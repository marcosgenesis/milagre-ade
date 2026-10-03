import { PROVIDERS, providerName } from "@milagre/shared/providers";
import { effortFor } from "@milagre/shared/model-options";
import { PERMISSION_MODES, effortCopy } from "@milagre/shared/model-copy";
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { type AgentCliStatus, type AgentModels, type ModelProvider, type PermissionMode } from '@milagre/shared/model';
import { modelsFor, type MobileModel, type TurnPreferences } from './turn-options';
import { Icon, Sheet, Toggle, Select, colors, styles } from './ui';

export function AgentControls({ model, preferences, reported, status, lockedProvider, disabled, onToggle, onChange }: { model: MobileModel; preferences: TurnPreferences; reported: AgentModels | null; status: AgentCliStatus | null; lockedProvider: boolean; disabled: boolean; onToggle: () => void; onChange: (patch: Partial<TurnPreferences>) => void }) {
  const [expanded, setExpanded] = useState(false);
  const models = modelsFor(model.provider, reported);
  if (!models.some(item => item.id === model.id)) models.unshift(model);
  const cli = status?.[model.provider];
  const effort = effortFor(model, preferences.effort);
  return <View style={{ flex: 1, minWidth: 0 }}><Pressable accessibilityRole="button" accessibilityLabel={`Agent settings, ${model.name}${effort ? `, ${effortCopy(effort).name}` : ''}`} onPress={() => { onToggle(); setExpanded(true); }} style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, opacity: pressed ? 0.5 : 1 })}><Icon name={{ ios: 'sparkles', android: 'auto_awesome' }} size={19} /><Text numberOfLines={1} style={[styles.muted, { flexShrink: 1, color: colors.text }]}>{model.name}</Text>{effort && <Text numberOfLines={1} style={[styles.label, { flexShrink: 2 }]}>{effortCopy(effort).name}</Text>}<Icon name={{ ios: 'chevron.down', android: 'expand_more' }} size={11} /></Pressable>
    <Sheet title="Agent settings" visible={expanded} close={() => setExpanded(false)}>
      {cli && cli.state !== 'ready' && <Text style={styles.muted}>{cli.message || `Agent ${cli.state}`}</Text>}
      {disabled && <Text style={styles.muted}>Settings can be changed when this turn finishes.</Text>}
      {!lockedProvider && <Select label="Agent" value={model.provider} disabled={disabled} options={PROVIDERS.map(value => ({ value, title: providerName(value) }))} onChange={value => onChange({ provider: value as ModelProvider, model: '', fastMode: false })} />}
      <Select label="Model" value={model.id} disabled={disabled} options={models.map(item => ({ value: item.id, title: item.name, description: item.description }))} onChange={value => onChange({ model: value })} />
      {model.efforts.length > 0 && <Select label="Effort" value={effortFor(model, preferences.effort) || ''} disabled={disabled} options={model.efforts.map(value => ({ value, title: effortCopy(value).name, description: effortCopy(value).description }))} onChange={effort => onChange({ effort })} />}
      {model.fastMode && !disabled && <View style={{ gap: 6 }}><Toggle title="Fast mode" selected={preferences.fastMode} onPress={() => onChange({ fastMode: !preferences.fastMode })} /><Text style={styles.muted}>Faster output uses higher provider rates.</Text></View>}
      <Select label="Permissions" value={preferences.permissionMode} disabled={disabled} options={PERMISSION_MODES.map(mode => ({ value: mode.id, title: mode.name, description: mode.description }))} onChange={value => onChange({ permissionMode: value as PermissionMode })} />
    </Sheet>
  </View>;
}
