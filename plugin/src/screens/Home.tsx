import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {getHighlightCount, getReadwiseApiToken, deleteSetting, getSetting, setSetting} from '../db';
import {SettingsKey} from '../db/schema';
import {syncHighlights, type SyncProgress} from '../readwise/sync';
import {
  syncPendingHighlightsToDigest,
  getPendingDigestSyncCount,
  type DigestSyncProgress,
} from '../lib/digestSync';
import {ensureInternetPermission} from '../lib/permissions';

interface Props {
  onSignOut: () => void;
  onInsertQuote: () => void;
}

export default function Home({onSignOut, onInsertQuote}: Props): React.JSX.Element {
  const [count, setCount] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [digestSyncEnabled, setDigestSyncEnabled] = useState(false);
  const [digestPendingCount, setDigestPendingCount] = useState<number | null>(null);
  const [digestSyncing, setDigestSyncing] = useState(false);
  const [digestProgress, setDigestProgress] = useState<DigestSyncProgress | null>(null);
  const [digestError, setDigestError] = useState<string | null>(null);

  const refreshCount = useCallback(async () => {
    setCount(await getHighlightCount());
  }, []);

  const refreshDigestPendingCount = useCallback(async () => {
    setDigestPendingCount(await getPendingDigestSyncCount());
  }, []);

  useEffect(() => {
    refreshCount();
    refreshDigestPendingCount();
    getSetting(SettingsKey.DigestSyncEnabled).then(value => setDigestSyncEnabled(value === '1'));
  }, [refreshCount, refreshDigestPendingCount]);

  const handleDigestSync = async () => {
    setDigestError(null);
    setDigestSyncing(true);
    setDigestProgress(null);
    try {
      await syncPendingHighlightsToDigest(setDigestProgress);
      await refreshDigestPendingCount();
    } catch (err) {
      setDigestError(err instanceof Error ? err.message : 'Digest sync failed.');
    } finally {
      setDigestSyncing(false);
    }
  };

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

      if (digestSyncEnabled) {
        await handleDigestSync();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const handleToggleDigestSync = async (value: boolean) => {
    setDigestSyncEnabled(value);
    await setSetting(SettingsKey.DigestSyncEnabled, value ? '1' : '0');
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

      <TouchableOpacity style={styles.button} onPress={onInsertQuote}>
        <Text style={styles.buttonText}>Insert quote into note</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.secondaryActionButton, syncing && styles.buttonDisabled]}
        onPress={handleSync}
        disabled={syncing}>
        {syncing ? (
          <ActivityIndicator color="#000000" />
        ) : (
          <Text style={styles.secondaryActionButtonText}>Sync now</Text>
        )}
      </TouchableOpacity>

      {syncing ? (
        <Text style={styles.status}>
          {progress
            ? `Syncing — ${progress.highlightsSoFar} so far (page ${progress.page})`
            : 'Starting sync…'}
        </Text>
      ) : null}

      <View style={styles.digestSection}>
        <View style={styles.digestToggleRow}>
          <Text style={styles.digestToggleLabel}>Sync into Digest</Text>
          <Switch value={digestSyncEnabled} onValueChange={handleToggleDigestSync} />
        </View>
        <Text style={styles.digestSubtext}>
          {digestPendingCount === null
            ? ' '
            : digestPendingCount === 0
              ? 'Digest is up to date.'
              : `${digestPendingCount} highlight${digestPendingCount === 1 ? '' : 's'} not yet in Digest.`}
        </Text>

        {digestError ? <Text style={styles.error}>{digestError}</Text> : null}

        <TouchableOpacity
          style={[styles.secondaryActionButton, digestSyncing && styles.buttonDisabled]}
          onPress={handleDigestSync}
          disabled={digestSyncing}>
          {digestSyncing ? (
            <ActivityIndicator color="#000000" />
          ) : (
            <Text style={styles.secondaryActionButtonText}>Sync to Digest now</Text>
          )}
        </TouchableOpacity>

        {digestSyncing ? (
          <Text style={styles.status}>
            {digestProgress
              ? `Syncing to Digest — ${digestProgress.synced} of ${digestProgress.total}`
              : 'Starting Digest sync…'}
          </Text>
        ) : null}
      </View>

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
  secondaryActionButton: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  secondaryActionButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '600',
  },
  digestSection: {
    borderTopWidth: 1,
    borderTopColor: '#dddddd',
    marginTop: 8,
    paddingTop: 16,
    marginBottom: 8,
  },
  digestToggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  digestToggleLabel: {
    fontSize: 15,
    color: '#000000',
    fontWeight: '600',
  },
  digestSubtext: {
    fontSize: 13,
    color: '#555555',
    marginBottom: 12,
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
