import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'

const EXT_BY_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' }
const MIME_BY_EXT: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png' }

function cacheDir(): string {
  return path.join(app.getPath('userData'), 'dab-slides')
}

function keyFor(channel: string, stationId: number): string {
  return `${channel}-${stationId}`
}

/**
 * Disk-backed cache of MOT slideshow images (album art / station logos),
 * keyed by channel+station id since a DAB service only exists within one
 * ensemble. Persisted so artwork seen in a previous session is available
 * immediately without re-tuning to that station.
 */
export class DabImageCache {
  private cache = new Map<string, string>()
  private readonly ready: Promise<void>

  constructor() {
    this.ready = this.loadExisting()
  }

  whenReady(): Promise<void> {
    return this.ready
  }

  get(channel: string, stationId: number): string | undefined {
    return this.cache.get(keyFor(channel, stationId))
  }

  async save(channel: string, stationId: number, data: Buffer, mimeType: string): Promise<string> {
    const ext = EXT_BY_MIME[mimeType]
    if (!ext) throw new Error(`Unsupported slide mime type: ${mimeType}`)

    const key = keyFor(channel, stationId)
    const dataUrl = `data:${mimeType};base64,${data.toString('base64')}`
    this.cache.set(key, dataUrl)

    try {
      const dir = cacheDir()
      await mkdir(dir, { recursive: true })
      await writeFile(path.join(dir, `${key}.${ext}`), data)
    } catch (e) {
      console.warn('[DabImageCache] failed to persist slide to disk (ignored)', e)
    }

    return dataUrl
  }

  private async loadExisting(): Promise<void> {
    try {
      const dir = cacheDir()
      await mkdir(dir, { recursive: true })
      const files = await readdir(dir)
      for (const file of files) {
        const ext = path.extname(file).slice(1)
        const mimeType = MIME_BY_EXT[ext]
        if (!mimeType) continue
        const key = path.basename(file, path.extname(file))
        const data = await readFile(path.join(dir, file))
        this.cache.set(key, `data:${mimeType};base64,${data.toString('base64')}`)
      }
    } catch (e) {
      console.warn('[DabImageCache] failed to load cached slides (ignored)', e)
    }
  }
}
