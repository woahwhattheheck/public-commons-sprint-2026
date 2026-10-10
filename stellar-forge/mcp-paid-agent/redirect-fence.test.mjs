import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { McpPaidToolBroker } from './agent-server.mjs';

const start=async handler=>{
  const server=createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,url:'http://127.0.0.1:'+server.address().port};
};
const end=async obj=>new Promise((resolve,reject)=>obj.server.close(err=>err?reject(err):resolve()));
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64');

// Exactly one focused original broker / real Node-fetch loopback check.
// No Stellar keys, provider endpoints, network outside 127.0.0.1 or payments.
test('discovery and signed buyer requests refuse 3xx origin escape', async()=>{
  let attackerHits=0, signedHits=0;
  const attacker=await start((req,res)=>{
    attackerHits++;
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({leak:true,hasSignature:!!req.headers['payment-signature']}));
  });
  const accepted={scheme:'exact',network:'stellar:testnet',asset:'USDC:TEST',
    amount:'17000',payTo:'GSELLER'};
  let merchant,catalog,redirectCatalog;
  try{
    merchant=await start((req,res)=>{
      if(req.url!=='/paid'){res.writeHead(404);res.end();return;}
      if(!req.headers['payment-signature']){
        const required={x402Version:2,resource:{url:merchant.url+'/paid'},accepts:[accepted]};
        res.writeHead(402,{'PAYMENT-REQUIRED':b64(required)});res.end('{}');return;
      }
      signedHits++;
      res.writeHead(307,{location:attacker.url+'/steal'});res.end();
    });
    catalog=await start((req,res)=>{
      if(!req.url.startsWith('/discovery/search')){res.writeHead(404);res.end();return;}
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({resources:[{
        resource:{url:merchant.url+'/paid',description:'Test-only signed route'},
        accepts:[accepted],extensions:{bazaar:{info:{input:{type:'http',method:'GET'}}}}
      }]}));
    });
    const broker=new McpPaidToolBroker({discoveryUrl:catalog.url,
      allowedResourceOrigins:[merchant.url],
      approve:()=>true,signPayment:async ({resource,accepted})=>({
        x402Version:2,resource,accepted,payload:{localFixture:true}
      })});
    const rows=await broker.search({query:'paid'});
    assert.equal(rows.resources.length,1);
    const quote=broker.preview({handle:rows.resources[0].handle});
    const result=await broker.execute({quoteId:quote.quoteId});
    assert.equal(result.status,'INDETERMINATE');
    assert.equal(result.attempts,1);
    assert.equal(result.recovery.recoveryAction,'reconcile_settlement');
    assert.equal(result.recovery.safeToAutoRetry,false);
    assert.equal(signedHits,1);
    assert.equal(attackerHits,0,'signed PAYMENT-SIGNATURE must never follow merchant 307');
    assert.equal((await broker.execute({quoteId:quote.quoteId})).status,'INDETERMINATE');
    assert.equal(signedHits,1,'replay cannot submit another signed payment');

    redirectCatalog=await start((req,res)=>{
      res.writeHead(302,{location:attacker.url+'/catalog-copy'});res.end();
    });
    const alternate=new McpPaidToolBroker({discoveryUrl:redirectCatalog.url});
    await assert.rejects(()=>alternate.search({query:'paid'}));
    assert.equal(attackerHits,0,'catalog 302 may not escape configured discovery origin');
  } finally {
    if(redirectCatalog)await end(redirectCatalog);
    if(catalog)await end(catalog);
    if(merchant)await end(merchant);
    await end(attacker);
  }
});
