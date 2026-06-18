import { act, renderHook } from '@testing-library/react'
import { useRadioState } from '../../hooks'

const mockStart = jest.fn()
const mockStop = jest.fn()
const mockSetFrequency = jest.fn()
const mockSetMode = jest.fn()
const mockStep = jest.fn()
const mockOnEvent = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  ;(window as never).projection = {
    radio: {
      start: mockStart,
      stop: mockStop,
      setFrequency: mockSetFrequency,
      setMode: mockSetMode,
      step: mockStep,
      onEvent: mockOnEvent
    }
  }

  mockStart.mockResolvedValue({ running: true, frequencyMhz: 100.0, mode: 'fm' })
  mockStop.mockResolvedValue({ running: false, frequencyMhz: 100.0, mode: 'fm' })
  mockSetFrequency.mockResolvedValue({ running: true, frequencyMhz: 98.0, mode: 'fm' })
  mockSetMode.mockResolvedValue({ running: false, frequencyMhz: 100.0, mode: 'fm' })
  mockStep.mockResolvedValue({ running: true, frequencyMhz: 100.1, mode: 'fm' })
  mockOnEvent.mockReturnValue(jest.fn())
})

describe('useRadioState', () => {
  it('returns the default stopped state', () => {
    const { result } = renderHook(() => useRadioState())

    expect(result.current.running).toBe(false)
    expect(result.current.frequencyMhz).toBe(100.0)
    expect(result.current.mode).toBe('fm')
    expect(result.current.error).toBeNull()
  })

  it('does not autostart when forceHydrate is false', () => {
    renderHook(() => useRadioState({ forceHydrate: false }))

    expect(mockStart).not.toHaveBeenCalled()
    expect(mockSetMode).not.toHaveBeenCalled()
  })

  it('sets mode to fm and autostarts, then stops on unmount when forceHydrate is true', async () => {
    const { unmount } = renderHook(() => useRadioState({ forceHydrate: true }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(mockSetMode).toHaveBeenCalledWith('fm')
    expect(mockStart).toHaveBeenCalledTimes(1)

    unmount()

    expect(mockStop).toHaveBeenCalledTimes(1)
  })

  it('subscribes to radio events and unsubscribes on unmount', () => {
    const unsubscribe = jest.fn()
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
      return jest.fn()
    })

    const { result } = renderHook(() => useRadioState())

    act(() => {
      handler({}, { type: 'state', state: { running: true, frequencyMhz: 103.5 } })
    })

    expect(result.current.running).toBe(true)
    expect(result.current.frequencyMhz).toBe(103.5)
  })

  it('applies error events from the main process', () => {
    let handler: (ev: unknown, payload?: unknown) => void = () => {}
    mockOnEvent.mockImplementationOnce((cb) => {
      handler = cb
      return jest.fn()
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
})
