import test from 'node:test';
import assert from 'node:assert/strict';
import {QlooClient} from '../src/qloo.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return {promise, resolve};
}

test('concurrent identical Qloo requests share one outbound call and then reuse TTL cache', async () => {
  let calls = 0;
  let clock = 0;
  const gate = deferred();
  const result = {results:[{entity_id:'artist:1',name:'A'}]};
  const client = new QlooClient({key:'fixture-only', now:() => clock, fetcher:async () => {
    calls += 1;
    await gate.promise;
    return {ok:true, json:async () => result};
  }});
  const promises = Array.from({length:25}, () => client.get('/search', {query:'Jazz',take:8}));
  assert.equal(calls, 1);
  assert.equal(client.inFlight.size, 1);
  gate.resolve();
  const all = await Promise.all(promises);
  assert.ok(all.every(v => v === result));
  assert.equal(client.calls, 1);
  assert.equal(client.inFlight.size, 0);
  assert.equal(await client.get('/search', {query:'Jazz',take:8}), result);
  assert.equal(calls, 1);
  clock = 300001;
  await client.get('/search', {query:'Jazz',take:8});
  assert.equal(calls, 2);
});

test('failed shared 429 is not cached; subsequent retry can succeed', async () => {
  let calls = 0;
  const gate = deferred();
  const client = new QlooClient({key:'fixture-only', fetcher:async () => {
    calls += 1;
    if (calls === 1) {
      await gate.promise;
      return {ok:false,status:429};
    }
    return {ok:true,json:async()=>({results:[]})};
  }});
  const concurrent = Array.from({length:12},()=>client.get('/v2/insights',{'filter.type':'urn:entity:place',take:3}));
  assert.equal(calls, 1);
  gate.resolve();
  const failures = await Promise.allSettled(concurrent);
  assert.ok(failures.every(x=>x.status==='rejected' && x.reason.code==='QLOO_RATE_LIMIT'));
  assert.equal(client.inFlight.size,0);
  await client.get('/v2/insights',{'filter.type':'urn:entity:place',take:3});
  assert.equal(calls,2);
});

test('different request URLs do not incorrectly share responses', async () => {
  const seen = [];
  const gate = deferred();
  const client = new QlooClient({key:'fixture-only',fetcher:async url=>{
    seen.push(String(url));
    await gate.promise;
    return {ok:true,json:async()=>({query:String(url)})};
  }});
  const first = client.get('/search',{query:'Jazz'});
  const second = client.get('/search',{query:'Opera'});
  assert.equal(seen.length,2);
  gate.resolve();
  assert.notDeepEqual(await first, await second);
  assert.equal(client.inFlight.size,0);
});
