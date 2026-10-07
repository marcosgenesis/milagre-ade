/** At most 15 stops spread across the full Chat, always keeping both ends. */
export function messageNavigationIndices(messageCount: number): number[] {
  const count = Math.min(messageCount, 15);
  return Array.from({ length: count }, (_, index) => (count > 1 ? Math.round((index * (messageCount - 1)) / (count - 1)) : 0));
}
