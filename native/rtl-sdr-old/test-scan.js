const rtl = require('./index');
const { FMDemodulator, Decimator, DeEmphasis } = require('./index');

const freqs = ['98.2', '101.2', '104.0', '105.3', '107.3'];
let current = 0;

const demod    = new FMDemodulator();
const decimator = new Decimator(2048000, 44100);
const deemph   = new DeEmphasis(44100);

rtl.open(0);
rtl.setSampleRate(2048000);
rtl.setGain(197);
rtl.setFrequency(freqs[0]);
console.error('tuned to', freqs[0]);

setInterval(() => {
    current = (current + 1) % freqs.length;
    rtl.setFrequency(freqs[current]);
    console.error('tuned to', freqs[current]);
}, 5000);

rtl.readAsync((buf) => {
    const audio = deemph.process(decimator.decimate(demod.demodulate(buf)));
    const pcm = Buffer.alloc(audio.length * 2);
    for (let i = 0; i < audio.length; i++) {
        const s = Math.max(-1, Math.min(1, audio[i]));
        pcm.writeInt16LE(Math.round(s * 32767), i * 2);
    }
    process.stdout.write(pcm);
});
