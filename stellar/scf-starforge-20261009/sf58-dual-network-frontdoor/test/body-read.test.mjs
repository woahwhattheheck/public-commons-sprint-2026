// Focused original Node HTTP ingress tests. No chain/RPC, seller, signer or spend.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { boundedBodyBytes, BodyReadError } from '../body-read.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const start = async server => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`; };
const close = async server => new Promise(resolve => server.close(resolve));

test('real HTTP partial upload expires, releases admission, and healthy native-sized JSON still passes byte exact', async () => {
  let active = 0; let delivered = 0;
  const server = createServer(async (req, res) => {
    if (active >= 1) { res.writeHead(429); res.end('BUSY'); return; }
    active++;
    try {
      const raw = await boundedBodyBytes(req, 2048, 140);
      delivered++;
      res.writeHead(200, {'content-type':'application/octet-stream'});
      res.end(raw);
    } catch(e) {
      if (!res.destroyed) { res.writeHead(e instanceof BodyReadError ? e.status : 500); res.end(); }
    } finally {active--;}
  });
  const base = await start(server);
  let stalled;
  try {
    stalled = httpRequest(base + '/verify', {method:'POST',headers:{'transfer-encoding':'chunked'}});
    stalled.on('error',()=>{}); stalled.write('{"paymentPayload":');
    await sleep(25);
    const during = await fetch(base + '/verify', {method:'POST',body:'{"safe":true}', headers:{'content-type':'application/json'}});
    assert.equal(during.status, 429, 'slow inbound body must consume exactly one slot before deadline');
    await sleep(175);
    assert.equal(active,0,'expired upload must release its admitted slot');
    const original = '{\n  "paymentPayload": {"accepted":{"network":"stellar:testnet"}}\n}';
    const good = await fetch(base+'/verify',{method:'POST',headers:{'content-type':'application/json'},body:original});
    assert.equal(good.status,200);assert.equal(await good.text(),original);
    assert.equal(delivered,1,'slow partial upload must never reach native backend');
  } finally {stalled?.destroy();await close(server);}
});

test('exact limit is admitted, overflow and empty body reject without upstream forwarding', async () => {
  let statuses = [];
  const server = createServer(async (req,res)=> {
    try {const bytes = await boundedBodyBytes(req,5,200);
      statuses.push('admitted');res.end(bytes);}
    catch(e){statuses.push(e.code);if(!res.destroyed){res.writeHead(e.status??500);res.end();}}
  });
  const base=await start(server);
  try{
    let r=await fetch(base,{method:'POST',body:'12345'});
    assert.equal(r.status,200);assert.equal(await r.text(),'12345');
    r=await fetch(base,{method:'POST',body:'123456'});
    assert.equal(r.status,413);
    r=await fetch(base,{method:'POST',body:''});
    assert.equal(r.status,400);
    assert.deepEqual(statuses,['admitted','BODY_TOO_LARGE','EMPTY_BODY']);
  } finally{await close(server)}
});
