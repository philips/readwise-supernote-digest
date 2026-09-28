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

### Task 3 — Sync Readwise quotes into "the digest database" (revised interpretation)

Given the ContentProvider path is blocked, propose implementing this entirely through the
documented note-embedded digest TextBox primitive instead of a separate system database:

- Maintain (or let the user pick) a dedicated note file, e.g. `Note/Readwise Digest.note`, created
  via `PluginFileAPI` if it doesn't exist.
- For each unsynced highlight (`synced_to_digest_at IS NULL`), insert a
  `TYPE_TEXT_DIGEST_CREATE`/`_QUOTE` TextBox (same mechanism as Task 2) into that note, tagging
  provenance via the "category postfix" concept from the note: prefix/suffix the book title with
  `" (Readwise)"` or similar inside `textDigestData`/`textContentFull`, since we don't have a
  first-class "category" field to set on a real digest DB row.
- Setting: `digest_sync_enabled` toggle in plugin settings UI; background/periodic sync job (or
  manual "Sync now" button — periodic background execution in a RN plugin process needs its own
  investigation, likely triggered on plugin-open rather than true background cron).
- **Do the on-device ContentProvider probe (see Research findings) before committing to this
  fallback** — if it turns out pluginhost *does* have access through some path we haven't found
  (e.g. a hidden SDK method, or the knowledge app itself exposing something via AIDL rather than
  the ContentProvider), prefer that over the note-file workaround.

### Task 4 — Export digest entries to Readwise, avoiding loops

- Symmetric to Task 3: scan the same digest-tagged TextBoxes (ours, and potentially the user's own
  manually-created `TYPE_TEXT_DIGEST_CREATE`/`_QUOTE` entries across all notes) via
  `PluginFileAPI.getElements` per note/page.
- Filter out entries whose `textDigestData`/tag marks them as Readwise-sourced (the same "Readwise"
  category marker from Task 3) — prevents re-exporting what we just imported.
- POST remaining entries to `POST /api/v2/highlights/` (`category` likely `"books"` with title =
  the source note's name, or a dedicated category/source_type like `source_type: "supernote_digest"`
  to distinguish in the user's Readwise dashboard).
- Record what's been exported in `exported_digest_entries` to avoid re-sending unchanged entries
  every sync (Readwise de-dupes by title/author/text/source_url anyway, but avoid the redundant
  network calls).
- Setting: `readwise_export_enabled` toggle, independent of Task 3's toggle.

---

## Open items / risks to resolve before or during implementation

1. **Task 3/4 mechanism** — confirmed blocked via ContentProvider; plan above uses the note-file
   fallback. Needs a real on-device probe once a plugin skeleton exists to be 100% sure there's no
   other access path (see "still worth a cheap on-device experiment" above).
2. **`textDigestData` exact schema** — undocumented as a value shape (just typed `string`). Should
   reverse-engineer by manually using Supernote's built-in "save selection to digest" feature on the
   device, then reading the resulting element via `PluginFileAPI.getElements`, before writing our
   own values into it — otherwise our synced entries may render or behave differently from
   native ones.
3. **Android SDK not yet installed** on this dev machine (Node 22 ✅, JDK 25 ✅, but no
   `ANDROID_HOME`/SDK Platform 35/Build-Tools). Needed before `buildPlugin.sh` can produce a
   `.snplg`. Install before Task 1 build/deploy loop starts.
4. **Background/periodic sync** — Tasks 3/4 imply some kind of recurring sync, not just
   user-triggered. Need to check whether `sn-plugin-lib`/PluginHost supports any background
   execution model beyond "plugin view is open," or whether this has to be manual/on-open only for
   v1.
5. **react-native pinned to 0.79.2 / react 19.0.0** — must not drift (see vendored skill).

## Suggested build order

1. Scaffold plugin project (`plugin/`), wire up `scripts/snplg-*.sh` (already parameterized for
   `plugin/` as the default dir).
2. Task 1: settings/setup UI, SQLite schema, Readwise auth + export sync. Get this fully working
   and deployed to the device first — establishes the whole toolchain end-to-end.
3. Task 2: quote picker + insert-as-textbox. Reverse-engineer `textDigestData` shape here.
4. Task 3: on-device ContentProvider probe, then implement via chosen mechanism (fallback: digest
   note file).
5. Task 4: export path, symmetric to Task 3, with loop-prevention filter.
