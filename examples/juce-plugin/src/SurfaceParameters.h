#pragma once

#include <array>

/** Shared constants of the lq-surface host contract (see docs/architecture.md).

    These must stay in sync with @lowquo/surface (PARAMETER_IDS) and @lowquo/surface-juce
    (NATIVE_FUNCTIONS / HOST_STATE_EVENT).
*/
namespace lqsurface
{
inline constexpr int numParameters = 3;

/** Host parameter IDs, ordered x, y, z. Each is normalised [0, 1] with default 0.5. */
inline constexpr std::array<const char*, numParameters> parameterIds { "surface_x", "surface_y", "surface_z" };

/** Display names shown by hosts. IDs above are the stable contract; names are cosmetic. */
inline constexpr std::array<const char*, numParameters> parameterNames { "Surface X", "Surface Y", "Surface Z" };

/** Keys used in the surfaceHostState / surfaceGetState payloads ({ x, y, z } normalised values). */
inline constexpr std::array<const char*, numParameters> stateKeys { "x", "y", "z" };

inline constexpr float defaultNormalisedValue = 0.5f;

/** Parameter version hint for juce::ParameterID (VST3/AU parameter identity). */
inline constexpr int parameterVersionHint = 1;

namespace native
{
    inline constexpr const char* beginGesture   = "surfaceBeginGesture";
    inline constexpr const char* setParameter   = "surfaceSetParameter";
    inline constexpr const char* endGesture     = "surfaceEndGesture";
    inline constexpr const char* getState       = "surfaceGetState";
    inline constexpr const char* hostStateEvent = "surfaceHostState";
}
} // namespace lqsurface
