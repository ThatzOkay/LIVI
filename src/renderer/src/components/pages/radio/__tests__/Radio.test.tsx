import { fireEvent, render, screen } from '@testing-library/react'
import { Radio } from '../Radio'

const mockToggle = vi.fn()
const mockStep = vi.fn()
const mockSetFavorite = vi.fn()
const mockRecallFavorite = vi.fn()
const NO_FAVORITES = [null, null, null, null, null]
let mockState: {
  running: boolean
  frequencyMhz: number
  error: string | null
  station?: { id: number; genre: string; name?: string; text?: string } | null
  favorites?: (number | null)[]
}

vi.mock('../../media/hooks', () => ({
  useElementSize: () => [{ current: null }, { w: 800, h: 480 }],
  useRadioState: () => ({
    station: null,
    favorites: NO_FAVORITES,
    ...mockState,
    toggle: mockToggle,
    step: mockStep,
    start: vi.fn(),
    stop: vi.fn(),
    setFrequency: vi.fn(),
    setFavorite: mockSetFavorite,
    recallFavorite: mockRecallFavorite
  })
}))

describe('Radio component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState = { running: false, frequencyMhz: 100.0, error: null }
  })

  test('renders the current frequency and stopped status', () => {
    render(<Radio />)

    expect(screen.getByText('100.00')).toBeInTheDocument()
    expect(screen.getByText('Stopped')).toBeInTheDocument()
  })

  test('renders playing status and rounds the frequency to two decimals', () => {
    mockState = { running: true, frequencyMhz: 101.3, error: null }
    render(<Radio />)

    expect(screen.getByText('101.30')).toBeInTheDocument()
    expect(screen.getByText('Playing')).toBeInTheDocument()
  })

  test('shows the error message instead of the status when present', () => {
    mockState = { running: false, frequencyMhz: 100.0, error: 'no device' }
    render(<Radio />)

    expect(screen.getByText('no device')).toBeInTheDocument()
  })

  test('wires the play/stop button to toggle', () => {
    render(<Radio />)

    fireEvent.click(screen.getByLabelText('Start/Stop'))

    expect(mockToggle).toHaveBeenCalledTimes(1)
  })

  test('wires step and fast-skip buttons to step with the right direction/fast flag', () => {
    render(<Radio />)

    fireEvent.click(screen.getByLabelText('Fast skip back'))
    expect(mockStep).toHaveBeenLastCalledWith(-1, true)

    fireEvent.click(screen.getByLabelText('Step skip back'))
    expect(mockStep).toHaveBeenLastCalledWith(-1, false)

    fireEvent.click(screen.getByLabelText('Step skip forward'))
    expect(mockStep).toHaveBeenLastCalledWith(1, false)

    fireEvent.click(screen.getByLabelText('Fast skip forward'))
    expect(mockStep).toHaveBeenLastCalledWith(1, true)
  })
})
