import {PluginCommAPI, PluginNoteAPI, Element, type TextBox} from 'sn-plugin-lib';
import type {APIResponse} from './apiResponse';
import {ensureFileWritePermission} from './permissions';

/**
 * NOTE: `ElementType` (as used in the docs.supernote.com examples) is declared in
 * `sn-plugin-lib`'s model/Element.ts but is NOT re-exported from the package's public index
 * (checked node_modules/sn-plugin-lib/lib/typescript/src/index.d.ts directly -- only `Element`
 * is exported). The same type constants are duplicated as static properties directly on the
 * exported `Element` class, so use those instead of importing a nonexistent `ElementType`.
 */
//
// Originally used TYPE_TEXT_DIGEST_CREATE (502, Supernote's "digest" textbox styling) here, but
// on-device testing found insertPageElements unconditionally rejects it with "The digest text
// box is not editable!" regardless of the textEditable field's value (tried both 0 and 1) --
// contradicts the docs table's claim that digest TextBoxes "can be inserted and edited" via the
// plugin API. Whatever the real constraint is, creating a *new* digest-styled TextBox from a
// plugin does not appear to be supported in practice. Task 2 only asks for "a textbox" (not
// specifically digest styling), so use the plain, confirmed-working TYPE_TEXT (500) instead --
// see plans/plan.md "Task 2" notes for the full investigation and a pointer back to this if
// Task 3/4 ever need the digest styling specifically.
const TYPE_TEXT = Element.TYPE_TEXT;

export interface QuoteToInsert {
  text: string;
  bookTitle?: string | null;
  bookAuthor?: string | null;
}

const TOP_MARGIN_PX = 80;
const WIDTH_RATIO = 0.8;
const DEFAULT_FONT_SIZE = 28;
/** Rough estimate (no text-measurement API available) so the box isn't absurdly short for a
 * long quote. Supernote lets the user drag-resize afterward regardless. */
const CHARS_PER_LINE_ESTIMATE = 40;
const LINE_HEIGHT_PX = 44;
const MIN_HEIGHT_PX = 200;

export class InsertQuoteError extends Error {}

/**
 * Inserts a Readwise highlight into the currently-open note as a digest-style TextBox
 * (`Element.TYPE_TEXT_DIGEST_CREATE`, 502) on the current page's main layer.
 *
 * Digest TextBoxes are NOTE-only and main-layer-only (see skill references/types.md and
 * docs.supernote.com's Element Operations guide) -- callers must ensure a .note file (not .doc/
 * .pdf/.epub) is open before calling this.
 */
export async function insertQuoteIntoCurrentNote(quote: QuoteToInsert): Promise<void> {
  const hasFileWrite = await ensureFileWritePermission();
  if (!hasFileWrite) {
    throw new InsertQuoteError('File write access is required to insert a quote into the note.');
  }

  const pathRes = (await PluginCommAPI.getCurrentFilePath()) as unknown as APIResponse<string>;
  if (!pathRes.success || !pathRes.result) {
    throw new InsertQuoteError('No note is currently open.');
  }
  if (!pathRes.result.toLowerCase().endsWith('.note')) {
    throw new InsertQuoteError(
      'Open a Supernote note (.note file) to insert a quote -- documents are not supported.',
    );
  }

  const pageRes = (await PluginCommAPI.getCurrentPageNum()) as unknown as APIResponse<number>;
  if (!pageRes.success || pageRes.result == null) {
    throw new InsertQuoteError('Could not determine the current page.');
  }
  const page = pageRes.result;

  const sizeRes = (await PluginCommAPI.getPageDisplaySize()) as unknown as APIResponse<{
    width: number;
    height: number;
  }>;
  if (!sizeRes.success || !sizeRes.result) {
    throw new InsertQuoteError('Could not determine the page size.');
  }
  const {width: pageWidth} = sizeRes.result;

  // Flush any pending in-memory note edits before reading/writing element state (SDK guidance
  // for insertElements/modifyElements/replaceElements -- applies here too since we're about to
  // write). See docs.supernote.com's saveCurrentNote page / skill gotcha #9.
  await PluginNoteAPI.saveCurrentNote();

  const text = formatQuoteText(quote);
  const width = Math.max(200, Math.round(pageWidth * WIDTH_RATIO));
  // Centered horizontally -- previously left-anchored near the page edge, which put it right
  // under the NOTE app's fixed left-side toolbar overlay and got visually cut off.
  const left = Math.round((pageWidth - width) / 2);
  const estimatedLines = Math.max(1, Math.ceil(text.length / CHARS_PER_LINE_ESTIMATE));
  const height = Math.max(MIN_HEIGHT_PX, estimatedLines * LINE_HEIGHT_PX + LINE_HEIGHT_PX);

  const createRes = (await PluginCommAPI.createElement(
    TYPE_TEXT,
  )) as unknown as APIResponse<Element>;
  if (!createRes.success || !createRes.result) {
    throw new InsertQuoteError(createRes.error?.message ?? 'Could not create the text element.');
  }
  const element = createRes.result;

  element.pageNum = page;
  element.layerNum = 0; // digest TextBoxes are main-layer only

  const textBox: TextBox = {
    fontSize: DEFAULT_FONT_SIZE,
    fontPath: null,
    textContentFull: text,
    textRect: {
      left,
      top: TOP_MARGIN_PX,
      right: left + width,
      bottom: TOP_MARGIN_PX + height,
    },
    textDigestData: null,
    textAlign: 0,
    textBold: 0,
    textItalics: 0,
    textFrameWidthType: 0,
    textFrameStyle: 3, // thin stroke border, so the inserted quote is visually distinct
    textEditable: 0, // 0 = editable, per docs -- confirmed working for plain TYPE_TEXT
  };
  element.textBox = textBox;

  try {
    const insertRes = (await PluginCommAPI.insertPageElements(
      [element],
      page,
      0,
    )) as unknown as APIResponse<boolean>;
    if (!insertRes.success || !insertRes.result) {
      throw new InsertQuoteError(
        insertRes.error?.message ?? 'Could not insert the quote into the note.',
      );
    }
  } finally {
    // NOTE: `element.recycle()` (shown in docs.supernote.com examples, and declared on the
    // `Element` *class* in the SDK's .d.ts) does not actually exist on the object
    // PluginCommAPI.createElement() returns -- confirmed by reading the SDK source
    // (node_modules/sn-plugin-lib/lib/module/sdk/PluginCommAPI.js): createElement's result is a
    // plain object augmented with a couple of ElementDataAccessor fields, never wrapped in a
    // real Element instance with prototype methods. Calling `.recycle()` on it throws
    // "undefined is not a function" -- confirmed on-device. Use the static
    // PluginCommAPI.recycleElement(uuid) instead, which is what `.recycle()` would have called
    // anyway. It's synchronous/fire-and-forget (returns void, not a Promise), so no await.
    PluginCommAPI.recycleElement(element.uuid);
  }

  await PluginCommAPI.reloadFile();
}

function formatQuoteText(quote: QuoteToInsert): string {
  const attribution = [quote.bookTitle, quote.bookAuthor].filter(Boolean).join(' \u2014 ');
  return attribution ? `${quote.text}\n\n\u2014 ${attribution}` : quote.text;
}
