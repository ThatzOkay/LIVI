import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// Same vi.fn()-as-constructor limitation noted in RadioService.test.ts:
// Vitest's mock proxying for dynamically-imported modules loses `new`-ability
// on vi.fn()-wrapped properties, so the native module export must be a plain
// constructor function, with per-test scripting going through closures.
const { DabRadioCtor, setQueuedStations, callOrder, setStartDelayMs, setProgrammeInfo } =
  vi.hoisted(() => {
    type Listener = (payload?: unknown) => void
    type QueuedStation = {
      id: number
      label: string
      channel: string
      frequencyHz: number
      snr: number
    }
    type ProgrammeInfo = { codec: string; bitrateKbps: number } | null

    let queuedStations: QueuedStation[] = []
    let startDelayMs = 0
    let programmeInfo: ProgrammeInfo = null
    const callOrder: string[] = []

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
          callOrder.push(`start:${frequencyHz}`)
          // Simulates a slow real retune — long enough that a second
          // selectStation() call issued without awaiting the first would
          // overlap it if the two weren't properly serialized.
          if (startDelayMs > 0) await new Promise((r) => setTimeout(r, startDelayMs))
          // Real ensembles announce services shortly after a retune. Mirror
          // that here so selectStation()'s waitForSync resolves immediately
          // instead of hitting its real 8s timeout in every test.
          const match = queuedStations.find((s) => s.frequencyHz === frequencyHz)
          if (match) setTimeout(() => emit('service', { id: match.id, label: match.label }), 0)
        }),
        stop: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
        selectService: vi.fn((id: number) => {
          callOrder.push(`selectService:${id}`)
        }),
        getProgrammeInfo: vi.fn(() => programmeInfo),
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
      },
      setStartDelayMs: (ms: number) => {
        startDelayMs = ms
      },
      setProgrammeInfo: (info: ProgrammeInfo) => {
        programmeInfo = info
      },
      callOrder
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
  setStartDelayMs(0)
  setProgrammeInfo(null)
  callOrder.length = 0
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

describe('DabRadio selection queueing and loading state', () => {
  test('a second selectStation call queues behind a slow first one instead of racing it', async () => {
    setQueuedStations([SLAM_WEAK, SLAM_STRONG])
    setStartDelayMs(20)
    const dab = new DabRadio(vi.fn())
    await dab.hydrate(undefined)

    const first = dab.selectStation(SLAM_WEAK)
    const second = dab.selectStation(SLAM_STRONG)
    await Promise.all([first, second])

    // If the two calls had raced, start:STRONG could have landed before
    // selectService:WEAK (interleaving the native start() of the second
    // tap into the middle of the first's still-in-flight retune) — this is
    // exactly the class of bug that made a station sometimes need a
    // second tap to actually take effect.
    expect(callOrder).toEqual([
      'start:220352000',
      'selectService:1',
      'start:197648000',
      'selectService:2'
    ])
    expect(dab.getState().currentStation).toMatchObject({ id: 2, channel: '8B' })
  })

  test('selectingStation is set while a selection is in flight and cleared once it settles', async () => {
    setQueuedStations([SLAM_WEAK])
    setStartDelayMs(20)
    const dab = new DabRadio(vi.fn())
    await dab.hydrate(undefined)

    expect(dab.getState().selectingStation).toBeNull()

    const pending = dab.selectStation(SLAM_WEAK)
    // enqueue() chains through a resolved promise, so the queued task only
    // actually starts running (setting selectingStation) a microtask later.
    await Promise.resolve()
    expect(dab.getState().selectingStation).toMatchObject({ id: 1, channel: '11C' })

    await pending

    expect(dab.getState().selectingStation).toBeNull()
  })

  test('programmeInfo reflects the native codec/bitrate lookup after a successful selection', async () => {
    setQueuedStations([SLAM_WEAK])
    setProgrammeInfo({ codec: 'DAB+', bitrateKbps: 96 })
    const dab = new DabRadio(vi.fn())
    await dab.hydrate(undefined)

    await dab.selectStation(SLAM_WEAK)

    expect(dab.getState().programmeInfo).toEqual({ codec: 'DAB+', bitrateKbps: 96 })
  })

  test('stop() cuts short an in-flight selectStation sync wait instead of queuing 8s behind it', async () => {
    // No queued stations means the ensemble never announces SLAM_WEAK's
    // service — without the fix, waitForSync would only resolve via its own
    // SYNC_TIMEOUT_MS (8s) timer, and stop() (enqueued behind it) would have
    // to wait that whole time too. This is exactly what made switching to FM
    // right after a slow/failed tune feel like it locked up.
    setQueuedStations([])
    const dab = new DabRadio(vi.fn())
    await dab.hydrate(undefined)

    const selecting = dab.selectStation(SLAM_WEAK)
    // Let the queued task actually start and reach the sync wait.
    await new Promise((r) => setTimeout(r, 0))
    expect(dab.getState().selectingStation).toMatchObject({ id: 1 })

    await dab.stop()
    await selecting

    expect(callOrder).toEqual(['start:220352000'])
    expect(callOrder).not.toContain('selectService:1')
    expect(dab.getState()).toMatchObject({
      running: false,
      currentStation: null,
      selectingStation: null
    })
  })
})
