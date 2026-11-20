#pragma once

#include <cstddef>

namespace lqsurface
{
struct EmbeddedAsset
{
    const char* data = nullptr;
    size_t size = 0;
};

/** Finds a juce_add_binary_data resource by its original file name (e.g. "surface-ui.zip").

    Looking the resource up through BinaryData::originalFilenames avoids depending on juceaide's
    identifier mangling ("surface-ui.zip" becomes "surfaceui_zip", not "surface_ui_zip").
    Returns an empty asset if no such resource was embedded.
*/
EmbeddedAsset findEmbeddedAsset (const char* originalFileName);

inline constexpr const char* uiArchiveFileName = "surface-ui.zip";
} // namespace lqsurface
