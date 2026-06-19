vi.mock('../Radio', () => ({
  __esModule: true,
  Radio: 'RadioMock'
}))

describe('radio index', () => {
  test('re-exports Radio module', async () => {
    const mod = await import('../index')

    expect(mod.Radio).toBe('RadioMock')
  })
})
