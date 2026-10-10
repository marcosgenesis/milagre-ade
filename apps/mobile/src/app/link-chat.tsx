import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import { canLinkProjects, type LinkScope } from "@milagre/shared/chat-links";
import { createLinkTitle, linkSummary, linkWorktree, projectsScopeSubtitle, type LinkChoice } from "../chat-links";
import { currentLinkQuestion } from "../link-chat-store";
import { Icon } from "../icons";
import { Button, Field, PageScroll, Toggle, useStyles } from "../ui";
import { useTheme } from "../theme";

/**
 * The "Create Link" confirmation, desktop's dialog on the phone: which ends to link, whether the source Chat may make
 * Delegations without asking, and what it should ask the other Chat. The choice runs once the sheet has gone, as the
 * confirmation sheet's does, so the notice it shows never fights the sheet's dismissal.
 */
export default function LinkChat() {
  const { colors } = useTheme();
  const styles = useStyles();
  const [entry] = useState(currentLinkQuestion);
  const [scope, setScope] = useState<LinkScope>("worktrees");
  const [grant, setGrant] = useState(false);
  const [text, setText] = useState("");
  const chosen = useRef<LinkChoice | null>(null);
  useEffect(() => {
    if (!entry) {
      router.back();
      return;
    }
    return () => entry.choose(chosen.current);
  }, [entry]);
  if (!entry) return null;
  const { source, target } = entry;
  const projects = canLinkProjects(linkWorktree(source), linkWorktree(target));
  const close = (choice: LinkChoice | null) => {
    chosen.current = choice;
    router.back();
  };
  const scopes: { id: LinkScope; title: string; subtitle?: string }[] = [
    { id: "worktrees", title: "Only these Worktrees" },
    ...(projects ? [{ id: "projects" as const, title: "The whole Projects", subtitle: projectsScopeSubtitle(source, target) }] : []),
  ];
  return (
    <PageScroll style={styles.screen} contentContainerStyle={{ gap: 20, padding: 20 }} automaticallyAdjustKeyboardInsets>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pressable accessibilityRole="button" onPress={() => close(null)} style={{ minHeight: 44, minWidth: 64, justifyContent: "center" }}>
          <Text style={[styles.text, { color: colors.ink2 }]}>Cancel</Text>
        </Pressable>
        <Text accessibilityRole="header" style={{ flex: 1, textAlign: "center", color: colors.ink, fontSize: 17, fontWeight: "600" }}>
          Create Link
        </Text>
        <View style={{ minWidth: 64 }} />
      </View>
      <Text numberOfLines={2} style={[styles.text, { textAlign: "center", fontWeight: "500" }]}>
        {linkSummary(source, target, projects ? scope : "worktrees")}
      </Text>
      <View accessibilityRole="radiogroup" style={{ borderRadius: 12, borderCurve: "continuous", backgroundColor: colors.surface, padding: 4 }}>
        {scopes.map((item, index) => {
          const selected = scope === item.id;
          return (
            <View key={item.id}>
              {index > 0 && <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginLeft: 12 }} />}
              <Pressable
                accessibilityRole="radio"
                accessibilityLabel={item.subtitle ? `${item.title}. ${item.subtitle}` : item.title}
                accessibilityState={{ checked: selected }}
                onPress={() => setScope(item.id)}
                style={({ pressed }) => ({
                  minHeight: 52,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 8,
                  backgroundColor: pressed ? colors.hover : "transparent",
                })}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.text, { fontSize: 15 }]}>{item.title}</Text>
                  {item.subtitle && <Text style={styles.caption}>{item.subtitle}</Text>}
                </View>
                <View style={{ width: 18 }}>{selected && <Icon icon={Tick02Icon} tone="accent" size={18} />}</View>
              </Pressable>
            </View>
          );
        })}
      </View>
      <View style={{ gap: 4 }}>
        <Toggle title={`Always allow Delegations from “${source.title}”`} selected={grant} onPress={() => setGrant((value) => !value)} />
        <Text style={styles.caption}>Same as “Always allow for this Link in this chat” on the approval card.</Text>
      </View>
      <Field
        label={`Ask “${source.title}” (optional)`}
        value={text}
        onChangeText={setText}
        placeholder="What should it ask the other chat to do?"
        multiline
        autoCapitalize="sentences"
        autoCorrect
        style={{ minHeight: 96, textAlignVertical: "top" }}
      />
      <Text style={styles.muted}>Every Chat on either side can read the other side and make Delegations to it.</Text>
      <Button title={createLinkTitle(text)} onPress={() => close({ scope: projects ? scope : "worktrees", grant, text })} />
    </PageScroll>
  );
}
