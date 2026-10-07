export type DiffMode = "uncommitted" | "committed";

export type DiffFileEntry = {
  /** The new path, relative to the chat's folder. */
  path: string;
  /** Renames only. */
  oldPath?: string;
  status: "added" | "deleted" | "modified" | "renamed";
  added: number;
  removed: number;
  binary: boolean;
  untracked?: boolean;
};

/** `base` is the branch name `committed` compares with, null for `uncommitted` or when there is none. `message` explains an empty list (no shared history with the base). */
export type DiffFilesResult = { isRepo: false; message: string } | { isRepo: true; base: string | null; files: DiffFileEntry[]; message?: string };

/** `patch` is empty when the file is binary or `tooLarge` (over 1 MB). */
export type DiffFileResult = { patch: string; binary: boolean; tooLarge: boolean };
