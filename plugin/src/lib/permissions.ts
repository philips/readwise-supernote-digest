import {PluginManager} from 'sn-plugin-lib';

const INTERNET_PERMISSION = 'plugin.permission.INTERNET';
const FILE_WRITE_PERMISSION = 'plugin.permission.FILE:WRITE';
const FILE_READ_PERMISSION = 'plugin.permission.FILE:READ';

/**
 * Ensures the plugin has the INTERNET permission before the first network call in a session.
 * Must be declared in PluginConfig.json's `uses-permissions` (already is, see plugin root
 * PluginConfig.json) -- calling hasPermission/requestPermission for an undeclared permission
 * throws error 1500. See vendored skill references/patterns.md Pattern 17.
 *
 * `hasPermission` result: 1 = granted. `requestPermission` result: 1 = granted this session,
 * 2 = granted always, 0/-1 = denied/dismissed.
 */
export async function ensureInternetPermission(): Promise<boolean> {
  const has = await PluginManager.hasPermission(INTERNET_PERMISSION);
  if (has === 1) {return true;}

  const result = await PluginManager.requestPermission(
    INTERNET_PERMISSION,
    'Readwise Digest needs network access to sync highlights with your Readwise account.',
  );
  return result === 1 || result === 2;
}

/**
 * Inserting a quote into the current note goes through PluginCommAPI.createElement /
 * insertPageElements / PluginNoteAPI.saveCurrentNote -- despite operating only on the
 * already-open current file, this firmware still gates it behind FILE:WRITE (confirmed
 * on-device: "File write permission has not been requested, so related APIs cannot be called."
 * without this). The skill/docs' claim that current-file PluginCommAPI calls are ungated
 * doesn't hold for the note-writing ones -- only true for read-ish calls like lassoElements.
 */
export async function ensureFileWritePermission(): Promise<boolean> {
  const has = await PluginManager.hasPermission(FILE_WRITE_PERMISSION);
  if (has === 1) {return true;}

  const result = await PluginManager.requestPermission(
    FILE_WRITE_PERMISSION,
    'Readwise Digest needs file write access to insert a quote into the current note.',
  );
  return result === 1 || result === 2;
}

/**
 * Reading a document's title/author out of the PDF/EPUB itself (src/lib/documentInfo). The host
 * enforces this in native code too, not just for SDK calls: without it our own
 * DocumentMetadataModule gets `SecurityException: Plugin [...] has no READ permission on sdcard`.
 */
export async function ensureFileReadPermission(): Promise<boolean> {
  const has = await PluginManager.hasPermission(FILE_READ_PERMISSION);
  if (has === 1) {return true;}

  const result = await PluginManager.requestPermission(
    FILE_READ_PERMISSION,
    'Readwise Digest needs file read access to look up the title and author of the books you highlighted.',
  );
  return result === 1 || result === 2;
}
