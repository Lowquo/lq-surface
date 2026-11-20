#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

/** Stereo passthrough processor exposing the three lq-surface host parameters.

    Audio is never modified: there is no DSP here (and no lq-hit code). The host owns the
    authoritative parameter state; the editor only reads it and writes inside user gestures.
*/
class SurfaceExampleProcessor final : public juce::AudioProcessor
{
public:
    SurfaceExampleProcessor();
    ~SurfaceExampleProcessor() override = default;

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override                          { return true; }

    const juce::String getName() const override              { return "lq-surface example"; }
    bool acceptsMidi() const override                        { return false; }
    bool producesMidi() const override                       { return false; }
    bool isMidiEffect() const override                       { return false; }
    double getTailLengthSeconds() const override             { return 0.0; }

    int getNumPrograms() override                            { return 1; }
    int getCurrentProgram() override                         { return 0; }
    void setCurrentProgram (int) override                    {}
    const juce::String getProgramName (int) override         { return {}; }
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

    /** Builds the restorable state from untrusted input: only surface_x/y/z are kept, missing,
        non-numeric or non-finite values fall back to the default and others are clamped to [0, 1].
        Returns an invalid tree if `incoming` does not have the expected type. */
    static juce::ValueTree sanitiseState (const juce::ValueTree& incoming);

    static constexpr const char* stateType = "SurfaceState";

    juce::AudioProcessorValueTreeState parameters;

private:
    static juce::AudioProcessorValueTreeState::ParameterLayout makeParameterLayout();

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (SurfaceExampleProcessor)
};
