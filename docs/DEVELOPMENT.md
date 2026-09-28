# Development Workflow

Plugin dev workflow for Supernote NOTE/DOC (`sn-plugin-lib`, React Native), based on
[gorlix/supernote-plugin-dev](https://github.com/gorlix/supernote-plugin-dev) (vendored as an
agent skill at `.claude/skills/supernote-plugin-dev/`) and adb scripting patterns from
[philips/olaink](https://github.com/philips/olaink).

## Device

- Model: Supernote Nomad (Android 11)
- IP: `100.103.149.40` (Tailscale), adb over Wi-Fi on port 5555
- Connect: `adb connect 100.103.149.40:5555`
- All `scripts/snplg-*.sh` default to this device via `SNPLG_DEVICE`; override per-invocation if needed:
  `SNPLG_DEVICE=<other-serial> scripts/snplg-logs.sh`

Relevant on-device packages:
- `com.ratta.supernote.pluginhost` — RN plugin host runtime
- `com.ratta.supernote.note` — NOTE app (plugin buttons live here)
- `com.ratta.settings` — Settings app (Apps → Plugins install UI)

## Skill

The full SDK reference (API signatures, coordinate systems, 40+ gotchas, patterns for lasso ops,
floating windows, EMR pen handling, SQLite, i18n, publish checklist) is vendored at:

```
.claude/skills/supernote-plugin-dev/SKILL.md
.claude/skills/supernote-plugin-dev/references/*.md
```

Read `SKILL.md` first — it's project-agnostic and points to `references/*.md` per topic. It also
recommends adding the live docs MCP for anything version/signature-sensitive:

```
claude mcp add --transport http --scope project supernote-docs https://docs.supernote.com/mcp
```

## Environment

| Dependency | Version | Status here |
|---|---|---|
| Node.js | ≥18 LTS | ✅ v22 installed |
| JDK | ≥19 | ✅ OpenJDK 25 installed (verify Gradle compat when scaffolding) |
| Android SDK Platform 35 + Build-Tools 35.0.0 | — | ❌ not yet installed, needed for `buildPlugin.sh` |
| React Native | pinned **0.79.2** | set by template, do not bump |
| yarn | latest | check before scaffold |

## Scaffold (once plugin specifics are decided)

```bash
npx @react-native-community/cli init plugin \
  --template @supernote-plugin/sn-plugin-template --version 0.79.2
```

Expected to land at `./plugin` (see `scripts/snplg-deploy.sh` default `PLUGIN_DIR=plugin`).
`PluginConfig.json` fields to fill in manually after first build: `iconPath`, `desc`, `author`,
`uses-permissions` (e.g. `plugin.permission.INTERNET` for pushing to Readwise).

## Day-to-day loop

```bash
# 1. Build + install (full reinstall, use for native changes or first install)
scripts/snplg-deploy.sh

# 2. JS/TS-only iteration (fast path, no reinstall)
scripts/snplg-hotreload.sh --build

# 3. Open the plugin's full-screen view from the NOTE app sidebar
scripts/snplg-open-from-note.sh "Readwise Digest"

# 4. Logs (live tail or one-shot capture)
scripts/snplg-logs.sh
scripts/snplg-logs.sh --capture
scripts/snplg-logs.sh --quiet     # hide SDK verifyParams noise
```

`scripts/snplg-deploy.sh` drives the on-device install UI via `uiautomator dump` (no root needed):
push `.snplg` → Settings → Apps → Plugins → Add Plugin → select file → Install → wait for
`PluginInstallManager: Install Success` in logcat.

## Gotchas worth remembering up front

See `.claude/skills/supernote-plugin-dev/SKILL.md` "Common Gotchas" for the full numbered list.
Highlights most likely to bite early:

- `PluginManager.init()` must run *after* `AppRegistry.registerComponent(...)` — miss it and every
  SDK call fails silently.
- `PluginConfig.json`'s `pluginKey` must exactly match the `appName` passed to
  `AppRegistry.registerComponent`.
- Reinstalling via Settings reads from `MyStyle/Plugins/<name>.snplg`, not the plain `MyStyle/`
  copy — pushing a rebuild there and tapping "reinstall" silently reruns the old build.
- Every `console.log` is stripped unless the build defines `__DEV__`; `buildPlugin.sh` always
  builds with `--dev false`. Keep one deliberate, ungated startup log line
  (e.g. `${TAG} v${versionName} starting`) so `adb logcat` always confirms which build is running.
- `INTERNET` (needed to POST to Readwise's API) is a runtime-gated permission (SDK ≥0.1.65-era
  firmware): declare it in `uses-permissions` and call `PluginManager.requestPermission` before
  the first request, or you'll get a silent on-device-only `SocketException`.
- react-native is hard-pinned to `0.79.2` by the host; keep `react`/`react-test-renderer` pinned
  to exactly `19.0.0` too (peer ranges are loose enough to let a newer `react` slip in and crash
  silently on-device with no error in `npm test`).

## Reference repos

- https://github.com/philips/olaink — real-world monorepo plugin + Cloudflare Worker relay;
  source of the adb scripting patterns in `scripts/`.
- https://github.com/gorlix/supernote-plugin-dev — the vendored skill/reference docs.
