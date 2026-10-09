const { searchMessages } = require("@milagre/shared/message-search");

// What a client reads of a Chat when it doesn't hold every message (#300 phase 3): the latest turns first, then older
// pages on a cursor, and search across the Project's Chats done by the host.

/**
 * Messages of Chat `chatId` before the message `before` (the oldest one the client holds; the end of the Chat without
 * it), going back `turns` of the user's messages and at most `limit` messages. In the Project's order.
 */
function chatPage(messages, chatId, { before, turns = 10, limit = 75 } = {}) {
  const chat = messages.filter((message) => message.session_id === chatId);
  let end = chat.length;
  if (before !== undefined && before !== null) {
    const at = chat.findIndex((message) => message.id === before);
    if (at >= 0) end = at;
  }
  let start = end;
  let seen = 0;
  while (start > 0 && end - start < limit) {
    start--;
    if (chat[start].role === "user" && ++seen >= turns) break;
  }
  return { messages: chat.slice(start, end), hasMore: start > 0, total: chat.length };
}

/** Matches for `query` across the Chats of `sessions` that aren't archived, best first: where they are and what matched. */
function chatSearch(state, query, { limit = 200 } = {}) {
  const messages = state.messages.filter((message) => state.sessions[message.session_id] && !state.sessions[message.session_id].archived);
  return searchMessages(messages, String(query ?? ""), limit).map(({ message, score, snippet, highlight, term }) => ({
    message: { id: message.id, session_id: message.session_id },
    score,
    snippet,
    highlight,
    term,
  }));
}

module.exports = { chatPage, chatSearch };
