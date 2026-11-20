#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>

#include "PluginProcessor.h"
#include "SurfaceNativeBridge.h"
#include "SurfaceWebResources.h"

/** Hosts the bundled web UI in a WebBrowserComponent.

    - Only bundled resources are served (resource provider backed by the embedded ZIP); the
      WebView never navigates away from the resource-provider root, http(s) links open in the
      system browser and new-window requests never create a window.
    - Native functions are validated and gesture-balanced by lqsurface::SurfaceNativeBridge.
    - Host -> UI updates use change detection on the message thread, plus surfaceGetState for an
      initial pull when the page loads (editor reopen, project recall).
*/
class SurfaceExampleEditor final : public juce::AudioProcessorEditor,
                                   private juce::Timer
{
public:
    explicit SurfaceExampleEditor (SurfaceExampleProcessor&);
    ~SurfaceExampleEditor() override;

    void resized() override;

private:
    class Browser;

    juce::WebBrowserComponent::Options createBrowserOptions();
    std::optional<juce::WebBrowserComponent::Resource> serveResource (const juce::String& path) const;
    bool handleNavigation (const juce::String& url);
    void handleNewWindow (const juce::String& url);
    void handlePageLoaded (const juce::String& url);
    void openInSystemBrowser (const juce::String& url);
    void timerCallback() override;

    // Declared before the browser so that they outlive it: the browser's resource provider and
    // native functions refer to them.
    lqsurface::EmbeddedUiArchive archive;
    lqsurface::SurfaceNativeBridge bridge;
    lqsurface::ExternalLinkThrottle linkThrottle;
    bool pageReady = false;

    std::unique_ptr<Browser> browser;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (SurfaceExampleEditor)
};
