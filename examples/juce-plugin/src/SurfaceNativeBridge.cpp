#include "SurfaceNativeBridge.h"

#include <cmath>

namespace lqsurface
{
namespace validation
{
    std::optional<int> parameterIndexForId (const juce::var& id)
    {
        if (! id.isString())
            return std::nullopt;

        const auto text = id.toString();

        for (int i = 0; i < numParameters; ++i)
            if (text == parameterIds[(size_t) i])
                return i;

        return std::nullopt;
    }

    bool isNumber (const juce::var& value)
    {
        // var::isBool() is distinct from isInt(), so JSON true/false are rejected here.
        return value.isInt() || value.isInt64() || value.isDouble();
    }

    std::optional<int> parseGestureArgs (const juce::Array<juce::var>& args)
    {
        if (args.size() != 1)
            return std::nullopt;

        return parameterIndexForId (args.getReference (0));
    }

    std::optional<SetRequest> parseSetArgs (const juce::Array<juce::var>& args)
    {
        if (args.size() != 2)
            return std::nullopt;

        const auto index = parameterIndexForId (args.getReference (0));
        const auto& rawValue = args.getReference (1);

        if (! index.has_value() || ! isNumber (rawValue))
            return std::nullopt;

        const auto value = static_cast<double> (rawValue);

        if (! std::isfinite (value) || value < 0.0 || value > 1.0)
            return std::nullopt;

        return SetRequest { *index, value };
    }
}

//==============================================================================
SurfaceNativeBridge::SurfaceNativeBridge (Parameters parametersToUse)
    : parameters (parametersToUse)
{
    // Null entries (misconfigured processor) are tolerated: calls for them are rejected.
}

SurfaceNativeBridge::Parameters SurfaceNativeBridge::findParameters (juce::AudioProcessorValueTreeState& state)
{
    Parameters result {};

    for (size_t i = 0; i < result.size(); ++i)
        result[i] = state.getParameter (parameterIds[i]);

    return result;
}

SurfaceNativeBridge::~SurfaceNativeBridge()
{
    endAllGestures();
}

void SurfaceNativeBridge::open (int index)
{
    auto* p = parameters[(size_t) index];
    jassert (p != nullptr && ! gestureOpen[(size_t) index]);
    gestureOpen[(size_t) index] = true;
    p->beginChangeGesture();
}

void SurfaceNativeBridge::close (int index)
{
    auto* p = parameters[(size_t) index];
    jassert (p != nullptr && gestureOpen[(size_t) index]);
    gestureOpen[(size_t) index] = false;
    p->endChangeGesture();
}

juce::var SurfaceNativeBridge::beginGesture (const juce::Array<juce::var>& args)
{
    JUCE_ASSERT_MESSAGE_THREAD

    const auto index = validation::parseGestureArgs (args);

    if (! index.has_value() || parameters[(size_t) *index] == nullptr)
        return false;

    if (! gestureOpen[(size_t) *index])
        open (*index);

    return true;
}

juce::var SurfaceNativeBridge::setParameter (const juce::Array<juce::var>& args)
{
    JUCE_ASSERT_MESSAGE_THREAD

    const auto request = validation::parseSetArgs (args);

    if (! request.has_value())
        return false;

    const auto index = request->index;
    auto* p = parameters[(size_t) index];

    if (p == nullptr)
        return false;

    const bool selfContained = ! gestureOpen[(size_t) index];

    if (selfContained)
        open (index);

    p->setValueNotifyingHost (static_cast<float> (request->value));

    if (selfContained)
        close (index);

    // The page knows this value already: never report it back as a host change.
    seenValues[(size_t) index] = p->getValue();
    return true;
}

juce::var SurfaceNativeBridge::endGesture (const juce::Array<juce::var>& args)
{
    JUCE_ASSERT_MESSAGE_THREAD

    const auto index = validation::parseGestureArgs (args);

    if (! index.has_value() || parameters[(size_t) *index] == nullptr)
        return false;

    if (gestureOpen[(size_t) *index])
        close (*index);

    return true;
}

juce::var SurfaceNativeBridge::getState (const juce::Array<juce::var>& args)
{
    JUCE_ASSERT_MESSAGE_THREAD

    if (! args.isEmpty())
        return false;

    seenValues = readValues();
    seenStateValid = true;
    return makePayload (seenValues);
}

int SurfaceNativeBridge::endAllGestures()
{
    int closed = 0;

    for (int i = 0; i < numParameters; ++i)
    {
        if (gestureOpen[(size_t) i])
        {
            close (i);
            ++closed;
        }
    }

    return closed;
}

bool SurfaceNativeBridge::isGestureOpen (int index) const noexcept
{
    return juce::isPositiveAndBelow (index, numParameters) && gestureOpen[(size_t) index];
}

int SurfaceNativeBridge::getNumOpenGestures() const noexcept
{
    int count = 0;

    for (auto isOpen : gestureOpen)
        count += isOpen ? 1 : 0;

    return count;
}

std::optional<juce::var> SurfaceNativeBridge::takeHostStateChange()
{
    JUCE_ASSERT_MESSAGE_THREAD

    // The page is authoritative for the duration of its own gesture; report afterwards.
    if (getNumOpenGestures() > 0)
        return std::nullopt;

    const auto values = readValues();

    if (seenStateValid && values == seenValues)
        return std::nullopt;

    seenValues = values;
    seenStateValid = true;
    return makePayload (values);
}

std::array<float, numParameters> SurfaceNativeBridge::readValues() const
{
    std::array<float, numParameters> values {};

    for (size_t i = 0; i < values.size(); ++i)
        values[i] = parameters[i] != nullptr ? parameters[i]->getValue() : defaultNormalisedValue;

    return values;
}

juce::var SurfaceNativeBridge::makePayload (const std::array<float, numParameters>& values) const
{
    juce::DynamicObject::Ptr object (new juce::DynamicObject());

    for (size_t i = 0; i < values.size(); ++i)
        object->setProperty (juce::Identifier (stateKeys[i]), static_cast<double> (values[i]));

    return juce::var (object.get());
}
} // namespace lqsurface
