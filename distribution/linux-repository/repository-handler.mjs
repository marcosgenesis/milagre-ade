// All paths and upstream URLs come from signed, generated release metadata.
// Never derive a GitHub URL from the incoming request.
export function createRepositoryWorker(metadata, packages, upstreamFetch = fetch) {
  return {
    async fetch(request) {
      if (!['GET', 'HEAD'].includes(request.method)) {
        return new Response('Method not allowed\n', { status: 405, headers: { Allow: 'GET, HEAD' } });
      }
      const url = new URL(request.url);
      const pathname = url.pathname;
      const rawPath = request.url.match(/^https?:\/\/[^/?#]+([^?#]*)/i)?.[1] || '/';
      if (rawPath !== pathname || url.search || url.href.includes('?') || /[%\\]/.test(pathname) || pathname.includes('//') || pathname.split('/').some(part => part === '.' || part === '..')) {
        return new Response('Not found\n', { status: 404 });
      }
      if (Object.hasOwn(metadata, pathname)) {
        const entry = metadata[pathname];
        const bytes = Uint8Array.from(atob(entry.base64), character => character.charCodeAt(0));
        const headers = new Headers({
          'Content-Type': entry.type,
          'Content-Length': String(bytes.byteLength),
          'Cache-Control': 'public, max-age=60, must-revalidate',
          'X-Content-Type-Options': 'nosniff',
          ETag: `"${entry.sha256}"`,
        });
        if (request.headers.get('If-None-Match')?.split(',').map(value => value.trim().replace(/^W\//, '')).some(value => value === '*' || value === headers.get('ETag'))) {
          headers.delete('Content-Length');
          return new Response(null, { status: 304, headers });
        }
        return new Response(request.method === 'HEAD' ? null : bytes, { headers });
      }
      if (!Object.hasOwn(packages, pathname)) return new Response('Not found\n', { status: 404 });
      const entry = packages[pathname];
      const headers = new Headers();
      for (const name of ['Range', 'If-Range', 'If-None-Match', 'If-Modified-Since']) {
        const value = request.headers.get(name);
        if (value !== null) headers.set(name, value);
      }
      let response;
      try {
        response = await upstreamFetch(entry.url, { method: request.method, headers, redirect: 'follow' });
      } catch {
        return new Response('Release asset unavailable\n', { status: 502 });
      }
      if (![200, 206, 304, 416].includes(response.status)) {
        await response.body?.cancel();
        return new Response('Release asset unavailable\n', { status: 502 });
      }
      const outgoing = new Headers({ 'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
      for (const name of ['Content-Length', 'Content-Range', 'Content-Encoding', 'Accept-Ranges', 'ETag', 'Last-Modified']) {
        const value = response.headers.get(name);
        if (value !== null) outgoing.set(name, value);
      }
      // Clients authenticate package bytes using signed APT checksums or RPM signatures.
      outgoing.set('Cache-Control', 'public, max-age=86400');
      return new Response(request.method === 'HEAD' || response.status === 304 ? null : response.body, { status: response.status, headers: outgoing });
    },
  };
}
