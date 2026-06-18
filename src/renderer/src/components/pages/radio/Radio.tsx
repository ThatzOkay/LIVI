import { useElementSize, useRadioState } from '../media/hooks'
import { mediaScaleOps } from '../media/utils/mediaScaleOps'
import { RadioControls } from './components'

export const Radio = ({ forceHydrate = true } = {}) => {
  const [rootRef, { w, h }] = useElementSize<HTMLDivElement>()
  const { running, frequencyMhz, error, toggle, step } = useRadioState({ forceHydrate })

  // Scales (base) — same proportions as the Media page
  const { titlePx, pagePad, sectionGap, ctrlSize, ctrlGap } = mediaScaleOps({ w, h })

  const isTinyHeight = h > 0 && h <= 320
  const pagePadClamped = isTinyHeight ? Math.min(pagePad, 10) : pagePad

  const freqPx = Math.round(titlePx * 2.4)
  const iconPx = Math.round(ctrlSize * 0.46)
  const iconMainPx = Math.round(ctrlSize * 0.52)

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
        <div style={{ opacity: 0.7, fontSize: Math.round(titlePx * 0.4), letterSpacing: 2 }}>
          FM RADIO
        </div>

        <div
          style={{
            fontSize: freqPx,
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: 0.5
          }}
        >
          {frequencyMhz.toFixed(1)}
          <span style={{ fontSize: Math.round(freqPx * 0.32), opacity: 0.7, marginLeft: 8 }}>
            MHz
          </span>
        </div>

        <div style={{ opacity: 0.6, fontSize: Math.round(titlePx * 0.36) }}>
          {error ? error : running ? 'Playing' : 'Stopped'}
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
        <RadioControls
          ctrlGap={ctrlGap}
          ctrlSize={ctrlSize}
          running={running}
          onFastBack={() => step(-1, true)}
          onStepBack={() => step(-1, false)}
          onTogglePlay={toggle}
          onStepForward={() => step(1, false)}
          onFastForward={() => step(1, true)}
          iconPx={iconPx}
          iconMainPx={iconMainPx}
        />
      </div>
    </div>
  )
}
