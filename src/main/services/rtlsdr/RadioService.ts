import { configEvents } from '@main/ipc/utils'
import { AudioOutput } from '@main/services/audio'
import type { Config, RadioConfig } from '@shared/types'
import { BrowserWindow } from 'electron'

const SAMPLE_RATE = 2048000
const OUTPUT_RATE = 48000
const DEFAULT_FREQUENCY_MHZ = 100.0
const FAVORITES_SLOTS = 5
// User-driven frequency changes (stepping/seeking) can fire in quick bursts;
// debounce the "last frequency" write so each one doesn't hit disk.
const PERSIST_DEBOUNCE_MS = 1000

export const FM_BAND_MIN_MHZ = 87
export const FM_BAND_MAX_MHZ = 108
export const FM_STEP_MHZ = 0.05
export const FM_FAST_STEP_MHZ = 1.0

export type RadioMode = 'fm' | 'dab'

/// Mode-agnostic station metadata. FM populates this from RDS (PI/PS/RT/PTY);
/// a future DAB mode would populate the same shape from its service label /
/// dynamic label segment, so IPC/preload/UI consumers don't need to change.
export type StationInfo = {
  id: number
  genre: string
  name?: string
  text?: string
}

export type RadioState = {
  running: boolean
  frequencyMhz: number
  mode: RadioMode
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

function load(): RtlSdrAddon | null {
  if (addon || loadFailed) return addon
  try {
    addon = require('rtl-sdr-fm') as RtlSdrAddon
  } catch (e) {
    loadFailed = true
    console.error('[RadioService] native addon load failed:', (e as Error).message)
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

class RadioService {
  private deviceOpen = false
  private running = false
  private frequencyMhz = DEFAULT_FREQUENCY_MHZ
  private mode: RadioMode = 'fm'
  private pipeline: FMPipelineLike | null = null
  private audioOutput: AudioOutput | null = null
  private station: StationInfo | null = null
  private favorites: (number | null)[] = new Array(FAVORITES_SLOTS).fill(null)
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  /** Restores last frequency/mode/favorites from persisted config. Call once at app startup. */
  hydrate(radio: RadioConfig | undefined): void {
    if (!radio) return
    this.frequencyMhz = clampFrequency(radio.lastFrequencyMhz ?? DEFAULT_FREQUENCY_MHZ)
    this.mode = radio.lastMode ?? 'fm'
    const favorites = Array.isArray(radio.favorites) ? radio.favorites : []
    this.favorites = Array.from({ length: FAVORITES_SLOTS }, (_, i) => favorites[i] ?? null)
  }

  getState(): RadioState {
    return {
      running: this.running,
      frequencyMhz: this.frequencyMhz,
      mode: this.mode,
      station: this.station,
      favorites: this.favorites
    }
  }

  setMode(mode: RadioMode): RadioState {
    this.mode = mode
    this.schedulePersist()
    this.broadcastState()
    return this.getState()
  }

  getFavorites(): (number | null)[] {
    return this.favorites
  }

  /** Saves the current frequency into a preset slot, like holding a button on a real radio. */
  setFavorite(slot: number): RadioState {
    if (slot >= 0 && slot < FAVORITES_SLOTS) {
      this.favorites = this.favorites.map((f, i) => (i === slot ? this.frequencyMhz : f))
      this.persistNow()
      this.broadcastState()
    }
    return this.getState()
  }

  /** Tunes to whatever frequency is saved in a preset slot. No-op if the slot is empty. */
  recallFavorite(slot: number): RadioState {
    const freq = slot >= 0 && slot < FAVORITES_SLOTS ? this.favorites[slot] : null
    if (typeof freq === 'number') {
      if (!this.running) this.start(freq)
      else this.tune(clampFrequency(freq))
    }
    return this.getState()
  }

  start(frequencyMhz?: number): RadioState {
    if (typeof frequencyMhz === 'number' && Number.isFinite(frequencyMhz)) {
      this.frequencyMhz = clampFrequency(frequencyMhz)
    }

    if (this.running) {
      this.tune(this.frequencyMhz)
      return this.getState()
    }

    const a = load()
    if (!a) {
      this.broadcastError('RTL-SDR addon unavailable')
      return this.getState()
    }

    try {
      if (!this.deviceOpen) {
        const openResult = a.open(0)
        if (openResult !== 0) {
          this.broadcastError('Failed to open RTL-SDR device')
          return this.getState()
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

      a.readAsync((buf) => {
        if (!this.running || !this.pipeline || !this.audioOutput) return
        const audio = this.pipeline.process(buf)
        this.audioOutput.write(floatToInt16(audio))

        const station = toStationInfo(this.pipeline.rds())
        if (!stationInfoEqual(this.station, station)) {
          this.station = station
          this.broadcastState()
        }
      })

      this.running = true
      this.schedulePersist()
      this.broadcastState()
    } catch (e) {
      this.broadcastError((e as Error).message)
    }

    return this.getState()
  }

  stop(): RadioState {
    if (!this.running) return this.getState()

    const a = load()
    try {
      a?.stopAsync()
      a?.close()
    } catch (e) {
      console.error('[RadioService] stop failed:', (e as Error).message)
    }

    this.deviceOpen = false
    this.running = false
    this.pipeline = null
    this.station = null
    this.audioOutput?.stop()
    this.audioOutput = null

    this.broadcastState()
    return this.getState()
  }

  setFrequency(mhz: number): RadioState {
    this.tune(clampFrequency(mhz))
    return this.getState()
  }

  step(direction: 1 | -1, fast: boolean): RadioState {
    const delta = (fast ? FM_FAST_STEP_MHZ : FM_STEP_MHZ) * direction
    this.tune(clampFrequency(this.frequencyMhz + delta))
    return this.getState()
  }

  private tune(mhz: number): void {
    this.frequencyMhz = mhz
    if (this.running) {
      const a = load()
      try {
        a?.setFrequency(mhz * 1_000_000)
        // A new frequency means a different station — clear stale RDS data
        // and re-sync the demod chain rather than waiting for it to drift off.
        this.pipeline?.resetRds()
        this.station = null
      } catch (e) {
        this.broadcastError((e as Error).message)
        return
      }
    }
    this.schedulePersist()
    this.broadcastState()
  }

  /** Debounces writes for high-frequency changes (seeking/stepping). */
  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.persistNow()
    }, PERSIST_DEBOUNCE_MS)
  }

  private persistNow(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    const radio: RadioConfig = {
      lastFrequencyMhz: this.frequencyMhz,
      lastMode: this.mode,
      favorites: this.favorites
    }
    try {
      configEvents.emit('requestSave', { radio } satisfies Partial<Config>)
    } catch (e) {
      console.warn('[RadioService] requestSave failed (ignored)', e)
    }
  }

  private broadcastState(): void {
    const payload = { type: 'state', state: this.getState() }
    BrowserWindow.getAllWindows().forEach((win) => win.webContents.send('radio-event', payload))
  }

  private broadcastError(message: string): void {
    console.error('[RadioService]', message)
    const payload = { type: 'error', message }
    BrowserWindow.getAllWindows().forEach((win) => win.webContents.send('radio-event', payload))
  }
}

export const radioService = new RadioService()
