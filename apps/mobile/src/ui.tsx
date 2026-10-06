import React from 'react';
import { ActivityIndicator, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewProps, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { Button as NativeButton, Host, Picker, Switch } from '@expo/ui';
import { Button as IOSButton, HStack as IOSHStack, Host as IOSHost, Image as IOSImage, Menu as IOSMenu, Picker as IOSPicker, Rectangle, Section as IOSSection, Text as IOSText, Toggle as IOSToggle } from '@expo/ui/swift-ui';
import { accessibilityLabel, buttonBorderShape, buttonStyle, contentShape, disabled as nativeDisabled, font, foregroundStyle, frame, labelStyle, lineLimit, menuOrder, padding, tint, pickerStyle, shapes, tag, controlSize } from '@expo/ui/swift-ui/modifiers';
import { MenuView, type MenuAction } from '@expo/ui/community/menu';
import * as Haptics from 'expo-haptics';
import { ArrowRight01Icon, CheckmarkCircle02Icon, CircleIcon } from '@hugeicons/core-free-icons';
import { colors as palette, fonts } from './theme';
import { confirmSheet } from './confirm-store';
import { Icon, type IconData, type Tone } from './icons';

export const colors = { ...palette, bg: palette.page, panel: palette.surface, text: palette.ink, muted: palette.ink2, error: palette.red };
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { padding: 20, gap: 20, paddingBottom: 36 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  card: { backgroundColor: colors.surface, padding: 16, borderRadius: 20, borderCurve: 'continuous', gap: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  title: { color: colors.ink, fontSize: 34, fontWeight: '700', letterSpacing: -0.6 },
  subtitle: { color: colors.ink, fontSize: 20, fontWeight: '600' },
  text: { color: colors.ink, fontSize: 16, lineHeight: 23 },
  muted: { color: colors.ink2, fontSize: 15, lineHeight: 21 },
  label: { color: colors.ink2, fontSize: 13, fontWeight: '500' },
  caption: { color: colors.ink3, fontSize: 12 },
  section: { color: colors.ink3, fontSize: 11, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  input: { backgroundColor: colors.field, color: colors.ink, fontSize: 16, borderRadius: 12, borderCurve: 'continuous', paddingHorizontal: 14, paddingVertical: 12, minHeight: 44 },
  error: { backgroundColor: colors.redTint, borderRadius: 16, borderCurve: 'continuous', padding: 16, gap: 12 },
  code: { color: colors.ink, fontSize: 13, lineHeight: 20, fontFamily: fonts.mono },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
});

const tap = () => { if (Platform.OS === 'ios') void Haptics.selectionAsync().catch(() => {}); };

// Native scrolling and choice controls have one shared entry point.
export const PageScroll = React.forwardRef<ScrollView, ScrollViewProps>(function PageScroll({ children, contentContainerStyle, ...props }, ref) {
  return <ScrollView ref={ref} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} contentContainerStyle={[styles.content, contentContainerStyle]} {...props}>{children}</ScrollView>;
});
export function Button({ title, onPress, disabled = false, secondary = false, loading = false, destructive = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; loading?: boolean; destructive?: boolean }) {
  return <View style={{ minHeight: 44, justifyContent: 'center', alignItems: 'center' }}><Host ignoreSafeArea="all" matchContents seedColor={(destructive ? palette.red : palette.ink) as string}>
    <NativeButton label={title} variant={secondary ? 'outlined' : 'filled'} disabled={disabled || loading} onPress={() => { tap(); onPress(); }} modifiers={Platform.OS === 'ios' ? [controlSize('large')] : undefined} style={{ height: 48 }} />
  </Host>{loading && <ActivityIndicator accessibilityLabel={title} style={{ position: 'absolute', right: 12 }} color={colors.ink2} />}</View>;
}
/** A pill button drawn in React Native, for places that need desktop's ink fill. */
export function PillButton({ title, onPress, icon, disabled = false, secondary = false, loading = false, style }: { title: string; onPress: () => void; icon?: IconData; disabled?: boolean; secondary?: boolean; loading?: boolean; style?: StyleProp<ViewStyle> }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled, busy: loading }} disabled={disabled || loading} onPress={() => { tap(); onPress(); }} style={({ pressed }) => [{ height: 46, paddingHorizontal: 18, borderRadius: 23, borderCurve: 'continuous', flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: secondary ? colors.surface : colors.ink, borderWidth: secondary ? 1 : 0, borderColor: colors.lineStrong, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }, style]}>
    {loading ? <ActivityIndicator color={secondary ? colors.ink2 : colors.onInk} /> : icon ? <Icon icon={icon} tone={secondary ? 'ink' : 'onInk'} size={18} /> : null}
    <Text style={{ color: secondary ? colors.ink : colors.onInk, fontSize: 15, fontWeight: '600' }}>{title}</Text>
  </Pressable>;
}
export function Toggle({ title, selected, onPress, disabled = false }: { title: string; selected: boolean; onPress: () => void; disabled?: boolean }) {
  return <Host ignoreSafeArea="all" matchContents={{ vertical: true }} style={{ minHeight: 44 }} seedColor={palette.green as string}><Switch label={title} value={selected} disabled={disabled} onValueChange={onPress} /></Host>;
}
export function Choice({ title, selected, onPress }: { title: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={onPress} style={({ pressed }) => ({ paddingVertical: 12, paddingHorizontal: 14, minHeight: 44, backgroundColor: colors.field, borderRadius: 12, borderCurve: 'continuous', flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.6 : 1 })}><Text style={[styles.text, { flex: 1 }]}>{title}</Text><Icon icon={selected ? CheckmarkCircle02Icon : CircleIcon} tone={selected ? 'ink' : 'ink3'} size={22} /></Pressable>;
}
export function Field({ label, hideLabel = false, ...props }: TextInputProps & { label: string; hideLabel?: boolean }) {
  return <View style={{ gap: 8 }}>{!hideLabel && <Text style={styles.label}>{label}</Text>}<TextInput accessibilityLabel={label} autoCapitalize="none" autoCorrect={false} placeholderTextColor={colors.ink3} selectionColor={colors.accent} {...props} style={[styles.input, props.style]} /></View>;
}
export function ErrorNotice({ message, retry, retryTitle = 'Reconnect' }: { message: string; retry?: () => void; retryTitle?: string }) {
  return <View accessibilityRole="alert" style={styles.error}><Text selectable style={{ color: colors.red, fontSize: 15, lineHeight: 22 }}>{message}</Text>{retry && <PillButton title={retryTitle} secondary onPress={retry} style={{ alignSelf: 'flex-start' }} />}</View>;
}
export function Select({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: { value: string; title: string; description?: string }[]; onChange: (value: string) => void; disabled?: boolean }) {
  const selected = options.find(option => option.value === value);
  const items = selected ? options : [{ value, title: 'Choose' }, ...options];
  return <View style={{ gap: 4 }}><View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={styles.text}>{label}</Text><Host ignoreSafeArea="all" matchContents style={{ minHeight: 44, maxWidth: '100%', justifyContent: 'center' }} seedColor={palette.ink as string}>
    {Platform.OS === 'ios' ? <IOSPicker label={label} selection={value} onSelectionChange={onChange} modifiers={[pickerStyle('menu'), nativeDisabled(disabled), accessibilityLabel(label)]} testID={`select-${label}`}>
      {items.map(option => <IOSText key={option.value} modifiers={[tag(option.value)]}>{option.title}</IOSText>)}
    </IOSPicker> : <Picker selectedValue={value} onValueChange={onChange} enabled={!disabled} testID={`select-${label}`}>
      {items.map(option => <Picker.Item key={option.value} value={option.value} label={`${label}: ${option.title}`} />)}
    </Picker>}
  </Host></View>{selected?.description ? <Text style={styles.caption}>{selected.description}</Text> : null}</View>;
}
/** iOS segmented control (a native SwiftUI Picker); Android falls back to the dropdown Picker. */
export function Segmented({ label, value, options, onChange }: { label: string; value: string; options: { value: string; title: string }[]; onChange: (value: string) => void }) {
  return <Host ignoreSafeArea="all" matchContents={{ vertical: true }} style={{ minHeight: 32, width: '100%' }}>
    {Platform.OS === 'ios' ? <IOSPicker label={label} selection={value} onSelectionChange={onChange} modifiers={[pickerStyle('segmented'), accessibilityLabel(label)]} testID={`segmented-${label}`}>
      {options.map(option => <IOSText key={option.value} modifiers={[tag(option.value)]}>{option.title}</IOSText>)}
    </IOSPicker> : <Picker selectedValue={value} onValueChange={onChange} testID={`segmented-${label}`}>
      {options.map(option => <Picker.Item key={option.value} value={option.value} label={option.title} />)}
    </Picker>}
  </Host>;
}
export function ListRow({ title, subtitle, subtitleLines = 1, onPress, onLongPress, disabled = false, compact = false, leading, trailing }: { title: string; subtitle?: string; subtitleLines?: number; compact?: boolean; onPress: () => void; onLongPress?: () => void; disabled?: boolean; leading?: React.ReactNode; trailing?: React.ReactNode }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} onLongPress={onLongPress} accessibilityActions={onLongPress ? [{ name: 'longpress', label: 'Actions' }] : undefined} onAccessibilityAction={onLongPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: compact ? 8 : 13, minHeight: compact ? 48 : 52, opacity: disabled ? 0.4 : pressed ? 0.5 : 1 })}>{leading}<View style={{ flex: 1, gap: 3 }}><Text numberOfLines={1} style={[styles.text, { fontWeight: '500' }, compact && { fontSize: 15, lineHeight: 20 }]}>{title}</Text>{/* Paths keep their start and end; descriptions can wrap. */}{subtitle && <Text style={styles.caption} numberOfLines={subtitleLines} ellipsizeMode={subtitleLines === 1 ? "middle" : "tail"}>{subtitle}</Text>}</View>{trailing ?? <Icon icon={ArrowRight01Icon} tone="ink3" size={16} />}</Pressable>;
}
export function IconButton({ label, icon, onPress, disabled = false, filled = false, loading = false, tone = 'ink2', size = 36 }: { label: string; icon: IconData; onPress: () => void; disabled?: boolean; filled?: boolean; loading?: boolean; tone?: Tone; size?: number }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy: loading }} hitSlop={4} disabled={disabled || loading} onPress={() => { tap(); onPress(); }} style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: filled ? colors.ink : 'transparent', opacity: disabled ? 0.35 : pressed ? 0.5 : 1 })}>{loading ? <ActivityIndicator color={filled ? colors.onInk : colors.ink2} /> : <Icon icon={icon} size={20} tone={filled ? 'onInk' : tone} />}</Pressable>;
}
/** Native Liquid Glass on iOS 26; SwiftUI supplies the fallback on older iOS. */
export function GlassIconButton({ label, systemImage, icon, onPress }: { label: string; systemImage: React.ComponentProps<typeof IOSButton>['systemImage']; icon: IconData; onPress: () => void }) {
  if (Platform.OS !== 'ios') return <CircleButton label={label} icon={icon} onPress={onPress} />;
  return <Host ignoreSafeArea="all" matchContents>
    <IOSButton label={label} systemImage={systemImage} onPress={() => { tap(); onPress(); }} modifiers={[buttonStyle('glass'), controlSize('large'), labelStyle('iconOnly'), buttonBorderShape('circle'), tint({ type: 'hierarchical', style: 'primary' }), accessibilityLabel(label)]} />
  </Host>;
}
/** A bar button for the native header; iOS draws the round glass background itself. */
export function HeaderButton({ label, icon, onPress }: { label: string; icon: IconData; onPress?: () => void }) {
  const body = <View accessible accessibilityRole="button" accessibilityLabel={label} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}><Icon icon={icon} size={20} tone="ink" /></View>;
  if (!onPress) return body;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={() => { tap(); onPress(); }} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>{body}</Pressable>;
}
/** The round bordered buttons inside sheets (close, back, done). */
export function CircleButton({ label, icon, onPress, filled = false }: { label: string; icon: IconData; onPress?: () => void; filled?: boolean }) {
  const body = <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: filled ? colors.accent : colors.surface, borderWidth: filled ? 0 : StyleSheet.hairlineWidth, borderColor: colors.lineStrong }}><Icon icon={icon} size={20} tone={filled ? 'onInk' : 'ink'} /></View>;
  if (!onPress) return body;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={4} onPress={() => { tap(); onPress(); }} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>{body}</Pressable>;
}
export type MenuItem = { id: string; title: string; systemImage?: string; checked?: boolean; destructive?: boolean; disabled?: boolean; subtitle?: string };
export type MenuSection = { title?: string; items: MenuItem[] };
type NativeMenuTrigger = { title?: string; systemImage: string; disabled?: boolean; maxWidth?: number };
/** A row's actions or a short list of choices, in the confirmation bottom sheet with Cancel last. */
export function showActions({ title, actions, onSelect }: { title?: string; actions: { id: string; title: string; destructive?: boolean; disabled?: boolean }[]; onSelect: (id: string) => void }) {
  const enabled = actions.filter(action => !action.disabled);
  if (!enabled.length) return;
  Keyboard.dismiss();
  confirmSheet(title || '', undefined, [...enabled.map(action => ({ text: action.title, style: action.destructive ? 'destructive' as const : 'default' as const, onPress: () => { tap(); onSelect(action.id); } })), { text: 'Cancel', style: 'cancel' as const }]);
}
/**
 * A native pull-down menu on its trigger. With `onPress`, a tap runs it and a long press opens the menu (a Chat row);
 * without it, a tap opens the menu (the header switchers, a row's ⋯ button).
 */
export function PullDown({ title, sections, onSelect, children, label, onPress, style, nativeTrigger }: { title?: string; sections: MenuSection[]; onSelect: (id: string) => void; children: React.ReactNode; label: string; onPress?: () => void; style?: StyleProp<ViewStyle>; nativeTrigger?: NativeMenuTrigger }) {
  if (Platform.OS === 'ios' && nativeTrigger && !onPress) {
    // Composer menus use only SwiftUI views. No React child is handed to SwiftUI, avoiding the Fabric reparenting crash.
    const select = (id: string) => { tap(); setTimeout(() => onSelect(id), 250); };
    const body = sections.map((section, index) => <IOSSection key={index} title={section.title}>{section.items.map(item => item.checked !== undefined
      ? <IOSToggle key={item.id} label={item.title} systemImage={item.systemImage as never} isOn={item.checked} onIsOnChange={() => select(item.id)} modifiers={[nativeDisabled(!!item.disabled)]} />
      : <IOSButton key={item.id} label={item.title} systemImage={item.systemImage as never} role={item.destructive ? 'destructive' : undefined} onPress={() => select(item.id)} modifiers={[nativeDisabled(!!item.disabled)]} />)}</IOSSection>);
    const trigger = nativeTrigger.title
      ? <IOSHStack spacing={6} modifiers={[padding({ horizontal: 10, vertical: 6 }), frame({ minWidth: 0, maxWidth: nativeTrigger.maxWidth ?? 260, alignment: 'leading' })]}>
        <IOSImage systemName={nativeTrigger.systemImage as never} size={14} color={colors.ink2} />
        <IOSText modifiers={[font({ size: 13, weight: 'medium' }), foregroundStyle(colors.ink2), lineLimit(1)]}>{nativeTrigger.title}</IOSText>
        <IOSImage systemName="chevron.up.chevron.down" size={13} color={colors.ink3} />
      </IOSHStack>
      : <IOSImage systemName={nativeTrigger.systemImage as never} size={21} color={colors.ink2} modifiers={[frame({ width: 36, height: 36 })]} />;
    return <View style={style} onTouchStart={() => Keyboard.dismiss()}><IOSHost matchContents seedColor={colors.ink2} testID={label} ignoreSafeArea="all">
      <IOSMenu label={trigger} modifiers={[accessibilityLabel(label), menuOrder('fixed'), tint(colors.ink2), nativeDisabled(!!nativeTrigger.disabled)]}>{title ? <IOSSection title={title}>{body}</IOSSection> : body}</IOSMenu>
    </IOSHost></View>;
  }
  if (Platform.OS === 'ios') {
    // A SwiftUI menu laid over the trigger, its label an invisible shape. Hosting the React trigger inside the menu
    // (RNHostView) crashed Fabric when SwiftUI re-attached a view React had already recycled (TestFlight build 9,
    // -[RCTViewComponentView unmountChildComponentView:index:]); here no React view ever lives inside SwiftUI.
    // Like Paseo, the choice runs once the menu has gone, so the re-render it causes never races the menu's teardown.
    const select = (id: string) => { tap(); setTimeout(() => onSelect(id), 250); };
    // A tap menu keeps the order it is given (desktop's order), instead of iOS reversing it when it opens upward.
    const item = (entry: MenuItem) => entry.checked !== undefined
      ? <IOSToggle key={entry.id} label={entry.title} systemImage={entry.systemImage as never} isOn={entry.checked} onIsOnChange={() => select(entry.id)} modifiers={entry.disabled ? [nativeDisabled(true)] : undefined} />
      : <IOSButton key={entry.id} label={entry.title} systemImage={entry.systemImage as never} role={entry.destructive ? 'destructive' : undefined} onPress={() => select(entry.id)} modifiers={entry.disabled ? [nativeDisabled(true)] : undefined} />;
    const body = sections.map((section, index) => <IOSSection key={index} title={section.title}>{section.items.map(item)}</IOSSection>);
    // The system draws menus below the keyboard, so a touch on the trigger lowers it first.
    return <View style={style} onTouchStart={() => Keyboard.dismiss()}>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{children}</View>
      <IOSHost style={StyleSheet.absoluteFill} testID={label} ignoreSafeArea="all">
        <IOSMenu label={<Rectangle modifiers={[foregroundStyle('#00000001'), contentShape(shapes.rectangle()), accessibilityLabel(label)]} />} onPrimaryAction={onPress} modifiers={[menuOrder('fixed')]}>{title ? <IOSSection title={title}>{body}</IOSSection> : body}</IOSMenu>
      </IOSHost>
    </View>;
  }
  // The system draws menus below the keyboard, so a touch on the trigger lowers it first.
  const trigger = onPress
    ? <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onTouchStart={() => Keyboard.dismiss()}>{children}</Pressable>
    : <View accessibilityLabel={label} onTouchStart={() => Keyboard.dismiss()}>{children}</View>;
  const actions: MenuAction[] = sections.map((section, index) => ({ id: `section-${index}`, title: section.title || '', displayInline: true, subactions: section.items.map(item => ({ id: item.id, title: item.subtitle ? `${item.title}\n${item.subtitle}` : item.title, image: item.systemImage as MenuAction['image'], state: item.checked ? 'on' : undefined, attributes: { destructive: item.destructive, disabled: item.disabled } })) }));
  return <MenuView title={title} actions={actions} shouldOpenOnLongPress={!!onPress} onPressAction={({ nativeEvent }) => { tap(); onSelect(nativeEvent.event); }} style={style} testID={label}>{trigger}</MenuView>;
}
