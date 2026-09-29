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
import {
  exportPendingDigestEntries,
  getPendingDigestExportCount,
  type DigestExportProgress,
  type DigestExportResult,
} from '../lib/digestExport';
import {ensureInternetPermission} from '../lib/permissions';
import {Color, FontSize} from '../theme';

interface Props {
  onSignOut: () => void;
}

function summarizeExport(result: DigestExportResult): string | null {
  if (result.exported === 0) {return null;}
  const parts = [`Exported ${result.exported} ${result.exported === 1 ? 'entry' : 'entries'}`];
  if (result.documents > 0) {
    parts.push(`${result.documents} from books`);
  }
  let text = parts.length > 1 ? `${parts[0]} (${parts.slice(1).join(', ')}).` : `${parts[0]}.`;
  if (result.usedFilename > 0) {
    text +=
      ` ${result.usedFilename} book ${result.usedFilename === 1 ? 'highlight was' : 'highlights were'}` +
      " filed under the file name because the book's title and author couldn't be read.";
  }
  return text;
}

/** Tab content ("Sync and Export") -- highlight cache status plus the two Digest bridges.
 * Quote-insertion lives in its own tab (src/screens/InsertQuote.tsx) now, not here. */
export default function SyncExport({onSignOut}: Props): React.JSX.Element {
  const [count, setCount] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [digestSyncEnabled, setDigestSyncEnabled] = useState(false);
  const [digestPendingCount, setDigestPendingCount] = useState<number | null>(null);
  const [digestSyncing, setDigestSyncing] = useState(false);
  const [digestProgress, setDigestProgress] = useState<DigestSyncProgress | null>(null);
  const [digestError, setDigestError] = useState<string | null>(null);

  const [exportEnabled, setExportEnabled] = useState(false);
  const [exportPendingCount, setExportPendingCount] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<DigestExportProgress | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSummary, setExportSummary] = useState<string | null>(null);

  const refreshCount = useCallback(async () => {
    setCount(await getHighlightCount());
  }, []);

  const refreshDigestPendingCount = useCallback(async () => {
    setDigestPendingCount(await getPendingDigestSyncCount());
  }, []);

  const refreshExportPendingCount = useCallback(async () => {
    setExportPendingCount(await getPendingDigestExportCount());
  }, []);

  useEffect(() => {
    refreshCount();
    refreshDigestPendingCount();
    refreshExportPendingCount();
    getSetting(SettingsKey.DigestSyncEnabled).then(value => setDigestSyncEnabled(value === '1'));
    getSetting(SettingsKey.ReadwiseExportEnabled).then(value => setExportEnabled(value === '1'));
  }, [refreshCount, refreshDigestPendingCount, refreshExportPendingCount]);

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

  const handleExport = async () => {
    setExportError(null);
    setExportSummary(null);
    setExporting(true);
    setExportProgress(null);
    try {
      const result = await exportPendingDigestEntries(setExportProgress);
      setExportSummary(summarizeExport(result));
      await refreshExportPendingCount();
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export to Readwise failed.');
    } finally {
      setExporting(false);
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
      if (exportEnabled) {
        await handleExport();
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

  const handleToggleExport = async (value: boolean) => {
    setExportEnabled(value);
    await setSetting(SettingsKey.ReadwiseExportEnabled, value ? '1' : '0');
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
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Highlights cached</Text>
        <Text style={styles.cardValue}>{count === null ? '…' : count}</Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.primaryButton, syncing && styles.buttonDisabled]}
        onPress={handleSync}
        disabled={syncing}>
        {syncing ? (
          <ActivityIndicator color={Color.background} />
        ) : (
          <Text style={styles.primaryButtonText}>Sync now</Text>
        )}
      </TouchableOpacity>

      {syncing ? (
        <Text style={styles.status}>
          {progress
            ? `Syncing — ${progress.highlightsSoFar} so far (page ${progress.page})`
            : 'Starting sync…'}
        </Text>
      ) : null}

      <View style={styles.section}>
        <View style={styles.toggleRow}>
          <Text style={styles.sectionLabel}>Sync into Digest</Text>
          <Switch value={digestSyncEnabled} onValueChange={handleToggleDigestSync} />
        </View>
        <Text style={styles.subtext}>
          {digestPendingCount === null
            ? ' '
            : digestPendingCount === 0
              ? 'Digest is up to date.'
              : `${digestPendingCount} highlight${digestPendingCount === 1 ? '' : 's'} not yet in Digest.`}
        </Text>

        {digestError ? <Text style={styles.error}>{digestError}</Text> : null}

        <TouchableOpacity
          style={[styles.secondaryButton, digestSyncing && styles.buttonDisabled]}
          onPress={handleDigestSync}
          disabled={digestSyncing}>
          {digestSyncing ? (
            <ActivityIndicator color={Color.text} />
          ) : (
            <Text style={styles.secondaryButtonText}>Sync to Digest now</Text>
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

      <View style={styles.section}>
        <View style={styles.toggleRow}>
          <Text style={styles.sectionLabel}>Export Digest to Readwise</Text>
          <Switch value={exportEnabled} onValueChange={handleToggleExport} />
        </View>
        <Text style={styles.subtext}>
          {exportPendingCount === null
            ? ' '
            : exportPendingCount === 0
              ? 'Nothing new to export.'
              : `${exportPendingCount} Digest ${exportPendingCount === 1 ? 'entry' : 'entries'} not yet on Readwise.`}
        </Text>

        <Text style={styles.subtext}>
          Includes highlights from books. Their title and author are read from the file, which needs
          file access; without it the file name is used.
        </Text>

        {exportError ? <Text style={styles.error}>{exportError}</Text> : null}
        {exportSummary ? <Text style={styles.subtext}>{exportSummary}</Text> : null}

        <TouchableOpacity
          style={[styles.secondaryButton, exporting && styles.buttonDisabled]}
          onPress={handleExport}
          disabled={exporting}>
          {exporting ? (
            <ActivityIndicator color={Color.text} />
          ) : (
            <Text style={styles.secondaryButtonText}>Export to Readwise now</Text>
          )}
        </TouchableOpacity>

        {exporting ? (
          <Text style={styles.status}>
            {exportProgress
              ? `Exporting — ${exportProgress.exported} of ${exportProgress.total}`
              : 'Starting export…'}
          </Text>
        ) : null}
      </View>

      <TouchableOpacity style={styles.disconnectButton} onPress={handleDisconnect}>
        <Text style={styles.disconnectButtonText}>Disconnect Readwise</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: Color.background,
  },
  card: {
    borderWidth: 2,
    borderColor: Color.border,
    padding: 20,
    marginBottom: 20,
    alignItems: 'center',
  },
  cardLabel: {
    fontSize: FontSize.meta,
    color: Color.mutedText,
  },
  cardValue: {
    fontSize: 40,
    fontWeight: '700',
    color: Color.text,
    marginTop: 4,
  },
  primaryButton: {
    backgroundColor: Color.text,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: Color.background,
    fontSize: FontSize.button,
    fontWeight: '700',
  },
  secondaryButton: {
    borderWidth: 2,
    borderColor: Color.border,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  secondaryButtonText: {
    color: Color.text,
    fontSize: FontSize.button,
    fontWeight: '700',
  },
  section: {
    borderTopWidth: 2,
    borderTopColor: Color.mutedBorder,
    marginTop: 12,
    paddingTop: 20,
    marginBottom: 8,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  sectionLabel: {
    fontSize: FontSize.body,
    color: Color.text,
    fontWeight: '700',
  },
  subtext: {
    fontSize: FontSize.meta,
    color: Color.mutedText,
    marginBottom: 14,
  },
  disconnectButton: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  disconnectButtonText: {
    color: Color.error,
    fontSize: FontSize.meta,
  },
  error: {
    color: Color.error,
    fontSize: FontSize.meta,
    marginBottom: 12,
  },
  status: {
    marginTop: -4,
    marginBottom: 12,
    fontSize: FontSize.meta,
    color: Color.mutedText,
    textAlign: 'center',
  },
});
