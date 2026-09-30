import {loadEnv} from './helpers/env';

describe('read-only mode: the guard (fails closed)', () => {
  test('a fresh install (setting absent) is read-only', async () => {
    const {writeGuard, db, schema} = await loadEnv({writesEnabled: false});
    expect(await db.getSetting(schema.SettingsKey.ReadwiseWritesEnabled)).toBeNull();
    expect(await writeGuard.isReadwiseWriteAllowed()).toBe(false);
    await expect(writeGuard.assertReadwiseWritesAllowed()).rejects.toBeInstanceOf(
      writeGuard.ReadwiseReadOnlyError,
    );
  });

  test('only the exact string "1" allows writes', async () => {
    const {writeGuard, db, schema} = await loadEnv({writesEnabled: false});
    const key = schema.SettingsKey.ReadwiseWritesEnabled;
    const results: Record<string, boolean> = {};
    for (const value of ['1', '0', '', 'true', 'TRUE', 'yes', 'on', ' 1', '1 ', '01', '11', 'null', 'false']) {
      await db.setSetting(key, value);
      results[value] = await writeGuard.isReadwiseWriteAllowed();
    }
    expect(results).toEqual({
      '1': true,
      '0': false, '': false, true: false, TRUE: false, yes: false, on: false,
      ' 1': false, '1 ': false, '01': false, '11': false, null: false, false: false,
    });
  });

  test('a database error means read-only, not "allowed"', async () => {
    const env = await loadEnv();
    expect(await env.writeGuard.isReadwiseWriteAllowed()).toBe(true); // writes are enabled here
    const spy = jest.spyOn(env.db, 'getSetting').mockRejectedValue(new Error('disk I/O error'));
    expect(await env.writeGuard.isReadwiseWriteAllowed()).toBe(false);
    await expect(env.writeGuard.assertReadwiseWritesAllowed()).rejects.toThrow(/read-only/i);
    spy.mockRestore();
    expect(await env.writeGuard.isReadwiseWriteAllowed()).toBe(true);
  });

  test('a database that was never initialised (no settings table) is read-only', async () => {
    jest.resetModules();
    (globalThis as any).__sqliteTestDbs?.clear();
    const guard = require('../src/readwise/writeGuard');
    expect(await guard.isReadwiseWriteAllowed()).toBe(false);
  });

  test('the setting is read on every call, never cached', async () => {
    const {writeGuard} = await loadEnv({writesEnabled: false});
    const seen: boolean[] = [];
    for (const enabled of [false, true, true, false, true]) {
      await writeGuard.setReadwiseWritesEnabled(enabled);
      seen.push(await writeGuard.isReadwiseWriteAllowed());
    }
    expect(seen).toEqual([false, true, true, false, true]);
  });

  test('turning read-only back on deletes the setting instead of storing "off"', async () => {
    const {writeGuard, db, schema} = await loadEnv({writesEnabled: false});
    const key = schema.SettingsKey.ReadwiseWritesEnabled;
    await writeGuard.setReadwiseWritesEnabled(true);
    expect(await db.getSetting(key)).toBe('1');
    await writeGuard.setReadwiseWritesEnabled(false);
    expect(await db.getSetting(key)).toBeNull();
  });

  test('the choice survives an app restart', async () => {
    const first = await loadEnv({writesEnabled: false});
    await first.writeGuard.setReadwiseWritesEnabled(true);
    const second = await loadEnv({keepDatabase: true});
    expect(await second.writeGuard.isReadwiseWriteAllowed()).toBe(true);
    await second.writeGuard.setReadwiseWritesEnabled(false);
    const third = await loadEnv({keepDatabase: true});
    expect(await third.writeGuard.isReadwiseWriteAllowed()).toBe(false);
  });

  test('the error says what happened and how to change it', async () => {
    const {writeGuard} = await loadEnv({writesEnabled: false});
    const err = new writeGuard.ReadwiseReadOnlyError();
    expect(err.name).toBe('ReadwiseReadOnlyError');
    expect(err.message).toMatch(/read-only mode is on/i);
    expect(err.message).toMatch(/turn it off/i);
  });
});
