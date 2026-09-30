import {getDocumentInfoCache, putDocumentInfoCache} from '../../db';
import {
  cleanTitle,
  isJunkTitle,
  joinAuthors,
} from './clean';
import {parseFilename} from './filename';
import {readDocumentMetadata} from './nativeBridge';

const STORAGE_ROOT = '/storage/emulated/0/';

/** The Digest stores `source_path` relative to shared storage ("Document/Foo.epub", and for
 * files synced from the Supernote cloud "Android/data/com.ratta.supernote.serverlink/..."). */
export function toAbsolutePath(digestSourcePath: string): string {
  return digestSourcePath.startsWith('/') ? digestSourcePath : STORAGE_ROOT + digestSourcePath;
}

export type InfoSource = 'embedded' | 'filename';

export interface DocumentInfo {
  /** Never empty. */
  title: string;
  author: string | null;
  titleSource: InfoSource;
  authorSource: InfoSource | null;
  format: 'pdf' | 'epub' | null;
}

/**
 * Title and author for a document in the Digest's "Documents" bucket, from its `source_path`.
 *
 * Per field, first non-junk value wins:  metadata embedded in the file (EPUB OPF / PDF Info)
 * >  the filename.  The result is cached per path (re-derived only after
 * a filename guess made while the file was unreadable) so the same document always exports under
 * the same title -- Readwise de-duplicates on title + author + text, so a title that drifted between runs would
 * turn every highlight into a duplicate.
 */
export async function resolveDocumentInfo(digestSourcePath: string): Promise<DocumentInfo> {
  const sourcePath = toAbsolutePath(digestSourcePath);
  // Sticky on purpose: once a document has a title it keeps it, even if the file's metadata is
  // edited later (already-exported highlights sit under the old title, and switching would
  // duplicate them on Readwise). The one exception is an entry made while the file was missing
  // (file_size null) -- that was only a filename guess, so upgrade it once the file is readable.
  const cached = await getDocumentInfoCache(sourcePath);
  if (cached && cached.file_size !== null) {
    return cached.info;
  }

  const embedded = await readDocumentMetadata(sourcePath);
  if (cached && (!embedded.exists || embedded.error)) {
    return cached.info; // still can't read it: keep what we told Readwise before
  }

  const info = await derive(sourcePath, embedded);
  // Only a successful read makes the answer sticky. If the read failed (permission not granted
  // yet, corrupt file) this is a filename guess: remember it, but leave file_size null so it is
  // upgraded as soon as the file becomes readable.
  const readOk = embedded.exists && !embedded.error;
  await putDocumentInfoCache(
    sourcePath,
    info,
    readOk ? embedded.size ?? null : null,
    readOk ? embedded.mtime ?? null : null,
  );
  return info;
}

async function derive(
  sourcePath: string,
  embedded: Awaited<ReturnType<typeof readDocumentMetadata>>,
): Promise<DocumentInfo> {
  // "Embedded" means the file's own metadata: for a PDF the Info dictionary first, then XMP;
  // each field falls through independently when the earlier value is junk or missing.
  const embeddedTitle = [embedded.title, embedded.xmpTitle].find(t => t && !isJunkTitle(t));
  const fromFile = {
    title: embeddedTitle ? cleanTitle(embeddedTitle) : null,
    author:
      (embedded.authors ? joinAuthors(embedded.authors) : null) ??
      (embedded.xmpAuthors ? joinAuthors(embedded.xmpAuthors) : null),
  };
  const fromName = parseFilename(sourcePath);

  let title: string;
  let titleSource: InfoSource;
  if (fromFile.title) {
    title = fromFile.title;
    titleSource = 'embedded';
  } else if (fromName.title) {
    title = fromName.title;
    titleSource = 'filename';
  } else {
    title = fromName.stem || 'Untitled document';
    titleSource = 'filename';
  }

  let author: string | null = null;
  let authorSource: InfoSource | null = null;
  if (fromFile.author) {
    author = fromFile.author;
    authorSource = 'embedded';
  } else if (fromName.author) {
    author = fromName.author;
    authorSource = 'filename';
  }

  return {title, author, titleSource, authorSource, format: embedded.format ?? null};
}
