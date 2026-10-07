// Focused native check: bundle this entry with Expo export:embed into an existing simulator app.
import { registerRootComponent } from "expo";
import { useState } from "react";
import { Keyboard, KeyboardAvoidingView, Pressable, Text, View } from "react-native";
import { PromptField } from "../../apps/mobile/src/prompt-field";
import { colors } from "../../apps/mobile/src/ui";
import type { Client } from "../../apps/mobile/src/client";

const catalog = {
  skills: [
    { name: "tldr", description: "Rewrite text for a skimming reader while preserving facts and voice." },
    { name: "docs", description: "Find documentation for a library or API." },
  ],
};
const immediate = { call: async () => catalog } as unknown as Client;
const delayed = { call: () => new Promise((resolve) => setTimeout(() => resolve(catalog), 5000)) } as unknown as Client;

function NativePromptSkills() {
  const [draft, setDraft] = useState("");
  const [client, setClient] = useState(immediate);
  const [sent, setSent] = useState("");
  const button = (title: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={{ padding: 12 }}>
      <Text style={{ color: colors.accentInk }}>{title}</Text>
    </Pressable>
  );
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.page, paddingTop: 80, paddingBottom: 40 }}>
      <View style={{ padding: 20, gap: 12 }}>
        <Text style={{ fontSize: 22, color: colors.ink }}>Skill composer</Text>
        <Text style={{ color: colors.ink2 }}>Type / to choose a skill.</Text>
        {button("Load catalog after 5 seconds", () => {
          setDraft("run /tldr");
          setClient(delayed);
        })}
        {button("Dismiss keyboard", Keyboard.dismiss)}
        <Text accessibilityLabel="Last sent message" style={{ color: colors.ink2 }}>
          {sent}
        </Text>
      </View>
      <View style={{ flex: 1 }} />
      <View style={{ marginHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface }}>
        <PromptField client={client} projectPath="/fixture" draft={draft} onChangeText={setDraft} />
        {button("Send message", () => {
          setSent(draft);
          setDraft("");
          Keyboard.dismiss();
        })}
      </View>
    </KeyboardAvoidingView>
  );
}

registerRootComponent(NativePromptSkills);
