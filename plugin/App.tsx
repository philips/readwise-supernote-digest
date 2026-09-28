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
import Home from './src/screens/Home';
import InsertQuote from './src/screens/InsertQuote';

type Route = 'loading' | 'setup' | 'home' | 'insert';

function App(): React.JSX.Element {
  const [route, setRoute] = useState<Route>('loading');
  const [initError, setInitError] = useState<string | null>(null);

  const bootstrap = useCallback(async () => {
    try {
      await initDatabase();
      const token = await getReadwiseApiToken();
      setRoute(token ? 'home' : 'setup');
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
    body = <Setup onComplete={() => setRoute('home')} />;
  } else if (route === 'insert') {
    body = <InsertQuote onBack={() => setRoute('home')} />;
  } else {
    body = <Home onSignOut={() => setRoute('setup')} onInsertQuote={() => setRoute('insert')} />;
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
    backgroundColor: '#ffffff',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
    color: '#000000',
  },
  errorText: {
    color: '#a00000',
    fontSize: 15,
    padding: 24,
    textAlign: 'center',
  },
});

export default App;
