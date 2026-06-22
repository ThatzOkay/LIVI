import { configEvents } from '@main/ipc/utils'
import type { Config, DabStationRef, RadioConfig } from '@shared/types'
import { BrowserWindow } from 'electron'
import type { BackendEvent } from './backendEvent'
import { DabRadio, type DabState } from './DabRadio'
import { FmRadio, type StationInfo } from './FmRadio'

export type { DabState } from './DabRadio'
export type { StationInfo } from './FmRadio'
export { FM_BAND_MAX_MHZ, FM_BAND_MIN_MHZ, FM_FAST_STEP_MHZ, FM_STEP_MHZ } from './FmRadio'

const PERSIST_DEBOUNCE_MS = 1000

export type RadioMode = 'fm' | 'dab'

export type RadioState = {
  running: boolean
  frequencyMhz: number
  mode: RadioMode
  station: StationInfo | null
  favorites: (number | null)[]
}

/**
 * Thin orchestrator: owns which band is active and delegates playback to
 * whichever backend (FmRadio / DabRadio) the active mode maps to. Each
 * backend manages its own hardware/native addon and reports changes back
 * via a notify callback, so persistence and broadcasting only happen here.
 */
class RadioService {
  private mode: RadioMode = 'fm'
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  private readonly fm = new FmRadio((event) => this.onFmEvent(event))
  private readonly dab = new DabRadio((event) => this.onDabEvent(event))

  /** Restores last mode + both backends' persisted state. Call once at app startup. */
  async hydrate(radio: RadioConfig | undefined): Promise<void> {
    if (!radio) return
    this.mode = radio.lastMode ?? 'fm'
    this.fm.hydrate(radio)
    await this.dab.hydrate(radio)
  }

  getState(): RadioState {
    const fm = this.fm.getState()
    return {
      running: fm.running,
      frequencyMhz: fm.frequencyMhz,
      mode: this.mode,
      station: fm.station,
      favorites: fm.favorites
    }
  }

  getDabState(): DabState {
    return this.dab.getState()
  }

  setMode(mode: RadioMode): RadioState {
    this.mode = mode
    this.schedulePersist()
    this.broadcastFmState()
    return this.getState()
  }

  // ── FM ───────────────────────────────────────────────────────────────────
  async startFm(frequencyMhz?: number): Promise<RadioState> {
    await this.fm.start(frequencyMhz)
    return this.getState()
  }

  async stopFm(): Promise<RadioState> {
    await this.fm.stop()
    return this.getState()
  }

  async setFmFrequency(mhz: number): Promise<RadioState> {
    await this.fm.setFrequency(mhz)
    return this.getState()
  }

  async stepFm(direction: 1 | -1, fast: boolean): Promise<RadioState> {
    await this.fm.step(direction, fast)
    return this.getState()
  }

  /** A deliberate save action — persisted immediately rather than debounced. */
  setFmFavorite(slot: number): RadioState {
    this.fm.setFavorite(slot)
    this.persistNow()
    return this.getState()
  }

  async recallFmFavorite(slot: number): Promise<RadioState> {
    await this.fm.recallFavorite(slot)
    return this.getState()
  }

  // ── DAB ──────────────────────────────────────────────────────────────────
  async scanDabStations(): Promise<DabState> {
    await this.dab.scan()
    return this.getDabState()
  }

  async selectDabStation(station: DabStationRef): Promise<DabState> {
    await this.dab.selectStation(station)
    return this.getDabState()
  }

  async stopDab(): Promise<DabState> {
    await this.dab.stop()
    return this.getDabState()
  }

  /** A deliberate save action — persisted immediately rather than debounced. */
  setDabFavorite(slot: number): DabState {
    this.dab.setFavorite(slot)
    this.persistNow()
    return this.getDabState()
  }

  async recallDabFavorite(slot: number): Promise<DabState> {
    await this.dab.recallFavorite(slot)
    return this.getDabState()
  }

  private onFmEvent(event: BackendEvent): void {
    if (event.type === 'error') {
      this.broadcastError(event.message)
      return
    }
    this.schedulePersist()
    this.broadcastFmState()
  }

  private onDabEvent(event: BackendEvent): void {
    if (event.type === 'error') {
      this.broadcastError(event.message)
      return
    }
    this.schedulePersist()
    this.broadcastDabState()
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
    const fm = this.fm.getState()
    const dab = this.dab.getState()
    const radio: RadioConfig = {
      lastFrequencyMhz: fm.frequencyMhz,
      lastMode: this.mode,
      favorites: fm.favorites,
      // Strip the runtime-only cached image — config is for lean settings,
      // not image blobs. The disk image cache is the source of truth and
      // gets re-attached on the next hydrate().
      dabFavorites: dab.favorites.map((f) =>
        f ? { id: f.id, label: f.label, channel: f.channel, frequencyHz: f.frequencyHz } : null
      )
    }
    try {
      configEvents.emit('requestSave', { radio } satisfies Partial<Config>)
    } catch (e) {
      console.warn('[RadioService] requestSave failed (ignored)', e)
    }
  }

  private broadcastFmState(): void {
    const payload = { type: 'state', state: this.getState() }
    BrowserWindow.getAllWindows().forEach((win) => win.webContents.send('radio-event', payload))
  }

  private broadcastDabState(): void {
    const payload = { type: 'dab-state', state: this.getDabState() }
    BrowserWindow.getAllWindows().forEach((win) => win.webContents.send('radio-event', payload))
  }

  private broadcastError(message: string): void {
    console.error('[RadioService]', message)
    const payload = { type: 'error', message }
    BrowserWindow.getAllWindows().forEach((win) => win.webContents.send('radio-event', payload))
  }
}

export const radioService = new RadioService()
