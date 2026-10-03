import { PERMISSION_MODES } from "@milagre/shared/model-copy";
import { Pressable, Text, View } from 'react-native';
import { ArrowDown01Icon, Shield01Icon, ShieldAlertIcon, SecurityCheckIcon } from '@hugeicons/core-free-icons';
import type { PermissionMode } from '@milagre/shared/model';
import type { MobileModel } from './turn-options';
import { Icon, ProviderLogo } from './icons';
import { PullDown, colors } from './ui';

/** The composer's model chip: provider logo, model name and a chevron. Effort and fast mode live in the model sheet. */
export function AgentControls({ model, disabled, onToggle }: { model: MobileModel; disabled?: boolean; onToggle: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Model, ${model.name}`} accessibilityHint="Opens model, effort and speed settings" disabled={disabled} onPress={onToggle} style={({ pressed }) => ({ minHeight: 34, maxWidth: 190, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', gap: 6, opacity: disabled ? 0.45 : pressed ? 0.6 : 1 })}>
    <ProviderLogo provider={model.provider} size={14} />
    <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 13, fontWeight: '500', flexShrink: 1 }}>{model.name}</Text>
    <Icon icon={ArrowDown01Icon} tone="ink3" size={12} />
  </Pressable>;
}

const SHORT: Record<PermissionMode, string> = { ask: 'Ask', auto: 'Auto', full: 'Full' };
// The same shields as the chip, as SF Symbols because the system draws the menu.
const SYMBOL: Record<PermissionMode, string> = { ask: 'shield', auto: 'checkmark.shield', full: 'exclamationmark.shield' };
/** Desktop's permission picker as a native pull-down: Ask approval, Auto mode, Full permission. */
export function PermissionChip({ mode, disabled, onChange }: { mode: PermissionMode; disabled?: boolean; onChange: (mode: PermissionMode) => void }) {
  return <PullDown label="Permissions" sections={[{ title: 'Permissions', items: PERMISSION_MODES.map(item => ({ id: item.id, title: item.name, systemImage: SYMBOL[item.id], checked: item.id === mode, disabled })) }]} onSelect={id => onChange(id as PermissionMode)}>
    <View accessibilityRole="button" accessibilityLabel={`Permissions, ${PERMISSION_MODES.find(item => item.id === mode)?.name}`} style={{ minHeight: 34, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4, opacity: disabled ? 0.45 : 1 }}>
      <Icon icon={mode === 'full' ? ShieldAlertIcon : mode === 'auto' ? SecurityCheckIcon : Shield01Icon} tone={mode === 'full' ? 'orange' : 'ink2'} size={15} />
      <Text style={{ color: mode === 'full' ? colors.orange : colors.ink2, fontSize: 13 }}>{SHORT[mode]}</Text>
    </View>
  </PullDown>;
}
