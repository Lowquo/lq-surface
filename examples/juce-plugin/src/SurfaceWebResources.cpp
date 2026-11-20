#include "SurfaceWebResources.h"

#include <cstring>

namespace lqsurface
{
std::optional<juce::String> normaliseResourcePath (const juce::String& requestedPath)
{
    if (requestedPath.length() > 1024)
        return std::nullopt;

    auto path = requestedPath.upToFirstOccurrenceOf ("?", false, false)
                             .upToFirstOccurrenceOf ("#", false, false);

    if (path.startsWithChar ('/'))
        path = path.substring (1);

    if (path.isEmpty())
        return juce::String ("index.html");

    // Refuse traversal and anything that is not a plain relative archive path. The archive only
    // contains trusted packaged assets, but the provider should never be a generic file reader.
    if (path.startsWithChar ('/') || path.endsWithChar ('/') || path.contains ("//")
        || path.contains ("..") || path.containsChar ('\\') || path.containsChar (':'))
        return std::nullopt;

    for (auto p = path.getCharPointer(); ! p.isEmpty(); ++p)
    {
        const auto c = *p;

        if (c < 0x20 || c == 0x7f)
            return std::nullopt;
    }

    return path;
}

juce::String mimeTypeForPath (const juce::String& path)
{
    const auto fileName = path.fromLastOccurrenceOf ("/", false, false);
    const auto ext = fileName.contains (".") ? fileName.fromLastOccurrenceOf (".", false, false).toLowerCase()
                                             : juce::String();

    struct Mapping { const char* extension; const char* mime; };
    static constexpr Mapping mappings[] {
        { "html",  "text/html" },
        { "htm",   "text/html" },
        { "js",    "text/javascript" },
        { "mjs",   "text/javascript" },
        { "css",   "text/css" },
        { "json",  "application/json" },
        { "map",   "application/json" },
        { "svg",   "image/svg+xml" },
        { "png",   "image/png" },
        { "jpg",   "image/jpeg" },
        { "jpeg",  "image/jpeg" },
        { "gif",   "image/gif" },
        { "webp",  "image/webp" },
        { "ico",   "image/vnd.microsoft.icon" },
        { "woff",  "font/woff" },
        { "woff2", "font/woff2" },
        { "ttf",   "font/ttf" },
        { "otf",   "font/otf" },
        { "txt",   "text/plain" },
        { "wasm",  "application/wasm" },
    };

    for (const auto& m : mappings)
        if (ext == m.extension)
            return m.mime;

    return "application/octet-stream";
}

//==============================================================================
EmbeddedUiArchive::EmbeddedUiArchive (const void* data, size_t sizeInBytes)
{
    if (data != nullptr && sizeInBytes > 0)
        zip = std::make_unique<juce::ZipFile> (new juce::MemoryInputStream (data, sizeInBytes, false), true);
}

EmbeddedUiArchive::~EmbeddedUiArchive() = default;

bool EmbeddedUiArchive::isValid() const noexcept
{
    return zip != nullptr && zip->getEntry ("index.html") != nullptr;
}

int EmbeddedUiArchive::getNumEntries() const noexcept
{
    return zip != nullptr ? zip->getNumEntries() : 0;
}

std::optional<juce::WebBrowserComponent::Resource> EmbeddedUiArchive::getResource (const juce::String& requestedPath) const
{
    if (zip == nullptr)
        return std::nullopt;

    const auto name = normaliseResourcePath (requestedPath);

    if (! name.has_value())
        return std::nullopt;

    const auto* entry = zip->getEntry (*name);

    if (entry == nullptr || entry->isSymbolicLink
        || entry->uncompressedSize < 0 || entry->uncompressedSize > maxEntryBytes)
        return std::nullopt;

    std::unique_ptr<juce::InputStream> stream (zip->createStreamForEntry (*entry));

    if (stream == nullptr)
        return std::nullopt;

    std::vector<std::byte> bytes (static_cast<size_t> (entry->uncompressedSize));

    if (! bytes.empty())
    {
        const auto bytesRead = stream->read (bytes.data(), bytes.size());

        if (bytesRead < 0 || static_cast<size_t> (bytesRead) != bytes.size())
            return std::nullopt;
    }

    return juce::WebBrowserComponent::Resource { std::move (bytes), mimeTypeForPath (*name) };
}

juce::WebBrowserComponent::Resource EmbeddedUiArchive::missingArchivePage()
{
    static constexpr char html[] =
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>lq-surface</title></head>"
        "<body style=\"font-family:sans-serif;background:#171923;color:#eee;padding:2em\">"
        "<h1>UI resources missing</h1>"
        "<p>The embedded web UI archive could not be opened. Run <code>npm run pack:juce</code> "
        "at the repository root and rebuild the plug-in.</p></body></html>";

    std::vector<std::byte> bytes (sizeof (html) - 1);
    std::memcpy (bytes.data(), html, bytes.size());
    return { std::move (bytes), "text/html" };
}

//==============================================================================
NavigationDecision classifyNavigation (const juce::String& url, const juce::String& resourceProviderRoot)
{
    if (url.isEmpty() || url.length() > 4096)
        return NavigationDecision::block;

    if (resourceProviderRoot.isNotEmpty() && url.startsWith (resourceProviderRoot))
        return NavigationDecision::allow;

    if (url == "about:blank")
        return NavigationDecision::allow;

    const auto scheme = url.upToFirstOccurrenceOf (":", false, false).toLowerCase();

    if ((scheme == "https" || scheme == "http") && url.substring (scheme.length()).startsWith ("://"))
        return NavigationDecision::openExternally;

    return NavigationDecision::block;
}

bool ExternalLinkThrottle::tryAcquire (juce::uint32 nowMs) noexcept
{
    // Unsigned subtraction handles the millisecond counter wrapping around.
    if (last.has_value() && nowMs - *last < interval)
        return false;

    last = nowMs;
    return true;
}
} // namespace lqsurface
