import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Pinned to Vite 7's "baseline-widely-available" default (2025-05-01). The JUCE example embeds this
    // build in the system WKWebView (macOS deployment target 11.0); Vite 8 raises its default to Safari 16.4.
    // Change only deliberately, and test the plug-in on the oldest supported macOS.
    target: ['chrome107', 'edge107', 'firefox104', 'safari16'],
  },
  server: { host: '127.0.0.1' },
});
