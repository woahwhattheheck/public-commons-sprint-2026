import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createWorkspace,restoreWorkspace,applyReview,exportReport} from './workspace.mjs';
import {createWorkspaceServer} from './workspace-server.mjs';
const input={title:'Corpus <script>',sources:[{id:'s',title:'Trial',body:'🧪 The trial enrolled 120 participants. Long-term survival was not measured.'}],claims:['The trial enrolled 120 participants.','Long-term survival improved.']};
test('batch creation, real extractor, review, resume and source-linked report',()=>{
 const ws=createWorkspace(input);assert.equal(ws.claims.length,2);assert.equal(ws.mode,'offline');
 const e=ws.claims[0].evidence[0];assert.equal(ws.sources[0].body.slice(e.start,e.end),'🧪 The trial enrolled 120 participants.');assert.equal(e.quote,undefined);
 const reviewed=applyReview(ws,'claim-1',{decision:'supported',reviewer:'Researcher',note:'The enrollment count is explicit.',evidence_ids:['E1']});
 assert.equal(ws.claims[0].review.decision,'pending');assert.deepEqual(restoreWorkspace(JSON.parse(JSON.stringify(reviewed))),reviewed);
 const report=exportReport(reviewed);assert.match(report,/1 of 2 claims reviewed/);assert.match(report,/SELECTED BY REVIEWER/);assert.match(report,/UTF-16/);assert.ok(!report.includes('<script>'));
});
test('changed basis, unknown citations and duplicate claim IDs cannot reuse a decision',()=>{
 const ws=createWorkspace(input);const bad=structuredClone(ws);bad.sources[0].body+=' Changed.';assert.throws(()=>restoreWorkspace(bad),/checksum/);
 const changed=structuredClone(ws);changed.claims[0].text='A different trial claim.';assert.throws(()=>restoreWorkspace(changed),/basis changed/);
 assert.throws(()=>applyReview(ws,'claim-1',{decision:'supported',reviewer:'R',note:'N',evidence_ids:['E99']}),/unknown evidence/);
 assert.throws(()=>createWorkspace({...input,claims:[{id:'same',text:'one claim'},{id:'same',text:'two claim'}]}),/unique/);
 const forged=structuredClone(ws);forged.claims[0].evidence[0].start=999999;assert.deepEqual(restoreWorkspace(forged),ws);
});
test('real HTTP workspace routes support the complete offline roundtrip',async()=>{
 const server=createWorkspaceServer();server.listen(0,'127.0.0.1');await once(server,'listening');const root=`http://127.0.0.1:${server.address().port}`;
 try {
  const get=await fetch(root+'/');assert.equal(get.status,200);assert.match(await get.text(),/Review a research corpus/);
  const post=(path,data)=>fetch(root+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  const r=await post('/api/workspace',input);assert.equal(r.status,200);const ws=await r.json();
  const edited=await post('/api/review',{workspace:ws,claim_id:'claim-2',review:{decision:'insufficient',reviewer:'R',note:'Outcome not measured.',evidence_ids:[]}});assert.equal(edited.status,200);const saved=await edited.json();
  assert.equal((await post('/api/workspace',saved)).status,200);const report=await post('/api/report',saved);assert.match((await report.json()).markdown,/Outcome not measured/);
  assert.equal((await post('/api/workspace',[])).status,400);assert.equal((await fetch(root+'/app.mjs')).status,404);
 } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
