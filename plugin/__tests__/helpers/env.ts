/**
 * Loads the plugin modules against a fresh module registry and a fresh in-memory database, with
 * the native-facing collaborators (Digest ContentProvider, Readwise HTTP client, permission
 * prompts) replaced by controllable fakes. Everything else -- db/, digestSync, digestExport,
 * readwise/sync -- is the real code.
 */
import type {DigestEntry, ManualDigestEntry} from '../../src/lib/knowledgeProvider';
import type {LocalHighlightRow} from '../../src/readwise/types';

export interface Fakes {
  /** What the Digest app currently contains (source_type=4 entries). */
  digestEntries: ManualDigestEntry[];
  /** What the Digest app holds in its Documents bucket (source_type=1). */
  documentEntries: DigestEntry[];
  /** Native DocumentMetadata.readMetadata: default answers "file does not exist". */
  readDocumentMetadata: jest.Mock;
  ensureFileReadPermission: jest.Mock;
  /** Category name -> unique_attribute that findDigestCategory can see. */
  categories: Record<string, string>;
  createHighlights: jest.Mock;
  insertDigestEntry: jest.Mock;
  getOrCreateDigestCategory: jest.Mock;
  findDigestCategory: jest.Mock;
  fetchExportPage: jest.Mock;
  /** Only in realClient mode: the global fetch that the real Readwise client ends up calling. */
  fetch: jest.Mock;
}

export interface LoadEnvOptions {
  /** Reuse the in-memory database of the previous loadEnv (simulates an app restart). */
  keepDatabase?: boolean;
  /**
   * Read-only mode. Default `true` = writes ENABLED (read-only off), so the suites written before
   * read-only mode existed keep meaning what they meant. `false` = the real default: the setting is
   * absent and everything is read-only. Ignored with keepDatabase, which keeps what is stored.
   */
  writesEnabled?: boolean;
  /** Use the real readwise/client (and so the real write guard) on top of a fake global fetch,
   * instead of the fakes. */
  realClient?: boolean;
}

export async function loadEnv(options: LoadEnvOptions = {}) {
  jest.resetModules();
  if (!options.keepDatabase) {
    (globalThis as any).__sqliteTestDbs?.clear();
  }

  const fakes: Fakes = {
    digestEntries: [],
    documentEntries: [],
    readDocumentMetadata: jest.fn(async () => ({exists: false})),
    ensureFileReadPermission: jest.fn(async () => true),
    categories: {},
    createHighlights: jest.fn(async () => []),
    insertDigestEntry: jest.fn(async () => undefined),
    getOrCreateDigestCategory: jest.fn(async (name: string) => {
      fakes.categories[name] = fakes.categories[name] ?? `attr-${name}`;
      return fakes.categories[name];
    }),
    findDigestCategory: jest.fn(async (name: string) => fakes.categories[name] ?? null),
    fetchExportPage: jest.fn(),
    fetch: jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: {get: () => null},
      json: async () => [],
      text: async () => '',
    })),
  };

  jest.doMock('../../src/lib/knowledgeProvider', () => ({
    DigestSourceType: {Document: 1, Note: 2, ManualEntry: 4},
    listManualDigestEntries: jest.fn(async () => fakes.digestEntries),
    listDigestEntriesBySourceType: jest.fn(async (type: number) =>
      type === 1 ? fakes.documentEntries : [],
    ),
    findDigestCategory: fakes.findDigestCategory,
    getOrCreateDigestCategory: fakes.getOrCreateDigestCategory,
    insertDigestEntry: fakes.insertDigestEntry,
  }));
  jest.doMock('../../src/lib/permissions', () => ({
    ensureInternetPermission: jest.fn(async () => true),
    ensureFileWritePermission: jest.fn(async () => true),
    ensureFileReadPermission: (...args: unknown[]) => fakes.ensureFileReadPermission(...args),
  }));
  jest.doMock('../../src/lib/documentInfo/nativeBridge', () => ({
    readDocumentMetadata: (...args: unknown[]) => fakes.readDocumentMetadata(...args),
  }));
  if (options.realClient) {
    (globalThis as any).fetch = fakes.fetch;
  } else {
    jest.doMock('../../src/readwise/client', () => {
      class ReadwiseRateLimitError extends Error {
        retryAfterSeconds = 0;
      }
      return {
        createHighlights: fakes.createHighlights,
        fetchExportPage: fakes.fetchExportPage,
        ReadwiseRateLimitError,
      };
    });
  }

  const db = require('../../src/db');
  const digestExport = require('../../src/lib/digestExport');
  const digestSync = require('../../src/lib/digestSync');
  const sync = require('../../src/readwise/sync');
  const schema = require('../../src/db/schema');
  const constants = require('../../src/readwise/constants');
  const types = require('../../src/readwise/types');
  const writeGuard = require('../../src/readwise/writeGuard');
  const client = require('../../src/readwise/client');
  const documentResolve = require('../../src/lib/documentInfo/resolve');

  await db.initDatabase();
  await db.setSetting(schema.SettingsKey.ReadwiseApiToken, 'test-token');
  if (!options.keepDatabase) {
    await writeGuard.setReadwiseWritesEnabled(options.writesEnabled ?? true);
  }

  return {
    fakes,
    db,
    digestExport,
    digestSync,
    sync,
    schema,
    constants,
    types,
    writeGuard,
    client,
    documentResolve,
    resolveDocumentInfo: documentResolve.resolveDocumentInfo,
  };
}

let nextId = 1000;

export function highlight(overrides: Partial<LocalHighlightRow> = {}): LocalHighlightRow {
  const id = overrides.readwise_id ?? nextId++;
  return {
    readwise_id: id,
    user_book_id: 1,
    book_title: 'Some Book',
    book_author: 'Some Author',
    category: 'books',
    source: 'kindle',
    text: `highlight ${id}`,
    note: null,
    location: null,
    location_type: null,
    color: null,
    highlighted_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    highlight_url: null,
    source_url: null,
    is_deleted: false,
    fetched_at: '2026-01-02T00:00:00Z',
    ...overrides,
  };
}

let nextEntryId = 1;

export function digestEntry(overrides: Partial<ManualDigestEntry> = {}): ManualDigestEntry {
  return {
    id: nextEntryId++,
    content: 'a quote from the digest',
    categoryUniqueAttribute: null,
    metadata: null,
    creationTime: Date.UTC(2026, 0, 1),
    ...overrides,
  };
}

let nextDocEntryId = 5000;

/** A Digest "Documents" entry (a highlight made while reading a PDF/EPUB). */
export function documentEntry(overrides: Partial<DigestEntry> = {}): DigestEntry {
  return {
    id: nextDocEntryId++,
    content: 'a highlighted passage',
    categoryUniqueAttribute: null,
    metadata: null,
    creationTime: Date.UTC(2026, 0, 1),
    sourceType: 1,
    sourcePath: 'Document/Some Book - Filename Author.pdf',
    sourcePage: '12',
    comment: null,
    ...overrides,
  };
}
