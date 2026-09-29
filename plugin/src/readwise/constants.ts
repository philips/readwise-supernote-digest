/**
 * Identifiers for highlights this plugin exports to Readwise (Digest -> Readwise, see
 * src/lib/digestExport.ts). Shared with the import side so it can recognise its own exports when
 * they come back down in the next Readwise export sync, and not push them into Digest a second
 * time (they already exist there, as the user's original hand-typed entry).
 */
export const SUPERNOTE_EXPORT_TITLE = 'Supernote Digest';
export const SUPERNOTE_EXPORT_SOURCE_TYPE = 'supernote_digest';
