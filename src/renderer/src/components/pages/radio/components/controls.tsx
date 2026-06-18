import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import FastForwardIcon from '@mui/icons-material/FastForward'
import FastRewindIcon from '@mui/icons-material/FastRewind'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import StopIcon from '@mui/icons-material/Stop'
import { useTheme } from '@mui/material/styles'
import type React from 'react'
import { useState } from 'react'
import { circleBtnStyle } from '../../media/styles'

type ButtonKey = 'fastBack' | 'stepBack' | 'play' | 'stepForward' | 'fastForward'

type RadioControlsProps = {
  ctrlGap: number
  ctrlSize: number
  running: boolean
  onFastBack: () => void
  onStepBack: () => void
  onTogglePlay: () => void
  onStepForward: () => void
  onFastForward: () => void
  iconPx: number
  iconMainPx: number
}

export const RadioControls = ({
  ctrlGap,
  ctrlSize,
  running,
  onFastBack,
  onStepBack,
  onTogglePlay,
  onStepForward,
  onFastForward,
  iconPx,
  iconMainPx
}: RadioControlsProps) => {
  const theme = useTheme()
  const ringColor = theme.palette.primary.main

  const [hover, setHover] = useState<Record<ButtonKey, boolean>>({
    fastBack: false,
    stepBack: false,
    play: false,
    stepForward: false,
    fastForward: false
  })
  const [focus, setFocus] = useState<Record<ButtonKey, boolean>>({
    fastBack: false,
    stepBack: false,
    play: false,
    stepForward: false,
    fastForward: false
  })

  const hoverProps = (
    key: ButtonKey
  ): {
    onPointerEnter: (e: React.PointerEvent<HTMLButtonElement>) => void
    onPointerLeave: () => void
  } => ({
    onPointerEnter: (e) => {
      if (e.pointerType === 'mouse') setHover((h) => ({ ...h, [key]: true }))
    },
    onPointerLeave: () => setHover((h) => ({ ...h, [key]: false }))
  })

  const focusProps = (key: ButtonKey) => ({
    onFocus: () => setFocus((f) => ({ ...f, [key]: true })),
    onBlur: () => setFocus((f) => ({ ...f, [key]: false }))
  })

  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        justifyContent: 'center'
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: ctrlGap,
          alignItems: 'center',
          height: Math.round(ctrlSize * 1.1)
        }}
      >
        <button
          onMouseUp={(e) => (e.currentTarget as HTMLButtonElement).blur()}
          {...focusProps('fastBack')}
          {...hoverProps('fastBack')}
          onClick={onFastBack}
          aria-label="Fast skip back"
          style={circleBtnStyle(ctrlSize, {
            focused: focus.fastBack,
            hovered: hover.fastBack,
            ringColor
          })}
        >
          <FastRewindIcon sx={{ fontSize: iconPx, display: 'block', lineHeight: 0 }} />
        </button>

        <button
          onMouseUp={(e) => (e.currentTarget as HTMLButtonElement).blur()}
          {...focusProps('stepBack')}
          {...hoverProps('stepBack')}
          onClick={onStepBack}
          aria-label="Step skip back"
          style={circleBtnStyle(ctrlSize, {
            focused: focus.stepBack,
            hovered: hover.stepBack,
            ringColor
          })}
        >
          <ChevronLeftIcon sx={{ fontSize: iconPx, display: 'block', lineHeight: 0 }} />
        </button>

        <button
          onMouseUp={(e) => (e.currentTarget as HTMLButtonElement).blur()}
          {...focusProps('play')}
          {...hoverProps('play')}
          onClick={onTogglePlay}
          aria-label="Start/Stop"
          aria-pressed={running}
          style={circleBtnStyle(Math.round(ctrlSize * 1.1), {
            focused: focus.play,
            hovered: hover.play,
            ringColor
          })}
        >
          {running ? (
            <StopIcon sx={{ fontSize: iconMainPx, display: 'block', lineHeight: 0 }} />
          ) : (
            <PlayArrowIcon
              sx={{
                fontSize: iconMainPx,
                display: 'block',
                lineHeight: 0,
                transform: 'translateX(1px)'
              }}
            />
          )}
        </button>

        <button
          onMouseUp={(e) => (e.currentTarget as HTMLButtonElement).blur()}
          {...focusProps('stepForward')}
          {...hoverProps('stepForward')}
          onClick={onStepForward}
          aria-label="Step skip forward"
          style={circleBtnStyle(ctrlSize, {
            focused: focus.stepForward,
            hovered: hover.stepForward,
            ringColor
          })}
        >
          <ChevronRightIcon sx={{ fontSize: iconPx, display: 'block', lineHeight: 0 }} />
        </button>

        <button
          onMouseUp={(e) => (e.currentTarget as HTMLButtonElement).blur()}
          {...focusProps('fastForward')}
          {...hoverProps('fastForward')}
          onClick={onFastForward}
          aria-label="Fast skip forward"
          style={circleBtnStyle(ctrlSize, {
            focused: focus.fastForward,
            hovered: hover.fastForward,
            ringColor
          })}
        >
          <FastForwardIcon sx={{ fontSize: iconPx, display: 'block', lineHeight: 0 }} />
        </button>
      </div>
    </div>
  )
}
