#!/usr/bin/env bash
# Hot-reload the plugin's JS bundle on a connected device without a full
# reinstall. Uses the plugin host's debug broadcast receiver, which swaps
# the bundle in place and re-runs index.js in the note-app context.
#
# JS/TS-only changes: use this (fast). Native Kotlin/Java changes: you still
# need scripts/snplg-deploy.sh (full reinstall) plus a pluginhost force-stop
# — see references/setup-and-build.md in the vendored skill.
#
# Usage:
#   scripts/snplg-hotreload.sh [plugin-dir] [--build]
#
# Prereq: a built bundle under <plugin-dir>/build/generated/*.bundle
#         (pass --build to run the build first).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEVICE="${SNPLG_DEVICE:-100.103.149.40:5555}"

PLUGIN_DIR="plugin"
DO_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --build) DO_BUILD=1 ;;
    -*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) PLUGIN_DIR="$arg" ;;
  esac
done

cd "$REPO_ROOT/$PLUGIN_DIR"

if [ "$DO_BUILD" = 1 ]; then
  if [ -x ./buildPlugin.sh ]; then ./buildPlugin.sh; else npm run build:snplg; fi
fi

BUNDLE="$(ls -1 build/generated/*.bundle 2>/dev/null | head -1)"
[ -n "$BUNDLE" ] || { echo "missing build/generated/*.bundle — run with --build" >&2; exit 1; }

CONFIG="build/generated/PluginConfig.json"
[ -f "$CONFIG" ] || CONFIG="PluginConfig.json"
[ -f "$CONFIG" ] || { echo "no PluginConfig.json found to read pluginID from" >&2; exit 1; }
PLUGIN_ID="$(python3 -c "import json;print(json.load(open('$CONFIG'))['pluginID'])")"
[ -n "$PLUGIN_ID" ] || { echo "could not read pluginID from $CONFIG" >&2; exit 1; }

DEST="/storage/emulated/0/MyStyle/$(basename "$BUNDLE")"

echo "==> pushing $BUNDLE to $DEST"
adb -s "$DEVICE" push "$BUNDLE" "$DEST" >/dev/null

echo "==> hot-reloading (debug receiver) pluginID=$PLUGIN_ID"
adb -s "$DEVICE" shell am broadcast \
  -n com.ratta.supernote.pluginhost/.receiver.PluginReceiver \
  -a com.ratta.supernote.plugin.action.DEBUG -f 0x01000000 \
  --es bundle_path "$DEST" --es plugin_id "$PLUGIN_ID" >/dev/null

echo "OK: hot-reloaded. Tail logs with: scripts/snplg-logs.sh"
