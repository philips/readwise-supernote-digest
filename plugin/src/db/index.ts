import SQLite from 'react-native-sqlite-storage';
import PluginConfigJson from '../../PluginConfig.json';
import {SCHEMA_STATEMENTS, SettingsKey} from './schema';
import type {LocalHighlightRow} from '../readwise/types';
import {SUPERNOTE_EXPORT_TITLE} from '../readwise/constants';
import type {DocumentInfo} from '../lib/documentInfo/resolve';

SQLite.enablePromise(false); // we use the callback API and wrap it ourselves below

const PLUGIN_ID: string = PluginConfigJson.pluginID;
// See schema.ts for why the pluginID is baked into the filename rather than relied on
// via the `location` open option.
const DB_NAME = `readwise-digest-${PLUGIN_ID}.db`;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  return new Promise((resolve, reject) => {
    SQLite.openDatabase(
      {name: DB_NAME, location: 'default'},
      db => resolve(db),
      err => reject(err),
    );
  });
}

export interface SqlResult {
  rows: any[];
  insertId?: number;
  rowsAffected: number;
}

export async function runSQL(sql: string, args: any[] = []): Promise<SqlResult> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        tx.executeSql(
          sql,
          args,
          (_tx, result) => {
            const rows: any[] = [];
            for (let i = 0; i < result.rows.length; i++) {
              rows.push(result.rows.item(i));
            }
            resolve({
              rows,
              insertId: result.insertId,
              rowsAffected: result.rowsAffected,
            });
          },
          (_tx, err) => {
            reject(err);
            return false; // don't roll back the whole transaction on a single statement error
          },
        );
      },
      txErr => reject(txErr),
    );
  });
}

/** Run several statements inside one transaction (used for batch highlight upserts). */
export async function runInTransaction(
  statements: Array<{sql: string; args?: any[]}>,
): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        for (const {sql, args} of statements) {
          tx.executeSql(sql, args ?? []);
        }
      },
      txErr => reject(txErr),
      () => resolve(),
    );
  });
}

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openDatabase();
  }
  return dbPromise;
}

let initPromise: Promise<void> | null = null;

/** Idempotent — safe to call on every app mount. */
export function initDatabase(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      for (const statement of SCHEMA_STATEMENTS) {
        await runSQL(statement);
      }
      // Also covers rows cached before this rule existed.
      await markOwnExportsSyncedToDigest();
    })();
  }
  return initPromise;
}

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

export async function getSetting(key: string): Promise<string | null> {
  const {rows} = await runSQL('SELECT value FROM settings WHERE key = ?', [key]);
  return rows.length > 0 ? (rows[0].value as string | null) : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await runSQL('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
}

export async function deleteSetting(key: string): Promise<void> {
  await runSQL('DELETE FROM settings WHERE key = ?', [key]);
}

export async function getReadwiseApiToken(): Promise<string | null> {
  return getSetting(SettingsKey.ReadwiseApiToken);
}

// ---------------------------------------------------------------------------
// highlights
// ---------------------------------------------------------------------------

const UPSERT_HIGHLIGHT_SQL = `
  INSERT INTO highlights (
    readwise_id, user_book_id, book_title, book_author, category, source,
    text, note, location, location_type, color, highlighted_at, created_at,
    updated_at, highlight_url, source_url, is_deleted, fetched_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(readwise_id) DO UPDATE SET
    user_book_id = excluded.user_book_id,
    book_title = excluded.book_title,
    book_author = excluded.book_author,
    category = excluded.category,
    source = excluded.source,
    text = excluded.text,
    note = excluded.note,
    location = excluded.location,
    location_type = excluded.location_type,
    color = excluded.color,
    highlighted_at = excluded.highlighted_at,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    highlight_url = excluded.highlight_url,
    source_url = excluded.source_url,
    is_deleted = excluded.is_deleted,
    fetched_at = excluded.fetched_at;
`;

export async function upsertHighlights(highlights: LocalHighlightRow[]): Promise<void> {
  if (highlights.length === 0) {return;}
  const statements = highlights.map(h => ({
    sql: UPSERT_HIGHLIGHT_SQL,
    args: [
      h.readwise_id,
      h.user_book_id,
      h.book_title,
      h.book_author,
      h.category,
      h.source,
      h.text,
      h.note,
      h.location,
      h.location_type,
      h.color,
      h.highlighted_at,
      h.created_at,
      h.updated_at,
      h.highlight_url,
      h.source_url,
      h.is_deleted ? 1 : 0,
      h.fetched_at,
    ],
  }));
  await runInTransaction(statements);
  await markOwnExportsSyncedToDigest();
}

/**
 * Highlights we exported to Readwise ourselves (Digest -> Readwise) come back down on the next
 * import sync as ordinary highlights. They originated in Digest, so pushing them back into Digest
 * (Readwise -> Digest) would create a duplicate of the user's own entry. Mark them as already
 * synced so digestSync skips them.
 */
async function markOwnExportsSyncedToDigest(): Promise<void> {
  await runSQL(
    `UPDATE highlights SET synced_to_digest_at = fetched_at
     WHERE book_title = ? AND synced_to_digest_at IS NULL`,
    [SUPERNOTE_EXPORT_TITLE],
  );
}

export async function getHighlightCount(): Promise<number> {
  const {rows} = await runSQL(
    'SELECT COUNT(*) as count FROM highlights WHERE is_deleted = 0',
  );
  return rows.length > 0 ? Number(rows[0].count) : 0;
}

export async function listHighlights(
  options: {limit?: number; offset?: number; search?: string} = {},
): Promise<LocalHighlightRow[]> {
  const {limit = 50, offset = 0, search} = options;
  if (search && search.trim().length > 0) {
    const like = `%${search.trim()}%`;
    const {rows} = await runSQL(
      `SELECT * FROM highlights WHERE is_deleted = 0
       AND (text LIKE ? OR book_title LIKE ? OR book_author LIKE ?)
       ORDER BY highlighted_at DESC LIMIT ? OFFSET ?`,
      [like, like, like, limit, offset],
    );
    return rows as LocalHighlightRow[];
  }
  const {rows} = await runSQL(
    'SELECT * FROM highlights WHERE is_deleted = 0 ORDER BY highlighted_at DESC LIMIT ? OFFSET ?',
    [limit, offset],
  );
  return rows as LocalHighlightRow[];
}

export async function markHighlightInsertedIntoNote(
  readwiseId: number,
  timestamp: string,
): Promise<void> {
  await runSQL('UPDATE highlights SET inserted_into_note_at = ? WHERE readwise_id = ?', [
    timestamp,
    readwiseId,
  ]);
}

export async function markHighlightSyncedToDigest(
  readwiseId: number,
  timestamp: string,
): Promise<void> {
  await runSQL('UPDATE highlights SET synced_to_digest_at = ? WHERE readwise_id = ?', [
    timestamp,
    readwiseId,
  ]);
}

export async function getUnsyncedToDigestHighlights(
  limit = 25,
): Promise<LocalHighlightRow[]> {
  const {rows} = await runSQL(
    `SELECT * FROM highlights WHERE is_deleted = 0 AND synced_to_digest_at IS NULL
     ORDER BY highlighted_at ASC LIMIT ?`,
    [limit],
  );
  return rows as LocalHighlightRow[];
}

export async function getUnsyncedToDigestCount(): Promise<number> {
  const {rows} = await runSQL(
    'SELECT COUNT(*) as count FROM highlights WHERE is_deleted = 0 AND synced_to_digest_at IS NULL',
  );
  return rows.length > 0 ? Number(rows[0].count) : 0;
}

// ---------------------------------------------------------------------------
// exported_digest_entries (Task 4: Digest -> Readwise export bookkeeping)
// ---------------------------------------------------------------------------

/** Every `local_key` (Digest entry id, stringified) already exported to Readwise, as a Set for
 * fast membership checks against a freshly-queried Digest entry list. */
export async function getExportedDigestEntryKeys(): Promise<Set<string>> {
  const {rows} = await runSQL('SELECT local_key FROM exported_digest_entries');
  return new Set(rows.map(r => String(r.local_key)));
}

export async function markDigestEntryExported(
  localKey: string,
  exportedAt: string,
  readwiseHighlightId?: number | null,
): Promise<void> {
  await runSQL(
    'INSERT OR REPLACE INTO exported_digest_entries (local_key, readwise_highlight_id, exported_at) VALUES (?, ?, ?)',
    [localKey, readwiseHighlightId ?? null, exportedAt],
  );
}

// ---------------------------------------------------------------------------
// document_info (title/author cache for Documents-bucket Digest entries)
// ---------------------------------------------------------------------------

export interface CachedDocumentInfo {
  info: DocumentInfo;
  file_size: number | null;
  file_mtime: number | null;
}

export async function getDocumentInfoCache(
  sourcePath: string,
): Promise<CachedDocumentInfo | null> {
  const {rows} = await runSQL('SELECT * FROM document_info WHERE source_path = ?', [sourcePath]);
  if (rows.length === 0) {return null;}
  const r = rows[0];
  return {
    info: {
      title: r.title,
      author: r.author ?? null,
      titleSource: r.title_source,
      authorSource: r.author_source ?? null,
      format: r.format ?? null,
    },
    file_size: r.file_size ?? null,
    file_mtime: r.file_mtime ?? null,
  };
}

export async function putDocumentInfoCache(
  sourcePath: string,
  info: DocumentInfo,
  fileSize: number | null,
  fileMtime: number | null,
): Promise<void> {
  await runSQL(
    `INSERT OR REPLACE INTO document_info
       (source_path, title, author, title_source, author_source, format, file_size, file_mtime, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sourcePath,
      info.title,
      info.author,
      info.titleSource,
      info.authorSource,
      info.format,
      fileSize,
      fileMtime,
      new Date().toISOString(),
    ],
  );
}

export async function clearAllData(): Promise<void> {
  await runSQL('DELETE FROM highlights');
  await runSQL('DELETE FROM settings');
  await runSQL('DELETE FROM exported_digest_entries');
  await runSQL('DELETE FROM document_info');
}
