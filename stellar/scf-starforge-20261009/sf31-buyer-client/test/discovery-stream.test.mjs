// MIT. Real Node 22 HTTP stream regressions for the SF31 catalog reader.
// No signer, payment, RPC, wallet, or hosted GitHub Actions used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { X402BuyerClient, BuyerError } from '../buyer.mjs';

test('discovery streams are byte-bounded, UTF-8 strict, and preserve valid split metadata', async (t) => {
  let mode = 'valid';
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (mode === 'valid') {
      const bytes = Buffer.from(JSON.stringify({
        resources: [{ resource: { url: 'https://example.com/paid', description: 'José' } }],
        pagination: { offset: 0, limit: 20, total: 1 }
      }));
      const boundary = bytes.indexOf(0xc3); // Split inside UTF-8 é.
      assert.ok(boundary >= 0);
      res.write(bytes.subarray(0, boundary + 1));
      res.end(bytes.subarray(boundary + 1));
    } else if (mode === 'too-large') {
      // Transfer-Encoding: chunked, no Content-Length to trust.
      const prefix = '{"resources":[{"description":"';
      res.write(prefix);
      for (let i = 0; i < 80; i++) res.write('x'.repeat(4096));
      res.end('"}],"pagination":{"offset":0,"limit":20,"total":1}}');
    } else if (mode === 'invalid-utf8') {
      res.end(Buffer.from([123, 34, 120, 34, 58, 34, 195, 40, 34, 125]));
    } else {
      res.end('{"resources":');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const buyer = new X402BuyerClient({ allowLocal: true });
    const origin = 'http://127.0.0.1:' + server.address().port;
    await t.test('valid split UTF-8 discovery', async () => {
      mode = 'valid';
      const reply = await buyer.discover({ origin });
      assert.equal(reply.resources[0].resource.description, 'José');
      assert.equal(reply.pagination.total, 1);
    });
    await t.test('oversize chunked response rejected during streaming', async () => {
      mode = 'too-large';
      await assert.rejects(buyer.discover({ origin }), e =>
        e instanceof BuyerError && e.code === 'DISCOVERY_RESPONSE_TOO_LARGE');
    });
    await t.test('invalid UTF-8 rejected instead of silent replacement', async () => {
      mode = 'invalid-utf8';
      await assert.rejects(buyer.discover({ origin }), e =>
        e instanceof BuyerError && e.code === 'BAD_DISCOVERY_RESPONSE');
    });
    await t.test('malformed JSON rejected', async () => {
      mode = 'invalid-json';
      await assert.rejects(buyer.discover({ origin }), e =>
        e instanceof BuyerError && e.code === 'BAD_DISCOVERY_RESPONSE');
    });
  } finally {
    server.close();
    await once(server, 'close');
  }
});
