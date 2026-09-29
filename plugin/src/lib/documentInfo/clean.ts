/**
 * Normalisation and junk detection for titles/authors coming from wildly inconsistent sources
 * (EPUB OPF, PDF Info dictionaries, filenames). Pure functions, unit-tested.
 *
 * The output feeds Readwise, which de-duplicates on title + author + text: whatever these
 * functions return for a given input must stay stable, or every highlight re-imports as a
 * duplicate. Change the rules deliberately (and only with a cache invalidation in mind).
 */

const FILE_EXTENSION = /\.(pdf|epub|mobi|azw3?|docx?|odt|rtf|txt|tex|dvi|ps|indd|pages|pptx?|xlsx?|fb2|djvu)$/i;

const JUNK_TITLES = [
  // "Untitled", "Untitled-1", "untitled document (2)" -- but not "Untitled Masterpiece".
  /^untitled(\s+document)?([\s_-]*\(?\d+\)?)?$/i,
  /^unknown$/i,
  /^book\d*$/i,
  /^document\d*$/i,
  /^title$/i,
  /^powerpoint presentation$/i,
  /^slide\s*\d*$/i,
  /^new document$/i,
  /^(scan|scanned|img|image)[-_ ]?\d*$/i,
  /^microsoft (word|excel|powerpoint) - /i, // "Microsoft Word - report.doc": generator artefact
];

const JUNK_AUTHORS = new Set([
  'unknown',
  'unknown author',
  'anonymous',
  'admin',
  'administrator',
  'user',
  'owner',
  'author',
  'authors',
  'na',
  'n/a',
  'none',
  'null',
  'calibre', // conversion tools stamp themselves as the author
  'microsoft',
  'microsoft office user',
  'pc',
  'home',
  'default',
  'scanner',
]);

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function isJunkTitle(title: string | null | undefined): boolean {
  if (!title) {return true;}
  const t = collapseWhitespace(title);
  if (t.length < 2) {return true;}
  if (FILE_EXTENSION.test(t)) {return true;} // a filename stuffed into the Title field
  return JUNK_TITLES.some(re => re.test(t));
}

export function isJunkAuthor(author: string | null | undefined): boolean {
  if (!author) {return true;}
  const a = collapseWhitespace(author).toLowerCase();
  return a.length < 2 || JUNK_AUTHORS.has(a);
}

/** "Title, The" -> "The Title" (library sort form). Only for a trailing article. */
export function uninvertArticle(title: string): string {
  const m = /^(.+),\s+(The|A|An)$/i.exec(title);
  return m ? `${m[2]} ${m[1]}` : title;
}

/**
 * Filenames can't contain ':' etc., so exporters substitute '_' -- "Title_ Subtitle". Restores
 * the colon when an underscore is glued to the previous word and followed by a space, and turns
 * underscore-separated names ("The_Boy_and_the_Tape") back into words.
 */
export function restoreFilenameUnderscores(s: string): string {
  if (!s.includes('_')) {return s;}
  if (!/\s/.test(s)) {return s.replace(/_+/g, ' ');}
  return s.replace(/(\S)_(?= )/g, '$1:').replace(/ _ /g, ' : ');
}

export function cleanTitle(title: string): string {
  return uninvertArticle(collapseWhitespace(title));
}

/**
 * "Last, First" -> "First Last", but only when it is unambiguous: exactly one comma and a
 * single-word surname. "Chris Baldry, Peter Bain" (two authors) and "Chris Baldry, et al." must
 * be left alone.
 */
function uninvertName(author: string): string {
  const m = /^([^,&\s]+),\s+([^,&]+)$/.exec(author);
  if (!m) {return author;}
  if (/\bet\s+al\b/i.test(m[2])) {return author;}
  return `${m[2]} ${m[1]}`;
}

/** Normalises one author string (which may itself list several, joined by " & " or " and "). */
export function cleanAuthor(author: string): string {
  const a = collapseWhitespace(author).replace(/\s*&\s*/g, ', ').replace(/_+$/, '.');
  return uninvertName(a);
}

export function joinAuthors(authors: string[]): string | null {
  const cleaned = authors
    .map(a => cleanAuthor(a))
    .filter(a => !isJunkAuthor(a));
  return cleaned.length > 0 ? cleaned.join(', ') : null;
}
