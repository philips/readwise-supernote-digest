import {NativeModules} from 'react-native';

/**
 * Thin wrapper around the KnowledgeProviderModule native module -- direct integration with
 * Supernote's native Digest feature. See that Kotlin module's doc comment (and
 * plans/plan.md "Task 3") for the full story on why/how this works despite not being part of
 * the documented sn-plugin-lib SDK surface.
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
