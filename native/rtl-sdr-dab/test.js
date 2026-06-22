// Quick test: node test.js | aplay -r 48000 -f S16_LE -c 2
const { DabRadio } = require('.')

const radio = new DabRadio()
const services = new Map()
let selected = false

radio.on('service', (svc) => {
  console.error(`[service] ${svc.id} "${svc.label}"`)
  services.set(svc.id, svc)

  // auto-select first service found
  if (!selected) {
    selected = true
    setTimeout(() => {
      console.error(`[selecting] ${svc.label}`)
      radio.selectService(svc.id)
    }, 2000)
  }
})

radio.on('metadata', ({ type, value }) => {
  console.error(`[${type}] ${value}`)
})

radio.on('audio', ({ buffer, samplerate, stereo }) => {
  process.stdout.write(Buffer.from(buffer.buffer))
})

// 174.928 MHz = DAB block 5C (Netherlands main multiplex)
radio.start(174928000)
console.error('[dab] started, waiting for services...')

process.on('SIGINT', () => {
  radio.stop()
  process.exit(0)
})
