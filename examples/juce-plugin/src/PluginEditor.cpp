#include "PluginEditor.h"
#include "EmbeddedAssets.h"
#include "SurfaceParameters.h"

namespace
{
lqsurface::EmbeddedUiArchive openEmbeddedArchive()
{
    const auto asset = lqsurface::findEmbeddedAsset (lqsurface::uiArchiveFileName);
    return { asset.data, asset.size };
}

#if JUCE_WINDOWS
/** WebView2 refuses to start if it cannot write its user-data folder, and the default location
    sits next to the host executable, which is often not writable. Use a per-user folder. */
juce::File webView2UserDataFolder()
{
    for (auto base : { juce::File::getSpecialLocation (juce::File::windowsLocalAppData),
                       juce::File::getSpecialLocation (juce::File::tempDirectory) })
    {
        const auto folder = base.getChildFile ("lowquo").getChildFile ("lq-surface-example").getChildFile ("WebView2");

        if (folder.createDirectory().wasOk())
            return folder;
    }

    return {};
}
#endif
} // namespace

//==============================================================================
class SurfaceExampleEditor::Browser final : public juce::WebBrowserComponent
{
public:
    Browser (SurfaceExampleEditor& ownerIn, const Options& options)
        : WebBrowserComponent (options), owner (ownerIn) {}

    bool pageAboutToLoad (const juce::String& url) override       { return owner.handleNavigation (url); }
    void pageFinishedLoading (const juce::String& url) override    { owner.handlePageLoaded (url); }
    void newWindowAttemptingToLoad (const juce::String& url) override { owner.handleNewWindow (url); }

private:
    SurfaceExampleEditor& owner;
};

//==============================================================================
SurfaceExampleEditor::SurfaceExampleEditor (SurfaceExampleProcessor& p)
    : AudioProcessorEditor (&p),
      archive (openEmbeddedArchive()),
      bridge (lqsurface::SurfaceNativeBridge::findParameters (p.parameters))
{
    browser = std::make_unique<Browser> (*this, createBrowserOptions());
    addAndMakeVisible (*browser);
    setSize (920, 820);
    browser->goToURL (juce::WebBrowserComponent::getResourceProviderRoot());

    // Message-thread change detection only; never runs on (or touches) the audio thread.
    startTimerHz (30);
}

SurfaceExampleEditor::~SurfaceExampleEditor()
{
    stopTimer();
    // Close anything the page left open before the page disappears (editor close mid-drag).
    bridge.endAllGestures();
    browser.reset();
}

juce::WebBrowserComponent::Options SurfaceExampleEditor::createBrowserOptions()
{
    using Options = juce::WebBrowserComponent::Options;
    using Args = juce::Array<juce::var>;
    using Completion = juce::WebBrowserComponent::NativeFunctionCompletion;

    return Options {}
       #if JUCE_WINDOWS
        .withBackend (Options::Backend::webview2)
        .withWinWebView2Options (Options::WinWebView2 {}
                                     .withUserDataFolder (webView2UserDataFolder())
                                     .withStatusBarDisabled())
       #endif
        .withNativeIntegrationEnabled()
        .withNativeFunction (lqsurface::native::beginGesture,
                             [this] (const Args& args, Completion complete) { complete (bridge.beginGesture (args)); })
        .withNativeFunction (lqsurface::native::setParameter,
                             [this] (const Args& args, Completion complete) { complete (bridge.setParameter (args)); })
        .withNativeFunction (lqsurface::native::endGesture,
                             [this] (const Args& args, Completion complete) { complete (bridge.endGesture (args)); })
        .withNativeFunction (lqsurface::native::getState,
                             [this] (const Args& args, Completion complete) { complete (bridge.getState (args)); })
        // No allowed origin: only pages served from the resource-provider root can use it.
        .withResourceProvider ([this] (const juce::String& path) { return serveResource (path); });
}

std::optional<juce::WebBrowserComponent::Resource> SurfaceExampleEditor::serveResource (const juce::String& path) const
{
    if (archive.isValid())
        return archive.getResource (path);

    if (lqsurface::normaliseResourcePath (path) == juce::String ("index.html"))
        return lqsurface::EmbeddedUiArchive::missingArchivePage();

    return std::nullopt;
}

bool SurfaceExampleEditor::handleNavigation (const juce::String& url)
{
    switch (lqsurface::classifyNavigation (url, juce::WebBrowserComponent::getResourceProviderRoot()))
    {
        case lqsurface::NavigationDecision::allow:
            // The current document (and any gesture its script had open) is about to go away.
            bridge.endAllGestures();
            pageReady = false;
            return true;

        case lqsurface::NavigationDecision::openExternally:
            openInSystemBrowser (url);
            return false;

        case lqsurface::NavigationDecision::block:
            break;
    }

    return false;
}

void SurfaceExampleEditor::handleNewWindow (const juce::String& url)
{
    // Never create a second WebView. External links go to the system browser instead.
    if (lqsurface::classifyNavigation (url, juce::WebBrowserComponent::getResourceProviderRoot())
            == lqsurface::NavigationDecision::openExternally)
        openInSystemBrowser (url);
}

void SurfaceExampleEditor::handlePageLoaded (const juce::String& url)
{
    pageReady = url.startsWith (juce::WebBrowserComponent::getResourceProviderRoot());

    if (pageReady)
        bridge.invalidateSeenState();
}

void SurfaceExampleEditor::openInSystemBrowser (const juce::String& url)
{
    if (! linkThrottle.tryAcquire (juce::Time::getMillisecondCounter()))
        return;

    // Deferred so the WebView's navigation callback returns before another app is launched.
    juce::MessageManager::callAsync ([target = juce::URL (url)] { target.launchInDefaultBrowser(); });
}

void SurfaceExampleEditor::timerCallback()
{
    if (! pageReady || browser == nullptr || ! browser->isVisible())
        return;

    if (const auto payload = bridge.takeHostStateChange())
        browser->emitEventIfBrowserIsVisible (lqsurface::native::hostStateEvent, *payload);
}

void SurfaceExampleEditor::resized()
{
    if (browser != nullptr)
        browser->setBounds (getLocalBounds());
}
