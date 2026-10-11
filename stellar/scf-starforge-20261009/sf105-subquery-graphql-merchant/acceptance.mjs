// MIT. One focused, source-native Node22 exercise: original SF30 upstream
// transport against an actual local SubQuery-shaped HTTP server.
// No hosted CI, wallet, fee payment, fixture scorer or external provider.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createSubQueryMerchantHandlers } from './adapter.mjs';
import { readSellerConfig, startSellerService } from '../sf30-seller-sdk/serve.mjs';
import { validateSubQuerySellerRoutes } from './adapter.mjs';

async function main() {
  const source = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)),
    'examples/approved-queries.json'),'utf8'));
  const observed = [];
  let mode = 'valid';
  const backend = createServer(async (req,res) => {
    const parts = [];
    for await (const part of req) parts.push(part);
    const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
    observed.push({ method:req.method,url:req.url,body,contentType:req.headers['content-type'] });
    const root = /payments/.test(body.query) ? 'payments' : 'credits';
    const data = mode === 'errors' ? { errors:[{message:'Private upstream error'}] } :
      {data:{[root]:{totalCount:1,nodes:[{id:'indexed-op',amount:'100.0000000'}]}}};
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify(data));
  });
  await new Promise((resolve,reject)=>backend.listen(0,'127.0.0.1',resolve).once('error',reject));
  const url = 'http://127.0.0.1:' + backend.address().port;
  let seller;
  try {
    const queries = {...source,origin:url,path:'/graphql'};
    delete queries.authorizationEnv;
    const handlers = createSubQueryMerchantHandlers(queries,{allowLoopback:true});
    const context = {method:'POST',url:new URL('http://127.0.0.1/indexed/payments'),
      pathParams:{},headers:{},body:{variables:{first:2}}};
    assert.equal(handlers.admitPayments(context),true);
    const paidPreview = await handlers.getPayments(context);
    assert.equal(paidPreview.status,200);
    assert.equal(paidPreview.body.operation,'payments');
    assert.equal(paidPreview.body.data.nodes[0].id,'indexed-op');
    assert.equal(observed.length,1);
    assert.equal(observed[0].method,'POST');
    assert.equal(observed[0].url,'/graphql');
    assert.equal(observed[0].body.variables.first,2);
    assert.equal(observed[0].body.query,source.operations[0].query);
    assert.match(observed[0].contentType,/application\/json/);
    assert.equal(handlers.admitPayments({...context,body:{variables:{first:1000}}}).status,422);
    assert.equal(handlers.admitPayments({...context,body:{query:'{__schema{types{name}}}',variables:{first:2}}}).status,422);
    assert.equal(observed.length,1);
    mode = 'errors';
    assert.equal((await handlers.getPayments(context)).status,502);
    assert.equal(observed.length,2);
    const sellerPath = process.argv[2];
    if (sellerPath) {
      const conf = await readSellerConfig(sellerPath);
      assert.equal(validateSubQuerySellerRoutes(conf,queries),true);
      seller = await startSellerService({config:conf,handlers,port:0});
      const request = await fetch(seller.url+'/indexed/payments',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({variables:{first:2}})});
      assert.equal(request.status,402);
      assert.equal(observed.length,2,
        'Unpaid 402 may not call private backend in original SF30 challenge-only mode');
    }
    console.log(JSON.stringify({result:'PASS',originalTransport:'SF30 upstream.mjs',
      backendPosts:observed.length,queryFilterRejected:true,graphqlErrorsRejected:true,
      ...(seller ? {originalSeller:'HTTP402 original payment challenge with zero backend calls'} :
        {originalSeller:'Supply owner seller JSON path for original challenge exercise'})}));
  } finally {
    if(seller) await seller.close();
    await new Promise(resolve=>backend.close(resolve));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
