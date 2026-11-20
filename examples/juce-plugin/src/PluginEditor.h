#pragma once
#include <JuceHeader.h>
#include "PluginProcessor.h"

class SurfaceExampleEditor final : public juce::AudioProcessorEditor, private juce::Timer {
public:
    explicit SurfaceExampleEditor(SurfaceExampleProcessor&);
    ~SurfaceExampleEditor() override;
    void resized() override;
private:
    static std::optional<juce::WebBrowserComponent::Resource> getResource(const juce::String& requestedPath);
    juce::RangedAudioParameter* parameterFor(const juce::String& id) const;
    void timerCallback() override;
    SurfaceExampleProcessor& processor;
    struct EmbeddedBrowser final : public juce::WebBrowserComponent {
        using juce::WebBrowserComponent::WebBrowserComponent;
        bool pageReady = false;
        bool pageAboutToLoad(const juce::String&) override { pageReady = false; return true; }
        void pageFinishedLoading(const juce::String&) override { pageReady = true; }
    };
    EmbeddedBrowser browser;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(SurfaceExampleEditor)
};
