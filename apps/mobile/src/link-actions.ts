import { BubbleChatIcon } from "@hugeicons/core-free-icons";
import type { CanvasLink } from "@milagre/shared/chat-links";
import type { Client } from "./client";
import { REMOVE_LINK, createChatLink, linkChatKey, linkNoticeIsProblem, linkPickerItems, removeChatLink, type LinkChat } from "./chat-links";
import { showChoiceSheet } from "./choice-store";
import { confirm, confirmSheet } from "./confirm-store";
import { askLinkChoice } from "./link-chat-store";
import { refreshLinks, setLinks } from "./use-links";

/**
 * "Link with…" from a Chat's ⋯ menu: pick the other Chat in the searchable sheet, confirm how to link them, then make
 * the Link (and grant and ask, when chosen). Each sheet opens once the one before it has gone. After "Create Link and
 * ask" sent its message, `onAsked` opens the source Chat, as desktop does, so the message and the reply are in view.
 */
export function linkWithChat({
  client,
  links,
  source,
  chats,
  send,
  notify,
  onAsked,
}: {
  client: Client;
  links: readonly CanvasLink[];
  source: LinkChat;
  chats: readonly LinkChat[];
  send: (message: { body: string; prompt: string }) => Promise<unknown>;
  notify: (notice: string) => void;
  onAsked?: () => void;
}) {
  showChoiceSheet({
    title: "Link with…",
    placeholder: "Search chats",
    emptyLabel: "No other chats to link.",
    icon: BubbleChatIcon,
    items: linkPickerItems(links, source, chats),
    onSelect: (id) => {
      const target = chats.find((chat) => linkChatKey(chat) === id);
      if (target) void confirmLink({ client, source, target, send, notify, onAsked });
    },
  });
}

async function confirmLink({
  client,
  source,
  target,
  send,
  notify,
  onAsked,
}: {
  client: Client;
  source: LinkChat;
  target: LinkChat;
  send: (message: { body: string; prompt: string }) => Promise<unknown>;
  notify: (notice: string) => void;
  onAsked?: () => void;
}) {
  const choice = await askLinkChoice(source, target);
  if (!choice) return;
  const result = await createChatLink({ call: client.call, source, target, choice, send });
  // No Link made: what this phone showed may be out of date (a Link made or removed elsewhere), so read them again.
  if (result.links) setLinks(client, result.links);
  else void refreshLinks(client);
  if (linkNoticeIsProblem(result.notice)) notify(result.notice);
  else if (choice.text.trim()) onAsked?.();
}

/** "Remove Link with…": pick one of the Chat's Links by its other end, confirm, and remove it. */
export async function removeLinkFromChat({
  client,
  ends,
  notify,
}: {
  client: Client;
  ends: readonly { link: CanvasLink; label: string }[];
  notify: (notice: string) => void;
}) {
  if (!ends.length) return;
  const linkId = await new Promise<string | null>((resolve) =>
    confirmSheet("Remove Link with…", undefined, [
      ...ends.map(({ link, label }) => ({ text: label, onPress: () => resolve(link.id) })),
      { text: "Cancel", style: "cancel" as const, onPress: () => resolve(null) },
    ]),
  );
  if (!linkId || !(await confirm(REMOVE_LINK.title, REMOVE_LINK.message, REMOVE_LINK.action))) return;
  const result = await removeChatLink(client.call, linkId);
  // A Link already gone (removed on the Mac) fails here: read the Links again so its icon goes too.
  if (result.links) setLinks(client, result.links);
  else void refreshLinks(client);
  if (linkNoticeIsProblem(result.notice)) notify(result.notice);
}
