import { Pressable, Text, View } from "react-native";
import type { ReactNode } from "react";
import * as Linking from "expo-linking";
import { CircleDotIcon, GitMergeIcon, GitPullRequestIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import type { PullRequest } from "@milagre/shared/model";
import { pullRequestPresentation, rowPullRequests } from "@milagre/shared/pr-blockers";
import { issueChipLabel, type LinearIssue } from "@milagre/shared/linear";
import { Icon } from "./icons";
import { colors, PullDown } from "./ui";

const icons = { merged: GitMergeIcon, ready: Tick02Icon, checking: CircleDotIcon, open: GitPullRequestIcon };

/** Desktop's two PR chips and overflow menu, with tap targets separate from the Chat title. The Worktree's Linear issue comes first. */
export function ChatPullRequestChips({
  pullRequests,
  linearIssue,
  children,
}: {
  pullRequests: PullRequest[];
  linearIssue?: LinearIssue;
  children?: ReactNode;
}) {
  if (!pullRequests.length && !linearIssue) return null;
  const ordered = rowPullRequests(pullRequests);
  const open = (url: string) => {
    if (url.startsWith("https://")) void Linking.openURL(url).catch(() => {});
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", columnGap: 8, paddingLeft: 42, paddingRight: 4 }}>
      {linearIssue && (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open Linear issue ${linearIssue.key}`}
          accessibilityHint={linearIssue.title}
          onPress={(event) => {
            event.stopPropagation();
            open(linearIssue.url);
          }}
          style={({ pressed }) => ({ minHeight: 24, flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 5, opacity: pressed ? 0.55 : 1 })}
        >
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: linearIssue.state.color }} />
          <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.ink2, fontSize: 12 }}>
            {issueChipLabel(linearIssue)}
          </Text>
        </Pressable>
      )}
      {ordered.slice(0, 2).map((pr) => {
        const { tone, icon, label } = pullRequestPresentation(pr);
        return (
          <Pressable
            key={pr.url}
            accessibilityRole="link"
            accessibilityLabel={`Open ${pr.state === "MERGED" ? "merged " : ""}pull request #${pr.number}${label ? `, ${label.toLowerCase()}` : ""}`}
            accessibilityHint={pr.title}
            onPress={(event) => {
              event.stopPropagation();
              open(pr.url);
            }}
            style={({ pressed }) => ({ minHeight: 24, flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 4, opacity: pressed ? 0.55 : 1 })}
          >
            <Icon icon={icons[icon]} tone={tone} size={12} />
            <Text style={{ color: colors.ink2, fontSize: 12, fontVariant: ["tabular-nums"] }}>#{pr.number}</Text>
            {pullRequests.length === 1 && !!label && (
              <Text numberOfLines={1} style={{ flexShrink: 1, color: colors[tone], fontSize: 12 }}>
                {label}
              </Text>
            )}
          </Pressable>
        );
      })}
      {ordered.length > 2 && (
        <PullDown
          label={`${ordered.length - 2} more pull requests`}
          title="Pull requests"
          sections={[{ items: ordered.map((pr) => ({ id: pr.url, title: `#${pr.number} · ${pr.title}` })) }]}
          onSelect={open}
        >
          <View style={{ minHeight: 24, justifyContent: "center" }}>
            <Text style={{ color: colors.ink2, fontSize: 12 }}>+{ordered.length - 2}</Text>
          </View>
        </PullDown>
      )}
      {children}
    </View>
  );
}
