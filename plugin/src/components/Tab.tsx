import React from 'react';
import {Pressable, StyleSheet, Text} from 'react-native';
import {Color, FontSize} from '../theme';

interface TabProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

/** Bordered-box tab button, same structure/style as philips/olaink's `Tab` component (see
 * src/theme.ts doc comment) -- active tab is a solid black fill with white label, inactive tabs
 * are just an outline, all sitting on a shared bottom border (`TabBar` below supplies that). */
export default function Tab({label, active, onPress}: TabProps): React.JSX.Element {
  return (
    <Pressable style={[styles.tab, active && styles.tabActive]} onPress={onPress}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tab: {
    borderWidth: 2,
    borderBottomWidth: 0,
    borderColor: Color.border,
    marginRight: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  tabActive: {
    backgroundColor: Color.text,
  },
  tabText: {
    color: Color.text,
    fontSize: FontSize.tab,
    fontWeight: '700',
  },
  tabTextActive: {
    color: Color.background,
  },
});
