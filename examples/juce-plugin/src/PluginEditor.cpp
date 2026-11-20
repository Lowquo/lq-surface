#include "PluginEditor.h"
#include <BinaryData.h>
#include <memory>
#include <cmath>

namespace {
using Resource = juce::WebBrowserComponent::Resource;

juce::ZipFile& uiArchive() {
    // BinaryData ownership is static. ZipFile retains the stream reference.
    static int size = 0;
    static const auto* bytes = BinaryData::getNamedResource("surface_ui_zip", size);
    static juce::MemoryInputStream stream(bytes, static_cast<size_t>(size), false);
    static juce::ZipFile zip(stream);
    return zip;
}

juce::String mimeFor(const juce::String& name) {
    const auto ext = name.fromLastOccurrenceOf(".", false, false).toLowerCase();
    if (ext == "html") return "text/html";
    if (ext == "js") return "text/javascript";
    if (ext == "css") return "text/css";
    if (ext == "svg") return "image/svg+xml";
    if (ext == "json" || ext == "map") return "application/json";
    if (ext == "png") return "image/png";
    if (ext == "woff2") return "font/woff2";
    return "application/octet-stream";
}
}

SurfaceExampleEditor::SurfaceExampleEditor(SurfaceExampleProcessor& p)
    : AudioProcessorEditor(&p), processor(p),
      browser(juce::WebBrowserComponent::Options{}
#if JUCE_WINDOWS
          .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
#endif
          .withNativeIntegrationEnabled()
          .withNativeFunction("surfaceBeginGesture", [this](const auto& args, auto complete) {
              const auto* param = args.size() >= 1 ? parameterFor(args[0].toString()) : nullptr;
              if (param != nullptr) param->beginChangeGesture();
              complete(param != nullptr);
          })
          .withNativeFunction("surfaceSetParameter", [this](const auto& args, auto complete) {
              auto* param = args.size() >= 2 ? parameterFor(args[0].toString()) : nullptr;
              const auto v = args.size() >= 2 ? static_cast<double>(args[1]) : -1.0;
              const bool valid = param != nullptr && std::isfinite(v) && v >= 0.0 && v <= 1.0;
              if (valid) param->setValueNotifyingHost(static_cast<float>(v));
              complete(valid);
          })
          .withNativeFunction("surfaceEndGesture", [this](const auto& args, auto complete) {
              auto* param = args.size() >= 1 ? parameterFor(args[0].toString()) : nullptr;
              if (param != nullptr) param->endChangeGesture();
              complete(param != nullptr);
          })
          .withResourceProvider([](const juce::String& path) { return getResource(path); })) {
    setSize(920, 820);
    addAndMakeVisible(browser);
    browser.goToURL(juce::WebBrowserComponent::getResourceProviderRoot());
    startTimerHz(12); // UI-only polling, not on the real-time audio thread.
}

SurfaceExampleEditor::~SurfaceExampleEditor() { stopTimer(); }

juce::RangedAudioParameter* SurfaceExampleEditor::parameterFor(const juce::String& id) const {
    if (id != "surface_x" && id != "surface_y" && id != "surface_z") return nullptr;
    return processor.parameters.getParameter(id);
}

std::optional<Resource> SurfaceExampleEditor::getResource(const juce::String& requestedPath) {
    auto name = requestedPath.trimCharactersAtStart("/");
    if (name.isEmpty()) name = "index.html";
    // Refuse traversal even though the ZIP contains trusted packaged assets only.
    if (name.contains("..") || name.containsChar('\\')) return std::nullopt;
    auto& archive = uiArchive();
    const auto* entry = archive.getEntry(name);
    if (entry == nullptr) return std::nullopt;
    std::unique_ptr<juce::InputStream> stream(archive.createStreamForEntry(*entry));
    if (stream == nullptr || entry->uncompressedSize > 10 * 1024 * 1024) return std::nullopt;
    std::vector<std::byte> bytes(static_cast<size_t>(entry->uncompressedSize));
    const auto read = stream->read(bytes.data(), static_cast<int>(bytes.size()));
    if (read != static_cast<int>(bytes.size())) return std::nullopt;
    return Resource{std::move(bytes), mimeFor(name)};
}

void SurfaceExampleEditor::timerCallback() {
    if (!browser.pageReady) return;
    // Frontend expects x/y/z, not native IDs.
    juce::DynamicObject::Ptr compact(new juce::DynamicObject());
    for (const char* axis : { "x", "y", "z" }) {
        const juce::String paramId = "surface_" + juce::String(axis);
        if (const auto* p = parameterFor(paramId)) compact->setProperty(juce::Identifier(axis), p->getValue());
    }
    browser.emitEventIfBrowserIsVisible("surfaceHostState", juce::var(compact.get()));
}

void SurfaceExampleEditor::resized() { browser.setBounds(getLocalBounds()); }
