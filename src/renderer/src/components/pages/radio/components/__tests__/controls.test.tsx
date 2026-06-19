import { fireEvent, render, screen } from '@testing-library/react'
import { RadioControls } from '../controls'

const circleBtnStyleMock = vi.fn((size: number, state: unknown) => ({
  width: size,
  height: size,
  border: 'none',
  ...(state as object)
}))

vi.mock('../../../media/styles', () => ({
  circleBtnStyle: (...args: Parameters<typeof circleBtnStyleMock>) => circleBtnStyleMock(...args)
}))

vi.mock('@mui/material/styles', () => ({
  useTheme: () => ({
    palette: {
      primary: {
        main: '#00aaff'
      }
    }
  })
}))

vi.mock('@mui/icons-material/PlayArrow', () => ({
  __esModule: true,
  default: () => <span data-testid="play-icon" />
}))
vi.mock('@mui/icons-material/Stop', () => ({
  __esModule: true,
  default: () => <span data-testid="stop-icon" />
}))
vi.mock('@mui/icons-material/FastRewind', () => ({
  __esModule: true,
  default: () => <span data-testid="fast-back-icon" />
}))
vi.mock('@mui/icons-material/FastForward', () => ({
  __esModule: true,
  default: () => <span data-testid="fast-forward-icon" />
}))
vi.mock('@mui/icons-material/ChevronLeft', () => ({
  __esModule: true,
  default: () => <span data-testid="step-back-icon" />
}))
vi.mock('@mui/icons-material/ChevronRight', () => ({
  __esModule: true,
  default: () => <span data-testid="step-forward-icon" />
}))

describe('RadioControls', () => {
  const onFastBack = vi.fn()
  const onStepBack = vi.fn()
  const onTogglePlay = vi.fn()
  const onStepForward = vi.fn()
  const onFastForward = vi.fn()

  const renderControls = (overrides?: Partial<React.ComponentProps<typeof RadioControls>>) =>
    render(
      <RadioControls
        ctrlGap={12}
        ctrlSize={40}
        running={false}
        onFastBack={onFastBack}
        onStepBack={onStepBack}
        onTogglePlay={onTogglePlay}
        onStepForward={onStepForward}
        onFastForward={onFastForward}
        iconPx={18}
        iconMainPx={24}
        {...overrides}
      />
    )

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('renders all five controls', () => {
    renderControls()

    expect(screen.getByLabelText('Fast skip back')).toBeInTheDocument()
    expect(screen.getByLabelText('Step skip back')).toBeInTheDocument()
    expect(screen.getByLabelText('Start/Stop')).toBeInTheDocument()
    expect(screen.getByLabelText('Step skip forward')).toBeInTheDocument()
    expect(screen.getByLabelText('Fast skip forward')).toBeInTheDocument()
  })

  test('shows play icon when stopped and stop icon when running', () => {
    const { rerender } = renderControls({ running: false })
    expect(screen.getByTestId('play-icon')).toBeInTheDocument()

    rerender(
      <RadioControls
        ctrlGap={12}
        ctrlSize={40}
        running={true}
        onFastBack={onFastBack}
        onStepBack={onStepBack}
        onTogglePlay={onTogglePlay}
        onStepForward={onStepForward}
        onFastForward={onFastForward}
        iconPx={18}
        iconMainPx={24}
      />
    )
    expect(screen.getByTestId('stop-icon')).toBeInTheDocument()
    expect(screen.getByLabelText('Start/Stop')).toHaveAttribute('aria-pressed', 'true')
  })

  test('calls handlers on click', () => {
    renderControls()

    fireEvent.click(screen.getByLabelText('Fast skip back'))
    fireEvent.click(screen.getByLabelText('Step skip back'))
    fireEvent.click(screen.getByLabelText('Start/Stop'))
    fireEvent.click(screen.getByLabelText('Step skip forward'))
    fireEvent.click(screen.getByLabelText('Fast skip forward'))

    expect(onFastBack).toHaveBeenCalledTimes(1)
    expect(onStepBack).toHaveBeenCalledTimes(1)
    expect(onTogglePlay).toHaveBeenCalledTimes(1)
    expect(onStepForward).toHaveBeenCalledTimes(1)
    expect(onFastForward).toHaveBeenCalledTimes(1)
  })

  test('blurs button on mouse up', () => {
    renderControls()
    const btn = screen.getByLabelText('Fast skip back')
    const blurSpy = vi.spyOn(btn, 'blur')

    fireEvent.mouseUp(btn)

    expect(blurSpy).toHaveBeenCalledTimes(1)
  })
})
