import {deleteSetting, getSetting, setSetting} from '../db';
import {SettingsKey} from '../db/schema';

/**
 * Read-only mode: the plugin may not change anything in the user's Readwise account.
 *
 * Enforced here, at the bottom, and not only in the UI: src/readwise/client.ts asks this module
 * before every request that is not a plain read, so no screen or future feature can write by
 * accident. See plans/read-only-mode.md.
 *
 * Design rules:
 *  - Fails closed. Only the stored value '1' allows writes; a missing setting, any other value and
 *    any error reading the database all mean read-only. The default is therefore "read-only" with no
 *    initialisation step that could be forgotten.
 *  - Never cached. The setting is read from the database on every call, so flipping the switch
 *    takes effect on the very next request.
 */

export class ReadwiseReadOnlyError extends Error {
  constructor() {
    super(
      'Read-only mode is on, so nothing is sent to Readwise. ' +
        'Turn it off in Sync and Export to allow exporting.',
    );
    this.name = 'ReadwiseReadOnlyError';
  }
}

export async function isReadwiseWriteAllowed(): Promise<boolean> {
  try {
    return (await getSetting(SettingsKey.ReadwiseWritesEnabled)) === '1';
  } catch {
    return false; // can't tell => read-only
  }
}

export async function assertReadwiseWritesAllowed(): Promise<void> {
  if (!(await isReadwiseWriteAllowed())) {
    throw new ReadwiseReadOnlyError();
  }
}

/** `true` lets the plugin write to Readwise (read-only mode off). `false` restores the default by
 * deleting the setting, so there is no stored "off" value to get out of sync with it. */
export async function setReadwiseWritesEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    await setSetting(SettingsKey.ReadwiseWritesEnabled, '1');
  } else {
    await deleteSetting(SettingsKey.ReadwiseWritesEnabled);
  }
}
