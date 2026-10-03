import { useState } from 'react';
import { Text, View } from 'react-native';
import { PERMISSION_MODES, effortCopy, effortFor, type AgentCliStatus, type AgentModels, type ModelProvider, type PermissionMode } from '@milagre/shared/model';
import { modelsFor, type MobileModel, type TurnPreferences } from './turn-options';
import { Button, Choice, Select, styles } from './ui';

export function AgentControls({ model, preferences, reported, status, lockedProvider, disabled, onChange }: { model: MobileModel; preferences: TurnPreferences; reported: AgentModels | null; status: AgentCliStatus | null; lockedProvider: boolean; disabled: boolean; onChange: (patch: Partial<TurnPreferences>) => void }) {
  const [expanded, setExpanded] = useState(false);
  const models = modelsFor(model.provider, reported);
  if (!models.some(item => item.id === model.id)) models.unshift(model);
  const cli = status?.[model.provider];
  return <View style={styles.card}><Button title={`${model.provider === 'codex' ? 'Codex' : 'Claude'} / ${model.name}`} secondary onPress={() => setExpanded(!expanded)} />
    {cli && <Text style={styles.muted}>{cli.state === 'ready' ? 'Ready on your computer' : cli.message || `Agent ${cli.state}`}</Text>}
    {expanded && <><Text style={styles.label}>AGENT SETTINGS</Text>{disabled && <Text style={styles.muted}>Settings can be changed when this turn finishes.</Text>}
      {!lockedProvider && <Select label="Agent" value={model.provider} disabled={disabled} options={[{ value: 'codex', title: 'Codex' }, { value: 'claude', title: 'Claude' }]} onChange={value => onChange({ provider: value as ModelProvider, model: '', fastMode: false })} />}
      <Select label="Model" value={model.id} disabled={disabled} options={models.map(item => ({ value: item.id, title: item.name, description: item.description }))} onChange={value => onChange({ model: value })} />
      {model.efforts.length > 0 && <Select label="Effort" value={effortFor(model, preferences.effort) || ''} disabled={disabled} options={model.efforts.map(value => ({ value, title: effortCopy(value).name, description: effortCopy(value).description }))} onChange={effort => onChange({ effort })} />}
      {model.fastMode && !disabled && <View style={{ gap: 6 }}><Choice title="Fast mode" selected={preferences.fastMode} onPress={() => onChange({ fastMode: !preferences.fastMode })} /><Text style={styles.muted}>Faster output uses higher provider rates.</Text></View>}
      <Select label="Permissions" value={preferences.permissionMode} disabled={disabled} options={PERMISSION_MODES.map(mode => ({ value: mode.id, title: mode.name, description: mode.description }))} onChange={value => onChange({ permissionMode: value as PermissionMode })} />
    </>}
  </View>;
}
