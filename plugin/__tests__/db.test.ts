import {loadEnv, highlight} from './helpers/env';

describe('db: own-export rule (markOwnExportsSyncedToDigest)', () => {
  test('highlights titled "Supernote Digest" are never pending for Digest sync', async () => {
    const {db, constants} = await loadEnv();
    await db.upsertHighlights([
      highlight({readwise_id: 1, book_title: constants.SUPERNOTE_EXPORT_TITLE}),
      highlight({readwise_id: 2, book_title: 'Real Book'}),
    ]);
    const pending = await db.getUnsyncedToDigestHighlights();
    expect(pending.map((h: any) => h.readwise_id)).toEqual([2]);
    expect(await db.getUnsyncedToDigestCount()).toBe(1);
  });

  test('title match is exact: near-misses still sync into Digest', async () => {
    const {db} = await loadEnv();
    await db.upsertHighlights([
      highlight({readwise_id: 1, book_title: 'supernote digest'}),
      highlight({readwise_id: 2, book_title: 'Supernote Digest 2'}),
      highlight({readwise_id: 3, book_title: null}),
    ]);
    expect(await db.getUnsyncedToDigestCount()).toBe(3);
  });

  test('applies to rows cached before the rule existed (app restart runs it at init)', async () => {
    const first = await loadEnv();
    // Old cache: a row inserted with raw SQL, bypassing upsertHighlights.
    await first.db.runSQL(
      `INSERT INTO highlights (readwise_id, text, book_title, fetched_at) VALUES (?, ?, ?, ?)`,
      [77, 'old export', first.constants.SUPERNOTE_EXPORT_TITLE, '2026-01-01T00:00:00Z'],
    );
    expect(await first.db.getUnsyncedToDigestCount()).toBe(1);

    // "Restart": new module registry, same database. initDatabase() must repair the row.
    const second = await loadEnv({keepDatabase: true});
    expect(await second.db.getUnsyncedToDigestCount()).toBe(0);
  });

  test('does not overwrite a real synced_to_digest_at timestamp', async () => {
    const {db, constants} = await loadEnv();
    await db.upsertHighlights([
      highlight({readwise_id: 1, book_title: constants.SUPERNOTE_EXPORT_TITLE}),
    ]);
    await db.markHighlightSyncedToDigest(1, '2030-05-05T00:00:00Z');
    await db.upsertHighlights([highlight({readwise_id: 2})]);
    const {rows} = await db.runSQL('SELECT synced_to_digest_at FROM highlights WHERE readwise_id = 1');
    expect(rows[0].synced_to_digest_at).toBe('2030-05-05T00:00:00Z');
  });

  test('re-upserting an existing highlight keeps its synced state', async () => {
    const {db} = await loadEnv();
    await db.upsertHighlights([highlight({readwise_id: 5})]);
    await db.markHighlightSyncedToDigest(5, '2026-02-02T00:00:00Z');
    await db.upsertHighlights([highlight({readwise_id: 5, text: 'edited on Readwise'})]);
    expect(await db.getUnsyncedToDigestCount()).toBe(0);
  });

  test('empty upsert is a no-op', async () => {
    const {db} = await loadEnv();
    await expect(db.upsertHighlights([])).resolves.toBeUndefined();
    expect(await db.getHighlightCount()).toBe(0);
  });
});

describe('db: deleted highlights', () => {
  test('are excluded from counts, listings and the Digest queue', async () => {
    const {db} = await loadEnv();
    await db.upsertHighlights([
      highlight({readwise_id: 1}),
      highlight({readwise_id: 2, is_deleted: true}),
    ]);
    expect(await db.getHighlightCount()).toBe(1);
    expect((await db.listHighlights()).map((h: any) => h.readwise_id)).toEqual([1]);
    expect(await db.getUnsyncedToDigestCount()).toBe(1);
  });

  test('a highlight deleted later by an incremental sync drops out of the count', async () => {
    const {db} = await loadEnv();
    await db.upsertHighlights([highlight({readwise_id: 1})]);
    expect(await db.getHighlightCount()).toBe(1);
    await db.upsertHighlights([highlight({readwise_id: 1, is_deleted: true})]);
    expect(await db.getHighlightCount()).toBe(0);
  });
});

describe('db: exported_digest_entries', () => {
  test('tracks keys as strings and is idempotent', async () => {
    const {db} = await loadEnv();
    await db.markDigestEntryExported('12', '2026-01-01T00:00:00Z');
    await db.markDigestEntryExported('12', '2026-01-02T00:00:00Z');
    const keys = await db.getExportedDigestEntryKeys();
    expect([...keys]).toEqual(['12']);
  });

  test('clearAllData wipes highlights, settings and export bookkeeping', async () => {
    const {db} = await loadEnv();
    await db.upsertHighlights([highlight({readwise_id: 1})]);
    await db.markDigestEntryExported('1', '2026-01-01T00:00:00Z');
    await db.clearAllData();
    expect(await db.getHighlightCount()).toBe(0);
    expect((await db.getExportedDigestEntryKeys()).size).toBe(0);
    expect(await db.getReadwiseApiToken()).toBeNull();
  });
});

describe('db: search', () => {
  test('LIKE search matches text, title and author', async () => {
    const {db} = await loadEnv();
    await db.upsertHighlights([
      highlight({readwise_id: 1, text: 'needle in text'}),
      highlight({readwise_id: 2, book_title: 'The Needle'}),
      highlight({readwise_id: 3, book_author: 'Needleman'}),
      highlight({readwise_id: 4, text: 'nothing'}),
    ]);
    const ids = (await db.listHighlights({search: 'needle'})).map((h: any) => h.readwise_id);
    expect(ids.sort()).toEqual([1, 2, 3]);
  });
});
