import {getOrCreateDigestCategory, insertDigestEntry} from './knowledgeProvider';
import {
  getSetting,
  setSetting,
  markHighlightSyncedToDigest,
  getUnsyncedToDigestHighlights,
  getUnsyncedToDigestCount,
} from '../db';
import {SettingsKey, DEFAULT_DIGEST_CATEGORY} from '../db/schema';
import type {LocalHighlightRow} from '../readwise/types';

/**
 * Task 3: sync Readwise highlights into Supernote's native Digest feature, tagged with a
 * "Readwise" category (the "category postfix" the spec asked for). See
 * src/lib/knowledgeProvider.ts / android/app/src/main/java/com/plugin/KnowledgeProviderModule.kt
 * for how this actually talks to the on-device Digest app's ContentProvider, and plans/plan.md
 * "Task 3" for the full investigation that got us here (two earlier approaches -- a raw
 * ContentProvider write and digest-styled note textboxes -- were both initially believed
 * infeasible; the ContentProvider path turned out to work after deeper investigation).
 */

export interface DigestSyncProgress {
  synced: number;
  total: number;
}

export class DigestSyncError extends Error {}

async function getCategoryUniqueAttribute(): Promise<string> {
  const cached = await getSetting(SettingsKey.DigestCategoryUniqueAttribute);
  if (cached) {return cached;}

  const categoryName = (await getSetting(SettingsKey.DigestCategory)) || DEFAULT_DIGEST_CATEGORY;
  const uniqueAttribute = await getOrCreateDigestCategory(categoryName);
  await setSetting(SettingsKey.DigestCategoryUniqueAttribute, uniqueAttribute);
  return uniqueAttribute;
}

function formatAuthor(highlight: LocalHighlightRow): string | null {
  const parts = [highlight.book_title, highlight.book_author].filter(Boolean);
  return parts.length > 0 ? parts.join(' \u2014 ') : null;
}

/** Number of highlights not yet synced into the Digest app. */
export async function getPendingDigestSyncCount(): Promise<number> {
  return getUnsyncedToDigestCount();
}

const FETCH_BATCH_SIZE = 25;

/**
 * Syncs all highlights not yet synced into the Digest app. Safe to call repeatedly / resume
 * after a partial failure -- each highlight is only marked synced (`synced_to_digest_at`) after
 * its insert succeeds, and the category lookup/creation is cached after the first successful
 * sync so later runs don't need to hit the provider for it again.
 */
export async function syncPendingHighlightsToDigest(
  onProgress?: (progress: DigestSyncProgress) => void,
): Promise<{synced: number}> {
  const total = await getUnsyncedToDigestCount();
  if (total === 0) {return {synced: 0};}

  let categoryUniqueAttribute: string;
  try {
    categoryUniqueAttribute = await getCategoryUniqueAttribute();
  } catch (err) {
    throw new DigestSyncError(
      err instanceof Error ? `Could not set up the Digest category: ${err.message}` : String(err),
    );
  }

  let synced = 0;
  for (;;) {
    const batch = await getUnsyncedToDigestHighlights(FETCH_BATCH_SIZE);
    if (batch.length === 0) {break;}
    for (const highlight of batch) {
      try {
        await insertDigestEntry({
          content: highlight.text,
          categoryUniqueAttribute,
          author: formatAuthor(highlight),
        });
      } catch (err) {
        throw new DigestSyncError(
          err instanceof Error ? `Could not insert into Digest: ${err.message}` : String(err),
        );
      }
      await markHighlightSyncedToDigest(highlight.readwise_id, new Date().toISOString());
      synced += 1;
      onProgress?.({synced, total});
    }
  }
  return {synced};
}
