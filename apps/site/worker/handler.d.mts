type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export declare const RELEASES_API: string;
export declare const RELEASES_PAGE: string;
export declare function latestDownload(
  target: string,
  fetchImpl: FetchLike,
  options?: { token?: string; timeoutMs?: number },
): Promise<string | null>;
export declare function handleRequest(
  request: Request,
  options: { assets: { fetch(request: Request): Promise<Response> }; fetchImpl: FetchLike; token?: string },
): Promise<Response>;
