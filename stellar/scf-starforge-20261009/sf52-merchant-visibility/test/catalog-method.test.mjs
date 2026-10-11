// MIT. Focused loopback HTTP check for catalog-declared HTTP method selection.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {diagnose} from '../diagnose.mjs';

async function serve(handler) {
  const server = createServer(handler);
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  return {url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(r=>server.close(r))};
}
const payment = {network:'stellar:testnet',scheme:'exact',asset:'TEST_ASSET',payTo:'GTESTRECIPIENT',amount:'100'};
const header=Buffer.from(JSON.stringify({x402Version:2,accepts:[payment],
  extensions:{bazaar:{info:{input:{type:'http',method:'GET'}}}}})).toString('base64');
test('complete POST-only listing skips GET; GET listing probes original HTTP endpoint',async()=>{
  let method='POST',sellerGets=0;
  const seller=await serve((req,res)=>{
    if(req.method==='GET')sellerGets++;
    res.writeHead(method==='POST'?405:402,{'payment-required':header});
    res.end();
  });
  const catalog=await serve((_req,res)=>{
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({items:[{
      type:'http',resource:seller.url+'/operation',x402Version:2,accepts:[payment],
      extensions:{bazaar:{info:{input:{type:'http',method}}}}
    }],pagination:{total:1}}));
  });
  const run=()=>diagnose({resourceUrl:seller.url+'/operation',
    catalogUrl:catalog.url+'/discovery/resources',network:'stellar:testnet',
    payTo:payment.payTo,allowLoopback:true});
  try {
    const first=await run();
    assert.equal(first.verdict,'LISTED');
    assert.deepEqual(first.catalog.operationEvidence.httpMethods,['POST']);
    assert.equal(first.challenge.state,'CATALOG_NON_GET_ONLY');
    assert.equal(first.sellerDiscovery.state,'CATALOG_NON_GET_ONLY');
    assert.equal(sellerGets,0);
    method='GET';
    const second=await run();
    assert.equal(second.verdict,'LISTED');
    assert.equal(second.challenge.state,'X402_402');
    assert.equal(sellerGets,1);
  } finally {await catalog.close();await seller.close();}
});
test('incomplete method metadata does not suppress origin GET',async()=>{
  let sellerGets=0;
  const seller=await serve((_req,res)=>{sellerGets++;res.writeHead(402,{'payment-required':header});res.end();});
  const catalog=await serve((_req,res)=>{
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({items:[{type:'http',resource:seller.url+'/resource',accepts:[payment]}],
      pagination:{total:1}}));
  });
  try {
    const result=await diagnose({resourceUrl:seller.url+'/resource',
      catalogUrl:catalog.url+'/discovery/resources',payTo:payment.payTo,
      network:'stellar:testnet',allowLoopback:true});
    assert.equal(result.catalog.operationEvidence.unresolvedMethodCount,1);
    assert.equal(result.challenge.state,'X402_402');
    assert.equal(sellerGets,1);
  } finally {await catalog.close();await seller.close();}
});
