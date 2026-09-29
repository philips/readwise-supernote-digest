import {NativeModules} from 'react-native';

/**
 * Thin wrapper around the KnowledgeProviderModule native module -- direct integration with
 * Supernote's native Digest feature. See docs/KNOWLEDGE_PROVIDER.md for the full URI/schema
 * reference, and plans/plan.md "Task 3" for how/why this works despite not being part of the
 * documented sn-plugin-lib SDK surface.
 */

function getNativeModule() {
  const {KnowledgeProvider} = NativeModules;
  if (!KnowledgeProvider) {
    throw new Error(
      'KnowledgeProvider native module is not registered -- check reactPackages in ' +
        'build/generated/PluginConfig.json and that MainApplication.kt adds KnowledgeProviderPackage().',
    );
  }
  return KnowledgeProvider;
}

/** Looks up (or creates) a Digest category by name, returning its unique_attribute -- the value
 * `insertDigestEntry` needs to file entries under this category. */
export async function getOrCreateDigestCategory(name: string): Promise<string> {
  return getNativeModule().getOrCreateCategory(name);
}

/** Like getOrCreateDigestCategory but read-only: resolves null if no such category exists. */
export async function findDigestCategory(name: string): Promise<string | null> {
  return getNativeModule().findCategory(name);
}

export interface DigestEntryInput {
  content: string;
  categoryUniqueAttribute?: string | null;
  author?: string | null;
}

/** Creates a new entry in the native Digest app (appears under its "Manual Entry" tab). */
export async function insertDigestEntry(entry: DigestEntryInput): Promise<void> {
  const metadataJson = entry.author ? JSON.stringify({author: entry.author}) : null;
  await getNativeModule().insertEntry(
    entry.content,
    entry.categoryUniqueAttribute ?? null,
    metadataJson,
  );
}

export interface ManualDigestEntry {
  id: number;
  content: string | null;
  categoryUniqueAttribute: string | null;
  /** Flat JSON object string, e.g. `{"author":"..."}` -- not parsed here, see
   * docs/KNOWLEDGE_PROVIDER.md "metadata" for the known keys. */
  metadata: string | null;
  creationTime: number;
}

/** Lists every "Manual Entry" (source_type=4) Digest entry -- both the ones this plugin created
 * (Task 3) and any the user typed by hand via the native "+" button. Task 4 filters out our own
 * Readwise-tagged ones client-side (see src/lib/digestSync.ts) before exporting the rest. */
export async function listManualDigestEntries(): Promise<ManualDigestEntry[]> {
  return getNativeModule().queryManualEntries();
}

/** Digest source_type buckets (docs/KNOWLEDGE_PROVIDER.md "source_type"). */
export const DigestSourceType = {
  Document: 1,
  Note: 2,
  ManualEntry: 4,
} as const;

/** A Digest entry with its origin file. `sourcePath` is only meaningful for Document and Note
 * entries; `sourcePage` is 1-based for documents. */
export interface DigestEntry extends ManualDigestEntry {
  sourceType: number;
  sourcePath: string | null;
  sourcePage: string | null;
  comment: string | null;
}

/** Lists every Digest entry of one bucket, e.g. highlights made while reading PDFs/EPUBs. */
export async function listDigestEntriesBySourceType(sourceType: number): Promise<DigestEntry[]> {
  return getNativeModule().queryEntriesBySourceType(sourceType);
}
