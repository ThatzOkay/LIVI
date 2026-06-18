type RtlSdrAddon = {
  getDeviceCount: () => number
}

let addon: RtlSdrAddon | null = null
let loadFailed = false

// Lazily require the native addon: librtlsdr may not be present on every
// dev machine/platform, so a missing addon should disable detection rather
// than crash the main process.
function load(): RtlSdrAddon | null {
  if (addon || loadFailed) return addon
  try {
    addon = require('rtl-sdr-fm') as RtlSdrAddon
  } catch (e) {
    loadFailed = true
    console.error('[RtlSdr] native addon load failed:', (e as Error).message)
  }
  return addon
}

export function detectRtlSdr(): boolean {
  const a = load()
  if (!a) return false
  try {
    return a.getDeviceCount() > 0
  } catch (e) {
    console.error('[RtlSdr] getDeviceCount failed:', (e as Error).message)
    return false
  }
}
