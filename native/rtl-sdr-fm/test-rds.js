const addon = require('./index.js');
addon.open(0);
addon.setSampleRate(2048000);
addon.setGain(150);
addon.setFrequency(103500000);

addon.readAsync(() => {}, 48000);

let n = 0;
const interval = setInterval(() => {
  n++;
  console.log(n*4 + 's ->', JSON.stringify(addon.getRds()));
  if (n === 3) {
    console.log('--- retuning to 100.0 MHz, resetting RDS ---');
    addon.setFrequency(100000000);
  }
  if (n >= 5) {
    clearInterval(interval);
    addon.stopAsync();
    setTimeout(() => { addon.close(); process.exit(0); }, 200);
  }
}, 4000);
