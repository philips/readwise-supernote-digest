import {NativeModules} from 'react-native';

/** Result of DocumentMetadataModule.readMetadata -- never a rejection, see the Kotlin doc. */
export interface NativeDocumentMetadata {
  exists: boolean;
  size?: number;
  mtime?: number;
  format?: 'pdf' | 'epub';
  title?: string;
  authors?: string[];
  /** PDF only: the document's XMP dc:title / dc:creator, separate from the Info dictionary values
   * above so either can be skipped when it is junk. */
  xmpTitle?: string;
  xmpAuthors?: string[];
  error?: string;
}

function getModule() {
  const {DocumentMetadata} = NativeModules;
  if (!DocumentMetadata) {
    throw new Error(
      'DocumentMetadata native module is not registered -- check reactPackages in ' +
        'build/generated/PluginConfig.json and that MainApplication.kt adds DocumentMetadataPackage().',
    );
  }
  return DocumentMetadata;
}

export function readDocumentMetadata(path: string): Promise<NativeDocumentMetadata> {
  return getModule().readMetadata(path);
}
