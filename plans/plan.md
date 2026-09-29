# Readwise Supernote Digest — Plugin Plan

Source: handwritten note "Readwise Supernote Digest Plugin" (2 pages, digested via OCR/vision on
`2025` note transfer). Transcribed below, followed by research findings and proposed architecture.

## Transcribed spec

**Background and Context**

> Readwise has an API at https://readwise.io/api_deets which can ingest highlights from text you
> want to save or review, or export saved highlights. Supernote has a digest feature that serves a
> similar purpose.

**Task 1** — Create a plugin that exports and stores Readwise quotes into a plugin sqlite db. This
will require a setup flow and saving a Readwise API key.

**Task 2** — Extend the plugin to be able to insert quotes from Readwise into the current note as a
textbox.

**Task 3** — Sync Readwise quotes into the digest database. I think there is an API via
`content://com.ratta.supernote.knowledge.provider`. Use a category postfix like Readwise. Provide a
setting to enable sync.

**Task 4** — Export digest entries to the Readwise API while filtering out digest entries in the
Readwise category to avoid looping data. Provide a setting to enable this sync.

---

## Research findings

### Readwise API (confirmed live, public, unauthenticated probes return expected 401s)

Full docs pulled from `https://readwise.io/api_deets` (also mirrored at `/tmp/readwise-api-deets.txt`
during this session — re-fetch if needed, not vendored into the repo).

- **Auth**: header `Authorization: Token <key>`. Validate with `GET /api/v2/auth/` → `204` if valid.
- **Create highlights** (Task 1 write path / Task 4 export): `POST https://readwise.io/api/v2/highlights/`
  ```json
  { "highlights": [ { "text": "...", "title": "...", "author": "...", "source_url": "...",
    "source_type": "supernote_digest", "category": "articles|books|tweets|podcasts", "note": "...",
    "location": 0, "location_type": "page|location|none|order|offset|time_offset",
    "highlighted_at": "2020-07-14T20:11:24+00:00", "highlight_url": "..." } ] }
  ```
  - `text` is the only required field. Response includes `modified_highlights` (created/updated highlight IDs) — use this to know what round-tripped.
  - **De-dupe key is `title`+`author`+`text`+`source_url`** (including nulls) — sending the same 4 fields again is a safe no-op, not a duplicate. Useful for idempotent retries.
  - Re-POSTing with the same `highlight_url` **updates** that highlight's text — could be used for edit-sync later, not needed for v1.
  - Rate limit: 240 req/min default, but **highlight LIST and book LIST are 20 req/min** — irrelevant to CREATE/EXPORT which we'll use primarily.
- **Export highlights** (Task 1 read/sync path): `GET https://readwise.io/api/v2/export/`
  - Params: `updatedAfter` (ISO8601, incremental sync), `ids` (comma-separated `user_book_id`s),
    `includeDeleted`, `pageCursor` (pagination).
  - Recommended pattern: first sync with no params, follow `nextPageCursor` until null, persist the
    cursor's completion time; subsequent syncs pass `updatedAfter` = last successful sync time.
  - Response nests highlights under each book/article ("user_book"): `user_book_id`, `title`,
    `author`, `category`, `source`, `source_url`, `readwise_url`, then `highlights[]` with `id`,
    `text`, `note`, `location`, `location_type`, `color`, `highlighted_at`, `created_at`,
    `updated_at`, `is_deleted`, `url`, `end_location`, `external_id`.

This maps cleanly onto Task 1/4.

### Supernote plugin SDK (from vendored skill + `docs.supernote.com` llms-full.txt, pulled live this session)

- **Plugin JS runs inside the `com.ratta.supernote.pluginhost` process** ("Plugin logic runs in
  PluginHost" — Plugin Principles doc). It is not a separately-`pm install`-ed APK; there's no
  independent plugin UID.
- Only 4 runtime-gated permissions exist in the whole SDK: `plugin.permission.FILE:READ`,
  `FILE:WRITE`, `FILE:DELETE`, `INTERNET`. There is **no** general mechanism to request an
  arbitrary Android permission string through `PluginManager.hasPermission`/`requestPermission` —
  it's a fixed enum, not open-ended.
- Digest support in the *documented* SDK is limited to two things:
  1. **Note-embedded digest TextBox elements** — `ElementType.TYPE_TEXT_DIGEST_QUOTE` (`501`) and
     `TYPE_TEXT_DIGEST_CREATE` (`502`), main-layer-only TextBoxes with an extra `textDigestData`
     string field. These are just elements inside a `.note` file, fully accessible via
     `PluginFileAPI.insertElements`/`getElements`/`modifyElements` (the high-level convenience
     `PluginNoteAPI.insertText` does **not** expose `textDigestData` or a type override — use the
     lower-level `PluginCommAPI.createElement(ElementType.TYPE_TEXT_DIGEST_CREATE)` +
     `PluginFileAPI.insertElements` path to set it).
  2. **Read-only digest links** — `Link.linkType === 6` ("digest link"). Explicitly documented as
     read-only; "current plugin APIs do not support creating/modifying links as digest links."
  3. There is **no dedicated "Digest"/"Knowledge" guide page, endpoint, or API module** anywhere in
     the docs (grepped the full docs export for `Digest`/`Knowledge` — only the above two hits).

### The `content://com.ratta.supernote.knowledge.provider` content provider (Task 3/4's proposed mechanism)

Verified directly on-device (`adb -s 100.103.149.40:5555 shell content query --uri ...`):

```
java.lang.SecurityException: Permission Denial: opening provider
com.ratta.supernote.knowledge.provider.KnowledgeContentProvider from (null) (pid=..., uid=2000)
requires com.ratta.supernote.knowledge.permission.READ_KNOWLEDGE or
com.ratta.supernote.knowledge.permission.WRITE_KNOWLEDGE
```

Both permissions are `protectionLevel=normal` (not `signature`/`dangerous`) — so in principle any
app that *declares* them in its manifest gets them automatically at install time. The problem:

- Checked `dumpsys package` for `com.ratta.supernote.pluginhost` **and** `com.ratta.supernote.note`
  (the two processes a plugin can possibly run inside/alongside) — **neither package's "requested
  permissions" list includes `READ_KNOWLEDGE` or `WRITE_KNOWLEDGE`.** Only the app that defines the
  provider (`com.ratta.supernote.knowledge`) plus whichever first-party app implements the native
  Digest UI presumably hold it (not confirmed which one — device didn't expose it via adb without
  root).
- Since plugin JS/native code executes **inside the already-installed, already-permission-fixed
  `pluginhost` process/UID** (confirmed by the SDK's own "Plugin Principles" doc), nothing a plugin
  bundles in its own manifest (`PluginConfig.json` `uses-permissions`, or a `node_change/`-style
  native module's `AndroidManifest.xml`) can grant the *pluginhost process* a new Android permission
  post-hoc — Android permission grants are resolved against the installed package's manifest at
  `pm install`/scan time, and the plugin is never independently `pm install`-ed.

**Conclusion: Task 3/4's literal mechanism (direct read/write to the knowledge ContentProvider) is
blocked at the OS level for any code running inside PluginHost, and is not exposed by the
documented SDK either.** This matches the handwritten note's own hedge ("I *think* there is an
API...") — worth flagging back rather than silently reinterpreting.

**Still worth a cheap on-device experiment once the plugin skeleton exists**: write a minimal native
module that does a raw `ContentResolver.query(...)` against that URI from inside a running plugin
and check the logcat error. If it's genuinely the same `SecurityException`, that closes the
question definitively (rather than relying purely on static manifest analysis). ~30 min, do this
early in Task 3, not now (no scaffold/build environment yet — see Open Items).

---

## Proposed architecture

### Task 1 — Local SQLite cache + setup flow

- Use `sn-plugin-lib`'s documented SQLite pattern (see `references/sqlite.md` in the vendored
  skill) inside the plugin's private data directory (`NativePluginManager.getPluginDirPath()`).
- Schema (draft):
  ```sql
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  -- keys: readwise_api_token, last_export_updated_after, last_export_cursor,
  --       digest_sync_enabled, readwise_export_enabled, digest_category (default 'Readwise')

  CREATE TABLE highlights (
    readwise_id INTEGER PRIMARY KEY,     -- Readwise highlight id
    user_book_id INTEGER,
    book_title TEXT, book_author TEXT, category TEXT,
    text TEXT NOT NULL, note TEXT,
    location INTEGER, location_type TEXT,
    highlighted_at TEXT, updated_at TEXT,
    highlight_url TEXT, source_url TEXT,
    inserted_into_note_at TEXT,          -- last time Task 2 inserted this into a note (nullable)
    synced_to_digest_at TEXT,            -- Task 3 bookkeeping (nullable)
    fetched_at TEXT NOT NULL
  );

  CREATE TABLE exported_digest_entries (  -- Task 4 bookkeeping: what we've already pushed out
    local_key TEXT PRIMARY KEY,           -- however we identify a "digest entry" locally
    readwise_highlight_id INTEGER,
    exported_at TEXT NOT NULL
  );
  ```
- Setup flow (first-run UI): API key input → validate via `GET /api/v2/auth/` → store in
  `settings` → trigger first full export sync (loop `pageCursor` with no `updatedAfter`).
- **`INTERNET` permission**: declare in `PluginConfig.json` `uses-permissions`, call
  `PluginManager.hasPermission`/`requestPermission('plugin.permission.INTERNET')` before the first
  request (see skill Pattern 17 / gotcha list).
- API token storage: plain in the plugin sqlite db is consistent with "plugin sqlite db" from the
  note; the plugin's private data dir isn't world-readable, so this matches the security posture of
  comparable plugins. Flag to revisit if `publish-review.md`'s checklist wants better-than-that.

### Task 2 — Insert a Readwise quote into the current note

- UI: toolbar button opens a picker (list backed by the `highlights` table, most-recent or
  searchable) → user selects a quote → insert.
- Insertion: `PluginCommAPI.createElement(ElementType.TYPE_TEXT_DIGEST_QUOTE)` (quote styling) →
  populate `element.textBox.textContentFull` (quote text, optionally with attribution line) and
  `element.textBox.textDigestData` (TBD exact schema — inspect what NOTE's own "save to digest"
  gesture writes here, via `getElements` on a note where the user manually saved a digest quote, to
  match format) → `element.layerNum = 0` (main layer only) → `element.pageNum` = current page (via
  `PluginCommAPI.getCurrentPageNum()`) → `PluginFileAPI.insertElements(path, page, [element])`.
  - `PluginNoteAPI.saveCurrentNote()` before insertion, per gotcha #9 in the skill, so the in-memory
    cache is flushed first.
  - Coordinate system: `textRect` is **pixel coordinates** — get page size via
    `PluginCommAPI.getPageDisplaySize()` (current file, ungated) rather than
    `PluginFileAPI.getPageSize` (silently permission-gated on some firmware — see skill gotcha #38).

### Task 3 — Sync Readwise quotes into "the digest database" [SUPERSEDED — see "Task 3
  implementation notes" near the end of this file]

The architecture below (a plugin-managed note file as a digest substitute) was the plan while the
real ContentProvider was believed inaccessible from a plugin. On-device experimentation (prompted
by explicit user request to keep digging rather than accept the note-file workaround) found that
direct ContentProvider access to the real native Digest actually works. Task 3 is implemented via
a small native module talking to `content://com.ratta.supernote.knowledge.provider` directly —
no note file involved. Left here for history; skip to the implementation notes section for what
actually shipped.

~~Given the ContentProvider path is blocked, propose implementing this entirely through the
documented note-embedded digest TextBox primitive instead of a separate system database~~:

- ~~Maintain (or let the user pick) a dedicated note file, e.g. `Note/Readwise Digest.note`,
  created via `PluginFileAPI` if it doesn't exist.~~
- ~~For each unsynced highlight (`synced_to_digest_at IS NULL`), insert a
  `TYPE_TEXT_DIGEST_CREATE`/`_QUOTE` TextBox (same mechanism as Task 2) into that note~~ (also
  turned out to be blocked independently — see Task 2 implementation notes, finding #3).
- ~~Setting: `digest_sync_enabled` toggle in plugin settings UI~~ (this part carried over to the
  real implementation unchanged).

### Task 4 — Export digest entries to Readwise, avoiding loops [NOT YET IMPLEMENTED]

Now that Task 3 has real read/write ContentProvider access, Task 4 should be symmetric and much
more literal than originally planned:

- Query the Digest DB directly (not note files) for user-created entries: `knowledge/by_source_type`
  or scan `knowledge/by_knowledge_base` — need to check the decompiled `KnowledgeContentProvider`
  (still in `/tmp/knowledge_src` as of this session, not committed to the repo — re-decompile
  `/system_ext/app/SupernoteKnowledge/SupernoteKnowledge.apk` with jadx if needed) for the exact
  query shape and which `source_type` values correspond to user-entered vs. our own Readwise-synced
  rows.
- Filter out entries whose `knowledge_base_unique_attribute` matches our cached Readwise category
  (`SettingsKey.DigestCategoryUniqueAttribute`) — prevents re-exporting what Task 3 just imported.
- POST remaining entries to `POST /api/v2/highlights/`.
- Record what's been exported in `exported_digest_entries` (schema already has this table from
  Task 1) to avoid re-sending unchanged entries every sync.
- Setting: `readwise_export_enabled` toggle, independent of Task 3's toggle (schema already has
  this key too).

---

## Open issues

Resolved this round (see "Round 3 fixes" at the end of this file): duplicate re-import loop, stale
Setup screenshot, leftover test entry, deleted highlights lingering in the local cache, and an
empty-cache hole in export loop-prevention. Still open:

### 1. Export Documents and Notes highlights to Readwise -- extraction done, export not wired yet

Task 4 only exports the **Manual Entry** tab (`source_type = 4`). Highlights made while reading
PDFs/EPUBs (**Documents**, `source_type = 1`) or saved from handwritten notes (**Notes**,
`source_type = 2`) never reach Readwise. A Digest row has **no title or author column**; Readwise
needs a title (required whenever `source_type` is set) and de-dupes on title + author + text +
source_url, so the title must come from the file and must be **stable** across runs.

**Done: title/author extraction** (`src/lib/documentInfo/`, `android/.../docmeta/`)
- Native, pure-JVM, no library: EPUB (zip -> `container.xml` -> OPF `dc:title`/`dc:creator`,
  only `aut`/role-less creators) and PDF (last `startxref` -> classic xref table or xref stream with
  PNG predictor, following `/Prev`, -> `/Info`, including Info inside an object stream; UTF-16/UTF-8/
  Latin-1 text strings; refuses encrypted files). Reads only the file tail plus a few objects, so a
  370 MB scan costs the same as a paper. 36 JUnit tests over generated fixtures
  (`./gradlew :app:testDebugUnitTest`), mutation-checked.
- Validated on 158 real files from the device (146 EPUB, 12 PDF): every EPUB gave title + author,
  10/12 PDFs did (the other two have no Info dictionary), max 35 ms. Embedded metadata is much
  better than filenames (`_` for `:`, "Title, The" inversion, `Unknown - Author.pdf` naming).
  `RealFilesScanTest` is an opt-in scan (`DOCMETA_DIR=... DOCMETA_OUT=...`).
- JS policy: embedded metadata, else filename (`Title - Author.ext`, split on the last " - ").
  Junk detection ("Untitled", "Microsoft Word - x.doc", filenames-as-titles, "Admin" as author),
  "Last, First" and trailing-article normalisation. Cached per path in `document_info` and
  **sticky**: once a document has a title it keeps it, so a later metadata edit can't turn already
  exported highlights into duplicates. Exception: a filename guess made because the read failed
  is upgraded once the file becomes readable.
- 108 jest tests on the above (`__tests__/documentInfo.*`).

**Findings from testing on the device**
- Reading needs **`plugin.permission.FILE:READ`** (now declared; `ensureFileReadPermission()`).
  The host enforces it in native code too (`SecurityException: ... no READ permission on sdcard`).
  It is only prompted for when something calls it -- nothing does yet.
- Digest `source_path` is **relative to shared storage** (`Document/Foo.epub`), not absolute;
  `toAbsolutePath` prepends `/storage/emulated/0/`.
- The host also whitelists paths: `SecurityException: ... not allowed to access sdcard path outside
  whitelist`. Files synced from the Supernote cloud live under
  `Android/data/com.ratta.supernote.serverlink/files/sync/...` and **cannot be read** by a plugin;
  those entries can only use the filename (truncated by the sync, e.g. "Concrete Mathematics_ A
  Foundation for Com - ..."), and some have no author at all.
- The read permission dialog offers "Allow This Time Only" / "Always Allow": with the former the
  prompt returns on every launch.

**Still to do**
- Wire it in: `listDigestEntriesBySourceType(1)` exists (returns `sourcePath`, `sourcePage`,
  `comment`); export those with `title`/`author` from `resolveDocumentInfo`, `category: 'books'`,
  `location`/`location_type: 'page'` from `sourcePage`, `note` from `comment`, and key
  `exported_digest_entries` by row id as now. Loop prevention is unaffected.
- Unreadable or metadata-less files: **decided** -- export under the filename-derived title (and
  author, if the name has one) rather than skipping. The serverlink sync folder is the main case;
  see https://github.com/philips/readwise-supernote-digest/issues/1. Because the title is cached
  and sticky, a later upgrade to real metadata won't rename already-exported highlights.
- Notes (`source_type = 2`): title = the `.note` file name, page from `metadata.note_page`; needs
  its own toggle, and a decision on whether handwriting recognition text belongs in Readwise.
- XMP metadata for PDFs whose Info dictionary is empty (2 of 12 sampled).
- UI: a toggle and pending count next to the existing export, plus a place to explain the read
  permission before the OS prompt appears.

### 2. Known limitations (not scheduled)

- **Readwise -> Digest deletions.** When a highlight is deleted on Readwise we now drop it from the
  local cache, but the corresponding Digest entry stays: `delete()` on the provider is
  trusted-caller-only (docs/KNOWLEDGE_PROVIDER.md), so a plugin cannot remove Digest rows.
- **Edits aren't propagated** in either direction: an exported entry is tracked by Digest row id
  only, so editing it later in Digest is not re-sent (Readwise's `highlight_url` update trick could
  do it); likewise edits on Readwise don't update the Digest copy.
- **Undocumented provider.** The whole Digest integration depends on reverse-engineered behavior
  (uid 1000 permission grant, URI schema) that a firmware update could change without notice.
- **Background sync.** Everything is manual or on-open; there's no periodic sync while the plugin
  is closed. Not investigated whether PluginHost supports any background model.
- **react-native pinned at 0.79.2 / react 19.0.0** by the host (see vendored skill).

## Suggested build order

1. ✅ Scaffold plugin project (`plugin/`), wire up `scripts/snplg-*.sh` (already parameterized for
   `plugin/` as the default dir).
2. ✅ Task 1: settings/setup UI, SQLite schema, Readwise auth + export sync. Verified
   end-to-end on-device with a real account (6472 highlights synced). See "Task 1 implementation
   notes" below.
3. ✅ Task 2: quote picker + insert-as-textbox. Verified end-to-end on-device -- a real
   Readwise quote now lands as a real TextBox on a real note page. See "Task 2 implementation
   notes" below.
4. \u2705 Task 3: real native Digest integration via direct ContentProvider access (not a note
   file -- see "Task 3 implementation notes" near the end of this file for the full story).
   Verified end-to-end: all 6472 cached highlights synced into the real Digest app's Manual Entry
   tab, correct Category ("Readwise") and Author fields, zero errors.
5. Task 4: export path, symmetric to Task 3, with loop-prevention filter. Not yet implemented.

## Task 1 implementation notes (2025 session)

- SQLite via `react-native-sqlite-storage`, vendored under `plugin/node_change/` per the skill's
  Pattern 11 (`node_change/` = patched third-party native deps, auto-detected by `buildPlugin.sh`).
  Had to actually patch it to be usable at all:
  - Its `platforms/android/build.gradle` pinned AGP 3.1.4 via `jcenter()` in its own nested
    `buildscript{}` block — jcenter's been fully shut down since Feb 2024, this would have failed
    outright. Removed the block (the root project's already-applied AGP classpath covers it, since
    everything here uses the classic non-`plugins{}`-DSL application style); added the `namespace
    'org.pgsqlite'` AGP 7+/8+ requires and wasn't declared; renamed `lintOptions` → `lint`.
  - Its `package.json` `devDependencies` (`react-native@^0.63.2`, `react-native-windows`) caused
    `npm install` to nest-install a *second, ancient* `node_modules/react-native` tree inside
    `node_change/react-native-sqlite-storage/` on every install (83MB, and a real risk of Metro
    resolving the wrong RN version for files under that directory — exactly the kind of
    version-mismatch the skill warns crashes silently on-device). Stripped `devDependencies`
    entirely; the library has no runtime `dependencies` so this was pure bloat.
  - Trimmed unused `ios`/`windows`/legacy `android-native` (prebuilt `.so` libs) platform dirs —
    cut the vendored copy from ~8MB to ~1.2MB. Updated `react-native.config.js` to only declare
    the `android` platform.
  - **Important, not yet verified on-device**: per the Android native source
    (`SQLitePlugin.java`), the `location` open option is actually a no-op on Android — it always
    resolves via `Context#getDatabasePath(name)` on whichever process is calling (i.e.
    `com.ratta.supernote.pluginhost`, since plugin JS runs inside that process). That means the DB
    filename, not `location`, is what isolates this plugin's storage from any other plugin's in the
    shared pluginhost process. Handled by namespacing the filename with this plugin's own
    `pluginID` (`readwise-digest-<pluginID>.db`, see `src/db/index.ts`) rather than trusting
    `location: 'plugins/<pluginID>/'` per the skill's literal snippet.
- Pre-created `plugin/PluginConfig.json` by hand (16-char lowercase-alphanumeric `pluginID`,
  matching `new_random_string 16` in `buildPlugin.sh`) instead of letting the build script
  auto-generate it on first build — `buildPlugin.sh` skips generation entirely if this file already
  exists, so `uses-permissions: ["plugin.permission.INTERNET"]` is stable across every rebuild
  rather than needing to be re-added by hand after each `PluginConfig.json` regeneration.
- `sn-plugin-lib` — scaffold's default `"^0.1.19"` actually resolved to `0.1.65` (the real latest
  0.1.x), which is good since `hasPermission`/`requestPermission` (needed for the `INTERNET` gate)
  were only added in 0.1.65. Pinned explicitly to `"0.1.65"` in `package.json` rather than leaving
  the loose `^0.1.19` range, so a future `npm install` can't silently drift onto a breaking SDK
  version (see the skill's version-gated-facts warning at the top of `SKILL.md`).
- Readwise sync (`src/readwise/sync.ts`) follows Readwise's own recommended pattern: full sync on
  first run (no `updatedAfter`), follow `nextPageCursor` until null, persist the sync's *start*
  time (not finish time) as `last_export_updated_after` so nothing updated mid-sync gets missed on
  the next incremental pull. Rate-limit (`429`) handling retries using the `Retry-After` header, up
  to 3 attempts.
- Verified without a device (no Android SDK on this machine yet — see "Open items" above):
  `npx tsc --noEmit`, `npx eslint`, and `npx react-native bundle --platform android --dev false`
  all pass/succeed, including resolving the vendored SQLite native module through autolinking
  (`npx react-native config` lists it) and the app's UI strings landing in the built bundle.

## Task 1 on-device verification (real device + real Readwise account)

Installed the Android SDK (platform 35, build-tools 35.0.0) and a JDK 21 (system JDK 25 is too new
for Gradle 8.13 — `Unsupported class file major version 69`; installed Temurin 21 to `~/jdks/`,
set `JAVA_HOME` only for the Gradle invocation). Full `buildPlugin.sh` → `scripts/snplg-deploy.sh`
→ device loop confirmed working.

**Real bug found in `buildPlugin.sh`** (not our plugin code): it computes the `reactPackages`
array for `PluginConfig.json` by parsing
`android/app/build/generated/autolinking/src/main/java/com/facebook/react/PackageList.java` — but
that file is only generated as a side effect of the Gradle native build, which runs *after*
`update_plugin_config_packages` in the script's `main()`. Net effect: **the first build of any
fresh project always ships an empty `reactPackages` array**, silently breaking every custom native
module (`NativeModules.X` would be `null` at runtime, per skill gotcha #33) with no build error or
warning. Re-running `buildPlugin.sh` a second time (the autolinking file now exists from build #1)
correctly picks up `org.pgsqlite.SQLitePluginPackage`. **Always build twice on a fresh project /
after adding a new native dependency**, and check `build/generated/PluginConfig.json`'s
`reactPackages` isn't empty before trusting a build.

**Real bug found and fixed in our own code**: `src/readwise/client.ts`'s `fetchExportPage` used
`URLSearchParams.set()` to build the `updatedAfter`/`pageCursor` query params. React Native's
built-in `URLSearchParams` polyfill (`Libraries/Blob/URLSearchParams.js`) is a deliberately small
subset of the spec — it only implements `append()`/`toString()`/iteration from an object
constructor; `.set()`/`.get()`/`.has()`/`.delete()`/`.sort()` all unconditionally
`throw new Error('URLSearchParams.X is not implemented')`. Not caught by `tsc` (DOM lib types
declare the full spec) or the Metro bundle smoke test (nothing exercised the code path). Surfaced
only when a real user entered a real token: auth succeeded, page 1 of the export succeeded (no
query params needed on page 1), then the crash hit on page 2's `pageCursor` param. Fixed by
building the query string by hand (`encodeURIComponent` + manual `&`-join) instead of relying on
any `URLSearchParams` method beyond what's known-safe. **Takeaway**: any web API usage should be
checked against RN's actual polyfill, not MDN or TypeScript's DOM lib types, before assuming it
works on-device.

**End-to-end confirmed working on real hardware with a real Readwise account**:
- Plugin installs, loads (`Running "readwise-digest"`), SQLite DB initializes.
- Routes to Setup screen when no token stored; routes to Home when one is.
- `INTERNET` permission dialog fires correctly (`plugin.permission.INTERNET` declared +
  `hasPermission`/`requestPermission` flow), "Always Allow" persists across app sessions.
- Real network calls reach Readwise's live API; bad-token rejection shows the correct error copy.
- Full paginated export sync completed successfully after the fix: **6472 highlights** synced and
  persisted to SQLite (started from a partial 505 left over from the pre-fix crash, confirming the
  upsert path safely resumes/re-runs), "Sync now" returns to idle state with the final count, no
  crashes or exceptions anywhere in the `pluginhost` process log throughout.

## Task 2 implementation notes (real device, real note, real Readwise data)

Implementation: `src/lib/insertQuote.ts` (insertion logic), `src/screens/InsertQuote.tsx`
(searchable picker screen, wired into `Home` via a new "Insert quote into note" button and a
third `App.tsx` route). Uses `PluginCommAPI.getCurrentFilePath/getCurrentPageNum/
getPageDisplaySize` + `PluginNoteAPI.saveCurrentNote` + `PluginCommAPI.createElement` +
`PluginCommAPI.insertPageElements` (the current-file element CRUD family, not
`PluginFileAPI.insertElements`, per `getPageDisplaySize`'s own doc note about coordinate
mismatches).

Three real, on-device-only bugs found and fixed this session (none caught by `tsc`/eslint/Metro
bundling -- all only surfaced by actually running on hardware):

1. **`ElementType` isn't exported from `sn-plugin-lib`'s public index**, despite every
   docs.supernote.com code example importing it that way (`import { ElementType } from
   'sn-plugin-lib'`). Checked `node_modules/sn-plugin-lib/lib/typescript/src/index.d.ts` directly:
   only `Element` is exported. The same type constants (`TYPE_TEXT`, `TYPE_TEXT_DIGEST_CREATE`,
   etc.) are duplicated as `static readonly` properties directly on the exported `Element` class --
   use `Element.TYPE_TEXT` etc. instead. Would have been a `tsc` error immediately if actually
   attempted (`Module '"sn-plugin-lib"' has no exported member 'ElementType'`), so low-risk, but
   worth remembering before copy-pasting any docs example.

2. **`element.recycle()` (shown in docs examples, declared on the `Element` *class* in the .d.ts)
   doesn't exist on the object `PluginCommAPI.createElement()` actually returns at runtime** --
   confirmed by reading `node_modules/sn-plugin-lib/lib/module/sdk/PluginCommAPI.js`:
   `createElement`'s result is a plain object from the native bridge, augmented with a couple of
   `ElementDataAccessor` fields (`angles`, `contoursSrc`), never wrapped in a real `Element`
   instance with prototype methods. Calling `.recycle()` on it throws `"undefined is not a
   function"` on-device (first real error hit this session, screenshot-confirmed). Fixed by using
   the static `PluginCommAPI.recycleElement(element.uuid)` instead (which is genuinely what
   `.recycle()` would have delegated to). `tsc` didn't catch this either -- the `Element` class's
   `.d.ts` type includes `recycle(): Promise<void>` as a real method, so the loose object shape
   returned at runtime type-checks fine against it despite not actually having that method.

3. **Digest-type TextBoxes (`Element.TYPE_TEXT_DIGEST_CREATE` / `_QUOTE`, 501/502) cannot actually
   be *inserted* via `insertPageElements`**, contradicting the docs table's explicit claim
   ("Digest created TextBox ... can be inserted and edited only on the main layer"). On-device,
   every attempt -- regardless of the `textEditable` field value (tried both `0` and `1`) --
   fails with `"The digest text box is not editable!"`. Since Task 2 only asks for "a textbox" (no
   digest-styling requirement), switched to the plain `Element.TYPE_TEXT` (500), which works
   exactly as documented. **Open question for later**: is creating a *new* digest textbox from a
   plugin simply unsupported (only Supernote's own native "save to digest" gesture can produce
   one, and plugins can only read/modify *existing* ones -- matching that `modifyLassoText`'s docs
   example switches on `TYPE_TEXT_DIGEST_QUOTE/_CREATE` but no `insertElements`/`insertPageElements`
   example ever does), or is there some other required field we're missing? Worth revisiting if a
   future task specifically needs the digest visual styling; for now Task 2 uses plain `TYPE_TEXT`
   with a thin border (`textFrameStyle: 3`) to look visually distinct instead.

4. Also needed `plugin.permission.FILE:WRITE` (declared in `PluginConfig.json` `uses-permissions`,
   requested via the same `hasPermission`/`requestPermission` pattern as `INTERNET` in Task 1) --
   confirmed on-device that `createElement`/`insertPageElements`/`saveCurrentNote` are gated behind
   it even though they only operate on the already-open current file. This contradicts the skill's
   own claim ("Operations that stay inside the currently-open file via PluginCommAPI... don't need
   any of this") -- that claim holds for read-ish calls like `lassoElements`/`setLassoBoxState`,
   but not for ones that persist a write to the file, at least on this firmware.

**End-to-end confirmed working**: opened the plugin from inside a real, pre-existing note ("math",
14 pages, real handwritten content) via the NOTE app's Plugins toolbar entry, browsed/searched the
6472 cached Readwise highlights in the new picker screen, tapped "Insert into note" on a real
highlight (a quote from *Tokens Too Cheap to Meter* by jyn), and confirmed via screenshot that a
real TextBox element -- quote text + `\u2014 book \u2014 author` attribution line -- now appears at the top
of the actual note page, persisted after `PluginCommAPI.reloadFile()`. The picker's "Inserted ✓"
state and `inserted_into_note_at` DB bookkeeping (for a future "already inserted" indicator) both
worked as designed.

## Task 3 implementation notes: real native Digest integration (real device, real ContentProvider)

**This is the one that changed direction mid-stream.** First pass at Task 3 built a
note-file-based substitute for "the digest database" (a plugin-managed `Readwise Digest.note`,
plain `TYPE_TEXT` boxes). User pushed back ("digest sync should not touch any note... can you
explore an NPK to access the ContentProvider?") before that got committed, which led to actually
re-testing the ContentProvider from inside a real running plugin instead of relying on the earlier
static `dumpsys` analysis from the initial research phase. That re-test overturned the earlier
"blocked" conclusion.

### The probe

Added a throwaway native module (`KnowledgeProbeModule.kt`, since replaced by the real
`KnowledgeProviderModule.kt`) exposing a `ContentResolver.query()` call on
`content://com.ratta.supernote.knowledge.provider`, wired into `MainApplication.kt`'s
`getPackages()` (per `find_manual_react_packages_from_application` in `buildPlugin.sh` -- a
custom `ReactPackage` needs a `.add(...)` call there to get picked up into
`build/generated/PluginConfig.json`'s `reactPackages`, same requirement as the SQLite package back
in Task 1). Result, tapped from a debug button in `Home.tsx`:

```json
{
  "callingUid": 1000,
  "packageName": "com.ratta.supernote.pluginhost",
  "processName": "com.ratta.supernote.pluginhost",
  "attempts": {
    "bareAuthorityQuery": {"success": false, "exceptionType": "IllegalArgumentException",
      "message": "Unknown URI: content://com.ratta.supernote.knowledge.provider"},
    "digestSubpathQuery": {"success": false, "exceptionType": "IllegalArgumentException",
      "message": "Unknown URI: content://com.ratta.supernote.knowledge.provider/digest"}
  }
}
```

No `SecurityException`. The earlier `adb shell content query` test (session start) got exactly
that -- `Permission Denial ... requires READ_KNOWLEDGE` -- because `adb shell` runs as uid 2000,
which holds nothing. pluginhost runs as **uid 1000** (`android.uid.system`, the same shared UID as
`com.ratta.supernote.knowledge` itself), and that UID *does* pass the provider's permission check.
The two `IllegalArgumentException`s just meant the guessed URI paths were wrong -- an entirely
different, much better problem to have.

### Reverse-engineering the real schema

Pulled the live APK (`adb pull /system_ext/app/SupernoteKnowledge/SupernoteKnowledge.apk`),
decompiled it with `jadx` (no `apktool`/`jadx` preinstalled; downloaded jadx 1.5.6 directly from
GitHub releases). `KnowledgeContentProvider.java`'s permission gate:

```java
private void checkWritePermission() {
    if (!isTrustedCaller() && getContext().checkCallingOrSelfPermission(WRITE_PERMISSION) != 0) {
        throw new SecurityException(...);
    }
}
private boolean isTrustedCaller() {
    // hardcoded allowlist: document, note, settings, background, inkhub -- NOT pluginhost
}
```

`isTrustedCaller()` doesn't include pluginhost, confirming the pass came from a genuine
`checkCallingOrSelfPermission` grant tied to uid 1000, not an app-level allowlist bypass. (Why
uid 1000 gets this: some combination of Android's system-UID permission short-circuiting and/or
sharedUserId-level pooling within `android.uid.system` -- confirmed empirically, exact AOSP
mechanism not pinned down further since it didn't matter once the behavior itself was verified.)

Read `insert()`/`query()` in full to get the exact schema (all confirmed working end-to-end, see
below):

- **Category lookup**: `query(content://.../knowledge_base/by_name, selectionArgs=[name])` ->
  cursor with `unique_attribute` column (empty if not found).
- **Category creation** (NOT in the `isTrustedCaller()`-only blocklist, unlike the more obvious
  `knowledge_base/insert_with_unique_attribute` endpoint, which *is* blocked): `insert(content://
  .../knowledge_base, {name: "Readwise"})` -> returns a `Uri` with the new row's id appended;
  `unique_attribute` is server-generated (`KnowledgeUtils.generateKnowledgeBaseUniqueValue()`) --
  read it back via `query(content://.../knowledge_base/by_id/<id>)`.
- **Entry creation** (also not blocked): `insert(content://.../knowledge/insert, values)` where
  `values` is:
  - `content` (String, required, <=15000 chars) -- the digest text
  - `knowledge_base_unique_attribute` (String, optional) -- links to the category
  - `source_type` (Int) -- `1`=document, `2`=note, `3`=system pasteboard, `4`=**self-add** (what
    the "Manual Entry" tab's own "+" flow uses; using it is what makes our entries show up there)
  - `metadata` (String, optional) -- a flat JSON object string, e.g. `{"author":"..."}`; internally
    parsed/written via simple `org.json.JSONObject` (`KnowledgeUtils.setMetadataStringValue`), not
    any richer schema
  - `creation_time`/`last_modified_time` auto-fill via `System.currentTimeMillis()` if omitted
- Several sibling endpoints genuinely *are* `isTrustedCaller()`-gated and out of reach for a plugin
  regardless of the uid-1000 finding: tags (`knowledge/by_tag*`, `add_tags`, `update_tags`),
  `knowledge/restore`, `knowledge_base/restore`, `knowledge_base/insert_with_unique_attribute`,
  and (query-side) `knowledge/search/special_carousel`. None of these were needed for Task 3.

### Implementation

- `android/app/src/main/java/com/plugin/KnowledgeProviderModule.kt` +
  `KnowledgeProviderPackage.kt`: `getOrCreateCategory(name)` (query-by-name, else insert +
  read-back) and `insertEntry(content, categoryUniqueAttribute, metadataJson)`, both plain
  `ContentResolver` calls, no SDK involvement at all.
- `AndroidManifest.xml`: declares `<uses-permission>` for `READ_KNOWLEDGE`/`WRITE_KNOWLEDGE`
  anyway, for documentation/defensiveness -- but per the above, this declaration in the plugin's
  own npk manifest almost certainly has zero real effect (the npk is never `pm install`-ed as its
  own package; see the Task 3 "Research findings" section above for why). The actual access comes
  from pluginhost's own already-granted identity.
- `src/lib/knowledgeProvider.ts`: thin wrapper.
- `src/lib/digestSync.ts`: `getOrCreateDigestCategory` result cached in
  `SettingsKey.DigestCategoryUniqueAttribute` so the category is only looked up/created once, not
  on every sync; `syncPendingHighlightsToDigest` loops `getUnsyncedToDigestHighlights` in batches
  of 25 (same pattern as Task 1's export sync), formats `author` as `"book — author"`, calls
  `insertEntry`, marks `synced_to_digest_at` per-row so a partial failure is resumable.
- `Home.tsx`: "Sync into Digest" toggle (`SettingsKey.DigestSyncEnabled`) + pending count +
  "Sync to Digest now" button; wired so enabling the toggle also runs a Digest sync automatically
  after every Readwise "Sync now".

### Verified end-to-end on the real device, real Readwise account, zero errors

Tapped "Sync to Digest now" against all 6472 cached highlights (no manual batching/limiting --
the button syncs everything pending in one run). Progress UI counted up smoothly (~45
entries/sec: 62 -> 731 -> 2533 -> 5263 -> "Digest is up to date" over about 2.5 minutes total),
zero errors the whole way. Opened the real Digest app (`KnowledgeActivity`) afterward:

- **Manual Entry** tab: **6472** (matches exactly).
- Opened an individual entry's detail view: **Category: Readwise**, **Author: ... — jyn** (the
  `"book — author"` format from `digestSync.ts`), exact quote text, dated today, "From: Manual
  Entry". Indistinguishable from an entry a user typed by hand via the "+" button, except we did
  it programmatically for 6472 highlights in ~2.5 minutes.
- Bonus: the entry detail view has its own **Annotations** (handwriting/keyboard) section --
  something we get for free by using the real feature instead of a synthetic substitute.

### Residual notes for later

- The decompiled source lives at `/tmp/knowledge_src` on this dev machine (not committed --
  disposable, re-generate from the live APK + jadx if needed again for Task 4).
- `KnowledgeContentProvider`'s `delete()` method wasn't read in detail this session (only
  `insert()`/`query()`) -- check its `isTrustedCaller()` blocklist before assuming Task 4 (or a
  future "un-sync" feature) can delete rows the same way.
- This entire mechanism is undocumented, reverse-engineered, and could change on a Supernote
  firmware update (new `isTrustedCaller()` list, revoked uid-1000 grant, schema changes, etc.) with
  no warning and no changelog to check against. Worth a defensive try/catch around the whole Task 3
  flow surfacing a clear "Digest sync isn't working, Supernote may have changed something" error
  rather than a raw exception, and worth re-verifying after any firmware update.

## Task 4 implementation notes: export Digest entries to Readwise

- `KnowledgeProviderModule.queryManualEntries` lists `source_type = 4` rows via the bare
  `knowledge` dir URI with a raw `selection` string (that path concatenates `selection` into SQL
  unparameterized; see docs/KNOWLEDGE_PROVIDER.md). Filtering out our own Readwise-category rows
  happens in JS (`src/lib/digestExport.ts`), comparing against the cached
  `SettingsKey.DigestCategoryUniqueAttribute`.
- `exported_digest_entries` (Task 1 schema) now tracks exported Digest row ids.
- Found on-device: Readwise's create endpoint returns 400 "Title is required when source_type is
  specified" -- not obvious from the API docs. Exports use `title: 'Supernote Digest'`.
- Verified: created one uncategorized Manual Entry by hand; pending count showed exactly 1 of 6473
  (the 6472 Readwise-tagged rows correctly excluded); export succeeded; a following "Sync now"
  pulled it back (6472 -> 6473), confirming it reached Readwise's servers.
- Known wrinkle: the exported entry then re-imports as a normal highlight, so with "Sync into
  Digest" on it would be pushed back into Digest as a Readwise-category entry (a duplicate of the
  original hand-typed one). Not addressed yet.

## UX: tabs

App now has two tabs, copied in style/font size from philips/olaink (`src/theme.ts`,
`src/components/Tab.tsx`): "Insert a Quote" (default) and "Sync and Export" (`SyncExport.tsx`,
formerly `Home.tsx`). Setup screen fonts use the same scale. `docs/screenshots/01-setup.png` predates
the font change and is stale; re-capture it next time the plugin is disconnected.

## Round 3 fixes (open issues from the Task 4 / tabs round)

1. **Re-import duplicate loop.** A Digest entry exported to Readwise came back on the next import
   sync as an ordinary highlight and, with "Sync into Digest" on, would have been pushed back into
   Digest as a Readwise-category duplicate. Readwise records our exports with
   `source = "supernote_digest"` and book title "Supernote Digest" (confirmed via the export API);
   `src/readwise/constants.ts` now holds those identifiers, and the DB layer marks any highlight
   with that title as already synced to Digest (`markOwnExportsSyncedToDigest`, run after every
   upsert and at init, so it also fixes rows cached earlier). Verified on-device: the Digest pending
   count went from "1 highlight not yet in Digest" to "Digest is up to date."
2. **Deleted highlights lingering in the cache.** Discovered while cleaning up the test entry: it
   had been deleted on Readwise (book and highlight both `is_deleted: true` in the export API), but
   our cache still counted it, because the import never requested deletions. Incremental syncs now
   pass `includeDeleted=true` (first full sync doesn't need to), and a deleted book marks all its
   highlights deleted. Verified: "Sync now" took the cached count from 6473 to 6472.
   (Note: Readwise's *highlights* endpoint 404s for deleted ids, and the export endpoint reports
   them with `is_deleted` -- only the latter is usable to detect deletions.)
3. **Export loop-prevention with an empty cache.** The export skipped Readwise-category Digest
   entries by comparing against the cached category id. If that cache was empty (plugin data reset,
   or Export used before any Digest sync) nothing would be filtered and all ~6,472 Readwise entries
   would have been re-exported to Readwise. It now falls back to a read-only lookup by name
   (`KnowledgeProviderModule.findCategory`, returns null rather than creating anything). Verified
   on-device: returns the category id for "Readwise", null for a nonexistent name.
4. **Stale Setup screenshot.** Re-captured with the new fonts, without disconnecting: a temporary
   build forced the Setup route so the saved token was never touched.
5. **Leftover test entry.** Removed the "Task 4 test entry" from the Digest app through its own
   Delete action (the plugin can't delete Digest rows); it was already gone from Readwise.
6. **The "[pi] Work in progress" commit** was split into logical commits (see git log).
