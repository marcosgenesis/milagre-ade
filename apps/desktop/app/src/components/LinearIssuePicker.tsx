import { useEffect, useState, type CSSProperties } from "react";
import type { LinearIssue } from "@milagre/shared/linear";
import { LinearLogo } from "./ProviderLogo";
import { PickerPanel, PickerRow } from "./primitives/Picker";

type IssueList = { issues: LinearIssue[]; error?: string };

/**
 * The "Start from a Linear issue" list: a search over the workspace's issues. Shared by the new-chat header and the
 * sidebar row's "Link issue…" menu item. A typed query waits 250 ms, and a stale answer is dropped.
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

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      Promise.resolve()
        .then(() => window.milagre.listLinearIssues(query.trim() || undefined))
        .then(
          (result) => {
            if (live) setIssues("error" in result ? { issues: [], error: result.error } : { issues: result.issues });
          },
          (error: unknown) => {
            if (live) setIssues({ issues: [], error: error instanceof Error ? error.message : String(error) });
          },
        );
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const issueRows = issues?.issues ?? [];

  return (
    <PickerPanel
      title={title}
      query={query}
      onQueryChange={setQuery}
      placeholder="Search issues"
      searchPlacement="bottom"
      emptyLabel={issues ? (issues.error ?? "No issues found.") : "Loading issues…"}
      isEmpty={issueRows.length === 0}
      className={className}
      style={style}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
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
