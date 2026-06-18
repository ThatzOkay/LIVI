jest.mock('../Radio', () => ({
  __esModule: true,
  Radio: 'RadioMock'
}))

describe('radio index', () => {
  test('re-exports Radio module', () => {
    const mod = require('../index')

    expect(mod.Radio).toBe('RadioMock')
  })
})
