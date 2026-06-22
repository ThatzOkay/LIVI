import { AudioOutput } from '@main/services/audio'
import type { DabStationRef, RadioConfig } from '@shared/types'
import type { BackendNotify } from './backendEvent'
import { DabImageCache } from './dabImageCache'
import { DabStationCache, type DabStationRecord } from './dabStationCache'

const FAVORITES_SLOTS = 5
// Time to let the receiver sync to a new channel and the FIC announce the
// target service before giving up and selecting anyway.
const SYNC_TIMEOUT_MS = 8000
// Used to rank label-matched stations by signal strength when a real SNR
// reading isn't available (e.g. entries loaded from disk before this
// feature existed) — low enough to always lose to any real measurement.
const SNR_FALLBACK = -1000

// Runtime-only enrichment of a station with its cached slideshow image (if
// any has ever been captured for it). Never persisted to config — the image
// cache on disk is the source of truth, this is just attached for display.
export type DabStationView = DabStationRef & { imageUrl?: string }

// Internal per-channel record: every (channel, id) variant ever seen, each
// carrying the signal strength it was measured with. getState() never
// exposes this directly — it's collapsed via groupedStations() first, since
// the same station broadcast on multiple channels should show up as one
// tile, not one per channel.
type DabStationInternal = DabStationView & DabStationRecord

export type DabState = {
  running: boolean
  scanning: boolean
  scanningChannel: string | null
  stations: DabStationView[]
  currentStation: DabStationView | null
  favorites: (DabStationView | null)[]
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase()
}

function snrOf(station: DabStationRecord): number {
  return typeof station.snr === 'number' ? station.snr : SNR_FALLBACK
}

type NativeDabService = { id: number; label: string }
type NativeDabStation = DabStationRecord
type NativeDabRadio = {
  start: (frequencyHz: number) => Promise<unknown>
  stop: () => Promise<unknown>
  close: () => Promise<unknown>
  selectService: (serviceId: number) => void
  scanStations: (opts?: {
    noSignalTimeoutMs?: number
    signalDwellMs?: number
  }) => Promise<NativeDabStation[]>
  on: (event: string, listener: (...args: never[]) => void) => void
  off: (event: string, listener: (...args: never[]) => void) => void
}
type DabAddonModule = { DabRadio: new () => NativeDabRadio }

let nativeModule: DabAddonModule | null = null
let loadFailed = false

// Dynamic import (not require()) so a missing/broken native module degrades
// gracefully via the catch below instead of crashing the app at startup.
async function load(): Promise<DabAddonModule | null> {
  if (nativeModule || loadFailed) return nativeModule
  try {
    nativeModule = (await import('rtl-sdr-dab')) as unknown as DabAddonModule
  } catch (e) {
    loadFailed = true
    console.error('[DabRadio] native addon load failed:', (e as Error).message)
  }
  return nativeModule
}

export class DabRadio {
  private radio: NativeDabRadio | null = null
  private tunedFrequencyHz: number | null = null
  private running = false
  private scanning = false
  private scanningChannel: string | null = null
  private allStations: DabStationInternal[] = []
  private currentStation: DabStationView | null = null
  private favorites: (DabStationView | null)[] = new Array(FAVORITES_SLOTS).fill(null)
  private audioOutput: AudioOutput | null = null
  private audioSampleRate = 0
  private readonly imageCache = new DabImageCache()
  private readonly stationCache = new DabStationCache()

  constructor(private readonly notify: BackendNotify) {}

  /**
   * Restores saved favorites and the last full scan's station list (each
   * with any cached artwork) from disk. Call once at app startup. A DAB
   * ensemble's lineup rarely changes between sessions, so this gives an
   * immediately-usable station grid without forcing a re-scan every time.
   */
  async hydrate(radio: RadioConfig | undefined): Promise<void> {
    await Promise.all([this.imageCache.whenReady(), this.stationCache.whenReady()])

    this.allStations = this.stationCache.get().map((station) => {
      const imageUrl = this.imageCache.get(station.channel, station.id)
      return imageUrl ? { ...station, imageUrl } : station
    })

    if (!radio) return
    const favorites = Array.isArray(radio.dabFavorites) ? radio.dabFavorites : []
    this.favorites = Array.from({ length: FAVORITES_SLOTS }, (_, i) => {
      const fav = favorites[i] ?? null
      if (!fav) return null
      const imageUrl = this.imageCache.get(fav.channel, fav.id)
      return imageUrl ? { ...fav, imageUrl } : fav
    })
  }

  getState(): DabState {
    return {
      running: this.running,
      scanning: this.scanning,
      scanningChannel: this.scanningChannel,
      stations: this.groupedStations(),
      currentStation: this.currentStation,
      favorites: this.favorites
    }
  }

  /**
   * The same station is sometimes broadcast on more than one channel —
   * different regional ensembles often carry the same national network
   * (e.g. SLAM! seen on both 11C and 8B). Collapse those into a single
   * tile using whichever channel currently measures strongest, rather
   * than showing one tile per channel for what's really the same station.
   * Entries with no label can't be matched this way, so each stays its own
   * group.
   */
  private groupedStations(): DabStationView[] {
    const groups = new Map<string, DabStationInternal[]>()
    for (const station of this.allStations) {
      const key = normalizeLabel(station.label) || `${station.channel}:${station.id}`
      const list = groups.get(key)
      if (list) list.push(station)
      else groups.set(key, [station])
    }
    return Array.from(groups.values(), (variants) =>
      variants.reduce((best, s) => (snrOf(s) > snrOf(best) ? s : best))
    )
  }

  /** The currently-strongest known channel variant for a given label, if any. */
  private bestVariantForLabel(label: string): DabStationInternal | undefined {
    const key = normalizeLabel(label)
    if (!key) return undefined
    return this.allStations
      .filter((s) => normalizeLabel(s.label) === key)
      .reduce<DabStationInternal | undefined>(
        (best, s) => (!best || snrOf(s) > snrOf(best) ? s : best),
        undefined
      )
  }

  private async ensureRadio(): Promise<NativeDabRadio | null> {
    if (this.radio) return this.radio

    const mod = await load()
    if (!mod) {
      this.notify({ type: 'error', message: 'DAB addon unavailable' })
      return null
    }

    const radio = new mod.DabRadio()
    radio.on('audio', (...args: unknown[]) => {
      const { buffer, samplerate, stereo } = args[0] as {
        buffer: Buffer
        samplerate: number
        stereo: boolean
      }
      this.onAudio(buffer, samplerate, stereo)
    })
    radio.on('slide', (...args: unknown[]) => {
      const { buffer, mimeType } = args[0] as { buffer: Buffer; mimeType: string }
      void this.onSlide(buffer, mimeType)
    })
    this.radio = radio
    return radio
  }

  private onAudio(buffer: Buffer, sampleRate: number, stereo: boolean): void {
    const channels = stereo ? 2 : 1
    if (!this.audioOutput || this.audioSampleRate !== sampleRate) {
      this.audioOutput?.stop()
      this.audioOutput = new AudioOutput({ sampleRate, channels, mode: 'realtime' })
      this.audioOutput.start()
      this.audioSampleRate = sampleRate
    }
    this.audioOutput.write(buffer)
  }

  // MOT slides are only ever broadcast for the currently-tuned programme, so
  // whatever arrives here belongs to currentStation.
  private async onSlide(buffer: Buffer, mimeType: string): Promise<void> {
    if (!this.currentStation) return
    const { channel, id } = this.currentStation
    const imageUrl = await this.imageCache.save(channel, id, buffer, mimeType)
    this.applyImage(channel, id, imageUrl)
    this.notify({ type: 'change' })
  }

  /** Attaches a captured image to every in-memory reference to this station. */
  private applyImage(channel: string, id: number, imageUrl: string): void {
    const matches = (s: DabStationView | null): s is DabStationView =>
      !!s && s.channel === channel && s.id === id

    this.allStations = this.allStations.map((s) => (matches(s) ? { ...s, imageUrl } : s))
    if (matches(this.currentStation)) this.currentStation = { ...this.currentStation, imageUrl }
    this.favorites = this.favorites.map((f) => (matches(f) ? { ...f, imageUrl } : f))
  }

  /** Sweeps the DAB band collecting whatever services each ensemble announces. */
  async scan(): Promise<DabStationRef[]> {
    if (this.scanning) return this.groupedStations()

    const radio = await this.ensureRadio()
    if (!radio) return []

    // Scanning needs exclusive use of the tuner — drop any current playback first.
    await this.stop()

    this.scanning = true
    this.allStations = []
    this.scanningChannel = null
    this.notify({ type: 'change' })

    const onProgress = (...args: unknown[]) => {
      const entry = args[0] as { channel: string }
      this.scanningChannel = entry.channel
      this.notify({ type: 'change' })
    }
    const onFound = (...args: unknown[]) => {
      const station = args[0] as NativeDabStation
      const imageUrl = this.imageCache.get(station.channel, station.id)
      const withImage: DabStationInternal = imageUrl ? { ...station, imageUrl } : station
      // A station can be re-announced with a corrected (no-longer-empty)
      // label once the FIC finishes decoding it — see index.js's onService.
      // Replace the existing entry in place instead of appending a dupe.
      const idx = this.allStations.findIndex(
        (s) => s.id === station.id && s.channel === station.channel
      )
      this.allStations =
        idx >= 0
          ? this.allStations.map((s, i) => (i === idx ? withImage : s))
          : [...this.allStations, withImage]
      this.notify({ type: 'change' })
    }

    radio.on('scanProgress', onProgress)
    radio.on('stationFound', onFound)

    try {
      await radio.scanStations()
      // A full sweep is authoritative — replace the cache wholesale so any
      // station that genuinely disappeared (multiplex change, moved out of
      // range) doesn't linger forever. imageUrl is runtime-only enrichment,
      // never persisted here (the image cache on disk is its source of truth).
      await this.stationCache.save(this.allStations.map(({ imageUrl, ...station }) => station))
    } finally {
      radio.off('scanProgress', onProgress)
      radio.off('stationFound', onFound)
      this.scanning = false
      this.scanningChannel = null
      this.tunedFrequencyHz = null
      this.notify({ type: 'change' })
    }

    return this.groupedStations()
  }

  /** Tunes to (if needed) and selects the given station. */
  async selectStation(station: DabStationRef): Promise<void> {
    const radio = await this.ensureRadio()
    if (!radio) return

    if (this.tunedFrequencyHz !== station.frequencyHz) {
      // start() retunes the already-open device in place (see index.js) —
      // no need to stop() first, same as welle.io's own setChannel().
      await radio.start(station.frequencyHz)
      this.tunedFrequencyHz = station.frequencyHz
      await this.waitForSync(radio, station.id)
    }

    radio.selectService(station.id)
    const cachedImage = this.imageCache.get(station.channel, station.id)
    this.currentStation = cachedImage ? { ...station, imageUrl: cachedImage } : station
    this.running = true
    this.notify({ type: 'change' })
  }

  private waitForSync(radio: NativeDabRadio, targetId: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        radio.off('service', onService)
        clearTimeout(timer)
        resolve()
      }
      const onService = (...args: unknown[]) => {
        const svc = args[0] as NativeDabService
        if (svc.id === targetId) finish()
      }
      radio.on('service', onService)
      const timer = setTimeout(finish, SYNC_TIMEOUT_MS)
    })
  }

  // Fully releases the device (not just a pause) — this is the outward
  // "done with DAB" signal, e.g. switching to FM. A scan can leave the
  // native device open for fast resume even though running/tunedFrequencyHz
  // are already reset, so this can't early-return on those flags alone;
  // radio.close() is safe to call even if nothing is currently active.
  async stop(): Promise<void> {
    await this.radio?.close()
    this.audioOutput?.stop()
    this.audioOutput = null
    this.audioSampleRate = 0
    this.tunedFrequencyHz = null
    this.running = false
    this.currentStation = null

    this.notify({ type: 'change' })
  }

  /** Saves the currently playing station into a preset slot. No-op if nothing is playing. */
  setFavorite(slot: number): void {
    if (slot >= 0 && slot < FAVORITES_SLOTS && this.currentStation) {
      const station = this.currentStation
      this.favorites = this.favorites.map((f, i) => (i === slot ? station : f))
      this.notify({ type: 'change' })
    }
  }

  /**
   * Tunes to and selects whatever station is saved in a preset slot. No-op
   * if empty. Re-resolves to whichever channel currently measures
   * strongest for that station's label, rather than always replaying the
   * exact channel it happened to be saved on — signal conditions (or which
   * channels have been scanned since) can change which one actually works.
   */
  async recallFavorite(slot: number): Promise<void> {
    const saved = slot >= 0 && slot < FAVORITES_SLOTS ? this.favorites[slot] : null
    if (!saved) return
    const best = this.bestVariantForLabel(saved.label) ?? saved
    await this.selectStation(best)
  }
}
