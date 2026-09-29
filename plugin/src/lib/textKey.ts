/**
 * Identity of a highlight's text for "is this the same passage?" checks. Whitespace-insensitive
 * (Readwise and the Digest app both re-wrap and trim), nothing more: anything cleverer risks
 * merging different quotes.
 */
export function textKey(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
