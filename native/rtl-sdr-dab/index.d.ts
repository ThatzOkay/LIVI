import { EventEmitter } from 'events'

export interface DabChannel {
  channel: string
  frequencyHz: number
}

export interface DabService {
  id: number
  label: string
}

export interface DabStation extends DabService {
  channel: string
  frequencyHz: number
  /** Signal-to-noise ratio observed on this channel when the station was found. */
  snr: number
}

export interface DabAudioEvent {
  buffer: Buffer
  samplerate: number
  stereo: boolean
}

export interface DabMetadataEvent {
  type: string
  value: string
}

// MOT slideshow image (album art / station logo) decoded for the currently
// selected programme. mimeType is 'image/jpeg' or 'image/png'.
export interface DabSlideEvent {
  buffer: Buffer
  mimeType: string
}

export interface DabScanOptions {
  /** Max time to wait for a signal-presence report before giving up on a channel. Defaults to 2000ms. */
  noSignalTimeoutMs?: number
  /** Once signal is confirmed, how much longer to listen for services/labels. Defaults to 10000ms (matches welle.io's own GUI scanner). */
  signalDwellMs?: number
}

export interface DabStartOptions {
  /**
   * Puts the receiver in welle.io's "scan mode" — only this makes the
   * 'signal' event fire. Only scanStations() needs this; normal
   * single-channel tuning should leave it false (the default).
   */
  scan?: boolean
}

export declare const DAB_CHANNELS: DabChannel[]

// Event payloads ('audio' -> DabAudioEvent, 'service' -> DabService,
// 'metadata' -> DabMetadataEvent, 'slide' -> DabSlideEvent, 'snr' -> number,
// 'signal' -> boolean, 'scanProgress' -> DabChannel,
// 'stationFound' -> DabStation, 'scanComplete' -> DabStation[]) are passed
// through the inherited EventEmitter on/off/emit, which use loose listener
// types rather than per-event overloads.
export declare class DabRadio extends EventEmitter {
  constructor()

  start(frequencyHz: number, options?: DabStartOptions): Promise<this>
  stop(): Promise<this>
  close(): Promise<this>
  selectService(serviceId: number): this
  getService(serviceId: number): DabService | null
  scanStations(options?: DabScanOptions): Promise<DabStation[]>
}
