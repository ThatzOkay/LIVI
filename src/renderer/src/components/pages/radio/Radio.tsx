import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import { useElementSize, useRadioState } from '../media/hooks'
import { mediaScaleOps } from '../media/utils/mediaScaleOps'
import { DabPanel, FmPanel } from './components'

export const Radio = ({ forceHydrate = true } = {}) => {
  const [rootRef, { w, h }] = useElementSize<HTMLDivElement>()
  const {
    running,
    frequencyMhz,
    mode,
    station,
    favorites,
    error,
    toggle,
    step,
    switchMode,
    setFavorite,
    recallFavorite,
    dab,
    scanDabStations,
    selectDabStation,
    stopDab,
    setDabFavorite,
    recallDabFavorite
  } = useRadioState({ forceHydrate })

  // Scales (base) — same proportions as the Media page
  const { titlePx, pagePad, sectionGap, ctrlSize, ctrlGap } = mediaScaleOps({ w, h })

  const isTinyHeight = h > 0 && h <= 320
  const pagePadClamped = isTinyHeight ? Math.min(pagePad, 10) : pagePad

  const freqPx = Math.round(titlePx * 2.4)
  const iconPx = Math.round(ctrlSize * 0.46)
  const iconMainPx = Math.round(ctrlSize * 0.52)
  const favSize = Math.round(ctrlSize * 0.7)
  const favFontPx = Math.round(favSize * 0.32)

  const tabs = (
    <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
      <Tabs
        value={mode === 'dab' ? 'dab' : 'fm'}
        onChange={(_e, newMode) => switchMode(newMode)}
        centered
      >
        <Tab label="DAB" value="dab" />
        <Tab label="FM" value="fm" />
      </Tabs>
    </div>
  )

  return (
    <div
      id="radio-root"
      ref={rootRef}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        padding: pagePadClamped,
        boxSizing: 'border-box',
        overflow: 'hidden'
      }}
    >
      {mode === 'dab' ? (
        <DabPanel
          tabs={tabs}
          titlePx={titlePx}
          sectionGap={sectionGap}
          isTinyHeight={isTinyHeight}
          ctrlGap={ctrlGap}
          ctrlSize={ctrlSize}
          iconMainPx={iconMainPx}
          favSize={favSize}
          favFontPx={favFontPx}
          dab={dab}
          error={error}
          onScan={scanDabStations}
          onSelectStation={selectDabStation}
          onStop={stopDab}
          onRecallFavorite={recallDabFavorite}
          onSaveFavorite={setDabFavorite}
        />
      ) : (
        <FmPanel
          tabs={tabs}
          titlePx={titlePx}
          freqPx={freqPx}
          sectionGap={sectionGap}
          isTinyHeight={isTinyHeight}
          frequencyMhz={frequencyMhz}
          station={station}
          running={running}
          error={error}
          ctrlGap={ctrlGap}
          ctrlSize={ctrlSize}
          iconPx={iconPx}
          iconMainPx={iconMainPx}
          favSize={favSize}
          favFontPx={favFontPx}
          favorites={favorites}
          onFastBack={() => step(-1, true)}
          onStepBack={() => step(-1, false)}
          onTogglePlay={toggle}
          onStepForward={() => step(1, false)}
          onFastForward={() => step(1, true)}
          onRecall={recallFavorite}
          onSave={setFavorite}
        />
      )}
    </div>
  )
}
