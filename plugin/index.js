/**
 * @format
 */

import {AppRegistry, Image} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

import {PluginManager} from 'sn-plugin-lib';

AppRegistry.registerComponent(appName, () => App);

// Must run after registerComponent -- everything else silently fails otherwise.
PluginManager.init();

// Toolbar button (NOTE + DOC): opens the setup flow / main plugin view.
// Lasso button for "insert quote into note" (Task 2) will be added alongside that feature.
PluginManager.registerButton(1, ['NOTE', 'DOC'], {
  id: 100,
  name: 'Readwise Digest',
  icon: Image.resolveAssetSource(require('./assets/icon.png')).uri,
  showType: 1,
});
