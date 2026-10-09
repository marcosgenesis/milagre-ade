export type SyntaxKind = "plain" | "comment" | "keyword" | "string" | "number" | "function" | "type" | "tag" | "property" | "operator" | "punctuation";
export type SyntaxToken = { text: string; kind: SyntaxKind };
export const MAX_SYNTAX_CHARACTERS: number;
export function fileLanguage(path: string): string | undefined;
export function highlightFile(text: string, name: string): SyntaxToken[];
