import { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GitBranchIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { currentChoice } from "../choice-store";
import { Icon } from "../icons";
import { colors, styles } from "../ui";
import { fonts } from "../theme";

function ChoiceSeparator() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginLeft: 40 }} />;
}

/** Long choice lists use a native sheet with the system search toolbar. */
export default function ChoiceSheet() {
  const [entry] = useState(currentChoice);
  const [query, setQuery] = useState("");
  const chosen = useRef<string | null>(null);
  const closing = useRef(false);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!entry) {
      router.back();
      return;
    }
    // Apply after dismissal, like the confirmation sheet: worktree selection changes the Chat's route params.
    return () => entry.choose(chosen.current);
  }, [entry]);
  if (!entry) return null;
  const search = query.trim().toLowerCase();
  const items = entry.items.filter((item) => item.title.toLowerCase().includes(search));
  const close = (id: string | null) => {
    if (closing.current) return;
    closing.current = true;
    chosen.current = id;
    router.back();
  };
  return (
    <>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        style={styles.screen}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: Math.max(insets.bottom, 16) }}
        ListHeaderComponent={
          <View style={{ paddingTop: 16, paddingBottom: 12 }}>
            <Text style={styles.caption}>
              {items.length} {items.length === 1 ? "result" : "results"}
            </Text>
          </View>
        }
        ItemSeparatorComponent={ChoiceSeparator}
        ListEmptyComponent={<Text style={[styles.muted, { paddingVertical: 24, textAlign: "center" }]}>{entry.emptyLabel}</Text>}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="radio"
            accessibilityLabel={item.subtitle ? `${item.title}. ${item.subtitle}` : item.title}
            accessibilityState={{ checked: !!item.checked, disabled: !!item.disabled }}
            disabled={item.disabled}
            onPress={() => close(item.id)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              minHeight: 60,
              paddingHorizontal: 10,
              paddingVertical: 14,
              borderRadius: 10,
              borderCurve: "continuous",
              backgroundColor: pressed ? colors.hover : item.checked ? colors.accentTint : "transparent",
              opacity: item.disabled ? 0.4 : 1,
            })}
          >
            <Icon icon={entry.icon ?? GitBranchIcon} tone={item.checked ? "accent" : "ink3"} size={18} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ color: colors.ink, fontFamily: fonts.mono, fontSize: 14, lineHeight: 21 }}>{item.title}</Text>
              {item.subtitle && (
                <Text numberOfLines={1} ellipsizeMode="middle" style={styles.caption}>
                  {item.subtitle}
                </Text>
              )}
            </View>
            <View style={{ width: 18 }}>{item.checked && <Icon icon={Tick02Icon} tone="accent" size={18} />}</View>
          </Pressable>
        )}
      />
      <Stack.Title>{entry.title}</Stack.Title>
      <Stack.SearchBar
        placeholder={entry.placeholder}
        placement="integrated"
        allowToolbarIntegration
        autoCapitalize="none"
        hideWhenScrolling={false}
        hideNavigationBar={false}
        obscureBackground={false}
        onChangeText={(event) => setQuery(event.nativeEvent.text)}
        onCancelButtonPress={() => setQuery("")}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="xmark" onPress={() => close(null)}>
          Close
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="bottom">
        <Stack.Toolbar.SearchBarSlot />
      </Stack.Toolbar>
    </>
  );
}
