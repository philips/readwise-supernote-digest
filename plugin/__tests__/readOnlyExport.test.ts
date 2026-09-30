import {loadEnv, digestEntry, documentEntry, highlight} from './helpers/env';

const okResponse = (body: unknown = []) => ({
  ok: true, status: 200, headers: {get: () => null}, json: async () => body, text: async () => '',
});

async function setup(writesEnabled: boolean) {
  const env = await loadEnv({realClient: true, writesEnabled});
  env.fakes.categories.Readwise = 'attr-Readwise';
  await env.db.setSetting(env.schema.SettingsKey.DigestCategoryUniqueAttribute, 'attr-Readwise');
  env.fakes.readDocumentMetadata.mockResolvedValue({
    exists: true, size: 1, mtime: 1, format: 'pdf', title: 'Embedded Title', authors: ['Embedded Author'],
  });
  return env;
}

function withPending(env: any, manual = 2, docs = 2) {
  env.fakes.digestEntries = Array.from({length: manual}, (_, i) => digestEntry({id: i + 1, content: `manual ${i}`}));
  env.fakes.documentEntries = Array.from({length: docs}, (_, i) => documentEntry({id: 1000 + i, content: `book ${i}`}));
}

describe('read-only mode: exporting leaves no trace', () => {
  test('a read-only export throws the read-only error and sends nothing', async () => {
    const env = await setup(false);
    withPending(env);
    await expect(env.digestExport.exportPendingDigestEntries()).rejects.toBeInstanceOf(
      env.writeGuard.ReadwiseReadOnlyError,
    );
    expect(env.fakes.fetch).not.toHaveBeenCalled();
  });

  test('it is not wrapped as a generic export failure', async () => {
    const env = await setup(false);
    withPending(env);
    const err = await env.digestExport.exportPendingDigestEntries().catch((e: Error) => e);
    expect(err).not.toBeInstanceOf(env.digestExport.DigestExportError);
    expect(err.name).toBe('ReadwiseReadOnlyError');
  });

  test('no file reads, no permission prompts, no title lookups', async () => {
    const env = await setup(false);
    withPending(env);
    await env.digestExport.exportPendingDigestEntries().catch(() => undefined);
    expect(env.fakes.readDocumentMetadata).not.toHaveBeenCalled();
    expect(env.fakes.ensureFileReadPermission).not.toHaveBeenCalled();
  });

  test('nothing is recorded: not exported, no export text, no cached titles', async () => {
    const env = await setup(false);
    withPending(env);
    await env.digestExport.exportPendingDigestEntries().catch(() => undefined);
    expect((await env.db.getExportedDigestEntryKeys()).size).toBe(0);
    expect((await env.db.runSQL('SELECT COUNT(*) AS n FROM exported_text_keys')).rows[0].n).toBe(0);
    expect((await env.db.runSQL('SELECT COUNT(*) AS n FROM document_info')).rows[0].n).toBe(0);
    // ...so a highlight with the same text is still a genuine import, not treated as our own export.
    await env.db.upsertHighlights([highlight({readwise_id: 1, source: 'kindle', text: 'book 0'})]);
    expect(await env.digestSync.getPendingDigestSyncCount()).toBe(1);
  });

  test('counting what is pending still works, it only reads local data', async () => {
    const env = await setup(false);
    withPending(env, 2, 3);
    expect(await env.digestExport.getPendingDigestExportCount()).toBe(5);
    expect(env.fakes.fetch).not.toHaveBeenCalled();
  });

  test('read-only with nothing pending is still the read-only error, not a silent "0 exported"', async () => {
    const env = await setup(false);
    await expect(env.digestExport.exportPendingDigestEntries()).rejects.toThrow(/read-only/i);
  });

  test('turning read-only off afterwards exports exactly what was pending, once', async () => {
    const env = await setup(false);
    withPending(env, 2, 2);
    await env.digestExport.exportPendingDigestEntries().catch(() => undefined);

    await env.writeGuard.setReadwiseWritesEnabled(true);
    const result = await env.digestExport.exportPendingDigestEntries();
    expect(result).toMatchObject({exported: 4, documents: 2});
    expect(env.fakes.fetch).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(env.fakes.fetch.mock.calls[0][1].body).highlights;
    expect(sent.map((h: any) => h.text).sort()).toEqual(['book 0', 'book 1', 'manual 0', 'manual 1']);

    expect((await env.digestExport.exportPendingDigestEntries().catch(() => null))?.exported).toBe(0);
    expect(env.fakes.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('read-only mode: flipping it during an export', () => {
  test('turning it on between batches stops before the next one; turning it off resumes', async () => {
    const env = await setup(true);
    env.fakes.digestEntries = Array.from({length: 150}, (_, i) => digestEntry({id: i + 1}));
    let calls = 0;
    env.fakes.fetch.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {await env.writeGuard.setReadwiseWritesEnabled(false);} // user flips it mid-export
      return okResponse();
    });

    const err = await env.digestExport.exportPendingDigestEntries().catch((e: Error) => e);
    expect(err.name).toBe('ReadwiseReadOnlyError');
    expect(err).not.toBeInstanceOf(env.digestExport.DigestExportError);
    expect(env.fakes.fetch).toHaveBeenCalledTimes(1); // the second batch never left the device
    expect((await env.db.getExportedDigestEntryKeys()).size).toBe(100); // only the batch that was sent

    await env.writeGuard.setReadwiseWritesEnabled(true);
    const rest = await env.digestExport.exportPendingDigestEntries();
    expect(rest.exported).toBe(50);
    expect((await env.db.getExportedDigestEntryKeys()).size).toBe(150);
  });

  test('turned on before the very first batch: nothing is sent', async () => {
    const env = await setup(true);
    withPending(env, 3, 0);
    env.fakes.ensureFileReadPermission.mockImplementation(async () => true);
    await env.writeGuard.setReadwiseWritesEnabled(false);
    await expect(env.digestExport.exportPendingDigestEntries()).rejects.toThrow(/read-only/i);
    expect(env.fakes.fetch).not.toHaveBeenCalled();
  });
});

describe('read-only mode: everything that only reads keeps working', () => {
  test('import from Readwise (GET) works and fills the cache', async () => {
    const env = await setup(false);
    env.fakes.fetch.mockResolvedValue(okResponse({
      count: 1, nextPageCursor: null,
      results: [{
        user_book_id: 5, is_deleted: false, title: 'Book', author: 'Author', source: 'kindle', category: 'books',
        readwise_url: 'https://readwise.io/x', source_url: null,
        highlights: [{id: 77, is_deleted: false, text: 'imported', location: null, location_type: null,
          note: null, color: null, highlighted_at: null, created_at: null, updated_at: null, url: null}],
      }],
    }));
    const result = await env.sync.syncHighlights('tok');
    expect(result.highlightsFetched).toBe(1);
    expect(await env.db.getHighlightCount()).toBe(1);
    expect(env.fakes.fetch.mock.calls.every((c: any[]) => c[1].method === 'GET')).toBe(true);
  });

  test('syncing into Digest (a local write, not Readwise) is unaffected', async () => {
    const env = await setup(false);
    await env.db.upsertHighlights([highlight({readwise_id: 1, text: 'to digest'})]);
    const result = await env.digestSync.syncPendingHighlightsToDigest();
    expect(result.synced).toBe(1);
    expect(env.fakes.insertDigestEntry).toHaveBeenCalledTimes(1);
  });
});
