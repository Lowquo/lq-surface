import { rmSync } from 'node:fs';

// dist/ also holds each package's .tsbuildinfo, so removing it forces a full `tsc -b` rebuild.
const paths = [
  'packages/core/dist',
  'packages/controls/dist',
  'packages/juce/dist',
  'examples/playground/dist',
  'examples/juce-plugin/resources/surface-ui.zip',
];
for (const path of paths) rmSync(path, { recursive: true, force: true });
