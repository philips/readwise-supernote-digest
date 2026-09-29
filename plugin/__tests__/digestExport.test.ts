import {loadEnv, digestEntry} from './helpers/env';

const READWISE_ATTR = 'attr-Readwise';

async function setup(cacheCategory: boolean) {
  const env = await loadEnv();
  env.fakes.categories.Readwise = READWISE_ATTR;
  if (cacheCategory) {
    await env.db.setSetting(env.schema.SettingsKey.DigestCategoryUniqueAttribute, READWISE_ATTR);
  }
  return env;
}

describe('export: loop prevention', () => {
  test('never exports entries filed under the Readwise category (cached id)', async () => {
    const {fakes, digestExport} = await setup(true);
    fakes.digestEntries = [
      digestEntry({id: 1, content: 'imported from Readwise', categoryUniqueAttribute: READWISE_ATTR}),
      digestEntry({id: 2, content: 'typed by hand'}),
    ];
    const result = await digestExport.exportPendingDigestEntries();
    expect(result.exported).toBe(1);
    const sent = fakes.createHighlights.mock.calls[0][1];
    expect(sent.map((h: any) => h.text)).toEqual(['typed by hand']);
  });

  test('empty category cache: falls back to a by-name lookup (does not export all Readwise entries)', async () => {
    const {fakes, digestExport} = await setup(false);
    fakes.digestEntries = Array.from({length: 250}, (_, i) =>
      digestEntry({id: i + 1, content: `imported ${i}`, categoryUniqueAttribute: READWISE_ATTR}),
    );
    fakes.digestEntries.push(digestEntry({id: 999, content: 'mine'}));
    expect(await digestExport.getPendingDigestExportCount()).toBe(1);
    await digestExport.exportPendingDigestEntries();
    expect(fakes.createHighlights).toHaveBeenCalledTimes(1);
    expect(fakes.createHighlights.mock.calls[0][1]).toHaveLength(1);
    expect(fakes.findDigestCategory).toHaveBeenCalledWith('Readwise');
    expect(fakes.getOrCreateDigestCategory).not.toHaveBeenCalled(); // lookup must be read-only
  });

  test('uses the configured category name for the fallback lookup', async () => {
    const {fakes, db, schema, digestExport} = await setup(false);
    await db.setSetting(schema.SettingsKey.DigestCategory, 'Highlights');
    fakes.categories.Highlights = 'attr-Highlights';
    fakes.digestEntries = [
      digestEntry({id: 1, content: 'a', categoryUniqueAttribute: 'attr-Highlights'}),
      digestEntry({id: 2, content: 'b'}),
    ];
    expect(await digestExport.getPendingDigestExportCount()).toBe(1);
    expect(fakes.findDigestCategory).toHaveBeenCalledWith('Highlights');
  });

  test('category does not exist anywhere: nothing to filter, everything is the user\'s', async () => {
    const {fakes, digestExport} = await loadEnv(); // no categories at all
    fakes.digestEntries = [digestEntry({id: 1}), digestEntry({id: 2})];
    expect(await digestExport.getPendingDigestExportCount()).toBe(2);
  });

  test('entries in some other category are still exported', async () => {
    const {fakes, digestExport} = await setup(true);
    fakes.digestEntries = [digestEntry({id: 1, categoryUniqueAttribute: 'attr-Other'})];
    expect(await digestExport.getPendingDigestExportCount()).toBe(1);
  });

  test('stale cached category id (category recreated) is the only one filtered', async () => {
    // Documented limitation: if the user deletes and recreates "Readwise" in the Digest app the
    // cached id no longer matches and old entries would look like the user's. Pin the behaviour.
    const {fakes, db, schema, digestExport} = await loadEnv();
    await db.setSetting(schema.SettingsKey.DigestCategoryUniqueAttribute, 'stale-attr');
    fakes.digestEntries = [digestEntry({id: 1, categoryUniqueAttribute: 'new-attr'})];
    expect(await digestExport.getPendingDigestExportCount()).toBe(1);
  });
});

describe('export: selection edge cases', () => {
  test('skips entries already exported (id match is string-normalised)', async () => {
    const {fakes, db, digestExport} = await setup(true);
    await db.markDigestEntryExported('5', '2026-01-01T00:00:00Z');
    fakes.digestEntries = [digestEntry({id: 5}), digestEntry({id: 6})];
    expect(await digestExport.getPendingDigestExportCount()).toBe(1);
  });

  test.each([null, '', '   ', '\n\t'])('skips blank content %j', async content => {
    const {fakes, digestExport} = await setup(true);
    fakes.digestEntries = [digestEntry({id: 1, content})];
    expect(await digestExport.getPendingDigestExportCount()).toBe(0);
    expect((await digestExport.exportPendingDigestEntries()).exported).toBe(0);
    expect(fakes.createHighlights).not.toHaveBeenCalled();
  });

  test('second run exports nothing (idempotent)', async () => {
    const {fakes, digestExport} = await setup(true);
    fakes.digestEntries = [digestEntry({id: 1}), digestEntry({id: 2})];
    expect((await digestExport.exportPendingDigestEntries()).exported).toBe(2);
    expect((await digestExport.exportPendingDigestEntries()).exported).toBe(0);
    expect(fakes.createHighlights).toHaveBeenCalledTimes(1);
  });

  test('entry added after a run is picked up by the next run only', async () => {
    const {fakes, digestExport} = await setup(true);
    fakes.digestEntries = [digestEntry({id: 1})];
    await digestExport.exportPendingDigestEntries();
    fakes.digestEntries.push(digestEntry({id: 2, content: 'new one'}));
    expect((await digestExport.exportPendingDigestEntries()).exported).toBe(1);
    expect(fakes.createHighlights.mock.calls[1][1][0].text).toBe('new one');
  });
});

describe('export: payload', () => {
  test('uses the shared title/source_type and trims text', async () => {
    const {fakes, digestExport, constants} = await setup(true);
    fakes.digestEntries = [digestEntry({id: 1, content: '  padded quote \n'})];
    await digestExport.exportPendingDigestEntries();
    const [h] = fakes.createHighlights.mock.calls[0][1];
    expect(h.text).toBe('padded quote');
    expect(h.title).toBe(constants.SUPERNOTE_EXPORT_TITLE);
    expect(h.source_type).toBe(constants.SUPERNOTE_EXPORT_SOURCE_TYPE);
  });

  test('never sends source_type without a title (Readwise 400s)', async () => {
    const {fakes, digestExport} = await setup(true);
    fakes.digestEntries = [digestEntry({id: 1})];
    await digestExport.exportPendingDigestEntries();
    for (const h of fakes.createHighlights.mock.calls[0][1]) {
      if (h.source_type) {expect(h.title).toBeTruthy();}
    }
  });

  test.each([
    ['author present', '{"author":"Ada"}', 'Ada'],
    ['author empty string', '{"author":""}', undefined],
    ['no author key', '{"other":1}', undefined],
    ['malformed JSON', '{not json', undefined],
    ['null metadata', null, undefined],
  ])('author from metadata: %s', async (_name, metadata, expected) => {
    const {fakes, digestExport} = await setup(true);
    fakes.digestEntries = [digestEntry({id: 1, metadata})];
    await digestExport.exportPendingDigestEntries();
    expect(fakes.createHighlights.mock.calls[0][1][0].author).toBe(expected);
  });

  test('highlighted_at is ISO from creationTime; omitted when 0', async () => {
    const {fakes, digestExport} = await setup(true);
    fakes.digestEntries = [
      digestEntry({id: 1, creationTime: Date.UTC(2026, 4, 6, 7, 8, 9)}),
      digestEntry({id: 2, creationTime: 0}),
    ];
    await digestExport.exportPendingDigestEntries();
    const [a, b] = fakes.createHighlights.mock.calls[0][1];
    expect(a.highlighted_at).toBe('2026-05-06T07:08:09.000Z');
    expect(b.highlighted_at).toBeUndefined();
  });
});

describe('export: batching and failures', () => {
  test('sends in batches of 100 and reports progress', async () => {
    const {fakes, digestExport} = await setup(true);
    fakes.digestEntries = Array.from({length: 230}, (_, i) => digestEntry({id: i + 1}));
    const progress: Array<{exported: number; total: number}> = [];
    const result = await digestExport.exportPendingDigestEntries((p: any) => progress.push(p));
    expect(result.exported).toBe(230);
    expect(fakes.createHighlights.mock.calls.map(c => c[1].length)).toEqual([100, 100, 30]);
    expect(progress[progress.length - 1]).toEqual({exported: 230, total: 230});
  });

  test('a failing batch keeps earlier batches marked and a rerun resumes', async () => {
    const {fakes, db, digestExport} = await setup(true);
    fakes.digestEntries = Array.from({length: 150}, (_, i) => digestEntry({id: i + 1}));
    fakes.createHighlights
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('boom'));
    await expect(digestExport.exportPendingDigestEntries()).rejects.toThrow(/boom/);
    expect((await db.getExportedDigestEntryKeys()).size).toBe(100);

    const rerun = await digestExport.exportPendingDigestEntries();
    expect(rerun.exported).toBe(50);
    expect((await db.getExportedDigestEntryKeys()).size).toBe(150);
  });

  test('failed batch marks nothing from that batch', async () => {
    const {fakes, db, digestExport} = await setup(true);
    fakes.digestEntries = [digestEntry({id: 1})];
    fakes.createHighlights.mockRejectedValueOnce(new Error('offline'));
    await expect(digestExport.exportPendingDigestEntries()).rejects.toBeInstanceOf(
      digestExport.DigestExportError,
    );
    expect((await db.getExportedDigestEntryKeys()).size).toBe(0);
  });

  test('no token: refuses to run and does not touch the network', async () => {
    const {fakes, db, schema, digestExport} = await setup(true);
    await db.deleteSetting(schema.SettingsKey.ReadwiseApiToken);
    fakes.digestEntries = [digestEntry({id: 1})];
    await expect(digestExport.exportPendingDigestEntries()).rejects.toThrow(/token/i);
    expect(fakes.createHighlights).not.toHaveBeenCalled();
  });
});
