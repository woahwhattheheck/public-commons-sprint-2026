// MIT. Real PR451 catalog cursor-recovery regression; node --test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {BazaarCatalog,createDiscoveryServer} from '../../../../scf46-stellar-bazaar/src/catalog.mjs';
import {fetchDiscoveryCatalog} from '../recovery.mjs';
const entry=n=>({
  resource:{url:'https://example.org/weather-'+n,serviceName:'Weather',description:'weather'},
  accepts:[{network:'stellar:testnet',scheme:'exact',payTo:'DEVELOPMENT_FIXTURE_ONLY'}],
  extensions:{bazaar:{info:{input:{type:'http',method:'GET'}},schema:{type:'object'}}}
});
test('real HTTP stale cursor refreshes the actual Bazaar catalog without payment',async()=>{
  const catalog=new BazaarCatalog();
  for(let i=0;i<4;i++)catalog.insertValidated(entry(i));
  const server=createServer(createDiscoveryServer(catalog));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const baseUrl='http://127.0.0.1:'+server.address().port;
  let once=false;
  try {
    const result=await fetchDiscoveryCatalog({
      baseUrl,query:'weather',pageLimit:2,
      onPage:({pages})=>{if(pages===1&&!once){once=true;catalog.insertValidated(entry(99));}}
    });
    assert.equal(result.resources.length,5);
    assert.equal(result.restarts,1);
    assert.equal(result.paymentCalls,0);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
