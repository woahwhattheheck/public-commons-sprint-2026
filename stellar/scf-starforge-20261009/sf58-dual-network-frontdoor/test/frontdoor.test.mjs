import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { makeFrontdoor, originOnly, combineSupported } from '../frontdoor.mjs';

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) { await new Promise(resolve => server.close(resolve)); }
const payload = (network) => ({
  paymentPayload: {x402Version: 2, accepted: {network, scheme: 'exact'}, payload: {transaction: 'unaltered-test-XDR'}},
  paymentRequirements: {network, scheme: 'exact', amount: '123', payTo: 'original-buyer-recipient'},
  originalExtension: {unrecognized: 'preserve-original-bytes'}
});

test('routes original v2 bytes by both matching network descriptors; merges actual backend /supported only', async () => {
  const calls = {testnet: [], pubnet: []};
  const peers = [];
  let edge;
  try {
    const origins = {};
    for (const name of ['testnet', 'pubnet']) {
      const network = `stellar:${name}`;
      const peer = createServer(async (req, res) => {
        if (req.headers.authorization !== `Bearer ${name}-secret`) { res.writeHead(401); res.end('{}'); return; }
        const parts = [];
        for await (const b of req) parts.push(b);
        const raw = Buffer.concat(parts).toString();
        calls[name].push({path: req.url, raw});
        res.setHeader('content-type', 'application/json');
        if (req.url === '/supported') {
          res.end(JSON.stringify({
            kinds: [{x402Version: 2, scheme: 'exact', network, extra: {areFeesSponsored: name === 'testnet'}}],
            extensions: ['common-ext', `${name}-only`], signers: {'stellar:*': [`shared-signer`, `${name}-signer`]}
          }));
        } else {
          res.end(JSON.stringify({success: true, network, originalBytes: raw}));
        }
      });
      peers.push(peer);
      origins[network] = {origin: await listen(peer), bearer: `${name}-secret`};
    }
    edge = makeFrontdoor({upstreams: origins, allowLoopbackHttp: true, inboundToken: 'at-least-16-char-operator-secret'});
    const base = await listen(edge);
    const headers = {authorization: 'Bearer at-least-16-char-operator-secret', 'content-type': 'application/json'};
    const wrongAuth = await fetch(base + '/supported');
    assert.equal(wrongAuth.status, 401);
    const supported = await fetch(base + '/supported', {headers});
    assert.equal(supported.status, 200);
    const advertised = await supported.json();
    assert.deepEqual(advertised.kinds.map(x => x.network), ['stellar:testnet', 'stellar:pubnet']);
    assert.deepEqual(advertised.extensions, ['common-ext']);
    assert.deepEqual(advertised.signers, {'stellar:*': ['shared-signer', 'testnet-signer', 'pubnet-signer']});
    for (const network of ['stellar:testnet', 'stellar:pubnet']) {
      const body = JSON.stringify(payload(network), null, 1); // odd whitespace must survive forwarding
      const response = await fetch(base + '/verify', {method: 'POST', headers, body});
      assert.equal(response.status, 200);
      assert.equal((await response.json()).originalBytes, body);
    }
    const before = calls.testnet.length + calls.pubnet.length;
    const wrong = payload('stellar:testnet');
    wrong.paymentPayload.accepted.network = 'stellar:pubnet';
    const blocked = await fetch(base + '/settle', {method: 'POST', headers, body: JSON.stringify(wrong)});
    assert.equal(blocked.status, 400);
    assert.equal((await blocked.json()).error, 'NETWORK_NOT_BOUND');
    assert.equal(calls.testnet.length + calls.pubnet.length, before);
    const settled = await fetch(base + '/settle', {method: 'POST', headers, body: JSON.stringify(payload('stellar:pubnet'))});
    assert.equal(settled.status, 200);
    assert.equal(calls.pubnet.at(-1).path, '/settle');
    assert.equal(calls.testnet.some(x => x.path === '/settle'), false);
  } finally { if (edge) await close(edge); for (const p of peers) await close(p); }
});

test('fails closed on untrusted redirect and bad backend advertised network', async () => {
  const badPeer = createServer((req, res) => {
    if (req.url === '/supported') res.end(JSON.stringify({kinds: [{x402Version: 2, scheme: 'exact', network: 'stellar:pubnet'}], signers: {'stellar:*':['testnet-signer']}}));
    else {res.writeHead(302, {location: 'https://attacker.example/settle'}); res.end('');}
  });
  const goodPeer = createServer((req, res) => res.end(JSON.stringify({kinds: [{x402Version: 2, scheme: 'exact', network: 'stellar:pubnet'}], signers: {'stellar:*':['pubnet-signer']}})));
  let edge;
  try {
    const a = await listen(badPeer), b = await listen(goodPeer);
    edge = makeFrontdoor({upstreams: {'stellar:testnet': {origin: a}, 'stellar:pubnet': {origin: b}}, allowLoopbackHttp: true});
    const base = await listen(edge);
    const supported = await fetch(base + '/supported');
    assert.equal(supported.status, 502);
    assert.equal((await supported.json()).error, 'SUPPORTED_NETWORK_MISMATCH');
    const response = await fetch(base + '/settle', {method:'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(payload('stellar:testnet'))});
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, 'UPSTREAM_REDIRECT_DENIED');
  } finally {if (edge) await close(edge); await close(badPeer); await close(goodPeer);}
});

test('rejects network-indexed signer maps that differ from native @x402/core CAIP family contract', () => {
  const kinds = net => [{x402Version: 2, scheme: 'exact', network: net}];
  assert.throws(() => combineSupported([
    {kinds: kinds('stellar:testnet'), signers: {'stellar:testnet': ['invalid']}},
    {kinds: kinds('stellar:pubnet'), signers: {'stellar:*': ['valid']}}
  ]), /SUPPORTED_BAD_SIGNERS/);
});

test('origin guard rejects credentials, paths and external HTTP', () => {
  for (const url of ['http://example.com', 'https://alice:pass@example.com/', 'https://example.com/verify', 'https://example.com?redirect=a']) {
    assert.throws(() => originOnly(url), /origin/i);
  }
  assert.equal(originOnly('https://facilitator.example.org'), 'https://facilitator.example.org');
  assert.equal(originOnly('http://127.0.0.1:9000', {allowLoopbackHttp: true}), 'http://127.0.0.1:9000');
});
