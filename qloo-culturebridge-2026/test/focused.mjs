import assert from 'node:assert/strict';
import {cleanSeed,cleanKind,buildAgentResponse} from '../src/engine.mjs';
import {demoResults} from '../src/fixtures.mjs';
import {buildLiveComparison,QlooError} from '../src/qloo.mjs';

const a=cleanSeed('  Radiohead  '),b=cleanSeed('Nina Simone'),kind=cleanKind('artist');
const demo=buildAgentResponse({seedA:a,seedB:b,kind,mode:'fixture',...demoResults(a,b,kind)});
assert.equal(demo.mode,'fixture');assert.ok(demo.bridges.length>=1);
assert.ok(demo.warnings[0].includes('NOT live Qloo data'));
assert.ok(demo.bridges.every(x=>x.rankA>=1&&x.rankB>=1&&x.evidence.source==='Qloo Insights'));
assert.ok(demo.trace.some(x=>x.step==='compare'));

const hits=[];
async function mockedFetch(url,opts){const u=new URL(url);hits.push({path:u.pathname,params:u.searchParams,headers:opts.headers});
 let json;
 if(u.pathname==='/search'){const q=u.searchParams.get('query');json={results:[{id:q==='Radiohead'?'seedA':'seedB',name:q}]}}
 else{const seed=u.searchParams.get('signal.interests.entities');json={results:{entities:seed==='seedA'?
 [{id:'x',name:'Common bridge'},{id:'z',name:'First only'}]:
 [{id:'z2',name:'Second only'},{id:'x',name:'Common bridge'}]}}}
 return {ok:true,status:200,json:async()=>json};}
const realPath=await buildLiveComparison({seedA:a,seedB:b,kind,key:'mock-credential-only',fetcher:mockedFetch});
const live=buildAgentResponse({seedA:a,seedB:b,kind,mode:'live',...realPath});
assert.deepEqual(live.bridges.map(x=>x.name),['Common bridge']);
assert.equal(live.bridges[0].rankA,1);assert.equal(live.bridges[0].rankB,2);
assert.equal(hits.length,4);assert.ok(hits.every(x=>x.headers['X-Api-Key']==='mock-credential-only'));
assert.ok(hits.filter(x=>x.path==='/v2/insights').every(x=>x.params.get('feature.explainability')==='true'));
let caught=null;
try{await buildLiveComparison({seedA:a,seedB:b,kind,key:'mock',fetcher:async()=>({ok:false,status:429})})}
catch(err){caught=err}
assert.ok(caught instanceof QlooError);assert.equal(caught.code,'RATE_LIMIT');
console.log('CultureBridge focused integration: PASS — fixture watermark, real request route (mock), shared-ground ranking, source-only key header, explicit 429 classification');
