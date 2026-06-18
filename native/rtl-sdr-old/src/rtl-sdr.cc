#include <napi.h>
#include <rtl-sdr.h>
#include <thread>
#include <cstring>

rtlsdr_dev_t *dev = nullptr;
Napi::ThreadSafeFunction tsfn;

// open(deviceIndex)
Napi::Value Open(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    int index = info[0].As<Napi::Number>().Int32Value();
    int r = rtlsdr_open(&dev, index);
    return Napi::Number::New(env, r);
}

// close()
Napi::Value Close(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (dev) { rtlsdr_close(dev); dev = nullptr; }
    return env.Undefined();
}

// setFrequency(hz)
Napi::Value SetFrequency(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    uint32_t freq = info[0].As<Napi::Number>().Uint32Value();
    int r = rtlsdr_set_center_freq(dev, freq);
    return Napi::Number::New(env, r);
}

// setSampleRate(hz)
Napi::Value SetSampleRate(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    uint32_t rate = info[0].As<Napi::Number>().Uint32Value();
    int r = rtlsdr_set_sample_rate(dev, rate);
    return Napi::Number::New(env, r);
}

// setGain(gain) — tenths of dB, e.g. 400 = 40.0 dB. -1 = auto
Napi::Value SetGain(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    int gain = info[0].As<Napi::Number>().Int32Value();
    if (gain == -1) {
        rtlsdr_set_tuner_gain_mode(dev, 0); // auto
    } else {
        rtlsdr_set_tuner_gain_mode(dev, 1); // manual
        rtlsdr_set_tuner_gain(dev, gain);
    }
    return env.Undefined();
}

// getDeviceCount()
Napi::Value GetDeviceCount(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), rtlsdr_get_device_count());
}

// getDeviceName(index)
Napi::Value GetDeviceName(const Napi::CallbackInfo& info) {
    int index = info[0].As<Napi::Number>().Int32Value();
    return Napi::String::New(info.Env(), rtlsdr_get_device_name(index));
}

// internal C callback — called by rtlsdr on its own thread
void RtlCallback(unsigned char *buf, uint32_t len, void *ctx) {
    unsigned char *copy = new unsigned char[len];
    memcpy(copy, buf, len);

    tsfn.NonBlockingCall(copy, [len](Napi::Env env, Napi::Function jsCallback, unsigned char *data) {
        jsCallback.Call({ Napi::Buffer<unsigned char>::Copy(env, data, len) });
        delete[] data;
    });
}

// readAsync(callback) — starts streaming IQ data
Napi::Value ReadAsync(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    tsfn = Napi::ThreadSafeFunction::New(
        env,
        info[0].As<Napi::Function>(),
        "rtlsdr_callback",
        0,  // unlimited queue
        1   // one thread
    );

    rtlsdr_reset_buffer(dev);

    std::thread([]() {
        rtlsdr_read_async(dev, RtlCallback, nullptr, 0, 0);
        tsfn.Release();
    }).detach();

    return env.Undefined();
}

// stopAsync()
Napi::Value StopAsync(const Napi::CallbackInfo& info) {
    rtlsdr_cancel_async(dev);
    return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("open",           Napi::Function::New(env, Open));
    exports.Set("close",          Napi::Function::New(env, Close));
    exports.Set("setFrequency",   Napi::Function::New(env, SetFrequency));
    exports.Set("setSampleRate",  Napi::Function::New(env, SetSampleRate));
    exports.Set("setGain",        Napi::Function::New(env, SetGain));
    exports.Set("getDeviceCount", Napi::Function::New(env, GetDeviceCount));
    exports.Set("getDeviceName",  Napi::Function::New(env, GetDeviceName));
    exports.Set("readAsync",      Napi::Function::New(env, ReadAsync));
    exports.Set("stopAsync",      Napi::Function::New(env, StopAsync));
    return exports;
}

NODE_API_MODULE(rtlsdr, Init)
