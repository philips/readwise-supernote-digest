import {loadEnv, digestEntry, documentEntry, highlight} from './helpers/env';

const READWISE_ATTR = 'attr-Readwise';

async function setup() {
  const env = await loadEnv();
  env.fakes.categories.Readwise = READWISE_ATTR;
  await env.db.setSetting(env.schema.SettingsKey.DigestCategoryUniqueAttribute, READWISE_ATTR);
  // Default: files are readable and carry embedded metadata.
  env.fakes.readDocumentMetadata.mockImplementation(async () => ({
    exists: true, size: 10, mtime: 1, format: 'pdf', title: 'Embedded Title', authors: ['Embedded Author'],
  }));
  return env;
}

const sentHighlights = (env: any) => env.fakes.createHighlights.mock.calls.flatMap((c: any[]) => c[1]);

describe('document export: payload', () => {
  test('book highlight goes out under the real title/author with page, note and category', async () => {
    const env = await setup();
    env.fakes.documentEntries = [
      documentEntry({content: '  A passage \n', sourcePage: '26', comment: '  my thought '}),
    ];
    const result = await env.digestExport.exportPendingDigestEntries();
    expect(result).toEqual({exported: 1, documents: 1, usedFilename: 0});
    const [h] = sentHighlights(env);
    expect(h).toMatchObject({
      text: 'A passage',
      title: 'Embedded Title',
      author: 'Embedded Author',
      category: 'books',
      location: 26,
      location_type: 'page',
      note: 'my thought',
      source_type: env.constants.SUPERNOTE_EXPORT_SOURCE_TYPE,
      highlighted_at: '2026-01-01T00:00:00.000Z',
    });
  });

  test.each([
    ['12', 12],
    [' 7 ', 7],
    ['0', undefined],
    ['', undefined],
    [null, undefined],
    ['abc', undefined],
    ['12-13', undefined],
    ['-3', undefined],
    ['1.5', undefined],
  ])('page %j -> location %j (and location_type only when there is a location)', async (page, expected) => {
    const env = await setup();
    env.fakes.documentEntries = [documentEntry({sourcePage: page as any})];
    await env.digestExport.exportPendingDigestEntries();
    const [h] = sentHighlights(env);
    expect(h.location).toBe(expected);
    expect(h.location_type).toBe(expected === undefined ? undefined : 'page');
  });

  test.each([[null], [''], ['   \n']])('blank comment %j sends no note', async comment => {
    const env = await setup();
    env.fakes.documentEntries = [documentEntry({comment})];
    await env.digestExport.exportPendingDigestEntries();
    expect(sentHighlights(env)[0].note).toBeUndefined();
  });

  test('blank content is skipped like for manual entries', async () => {
    const env = await setup();
    env.fakes.documentEntries = [documentEntry({content: '  '}), documentEntry({content: null})];
    expect(await env.digestExport.getPendingDigestExportCount()).toBe(0);
  });

  test('author omitted when neither the file nor the filename has one', async () => {
    const env = await setup();
    env.fakes.readDocumentMetadata.mockResolvedValue({exists: true, size: 1, mtime: 1, format: 'pdf', title: 'T', authors: []});
    env.fakes.documentEntries = [documentEntry({sourcePath: 'Document/1987-mcdermott.pdf'})];
    await env.digestExport.exportPendingDigestEntries();
    expect(sentHighlights(env)[0].author).toBeUndefined();
  });
});

describe('document export: filename fallback (missing or unreadable metadata)', () => {
  test('unreadable file (host denied the read) exports under the filename title', async () => {
    const env = await setup();
    env.fakes.readDocumentMetadata.mockResolvedValue({
      exists: true, size: 1, mtime: 1,
      error: 'SecurityException: Plugin [x] is not allowed to access sdcard path outside whitelist: /y',
    });
    env.fakes.documentEntries = [
      documentEntry({sourcePath: 'Android/data/com.ratta.supernote.serverlink/files/sync/2/books/Math/Concrete Mathematics_ A Foundation - Ronald L. Graham, Donald E. Knuth.pdf'}),
    ];
    const result = await env.digestExport.exportPendingDigestEntries();
    expect(result).toEqual({exported: 1, documents: 1, usedFilename: 1});
    expect(sentHighlights(env)[0]).toMatchObject({
      title: 'Concrete Mathematics: A Foundation',
      author: 'Ronald L. Graham, Donald E. Knuth',
    });
  });

  test('missing file and a name with no author: stem as title, no author', async () => {
    const env = await setup();
    env.fakes.readDocumentMetadata.mockResolvedValue({exists: false});
    env.fakes.documentEntries = [documentEntry({sourcePath: 'Document/1987-mcdermott.pdf'})];
    const result = await env.digestExport.exportPendingDigestEntries();
    expect(result.usedFilename).toBe(1);
    const [h] = sentHighlights(env);
    expect(h.title).toBe('1987-mcdermott');
    expect(h.author).toBeUndefined();
  });

  test('a junk filename still yields a non-empty title', async () => {
    const env = await setup();
    env.fakes.readDocumentMetadata.mockResolvedValue({exists: false});
    env.fakes.documentEntries = [documentEntry({sourcePath: 'Document/book - Unknown.pdf'})];
    await env.digestExport.exportPendingDigestEntries();
    expect(sentHighlights(env)[0].title).toBeTruthy();
  });

  test('no source path at all still exports', async () => {
    const env = await setup();
    env.fakes.documentEntries = [documentEntry({sourcePath: null})];
    const result = await env.digestExport.exportPendingDigestEntries();
    expect(result.exported).toBe(1);
    expect(sentHighlights(env)[0].title).toBeTruthy();
  });

  test('the native module blowing up does not stop the export', async () => {
    const env = await setup();
    env.fakes.readDocumentMetadata.mockRejectedValue(new Error('module not registered'));
    env.fakes.documentEntries = [documentEntry({sourcePath: 'Document/Some Book - Some Author.epub'})];
    const result = await env.digestExport.exportPendingDigestEntries();
    expect(result).toEqual({exported: 1, documents: 1, usedFilename: 1});
    expect(sentHighlights(env)[0]).toMatchObject({title: 'Some Book', author: 'Some Author'});
  });

  test('declining file access still exports (filename), and does not abort', async () => {
    const env = await setup();
    env.fakes.ensureFileReadPermission.mockResolvedValue(false);
    env.fakes.readDocumentMetadata.mockResolvedValue({
      exists: true, size: 1, mtime: 1, error: 'SecurityException: no READ permission on sdcard',
    });
    env.fakes.documentEntries = [documentEntry({sourcePath: 'Document/Some Book - Some Author.epub'})];
    const result = await env.digestExport.exportPendingDigestEntries();
    expect(result).toEqual({exported: 1, documents: 1, usedFilename: 1});
    expect(sentHighlights(env)[0].title).toBe('Some Book');
  });

  test('a throwing permission prompt is treated as declined', async () => {
    const env = await setup();
    env.fakes.ensureFileReadPermission.mockRejectedValue(new Error('prompt failed'));
    env.fakes.documentEntries = [documentEntry()];
    await expect(env.digestExport.exportPendingDigestEntries()).resolves.toMatchObject({exported: 1});
  });
});

describe('document export: permission prompt and file access', () => {
  test('only asks for file access when a book highlight is actually pending', async () => {
    const env = await setup();
    env.fakes.digestEntries = [digestEntry({id: 1})];
    await env.digestExport.exportPendingDigestEntries();
    expect(env.fakes.ensureFileReadPermission).not.toHaveBeenCalled();
    expect(env.fakes.readDocumentMetadata).not.toHaveBeenCalled();

    env.fakes.documentEntries = [documentEntry()];
    await env.digestExport.exportPendingDigestEntries();
    expect(env.fakes.ensureFileReadPermission).toHaveBeenCalledTimes(1);
  });

  test('counting pending entries never touches files or prompts', async () => {
    const env = await setup();
    env.fakes.documentEntries = [documentEntry(), documentEntry()];
    expect(await env.digestExport.getPendingDigestExportCount()).toBe(2);
    expect(env.fakes.readDocumentMetadata).not.toHaveBeenCalled();
    expect(env.fakes.ensureFileReadPermission).not.toHaveBeenCalled();
  });

  test('each book is resolved once per run, however many highlights it has', async () => {
    const env = await setup();
    env.fakes.documentEntries = [
      documentEntry({sourcePath: 'Document/A - X.pdf'}),
      documentEntry({sourcePath: 'Document/A - X.pdf'}),
      documentEntry({sourcePath: 'Document/A - X.pdf'}),
      documentEntry({sourcePath: 'Document/B - Y.pdf'}),
    ];
    await env.digestExport.exportPendingDigestEntries();
    expect(env.fakes.readDocumentMetadata).toHaveBeenCalledTimes(2);
  });

  test('an unreadable book is also looked at once per run (its answer is not cached as final)', async () => {
    const env = await setup();
    env.fakes.readDocumentMetadata.mockResolvedValue({exists: true, size: 1, mtime: 1, error: 'denied'});
    env.fakes.documentEntries = Array.from({length: 5}, () =>
      documentEntry({sourcePath: 'Document/A - X.pdf'}),
    );
    await env.digestExport.exportPendingDigestEntries();
    expect(env.fakes.readDocumentMetadata).toHaveBeenCalledTimes(1);
  });
});

describe('document export: title stability (Readwise de-dupes on title)', () => {
  test('a later highlight from the same book keeps the first title even if the file changed', async () => {
    const env = await setup();
    env.fakes.documentEntries = [documentEntry({sourcePath: 'Document/A - X.pdf'})];
    await env.digestExport.exportPendingDigestEntries();

    env.fakes.readDocumentMetadata.mockResolvedValue({
      exists: true, size: 2, mtime: 2, format: 'pdf', title: 'Retitled', authors: ['Someone Else'],
    });
    env.fakes.documentEntries.push(documentEntry({sourcePath: 'Document/A - X.pdf', content: 'second'}));
    await env.digestExport.exportPendingDigestEntries();
    const titles = sentHighlights(env).map((h: any) => h.title);
    expect(titles).toEqual(['Embedded Title', 'Embedded Title']);
  });

  test('documented limitation: a filename guess is upgraded once the file becomes readable', async () => {
    const env = await setup();
    env.fakes.readDocumentMetadata.mockResolvedValue({exists: true, size: 1, mtime: 1, error: 'denied'});
    env.fakes.documentEntries = [documentEntry({sourcePath: 'Document/A Book - An Author.pdf'})];
    await env.digestExport.exportPendingDigestEntries();

    env.fakes.readDocumentMetadata.mockResolvedValue({
      exists: true, size: 1, mtime: 1, format: 'pdf', title: 'The Real Title', authors: ['An Author'],
    });
    env.fakes.documentEntries.push(documentEntry({sourcePath: 'Document/A Book - An Author.pdf', content: 'later'}));
    await env.digestExport.exportPendingDigestEntries();
    const titles = sentHighlights(env).map((h: any) => h.title);
    expect(titles).toEqual(['A Book', 'The Real Title']);
  });
});

describe('document export: bookkeeping and mixing with manual entries', () => {
  test('manual and book entries are exported together, counts split correctly', async () => {
    const env = await setup();
    env.fakes.digestEntries = [digestEntry({id: 1}), digestEntry({id: 2})];
    env.fakes.documentEntries = [documentEntry({id: 3}), documentEntry({id: 4})];
    const result = await env.digestExport.exportPendingDigestEntries();
    expect(result).toEqual({exported: 4, documents: 2, usedFilename: 0});
    const titles = sentHighlights(env).map((h: any) => h.title);
    expect(titles.filter((t: string) => t === env.constants.SUPERNOTE_EXPORT_TITLE)).toHaveLength(2);
    expect(await env.digestExport.getPendingDigestExportCount()).toBe(0);
  });

  test('manual entries are unchanged: still the shared title, no category or location', async () => {
    const env = await setup();
    env.fakes.digestEntries = [digestEntry({id: 1})];
    await env.digestExport.exportPendingDigestEntries();
    const [h] = sentHighlights(env);
    expect(h.title).toBe(env.constants.SUPERNOTE_EXPORT_TITLE);
    expect(h.category).toBeUndefined();
    expect(h.location).toBeUndefined();
  });

  test('exported book highlights are not exported twice', async () => {
    const env = await setup();
    env.fakes.documentEntries = [documentEntry({id: 9})];
    await env.digestExport.exportPendingDigestEntries();
    expect((await env.digestExport.exportPendingDigestEntries()).exported).toBe(0);
    expect(env.fakes.createHighlights).toHaveBeenCalledTimes(1);
  });

  test('book highlights carrying the Readwise category are never exported', async () => {
    const env = await setup();
    env.fakes.documentEntries = [documentEntry({categoryUniqueAttribute: READWISE_ATTR})];
    expect(await env.digestExport.getPendingDigestExportCount()).toBe(0);
  });

  test('batches of 100 across the mixed list; a failure resumes where it stopped', async () => {
    const env = await setup();
    env.fakes.digestEntries = Array.from({length: 90}, (_, i) => digestEntry({id: i + 1}));
    env.fakes.documentEntries = Array.from({length: 60}, (_, i) => documentEntry({id: 1000 + i}));
    env.fakes.createHighlights.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('boom'));
    await expect(env.digestExport.exportPendingDigestEntries()).rejects.toThrow(/boom/);
    expect((await env.db.getExportedDigestEntryKeys()).size).toBe(100);

    const rerun = await env.digestExport.exportPendingDigestEntries();
    expect(rerun.exported).toBe(50);
  });

  test('a failed batch remembers no export text (so nothing is wrongly treated as already in Digest)', async () => {
    const env = await setup();
    env.fakes.documentEntries = [documentEntry({content: 'never sent'})];
    env.fakes.createHighlights.mockRejectedValueOnce(new Error('offline'));
    await expect(env.digestExport.exportPendingDigestEntries()).rejects.toThrow();
    await env.db.upsertHighlights([highlight({readwise_id: 1, text: 'never sent'})]);
    expect(await env.digestSync.getPendingDigestSyncCount()).toBe(1);
  });
});

describe('loop prevention for book highlights', () => {
  // An exported book highlight returns from Readwise under its real title. With "Sync into
  // Digest" on it would otherwise be pushed into Digest again as a Readwise-category duplicate.

  test('re-imported under the real book title: not pushed back into Digest', async () => {
    const env = await setup();
    env.fakes.documentEntries = [documentEntry({content: 'It was the best of times'})];
    await env.digestExport.exportPendingDigestEntries();

    await env.db.upsertHighlights([
      highlight({readwise_id: 1, book_title: 'Embedded Title', book_author: 'Embedded Author', source: 'supernote_digest', text: 'It was the best of times'}),
    ]);
    expect(await env.digestSync.getPendingDigestSyncCount()).toBe(0);
    await env.digestSync.syncPendingHighlightsToDigest();
    expect(env.fakes.insertDigestEntry).not.toHaveBeenCalled();
  });

  test('lands in a pre-existing book from another source (Kindle): matched by text alone', async () => {
    const env = await setup();
    env.fakes.documentEntries = [documentEntry({content: 'Call me Ishmael.'})];
    await env.digestExport.exportPendingDigestEntries();
    await env.db.upsertHighlights([
      highlight({readwise_id: 2, source: 'kindle', book_title: 'Moby-Dick', text: 'Call me Ishmael.'}),
    ]);
    expect(await env.digestSync.getPendingDigestSyncCount()).toBe(0);
  });

  test('whitespace and line wrapping differences do not defeat the match', async () => {
    const env = await setup();
    env.fakes.documentEntries = [documentEntry({content: ' one two\nthree   four '})];
    await env.digestExport.exportPendingDigestEntries();
    await env.db.upsertHighlights([highlight({readwise_id: 3, source: 'kindle', text: 'one two three four'})]);
    expect(await env.digestSync.getPendingDigestSyncCount()).toBe(0);
  });

  test('different text (even a substring) is still a genuine Readwise highlight', async () => {
    const env = await setup();
    env.fakes.documentEntries = [documentEntry({content: 'the quick brown fox'})];
    await env.digestExport.exportPendingDigestEntries();
    await env.db.upsertHighlights([
      highlight({readwise_id: 4, source: 'kindle', text: 'the quick brown fox jumps'}),
      highlight({readwise_id: 5, source: 'kindle', text: 'quick brown'}),
    ]);
    expect(await env.digestSync.getPendingDigestSyncCount()).toBe(2);
  });

  test('anything Readwise attributes to our source_type is ours, whatever the title', async () => {
    const env = await setup();
    await env.db.upsertHighlights([
      highlight({readwise_id: 6, source: env.constants.SUPERNOTE_EXPORT_SOURCE_TYPE, book_title: 'Any Book At All'}),
      highlight({readwise_id: 7, source: 'kindle', book_title: 'Any Book At All'}),
    ]);
    const pending = await env.db.getUnsyncedToDigestHighlights();
    expect(pending.map((h: any) => h.readwise_id)).toEqual([7]);
  });

  test('app restart repairs rows cached before the export happened', async () => {
    const first = await setup();
    await first.db.upsertHighlights([highlight({readwise_id: 8, source: 'kindle', text: 'already cached copy'})]);
    first.fakes.documentEntries = [documentEntry({content: 'already cached copy'})];
    await first.digestExport.exportPendingDigestEntries();
    expect(await first.digestSync.getPendingDigestSyncCount()).toBe(1); // not yet noticed

    const second = await loadEnv({keepDatabase: true});
    expect(await second.digestSync.getPendingDigestSyncCount()).toBe(0);
  });

  test('a highlight that was already synced into Digest keeps its original timestamp', async () => {
    const env = await setup();
    await env.db.upsertHighlights([highlight({readwise_id: 9, source: 'kindle', text: 'same text'})]);
    await env.db.markHighlightSyncedToDigest(9, '2030-01-01T00:00:00Z');
    env.fakes.documentEntries = [documentEntry({content: 'same text'})];
    await env.digestExport.exportPendingDigestEntries();
    await env.db.upsertHighlights([highlight({readwise_id: 10, text: 'unrelated'})]);
    const {rows} = await env.db.runSQL('SELECT synced_to_digest_at FROM highlights WHERE readwise_id = 9');
    expect(rows[0].synced_to_digest_at).toBe('2030-01-01T00:00:00Z');
  });

  test('an upsert only text-checks its own batch; older pending rows wait for the next app start', async () => {
    // Keeps a first full sync of thousands of highlights cheap (no re-scan per page). The
    // trade-off is deliberate and visible here.
    const env = await setup();
    await env.db.upsertHighlights([highlight({readwise_id: 1, source: 'kindle', text: 'older cached copy'})]);
    env.fakes.documentEntries = [documentEntry({content: 'older cached copy'})];
    await env.digestExport.exportPendingDigestEntries();

    await env.db.upsertHighlights([highlight({readwise_id: 2, text: 'unrelated'})]);
    const pending = (await env.db.getUnsyncedToDigestHighlights()).map((h: any) => h.readwise_id).sort();
    expect(pending).toEqual([1, 2]); // row 1 not re-checked by this batch

    // ...but a batch that itself contains a matching text is caught immediately.
    await env.db.upsertHighlights([highlight({readwise_id: 3, source: 'kindle', text: 'older cached copy'})]);
    const after = (await env.db.getUnsyncedToDigestHighlights()).map((h: any) => h.readwise_id).sort();
    expect(after).toEqual([1, 2]);
  });

  test('full round trip: book highlight out, echoed back, Digest stays put', async () => {
    const env = await setup();
    env.fakes.digestEntries = [digestEntry({id: 1, content: 'typed by me'})];
    env.fakes.documentEntries = [documentEntry({id: 2, content: 'from the book'})];
    await env.digestExport.exportPendingDigestEntries();

    const sent = sentHighlights(env);
    env.fakes.fetchExportPage.mockResolvedValue({
      count: 2, nextPageCursor: null,
      results: sent.map((h: any, i: number) => ({
        user_book_id: 700 + i, is_deleted: false, title: h.title, author: h.author ?? null,
        source: h.source_type, category: 'books', readwise_url: 'https://readwise.io/x', source_url: null,
        highlights: [{
          id: 8000 + i, is_deleted: false, text: h.text, location: h.location ?? null, location_type: null,
          note: null, color: null, highlighted_at: null, created_at: null, updated_at: null, url: null,
        }],
      })),
    });
    await env.sync.syncHighlights('t');
    expect(await env.db.getHighlightCount()).toBe(2);
    await env.digestSync.syncPendingHighlightsToDigest();
    expect(env.fakes.insertDigestEntry).not.toHaveBeenCalled();
    expect(await env.digestExport.getPendingDigestExportCount()).toBe(0);
  });

  test('clearAllData forgets exported texts', async () => {
    const env = await setup();
    env.fakes.documentEntries = [documentEntry({content: 'forget me'})];
    await env.digestExport.exportPendingDigestEntries();
    await env.db.clearAllData();
    await env.db.upsertHighlights([highlight({readwise_id: 1, source: 'kindle', text: 'forget me'})]);
    expect(await env.digestSync.getPendingDigestSyncCount()).toBe(1);
  });

  test('markTextExported ignores blank text', async () => {
    const env = await setup();
    await env.db.markTextExported('   \n ');
    const {rows} = await env.db.runSQL('SELECT COUNT(*) AS n FROM exported_text_keys');
    expect(rows[0].n).toBe(0);
  });
});
