import { fireEvent, render, screen } from '@testing-library/react'
import { Radio } from '../Radio'

const mockToggle = jest.fn()
const mockStep = jest.fn()
let mockState: { running: boolean; frequencyMhz: number; error: string | null }

jest.mock('../../media/hooks', () => ({
  useElementSize: () => [{ current: null }, { w: 800, h: 480 }],
  useRadioState: () => ({
    ...mockState,
    toggle: mockToggle,
    step: mockStep,
    start: jest.fn(),
    stop: jest.fn(),
    setFrequency: jest.fn()
  })
}))

describe('Radio component', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockState = { running: false, frequencyMhz: 100.0, error: null }
  })

  test('renders the current frequency and stopped status', () => {
    render(<Radio />)

    expect(screen.getByText('100.0')).toBeInTheDocument()
    expect(screen.getByText('Stopped')).toBeInTheDocument()
  })

  test('renders playing status and rounds the frequency to one decimal', () => {
    mockState = { running: true, frequencyMhz: 101.3, error: null }
    render(<Radio />)

    expect(screen.getByText('101.3')).toBeInTheDocument()
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
