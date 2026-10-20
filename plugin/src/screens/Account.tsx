import React, {useState} from 'react';
import {deleteSetting} from '../db';
import {SettingsKey} from '../db/schema';
import {setReadwiseWritesEnabled} from '../readwise/writeGuard';
import {ConfirmPanel, ListRow, SectionLabel} from '../snuxlib';

interface Props {
  onSignOut: () => void;
  log: (text: string) => void;
}

/** Account tab (pinned to the bottom of the menu): the one account-level action, Disconnect. */
export default function Account({onSignOut, log}: Props): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);

  const confirmDisconnect = async () => {
    setConfirming(false);
    try {
      // A new connection starts read-only again, whatever was allowed before.
      await setReadwiseWritesEnabled(false);
      await deleteSetting(SettingsKey.ReadwiseApiToken);
      log('Disconnected from Readwise. Read-only mode is on.');
      onSignOut();
    } catch (err) {
      log(`Disconnect failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  };

  return (
    <>
      <SectionLabel>Account</SectionLabel>
      {confirming ? (
        <ConfirmPanel
          destructive
          title="Disconnect Readwise?"
          message="This clears the saved API token and turns read-only mode back on. Your cached highlights stay on the device."
          confirmLabel="Disconnect"
          onConfirm={confirmDisconnect}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <ListRow
          title="Disconnect Readwise"
          meta="Clears the saved API token"
          onPress={() => setConfirming(true)}
          solid
        />
      )}
    </>
  );
}
