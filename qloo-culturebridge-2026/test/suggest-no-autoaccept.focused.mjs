import assert from 'node:assert/strict';
import http from 'node:http';
import {QlooError,resolveEntity,buildLiveComparison} from '../src/qloo.mjs';
import {createServer} from '../src/server.mjs';
const good=data=>({ok:true,status:200,headers:{get:()=>null},json:async()=>data});
const provider=data=>async()=>good(data);
const payload={results:[
  {id:'a-1',name:'Blade Runners'},
  {id:'b-2',name:'Blade Runner 2049'},
  {id:'c-3',name:'Running Blade'},
  {id:'d-4',name:'Roadrunner'},
]};
await assert.rejects(resolveEntity('Blade Runner','local',provider(payload)),e=>{
  assert.ok(e instanceof QlooError);assert.equal(e.code,'NO_MATCH');
  assert.equal(e.suggestions.length,3);
  assert.ok(e.suggestions.every(x=>x.reason==='did_you_mean'&&typeof x.id==='string'&&typeof x.name==='string'));
  assert.equal(e.suggestions[0].id,'b-2');return true;
});
await assert.rejects(resolveEntity('Witcher','local',provider({results:[]})),e=>{
  assert.equal(e.code,'NO_MATCH');assert.deepEqual(e.suggestions,[]);return true;
});
await assert.rejects(resolveEntity('Alpha','local',provider({results:[{id:'e-1',name:'Alpha'},{id:'e-2',name:'ALPHA'}]})),e=>{
  assert.equal(e.code,'AMBIGUOUS_SEED');assert.equal(e.suggestions,undefined);return true;
});
const exact=await resolveEntity('Alpha','local',provider({results:[{id:'fuzzy',name:'Alphabet'},{id:'exact',name:'Alpha'}]}));
assert.equal(exact.id,'exact');
let insights=0,search=0;
const fetcher=async u=>{
  if(u.pathname==='/search'){search++;return good({results:[{id:'fuzzy',name:'Blade Runners'},{id:'another',name:'Blade Runner 2049'}]});}
  if(u.pathname==='/v2/insights'){insights++;return good({results:[]});}
  throw Error('unexpected endpoint');
};
await assert.rejects(buildLiveComparison({seedA:'Blade Runner',seedB:'The Witcher',kind:'movie',fetcher,key:'local'}),e=>e.code==='NO_MATCH'&&e.suggestions.length===2);
assert.equal(search,2);assert.equal(insights,0,'unselected hints never enter Insights');
process.env.QLOO_API_KEY='local-test-placeholder';
const old=globalThis.fetch;
globalThis.fetch=fetcher;
const server=createServer();
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const port=server.address().port;
try {
  const response=await new Promise((resolve,reject)=>http.get({hostname:'127.0.0.1',port,path:'/api/bridge?a=Blade%20Runner&b=The%20Witcher&kind=movie&mode=live'},res=>{
    const parts=[];res.on('data',b=>parts.push(b));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(parts).toString('utf8'))}));res.on('error',reject);
  }).on('error',reject));
  assert.equal(response.status,422);assert.equal(response.body.code,'NO_MATCH');
  assert.equal(response.body.suggestions.length,2);
  assert.equal(insights,0);
} finally { await new Promise(ok=>server.close(ok));globalThis.fetch=old; }
console.log('CultureBridge provider-returned hints: focused original-source controls PASS');
