const { EventEmitter } = require('events')
const { DabAddon } = require('./build/Release/rtl_sdr_dab.node')

// Standard DAB Band III channel raster (matches welle.io's own
// vendor/welle.io/src/various/channels.cpp). Each station only exists within
// the ensemble of a single channel, so building a station list means tuning
// to each channel in turn and collecting whatever services the FIC announces
// while we're listening.
const DAB_CHANNELS = [
  { channel: '5A', frequencyHz: 174928000 },
  { channel: '5B', frequencyHz: 176640000 },
  { channel: '5C', frequencyHz: 178352000 },
  { channel: '5D', frequencyHz: 180064000 },
  { channel: '6A', frequencyHz: 181936000 },
  { channel: '6B', frequencyHz: 183648000 },
  { channel: '6C', frequencyHz: 185360000 },
  { channel: '6D', frequencyHz: 187072000 },
  { channel: '7A', frequencyHz: 188928000 },
  { channel: '7B', frequencyHz: 190640000 },
  { channel: '7C', frequencyHz: 192352000 },
  { channel: '7D', frequencyHz: 194064000 },
  { channel: '8A', frequencyHz: 195936000 },
  { channel: '8B', frequencyHz: 197648000 },
  { channel: '8C', frequencyHz: 199360000 },
  { channel: '8D', frequencyHz: 201072000 },
  { channel: '9A', frequencyHz: 202928000 },
  { channel: '9B', frequencyHz: 204640000 },
  { channel: '9C', frequencyHz: 206352000 },
  { channel: '9D', frequencyHz: 208064000 },
  { channel: '10A', frequencyHz: 209936000 },
  { channel: '10B', frequencyHz: 211648000 },
  { channel: '10C', frequencyHz: 213360000 },
  { channel: '10D', frequencyHz: 215072000 },
  { channel: '11A', frequencyHz: 216928000 },
  { channel: '11B', frequencyHz: 218640000 },
  { channel: '11C', frequencyHz: 220352000 },
  { channel: '11D', frequencyHz: 222064000 },
  { channel: '12A', frequencyHz: 223936000 },
  { channel: '12B', frequencyHz: 225648000 },
  { channel: '12C', frequencyHz: 227360000 },
  { channel: '12D', frequencyHz: 229072000 },
  { channel: '13A', frequencyHz: 230784000 },
  { channel: '13B', frequencyHz: 232496000 },
  { channel: '13C', frequencyHz: 234208000 },
  { channel: '13D', frequencyHz: 235776000 },
  { channel: '13E', frequencyHz: 237488000 },
  { channel: '13F', frequencyHz: 239200000 }
]

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

class DabRadio extends EventEmitter {
  #addon
  #scanning = false

  constructor() {
    super()
    this.#addon = new DabAddon()

    this.#addon.onAudio((buffer, samplerate, stereo) => {
      this.emit('audio', { buffer, samplerate, stereo })
    })

    this.#addon.onService((service) => {
      this.emit('service', service)
    })

    this.#addon.onMetadata((type, value) => {
      this.emit('metadata', { type, value })
    })

    this.#addon.onSlide((buffer, mimeType) => {
      this.emit('slide', { buffer, mimeType })
    })

    this.#addon.onSnr((snr) => {
      this.emit('snr', snr)
    })

    this.#addon.onSignal((isSignal) => {
      this.emit('signal', isSignal)
    })
  }

  /**
   * Start receiving DAB on the given frequency. Resolves once the device is
   * open and tuned — this is a real (occasionally slow) USB operation, not a
   * fire-and-forget call.
   * @param {number} frequencyHz - e.g. 174928000 for 5A
   * @param {{ scan?: boolean }} [options] - scan must be true for the
   *   'signal' event to ever fire (it only fires when the receiver is
   *   restarted in welle.io's own "scan mode") — only scanStations() needs
   *   this, normal tuning leaves it false.
   * @returns {Promise<this>}
   */
  async start(frequencyHz, { scan = false } = {}) {
    await this.#addon.start(frequencyHz, scan)
    return this
  }

  /**
   * Pauses playback but keeps the USB device open, so resuming (another
   * start(), another scan channel) is a cheap retune rather than a full
   * close+reopen.
   * @returns {Promise<this>}
   */
  async stop() {
    await this.#addon.stop()
    return this
  }

  /**
   * Fully releases the USB device. Call this when actually done with DAB
   * (e.g. switching to FM) so the hardware is free for something else.
   * @returns {Promise<this>}
   */
  async close() {
    await this.#addon.close()
    return this
  }

  /**
   * Select a service by its service ID (received via 'service' event).
   * Only valid while tuned to the frequency the service was found on.
   * @param {number} serviceId
   */
  selectService(serviceId) {
    this.#addon.selectService(serviceId)
    return this
  }

  /**
   * Looks up a service's current label by ID. A service's label can still
   * be empty shortly after it's first detected — see scanStations()'s
   * label-polling loop for why — so this may legitimately return an empty
   * label even for a known, valid service.
   * @param {number} serviceId
   * @returns {{ id: number, label: string } | null}
   */
  getService(serviceId) {
    return this.#addon.getService(serviceId)
  }

  /**
   * Sweeps every Band III DAB channel, collecting whatever services each
   * ensemble announces, to build up a station list. DAB has no concept of
   * tuning to an arbitrary frequency and hoping for the best — you pick a
   * station from a known list instead, same as welle.io's own scan mode.
   *
   * Per channel, timing is adaptive rather than a fixed dwell — same as
   * welle.io's own GUI scanner (CRadioController::nextChannel /
   * onSignalPresence): wait briefly for the receiver to report whether
   * there's any signal at all, skip fast if not, and only settle in for the
   * long listen needed to decode services and labels once it confirms
   * something is actually there. A fixed short dwell would cut off every
   * channel with a real but marginal signal before it ever syncs.
   *
   * Emits 'scanProgress' ({ channel, frequencyHz }) as each channel starts,
   * 'stationFound' ({ id, label, channel, frequencyHz, snr }) for each new
   * station, and resolves/emits 'scanComplete' (stations[]) when done.
   *
   * @param {{ noSignalTimeoutMs?: number, signalDwellMs?: number }} [options]
   *   noSignalTimeoutMs: max time to wait for any signal-presence report
   *   before giving up on a channel. signalDwellMs: once signal is
   *   confirmed, how much longer to listen for services/labels (welle.io's
   *   GUI uses 10000ms here).
   * @returns {Promise<Array<{ id: number, label: string, channel: string, frequencyHz: number, snr: number }>>}
   */
  async scanStations({ noSignalTimeoutMs = 2000, signalDwellMs = 10000 } = {}) {
    if (this.#scanning) throw new Error('A scan is already in progress')
    this.#scanning = true

    const stations = new Map()
    let current = DAB_CHANNELS[0]
    // Same station (by SId) is sometimes broadcast on more than one channel
    // — different regional ensembles often carry the same national network.
    // Tracking SNR per channel here lets callers later decide which of
    // several same-station entries actually has the strongest signal.
    let currentSnr = 0
    const onSnr = (snr) => {
      currentSnr = snr
    }
    this.on('snr', onSnr)

    // The FIC announces a service's ID (firing the 'service' event) before
    // its label text has decoded off a separate FIG, and there's no
    // follow-up event when the label later lands — see addon.cpp's
    // getService() comment. welle.io's own GUI handles exactly this with a
    // recurring timer that re-polls getService() until the label resolves
    // (CRadioController::labelTimerTimeout); LABEL_POLL_MS/LABEL_POLL_RETRIES
    // here are the same idea. Capped so a service that genuinely never gets
    // a label (some run label-less) doesn't retry forever.
    const LABEL_POLL_MS = 250
    const LABEL_POLL_RETRIES = 20
    const pendingLabels = new Map() // key -> attempts so far

    const onService = (service) => {
      const key = `${current.frequencyHz}:${service.id}`
      if (stations.has(key)) return
      const station = {
        ...service,
        channel: current.channel,
        frequencyHz: current.frequencyHz,
        snr: currentSnr
      }
      stations.set(key, station)
      this.emit('stationFound', station)
      if (!station.label) pendingLabels.set(key, 0)
    }

    this.on('service', onService)

    const labelTimer = setInterval(() => {
      for (const [key, attempts] of pendingLabels) {
        const station = stations.get(key)
        if (!station) {
          pendingLabels.delete(key)
          continue
        }
        const fresh = this.getService(station.id)
        if (fresh && fresh.label) {
          station.label = fresh.label
          pendingLabels.delete(key)
          this.emit('stationFound', station)
        } else if (attempts + 1 >= LABEL_POLL_RETRIES) {
          pendingLabels.delete(key)
        } else {
          pendingLabels.set(key, attempts + 1)
        }
      }
    }, LABEL_POLL_MS)

    try {
      for (const entry of DAB_CHANNELS) {
        current = entry
        currentSnr = 0
        this.emit('scanProgress', entry)
        // start() retunes the already-open device in place rather than
        // closing and reopening the USB connection on every channel — same
        // as welle.io's own GUI (CRadioController::setChannel()). Doing a
        // full close+reopen 38 times back-to-back was observed to wedge
        // the dongle partway through a scan. The scan:true flag puts the
        // receiver in welle.io's "scan mode", which is what makes the
        // 'signal' event fire at all.
        await this.start(entry.frequencyHz, { scan: true })
        const hasSignal = await this.#waitForSignal(noSignalTimeoutMs)
        if (hasSignal) await delay(signalDwellMs)
      }
    } finally {
      // Mirrors welle.io's stopScan(): pause the receiver once the sweep
      // is done (or aborted), but the device handle stays open for
      // whatever comes next (selecting a station, scanning again).
      await this.stop()
      this.off('service', onService)
      this.off('snr', onSnr)
      clearInterval(labelTimer)
      this.#scanning = false
    }

    const result = Array.from(stations.values())
    this.emit('scanComplete', result)
    return result
  }

  /**
   * Resolves with whatever the next 'signal' event reports, or false if
   * none arrives within timeoutMs. Only ever meaningful right after a
   * start(freq, { scan: true }) call — see that option's doc comment.
   * @param {number} timeoutMs
   * @returns {Promise<boolean>}
   */
  #waitForSignal(timeoutMs) {
    return new Promise((resolve) => {
      let done = false
      const finish = (value) => {
        if (done) return
        done = true
        this.off('signal', onSignal)
        clearTimeout(timer)
        resolve(value)
      }
      const onSignal = (isSignal) => finish(isSignal)
      this.on('signal', onSignal)
      const timer = setTimeout(() => finish(false), timeoutMs)
    })
  }
}

module.exports = { DabRadio, DAB_CHANNELS }
