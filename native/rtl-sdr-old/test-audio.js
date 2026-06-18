// test-audio.js
const rtl = require('./index');
const { FMPipeline } = require('./index');

const pipeline = new FMPipeline(2048000, 44100);

const gain = parseInt(process.argv[2] ?? '100');

rtl.open(0);
rtl.setSampleRate(2048000);
rtl.setFrequency('103.6');
rtl.setGain(gain);

rtl.readAsync((buf) => {
    const audio = pipeline.process(buf);
    const pcm = Buffer.alloc(audio.length * 2);
    for (let i = 0; i < audio.length; i++)
        pcm.writeInt16LE(Math.round(audio[i] * 32767), i * 2);
    process.stdout.write(pcm);
});
