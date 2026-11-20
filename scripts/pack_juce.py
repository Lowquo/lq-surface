#!/usr/bin/env python3
"""Package Vite output as a JUCE BinaryData asset; does not build a plugin."""
from pathlib import Path
import zipfile
root = Path(__file__).resolve().parents[1]
dist = root / 'examples' / 'playground' / 'dist'
if not (dist / 'index.html').is_file():
    raise SystemExit('Missing playground/dist/index.html; run npm run build first')
target = root / 'examples' / 'juce-plugin' / 'resources' / 'surface-ui.zip'
target.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
    for path in sorted(dist.rglob('*')):
        if path.is_file():
            zf.write(path, path.relative_to(dist).as_posix())
print(f'Wrote {target} ({target.stat().st_size:,} bytes)')
