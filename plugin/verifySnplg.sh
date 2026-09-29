#!/usr/bin/env bash
# Assert that a built readwise-digest.snplg is what Plugin Manager should install. Run by the
# release workflow on every build (and usable locally: `npm run verify:plugin`).
#
# The checks exist because of failures that are silent on a device:
#  - buildPlugin.sh has shipped an empty `reactPackages` list on a first build of a clean checkout,
#    which produces a plugin that installs fine and then has no database or Digest access;
#  - a changed pluginID makes Plugin Manager install a second plugin instead of upgrading;
#  - a non-increasing versionCode makes Plugin Manager refuse the upgrade.
set -euo pipefail

EXPECT_VERSION_NAME=""
EXPECT_VERSION_CODE=""
ARCHIVE=""

usage() {
  echo "usage: $0 [--expect-version-name NAME] [--expect-version-code CODE] path/to/readwise-digest.snplg" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --expect-version-name) EXPECT_VERSION_NAME="${2:?}"; shift 2 ;;
    --expect-version-code) EXPECT_VERSION_CODE="${2:?}"; shift 2 ;;
    -h|--help) usage ;;
    -*) echo "unknown flag: $1" >&2; usage ;;
    *) if [[ -n "$ARCHIVE" ]]; then usage; fi; ARCHIVE="$1"; shift ;;
  esac
done
[[ -n "$ARCHIVE" && -f "$ARCHIVE" ]] || { echo "archive not found: ${ARCHIVE:-<missing>}" >&2; usage; }
for tool in unzip python3; do command -v "$tool" >/dev/null || { echo "missing $tool" >&2; exit 2; }; done

fail() { echo "FAIL: $*" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
unzip -q "$ARCHIVE" -d "$TMP"

# --- exact set of files -------------------------------------------------------------------------
ENTRIES="$(cd "$TMP" && find . -type f | sed 's|^\./||' | LC_ALL=C sort)"
EXPECTED="$(printf '%s\n' \
  PluginConfig.json \
  app.npk \
  drawable-mdpi/assets_icon.png \
  readwise-digest.bundle | LC_ALL=C sort)"
if [[ "$ENTRIES" != "$EXPECTED" ]]; then
  echo 'archive entry set mismatch (< expected, > actual):' >&2
  diff <(printf '%s\n' "$EXPECTED") <(printf '%s\n' "$ENTRIES") >&2 || true
  exit 1
fi

# --- PluginConfig.json --------------------------------------------------------------------------
PLUGIN_CONFIG="$TMP/PluginConfig.json" EXPECT_VERSION_NAME="$EXPECT_VERSION_NAME" \
EXPECT_VERSION_CODE="$EXPECT_VERSION_CODE" python3 - <<'PY'
import json, os, sys

config = json.load(open(os.environ['PLUGIN_CONFIG']))
errors = []

def expect(key, value):
    if config.get(key) != value:
        errors.append(f"{key} must be {value!r}, got {config.get(key)!r}")

# Changing the ID installs a second plugin next to the old one instead of upgrading it.
expect('pluginID', '5hmif2r6vihq6bos')
expect('pluginKey', 'readwise-digest')
expect('jsMainPath', 'index')
expect('nativeCodePackage', '/app.npk')

permissions = sorted(config.get('uses-permissions', []))
wanted = sorted(['plugin.permission.INTERNET', 'plugin.permission.FILE:READ', 'plugin.permission.FILE:WRITE'])
if permissions != wanted:
    errors.append(f"permissions must be exactly {wanted}, got {permissions}")

# See the header: an empty list installs fine and breaks at runtime.
packages = sorted(config.get('reactPackages', []))
wanted_packages = sorted([
    'com.plugin.DocumentMetadataPackage',
    'com.plugin.KnowledgeProviderPackage',
    'org.pgsqlite.SQLitePluginPackage',
])
if packages != wanted_packages:
    errors.append(f"reactPackages must be exactly {wanted_packages}, got {packages}")

name, code = os.environ['EXPECT_VERSION_NAME'], os.environ['EXPECT_VERSION_CODE']
if name and config.get('versionName') != name:
    errors.append(f"versionName {config.get('versionName')!r} != expected {name!r}")
if code and str(config.get('versionCode')) != code:
    errors.append(f"versionCode {config.get('versionCode')!r} != expected {code!r}")
if not str(config.get('versionCode', '')).isdecimal():
    errors.append(f"versionCode must be a decimal string, got {config.get('versionCode')!r}")

if errors:
    for e in errors:
        print(f"FAIL: {e}", file=sys.stderr)
    sys.exit(1)
PY

# --- native code package (app.npk) --------------------------------------------------------------
NPK="$TMP/app.npk"
NPK_ENTRIES="$(unzip -Z1 "$NPK")"
grep -q '^classes.*\.dex$' <<<"$NPK_ENTRIES" || fail 'app.npk contains no classes.dex'

# The host provides React Native and Hermes; a second copy in the plugin crashes it. The one
# library that is expected comes from the SDK plugin template.
UNEXPECTED_SO="$(grep -E '\.so$' <<<"$NPK_ENTRIES" | grep -vxF 'lib/arm64-v8a/libnative-lib.so' || true)"
[[ -z "$UNEXPECTED_SO" ]] || fail "app.npk contains unexpected native libraries: $UNEXPECTED_SO"

# Our own native modules must have made it into the dex files (they are spread over classes*.dex).
NPK_DIR="$TMP/npk"
mkdir -p "$NPK_DIR"
unzip -q "$NPK" -d "$NPK_DIR"
for cls in com/plugin/DocumentMetadataPackage com/plugin/DocumentMetadataModule \
           com/plugin/KnowledgeProviderPackage com/plugin/KnowledgeProviderModule \
           com/plugin/docmeta/PdfMetadataReader com/plugin/docmeta/EpubMetadataReader \
           org/pgsqlite/SQLitePluginPackage; do
  grep -a -l "$cls" "$NPK_DIR"/classes*.dex >/dev/null 2>&1 || fail "class $cls not found in app.npk"
done

# --- JS bundle ----------------------------------------------------------------------------------
BUNDLE="$TMP/readwise-digest.bundle"
[[ "$(wc -c <"$BUNDLE")" -gt 100000 ]] || fail 'JS bundle is suspiciously small'
grep -qF 'readwise.io/api/v2' "$BUNDLE" || fail 'JS bundle does not reference the Readwise API'
grep -qF 'registerAsset' "$BUNDLE" || fail 'JS bundle does not register the sidebar icon asset'
# Metro's first line declares the mode. A development bundle is ~5x larger and slower on device.
head -c 600 "$BUNDLE" | grep -qF '__DEV__=false' || fail 'JS bundle is not a production build (expected __DEV__=false; bundle with --dev false)'

echo "OK: $(basename "$ARCHIVE") (version ${EXPECT_VERSION_NAME:-<unchecked>}/${EXPECT_VERSION_CODE:-<unchecked>}, pluginID 5hmif2r6vihq6bos)"
