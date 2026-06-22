#pragma once

#include "radio-receiver.h"
#include <napi.h>
#include <mutex>
#include <vector>
#include <string>

// Implements both halves of the welle.io callback API: RadioControllerInterface
// (ensemble-wide events — scan/sync/service list) and ProgrammeHandlerInterface
// (per-tuned-service events — audio/labels), since this addon only ever plays
// one service at a time.
class DabController : public RadioControllerInterface, public ProgrammeHandlerInterface {
public:
    explicit DabController(Napi::Env env);
    ~DabController();

    void setAudioCallback(Napi::ThreadSafeFunction tsfn);
    void setMetadataCallback(Napi::ThreadSafeFunction tsfn);
    void setServiceListCallback(Napi::ThreadSafeFunction tsfn);
    void setSlideCallback(Napi::ThreadSafeFunction tsfn);
    void setSnrCallback(Napi::ThreadSafeFunction tsfn);
    void setSignalCallback(Napi::ThreadSafeFunction tsfn);

    // Set once a RadioReceiver exists, so onServiceDetected can look up the
    // service's label. Pass nullptr on stop.
    void setReceiver(RadioReceiver* receiver);

    // RadioControllerInterface
    void onSNR(float snr) override;
    void onFrequencyCorrectorChange(int fine, int coarse) override;
    void onSyncChange(char isSync) override;
    void onSignalPresence(bool isSignal) override;
    void onServiceDetected(uint32_t sId) override;
    void onNewEnsemble(uint16_t eId) override;
    void onSetEnsembleLabel(DabLabel& label) override;
    void onDateTimeUpdate(const dab_date_time_t& dateTime) override;
    void onFIBDecodeSuccess(bool crcCheckOk, const uint8_t* fib) override;
    void onNewImpulseResponse(std::vector<float>&& data) override;
    void onConstellationPoints(std::vector<DSPCOMPLEX>&& data) override;
    void onNewNullSymbol(std::vector<DSPCOMPLEX>&& data) override;
    void onTIIMeasurement(tii_measurement_t&& m) override;
    void onMessage(message_level_t level, const std::string& text,
                   const std::string& text2 = std::string()) override;

    // ProgrammeHandlerInterface
    void onFrameErrors(int frameErrors) override;
    void onNewAudio(std::vector<int16_t>&& audioData, int sampleRate, const std::string& mode) override;
    void onRsErrors(bool uncorrectedErrors, int numCorrectedErrors) override;
    void onAacErrors(int aacErrors) override;
    void onNewDynamicLabel(const std::string& label) override;
    void onMOT(const mot_file_t& mot_file) override;
    void onPADLengthError(size_t announced_xpad_len, size_t xpad_len) override;

private:
    RadioReceiver* receiver_ = nullptr;

    Napi::ThreadSafeFunction audio_tsfn_;
    Napi::ThreadSafeFunction metadata_tsfn_;
    Napi::ThreadSafeFunction service_list_tsfn_;
    Napi::ThreadSafeFunction slide_tsfn_;
    Napi::ThreadSafeFunction snr_tsfn_;
    Napi::ThreadSafeFunction signal_tsfn_;

    bool audio_tsfn_valid_ = false;
    bool metadata_tsfn_valid_ = false;
    bool service_list_tsfn_valid_ = false;
    bool slide_tsfn_valid_ = false;
    bool snr_tsfn_valid_ = false;
    bool signal_tsfn_valid_ = false;
};
