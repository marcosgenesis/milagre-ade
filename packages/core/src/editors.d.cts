import type { EditorInfo } from '@milagre/shared/model';
export interface DetectedEditor extends EditorInfo { appPath: string | null; cli: string | null }
export interface EditorRequest { root: string; path?: string; line?: number; editor?: string }
export function detectEditors(): Promise<DetectedEditor[]>;
export function requireWorktreeRoot(root: string): Promise<void>;
export function openInEditor(request: EditorRequest, options: { editors: DetectedEditor[]; checkRoot?: (root: string) => Promise<void | string[]> }): Promise<string | null>;
