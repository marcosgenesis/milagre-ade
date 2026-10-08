import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useSession } from "../session";
import { ProjectIcon } from "../project-icon";
import { ErrorNotice, PageScroll, colors, styles } from "../ui";

/** A checkbox per Project: unchecked ones leave the Projects list here and the all-Projects sidebar on the Mac. Links are always listed. */
export default function ChooseProjects() {
  const session = useSession();
  // By name, not by recency: opening a Project reorders the recent list, and a row must not move under the finger.
  const projects = session.recent
    .filter((item) => !item.link)
    .map((item) => ({ ...item, name: item.name || item.path.split("/").at(-1) || "Project" }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.path.localeCompare(b.path));
  // The choice shows at once; the Mac's answer replaces it, or a failure puts it back.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const shown = (path: string, hidden?: boolean) => !(pending[path] ?? hidden);
  async function toggle(path: string, show: boolean) {
    const client = session.client;
    if (!client) return;
    setError("");
    setPending((previous) => ({ ...previous, [path]: !show }));
    try {
      await client.call("project:set-hidden", [path, !show]);
      await session.reloadProjects();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "Could not change this setting.";
      setError(/not available from mobile|unknown command/i.test(message) ? "Update Milagre on your Mac to hide Projects from your phone." : message);
    } finally {
      setPending((previous) => {
        const next = { ...previous };
        delete next[path];
        return next;
      });
    }
  }
  const hiddenCount = projects.filter((project) => !shown(project.path, project.hidden)).length;
  return (
    <PageScroll style={styles.screen} contentContainerStyle={{ gap: 16, padding: 20 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ width: 52 }} />
        <Text accessibilityRole="header" style={{ flex: 1, textAlign: "center", color: colors.ink, fontSize: 17, fontWeight: "600" }}>
          Choose projects
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={{ minWidth: 52, minHeight: 44, alignItems: "flex-end", justifyContent: "center" }}
        >
          <Text style={[styles.text, { fontWeight: "600" }]}>Done</Text>
        </Pressable>
      </View>
      <Text style={styles.muted}>Checked Projects show in your Projects list, and in the sidebar on your Mac when it shows every Project.</Text>
      <View style={{ borderRadius: 12, backgroundColor: colors.surface, padding: 4 }}>
        {projects.map((project) => {
          const checked = shown(project.path, project.hidden);
          const name = project.name;
          return (
            <Pressable
              key={project.path}
              accessibilityRole="checkbox"
              accessibilityLabel={name}
              accessibilityState={{ checked }}
              onPress={() => void toggle(project.path, !checked)}
              style={({ pressed }) => ({
                height: 64,
                paddingHorizontal: 12,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                borderRadius: 8,
                backgroundColor: pressed ? colors.hover : "transparent",
              })}
            >
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 5,
                  borderWidth: checked ? 0 : 1.5,
                  borderColor: colors.ink3,
                  backgroundColor: checked ? colors.ink : "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {checked && <Text style={{ color: colors.surface, fontSize: 15, fontWeight: "600" }}>✓</Text>}
              </View>
              <ProjectIcon client={session.client} path={project.path} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text numberOfLines={1} style={[styles.text, { fontSize: 15, color: checked ? colors.ink : colors.ink3 }]}>
                  {name}
                </Text>
                <Text numberOfLines={1} ellipsizeMode="middle" style={styles.caption}>
                  {project.path}
                </Text>
              </View>
            </Pressable>
          );
        })}
        {!projects.length && <Text style={[styles.muted, { padding: 16 }]}>Open a Project on your Mac to list it here.</Text>}
      </View>
      {projects.length > 0 && <Text style={styles.caption}>{hiddenCount ? `${hiddenCount} hidden.` : "All Projects are shown."}</Text>}
      {error ? <ErrorNotice message={error} /> : null}
    </PageScroll>
  );
}
