import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewProps, type TextInputProps } from 'react-native';

export const colors = { bg: '#111015', panel: '#1c1b22', line: '#34313d', text: '#f4f0e9', muted: '#aaa5b5', accent: '#d9b6ff', error: '#ffb6b6', green: '#b3ddbc' };
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 22, gap: 18, paddingBottom: 36 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  card: { backgroundColor: colors.panel, padding: 18, borderRadius: 18, gap: 12, borderWidth: 1, borderColor: colors.line },
  title: { color: colors.text, fontSize: 30, fontWeight: '600', letterSpacing: -0.8 },
  subtitle: { color: colors.text, fontSize: 19, fontWeight: '600' },
  text: { color: colors.text, fontSize: 16, lineHeight: 24 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  label: { color: colors.muted, fontSize: 12, letterSpacing: 1.2, fontWeight: '600' },
  input: { backgroundColor: colors.bg, color: colors.text, fontSize: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 13, minHeight: 48 },
  error: { backgroundColor: '#351e27', borderRadius: 12, padding: 14, gap: 12 },
  code: { color: colors.text, fontSize: 13, lineHeight: 19, fontFamily: 'Menlo' },
});

// All native scrolling and choices go through these shared controls.
export const PageScroll = React.forwardRef<ScrollView, ScrollViewProps>(function PageScroll({ children, contentContainerStyle, ...props }, ref) {
  return <ScrollView ref={ref} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, contentContainerStyle]} {...props}>{children}</ScrollView>;
});
export function Button({ title, onPress, disabled = false, secondary = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => ({ backgroundColor: secondary ? colors.panel : colors.accent, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13, minHeight: 48, opacity: disabled ? 0.4 : pressed ? 0.7 : 1, borderWidth: 1, borderColor: secondary ? colors.line : colors.accent })}>
    <Text style={{ color: secondary ? colors.text : colors.bg, fontSize: 15, fontWeight: '600', textAlign: 'center' }}>{title}</Text>
  </Pressable>;
}
export function Choice({ title, selected, onPress }: { title: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={onPress} style={{ borderRadius: 12, borderWidth: 1, borderColor: selected ? colors.accent : colors.line, padding: 14, minHeight: 48, backgroundColor: selected ? '#342b42' : colors.bg }}><Text style={styles.text}>{title}</Text></Pressable>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return <View style={{ gap: 8 }}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} autoCapitalize="none" autoCorrect={false} placeholderTextColor={colors.muted} {...props} style={[styles.input, props.style]} /></View>;
}
export function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  return <View accessibilityRole="alert" style={styles.error}><Text selectable style={{ color: colors.error, fontSize: 14, lineHeight: 21 }}>{message}</Text>{retry && <Button title="Reconnect" secondary onPress={retry} />}</View>;
}
