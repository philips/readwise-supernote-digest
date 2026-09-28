import {PluginManager} from 'sn-plugin-lib';

const INTERNET_PERMISSION = 'plugin.permission.INTERNET';

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
