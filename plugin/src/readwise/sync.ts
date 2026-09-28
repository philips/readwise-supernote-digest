import {fetchExportPage, ReadwiseRateLimitError} from './client';
import {flattenExportBook} from './types';
import {getSetting, setSetting, upsertHighlights} from '../db';
import {SettingsKey} from '../db/schema';

export interface SyncProgress {
  page: number;
  booksInPage: number;
  highlightsSoFar: number;
}

export interface SyncResult {
  highlightsFetched: number;
  pages: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const MAX_RATE_LIMIT_RETRIES = 3;

async function fetchExportPageWithRetry(
  token: string,
  params: {updatedAfter?: string; pageCursor?: string},
  attempt = 0,
): ReturnType<typeof fetchExportPage> {
  try {
    return await fetchExportPage(token, params);
  } catch (err) {
    if (err instanceof ReadwiseRateLimitError && attempt < MAX_RATE_LIMIT_RETRIES) {
      await sleep(err.retryAfterSeconds * 1000);
      return fetchExportPageWithRetry(token, params, attempt + 1);
    }
    throw err;
  }
}

/**
 * Pulls all highlights (or, if a previous sync completed, only ones updated since then) from
 * Readwise's export endpoint and upserts them into the local SQLite cache.
 *
 * Readwise's recommended pattern (see their API docs): first sync with no `updatedAfter`,
 * follow `nextPageCursor` until null, then on subsequent syncs pass `updatedAfter` = the time
 * the *previous* sync started (not finished -- captured before this sync's first request, so a
 * highlight updated mid-sync isn't missed on the next incremental pull).
 */
export async function syncHighlights(
  token: string,
  onProgress?: (progress: SyncProgress) => void,
): Promise<SyncResult> {
  const updatedAfter = (await getSetting(SettingsKey.LastExportUpdatedAfter)) ?? undefined;
  const syncStartedAt = new Date().toISOString();

  let cursor: string | undefined;
  let page = 0;
  let highlightsSoFar = 0;

  do {
    const response = await fetchExportPageWithRetry(token, {updatedAfter, pageCursor: cursor});
    const rows = response.results.flatMap(book => flattenExportBook(book, syncStartedAt));
    await upsertHighlights(rows);

    page += 1;
    highlightsSoFar += rows.length;
    onProgress?.({page, booksInPage: response.results.length, highlightsSoFar});

    cursor = response.nextPageCursor ?? undefined;
  } while (cursor);

  await setSetting(SettingsKey.LastExportUpdatedAfter, syncStartedAt);

  return {highlightsFetched: highlightsSoFar, pages: page};
}
