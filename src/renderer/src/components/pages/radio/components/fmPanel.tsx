import type { ReactNode } from 'react'
import type { StationInfo } from '../../media/hooks'
import { RadioControls } from './controls'
import { FavoritesRow } from './favorites'

type FmPanelProps = {
  tabs: ReactNode
  titlePx: number
  freqPx: number
  sectionGap: number
  isTinyHeight: boolean
  frequencyMhz: number
  station: StationInfo | null
  running: boolean
  error: string | null
  ctrlGap: number
  ctrlSize: number
  iconPx: number
  iconMainPx: number
  favSize: number
  favFontPx: number
  favorites: (number | null)[]
  onFastBack: () => void
  onStepBack: () => void
  onTogglePlay: () => void
  onStepForward: () => void
  onFastForward: () => void
  onRecall: (slot: number) => void
  onSave: (slot: number) => void
}

export const FmPanel = ({
  tabs,
  titlePx,
  freqPx,
  sectionGap,
  isTinyHeight,
  frequencyMhz,
  station,
  running,
  error,
  ctrlGap,
  ctrlSize,
  iconPx,
  iconMainPx,
  favSize,
  favFontPx,
  favorites,
  onFastBack,
  onStepBack,
  onTogglePlay,
  onStepForward,
  onFastForward,
  onRecall,
  onSave
}: FmPanelProps) => {
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

        <div style={{ opacity: 0.7, fontSize: Math.round(titlePx * 0.4), letterSpacing: 2 }}>
          {station?.name ? station.name.trim() : 'FM RADIO'}
        </div>

        <div
          style={{
            fontSize: freqPx,
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: 0.5
          }}
        >
          {frequencyMhz.toFixed(2)}
          <span style={{ fontSize: Math.round(freqPx * 0.32), opacity: 0.7, marginLeft: 8 }}>
            MHz
          </span>
        </div>

        <div style={{ opacity: 0.6, fontSize: Math.round(titlePx * 0.36) }}>
          {error ? error : running ? 'Playing' : 'Stopped'}
        </div>

        {station?.text && (
          <div
            style={{
              opacity: 0.55,
              fontSize: Math.round(titlePx * 0.32),
              maxWidth: '80%',
              textAlign: 'center',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {station.text.trim()}
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
        <RadioControls
          ctrlGap={ctrlGap}
          ctrlSize={ctrlSize}
          running={running}
          onFastBack={onFastBack}
          onStepBack={onStepBack}
          onTogglePlay={onTogglePlay}
          onStepForward={onStepForward}
          onFastForward={onFastForward}
          iconPx={iconPx}
          iconMainPx={iconMainPx}
        />

        <FavoritesRow
          ctrlGap={ctrlGap}
          size={favSize}
          fontPx={favFontPx}
          favorites={favorites}
          running={running}
          activeFrequencyMhz={frequencyMhz}
          onRecall={onRecall}
          onSave={onSave}
        />
      </div>
    </>
  )
}
