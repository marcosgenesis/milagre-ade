import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomWebView } from "@expo/dom-webview";
import { File, Paths } from "expo-file-system";
import { ArrowLeft01Icon, ArrowRight01Icon, Cancel01Icon, PaintBoardIcon } from "@hugeicons/core-free-icons";
import { artifactDocument, type Artifact } from "@milagre/shared/artifact";
import type { ArtifactStep } from "@milagre/shared/reply-parts";
import { useSession } from "./session";
import { Icon } from "./icons";
import { CircleButton, PillButton, colors, styles } from "./ui";

/** A design the agent showed. It opens full screen; a saved Chat is needed to read it from the computer. */
export function ArtifactCard({ step, chatId }: { step: ArtifactStep; chatId?: string }) {
  const { client } = useSession();
  const { id, version, title } = step.artifact;
  const openable = !!client && !!chatId && !chatId.includes("#new:");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Design ${title}, version ${version}. Open full screen`}
      disabled={!openable}
      onPress={() => router.push({ pathname: "/artifact-sheet", params: { hostId: client!.url, chatId: chatId!, id, version: String(version) } })}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 12,
        borderRadius: 14,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: pressed ? colors.hover : colors.surface,
        opacity: openable ? 1 : 0.6,
      })}
    >
      <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas }}>
        <Icon icon={PaintBoardIcon} tone="ink2" size={18} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 15, fontWeight: "500" }}>
          {title}
        </Text>
        <Text style={{ color: colors.ink3, fontSize: 12 }}>Design · version {version}</Text>
      </View>
      <Icon icon={ArrowRight01Icon} tone="ink3" size={16} />
    </Pressable>
  );
}

/** A design full screen, with its earlier versions a tap away. */
export function ArtifactSheet({ hostId, chatId, id, version }: { hostId?: string; chatId?: string; id?: string; version?: string }) {
  const { client } = useSession();
  const insets = useSafeAreaInsets();
  const source = client && chatId && id && (!hostId || hostId === client.url) ? client : null;
  const [shown, setShown] = useState<number | null>(version ? Number(version) : null);
  const [state, setState] = useState<{ artifact: Artifact | null; error: string }>({ artifact: null, error: "" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!source) return;
    let live = true;
    source
      .call<Artifact>("artifact:get", [{ chatId, id, ...(shown === null ? {} : { version: shown }) }])
      .then((artifact) => live && setState({ artifact, error: "" }))
      .catch((error: unknown) => live && setState({ artifact: null, error: error instanceof Error ? error.message : "Could not load this design." }));
    return () => {
      live = false;
    };
  }, [source, chatId, id, shown, revision]);
  const artifact = state.artifact;
  const current = artifact?.version ?? shown ?? 1;
  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: colors.page }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 8 }}>
        <CircleButton label="Previous version" icon={ArrowLeft01Icon} onPress={artifact && current > 1 ? () => setShown(current - 1) : undefined} />
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text accessibilityRole="header" numberOfLines={1} style={{ color: colors.ink, fontSize: 17, fontWeight: "600" }}>
            {artifact?.title ?? "Design"}
          </Text>
          {artifact && (
            <Text style={{ color: colors.ink3, fontSize: 11 }}>
              Version {artifact.version} of {artifact.latest}
            </Text>
          )}
        </View>
        <CircleButton label="Next version" icon={ArrowRight01Icon} onPress={artifact && current < artifact.latest ? () => setShown(current + 1) : undefined} />
        <CircleButton label="Close design" icon={Cancel01Icon} onPress={() => router.back()} />
      </View>
      <View style={{ flex: 1, paddingBottom: insets.bottom }}>
        {!source ? (
          <Text style={[styles.muted, { padding: 20 }]}>Reconnect to this Mac to open its designs.</Text>
        ) : state.error ? (
          <View style={{ padding: 20, gap: 16 }}>
            <Text accessibilityRole="alert" style={{ color: colors.red }}>
              {state.error}
            </Text>
            <PillButton title="Retry" onPress={() => setRevision((value) => value + 1)} />
          </View>
        ) : artifact ? (
          <ArtifactWebView key={`${artifact.id}:${artifact.version}`} html={artifact.html} />
        ) : (
          <Text style={[styles.muted, { padding: 20 }]}>Loading design...</Text>
        )}
      </View>
    </View>
  );
}

/**
 * The design from a cache file of its own, under the same policy as the desktop: no requests of its own, so it can't
 * send anything anywhere. The Expo modules bridge stays off, and nothing it posts is read.
 */
function ArtifactWebView({ html }: { html: string }) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const file = new File(Paths.cache, `artifact-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
    try {
      file.write(artifactDocument(html));
      setUri(file.uri);
    } catch {
      setFailed(true);
    }
    return () => {
      try {
        if (file.exists) file.delete();
      } catch {
        /* The OS may purge cache files while backgrounding. */
      }
    };
  }, [html]);
  if (failed)
    return (
      <Text accessibilityRole="alert" style={{ color: colors.red, padding: 20 }}>
        Could not prepare this design.
      </Text>
    );
  if (!uri) return null;
  return (
    <DomWebView
      source={{ uri }}
      style={{ flex: 1, backgroundColor: "#ffffff" }}
      containerStyle={{ flex: 1 }}
      useExpoModulesBridge={false}
      allowsInlineMediaPlayback
      automaticallyAdjustContentInsets={false}
      contentInsetAdjustmentBehavior="never"
      onContentProcessDidTerminate={() => setFailed(true)}
      onRenderProcessGone={() => setFailed(true)}
    />
  );
}
