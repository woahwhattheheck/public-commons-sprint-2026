import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createPitchPulseServer} from '../server.mjs';

test('clock scrub is read-only; expired highlights remain historical, never live',async t=>{
 const server=createPitchPulseServer();
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const base=`http://127.0.0.1:${server.address().port}`;
 let cookie='';
 const query=async(path,method='GET')=>{
  const response=await fetch(base+path,{method,headers:cookie?{cookie}:{}});
  if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  return {status:response.status,body:await response.json()};
 };
 for(let i=0;i<10;i++)assert.equal((await query('/api/next','POST')).status,200);
 const live=(await query('/api/state')).body;
 assert.equal(live.clockSecond,296);
 assert.equal(live.lastLedgerSecond,296);
 assert.equal(live.scoreboard[0].goals,1);
 assert.equal(live.activeOverlays.some(o=>o.kind==='goal'),false);
 const replayBefore=(await query('/api/replay')).body;
 const early=await query('/api/state?asOfSecond=237');
 assert.equal(early.status,200);
 assert.equal(early.body.scoreboard[0].goals,0);
 assert.equal(early.body.view.clockMode,'as-of');
 const goal=(await query('/api/state?asOfSecond=238')).body;
 assert.equal(goal.scoreboard[0].goals,1);
 assert.equal(goal.activeOverlays.some(o=>o.kind==='goal'),true);
 const after=(await query('/api/state?asOfSecond=257')).body;
 assert.equal(after.scoreboard[0].goals,1);
 assert.equal(after.activeOverlays.some(o=>o.kind==='goal'),false);
 assert.equal(after.overlays.some(o=>o.kind==='goal'),true);
 for(const bad of ['-1','2.5','01','9999','Infinity']){
  assert.equal((await query(`/api/state?asOfSecond=${bad}`)).status,422);
 }
 assert.equal((await query('/api/next?asOfSecond=220','POST')).status,422);
 assert.deepEqual((await query('/api/replay')).body,replayBefore);
 assert.deepEqual((await query('/api/state')).body,live);
});
