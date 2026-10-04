import { PERMISSION_MODES } from "@milagre/shared/model-copy";
import { Pressable, Text } from 'react-native';
import { ArrowDown01Icon, Shield01Icon, ShieldAlertIcon, SecurityCheckIcon } from '@hugeicons/core-free-icons';
import type { PermissionMode } from '@milagre/shared/model';
import type { MobileModel } from './turn-options';
import { Icon, ProviderLogo } from './icons';
import { colors } from './ui';

/** The composer's model chip: provider logo, model name and a chevron. Effort and fast mode live in the model sheet. */
export function AgentControls({ model, disabled, onToggle }: { model: MobileModel; disabled?: boolean; onToggle: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Model, ${model.name}`} accessibilityHint="Opens model, effort and speed settings" disabled={disabled} onPress={onToggle} style={({ pressed }) => ({ minHeight: 34, maxWidth: 190, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', gap: 6, opacity: disabled ? 0.45 : pressed ? 0.6 : 1 })}>
    <ProviderLogo provider={model.provider} size={14} />
    <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 13, fontWeight: '500', flexShrink: 1 }}>{model.name}</Text>
    <Icon icon={ArrowDown01Icon} tone="ink3" size={12} />
  </Pressable>;
}

const SHORT: Record<PermissionMode, string> = { ask: 'Ask', auto: 'Auto', full: 'Full' };
/** The composer's permission chip; it opens the permission sheet. A plain button, so nothing React sits in a native menu. */
export function PermissionChip({ mode, disabled, onPress }: { mode: PermissionMode; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Permissions, ${PERMISSION_MODES.find(item => item.id === mode)?.name}`} accessibilityHint="Opens permission modes" disabled={disabled} onPress={onPress} style={({ pressed }) => ({ minHeight: 34, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4, opacity: disabled ? 0.45 : pressed ? 0.6 : 1 })}>
    <PermissionIcon mode={mode} size={15} />
    <Text style={{ color: mode === 'full' ? colors.orange : colors.ink2, fontSize: 13 }}>{SHORT[mode]}</Text>
  </Pressable>;
}
export function PermissionIcon({ mode, size }: { mode: PermissionMode; size: number }) {
  return <Icon icon={mode === 'full' ? ShieldAlertIcon : mode === 'auto' ? SecurityCheckIcon : Shield01Icon} tone={mode === 'full' ? 'orange' : 'ink2'} size={size} />;
}
