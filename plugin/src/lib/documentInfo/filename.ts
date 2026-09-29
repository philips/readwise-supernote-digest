import {
  cleanAuthor,
  cleanTitle,
  collapseWhitespace,
  isJunkAuthor,
  isJunkTitle,
  restoreFilenameUnderscores,
} from './clean';

export interface FilenameInfo {
  /** null when the filename yields nothing better than junk ("book", "Unknown"). */
  title: string | null;
  author: string | null;
  /** The cleaned file stem: last-resort title so an export never has an empty one. */
  stem: string;
}

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

/**
 * Best-effort "Title - Author.ext" parsing (a common library-export naming scheme, and the one used by
 * the books on the test device). Splits on the LAST " - " so titles containing a
 * spaced dash still work, at the cost of misreading "Title - Subtitle.pdf" as an author.
 * That is why filenames are the lowest-priority source (see resolve.ts).
 */
export function parseFilename(pathOrName: string): FilenameInfo {
  const stemRaw = basename(pathOrName).replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const stem = collapseWhitespace(restoreFilenameUnderscores(stemRaw));

  const at = stem.lastIndexOf(' - ');
  if (at <= 0) {
    return {title: isJunkTitle(stem) ? null : cleanTitle(stem), author: null, stem};
  }
  const titlePart = stem.slice(0, at);
  const authorPart = stem.slice(at + 3);

  const title = isJunkTitle(titlePart) ? null : cleanTitle(titlePart);
  const authorClean = cleanAuthor(authorPart);
  const author = isJunkAuthor(authorClean) ? null : authorClean;
  return {title, author, stem};
}
