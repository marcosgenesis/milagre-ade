import React from 'react';
import { ActionSheetIOS, Alert, Modal, SafeAreaView, ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ColorValue, type ScrollViewProps, type TextInputProps } from 'react-native';
import { Color } from 'expo-router';
import { Button as NativeButton, Host, Picker, Switch } from '@expo/ui';
import { Picker as IOSPicker, Text as IOSText } from '@expo/ui/swift-ui';
import { accessibilityLabel, disabled as nativeDisabled, pickerStyle, tag, controlSize } from '@expo/ui/swift-ui/modifiers';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import * as Haptics from 'expo-haptics';

const semantic = (ios: ColorValue, android: ColorValue, fallback: string) => Platform.select({ ios, android, default: fallback })!;
export const colors = {
  bg: semantic(Color.ios.systemGroupedBackground, Color.android.dynamic.surface, '#f2f2f7'),
  panel: semantic(Color.ios.secondarySystemGroupedBackground, Color.android.dynamic.surfaceContainer, '#ffffff'),
  field: semantic(Color.ios.tertiarySystemFill, Color.android.dynamic.surfaceContainerHighest, '#e9e9ef'),
  line: semantic(Color.ios.separator, Color.android.dynamic.outlineVariant, '#d1d1d6'),
  text: semantic(Color.ios.label, Color.android.dynamic.onSurface, '#17171c'),
  muted: semantic(Color.ios.secondaryLabel, Color.android.dynamic.onSurfaceVariant, '#666670'),
  accent: semantic(Color.ios.systemPurple, Color.android.dynamic.primary, '#8944ab'),
  error: semantic(Color.ios.systemRed, Color.android.dynamic.error, '#c62c31'),
  green: semantic(Color.ios.systemGreen, Color.android.dynamic.tertiary, '#248a3d'),
};
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, gap: 20, paddingBottom: 36 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  card: { backgroundColor: colors.panel, padding: 16, borderRadius: 20, borderCurve: 'continuous', gap: 12 },
  title: { color: colors.text, fontSize: 34, fontWeight: '700', letterSpacing: -0.6 },
  subtitle: { color: colors.text, fontSize: 20, fontWeight: '600' },
  text: { color: colors.text, fontSize: 17, lineHeight: 25 },
  muted: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  label: { color: colors.muted, fontSize: 13, fontWeight: '500' },
  input: { backgroundColor: colors.field, color: colors.text, fontSize: 17, borderRadius: 12, borderCurve: 'continuous', paddingHorizontal: 14, paddingVertical: 12, minHeight: 44 },
  error: { backgroundColor: colors.panel, borderRadius: 16, borderCurve: 'continuous', padding: 16, gap: 12, borderLeftWidth: 3, borderColor: colors.error },
  code: { color: colors.text, fontSize: 13, lineHeight: 20, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});

// Native scrolling and choice controls have one shared entry point.
export const PageScroll = React.forwardRef<ScrollView, ScrollViewProps>(function PageScroll({ children, contentContainerStyle, ...props }, ref) {
  return <ScrollView ref={ref} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} contentContainerStyle={[styles.content, contentContainerStyle]} {...props}>{children}</ScrollView>;
});
export function Icon({ name, color = colors.muted, size = 18 }: { name: SymbolViewProps['name']; color?: ColorValue; size?: number }) {
  return <SymbolView name={name} tintColor={color} size={size} style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no" />;
}
export function Button({ title, onPress, disabled = false, secondary = false, loading = false, destructive = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; loading?: boolean; destructive?: boolean }) {
  return <View style={{ minHeight: 44, justifyContent: 'center', alignItems: 'center' }}><Host ignoreSafeArea="all" matchContents seedColor={destructive ? colors.error : colors.accent}>
    <NativeButton label={title} variant={secondary ? 'outlined' : 'filled'} disabled={disabled || loading} onPress={() => { if (Platform.OS === 'ios') void Haptics.selectionAsync().catch(() => {}); onPress(); }} modifiers={Platform.OS === 'ios' ? [controlSize('large')] : undefined} style={{ height: 48 }} />
  </Host>{loading && <ActivityIndicator accessibilityLabel={title} style={{ position: 'absolute', right: 12 }} color={colors.accent} />}</View>;
}
export function Toggle({ title, selected, onPress, disabled = false }: { title: string; selected: boolean; onPress: () => void; disabled?: boolean }) {
  return <Host ignoreSafeArea="all" matchContents={{ vertical: true }} style={{ minHeight: 44 }} seedColor={colors.accent}><Switch label={title} value={selected} disabled={disabled} onValueChange={onPress} /></Host>;
}
export function Choice({ title, selected, onPress }: { title: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={onPress} style={({ pressed }) => ({ paddingVertical: 12, paddingHorizontal: 14, minHeight: 44, backgroundColor: colors.field, borderRadius: 12, borderCurve: 'continuous', flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.6 : 1 })}><Text style={[styles.text, { flex: 1 }]}>{title}</Text><Icon name={{ ios: selected ? 'checkmark.circle.fill' : 'circle', android: selected ? 'check_circle' : 'radio_button_unchecked' }} color={selected ? colors.accent : colors.muted} size={22} /></Pressable>;
}
export function Field({ label, hideLabel = false, ...props }: TextInputProps & { label: string; hideLabel?: boolean }) {
  return <View style={{ gap: 8 }}>{!hideLabel && <Text style={styles.label}>{label}</Text>}<TextInput accessibilityLabel={label} autoCapitalize="none" autoCorrect={false} placeholderTextColor={colors.muted} selectionColor={colors.accent} {...props} style={[styles.input, props.style]} /></View>;
}
export function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  return <View accessibilityRole="alert" style={styles.error}><Text selectable style={{ color: colors.error, fontSize: 15, lineHeight: 22 }}>{message}</Text>{retry && <Button title="Reconnect" secondary onPress={retry} />}</View>;
}
export function Select({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: { value: string; title: string; description?: string }[]; onChange: (value: string) => void; disabled?: boolean }) {
  const selected = options.find(option => option.value === value);
  const items = selected ? options : [{ value, title: 'Choose' }, ...options];
  return <View style={{ gap: 4 }}><View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={styles.text}>{label}</Text><Host ignoreSafeArea="all" matchContents style={{ minHeight: 44, maxWidth: '100%', justifyContent: 'center' }} seedColor={colors.accent}>
    {Platform.OS === 'ios' ? <IOSPicker label={label} selection={value} onSelectionChange={onChange} modifiers={[pickerStyle('menu'), nativeDisabled(disabled), accessibilityLabel(label)]} testID={`select-${label}`}>
      {items.map(option => <IOSText key={option.value} modifiers={[tag(option.value)]}>{option.title}</IOSText>)}
    </IOSPicker> : <Picker selectedValue={value} onValueChange={onChange} enabled={!disabled} testID={`select-${label}`}>
      {items.map(option => <Picker.Item key={option.value} value={option.value} label={`${label}: ${option.title}`} />)}
    </Picker>}
  </Host></View>{options.some(option => option.description) && (label === 'Permissions' ? options : selected ? [selected] : []).map(option => option.description ? <Text key={option.value} style={styles.muted}>{option.title}: {option.description}</Text> : null)}</View>;
}
export function ListRow({ title, subtitle, onPress, disabled = false }: { title: string; subtitle?: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, minHeight: 52, opacity: disabled ? 0.4 : pressed ? 0.5 : 1 })}><View style={{ flex: 1, gap: 4 }}><Text style={styles.text}>{title}</Text>{subtitle && <Text style={styles.muted} numberOfLines={2}>{subtitle}</Text>}</View><Icon name={{ ios: 'chevron.right', android: 'chevron_right' }} size={14} /></Pressable>;
}

export function IconButton({ label, name, onPress, disabled = false, filled = false, loading = false }: { label: string; name: SymbolViewProps['name']; onPress: () => void; disabled?: boolean; filled?: boolean; loading?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy: loading }} disabled={disabled || loading} onPress={() => { if (Platform.OS === 'ios') void Haptics.selectionAsync().catch(() => {}); onPress(); }} style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: filled ? colors.accent : 'transparent', opacity: disabled ? 0.35 : pressed ? 0.5 : 1 })}>{loading ? <ActivityIndicator color={colors.muted} /> : <Icon name={name} size={24} color={filled ? '#fff' : colors.muted} />}</Pressable>;
}
export function choiceMenu(title: string, choices: { title: string; onPress: () => void }[]) {
  if (Platform.OS === 'ios') ActionSheetIOS.showActionSheetWithOptions({ title, options: [...choices.map(choice => choice.title), 'Cancel'], cancelButtonIndex: choices.length }, index => choices[index]?.onPress());
  else Alert.alert(title, undefined, [...choices.map(choice => ({ text: choice.title, onPress: choice.onPress })), { text: 'Cancel', style: 'cancel' }]);
}
export function Sheet({ title, visible, close, children }: { title: string; visible: boolean; close: () => void; children: React.ReactNode }) {
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}><SafeAreaView style={styles.screen}><View style={[styles.row, { paddingHorizontal: 20, paddingTop: 12, justifyContent: 'space-between' }]}><Text accessibilityRole="header" style={styles.subtitle}>{title}</Text><Button title="Done" secondary onPress={close} /></View><PageScroll>{children}</PageScroll></SafeAreaView></Modal>;
}
