import { useState } from "react";
import { Text, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useSession } from "../session";
import { ProjectIcon, setProjectImage } from "../project-icon";
import { ErrorNotice, PageScroll, PillButton, styles } from "../ui";

// Same size as desktop's: the icon is shown small everywhere, and the computer keeps it under 450 KB.
async function pickIcon() {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1] });
  if (result.canceled) return undefined;
  const asset = result.assets[0];
  const context = ImageManipulator.manipulate(asset.uri);
  context.resize(asset.width > asset.height ? { width: Math.min(asset.width, 256) } : { height: Math.min(asset.height, 256) });
  const rendered = await context.renderAsync();
  const icon = await rendered.saveAsync({ format: SaveFormat.PNG, base64: true });
  context.release();
  rendered.release();
  if (!icon.base64) throw new Error("Could not read this photo.");
  return `data:image/png;base64,${icon.base64}`;
}

export default function ProjectSettingsScreen() {
  const session = useSession();
  const { path, name } = useLocalSearchParams<{ path: string; name?: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const client = session.client;
  if (!client || !path) return <Redirect href="/" />;
  async function save(icon: () => Promise<string | null | undefined>) {
    setBusy(true);
    setError("");
    try {
      const chosen = await icon();
      if (chosen !== undefined) setProjectImage(client!, path, await client!.call<string | null>("project:set-icon", [path, chosen]));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not change the icon.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Stack.Screen options={{ title: name || "Project" }} />
      <PageScroll>
        <Text style={styles.label}>Icon</Text>
        <View style={[styles.card, { alignItems: "center", gap: 16 }]}>
          <ProjectIcon client={client} path={path} size={72} />
          <Text style={[styles.caption, { textAlign: "center" }]}>
            Shown in your Projects list and on the desktop app. Reset goes back to the repository&apos;s own icon.
          </Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <PillButton title="Choose photo" loading={busy} onPress={() => void save(pickIcon)} />
            <PillButton title="Reset" secondary disabled={busy} onPress={() => void save(async () => null)} />
          </View>
        </View>
        {error ? <ErrorNotice message={error} /> : null}
      </PageScroll>
    </>
  );
}
