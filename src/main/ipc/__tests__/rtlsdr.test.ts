import { registerIpcHandle } from '@main/ipc/register'
import { registerRtlSdrIpc } from '@main/ipc/rtlsdr'
import { radioService } from '@main/services/rtlsdr/RadioService'
import { detectRtlSdr } from '@main/services/rtlsdr/RtlSdrDetection'
import type { Mock } from 'vitest'

vi.mock('@main/ipc/register', () => ({
  registerIpcHandle: vi.fn()
}))

vi.mock('@main/services/rtlsdr/RtlSdrDetection', () => ({
  detectRtlSdr: vi.fn(() => true)
}))

vi.mock('@main/services/rtlsdr/RadioService', () => ({
  radioService: {
    start: vi.fn(),
    stop: vi.fn(),
    setFrequency: vi.fn(),
    setMode: vi.fn(),
    step: vi.fn(),
    getState: vi.fn(),
    setFavorite: vi.fn(),
    recallFavorite: vi.fn()
  }
}))

describe('registerRtlSdrIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function getHandler<T = (...args: unknown[]) => unknown>(channel: string): T {
    const pair = (registerIpcHandle as Mock).mock.calls.find(([ch]) => ch === channel)
    if (!pair) throw new Error(`Handler not registered for ${channel}`)
    return pair[1] as T
  }

  test('registers all expected channels', () => {
    registerRtlSdrIpc()

    const channels = (registerIpcHandle as Mock).mock.calls.map(([ch]) => ch)
    expect(channels).toEqual([
      'rtl-sdr-detect',
      'radio-start',
      'radio-stop',
      'radio-set-mode',
      'radio-set-frequency',
      'radio-step',
      'radio-get-state',
      'radio-set-favorite',
      'radio-recall-favorite'
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

  test('radio-set-favorite delegates to radioService.setFavorite', () => {
    registerRtlSdrIpc()
    const handler = getHandler<(evt: unknown, slot: number) => unknown>('radio-set-favorite')

    handler({}, 2)

    expect(radioService.setFavorite).toHaveBeenCalledWith(2)
  })

  test('radio-recall-favorite delegates to radioService.recallFavorite', () => {
    registerRtlSdrIpc()
    const handler = getHandler<(evt: unknown, slot: number) => unknown>('radio-recall-favorite')

    handler({}, 3)

    expect(radioService.recallFavorite).toHaveBeenCalledWith(3)
  })
})
