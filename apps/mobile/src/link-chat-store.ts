import type { LinkChat, LinkChoice } from "./chat-links";

/** The "Create Link" confirmation waiting for its sheet; `choose` runs once, with the choice or null when dismissed. */
export type LinkQuestion = { source: LinkChat; target: LinkChat; choose: (choice: LinkChoice | null) => void };

let current: LinkQuestion | null = null;
let present: (() => void) | null = null;

/** The app's root wires this to open the sheet route; a route can't carry callbacks, so the question waits here. */
export function setLinkPresenter(open: () => void) {
  present = open;
}
export function currentLinkQuestion() {
  return current;
}

/** Asks how to link the two Chats; resolves null when the sheet is dismissed. A newer question dismisses an older one. */
export function askLinkChoice(source: LinkChat, target: LinkChat) {
  current?.choose(null);
  return new Promise<LinkChoice | null>((resolve) => {
    let done = false;
    const entry: LinkQuestion = {
      source,
      target,
      choose(choice) {
        if (done) return;
        done = true;
        if (current === entry) current = null;
        resolve(choice);
      },
    };
    current = entry;
    present?.();
  });
}
