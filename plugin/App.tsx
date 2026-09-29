/**
 * Readwise Digest — plugin root view.
 *
 * @format
 */

import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import {initDatabase, getReadwiseApiToken} from './src/db';
import Setup from './src/screens/Setup';
import SyncExport from './src/screens/SyncExport';
import InsertQuote from './src/screens/InsertQuote';
import Tab from './src/components/Tab';
import {Color} from './src/theme';

type Route = 'loading' | 'setup' | 'main';
type MainTab = 'insert' | 'syncExport';

function App(): React.JSX.Element {
  const [route, setRoute] = useState<Route>('loading');
  const [initError, setInitError] = useState<string | null>(null);
  // Defaults to "Insert a Quote" -- that's the action most likely to be why someone opened the
  // plugin from inside a note, so it shouldn't be a tap away behind a sync/settings screen.
  const [tab, setTab] = useState<MainTab>('insert');

  const bootstrap = useCallback(async () => {
    try {
      await initDatabase();
      const token = await getReadwiseApiToken();
      setRoute(token ? 'main' : 'setup');
    } catch (err) {
      setInitError(err instanceof Error ? err.message : 'Failed to initialize plugin storage.');
    }
  }, []);

  useEffect(() => {
    // Ungated startup log -- __DEV__-gated logs are stripped from real builds
    // (buildPlugin.sh always bundles with --dev false), so keep at least one
    // plain console.log to confirm which build is actually running via adb logcat.

    console.log('[readwise-digest] starting');
    bootstrap();
  }, [bootstrap]);

  const handleClose = () => {
    PluginManager.closePluginView();
  };

  let body: React.JSX.Element;
  if (initError) {
    body = (
      <View style={styles.center}>
        <Text style={styles.errorText}>{initError}</Text>
      </View>
    );
  } else if (route === 'loading') {
    body = (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  } else if (route === 'setup') {
    body = <Setup onComplete={() => setRoute('main')} />;
  } else {
    body = (
      <View style={styles.mainContainer}>
        <View style={styles.tabBar}>
          <Tab label="Insert a Quote" active={tab === 'insert'} onPress={() => setTab('insert')} />
          <Tab
            label="Sync and Export"
            active={tab === 'syncExport'}
            onPress={() => setTab('syncExport')}
          />
        </View>
        <View style={styles.tabContent}>
          {tab === 'insert' ? (
            <InsertQuote />
          ) : (
            <SyncExport onSignOut={() => setRoute('setup')} />
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Pressable style={styles.closeButton} onPress={handleClose}>
        <Text style={styles.closeText}>✕</Text>
      </Pressable>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Color.background,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mainContainer: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingTop: 24,
    paddingHorizontal: 24,
    borderBottomColor: Color.border,
    borderBottomWidth: 2,
  },
  tabContent: {
    flex: 1,
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    zIndex: 10,
  },
  closeText: {
    fontSize: 18,
    color: Color.text,
  },
  errorText: {
    color: Color.error,
    fontSize: 15,
    padding: 24,
    textAlign: 'center',
  },
});

export default App;
