import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ArrowLeft01Icon, ArrowRight01Icon, ArrowUp02Icon, Cancel01Icon, PencilEdit02Icon, ShieldAlertIcon, Tick02Icon } from '@hugeicons/core-free-icons';
import type { AgentQuestion, PermissionDecision, PermissionRequest, QuestionAnswers, QuestionRequest } from '@milagre/shared/model';
import { Icon } from './icons';
import { IconButton, PillButton, colors, styles } from './ui';

const RECOMMENDED = /\s*\((recommended)\)\s*$/i;

/**
 * The agent's questions, Claude-style: the card takes the composer's place, one question at a time.
 * A single-choice pick answers and moves on; multi-select gets a Send button; the last row types an answer.
 */
export function Questions({ request, busy, submit }: { request: QuestionRequest; busy: boolean; submit: (answers: QuestionAnswers | null, summary: string) => void }) {
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<QuestionAnswers>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const questions = request.questions;
  const question = questions[Math.min(page, questions.length - 1)];
  const answerOf = (q: AgentQuestion) => [...(picked[q.id] || []), ...(typed[q.id]?.trim() ? [typed[q.id].trim()] : [])];
  function finish(next: QuestionAnswers, nextTyped = typed) {
    const answers = Object.fromEntries(questions.map(q => [q.id, [...(next[q.id] || []), ...(nextTyped[q.id]?.trim() ? [nextTyped[q.id].trim()] : [])]]));
    const open = questions.findIndex(q => !answers[q.id].length);
    if (open >= 0) { setPage(open); return; }
    submit(answers, questions.map(q => `${q.header || q.question}: ${q.secret ? '[hidden answer]' : answers[q.id].join(', ')}`).join('\n'));
  }
  function choose(label: string) {
    if (question.multiSelect) { setPicked(current => ({ ...current, [question.id]: current[question.id]?.includes(label) ? current[question.id].filter(value => value !== label) : [...(current[question.id] || []), label] })); return; }
    const next = { ...picked, [question.id]: [label] };
    const nextTyped = { ...typed, [question.id]: '' };
    setPicked(next); setTyped(nextTyped);
    if (page < questions.length - 1) setPage(page + 1); else finish(next, nextTyped);
  }
  function sendTyped() {
    if (!typed[question.id]?.trim()) return;
    if (!question.multiSelect) setPicked(current => ({ ...current, [question.id]: [] }));
    const next = question.multiSelect ? picked : { ...picked, [question.id]: [] };
    if (page < questions.length - 1) setPage(page + 1); else finish(next);
  }
  const count = answerOf(question).length;
  return <View accessibilityLabel="Agent question" style={{ backgroundColor: colors.surface, borderRadius: 24, borderCurve: 'continuous', borderWidth: 1, borderColor: colors.lineStrong, padding: 8, paddingTop: 8, gap: 4, boxShadow: '0 8px 28px #00000017' }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 2 }}>
      {questions.length > 1 && <><IconButton label="Previous question" icon={ArrowLeft01Icon} size={32} disabled={page === 0} onPress={() => setPage(page - 1)} /><Text style={{ color: colors.ink2, fontSize: 13 }}>{page + 1} of {questions.length}</Text><IconButton label="Next question" icon={ArrowRight01Icon} size={32} disabled={page === questions.length - 1} onPress={() => setPage(page + 1)} /></>}
      <View style={{ flex: 1 }} />
      <IconButton label="Dismiss questions" icon={Cancel01Icon} size={32} tone="ink" disabled={busy} onPress={() => submit(null, '')} />
    </View>
    <View style={{ paddingHorizontal: 10, paddingBottom: 8, gap: 3 }}>
      <Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 17, fontWeight: '600', lineHeight: 22 }}>{question.question}</Text>
      {question.multiSelect && <Text style={styles.caption}>Pick any that apply.</Text>}
    </View>
    <View accessibilityRole={question.multiSelect ? undefined : 'radiogroup'} style={{ gap: 4 }}>
      {question.options.map((option, index) => {
        const on = !!picked[question.id]?.includes(option.label);
        const recommended = RECOMMENDED.test(option.label);
        return <Pressable key={option.label} accessibilityRole={question.multiSelect ? 'checkbox' : 'radio'} accessibilityState={{ checked: on, disabled: busy }} disabled={busy} onPress={() => choose(option.label)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 14, borderCurve: 'continuous', borderWidth: on ? 1.5 : 1, borderColor: on ? colors.ink : colors.line, backgroundColor: on ? colors.surface : colors.page, opacity: pressed ? 0.6 : 1 })}>
          <View style={{ width: 26, height: 26, borderRadius: question.multiSelect ? 7 : 13, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? colors.ink : colors.surface, borderWidth: on ? 0 : 1, borderColor: colors.lineStrong }}>
            {on && question.multiSelect ? <Icon icon={Tick02Icon} tone="onInk" size={15} strokeWidth={2.4} /> : <Text style={{ color: on ? colors.onInk : colors.ink2, fontSize: 13, fontWeight: '600' }}>{index + 1}</Text>}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}><Text style={{ color: colors.ink, fontSize: 15, fontWeight: '500' }}>{option.label.replace(RECOMMENDED, '')}</Text>{recommended && <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: colors.accentTint }}><Text style={{ color: colors.accentInk, fontSize: 10, fontWeight: '600' }}>Recommended</Text></View>}</View>
            {!!option.description && <Text style={{ color: colors.ink2, fontSize: 13, lineHeight: 18 }}>{option.description}</Text>}
          </View>
        </Pressable>;
      })}
      {(question.allowOther || !question.options.length) && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, paddingLeft: 12, paddingRight: 6, borderRadius: 14, borderCurve: 'continuous', borderWidth: typed[question.id] ? 1.5 : 1, borderColor: typed[question.id] ? colors.ink : colors.line, backgroundColor: typed[question.id] ? colors.surface : colors.page }}>
        <View style={{ width: 26, alignItems: 'center' }}><Icon icon={PencilEdit02Icon} tone="ink2" size={16} /></View>
        <TextInput accessibilityLabel={`Your own answer to: ${question.question}`} placeholder="Type your answer…" placeholderTextColor={colors.ink3} secureTextEntry={question.secret} value={typed[question.id] || ''} onChangeText={text => setTyped(current => ({ ...current, [question.id]: text }))} onSubmitEditing={sendTyped} returnKeyType="send" editable={!busy} style={{ flex: 1, color: colors.ink, fontSize: 15, paddingVertical: 12 }} />
        {!!typed[question.id]?.trim() && !question.multiSelect && <IconButton label="Send answer" icon={ArrowUp02Icon} filled size={32} onPress={sendTyped} disabled={busy} />}
      </View>}
    </View>
    {question.multiSelect && <PillButton title={count ? `Send ${count} answer${count === 1 ? '' : 's'}` : 'Pick at least one'} disabled={busy || !count} loading={busy} onPress={() => finish(picked)} style={{ marginTop: 6 }} />}
  </View>;
}

/** Desktop's approval card: what the agent wants to run or change, then Deny, Always allow in this Chat, and Allow once. */
export function Approval({ approval, busy, respond }: { approval: PermissionRequest; busy: boolean; respond: (decision: PermissionDecision) => void }) {
  const detail = [approval.description, approval.command, approval.diff, approval.detail].filter(Boolean) as string[];
  return <View style={{ backgroundColor: colors.surface, borderRadius: 18, borderCurve: 'continuous', borderWidth: 1, borderColor: colors.lineStrong, padding: 14, gap: 10 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon icon={ShieldAlertIcon} tone="orange" size={16} strokeWidth={2} /><Text style={{ color: colors.ink, fontSize: 15, fontWeight: '600', flex: 1 }}>{approval.title}</Text></View>
    {detail.map((text, index) => <View key={index} style={{ backgroundColor: colors.field, borderRadius: 8, padding: 10, maxHeight: 220, overflow: 'hidden' }}><Text selectable style={[styles.code, { fontSize: 12 }]}>{text}</Text></View>)}
    {!!approval.reason && <Text style={styles.caption}>{approval.reason}</Text>}
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <PillButton title="Deny" secondary disabled={busy} onPress={() => respond('deny')} style={{ flex: 1, height: 40 }} />
      <PillButton title="Allow once" disabled={busy} onPress={() => respond('allow')} style={{ flex: 1, height: 40 }} />
    </View>
    {approval.allowForChat && <Pressable accessibilityRole="button" disabled={busy} onPress={() => respond('allow-for-chat')} style={{ alignSelf: 'center', paddingVertical: 4 }}><Text style={{ color: colors.ink2, fontSize: 13, fontWeight: '500' }}>Always allow in this Chat</Text></Pressable>}
  </View>;
}
