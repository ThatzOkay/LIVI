const addon = require('./index.js');
addon.open(0);
addon.setSampleRate(2048000);
addon.setGain(150);
addon.setFrequency(103500000);
const pipeline = new addon.FMPipeline(2048000, 48000);

addon.readAsync((buf) => { pipeline.process(buf); });

let n = 0;
const interval = setInterval(() => {
  n++;
  console.log(n*4 + 's ->', JSON.stringify(pipeline.rds()));
  if (n === 3) {
    console.log('--- retuning to 100.0 MHz, resetting RDS ---');
    addon.setFrequency(100000000);
    pipeline.resetRds();
  }
  if (n >= 5) {
    clearInterval(interval);
    addon.stopAsync();
    setTimeout(() => { addon.close(); process.exit(0); }, 200);
  }
}, 4000);
