export type IpcError = { code: string; message: string };
export type Result<T, E extends IpcError = IpcError> = { ok: true; value: T } | { ok: false; error: E };
export function ipcErrorMessage(error: unknown): string;
export function ipcErrorCode(error: unknown): string | undefined;
