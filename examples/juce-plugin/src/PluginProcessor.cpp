#include "PluginProcessor.h"
#include "PluginEditor.h"

SurfaceExampleProcessor::SurfaceExampleProcessor()
    : AudioProcessor(BusesProperties()
        .withInput("Input", juce::AudioChannelSet::stereo(), true)
        .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      parameters(*this, nullptr, "SurfaceState", makeParameterLayout()) {}

juce::AudioProcessorValueTreeState::ParameterLayout SurfaceExampleProcessor::makeParameterLayout() {
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    for (const char* name : { "surface_x", "surface_y", "surface_z" })
        layout.add(std::make_unique<juce::AudioParameterFloat>(
            juce::ParameterID{name, 1}, name, juce::NormalisableRange<float>{0.0f, 1.0f}, 0.5f));
    return layout;
}

void SurfaceExampleProcessor::prepareToPlay(double, int) {}
void SurfaceExampleProcessor::releaseResources() {}
void SurfaceExampleProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) {
    juce::ScopedNoDenormals noDenormals;
    // Intentional stereo passthrough. No DSP is in this example.
    for (int channel = getTotalNumInputChannels(); channel < getTotalNumOutputChannels(); ++channel)
        buffer.clear(channel, 0, buffer.getNumSamples());
}

bool SurfaceExampleProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const {
    return layouts.getMainInputChannelSet() == juce::AudioChannelSet::stereo()
        && layouts.getMainOutputChannelSet() == juce::AudioChannelSet::stereo();
}

juce::AudioProcessorEditor* SurfaceExampleProcessor::createEditor() { return new SurfaceExampleEditor(*this); }
void SurfaceExampleProcessor::getStateInformation(juce::MemoryBlock& destData) {
    if (const auto xml = parameters.copyState().createXml()) copyXmlToBinary(*xml, destData);
}
void SurfaceExampleProcessor::setStateInformation(const void* data, int sizeInBytes) {
    if (const auto xml = getXmlFromBinary(data, sizeInBytes))
        parameters.replaceState(juce::ValueTree::fromXml(*xml));
}
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new SurfaceExampleProcessor(); }
