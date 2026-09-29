/**
 * Test double for react-native-sqlite-storage backed by Node's built-in SQLite (node:sqlite,
 * Node >= 22.13), so tests execute the plugin's real SQL -- upserts, the UPDATE that marks our own
 * exports as synced, COUNT filters -- rather than asserting against a mocked query layer.
 *
 * Implements only the callback-style surface src/db/index.ts uses. Databases are in-memory and
 * keyed by name; loadEnv() clears them unless asked to keep them.
 */
const {DatabaseSync} = require('node:sqlite');

type ExecCb = (tx: any, result: any) => void;
type ErrCb = (tx: any, err: Error) => boolean | void;

// Databases by name, so a test can simulate an app restart (fresh module registry, same file).
const shared: Map<string, any> = ((globalThis as any).__sqliteTestDbs ??= new Map());

function makeDb(name: string) {
  let raw = shared.get(name);
  if (!raw) {
    raw = new DatabaseSync(':memory:');
    shared.set(name, raw);
  }

  const tx = {
    error: null as Error | null,
    executeSql(sql: string, args: any[] = [], ok?: ExecCb, fail?: ErrCb) {
      try {
        const stmt = raw.prepare(sql);
        const isQuery = /^\s*(SELECT|PRAGMA)/i.test(sql);
        let rows: any[] = [];
        let rowsAffected = 0;
        let insertId: number | undefined;
        if (isQuery) {
          rows = stmt.all(...args);
        } else {
          const info = stmt.run(...args);
          rowsAffected = Number(info.changes);
          insertId = Number(info.lastInsertRowid);
        }
        ok?.(tx, {
          rows: {length: rows.length, item: (i: number) => rows[i]},
          rowsAffected,
          insertId,
        });
      } catch (err) {
        if (fail) {
          fail(tx, err as Error);
        } else {
          tx.error = err as Error;
        }
      }
    },
  };

  return {
    transaction(fn: (tx: any) => void, errCb?: (e: Error) => void, okCb?: () => void) {
      tx.error = null;
      raw.exec('BEGIN');
      try {
        fn(tx);
      } catch (err) {
        raw.exec('ROLLBACK');
        errCb?.(err as Error);
        return;
      }
      if (tx.error) {
        raw.exec('ROLLBACK');
        errCb?.(tx.error);
        return;
      }
      raw.exec('COMMIT');
      okCb?.();
    },
    close() {},
  };
}

const SQLite = {
  enablePromise(_enabled: boolean) {},
  openDatabase(opts: {name: string}, ok: (db: any) => void, _err?: (e: Error) => void) {
    ok(makeDb(opts.name));
  },
};

export default SQLite;
module.exports = SQLite;
module.exports.default = SQLite;
