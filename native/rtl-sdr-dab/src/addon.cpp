#include <napi.h>
#include "dab_controller.h"
#include "radio-receiver.h"
#include "rtl_sdr.h"

class DabAddon;

// Start/Stop do blocking USB/libusb work (rtlsdr_open, rtlsdr_cancel_async,
// OFDM/reader thread joins) that can occasionally stall for longer than
// expected — or, if the dongle wedges, indefinitely. Running that on
// Node's single main thread would freeze the whole Electron process, so
// it's pushed onto the libuv threadpool via AsyncWorker instead.
class StartWorker : public Napi::AsyncWorker {
public:
    StartWorker(Napi::Env env, DabAddon* addon, uint32_t frequencyHz, bool scanMode);
    Napi::Promise GetPromise() { return deferred_.Promise(); }

protected:
    void Execute() override;
    void OnOK() override { deferred_.Resolve(Env().Undefined()); }
    void OnError(const Napi::Error& e) override { deferred_.Reject(e.Value()); }

private:
    DabAddon* addon_;
    uint32_t frequencyHz_;
    bool scanMode_;
    Napi::Promise::Deferred deferred_;
};

class StopWorker : public Napi::AsyncWorker {
public:
    StopWorker(Napi::Env env, DabAddon* addon);
    Napi::Promise GetPromise() { return deferred_.Promise(); }

protected:
    void Execute() override;
    void OnOK() override { deferred_.Resolve(Env().Undefined()); }
    void OnError(const Napi::Error& e) override { deferred_.Reject(e.Value()); }

private:
    DabAddon* addon_;
    Napi::Promise::Deferred deferred_;
};

class CloseWorker : public Napi::AsyncWorker {
public:
    CloseWorker(Napi::Env env, DabAddon* addon);
    Napi::Promise GetPromise() { return deferred_.Promise(); }

protected:
    void Execute() override;
    void OnOK() override { deferred_.Resolve(Env().Undefined()); }
    void OnError(const Napi::Error& e) override { deferred_.Reject(e.Value()); }

private:
    DabAddon* addon_;
    Napi::Promise::Deferred deferred_;
};

class DabAddon : public Napi::ObjectWrap<DabAddon> {
public:
    friend class StartWorker;
    friend class StopWorker;
    friend class CloseWorker;

    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "DabAddon", {
            InstanceMethod("start",         &DabAddon::Start),
            InstanceMethod("stop",          &DabAddon::Stop),
            InstanceMethod("close",         &DabAddon::Close),
            InstanceMethod("selectService", &DabAddon::SelectService),
            InstanceMethod("getService",    &DabAddon::GetService),
            InstanceMethod("getProgrammeInfo", &DabAddon::GetProgrammeInfo),
            InstanceMethod("onAudio",       &DabAddon::OnAudio),
            InstanceMethod("onService",     &DabAddon::OnService),
            InstanceMethod("onMetadata",    &DabAddon::OnMetadata),
            InstanceMethod("onSlide",       &DabAddon::OnSlide),
            InstanceMethod("onSnr",         &DabAddon::OnSnr),
            InstanceMethod("onSignal",      &DabAddon::OnSignal),
        });
        exports.Set("DabAddon", func);
        return exports;
    }

    DabAddon(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<DabAddon>(info) {
        controller_ = std::make_unique<DabController>(info.Env());
    }

    // Only reached on process exit (JS side always awaits stop() first in
    // normal operation), so a synchronous teardown here is acceptable.
    ~DabAddon() { close_device(); }

private:
    // start(frequencyHz: number, scanMode?: boolean): Promise<void>
    // CRTL_SDR opens the device itself (it doesn't support selecting by
    // index), so this only accepts a frequency. scanMode is forwarded to
    // RadioReceiver::restart() — it's what makes onSignalPresence fire at
    // all (see ofdm-processor.cpp's `if (scanMode)` guards), so a real band
    // scan needs it true; normal single-channel tuning leaves it false.
    Napi::Value Start(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (info.Length() < 1 || !info[0].IsNumber()) {
            Napi::TypeError::New(env, "frequencyHz required").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        uint32_t freq = info[0].As<Napi::Number>().Uint32Value();
        bool scanMode = info.Length() > 1 && info[1].IsBoolean() && info[1].As<Napi::Boolean>().Value();
        auto* worker = new StartWorker(env, this, freq, scanMode);
        Napi::Promise promise = worker->GetPromise();
        worker->Queue();
        return promise;
    }

    // stop(): Promise<void>
    // Pauses playback but keeps the USB device open — use this between scan
    // channels or when briefly pausing, since retuning a still-open device
    // is far cheaper (and far less likely to wedge it) than closing and
    // reopening it.
    Napi::Value Stop(const Napi::CallbackInfo& info) {
        auto* worker = new StopWorker(info.Env(), this);
        Napi::Promise promise = worker->GetPromise();
        worker->Queue();
        return promise;
    }

    // close(): Promise<void>
    // Fully releases the USB device. Use this when actually done with DAB
    // (e.g. switching to FM), so the device is free for something else to
    // claim it.
    Napi::Value Close(const Napi::CallbackInfo& info) {
        auto* worker = new CloseWorker(info.Env(), this);
        Napi::Promise promise = worker->GetPromise();
        worker->Queue();
        return promise;
    }

    // selectService(serviceId: number)
    // Only reconfigures already-running decoder state (no device I/O), so
    // this stays synchronous.
    Napi::Value SelectService(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (!receiver_ || info.Length() < 1 || !info[0].IsNumber()) return env.Undefined();

        uint32_t sid = info[0].As<Napi::Number>().Uint32Value();
        Service service = receiver_->getService(sid);
        receiver_->playSingleProgramme(*controller_, "", service);

        return env.Undefined();
    }

    // getService(serviceId: number): { id: number, label: string } | null
    // The FIC announces a service's ID (triggering onServiceDetected) before
    // its label text arrives on a separate FIG, with no follow-up event when
    // the label does land. welle.io's own GUI handles this with a recurring
    // timer that just re-polls getService() until the label is non-empty
    // (CRadioController::labelTimerTimeout) — this method is what the JS
    // side polls the same way. It's safe to call synchronously here because,
    // unlike onServiceDetected, this is only ever invoked from JS-driven
    // code on the main thread, never from the FIC/OFDM thread — the same
    // reasoning that already makes SelectService's getService() call safe.
    Napi::Value GetService(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (!receiver_ || info.Length() < 1 || !info[0].IsNumber()) return env.Null();

        uint32_t sid = info[0].As<Napi::Number>().Uint32Value();
        Service service = receiver_->getService(sid);
        if (service.serviceId == 0) return env.Null();

        auto obj = Napi::Object::New(env);
        obj.Set("id",    Napi::Number::New(env, service.serviceId));
        obj.Set("label", Napi::String::New(env, service.serviceLabel.utf8_label()));
        return obj;
    }

    // getProgrammeInfo(serviceId: number): { codec: 'DAB' | 'DAB+', bitrateKbps: number } | null
    // Mirrors welle.io's own GUI (CRadioController::stationTimerTimeout),
    // which reads this exact same way right after a successful
    // playSingleProgramme(): walk the service's audio component to find its
    // subchannel, then read off its codec type and effective bitrate. Safe
    // to call synchronously for the same reason GetService() is — only
    // ever invoked from JS-driven code on the main thread.
    Napi::Value GetProgrammeInfo(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (!receiver_ || info.Length() < 1 || !info[0].IsNumber()) return env.Null();

        uint32_t sid = info[0].As<Napi::Number>().Uint32Value();
        Service service = receiver_->getService(sid);
        if (service.serviceId == 0) return env.Null();

        for (const auto& sc : receiver_->getComponents(service)) {
            if (sc.transportMode() != TransportMode::Audio) continue;
            if (sc.audioType() != AudioServiceComponentType::DAB &&
                sc.audioType() != AudioServiceComponentType::DABPlus) continue;

            Subchannel subch = receiver_->getSubchannel(sc);
            if (!subch.valid()) continue;

            auto obj = Napi::Object::New(env);
            obj.Set("codec", Napi::String::New(env,
                sc.audioType() == AudioServiceComponentType::DABPlus ? "DAB+" : "DAB"));
            obj.Set("bitrateKbps", Napi::Number::New(env, subch.bitrate()));
            return obj;
        }
        return env.Null();
    }

    // onAudio(cb: (buffer: Buffer, samplerate: number, stereo: bool) => void)
    Napi::Value OnAudio(const Napi::CallbackInfo& info) {
        auto tsfn = Napi::ThreadSafeFunction::New(
            info.Env(), info[0].As<Napi::Function>(), "dab_audio", 0, 1);
        controller_->setAudioCallback(std::move(tsfn));
        return info.Env().Undefined();
    }

    // onService(cb: (service: { id: number, label: string }) => void)
    Napi::Value OnService(const Napi::CallbackInfo& info) {
        auto tsfn = Napi::ThreadSafeFunction::New(
            info.Env(), info[0].As<Napi::Function>(), "dab_service", 0, 1);
        controller_->setServiceListCallback(std::move(tsfn));
        return info.Env().Undefined();
    }

    // onMetadata(cb: (type: string, value: string) => void)
    Napi::Value OnMetadata(const Napi::CallbackInfo& info) {
        auto tsfn = Napi::ThreadSafeFunction::New(
            info.Env(), info[0].As<Napi::Function>(), "dab_metadata", 0, 1);
        controller_->setMetadataCallback(std::move(tsfn));
        return info.Env().Undefined();
    }

    // onSlide(cb: (buffer: Buffer, mimeType: string) => void)
    Napi::Value OnSlide(const Napi::CallbackInfo& info) {
        auto tsfn = Napi::ThreadSafeFunction::New(
            info.Env(), info[0].As<Napi::Function>(), "dab_slide", 0, 1);
        controller_->setSlideCallback(std::move(tsfn));
        return info.Env().Undefined();
    }

    // onSnr(cb: (snr: number) => void)
    Napi::Value OnSnr(const Napi::CallbackInfo& info) {
        auto tsfn = Napi::ThreadSafeFunction::New(
            info.Env(), info[0].As<Napi::Function>(), "dab_snr", 0, 1);
        controller_->setSnrCallback(std::move(tsfn));
        return info.Env().Undefined();
    }

    // onSignal(cb: (isSignal: boolean) => void)
    Napi::Value OnSignal(const Napi::CallbackInfo& info) {
        auto tsfn = Napi::ThreadSafeFunction::New(
            info.Env(), info[0].As<Napi::Function>(), "dab_signal", 0, 1);
        controller_->setSignalCallback(std::move(tsfn));
        return info.Env().Undefined();
    }

    // Pauses the demodulator and the USB read thread but — critically —
    // leaves the device handle open. Mirrors welle.io's own GUI
    // (CRadioController::stop(), which calls device->stop() but never
    // destroys the device). Closing and reopening the RTL-SDR on every
    // start/stop was observed to wedge the dongle after repeated cycles
    // (e.g. partway through a 38-channel scan).
    void stop_receiver_only() {
        controller_->setReceiver(nullptr);
        if (receiver_) {
            receiver_->stop();
            receiver_.reset();
        }
        if (input_) {
            input_->stop();
        }
    }

    // Full teardown, releasing the USB device. Only used when the addon
    // itself is being destroyed.
    void close_device() {
        stop_receiver_only();
        if (input_) {
            input_.reset();
        }
    }

    std::unique_ptr<DabController> controller_;
    std::unique_ptr<CRTL_SDR>      input_;
    std::unique_ptr<RadioReceiver> receiver_;
};

StartWorker::StartWorker(Napi::Env env, DabAddon* addon, uint32_t frequencyHz, bool scanMode)
    : Napi::AsyncWorker(env), addon_(addon), frequencyHz_(frequencyHz), scanMode_(scanMode),
      deferred_(Napi::Promise::Deferred::New(env)) {}

void StartWorker::Execute() {
    // Stop only the demodulator — the device (if already open from a
    // previous start/scan channel) stays open and just gets retuned below.
    addon_->controller_->setReceiver(nullptr);
    if (addon_->receiver_) {
        addon_->receiver_->stop();
        addon_->receiver_.reset();
    }

    if (!addon_->input_) {
        try {
            addon_->input_ = std::make_unique<CRTL_SDR>(*addon_->controller_);
        } catch (...) {
            SetError("Failed to open RTL-SDR device");
            return;
        }
    }

    // CRTL_SDR::setFrequency() pauses+resumes just its own read thread; it
    // only reopens the USB device if it was actually unplugged in the
    // meantime, so repeated calls here are cheap in-place retunes.
    addon_->input_->setFrequency(static_cast<int>(frequencyHz_));

    RadioReceiverOptions opts;
    addon_->receiver_ = std::make_unique<RadioReceiver>(*addon_->controller_, *addon_->input_, opts);
    addon_->controller_->setReceiver(addon_->receiver_.get());
    addon_->receiver_->restart(scanMode_);
}

StopWorker::StopWorker(Napi::Env env, DabAddon* addon)
    : Napi::AsyncWorker(env), addon_(addon), deferred_(Napi::Promise::Deferred::New(env)) {}

void StopWorker::Execute() {
    addon_->stop_receiver_only();
}

CloseWorker::CloseWorker(Napi::Env env, DabAddon* addon)
    : Napi::AsyncWorker(env), addon_(addon), deferred_(Napi::Promise::Deferred::New(env)) {}

void CloseWorker::Execute() {
    addon_->close_device();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    return DabAddon::Init(env, exports);
}

NODE_API_MODULE(rtl_sdr_dab, Init)
