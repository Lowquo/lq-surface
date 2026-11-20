#!/usr/bin/env bash
# Install or remove the lq-surface example in the *user-level* macOS plug-in folders, for local
# validation (auval, pluginval) and manual DAW testing only. Compiled example plug-ins must not be
# distributed (see docs/licensing.md).
#
#   macos-test-install.sh install <cmake-build-dir> [Release|Debug]
#   macos-test-install.sh uninstall
#   macos-test-install.sh status
#
# Safety rules:
# - Only ~/Library/Audio/Plug-Ins/{Components,VST3}; never /Library or system folders; no sudo.
# - install never overwrites: it stops if a bundle with the same name already exists.
# - uninstall removes a bundle only if its CFBundleIdentifier is the example's frozen identifier.
set -euo pipefail

BUNDLE_ID="io.lowquo.surface.example"
NAME="lq-surface example"
AU_DIR="$HOME/Library/Audio/Plug-Ins/Components"
VST3_DIR="$HOME/Library/Audio/Plug-Ins/VST3"
AU_DST="$AU_DIR/$NAME.component"
VST3_DST="$VST3_DIR/$NAME.vst3"

die() { echo "error: $*" >&2; exit 1; }
bundle_id() { /usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$1/Contents/Info.plist" 2>/dev/null || true; }
refresh_au_cache() { killall -9 AudioComponentRegistrar 2>/dev/null || true; } # user-level daemon; relaunches on demand

[ "$(uname -s)" = Darwin ] || die "macOS only"

case "${1:-}" in
  install)
    build="${2:-}"; config="${3:-Release}"
    [ -n "$build" ] || die "usage: $0 install <cmake-build-dir> [Release|Debug]"
    art="$build/LqSurfaceExample_artefacts/$config"
    for src in "$art/AU/$NAME.component" "$art/VST3/$NAME.vst3"; do
      [ -d "$src" ] || die "not built: $src"
      [ "$(bundle_id "$src")" = "$BUNDLE_ID" ] || die "unexpected bundle identifier in $src"
    done
    for dst in "$AU_DST" "$VST3_DST"; do
      [ ! -e "$dst" ] || die "$dst already exists; not overwriting (run '$0 uninstall' first if it is this example)"
    done
    mkdir -p "$AU_DIR" "$VST3_DIR"
    ditto "$art/AU/$NAME.component" "$AU_DST"
    ditto "$art/VST3/$NAME.vst3" "$VST3_DST"
    refresh_au_cache
    echo "installed: $AU_DST"
    echo "installed: $VST3_DST"
    echo "validate:  auval -strict -v aufx Lqsf Lqoo"
    ;;
  uninstall)
    removed=0
    for dst in "$AU_DST" "$VST3_DST"; do
      [ -e "$dst" ] || continue
      id="$(bundle_id "$dst")"
      [ "$id" = "$BUNDLE_ID" ] || die "$dst has identifier '$id', not $BUNDLE_ID; leaving it untouched"
      rm -rf "$dst"
      echo "removed:   $dst"
      removed=1
    done
    [ "$removed" = 1 ] && refresh_au_cache
    [ "$removed" = 1 ] || echo "nothing to remove"
    ;;
  status)
    for dst in "$AU_DST" "$VST3_DST"; do
      if [ -e "$dst" ]; then echo "present:   $dst ($(bundle_id "$dst"))"; else echo "absent:    $dst"; fi
    done
    ;;
  *)
    die "usage: $0 install <cmake-build-dir> [Release|Debug] | uninstall | status"
    ;;
esac
