import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {getHighlightCount, getReadwiseApiToken, deleteSetting} from '../db';
import {SettingsKey} from '../db/schema';
import {syncHighlights, type SyncProgress} from '../readwise/sync';
import {ensureInternetPermission} from '../lib/permissions';

interface Props {
  onSignOut: () => void;
}

export default function Home({onSignOut}: Props): React.JSX.Element {
  const [count, setCount] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshCount = useCallback(async () => {
    setCount(await getHighlightCount());
  }, []);

  useEffect(() => {
    refreshCount();
  }, [refreshCount]);

  const handleSync = async () => {
    setError(null);
    setSyncing(true);
    setProgress(null);
    try {
      const token = await getReadwiseApiToken();
      if (!token) {
        setError('No Readwise token saved — please reconnect.');
        setSyncing(false);
        return;
      }
      const granted = await ensureInternetPermission();
      if (!granted) {
        setError('Network access is required to sync.');
        setSyncing(false);
        return;
      }
      await syncHighlights(token, setProgress);
      await refreshCount();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = () => {
    Alert.alert(
      'Disconnect Readwise?',
      'This clears the saved API token. Your cached highlights stay on the device.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await deleteSetting(SettingsKey.ReadwiseApiToken);
            onSignOut();
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Readwise Digest</Text>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Highlights cached</Text>
        <Text style={styles.cardValue}>{count === null ? '…' : count}</Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.button, syncing && styles.buttonDisabled]}
        onPress={handleSync}
        disabled={syncing}>
        {syncing ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.buttonText}>Sync now</Text>
        )}
      </TouchableOpacity>

      {syncing ? (
        <Text style={styles.status}>
          {progress
            ? `Syncing — ${progress.highlightsSoFar} so far (page ${progress.page})`
            : 'Starting sync…'}
        </Text>
      ) : null}

      <TouchableOpacity style={styles.secondaryButton} onPress={handleDisconnect}>
        <Text style={styles.secondaryButtonText}>Disconnect Readwise</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 20,
    color: '#000000',
  },
  card: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    padding: 16,
    marginBottom: 20,
    alignItems: 'center',
  },
  cardLabel: {
    fontSize: 14,
    color: '#333333',
  },
  cardValue: {
    fontSize: 32,
    fontWeight: '700',
    color: '#000000',
    marginTop: 4,
  },
  button: {
    backgroundColor: '#000000',
    borderRadius: 4,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#a00000',
    fontSize: 14,
  },
  error: {
    color: '#a00000',
    fontSize: 14,
    marginBottom: 12,
  },
  status: {
    marginTop: -4,
    marginBottom: 12,
    fontSize: 14,
    color: '#333333',
    textAlign: 'center',
  },
});
