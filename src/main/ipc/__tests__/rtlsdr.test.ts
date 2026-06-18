import { registerIpcHandle } from '@main/ipc/register'
import { registerRtlSdrIpc } from '@main/ipc/rtlsdr'
import { radioService } from '@main/services/rtlsdr/RadioService'
import { detectRtlSdr } from '@main/services/rtlsdr/RtlSdrDetection'

jest.mock('@main/ipc/register', () => ({
  registerIpcHandle: jest.fn()
}))

jest.mock('@main/services/rtlsdr/RtlSdrDetection', () => ({
  detectRtlSdr: jest.fn(() => true)
}))

jest.mock('@main/services/rtlsdr/RadioService', () => ({
  radioService: {
    start: jest.fn(),
    stop: jest.fn(),
    setFrequency: jest.fn(),
    setMode: jest.fn(),
    step: jest.fn(),
    getState: jest.fn()
  }
}))

describe('registerRtlSdrIpc', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  function getHandler<T = (...args: unknown[]) => unknown>(channel: string): T {
    const pair = (registerIpcHandle as jest.Mock).mock.calls.find(([ch]) => ch === channel)
    if (!pair) throw new Error(`Handler not registered for ${channel}`)
    return pair[1] as T
  }

  test('registers all expected channels', () => {
    registerRtlSdrIpc()

    const channels = (registerIpcHandle as jest.Mock).mock.calls.map(([ch]) => ch)
    expect(channels).toEqual([
      'rtl-sdr-detect',
      'radio-start',
      'radio-stop',
      'radio-set-mode',
      'radio-set-frequency',
      'radio-step',
      'radio-get-state'
    ])
  })

  test('rtl-sdr-detect delegates to detectRtlSdr', () => {
    registerRtlSdrIpc()
    const handler = getHandler('rtl-sdr-detect')

    expect(handler()).toBe(true)
    expect(detectRtlSdr).toHaveBeenCalledTimes(1)
  })

  test('radio-start delegates to radioService.start with the given frequency', () => {
    registerRtlSdrIpc()
    const handler = getHandler<(evt: unknown, freq?: number) => unknown>('radio-start')

    handler({}, 101.3)

    expect(radioService.start).toHaveBeenCalledWith(101.3)
  })

  test('radio-stop delegates to radioService.stop', () => {
    registerRtlSdrIpc()
    const handler = getHandler('radio-stop')

    handler()

    expect(radioService.stop).toHaveBeenCalledTimes(1)
  })

  test('radio-set-mode delegates to radioService.setMode', () => {
    registerRtlSdrIpc()
    const handler = getHandler<(evt: unknown, mode: 'fm' | 'dab') => unknown>('radio-set-mode')

    handler({}, 'dab')

    expect(radioService.setMode).toHaveBeenCalledWith('dab')
  })

  test('radio-set-frequency delegates to radioService.setFrequency', () => {
    registerRtlSdrIpc()
    const handler = getHandler<(evt: unknown, freq: number) => unknown>('radio-set-frequency')

    handler({}, 98.0)

    expect(radioService.setFrequency).toHaveBeenCalledWith(98.0)
  })

  test('radio-step delegates to radioService.step with direction and fast flag', () => {
    registerRtlSdrIpc()
    const handler =
      getHandler<(evt: unknown, opts: { direction: 1 | -1; fast?: boolean }) => unknown>(
        'radio-step'
      )

    handler({}, { direction: -1, fast: true })

    expect(radioService.step).toHaveBeenCalledWith(-1, true)
  })

  test('radio-step defaults fast to false when omitted', () => {
    registerRtlSdrIpc()
    const handler =
      getHandler<(evt: unknown, opts: { direction: 1 | -1; fast?: boolean }) => unknown>(
        'radio-step'
      )

    handler({}, { direction: 1 })

    expect(radioService.step).toHaveBeenCalledWith(1, false)
  })

  test('radio-get-state delegates to radioService.getState', () => {
    registerRtlSdrIpc()
    const handler = getHandler('radio-get-state')

    handler()

    expect(radioService.getState).toHaveBeenCalledTimes(1)
  })
})
