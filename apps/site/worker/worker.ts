import { handleRequest } from "./handler.mjs";

interface Env {
  ASSETS: Fetcher;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, {
      assets: env.ASSETS,
      // Cache the GitHub release lookup at the edge for 5 minutes.
      fetchImpl: (input, init) => fetch(input, { ...init, cf: { cacheTtl: 300, cacheEverything: true } }),
    });
  },
} satisfies ExportedHandler<Env>;
