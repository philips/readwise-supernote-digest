import React, {useState} from 'react';
import {Linking} from 'react-native';
import {validateToken, ReadwiseAuthError} from '../readwise/client';
import {syncHighlights} from '../readwise/sync';
import {setSetting} from '../db';
import {SettingsKey} from '../db/schema';
import {ensureInternetPermission} from '../lib/permissions';
import {
  BodyText,
  ListRow,
  PrimaryButton,
  SectionLabel,
  StatusText,
  TextField,
} from '../snuxlib';

const ACCESS_TOKEN_URL = 'https://readwise.io/access_token';

interface Props {
  onComplete: () => void;
  log: (text: string) => void;
}

export default function Setup({onComplete, log}: Props): React.JSX.Element {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const fail = (message: string) => {
    setError(message);
    setStatus(null);
    log(message);
  };

  const handleConnect = async () => {
    if (busy) {return;}
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      fail('Enter your Readwise API token first.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const granted = await ensureInternetPermission();
      if (!granted) {
        fail('Network access is required to connect to Readwise.');
        return;
      }

      setStatus('Validating token…');
      log('Validating token…');
      const valid = await validateToken(trimmed);
      if (!valid) {
        fail('That token was rejected by Readwise. Double-check it and try again.');
        return;
      }

      await setSetting(SettingsKey.ReadwiseApiToken, trimmed);
      log('Token accepted. Syncing highlights…');

      let lastLogged = 0;
      await syncHighlights(trimmed, p => {
        setStatus(`Syncing highlights — ${p.highlightsSoFar} so far (page ${p.page})`);
        if (p.page !== lastLogged) {
          lastLogged = p.page;
          log(`Sync: ${p.highlightsSoFar} highlights so far (page ${p.page})`);
        }
      });
      log('Connected to Readwise. Read-only mode is on.');
      onComplete();
    } catch (err) {
      if (err instanceof ReadwiseAuthError) {
        fail('That token was rejected by Readwise. Double-check it and try again.');
      } else {
        fail(err instanceof Error ? err.message : 'Something went wrong.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionLabel>Readwise access token</SectionLabel>
      <TextField value={token} onChangeText={setToken} placeholder="Paste your Readwise API token" />
      <PrimaryButton label={busy ? 'Connecting…' : 'Connect'} onPress={handleConnect} />
      {error ? <StatusText>{error}</StatusText> : null}
      {status ? <StatusText>{status}</StatusText> : null}

      <SectionLabel>Where to find it</SectionLabel>
      <ListRow
        title={ACCESS_TOKEN_URL}
        meta="Tap to open in the browser"
        onPress={() => Linking.openURL(ACCESS_TOKEN_URL).catch(() => {})}
        solid
      />
      <BodyText>
        The plugin starts in read-only mode: it only reads from Readwise until you turn that off in
        Sync and Export.
      </BodyText>
    </>
  );
}
