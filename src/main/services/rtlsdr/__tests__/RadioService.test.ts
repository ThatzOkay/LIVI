const mockAddon = {
  getDeviceCount: jest.fn(),
  open: jest.fn(),
  close: jest.fn(),
  setSampleRate: jest.fn(),
  setGain: jest.fn(),
  setFrequency: jest.fn(),
  readAsync: jest.fn(),
  stopAsync: jest.fn(),
  FMPipeline: jest.fn().mockImplementation(() => ({
    process: jest.fn(() => new Float32Array([0.5, -2, 1.5])),
    rds: jest.fn(() => ({ programId: 0, programType: 'None' })),
    resetRds: jest.fn()
  }))
}

jest.mock('rtl-sdr-fm', () => mockAddon, { virtual: true })

const mockAudioOutput = {
  start: jest.fn(),
  write: jest.fn(),
  stop: jest.fn()
}

jest.mock('@main/services/audio', () => ({
  AudioOutput: jest.fn().mockImplementation(() => mockAudioOutput)
}))

const configEventsMock = { emit: jest.fn(), on: jest.fn(), off: jest.fn() }
jest.mock('@main/ipc/utils', () => ({ configEvents: configEventsMock }))

jest.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: jest.fn(() => [])
  }
}))

const NO_FAVORITES = [null, null, null, null, null]

describe('RadioService', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let radioService: any

  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    mockAddon.open.mockReturnValue(0)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    radioService = require('../RadioService').radioService
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

  test('start opens the device, tunes and begins streaming audio', () => {
    const state = radioService.start(101.3)

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

  test('readAsync callback demodulates and writes clamped PCM to the audio output', () => {
    radioService.start(100.0)

    const cb = mockAddon.readAsync.mock.calls[0][0] as (buf: Buffer) => void
    cb(Buffer.from([0, 0]))

    expect(mockAudioOutput.write).toHaveBeenCalledTimes(1)
    const written = mockAudioOutput.write.mock.calls[0][0] as Int16Array
    expect(written[0]).toBe(Math.round(0.5 * 32767))
    expect(written[1]).toBe(-32767)
    expect(written[2]).toBe(32767)
  })

  test('stop tears down audio output and the device', () => {
    radioService.start()
    const state = radioService.stop()

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

  test('setFrequency clamps to the FM band and re-tunes while running', () => {
    radioService.start()
    const state = radioService.setFrequency(200)

    expect(state.frequencyMhz).toBe(87)
    expect(mockAddon.setFrequency).toHaveBeenCalledWith(87 * 1_000_000)
  })

  test('step moves by the small step and wraps at the band edges', () => {
    radioService.start(87)
    const state = radioService.step(-1, false)

    expect(state.frequencyMhz).toBe(108)
  })

  test('step moves by the fast step when fast is true', () => {
    radioService.start(100.0)
    const state = radioService.step(1, true)

    expect(state.frequencyMhz).toBe(101.0)
  })

  test('broadcasts state to all open windows', () => {
    const win = { webContents: { send: jest.fn() } }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BrowserWindow } = require('electron')
    ;(BrowserWindow.getAllWindows as jest.Mock).mockReturnValue([win])

    radioService.start(100.0)

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

  test('readAsync callback picks up station info and broadcasts when it changes', () => {
    const fmPipeline = {
      process: jest.fn(() => new Float32Array([0])),
      rds: jest.fn().mockReturnValueOnce({ programId: 0, programType: 'None' }).mockReturnValue({
        programId: 4242,
        programType: 'Pop',
        stationName: 'TEST FM',
        radioText: 'Now playing'
      }),
      resetRds: jest.fn()
    }
    mockAddon.FMPipeline.mockImplementationOnce(() => fmPipeline)

    radioService.start(100.0)
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

  test('retuning resets RDS state on the pipeline and clears cached station info', () => {
    const fmPipeline = {
      process: jest.fn(() => new Float32Array([0])),
      rds: jest.fn(() => ({
        programId: 4242,
        programType: 'Pop',
        stationName: 'TEST FM',
        radioText: 'Now playing'
      })),
      resetRds: jest.fn()
    }
    mockAddon.FMPipeline.mockImplementationOnce(() => fmPipeline)

    radioService.start(100.0)
    const cb = mockAddon.readAsync.mock.calls[0][0] as (buf: Buffer) => void
    cb(Buffer.from([0, 0]))
    expect(radioService.getState().station).not.toBeNull()

    radioService.setFrequency(98.0)

    expect(fmPipeline.resetRds).toHaveBeenCalled()
    expect(radioService.getState().station).toBeNull()
  })

  test('hydrate restores last frequency, mode and favorites from persisted config', () => {
    radioService.hydrate({
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

  test('hydrate is a no-op when there is nothing persisted', () => {
    radioService.hydrate(undefined)

    expect(radioService.getState()).toEqual({
      running: false,
      frequencyMhz: 100.0,
      mode: 'fm',
      station: null,
      favorites: NO_FAVORITES
    })
  })

  test('setFavorite saves the current frequency into a slot and persists it', () => {
    jest.useFakeTimers()
    radioService.start(98.5)

    const state = radioService.setFavorite(2)

    expect(state.favorites).toEqual([null, null, 98.5, null, null])
    expect(radioService.getState().favorites).toEqual([null, null, 98.5, null, null])
    // Favorites are a deliberate save action — persisted immediately, not debounced.
    expect(configEventsMock.emit).toHaveBeenCalledWith('requestSave', {
      radio: { lastFrequencyMhz: 98.5, lastMode: 'fm', favorites: [null, null, 98.5, null, null] }
    })
    jest.useRealTimers()
  })

  test('setFavorite ignores out-of-range slots', () => {
    radioService.start(98.5)
    const before = radioService.getState().favorites

    radioService.setFavorite(5)
    radioService.setFavorite(-1)

    expect(radioService.getState().favorites).toEqual(before)
  })

  test('recallFavorite tunes to the saved frequency', () => {
    radioService.start(100.0)
    radioService.setFavorite(0)
    radioService.setFrequency(90.0)

    const state = radioService.recallFavorite(0)

    expect(state.frequencyMhz).toBe(100.0)
    expect(mockAddon.setFrequency).toHaveBeenCalledWith(100.0 * 1_000_000)
  })

  test('recallFavorite is a no-op for an empty slot', () => {
    radioService.start(100.0)

    const state = radioService.recallFavorite(3)

    expect(state.frequencyMhz).toBe(100.0)
  })

  test('frequency changes are persisted after a debounce window', () => {
    jest.useFakeTimers()
    radioService.start(100.0)
    configEventsMock.emit.mockClear()

    radioService.setFrequency(98.0)
    expect(configEventsMock.emit).not.toHaveBeenCalled()

    jest.advanceTimersByTime(1000)

    expect(configEventsMock.emit).toHaveBeenCalledWith('requestSave', {
      radio: { lastFrequencyMhz: 98.0, lastMode: 'fm', favorites: NO_FAVORITES }
    })
    jest.useRealTimers()
  })

  test('start reports an error and leaves state stopped when the addon is unavailable', () => {
    jest.resetModules()
    jest.doMock('rtl-sdr-fm', () => {
      throw new Error('addon missing')
    })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fresh = require('../RadioService').radioService
    const state = fresh.start()

    expect(state.running).toBe(false)
    errorSpy.mockRestore()
  })
})
