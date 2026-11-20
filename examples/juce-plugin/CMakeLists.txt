cmake_minimum_required(VERSION 3.22)

# Must be set before project(). WKWebView's custom URL scheme handler (resource provider) needs
# macOS 10.13+, Apple Silicon needs 11.0+. Without this the bundle would require the build SDK.
set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "Minimum macOS version")

# JUCE 9 compiles its bundled C libraries (zlib, libpng, ...) as C, so C must be enabled.
project(LqSurfaceJuceExample VERSION 0.1.0 LANGUAGES C CXX)

option(LQ_SURFACE_BUILD_TESTS "Build the headless native test runner (run with ctest)" ON)
option(LQ_SURFACE_WEBVIEW_SMOKE_TEST "Also build/run an off-screen WebView smoke test (needs a GUI session)" OFF)

if(DEFINED JUCE_SOURCE_DIR AND EXISTS "${JUCE_SOURCE_DIR}/CMakeLists.txt")
    add_subdirectory("${JUCE_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/juce")
else()
    find_package(JUCE CONFIG REQUIRED)
endif()

set(LQ_SURFACE_UI_ARCHIVE "${CMAKE_CURRENT_SOURCE_DIR}/resources/surface-ui.zip")
if(NOT EXISTS "${LQ_SURFACE_UI_ARCHIVE}")
    message(FATAL_ERROR "Missing ${LQ_SURFACE_UI_ARCHIVE}. Run 'npm run pack:juce' at the repository root first.")
endif()

# The editor looks the archive up by its original file name ("surface-ui.zip"), so it does not
# depend on juceaide's identifier mangling (which produces BinaryData::surfaceui_zip).
juce_add_binary_data(LqSurfaceWebAssets SOURCES "${LQ_SURFACE_UI_ARCHIVE}")

# VST3 everywhere; AU only on macOS (JUCE would silently drop it elsewhere, be explicit).
set(LQ_SURFACE_FORMATS VST3)
if(APPLE)
    list(APPEND LQ_SURFACE_FORMATS AU)
endif()

juce_add_plugin(LqSurfaceExample
    COMPANY_NAME lowquo
    PRODUCT_NAME "lq-surface example"
    BUNDLE_ID io.lowquo.surface.example
    PLUGIN_MANUFACTURER_CODE LqXX         # 4 chars, at least one upper-case letter
    PLUGIN_CODE Lqsf                      # 4 chars, exactly one upper-case letter (AU requirement)
    FORMATS ${LQ_SURFACE_FORMATS}
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    NEEDS_WEB_BROWSER TRUE                # Linux only: link WebKitGTK
    NEEDS_CURL FALSE                      # no network access at plug-in runtime
    NEEDS_WEBVIEW2 TRUE                   # Windows only: WebView2LoaderStatic.lib (NuGet package)
    COPY_PLUGIN_AFTER_BUILD FALSE)        # never install into system/user plug-in folders

set(LQ_SURFACE_SOURCES
    src/EmbeddedAssets.cpp
    src/EmbeddedAssets.h
    src/PluginEditor.cpp
    src/PluginEditor.h
    src/PluginProcessor.cpp
    src/PluginProcessor.h
    src/SurfaceNativeBridge.cpp
    src/SurfaceNativeBridge.h
    src/SurfaceParameters.h
    src/SurfaceWebResources.cpp
    src/SurfaceWebResources.h)

# JUCE module configuration must be identical for every target that compiles these sources.
set(LQ_SURFACE_DEFINITIONS
    JUCE_WEB_BROWSER=1
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0)
if(WIN32)
    # Statically link the WebView2 loader: a plug-in cannot rely on WebView2Loader.dll being on
    # the host's DLL search path. Requires the Microsoft.Web.WebView2 NuGet package at build time.
    list(APPEND LQ_SURFACE_DEFINITIONS JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1)
endif()

target_sources(LqSurfaceExample PRIVATE ${LQ_SURFACE_SOURCES})
target_compile_features(LqSurfaceExample PRIVATE cxx_std_17)
target_compile_definitions(LqSurfaceExample PUBLIC ${LQ_SURFACE_DEFINITIONS})
target_link_libraries(LqSurfaceExample
    PRIVATE
        LqSurfaceWebAssets
        juce::juce_audio_processors
        juce::juce_gui_extra
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_warning_flags)

if(LQ_SURFACE_BUILD_TESTS)
    enable_testing()

    # Headless: exercises the processor, state handling, the native-function bridge, navigation
    # policy and the embedded archive. It never creates a window or a WebView.
    juce_add_console_app(LqSurfaceExampleTests
        PRODUCT_NAME "LqSurfaceExampleTests"
        NEEDS_WEB_BROWSER TRUE
        NEEDS_CURL FALSE
        NEEDS_WEBVIEW2 TRUE)

    target_sources(LqSurfaceExampleTests PRIVATE tests/SurfaceExampleTests.cpp ${LQ_SURFACE_SOURCES})
    target_include_directories(LqSurfaceExampleTests PRIVATE src)
    target_compile_features(LqSurfaceExampleTests PRIVATE cxx_std_17)
    target_compile_definitions(LqSurfaceExampleTests PRIVATE ${LQ_SURFACE_DEFINITIONS})
    target_link_libraries(LqSurfaceExampleTests
        PRIVATE
            LqSurfaceWebAssets
            juce::juce_audio_processors
            juce::juce_gui_extra
            juce::juce_recommended_config_flags
            juce::juce_recommended_warning_flags)

    add_test(NAME lq_surface_native_tests COMMAND LqSurfaceExampleTests)
    set_tests_properties(lq_surface_native_tests PROPERTIES TIMEOUT 120)

    if(LQ_SURFACE_WEBVIEW_SMOKE_TEST)
        # Creates the real editor off-screen and drives the bundled page via evaluateJavascript.
        juce_add_console_app(LqSurfaceWebViewSmoke
            PRODUCT_NAME "LqSurfaceWebViewSmoke"
            NEEDS_WEB_BROWSER TRUE
            NEEDS_CURL FALSE
            NEEDS_WEBVIEW2 TRUE)

        target_sources(LqSurfaceWebViewSmoke PRIVATE tests/WebViewSmokeTest.cpp ${LQ_SURFACE_SOURCES})
        target_include_directories(LqSurfaceWebViewSmoke PRIVATE src)
        target_compile_features(LqSurfaceWebViewSmoke PRIVATE cxx_std_17)
        target_compile_definitions(LqSurfaceWebViewSmoke PRIVATE ${LQ_SURFACE_DEFINITIONS} JUCE_MODAL_LOOPS_PERMITTED=1)
        target_link_libraries(LqSurfaceWebViewSmoke
            PRIVATE
                LqSurfaceWebAssets
                juce::juce_audio_processors
                juce::juce_gui_extra
                juce::juce_recommended_config_flags
                juce::juce_recommended_warning_flags)

        add_test(NAME lq_surface_webview_smoke COMMAND LqSurfaceWebViewSmoke)
        set_tests_properties(lq_surface_webview_smoke PROPERTIES TIMEOUT 180 LABELS gui)
    endif()
endif()
