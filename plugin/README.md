# readwise-digest (Supernote plugin)

Supernote NOTE/DOC plugin syncing highlights with [Readwise](https://readwise.io). See the repo
root for screenshots, feature overview, and full docs:

- `../README.md` — feature overview + screenshots
- `../plans/plan.md` — task-by-task design/implementation history
- `../docs/KNOWLEDGE_PROVIDER.md` — reverse-engineered schema for Supernote's native Digest
  ContentProvider
- `../docs/DEVELOPMENT.md` — adb workflow, device info, build/deploy/debug commands
- `../.claude/skills/supernote-plugin-dev/` — vendored `sn-plugin-lib` SDK reference

## Layout

```
index.js               Entry point: AppRegistry + PluginManager.init() + button registration
App.tsx                 Root view: Setup, or a two-tab main view (Insert a Quote default, Sync and Export)
src/db/                 SQLite schema + query helpers (react-native-sqlite-storage)
src/readwise/           Readwise API client, types, and import sync logic
src/screens/            Setup, SyncExport, InsertQuote screens
src/components/, src/theme.ts  Tab component + font sizes/colors (copied from philips/olaink)
src/lib/                 permissions, digestSync (Readwise -> Digest), digestExport
                         (Digest -> Readwise), knowledgeProvider (JS wrapper for the native
                         module), insertQuote (insert into current note)
android/app/src/main/java/com/plugin/
                         KnowledgeProviderModule.kt + KnowledgeProviderPackage.kt -- native
                         ContentResolver calls to Supernote's Digest provider (see
                         docs/KNOWLEDGE_PROVIDER.md)
node_change/             Vendored + patched react-native-sqlite-storage (see its own comments
                         for what was changed and why -- AGP/jcenter fixes, ios/windows trimmed)
PluginConfig.json        Pre-created (not auto-generated) so pluginID/uses-permissions are stable
                         across rebuilds -- see buildPlugin.sh, which skips generation if this
                         file already exists.
```

## Status

All four spec tasks implemented and verified end-to-end on a real device with a real Readwise
account:

1. **Local cache + setup flow** — full export sync, 6472+ highlights cached.
2. **Insert quote into note** — real `TYPE_TEXT` TextBox on the current page.
3. **Sync into Digest** — direct ContentProvider integration with Supernote's native Digest app
   (not a workaround), category-tagged `Readwise`.
4. **Export Digest → Readwise** — round-tripped and confirmed on Readwise's real servers, with
   loop-prevention (Readwise-tagged entries never get re-exported).

Dev loop: `../scripts/snplg-deploy.sh` to build+install, `../scripts/snplg-hotreload.sh --build`
for fast JS-only iteration, `../scripts/snplg-logs.sh` to tail logs.
