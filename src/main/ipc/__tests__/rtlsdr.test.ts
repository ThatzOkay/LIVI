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
    startFm: vi.fn(),
    stopFm: vi.fn(),
    setFmFrequency: vi.fn(),
    setMode: vi.fn(),
    stepFm: vi.fn(),
    getState: vi.fn(),
    setFmFavorite: vi.fn(),
    recallFmFavorite: vi.fn(),
    scanDabStations: vi.fn(),
    selectDabStation: vi.fn(),
    stopDab: vi.fn(),
    getDabState: vi.fn(),
    setDabFavorite: vi.fn(),
    recallDabFavorite: vi.fn()
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
      'radio-recall-favorite',
      'radio-dab-scan',
      'radio-dab-select-station',
      'radio-dab-stop',
      'radio-dab-get-state',
      'radio-dab-set-favorite',
      'radio-dab-recall-favorite'
    ])
  })

  test('rtl-sdr-detect delegates to detectRtlSdr', () => {
    registerRtlSdrIpc()
    const handler = getHandler('rtl-sdr-detect')

    expect(handler()).toBe(true)
    expect(detectRtlSdr).toHaveBeenCalledTimes(1)
  })

  test('radio-start delegates to radioService.startFm with the given frequency', () => {
    registerRtlSdrIpc()
    const handler = getHandler<(evt: unknown, freq?: number) => unknown>('radio-start')

    handler({}, 101.3)

    expect(radioService.startFm).toHaveBeenCalledWith(101.3)
  })

  test('radio-stop delegates to radioService.stopFm', () => {
    registerRtlSdrIpc()
    const handler = getHandler('radio-stop')

    handler()

    expect(radioService.stopFm).toHaveBeenCalledTimes(1)
  })

  test('radio-set-mode delegates to radioService.setMode', () => {
    registerRtlSdrIpc()
    const handler = getHandler<(evt: unknown, mode: 'fm' | 'dab') => unknown>('radio-set-mode')

    handler({}, 'dab')

    expect(radioService.setMode).toHaveBeenCalledWith('dab')
  })

  test('radio-set-frequency delegates to radioService.setFmFrequency', () => {
    registerRtlSdrIpc()
    const handler = getHandler<(evt: unknown, freq: number) => unknown>('radio-set-frequency')

    handler({}, 98.0)

    expect(radioService.setFmFrequency).toHaveBeenCalledWith(98.0)
  })

  test('radio-step delegates to radioService.stepFm with direction and fast flag', () => {
    registerRtlSdrIpc()
    const handler =
      getHandler<(evt: unknown, opts: { direction: 1 | -1; fast?: boolean }) => unknown>(
        'radio-step'
      )

    handler({}, { direction: -1, fast: true })

    expect(radioService.stepFm).toHaveBeenCalledWith(-1, true)
  })

  test('radio-step defaults fast to false when omitted', () => {
    registerRtlSdrIpc()
    const handler =
      getHandler<(evt: unknown, opts: { direction: 1 | -1; fast?: boolean }) => unknown>(
        'radio-step'
      )

    handler({}, { direction: 1 })

    expect(radioService.stepFm).toHaveBeenCalledWith(1, false)
  })

  test('radio-get-state delegates to radioService.getState', () => {
    registerRtlSdrIpc()
    const handler = getHandler('radio-get-state')

    handler()

    expect(radioService.getState).toHaveBeenCalledTimes(1)
  })

  test('radio-set-favorite delegates to radioService.setFmFavorite', () => {
    registerRtlSdrIpc()
    const handler = getHandler<(evt: unknown, slot: number) => unknown>('radio-set-favorite')

    handler({}, 2)

    expect(radioService.setFmFavorite).toHaveBeenCalledWith(2)
  })

  test('radio-recall-favorite delegates to radioService.recallFmFavorite', () => {
    registerRtlSdrIpc()
    const handler = getHandler<(evt: unknown, slot: number) => unknown>('radio-recall-favorite')

    handler({}, 3)

    expect(radioService.recallFmFavorite).toHaveBeenCalledWith(3)
  })

  test('radio-dab-scan delegates to radioService.scanDabStations', () => {
    registerRtlSdrIpc()
    const handler = getHandler('radio-dab-scan')

    handler()

    expect(radioService.scanDabStations).toHaveBeenCalledTimes(1)
  })

  test('radio-dab-select-station delegates to radioService.selectDabStation', () => {
    registerRtlSdrIpc()
    const handler = getHandler<(evt: unknown, station: { id: number }) => unknown>(
      'radio-dab-select-station'
    )
    const station = { id: 4242, label: 'TEST', channel: '5A', frequencyHz: 174928000 }

    handler({}, station)

    expect(radioService.selectDabStation).toHaveBeenCalledWith(station)
  })

  test('radio-dab-stop delegates to radioService.stopDab', () => {
    registerRtlSdrIpc()
    const handler = getHandler('radio-dab-stop')

    handler()

    expect(radioService.stopDab).toHaveBeenCalledTimes(1)
  })

  test('radio-dab-get-state delegates to radioService.getDabState', () => {
    registerRtlSdrIpc()
    const handler = getHandler('radio-dab-get-state')

    handler()

    expect(radioService.getDabState).toHaveBeenCalledTimes(1)
  })

  test('radio-dab-set-favorite delegates to radioService.setDabFavorite', () => {
    registerRtlSdrIpc()
    const handler = getHandler<(evt: unknown, slot: number) => unknown>('radio-dab-set-favorite')

    handler({}, 1)

    expect(radioService.setDabFavorite).toHaveBeenCalledWith(1)
  })

  test('radio-dab-recall-favorite delegates to radioService.recallDabFavorite', () => {
    registerRtlSdrIpc()
    const handler = getHandler<(evt: unknown, slot: number) => unknown>('radio-dab-recall-favorite')

    handler({}, 4)

    expect(radioService.recallDabFavorite).toHaveBeenCalledWith(4)
  })
})
