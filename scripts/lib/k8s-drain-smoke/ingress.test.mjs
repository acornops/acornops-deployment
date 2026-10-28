import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { requestIngress } from './ingress.mjs';

test('ingress client preserves the virtual host and cookies without replaying redirects', async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ host: req.headers.host, origin: req.headers.origin, path: req.url });
    res.writeHead(307, { location: '/replayed', 'set-cookie': ['first=one; Path=/', 'second=two; Path=/'] });
    res.end('redirect');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await requestIngress(`http://127.0.0.1:${server.address().port}/submit`, {
      method: 'POST', redirect: 'manual', headers: { host: 'drain-example.localhost',
        origin: 'http://drain-example.localhost:18089' }, body: '{}', signal: AbortSignal.timeout(2000) });
    assert.deepEqual(requests, [{ host: 'drain-example.localhost',
      origin: 'http://drain-example.localhost:18089', path: '/submit' }]);
    assert.equal(response.status, 307);
    assert.equal(response.redirected, false);
    assert.deepEqual(response.headers.getSetCookie(), ['first=one; Path=/', 'second=two; Path=/']);
    assert.equal(await response.text(), 'redirect');
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

test('ingress client bounds an accepted response whose body never finishes', async () => {
  const server = http.createServer((req, res) => { res.writeHead(200); res.write('partial'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(async () => {
      const response = await requestIngress(`http://127.0.0.1:${server.address().port}/stall`, {
        signal: AbortSignal.timeout(50) });
      await response.text();
    }, /abort|timeout/i);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});
