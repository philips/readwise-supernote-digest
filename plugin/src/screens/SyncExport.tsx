import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
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
import {
  isReadwiseWriteAllowed,
  ReadwiseReadOnlyError,
  setReadwiseWritesEnabled,
} from '../readwise/writeGuard';
import ConfirmPanel from '../components/ConfirmPanel';
import Toggle from '../components/Toggle';
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

  // Read-only mode: nothing is sent to Readwise. Starts true (the safe answer) until the stored
  // setting has been read; the real enforcement is in src/readwise/client.ts, not here.
  const [readOnly, setReadOnly] = useState(true);
  // Which confirmation is showing (in-screen, see ConfirmPanel), if any.
  const [confirming, setConfirming] = useState<'leave-read-only' | 'disconnect' | null>(null);

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
    isReadwiseWriteAllowed().then(allowed => setReadOnly(!allowed));
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
      if (err instanceof ReadwiseReadOnlyError) {
        // Not a failure: read-only mode was on, or was turned on while this export was running.
        setReadOnly(true);
        setExportSummary(err.message);
        await refreshExportPendingCount();
      } else {
        setExportError(err instanceof Error ? err.message : 'Export to Readwise failed.');
      }
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
        // Read the setting now rather than trusting the screen's copy of it.
        if (await isReadwiseWriteAllowed()) {
          await handleExport();
        } else {
          setReadOnly(true);
          setExportSummary('Export skipped: read-only mode is on.');
        }
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

  // After any change, show what is actually stored (not what we assume we just wrote).
  const showStoredReadOnlyState = async () => setReadOnly(!(await isReadwiseWriteAllowed()));

  const handleToggleReadOnly = (nextReadOnly: boolean) => {
    if (nextReadOnly) {
      setConfirming(null);
      setReadwiseWritesEnabled(false).then(showStoredReadOnlyState).catch(showStoredReadOnlyState);
      return;
    }
    // Turning it off lets the plugin write to a real account, so ask first.
    setConfirming('leave-read-only');
  };

  const confirmLeaveReadOnly = async () => {
    setConfirming(null);
    await setReadwiseWritesEnabled(true).catch(() => undefined);
    await showStoredReadOnlyState();
    setExportSummary(null);
  };

  const handleToggleExport = async (value: boolean) => {
    setExportEnabled(value);
    await setSetting(SettingsKey.ReadwiseExportEnabled, value ? '1' : '0');
  };

  const confirmDisconnect = async () => {
    setConfirming(null);
    // A new connection starts read-only again, whatever was allowed before.
    await setReadwiseWritesEnabled(false);
    await deleteSetting(SettingsKey.ReadwiseApiToken);
    onSignOut();
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
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
        <Toggle
          label="Sync into Digest"
          subtext={
            digestPendingCount === null
              ? ' '
              : digestPendingCount === 0
                ? 'Digest is up to date.'
                : `${digestPendingCount} highlight${digestPendingCount === 1 ? '' : 's'} not yet in Digest.`
          }
          value={digestSyncEnabled}
          onChange={handleToggleDigestSync}
        />

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
        <Toggle
          label="Read-only mode"
          subtext={
            readOnly
              ? 'Nothing is ever sent to Readwise. Turn off to allow exporting.'
              : 'Exporting can add highlights to your Readwise account.'
          }
          value={readOnly}
          onChange={handleToggleReadOnly}
        />
        {confirming === 'leave-read-only' ? (
          <ConfirmPanel
            title="Turn off read-only mode?"
            message="Exporting will be able to add highlights to your Readwise account."
            confirmLabel="Turn off"
            onConfirm={confirmLeaveReadOnly}
            onCancel={() => setConfirming(null)}
          />
        ) : null}

        <Toggle
          label="Export Digest to Readwise"
          subtext={
            readOnly
              ? `Locked while read-only mode is on.${exportPendingCount ? ` (${exportPendingCount} waiting.)` : ''}`
              : exportPendingCount === null
                ? ' '
                : exportPendingCount === 0
                  ? 'Nothing new to export.'
                  : `${exportPendingCount} Digest ${exportPendingCount === 1 ? 'entry' : 'entries'} not yet on Readwise.`
          }
          value={exportEnabled}
          onChange={handleToggleExport}
          disabled={readOnly}
        />
        <Text style={styles.subtext}>
          Includes highlights from books. Their title and author are read from the file, which needs
          file access; without it the file name is used.
        </Text>

        {exportError ? <Text style={styles.error}>{exportError}</Text> : null}
        {exportSummary ? <Text style={styles.subtext}>{exportSummary}</Text> : null}

        <TouchableOpacity
          style={[
            styles.secondaryButton,
            exporting && styles.buttonDisabled,
            readOnly && styles.buttonLocked,
          ]}
          onPress={handleExport}
          disabled={exporting || readOnly}>
          {exporting ? (
            <ActivityIndicator color={Color.text} />
          ) : (
            <Text style={[styles.secondaryButtonText, readOnly && styles.lockedLabel]}>
              Export to Readwise now
            </Text>
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

      {confirming === 'disconnect' ? (
        <ConfirmPanel
          title="Disconnect Readwise?"
          message="This clears the saved API token and turns read-only mode back on. Your cached highlights stay on the device."
          confirmLabel="Disconnect"
          destructive
          onConfirm={confirmDisconnect}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
      <TouchableOpacity style={styles.disconnectButton} onPress={() => setConfirming('disconnect')}>
        <Text style={styles.disconnectButtonText}>Disconnect Readwise</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: Color.background,
  },
  container: {
    flexGrow: 1,
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
  subtext: {
    fontSize: FontSize.meta,
    color: Color.mutedText,
    marginBottom: 14,
  },
  // "Not available" on the Nomad's e-ink display: opacity alone is too faint to read as disabled,
  // so a locked control also gets a dashed border and muted text.
  buttonLocked: {
    borderStyle: 'dashed',
    borderColor: Color.mutedBorder,
  },
  lockedLabel: {
    color: Color.mutedText,
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
