import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const { getPathMock } = vi.hoisted(() => ({ getPathMock: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: getPathMock } }))

import { DabImageCache } from '../dabImageCache'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47])

let userDataDir: string

beforeEach(async () => {
  userDataDir = await mkdtemp(path.join(os.tmpdir(), 'livi-dab-cache-'))
  getPathMock.mockReturnValue(userDataDir)
})

afterEach(async () => {
  await rm(userDataDir, { recursive: true, force: true })
})

describe('DabImageCache', () => {
  test('returns undefined for a station that has never been cached', async () => {
    const cache = new DabImageCache()
    await cache.whenReady()

    expect(cache.get('5A', 4242)).toBeUndefined()
  })

  test('save stores a base64 data URL and makes it available via get', async () => {
    const cache = new DabImageCache()
    await cache.whenReady()

    const dataUrl = await cache.save('5A', 4242, JPEG, 'image/jpeg')

    expect(dataUrl).toBe(`data:image/jpeg;base64,${JPEG.toString('base64')}`)
    expect(cache.get('5A', 4242)).toBe(dataUrl)
  })

  test('distinguishes stations by channel and id', async () => {
    const cache = new DabImageCache()
    await cache.whenReady()

    await cache.save('5A', 1, JPEG, 'image/jpeg')
    await cache.save('5A', 2, PNG, 'image/png')
    await cache.save('5C', 1, PNG, 'image/png')

    expect(cache.get('5A', 1)).toContain('image/jpeg')
    expect(cache.get('5A', 2)).toContain('image/png')
    expect(cache.get('5C', 1)).toContain('image/png')
  })

  test('persists to disk and is reloaded by a fresh cache instance', async () => {
    const first = new DabImageCache()
    await first.whenReady()
    await first.save('7B', 99, PNG, 'image/png')

    const second = new DabImageCache()
    await second.whenReady()

    expect(second.get('7B', 99)).toBe(`data:image/png;base64,${PNG.toString('base64')}`)
  })

  test('rejects an unsupported mime type without caching anything', async () => {
    const cache = new DabImageCache()
    await cache.whenReady()

    await expect(cache.save('5A', 1, JPEG, 'image/gif')).rejects.toThrow(
      'Unsupported slide mime type'
    )
    expect(cache.get('5A', 1)).toBeUndefined()
  })
})
