import RadioIcon from '@mui/icons-material/Radio'
import StopIcon from '@mui/icons-material/Stop'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import { useTheme } from '@mui/material/styles'
import type { ReactNode } from 'react'
import { useState } from 'react'
import type { DabHookState, DabStationRef } from '../../media/hooks'
import { circleBtnStyle } from '../../media/styles'
import { DabFavoritesRow } from './dabFavorites'

type StationTileProps = {
  station: DabStationRef & { imageUrl?: string }
  isActive: boolean
  titlePx: number
  ringColor: string
  onSelect: () => void
}

const StationTile = ({ station: s, isActive, titlePx, ringColor, onSelect }: StationTileProps) => {
  const [hover, setHover] = useState(false)
  const [pressed, setPressed] = useState(false)
  const hasImage = !!s.imageUrl

  return (
    <button
      onClick={onSelect}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => {
        setPressed(false)
        setHover(false)
      }}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') setHover(true)
      }}
      aria-pressed={isActive}
      aria-label={`${s.label.trim() || s.channel}, channel ${s.channel}${isActive ? ', now playing' : ''}`}
      style={{
        position: 'relative',
        border: 'none',
        borderRadius: 14,
        aspectRatio: '1.6',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'flex-end',
        background: hasImage
          ? `linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.25) 60%, rgba(0,0,0,0) 100%), url(${s.imageUrl})`
          : hover || pressed
            ? 'rgba(255,255,255,0.14)'
            : 'rgba(255,255,255,0.07)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        color: hasImage ? '#fff' : 'inherit',
        cursor: 'pointer',
        overflow: 'hidden',
        padding: '6px 8px',
        boxShadow: isActive ? `0 0 0 2px ${ringColor}` : '0 0 0 1px rgba(255,255,255,0.08)',
        transform: pressed ? 'scale(0.96)' : 'scale(1)',
        transition: 'transform 110ms ease, box-shadow 150ms ease, background 150ms ease'
      }}
    >
      {isActive && (
        <span
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: ringColor,
            boxShadow: `0 0 4px ${ringColor}`
          }}
        />
      )}
      <span
        style={{
          fontSize: Math.round(titlePx * 0.3),
          fontWeight: 700,
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {s.label.trim() || s.channel}
      </span>
      <span
        style={{
          fontSize: Math.round(titlePx * 0.2),
          opacity: 0.75,
          marginTop: 2,
          padding: '1px 6px',
          borderRadius: 999,
          background: hasImage ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.12)'
        }}
      >
        {s.channel}
      </span>
    </button>
  )
}

type DabPanelProps = {
  tabs: ReactNode
  titlePx: number
  sectionGap: number
  isTinyHeight: boolean
  ctrlGap: number
  ctrlSize: number
  iconMainPx: number
  favSize: number
  favFontPx: number
  dab: DabHookState
  error: string | null
  onScan: () => void
  onSelectStation: (station: DabStationRef) => void
  onStop: () => void
  onRecallFavorite: (slot: number) => void
  onSaveFavorite: (slot: number) => void
}

export const DabPanel = ({
  tabs,
  titlePx,
  sectionGap,
  isTinyHeight,
  ctrlGap,
  ctrlSize,
  iconMainPx,
  favSize,
  favFontPx,
  dab,
  error,
  onScan,
  onSelectStation,
  onStop,
  onRecallFavorite,
  onSaveFavorite
}: DabPanelProps) => {
  const theme = useTheme()
  const ringColor = theme.palette.primary.main
  const [hover, setHover] = useState(false)
  const [focus, setFocus] = useState(false)

  const { scanning, scanningChannel, stations, currentStation, running, favorites } = dab

  return (
    <>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: sectionGap
        }}
      >
        {tabs}

        {currentStation?.imageUrl && (
          <img
            src={currentStation.imageUrl}
            alt=""
            style={{
              width: Math.round(titlePx * 2.2),
              height: Math.round(titlePx * 2.2),
              objectFit: 'cover',
              borderRadius: 8
            }}
          />
        )}

        <div style={{ opacity: 0.7, fontSize: Math.round(titlePx * 0.4), letterSpacing: 2 }}>
          {currentStation?.label?.trim() || 'DAB RADIO'}
        </div>

        <div style={{ opacity: 0.6, fontSize: Math.round(titlePx * 0.36) }}>
          {error
            ? error
            : scanning
              ? `Scanning ${scanningChannel ?? ''}…`
              : running
                ? 'Playing'
                : 'Stopped'}
        </div>

        <Button
          variant="outlined"
          size="small"
          disabled={scanning}
          onClick={onScan}
          startIcon={scanning ? <CircularProgress size={14} color="inherit" /> : <RadioIcon />}
        >
          {scanning ? 'Scanning…' : stations.length > 0 ? 'Scan again' : 'Scan for stations'}
        </Button>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: Math.round(sectionGap * 0.7),
            width: '100%',
            maxWidth: 480,
            maxHeight: '40%',
            padding: 2,
            overflowY: 'auto'
          }}
        >
          {stations.length === 0 ? (
            <div
              style={{
                gridColumn: '1 / -1',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                opacity: 0.5,
                fontSize: Math.round(titlePx * 0.3),
                textAlign: 'center',
                padding: '1rem 0'
              }}
            >
              <RadioIcon sx={{ fontSize: Math.round(titlePx * 0.7) }} />
              {scanning ? 'Listening for ensembles…' : 'No stations yet — tap Scan to search'}
            </div>
          ) : (
            stations.map((s) => (
              <StationTile
                key={`${s.channel}:${s.id}`}
                station={s}
                isActive={currentStation?.id === s.id && currentStation.channel === s.channel}
                titlePx={titlePx}
                ringColor={ringColor}
                onSelect={() => onSelectStation(s)}
              />
            ))
          )}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridAutoRows: 'auto',
          rowGap: isTinyHeight ? 8 : 10,
          paddingBottom: isTinyHeight ? 6 : '1rem',
          width: '100%',
          boxSizing: 'border-box'
        }}
      >
        <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
          <button
            onMouseUp={(e) => (e.currentTarget as HTMLButtonElement).blur()}
            onPointerEnter={(e) => {
              if (e.pointerType === 'mouse') setHover(true)
            }}
            onPointerLeave={() => setHover(false)}
            onFocus={() => setFocus(true)}
            onBlur={() => setFocus(false)}
            onClick={onStop}
            disabled={!running}
            aria-label="Stop"
            style={{
              ...circleBtnStyle(Math.round(ctrlSize * 1.1), {
                focused: focus,
                hovered: hover,
                ringColor
              }),
              opacity: running ? 1 : 0.4
            }}
          >
            <StopIcon sx={{ fontSize: iconMainPx, display: 'block', lineHeight: 0 }} />
          </button>
        </div>

        <DabFavoritesRow
          ctrlGap={ctrlGap}
          size={favSize}
          fontPx={favFontPx}
          favorites={favorites}
          currentStation={currentStation}
          onRecall={onRecallFavorite}
          onSave={onSaveFavorite}
        />
      </div>
    </>
  )
}
