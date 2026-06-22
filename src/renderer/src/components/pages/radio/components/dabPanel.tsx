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
  isSelecting: boolean
  titlePx: number
  ringColor: string
  onSelect: () => void
}

const StationTile = ({
  station: s,
  isActive,
  isSelecting,
  titlePx,
  ringColor,
  onSelect
}: StationTileProps) => {
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
      aria-busy={isSelecting}
      aria-label={`${s.label.trim() || s.channel}, channel ${s.channel}${isActive ? ', now playing' : ''}${isSelecting ? ', tuning…' : ''}`}
      style={{
        position: 'relative',
        border: 'none',
        borderRadius: 14,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'flex-end',
        // Plain color fallback, visible while the <img> below loads (or if
        // there's no image at all) — never a CSS background-image here, see
        // the <img> below for why.
        backgroundColor: hasImage
          ? '#000'
          : hover || pressed
            ? 'rgba(255,255,255,0.14)'
            : 'rgba(255,255,255,0.07)',
        color: hasImage ? '#fff' : 'inherit',
        cursor: 'pointer',
        overflow: 'hidden',
        padding: '6px 8px',
        opacity: isSelecting ? 0.6 : 1,
        boxShadow: isActive ? `0 0 0 2px ${ringColor}` : '0 0 0 1px rgba(255,255,255,0.08)',
        transform: pressed ? 'scale(0.96)' : 'scale(1)',
        transition:
          'transform 110ms ease, box-shadow 150ms ease, background-color 150ms ease, opacity 150ms ease'
      }}
    >
      {/* A real <img>, not a CSS background-image — using `background` (the
          shorthand) here previously meant any re-render that changed its
          value (e.g. hover toggling the no-image fallback color) silently
          reset backgroundSize/backgroundPosition to their defaults, since
          React's diff skips re-applying sibling properties whose value
          didn't itself change. An <img> has no such shorthand to step on. */}
      {hasImage && (
        <img
          src={s.imageUrl}
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            zIndex: 0
          }}
        />
      )}
      {hasImage && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            // Pure gradient, no url() to protect — safe as a shorthand since
            // there's no sibling backgroundSize/backgroundPosition to lose.
            background:
              'linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.25) 60%, rgba(0,0,0,0) 100%)',
            zIndex: 1
          }}
        />
      )}
      {isSelecting && (
        <CircularProgress
          size={Math.round(titlePx * 0.5)}
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            marginTop: Math.round(titlePx * -0.25),
            marginLeft: Math.round(titlePx * -0.25),
            color: 'inherit',
            zIndex: 3
          }}
        />
      )}
      {isActive && !isSelecting && (
        <span
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 7,
            height: 7,
            borderRadius: '50%',
            backgroundColor: ringColor,
            boxShadow: `0 0 4px ${ringColor}`,
            zIndex: 3
          }}
        />
      )}
      <span
        style={{
          position: 'relative',
          zIndex: 2,
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
          position: 'relative',
          zIndex: 2,
          fontSize: Math.round(titlePx * 0.2),
          opacity: 0.75,
          marginTop: 2,
          padding: '1px 6px',
          borderRadius: 999,
          backgroundColor: hasImage ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.12)'
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

  const {
    scanning,
    scanningChannel,
    stations,
    currentStation,
    selectingStation,
    programmeInfo,
    dynamicLabel,
    running,
    favorites
  } = dab

  const statusText = error
    ? error
    : scanning
      ? `Scanning ${scanningChannel ?? ''}…`
      : selectingStation
        ? `Tuning to ${selectingStation.label.trim() || selectingStation.channel}…`
        : running
          ? programmeInfo
            ? `Playing · ${programmeInfo.codec} · ${programmeInfo.bitrateKbps} kbps`
            : 'Playing'
          : 'Stopped'
  const showStatusSpinner = !error && (scanning || !!selectingStation)

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

        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            boxSizing: 'border-box',
            padding: '0 1rem'
          }}
        >
          <div
            data-testid="dab-artwork"
            style={{
              width: Math.round(titlePx * 2.2),
              height: Math.round(titlePx * 2.2),
              borderRadius: 8,
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(255,255,255,0.07)'
            }}
          >
            {currentStation?.imageUrl ? (
              <img
                src={currentStation.imageUrl}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <RadioIcon sx={{ fontSize: Math.round(titlePx * 0.9), opacity: 0.3 }} />
            )}
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 2
            }}
          >
            <div style={{ opacity: 0.7, fontSize: Math.round(titlePx * 0.4), letterSpacing: 2 }}>
              {currentStation?.label?.trim() || 'DAB RADIO'}
            </div>
            {running && dynamicLabel && (
              <div
                style={{
                  height: Math.round(titlePx * 0.45),
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                <div
                  style={{
                    opacity: 0.55,
                    fontSize: Math.round(titlePx * 0.32),
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {dynamicLabel}
                </div>
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            opacity: 0.6,
            fontSize: Math.round(titlePx * 0.36)
          }}
        >
          {showStatusSpinner && (
            <CircularProgress size={Math.round(titlePx * 0.32)} color="inherit" />
          )}
          {statusText}
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

        {stations.length === 0 ? (
          <div
            style={{
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
          <div
            style={{
              flex: 1,
              minHeight: 0,
              width: '100%',
              display: 'grid',
              gridAutoFlow: 'column',
              gridTemplateRows: `repeat(${isTinyHeight ? 2 : 3}, 1fr)`,
              gridAutoColumns: `minmax(${Math.round(titlePx * 3.4)}px, 1fr)`,
              gap: Math.round(sectionGap * 0.7),
              padding: 8,
              overflowX: 'auto',
              overflowY: 'hidden'
            }}
          >
            {stations.map((s) => (
              <StationTile
                key={`${s.channel}:${s.id}`}
                station={s}
                isActive={currentStation?.id === s.id && currentStation.channel === s.channel}
                isSelecting={
                  selectingStation?.id === s.id && selectingStation?.channel === s.channel
                }
                titlePx={titlePx}
                ringColor={ringColor}
                onSelect={() => onSelectStation(s)}
              />
            ))}
          </div>
        )}
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
