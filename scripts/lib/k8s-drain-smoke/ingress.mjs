import http from 'node:http';

// Fetch replaces Host in current Node releases. The local Ingress needs its
// virtual host while the TCP connection still goes to the explicit loopback URL.
// Native requests also never follow or replay redirects.
export function requestIngress(url, { method = 'GET', headers, body, signal } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method, headers, signal }, (incoming) => {
      const chunks = [];
      let size = 0;
      incoming.on('data', (chunk) => {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) request.destroy(new Error('Ingress response exceeds fixture bound'));
        else chunks.push(chunk);
      });
      incoming.on('error', reject);
      incoming.on('end', () => {
        const responseHeaders = new Headers();
        for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
          responseHeaders.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
        }
        resolve(new Response([204, 205, 304].includes(incoming.statusCode) ? null : Buffer.concat(chunks),
          { status: incoming.statusCode, headers: responseHeaders }));
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}
