import type {
  ReadwiseCreateHighlightInput,
  ReadwiseCreateHighlightsResponse,
  ReadwiseExportResponse,
} from './types';

const BASE_URL = 'https://readwise.io/api/v2';

export class ReadwiseAuthError extends Error {
  constructor() {
    super('Readwise API token is invalid or expired.');
    this.name = 'ReadwiseAuthError';
  }
}

export class ReadwiseRateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super(`Readwise API rate limit hit; retry after ${retryAfterSeconds}s.`);
    this.name = 'ReadwiseRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ReadwiseApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(`Readwise API error (${status}): ${message}`);
    this.name = 'ReadwiseApiError';
    this.status = status;
  }
}

function authHeader(token: string): Record<string, string> {
  return {Authorization: `Token ${token}`};
}

async function handleErrorResponse(res: Response): Promise<never> {
  if (res.status === 401 || res.status === 403) {
    throw new ReadwiseAuthError();
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After') ?? '60');
    throw new ReadwiseRateLimitError(Number.isFinite(retryAfter) ? retryAfter : 60);
  }
  let bodyText = '';
  try {
    bodyText = await res.text();
  } catch {
    // ignore
  }
  throw new ReadwiseApiError(res.status, bodyText || res.statusText);
}

/** GET /api/v2/auth/ -- returns true if the token is valid (204), false if invalid (401). */
export async function validateToken(token: string): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/auth/`, {
    method: 'GET',
    headers: authHeader(token),
  });
  if (res.status === 204) {return true;}
  if (res.status === 401 || res.status === 403) {return false;}
  await handleErrorResponse(res);
  return false;
}

export interface ExportPageParams {
  updatedAfter?: string;
  pageCursor?: string;
  /** Also return highlights/books deleted on Readwise, flagged is_deleted. */
  includeDeleted?: boolean;
}

/** GET /api/v2/export/ -- one page of the highlight export. Caller drives pagination via
 * `nextPageCursor` in the response (see src/readwise/sync.ts). */
export async function fetchExportPage(
  token: string,
  params: ExportPageParams = {},
): Promise<ReadwiseExportResponse> {
  // Deliberately not using URLSearchParams: React Native's built-in polyfill
  // (Libraries/Blob/URLSearchParams.js) only implements append()/toString()/iteration --
  // .set()/.get()/.has()/.delete()/.sort() all throw "not implemented" at runtime (confirmed
  // on-device). Building the query string by hand sidesteps relying on polyfill coverage at all.
  const queryParts: string[] = [];
  if (params.updatedAfter) {
    queryParts.push(`updatedAfter=${encodeURIComponent(params.updatedAfter)}`);
  }
  if (params.pageCursor) {
    queryParts.push(`pageCursor=${encodeURIComponent(params.pageCursor)}`);
  }
  if (params.includeDeleted) {
    queryParts.push('includeDeleted=true');
  }
  const qs = queryParts.join('&');
  const url = `${BASE_URL}/export/${qs ? `?${qs}` : ''}`;

  const res = await fetch(url, {method: 'GET', headers: authHeader(token)});
  if (!res.ok) {
    await handleErrorResponse(res);
  }
  return (await res.json()) as ReadwiseExportResponse;
}

/** POST /api/v2/highlights/ -- create/update highlights. Used by Task 4 (digest -> Readwise
 * export); wired up here now since it's the same client module. */
export async function createHighlights(
  token: string,
  highlights: ReadwiseCreateHighlightInput[],
): Promise<ReadwiseCreateHighlightsResponse> {
  if (highlights.length === 0) {return [];}
  const res = await fetch(`${BASE_URL}/highlights/`, {
    method: 'POST',
    headers: {
      ...authHeader(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({highlights}),
  });
  if (!res.ok) {
    await handleErrorResponse(res);
  }
  return (await res.json()) as ReadwiseCreateHighlightsResponse;
}
