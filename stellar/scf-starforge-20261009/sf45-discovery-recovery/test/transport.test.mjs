// MIT. Real PR451 discovery transport retry behavior under explicit local fault injection.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {BazaarCatalog,createDiscoveryServer} from '../../../../scf46-stellar-bazaar/src/catalog.mjs';
import {fetchDiscoveryCatalog,DiscoveryError} from '../recovery.mjs';
function entry(n){return {
  resource:{url:'https://example.org/weather-'+n,serviceName:'Weather',description:'weather'},
  accepts:[{network:'stellar:testnet',scheme:'exact',payTo:'DEVELOPMENT_FIXTURE_ONLY'}],
  extensions:{bazaar:{info:{input:{type:'http',method:'GET'}},schema:{type:'object'}}}
};}
async function serve(handler){
  const server=createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {baseUrl:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};
}
test('503 then 429 injected at real HTTP boundary are retried; original catalog fully paginates',async()=>{
  const c=new BazaarCatalog();for(let i=0;i<5;i++)c.insertValidated(entry(i));
  const real=createDiscoveryServer(c);let count=0;
  const s=await serve((req,res)=>{if(count<2){res.writeHead(count++===0?503:429);res.end('injected');}else real(req,res);});
  try {
    const r=await fetchDiscoveryCatalog({baseUrl:s.baseUrl,query:'weather',pageLimit:2,backoffMs:1,maxRetries:3});
    assert.equal(r.resources.length,5);assert.equal(r.retries,2);assert.equal(r.attempts,5);assert.equal(r.paymentCalls,0);
  }finally{await s.close();}
});
test('persistent 503 exhausts retry budget rather than inventing success',async()=>{
  const s=await serve((req,res)=>{res.writeHead(503);res.end('injected');});
  try {
    await assert.rejects(fetchDiscoveryCatalog({baseUrl:s.baseUrl,query:'weather',backoffMs:1,maxRetries:1}),
      e=>e instanceof DiscoveryError&&e.code==='DISCOVERY_HTTP_EXHAUSTED'&&e.status===503);
  }finally{await s.close();}
});
