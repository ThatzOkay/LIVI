import { registerIpcHandle } from '@main/ipc/register'
import { RadioMode, radioService } from '@main/services/rtlsdr/RadioService'
import { detectRtlSdr } from '@main/services/rtlsdr/RtlSdrDetection'

export function registerRtlSdrIpc(): void {
  registerIpcHandle('rtl-sdr-detect', () => detectRtlSdr())

  registerIpcHandle('radio-start', (_evt, frequencyMhz?: number) =>
    radioService.start(frequencyMhz)
  )
  registerIpcHandle('radio-stop', () => radioService.stop())
  registerIpcHandle('radio-set-mode', (_evt, mode: RadioMode) => radioService.setMode(mode))
  registerIpcHandle('radio-set-frequency', (_evt, frequencyMhz: number) =>
    radioService.setFrequency(frequencyMhz)
  )
  registerIpcHandle('radio-step', (_evt, opts: { direction: 1 | -1; fast?: boolean }) =>
    radioService.step(opts.direction, !!opts.fast)
  )
  registerIpcHandle('radio-get-state', () => radioService.getState())
  registerIpcHandle('radio-set-favorite', (_evt, slot: number) => radioService.setFavorite(slot))
  registerIpcHandle('radio-recall-favorite', (_evt, slot: number) =>
    radioService.recallFavorite(slot)
  )
}
