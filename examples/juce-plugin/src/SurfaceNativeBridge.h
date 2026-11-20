#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include "SurfaceParameters.h"

#include <array>
#include <optional>

namespace lqsurface
{
//==============================================================================
/** Strict validation of untrusted arguments received from the WebView.

    JUCE converts JavaScript arguments to juce::var, where e.g. static_cast<double> silently accepts
    strings, booleans and void. These helpers accept only the exact shapes of the contract.
*/
namespace validation
{
    /** Index (0..2) of an exact, allowed parameter ID string; std::nullopt otherwise. */
    std::optional<int> parameterIndexForId (const juce::var& id);

    /** True for JSON numbers (int, int64 or double); false for bool, string, void, objects... */
    bool isNumber (const juce::var& value);

    /** Exactly one argument: an allowed parameter ID string. */
    std::optional<int> parseGestureArgs (const juce::Array<juce::var>& args);

    struct SetRequest
    {
        int index;
        double value;
    };

    /** Exactly two arguments: an allowed ID string and a finite number in [0, 1]. */
    std::optional<SetRequest> parseSetArgs (const juce::Array<juce::var>& args);
}

//==============================================================================
/**
    Message-thread logic behind the WebView native functions, kept free of any
    WebBrowserComponent dependency so it can be unit tested headlessly.

    Gesture policy (per parameter):
    - begin opens a host gesture; a duplicate begin is ignored (no second beginChangeGesture()).
    - end closes an open gesture; an unmatched end is ignored.
    - set inside an open gesture calls setValueNotifyingHost().
    - set without an open gesture is applied as a self-contained begin/set/end, so the host
      never receives an un-gestured write.
    - endAllGestures() closes everything the page left open. The editor calls it on every page
      navigation/reload and on teardown, so a reload, crash-and-reload or editor close mid-drag
      never leaves host automation stuck in "touch".

    Host -> UI state:
    - takeHostStateChange() reports values that changed since the page last saw them. Values the
      page itself wrote (via set) and values it pulled (via getState) count as seen, so the page
      never receives an echo of its own writes. Nothing is reported while a page gesture is open.

    Native function results: begin/set/end return true when the call was valid (including
    ignored duplicates) and false when the arguments were rejected. getState returns
    { x, y, z } (normalised [0, 1]) or false for invalid arguments.

    All member functions must be called on the message thread. Nothing here touches audio.
*/
class SurfaceNativeBridge
{
public:
    using Parameters = std::array<juce::RangedAudioParameter*, numParameters>;

    explicit SurfaceNativeBridge (Parameters parametersToUse);

    /** Looks up surface_x/y/z in the given state. Missing parameters are left as nullptr. */
    static Parameters findParameters (juce::AudioProcessorValueTreeState& state);

    /** Ends every gesture that is still open. */
    ~SurfaceNativeBridge();

    juce::var beginGesture (const juce::Array<juce::var>& args);
    juce::var setParameter (const juce::Array<juce::var>& args);
    juce::var endGesture (const juce::Array<juce::var>& args);
    juce::var getState (const juce::Array<juce::var>& args);

    /** Closes all open gestures (page navigation, reload or teardown). Returns how many were open. */
    int endAllGestures();

    bool isGestureOpen (int index) const noexcept;
    int getNumOpenGestures() const noexcept;

    /** A { x, y, z } payload if host-side values differ from what the page has seen. */
    std::optional<juce::var> takeHostStateChange();

    /** Makes the next takeHostStateChange() report the full state (e.g. after a page load). */
    void invalidateSeenState() noexcept   { seenStateValid = false; }

private:
    std::array<float, numParameters> readValues() const;
    juce::var makePayload (const std::array<float, numParameters>& values) const;
    void open (int index);
    void close (int index);

    Parameters parameters;
    std::array<bool, numParameters> gestureOpen {};
    std::array<float, numParameters> seenValues {};
    bool seenStateValid = false;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (SurfaceNativeBridge)
};
} // namespace lqsurface
