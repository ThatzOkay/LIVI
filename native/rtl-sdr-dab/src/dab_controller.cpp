#include "dab_controller.h"
#include <cstring>

DabController::DabController(Napi::Env env) {}

DabController::~DabController() {
    if (audio_tsfn_valid_)        audio_tsfn_.Release();
    if (metadata_tsfn_valid_)     metadata_tsfn_.Release();
    if (service_list_tsfn_valid_) service_list_tsfn_.Release();
    if (slide_tsfn_valid_)        slide_tsfn_.Release();
    if (snr_tsfn_valid_)          snr_tsfn_.Release();
    if (signal_tsfn_valid_)       signal_tsfn_.Release();
}

void DabController::setAudioCallback(Napi::ThreadSafeFunction tsfn) {
    audio_tsfn_ = std::move(tsfn);
    audio_tsfn_valid_ = true;
}

void DabController::setMetadataCallback(Napi::ThreadSafeFunction tsfn) {
    metadata_tsfn_ = std::move(tsfn);
    metadata_tsfn_valid_ = true;
}

void DabController::setServiceListCallback(Napi::ThreadSafeFunction tsfn) {
    service_list_tsfn_ = std::move(tsfn);
    service_list_tsfn_valid_ = true;
}

void DabController::setSlideCallback(Napi::ThreadSafeFunction tsfn) {
    slide_tsfn_ = std::move(tsfn);
    slide_tsfn_valid_ = true;
}

void DabController::setSnrCallback(Napi::ThreadSafeFunction tsfn) {
    snr_tsfn_ = std::move(tsfn);
    snr_tsfn_valid_ = true;
}

void DabController::setSignalCallback(Napi::ThreadSafeFunction tsfn) {
    signal_tsfn_ = std::move(tsfn);
    signal_tsfn_valid_ = true;
}

void DabController::setReceiver(RadioReceiver* receiver) {
    receiver_ = receiver;
}

void DabController::onNewAudio(std::vector<int16_t>&& audioData, int sampleRate, const std::string& mode) {
    if (!audio_tsfn_valid_) return;

    // copy buffer for async delivery
    auto* data = new std::vector<int16_t>(std::move(audioData));
    int sr = sampleRate;

    audio_tsfn_.NonBlockingCall(data, [sr](Napi::Env env, Napi::Function cb, std::vector<int16_t>* data) {
        auto buf = Napi::Buffer<int16_t>::Copy(env, data->data(), data->size());
        // DAB+ audio decoded by welle.io is always interleaved stereo PCM.
        cb.Call({ buf, Napi::Number::New(env, sr), Napi::Boolean::New(env, true) });
        delete data;
    });
}

void DabController::onNewDynamicLabel(const std::string& label) {
    if (!metadata_tsfn_valid_) return;

    auto* text = new std::string(label);
    metadata_tsfn_.NonBlockingCall(text, [](Napi::Env env, Napi::Function cb, std::string* text) {
        cb.Call({ Napi::String::New(env, "dls"), Napi::String::New(env, *text) });
        delete text;
    });
}

// IMPORTANT: this runs on the FIC/OFDM thread, possibly already holding the
// FIG mutex partway through parsing the very FIG that announced this
// service. receiver_->getService() takes that same mutex internally — see
// welle.io's own welle-gui CRadioController::onServiceDetected, which has
// the exact same warning and defers the lookup to a GUI-thread timer
// instead. We get the same effect for free: the lookup below runs inside
// the NonBlockingCall callback, which node-addon-api always dispatches on
// the main JS thread, off the FIC thread's call stack entirely. Calling
// getService() directly here (as this used to) self-deadlocked the FIC
// thread on any channel where the FIC actually announced services that
// the OFDM thread couldn't pick up since the deadlock froze it permanently.
void DabController::onServiceDetected(uint32_t sId) {
    if (!service_list_tsfn_valid_) return;

    auto* idPtr = new uint32_t(sId);

    service_list_tsfn_.NonBlockingCall(idPtr, [this](Napi::Env env, Napi::Function cb, uint32_t* idPtr) {
        uint32_t sId = *idPtr;
        delete idPtr;
        if (!receiver_) return;

        Service service = receiver_->getService(sId);

        auto obj = Napi::Object::New(env);
        obj.Set("id",    Napi::Number::New(env, service.serviceId));
        obj.Set("label", Napi::String::New(env, service.serviceLabel.utf8_label()));
        cb.Call({ obj });
    });
}

// Called from OfdmDecoder::processPRS() (OFDM thread), throttled at the
// source to roughly every 10 PRS symbols and already smoothed there. Unlike
// onServiceDetected, this never touches the FIG mutex, so forwarding it
// straight through is safe.
void DabController::onSNR(float snr) {
    if (!snr_tsfn_valid_) return;

    auto* value = new float(snr);
    snr_tsfn_.NonBlockingCall(value, [](Napi::Env env, Napi::Function cb, float* value) {
        cb.Call({ Napi::Number::New(env, *value) });
        delete value;
    });
}
void DabController::onFrequencyCorrectorChange(int fine, int coarse) {}
void DabController::onSyncChange(char isSync) {}
// Only fires when the receiver was restarted in scan mode (RadioReceiver::
// restart(true) -> OFDMProcessor::set_scanMode(true)), and only once per
// channel visit: either after 5 failed sync attempts (no real ensemble
// here) or as soon as phase sync first succeeds (something is here, worth
// waiting longer for FIC/service decode) — see welle.io's own
// ofdm-processor.cpp. The JS side uses this exactly like welle.io's GUI
// does (CRadioController::nextChannel's isWait branch): skip fast on
// false, wait out a long settle window on true.
void DabController::onSignalPresence(bool isSignal) {
    if (!signal_tsfn_valid_) return;

    auto* value = new bool(isSignal);
    signal_tsfn_.NonBlockingCall(value, [](Napi::Env env, Napi::Function cb, bool* value) {
        cb.Call({ Napi::Boolean::New(env, *value) });
        delete value;
    });
}
void DabController::onNewEnsemble(uint16_t eId) {}
void DabController::onSetEnsembleLabel(DabLabel& label) {}
void DabController::onDateTimeUpdate(const dab_date_time_t& dateTime) {}
void DabController::onFIBDecodeSuccess(bool crcCheckOk, const uint8_t* fib) {}
void DabController::onNewImpulseResponse(std::vector<float>&& data) {}
void DabController::onConstellationPoints(std::vector<DSPCOMPLEX>&& data) {}
void DabController::onNewNullSymbol(std::vector<DSPCOMPLEX>&& data) {}
void DabController::onTIIMeasurement(tii_measurement_t&& m) {}
void DabController::onMessage(message_level_t level, const std::string& text, const std::string& text2) {}
void DabController::onFrameErrors(int frameErrors) {}
void DabController::onRsErrors(bool uncorrectedErrors, int numCorrectedErrors) {}
void DabController::onAacErrors(int aacErrors) {}
// Slideshow images (album art / station logos), keyed by content_sub_type:
// 0x01 = JPEG, 0x03 = PNG. Anything else (e.g. text-only MOT objects) is
// dropped here rather than forwarded as an undecodable image.
void DabController::onMOT(const mot_file_t& mot_file) {
    if (!slide_tsfn_valid_) return;
    if (mot_file.content_sub_type != 0x01 && mot_file.content_sub_type != 0x03) return;

    auto* payload = new std::pair<std::vector<uint8_t>, int>(mot_file.data, mot_file.content_sub_type);

    slide_tsfn_.NonBlockingCall(payload, [](Napi::Env env, Napi::Function cb, std::pair<std::vector<uint8_t>, int>* payload) {
        auto buf = Napi::Buffer<uint8_t>::Copy(env, payload->first.data(), payload->first.size());
        const char* mimeType = payload->second == 0x03 ? "image/png" : "image/jpeg";
        cb.Call({ buf, Napi::String::New(env, mimeType) });
        delete payload;
    });
}
void DabController::onPADLengthError(size_t announced_xpad_len, size_t xpad_len) {}
