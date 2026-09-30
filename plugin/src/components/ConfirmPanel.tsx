import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {Color, FontSize} from '../theme';

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** The confirming action is the risky one (e.g. Disconnect): shown in the error colour. */
  destructive?: boolean;
}

/**
 * Confirmation shown inside the screen instead of the platform Alert. The native dialog renders
 * tiny on the Nomad (about 25 px tall text buttons in low-contrast teal); this uses the same large,
 * bordered, black-and-white buttons as the rest of the plugin.
 */
export default function ConfirmPanel({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  destructive,
}: Props): React.JSX.Element {
  return (
    <View style={styles.panel} accessibilityRole="alert">
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      <View style={styles.buttons}>
        <TouchableOpacity style={[styles.button, styles.cancel]} onPress={onCancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, destructive ? styles.confirmDestructive : styles.confirm]}
          onPress={onConfirm}>
          <Text style={styles.confirmText}>{confirmLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderWidth: 4,
    borderColor: Color.border,
    padding: 20,
    marginBottom: 14,
    backgroundColor: Color.background,
  },
  title: {
    fontSize: FontSize.body,
    fontWeight: '700',
    color: Color.text,
  },
  message: {
    fontSize: FontSize.meta,
    color: Color.text,
    marginTop: 6,
    marginBottom: 16,
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  button: {
    flex: 1,
    minHeight: 84,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  cancel: {
    marginRight: 12,
    borderColor: Color.border,
    backgroundColor: Color.background,
  },
  confirm: {
    marginLeft: 12,
    borderColor: Color.text,
    backgroundColor: Color.text,
  },
  confirmDestructive: {
    marginLeft: 12,
    borderColor: Color.error,
    backgroundColor: Color.error,
  },
  cancelText: {
    fontSize: FontSize.button,
    fontWeight: '700',
    color: Color.text,
  },
  confirmText: {
    fontSize: FontSize.button,
    fontWeight: '700',
    color: Color.background,
  },
});
