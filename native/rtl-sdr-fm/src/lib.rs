#![deny(clippy::all)]

use std::sync::Mutex;
use std::thread;

use desperado::Gain;
use desperado::dsp::DspBlock;
use desperado::dsp::decimator::Decimator;
use desperado::rtlsdr::{AsyncRtlSdrReader, RtlSdrConfig, list_devices};
use fmradio::rds::{RdsDecoder, RdsResamplerCustom, StereoDecoderPLL};
use fmradio::{AdaptiveResampler, DeemphasisFilter, PhaseExtractor};
use futures::StreamExt;
use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use num_complex::Complex;
use tokio::sync::mpsc::UnboundedSender;

/// `rs_rtl` (used by `desperado`, our primary backend) only drives R820T/R828D
/// tuners and only recognizes the generic Realtek USB IDs. Older or OEM-rebranded
/// RTL2832U dongles — e.g. the TerraTec NOXON DAB/DAB+ stick, which uses a
/// Fitipower FC0013 tuner — aren't visible to it at all. Real `librtlsdr` (the
/// C library the old addon linked against) supports every tuner chip, so it's
/// kept here as a fallback for exactly the hardware `rs_rtl` can't see.
mod librtlsdr_ffi {
  use std::os::raw::{c_char, c_int, c_void};

  pub type RtlSdrDev = *mut c_void;
  pub type ReadAsyncCb = extern "C" fn(buf: *mut u8, len: u32, ctx: *mut c_void);

  #[link(name = "rtlsdr")]
  unsafe extern "C" {
    pub fn rtlsdr_get_device_count() -> u32;
    pub fn rtlsdr_get_device_name(index: u32) -> *const c_char;
    pub fn rtlsdr_open(dev: *mut RtlSdrDev, index: u32) -> c_int;
    pub fn rtlsdr_close(dev: RtlSdrDev) -> c_int;
    pub fn rtlsdr_set_center_freq(dev: RtlSdrDev, freq: u32) -> c_int;
    pub fn rtlsdr_set_sample_rate(dev: RtlSdrDev, rate: u32) -> c_int;
    pub fn rtlsdr_set_tuner_gain_mode(dev: RtlSdrDev, manual: c_int) -> c_int;
    pub fn rtlsdr_set_tuner_gain(dev: RtlSdrDev, gain: c_int) -> c_int;
    pub fn rtlsdr_reset_buffer(dev: RtlSdrDev) -> c_int;
    pub fn rtlsdr_read_async(
      dev: RtlSdrDev,
      cb: ReadAsyncCb,
      ctx: *mut c_void,
      buf_num: u32,
      buf_len: u32,
    ) -> c_int;
    pub fn rtlsdr_cancel_async(dev: RtlSdrDev) -> c_int;
  }
}

/// Raw pointer handle for an open `librtlsdr` device. `rtlsdr_dev_t*` is safe to
/// use from another thread as long as calls don't overlap — guarded here the same
/// way the old C++ addon relied on librtlsdr's internal locking: a single global
/// handle, streamed on one thread, configured from any thread.
struct FfiDevHandle(librtlsdr_ffi::RtlSdrDev);
unsafe impl Send for FfiDevHandle {}

impl FfiDevHandle {
  /// Returns the raw pointer through a method call rather than tuple-struct
  /// destructuring, so closures capture the whole `Send` wrapper instead of the
  /// (non-`Send`) pointer field directly via disjoint capture.
  fn ptr(&self) -> librtlsdr_ffi::RtlSdrDev {
    self.0
  }
}

/// Raw IQ chunks are delivered to JS as a plain `(buf: Buffer) => void` callback,
/// mirroring the old C++ addon's `readAsync`. FM demodulation lives entirely in
/// [`FmPipeline`] on the JS side of that boundary, so neither side needs to change
/// when the other does.
type RawIqCallback = ThreadsafeFunction<Buffer, (), Buffer, Status, false>;

enum ActiveBackend {
  Desperado,
  Ffi,
}

static ACTIVE_BACKEND: Mutex<Option<ActiveBackend>> = Mutex::new(None);
static FFI_DEV: Mutex<Option<FfiDevHandle>> = Mutex::new(None);

/// Hardware access goes through `desperado`, which bundles device index, sample
/// rate, gain and frequency into one `RtlSdrConfig` consumed only when streaming
/// actually starts. `open`/`setSampleRate`/`setGain`/`setFrequency` accumulate the
/// desired config here until `readAsync` opens the device for real.
#[derive(Clone)]
struct PendingConfig {
  device_index: usize,
  sample_rate: u32,
  gain: Gain,
  center_freq: u32,
}

impl Default for PendingConfig {
  fn default() -> Self {
    Self {
      device_index: 0,
      sample_rate: 2_048_000,
      gain: Gain::Manual(10.0),
      center_freq: 100_000_000,
    }
  }
}

/// Sent to the streaming task. Retuning is a cheap channel send handled inside
/// the same task that polls IQ samples, so JS-facing calls never block waiting
/// on the next USB chunk.
enum StreamCommand {
  Tune(u32),
  Stop,
}

static PENDING: Mutex<Option<PendingConfig>> = Mutex::new(None);
static CMD_TX: Mutex<Option<UnboundedSender<StreamCommand>>> = Mutex::new(None);

#[napi]
pub fn get_device_count() -> u32 {
  let desperado_count = list_devices().map(|d| d.len() as u32).unwrap_or(0);
  if desperado_count > 0 {
    return desperado_count;
  }
  unsafe { librtlsdr_ffi::rtlsdr_get_device_count() }
}

#[napi]
pub fn get_device_name(index: u32) -> String {
  if let Some(devices) = list_devices().ok().filter(|d| !d.is_empty()) {
    return devices
      .into_iter()
      .find(|d| d.index == index as usize)
      .map(|d| if d.product.is_empty() { d.manufacturer } else { d.product })
      .unwrap_or_default();
  }

  unsafe {
    let ptr = librtlsdr_ffi::rtlsdr_get_device_name(index);
    if ptr.is_null() {
      String::new()
    } else {
      std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned()
    }
  }
}

#[napi]
pub fn open(index: u32) -> i32 {
  let desperado_count = list_devices().map(|d| d.len()).unwrap_or(0);
  if (index as usize) < desperado_count {
    *PENDING.lock().unwrap() = Some(PendingConfig {
      device_index: index as usize,
      ..PendingConfig::default()
    });
    *ACTIVE_BACKEND.lock().unwrap() = Some(ActiveBackend::Desperado);
    return 0;
  }

  // Fall back to real librtlsdr for hardware rs_rtl doesn't recognize.
  let ffi_count = unsafe { librtlsdr_ffi::rtlsdr_get_device_count() };
  if (index as usize) < ffi_count as usize {
    let mut dev: librtlsdr_ffi::RtlSdrDev = std::ptr::null_mut();
    let r = unsafe { librtlsdr_ffi::rtlsdr_open(&mut dev, index) };
    if r == 0 {
      *FFI_DEV.lock().unwrap() = Some(FfiDevHandle(dev));
      *ACTIVE_BACKEND.lock().unwrap() = Some(ActiveBackend::Ffi);
      return 0;
    }
    eprintln!("[rtl-sdr] librtlsdr open failed: {r}");
    return -1;
  }

  -1
}

#[napi]
pub fn close() {
  match ACTIVE_BACKEND.lock().unwrap().take() {
    Some(ActiveBackend::Ffi) => {
      if let Some(FfiDevHandle(dev)) = FFI_DEV.lock().unwrap().take() {
        unsafe {
          librtlsdr_ffi::rtlsdr_cancel_async(dev);
          librtlsdr_ffi::rtlsdr_close(dev);
        }
      }
    }
    Some(ActiveBackend::Desperado) | None => {
      if let Some(tx) = CMD_TX.lock().unwrap().take() {
        let _ = tx.send(StreamCommand::Stop);
      }
      *PENDING.lock().unwrap() = None;
    }
  }
}

#[napi]
pub fn set_sample_rate(rate: u32) -> i32 {
  if matches!(*ACTIVE_BACKEND.lock().unwrap(), Some(ActiveBackend::Ffi)) {
    return match FFI_DEV.lock().unwrap().as_ref() {
      Some(FfiDevHandle(dev)) => unsafe { librtlsdr_ffi::rtlsdr_set_sample_rate(*dev, rate) },
      None => -1,
    };
  }

  match PENDING.lock().unwrap().as_mut() {
    Some(pending) => {
      pending.sample_rate = rate;
      0
    }
    None => -1,
  }
}

/// `gain < 0` selects automatic gain, matching the old C++ addon's `-1 = auto`
/// convention, expressed in tenths of dB like the rest of this API. Only takes
/// effect before streaming starts on the `desperado` backend — `RadioService`
/// never calls this while running. The `librtlsdr` fallback applies it immediately,
/// matching the old C++ addon.
#[napi]
pub fn set_gain(gain: i32) {
  if matches!(*ACTIVE_BACKEND.lock().unwrap(), Some(ActiveBackend::Ffi)) {
    if let Some(FfiDevHandle(dev)) = FFI_DEV.lock().unwrap().as_ref() {
      unsafe {
        if gain < 0 {
          librtlsdr_ffi::rtlsdr_set_tuner_gain_mode(*dev, 0);
        } else {
          librtlsdr_ffi::rtlsdr_set_tuner_gain_mode(*dev, 1);
          librtlsdr_ffi::rtlsdr_set_tuner_gain(*dev, gain);
        }
      }
    }
    return;
  }

  if let Some(pending) = PENDING.lock().unwrap().as_mut() {
    pending.gain = if gain < 0 {
      Gain::Auto
    } else {
      Gain::Manual(gain as f64 / 10.0)
    };
  }
}

#[napi]
pub fn set_frequency(freq: u32) -> i32 {
  if matches!(*ACTIVE_BACKEND.lock().unwrap(), Some(ActiveBackend::Ffi)) {
    return match FFI_DEV.lock().unwrap().as_ref() {
      Some(FfiDevHandle(dev)) => unsafe { librtlsdr_ffi::rtlsdr_set_center_freq(*dev, freq) },
      None => -1,
    };
  }

  let cmd_tx = CMD_TX.lock().unwrap().clone();
  if let Some(tx) = cmd_tx {
    return match tx.send(StreamCommand::Tune(freq)) {
      Ok(()) => 0,
      Err(e) => {
        eprintln!("[rtl-sdr] tune failed: {e}");
        -1
      }
    };
  }

  match PENDING.lock().unwrap().as_mut() {
    Some(pending) => {
      pending.center_freq = freq;
      0
    }
    None => -1,
  }
}

/// `desperado::IqAsyncSource` already hands back demodulator-ready `Complex<f32>`
/// samples; converting back to interleaved cu8 bytes keeps `readAsync`'s JS-facing
/// contract (and [`FmPipeline::process`]) byte-for-byte unchanged.
fn complex_to_cu8(samples: &[Complex<f32>]) -> Vec<u8> {
  let mut bytes = Vec::with_capacity(samples.len() * 2);
  for c in samples {
    bytes.push((c.re * 128.0 + 127.5).clamp(0.0, 255.0) as u8);
    bytes.push((c.im * 128.0 + 127.5).clamp(0.0, 255.0) as u8);
  }
  bytes
}

/// C callback trampoline for the `librtlsdr` fallback: forwards each raw IQ chunk
/// to the boxed [`RawIqCallback`] passed in as `ctx`.
extern "C" fn ffi_read_callback(buf: *mut u8, len: u32, ctx: *mut std::os::raw::c_void) {
  if buf.is_null() || len == 0 || ctx.is_null() {
    return;
  }
  let callback = unsafe { &*(ctx as *const RawIqCallback) };
  let bytes = unsafe { std::slice::from_raw_parts(buf, len as usize) }.to_vec();
  callback.call(Buffer::from(bytes), ThreadsafeFunctionCallMode::NonBlocking);
}

/// Starts streaming and delivers each raw IQ chunk to `callback`. Mirrors the old
/// C++ addon's `readAsync(callback)` — the callback receives interleaved unsigned
/// 8-bit I/Q bytes, not demodulated audio.
#[napi(ts_args_type = "callback: (buf: Buffer) => void")]
pub fn read_async(callback: RawIqCallback) -> Result<()> {
  if matches!(*ACTIVE_BACKEND.lock().unwrap(), Some(ActiveBackend::Ffi)) {
    let dev = match FFI_DEV.lock().unwrap().as_ref() {
      Some(FfiDevHandle(dev)) => FfiDevHandle(*dev),
      None => return Err(Error::from_reason("RTL-SDR device not open")),
    };

    let ctx = Box::into_raw(Box::new(callback)) as usize;
    thread::spawn(move || {
      let dev = dev.ptr();
      let ctx = ctx as *mut std::os::raw::c_void;
      unsafe {
        librtlsdr_ffi::rtlsdr_reset_buffer(dev);
        librtlsdr_ffi::rtlsdr_read_async(dev, ffi_read_callback, ctx, 0, 0);
        drop(Box::from_raw(ctx as *mut RawIqCallback));
      }
    });

    return Ok(());
  }

  let pending = PENDING
    .lock()
    .unwrap()
    .clone()
    .ok_or_else(|| Error::from_reason("RTL-SDR device not open"))?;

  let config = RtlSdrConfig::new(
    pending.device_index,
    pending.center_freq,
    pending.sample_rate,
    pending.gain,
  );

  let (cmd_tx, mut cmd_rx) = tokio::sync::mpsc::unbounded_channel::<StreamCommand>();
  *CMD_TX.lock().unwrap() = Some(cmd_tx);

  thread::spawn(move || {
    let rt = match tokio::runtime::Builder::new_current_thread().build() {
      Ok(rt) => rt,
      Err(e) => {
        eprintln!("[rtl-sdr] failed to start runtime: {e}");
        return;
      }
    };

    rt.block_on(async move {
      let mut reader = match AsyncRtlSdrReader::new(&config) {
        Ok(reader) => reader,
        Err(e) => {
          eprintln!("[rtl-sdr] failed to start streaming: {e}");
          return;
        }
      };

      loop {
        tokio::select! {
          sample = reader.next() => match sample {
            Some(Ok(samples)) => {
              callback.call(
                Buffer::from(complex_to_cu8(&samples)),
                ThreadsafeFunctionCallMode::NonBlocking,
              );
            }
            Some(Err(e)) => {
              eprintln!("[rtl-sdr] stream error: {e}");
              break;
            }
            None => break,
          },
          cmd = cmd_rx.recv() => match cmd {
            Some(StreamCommand::Tune(freq)) => {
              if let Err(e) = reader.tune(freq) {
                eprintln!("[rtl-sdr] tune failed: {e}");
              }
            }
            Some(StreamCommand::Stop) | None => break,
          },
        }
      }
    });
  });

  Ok(())
}

#[napi]
pub fn stop_async() {
  if matches!(*ACTIVE_BACKEND.lock().unwrap(), Some(ActiveBackend::Ffi)) {
    if let Some(FfiDevHandle(dev)) = FFI_DEV.lock().unwrap().as_ref() {
      unsafe {
        librtlsdr_ffi::rtlsdr_cancel_async(*dev);
      }
    }
    return;
  }

  if let Some(tx) = CMD_TX.lock().unwrap().take() {
    let _ = tx.send(StreamCommand::Stop);
  }
}

/// RDS (station name / radio text) metadata decoded from the same wideband
/// signal the audio path demodulates. Pulled by JS via [`FmPipeline::rds`]
/// rather than pushed, since it only changes a few times a minute.
#[napi(object)]
pub struct RdsInfo {
  pub program_id: u32,
  pub program_type: String,
  pub station_name: Option<String>,
  pub radio_text: Option<String>,
}

/// FM demodulation pipeline: phase-difference demodulation, adaptive resampling
/// down to the output rate, then de-emphasis. Exported as `FMPipeline` to match
/// the old C++ addon's JS-facing class name (`#[napi(js_name)]` below) — `clippy`
/// flags `FMPipeline` itself as an upper-case-acronym struct name.
#[napi(js_name = "FMPipeline")]
pub struct FmPipeline {
  extractor: PhaseExtractor,
  resampler: AdaptiveResampler,
  deemph: DeemphasisFilter,
  volume: f32,
  // RDS is decoded from the same raw (pre-normalized) wideband phase signal,
  // before deemphasis/resampling — the 19kHz pilot and 57kHz RDS subcarrier
  // live above the audio band the resampler later filters down to. Running the
  // stereo/RDS FIR+resampling chain at the full IQ rate is ~4x too slow for
  // real time, so it runs off a decimated copy of `phase` instead — the audio
  // path below is untouched and still runs at full rate.
  mpx_rate: f32,
  decim_factor: usize,
  mpx_decimator: Decimator,
  stereo: StereoDecoderPLL,
  rds_resampler: RdsResamplerCustom,
  rds: RdsDecoder,
}

impl FmPipeline {
  // 171 kHz gives exactly 3 samples per 2375 Hz RDS symbol (matches redsea/fmradio's
  // own CLI architecture), independent of the FM audio output rate.
  const RDS_TARGET_RATE: f32 = 171_000.0;
  // Matches fmradio's own CLI: decimate the wideband signal down to ~240kHz
  // before stereo/RDS DSP — comfortably above the 57kHz RDS subcarrier, but
  // a fraction of the cost of running those filters at the full IQ rate.
  const FM_BANDWIDTH: f32 = 240_000.0;

  fn new_rds_decoder() -> RdsDecoder {
    let mut rds = RdsDecoder::new(Self::RDS_TARGET_RATE, false);
    rds.set_print_json_output(false);
    rds
  }
}

#[napi]
impl FmPipeline {
  #[napi(constructor)]
  pub fn new(input_rate: u32, output_rate: u32) -> Result<Self> {
    let ratio = output_rate as f64 / input_rate as f64;
    let resampler = AdaptiveResampler::new(ratio, 1, 1).map_err(Error::from_reason)?;

    let decim_factor = ((input_rate as f32) / Self::FM_BANDWIDTH).round().max(1.0) as usize;
    let mpx_rate = input_rate as f32 / decim_factor as f32;

    Ok(Self {
      extractor: PhaseExtractor::new(),
      resampler,
      deemph: DeemphasisFilter::new(output_rate as f32, 50e-6),
      volume: 10.0,
      mpx_rate,
      decim_factor,
      mpx_decimator: Decimator::new(decim_factor),
      stereo: StereoDecoderPLL::new(mpx_rate),
      rds_resampler: RdsResamplerCustom::new(mpx_rate, Self::RDS_TARGET_RATE),
      rds: Self::new_rds_decoder(),
    })
  }

  /// Clears decoded RDS state (PI/PS/RT/PTY) and re-syncs the stereo pilot PLL and
  /// RDS demod chain. Call this after retuning — a new frequency means a different
  /// station, so the old station's RDS data must not linger.
  #[napi]
  pub fn reset_rds(&mut self) {
    self.mpx_decimator = Decimator::new(self.decim_factor);
    self.stereo = StereoDecoderPLL::new(self.mpx_rate);
    self.rds_resampler = RdsResamplerCustom::new(self.mpx_rate, Self::RDS_TARGET_RATE);
    self.rds = Self::new_rds_decoder();
  }

  #[napi]
  pub fn process(&mut self, buf: Buffer) -> Float32Array {
    let bytes: &[u8] = &buf;
    let n = bytes.len() / 2;
    let mut iq: Vec<Complex<f32>> = Vec::with_capacity(n);
    for i in 0..n {
      let re = (bytes[2 * i] as f32 - 127.5) / 128.0;
      let im = (bytes[2 * i + 1] as f32 - 127.5) / 128.0;
      iq.push(Complex::new(re, im));
    }

    let phase = self.extractor.process(&iq);

    // Stereo PLL locks onto the 19kHz pilot; RDS mixes coherently off 3x that
    // phase to find the 57kHz subcarrier. Both need the raw, unnormalized phase,
    // decimated down to a rate the FIR/resampling chain can keep up with.
    let phase_complex: Vec<Complex<f32>> = phase.iter().map(|&p| Complex::new(p, 0.0)).collect();
    let mpx: Vec<f32> = self.mpx_decimator.process(&phase_complex).iter().map(|c| c.re).collect();
    let (_left, _right, pilot_phases) = self.stereo.process(&mpx);
    let (rds_i, rds_q) = self.rds_resampler.process_with_pilot(&mpx, &pilot_phases);
    if !rds_i.is_empty() {
      self.rds.process_iq(&rds_i, &rds_q);
    }

    let mut mono = phase;
    for p in mono.iter_mut() {
      *p /= std::f32::consts::PI;
    }

    let resampled = self.resampler.process(&mono);
    let mut audio = self.deemph.process(&resampled);
    for a in audio.iter_mut() {
      *a = (*a * self.volume).clamp(-1.0, 1.0);
    }

    Float32Array::new(audio)
  }

  #[napi]
  pub fn rds(&self) -> RdsInfo {
    RdsInfo {
      program_id: self.rds.program_id() as u32,
      program_type: self.rds.program_type(),
      station_name: self.rds.station_name(),
      radio_text: self.rds.radio_text(),
    }
  }
}
