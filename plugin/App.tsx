/**
 * Readwise Digest — plugin root view.
 *
 * UI is built from snuxlib (src/snuxlib, vendored from philips/olaink): one PluginScreen, one tab
 * per task, account tab pinned to the bottom, a Logs tab. Status, results and errors go to the log.
 *
 * @format
 */

import React, {useCallback, useEffect, useState} from 'react';
import {PluginManager} from 'sn-plugin-lib';
import {initDatabase, getReadwiseApiToken} from './src/db';
import Setup from './src/screens/Setup';
import SyncExport from './src/screens/SyncExport';
import InsertQuote from './src/screens/InsertQuote';
import Account from './src/screens/Account';
import {
  EmptyText,
  icons,
  LogPane,
  PluginScreen,
  StatusText,
  useLog,
  type TabSpec,
} from './src/snuxlib';

type Route = 'loading' | 'setup' | 'main';
type TabKey = 'insert' | 'syncExport' | 'account' | 'logs' | 'connect';

const TITLES: Record<TabKey, string> = {
  insert: 'Insert a Quote',
  syncExport: 'Sync and Export',
  account: 'Readwise',
  logs: 'Logs',
  connect: 'Connect Readwise',
};

function App(): React.JSX.Element {
  const [route, setRoute] = useState<Route>('loading');
  const [initError, setInitError] = useState<string | null>(null);
  // Defaults to "Insert a Quote" -- that's the action most likely to be why someone opened the
  // plugin from inside a note, so it shouldn't be a tap away behind a sync/settings screen.
  const [tab, setTab] = useState<TabKey>('insert');
  // prefix: also console.logs `[readwise-digest] ...`, so a build can be identified via adb logcat.
  const {entries, log, clear} = useLog({initial: 'Started.', prefix: 'readwise-digest'});

  const bootstrap = useCallback(async () => {
    try {
      await initDatabase();
      const token = await getReadwiseApiToken();
      setRoute(token ? 'main' : 'setup');
      if (!token) {
        setTab('connect');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initialize plugin storage.';
      setInitError(message);
      log(`Startup failed: ${message}`);
    }
  }, [log]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const signedIn = route === 'main';
  const tabs: TabSpec[] = [
    ...(signedIn
      ? [
          {key: 'insert', label: 'Insert a Quote', icon: icons.inbox, onPress: () => setTab('insert')},
          {key: 'syncExport', label: 'Sync and Export', icon: icons.send, onPress: () => setTab('syncExport')},
        ]
      : [{key: 'connect', label: 'Connect', icon: icons.pair, onPress: () => setTab('connect')}]),
    {key: 'logs', label: 'Logs', icon: icons.logs, onPress: () => setTab('logs')},
    ...(signedIn
      ? [{key: 'account', label: 'Readwise', icon: icons.user, onPress: () => setTab('account'), bottom: true}]
      : []),
  ];

  const signOut = () => {
    setRoute('setup');
    setTab('connect');
  };

  const connected = () => {
    setRoute('main');
    setTab('insert');
  };

  let pane: React.JSX.Element | null;
  if (tab === 'logs') {
    pane = <LogPane entries={entries} onClear={clear} diagnostics={['Readwise Digest', `Route ${route}`]} />;
  } else if (initError) {
    pane = <StatusText>{initError}</StatusText>;
  } else if (route === 'loading') {
    pane = <EmptyText>Starting…</EmptyText>;
  } else if (route === 'setup') {
    pane = <Setup onComplete={connected} log={log} />;
  } else if (tab === 'syncExport') {
    pane = <SyncExport log={log} />;
  } else if (tab === 'account') {
    pane = <Account onSignOut={signOut} log={log} />;
  } else {
    pane = <InsertQuote log={log} />;
  }

  return (
    <PluginScreen
      appName="Readwise Digest"
      title={TITLES[tab]}
      onClose={() => PluginManager.closePluginView()}
      tabs={tabs}
      activeKey={tab}>
      {pane}
    </PluginScreen>
  );
}

export default App;
