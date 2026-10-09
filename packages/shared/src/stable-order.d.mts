export function stableOrder(previous: string[], next: string[]): string[];
export function keepOrder<T>(previous: T[], next: T[], keyOf: (item: T) => string): T[];
