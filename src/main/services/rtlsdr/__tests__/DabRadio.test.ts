import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// Same vi.fn()-as-constructor limitation noted in RadioService.test.ts:
// Vitest's mock proxying for dynamically-imported modules loses `new`-ability
// on vi.fn()-wrapped properties, so the native module export must be a plain
// constructor function, with per-test scripting going through closures.
const { DabRadioCtor, setQueuedStations } = vi.hoisted(() => {
  type Listener = (payload?: unknown) => void
  type QueuedStation = {
    id: number
    label: string
    channel: string
    frequencyHz: number
    snr: number
  }

  let queuedStations: QueuedStation[] = []

  function createMockNativeRadio() {
    const listeners = new Map<string, Set<Listener>>()
    const emit = (event: string, payload?: unknown) => {
      for (const cb of [...(listeners.get(event) ?? [])]) cb(payload)
    }
    return {
      on(event: string, cb: Listener) {
        if (!listeners.has(event)) listeners.set(event, new Set())
        listeners.get(event)?.add(cb)
      },
      off(event: string, cb: Listener) {
        listeners.get(event)?.delete(cb)
      },
      start: vi.fn(async (frequencyHz: number) => {
        // Real ensembles announce services shortly after a retune. Mirror
        // that here so selectStation()'s waitForSync resolves immediately
        // instead of hitting its real 8s timeout in every test.
        const match = queuedStations.find((s) => s.frequencyHz === frequencyHz)
        if (match) setTimeout(() => emit('service', { id: match.id, label: match.label }), 0)
      }),
      stop: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      selectService: vi.fn(),
      scanStations: vi.fn(async () => {
        for (const station of queuedStations) emit('stationFound', station)
        return queuedStations
      })
    }
  }

  return {
    DabRadioCtor: createMockNativeRadio,
    setQueuedStations: (stations: QueuedStation[]) => {
      queuedStations = stations
    }
  }
})

vi.mock('rtl-sdr-dab', () => ({ DabRadio: DabRadioCtor }))

const { getPathMock } = vi.hoisted(() => ({ getPathMock: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: getPathMock } }))

import { DabRadio } from '../DabRadio'

const SLAM_WEAK = { id: 1, label: 'SLAM!', channel: '11C', frequencyHz: 220352000, snr: 2 }
const SLAM_STRONG = { id: 2, label: 'SLAM!', channel: '8B', frequencyHz: 197648000, snr: 12 }
const QMUSIC = { id: 3, label: 'Qmusic', channel: '11C', frequencyHz: 220352000, snr: 2 }

let userDataDir: string

beforeEach(async () => {
  userDataDir = await mkdtemp(path.join(os.tmpdir(), 'livi-dab-radio-'))
  getPathMock.mockReturnValue(userDataDir)
  setQueuedStations([])
})

afterEach(async () => {
  await rm(userDataDir, { recursive: true, force: true })
})

describe('DabRadio station grouping', () => {
  test('collapses the same station found on multiple channels into one tile, keeping the strongest', async () => {
    setQueuedStations([SLAM_WEAK, SLAM_STRONG, QMUSIC])
    const dab = new DabRadio(vi.fn())
    await dab.hydrate(undefined)

    await dab.scan()
    const { stations } = dab.getState()

    const slamEntries = stations.filter((s) => s.label === 'SLAM!')
    expect(slamEntries).toHaveLength(1)
    expect(slamEntries[0]).toMatchObject({ channel: '8B', id: 2 })
    expect(stations).toHaveLength(2) // one SLAM! tile + one Qmusic tile, not three
  })

  test('keeps stations with different labels as separate tiles', async () => {
    setQueuedStations([SLAM_WEAK, QMUSIC])
    const dab = new DabRadio(vi.fn())
    await dab.hydrate(undefined)

    await dab.scan()
    const { stations } = dab.getState()

    expect(stations.map((s) => s.label).sort()).toEqual(['Qmusic', 'SLAM!'])
  })

  test('recallFavorite re-resolves to the currently strongest channel, not the one it was saved on', async () => {
    setQueuedStations([SLAM_WEAK, SLAM_STRONG])
    const dab = new DabRadio(vi.fn())
    await dab.hydrate(undefined)
    await dab.scan()

    // Simulate having favorited the weak channel specifically (e.g. saved
    // back when it was the only one known).
    await dab.selectStation(SLAM_WEAK)
    dab.setFavorite(0)
    expect(dab.getState().favorites[0]).toMatchObject({ channel: '11C', id: 1 })

    await dab.recallFavorite(0)

    expect(dab.getState().currentStation).toMatchObject({ channel: '8B', id: 2 })
  })
})
