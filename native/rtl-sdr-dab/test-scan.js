// Quick test: node test-scan.js [dwellMs]
const { DabRadio } = require('.')

const radio = new DabRadio()
const dwellMs = Number(process.argv[2]) || 3000

radio.on('scanProgress', ({ channel, frequencyHz }) => {
  console.error(`[scan] tuning ${channel} (${(frequencyHz / 1e6).toFixed(3)} MHz)...`)
})

radio.on('stationFound', (station) => {
  console.error(`[found] ${station.channel} id=${station.id} "${station.label}"`)
})

radio.on('scanComplete', (stations) => {
  console.error(`[scan] done, ${stations.length} station(s) found:`)
  for (const s of stations) {
    console.error(`  ${s.channel.padEnd(4)} id=${s.id} "${s.label}"`)
  }
})

radio
  .scanStations({ dwellMs })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[scan] failed:', err)
    process.exit(1)
  })

process.on('SIGINT', () => {
  radio.stop()
  process.exit(0)
})
