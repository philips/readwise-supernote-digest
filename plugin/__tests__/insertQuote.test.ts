import fs from 'fs';
import path from 'path';

const mockGrants: Record<string, boolean> = {};
const mockCalls: string[] = [];

jest.mock('sn-plugin-lib', () => {
  const ok = (result: unknown) => ({success: true, result});
  const track = (name: string, impl: (...a: any[]) => any) =>
    jest.fn((...args: any[]) => {
      mockCalls.push(name);
      return impl(...args);
    });
  return {
    Element: {TYPE_TEXT: 500},
    PluginManager: {
      hasPermission: jest.fn(async (p: string) => (mockGrants[p] ? 1 : 0)),
      requestPermission: jest.fn(async (p: string) => {
        mockCalls.push(`request:${p}`);
        if (mockGrants[`ask:${p}`] === false) {return 0;}
        mockGrants[p] = true;
        return 1;
      }),
    },
    PluginCommAPI: {
      getCurrentFilePath: track('getCurrentFilePath', async () => ok('/storage/emulated/0/Note/test.note')),
      getCurrentPageNum: track('getCurrentPageNum', async () => ok(3)),
      // The old call. Must never be made with sn-plugin-lib later than 0.1.65.
      getPageDisplaySize: track('getPageDisplaySize', async () => ok({width: 1, height: 1})),
      createElement: track('createElement', async () => ok({uuid: 'u-1'})),
      insertPageElements: track('insertPageElements', async () => ok(true)),
      recycleElement: track('recycleElement', () => undefined),
      reloadFile: track('reloadFile', async () => undefined),
    },
    PluginFileAPI: {
      getPageSize: track('getPageSize', async () => ok({width: 1920, height: 2560})),
    },
    PluginNoteAPI: {
      saveCurrentNote: track('saveCurrentNote', async () => undefined),
    },
  };
});

import {PluginCommAPI, PluginFileAPI, PluginManager, PluginNoteAPI} from 'sn-plugin-lib';
import {insertQuoteIntoCurrentNote, layoutQuoteBox} from '../src/lib/insertQuote';

const api = PluginCommAPI as any;
const files = PluginFileAPI as any;
const manager = PluginManager as any;
const QUOTE = {text: 'A short quote.', bookTitle: 'Book', bookAuthor: 'Author'};
const WRITE = 'plugin.permission.FILE:WRITE';
const READ = 'plugin.permission.FILE:READ';

beforeEach(() => {
  mockCalls.length = 0;
  for (const k of Object.keys(mockGrants)) {delete mockGrants[k];}
  mockGrants[WRITE] = true;
  mockGrants[READ] = true;
  jest.clearAllMocks();
});

const insertedRect = () => api.insertPageElements.mock.calls[0][0][0].textBox.textRect;

describe('insertQuote: page size comes from getPageSize (sn-plugin-lib > 0.1.65)', () => {
  test('asks getPageSize for the open file and current page, and never getPageDisplaySize', async () => {
    await insertQuoteIntoCurrentNote(QUOTE);
    expect(files.getPageSize).toHaveBeenCalledTimes(1);
    expect(files.getPageSize).toHaveBeenCalledWith('/storage/emulated/0/Note/test.note', 3);
    expect(api.getPageDisplaySize).not.toHaveBeenCalled();
  });

  test('the box is laid out in that page size (Manta/Nomad 1920 wide)', async () => {
    await insertQuoteIntoCurrentNote(QUOTE);
    const r = insertedRect();
    expect(r.left).toBe(192); // (1920 - 1536) / 2
    expect(r.right).toBe(192 + 1536);
    expect(r.top).toBe(80);
  });

  test('a different page size gives a different box (A5X/A6X 1404 wide)', async () => {
    files.getPageSize.mockResolvedValueOnce({success: true, result: {width: 1404, height: 1872}});
    await insertQuoteIntoCurrentNote(QUOTE);
    const r = insertedRect();
    expect(r.right - r.left).toBe(Math.round(1404 * 0.8));
    expect(r.left).toBe(Math.round((1404 - Math.round(1404 * 0.8)) / 2));
    expect(Math.abs(r.left + (r.right - r.left) / 2 - 1404 / 2)).toBeLessThanOrEqual(1); // centred, within rounding
  });

  test('inserts on the current page, then reloads the file; the created element is recycled', async () => {
    await insertQuoteIntoCurrentNote(QUOTE);
    const [elements, page, layer] = api.insertPageElements.mock.calls[0];
    expect(page).toBe(3);
    expect(layer).toBe(0);
    expect(elements[0].pageNum).toBe(3);
    expect(elements[0].textBox.textContentFull).toBe('A short quote.\n\n\u2014 Book \u2014 Author');
    expect(api.recycleElement).toHaveBeenCalledWith('u-1');
    expect(api.reloadFile).toHaveBeenCalledTimes(1);
  });

  test('order: file/page are read first, the note is saved before anything is written', async () => {
    await insertQuoteIntoCurrentNote(QUOTE);
    const order = (n: string) => mockCalls.indexOf(n);
    expect(order('getCurrentFilePath')).toBeLessThan(order('getPageSize'));
    expect(order('getCurrentPageNum')).toBeLessThan(order('getPageSize'));
    expect(order('getPageSize')).toBeLessThan(order('saveCurrentNote'));
    expect(order('saveCurrentNote')).toBeLessThan(order('createElement'));
    expect(order('createElement')).toBeLessThan(order('insertPageElements'));
    expect(order('insertPageElements')).toBeLessThan(order('reloadFile'));
  });
});

describe('insertQuote: file read permission (getPageSize is gated by FILE:READ)', () => {
  test('already granted: no prompt', async () => {
    await insertQuoteIntoCurrentNote(QUOTE);
    expect(manager.requestPermission).not.toHaveBeenCalled();
  });

  test('not granted yet: prompts once, then carries on', async () => {
    mockGrants[READ] = false;
    await insertQuoteIntoCurrentNote(QUOTE);
    expect(manager.requestPermission).toHaveBeenCalledTimes(1);
    expect(manager.requestPermission.mock.calls[0][0]).toBe(READ);
    expect(files.getPageSize).toHaveBeenCalledTimes(1);
  });

  test('declined: clear error, no page-size call, nothing written', async () => {
    mockGrants[READ] = false;
    mockGrants[`ask:${READ}`] = false;
    await expect(insertQuoteIntoCurrentNote(QUOTE)).rejects.toThrow(/file read access/i);
    expect(files.getPageSize).not.toHaveBeenCalled();
    expect(api.insertPageElements).not.toHaveBeenCalled();
    expect(api.createElement).not.toHaveBeenCalled();
  });

  test('only asked for once the note is known to be a .note (a PDF never triggers the prompt)', async () => {
    mockGrants[READ] = false;
    api.getCurrentFilePath.mockResolvedValueOnce({success: true, result: '/storage/emulated/0/Document/book.pdf'});
    await expect(insertQuoteIntoCurrentNote(QUOTE)).rejects.toThrow(/\.note/);
    expect(manager.requestPermission).not.toHaveBeenCalled();
  });

  test('write permission is still required', async () => {
    mockGrants[WRITE] = false;
    mockGrants[`ask:${WRITE}`] = false;
    await expect(insertQuoteIntoCurrentNote(QUOTE)).rejects.toThrow(/write access/i);
    expect(files.getPageSize).not.toHaveBeenCalled();
  });
});

describe('insertQuote: failures', () => {
  test('getPageSize fails: its message is shown, nothing is written', async () => {
    files.getPageSize.mockResolvedValueOnce({success: false, error: {code: 1, message: 'no such page'}});
    await expect(insertQuoteIntoCurrentNote(QUOTE)).rejects.toThrow('no such page');
    expect(api.insertPageElements).not.toHaveBeenCalled();
  });

  test.each([
    ['no message', {success: false}],
    ['success without a result', {success: true, result: null}],
  ])('getPageSize gives nothing usable (%s)', async (_n, response) => {
    files.getPageSize.mockResolvedValueOnce(response);
    await expect(insertQuoteIntoCurrentNote(QUOTE)).rejects.toThrow(/page size/i);
    expect(api.insertPageElements).not.toHaveBeenCalled();
  });

  test('no note open / no current page', async () => {
    api.getCurrentFilePath.mockResolvedValueOnce({success: false});
    await expect(insertQuoteIntoCurrentNote(QUOTE)).rejects.toThrow(/no note is currently open/i);
    api.getCurrentPageNum.mockResolvedValueOnce({success: false});
    await expect(insertQuoteIntoCurrentNote(QUOTE)).rejects.toThrow(/current page/i);
  });

  test('a failed insert still recycles the element and does not reload', async () => {
    api.insertPageElements.mockResolvedValueOnce({success: true, result: false});
    await expect(insertQuoteIntoCurrentNote(QUOTE)).rejects.toThrow(/could not insert/i);
    expect(api.recycleElement).toHaveBeenCalledWith('u-1');
    expect(api.reloadFile).not.toHaveBeenCalled();
  });
});

describe('layoutQuoteBox', () => {
  test.each([1404, 1920, 1000, 2400])('page width %i: centred, 80% wide, integer coordinates', width => {
    const r = layoutQuoteBox(width, 'x');
    expect(r.right - r.left).toBe(Math.round(width * 0.8));
    expect(r.left).toBe(Math.round((width - (r.right - r.left)) / 2));
    for (const v of Object.values(r)) {expect(Number.isInteger(v)).toBe(true);}
    expect(r.right).toBeLessThanOrEqual(width);
  });

  test('never narrower than 200 px, even on a tiny page', () => {
    const r = layoutQuoteBox(100, 'x');
    expect(r.right - r.left).toBe(200);
  });

  test('height: at least 200, and grows with the text', () => {
    const height = (text: string) => {
      const r = layoutQuoteBox(1920, text);
      return r.bottom - r.top;
    };
    expect(height('short')).toBe(200);
    expect(height('x'.repeat(40 * 10))).toBeGreaterThan(height('x'.repeat(40 * 3)));
    expect(height('x'.repeat(40 * 10))).toBe(10 * 44 + 44);
  });

  test('top margin is fixed', () => {
    expect(layoutQuoteBox(1920, 'x').top).toBe(80);
  });
});

describe('migration guard', () => {
  test('the app never calls getPageDisplaySize (it is for sn-plugin-lib 0.1.65 and earlier)', () => {
    const dir = path.join(__dirname, '..', 'src');
    const walk = (d: string): string[] =>
      fs.readdirSync(d, {withFileTypes: true}).flatMap(e =>
        e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : [],
      );
    const calls = walk(dir).filter(f =>
      /getPageDisplaySize\s*\(/.test(fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')),
    );
    expect(calls.map(f => path.relative(dir, f))).toEqual([]);
  });

  test('PluginNoteAPI.saveCurrentNote is part of the flow', async () => {
    await insertQuoteIntoCurrentNote(QUOTE);
    expect((PluginNoteAPI as any).saveCurrentNote).toHaveBeenCalledTimes(1);
  });
});
