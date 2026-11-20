# JUCE WebView plugin example (not lq-hit)

This demonstrates **host-automatable** x/y/z parameters connected to a bundled web UI. Audio passes through unchanged. The native plugin contains no commercial algorithms, processing chain or lq-hit proprietary DSP.

**Build prerequisites:** JUCE 9.x (supplied separately with an appropriate licence), CMake 3.22+, C++17 compiler, Node.js 22+, Python 3, platform SDKs and WebView2 on Windows. Actual macOS/Windows native builds have **not** been run as part of preparing this starter repository. Build integration may need adjustment for the specific JUCE version/host.

## Build the embedded UI archive first

At repository root:

```sh
npm install
npm run pack:juce
```

That generates `resources/surface-ui.zip` from the built Vite playground. The archive is locally generated and ignored by Git.

## Build the JUCE example

Point CMake to an independently obtained JUCE source checkout or an installed JUCE CMake package:

```sh
cmake -S examples/juce-plugin -B build/surface-juce -DJUCE_SOURCE_DIR=/absolute/path/to/JUCE
cmake --build build/surface-juce --config Release
```

On macOS the target enables AU and VST3; on Windows it enables VST3. Check the current JUCE licensing conditions. On Windows the example requires WebView2.

The UI uses JUCE's native-function bridge with `surfaceBeginGesture`, `surfaceSetParameter`, and `surfaceEndGesture`. C++ validates allowed parameter IDs and values. The browser is loaded from the plugin's **embedded** ZIP resource provider, not a remote website. The example periodically sends a `surfaceHostState` event to display host automation changes. Native parameter state is authoritative; closing/reopening the editor does not affect audio.

This is not a completed production plugin. Validate compilation, startup in real DAWs, multiple instances, automation playback, host state recall, and renderer lifecycles before use in a released product.
