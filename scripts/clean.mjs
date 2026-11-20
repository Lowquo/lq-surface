import { rmSync } from 'node:fs';
for (const path of ['packages/core/dist','packages/controls/dist','packages/juce/dist','examples/playground/dist','examples/juce-plugin/resources/surface-ui.zip']) rmSync(path,{recursive:true,force:true});
