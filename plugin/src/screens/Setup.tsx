import React, {useState} from 'react';
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {validateToken, ReadwiseAuthError} from '../readwise/client';
import {syncHighlights, type SyncProgress} from '../readwise/sync';
import {setSetting} from '../db';
import {SettingsKey} from '../db/schema';
import {ensureInternetPermission} from '../lib/permissions';

type Status = 'idle' | 'checking-permission' | 'validating' | 'syncing' | 'error';

const ACCESS_TOKEN_URL = 'https://readwise.io/access_token';

interface Props {
  onComplete: () => void;
}

export default function Setup({onComplete}: Props): React.JSX.Element {
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<SyncProgress | null>(null);

  const busy = status === 'checking-permission' || status === 'validating' || status === 'syncing';

  const handleConnect = async () => {
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      setError('Enter your Readwise API token first.');
      return;
    }
    setError(null);
    try {
      setStatus('checking-permission');
      const granted = await ensureInternetPermission();
      if (!granted) {
        setStatus('error');
        setError('Network access is required to connect to Readwise.');
        return;
      }

      setStatus('validating');
      const valid = await validateToken(trimmed);
      if (!valid) {
        setStatus('error');
        setError('That token was rejected by Readwise. Double-check it and try again.');
        return;
      }

      await setSetting(SettingsKey.ReadwiseApiToken, trimmed);

      setStatus('syncing');
      setProgress(null);
      await syncHighlights(trimmed, p => setProgress(p));

      onComplete();
    } catch (err) {
      setStatus('error');
      if (err instanceof ReadwiseAuthError) {
        setError('That token was rejected by Readwise. Double-check it and try again.');
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Connect Readwise</Text>
      <Text style={styles.body}>
        Paste your Readwise access token below. You can find it at:
      </Text>
      <Text
        style={styles.link}
        onPress={() => Linking.openURL(ACCESS_TOKEN_URL).catch(() => {})}>
        {ACCESS_TOKEN_URL}
      </Text>

      <TextInput
        style={styles.input}
        value={token}
        onChangeText={setToken}
        placeholder="Readwise API token"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        editable={!busy}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.button, busy && styles.buttonDisabled]}
        onPress={handleConnect}
        disabled={busy}>
        {busy ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.buttonText}>Connect</Text>
        )}
      </TouchableOpacity>

      {status === 'validating' ? (
        <Text style={styles.status}>Validating token…</Text>
      ) : null}
      {status === 'syncing' ? (
        <Text style={styles.status}>
          Syncing highlights{progress ? ` — ${progress.highlightsSoFar} so far (page ${progress.page})` : '…'}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 12,
    color: '#000000',
  },
  body: {
    fontSize: 15,
    color: '#333333',
    marginBottom: 4,
  },
  link: {
    fontSize: 15,
    color: '#000000',
    textDecorationLine: 'underline',
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 12,
    color: '#000000',
  },
  button: {
    backgroundColor: '#000000',
    borderRadius: 4,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: '#a00000',
    fontSize: 14,
    marginBottom: 12,
  },
  status: {
    marginTop: 16,
    fontSize: 14,
    color: '#333333',
    textAlign: 'center',
  },
});
