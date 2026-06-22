import { useCallback, useEffect, useRef, useState } from 'react'

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

export type DabHookState = {
  running: boolean
  scanning: boolean
  scanningChannel: string | null
  stations: DabStationRef[]
  currentStation: DabStationRef | null
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
  mode: 'fm',
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

  // Switching bands must stop whichever was playing first — otherwise the
  // previous band keeps playing under the newly selected tab's label. FM then
  // autostarts (it always has a frequency to resume); DAB has no pipeline
  // running until the user scans/selects/recalls a station, so it stays idle.
  const switchMode = useCallback(
    async (mode: RadioMode) => {
      if (mode === 'dab') {
        if (state.running) await stop()
        await setMode(mode)
      } else {
        if (dab.running) await stopDab()
        await setMode(mode)
        await start()
      }
    },
    [state.running, dab.running, stop, stopDab, setMode, start]
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
    recallDabFavorite
  }
}
