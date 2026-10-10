// MIT. One focused live Node HTTP regression of the actual SF12 listener.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createSupportedServer } from '../supported.mjs';

const send = (port, host, path = '/supported') => new Promise((resolve, reject) => {
  const req = request({
    hostname: '127.0.0.1', port, path, method: 'GET',
    setHost: host !== null, headers: host === null ? undefined : host
  }, res => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => resolve({status: res.statusCode, body}));
  });
  req.on('error', reject);
  req.end();
});

test('SF12 real /supported HTTP refuses DNS rebinding and invalid Host authority', async () => {
  // The Host boundary is orthogonal to trusted SDK and RPC readiness. No paid
  // network or mock chain receipt is involved.
  const gateway = {snapshot: async () => ({
    ready: true,
    supported: {kinds: [], extensions: [], signers: {'stellar:*': []}},
    assetManifest: {x402Version: 2, assets: []}
  })};
  const server = createSupportedServer({gateway});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    for (const authority of [
      '127.0.0.1:' + port, 'localhost:' + port, 'localhost', 'LOCALHOST:' + port
    ]) {
      assert.equal((await send(port, {'Host': authority})).status, 200, authority);
    }
    for (const authority of [
      'attacker.example', 'attacker.example:' + port,
      '127.0.0.1.attacker.example:' + port,
      '127.0.0.1.', '[::1].attacker.example:' + port,
      '127.0.0.1:' + (port + 1), 'localhost:00080', 'localhost:0',
      'localhost:65536', 'localhost:1@attacker.example', '[::1', '::1'
    ]) {
      for (const path of ['/supported', '/supported/assets', '/health']) {
        const response = await send(port, {'Host': authority}, path);
        assert.equal(response.status, 403, authority + ' ' + path);
        assert.deepEqual(JSON.parse(response.body), {error: 'LOCAL_HOST_REQUIRED'});
      }
    }
    assert.notEqual((await send(port, null)).status, 200, 'no Host fails closed');
    const duplicate = [['Host', '127.0.0.1:' + port], ['hOsT', 'attacker.example:' + port]];
    assert.notEqual((await send(port, duplicate)).status, 200, 'duplicate Host fails closed');
    assert.equal((await send(port, {'Host': 'localhost:' + port}, '/bogus')).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
