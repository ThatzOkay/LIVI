import { useCallback, useEffect, useRef, useState } from 'react'

// Switching away from DAB releases the RTL-SDR (a real USB teardown) right
// before FM's start() tries to reclaim the same tuner. Starting FM the
// instant stopDab() resolves was observed to stutter/lock up under CPU
// power-saving governors — the device hand-off and FM's own native init
// land in the same burst of CPU demand right as the CPU is still ramping up
// from idle. A short pause between the two gives it room to catch up.
const FM_RESUME_AFTER_DAB_DELAY_MS = 500

export type RadioMode = 'fm' | 'dab'

export type StationInfo = {
  id: number
  genre: string
  name?: string
  text?: string
}

export type RadioHookState = {
  running: boolean
  frequencyMhz: number
  mode: RadioMode
  station: StationInfo | null
  favorites: (number | null)[]
  error: string | null
}

// DAB has no continuous tuning — a station only exists within the ensemble of
// a specific channel, so it carries the channel's frequency alongside its id.
// imageUrl is a cached slideshow image, attached at runtime only.
export type DabStationRef = {
  id: number
  label: string
  channel: string
  frequencyHz: number
  imageUrl?: string
}

export type DabProgrammeInfo = { codec: 'DAB' | 'DAB+'; bitrateKbps: number }

export type DabHookState = {
  running: boolean
  scanning: boolean
  scanningChannel: string | null
  stations: DabStationRef[]
  currentStation: DabStationRef | null
  // The station a selectDabStation()/recallDabFavorite() call is currently
  // tuning to — null once it settles. Drives a loading indicator so a
  // multi-second retune doesn't look like nothing happened.
  selectingStation: DabStationRef | null
  programmeInfo: DabProgrammeInfo | null
  // DAB+'s Dynamic Label Segment — its equivalent of FM RDS RadioText, the
  // current track/show info. null for plain DAB services, which don't carry it.
  dynamicLabel: string | null
  favorites: (DabStationRef | null)[]
}

type RadioEventPayload =
  | {
      type: 'state'
      state: {
        running: boolean
        frequencyMhz: number
        mode: RadioMode
        station: StationInfo | null
        favorites: (number | null)[]
      }
    }
  | { type: 'dab-state'; state: DabHookState }
  | { type: 'error'; message: string }

const DEFAULT_STATE: RadioHookState = {
  running: false,
  frequencyMhz: 100.0,
  mode: 'dab',
  station: null,
  favorites: [null, null, null, null, null],
  error: null
}

const DEFAULT_DAB_STATE: DabHookState = {
  running: false,
  scanning: false,
  scanningChannel: null,
  stations: [],
  currentStation: null,
  selectingStation: null,
  programmeInfo: null,
  dynamicLabel: null,
  favorites: [null, null, null, null, null]
}

export function useRadioState({ forceHydrate = false } = {}) {
  const [state, setState] = useState<RadioHookState>(DEFAULT_STATE)
  const [dab, setDab] = useState<DabHookState>(DEFAULT_DAB_STATE)

  useEffect(() => {
    const handler = (_evt: unknown, payload?: RadioEventPayload) => {
      if (!payload) return
      if (payload.type === 'state') {
        setState((s) => ({ ...s, ...payload.state, error: null }))
      } else if (payload.type === 'dab-state') {
        setDab(payload.state)
      } else if (payload.type === 'error') {
        setState((s) => ({ ...s, error: payload.message }))
      }
    }
    return window.projection.radio.onEvent(handler as (e: unknown, ...a: unknown[]) => void)
  }, [])

  // DAB favorites/state are read once up front — unlike FM, nothing should
  // auto-start hardware just from reading them.
  useEffect(() => {
    void window.projection.radio.dab.getState().then(setDab)
  }, [])

  const start = useCallback(async () => {
    try {
      const result = await window.projection.radio.start()
      setState((s) => ({ ...s, ...result, error: null }))
    } catch (e) {
      setState((s) => ({ ...s, error: String(e) }))
    }
  }, [])

  const stop = useCallback(async () => {
    try {
      const result = await window.projection.radio.stop()
      setState((s) => ({ ...s, ...result, error: null }))
    } catch (e) {
      setState((s) => ({ ...s, error: String(e) }))
    }
  }, [])

  const toggle = useCallback(() => {
    return state.running ? stop() : start()
  }, [state.running, start, stop])

  const step = useCallback(async (direction: 1 | -1, fast = false) => {
    try {
      const result = await window.projection.radio.step(direction, fast)
      setState((s) => ({ ...s, ...result, error: null }))
    } catch (e) {
      setState((s) => ({ ...s, error: String(e) }))
    }
  }, [])

  const setFrequency = useCallback(async (frequencyMhz: number) => {
    try {
      const result = await window.projection.radio.setFrequency(frequencyMhz)
      setState((s) => ({ ...s, ...result, error: null }))
    } catch (e) {
      setState((s) => ({ ...s, error: String(e) }))
    }
  }, [])

  const setMode = useCallback(async (mode: RadioMode) => {
    try {
      const result = await window.projection.radio.setMode(mode)
      setState((s) => ({ ...s, ...result, error: null }))
    } catch (e) {
      setState((s) => ({ ...s, error: String(e) }))
    }
  }, [])

  const setFavorite = useCallback(async (slot: number) => {
    try {
      const result = await window.projection.radio.setFavorite(slot)
      setState((s) => ({ ...s, ...result, error: null }))
    } catch (e) {
      setState((s) => ({ ...s, error: String(e) }))
    }
  }, [])

  const recallFavorite = useCallback(async (slot: number) => {
    try {
      const result = await window.projection.radio.recallFavorite(slot)
      setState((s) => ({ ...s, ...result, error: null }))
    } catch (e) {
      setState((s) => ({ ...s, error: String(e) }))
    }
  }, [])

  const scanDabStations = useCallback(async () => {
    try {
      const result = await window.projection.radio.dab.scan()
      setDab(result)
    } catch (e) {
      setState((s) => ({ ...s, error: String(e) }))
    }
  }, [])

  const selectDabStation = useCallback(async (station: DabStationRef) => {
    try {
      const result = await window.projection.radio.dab.selectStation(station)
      setDab(result)
    } catch (e) {
      setState((s) => ({ ...s, error: String(e) }))
    }
  }, [])

  const stopDab = useCallback(async () => {
    try {
      const result = await window.projection.radio.dab.stop()
      setDab(result)
    } catch (e) {
      setState((s) => ({ ...s, error: String(e) }))
    }
  }, [])

  const setDabFavorite = useCallback(async (slot: number) => {
    try {
      const result = await window.projection.radio.dab.setFavorite(slot)
      setDab(result)
    } catch (e) {
      setState((s) => ({ ...s, error: String(e) }))
    }
  }, [])

  const recallDabFavorite = useCallback(async (slot: number) => {
    try {
      const result = await window.projection.radio.dab.recallFavorite(slot)
      setDab(result)
    } catch (e) {
      setState((s) => ({ ...s, error: String(e) }))
    }
  }, [])

  // Resumes whichever station was last selected (persisted across restarts
  // and mode switches) — mirrors start()'s frequency resume for FM. A no-op
  // if nothing was ever selected.
  const resumeDabStation = useCallback(async () => {
    try {
      const result = await window.projection.radio.dab.resume()
      setDab(result)
    } catch (e) {
      setState((s) => ({ ...s, error: String(e) }))
    }
  }, [])

  // Switching bands must release whichever device the previous band held —
  // otherwise the new band's start() fights it for the same USB tuner. FM's
  // deviceOpen always tracks running, so checking running is enough there.
  // DAB can leave its device open (fast-resume after a scan) even while
  // running is false, so stopDab() must always run unconditionally — it's a
  // safe no-op when nothing is open. FM then autostarts (it always has a
  // frequency to resume); DAB likewise resumes its last selected station.
  const switchMode = useCallback(
    async (mode: RadioMode) => {
      if (mode === 'dab') {
        if (state.running) await stop()
        await setMode(mode)
        await resumeDabStation()
      } else {
        await stopDab()
        await setMode(mode)
        await new Promise((resolve) => setTimeout(resolve, FM_RESUME_AFTER_DAB_DELAY_MS))
        await start()
      }
    },
    [state.running, stop, stopDab, setMode, start, resumeDabStation]
  )

  const startedRef = useRef(false)

  useEffect(() => {
    if (!forceHydrate || startedRef.current) return
    startedRef.current = true

    // The persisted mode lives in the main process (RadioService.hydrate()
    // ran at app startup) — fetch it before deciding whether to autostart FM,
    // rather than trusting the hook's stale default of 'fm'.
    void window.projection.radio.getState().then((result) => {
      setState((s) => ({ ...s, ...result, error: null }))
      if (result.mode === 'fm') void start()
      else void resumeDabStation()
    })

    return () => {
      if (!startedRef.current) return
      startedRef.current = false
      void stop()
      void stopDab()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceHydrate])

  return {
    ...state,
    dab,
    start,
    stop,
    toggle,
    step,
    setFrequency,
    setMode,
    switchMode,
    setFavorite,
    recallFavorite,
    scanDabStations,
    selectDabStation,
    stopDab,
    setDabFavorite,
    recallDabFavorite,
    resumeDabStation
  }
}
