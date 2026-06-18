#![deny(clippy::all)]

use std::sync::Mutex;
use std::thread;

use desperado::Gain;
use desperado::rtlsdr::{AsyncRtlSdrReader, RtlSdrConfig, list_devices};
use fmradio::{AdaptiveResampler, DeemphasisFilter, PhaseExtractor};
use futures::StreamExt;
use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use num_complex::Complex;
use tokio::sync::mpsc::UnboundedSender;

/// Raw IQ chunks are delivered to JS as a plain `(buf: Buffer) => void` callback,
/// mirroring the old C++ addon's `readAsync`. FM demodulation lives entirely in
/// [`FmPipeline`] on the JS side of that boundary, so neither side needs to change
/// when the other does.
type RawIqCallback = ThreadsafeFunction<Buffer, (), Buffer, Status, false>;

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
  list_devices().map(|d| d.len() as u32).unwrap_or(0)
}

#[napi]
pub fn get_device_name(index: u32) -> String {
  list_devices()
    .ok()
    .and_then(|devices| devices.into_iter().find(|d| d.index == index as usize))
    .map(|d| if d.product.is_empty() { d.manufacturer } else { d.product })
    .unwrap_or_default()
}

#[napi]
pub fn open(index: u32) -> i32 {
  *PENDING.lock().unwrap() = Some(PendingConfig {
    device_index: index as usize,
    ..PendingConfig::default()
  });
  0
}

#[napi]
pub fn close() {
  if let Some(tx) = CMD_TX.lock().unwrap().take() {
    let _ = tx.send(StreamCommand::Stop);
  }
  *PENDING.lock().unwrap() = None;
}

#[napi]
pub fn set_sample_rate(rate: u32) -> i32 {
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
/// effect before streaming starts — `RadioService` never calls this while running.
#[napi]
pub fn set_gain(gain: i32) {
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

/// Starts streaming and delivers each raw IQ chunk to `callback`. Mirrors the old
/// C++ addon's `readAsync(callback)` — the callback receives interleaved unsigned
/// 8-bit I/Q bytes, not demodulated audio.
#[napi(ts_args_type = "callback: (buf: Buffer) => void")]
pub fn read_async(callback: RawIqCallback) -> Result<()> {
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
  if let Some(tx) = CMD_TX.lock().unwrap().take() {
    let _ = tx.send(StreamCommand::Stop);
  }
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
}

#[napi]
impl FmPipeline {
  #[napi(constructor)]
  pub fn new(input_rate: u32, output_rate: u32) -> Result<Self> {
    let ratio = output_rate as f64 / input_rate as f64;
    let resampler = AdaptiveResampler::new(ratio, 1, 1).map_err(Error::from_reason)?;

    Ok(Self {
      extractor: PhaseExtractor::new(),
      resampler,
      deemph: DeemphasisFilter::new(output_rate as f32, 50e-6),
      volume: 4.0,
    })
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

    let mut phase = self.extractor.process(&iq);
    for p in phase.iter_mut() {
      *p /= std::f32::consts::PI;
    }

    let resampled = self.resampler.process(&phase);
    let mut audio = self.deemph.process(&resampled);
    for a in audio.iter_mut() {
      *a = (*a * self.volume).clamp(-1.0, 1.0);
    }

    Float32Array::new(audio)
  }
}
