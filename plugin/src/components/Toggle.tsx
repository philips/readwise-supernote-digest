import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {Color, FontSize} from '../theme';

interface Props {
  label: string;
  /** Explanation under the label; also where a locked toggle says why. */
  subtext?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  /** Locked: visibly "not available" and does not react to taps. */
  disabled?: boolean;
}

/**
 * On/off control for an e-ink screen. The platform Switch is about 30x36 px on the Nomad's 1920 px
 * wide display -- hard to see and hard to hit -- so this is a large bordered row: the whole row is
 * the touch target, and the state is a big ON/OFF pill (black when on) instead of a knob position.
 * Same idea as the big bordered buttons in philips/olaink, which does not use Switch either.
 */
export default function Toggle({label, subtext, value, onChange, disabled}: Props): React.JSX.Element {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{checked: value, disabled: !!disabled}}
      style={[styles.row, disabled && styles.rowLocked]}>
      <View style={styles.text}>
        <Text style={[styles.label, disabled && styles.lockedText]}>{label}</Text>
        {subtext ? <Text style={styles.subtext}>{subtext}</Text> : null}
      </View>
      <View style={[styles.pill, value ? styles.pillOn : styles.pillOff, disabled && styles.pillLocked]}>
        <Text style={[styles.pillText, value ? styles.pillTextOn : styles.pillTextOff, disabled && styles.lockedText]}>
          {value ? 'ON' : 'OFF'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 2,
    borderColor: Color.border,
    paddingVertical: 18,
    paddingHorizontal: 20,
    minHeight: 104,
    marginBottom: 14,
  },
  rowLocked: {
    borderStyle: 'dashed',
    borderColor: Color.mutedBorder,
  },
  text: {
    flex: 1,
    paddingRight: 20,
  },
  label: {
    fontSize: FontSize.body,
    fontWeight: '700',
    color: Color.text,
  },
  subtext: {
    fontSize: FontSize.meta,
    color: Color.mutedText,
    marginTop: 4,
  },
  lockedText: {
    color: Color.mutedText,
  },
  pill: {
    minWidth: 120,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  pillOn: {
    backgroundColor: Color.text,
    borderColor: Color.text,
  },
  pillOff: {
    backgroundColor: Color.background,
    borderColor: Color.border,
  },
  pillLocked: {
    borderStyle: 'dashed',
    borderColor: Color.mutedBorder,
    backgroundColor: Color.background,
  },
  pillText: {
    fontSize: FontSize.button,
    fontWeight: '700',
  },
  pillTextOn: {
    color: Color.background,
  },
  pillTextOff: {
    color: Color.text,
  },
});
