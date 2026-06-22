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

type FMPipelineLike = {
  process: (buffer: Buffer) => Float32Array
  rds: () => RdsInfoNative
  resetRds: () => void
}

type RtlSdrAddon = {
  getDeviceCount: () => number
  open: (index: number) => number
  close: () => void
  setSampleRate: (rate: number) => number
  setGain: (gain: number) => void
  setFrequency: (freq: number) => number
  readAsync: (cb: (buf: Buffer) => void) => void
  stopAsync: () => void
  FMPipeline: new (inputRate: number, outputRate: number) => FMPipelineLike
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

function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    let v = samples[i]
    if (v > 1) v = 1
    else if (v < -1) v = -1
    out[i] = Math.round(v * 32767)
  }
  return out
}

export class FmRadio {
  private deviceOpen = false
  private running = false
  private frequencyMhz = DEFAULT_FREQUENCY_MHZ
  private pipeline: FMPipelineLike | null = null
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

      this.pipeline = new a.FMPipeline(SAMPLE_RATE, OUTPUT_RATE)
      this.audioOutput = new AudioOutput({
        sampleRate: OUTPUT_RATE,
        channels: 1,
        mode: 'realtime'
      })
      this.audioOutput.start()

      a.readAsync((buf: Buffer) => {
        if (!this.running || !this.pipeline || !this.audioOutput) return
        const audio = this.pipeline.process(buf)
        this.audioOutput.write(floatToInt16(audio))

        const station = toStationInfo(this.pipeline.rds())
        if (!stationInfoEqual(this.station, station)) {
          this.station = station
          this.notify({ type: 'change' })
        }
      })

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
    this.pipeline = null
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
        a?.setFrequency(mhz * 1_000_000)
        // A new frequency means a different station — clear stale RDS data
        // and re-sync the demod chain rather than waiting for it to drift off.
        this.pipeline?.resetRds()
        this.station = null
      } catch (e) {
        this.notify({ type: 'error', message: (e as Error).message })
        return
      }
    }
    this.notify({ type: 'change' })
  }
}
