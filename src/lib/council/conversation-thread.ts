export function conversationMessages<T extends { id: string }>(
  messages: T[],
  thread: string | null,
): T[] {
  return thread
    ? messages.filter((message) => message.id.startsWith(`jc:${thread}:`))
    : messages;
}

export function savedConversationThread(run: string | number): string | null {
  try {
    const value = localStorage.getItem(`bmw-jury-thread:${run}`);
    return value && /^[a-f0-9-]{36}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function rememberConversationThread(
  run: string | number,
  thread: string,
) {
  try {
    localStorage.setItem(`bmw-jury-thread:${run}`, thread);
  } catch {
    /* The current conversation still works if browser storage is unavailable. */
  }
}
