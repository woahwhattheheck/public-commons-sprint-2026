// MIT. Native HTTP check of only changed SF72 behavior; no paid operations or CI.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {evaluate} from './preflight.mjs';
const calls=[];
let good=true;
const server=createServer((req,res)=>{
  calls.push({method:req.method,path:req.url,origin:req.headers.origin,
    requestedMethod:req.headers['access-control-request-method'],
    requestedHeaders:req.headers['access-control-request-headers']});
  res.setHeader('Access-Control-Allow-Origin',good?'http://127.0.0.1:9999':'*');
  res.setHeader('Access-Control-Allow-Methods','POST');
  res.setHeader('Access-Control-Allow-Headers',good?'payment-signature, content-type':'content-type');
  res.statusCode=good?204:403;
  res.end();
});
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const resource='http://127.0.0.1:'+server.address().port+'/paid-post';
  const catalog='http://127.0.0.1:'+server.address().port+'/discovery/resources';
  const original={schema:'stellar-forge.merchant-intake.v1',observedAt:'2026-10-11T00:00:00.000Z',
    scope:{resource,catalog,buyerOrigin:'http://127.0.0.1:9999',network:'stellar:testnet',
      payTo:'G_PUBLIC_EXAMPLE',intendedRetryMethod:'POST'},
    originals:{browserReadiness:null,sellerCatalog:{schema:'stellar-forge.seller-visibility.v1',
      seller:resource,network:'stellar:testnet',desiredPayTo:'G_PUBLIC_EXAMPLE',
      sellerDiscovery:{state:'CATALOG_NON_GET_ONLY'},catalog:{endpoint:catalog,complete:true,
        matchingResourceCount:1,operationEvidence:{httpMethods:['POST'],mcpToolCount:0,
          unresolvedMethodCount:0},matchingEvidence:{desiredPaymentRouteFound:true}}}}};
  const ready=await evaluate(original,{allowLoopback:true});
  assert.equal(ready.status,'POST_PREFLIGHT_READY_CHALLENGE_UNKNOWN');
  assert.equal(ready.operations.OPTIONS,1);
  assert.deepEqual(calls.map(x=>x.method),['OPTIONS']);
  assert.equal(calls[0].requestedMethod,'POST');
  assert.equal(calls[0].requestedHeaders,'payment-signature,content-type');
  good=false;
  const broken=await evaluate(original,{allowLoopback:true,credentialed:true});
  assert.equal(broken.status,'PREFLIGHT_REMEDIATION');
  assert.ok(broken.findings.some(f=>f.code==='ORIGIN_NOT_ALLOWED'));
  assert.ok(broken.findings.some(f=>f.code==='HEADER_NOT_ALLOWED_PAYMENT_SIGNATURE'));
  const mcp=structuredClone(original);
  mcp.originals.sellerCatalog.catalog.operationEvidence={httpMethods:[],mcpToolCount:1,unresolvedMethodCount:0};
  assert.equal((await evaluate(mcp,{allowLoopback:true})).status,'INCONCLUSIVE');
  const wrongRecipient=structuredClone(original);
  wrongRecipient.originals.sellerCatalog.catalog.matchingEvidence.desiredPaymentRouteFound=false;
  assert.equal((await evaluate(wrongRecipient,{allowLoopback:true})).status,'INCONCLUSIVE');
  assert.deepEqual(calls.map(x=>x.method),['OPTIONS','OPTIONS']);
  console.log(JSON.stringify({check:'SF72 source-shape native HTTP acceptance',pass:true,
    observedOPTIONS:calls.length,GET:0,POST:0,cases:['ready','remediation','MCP_no_probe','payment_route_mismatch_no_probe']},null,2));
} finally {await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
