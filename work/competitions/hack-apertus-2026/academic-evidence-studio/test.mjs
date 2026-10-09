import test from 'node:test';
import assert from 'node:assert/strict';
import {extract,evaluate,normalizeModelSuggestion,createServer} from './app.mjs';

const request={claim:'The research recorded 12 percent lower response time',sources:[{id:'p1',title:'Synthetic study',body:'The researchers measured latency. The research recorded 12 percent lower response time. The sample lacked a control group.'}],mode:'offline'};
test('exact source offsets and hashes survive untouched extraction',()=>{
  const result=extract(request);assert.ok(result.evidence.length);
  for(const e of result.evidence)assert.equal(request.sources[0].body.slice(e.start,e.end),e.quote);
});
test('offline never claims live inference',async()=>{
  const result=await evaluate(request);assert.equal(result.proposal.verdict,'not_evaluated');assert.equal(result.review_status,'HUMAN_REVIEW_REQUIRED');
});
test('unfounded model citations cannot authorize verdict',()=>{
  const result=normalizeModelSuggestion('{"verdict":"supported","reason":"trust me","evidence_ids":["E99"]}',[{id:'E1'}]);
  assert.equal(result.valid,false);assert.equal(result.verdict,'insufficient');
});
test('live mock returns advisory assessment without claim certification',async()=>{
  let called=false;
  const result=await evaluate({...request,mode:'live'},{endpoint:'http://127.0.0.1:8760/v1/chat/completions',key:'TEST_ONLY',fetcher:async(u,opts)=>{called=true;const body=JSON.parse(opts.body);assert.equal(body.messages[0].role,'system');return {ok:true,json:async()=>({choices:[{message:{content:'{"verdict":"supported","reason":"excerpt matches","evidence_ids":["E1"]}'}}]})}}});
  assert.ok(called);assert.equal(result.proposal.valid,true);assert.equal(result.review_status,'HUMAN_REVIEW_REQUIRED');
});
test('HTTP API enforces bound and has a working evidence response',async()=>{
  const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {const port=server.address().port;
    const response=await fetch(`http://127.0.0.1:${port}/api/evaluate`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request)});
    assert.equal(response.status,200);assert.equal((await response.json()).review_status,'HUMAN_REVIEW_REQUIRED');
    const bad=await fetch(`http://127.0.0.1:${port}/api/evaluate`,{method:'POST',headers:{'content-type':'application/json'},body:'{"claim":"x","sources":[]}' });
    assert.equal(bad.status,400);
  } finally {await new Promise(resolve=>server.close(resolve))}
});