#pragma once

#include <juce_gui_extra/juce_gui_extra.h>

#include <memory>
#include <optional>

namespace lqsurface
{
//==============================================================================
/** Maps a request path from the WebView resource provider to a ZIP entry name.

    "/" maps to "index.html"; a query or fragment is dropped. Paths containing "..", backslashes,
    colons, empty segments or control characters are rejected (std::nullopt).
*/
std::optional<juce::String> normaliseResourcePath (const juce::String& requestedPath);

/** MIME type for the file extension of a path; "application/octet-stream" when unknown. */
juce::String mimeTypeForPath (const juce::String& path);

//==============================================================================
/**
    The bundled web UI: a ZIP held in static BinaryData memory, read through a ZipFile that is
    owned by this object (one per editor). Nothing is shared between plug-in instances and no
    ZipFile/stream outlives its editor, so there is no static-destruction-order or unload risk.
*/
class EmbeddedUiArchive
{
public:
    /** `data` must stay valid for the lifetime of this object (BinaryData is static). */
    EmbeddedUiArchive (const void* data, size_t sizeInBytes);
    ~EmbeddedUiArchive();

    /** True if the archive opened and contains index.html. */
    bool isValid() const noexcept;

    int getNumEntries() const noexcept;

    /** Serves a request path from the archive. Entries larger than maxEntryBytes are refused. */
    std::optional<juce::WebBrowserComponent::Resource> getResource (const juce::String& requestedPath) const;

    /** A small built-in page explaining that the UI archive is missing or invalid. */
    static juce::WebBrowserComponent::Resource missingArchivePage();

    static constexpr juce::int64 maxEntryBytes = 16 * 1024 * 1024;

private:
    std::unique_ptr<juce::ZipFile> zip;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (EmbeddedUiArchive)
};

//==============================================================================
enum class NavigationDecision
{
    allow,          ///< Bundled content (resource-provider root) or JUCE's about:blank unload page.
    openExternally, ///< An http(s) link: never loaded in the WebView; may open in the system browser.
    block           ///< Anything else (file:, data:, javascript:, custom schemes...).
};

/** Classifies a navigation request. Only the resource-provider root (and about:blank, which JUCE
    uses to unload the page while the editor is hidden) may load inside the WebView, because the
    page there receives the native functions.
*/
NavigationDecision classifyNavigation (const juce::String& url, const juce::String& resourceProviderRoot);

/** Rate-limits opening links in the system browser (at most one per interval). */
class ExternalLinkThrottle
{
public:
    explicit ExternalLinkThrottle (juce::uint32 minimumIntervalMs = 1000) : interval (minimumIntervalMs) {}

    /** True if a launch is allowed at `nowMs` (e.g. juce::Time::getMillisecondCounter()). */
    bool tryAcquire (juce::uint32 nowMs) noexcept;

private:
    juce::uint32 interval;
    std::optional<juce::uint32> last;
};
} // namespace lqsurface
