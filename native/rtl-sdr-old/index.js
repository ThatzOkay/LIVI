const native = require('./build/Release/rtl-sdr');

const INPUT_RATE  = 192000;
const OUTPUT_RATE = 48000;

function parseFrequency(input) {
    const freq = parseFloat(input);
    if (isNaN(freq)) throw new Error(`Invalid frequency: ${input}`);
    if (freq > 1_000_000) return Math.round(freq);
    return Math.round(freq * 1_000_000);
}

// ─── DSP ──────────────────────────────────────────────────────────────────────

// 16-tap Hamming-windowed sinc FIR low-pass, cutoff at fs/8
// mirrors lp_f32 / init_lp_f32 from rtl_fm_player
function buildFIR16() {
    const taps = new Float32Array(16);
    for (let i = 0; i < 16; i++) {
        const j = i - 15.5;
        const sinc = j === 0 ? 0.125 : Math.sin(0.125 * Math.PI * j) / (Math.PI * j);
        const hamming = 0.54 - 0.46 * Math.cos(Math.PI * i / 15.5);
        taps[i] = sinc * hamming;
    }
    return taps;
}

const FIR_TAPS = buildFIR16();

class FMDemodulator {
    constructor() {
        this.prevI = 0;
        this.prevQ = 0;
        // FIR delay line for I and Q (32 floats, 16 IQ pairs)
        this.delayI = new Float32Array(16);
        this.delayQ = new Float32Array(16);
        this.delayPos = 0;
    }

    demodulate(buffer) {
        const samples = buffer.length / 2;
        const audio = new Float32Array(samples);

        for (let i = 0; i < samples; i++) {
            // convert uint8 to signed float [-1, 1]
            let I = (buffer[i * 2]     - 127.5) / 128.0;
            let Q = (buffer[i * 2 + 1] - 127.5) / 128.0;

            // FIR low-pass on I and Q before demodulation
            this.delayI[this.delayPos] = I;
            this.delayQ[this.delayPos] = Q;

            let fi = 0, fq = 0;
            for (let t = 0; t < 16; t++) {
                const idx = (this.delayPos - t + 16) & 15;
                fi += this.delayI[idx] * FIR_TAPS[t];
                fq += this.delayQ[idx] * FIR_TAPS[t];
            }
            this.delayPos = (this.delayPos + 1) & 15;

            // polar discriminator (atan2 Lagrange approximation)
            const cross = this.prevI * fq - this.prevQ * fi;
            const dot   = this.prevI * fi + this.prevQ * fq;
            audio[i] = atan2Lagrange(cross, dot) / Math.PI;

            this.prevI = fi;
            this.prevQ = fq;
        }

        return audio;
    }
}

// fast atan2 approximation matching rtl_fm_player's atan2_lagrange_f32
function atan2Lagrange(y, x) {
    const PI   = Math.PI;
    const PI2  = Math.PI / 2;
    const PI4  = Math.PI / 4;

    if (x === 0) {
        if (y < 0) return -PI2;
        if (y > 0) return  PI2;
        return 0;
    }
    if (y === 0) return x < 0 ? PI : 0;

    let z;
    if (x < 0) {
        if (y < 0) {
            if (x <= y) { z = y/x; return z*(PI4 - (z-1)*(0.2447 + 0.0663*z)) - PI; }
            z = x/y; return z*(-PI4 + (z-1)*(0.2447 + 0.0663*z)) - PI2;
        }
        if (-x >= y) { z = y/x; return z*(PI4 + (z+1)*(0.2447 - 0.0663*z)) + PI; }
        z = x/y; return PI2 - z*(PI4 + (z+1)*(0.2447 - 0.0663*z));
    }
    if (y < 0) {
        if (x >= -y) { z = y/x; return z*(PI4 + (z+1)*(0.2447 - 0.0663*z)); }
        z = x/y; return z*(-PI4 - (z+1)*(0.2447 - 0.0663*z)) - PI2;
    }
    if (x >= y) { z = y/x; return z*(PI4 - (z-1)*(0.2447 + 0.0663*z)); }
    z = x/y; return PI2 - z*(PI4 - (z-1)*(0.2447 + 0.0663*z));
}

// removes DC spike at center frequency
class DCBlocker {
    constructor() { this.avg = 0; }

    process(samples) {
        for (let i = 0; i < samples.length; i++) {
            this.avg += (samples[i] - this.avg) * 0.001;
            samples[i] -= this.avg;
        }
        return samples;
    }
}

// downsample from inputRate to outputRate with IIR anti-alias
class Decimator {
    constructor(inputRate, outputRate) {
        this.ratio = inputRate / outputRate; // 192000/48000 = 4.0
        this.acc   = 0;
        this.alpha = 1 - Math.exp(-2 * Math.PI * 15000 / inputRate);
        this.prev  = 0;
    }

    decimate(samples) {
        const out = new Float32Array(Math.floor(samples.length / this.ratio));
        let outIdx = 0;
        for (let i = 0; i < samples.length; i++) {
            this.prev += (samples[i] - this.prev) * this.alpha;
            this.acc++;
            if (this.acc >= this.ratio) {
                out[outIdx++] = this.prev;
                this.acc -= this.ratio;
            }
        }
        return out.subarray(0, outIdx);
    }
}

// European FM de-emphasis 50μs
// matches rtl_fm_player: ib[i] += lambda * (prev - ib[i])
class DeEmphasis {
    constructor(sampleRate) {
        // lambda = exp(-1 / (sampleRate * tau))
        this.lambda = Math.exp(-1.0 / (sampleRate * 50e-6));
        this.prev   = 0;
    }

    process(samples) {
        for (let i = 0; i < samples.length; i++) {
            this.prev = samples[i] += this.lambda * (this.prev - samples[i]);
        }
        return samples;
    }
}

// audio bandpass: high-pass 50Hz + low-pass 15kHz
class AudioBandpass {
    constructor(sampleRate) {
        this.hpAlpha = 1 - Math.exp(-2 * Math.PI * 50    / sampleRate);
        this.lpAlpha = 1 - Math.exp(-2 * Math.PI * 15000 / sampleRate);
        this.hpPrev  = 0;
        this.hpOut   = 0;
        this.lpPrev  = 0;
    }

    process(samples) {
        for (let i = 0; i < samples.length; i++) {
            this.hpOut  = this.hpOut * (1 - this.hpAlpha) + (samples[i] - this.hpPrev) * (1 - this.hpAlpha);
            this.hpPrev = samples[i];
            this.lpPrev += (this.hpOut - this.lpPrev) * this.lpAlpha;
            samples[i]   = this.lpPrev;
        }
        return samples;
    }
}

// AGC + soft limiter
class SoftLimiter {
    constructor() { this.gain = 1.0; }

    process(samples) {
        for (let i = 0; i < samples.length; i++) {
            if (Math.abs(samples[i]) * this.gain > 0.95) {
                this.gain *= 0.999;
            } else {
                this.gain = Math.min(1.0, this.gain * 1.0001);
            }
            samples[i] = Math.max(-1, Math.min(1, samples[i] * this.gain));
        }
        return samples;
    }
}

// full FM pipeline
class FMPipeline {
    constructor(inputRate = INPUT_RATE, outputRate = OUTPUT_RATE) {
        this.inputRate  = inputRate;
        this.outputRate = outputRate;
        this.demod      = new FMDemodulator();
        this.dc         = new DCBlocker();
        this.decimator  = new Decimator(inputRate, outputRate);
        this.deemph     = new DeEmphasis(outputRate);
        this.bandpass   = new AudioBandpass(outputRate);
        this.limiter    = new SoftLimiter();
        this.volume     = 4;
    }

    process(buffer) {
        const demodulated  = this.demod.demodulate(buffer);
        const dcBlocked    = this.dc.process(demodulated);
        const decimated    = this.decimator.decimate(dcBlocked);
        const deemphasized = this.deemph.process(decimated);
        const bandpassed   = this.bandpass.process(deemphasized);
        const limited      = this.limiter.process(bandpassed);
        // apply volume
        for (let i = 0; i < limited.length; i++) limited[i] *= this.volume;
        return limited;
    }
}

// ─── exports ──────────────────────────────────────────────────────────────────

module.exports = {
    INPUT_RATE,
    OUTPUT_RATE,
    parseFrequency,
    getDeviceCount:     () => native.getDeviceCount(),
    getDeviceName:      (i) => native.getDeviceName(i),
    open:               (i) => native.open(i ?? 0),
    close:              () => native.close(),
    setSampleRate:      (rate) => native.setSampleRate(rate),
    setGain:            (gain) => native.setGain(gain),
    setFrequency:       (freq) => native.setFrequency(parseFrequency(String(freq))),
    setFrequencyNative: (freq) => native.setFrequency(freq),
    readAsync:          (cb) => native.readAsync(cb),
    stopAsync:          () => native.stopAsync(),
    FMDemodulator,
    DCBlocker,
    Decimator,
    DeEmphasis,
    AudioBandpass,
    SoftLimiter,
    FMPipeline,
};
