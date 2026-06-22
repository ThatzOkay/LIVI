import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { DabStationRef } from '@shared/types'

const { getPathMock } = vi.hoisted(() => ({ getPathMock: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: getPathMock } }))

import { DabStationCache } from '../dabStationCache'

const STATION_A: DabStationRef = { id: 1, label: 'SLAM!', channel: '11C', frequencyHz: 220352000 }
const STATION_B: DabStationRef = { id: 2, label: 'Qmusic', channel: '11C', frequencyHz: 220352000 }

let userDataDir: string

beforeEach(async () => {
  userDataDir = await mkdtemp(path.join(os.tmpdir(), 'livi-dab-station-cache-'))
  getPathMock.mockReturnValue(userDataDir)
})

afterEach(async () => {
  await rm(userDataDir, { recursive: true, force: true })
})

describe('DabStationCache', () => {
  test('returns an empty list before anything has ever been saved', async () => {
    const cache = new DabStationCache()
    await cache.whenReady()

    expect(cache.get()).toEqual([])
  })

  test('save replaces the cached list and makes it available via get', async () => {
    const cache = new DabStationCache()
    await cache.whenReady()

    await cache.save([STATION_A, STATION_B])

    expect(cache.get()).toEqual([STATION_A, STATION_B])
  })

  test('a later save fully replaces the previous one rather than merging', async () => {
    const cache = new DabStationCache()
    await cache.whenReady()

    await cache.save([STATION_A, STATION_B])
    await cache.save([STATION_A])

    expect(cache.get()).toEqual([STATION_A])
  })

  test('persists to disk and is reloaded by a fresh cache instance', async () => {
    const first = new DabStationCache()
    await first.whenReady()
    await first.save([STATION_A, STATION_B])

    const second = new DabStationCache()
    await second.whenReady()

    expect(second.get()).toEqual([STATION_A, STATION_B])
  })
})
