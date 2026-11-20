#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "SurfaceParameters.h"

#include <cmath>
#include <optional>

namespace
{
// Property names used by juce::AudioProcessorValueTreeState for each parameter child.
const juce::Identifier parameterType { "PARAM" };
const juce::Identifier idProperty { "id" };
const juce::Identifier valueProperty { "value" };

std::optional<double> parseStoredValue (const juce::var& value)
{
    if (value.isInt() || value.isInt64() || value.isDouble())
        return static_cast<double> (value);

    if (value.isString())
    {
        const auto text = value.toString().trim();

        if (text.isEmpty() || ! text.containsOnly ("0123456789+-.eE"))
            return std::nullopt;

        return text.getDoubleValue();
    }

    return std::nullopt;
}
} // namespace

SurfaceExampleProcessor::SurfaceExampleProcessor()
    : AudioProcessor (BusesProperties()
                          .withInput ("Input", juce::AudioChannelSet::stereo(), true)
                          .withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      parameters (*this, nullptr, stateType, makeParameterLayout())
{
}

juce::AudioProcessorValueTreeState::ParameterLayout SurfaceExampleProcessor::makeParameterLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;

    for (size_t i = 0; i < lqsurface::parameterIds.size(); ++i)
        layout.add (std::make_unique<juce::AudioParameterFloat> (
            juce::ParameterID { lqsurface::parameterIds[i], lqsurface::parameterVersionHint },
            lqsurface::parameterNames[i],
            juce::NormalisableRange<float> { 0.0f, 1.0f },
            lqsurface::defaultNormalisedValue));

    return layout;
}

void SurfaceExampleProcessor::prepareToPlay (double, int) {}
void SurfaceExampleProcessor::releaseResources() {}

void SurfaceExampleProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    // Intentional passthrough: input samples are left untouched (bit-exact). No allocation, no
    // locks, no UI or WebView access on the audio thread. Only surplus outputs are cleared.
    juce::ScopedNoDenormals noDenormals;

    for (auto channel = getTotalNumInputChannels(); channel < getTotalNumOutputChannels(); ++channel)
        buffer.clear (channel, 0, buffer.getNumSamples());
}

bool SurfaceExampleProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    return layouts.getMainInputChannelSet() == juce::AudioChannelSet::stereo()
        && layouts.getMainOutputChannelSet() == juce::AudioChannelSet::stereo();
}

juce::AudioProcessorEditor* SurfaceExampleProcessor::createEditor()
{
    return new SurfaceExampleEditor (*this);
}

void SurfaceExampleProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    if (const auto xml = parameters.copyState().createXml())
        copyXmlToBinary (*xml, destData);
}

void SurfaceExampleProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    if (data == nullptr || sizeInBytes <= 0)
        return;

    const auto xml = getXmlFromBinary (data, sizeInBytes);

    // Ignore anything that is not our own state (wrong tag, other plug-in, corrupt data).
    if (xml == nullptr || ! xml->hasTagName (stateType))
        return;

    if (const auto restored = sanitiseState (juce::ValueTree::fromXml (*xml)); restored.isValid())
        parameters.replaceState (restored);
}

juce::ValueTree SurfaceExampleProcessor::sanitiseState (const juce::ValueTree& incoming)
{
    if (! incoming.hasType (stateType))
        return {};

    juce::ValueTree result { stateType };

    for (const auto* id : lqsurface::parameterIds)
    {
        auto value = static_cast<double> (lqsurface::defaultNormalisedValue);

        for (const auto& child : incoming)
        {
            if (! child.hasType (parameterType) || child.getProperty (idProperty).toString() != id)
                continue;

            if (const auto parsed = parseStoredValue (child.getProperty (valueProperty));
                parsed.has_value() && std::isfinite (*parsed))
                value = juce::jlimit (0.0, 1.0, *parsed); // ranges are [0, 1], so denormalised == normalised

            break;
        }

        result.appendChild (juce::ValueTree { parameterType, { { idProperty, juce::String (id) },
                                                               { valueProperty, value } } },
                            nullptr);
    }

    return result;
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new SurfaceExampleProcessor();
}
