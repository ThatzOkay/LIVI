import RestartAltOutlinedIcon from '@mui/icons-material/RestartAltOutlined'
import { Box, IconButton, Slider, Typography } from '@mui/material'
import { useEffect, useState } from 'react'

type Props = {
  label: string
  value: number
  min: number
  max: number
  step?: number
  defaultValue?: number
  swatch?: string
  onChange?: (v: number) => void
  onCommit: (v: number) => void
}

// Slider with a local draft while dragging, saved once on release.
export function CalibrationSlider({
  label,
  value,
  min,
  max,
  step = 0.01,
  defaultValue = 1,
  swatch,
  onChange,
  onCommit
}: Props) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  const reset = () => {
    setDraft(defaultValue)
    onChange?.(defaultValue)
    onCommit(defaultValue)
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          {swatch && (
            <Box
              sx={{
                width: 12,
                height: 12,
                borderRadius: 0.5,
                flex: '0 0 auto',
                backgroundColor: swatch
              }}
            />
          )}
          <Typography variant="body2" color="text.secondary">
            {label} {draft.toFixed(2)}
          </Typography>
        </Box>
        <IconButton size="small" disabled={draft === defaultValue} onClick={reset} sx={{ p: 0.25 }}>
          <RestartAltOutlinedIcon fontSize="small" />
        </IconButton>
      </Box>
      <Slider
        size="small"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(_, v) => {
          setDraft(v as number)
          onChange?.(v as number)
        }}
        onChangeCommitted={(_, v) => onCommit(v as number)}
        sx={{ width: 'calc(100% - 48px)', ml: 2, mr: 2, minWidth: 0 }}
      />
    </Box>
  )
}
