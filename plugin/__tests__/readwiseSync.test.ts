import {loadEnv} from './helpers/env';

function book(overrides: any = {}) {
  return {
    user_book_id: 10,
    is_deleted: false,
    title: 'Book',
    author: 'Author',
    source: 'kindle',
    category: 'books',
    readwise_url: 'https://readwise.io/bookreview/10',
    source_url: null,
    highlights: [
      {
        id: 100,
        is_deleted: false,
        text: 'hello',
        location: 1,
        location_type: 'page',
        note: null,
        color: null,
        highlighted_at: null,
        created_at: null,
        updated_at: null,
        url: null,
      },
    ],
    ...overrides,
  };
}

const page = (results: any[], nextPageCursor: string | null = null) => ({
  count: results.length,
  nextPageCursor,
  results,
});

describe('import sync (Readwise -> cache)', () => {
  test('first sync does not request deletions; later syncs do', async () => {
    const {fakes, sync} = await loadEnv();
    fakes.fetchExportPage.mockResolvedValue(page([book()]));
    await sync.syncHighlights('t');
    expect(fakes.fetchExportPage.mock.calls[0][1].includeDeleted).toBe(false);
    expect(fakes.fetchExportPage.mock.calls[0][1].updatedAfter).toBeUndefined();

    await sync.syncHighlights('t');
    expect(fakes.fetchExportPage.mock.calls[1][1].includeDeleted).toBe(true);
    expect(fakes.fetchExportPage.mock.calls[1][1].updatedAfter).toBeTruthy();
  });

  test('follows pagination cursors until exhausted', async () => {
    const {fakes, db, sync} = await loadEnv();
    fakes.fetchExportPage
      .mockResolvedValueOnce(page([book({user_book_id: 1, highlights: [{...book().highlights[0], id: 1}]})], 'c2'))
      .mockResolvedValueOnce(page([book({user_book_id: 2, highlights: [{...book().highlights[0], id: 2}]})], null));
    const result = await sync.syncHighlights('t');
    expect(result).toEqual({highlightsFetched: 2, pages: 2});
    expect(fakes.fetchExportPage.mock.calls[1][1].pageCursor).toBe('c2');
    expect(await db.getHighlightCount()).toBe(2);
  });

  test('a highlight deleted on Readwise disappears from the cache on the next sync', async () => {
    const {fakes, db, sync} = await loadEnv();
    fakes.fetchExportPage.mockResolvedValueOnce(page([book()]));
    await sync.syncHighlights('t');
    expect(await db.getHighlightCount()).toBe(1);

    const deleted = book();
    deleted.highlights[0].is_deleted = true;
    fakes.fetchExportPage.mockResolvedValueOnce(page([deleted]));
    await sync.syncHighlights('t');
    expect(await db.getHighlightCount()).toBe(0);
  });

  test('a deleted book deletes all of its highlights, even those not flagged themselves', async () => {
    const {fakes, db, sync} = await loadEnv();
    const b = book({is_deleted: true});
    b.highlights.push({...b.highlights[0], id: 101});
    fakes.fetchExportPage.mockResolvedValueOnce(page([b]));
    await sync.syncHighlights('t');
    expect(await db.getHighlightCount()).toBe(0);
  });

  test('a failed sync does not advance the incremental cursor', async () => {
    const {fakes, db, schema, sync} = await loadEnv();
    fakes.fetchExportPage.mockRejectedValueOnce(new Error('network'));
    await expect(sync.syncHighlights('t')).rejects.toThrow('network');
    expect(await db.getSetting(schema.SettingsKey.LastExportUpdatedAfter)).toBeNull();
  });

  test('book with no highlights flattens to nothing', async () => {
    const {types} = await loadEnv();
    expect(types.flattenExportBook(book({highlights: []}), 'now')).toEqual([]);
  });

  test('highlight_url prefers the highlight link, falls back to the book page', async () => {
    const {types} = await loadEnv();
    const withUrl = book();
    withUrl.highlights[0].url = 'https://x/y';
    expect(types.flattenExportBook(withUrl, 'now')[0].highlight_url).toBe('https://x/y');
    expect(types.flattenExportBook(book(), 'now')[0].highlight_url).toBe(
      'https://readwise.io/bookreview/10',
    );
  });
});
