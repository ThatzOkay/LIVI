import net from 'node:net'
import { app, BrowserWindow, type WebContents } from 'electron'
import path from 'path'
import { resolveGStreamerRoot } from '../audio/gstreamer'

export type GstVideoCodec = 'h264' | 'h265' | 'vp9' | 'av1'

// Linux: the video is composited by livi-compositor, which crops the video plane zero-copy
class CompositorControl {
  private socket: net.Socket | null = null
  private connecting = false
  private readonly pending = new Map<string, string>()
  private readonly path = process.env.LIVI_COMPOSITOR_CTRL ?? ''

  private get enabled(): boolean {
    return process.platform === 'linux' && this.path.length > 0
  }

  setVideoCrop(
    role: string,
    cropL: number,
    cropT: number,
    visW: number,
    visH: number,
    tierW: number,
    tierH: number
  ): void {
    if (!this.enabled) return
    const n = (v: number): number => Math.round(v)
    this.pending.set(
      role,
      `videocrop ${role} ${n(cropL)} ${n(cropT)} ${n(visW)} ${n(visH)} ${n(tierW)} ${n(tierH)}\n`
    )
    this.flush()
  }

  private flush(): void {
    const s = this.socket
    if (s && !s.destroyed && s.writable) {
      for (const line of this.pending.values()) s.write(line)
      return
    }
    this.connect()
  }

  private connect(): void {
    if (this.connecting || !this.enabled) return
    this.connecting = true
    const s = net.connect(this.path)
    s.on('connect', () => {
      this.connecting = false
      this.socket = s
      for (const line of this.pending.values()) s.write(line)
    })
    s.on('error', () => {
      this.connecting = false
    })
    s.on('close', () => {
      this.connecting = false
      if (this.socket === s) this.socket = null
    })
  }
}

const compositorControl = new CompositorControl()

export type GstCodecSupport = { hw: boolean; sw: boolean }
export type GstCodecProbe = Record<GstVideoCodec, GstCodecSupport>

interface GstAddon {
  version(): string
  probeCodecs(): GstCodecProbe
  createPlayer(codec: string, windowHandle: Buffer): unknown
  start(player: unknown): void
  pushBuffer(player: unknown, buffer: Buffer): boolean
  setVisible(player: unknown, visible: boolean): void
  setContentRegion(
    player: unknown,
    cropL: number,
    cropT: number,
    visW: number,
    visH: number,
    tierW: number,
    tierH: number
  ): void
  stop(player: unknown): void
}

let addon: GstAddon | null = null
let loadFailed = false

// Windows has no system GStreamer
function prepareWindowsRuntime(): void {
  if (process.platform !== 'win32') return
  const root = resolveGStreamerRoot()
  if (!root) return
  process.env.PATH = `${path.join(root, 'bin')};${process.env.PATH ?? ''}`
  process.env.GST_PLUGIN_SYSTEM_PATH = ''
  process.env.GST_PLUGIN_PATH = path.join(root, 'lib', 'gstreamer-1.0')
  process.env.GST_PLUGIN_SCANNER = path.join(
    root,
    'libexec',
    'gstreamer-1.0',
    'gst-plugin-scanner.exe'
  )
}

function prepareMacRuntime(): void {
  if (process.platform !== 'darwin' || !app.isPackaged) return
  const root = resolveGStreamerRoot()
  if (!root) return
  process.env.GST_PLUGIN_SYSTEM_PATH = ''
  process.env.GST_PLUGIN_PATH = path.join(root, 'lib', 'gstreamer-1.0')
  process.env.GST_PLUGIN_SCANNER = path.join(root, 'libexec', 'gstreamer-1.0', 'gst-plugin-scanner')
}

function load(): GstAddon | null {
  if (addon || loadFailed) return addon
  try {
    prepareWindowsRuntime()
    prepareMacRuntime()
    addon = require('gst-video') as GstAddon
    console.log('[GstVideo]', addon.version())
  } catch (e) {
    loadFailed = true
    console.error('[GstVideo] native addon load failed:', (e as Error).message)
  }
  return addon
}

// Which codecs the bundled/loaded GStreamer can decode on this platform,
// and whether the decoder is hardware-accelerated
export function probeGstCodecs(): GstCodecProbe {
  const none: GstCodecSupport = { hw: false, sw: false }
  const a = load()
  if (!a) return { h264: none, h265: none, vp9: none, av1: none }
  try {
    return a.probeCodecs()
  } catch {
    return { h264: none, h265: none, vp9: none, av1: none }
  }
}

// In-process GStreamer video player rendering into a window's native surface
export class GstVideo {
  private player: unknown = null
  private codec: GstVideoCodec | null = null
  private visible = true
  // AA content region inside the decoded tier (so the user-chosen AR fills the display)
  private region: {
    cropL: number
    cropT: number
    visW: number
    visH: number
    tierW: number
    tierH: number
  } | null = null

  constructor(
    private readonly wc: WebContents,
    private readonly role: string = 'main'
  ) {}

  private windowHandle(): Buffer | null {
    const win = BrowserWindow.fromWebContents(this.wc)
    if (!win || win.isDestroyed()) return null
    return win.getNativeWindowHandle()
  }

  private ensure(codec: GstVideoCodec): void {
    const a = load()
    if (!a) return
    if (this.player && this.codec === codec) return
    this.dispose()
    const handle = this.windowHandle()
    if (!handle) return
    this.player = a.createPlayer(codec, handle)
    this.codec = codec
    if (this.player) {
      a.start(this.player)
      a.setVisible(this.player, this.visible)
      if (this.region) this.applyRegion(a)
    }
  }

  push(codec: GstVideoCodec, nal: Buffer): void {
    const a = load()
    if (!a) return
    this.ensure(codec)
    if (this.player) a.pushBuffer(this.player, nal)
  }

  // Show/hide the video surface as the user navigates in/out of projection
  setVisible(visible: boolean): void {
    this.visible = visible
    if (addon && this.player) addon.setVisible(this.player, visible)
  }

  // Set the AA content region inside the decoded tier. The native view crops to it by
  // sizing + positioning the GL render (zero-copy); bars appear only on a window-AR
  // mismatch. Buffered and re-applied when the player is (re)created.
  setContentRegion(
    cropL: number,
    cropT: number,
    visW: number,
    visH: number,
    tierW: number,
    tierH: number
  ): void {
    this.region = visW > 0 && visH > 0 ? { cropL, cropT, visW, visH, tierW, tierH } : null
    // Linux: crop happens in the compositor
    compositorControl.setVideoCrop(this.role, cropL, cropT, visW, visH, tierW, tierH)
    if (addon && this.player) this.applyRegion(addon)
  }

  private applyRegion(a: GstAddon): void {
    if (!this.player) return
    const r = this.region
    a.setContentRegion(
      this.player,
      r?.cropL ?? 0,
      r?.cropT ?? 0,
      r?.visW ?? 0,
      r?.visH ?? 0,
      r?.tierW ?? 0,
      r?.tierH ?? 0
    )
  }

  dispose(): void {
    if (addon && this.player) {
      try {
        addon.stop(this.player)
      } catch {
        /* ignore */
      }
    }
    this.player = null
    this.codec = null
  }
}
