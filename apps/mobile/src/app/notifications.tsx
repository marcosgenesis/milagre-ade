import { Linking, Text, View } from "react-native";
import { Stack } from "expo-router";
import { Notification01Icon } from "@hugeicons/core-free-icons";
import { useActivity } from "../live-activity";
import { usePush } from "../push";
import { useSession } from "../session";
import { Icon } from "../icons";
import { ErrorNotice, PageScroll, PillButton, PullDown, Toggle, colors, styles } from "../ui";

export default function NotificationsScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Notifications" }} />
      <NotificationsView />
    </>
  );
}

/** Notification controls for the native Settings stack. */
export function NotificationsView() {
  const push = usePush();
  const activity = useActivity();
  const session = useSession();
  const state = push.state;
  return (
    <PageScroll>
      <View style={[styles.card, { gap: 16 }]}>
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: colors.field, alignItems: "center", justifyContent: "center" }}>
            <Icon icon={Notification01Icon} size={24} tone="ink" />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={styles.subtitle}>Chat notifications</Text>
            <Text style={styles.muted}>{state?.enabled ? "On" : "Off"}</Text>
          </View>
        </View>
        <Text style={styles.text}>Know when an agent needs you or finishes a turn, even when Milagre is closed.</Text>
        <PillButton
          title={state?.enabled ? "Turn off notifications" : "Enable notifications"}
          secondary={state?.enabled}
          loading={push.busy}
          disabled={!state || push.busy || (!state.enabled && (!!push.unavailable || !session.hosts.length))}
          onPress={() => void (state?.enabled ? push.disable() : push.enable())}
        />
        {push.unavailable ? (
          <Text style={styles.muted}>{push.unavailable}</Text>
        ) : !session.hosts.length ? (
          <Text style={styles.muted}>Pair a computer to receive its Chat notifications.</Text>
        ) : null}
      </View>
      <View style={styles.card}>
        <Toggle
          title="Notify when waiting"
          selected={state?.notifyWhenWaiting ?? true}
          disabled={!state || push.busy}
          onPress={() => void push.preferences({ notifyWhenWaiting: !state?.notifyWhenWaiting })}
        />
        <Text style={styles.muted}>Approvals and questions that need your input.</Text>
        <View style={styles.separator} />
        <Toggle
          title="Notify when finished"
          selected={state?.notifyOnCompletion ?? true}
          disabled={!state || push.busy}
          onPress={() => void push.preferences({ notifyOnCompletion: !state?.notifyOnCompletion })}
        />
        <Text style={styles.muted}>Completed turns and turns that fail.</Text>
      </View>
      <View style={styles.card}>
        <Toggle
          title="Live Activities"
          selected={activity.enabled}
          disabled={activity.busy || !activity.available || !session.hosts.length}
          onPress={() => void activity.toggle()}
        />
        <Text style={styles.muted}>Chat activity and short question choices on your Lock Screen and Dynamic Island.</Text>
        <View style={styles.separator} />
        <Text style={styles.subtitle}>Show in Live Activities</Text>
        <PullDown
          label="Show in Live Activities"
          title="Show in Live Activities"
          sections={[
            {
              items: [
                { id: "all", title: "Running agents and questions", checked: activity.mode === "all" },
                { id: "questions", title: "Questions only", checked: activity.mode === "questions" },
              ],
            },
          ]}
          nativeTrigger={{
            title: activity.mode === "questions" ? "Questions only" : "Running agents and questions",
            systemImage: "list.bullet",
            disabled: activity.busy,
            maxWidth: 320,
          }}
          onSelect={(id) => {
            if (id === "all" || id === "questions") void activity.changeMode(id);
          }}
        >
          <Text style={styles.text}>{activity.mode === "questions" ? "Questions only" : "Running agents and questions"}</Text>
        </PullDown>
        <Text style={styles.muted}>
          {activity.mode === "questions"
            ? "Appears when a Chat needs your answer or approval. Hidden while agents are only running."
            : "Shows running agents, then questions and approvals when a Chat needs you."}
        </Text>
        {!activity.available ? <Text style={styles.muted}>Live Activities are unavailable in this build or disabled in system settings.</Text> : null}
        {activity.error ? <ErrorNotice message={activity.error} /> : null}
      </View>
      {push.error ? <ErrorNotice message={push.error} /> : null}
      {state?.pending.length ? (
        <Text style={styles.muted}>
          Removal is pending for {state.pending.map((host) => host.name).join(", ")}. Milagre will retry when you open the app and the computer is online.
        </Text>
      ) : null}
      <Text style={styles.muted}>
        Alerts include Chat previews. Expo, Apple and Google process notification content. Your computer must stay online to send alerts.
      </Text>
      <PillButton title="Open system settings" secondary onPress={() => void Linking.openSettings()} />
    </PageScroll>
  );
}
