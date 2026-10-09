import assert from 'node:assert/strict';
import http from 'node:http';
import {KINDS} from '../src/engine.mjs';
import {QlooError,resolveEntity,buildLiveComparison} from '../src/qloo.mjs';
import {createServer} from '../src/server.mjs';

const good = data => ({ok:true,status:200,headers:{get:()=>null},json:async()=>data});
const provider = data => async (url,init) => {
  assert.equal(url.origin,'https://hackathon.api.qloo.com');
  assert.equal(init.redirect,'manual');
  assert.equal(init.headers['X-Api-Key'],'local-test-placeholder');
  return good(data);
};
let rounds=0;
for (const [kind,type] of Object.entries(KINDS)) {
  for (let i=0;i<256;i++) {
    const seed='  TEST  '+kind+' '+i+'  ';
    const canonical='test '+kind+' '+i;
    const exact='Test '+kind+' '+i;
    const entity='qloo:'+kind+':'+i;
    const data={results:{entities:[
      {entity_id:'wrong-'+i,name:'Test unrelated '+i,type},
      {entity:{id:{bad:i},name:exact,type}},
      {entity_id:entity,name:exact,type},
      {entity_id:entity.toUpperCase(),name:exact.toUpperCase(),type},
    ]}};
    const result=await resolveEntity(seed,'local-test-placeholder',provider(data));
    assert.equal(result.id,entity,'must not return fuzzy top search hit');
    assert.equal(result.name,exact);
    assert.ok(result.url.includes('types=urn%3Aentity%3Aartist'));
    assert.equal(canonical.trim(),canonical);
    rounds++;
  }
}
const errorCode=async(p,code)=>{
  await assert.rejects(p,e=>e instanceof QlooError&&e.code===code,code);
};
await errorCode(resolveEntity('Alpha','local-test-placeholder',provider({results:[{id:'fuzzy',name:'Alpaca'}]})),'NO_MATCH');
await errorCode(resolveEntity('Alpha','local-test-placeholder',provider({results:[
  {id:'a',name:'Alpha'},{id:'b',name:'ALPHA'}]})),'AMBIGUOUS_SEED');
await errorCode(resolveEntity('Alpha','local-test-placeholder',provider({results:[
  {id:{danger:1},name:'Alpha'},{id:42,name:'ALPHA'}]})),'NO_MATCH');
const width=await resolveEntity('ＡＬＰＨＡ','local-test-placeholder',provider({results:[
  {entity_id:'width',name:'Alpha'}]}));
assert.equal(width.id,'width','Unicode NFKC exact name matches');

const calls=[];
const fetcher=async (u,init)=>{
  calls.push({path:u.pathname,query:u.searchParams.get('query'),entity:u.searchParams.get('signal.interests.entities')});
  if(u.pathname==='/search'){
    const seed=u.searchParams.get('query');
    return provider({results:{entities:[{id:'unrelated',name:'Nearby'}, {entity_id:'id:'+seed,name:seed}]}})(u,init);
  }
  return provider({results:{entities:[{entity_id:'shared',name:'Bridge',type:'urn:entity:book'}]}})(u,init);
};
const comparison=await buildLiveComparison({seedA:'Alpha',seedB:'Beta',kind:'book',key:'local-test-placeholder',fetcher});
assert.equal(calls.length,4,'two searches then two independent Insights queries');
assert.deepEqual(calls.slice(2).map(x=>x.entity),['id:Alpha','id:Beta']);
assert.equal(comparison.trace[0].step,'resolve');
assert.equal(comparison.resultsA.results.entities[0].entity_id,'shared');

// In-process real Node HTTP route with injected Qloo-shaped provider replies.
process.env.QLOO_API_KEY='local-test-placeholder';
const origFetch=globalThis.fetch;
let active='missing';
globalThis.fetch=async (u,init)=>{
  if(u.pathname==='/search'){
    const seed=u.searchParams.get('query');
    if(active==='missing'&&seed==='Alpha')return provider({results:[{id:'wrong',name:'Alpaca'}]})(u,init);
    if(active==='ambiguous'&&seed==='Alpha')return provider({results:[{id:'one',name:'Alpha'},{id:'two',name:'ALPHA'}]})(u,init);
    return provider({results:[{entity_id:'id:'+seed,name:seed}]})(u,init);
  }
  return provider({results:[{entity_id:'shared',name:'Bridge',type:'urn:entity:book'}]})(u,init);
};
const server=createServer();
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const port=server.address().port;
async function call(url) {
  return new Promise((resolve,reject)=>http.get({hostname:'127.0.0.1',port,path:url},res=>{
    const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))}));res.on('error',reject);
  }).on('error',reject));
}
const url='/api/bridge?a=Alpha&b=Beta&kind=book&mode=live';
try {
  active='missing';let r=await call(url);assert.equal(r.status,422);assert.equal(r.body.code,'NO_MATCH');
  active='ambiguous';r=await call(url);assert.equal(r.status,409);assert.equal(r.body.code,'AMBIGUOUS_SEED');
  active='exact';r=await call(url);assert.equal(r.status,200);assert.equal(r.body.bridges[0].id,'shared');
  r=await call('/api/bridge?a=Alpha&b=Beta&kind=book&mode=fixture');
  assert.equal(r.status,200);assert.equal(r.body.mode,'fixture');
} finally {
  await new Promise(ok=>server.close(ok));
  globalThis.fetch=origFetch;
}
console.log('CultureBridge real-source adapter: PASS ('+rounds+' exact-seed mixes, 4 direct controls, actual 4-call comparison, 4 HTTP routes)');
