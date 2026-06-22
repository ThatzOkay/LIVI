import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DabStationRef } from '@shared/types'
import { app } from 'electron'

function cacheFile(): string {
  return path.join(app.getPath('userData'), 'dab-stations.json')
}

// snr is carried alongside the public DabStationRef shape so a station seen
// on multiple channels can still be ranked by signal strength immediately
// on startup, before any fresh scan has run this session.
export type DabStationRecord = DabStationRef & { snr?: number }

/**
 * Disk-backed cache of the station list discovered by the last full band
 * scan. A DAB ensemble's lineup rarely changes between sessions, so this
 * lets the app show a usable station grid immediately on startup instead
 * of forcing a multi-minute re-scan every time.
 */
export class DabStationCache {
  private stations: DabStationRecord[] = []
  private readonly ready: Promise<void>

  constructor() {
    this.ready = this.loadExisting()
  }

  whenReady(): Promise<void> {
    return this.ready
  }

  get(): DabStationRecord[] {
    return this.stations
  }

  /** Replaces the cache with the result of a full scan. */
  async save(stations: DabStationRecord[]): Promise<void> {
    this.stations = stations
    try {
      const dir = app.getPath('userData')
      await mkdir(dir, { recursive: true })
      await writeFile(cacheFile(), JSON.stringify(stations))
    } catch (e) {
      console.warn('[DabStationCache] failed to persist stations to disk (ignored)', e)
    }
  }

  private async loadExisting(): Promise<void> {
    try {
      const data = await readFile(cacheFile(), 'utf-8')
      const parsed = JSON.parse(data)
      if (Array.isArray(parsed)) this.stations = parsed
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[DabStationCache] failed to load cached stations (ignored)', e)
      }
    }
  }
}
