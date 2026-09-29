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
import {Color, FontSize} from '../theme';

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
          <ActivityIndicator color={Color.background} />
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
    backgroundColor: Color.background,
  },
  title: {
    fontSize: FontSize.title,
    fontWeight: '700',
    marginBottom: 16,
    color: Color.text,
  },
  body: {
    fontSize: FontSize.body,
    color: Color.mutedText,
    marginBottom: 6,
  },
  link: {
    fontSize: FontSize.body,
    color: Color.text,
    textDecorationLine: 'underline',
    marginBottom: 24,
  },
  input: {
    borderWidth: 2,
    borderColor: Color.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: FontSize.input,
    marginBottom: 16,
    color: Color.text,
  },
  button: {
    backgroundColor: Color.text,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: Color.background,
    fontSize: FontSize.button,
    fontWeight: '700',
  },
  error: {
    color: Color.error,
    fontSize: FontSize.meta,
    marginBottom: 12,
  },
  status: {
    marginTop: 16,
    fontSize: FontSize.meta,
    color: Color.mutedText,
    textAlign: 'center',
  },
});
