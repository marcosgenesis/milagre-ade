import { useState } from "react";
import { Pressable, Text } from "react-native";
import { ArrowDown01Icon, ArrowRight01Icon, File01Icon } from "@hugeicons/core-free-icons";
import type { DiffFileEntry } from "@milagre/shared/git-diff";
import type { DiffTreeNode } from "@milagre/shared/diff-tree";
import { Icon } from "./icons";
import { Counts, StatusBox } from "./diff-ui";
import { colors, styles } from "./ui";

export function ChangeTree({ nodes, depth, onOpen }: { nodes: DiffTreeNode<DiffFileEntry>[]; depth: number; onOpen: (file: DiffFileEntry) => void }) {
  return (
    <>
      {nodes.map((node) => (
        <TreeRow key={node.path} node={node} depth={depth} onOpen={onOpen} />
      ))}
    </>
  );
}

function TreeRow({ node, depth, onOpen }: { node: DiffTreeNode<DiffFileEntry>; depth: number; onOpen: (file: DiffFileEntry) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const row = { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingLeft: 12 + depth * 14, paddingRight: 14 } as const;
  if (node.type === "file")
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${node.name}, ${node.file.status}`}
        onPress={() => onOpen(node.file)}
        style={({ pressed }) => [row, { backgroundColor: pressed ? colors.hover : "transparent" }]}
      >
        <Icon icon={File01Icon} tone="ink3" size={16} strokeWidth={1.6} />
        <Text numberOfLines={1} ellipsizeMode="middle" style={[styles.text, { flex: 1, fontSize: 15 }]}>
          {node.name}
        </Text>
        {!node.file.binary && <Counts added={node.file.added} removed={node.file.removed} />}
        <StatusBox status={node.file.status} />
      </Pressable>
    );
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${node.name} folder`}
        accessibilityState={{ expanded: !collapsed }}
        onPress={() => setCollapsed((value) => !value)}
        style={({ pressed }) => [row, { backgroundColor: pressed ? colors.hover : "transparent" }]}
      >
        <Icon icon={collapsed ? ArrowRight01Icon : ArrowDown01Icon} tone="ink3" size={15} />
        <Text numberOfLines={1} ellipsizeMode="head" style={{ flex: 1, color: colors.ink2, fontSize: 15 }}>
          {node.name}
        </Text>
        <Counts added={node.added} removed={node.removed} />
      </Pressable>
      {!collapsed && <ChangeTree nodes={node.children} depth={depth + 1} onOpen={onOpen} />}
    </>
  );
}
