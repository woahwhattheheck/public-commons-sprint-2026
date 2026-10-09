import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createPitchPulseServer} from '../server.mjs';
import {SessionStore,FoundryBudget} from '../demo_sessions.mjs';
import {SYNTHETIC_EVENTS} from '../engine.mjs';

async function fixture(t,options={}){
 const server=createPitchPulseServer({budget:new FoundryBudget({limit:0}),...options});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const base=`http://127.0.0.1:${server.address().port}`;
 const visitor=()=>{
  let cookie='';
  return async(path,method='GET',payload,extraHeaders={})=>{
   const headers={...extraHeaders};if(cookie)headers.cookie=cookie;
   if(payload!==undefined)headers['content-type']='application/json';
   const response=await fetch(base+path,{method,headers,
    body:payload===undefined?undefined:JSON.stringify(payload)});
   const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
   return {status:response.status,headers:response.headers,body:await response.json()};
  };
 };
 return {base,visitor};
}

test('separate visitors cannot reset each other; health allocates no cookie',async t=>{
 const {visitor}=await fixture(t);const alice=visitor(),bob=visitor();
 const health=await alice('/healthz');assert.equal(health.status,200);assert.equal(health.headers.get('set-cookie'),null);
 const a=await alice('/api/state'),b=await bob('/api/state');
 assert.notEqual(a.headers.get('set-cookie'),b.headers.get('set-cookie'));
 assert.match(a.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
 assert.equal((await alice('/api/next','POST')).body.acceptedEvents,1);
 assert.equal((await bob('/api/reset','POST')).body.acceptedEvents,0);
 assert.equal((await alice('/api/state')).body.acceptedEvents,1);
 const denied=await alice('/api/reset','POST',undefined,{origin:'https://other.example'});
 assert.equal(denied.status,403);assert.equal((await alice('/api/state')).body.acceptedEvents,1);
});

test('export/import reproduces goal evidence and resumes the exact built-in cursor',async t=>{
 const {visitor}=await fixture(t);const source=visitor(),target=visitor();
 for(let i=0;i<9;i++)assert.equal((await source('/api/next','POST')).status,200);
 const snapshot=(await source('/api/state')).body;
 assert.equal(snapshot.scoreboard[0].goals,1);
 const replay=(await source('/api/replay')).body;
 assert.equal(replay.nextIndex,9);assert.equal(replay.events.length,9);
 const restored=await target('/api/replay','POST',replay);
 assert.equal(restored.status,200);assert.deepEqual(restored.body,snapshot);
 assert.deepEqual((await target('/api/replay')).body,replay);
 assert.deepEqual((await target('/api/next','POST')).body,(await source('/api/next','POST')).body);
});

test('invalid imports and view options leave state intact; custom replay never advances built-in cursor',async t=>{
 const {visitor}=await fixture(t);const client=visitor();
 await client('/api/next','POST');await client('/api/next','POST');
 const saved=(await client('/api/replay')).body;
 const invalid=[
  {...saved,events:[...saved.events,saved.events[0]],nextIndex:null},
  {...saved,events:saved.events.slice().reverse(),nextIndex:null},
  {...saved,nextIndex:1},
  {...saved,events:[{...saved.events[0],outcome:'missed'},saved.events[1]]},
  {...saved,schema:'unrecognized'},
 ];
 for(const replay of invalid){
  assert.equal((await client('/api/replay','POST',replay)).status,422);
  assert.deepEqual((await client('/api/replay')).body,saved);
 }
 assert.equal((await client('/api/replay','POST',{...saved,extra:'x'.repeat(2*1024*1024)})).status,413);
 assert.equal((await client('/api/next?audience=unknown','POST')).status,422);
 assert.deepEqual((await client('/api/replay')).body,saved);
 // Retransmitting an accepted built-in event must not switch the session into custom mode.
 assert.equal((await client('/api/events','POST',SYNTHETIC_EVENTS[0])).body.result.duplicate,true);
 assert.deepEqual((await client('/api/replay')).body,saved);
 const inserted=await client('/api/events','POST',{id:'custom-shot',second:700,team:'Valley FC',type:'shot',outcome:'goal'});
 assert.equal(inserted.body.replayMode,'custom');assert.equal(inserted.body.demoRemaining,0);
 const custom=(await client('/api/replay')).body;assert.equal(custom.nextIndex,null);
 assert.equal((await client('/api/next','POST')).status,422);
 assert.deepEqual((await client('/api/replay')).body,custom);
 const {result,...customSnapshot}=inserted.body;
 assert.deepEqual((await visitor()('/api/replay','POST',custom)).body,customSnapshot);
 assert.equal((await client('/api/reset','POST')).body.demoRemaining,SYNTHETIC_EVENTS.length);
});

test('bounded sessions preserve active visitors, expire idle entries, and can use secure cookies',async t=>{
 let now=0;const store=new SessionStore({maxSessions:1,ttlMs:1000,now:()=>now});
 const {visitor}=await fixture(t,{store,secureCookie:true});const first=visitor(),second=visitor();
 const initial=await first('/api/next','POST');assert.match(initial.headers.get('set-cookie'),/; Secure$/);
 const full=await second('/api/state');assert.equal(full.status,503);assert.equal(full.headers.get('retry-after'),'60');
 assert.equal((await first('/api/state')).body.acceptedEvents,1);
 assert.equal((await second('/healthz')).status,200);assert.equal(store.sessions.size,1);
 now=1001;assert.equal((await second('/api/state')).status,200);assert.equal(store.sessions.size,1);
 assert.equal((await first('/api/state')).status,503);
});


test('Foundry starts disabled; shared budget serializes calls and counts failures conservatively',async t=>{
 const {visitor}=await fixture(t);const client=visitor();
 assert.equal((await client('/api/state')).body.foundryConfigured,false);
 assert.equal((await client('/api/explain','POST')).body.status,'budget-disabled');
 let now=0,release;const budget=new FoundryBudget({limit:2,now:()=>now});
 const pending=budget.run(()=>new Promise(resolve=>{release=resolve;}));
 await assert.rejects(budget.run(()=>assert.fail('parallel provider execution')),{status:429});
 release('draft');assert.equal(await pending,'draft');
 await assert.rejects(budget.run(async()=>{throw new Error('provider failure');}),/provider failure/);
 await assert.rejects(budget.run(()=>assert.fail('over-budget execution')),{status:429,retryAfter:3600});
 now=3600000;assert.equal(await budget.run(async()=>'new window'),'new window');
 assert.throws(()=>new FoundryBudget({limit:'2junk'}),/Invalid/);
});


test('engine-limit ledger with worst-case player escaping fits the replay budget and round-trips',async t=>{
 const {visitor}=await fixture(t);const source=visitor(),target=visitor();
 // JSON-escaped control characters maximize the allowed player string's serialized size.
 const events=Array.from({length:3000},(_,index)=>({
  id:`event_${String(index).padStart(42,'0')}`,second:index,team:'Harbor FC',
  type:'pass',outcome:'complete',player:'\u0000'.repeat(64),duration:0
 }));
 const replay={schema:'pitchpulse-replay/v1',fixture:'synthetic',nextIndex:null,events};
 const accepted=await source('/api/replay','POST',replay);assert.equal(accepted.status,200);
 const exported=(await source('/api/replay')).body;
 const file=JSON.stringify(exported,null,2)+'\n';
 assert.ok(Buffer.byteLength(file)>1024*1024,'exercise the previously rejected valid range');
 assert.ok(Buffer.byteLength(file)<=2*1024*1024,'the browser must accept its own exported file');
 const restored=await target('/api/replay','POST',JSON.parse(file));
 assert.equal(restored.status,200);assert.deepEqual(restored.body,accepted.body);
});
