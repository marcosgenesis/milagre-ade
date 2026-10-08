import { PROVIDERS, providerName } from "@milagre/shared/providers";
import { effortFor } from "@milagre/shared/model-options";
import { effortCopy } from "@milagre/shared/model-copy";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Cancel01Icon, FlashIcon, Tick02Icon, UserMultipleIcon } from "@hugeicons/core-free-icons";
import type { ModelProvider } from "@milagre/shared/model";
import { useComposer, useSession } from "../session";
import { modelsFor, selectedModel, type TurnPreferences } from "../turn-options";
import { EffortMeter, Icon, ProviderLogo } from "../icons";
import { CircleButton, colors, styles } from "../ui";

/** Model, thinking effort, Ultracode and fast mode for one Chat. Cancel (✕) discards, Done (✓) applies, per Apple's sheet guidance. */
export default function ModelSheet() {
  const params = useLocalSearchParams<{ chatId: string; model?: string; provider?: string; busy?: string }>();
  const session = useSession();
  const composer = useComposer();
  const navigation = useNavigation();
  const saved = composer.preferences[params.chatId] || composer.defaults;
  const initial: TurnPreferences = { ...saved, provider: (params.provider as ModelProvider | undefined) || saved.provider, model: params.model || saved.model };
  const [draft, setDraft] = useState<TurnPreferences>(initial);
  const busy = params.busy === "1";
  const model = selectedModel(draft.provider, draft.model, session.models);
  const models = modelsFor(draft.provider, session.models);
  if (!models.some((item) => item.id === model.id)) models.unshift(model);
  const effort = effortFor(model, draft.effort);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const [closing, setClosing] = useState(false);
  usePreventRemove(dirty && !closing, ({ data }) =>
    Alert.alert("Discard changes?", "Your model and effort picks will not be applied.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(data.action) },
    ]),
  );
  const close = (apply: boolean) => {
    if (apply) composer.setPreferences((current) => ({ ...current, [params.chatId]: { ...draft, model: model.id } }));
    setClosing(true);
    setTimeout(() => router.back(), 0);
  };
  const cli = session.cliStatus?.[draft.provider];
  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 40 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 8,
          backgroundColor: colors.page,
        }}
      >
        <CircleButton label="Cancel" icon={Cancel01Icon} onPress={() => close(false)} />
        <Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 17, fontWeight: "600" }}>
          Model
        </Text>
        <CircleButton label="Done" icon={Tick02Icon} filled onPress={() => close(true)} />
      </View>
      <View style={{ padding: 16, paddingTop: 8, gap: 16 }}>
        {busy && <Text style={styles.caption}>Changes apply to your next message. This turn keeps its settings.</Text>}
        <View
          accessibilityRole="tablist"
          style={{ flexDirection: "row", padding: 3, gap: 3, borderRadius: 11, borderCurve: "continuous", backgroundColor: colors.canvas }}
        >
          {PROVIDERS.map((provider) => {
            const on = provider === draft.provider;
            return (
              <Pressable
                key={provider}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => setDraft((current) => ({ ...current, provider, model: "", fastMode: false, ultracode: false }))}
                style={{
                  flex: 1,
                  height: 36,
                  borderRadius: 8,
                  borderCurve: "continuous",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  backgroundColor: on ? colors.surface : "transparent",
                  boxShadow: on ? "0 1px 3px #0000001a" : undefined,
                }}
              >
                <ProviderLogo provider={provider} size={14} tone={on ? "ink" : "ink3"} />
                <Text style={{ color: on ? colors.ink : colors.ink3, fontSize: 13, fontWeight: "600" }}>{providerName(provider)}</Text>
                <Text style={{ color: colors.ink3, fontSize: 11 }}>{modelsFor(provider, session.models).length}</Text>
              </Pressable>
            );
          })}
        </View>
        {cli && cli.state !== "ready" && (
          <Text style={[styles.caption, { color: colors.orange }]}>{cli.message || `${providerName(draft.provider)} is ${cli.state}.`}</Text>
        )}
        <View style={[styles.card, { paddingVertical: 0, paddingHorizontal: 14, gap: 0 }]}>
          {models.map((item, index) => (
            <View key={item.id}>
              {index > 0 && <View style={styles.separator} />}
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: item.id === model.id }}
                onPress={() => setDraft((current) => ({ ...current, model: item.id }))}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, opacity: pressed ? 0.5 : 1 })}
              >
                <ProviderLogo provider={item.provider} size={16} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "500" }}>{item.name}</Text>
                  {!!item.description && <Text style={styles.caption}>{item.description}</Text>}
                </View>
                {item.id === model.id && <Icon icon={Tick02Icon} tone="ink" size={18} strokeWidth={2.2} />}
              </Pressable>
            </View>
          ))}
        </View>
        {model.efforts.length > 0 && (
          <View style={{ gap: 8 }}>
            <Text style={styles.section}>Thinking effort</Text>
            <View
              accessibilityRole="radiogroup"
              style={{ flexDirection: "row", padding: 3, gap: 3, borderRadius: 14, borderCurve: "continuous", backgroundColor: colors.canvas }}
            >
              {model.efforts.map((level, index) => {
                const on = level === effort;
                return (
                  <Pressable
                    key={level}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${effortCopy(level).name}. ${effortCopy(level).description}`}
                    onPress={() => setDraft((current) => ({ ...current, effort: level }))}
                    style={{
                      flex: 1,
                      alignItems: "center",
                      gap: 6,
                      paddingVertical: 9,
                      borderRadius: 11,
                      borderCurve: "continuous",
                      backgroundColor: on ? colors.surface : "transparent",
                      boxShadow: on ? "0 1px 3px #0000001a" : undefined,
                    }}
                  >
                    <EffortMeter level={index} total={model.efforts.length} tone={on ? "ink" : "ink3"} />
                    <Text numberOfLines={1} style={{ color: on ? colors.ink : colors.ink3, fontSize: 11, fontWeight: on ? "600" : "500" }}>
                      {effortCopy(level).name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {effort && (
              <Text style={styles.caption}>
                {effortCopy(effort).name} · {effortCopy(effort).description}
              </Text>
            )}
          </View>
        )}
        {model.ultracode && (
          <ToggleRow
            icon={UserMultipleIcon}
            title="Ultracode"
            detail="Splits big work across parallel agents, at this effort"
            value={!!draft.ultracode}
            onChange={(value) => setDraft((current) => ({ ...current, ultracode: value }))}
          />
        )}
        {model.fastMode && (
          <ToggleRow
            icon={FlashIcon}
            title="Fast mode"
            detail="Faster replies at higher usage rates"
            value={draft.fastMode}
            onChange={(value) => setDraft((current) => ({ ...current, fastMode: value }))}
          />
        )}
      </View>
    </ScrollView>
  );
}

function ToggleRow({
  icon,
  title,
  detail,
  value,
  onChange,
}: {
  icon: typeof FlashIcon;
  title: string;
  detail: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14 }]}>
      <Icon icon={icon} tone={value ? "ink" : "ink2"} size={18} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "500" }}>{title}</Text>
        <Text style={styles.caption}>{detail}</Text>
      </View>
      <Switch accessibilityLabel={title} value={value} onValueChange={onChange} />
    </View>
  );
}
