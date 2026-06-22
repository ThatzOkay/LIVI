import StarIcon from '@mui/icons-material/Star'
import StarBorderIcon from '@mui/icons-material/StarBorder'
import { useTheme } from '@mui/material/styles'
import { useRef, useState } from 'react'
import type { DabStationRef } from '../../media/hooks'
import { circleBtnStyle } from '../../media/styles'

const LONG_PRESS_MS = 700
const SLOTS = 5

type DabFavoritesRowProps = {
  ctrlGap: number
  size: number
  fontPx: number
  favorites: (DabStationRef | null)[]
  currentStation: DabStationRef | null
  onRecall: (slot: number) => void
  onSave: (slot: number) => void
}

export const DabFavoritesRow = ({
  ctrlGap,
  size,
  fontPx,
  favorites,
  currentStation,
  onRecall,
  onSave
}: DabFavoritesRowProps) => {
  const theme = useTheme()
  const ringColor = theme.palette.primary.main

  const [pressed, setPressed] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const timers = useRef<Record<number, ReturnType<typeof setTimeout> | undefined>>({})
  const longPressFired = useRef<Record<number, boolean>>({})

  const startPress = (slot: number): void => {
    longPressFired.current[slot] = false
    setPressed(slot)
    timers.current[slot] = setTimeout(() => {
      longPressFired.current[slot] = true
      setPressed(null)
      onSave(slot)
    }, LONG_PRESS_MS)
  }

  const endPress = (slot: number, fireTap: boolean): void => {
    const timer = timers.current[slot]
    if (timer) {
      clearTimeout(timer)
      timers.current[slot] = undefined
    }
    setPressed((p) => (p === slot ? null : p))
    if (fireTap && !longPressFired.current[slot]) onRecall(slot)
  }

  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: Math.round(fontPx * 0.3)
      }}
    >
      <div style={{ display: 'flex', gap: ctrlGap, alignItems: 'center' }}>
        {Array.from({ length: SLOTS }, (_, slot) => {
          const station = favorites[slot] ?? null
          const isActive = station != null && currentStation?.id === station.id
          const label = station ? station.label.trim() || station.channel : String(slot + 1)
          return (
            <button
              key={slot}
              onPointerDown={() => startPress(slot)}
              onPointerUp={() => endPress(slot, true)}
              onPointerLeave={() => endPress(slot, false)}
              onPointerCancel={() => endPress(slot, false)}
              onPointerEnter={(e: React.PointerEvent<HTMLButtonElement>) => {
                if (e.pointerType === 'mouse') setHover(slot)
              }}
              onMouseLeave={() => setHover((h) => (h === slot ? null : h))}
              aria-pressed={isActive}
              aria-label={
                station != null
                  ? `Preset ${slot + 1}: ${station.label.trim() || station.channel}.${isActive ? ' Now playing.' : ' Hold to overwrite.'}`
                  : `Preset ${slot + 1}: empty. Hold to save the current station.`
              }
              style={{
                ...circleBtnStyle(size, {
                  pressed: pressed === slot,
                  hovered: hover === slot,
                  focused: isActive,
                  ringColor
                }),
                position: 'relative',
                fontSize: Math.round(fontPx * 0.85),
                fontWeight: 700,
                opacity: station != null ? 1 : 0.45,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                padding: '0 4px',
                backgroundImage: station?.imageUrl ? `url(${station.imageUrl})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center'
              }}
            >
              {!station?.imageUrl && label}
            </button>
          )
        })}
      </div>
      <div style={{ opacity: 0.55, fontSize: Math.round(fontPx * 0.65) }}>
        {favorites.some((f) => f != null) ? (
          <>
            <StarIcon sx={{ fontSize: Math.round(fontPx * 0.7), verticalAlign: 'middle' }} /> tap to
            play, hold to save
          </>
        ) : (
          <>
            <StarBorderIcon sx={{ fontSize: Math.round(fontPx * 0.7), verticalAlign: 'middle' }} />{' '}
            hold a preset to save this station
          </>
        )}
      </div>
    </div>
  )
}
