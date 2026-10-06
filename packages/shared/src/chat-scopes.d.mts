import type { ChatScope } from './model.ts';
export function validLinkId(id: unknown): id is string;
export function isLinkScopeKey(key: unknown): key is string;
export function scopeKey(scope: ChatScope): string;
export function scopeFromKey(key: string): ChatScope;
export function chatKeyForScope(scope: ChatScope, sessionId: number): string;
export function scopeFromChatKey(key: string): ChatScope;
