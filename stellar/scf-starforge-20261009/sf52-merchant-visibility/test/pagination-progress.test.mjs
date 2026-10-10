// MIT. Focused original-source HTTP regression for cursor progression and catalog claims.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { inspectCatalog } from '../diagnose.mjs';

async function localCatalog(respond) {
  const seen = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    seen.push(url.searchParams.get('cursor') ?? 'START');
    const data = respond(url);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: 'http://127.0.0.1:' + server.address().port + '/discovery/resources', seen,
    close: () => new Promise(resolve => server.close(resolve))
  };
}

const target = 'https://merchant.example/paid-resource';
const item = {resource: target, accepts: [{network: 'stellar:testnet', payTo:'GDUMMY'}]};
const options = {targetResource: target, network:'stellar:testnet', payTo:'GDUMMY',
  allowLoopback:true, pageLimit:1, maxPages:8};

test('real cursor HTTP: empty filtered first page does not falsely prove resource absent', async () => {
  const v = await localCatalog(url => {
    const cursor = url.searchParams.get('cursor');
    if (!cursor) return {items:[], pagination:{nextCursor:'p2'}};
    if (cursor === 'p2') return {items:[item], pagination:{nextCursor:'p3'}};
    return {items:[], pagination:{}};
  });
  try {
    const result = await inspectCatalog({...options, catalogUrl:v.url});
    assert.equal(result.complete, true);
    assert.equal(result.matchingResourceCount, 1);
    assert.deepEqual(v.seen, ['START','p2','p3']);
  } finally {await v.close();}
});

test('empty page with contradictory declared total but valid cursor advances', async () => {
  const v = await localCatalog(url => {
    const cursor = url.searchParams.get('cursor');
    if (!cursor) return {resources:[], pagination:{total:1, nextCursor:'p2'}};
    return {resources:[item], pagination:{total:1}};
  });
  try {
    const result = await inspectCatalog({...options, catalogUrl:v.url});
    assert.equal(result.complete, true);
    assert.equal(result.matchingResourceCount, 1);
    assert.deepEqual(v.seen, ['START','p2']);
  } finally {await v.close();}
});

test('empty cursor cycle never reports a thoroughly searched catalog', async () => {
  const v = await localCatalog(url => {
    const cursor = url.searchParams.get('cursor');
    return {items:[], pagination:{nextCursor:cursor === 'a'?'b':'a'}};
  });
  try {
    const result = await inspectCatalog({...options, catalogUrl:v.url});
    assert.equal(result.complete, false);
    assert.match(result.incompleteReason, /cursor|repeat|cycle/i);
    assert.deepEqual(v.seen, ['START','a','b']);
  } finally {await v.close();}
});

test('empty exhausted catalog without cursor still supports a bounded absence result', async () => {
  const v = await localCatalog(() => ({items:[], pagination:{}}));
  try {
    const result = await inspectCatalog({...options, catalogUrl:v.url});
    assert.equal(result.complete, true);
    assert.equal(result.matchingResourceCount, 0);
    assert.deepEqual(v.seen, ['START']);
  } finally {await v.close();}
});

test('cursor page cap does not accidentally turn repeated empties into absence', async () => {
  const v = await localCatalog(url => {
    const current = url.searchParams.get('cursor');
    return {items:[], pagination:{nextCursor: String(current ? Number(current)+1 : 1)}};
  });
  try {
    const result = await inspectCatalog({...options, catalogUrl:v.url, maxPages:4});
    assert.equal(result.complete, false);
    assert.match(result.incompleteReason, /maxPages=4/);
    assert.equal(v.seen.length,4);
  } finally {await v.close();}
});
