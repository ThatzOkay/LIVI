import { registerIpcHandle } from '@main/ipc/register'
import { RadioMode, radioService } from '@main/services/rtlsdr/RadioService'
import { detectRtlSdr } from '@main/services/rtlsdr/RtlSdrDetection'
import type { DabStationRef } from '@shared/types'

export function registerRtlSdrIpc(): void {
  registerIpcHandle('rtl-sdr-detect', () => detectRtlSdr())

  registerIpcHandle('radio-start', (_evt, frequencyMhz?: number) =>
    radioService.startFm(frequencyMhz)
  )
  registerIpcHandle('radio-stop', () => radioService.stopFm())
  registerIpcHandle('radio-set-mode', (_evt, mode: RadioMode) => radioService.setMode(mode))
  registerIpcHandle('radio-set-frequency', (_evt, frequencyMhz: number) =>
    radioService.setFmFrequency(frequencyMhz)
  )
  registerIpcHandle('radio-step', (_evt, opts: { direction: 1 | -1; fast?: boolean }) =>
    radioService.stepFm(opts.direction, !!opts.fast)
  )
  registerIpcHandle('radio-get-state', () => radioService.getState())
  registerIpcHandle('radio-set-favorite', (_evt, slot: number) => radioService.setFmFavorite(slot))
  registerIpcHandle('radio-recall-favorite', (_evt, slot: number) =>
    radioService.recallFmFavorite(slot)
  )

  registerIpcHandle('radio-dab-scan', () => radioService.scanDabStations())
  registerIpcHandle('radio-dab-select-station', (_evt, station: DabStationRef) =>
    radioService.selectDabStation(station)
  )
  registerIpcHandle('radio-dab-stop', () => radioService.stopDab())
  registerIpcHandle('radio-dab-get-state', () => radioService.getDabState())
  registerIpcHandle('radio-dab-set-favorite', (_evt, slot: number) =>
    radioService.setDabFavorite(slot)
  )
  registerIpcHandle('radio-dab-recall-favorite', (_evt, slot: number) =>
    radioService.recallDabFavorite(slot)
  )
}
