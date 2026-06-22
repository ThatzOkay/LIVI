import { AudioOutput } from '@main/services/audio'
import type { RadioConfig } from '@shared/types'
import type { BackendNotify } from './backendEvent'

const SAMPLE_RATE = 2048000
const OUTPUT_RATE = 48000
const DEFAULT_FREQUENCY_MHZ = 100.0
const FAVORITES_SLOTS = 5

export const FM_BAND_MIN_MHZ = 87
export const FM_BAND_MAX_MHZ = 108
export const FM_STEP_MHZ = 0.05
export const FM_FAST_STEP_MHZ = 1.0

/// Mode-agnostic station metadata. FM populates this from RDS (PI/PS/RT/PTY);
/// DAB populates the same shape from its service label, so IPC/preload/UI
/// consumers don't need to change.
export type StationInfo = {
  id: number
  genre: string
  name?: string
  text?: string
}

export type FmState = {
  running: boolean
  frequencyMhz: number
  station: StationInfo | null
  favorites: (number | null)[]
}

type RdsInfoNative = {
  programId: number
  programType: string
  stationName?: string
  radioText?: string
}

type RtlSdrAddon = {
  getDeviceCount: () => number
  open: (index: number) => number
  close: () => void
  setSampleRate: (rate: number) => number
  setGain: (gain: number) => void
  setFrequency: (freq: number) => number
  // Delivers already-demodulated 16-bit PCM, ready for AudioOutput.write() —
  // demodulation runs natively inside the addon's own streaming thread, never
  // on this (Electron's main) thread. See the addon's read_async() doc
  // comment for why that distinction matters under a throttled/weaker CPU.
  readAsync: (cb: (buf: Buffer) => void, outputRate: number) => void
  stopAsync: () => void
  getRds: () => RdsInfoNative
}

let addon: RtlSdrAddon | null = null
let loadFailed = false

// Dynamic import (not require()) so a missing/broken native module degrades
// gracefully via the catch below instead of crashing the app at startup.
async function load(): Promise<RtlSdrAddon | null> {
  if (addon || loadFailed) return addon
  try {
    addon = (await import('rtl-sdr-fm')) as unknown as RtlSdrAddon
  } catch (e) {
    loadFailed = true
    console.error('[FmRadio] native addon load failed:', (e as Error).message)
  }
  return addon
}

function clampFrequency(mhz: number): number {
  if (mhz > FM_BAND_MAX_MHZ) return FM_BAND_MIN_MHZ
  if (mhz < FM_BAND_MIN_MHZ) return FM_BAND_MAX_MHZ
  return Math.round(mhz * 100) / 100
}

function toStationInfo(r: RdsInfoNative): StationInfo | null {
  if (r.programId === 0 && !r.stationName && !r.radioText) return null
  return { id: r.programId, genre: r.programType, name: r.stationName, text: r.radioText }
}

function stationInfoEqual(a: StationInfo | null, b: StationInfo | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.id === b.id && a.genre === b.genre && a.name === b.name && a.text === b.text
}

export class FmRadio {
  private deviceOpen = false
  private running = false
  private frequencyMhz = DEFAULT_FREQUENCY_MHZ
  private audioOutput: AudioOutput | null = null
  private station: StationInfo | null = null
  private favorites: (number | null)[] = new Array(FAVORITES_SLOTS).fill(null)

  constructor(private readonly notify: BackendNotify) {}

  /** Restores last frequency/favorites from persisted config. Call once at app startup. */
  hydrate(radio: RadioConfig | undefined): void {
    if (!radio) return
    this.frequencyMhz = clampFrequency(radio.lastFrequencyMhz ?? DEFAULT_FREQUENCY_MHZ)
    const favorites = Array.isArray(radio.favorites) ? radio.favorites : []
    this.favorites = Array.from({ length: FAVORITES_SLOTS }, (_, i) => favorites[i] ?? null)
  }

  getState(): FmState {
    return {
      running: this.running,
      frequencyMhz: this.frequencyMhz,
      station: this.station,
      favorites: this.favorites
    }
  }

  /** Saves the current frequency into a preset slot, like holding a button on a real radio. */
  setFavorite(slot: number): void {
    if (slot >= 0 && slot < FAVORITES_SLOTS) {
      this.favorites = this.favorites.map((f, i) => (i === slot ? this.frequencyMhz : f))
      this.notify({ type: 'change' })
    }
  }

  /** Tunes to whatever frequency is saved in a preset slot. No-op if the slot is empty. */
  async recallFavorite(slot: number): Promise<void> {
    const freq = slot >= 0 && slot < FAVORITES_SLOTS ? this.favorites[slot] : null
    if (typeof freq === 'number') {
      if (!this.running) await this.start(freq)
      else await this.tune(clampFrequency(freq))
    }
  }

  async start(frequencyMhz?: number): Promise<void> {
    if (typeof frequencyMhz === 'number' && Number.isFinite(frequencyMhz)) {
      this.frequencyMhz = clampFrequency(frequencyMhz)
    }

    if (this.running) {
      await this.tune(this.frequencyMhz)
      return
    }

    const a = await load()
    if (!a) {
      this.notify({ type: 'error', message: 'RTL-SDR addon unavailable' })
      return
    }

    try {
      if (!this.deviceOpen) {
        // a.open() is a synchronous native call (no AsyncWorker, unlike
        // rtl-sdr-dab's start/stop/close) — if the USB tuner is still
        // claimed by DAB, this can block the entire main process JS thread
        // until libusb gives up or succeeds, which is exactly what an
        // OS-level "app not responding" looks like.
        const openResult = a.open(0)
        if (openResult !== 0) {
          this.notify({ type: 'error', message: 'Failed to open RTL-SDR device' })
          return
        }
        this.deviceOpen = true
        a.setSampleRate(SAMPLE_RATE)
        a.setGain(200)
      }

      a.setFrequency(this.frequencyMhz * 1_000_000)

      this.audioOutput = new AudioOutput({
        sampleRate: OUTPUT_RATE,
        channels: 1,
        mode: 'realtime'
      })
      this.audioOutput.start()

      // buf arrives already demodulated (native-side, off this thread) —
      // this callback only ever does cheap work: queue it for playback, and
      // occasionally check whether RDS text changed.
      a.readAsync((buf: Buffer) => {
        if (!this.running || !this.audioOutput) return
        this.audioOutput.write(buf)

        const station = toStationInfo(a.getRds())
        if (!stationInfoEqual(this.station, station)) {
          this.station = station
          this.notify({ type: 'change' })
        }
      }, OUTPUT_RATE)

      this.running = true
      this.notify({ type: 'change' })
    } catch (e) {
      this.notify({ type: 'error', message: (e as Error).message })
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return

    if (this.deviceOpen) {
      const a = await load()
      try {
        a?.stopAsync()
        a?.close()
      } catch (e) {
        console.error('[FmRadio] stop failed:', (e as Error).message)
      }
      this.deviceOpen = false
    }

    this.running = false
    this.station = null
    this.audioOutput?.stop()
    this.audioOutput = null

    this.notify({ type: 'change' })
  }

  async setFrequency(mhz: number): Promise<void> {
    await this.tune(clampFrequency(mhz))
  }

  async step(direction: 1 | -1, fast: boolean): Promise<void> {
    const delta = (fast ? FM_FAST_STEP_MHZ : FM_STEP_MHZ) * direction
    await this.tune(clampFrequency(this.frequencyMhz + delta))
  }

  private async tune(mhz: number): Promise<void> {
    this.frequencyMhz = mhz
    if (this.running && this.deviceOpen) {
      const a = await load()
      try {
        // The addon resets its own decoded RDS state for us, atomically with
        // the retune itself (see read_async()'s StreamCommand::Tune handling)
        // — a new frequency means a different station, so the old one's RDS
        // text must not linger.
        a?.setFrequency(mhz * 1_000_000)
        this.station = null
      } catch (e) {
        this.notify({ type: 'error', message: (e as Error).message })
        return
      }
    }
    this.notify({ type: 'change' })
  }
}
