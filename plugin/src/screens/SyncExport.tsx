import React, {useCallback, useEffect, useState} from 'react';
import {getHighlightCount, getReadwiseApiToken, getSetting, setSetting} from '../db';
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
import {
  BodyText,
  ConfirmPanel,
  ListRow,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
  StatusText,
  Toggle,
} from '../snuxlib';

interface Props {
  log: (text: string) => void;
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
 * Quote-insertion lives in its own tab (src/screens/InsertQuote.tsx), Disconnect in Account.tsx.
 * Results and errors are written to the log (Logs tab); progress and the latest result of an
 * action are also shown inline next to its button. */
export default function SyncExport({log}: Props): React.JSX.Element {
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
  // Whether the "leave read-only mode" confirmation (in-screen, see ConfirmPanel) is showing.
  const [confirmingLeaveReadOnly, setConfirmingLeaveReadOnly] = useState(false);

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
    if (digestSyncing) {return;}
    setDigestError(null);
    setDigestSyncing(true);
    setDigestProgress(null);
    log('Digest sync: starting…');
    try {
      await syncPendingHighlightsToDigest(setDigestProgress);
      await refreshDigestPendingCount();
      log('Digest sync: done.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Digest sync failed.';
      setDigestError(message);
      log(`Digest sync failed: ${message}`);
    } finally {
      setDigestSyncing(false);
    }
  };

  const handleExport = async () => {
    if (exporting) {return;}
    setExportError(null);
    setExportSummary(null);
    setExporting(true);
    setExportProgress(null);
    log('Export to Readwise: starting…');
    try {
      const result = await exportPendingDigestEntries(setExportProgress);
      const summary = summarizeExport(result);
      setExportSummary(summary);
      log(summary ?? 'Export to Readwise: nothing new to export.');
      await refreshExportPendingCount();
    } catch (err) {
      if (err instanceof ReadwiseReadOnlyError) {
        // Not a failure: read-only mode was on, or was turned on while this export was running.
        setReadOnly(true);
        setExportSummary(err.message);
        log(err.message);
        await refreshExportPendingCount();
      } else {
        const message = err instanceof Error ? err.message : 'Export to Readwise failed.';
        setExportError(message);
        log(`Export to Readwise failed: ${message}`);
      }
    } finally {
      setExporting(false);
    }
  };

  const handleSync = async () => {
    if (syncing) {return;}
    setError(null);
    setSyncing(true);
    setProgress(null);
    log('Sync: starting…');
    try {
      const token = await getReadwiseApiToken();
      if (!token) {
        const message = 'No Readwise token saved — please reconnect.';
        setError(message);
        log(message);
        return;
      }
      const granted = await ensureInternetPermission();
      if (!granted) {
        const message = 'Network access is required to sync.';
        setError(message);
        log(message);
        return;
      }
      await syncHighlights(token, setProgress);
      await refreshCount();
      log('Sync: highlights up to date.');

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
          log('Export skipped: read-only mode is on.');
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed.';
      setError(message);
      log(`Sync failed: ${message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleToggleDigestSync = async (value: boolean) => {
    setDigestSyncEnabled(value);
    await setSetting(SettingsKey.DigestSyncEnabled, value ? '1' : '0');
    log(`Sync into Digest ${value ? 'on' : 'off'}.`);
  };

  // After any change, show what is actually stored (not what we assume we just wrote).
  const showStoredReadOnlyState = async () => {
    const allowed = await isReadwiseWriteAllowed();
    setReadOnly(!allowed);
    log(`Readwise read-only mode ${allowed ? 'off' : 'on'}.`);
  };

  const handleToggleReadOnly = (nextReadOnly: boolean) => {
    if (nextReadOnly) {
      setConfirmingLeaveReadOnly(false);
      setReadwiseWritesEnabled(false).then(showStoredReadOnlyState).catch(showStoredReadOnlyState);
      return;
    }
    // Turning it off lets the plugin write to a real account, so ask first.
    setConfirmingLeaveReadOnly(true);
  };

  const confirmLeaveReadOnly = async () => {
    setConfirmingLeaveReadOnly(false);
    await setReadwiseWritesEnabled(true).catch(() => undefined);
    await showStoredReadOnlyState();
    setExportSummary(null);
  };

  const handleToggleExport = async (value: boolean) => {
    setExportEnabled(value);
    await setSetting(SettingsKey.ReadwiseExportEnabled, value ? '1' : '0');
    log(`Export Digest to Readwise ${value ? 'on' : 'off'}.`);
  };

  const digestSubtext = !digestSyncEnabled
    ? `Turn on to sync highlights into Digest.${digestPendingCount ? ` (${digestPendingCount} waiting.)` : ''}`
    : digestPendingCount === null
      ? ' '
      : digestPendingCount === 0
        ? 'Digest is up to date.'
        : `${digestPendingCount} highlight${digestPendingCount === 1 ? '' : 's'} not yet in Digest.`;

  const exportSubtext = readOnly
    ? `Locked while read-only mode is on.${exportPendingCount ? ` (${exportPendingCount} waiting.)` : ''}`
    : exportPendingCount === null
      ? ' '
      : exportPendingCount === 0
        ? 'Nothing new to export.'
        : `${exportPendingCount} Digest ${exportPendingCount === 1 ? 'entry' : 'entries'} not yet on Readwise.`;

  return (
    <>
      <SectionLabel>Highlights</SectionLabel>
      <ListRow title="Highlights cached" detail={count === null ? '…' : String(count)} solid />
      <PrimaryButton label={syncing ? 'Syncing…' : 'Sync now'} onPress={handleSync} />
      {error ? <StatusText>{error}</StatusText> : null}
      {syncing ? (
        <StatusText>
          {progress
            ? `Syncing — ${progress.highlightsSoFar} so far (page ${progress.page})`
            : 'Starting sync…'}
        </StatusText>
      ) : null}

      <SectionLabel>Digest</SectionLabel>
      <Toggle
        label="Sync into Digest"
        subtext={digestSubtext}
        value={digestSyncEnabled}
        onChange={handleToggleDigestSync}
      />
      {digestSyncEnabled ? (
        <SecondaryButton
          label={digestSyncing ? 'Syncing to Digest…' : 'Sync to Digest now'}
          onPress={handleDigestSync}
        />
      ) : null}
      {digestError ? <StatusText>{digestError}</StatusText> : null}
      {digestSyncing ? (
        <StatusText>
          {digestProgress
            ? `Syncing to Digest — ${digestProgress.synced} of ${digestProgress.total}`
            : 'Starting Digest sync…'}
        </StatusText>
      ) : null}

      <SectionLabel>Readwise</SectionLabel>
      <Toggle
        label="Readwise Read-only mode"
        subtext={
          readOnly
            ? 'Nothing is ever sent to Readwise. Turn off to allow exporting.'
            : 'Exporting can add highlights to your Readwise account.'
        }
        value={readOnly}
        onChange={handleToggleReadOnly}
      />
      {confirmingLeaveReadOnly ? (
        <ConfirmPanel
          title="Turn off Readwise read-only mode?"
          message="Exporting will be able to add highlights to your Readwise account."
          confirmLabel="Turn off"
          onConfirm={confirmLeaveReadOnly}
          onCancel={() => setConfirmingLeaveReadOnly(false)}
        />
      ) : null}

      <Toggle
        label="Export Digest to Readwise"
        subtext={exportSubtext}
        value={exportEnabled}
        onChange={handleToggleExport}
        disabled={readOnly}
      />
      <BodyText>
        Includes highlights from books. Their title and author are read from the file, which needs
        file access; without it the file name is used.
      </BodyText>
      {!readOnly ? (
        <SecondaryButton
          label={exporting ? 'Exporting…' : 'Export to Readwise now'}
          onPress={handleExport}
        />
      ) : null}
      {exportError ? <StatusText>{exportError}</StatusText> : null}
      {exportSummary ? <StatusText>{exportSummary}</StatusText> : null}
      {exporting ? (
        <StatusText>
          {exportProgress
            ? `Exporting — ${exportProgress.exported} of ${exportProgress.total}`
            : 'Starting export…'}
        </StatusText>
      ) : null}
    </>
  );
}
