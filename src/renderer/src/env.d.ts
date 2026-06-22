import type { ElectronAPI } from '@electron-toolkit/preload'
import type { Config, DabStationRef, DongleFirmwareAction } from '@shared/types'
import type { MultiTouchPoint } from '@shared/types/TouchTypes'

// Should move to src/types/usb.ts
interface USBDevice {
  readonly productName?: string
  readonly manufacturerName?: string
  readonly serialNumber?: string
  readonly deviceVersionMajor?: number
  readonly deviceVersionMinor?: number
  readonly vendorId: number
  readonly productId: number
}
interface USBDeviceRequestOptions {
  filters?: Array<Partial<USBDevice>>
}

declare global {
  type UpdateEvent =
    | {
        phase:
          | 'start'
          | 'ready'
          | 'mounting'
          | 'copying'
          | 'unmounting'
          | 'installing'
          | 'relaunching'
      }
    | { phase: 'error'; message?: string }

  type UpdateProgress = {
    phase: 'download'
    percent?: number
    received?: number
    total?: number
  }

  const __BUILD_SHA__: string
  const __BUILD_RUN__: string
  const __BUILD_BRANCH__: string
}

type UsbDeviceInfo =
  | { device: false; vendorId: null; productId: null; usbFwVersion: string }
  | { device: true; vendorId: number; productId: number; usbFwVersion: string }

type RadioMode = 'fm' | 'dab'

type StationInfo = {
  id: number
  genre: string
  name?: string
  text?: string
}

type RadioState = {
  running: boolean
  frequencyMhz: number
  mode: RadioMode
  station: StationInfo | null
  favorites: (number | null)[]
}

// Cached slideshow image (album art / station logo) attached at runtime only
// — never part of the persisted DabStationRef shape.
type DabStationView = DabStationRef & { imageUrl?: string }

type DabState = {
  running: boolean
  scanning: boolean
  scanningChannel: string | null
  stations: DabStationView[]
  currentStation: DabStationView | null
  favorites: (DabStationView | null)[]
}

type MediaPayload = {
  timestamp: string
  payload: {
    type: number
    media?: {
      MediaSongName?: string
      MediaAlbumName?: string
      MediaArtistName?: string
      MediaAPPName?: string
      MediaSongDuration?: number
      MediaSongPlayTime?: number
      MediaPlayStatus?: number
      MediaLyrics?: string
    }
    base64Image?: string
  }
} | null

type DongleFirmwareCheckResult =
  | {
      ok: true
      hasUpdate: boolean
      latestVer?: string
      notes?: string
      size?: number
      id?: string
      token?: string
      request?: {
        lang: number
        code: number
        appVer: string
        ver: string
        uuid: string
        mfd: string
        fwn: string
        model: string
      }
      raw: unknown
    }
  | { ok: false; error: string }

type DevToolsUploadResult = {
  ok: boolean
  cgiOk: boolean
  webOk: boolean
  urls: string[]
  startedAt: string
  finishedAt: string
  durationMs: number
}

declare global {
  interface Navigator {
    usb: {
      getDevices(): Promise<USBDevice[]>
      requestDevice(options?: USBDeviceRequestOptions): Promise<USBDevice>
      addEventListener(type: 'connect' | 'disconnect', listener: (ev: Event) => void): void
      removeEventListener(type: 'connect' | 'disconnect', listener: (ev: Event) => void): void
    }
  }

  interface Window {
    electron: ElectronAPI

    projection: {
      quit(): Promise<void>
      onUSBResetStatus(callback: (event: unknown, ...args: unknown[]) => void): void

      usb: {
        forceReset(): Promise<boolean>
        detectDongle(): Promise<boolean>
        detectRtlSdr(): Promise<boolean>
        getDeviceInfo(): Promise<UsbDeviceInfo>
        getLastEvent(): Promise<unknown>
        getSysdefaultPrettyName(): Promise<string>
        uploadIcons(): Promise<void>
        uploadLiviScripts(): Promise<DevToolsUploadResult>
        listenForEvents(callback: (event: unknown, ...args: unknown[]) => void): () => void
      }

      radio: {
        start(frequencyMhz?: number): Promise<RadioState>
        stop(): Promise<RadioState>
        setFrequency(frequencyMhz: number): Promise<RadioState>
        setMode(mode: RadioMode): Promise<RadioState>
        step(direction: 1 | -1, fast?: boolean): Promise<RadioState>
        getState(): Promise<RadioState>
        setFavorite(slot: number): Promise<RadioState>
        recallFavorite(slot: number): Promise<RadioState>
        onEvent(callback: (event: unknown, ...args: unknown[]) => void): () => void

        dab: {
          scan(): Promise<DabState>
          selectStation(station: DabStationRef): Promise<DabState>
          stop(): Promise<DabState>
          getState(): Promise<DabState>
          setFavorite(slot: number): Promise<DabState>
          recallFavorite(slot: number): Promise<DabState>
        }
      }

      settings: {
        get(): Promise<Config>
        save(settings: Partial<Config>): Promise<void>
        onUpdate(
          callback: (event: import('electron').IpcRendererEvent, settings: Config) => void
        ): () => void
      }
      audio: {
        listSinks(): Promise<
          Array<{ id: string; name: string; isDefault: boolean; offline?: boolean }>
        >
        listSources(): Promise<
          Array<{ id: string; name: string; isDefault: boolean; offline?: boolean }>
        >
      }
      ipc: {
        start(): Promise<void>
        stop(): Promise<void>
        restart(): Promise<void>
        setVisible(visible: boolean): Promise<void>
        sendFrame(): Promise<void>
        dongleFirmware(action: DongleFirmwareAction): Promise<DongleFirmwareCheckResult>

        sendTouch(x: number, y: number, action: number): void
        sendMultiTouch(points: MultiTouchPoint[]): void
        sendCommand(key: string): void
        sendRawMessage(type: number, data: Uint8Array): void

        onEvent(callback: (event: unknown, ...args: unknown[]) => void): () => void

        onTelemetry(handler: (payload: unknown) => void): void
        offTelemetry(handler: (payload: unknown) => void): void
        getTelemetrySnapshot(): Promise<unknown>

        setVisualizerEnabled(enabled: boolean): void

        readMedia(): Promise<MediaPayload>
        readNavigation(): Promise<unknown>

        onAudioChunk(handler: (payload: unknown) => void): void
        offAudioChunk(handler: (payload: unknown) => void): void

        requestCluster(enabled: boolean): Promise<{ ok: boolean; enabled: boolean }>
        onClusterResolution(handler: (payload: unknown) => void): () => void

        connectBluetoothPairedDevice(mac: string): Promise<{ ok: boolean }>

        switchTransport(): Promise<{ ok: boolean; active: 'dongle' | 'aa' | 'cp' | null }>
        getTransportState(): Promise<{
          active: 'dongle' | 'aa' | 'cp' | null
          dongleDetected: boolean
          wiredPhoneDetected: boolean
          wirelessPhoneActive: boolean
          wiredPhoneActive: boolean
          preference: 'auto' | 'dongle' | 'native'
        }>
      }
    }

    app: {
      platform: NodeJS.Platform
      compositor: boolean
      notifyUserActivity(): void
      quitApp(): Promise<void>
      restartApp(): Promise<void>
      getVersion(): Promise<string>
      getLatestRelease(): Promise<{ version?: string; url?: string }>
      performUpdate(imageUrl?: string): Promise<void>
      onUpdateEvent(cb: (payload: UpdateEvent) => void): () => void
      onUpdateProgress(cb: (payload: UpdateProgress) => void): () => void
      beginInstall(): Promise<void>
      abortUpdate(): Promise<void>
      openExternal(url: string): Promise<{ ok: boolean; error?: string }>
      broadcastMediaKey(command: string): void
      onMediaKey(handler: (command: string) => void): () => void
    }
  }
}

export {}
