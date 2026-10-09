import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createServer} from '../src/server.mjs';
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
function partialPost(url,prefix){
  let req;
  const result=new Promise((resolve,reject)=>{
    req=http.request(url,{method:'POST',headers:{'Content-Type':'application/json','Transfer-Encoding':'chunked'}},res=>{
      let body='';res.setEncoding('utf8');res.on('data',part=>body+=part);
      res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));
    });
    req.on('error',reject);req.write(prefix);
  });
  return {req,result};
}
test('real streamed HTTP inputs cannot cross exclusive payout mutation gate',async()=>{
  const server=await createServer();
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const base='http://127.0.0.1:'+server.address().port;
  const post=(path,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  let decision,sync;
  try{
    const initial=await (await fetch(base+'/api/report')).json();
    const body=JSON.stringify({version:initial.version,caseId:initial.items[0].caseId,state:'escalated'});
    decision=partialPost(base+'/api/decision',body.slice(0,-1));
    await sleep(50);
    sync=partialPost(base+'/api/sync','{"batchId":"');
    await sleep(50);
    decision.req.end(body.slice(-1));
    const disputed=await decision.result;
    assert.equal(disputed.status,409,'decision must notice sync started while reading its body');
    assert.match(disputed.body.error,/sync in progress/);
    assert.equal((await post('/api/load-demo',{})).status,409,'fixture reset blocked during incomplete sync request');
    assert.equal((await post('/api/sync',{batchId:'NO_PROVIDER'})).status,409,'second sync blocked before first body finishes');
    const during=await (await fetch(base+'/api/report')).json();
    assert.equal(during.version,initial.version,'conflicting requests must not mutate report');
    sync.req.end('NO_PROVIDER"}');
    const completed=await sync.result;
    assert.equal(completed.status,502,'without runtime credentials, sandbox request fails without guessing payment data');
    assert.equal((await post('/api/load-demo',{})).status,200,'mutation gate clears after failed upstream attempt');
  }finally{
    decision?.req.destroy();sync?.req.destroy();
    await new Promise(done=>server.close(done));
  }
});
