// A comment or a choice made on the design sheet, waiting for its Chat's screen to send it as the user's message: the
// Chat screen owns sending (its draft, pending and error states), so the sheet hands the text over and goes back.
const waiting = new Map<string, string>();

export function postDesignMessage(chatKey: string, text: string) {
  waiting.set(chatKey, text);
}

/** The message waiting for this Chat, once: taking it removes it. */
export function takeDesignMessage(chatKey: string): string | null {
  const text = waiting.get(chatKey) ?? null;
  waiting.delete(chatKey);
  return text;
}
