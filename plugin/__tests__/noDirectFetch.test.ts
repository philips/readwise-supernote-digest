import fs from 'fs';
import path from 'path';

/**
 * Read-only mode is only as strong as "every request goes through readwiseFetch()". This fails if
 * someone adds another way out of the app. (The ESLint no-restricted-globals rule catches the same
 * thing earlier, in the editor and in CI.)
 */
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {return sourceFiles(full);}
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [full] : [];
  });
}

const SRC = path.join(__dirname, '..', 'src');
const APP_FILES = [...sourceFiles(SRC), path.join(__dirname, '..', 'App.tsx'), path.join(__dirname, '..', 'index.js')];
const CLIENT = path.join(SRC, 'readwise', 'client.ts');
const read = (f: string) => fs.readFileSync(f, 'utf8');
// `fetch(` as a bare call: not a method (`.fetch(`), not part of a longer name (`fetchExportPage(`).
const BARE_FETCH = /(^|[^.\w$])fetch\s*\(/g;
const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

describe('no way around the read-only guard', () => {
  test('the app files are really being scanned', () => {
    expect(APP_FILES.length).toBeGreaterThan(15);
    expect(APP_FILES).toContain(CLIENT);
  });

  test('only src/readwise/client.ts calls fetch', () => {
    const offenders = APP_FILES.filter(f => f !== CLIENT && count(read(f), BARE_FETCH) > 0);
    expect(offenders.map(f => path.relative(SRC, f))).toEqual([]);
  });

  test('inside client.ts there is exactly one, inside readwiseFetch (so the typed calls cannot skip it)', () => {
    const text = read(CLIENT);
    expect(count(text, BARE_FETCH)).toBe(1);
    const body = text.slice(text.indexOf('export async function readwiseFetch'));
    expect(body.slice(0, body.indexOf('\n}\n'))).toMatch(BARE_FETCH);
  });

  test('no other HTTP mechanism is used anywhere in the app', () => {
    const others = /\b(XMLHttpRequest|WebSocket|axios|node-fetch|sendBeacon)\b/;
    const offenders = APP_FILES.filter(f => others.test(read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
    expect(offenders.map(f => path.relative(SRC, f))).toEqual([]);
  });
});
