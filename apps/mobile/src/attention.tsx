import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { projectOfKey, sessionIdFromKey } from "@milagre/shared/agent-runs";
import { attentionLabel } from "@milagre/shared/attention";
import { readAttentionButton, saveAttentionButton } from "./hosts-native";
import { useSession } from "./session";
import { Icon } from "./icons";
import { PullDown, colors } from "./ui";

const NONE: string[] = [];
/** Chat keys, in every Project, whose turn waits on an approval or question. A Mac from before /attention gives none. */
// ponytail: polls every 5 s while the app is open; a live "attention" signal from the bridge if this ever costs too much.
export function useAttention(): string[] {
  const { client } = useSession();
  // Kept with the computer it came from, so switching computers never shows the last one's Chats.
  const [found, setFound] = useState<{ client: typeof client; keys: string[] }>({ client: null, keys: [] });
  useEffect(() => {
    if (!client) return;
    let live = true;
    const load = () => {
      if (AppState.currentState !== "active") return;
      client.attention().then(
        (keys) => {
          if (live) setFound((previous) => (previous.client === client && previous.keys.join("\n") === keys.join("\n") ? previous : { client, keys }));
        },
        () => {},
      );
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [client]);
  return found.client === client ? found.keys : NONE;
}

// The phone's "Attention button" setting, read once and shared by Settings and every Chat.
let showButton = true;
const listeners = new Set<() => void>();
void readAttentionButton().then((on) => {
  showButton = on;
  listeners.forEach((listener) => listener());
});
export function useAttentionButton(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => showButton,
  );
  return [
    on,
    (next) => {
      showButton = next;
      listeners.forEach((listener) => listener());
      void saveAttentionButton(next);
    },
  ];
}

export function AttentionDot() {
  return <View accessibilityLabel="Needs attention" style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.orange }} />;
}

/** Under the header's right edge. One waiting Chat opens on tap; several open a menu to pick one, oldest first. */
export function AttentionPill({ projectPath }: { projectPath: string }) {
  const { client, recent, cachedProject } = useSession();
  const insets = useSafeAreaInsets();
  const [enabled] = useAttentionButton();
  const waiting = useAttention().filter((key) => projectOfKey(key) !== projectPath);
  if (!enabled || !waiting.length || !client) return null;
  const name = (path: string) => recent.find((item) => item.path === path)?.name || path.split("/").at(-1) || "Project";
  const label = attentionLabel([...new Set(waiting.map(projectOfKey))].map(name));
  const open = (key: string) =>
    router.replace({ pathname: "/chat", params: { projectPath: projectOfKey(key), hostId: client.url, id: String(sessionIdFromKey(key)) } });
  const pill = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minHeight: 32,
        paddingHorizontal: 12,
        borderRadius: 16,
        borderCurve: "continuous",
        backgroundColor: colors.orangeTint,
      }}
    >
      <Text numberOfLines={1} style={{ color: colors.orange, fontSize: 13, fontWeight: "600", maxWidth: 220 }}>
        {label}
      </Text>
      <Icon icon={waiting.length > 1 ? ArrowDown01Icon : ArrowRight01Icon} tone="orange" size={14} strokeWidth={2} />
    </View>
  );
  const place = { position: "absolute" as const, top: insets.top + 52, right: 12 };
  if (waiting.length === 1)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}. Open the Chat.`}
        onPress={() => open(waiting[0])}
        style={({ pressed }) => [place, { opacity: pressed ? 0.6 : 1 }]}
      >
        {pill}
      </Pressable>
    );
  // A Project the phone hasn't loaded yet has no titles here, so its rows read "Chat".
  const items = waiting.map((key) => {
    const chat = cachedProject(projectOfKey(key))?.project.state.sessions[sessionIdFromKey(key)];
    return { id: key, title: chat?.title || chat?.generatedTitle || "Chat", subtitle: name(projectOfKey(key)) };
  });
  return (
    <PullDown label={`${label}. Choose a Chat.`} title="Waiting for you" sections={[{ items }]} onSelect={open} style={place}>
      {pill}
    </PullDown>
  );
}
