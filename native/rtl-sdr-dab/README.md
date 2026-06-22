# rtl-sdr-dab

DAB/DAB+ native Node.js addon using the welle.io backend.

## Dependencies

```bash
# Arch / CachyOS
sudo pacman -S fftw faad2 mpg123 librtlsdr
```

## Setup

```bash
# Add welle.io submodule (first time)
git submodule add https://github.com/AlbrechtL/welle.io.git vendor/welle.io
cd vendor/welle.io && git checkout v2.6 && cd ../..

# Or if cloning this repo
git submodule update --init --recursive

# Install JS deps and build
npm install
npm run build
```

## Test

```bash
# Pipe audio to aplay (Netherlands 5C multiplex)
node test.js | aplay -r 48000 -f S16_LE -c 2
```

## Usage

```js
const { DabRadio } = require('rtl-sdr-dab')

const radio = new DabRadio()

radio.on('service', (svc) => {
  console.log(svc.id, svc.label)
  radio.selectService(svc.id)
})

radio.on('audio', ({ buffer, samplerate, stereo }) => {
  // buffer is Int16Array PCM
})

radio.on('metadata', ({ type, value }) => {
  // type: 'dls' (scrolling text)
})

radio.start(174928000) // 5C Netherlands
```

## Frequencies (Netherlands)

| Block | Frequency   | Ensemble         |
|-------|-------------|------------------|
| 5C    | 174.928 MHz | NPO/publiek      |
| 7A    | 182.640 MHz | Commercieel      |
| 7B    | 183.648 MHz | Commercieel      |
| 11C   | 220.352 MHz | Commercieel      |
