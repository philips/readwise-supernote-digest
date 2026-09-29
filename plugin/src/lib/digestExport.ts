import {
  findDigestCategory,
  listManualDigestEntries,
  type ManualDigestEntry,
} from './knowledgeProvider';
import {createHighlights} from '../readwise/client';
import {
  getSetting,
  getExportedDigestEntryKeys,
  markDigestEntryExported,
  getReadwiseApiToken,
} from '../db';
import {SettingsKey, DEFAULT_DIGEST_CATEGORY} from '../db/schema';
import {ensureInternetPermission} from './permissions';
import type {ReadwiseCreateHighlightInput} from '../readwise/types';
import {SUPERNOTE_EXPORT_SOURCE_TYPE, SUPERNOTE_EXPORT_TITLE} from '../readwise/constants';

/**
 * Task 4: export Digest entries back to Readwise, skipping the ones Task 3 put there in the
 * first place (avoiding a sync loop). See docs/KNOWLEDGE_PROVIDER.md for the ContentProvider
 * schema this reads from, and plans/plan.md "Task 4" for the design notes.
 *
 * Source data: every "Manual Entry" (source_type=4) row in the Digest app -- this includes both
 * entries Task 3 created (tagged with the cached Readwise category's unique_attribute) and any
 * the user typed by hand via the native "+" button (uncategorized, or in some other category).
 * We export the latter and skip the former.
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
async function getPendingExportEntries(): Promise<ManualDigestEntry[]> {
  const [allEntries, exportedKeys, readwiseCategoryAttr] = await Promise.all([
    listManualDigestEntries(),
    getExportedDigestEntryKeys(),
    getReadwiseCategoryAttribute(),
  ]);

  return allEntries.filter(entry => {
    if (exportedKeys.has(String(entry.id))) {return false;}
    if (readwiseCategoryAttr && entry.categoryUniqueAttribute === readwiseCategoryAttr) {
      return false; // this is one of ours from Task 3 -- exporting it would loop back to Readwise
    }
    if (!entry.content || !entry.content.trim()) {return false;}
    return true;
  });
}

export async function getPendingDigestExportCount(): Promise<number> {
  return (await getPendingExportEntries()).length;
}

const EXPORT_BATCH_SIZE = 100; // Readwise's create endpoint takes an array in one request

/**
 * Exports every pending Digest entry to Readwise. Readwise's create endpoint accepts a whole
 * batch of highlights in a single request (unlike the export/import direction, which is
 * paginated per-request) -- so this sends in batches of EXPORT_BATCH_SIZE rather than one at a
 * time. Each entry in a successfully-sent batch is marked exported (`exported_digest_entries`);
 * a batch failure stops the run but leaves already-sent batches marked, so re-running resumes
 * from where it left off.
 */
export async function exportPendingDigestEntries(
  onProgress?: (progress: DigestExportProgress) => void,
): Promise<{exported: number}> {
  const token = await getReadwiseApiToken();
  if (!token) {
    throw new DigestExportError('No Readwise token saved -- please reconnect.');
  }

  const pending = await getPendingExportEntries();
  const total = pending.length;
  if (total === 0) {return {exported: 0};}

  const granted = await ensureInternetPermission();
  if (!granted) {
    throw new DigestExportError('Network access is required to export to Readwise.');
  }

  let exported = 0;
  for (let i = 0; i < pending.length; i += EXPORT_BATCH_SIZE) {
    const batch = pending.slice(i, i + EXPORT_BATCH_SIZE);
    const inputs = batch
      .map(toCreateHighlightInput)
      .filter((x): x is ReadwiseCreateHighlightInput => x !== null);
    if (inputs.length === 0) {continue;}

    try {
      await createHighlights(token, inputs);
    } catch (err) {
      throw new DigestExportError(
        err instanceof Error ? `Could not export to Readwise: ${err.message}` : String(err),
      );
    }

    const exportedAt = new Date().toISOString();
    for (const entry of batch) {
      await markDigestEntryExported(String(entry.id), exportedAt);
      exported += 1;
    }
    onProgress?.({exported, total});
  }

  return {exported};
}
