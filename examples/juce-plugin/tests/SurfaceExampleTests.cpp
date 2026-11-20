// Headless native tests for the lq-surface JUCE example (run via ctest).
//
// Covers: parameter layout, state save/restore (including hostile payloads), multiple-instance
// isolation, bit-exact passthrough, strict native-function validation, gesture balance (reload
// mid-gesture, teardown), host -> UI change detection, navigation policy and the embedded UI ZIP.
// No window, editor or WebView is created.

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>

#include "EmbeddedAssets.h"
#include "PluginProcessor.h"
#include "SurfaceNativeBridge.h"
#include "SurfaceParameters.h"
#include "SurfaceWebResources.h"

#include <cmath>
#include <cstring>
#include <iostream>
#include <limits>
#include <map>

namespace
{
using Args = juce::Array<juce::var>;
using lqsurface::SurfaceNativeBridge;

constexpr const char* testCategory = "lq-surface";

/** Parses a JSON array exactly as JUCE parses the arguments of a native function call. */
Args argsFromJson (const juce::String& json)
{
    const auto parsed = juce::JSON::parse (json);
    jassert (parsed.isArray());
    return parsed.isArray() ? *parsed.getArray() : Args {};
}

Args args (std::initializer_list<juce::var> values)
{
    Args result;

    for (const auto& v : values)
        result.add (v);

    return result;
}

/** Records host-facing gesture/value notifications of a processor, in order. */
struct HostRecorder final : public juce::AudioProcessorListener
{
    explicit HostRecorder (juce::AudioProcessor& p) : processor (p)   { processor.addListener (this); }
    ~HostRecorder() override                                         { processor.removeListener (this); }

    void audioProcessorParameterChanged (juce::AudioProcessor*, int index, float value) override
    {
        events.add ("set " + juce::String (index) + " " + juce::String (value, 3));
    }

    void audioProcessorChanged (juce::AudioProcessor*, const ChangeDetails&) override {}

    void audioProcessorParameterChangeGestureBegin (juce::AudioProcessor*, int index) override
    {
        events.add ("begin " + juce::String (index));
        ++open[index];
    }

    void audioProcessorParameterChangeGestureEnd (juce::AudioProcessor*, int index) override
    {
        events.add ("end " + juce::String (index));
        --open[index];
    }

    int count (const juce::String& prefix) const
    {
        int n = 0;

        for (const auto& e : events)
            n += e.startsWith (prefix) ? 1 : 0;

        return n;
    }

    bool balanced() const
    {
        for (const auto& [index, depth] : open)
            if (depth != 0)
                return false;

        return true;
    }

    void clear()   { events.clear(); open.clear(); }

    juce::AudioProcessor& processor;
    juce::StringArray events;
    std::map<int, int> open;
};

float valueOf (SurfaceExampleProcessor& p, int index)
{
    return p.parameters.getParameter (lqsurface::parameterIds[(size_t) index])->getValue();
}

void setHostValue (SurfaceExampleProcessor& p, int index, float value)
{
    // Simulates host automation / another editor writing the parameter.
    p.parameters.getParameter (lqsurface::parameterIds[(size_t) index])->setValueNotifyingHost (value);
}

juce::MemoryBlock stateOf (SurfaceExampleProcessor& p)
{
    juce::MemoryBlock block;
    p.getStateInformation (block);
    return block;
}

juce::MemoryBlock binaryFromXml (const juce::String& xmlText)
{
    juce::MemoryBlock block;
    const auto xml = juce::parseXML (xmlText);
    jassert (xml != nullptr);
    juce::AudioProcessor::copyXmlToBinary (*xml, block);
    return block;
}

void restore (SurfaceExampleProcessor& p, const juce::MemoryBlock& block)
{
    p.setStateInformation (block.getData(), (int) block.getSize());
}

//==============================================================================
class ParameterLayoutTests final : public juce::UnitTest
{
public:
    ParameterLayoutTests() : UnitTest ("Parameter layout", testCategory) {}

    void runTest() override
    {
        SurfaceExampleProcessor processor;

        beginTest ("exactly three host parameters with the contract IDs");
        const auto& params = processor.getParameters();
        expectEquals (params.size(), 3);

        for (int i = 0; i < 3; ++i)
        {
            auto* ranged = dynamic_cast<juce::RangedAudioParameter*> (params[i]);
            expect (ranged != nullptr);

            if (ranged == nullptr)
                continue;

            expectEquals (ranged->getParameterID(), juce::String (lqsurface::parameterIds[(size_t) i]));
            expectEquals (ranged->getVersionHint(), lqsurface::parameterVersionHint);
            expectEquals (ranged->getParameterIndex(), i);
            expect (ranged->isAutomatable());
            expectEquals (ranged->getNormalisableRange().start, 0.0f);
            expectEquals (ranged->getNormalisableRange().end, 1.0f);
            expectEquals (ranged->getDefaultValue(), 0.5f);
            expectEquals (ranged->getValue(), 0.5f);
            expectEquals (ranged->getName (64), juce::String (lqsurface::parameterNames[(size_t) i]));
        }

        beginTest ("plug-in characteristics");
        expect (processor.hasEditor());
        expect (! processor.acceptsMidi());
        expect (! processor.producesMidi());
        expect (! processor.isMidiEffect());
        expectEquals (processor.getTailLengthSeconds(), 0.0);
        expectEquals (processor.getTotalNumInputChannels(), 2);
        expectEquals (processor.getTotalNumOutputChannels(), 2);

        juce::AudioProcessor::BusesLayout stereo, mono, mixed;
        stereo.inputBuses.add (juce::AudioChannelSet::stereo());
        stereo.outputBuses.add (juce::AudioChannelSet::stereo());
        mono.inputBuses.add (juce::AudioChannelSet::mono());
        mono.outputBuses.add (juce::AudioChannelSet::mono());
        mixed.inputBuses.add (juce::AudioChannelSet::stereo());
        mixed.outputBuses.add (juce::AudioChannelSet::mono());
        expect (processor.checkBusesLayoutSupported (stereo));
        expect (! processor.checkBusesLayoutSupported (mono));
        expect (! processor.checkBusesLayoutSupported (mixed));
    }
};

//==============================================================================
class PassthroughTests final : public juce::UnitTest
{
public:
    PassthroughTests() : UnitTest ("Bit-exact passthrough", testCategory) {}

    void runTest() override
    {
        SurfaceExampleProcessor processor;
        processor.prepareToPlay (48000.0, 4096);

        // Automation must not affect audio either.
        setHostValue (processor, 0, 1.0f);
        setHostValue (processor, 2, 0.0f);

        auto random = getRandom();

        for (const auto numSamples : { 1, 17, 64, 512, 4096 })
        {
            beginTest ("block of " + juce::String (numSamples) + " samples is unchanged");

            juce::AudioBuffer<float> buffer (2, numSamples);

            for (int ch = 0; ch < 2; ++ch)
                for (int i = 0; i < numSamples; ++i)
                    buffer.setSample (ch, i, random.nextFloat() * 2.0f - 1.0f);

            // Special values: denormal, signed zero, infinities, NaN, extremes.
            const float specials[] { 1.0e-40f, -0.0f, std::numeric_limits<float>::infinity(),
                                     -std::numeric_limits<float>::infinity(),
                                     std::numeric_limits<float>::quiet_NaN(),
                                     std::numeric_limits<float>::max(),
                                     std::numeric_limits<float>::lowest(),
                                     std::numeric_limits<float>::denorm_min() };

            for (size_t k = 0; k < std::size (specials) && (int) k < numSamples; ++k)
                buffer.setSample ((int) (k % 2), (int) k, specials[k]);

            juce::AudioBuffer<float> reference;
            reference.makeCopyOf (buffer);

            juce::MidiBuffer midi;
            midi.addEvent (juce::MidiMessage::noteOn (1, 60, (juce::uint8) 100), 0);
            processor.processBlock (buffer, midi);

            for (int ch = 0; ch < 2; ++ch)
                expect (std::memcmp (buffer.getReadPointer (ch), reference.getReadPointer (ch),
                                     sizeof (float) * (size_t) numSamples) == 0,
                        "channel " + juce::String (ch) + " differs");
        }

        processor.releaseResources();
    }
};

//==============================================================================
class StateTests final : public juce::UnitTest
{
public:
    StateTests() : UnitTest ("State save/restore", testCategory) {}

    void runTest() override
    {
        beginTest ("round trip restores exact values");
        {
            SurfaceExampleProcessor a, b;
            setHostValue (a, 0, 0.25f);
            setHostValue (a, 1, 0.75f);
            setHostValue (a, 2, 0.125f);
            restore (b, stateOf (a));

            for (int i = 0; i < 3; ++i)
                expectEquals (valueOf (b, i), valueOf (a, i));

            // And again from b, to make sure the restored tree is itself saveable.
            SurfaceExampleProcessor c;
            restore (c, stateOf (b));

            for (int i = 0; i < 3; ++i)
                expectEquals (valueOf (c, i), valueOf (a, i));
        }

        beginTest ("wrong XML tag is ignored");
        {
            SurfaceExampleProcessor p;
            setHostValue (p, 0, 0.3f);
            restore (p, binaryFromXml ("<NotSurfaceState><PARAM id=\"surface_x\" value=\"0.9\"/></NotSurfaceState>"));
            expectEquals (valueOf (p, 0), 0.3f);
            expectEquals (valueOf (p, 1), 0.5f);
        }

        beginTest ("garbage, empty, null and truncated data are ignored");
        {
            SurfaceExampleProcessor source, p;
            setHostValue (source, 1, 0.9f);
            const auto valid = stateOf (source);
            setHostValue (p, 1, 0.2f);

            const char garbage[] = "definitely not a JUCE state blob";
            p.setStateInformation (garbage, (int) sizeof (garbage));
            p.setStateInformation (nullptr, 0);
            p.setStateInformation (garbage, 0);
            p.setStateInformation (garbage, -5);
            p.setStateInformation (valid.getData(), (int) valid.getSize() / 2);
            expectEquals (valueOf (p, 1), 0.2f);
        }

        beginTest ("hostile values are sanitised, unknown children dropped, missing params defaulted");
        {
            SurfaceExampleProcessor p;
            setHostValue (p, 0, 0.1f);
            setHostValue (p, 1, 0.1f);
            setHostValue (p, 2, 0.1f);
            restore (p, binaryFromXml ("<SurfaceState>"
                                       "<PARAM id=\"surface_x\" value=\"nan\"/>"
                                       "<PARAM id=\"surface_y\" value=\"7\"/>"
                                       "<PARAM id=\"evil\" value=\"1\"/>"
                                       "<OTHER id=\"surface_z\" value=\"0.9\"/>"
                                       "</SurfaceState>"));
            expectEquals (valueOf (p, 0), 0.5f); // non-numeric -> default
            expectEquals (valueOf (p, 1), 1.0f); // clamped
            expectEquals (valueOf (p, 2), 0.5f); // missing (wrong child type) -> default

            const auto tree = p.parameters.copyState();
            expectEquals (tree.getNumChildren(), 3);
            expect (! tree.getChildWithProperty ("id", "evil").isValid());

            restore (p, binaryFromXml ("<SurfaceState>"
                                       "<PARAM id=\"surface_x\" value=\"-0.5\"/>"
                                       "<PARAM id=\"surface_y\" value=\"1e400\"/>"
                                       "<PARAM id=\"surface_z\" value=\"inf\"/>"
                                       "</SurfaceState>"));
            expectEquals (valueOf (p, 0), 0.0f);
            expectEquals (valueOf (p, 1), 0.5f);
            expectEquals (valueOf (p, 2), 0.5f);
        }

        beginTest ("sanitiseState rejects foreign trees");
        expect (! SurfaceExampleProcessor::sanitiseState (juce::ValueTree ("Other")).isValid());
        expect (! SurfaceExampleProcessor::sanitiseState (juce::ValueTree()).isValid());
        expectEquals (SurfaceExampleProcessor::sanitiseState (juce::ValueTree (SurfaceExampleProcessor::stateType)).getNumChildren(), 3);
    }
};

//==============================================================================
class IsolationTests final : public juce::UnitTest
{
public:
    IsolationTests() : UnitTest ("Multiple-instance isolation", testCategory) {}

    void runTest() override
    {
        SurfaceExampleProcessor a, b;
        HostRecorder recA (a), recB (b);
        SurfaceNativeBridge bridgeA (SurfaceNativeBridge::findParameters (a.parameters));
        SurfaceNativeBridge bridgeB (SurfaceNativeBridge::findParameters (b.parameters));

        beginTest ("parameter writes stay in their own instance");
        expect (bridgeA.setParameter (args ({ "surface_x", 0.9 })) == juce::var (true));
        expectEquals (valueOf (a, 0), 0.9f);
        expectEquals (valueOf (b, 0), 0.5f);

        beginTest ("gestures stay in their own instance");
        bridgeA.beginGesture (args ({ "surface_y" }));
        expect (bridgeA.isGestureOpen (1));
        expect (! bridgeB.isGestureOpen (1));
        expectEquals (recB.events.size(), 0);
        bridgeA.endAllGestures();
        expect (recA.balanced());

        beginTest ("state restore affects only the target instance");
        SurfaceExampleProcessor c;
        setHostValue (c, 2, 0.05f);
        restore (b, stateOf (c));
        expectEquals (valueOf (b, 2), 0.05f);
        expectEquals (valueOf (a, 2), 0.5f);

        beginTest ("embedded UI archives are owned per editor");
        const auto asset = lqsurface::findEmbeddedAsset (lqsurface::uiArchiveFileName);
        auto first = std::make_unique<lqsurface::EmbeddedUiArchive> (asset.data, asset.size);
        lqsurface::EmbeddedUiArchive second (asset.data, asset.size);
        expect (first->isValid() && second.isValid());
        first.reset();
        expect (second.getResource ("/").has_value());
    }
};

//==============================================================================
class ValidationTests final : public juce::UnitTest
{
public:
    ValidationTests() : UnitTest ("Native-function validation", testCategory) {}

    void runTest() override
    {
        SurfaceExampleProcessor processor;
        HostRecorder recorder (processor);
        SurfaceNativeBridge bridge (SurfaceNativeBridge::findParameters (processor.parameters));

        beginTest ("valid set calls (as parsed from JSON) are applied");
        expect (bridge.setParameter (argsFromJson ("[\"surface_x\", 0]")) == juce::var (true));
        expectEquals (valueOf (processor, 0), 0.0f);
        expect (bridge.setParameter (argsFromJson ("[\"surface_x\", 1]")) == juce::var (true));
        expectEquals (valueOf (processor, 0), 1.0f);
        expect (bridge.setParameter (argsFromJson ("[\"surface_y\", 0.25]")) == juce::var (true));
        expectEquals (valueOf (processor, 1), 0.25f);
        expect (bridge.setParameter (args ({ "surface_z", juce::var ((juce::int64) 1) })) == juce::var (true));
        expectEquals (valueOf (processor, 2), 1.0f);
        expect (bridge.setParameter (args ({ "surface_z", juce::var (-0.0) })) == juce::var (true));
        expectEquals (valueOf (processor, 2), 0.0f);

        beginTest ("hostile set calls are rejected without touching the host");
        const juce::StringArray hostileJson {
            "[]",
            "[\"surface_x\"]",
            "[\"surface_x\", 0.5, 0]",
            "[\"surface_x\", 0.5, null]",
            "[0.5, \"surface_x\"]",
            "[\"SURFACE_X\", 0.5]",
            "[\"surface_x \", 0.5]",
            "[\" surface_x\", 0.5]",
            "[\"surface_w\", 0.5]",
            "[\"\", 0.5]",
            "[null, 0.5]",
            "[true, 0.5]",
            "[1, 0.5]",
            "[[\"surface_x\"], 0.5]",
            "[{\"id\": \"surface_x\"}, 0.5]",
            "[\"surface_x\", \"0.5\"]",
            "[\"surface_x\", true]",
            "[\"surface_x\", false]",
            "[\"surface_x\", null]",
            "[\"surface_x\", -0.0001]",
            "[\"surface_x\", 1.0001]",
            "[\"surface_x\", 2]",
            "[\"surface_x\", -1]",
            "[\"surface_x\", 1e400]",
            "[\"surface_x\", -1e400]",
            "[\"surface_x\", [0.5]]",
            "[\"surface_x\", {\"value\": 0.5}]",
            "[\"__proto__\", 0.5]",
            "[\"surfaceBeginGesture\", 0.5]",
        };

        recorder.clear();
        const auto before = std::array<float, 3> { valueOf (processor, 0), valueOf (processor, 1), valueOf (processor, 2) };

        for (const auto& json : hostileJson)
            expect (bridge.setParameter (argsFromJson (json)) == juce::var (false), "accepted " + json);

        const auto nan = std::numeric_limits<double>::quiet_NaN();
        const auto inf = std::numeric_limits<double>::infinity();

        for (const auto& hostile : { args ({ "surface_x", nan }),
                                     args ({ "surface_x", inf }),
                                     args ({ "surface_x", -inf }),
                                     args ({ "surface_x", juce::var() }),
                                     args ({ "surface_x", juce::var::undefined() }),
                                     args ({ juce::var ("surface_x"), juce::var (juce::MemoryBlock ("x", 1)) }) })
            expect (bridge.setParameter (hostile) == juce::var (false));

        for (int i = 0; i < 3; ++i)
            expectEquals (valueOf (processor, i), before[(size_t) i]);

        expectEquals (recorder.events.size(), 0);
        expectEquals (bridge.getNumOpenGestures(), 0);

        beginTest ("hostile begin/end calls are rejected and open nothing");
        for (const auto* json : { "[]", "[\"surface_x\", 1]", "[1]", "[\"surface_q\"]", "[true]", "[null]",
                                  "[[\"surface_x\"]]", "[{\"0\": \"surface_x\"}]" })
        {
            expect (bridge.beginGesture (argsFromJson (json)) == juce::var (false), json);
            expect (bridge.endGesture (argsFromJson (json)) == juce::var (false), json);
        }

        expectEquals (bridge.getNumOpenGestures(), 0);
        expectEquals (recorder.events.size(), 0);

        beginTest ("getState takes no arguments");
        expect (bridge.getState (argsFromJson ("[1]")) == juce::var (false));
        expect (bridge.getState (argsFromJson ("[null]")) == juce::var (false));
        const auto state = bridge.getState ({});
        expect (state.isObject());
        expectEquals ((double) state["x"], (double) valueOf (processor, 0));
        expectEquals ((double) state["y"], (double) valueOf (processor, 1));
        expectEquals ((double) state["z"], (double) valueOf (processor, 2));

        beginTest ("null parameters (misconfigured processor) are rejected");
        SurfaceNativeBridge empty ({});
        expect (empty.beginGesture (args ({ "surface_x" })) == juce::var (false));
        expect (empty.setParameter (args ({ "surface_x", 0.5 })) == juce::var (false));
        expect (empty.endGesture (args ({ "surface_x" })) == juce::var (false));
    }
};

//==============================================================================
class GestureBalanceTests final : public juce::UnitTest
{
public:
    GestureBalanceTests() : UnitTest ("Gesture balance", testCategory) {}

    void runTest() override
    {
        SurfaceExampleProcessor processor;
        HostRecorder recorder (processor);

        beginTest ("begin/set/end is forwarded in order");
        {
            SurfaceNativeBridge bridge (SurfaceNativeBridge::findParameters (processor.parameters));
            recorder.clear();
            expect (bridge.beginGesture (args ({ "surface_x" })) == juce::var (true));
            expect (bridge.setParameter (args ({ "surface_x", 0.75 })) == juce::var (true));
            expect (bridge.endGesture (args ({ "surface_x" })) == juce::var (true));
            expectEquals (recorder.events.joinIntoString (","), juce::String ("begin 0,set 0 0.750,end 0"));
        }

        beginTest ("duplicate begin and unmatched end are ignored");
        {
            SurfaceNativeBridge bridge (SurfaceNativeBridge::findParameters (processor.parameters));
            recorder.clear();
            expect (bridge.beginGesture (args ({ "surface_y" })) == juce::var (true));
            expect (bridge.beginGesture (args ({ "surface_y" })) == juce::var (true));
            expectEquals (recorder.count ("begin"), 1);
            expect (bridge.endGesture (args ({ "surface_y" })) == juce::var (true));
            expect (bridge.endGesture (args ({ "surface_y" })) == juce::var (true));
            expect (bridge.endGesture (args ({ "surface_z" })) == juce::var (true));
            expectEquals (recorder.count ("end"), 1);
            expect (recorder.balanced());
        }

        beginTest ("set without begin is a self-contained gesture");
        {
            SurfaceNativeBridge bridge (SurfaceNativeBridge::findParameters (processor.parameters));
            recorder.clear();
            expect (bridge.setParameter (args ({ "surface_z", 0.25 })) == juce::var (true));
            expectEquals (recorder.events.joinIntoString (","), juce::String ("begin 2,set 2 0.250,end 2"));
            expect (! bridge.isGestureOpen (2));
            expect (recorder.balanced());
        }

        beginTest ("page reload mid-gesture closes everything; stale ends are ignored");
        {
            SurfaceNativeBridge bridge (SurfaceNativeBridge::findParameters (processor.parameters));
            recorder.clear();

            for (const auto* id : lqsurface::parameterIds)
                bridge.beginGesture (args ({ id }));

            bridge.setParameter (args ({ "surface_x", 0.6 }));
            expectEquals (bridge.getNumOpenGestures(), 3);
            expect (! recorder.balanced());

            expectEquals (bridge.endAllGestures(), 3); // what the editor does in pageAboutToLoad
            expectEquals (bridge.getNumOpenGestures(), 0);
            expect (recorder.balanced());

            // Messages still in flight from the old page.
            bridge.endGesture (args ({ "surface_x" }));
            expectEquals (recorder.count ("end"), 3);
            expect (recorder.balanced());

            // The new page can start over.
            bridge.beginGesture (args ({ "surface_x" }));
            expect (bridge.isGestureOpen (0));
            bridge.endGesture (args ({ "surface_x" }));
            expectEquals (bridge.endAllGestures(), 0);
            expect (recorder.balanced());
        }

        beginTest ("destroying the bridge (editor close mid-drag) ends open gestures");
        {
            recorder.clear();
            {
                SurfaceNativeBridge bridge (SurfaceNativeBridge::findParameters (processor.parameters));
                bridge.beginGesture (args ({ "surface_x" }));
                bridge.beginGesture (args ({ "surface_z" }));
                bridge.setParameter (args ({ "surface_z", 0.9 }));
            }
            expectEquals (recorder.count ("begin"), 2);
            expectEquals (recorder.count ("end"), 2);
            expect (recorder.balanced());
        }

        beginTest ("randomised call sequences always leave the host balanced");
        {
            auto random = getRandom();
            recorder.clear();

            for (int round = 0; round < 50; ++round)
            {
                SurfaceNativeBridge bridge (SurfaceNativeBridge::findParameters (processor.parameters));

                for (int step = 0; step < 40; ++step)
                {
                    const auto* id = lqsurface::parameterIds[(size_t) random.nextInt (3)];

                    switch (random.nextInt (5))
                    {
                        case 0:  bridge.beginGesture (args ({ id })); break;
                        case 1:  bridge.endGesture (args ({ id })); break;
                        case 2:  bridge.setParameter (args ({ id, random.nextDouble() })); break;
                        case 3:  bridge.setParameter (args ({ id, random.nextDouble() * 4.0 - 2.0 })); break;
                        default: if (random.nextInt (10) == 0) bridge.endAllGestures(); break;
                    }

                    for (const auto& [index, depth] : recorder.open)
                        expect (depth == 0 || depth == 1, "nested gesture on parameter " + juce::String (index));
                }
            }

            expect (recorder.balanced());
        }
    }
};

//==============================================================================
class HostStateTests final : public juce::UnitTest
{
public:
    HostStateTests() : UnitTest ("Host -> UI state", testCategory) {}

    void runTest() override
    {
        SurfaceExampleProcessor processor;
        SurfaceNativeBridge bridge (SurfaceNativeBridge::findParameters (processor.parameters));

        beginTest ("first poll reports the full state, then nothing until something changes");
        auto change = bridge.takeHostStateChange();
        expect (change.has_value());
        if (change.has_value())
        {
            expectEquals ((double) (*change)["x"], 0.5);
            expectEquals ((double) (*change)["y"], 0.5);
            expectEquals ((double) (*change)["z"], 0.5);
        }
        expect (! bridge.takeHostStateChange().has_value());

        beginTest ("host automation is reported once");
        setHostValue (processor, 0, 0.8f);
        change = bridge.takeHostStateChange();
        expect (change.has_value());
        if (change.has_value())
            expectEquals ((double) (*change)["x"], (double) 0.8f);
        expect (! bridge.takeHostStateChange().has_value());

        beginTest ("the page's own writes are never echoed back");
        bridge.beginGesture (args ({ "surface_x" }));
        bridge.setParameter (args ({ "surface_x", 0.3 }));
        bridge.endGesture (args ({ "surface_x" }));
        bridge.setParameter (args ({ "surface_y", 0.1 }));
        expect (! bridge.takeHostStateChange().has_value());

        beginTest ("nothing is reported while a page gesture is open");
        bridge.beginGesture (args ({ "surface_z" }));
        setHostValue (processor, 1, 0.9f);
        expect (! bridge.takeHostStateChange().has_value());
        bridge.endGesture (args ({ "surface_z" }));
        change = bridge.takeHostStateChange();
        expect (change.has_value());
        if (change.has_value())
            expectEquals ((double) (*change)["y"], (double) 0.9f);

        beginTest ("getState counts as seen; invalidation forces a report (page load)");
        setHostValue (processor, 2, 0.2f);
        const auto pulled = bridge.getState ({});
        expectEquals ((double) pulled["z"], (double) 0.2f);
        expect (! bridge.takeHostStateChange().has_value());
        bridge.invalidateSeenState();
        expect (bridge.takeHostStateChange().has_value());

        beginTest ("payload is JSON with x/y/z numbers only");
        const auto json = juce::JSON::toString (pulled, true);
        const auto reparsed = juce::JSON::parse (json);
        expect (reparsed.isObject());
        expectEquals (reparsed.getDynamicObject()->getProperties().size(), 3);
        for (const auto* key : lqsurface::stateKeys)
            expect (reparsed[key].isDouble() || reparsed[key].isInt(), key);
    }
};

//==============================================================================
class NavigationTests final : public juce::UnitTest
{
public:
    NavigationTests() : UnitTest ("Navigation policy", testCategory) {}

    void runTest() override
    {
        using lqsurface::NavigationDecision;
        using lqsurface::classifyNavigation;

        for (const juce::String root : { "juce://juce.backend/", "https://juce.backend/" })
        {
            beginTest ("root " + root);

            for (const auto& url : { root, root + "index.html", root + "assets/index-abc.js", juce::String ("about:blank") })
                expect (classifyNavigation (url, root) == NavigationDecision::allow, url);

            for (const auto* url : { "https://github.com/Lowquo/lq-surface", "http://lowquo.io", "HTTPS://EXAMPLE.COM/x",
                                     "https://juce.backend.evil.example/" })
                expect (classifyNavigation (url, root) == NavigationDecision::openExternally, url);

            for (const auto* url : { "", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,<script>1</script>",
                                     "juce://juce.backend.evil/", "juce://other/", "about:srcdoc", "about:blank#x",
                                     "blob:juce://juce.backend/1234", "ftp://example.com", "https:/missing-slash",
                                     "mailto:someone@example.com", "vbscript:x" })
                expect (classifyNavigation (url, root) == NavigationDecision::block, url);

            expect (classifyNavigation ("https://" + juce::String::repeatedString ("a", 5000), root) == NavigationDecision::block);
        }

        beginTest ("an empty resource root never allows prefix matches");
        expect (classifyNavigation ("juce://juce.backend/", {}) == NavigationDecision::block);

        beginTest ("external links are rate limited");
        lqsurface::ExternalLinkThrottle throttle (1000);
        expect (throttle.tryAcquire (5000));
        expect (! throttle.tryAcquire (5001));
        expect (! throttle.tryAcquire (5999));
        expect (throttle.tryAcquire (6000));
        lqsurface::ExternalLinkThrottle wrapping (1000);
        expect (wrapping.tryAcquire (0xffffff00u));
        expect (wrapping.tryAcquire (0x00000400u)); // counter wrapped; 1280 ms later
    }
};

//==============================================================================
class ResourceTests final : public juce::UnitTest
{
public:
    ResourceTests() : UnitTest ("Embedded UI resources", testCategory) {}

    void runTest() override
    {
        using lqsurface::normaliseResourcePath;

        beginTest ("request paths are normalised strictly");
        expect (normaliseResourcePath ("/") == juce::String ("index.html"));
        expect (normaliseResourcePath ("") == juce::String ("index.html"));
        expect (normaliseResourcePath ("/index.html") == juce::String ("index.html"));
        expect (normaliseResourcePath ("/assets/a.js?v=1") == juce::String ("assets/a.js"));
        expect (normaliseResourcePath ("/assets/a.css#x") == juce::String ("assets/a.css"));

        for (const auto* bad : { "/../secret", "/assets/../index.html", "//evil", "/a\\b", "/C:/x", "/assets/",
                                 "/a//b", "/a\x01" "b", "/a\x7f" "b" })
            expect (! normaliseResourcePath (bad).has_value(), bad);

        expect (! normaliseResourcePath ("/" + juce::String::repeatedString ("a", 2000)).has_value());

        beginTest ("MIME types");
        expectEquals (lqsurface::mimeTypeForPath ("index.html"), juce::String ("text/html"));
        expectEquals (lqsurface::mimeTypeForPath ("assets/A.JS"), juce::String ("text/javascript"));
        expectEquals (lqsurface::mimeTypeForPath ("assets/a.css"), juce::String ("text/css"));
        expectEquals (lqsurface::mimeTypeForPath ("x.woff2"), juce::String ("font/woff2"));
        expectEquals (lqsurface::mimeTypeForPath ("x.unknown"), juce::String ("application/octet-stream"));
        expectEquals (lqsurface::mimeTypeForPath ("dir.v1/noext"), juce::String ("application/octet-stream"));

        beginTest ("the embedded archive is found by its original file name");
        const auto asset = lqsurface::findEmbeddedAsset (lqsurface::uiArchiveFileName);
        expect (asset.data != nullptr && asset.size > 0);
        // juceaide mangles "surface-ui.zip" to "surfaceui_zip"; the old "surface_ui_zip" lookup failed.
        expect (lqsurface::findEmbeddedAsset ("surface_ui_zip").data == nullptr);
        expect (lqsurface::findEmbeddedAsset (nullptr).data == nullptr);

        lqsurface::EmbeddedUiArchive archive (asset.data, asset.size);
        expect (archive.isValid());

        beginTest ("index.html is served and every asset it references resolves");
        const auto index = archive.getResource ("/");
        expect (index.has_value());

        if (index.has_value())
        {
            expectEquals (index->mimeType, juce::String ("text/html"));
            const auto html = juce::String::fromUTF8 (reinterpret_cast<const char*> (index->data.data()),
                                                      (int) index->data.size());
            expect (html.trimStart().startsWithIgnoreCase ("<!doctype html"));

            int referenced = 0;

            for (const auto* attribute : { "src=\"", "href=\"" })
            {
                for (auto rest = html.fromFirstOccurrenceOf (attribute, false, false); rest.isNotEmpty();
                     rest = rest.fromFirstOccurrenceOf (attribute, false, false))
                {
                    const auto target = rest.upToFirstOccurrenceOf ("\"", false, false);
                    expect (! target.containsIgnoreCase ("://"), "index.html references remote " + target);

                    if (target.startsWith ("./"))
                    {
                        ++referenced;
                        expect (archive.getResource ("/" + target.substring (2)).has_value(), target);
                    }
                }
            }

            expect (referenced >= 1, "index.html references no bundled assets");
        }

        beginTest ("every archive entry is servable with a sensible MIME type");
        {
            juce::MemoryInputStream stream (asset.data, asset.size, false);
            juce::ZipFile zip (stream);
            expectEquals (archive.getNumEntries(), zip.getNumEntries());

            for (int i = 0; i < zip.getNumEntries(); ++i)
            {
                const auto& name = zip.getEntry (i)->filename;
                const auto resource = archive.getResource ("/" + name);
                expect (resource.has_value(), name);

                if (resource.has_value())
                {
                    expectEquals ((juce::int64) resource->data.size(), zip.getEntry (i)->uncompressedSize);
                    expect (resource->mimeType != "application/octet-stream", name);
                }
            }
        }

        beginTest ("unknown and traversal requests are refused");
        expect (! archive.getResource ("/nope.js").has_value());
        expect (! archive.getResource ("/../index.html").has_value());
        expect (! archive.getResource ("/assets/../index.html").has_value());

        beginTest ("invalid archives are reported, with a fallback page");
        const char garbage[] = "not a zip";
        lqsurface::EmbeddedUiArchive broken (garbage, sizeof (garbage));
        expect (! broken.isValid());
        expect (! broken.getResource ("/").has_value());
        lqsurface::EmbeddedUiArchive none (nullptr, 0);
        expect (! none.isValid());
        expectEquals (lqsurface::EmbeddedUiArchive::missingArchivePage().mimeType, juce::String ("text/html"));
    }
};

ParameterLayoutTests parameterLayoutTests;
PassthroughTests passthroughTests;
StateTests stateTests;
IsolationTests isolationTests;
ValidationTests validationTests;
GestureBalanceTests gestureBalanceTests;
HostStateTests hostStateTests;
NavigationTests navigationTests;
ResourceTests resourceTests;
} // namespace

int main()
{
    // Initialises the MessageManager (APVTS uses a Timer); no window is ever created.
    const juce::ScopedJuceInitialiser_GUI juceInitialiser;

    juce::UnitTestRunner runner;
    runner.setAssertOnFailure (false);
    runner.runTestsInCategory (testCategory, 0x5eed);

    int passes = 0, failures = 0;

    for (int i = 0; i < runner.getNumResults(); ++i)
    {
        const auto* result = runner.getResult (i);
        passes += result->passes;
        failures += result->failures;

        for (const auto& message : result->messages)
            std::cerr << "FAIL: " << result->unitTestName << " / " << result->subcategoryName << ": " << message << '\n';
    }

    std::cout << "lq-surface native tests: " << runner.getNumResults() << " groups, "
              << passes << " passed, " << failures << " failed" << std::endl;

    return failures == 0 && passes > 0 ? 0 : 1;
}
