import { fireEvent, render, screen } from '@testing-library/react'
import { Radio } from '../Radio'

const mockToggle = vi.fn()
const mockStep = vi.fn()
const mockSetFavorite = vi.fn()
const mockRecallFavorite = vi.fn()
const mockSwitchMode = vi.fn()
const mockScanStations = vi.fn()
const mockSelectStation = vi.fn()
const mockStopDab = vi.fn()
const mockSetDabFavorite = vi.fn()
const mockRecallDabFavorite = vi.fn()
const NO_FAVORITES = [null, null, null, null, null]
const NO_DAB_FAVORITES = [null, null, null, null, null]

type DabStationRef = {
  id: number
  label: string
  channel: string
  frequencyHz: number
  imageUrl?: string
}

let mockState: {
  mode?: 'fm' | 'dab'
  running: boolean
  frequencyMhz: number
  error: string | null
  station?: { id: number; genre: string; name?: string; text?: string } | null
  favorites?: (number | null)[]
}

let mockDab: {
  running: boolean
  scanning: boolean
  scanningChannel: string | null
  stations: DabStationRef[]
  currentStation: DabStationRef | null
  favorites: (DabStationRef | null)[]
}

vi.mock('../../media/hooks', () => ({
  useElementSize: () => [{ current: null }, { w: 800, h: 480 }],
  useRadioState: () => ({
    station: null,
    favorites: NO_FAVORITES,
    ...mockState,
    dab: mockDab,
    toggle: mockToggle,
    step: mockStep,
    start: vi.fn(),
    stop: vi.fn(),
    setFrequency: vi.fn(),
    setMode: vi.fn(),
    switchMode: mockSwitchMode,
    setFavorite: mockSetFavorite,
    recallFavorite: mockRecallFavorite,
    scanDabStations: mockScanStations,
    selectDabStation: mockSelectStation,
    stopDab: mockStopDab,
    setDabFavorite: mockSetDabFavorite,
    recallDabFavorite: mockRecallDabFavorite
  })
}))

describe('Radio component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState = { mode: 'fm', running: false, frequencyMhz: 100.0, error: null }
    mockDab = {
      running: false,
      scanning: false,
      scanningChannel: null,
      stations: [],
      currentStation: null,
      favorites: NO_DAB_FAVORITES
    }
  })

  test('renders the current frequency and stopped status', () => {
    render(<Radio />)

    expect(screen.getByText('100.00')).toBeInTheDocument()
    expect(screen.getByText('Stopped')).toBeInTheDocument()
  })

  test('renders playing status and rounds the frequency to two decimals', () => {
    mockState = { mode: 'fm', running: true, frequencyMhz: 101.3, error: null }
    render(<Radio />)

    expect(screen.getByText('101.30')).toBeInTheDocument()
    expect(screen.getByText('Playing')).toBeInTheDocument()
  })

  test('shows the error message instead of the status when present', () => {
    mockState = { mode: 'fm', running: false, frequencyMhz: 100.0, error: 'no device' }
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

  test('switching to the DAB tab calls switchMode', () => {
    render(<Radio />)

    fireEvent.click(screen.getByRole('tab', { name: 'DAB' }))

    expect(mockSwitchMode).toHaveBeenCalledWith('dab')
  })

  describe('DAB tab', () => {
    beforeEach(() => {
      mockState = { mode: 'dab', running: false, frequencyMhz: 100.0, error: null }
    })

    test('renders the scan button and wires it to scanDabStations', () => {
      render(<Radio />)

      fireEvent.click(screen.getByText('Scan for stations'))

      expect(mockScanStations).toHaveBeenCalledTimes(1)
    })

    test('shows the scanning status with the current channel', () => {
      mockDab = { ...mockDab, scanning: true, scanningChannel: '7C' }
      render(<Radio />)

      expect(screen.getByText('Scanning 7C…')).toBeInTheDocument()
    })

    test('renders found stations and wires selecting one to selectDabStation', () => {
      const station: DabStationRef = {
        id: 4242,
        label: 'Test FM',
        channel: '5A',
        frequencyHz: 174928000
      }
      mockDab = { ...mockDab, stations: [station] }
      render(<Radio />)

      fireEvent.click(screen.getByLabelText('Test FM, channel 5A'))

      expect(mockSelectStation).toHaveBeenCalledWith(station)
    })

    test('builds a grid tile for every station found, regardless of count', () => {
      const stations: DabStationRef[] = [
        { id: 1, label: 'Radio One', channel: '5A', frequencyHz: 174928000 },
        { id: 2, label: 'Radio Two', channel: '5C', frequencyHz: 176640000 },
        { id: 3, label: 'Radio Three', channel: '7B', frequencyHz: 195936000 },
        { id: 4, label: 'Radio Four', channel: '9D', frequencyHz: 211648000 },
        { id: 5, label: 'Radio Five', channel: '11A', frequencyHz: 216928000 }
      ]
      mockDab = { ...mockDab, stations }
      render(<Radio />)

      for (const s of stations) {
        const tile = screen.getByLabelText(`${s.label}, channel ${s.channel}`)
        fireEvent.click(tile)
        expect(mockSelectStation).toHaveBeenCalledWith(s)
      }
      expect(mockSelectStation).toHaveBeenCalledTimes(stations.length)
    })

    test('shows a cached slideshow image for the current station when available', () => {
      mockDab = {
        ...mockDab,
        running: true,
        currentStation: {
          id: 1,
          label: 'X',
          channel: '5A',
          frequencyHz: 174928000,
          imageUrl: 'data:image/jpeg;base64,abc'
        }
      }
      render(<Radio />)

      const artwork = screen.getByTestId('dab-artwork')
      const img = artwork.querySelector('img') as HTMLImageElement
      expect(img.src).toBe('data:image/jpeg;base64,abc')
    })

    test('reserves the same artwork space (no image, just a placeholder) when none is cached', () => {
      mockDab = {
        ...mockDab,
        running: true,
        currentStation: { id: 1, label: 'X', channel: '5A', frequencyHz: 174928000 }
      }
      render(<Radio />)

      const artwork = screen.getByTestId('dab-artwork')
      expect(artwork.querySelector('img')).not.toBeInTheDocument()
    })

    test('renders a cached thumbnail inside a station grid tile when available', () => {
      const station: DabStationRef = {
        id: 4242,
        label: 'Test FM',
        channel: '5A',
        frequencyHz: 174928000,
        imageUrl: 'data:image/png;base64,xyz'
      }
      mockDab = { ...mockDab, stations: [station] }
      render(<Radio />)

      const tile = screen.getByLabelText('Test FM, channel 5A')
      const img = tile.querySelector('img') as HTMLImageElement
      expect(img.src).toBe('data:image/png;base64,xyz')
    })

    test('renders a cached thumbnail as the favorite slot background when available', () => {
      const favorites: (DabStationRef | null)[] = [
        {
          id: 7,
          label: 'Fave One',
          channel: '5A',
          frequencyHz: 174928000,
          imageUrl: 'data:image/jpeg;base64,fav'
        },
        null,
        null,
        null,
        null
      ]
      mockDab = { ...mockDab, favorites }
      render(<Radio />)

      const slot = screen.getByLabelText(/Preset 1: Fave One/)
      expect(slot.style.backgroundImage).toContain('data:image/jpeg;base64,fav')
    })

    test('wires the stop button to stopDab', () => {
      mockDab = {
        ...mockDab,
        running: true,
        currentStation: { id: 1, label: 'X', channel: '5A', frequencyHz: 174928000 }
      }
      render(<Radio />)

      fireEvent.click(screen.getByLabelText('Stop'))

      expect(mockStopDab).toHaveBeenCalledTimes(1)
    })
  })
})
