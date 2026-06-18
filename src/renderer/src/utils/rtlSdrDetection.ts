export async function updateRtlSdr(
  setRtlSdrConnected: (connected: boolean) => void
): Promise<boolean> {
  try {
    console.log('[RtlSdrDetection] Detecting RTL-SDR...')
    const connected = await window.projection.usb.detectRtlSdr()
    console.log('[RtlSdrDetection] RTL-SDR detected:', connected)
    setRtlSdrConnected(connected)
    return connected
  } catch (err) {
    console.log('[RtlSdrDetection] detectRtlSdr failed', err)
    setRtlSdrConnected(false)
    return false
  }
}
