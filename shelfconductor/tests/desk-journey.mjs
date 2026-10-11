// SPDX-License-Identifier: MIT
// One source-exact HTTP journey. Provider transport is explicitly recorded,
// not a live Qloo run or a claim about retailer stock / competition performance.
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHandler} from '../src/server.mjs';
import {makeQlooClient} from '../src/qloo.mjs';
import {parseCatalog,parseCsv,moneyToCents,toCsv} from '../public/catalog.js';
const calls=[];
const qloo=makeQlooClient({apiKey:'fixture-only',fetchImpl:async(url,options)=>{
  calls.push({url:String(url),method:options.method});
  assert.equal(url.origin,'https://hackathon.api.qloo.com');
  return Response.json(url.pathname==='/search'?{results:{entities:[{entity_id:'fixture-seed-a',name:'Café, Atlas'},{entity_id:'fixture-seed-b',name:'Café, Atlas'}]}}:{results:{entities:[1,2,3,4].map(n=>({entity_id:`fixture-book-${n}`,name:`Fixture book ${n}`}))}});
}});
const server=http.createServer(createHandler({qloo}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const post=async(path,body)=>{const response=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
try{
  const csv='sku,title,author,price_cents,stock,isbn,observed_at,qloo_id\r\nS1,"Café, Atlas",Fixture Author,1200,2,9780140328721,2026-10-11T09:00:00-04:00,fixture-book-1\r\nS2,"A ""quoted"" title",Fixture Author,1500,1,,,fixture-book-2\r\nS3,Other title,Fixture Author,900,1,,,fixture-book-3\r\nS4,Empty shelf,Fixture Author,500,0,,,fixture-book-4\r\n';
  const parsed=parseCatalog(csv);let result=await post('/api/catalog',parsed);assert.equal(result.status,200);
  const inventory=result.data.inventory;assert.equal(inventory[0].isbn,'9780140328721');assert.equal(inventory[0].observed_at,'2026-10-11T13:00:00.000Z');assert.equal(inventory[1].title,'A "quoted" title');
  assert.throws(()=>parseCsv('sku,sku\na,b\n'),/unique/);assert.throws(()=>parseCsv('sku,title,author,stock,price_cents\nx,"bad"junk,a,1,100\n'),/closing quote/);
  assert.equal(moneyToCents('19.99'),1999);assert.throws(()=>moneyToCents('19.999'));
  result=await post('/api/catalog',{inventory:[{...inventory[0],stock:''}]});assert.equal(result.status,400);
  const body={inventory,mode:'live',seed_titles:['Café, Atlas'],budget_cents:2500,max_books:2};
  result=await post('/api/plan',body);assert.equal(result.status,503);assert.equal(result.data.error,'AMBIGUOUS_SEED');
  const search=await post('/api/search',{title:'Café, Atlas'});assert.equal(search.data.candidates.length,2);
  body.seed_selections=[{title:'Café, Atlas',qloo_id:'fixture-seed-b'}];result=await post('/api/plan',body);assert.equal(result.status,200);assert.equal(result.data.selected.length,2);assert.equal(result.data.total_cents,2100);assert.equal(result.data.coverage.out_of_stock,1);
  const alternate=result.data.alternatives[0];assert.equal(alternate.sku,'S2');
  const pinned=await post('/api/plan',{...body,include_skus:[alternate.sku]});assert.equal(pinned.status,200);assert.ok(pinned.data.selected.some(b=>b.sku==='S2'));assert.ok(pinned.data.total_cents<=2500);
  const excluded=await post('/api/plan',{...body,exclude_skus:['S1']});assert.equal(excluded.status,200);assert.ok(!excluded.data.selected.some(b=>b.sku==='S1'));
  const conflict=await post('/api/plan',{...body,budget_cents:1000,include_skus:['S2']});assert.equal(conflict.status,400);
  const changed=await post('/api/plan',{...body,include_skus:['S2'],inventory:inventory.map(b=>b.sku==='S2'?{...b,stock:0}:b)});assert.equal(changed.status,400);assert.equal(changed.data.error,'PIN_UNAVAILABLE');
  const wrong=await post('/api/plan',{...body,seed_selections:[{title:'Café, Atlas',qloo_id:'not-returned'}]});assert.equal(wrong.status,503);
  const editions=await post('/api/plan',{...body,inventory:[...inventory,{...inventory[0],sku:'CHEAPER',price_cents:1000}]});assert.equal(editions.status,200);assert.ok(editions.data.selected.some(b=>b.sku==='CHEAPER'));assert.equal(new Set(editions.data.selected.map(b=>b.qloo_id)).size,editions.data.selected.length);
  // Use the unchanged service, not a reduced planner, with a complete 10,000-row input.
  const large=Array.from({length:10000},(_,n)=>({...inventory[n%4],sku:`SCALE-${n}`}));const start=performance.now();
  const scaled=await post('/api/plan',{...body,inventory:large});assert.equal(scaled.status,200);assert.ok(scaled.data.total_cents<=2500);assert.equal(scaled.data.coverage.eligible,7500);
  assert.equal(calls.length,2,'Search and insights must be reused across stock / budget / exclusion replans');
  assert.ok(!JSON.stringify(scaled.data).includes('fixture-only'));assert.ok(toCsv([{sku:'=1+1'}],['sku']).includes("'=1+1"));
  const roundtrip=parseCatalog(JSON.stringify({format:'shelfconductor-catalog/v1',inventory,meta:{source:'Original catalog'}}),'saved.json');assert.equal(roundtrip.inventory[0].title,'Café, Atlas');assert.equal(roundtrip.meta.source,'Original catalog');
  console.log(JSON.stringify({passed:true,provider:'recorded transport only',originalProviderRequests:calls.length,journey:'CSV review -> exact entity choice -> plan -> pin -> exclude -> stock change -> catalog roundtrip',largeCatalogRows:10000,largeCatalogMilliseconds:Math.round(performance.now()-start),retailerData:'fictional fixtures',apiKeyExposure:false},null,2));
}finally{await new Promise(resolve=>server.close(resolve));}
