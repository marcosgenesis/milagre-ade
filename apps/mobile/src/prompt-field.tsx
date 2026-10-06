import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import type { SkillCatalog } from '@milagre/shared/model';
import { promptSkillAtSelection, promptSkillParts } from '@milagre/shared/prompt-skills';
import type { Client } from './client';
import { useRpc } from './use-rpc';
import { Field, colors } from './ui';

/** Native attributed text keeps skill colors in the editable input, including wrapped/scrolled lines. */
export function PromptField({ client, projectPath, draft, onChangeText }: {
  client: Client;
  projectPath: string;
  draft: string;
  onChangeText: (value: string) => void;
}) {
  const { data } = useRpc<SkillCatalog>(client, 'skills:list', [projectPath]);
  const skills = data?.skills;
  const parts = useMemo(() => promptSkillParts(draft, (skills ?? []).map(skill => skill.name)), [draft, skills]);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [focused, setFocused] = useState(false);
  const [rendered, setRendered] = useState({ draft, parts, restore: undefined as typeof selection | undefined });
  // Recoloring after the catalog loads must preserve a selected range. Ordinary edits keep native caret control.
  const changed = rendered.draft !== draft || rendered.parts !== parts;
  const restore = changed ? (rendered.draft === draft ? selection : undefined) : rendered.restore;
  if (changed) setRendered({ draft, parts, restore });
  const name = focused ? promptSkillAtSelection(parts, selection) : null;
  const skill = name ? skills?.find(item => item.name.toLowerCase() === name) : null;

  return <View>
    {/* TextInput cannot receive value and attributed children together. The children mirror every accepted edit. */}
    <Field label="Message" hideLabel placeholder="Message the agent" multiline autoCorrect spellCheck autoCapitalize="sentences"
      onChangeText={onChangeText} onSelectionChange={event => {
        setSelection(event.nativeEvent.selection);
        setRendered(current => current.restore ? { ...current, restore: undefined } : current);
      }}
      selection={restore}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={{ backgroundColor: 'transparent', minHeight: 44, maxHeight: 140, paddingHorizontal: 10, paddingVertical: 6 }}>
      <Text style={{ fontSize: 16, color: colors.ink }}>{parts.map((part, index) => <Text key={index} style={{ color: part.skill ? colors.accentInk : colors.ink }}>{part.text}</Text>)}</Text>
    </Field>
    {skill ? <View accessibilityLiveRegion="polite" style={{ marginHorizontal: 10, marginBottom: 6, padding: 10, borderRadius: 10, backgroundColor: colors.accentTint, gap: 4 }}>
      <Text style={{ color: colors.accentInk, fontSize: 13, fontWeight: '600' }}>/{skill.name}</Text>
      <Text style={{ color: colors.ink2, fontSize: 13, lineHeight: 18 }}>{skill.description}</Text>
    </View> : null}
  </View>;
}
