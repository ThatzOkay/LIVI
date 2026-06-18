const rtl = require('./index');
const { FMDemodulator, Decimator } = require('./index');

const demod = new FMDemodulator();
const decimator = new Decimator(2048000, 44100);

console.log('Devices:', rtl.getDeviceCount());
console.log('Name:', rtl.getDeviceName(0));
console.log('Frequency:', rtl.parseFrequency("101.2"));

rtl.open(0);
rtl.setSampleRate(2048000);
rtl.setFrequency("101.2");
rtl.setGain(400);

rtl.readAsync((buf) => {
    const demodulated = demod.demodulate(buf);
    const audio = decimator.decimate(demodulated);
    console.log('audio samples:', audio.length, '~', (audio.length / 44100 * 1000).toFixed(0), 'ms');
});

setTimeout(() => {
    rtl.stopAsync();
    rtl.close();
}, 3000);
