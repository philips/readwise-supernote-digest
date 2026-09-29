import {
  DigestSourceType,
  findDigestCategory,
  listDigestEntriesBySourceType,
  listManualDigestEntries,
  type DigestEntry,
  type ManualDigestEntry,
} from './knowledgeProvider';
import {resolveDocumentInfo, type DocumentInfo} from './documentInfo/resolve';
import {parseFilename} from './documentInfo/filename';
import {createHighlights} from '../readwise/client';
import {
  getSetting,
  getExportedDigestEntryKeys,
  markDigestEntryExported,
  markTextExported,
  getReadwiseApiToken,
} from '../db';
import {SettingsKey, DEFAULT_DIGEST_CATEGORY} from '../db/schema';
import {ensureFileReadPermission, ensureInternetPermission} from './permissions';
import type {ReadwiseCreateHighlightInput} from '../readwise/types';
import {SUPERNOTE_EXPORT_SOURCE_TYPE, SUPERNOTE_EXPORT_TITLE} from '../readwise/constants';

/**
 * Task 4: export Digest entries back to Readwise, skipping the ones Task 3 put there in the
 * first place (avoiding a sync loop). See docs/KNOWLEDGE_PROVIDER.md for the ContentProvider
 * schema this reads from, and plans/plan.md "Task 4" for the design notes.
 *
 * Source data:
 *  - every "Manual Entry" (source_type=4) row -- both entries Task 3 created (tagged with the
 *    Readwise category) and any the user typed by hand via the native "+" button. We export the
 *    latter and skip the former.
 *  - every "Documents" (source_type=1) row: highlights made while reading a PDF/EPUB. These are
 *    exported under the book's real title and author, read out of the file (see
 *    src/lib/documentInfo), or from the filename when that isn't possible.
 * ("Notes", source_type=2, is not exported yet -- see plans/plan.md.)
 */

export class DigestExportError extends Error {}

export interface DigestExportProgress {
  exported: number;
  total: number;
}

function parseAuthorFromMetadata(metadata: string | null): string | undefined {
  if (!metadata) {return undefined;}
  try {
    const parsed = JSON.parse(metadata) as {author?: string};
    return parsed.author || undefined;
  } catch {
    return undefined;
  }
}

// Readwise's create endpoint returns a 400 ("Title is required when source_type is specified")
// if source_type is set without a title -- not obvious from the API docs' field table, only from
// hitting it live. Group every export under one consistent "book" title rather than leaving it
// unset (which would have silently landed in Readwise's generic "Quotes" book instead).
function toCreateHighlightInput(entry: ManualDigestEntry): ReadwiseCreateHighlightInput | null {
  const text = (entry.content ?? '').trim();
  if (!text) {return null;}
  return {
    text,
    title: SUPERNOTE_EXPORT_TITLE,
    author: parseAuthorFromMetadata(entry.metadata),
    source_type: SUPERNOTE_EXPORT_SOURCE_TYPE,
    highlighted_at: entry.creationTime
      ? new Date(entry.creationTime).toISOString()
      : undefined,
  };
}

type PendingEntry =
  | {kind: 'manual'; entry: ManualDigestEntry}
  | {kind: 'document'; entry: DigestEntry};

/** Digest stores a page as a string ("26"); Readwise wants a positive integer location. */
function parsePage(page: string | null | undefined): number | undefined {
  if (!page || !/^\d+$/.test(page.trim())) {return undefined;}
  const n = Number(page.trim());
  return n > 0 ? n : undefined;
}

function toDocumentHighlightInput(
  entry: DigestEntry,
  info: DocumentInfo,
): ReadwiseCreateHighlightInput | null {
  const text = (entry.content ?? '').trim();
  if (!text) {return null;}
  const page = parsePage(entry.sourcePage);
  const note = (entry.comment ?? '').trim();
  return {
    text,
    title: info.title,
    author: info.author ?? undefined,
    category: 'books',
    source_type: SUPERNOTE_EXPORT_SOURCE_TYPE,
    location: page,
    location_type: page === undefined ? undefined : 'page',
    note: note || undefined,
    highlighted_at: entry.creationTime
      ? new Date(entry.creationTime).toISOString()
      : undefined,
  };
}

/** Title/author for a document entry. Never throws: if the metadata machinery fails for any
 * reason the filename still gives Readwise something sensible to file the highlight under. */
async function resolveInfoSafely(sourcePath: string | null): Promise<DocumentInfo> {
  if (sourcePath) {
    try {
      return await resolveDocumentInfo(sourcePath);
    } catch {
      // fall through to the filename
    }
  }
  const name = parseFilename(sourcePath ?? '');
  return {
    title: name.title ?? (name.stem || 'Untitled document'),
    author: name.author,
    titleSource: 'filename',
    authorSource: name.author ? 'filename' : null,
    format: null,
  };
}

/**
 * unique_attribute of the Digest category our own imports are filed under. Normally cached by
 * digestSync, but if the cache is empty (plugin data reset, or Export used before any Digest
 * sync) the Readwise-tagged entries are still sitting in Digest, and skipping this lookup would
 * make the export send every one of them back to Readwise. Look the category up by name instead
 * (read-only -- never creates it).
 */
async function getReadwiseCategoryAttribute(): Promise<string | null> {
  const cached = await getSetting(SettingsKey.DigestCategoryUniqueAttribute);
  if (cached) {return cached;}
  const name = (await getSetting(SettingsKey.DigestCategory)) || DEFAULT_DIGEST_CATEGORY;
  return findDigestCategory(name);
}

/** Digest entries not yet exported and not tagged with our own Readwise category -- i.e. what a
 * real export run would send. Also used to show a pending count in the UI. */
async function getPendingExportEntries(): Promise<PendingEntry[]> {
  const [manual, documents, exportedKeys, readwiseCategoryAttr] = await Promise.all([
    listManualDigestEntries(),
    listDigestEntriesBySourceType(DigestSourceType.Document),
    getExportedDigestEntryKeys(),
    getReadwiseCategoryAttribute(),
  ]);

  const wanted = (entry: ManualDigestEntry): boolean => {
    if (exportedKeys.has(String(entry.id))) {return false;}
    if (readwiseCategoryAttr && entry.categoryUniqueAttribute === readwiseCategoryAttr) {
      return false; // this is one of ours from Task 3 -- exporting it would loop back to Readwise
    }
    if (!entry.content || !entry.content.trim()) {return false;}
    return true;
  };

  return [
    ...manual.filter(wanted).map((entry): PendingEntry => ({kind: 'manual', entry})),
    ...documents.filter(wanted).map((entry): PendingEntry => ({kind: 'document', entry})),
  ];
}

export async function getPendingDigestExportCount(): Promise<number> {
  return (await getPendingExportEntries()).length;
}

const EXPORT_BATCH_SIZE = 100; // Readwise's create endpoint takes an array in one request

export interface DigestExportResult {
  exported: number;
  /** How many of those were book highlights (Documents bucket). */
  documents: number;
  /** Book highlights filed under a filename-derived title because the file's own metadata was
   * missing or unreadable (e.g. the Supernote cloud-sync folder, or file access declined). */
  usedFilename: number;
}

/**
 * Exports every pending Digest entry to Readwise. Readwise's create endpoint accepts a whole
 * batch of highlights in a single request (unlike the export/import direction, which is
 * paginated per-request) -- so this sends in batches of EXPORT_BATCH_SIZE rather than one at a
 * time. Each entry in a successfully-sent batch is marked exported (`exported_digest_entries`);
 * a batch failure stops the run but leaves already-sent batches marked, so re-running resumes
 * from where it left off.
 *
 * Book highlights need file access to read the title/author out of the PDF/EPUB. If the user
 * declines, they are still exported, under the filename-derived title (a deliberate choice: the
 * alternative is silently never exporting them).
 */
export async function exportPendingDigestEntries(
  onProgress?: (progress: DigestExportProgress) => void,
): Promise<DigestExportResult> {
  const token = await getReadwiseApiToken();
  if (!token) {
    throw new DigestExportError('No Readwise token saved -- please reconnect.');
  }

  const pending = await getPendingExportEntries();
  const total = pending.length;
  const result: DigestExportResult = {exported: 0, documents: 0, usedFilename: 0};
  if (total === 0) {return result;}

  const granted = await ensureInternetPermission();
  if (!granted) {
    throw new DigestExportError('Network access is required to export to Readwise.');
  }

  // Once per run, not per entry: many highlights share one book.
  const infoByPath = new Map<string, DocumentInfo>();
  if (pending.some(p => p.kind === 'document')) {
    await ensureFileReadPermission().catch(() => false); // denied => filename fallback below
    for (const p of pending) {
      if (p.kind !== 'document') {continue;}
      const path = p.entry.sourcePath ?? '';
      if (!infoByPath.has(path)) {
        infoByPath.set(path, await resolveInfoSafely(p.entry.sourcePath));
      }
    }
  }

  for (let i = 0; i < pending.length; i += EXPORT_BATCH_SIZE) {
    const batch = pending.slice(i, i + EXPORT_BATCH_SIZE);
    const inputs: ReadwiseCreateHighlightInput[] = [];
    let batchDocuments = 0;
    let batchFilename = 0;
    for (const p of batch) {
      let input: ReadwiseCreateHighlightInput | null;
      if (p.kind === 'document') {
        const info = infoByPath.get(p.entry.sourcePath ?? '')!;
        input = toDocumentHighlightInput(p.entry, info);
        if (input) {
          batchDocuments += 1;
          if (info.titleSource === 'filename') {batchFilename += 1;}
        }
      } else {
        input = toCreateHighlightInput(p.entry);
      }
      if (input) {inputs.push(input);}
    }
    if (inputs.length === 0) {continue;}

    try {
      await createHighlights(token, inputs);
    } catch (err) {
      throw new DigestExportError(
        err instanceof Error ? `Could not export to Readwise: ${err.message}` : String(err),
      );
    }

    const exportedAt = new Date().toISOString();
    for (const p of batch) {
      // One table, so row ids are unique across buckets.
      await markDigestEntryExported(String(p.entry.id), exportedAt);
      if (p.entry.content) {await markTextExported(p.entry.content);}
      result.exported += 1;
    }
    result.documents += batchDocuments;
    result.usedFilename += batchFilename;
    onProgress?.({exported: result.exported, total});
  }

  return result;
}
