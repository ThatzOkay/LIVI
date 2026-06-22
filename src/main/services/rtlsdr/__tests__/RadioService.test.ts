import type { Mock } from 'vitest'

// Demodulation now happens natively inside the addon's own streaming thread
// (see lib.rs's read_async()) — readAsync's callback receives ready-to-play
// PCM directly, and RDS is pulled via getRds() rather than a per-instance
// pipeline object. getRds is mutable per test via setNextRds, mirroring
// DabRadio.test.ts's setProgrammeInfo pattern.
const { mockAddon, setNextRds } = vi.hoisted(() => {
  let rds: unknown = { programId: 0, programType: 'None' }
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
      getRds: vi.fn(() => rds)
    },
    setNextRds: (next: unknown) => {
      rds = next
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
    setNextRds({ programId: 0, programType: 'None' })
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

  test('readAsync callback writes the already-demodulated PCM straight to the audio output', async () => {
    await radioService.startFm(100.0)

    expect(mockAddon.readAsync).toHaveBeenCalledWith(expect.any(Function), 48000)
    const cb = mockAddon.readAsync.mock.calls[0][0] as (buf: Buffer) => void
    const pcm = Buffer.from([1, 2, 3, 4])
    cb(pcm)

    expect(mockAudioOutput.write).toHaveBeenCalledWith(pcm)
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
    setNextRds({ programId: 0, programType: 'None' })

    await radioService.startFm(100.0)
    const cb = mockAddon.readAsync.mock.calls[0][0] as (buf: Buffer) => void

    cb(Buffer.from([0, 0]))
    expect(radioService.getState().station).toBeNull()

    setNextRds({
      programId: 4242,
      programType: 'Pop',
      stationName: 'TEST FM',
      radioText: 'Now playing'
    })
    cb(Buffer.from([0, 0]))
    expect(radioService.getState().station).toEqual({
      id: 4242,
      genre: 'Pop',
      name: 'TEST FM',
      text: 'Now playing'
    })
  })

  test('retuning clears cached station info — the addon resets its own RDS state in lockstep', async () => {
    setNextRds({
      programId: 4242,
      programType: 'Pop',
      stationName: 'TEST FM',
      radioText: 'Now playing'
    })

    await radioService.startFm(100.0)
    const cb = mockAddon.readAsync.mock.calls[0][0] as (buf: Buffer) => void
    cb(Buffer.from([0, 0]))
    expect(radioService.getState().station).not.toBeNull()

    await radioService.setFmFrequency(98.0)

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
        dabFavorites: NO_FAVORITES,
        lastDabStation: null
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
        dabFavorites: NO_FAVORITES,
        lastDabStation: null
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
