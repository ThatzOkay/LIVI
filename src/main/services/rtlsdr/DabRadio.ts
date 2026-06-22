import { AudioOutput } from '@main/services/audio'
import type { DabStationRef, RadioConfig } from '@shared/types'
import type { BackendNotify } from './backendEvent'
import { DabImageCache } from './dabImageCache'
import { DabStationCache, type DabStationRecord } from './dabStationCache'

const FAVORITES_SLOTS = 5
// Time to let the receiver sync to a new channel and the FIC announce the
// target service before giving up and selecting anyway.
const SYNC_TIMEOUT_MS = 8000
// rtlsdr_close() returning doesn't guarantee libusb/the kernel have fully
// released the USB interface yet. Closing and immediately reopening the
// same RTL-SDR (e.g. handing the tuner to FM right after doStop()) is a
// known way to wedge the dongle — see close_device()'s own comment in
// addon.cpp about why DAB itself avoids full close/reopen between channels.
// A brief settle window here is cheap insurance against that exact failure
// mode at the one point where a full close is unavoidable (leaving DAB).
const DEVICE_RELEASE_SETTLE_MS = 200
// How long to wait after selectService() for at least one audio frame to
// actually arrive before treating the selection as having silently failed.
// waitForSync's own timeout means selectService() can run even though the
// FIC never confirmed the target service — usually harmless (the receiver
// was already synced, it just hadn't seen that exact FIG cycle yet), but
// occasionally the sync genuinely never completed, in which case nothing
// ever decodes: the UI says "Playing" forever while staying silent.
const AUDIO_WATCHDOG_MS = 5000
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

export type DabProgrammeInfo = { codec: 'DAB' | 'DAB+'; bitrateKbps: number }

export type DabState = {
  running: boolean
  scanning: boolean
  scanningChannel: string | null
  stations: DabStationView[]
  currentStation: DabStationView | null
  // The station a selectStation()/recallFavorite() call is currently
  // tuning to — null once it settles (or fails). Drives a loading
  // indicator in the UI; without it, a multi-second retune+sync looks
  // like nothing happened, which is what previously made it seem "stuck"
  // and tempted a second tap while the first was still in flight.
  selectingStation: DabStationRef | null
  programmeInfo: DabProgrammeInfo | null
  // DAB+'s Dynamic Label Segment — the same kind of "now playing" text RDS
  // RadioText shows for FM, decoded from the same audio service. DAB
  // (non-Plus) services don't carry this, so it stays null for them.
  dynamicLabel: string | null
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
  getProgrammeInfo: (serviceId: number) => DabProgrammeInfo | null
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
  private selectingStation: DabStationRef | null = null
  private programmeInfo: DabProgrammeInfo | null = null
  private favorites: (DabStationView | null)[] = new Array(FAVORITES_SLOTS).fill(null)
  // The most recently selected station, restored from config on hydrate()
  // and updated on every successful selectStation(). Deliberately NOT
  // cleared by doStop() (unlike currentStation) — switching to FM or just
  // backgrounding DAB shouldn't forget what to resume next time, the same
  // way FmRadio keeps frequencyMhz around while stopped.
  private lastStation: DabStationRef | null = null
  private audioOutput: AudioOutput | null = null
  private audioSampleRate = 0
  private readonly imageCache = new DabImageCache()
  private readonly stationCache = new DabStationCache()
  // Serializes every native-device-touching operation (scan/select/stop) so
  // an overlapping call — e.g. tapping a second station before the first
  // selectStation() finishes retuning+syncing — queues safely behind the
  // one in flight instead of racing it. Without this, two concurrent
  // start()/selectService() calls could interleave against the same native
  // receiver handle, which is what made a station sometimes need a second
  // tap to actually take effect.
  private taskQueue: Promise<unknown> = Promise.resolve()
  // Bumped by stop() so an in-flight selectStation() can tell it's been
  // superseded and bail out without applying its result — see doStop().
  private epoch = 0
  // Lets stop() cut short whatever selectStation() is currently blocked on
  // (waitForSync's up-to-8s wait for the FIC to announce the service)
  // instead of queuing politely behind it. Without this, switching to FM
  // right after a slow tune (e.g. autoResume on a weak ensemble) couldn't
  // release the device for up to SYNC_TIMEOUT_MS, since stop() only runs
  // once the queued selectStation task ahead of it actually returns.
  private cancelInFlightSync: (() => void) | null = null
  // DAB+'s Dynamic Label Segment — see the 'metadata' listener in
  // ensureRadio(). Reset on every new selection/stop so a stale "now
  // playing" line from the previous station never lingers.
  private dynamicLabel: string | null = null
  // Updated on every onAudio() call — scheduleAudioWatchdog() compares
  // against this to tell "no audio ever arrived" apart from "audio arrived,
  // then briefly paused", without needing a reset-to-zero sentinel that a
  // retry's own first frame could race against.
  private lastAudioAt = 0
  private audioWatchdogTimer: ReturnType<typeof setTimeout> | null = null
  // Keyed by `${channel}:${id}` so a watchdog-triggered retune doesn't
  // schedule another retry of itself — only ever read/written from inside
  // scheduleAudioWatchdog's own timeout callback, never from doSelectStation,
  // since the retry's own call running through doSelectStation again would
  // otherwise wipe this marker before the watchdog gets to check it.
  private watchdogRetriedFor: string | null = null

  constructor(private readonly notify: BackendNotify) {}

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.taskQueue.then(task, task)
    this.taskQueue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

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
    this.lastStation = radio.lastDabStation ?? null
  }

  /**
   * Resumes whatever station was playing when the app last persisted DAB
   * state — mirrors FmRadio's own "resume last frequency" behavior. No-op
   * if nothing was ever selected. Re-resolves to whichever channel variant
   * currently measures strongest, same as recallFavorite().
   */
  async autoResume(): Promise<void> {
    if (!this.lastStation) return
    const best = this.bestVariantForLabel(this.lastStation.label) ?? this.lastStation
    await this.selectStation(best)
  }

  /** The most recently selected station, for RadioService to persist. */
  getLastStation(): DabStationRef | null {
    return this.lastStation
  }

  getState(): DabState {
    return {
      running: this.running,
      scanning: this.scanning,
      scanningChannel: this.scanningChannel,
      stations: this.groupedStations(),
      currentStation: this.currentStation,
      selectingStation: this.selectingStation,
      programmeInfo: this.programmeInfo,
      dynamicLabel: this.dynamicLabel,
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
    // DAB+'s "now playing" text — DAB (non-Plus) services never emit this,
    // so dynamicLabel just stays null for them.
    radio.on('metadata', (...args: unknown[]) => {
      const { type, value } = args[0] as { type: string; value: string }
      if (type !== 'dls') return
      this.dynamicLabel = value
      this.notify({ type: 'change' })
    })
    this.radio = radio
    return radio
  }

  private onAudio(buffer: Buffer, sampleRate: number, stereo: boolean): void {
    this.lastAudioAt = Date.now()
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
    // Same immediate cancel as stop() — a scan supersedes whatever
    // selectStation() is mid-tune just as much as actually stopping does.
    this.epoch++
    this.cancelInFlightSync?.()
    return this.enqueue(() => this.doScan())
  }

  private async doScan(): Promise<DabStationRef[]> {
    const radio = await this.ensureRadio()
    if (!radio) return []

    // Scanning needs exclusive use of the tuner — drop any current playback
    // first. Calls the unqueued implementation directly: doScan() is itself
    // already running inside the queue, so going through the public stop()
    // here would enqueue behind itself and deadlock.
    await this.doStop()

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

  /**
   * Tunes to (if needed) and selects the given station. Queued behind any
   * scan/select/stop already in flight (see taskQueue) — a tap on a
   * different station while this is still retuning+syncing won't run
   * concurrently with it, it'll just wait its turn. selectingStation is set
   * immediately (before any of the actual work) so the UI can show a
   * loading state right away instead of looking like nothing happened.
   */
  async selectStation(station: DabStationRef): Promise<void> {
    return this.enqueue(() => this.doSelectStation(station))
  }

  private async doSelectStation(station: DabStationRef): Promise<void> {
    const myEpoch = this.epoch
    this.selectingStation = station
    this.dynamicLabel = null
    this.notify({ type: 'change' })

    try {
      const radio = await this.ensureRadio()
      if (!radio) return

      if (this.tunedFrequencyHz !== station.frequencyHz) {
        // start() retunes the already-open device in place (see index.js) —
        // no need to stop() first, same as welle.io's own setChannel().
        await radio.start(station.frequencyHz)
        this.tunedFrequencyHz = station.frequencyHz
        await this.waitForSync(radio, station.id)
      }

      // stop() may have fired while we were awaiting above (it cancels our
      // wait via cancelInFlightSync precisely so it doesn't have to queue
      // behind us) — don't resurrect playback it just tore down.
      if (myEpoch !== this.epoch) return

      radio.selectService(station.id)
      const cachedImage = this.imageCache.get(station.channel, station.id)
      this.currentStation = cachedImage ? { ...station, imageUrl: cachedImage } : station
      this.lastStation = station
      this.programmeInfo = radio.getProgrammeInfo(station.id)
      this.running = true
      this.scheduleAudioWatchdog(station)
    } finally {
      this.selectingStation = null
      this.notify({ type: 'change' })
    }
  }

  /**
   * waitForSync() can give up after SYNC_TIMEOUT_MS and let selectService()
   * run anyway — usually harmless (the receiver was already synced, it just
   * hadn't seen that exact FIG cycle yet), but occasionally sync genuinely
   * never completed, in which case nothing ever decodes: the UI says
   * "Playing" forever while staying silent. This checks, once, whether any
   * audio actually showed up; if not, retries the same selection exactly
   * once (forcing a real retune+resync, not a same-frequency no-op), and
   * surfaces a user-visible error if the retry is also silent.
   */
  private scheduleAudioWatchdog(station: DabStationRef): void {
    if (this.audioWatchdogTimer) clearTimeout(this.audioWatchdogTimer)
    const key = `${station.channel}:${station.id}`
    const sinceSelection = Date.now()

    this.audioWatchdogTimer = setTimeout(() => {
      this.audioWatchdogTimer = null

      // Superseded by a different/stopped selection in the meantime.
      if (
        this.currentStation?.channel !== station.channel ||
        this.currentStation?.id !== station.id
      )
        return

      if (this.lastAudioAt >= sinceSelection) {
        // Audio arrived — this station is healthy again, let a future
        // silent failure on it get its own fresh retry.
        if (this.watchdogRetriedFor === key) this.watchdogRetriedFor = null
        return
      }

      if (this.watchdogRetriedFor === key) {
        this.notify({
          type: 'error',
          message: `No audio from ${station.label.trim() || station.channel} — retune failed`
        })
        return
      }

      this.watchdogRetriedFor = key
      // Force doSelectStation to treat this as a genuine fresh retune
      // rather than a same-frequency no-op that'd skip waitForSync entirely.
      this.tunedFrequencyHz = null
      void this.selectStation(station)
    }, AUDIO_WATCHDOG_MS)
  }

  private waitForSync(radio: NativeDabRadio, targetId: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        radio.off('service', onService)
        clearTimeout(timer)
        if (this.cancelInFlightSync === finish) this.cancelInFlightSync = null
        resolve()
      }
      const onService = (...args: unknown[]) => {
        const svc = args[0] as NativeDabService
        if (svc.id === targetId) finish()
      }
      radio.on('service', onService)
      const timer = setTimeout(finish, SYNC_TIMEOUT_MS)
      this.cancelInFlightSync = finish
    })
  }

  // Fully releases the device (not just a pause) — this is the outward
  // "done with DAB" signal, e.g. switching to FM. A scan can leave the
  // native device open for fast resume even though running/tunedFrequencyHz
  // are already reset, so this can't early-return on those flags alone;
  // radio.close() is safe to call even if nothing is currently active.
  async stop(): Promise<void> {
    // Both run synchronously, before this even reaches the queue — so a
    // selectStation() stuck in its up-to-8s waitForSync wakes up and bails
    // immediately instead of making us wait in line behind it.
    this.epoch++
    this.cancelInFlightSync?.()
    return this.enqueue(() => this.doStop())
  }

  private async doStop(): Promise<void> {
    if (this.audioWatchdogTimer) {
      clearTimeout(this.audioWatchdogTimer)
      this.audioWatchdogTimer = null
    }
    await this.radio?.close()
    // Waited, not fired-and-forgotten — otherwise this gst-launch process
    // can still be alive (draining its EOS tail, up to STOP_GRACE_MS) by the
    // time a caller like switchMode's "stopDab() then startFm()" hands the
    // tuner to FM, briefly running two audio pipelines against the same sink.
    await this.audioOutput?.stopAndWait()
    this.audioOutput = null
    this.audioSampleRate = 0
    this.tunedFrequencyHz = null
    this.running = false
    this.currentStation = null
    this.programmeInfo = null
    this.dynamicLabel = null

    this.notify({ type: 'change' })
    await new Promise((resolve) => setTimeout(resolve, DEVICE_RELEASE_SETTLE_MS))
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
