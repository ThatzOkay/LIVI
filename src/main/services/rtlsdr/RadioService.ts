import { AudioOutput } from '@main/services/audio'
import { BrowserWindow } from 'electron'

const SAMPLE_RATE = 2048000
const OUTPUT_RATE = 48000
const DEFAULT_FREQUENCY_MHZ = 100.0

export const FM_BAND_MIN_MHZ = 87
export const FM_BAND_MAX_MHZ = 108
export const FM_STEP_MHZ = 0.1
export const FM_FAST_STEP_MHZ = 1.0

export type RadioMode = 'fm' | 'dab'

export type RadioState = {
  running: boolean
  frequencyMhz: number
  mode: RadioMode
}

type FMPipelineLike = {
  process: (buffer: Buffer) => Float32Array
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
  return Math.round(mhz * 10) / 10
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

  getState(): RadioState {
    return { running: this.running, frequencyMhz: this.frequencyMhz, mode: this.mode }
  }

  setMode(mode: RadioMode): RadioState {
    this.mode = mode
    this.broadcastState()
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
        a.setGain(150)
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
      })

      this.running = true
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
      } catch (e) {
        this.broadcastError((e as Error).message)
        return
      }
    }
    this.broadcastState()
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
