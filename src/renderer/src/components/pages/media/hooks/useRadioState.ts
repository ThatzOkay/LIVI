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
  | { type: 'error'; message: string }

const DEFAULT_STATE: RadioHookState = {
  running: false,
  frequencyMhz: 100.0,
  mode: 'fm',
  station: null,
  favorites: [null, null, null, null, null],
  error: null
}

export function useRadioState({ forceHydrate = false } = {}) {
  const [state, setState] = useState<RadioHookState>(DEFAULT_STATE)

  useEffect(() => {
    const handler = (_evt: unknown, payload?: RadioEventPayload) => {
      if (!payload) return
      if (payload.type === 'state') {
        setState((s) => ({ ...s, ...payload.state, error: null }))
      } else if (payload.type === 'error') {
        setState((s) => ({ ...s, error: payload.message }))
      }
    }
    return window.projection.radio.onEvent(handler as (e: unknown, ...a: unknown[]) => void)
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

  const startedRef = useRef(false)

  useEffect(() => {
    if (!forceHydrate || startedRef.current) return
    startedRef.current = true
    void setMode('fm').then(() => start())

    return () => {
      if (!startedRef.current) return
      startedRef.current = false
      void stop()
    }
  }, [forceHydrate, setMode, start, stop])

  return {
    ...state,
    start,
    stop,
    toggle,
    step,
    setFrequency,
    setMode,
    setFavorite,
    recallFavorite
  }
}
