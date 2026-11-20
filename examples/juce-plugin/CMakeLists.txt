cmake_minimum_required(VERSION 3.22)
project(LqSurfaceJuceExample VERSION 0.1.0 LANGUAGES CXX)

if (DEFINED JUCE_SOURCE_DIR AND EXISTS "${JUCE_SOURCE_DIR}/CMakeLists.txt")
    add_subdirectory("${JUCE_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/juce")
else()
    find_package(JUCE CONFIG REQUIRED)
endif()

set(WEB_ASSETS "${CMAKE_CURRENT_SOURCE_DIR}/resources/surface-ui.zip")
if (NOT EXISTS "${WEB_ASSETS}")
    message(FATAL_ERROR "Missing surface-ui.zip. Run 'npm run pack:juce' at the repository root first.")
endif()

juce_add_binary_data(SurfaceWebAssets SOURCES "${WEB_ASSETS}")
juce_add_plugin(LqSurfaceExample
    COMPANY_NAME lowquo
    PRODUCT_NAME "lq-surface example"
    BUNDLE_ID io.lowquo.surface.example
    PLUGIN_MANUFACTURER_CODE LqXX
    PLUGIN_CODE LqSf
    FORMATS VST3 AU
    NEEDS_WEBVIEW2 TRUE
    IS_SYNTH FALSE
    IS_MIDI_EFFECT FALSE
    COPY_PLUGIN_AFTER_BUILD FALSE
)

target_compile_features(LqSurfaceExample PRIVATE cxx_std_17)
target_sources(LqSurfaceExample PRIVATE src/PluginProcessor.cpp src/PluginProcessor.h src/PluginEditor.cpp src/PluginEditor.h)
target_compile_definitions(LqSurfaceExample PRIVATE JUCE_WEB_BROWSER=1 JUCE_USE_WIN_WEBVIEW2=1 JUCE_VST3_CAN_REPLACE_VST2=0)
target_link_libraries(LqSurfaceExample PRIVATE
    SurfaceWebAssets
    juce::juce_audio_utils
    juce::juce_gui_extra
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags
)
