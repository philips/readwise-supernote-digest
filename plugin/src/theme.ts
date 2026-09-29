/**
 * Shared visual constants. Font sizes and the tab bar style are copied from
 * philips/olaink's App.tsx (another Supernote plugin, same e-ink-readability rationale --
 * NOTE's default UI scale is too small to read comfortably on-device without squinting), not
 * invented independently. See that repo's `packages/plugin/App.tsx` `styles` object for the
 * source of truth if these ever need re-syncing.
 */

export const FontSize = {
  /** Screen/section titles (Ola Ink `section`) */
  title: 36,
  /** Tab bar labels (Ola Ink `tabText`) */
  tab: 30,
  /** Body copy, quote text (Ola Ink `copy`) */
  body: 30,
  /** Primary/secondary button labels (Ola Ink `buttonText`, bumped slightly for our bordered
   * buttons which carry more emphasis than Ola Ink's plain ones) */
  button: 28,
  /** Text inputs (Ola Ink `input`) */
  input: 28,
  /** Secondary/meta text -- attribution lines, status text, subtext (Ola Ink `noteMeta`/`status`) */
  meta: 24,
} as const;

export const Color = {
  text: '#000000',
  background: '#ffffff',
  border: '#000000',
  mutedText: '#555555',
  mutedBorder: '#cccccc',
  error: '#a00000',
} as const;
