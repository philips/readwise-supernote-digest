import {NativeModules} from 'react-native';

/** Result of DocumentMetadataModule.readMetadata -- never a rejection, see the Kotlin doc. */
export interface NativeDocumentMetadata {
  exists: boolean;
  size?: number;
  mtime?: number;
  format?: 'pdf' | 'epub';
  title?: string;
  authors?: string[];
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
