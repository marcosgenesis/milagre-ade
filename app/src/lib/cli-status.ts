import type { CliState, CliStatus } from "../model";

const TAB_LABELS: Record<Exclude<CliState, "ready">, string> = {
  missing: "Not installed",
  outdated: "Update",
  "logged-out": "Log in",
  broken: "Not working",
};

/** The short label that replaces a provider tab's model count, or null when the CLI is fine (or not known yet). */
export function cliTabLabel(status: CliStatus | null | undefined): string | null {
  return status && status.state !== "ready" ? TAB_LABELS[status.state] : null;
}

/** The full message the picker shows above the model rows, or null when there is nothing to flag. */
export function cliNotice(status: CliStatus | null | undefined): string | null {
  return status && status.state !== "ready" && status.message ? status.message : null;
}

/** A message split at its `backtick` spans, so commands can be set as code. */
export function messageParts(message: string): Array<{ text: string; code: boolean }> {
  return message.split(/`([^`]*)`/).flatMap((text, index) => (text ? [{ text, code: index % 2 === 1 }] : []));
}
