import { memo, useMemo } from 'react';
import { Alert, Linking, Text, View, type TextStyle } from 'react-native';
import type { Token } from 'markdown-it';
import { markdownTokens, safeLink } from './chat-presentation';
import { PageScroll, colors, styles } from './ui';

// Chat reading size: desktop uses 13px at 1.55; a phone reads best a little larger.
const body = { color: colors.ink, fontSize: 15, lineHeight: 22 };

type Node = { token: Token; children: Node[] };
function tree(tokens: Token[]) {
  const root: Node[] = [], stack = [root];
  for (const token of tokens) {
    if (token.nesting === -1) { if (stack.length > 1) stack.pop(); continue; }
    const node = { token, children: [] as Node[] };
    stack.at(-1)!.push(node);
    if (token.nesting === 1) stack.push(node.children);
  }
  return root;
}
function inline(tokens: Token[]) {
  return inlineNodes(tree(tokens));
}
function inlineNodes(nodes: Node[]): React.ReactNode {
  return nodes.map(({ token, children }, i) => {
    if (token.type === 'softbreak' || token.type === 'hardbreak') return '\n';
    if (token.type === 'image') return <Text key={i} style={styles.muted}>[Image: {token.content || 'attachment'}]</Text>;
    const text = children.length ? inlineNodes(children) : token.content;
    const style: TextStyle = token.type === 'strong_open' ? { fontWeight: '600' } : token.type === 'em_open' ? { fontStyle: 'italic' } : token.type === 's_open' ? { textDecorationLine: 'line-through' } : token.type === 'code_inline' ? { fontFamily: styles.code.fontFamily, backgroundColor: colors.field, fontSize: 13.5 } : {};
    const url = token.type === 'link_open' ? safeLink(String(token.attrGet('href') || '')) : null;
    return <Text key={i} style={[style, url ? { color: colors.accent, textDecorationLine: 'underline' } : {}]} accessibilityRole={url ? 'link' : undefined} onPress={url ? () => void Linking.openURL(url).catch(() => Alert.alert('Cannot open link', 'Try opening this address in your browser.')) : undefined}>{text}</Text>;
  });
}
function blocks(nodes: Node[]): React.ReactNode {
  return nodes.map(({ token, children }, index) => {
    const key = `${token.type}-${index}`;
    if (token.type === 'inline') return <Text key={key} selectable style={body}>{inline(token.children || [])}</Text>;
    if (token.type === 'fence' || token.type === 'code_block') return <View key={key} style={{ backgroundColor: colors.field, borderRadius: 12, borderCurve: 'continuous', overflow: 'hidden' }}>{token.info && <Text style={[styles.label, { paddingHorizontal: 12, paddingTop: 10 }]}>{token.info}</Text>}<PageScroll horizontal contentContainerStyle={{ padding: 12, paddingBottom: 12 }}><Text selectable style={styles.code}>{token.content.replace(/\n$/, '')}</Text></PageScroll></View>;
    if (token.type === 'heading_open') return <Text key={key} accessibilityRole="header" selectable style={{ color: colors.ink, fontWeight: '600', lineHeight: 23, fontSize: token.tag === 'h1' ? 17 : token.tag === 'h2' ? 16 : 15 }}>{inline(children.flatMap(n => n.token.children || []))}</Text>;
    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') return <View key={key} style={{ gap: 8 }}>{children.map((child, i) => <View key={i} style={{ flexDirection: 'row', gap: 10 }}><Text style={body}>{token.type === 'ordered_list_open' ? `${Number(token.attrGet('start') || 1) + i}.` : '•'}</Text><View style={{ flex: 1, gap: 8 }}>{blocks(child.children)}</View></View>)}</View>;
    if (token.type === 'blockquote_open') return <View key={key} style={{ borderLeftWidth: 3, borderColor: colors.line, paddingLeft: 14, gap: 8 }}>{blocks(children)}</View>;
    if (token.type === 'hr') return <View key={key} style={{ height: 1, backgroundColor: colors.line }} />;
    if (token.type === 'tr_open') return <View key={key} style={{ flexDirection: 'row', gap: 12, paddingVertical: 8, borderBottomWidth: 0.5, borderColor: colors.line }}>{children.map((child, i) => <View key={i} style={{ flex: 1 }}>{blocks(child.children)}</View>)}</View>;
    return <View key={key} style={{ gap: 8 }}>{children.length ? blocks(children) : <Text selectable style={body}>{token.content}</Text>}</View>;
  });
}
export const Markdown = memo(function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const nodes = useMemo(() => tree(markdownTokens(text, streaming)), [text, streaming]);
  return <View style={{ gap: 12 }}>{blocks(nodes)}</View>;
});
