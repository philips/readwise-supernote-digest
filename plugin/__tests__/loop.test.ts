import {loadEnv, digestEntry} from './helpers/env';

/**
 * End-to-end simulation of the full cycle with Readwise's behaviour faked: what we POST comes
 * back from the export endpoint as a highlight in a book titled after our export title.
 */
describe('Digest -> Readwise -> Digest round trip', () => {
  test('a hand-typed entry is exported once, re-imported, and never duplicated in Digest', async () => {
    const {fakes, db, digestExport, digestSync, sync, constants} = await loadEnv();
    fakes.categories.Readwise = 'attr-Readwise';

    // 1. User types an entry in Digest; there are also 3 Readwise-imported entries.
    fakes.digestEntries = [
      digestEntry({id: 1, content: 'imported a', categoryUniqueAttribute: 'attr-Readwise'}),
      digestEntry({id: 2, content: 'imported b', categoryUniqueAttribute: 'attr-Readwise'}),
      digestEntry({id: 3, content: 'imported c', categoryUniqueAttribute: 'attr-Readwise'}),
      digestEntry({id: 4, content: 'typed by me'}),
    ];

    // 2. Export: only the hand-typed entry goes out.
    expect((await digestExport.exportPendingDigestEntries()).exported).toBe(1);

    // 3. Readwise echoes it back on the next import sync as a "Supernote Digest" highlight.
    const sent = fakes.createHighlights.mock.calls[0][1][0];
    fakes.fetchExportPage.mockResolvedValue({
      count: 1,
      nextPageCursor: null,
      results: [
        {
          user_book_id: 500,
          is_deleted: false,
          title: sent.title,
          author: null,
          source: sent.source_type,
          category: 'books',
          readwise_url: 'https://readwise.io/bookreview/500',
          source_url: null,
          highlights: [
            {
              id: 9001, is_deleted: false, text: sent.text, location: null, location_type: null,
              note: null, color: null, highlighted_at: sent.highlighted_at, created_at: null,
              updated_at: null, url: null,
            },
          ],
        },
      ],
    });
    await sync.syncHighlights('t');
    expect(await db.getHighlightCount()).toBe(1);

    // 4. Digest sync must not push it back in.
    expect(sent.title).toBe(constants.SUPERNOTE_EXPORT_TITLE);
    expect(await digestSync.getPendingDigestSyncCount()).toBe(0);
    await digestSync.syncPendingHighlightsToDigest();
    expect(fakes.insertDigestEntry).not.toHaveBeenCalled();

    // 5. Export again: still nothing new, and the (already exported) entry isn't re-sent.
    expect(await digestExport.getPendingDigestExportCount()).toBe(0);
  });

  test('a genuine Readwise highlight synced into Digest is not exported back', async () => {
    const {fakes, db, digestExport, digestSync} = await loadEnv();
    const {highlight} = require('./helpers/env');
    await db.upsertHighlights([highlight({readwise_id: 1, text: 'from a book'})]);
    await digestSync.syncPendingHighlightsToDigest();

    // Simulate the Digest app now containing that entry under the Readwise category.
    const inserted = fakes.insertDigestEntry.mock.calls[0][0];
    fakes.digestEntries = [
      digestEntry({id: 1, content: inserted.content, categoryUniqueAttribute: inserted.categoryUniqueAttribute}),
    ];
    expect(await digestExport.getPendingDigestExportCount()).toBe(0);
  });

  test('data reset (empty cache + empty exported table) still does not re-export imports', async () => {
    const {fakes, digestExport} = await loadEnv();
    fakes.categories.Readwise = 'attr-Readwise';
    fakes.digestEntries = Array.from({length: 500}, (_, i) =>
      digestEntry({id: i + 1, categoryUniqueAttribute: 'attr-Readwise'}),
    );
    expect(await digestExport.getPendingDigestExportCount()).toBe(0);
  });
});
