import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePages, diffSnapshots, renderReportHtml, fetchVellar, PROVIDER } from '../catalog.mjs';

// Publicly observed Vellar testnet /quote route and 402 terms, excerpted from the actual 2026-10-10 catalog.
const QUOTE = {
  resource:'https://vellar-seller-demo-testnet-production.up.railway.app/quote', type:'http', x402Version:2,
  accepts:[{scheme:'exact',network:'stellar:testnet',asset:'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',amount:'1000000',payTo:'GBBA3HN2PNOAJGR6R5VY34SQFDFTZFQIGDPYATJB34UXXFUHVR4KZRAZ'}],
  serviceName:'Motivational quote of the day (paid)',lastUpdated:'2026-10-04T14:35:12.743Z',
  extensions:{bazaar:{info:{input:{type:'http',method:'GET'}}}},trust:{ownerVerified:false,verification:'unknown'}
};
const page=rows=>[{offset:0,payload:{items:rows,total:rows.length}}];
const date='2026-10-10T20:18:06Z';

test('actual Vellar x402 v2 quote tuple, exact price/payee diff and quarantine',()=>{
  const old=analyzePages(page([QUOTE]),{capturedAt:date});
  assert.equal(old.offerCount,1);
  assert.equal(old.offers[0].amount,'1000000');
  assert.equal(old.offers[0].providerOwnerVerified,false);
  const newer={...QUOTE,accepts:[{...QUOTE.accepts[0],amount:'1200000',payTo:'GAATVGLRHZXFC66GEN5QNKD56HC5JJZVHQ3P7ZJNVCCI4WKLN44FICSC'}]};
  const updated=analyzePages(page([newer]),{capturedAt:'2026-10-10T20:28:00Z'});
  const delta=diffSnapshots(old,updated);
  assert.equal(delta.summary.changed,1);
  assert.equal(delta.changes[0].kind,'PRICE_CHANGED+PAYEE_CHANGED');
  assert.equal(delta.canApprovePayment,false);
  const malicious={...QUOTE,resource:'https://good.example@evil.example/path#frag'};
  const bad=analyzePages(page([malicious]),{capturedAt:date});
  assert.equal(bad.quarantinedCount,1);
  assert.equal(bad.offerCount,0);
  const injected=analyzePages(page([{...QUOTE,serviceName:'<img src=x onerror=alert(1)>'}]),{capturedAt:date});
  const html=renderReportHtml(injected);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img src=x'));
});

test('fetch executes original provider discovery GET only, retains exact HTTP body sha and complete declared count',async()=>{
  // Exact x402 v2 provider shape observed in the 27-row Vellar capture.
  const body=JSON.stringify({items:[QUOTE],pagination:{total:1,limit:100,offset:0}});
  const calls=[];
  const {pages,snapshot}=await fetchVellar({capturedAt:date,fetchImpl:async(url,init)=>{
    calls.push([url,init.method,init.redirect]);
    return new Response(body,{status:200,headers:{'content-type':'application/json'}});
  }});
  assert.equal(calls.length,1);
  assert.ok(calls[0][0].startsWith(PROVIDER+'/discovery/resources?'));
  assert.deepEqual(calls[0].slice(1),['GET','error']);
  assert.equal(snapshot.declaredTotal,1);
  assert.equal(pages[0].body,body);
  assert.match(snapshot.pageHashes[0].sha256,/^[a-f0-9]{64}$/);
});


test('rejects conflicting flat and x402 v2 pagination totals',()=>{
  assert.throws(
    ()=>analyzePages([{offset:0,payload:{items:[],total:0,pagination:{total:1}}}],{capturedAt:date}),
    /Conflicting Vellar pagination totals/
  );
});
