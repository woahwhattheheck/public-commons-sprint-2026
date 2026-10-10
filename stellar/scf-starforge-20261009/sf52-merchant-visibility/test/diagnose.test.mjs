// MIT. Focused tests exercise actual Node22 HTTP via ephemeral loopback (not simulation of payment).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { diagnose, bazaarExtensionOutcome, decodeJsonHeader, resourceKey } from '../diagnose.mjs';

const asHeader = obj => Buffer.from(JSON.stringify(obj)).toString('base64');
const TEST_ADDRESS = '0xD0918296eF13b0fA23b67B6195Af6854868642B6';

async function loopback(handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r))};
}

const reqs = [{network:'eip155:8453',asset:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  scheme:'exact', payTo:TEST_ADDRESS,amount:'2000'}];
const challenge = asHeader({x402Version:2, accepts:reqs,
  extensions:{bazaar:{info:{input:{type:'http',method:'GET'}}}}});

async function scenario({brokenSecond = false, catalogContains = true}={}) {
  let sellerBase, catalogBase;
  const seller = await loopback((req,res) => {
    res.writeHead(402, {'PAYMENT-REQUIRED': challenge, 'content-type': 'application/json'});
    res.end('{"x402Version":2}');
  });
  sellerBase = seller.url;
  const catalog = await loopback((req,res) => {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const offset = Number(params.get('offset'));
    if (brokenSecond && offset) {res.writeHead(503); res.end('backoff'); return;}
    const resource = {resource:sellerBase+'/pulse',type:'http',x402Version:2,
      accepts:reqs,extensions:{bazaar:{info:{input:{type:'http',method:'GET'}}}}};
    const rows = [
      {resource:'https://example.org/one',accepts:[]},
      {resource:'https://example.org/two',accepts:[]},
      ...(catalogContains ? [resource] : [])];
    const limit = Number(params.get('limit'));
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify({items:rows.slice(offset,offset+limit),
      pagination:{total:rows.length,limit,offset}}));
  });
  catalogBase = catalog.url;
  return {seller,catalog,run:(extras={})=>diagnose({resourceUrl:sellerBase+'/pulse',
    catalogUrl:catalogBase+'/discovery/resources',payTo:TEST_ADDRESS,network:'eip155:8453',
    allowLoopback:true,pageLimit:2,...extras})};
}

test('paged discovery finds matching resource only after actual second HTTP page',async () => {
  const v = await scenario();
  try {
    const report = await v.run({extensionResponses:asHeader({bazaar:{status:'processing'}})});
    assert.equal(report.challenge.state,'X402_402');
    assert.equal(report.challenge.bazaarExtension,true);
    assert.equal(report.catalog.pages,2);
    assert.equal(report.catalog.complete,true);
    assert.equal(report.catalog.matchingResourceCount,1);
    assert.equal(report.verdict,'LISTED');
    assert.equal(report.extensionResponse.state,'PROCESSING');
  } finally {await v.catalog.close();await v.seller.close();}
});

test('absent from exhaustive catalog is distinct from rejected indexing',async()=>{
  const v=await scenario({catalogContains:false});
  try {
    const r=await v.run({extensionResponses:asHeader({bazaar:{status:'rejected',rejectedReason:'info failed schema validation'}})});
    assert.equal(r.catalog.complete,true);
    assert.equal(r.verdict,'NOT_LISTED_IN_EXHAUSTED_CATALOG');
    assert.equal(r.extensionResponse.state,'REJECTED');
    assert.equal(r.extensionResponse.reason,'info failed schema validation');
  } finally {await v.catalog.close();await v.seller.close();}
});

test('pagination HTTP failure never becomes false NOT_LISTED',async()=>{
  const v=await scenario({brokenSecond:true});
  try {
    const r=await v.run();
    assert.equal(r.catalog.complete,false);
    assert.equal(r.catalog.pages,1);
    assert.equal(r.verdict,'INCONCLUSIVE_CATALOG');
    assert.match(r.catalog.incompleteReason,/503/);
  } finally {await v.catalog.close();await v.seller.close();}
});

test('strict original header and resource parsing',()=>{
  assert.equal(bazaarExtensionOutcome(asHeader({bazaar:{status:'success'}})).state,'SUCCESS');
  assert.equal(bazaarExtensionOutcome(asHeader({bazaar:{status:'bogus'}})).state,'NO_VALID_BAZAAR_STATUS');
  assert.throws(()=>decodeJsonHeader('bad $$$'),/Invalid/);
  assert.equal(resourceKey('https://Example.org/a/'),'https://example.org/a');
});