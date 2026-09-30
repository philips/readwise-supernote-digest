/**
 * SQLite schema for the plugin's local Readwise cache.
 *
 * NOTE: on Android, react-native-sqlite-storage resolves databases via
 * `Context#getDatabasePath(name)` on whichever process the plugin JS is
 * running in (com.ratta.supernote.pluginhost) -- the `location` open option
 * is effectively a no-op on this platform (see node_change/react-native-sqlite-storage
 * platforms/android/src/main/java/org/pgsqlite/SQLitePlugin.java). That means
 * the database filename is the *only* thing separating this plugin's storage
 * from any other plugin's, so DB_NAME is namespaced with the plugin's own
 * pluginID (see src/db/index.ts) rather than a generic name like "app.db".
 */

export const CREATE_SETTINGS_TABLE = `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT
  );
`;

export const CREATE_HIGHLIGHTS_TABLE = `
  CREATE TABLE IF NOT EXISTS highlights (
    readwise_id INTEGER PRIMARY KEY NOT NULL,
    user_book_id INTEGER,
    book_title TEXT,
    book_author TEXT,
    category TEXT,
    source TEXT,
    text TEXT NOT NULL,
    note TEXT,
    location INTEGER,
    location_type TEXT,
    color TEXT,
    highlighted_at TEXT,
    created_at TEXT,
    updated_at TEXT,
    highlight_url TEXT,
    source_url TEXT,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    inserted_into_note_at TEXT,
    synced_to_digest_at TEXT,
    fetched_at TEXT NOT NULL
  );
`;

export const CREATE_HIGHLIGHTS_UPDATED_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_highlights_updated_at ON highlights(updated_at);
`;

export const CREATE_HIGHLIGHTS_BOOK_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_highlights_user_book_id ON highlights(user_book_id);
`;

/** Exported-to-Readwise bookkeeping for Task 4 (digest -> Readwise). Created now so the
 * schema is stable from v1; not populated until Task 4 is implemented. */
export const CREATE_EXPORTED_DIGEST_ENTRIES_TABLE = `
  CREATE TABLE IF NOT EXISTS exported_digest_entries (
    local_key TEXT PRIMARY KEY NOT NULL,
    readwise_highlight_id INTEGER,
    exported_at TEXT NOT NULL
  );
`;

/** Title/author resolved for a document (Digest "Documents" entry source_path). Cached so a
 * document keeps exporting under one stable title -- see src/lib/documentInfo/resolve.ts. */
export const CREATE_DOCUMENT_INFO_TABLE = `
  CREATE TABLE IF NOT EXISTS document_info (
    source_path TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    title_source TEXT NOT NULL,
    author_source TEXT,
    format TEXT,
    file_size INTEGER,
    file_mtime INTEGER,
    resolved_at TEXT NOT NULL
  );
`;

/** Text of everything we exported to Readwise (normalised, see src/lib/textKey.ts). An export
 * comes back on the next import as an ordinary highlight -- with the real book title for Documents
 * entries -- and must not be pushed into Digest again as a Readwise-category duplicate. */
export const CREATE_EXPORTED_TEXT_KEYS_TABLE = `
  CREATE TABLE IF NOT EXISTS exported_text_keys (
    text_key TEXT PRIMARY KEY NOT NULL
  );
`;

export const SCHEMA_STATEMENTS: string[] = [
  CREATE_SETTINGS_TABLE,
  CREATE_HIGHLIGHTS_TABLE,
  CREATE_HIGHLIGHTS_UPDATED_INDEX,
  CREATE_HIGHLIGHTS_BOOK_INDEX,
  CREATE_EXPORTED_DIGEST_ENTRIES_TABLE,
  CREATE_DOCUMENT_INFO_TABLE,
  CREATE_EXPORTED_TEXT_KEYS_TABLE,
];

/** Known `settings` table keys, centralized so callers don't hand-roll strings. */
export const SettingsKey = {
  ReadwiseApiToken: 'readwise_api_token',
  LastExportUpdatedAfter: 'last_export_updated_after',
  DigestSyncEnabled: 'digest_sync_enabled',
  ReadwiseExportEnabled: 'readwise_export_enabled',
  /** Read-only mode, stored inverted on purpose: ONLY the exact string '1' allows anything to be
   * sent to Readwise. Missing, empty, '0', garbage -- all mean read-only, so the default and every
   * failure mode are safe. See src/readwise/writeGuard.ts and plans/read-only-mode.md. */
  ReadwiseWritesEnabled: 'readwise_writes_enabled',
  DigestCategory: 'digest_category',
  /** Cached `unique_attribute` of the native Digest "knowledge_base" row matching
   * SettingsKey.DigestCategory, so we don't need to look it up (or risk re-creating it) on every
   * sync. See src/lib/digestSync.ts. */
  DigestCategoryUniqueAttribute: 'digest_category_unique_attribute',
} as const;

export type SettingsKeyType = (typeof SettingsKey)[keyof typeof SettingsKey];

/** Default value for SettingsKey.DigestCategory when unset. */
export const DEFAULT_DIGEST_CATEGORY = 'Readwise';
