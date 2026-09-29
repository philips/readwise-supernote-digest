import {loadEnv, highlight} from './helpers/env';

describe('digest sync (Readwise -> Digest)', () => {
  test('inserts pending highlights, tagged with the category, marks them synced', async () => {
    const {fakes, db, digestSync} = await loadEnv();
    await db.upsertHighlights([
      highlight({readwise_id: 1, text: 'one', book_title: 'B', book_author: 'A'}),
      highlight({readwise_id: 2, text: 'two'}),
    ]);
    const result = await digestSync.syncPendingHighlightsToDigest();
    expect(result.synced).toBe(2);
    expect(fakes.insertDigestEntry).toHaveBeenCalledTimes(2);
    expect(fakes.insertDigestEntry.mock.calls[0][0]).toMatchObject({
      content: 'one',
      categoryUniqueAttribute: 'attr-Readwise',
      author: 'B \u2014 A',
    });
    expect(await digestSync.getPendingDigestSyncCount()).toBe(0);
  });

  test('never pushes our own exports back into Digest', async () => {
    const {fakes, db, digestSync, constants} = await loadEnv();
    await db.upsertHighlights([
      highlight({readwise_id: 1, text: 'my own note', book_title: constants.SUPERNOTE_EXPORT_TITLE}),
    ]);
    expect(await digestSync.getPendingDigestSyncCount()).toBe(0);
    const result = await digestSync.syncPendingHighlightsToDigest();
    expect(result.synced).toBe(0);
    expect(fakes.insertDigestEntry).not.toHaveBeenCalled();
    expect(fakes.getOrCreateDigestCategory).not.toHaveBeenCalled();
  });

  test('second run inserts nothing (no duplicates)', async () => {
    const {fakes, db, digestSync} = await loadEnv();
    await db.upsertHighlights([highlight({readwise_id: 1})]);
    await digestSync.syncPendingHighlightsToDigest();
    await digestSync.syncPendingHighlightsToDigest();
    expect(fakes.insertDigestEntry).toHaveBeenCalledTimes(1);
  });

  test('deleted highlights are not synced', async () => {
    const {fakes, db, digestSync} = await loadEnv();
    await db.upsertHighlights([highlight({readwise_id: 1, is_deleted: true})]);
    await digestSync.syncPendingHighlightsToDigest();
    expect(fakes.insertDigestEntry).not.toHaveBeenCalled();
  });

  test.each([
    ['both', 'Title', 'Author', 'Title \u2014 Author'],
    ['title only', 'Title', null, 'Title'],
    ['author only', null, 'Author', 'Author'],
    ['neither', null, null, null],
    ['empty strings', '', '', null],
  ])('author label: %s', async (_n, title, author, expected) => {
    const {fakes, db, digestSync} = await loadEnv();
    await db.upsertHighlights([highlight({readwise_id: 1, book_title: title, book_author: author})]);
    await digestSync.syncPendingHighlightsToDigest();
    expect(fakes.insertDigestEntry.mock.calls[0][0].author).toBe(expected);
  });

  test('category is created once and cached', async () => {
    const {fakes, db, schema, digestSync} = await loadEnv();
    await db.upsertHighlights([highlight({readwise_id: 1})]);
    await digestSync.syncPendingHighlightsToDigest();
    await db.upsertHighlights([highlight({readwise_id: 2})]);
    await digestSync.syncPendingHighlightsToDigest();
    expect(fakes.getOrCreateDigestCategory).toHaveBeenCalledTimes(1);
    expect(await db.getSetting(schema.SettingsKey.DigestCategoryUniqueAttribute)).toBe('attr-Readwise');
  });

  test('insert failure stops the run; only successful inserts are marked; rerun resumes', async () => {
    const {fakes, db, digestSync} = await loadEnv();
    await db.upsertHighlights([
      highlight({readwise_id: 1, highlighted_at: '2026-01-01T00:00:00Z'}),
      highlight({readwise_id: 2, highlighted_at: '2026-01-02T00:00:00Z'}),
      highlight({readwise_id: 3, highlighted_at: '2026-01-03T00:00:00Z'}),
    ]);
    fakes.insertDigestEntry
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('provider gone'));
    await expect(digestSync.syncPendingHighlightsToDigest()).rejects.toThrow(/provider gone/);
    expect(await digestSync.getPendingDigestSyncCount()).toBe(2);

    const rerun = await digestSync.syncPendingHighlightsToDigest();
    expect(rerun.synced).toBe(2);
    expect(fakes.insertDigestEntry).toHaveBeenCalledTimes(4); // 1 ok + 1 failed + 2 resumed
  });

  test('category setup failure is reported as a DigestSyncError', async () => {
    const {fakes, db, digestSync} = await loadEnv();
    await db.upsertHighlights([highlight({readwise_id: 1})]);
    fakes.getOrCreateDigestCategory.mockRejectedValueOnce(new Error('denied'));
    await expect(digestSync.syncPendingHighlightsToDigest()).rejects.toBeInstanceOf(
      digestSync.DigestSyncError,
    );
    expect(await digestSync.getPendingDigestSyncCount()).toBe(1);
  });

  test('handles more than one fetch batch (25)', async () => {
    const {fakes, db, digestSync} = await loadEnv();
    await db.upsertHighlights(Array.from({length: 60}, (_, i) => highlight({readwise_id: i + 1})));
    const result = await digestSync.syncPendingHighlightsToDigest();
    expect(result.synced).toBe(60);
    expect(fakes.insertDigestEntry).toHaveBeenCalledTimes(60);
  });
});
