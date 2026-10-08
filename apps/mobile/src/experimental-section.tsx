import { useCallback, useState } from "react";
import { LINEAR_HINT, LINEAR_TITLE, linearStatusLine, type LinearStatus } from "@milagre/shared/linear";
import { Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSession } from "./session";
import { ErrorNotice, Toggle, styles } from "./ui";

/** Settings › Experimental: the connected Mac's experimental switches, like desktop's Experimental section. */
export function ExperimentalSection() {
  const session = useSession();
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
        ([value, status]) => live && setLinear({ enabled: value.enabled, status }),
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
  if (!session.client) return <Text style={styles.caption}>Connect to a Mac to change its experimental features.</Text>;
  return (
    <View style={{ gap: 8 }}>
      {linear !== null && (
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
