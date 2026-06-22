import type { Mock } from 'vitest'

// FMPipeline must be a plain constructor (not vi.fn()) — Vitest's mock proxying for
// dynamically-imported modules loses `new`-ability on vi.fn()-wrapped properties
// ("X is not a constructor"), so per-test pipeline swapping goes through a closure
// variable instead of vi.fn().mockImplementationOnce().
const { mockAddon, setNextFMPipeline } = vi.hoisted(() => {
  const defaultPipeline = () => ({
    process: vi.fn(() => new Float32Array([0.5, -2, 1.5])),
    rds: vi.fn(() => ({ programId: 0, programType: 'None' })),
    resetRds: vi.fn()
  })
  let nextPipeline: (() => unknown) | null = null
  function FMPipelineCtor() {
    const factory = nextPipeline ?? defaultPipeline
    nextPipeline = null
    return factory()
  }
  return {
    mockAddon: {
      getDeviceCount: vi.fn(),
      open: vi.fn(),
      close: vi.fn(),
      setSampleRate: vi.fn(),
      setGain: vi.fn(),
      setFrequency: vi.fn(),
      readAsync: vi.fn(),
      stopAsync: vi.fn(),
      FMPipeline: FMPipelineCtor
    },
    setNextFMPipeline: (factory: () => unknown) => {
      nextPipeline = factory
    }
  }
})

vi.mock('rtl-sdr-fm', () => mockAddon)

// Same vi.fn()-as-constructor limitation as FMPipeline above — AudioOutput must be a
// plain constructor too.
const { mockAudioOutput, AudioOutputCtor } = vi.hoisted(() => {
  const mockAudioOutput = {
    start: vi.fn(),
    write: vi.fn(),
    stop: vi.fn()
  }
  function AudioOutputCtor() {
    return mockAudioOutput
  }
  return { mockAudioOutput, AudioOutputCtor }
})

vi.mock('@main/services/audio', () => ({
  AudioOutput: AudioOutputCtor
}))

const { configEventsMock } = vi.hoisted(() => ({
  configEventsMock: { emit: vi.fn(), on: vi.fn(), off: vi.fn() }
}))
vi.mock('@main/ipc/utils', () => ({ configEvents: configEventsMock }))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  }
}))

const NO_FAVORITES = [null, null, null, null, null]

describe('RadioService', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let radioService: any

  // A single shared import for the whole suite: RadioService's `load()` memoizes the
  // native addon reference once resolved, so re-importing the module fresh per test
  // (via resetModules) is unreliable for a dynamically-imported native dep here — state
  // is reset between tests via the service's own public API instead (below).
  beforeAll(async () => {
    radioService = (await import('../RadioService')).radioService
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    mockAddon.open.mockReturnValue(0)
    await radioService.stopFm()
    await radioService.hydrate({ lastFrequencyMhz: 100, lastMode: 'fm', favorites: [] })
  })

  test('getState returns the default stopped state', () => {
    expect(radioService.getState()).toEqual({
      running: false,
      frequencyMhz: 100.0,
      mode: 'fm',
      station: null,
      favorites: NO_FAVORITES
    })
  })

  test('setMode updates the mode and broadcasts state', () => {
    const state = radioService.setMode('dab')

    expect(state).toEqual({
      running: false,
      frequencyMhz: 100.0,
      mode: 'dab',
      station: null,
      favorites: NO_FAVORITES
    })
    expect(radioService.getState().mode).toBe('dab')
  })

  test('start opens the device, tunes and begins streaming audio', async () => {
    const state = await radioService.startFm(101.3)

    expect(mockAddon.open).toHaveBeenCalledWith(0)
    expect(mockAddon.setSampleRate).toHaveBeenCalledWith(2048000)
    expect(mockAddon.setFrequency).toHaveBeenCalledWith(101.3 * 1_000_000)
    expect(mockAudioOutput.start).toHaveBeenCalled()
    expect(mockAddon.readAsync).toHaveBeenCalled()
    expect(state).toEqual({
      running: true,
      frequencyMhz: 101.3,
      mode: 'fm',
      station: null,
      favorites: NO_FAVORITES
    })
  })

  test('readAsync callback demodulates and writes clamped PCM to the audio output', async () => {
    await radioService.startFm(100.0)

    const cb = mockAddon.readAsync.mock.calls[0][0] as (buf: Buffer) => void
    cb(Buffer.from([0, 0]))

    expect(mockAudioOutput.write).toHaveBeenCalledTimes(1)
    const written = mockAudioOutput.write.mock.calls[0][0] as Int16Array
    expect(written[0]).toBe(Math.round(0.5 * 32767))
    expect(written[1]).toBe(-32767)
    expect(written[2]).toBe(32767)
  })

  test('stop tears down audio output and the device', async () => {
    await radioService.startFm()
    const state = await radioService.stopFm()

    expect(mockAddon.stopAsync).toHaveBeenCalled()
    expect(mockAddon.close).toHaveBeenCalled()
    expect(mockAudioOutput.stop).toHaveBeenCalled()
    expect(state).toEqual({
      running: false,
      frequencyMhz: 100.0,
      mode: 'fm',
      station: null,
      favorites: NO_FAVORITES
    })
  })

  test('setFrequency clamps to the FM band and re-tunes while running', async () => {
    await radioService.startFm()
    const state = await radioService.setFmFrequency(200)

    expect(state.frequencyMhz).toBe(87)
    expect(mockAddon.setFrequency).toHaveBeenCalledWith(87 * 1_000_000)
  })

  test('step moves by the small step and wraps at the band edges', async () => {
    await radioService.startFm(87)
    const state = await radioService.stepFm(-1, false)

    expect(state.frequencyMhz).toBe(108)
  })

  test('step moves by the fast step when fast is true', async () => {
    await radioService.startFm(100.0)
    const state = await radioService.stepFm(1, true)

    expect(state.frequencyMhz).toBe(101.0)
  })

  test('broadcasts state to all open windows', async () => {
    const win = { webContents: { send: vi.fn() } }
    const { BrowserWindow } = await import('electron')
    ;(BrowserWindow.getAllWindows as Mock).mockReturnValue([win])

    await radioService.startFm(100.0)

    expect(win.webContents.send).toHaveBeenCalledWith('radio-event', {
      type: 'state',
      state: {
        running: true,
        frequencyMhz: 100.0,
        mode: 'fm',
        station: null,
        favorites: NO_FAVORITES
      }
    })
  })

  test('readAsync callback picks up station info and broadcasts when it changes', async () => {
    const fmPipeline = {
      process: vi.fn(() => new Float32Array([0])),
      rds: vi.fn().mockReturnValueOnce({ programId: 0, programType: 'None' }).mockReturnValue({
        programId: 4242,
        programType: 'Pop',
        stationName: 'TEST FM',
        radioText: 'Now playing'
      }),
      resetRds: vi.fn()
    }
    setNextFMPipeline(() => fmPipeline)

    await radioService.startFm(100.0)
    const cb = mockAddon.readAsync.mock.calls[0][0] as (buf: Buffer) => void

    cb(Buffer.from([0, 0]))
    expect(radioService.getState().station).toBeNull()

    cb(Buffer.from([0, 0]))
    expect(radioService.getState().station).toEqual({
      id: 4242,
      genre: 'Pop',
      name: 'TEST FM',
      text: 'Now playing'
    })
  })

  test('retuning resets RDS state on the pipeline and clears cached station info', async () => {
    const fmPipeline = {
      process: vi.fn(() => new Float32Array([0])),
      rds: vi.fn(() => ({
        programId: 4242,
        programType: 'Pop',
        stationName: 'TEST FM',
        radioText: 'Now playing'
      })),
      resetRds: vi.fn()
    }
    setNextFMPipeline(() => fmPipeline)

    await radioService.startFm(100.0)
    const cb = mockAddon.readAsync.mock.calls[0][0] as (buf: Buffer) => void
    cb(Buffer.from([0, 0]))
    expect(radioService.getState().station).not.toBeNull()

    await radioService.setFmFrequency(98.0)

    expect(fmPipeline.resetRds).toHaveBeenCalled()
    expect(radioService.getState().station).toBeNull()
  })

  test('hydrate restores last frequency, mode and favorites from persisted config', async () => {
    await radioService.hydrate({
      lastFrequencyMhz: 98.5,
      lastMode: 'dab',
      favorites: [88.0, null, 103.5]
    })

    expect(radioService.getState()).toEqual({
      running: false,
      frequencyMhz: 98.5,
      mode: 'dab',
      station: null,
      favorites: [88.0, null, 103.5, null, null]
    })
  })

  test('hydrate is a no-op when there is nothing persisted', async () => {
    await radioService.hydrate(undefined)

    expect(radioService.getState()).toEqual({
      running: false,
      frequencyMhz: 100.0,
      mode: 'fm',
      station: null,
      favorites: NO_FAVORITES
    })
  })

  test('setFavorite saves the current frequency into a slot and persists it', async () => {
    vi.useFakeTimers()
    await radioService.startFm(98.5)

    const state = radioService.setFmFavorite(2)

    expect(state.favorites).toEqual([null, null, 98.5, null, null])
    expect(radioService.getState().favorites).toEqual([null, null, 98.5, null, null])
    // Favorites are a deliberate save action — persisted immediately, not debounced.
    expect(configEventsMock.emit).toHaveBeenCalledWith('requestSave', {
      radio: {
        lastFrequencyMhz: 98.5,
        lastMode: 'fm',
        favorites: [null, null, 98.5, null, null],
        dabFavorites: NO_FAVORITES
      }
    })
    vi.useRealTimers()
  })

  test('setFavorite ignores out-of-range slots', async () => {
    await radioService.startFm(98.5)
    const before = radioService.getState().favorites

    radioService.setFmFavorite(5)
    radioService.setFmFavorite(-1)

    expect(radioService.getState().favorites).toEqual(before)
  })

  test('recallFavorite tunes to the saved frequency', async () => {
    await radioService.startFm(100.0)
    radioService.setFmFavorite(0)
    await radioService.setFmFrequency(90.0)

    const state = await radioService.recallFmFavorite(0)

    expect(state.frequencyMhz).toBe(100.0)
    expect(mockAddon.setFrequency).toHaveBeenCalledWith(100.0 * 1_000_000)
  })

  test('recallFavorite is a no-op for an empty slot', async () => {
    await radioService.startFm(100.0)

    const state = await radioService.recallFmFavorite(3)

    expect(state.frequencyMhz).toBe(100.0)
  })

  test('frequency changes are persisted after a debounce window', async () => {
    vi.useFakeTimers()
    await radioService.startFm(100.0)
    configEventsMock.emit.mockClear()

    await radioService.setFmFrequency(98.0)
    expect(configEventsMock.emit).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)

    expect(configEventsMock.emit).toHaveBeenCalledWith('requestSave', {
      radio: {
        lastFrequencyMhz: 98.0,
        lastMode: 'fm',
        favorites: NO_FAVORITES,
        dabFavorites: NO_FAVORITES
      }
    })
    vi.useRealTimers()
  })

  test('start reports an error and leaves state stopped when the addon is unavailable', async () => {
    vi.resetModules()
    vi.doMock('rtl-sdr-fm', () => {
      throw new Error('addon missing')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const fresh = (await import('../RadioService')).radioService
    const state = await fresh.startFm()

    expect(state.running).toBe(false)
    errorSpy.mockRestore()
  })
})
