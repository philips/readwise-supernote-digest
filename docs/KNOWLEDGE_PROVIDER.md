# Supernote Knowledge/Digest ContentProvider (reverse-engineered)

This documents `content://com.ratta.supernote.knowledge.provider` — the ContentProvider backing
Supernote's native "Digest" feature (Settings/NOTE sidebar → Digest, package
`com.ratta.supernote.knowledge`). **None of this is documented by Supernote.** Everything here was
reverse-engineered this session by pulling the live APK off the device and decompiling it:

```bash
adb pull /system_ext/app/SupernoteKnowledge/SupernoteKnowledge.apk /tmp/knowledge.apk
# jadx: https://github.com/skylot/jadx (no apktool/jadx preinstalled on a fresh dev box)
jadx -d /tmp/knowledge_src --no-res -e /tmp/knowledge.apk
# Provider source: com/ratta/supernote/knowledge/provider/KnowledgeContentProvider.java
```

Firmware version this was verified against: `com.ratta.supernote.knowledge` versionCode
`100146` / versionName `1.00.146`. **This could change on any firmware update with no changelog to
check against** — re-decompile if something here stops working.

## Why a plugin can reach it at all

The provider is gated behind two custom Android permissions:

```java
private static final String READ_PERMISSION  = "com.ratta.supernote.knowledge.permission.READ_KNOWLEDGE";
private static final String WRITE_PERMISSION = "com.ratta.supernote.knowledge.permission.WRITE_KNOWLEDGE";

private void checkReadPermission() {
    if (!isTrustedCaller() && getContext().checkCallingOrSelfPermission(READ_PERMISSION) != 0) {
        throw new SecurityException("Read permission required: ...READ_KNOWLEDGE");
    }
}
// checkWritePermission() is identical, checking WRITE_PERMISSION.

private boolean isTrustedCaller() {
    // hardcoded allowlist by calling package name:
    // com.supernote.document, com.ratta.supernote.note, com.ratta.settings,
    // com.ratta.supernote.background, com.ratta.supernote.inkhub
}
```

Both permissions are `protectionLevel="normal"`. `com.ratta.supernote.pluginhost` (the process
Supernote plugin JS/native code actually runs inside — see the main `sn-plugin-lib` skill's
"Plugin Principles" notes) is **not** on the `isTrustedCaller()` allowlist. Despite that, a live
probe from inside a real plugin (a throwaway native module doing a raw `ContentResolver.query()`)
got no `SecurityException` — only `IllegalArgumentException: Unknown URI` for guessed paths, i.e.
it passed the permission check and only failed on schema. `adb shell content query ...` (uid
2000/shell) on the same URI gets the real `Permission Denial` error, for comparison.

The likely explanation: pluginhost runs as **uid 1000** (`android.uid.system`), the same shared
UID as `com.ratta.supernote.knowledge` itself, and `Context#checkCallingOrSelfPermission` resolves
as granted for that UID independently of `isTrustedCaller()`'s separate, hardcoded
package-name allowlist. The exact AOSP mechanism (system-UID short-circuiting vs. sharedUserId
permission pooling) wasn't pinned down further — what matters practically is that it's empirically
granted, consistently, for both read and write.

**This does not help with `delete()`** — see below, it doesn't have a permission-check fallback at
all, only the `isTrustedCaller()` gate.

## URI schema

Authority: `com.ratta.supernote.knowledge.provider`. All paths below are relative to
`content://com.ratta.supernote.knowledge.provider/`.

| Path | Operation(s) | Trusted-caller only? | Notes |
|---|---|---|---|
| `knowledge` | query (list/filter), insert | No | See "Listing/filtering entries" below — `insert` here is a different, blocked variant (see `insert_with_unique_attribute`-style note) |
| `knowledge/insert` | insert | No | Create a Digest entry. See schema below. |
| `knowledge/#` (id) | query, delete | query: no / delete: **yes** | Single entry by row id |
| `knowledge/by_source_path` | query | No | |
| `knowledge/by_knowledge_base` | query | No | Entries in the default/uncategorized knowledge base |
| `knowledge/by_knowledge_base/*` (unique_attribute) | query | No | Entries in a specific category |
| `knowledge/by_tag`, `knowledge/by_tag/#` | query | **Yes** | |
| `knowledge/add_tags/#`, `knowledge/update_tags/#` | insert/update | partially gated | Not explored further |
| `knowledge/restore` | insert | **Yes** | Sync/restore path |
| `knowledge/delete_synced_data` | delete | not explored | |
| `knowledge/sync/state` | query | **Yes** | |
| `knowledge/search/by_keyword`, `by_source_type`, `by_kb_unique` | query | not explored | Likely search, not simple listing — untested; use the `knowledge` dir + `selection` instead (see below) |
| `knowledge/search/special_carousel` | query | **Yes** | |
| `knowledge_base` | query, insert | No | List/create categories. `insert` here (bare dir) is NOT the same as `insert_with_unique_attribute` (which IS blocked) |
| `knowledge_base/by_name` | query | No | `selectionArgs[0]` = name (see below) |
| `knowledge_base/by_id/#` | query | No | |
| `knowledge_base/*` (unique_attribute) | query | No | |
| `knowledge_base/insert_with_unique_attribute` | insert | **Yes** | Blocked — use plain `knowledge_base` insert instead, which auto-generates the unique_attribute server-side |
| `knowledge_base/update` | update | not explored | |
| `knowledge_base/restore` | insert/update | **Yes** | |

"Trusted-caller only" = blocked by `isTrustedCaller()`'s hardcoded package allowlist
(`document`/`note`/`settings`/`background`/`inkhub`) regardless of the uid-1000 permission finding
above — genuinely inaccessible to a plugin, not just undocumented.

**`delete()` as a whole has no permission-check fallback**:
```java
public int delete(Uri uri, String selection, String[] selectionArgs) {
    if (!isTrustedCaller()) {
        throw new SecurityException("Permission denied: you are not authorized to invoke this interface.");
    }
    ...
```
Every delete path is trusted-caller-gated, full stop. A plugin cannot delete Digest entries via
this provider under any circumstance found so far.

## Listing/filtering entries: `knowledge` (bare dir) + raw `selection`

The `knowledge` directory URI's query handler takes a `selection` string and, if non-empty (and
not the special-cased `"service_id <= 0"`), concatenates it **directly, unparameterized**, into
raw SQL:

```java
// KnowledgeContentProvider.query(), CODE_KNOWLEDGE_DIR branch:
} else {
    allKnowledgeBasesAsCursor = this.knowledgeDB.knowledgeDao().getKnowledgeBySelectionAsCursor(
        new SimpleSQLiteQuery("SELECT * FROM knowledge WHERE " + selection + " AND state!=1 ORDER BY id ASC"));
}
```

`selectionArgs` is not applied as bind parameters anywhere in this path — there is no `?`
placeholder substitution. Whatever you pass as `selection` goes straight into the SQL string. This
is effectively a raw-SQL-injection surface exposed by the app itself (fine for our own controlled
values like `"source_type = 4"`; **do not** build this string from arbitrary/untrusted input).

Example used by this plugin: `query(content://.../knowledge, selection="source_type = 4")` to list
all Manual Entry rows (see `KnowledgeProviderModule.kt`'s `queryManualEntries`).

The query result columns are always remapped to a fixed 12-column shape by
`KnowledgeContentProvider.reorganizeKnowledgeData`, regardless of `SELECT *`:

| Column | Type | Notes |
|---|---|---|
| `id` | long | Row id |
| `content` | string | The digest text |
| `knowledge_base_unique_attribute` | string | Category link (empty string if uncategorized) |
| `source_type` | int | See enum below |
| `source_path` | string | Absolute path, resolved via `getInnerAbsolutePath` (only meaningful for `source_type` 1/2) |
| `source_page` | string | |
| `metadata` | string | Flat JSON object, see below |
| `comment_str` | string | |
| `handwrite_path` | string | Resolved mark-file path if a handwritten comment exists, else `""` |
| `handwrite_md5` | string | |
| `creation_time` | long (ms epoch) | |
| `last_modified_time` | long (ms epoch) | |

## `knowledge_base` (category) schema

Columns (from `KnowledgeBaseDao_Impl`'s generated SQL): `id, unique_attribute, service_id, name,
base_desc, data_md5, last_sync_data_md5, state, sync_state, creation_time, last_modified_time,
sync_lock, pending_sync`.

**Lookup by name**: `query(content://.../knowledge_base/by_name, selectionArgs=[name])` — this one
*does* use `selectionArgs[0]` properly (unlike the `knowledge` dir path above). Throws
`IllegalArgumentException` if `selectionArgs` is missing/empty.

**Create**: `insert(content://.../knowledge_base, {name: "..."})`. `name` is required (throws
`SQLException` if empty). `unique_attribute` is generated server-side
(`KnowledgeUtils.generateKnowledgeBaseUniqueValue()`) — read it back via
`query(content://.../knowledge_base/by_id/<id>)` using the id from the returned insert `Uri`
(`ContentUris.parseId(insertedUri)`).

## `knowledge` (entry) insert schema

`insert(content://.../knowledge/insert, values)`:

| Key | Type | Required | Notes |
|---|---|---|---|
| `content` | String | **Yes** | Max 15000 chars (`SQLException` if longer or empty) |
| `knowledge_base_unique_attribute` | String | No | Must already exist — provider validates via `getKnowledgeBaseByUniqueAttribute`, throws `SQLException` if not found |
| `source_type` | Int | No (defaults `0`) | See enum below — **not validated** against `source_path` existing; you *could* lie about it (don't, see next section) |
| `source_path` | String | No | Only meaningful if `source_type` is 1 (document) or 2 (note) |
| `source_page` | String | No | |
| `metadata` | String | No | Flat JSON object string, e.g. `{"author":"..."}` — parsed/written via plain `org.json.JSONObject`, see `KnowledgeUtils.setMetadataStringValue`/`getNoteMetadataStringValue`. Known keys used elsewhere in the app: `author`, `unique_identifier`, `link_id`, `note_page`, `note_pageId`, `note_fileId` |
| `comment_str` | String | No | Max 2000 chars |
| `handwrite_path` | String | No | Must be an existing `.mark` file if set |

`creation_time`/`last_modified_time` auto-fill to `System.currentTimeMillis()` if omitted.

### `source_type` enum

```java
KNOWLEDGE_SOURCE_TYPE_DOCUMENT         = 1  // "Documents" tab
KNOWLEDGE_SOURCE_TYPE_NOTE             = 2  // "Notes" tab
KNOWLEDGE_SOURCE_TYPE_SYSTEM_PASTEBOARD = 3 // not wired to any sidebar tab at all
KNOWLEDGE_SOURCE_TYPE_SELF_ADD         = 4  // "Manual Entry" tab -- what this plugin uses
```

The sidebar's three tabs map 1:1 to `source_type` via
`FragmentNavigationManager.navigateToKnowledgeListBySourceType` — `3` isn't handled there at all
(hits an "unknown source type" log branch), so entries with that source_type aren't reachable
through normal navigation.

**Don't set `source_type` 1 or 2 without a real backing file.** The provider doesn't validate it,
but the detail view (`KnowledgeDetailFragment`) does real work with it: for `source_type=2` it
tries to build a "jump to note" link from `metadata.note_pageId`/`note_fileId`, and displays
`new File(source_path).getName()` as a source label either way — a fake path just shows a dangling
filename. `source_type=4` (self-add) is the only type with no source-file expectations at all;
it's what this plugin uses for every entry it creates. See the repo's `plans/plan.md` "Why is the
category 'Manual Entry'" discussion for the full reasoning.

## What this plugin actually uses

See `plugin/android/app/src/main/java/com/plugin/KnowledgeProviderModule.kt` for the Kotlin side
(plain `ContentResolver` calls, no `sn-plugin-lib` involvement) and
`plugin/src/lib/knowledgeProvider.ts` for the JS wrapper. Summary:

- `getOrCreateCategory(name)` → `knowledge_base/by_name` query, else `knowledge_base` insert +
  `knowledge_base/by_id/<id>` read-back. Used once per category name, then cached in
  `SettingsKey.DigestCategoryUniqueAttribute`.
- `findCategory(name)` -> same `knowledge_base/by_name` query, but read-only: resolves `null` if the
  category doesn't exist. Used by the export as a fallback to identify our own Readwise-tagged
  entries when the cached category id is missing.
- `insertEntry(content, categoryUniqueAttribute, metadataJson)` → `knowledge/insert` with
  `source_type=4`.
- `queryManualEntries()` → `knowledge` dir query with `selection="source_type = 4"`, for Task 4's
  export-back-to-Readwise flow (filters out entries already tagged with our own Readwise category
  client-side, to avoid a sync loop).
