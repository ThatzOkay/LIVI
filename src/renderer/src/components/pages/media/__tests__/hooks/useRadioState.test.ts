import { act, renderHook } from '@testing-library/react'
import { useRadioState } from '../../hooks'

const mockStart = vi.fn()
const mockStop = vi.fn()
const mockSetFrequency = vi.fn()
const mockSetMode = vi.fn()
const mockGetState = vi.fn()
const mockStep = vi.fn()
const mockSetFavorite = vi.fn()
const mockRecallFavorite = vi.fn()
const mockOnEvent = vi.fn()

const mockDabGetState = vi.fn()
const mockDabScan = vi.fn()
const mockDabSelectStation = vi.fn()
const mockDabStop = vi.fn()
const mockDabSetFavorite = vi.fn()
const mockDabRecallFavorite = vi.fn()

const NO_FAVORITES = [null, null, null, null, null]
const NO_DAB_FAVORITES = [null, null, null, null, null]
const DEFAULT_DAB_STATE = {
  running: false,
  scanning: false,
  scanningChannel: null,
  stations: [],
  currentStation: null,
  favorites: NO_DAB_FAVORITES
}

beforeEach(() => {
  vi.clearAllMocks()
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  ;(window as never).projection = {
    radio: {
      start: mockStart,
      stop: mockStop,
      setFrequency: mockSetFrequency,
      setMode: mockSetMode,
      getState: mockGetState,
      step: mockStep,
      setFavorite: mockSetFavorite,
      recallFavorite: mockRecallFavorite,
      onEvent: mockOnEvent,
      dab: {
        getState: mockDabGetState,
        scan: mockDabScan,
        selectStation: mockDabSelectStation,
        stop: mockDabStop,
        setFavorite: mockDabSetFavorite,
        recallFavorite: mockDabRecallFavorite
      }
    }
  }

  mockStart.mockResolvedValue({
    running: true,
    frequencyMhz: 100.0,
    mode: 'fm',
    station: null,
    favorites: NO_FAVORITES
  })
  mockStop.mockResolvedValue({
    running: false,
    frequencyMhz: 100.0,
    mode: 'fm',
    station: null,
    favorites: NO_FAVORITES
  })
  mockSetFrequency.mockResolvedValue({
    running: true,
    frequencyMhz: 98.0,
    mode: 'fm',
    station: null,
    favorites: NO_FAVORITES
  })
  mockSetMode.mockResolvedValue({
    running: false,
    frequencyMhz: 100.0,
    mode: 'fm',
    station: null,
    favorites: NO_FAVORITES
  })
  mockGetState.mockResolvedValue({
    running: false,
    frequencyMhz: 100.0,
    mode: 'fm',
    station: null,
    favorites: NO_FAVORITES
  })
  mockStep.mockResolvedValue({
    running: true,
    frequencyMhz: 100.1,
    mode: 'fm',
    station: null,
    favorites: NO_FAVORITES
  })
  mockSetFavorite.mockResolvedValue({
    running: false,
    frequencyMhz: 100.0,
    mode: 'fm',
    station: null,
    favorites: [null, null, 100.0, null, null]
  })
  mockRecallFavorite.mockResolvedValue({
    running: true,
    frequencyMhz: 103.5,
    mode: 'fm',
    station: null,
    favorites: [null, null, 103.5, null, null]
  })
  mockOnEvent.mockReturnValue(vi.fn())
  mockDabGetState.mockResolvedValue(DEFAULT_DAB_STATE)
})

describe('useRadioState', () => {
  it('returns the default stopped state', () => {
    const { result } = renderHook(() => useRadioState())

    expect(result.current.running).toBe(false)
    expect(result.current.frequencyMhz).toBe(100.0)
    expect(result.current.mode).toBe('dab')
    expect(result.current.error).toBeNull()
  })

  it('does not autostart when forceHydrate is false', () => {
    renderHook(() => useRadioState({ forceHydrate: false }))

    expect(mockGetState).not.toHaveBeenCalled()
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('fetches the persisted mode and autostarts FM, then stops on unmount when forceHydrate is true', async () => {
    const { unmount } = renderHook(() => useRadioState({ forceHydrate: true }))

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockGetState).toHaveBeenCalledTimes(1)
    expect(mockStart).toHaveBeenCalledTimes(1)

    unmount()

    expect(mockStop).toHaveBeenCalledTimes(1)
    expect(mockDabStop).toHaveBeenCalledTimes(1)
  })

  it('does not autostart FM when the persisted mode is dab', async () => {
    mockGetState.mockResolvedValue({
      running: false,
      frequencyMhz: 100.0,
      mode: 'dab',
      station: null,
      favorites: NO_FAVORITES
    })

    renderHook(() => useRadioState({ forceHydrate: true }))

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockGetState).toHaveBeenCalledTimes(1)
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('subscribes to radio events and unsubscribes on unmount', () => {
    const unsubscribe = vi.fn()
    mockOnEvent.mockReturnValueOnce(unsubscribe)

    const { unmount } = renderHook(() => useRadioState())

    expect(mockOnEvent).toHaveBeenCalled()
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('applies state events from the main process', () => {
    let handler: (ev: unknown, payload?: unknown) => void = () => {}
    mockOnEvent.mockImplementationOnce((cb) => {
      handler = cb
      return vi.fn()
    })

    const { result } = renderHook(() => useRadioState())

    act(() => {
      handler({}, { type: 'state', state: { running: true, frequencyMhz: 103.5 } })
    })

    expect(result.current.running).toBe(true)
    expect(result.current.frequencyMhz).toBe(103.5)
  })

  it('applies station info from state events', () => {
    let handler: (ev: unknown, payload?: unknown) => void = () => {}
    mockOnEvent.mockImplementationOnce((cb) => {
      handler = cb
      return vi.fn()
    })

    const { result } = renderHook(() => useRadioState())

    act(() => {
      handler(
        {},
        {
          type: 'state',
          state: {
            running: true,
            frequencyMhz: 103.5,
            mode: 'fm',
            station: { id: 4242, genre: 'Pop', name: 'TEST FM', text: 'Now playing' }
          }
        }
      )
    })

    expect(result.current.station).toEqual({
      id: 4242,
      genre: 'Pop',
      name: 'TEST FM',
      text: 'Now playing'
    })
  })

  it('applies error events from the main process', () => {
    let handler: (ev: unknown, payload?: unknown) => void = () => {}
    mockOnEvent.mockImplementationOnce((cb) => {
      handler = cb
      return vi.fn()
    })

    const { result } = renderHook(() => useRadioState())

    act(() => {
      handler({}, { type: 'error', message: 'no device' })
    })

    expect(result.current.error).toBe('no device')
  })

  it('toggle starts when stopped and stops when running', async () => {
    const { result } = renderHook(() => useRadioState())

    await act(async () => {
      await result.current.toggle()
    })
    expect(mockStart).toHaveBeenCalledTimes(1)
    expect(result.current.running).toBe(true)

    await act(async () => {
      await result.current.toggle()
    })
    expect(mockStop).toHaveBeenCalledTimes(1)
  })

  it('step delegates to window.projection.radio.step and updates state', async () => {
    const { result } = renderHook(() => useRadioState())

    await act(async () => {
      await result.current.step(1, true)
    })

    expect(mockStep).toHaveBeenCalledWith(1, true)
    expect(result.current.frequencyMhz).toBe(100.1)
  })

  it('setFrequency delegates and updates state', async () => {
    const { result } = renderHook(() => useRadioState())

    await act(async () => {
      await result.current.setFrequency(98.0)
    })

    expect(mockSetFrequency).toHaveBeenCalledWith(98.0)
    expect(result.current.frequencyMhz).toBe(98.0)
  })

  it('setMode delegates and updates state', async () => {
    mockSetMode.mockResolvedValueOnce({ running: false, frequencyMhz: 100.0, mode: 'dab' })
    const { result } = renderHook(() => useRadioState())

    await act(async () => {
      await result.current.setMode('dab')
    })

    expect(mockSetMode).toHaveBeenCalledWith('dab')
    expect(result.current.mode).toBe('dab')
  })

  it('sets an error message when start rejects', async () => {
    mockStart.mockRejectedValueOnce(new Error('boom'))
    const { result } = renderHook(() => useRadioState())

    await act(async () => {
      await result.current.start()
    })

    expect(result.current.error).toContain('boom')
  })

  it('setFavorite delegates and updates state', async () => {
    const { result } = renderHook(() => useRadioState())

    await act(async () => {
      await result.current.setFavorite(2)
    })

    expect(mockSetFavorite).toHaveBeenCalledWith(2)
    expect(result.current.favorites).toEqual([null, null, 100.0, null, null])
  })

  it('recallFavorite delegates and updates state', async () => {
    const { result } = renderHook(() => useRadioState())

    await act(async () => {
      await result.current.recallFavorite(2)
    })

    expect(mockRecallFavorite).toHaveBeenCalledWith(2)
    expect(result.current.frequencyMhz).toBe(103.5)
    expect(result.current.favorites).toEqual([null, null, 103.5, null, null])
  })
})
