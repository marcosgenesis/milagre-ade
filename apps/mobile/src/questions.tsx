import { useState } from 'react';
import { Text, View } from 'react-native';
import type { QuestionAnswers, QuestionRequest } from '@milagre/shared/model';
import { Button, Choice, Field, styles } from './ui';

export function Questions({ request, busy, submit }: { request: QuestionRequest; busy: boolean; submit: (answers: QuestionAnswers, summary: string) => void }) {
  const [selected, setSelected] = useState<QuestionAnswers>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const answers = Object.fromEntries(request.questions.map(q => [q.id, [...(selected[q.id] || []), ...(typed[q.id]?.trim() ? [typed[q.id].trim()] : [])]]));
  return <View style={styles.card}><Text style={styles.label}>YOUR AGENT HAS A QUESTION</Text>{request.questions.map(q => <View key={q.id} style={{ gap: 10 }}><Text style={styles.text}>{q.question}</Text>{q.options.map(option => <Choice key={option.label} title={option.description ? `${option.label}: ${option.description}` : option.label} selected={selected[q.id]?.includes(option.label) || false} onPress={() => {
    setSelected(current => ({ ...current, [q.id]: q.multiSelect ? current[q.id]?.includes(option.label) ? current[q.id].filter(v => v !== option.label) : [...(current[q.id] || []), option.label] : [option.label] }));
    if (!q.multiSelect) setTyped(current => ({ ...current, [q.id]: '' }));
  }} />)}{(q.allowOther || !q.options.length) && <Field label={q.header || 'Your answer'} secureTextEntry={q.secret} value={typed[q.id] || ''} onChangeText={text => { setTyped(current => ({ ...current, [q.id]: text })); if (!q.multiSelect) setSelected(current => ({ ...current, [q.id]: [] })); }} />}</View>)}<Button title="Send answers" disabled={busy || Object.values(answers).some(v => !v.length)} onPress={() => submit(answers, request.questions.map(q => `${q.header || q.question}: ${q.secret ? '[hidden answer]' : answers[q.id].join(', ')}`).join('\n'))} /></View>;
}
