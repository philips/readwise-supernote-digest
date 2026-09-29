/** Types for the public Readwise API (https://readwise.io/api_deets), plus the local
 * SQLite row shape we flatten Readwise's export payload into. */

export type ReadwiseCategory = 'books' | 'articles' | 'tweets' | 'podcasts';

export type ReadwiseLocationType =
  | 'page'
  | 'location'
  | 'none'
  | 'order'
  | 'offset'
  | 'time_offset';

/** A single highlight as returned by GET /api/v2/export/, nested under a book/article. */
export interface ReadwiseExportHighlight {
  id: number;
  is_deleted: boolean;
  text: string;
  location: number | null;
  location_type: ReadwiseLocationType | null;
  note: string | null;
  color: string | null;
  highlighted_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  external_id: string | null;
  end_location: number | null;
  url: string | null;
  book_id: number;
}

/** A "user book" entry as returned by GET /api/v2/export/, with nested highlights. */
export interface ReadwiseExportBook {
  user_book_id: number;
  is_deleted: boolean;
  title: string;
  author: string | null;
  readable_title: string;
  source: string;
  cover_image_url: string | null;
  unique_url: string | null;
  book_tags: unknown[];
  category: ReadwiseCategory | string;
  document_note: string | null;
  summary: string | null;
  readwise_url: string;
  source_url: string | null;
  external_id: string | null;
  asin: string | null;
  highlights: ReadwiseExportHighlight[];
}

export interface ReadwiseExportResponse {
  count: number;
  nextPageCursor: string | null;
  results: ReadwiseExportBook[];
}

/** Body for POST /api/v2/highlights/ (Task 4 will use this; typed here alongside the rest
 * of the Readwise API surface so it's ready). */
export interface ReadwiseCreateHighlightInput {
  text: string;
  title?: string;
  author?: string;
  image_url?: string;
  source_url?: string;
  source_type?: string;
  category?: ReadwiseCategory;
  note?: string;
  location?: number;
  location_type?: ReadwiseLocationType;
  highlighted_at?: string;
  highlight_url?: string;
}

export interface ReadwiseCreateHighlightsResponseBook {
  id: number;
  title: string;
  author: string | null;
  category: string;
  source: string;
  num_highlights: number;
  last_highlight_at: string | null;
  updated: string;
  cover_image_url: string | null;
  highlights_url: string;
  source_url: string | null;
  asin: string | null;
  tags: unknown[];
  document_note: string;
  modified_highlights: number[];
}

export type ReadwiseCreateHighlightsResponse = ReadwiseCreateHighlightsResponseBook[];

/** Flattened row we actually persist in SQLite (see src/db/schema.ts). */
export interface LocalHighlightRow {
  readwise_id: number;
  user_book_id: number;
  book_title: string | null;
  book_author: string | null;
  category: string | null;
  source: string | null;
  text: string;
  note: string | null;
  location: number | null;
  location_type: string | null;
  color: string | null;
  highlighted_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  highlight_url: string | null;
  source_url: string | null;
  is_deleted: boolean;
  inserted_into_note_at?: string | null;
  synced_to_digest_at?: string | null;
  fetched_at: string;
}

export function flattenExportBook(
  book: ReadwiseExportBook,
  fetchedAt: string,
): LocalHighlightRow[] {
  return book.highlights.map(h => ({
    readwise_id: h.id,
    user_book_id: book.user_book_id,
    book_title: book.title ?? null,
    book_author: book.author ?? null,
    category: book.category ?? null,
    source: book.source ?? null,
    text: h.text,
    note: h.note,
    location: h.location,
    location_type: h.location_type,
    color: h.color,
    highlighted_at: h.highlighted_at,
    created_at: h.created_at,
    updated_at: h.updated_at,
    // `h.url` is the highlight's own deep link (e.g. a tweet); book.readwise_url is the
    // book/article's Readwise dashboard page. We keep the former here since it's the more
    // specific "link to this exact highlight" -- falls back to the dashboard page if absent.
    highlight_url: h.url ?? book.readwise_url ?? null,
    source_url: book.source_url ?? null,
    is_deleted: h.is_deleted || book.is_deleted,
    fetched_at: fetchedAt,
  }));
}
