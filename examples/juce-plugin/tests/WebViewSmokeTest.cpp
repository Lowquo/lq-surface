// Optional end-to-end smoke test of the real editor: WebView + embedded UI + native functions.
//
// Creates the plug-in editor off-screen (never placed on the desktop, so no window appears),
// waits for the bundled page to load and then drives it through evaluateJavascript():
// host -> UI state, UI -> host writes, blocked navigation, reload mid-gesture and teardown
// mid-gesture. Needs a GUI session (WebKit / WebView2), so it is not part of the default ctest
// run; enable with -DLQ_SURFACE_WEBVIEW_SMOKE_TEST=ON.

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>

#include "PluginProcessor.h"

#include <cmath>
#include <functional>
#include <iostream>
#include <map>
#include <optional>

namespace
{
struct GestureCounter final : public juce::AudioProcessorListener
{
    explicit GestureCounter (juce::AudioProcessor& p) : processor (p) { processor.addListener (this); }
    ~GestureCounter() override { processor.removeListener (this); }

    void audioProcessorParameterChanged (juce::AudioProcessor*, int, float) override {}
    void audioProcessorChanged (juce::AudioProcessor*, const ChangeDetails&) override {}
    void audioProcessorParameterChangeGestureBegin (juce::AudioProcessor*, int index) override { ++depth[index]; ++begins; }
    void audioProcessorParameterChangeGestureEnd (juce::AudioProcessor*, int index) override   { --depth[index]; ++ends; }

    bool balanced() const
    {
        for (const auto& [index, d] : depth)
            if (d != 0)
                return false;

        return true;
    }

    int open (int index) const
    {
        const auto it = depth.find (index);
        return it != depth.end() ? it->second : 0;
    }

    juce::AudioProcessor& processor;
    std::map<int, int> depth;
    int begins = 0, ends = 0;
};

int failures = 0;

void check (bool condition, const juce::String& what)
{
    std::cout << (condition ? "PASS: " : "FAIL: ") << what << std::endl;
    failures += condition ? 0 : 1;
}

bool waitFor (const std::function<bool()>& condition, int timeoutMs)
{
    const auto deadline = juce::Time::getMillisecondCounter() + (juce::uint32) timeoutMs;

    while (juce::Time::getMillisecondCounter() < deadline)
    {
        if (condition())
            return true;

        juce::MessageManager::getInstance()->runDispatchLoopUntil (20);
    }

    return condition();
}

juce::WebBrowserComponent* findBrowser (juce::Component& root)
{
    for (auto* child : root.getChildren())
    {
        if (auto* browser = dynamic_cast<juce::WebBrowserComponent*> (child))
            return browser;

        if (auto* nested = findBrowser (*child))
            return nested;
    }

    return nullptr;
}

std::optional<juce::var> evaluate (juce::WebBrowserComponent& browser, const juce::String& script)
{
    std::optional<juce::var> result;
    bool done = false;

    browser.evaluateJavascript (script, [&] (juce::WebBrowserComponent::EvaluationResult r)
    {
        if (const auto* value = r.getResult())
            result = *value;

        done = true;
    });

    waitFor ([&] { return done; }, 5000);
    return result;
}

bool evaluatesTrue (juce::WebBrowserComponent& browser, const juce::String& script)
{
    const auto result = evaluate (browser, script);
    return result.has_value() && result->isBool() && static_cast<bool> (*result);
}

float valueOf (SurfaceExampleProcessor& p, const char* id)
{
    return p.parameters.getParameter (id)->getValue();
}

const juce::String pageReady = "document.readyState === 'complete' && document.querySelector('#trackball') !== null";

void invokeNative (juce::WebBrowserComponent& browser, const juce::String& name, const juce::String& jsonArgs)
{
    // The low-level JUCE protocol, as a misbehaving or crashing page would leave it.
    evaluate (browser, "window.__JUCE__.backend.emitEvent('__juce__invoke', { name: '" + name
                           + "', params: " + jsonArgs + ", resultId: 900000 + Math.floor(Math.random() * 1000) }); true");
}
} // namespace

int main()
{
    const juce::ScopedJuceInitialiser_GUI juceInitialiser;

    auto processor = std::make_unique<SurfaceExampleProcessor>();
    GestureCounter gestures (*processor);
    std::unique_ptr<juce::AudioProcessorEditor> editor (processor->createEditorAndMakeActive());
    auto* browser = editor != nullptr ? findBrowser (*editor) : nullptr;
    check (browser != nullptr, "editor contains a WebBrowserComponent");

    if (browser == nullptr)
        return 1;

    check (waitFor ([&] { return evaluatesTrue (*browser, pageReady); }, 20000), "bundled page loaded from the resource provider");
    check (evaluatesTrue (*browser, "location.href.startsWith('juce://juce.backend/') || location.href.startsWith('https://juce.backend/')"),
           "page origin is the resource-provider root");
    check (evaluatesTrue (*browser, "['surfaceBeginGesture','surfaceSetParameter','surfaceEndGesture','surfaceGetState']"
                                    ".every((f) => window.__JUCE__.initialisationData.__juce__functions.includes(f))"),
           "all four native functions are registered");
    check (evaluatesTrue (*browser, "[...document.scripts].every((s) => !s.src || s.src.startsWith(location.origin))"),
           "no remote scripts");

    // Host -> UI (automation / project recall while the editor is open).
    processor->parameters.getParameter ("surface_x")->setValueNotifyingHost (0.9f);
    check (waitFor ([&] { return evaluatesTrue (*browser, "Math.abs(Number(document.querySelector('#x').value) - 0.8) < 0.01"); }, 5000),
           "host automation reaches the UI (x slider shows 0.8)");

    // UI -> host (a slider edit is a balanced, self-contained gesture).
    const auto beginsBefore = gestures.begins;
    evaluate (*browser, "(() => { const z = document.querySelector('#z'); z.value = '0.25'; z.dispatchEvent(new Event('input')); return true; })()");
    check (waitFor ([&] { return std::abs (valueOf (*processor, "surface_z") - 0.25f) < 1.0e-6f; }, 5000),
           "UI slider writes surface_z = 0.25 to the host");
    check (waitFor ([&] { return gestures.balanced() && gestures.begins > beginsBefore; }, 5000),
           "the UI write was wrapped in balanced gestures");
    check (std::abs (valueOf (*processor, "surface_x") - 0.9f) < 1.0e-6f, "host value of x is untouched by the z edit");

    // Navigation away from the bundle is refused (file: is blocked; http(s) would go to the system browser).
    evaluate (*browser, "location.href = 'file:///etc/hosts'; true");
    waitFor ([] { return false; }, 500);
    check (evaluatesTrue (*browser, pageReady + " && !location.href.startsWith('file:')"), "navigation to file: is blocked");

    // Page reload in the middle of a gesture must not leave the host gesture open.
    invokeNative (*browser, "surfaceBeginGesture", "['surface_y']");
    check (waitFor ([&] { return gestures.open (1) == 1; }, 5000), "a gesture is open before the reload");
    evaluate (*browser, "location.reload(); true");
    check (waitFor ([&] { return gestures.balanced(); }, 5000), "reload mid-gesture ends the open gesture");
    check (waitFor ([&] { return evaluatesTrue (*browser, pageReady); }, 20000), "page reloads");
    check (waitFor ([&] { return evaluatesTrue (*browser, "Math.abs(Number(document.querySelector('#x').value) - 0.8) < 0.01"
                                                          " && Math.abs(Number(document.querySelector('#z').value) - 0.25) < 0.01"); }, 5000),
           "after reload the UI restores host state (initial surfaceGetState pull)");

    // Hostile native calls from the page are refused.
    invokeNative (*browser, "surfaceSetParameter", "['surface_x', '0.1']");
    invokeNative (*browser, "surfaceSetParameter", "['surface_x', 7]");
    invokeNative (*browser, "surfaceSetParameter", "['surface_q', 0.1]");
    waitFor ([] { return false; }, 300);
    check (std::abs (valueOf (*processor, "surface_x") - 0.9f) < 1.0e-6f, "hostile native calls do not change the host");
    check (gestures.balanced(), "hostile native calls leave gestures balanced");

    // Editor closed in the middle of a drag.
    invokeNative (*browser, "surfaceBeginGesture", "['surface_x']");
    check (waitFor ([&] { return gestures.open (0) == 1; }, 5000), "a gesture is open before the editor closes");
    processor->editorBeingDeleted (editor.get()); // what every plug-in wrapper does first
    editor.reset();
    check (gestures.balanced(), "closing the editor mid-gesture ends the open gesture");

    std::cout << "WebView smoke test: " << failures << " failure(s)" << std::endl;
    return failures == 0 ? 0 : 1;
}
