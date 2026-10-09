import { useCallback, useState } from "react";
import { LINEAR_HINT, LINEAR_TITLE, linearStatusLine, type LinearStatus } from "@milagre/shared/linear";
import { Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useMuriloMode } from "./murilo-mode";
import { useUltracodeFatality } from "./ultracode-fatality-setting";
import { useSession } from "./session";
import { ErrorNotice, Toggle, styles } from "./ui";

/** Settings › Experimental: this phone's and the connected Mac's experimental switches, like desktop's Experimental section. */
export function ExperimentalSection() {
  const session = useSession();
  const [muriloMode, setMuriloMode] = useMuriloMode();
  const [fatality, setFatality] = useUltracodeFatality();
  // The Mac's Linear switch and connection; null until the Mac answers (an older Mac never does). Re-read on focus:
  // the phone gets no event when the Mac connects or disconnects.
  const [linear, setLinear] = useState<{ enabled: boolean; status: LinearStatus } | null>(null);
  const [linearError, setLinearError] = useState("");
  useFocusEffect(
    useCallback(() => {
      const client = session.client;
      if (!client) return;
      let live = true;
      Promise.all([client.call<{ enabled: boolean }>("linear:enabled:read", []), client.call<LinearStatus>("linear:status", [])]).then(
        // An older Mac answers null for commands it lacks: no Linear card.
        ([value, status]) => live && setLinear(value && status ? { enabled: value.enabled === true, status } : null),
        () => live && setLinear(null),
      );
      return () => {
        live = false;
      };
    }, [session.client]),
  );
  async function changeLinear(next: boolean) {
    const client = session.client;
    if (!client || !linear) return;
    setLinearError("");
    setLinear({ ...linear, enabled: next });
    try {
      const { enabled } = await client.call<{ enabled: boolean }>("linear:enabled:save", [next]);
      setLinear((current) => current && { ...current, enabled });
    } catch (failure) {
      setLinear((current) => current && { ...current, enabled: !next });
      setLinearError(failure instanceof Error ? failure.message : "Could not change this setting.");
    }
  }
  return (
    <View style={{ gap: 8 }}>
      {/* This phone's own switches, kept on the phone. */}
      <View style={[styles.card, { gap: 4 }]}>
        <Toggle title="Murilo mode" selected={muriloMode} onPress={() => setMuriloMode(!muriloMode)} />
        <Text style={styles.caption}>
          Shows every tool call in the Chat, one row each, with the agent&apos;s notes between them. Replies no longer fold their activity into one line.
        </Text>
      </View>
      <View style={[styles.card, { gap: 4 }]}>
        <Toggle title="Ultracode Fatality" selected={fatality} onPress={() => setFatality(!fatality)} />
        <Text style={styles.caption}>
          Turning Ultracode on darkens the screen and slams ULTRACODE across it Mortal Kombat style. The Mac also says it out loud.
        </Text>
      </View>
      {!session.client && <Text style={styles.caption}>Connect to a Mac to change its experimental features.</Text>}
      {session.client && linear !== null && (
        <View style={[styles.card, { gap: 4 }]}>
          <Toggle title={LINEAR_TITLE} selected={linear.enabled} onPress={() => void changeLinear(!linear.enabled)} />
          <Text style={styles.caption}>{LINEAR_HINT}</Text>
          {linear.enabled && <Text style={styles.caption}>{linearStatusLine(linear.status, "phone")}</Text>}
          {linearError ? <ErrorNotice message={linearError} /> : null}
        </View>
      )}
    </View>
  );
}
