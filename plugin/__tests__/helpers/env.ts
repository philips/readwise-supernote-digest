/**
 * Loads the plugin modules against a fresh module registry and a fresh in-memory database, with
 * the native-facing collaborators (Digest ContentProvider, Readwise HTTP client, permission
 * prompts) replaced by controllable fakes. Everything else -- db/, digestSync, digestExport,
 * readwise/sync -- is the real code.
 */
import type {ManualDigestEntry} from '../../src/lib/knowledgeProvider';
import type {LocalHighlightRow} from '../../src/readwise/types';

export interface Fakes {
  /** What the Digest app currently contains (source_type=4 entries). */
  digestEntries: ManualDigestEntry[];
  /** Category name -> unique_attribute that findDigestCategory can see. */
  categories: Record<string, string>;
  createHighlights: jest.Mock;
  insertDigestEntry: jest.Mock;
  getOrCreateDigestCategory: jest.Mock;
  findDigestCategory: jest.Mock;
  fetchExportPage: jest.Mock;
}

export async function loadEnv(options: {keepDatabase?: boolean} = {}) {
  jest.resetModules();
  if (!options.keepDatabase) {
    (globalThis as any).__sqliteTestDbs?.clear();
  }

  const fakes: Fakes = {
    digestEntries: [],
    categories: {},
    createHighlights: jest.fn(async () => []),
    insertDigestEntry: jest.fn(async () => undefined),
    getOrCreateDigestCategory: jest.fn(async (name: string) => {
      fakes.categories[name] = fakes.categories[name] ?? `attr-${name}`;
      return fakes.categories[name];
    }),
    findDigestCategory: jest.fn(async (name: string) => fakes.categories[name] ?? null),
    fetchExportPage: jest.fn(),
  };

  jest.doMock('../../src/lib/knowledgeProvider', () => ({
    listManualDigestEntries: jest.fn(async () => fakes.digestEntries),
    findDigestCategory: fakes.findDigestCategory,
    getOrCreateDigestCategory: fakes.getOrCreateDigestCategory,
    insertDigestEntry: fakes.insertDigestEntry,
  }));
  jest.doMock('../../src/lib/permissions', () => ({
    ensureInternetPermission: jest.fn(async () => true),
    ensureFileWritePermission: jest.fn(async () => true),
  }));
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

  const db = require('../../src/db');
  const digestExport = require('../../src/lib/digestExport');
  const digestSync = require('../../src/lib/digestSync');
  const sync = require('../../src/readwise/sync');
  const schema = require('../../src/db/schema');
  const constants = require('../../src/readwise/constants');
  const types = require('../../src/readwise/types');

  await db.initDatabase();
  await db.setSetting(schema.SettingsKey.ReadwiseApiToken, 'test-token');

  return {fakes, db, digestExport, digestSync, sync, schema, constants, types};
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
