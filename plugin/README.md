# readwise-digest (Supernote plugin)

Supernote NOTE/DOC plugin syncing highlights with [Readwise](https://readwise.io). See the repo
root for the full spec, research findings, and dev workflow:

- `../plans/plan.md` — task breakdown, Readwise API contract, digest ContentProvider findings
- `../docs/DEVELOPMENT.md` — adb workflow, device info, build/deploy/debug commands
- `../.claude/skills/supernote-plugin-dev/` — vendored `sn-plugin-lib` SDK reference

## Layout

```
index.js              Entry point: AppRegistry + PluginManager.init() + button registration
App.tsx                Root view: routes between Setup and Home based on saved API token
src/db/                SQLite schema + query helpers (react-native-sqlite-storage)
src/readwise/          Readwise API client, types, and sync logic
src/screens/           Setup (first-run API key flow) and Home (sync status/actions)
src/lib/                Small shared helpers (permissions)
node_change/            Vendored + patched react-native-sqlite-storage (see its own comments
                         for what was changed and why -- AGP/jcenter fixes, ios/windows trimmed)
PluginConfig.json       Pre-created (not auto-generated) so pluginID/uses-permissions are stable
                         across rebuilds -- see buildPlugin.sh, which skips generation if this
                         file already exists.
```

## Status

Task 1 (local SQLite cache + Readwise setup flow) implemented. Not yet built/deployed to a real
device -- this dev machine doesn't have the Android SDK installed yet (Node/JDK are fine). Verified
so far without a device:

- `npx tsc --noEmit` — clean
- `npx eslint src App.tsx index.js` — clean
- `npx react-native bundle --platform android --dev false ...` — bundles successfully (Metro
  resolution + babel all working, including the vendored SQLite module)

Once the Android SDK is available, use `../scripts/snplg-deploy.sh` to build+install and
`../scripts/snplg-logs.sh` to tail logs.
