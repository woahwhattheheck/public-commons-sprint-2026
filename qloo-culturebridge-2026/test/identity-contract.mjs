// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {bridgeIntersection,normalizeInsights,buildAgentResponse} from '../src/engine.mjs';
import {buildLiveComparison,QlooError} from '../src/qloo.mjs';

// Deliberate collision: same displayed name, different provider IDs.
const a=normalizeInsights({results:{entities:[
  {id:'qloo:one',name:'The Commons'}, {id:'qloo:shared',name:'Different spelling'},
  {name:'Untyped brand'}
]}});
const b=normalizeInsights({results:{entities:[
  {id:'qloo:two',name:'The Commons'}, {id:'qloo:shared',name:'Another display name'},
  {name:'Untyped brand'}
]}});
const bridges=bridgeIntersection(a,b);
assert.deepEqual(bridges.map(v=>v.id),['qloo:shared']);
const result=buildAgentResponse({seedA:'one',seedB:'two',kind:'artist',mode:'live',resultsA:{results:{entities:[{id:'different1',name:'Twin'}]}},resultsB:{results:{entities:[{id:'different2',name:'Twin'}]}},trace:[]});
assert.equal(result.bridges.length,0);
assert.ok(result.method.includes('same Qloo entity ID'));
const hits=[];
const fetcher=async(url,opts)=>{
  hits.push({url:new URL(url),opts});
  if(url.pathname==='/search')return {ok:true,json:async()=>({results:[{id:url.searchParams.get('query')==='Art One'?'art1':'art2',name:url.searchParams.get('query')}]})};
  return {ok:true,json:async()=>({results:{entities:[{id:'same-record',name:'Same Entity'}]}})};
};
const live=await buildLiveComparison({seedA:'Art One',seedB:'Art Two',kind:'artist',key:'mock-server-key',fetcher});
assert.equal(hits.length,4);
assert.ok(hits.every(x=>x.url.origin==='https://hackathon.api.qloo.com'));
assert.ok(hits.every(x=>x.opts.headers['X-Api-Key']==='mock-server-key'));
assert.equal(buildAgentResponse({seedA:'Art One',seedB:'Art Two',kind:'artist',mode:'live',...live}).bridges.length,1);
let contractError;
try{await buildLiveComparison({seedA:'Art One',seedB:'Art Two',kind:'artist',key:'mock',fetcher:async()=>({ok:true,json:async()=>({unexpected:[]})})});}
catch(error){contractError=error;}
assert.ok(contractError instanceof QlooError);
assert.equal(contractError.code,'RESPONSE');
console.log('CultureBridge identity and provider contract: PASS — stable ID-only matches, correct Qloo hackathon origin, and unknown-envelope failure');
