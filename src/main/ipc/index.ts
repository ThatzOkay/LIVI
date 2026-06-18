import { registerAppIpc } from '@main/ipc/app'
import { registerAudioIpc } from '@main/ipc/audio'
import { registerRtlSdrIpc } from '@main/ipc/rtlsdr'
import { registerSettingsIpc } from '@main/ipc/settings'
import { registerUpdateIpc } from '@main/ipc/update'
import { runtimeStateProps, ServicesProps } from '@main/types'

export function registerIpc(runtimeState: runtimeStateProps, services: ServicesProps) {
  registerAppIpc(runtimeState, services)
  registerAudioIpc()
  registerRtlSdrIpc()
  registerSettingsIpc(runtimeState)
  registerUpdateIpc(services)
}
