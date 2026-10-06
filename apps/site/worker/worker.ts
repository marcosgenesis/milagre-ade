import { handleRequest } from "./handler.mjs";

interface Env {
  ASSETS: Fetcher;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, {
      assets: env.ASSETS,
      // Cache successful GitHub release lookups at the edge for 5 minutes; errors are not cached.
      fetchImpl: (input, init) => fetch(input, { ...init, cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": 300, "400-599": 0 } } }),
    });
  },
} satisfies ExportedHandler<Env>;
