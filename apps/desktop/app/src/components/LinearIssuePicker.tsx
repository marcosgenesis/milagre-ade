import { useEffect, useState, type CSSProperties } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { RefreshIcon } from "@hugeicons/core-free-icons";
import type { LinearIssue } from "@milagre/shared/linear";
import { LinearLogo } from "./ProviderLogo";
import { PickerPanel, PickerRow } from "./primitives/Picker";
import Tooltip from "./primitives/Tooltip";

type IssueList = { issues: LinearIssue[]; error?: string };

/** Placeholder rows the size of issue rows, filling the list's max height, so the panel opens at its full size instead of growing into it. */
function IssueSkeleton() {
  return (
    <div role="status" data-linear-issue-skeleton className="h-64 overflow-hidden">
      <span className="sr-only">Loading issues</span>
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} aria-hidden="true" className="flex items-center gap-2 px-2 py-1.5 motion-safe:animate-pulse">
          <span className="size-[13px] shrink-0 rounded-full bg-ink/10" />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="my-1 h-3 w-11/12 rounded bg-ink/10" />
            <span className="my-1 h-3 w-1/2 rounded bg-ink/10" />
            <span className="h-2.5 w-20 rounded bg-ink/5" />
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The "Start from a Linear issue" list: a search over the workspace's issues. Shared by the new-chat header and the
 * sidebar row's "Link issue…" menu item. A typed query waits 250 ms, and a stale answer is dropped. The Mac keeps the
 * assigned list for a minute, so reopening is instant; the refresh button reads it from Linear again.
 */
export function LinearIssuePicker({
  onPick,
  onClose,
  className = "absolute top-[calc(100%+0.375rem)] w-[420px] max-w-[calc(100vw-2rem)]",
  style,
  title = "Start from a Linear issue",
}: {
  onPick: (issue: LinearIssue) => void;
  onClose: () => void;
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  const [query, setQuery] = useState("");
  const [issues, setIssues] = useState<IssueList | null>(null);
  // Bumped by the refresh button; 0 reads whatever the Mac has kept.
  const [refreshes, setRefreshes] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let live = true;
    const text = query.trim();
    const fresh = refreshes > 0;
    const timer = window.setTimeout(
      () => {
        const show = (list: IssueList) => {
          if (!live) return;
          setIssues(list);
          setRefreshing(false);
        };
        Promise.resolve()
          .then(() => window.milagre.listLinearIssues(text || undefined, { fresh }))
          .then(
            (result) => show("error" in result ? { issues: [], error: result.error } : { issues: result.issues }),
            (error: unknown) => show({ issues: [], error: error instanceof Error ? error.message : String(error) }),
          );
      },
      text ? 250 : 0,
    );
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query, refreshes]);

  const issueRows = issues?.issues ?? [];

  return (
    <PickerPanel
      title={title}
      titleAction={
        <Tooltip label="Refresh issues" side="bottom" align="end">
          <button
            type="button"
            aria-label="Refresh issues"
            data-linear-issues-refresh
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true);
              setRefreshes((count) => count + 1);
            }}
            className="-my-1 flex size-6 items-center justify-center rounded-chip text-ink-3 transition-colors hover:bg-hover hover:text-ink disabled:cursor-default"
          >
            <span className={refreshing ? "animate-spin" : ""}>
              <HugeiconsIcon icon={RefreshIcon} size={13} strokeWidth={1.8} color="currentColor" />
            </span>
          </button>
        </Tooltip>
      }
      query={query}
      onQueryChange={setQuery}
      placeholder="Search issues"
      searchPlacement="bottom"
      emptyLabel={issues?.error ?? "No issues found."}
      isEmpty={issues !== null && issueRows.length === 0}
      className={className}
      style={style}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      {issues === null && <IssueSkeleton />}
      {issueRows.map((issue) => (
        <div key={issue.key} data-linear-issue-row>
          <PickerRow
            icon={<LinearLogo size={13} />}
            label={`${issue.key} ${issue.title}`}
            description={issue.state.name}
            selected={false}
            wrapLabel
            onClick={() => onPick(issue)}
          />
        </div>
      ))}
    </PickerPanel>
  );
}
