// Focused source-integration check. Uses the real SF82/SF43/SF52 implementations
// and a LOCAL RPC wire fixture, not a wallet, transfer or hosted Actions run.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { executeWithEvidence } from './evidence.mjs';

const asset='C'+'A'.repeat(55), payTo='G'+'B'.repeat(55), payer='G'+'C'.repeat(55),
  tx='a'.repeat(64), price='25000';
let rpcCalls=0, buyerCalls=0;
const server=createServer(async(req,res)=>{
  let raw='';
  for await (const chunk of req) raw+=chunk;
  const input=JSON.parse(raw); rpcCalls++;
  assert.equal(req.method,'POST');
  const result=input.method==='getTransaction'
    ? {status:'SUCCESS',txHash:tx,ledger:123}
    : input.method==='getEvents'
      ? {events:[{txHash:tx,contractId:asset,id:'123-0'}],cursor:null}
      : null;
  assert.ok(result,'Original SF43 only uses getTransaction and getEvents');
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({jsonrpc:'2.0',id:input.id,result}));
});
server.listen(0,'127.0.0.1');
await once(server,'listening');
const rpcEndpoint=`http://127.0.0.1:${server.address().port}/`;
const outputDir=await mkdtemp(join(tmpdir(),'scf82-native-'));
const terms={scheme:'exact',network:'stellar:testnet',asset,payTo,amount:price};
const responseText='private HTTP resource content: DO NOT PERSIST';
const sent={intentId:'sf82-one-original-intent',status:'DELIVERED_REPORTED_SETTLED',
  attempts:2,httpStatus:200,settlement:'REPORTED_SUCCESS',requirement:terms,
  receipt:{success:true,network:'stellar:testnet',transaction:tx},
  operatorReservation:{outcome:'FRESH_RESERVATION_APPROVED',request_id:'sf82-one-original-intent',
    reserved_atomic_units:price,network:'stellar:testnet',secret:'not-public'},
  response:new Response(responseText,{status:200})};
try {
  const buyer={call:async options=>{buyerCalls++; assert.equal(options.intentId,sent.intentId);return sent;}};
  const first=await executeWithEvidence({buyer,call:{intentId:sent.intentId},
    outputDir,trustedPayer:payer,rpcEndpoint,captureBody:true,
    decodeContractEvent:async()=>({name:'transfer',from:payer,to:payTo,amount:price})});
  assert.equal(first.error,null);
  assert.equal(first.report.counts.verifiedTransfers,1);
  assert.equal(first.report.counts.transferAndBodyObserved,1);
  assert.equal(buyerCalls,1);assert.equal(rpcCalls,2);
  assert.equal((await stat(first.evidencePath)).mode & 0o777,0o600);
  const persisted=await readFile(first.evidencePath,'utf8');
  assert.equal(persisted.includes(responseText),false);
  assert.equal(persisted.includes('not-public'),false);
  const envelope=JSON.parse(persisted);
  assert.equal(envelope.observation.chain.status,'TOKEN_TRANSFER_MATCHED_TESTNET');
  assert.equal(envelope.report.outcomes[0].status,'TRANSFER_AND_HTTP_BODY_OBSERVED');
  assert.equal(envelope.operatorReservation.requestId,sent.intentId);
  await assert.rejects(executeWithEvidence({buyer,call:{intentId:sent.intentId},outputDir}),
    /TERMINAL_EVIDENCE_ALREADY_EXISTS/);
  assert.equal(buyerCalls,1,'duplicate did not even call original buyer');

  const err={paymentSent:true,code:'PAYMENT_OUTCOME_UNKNOWN',cause:{secret:'hide-me'}};
  const failed=await executeWithEvidence({buyer:{call:async()=>{throw err;}},
    call:{intentId:'sf82-lost-response'},outputDir});
  assert.equal(failed.error,err);
  assert.equal(failed.report.counts.verifiedTransfers,0);
  assert.equal(failed.report.outcomes[0].status,'SIGNED_RESULT_UNCERTAIN');
  assert.equal((await readFile(failed.evidencePath,'utf8')).includes('hide-me'),false);

  const free=await executeWithEvidence({buyer:{call:async()=>({intentId:'sf82-free-resource',
    status:'NO_PAYMENT_REQUIRED',attempts:1,httpStatus:200,settlement:'NOT_REQUESTED',
    requirement:null,receipt:null,response:new Response('free content',{status:200})})},
    call:{intentId:'sf82-free-resource'},outputDir,captureBody:true});
  assert.equal(free.report.outcomes[0].status,'NO_PAYMENT_REQUIRED');
  assert.equal(free.report.counts.verifiedTransfers,0);
  console.log(JSON.stringify({status:'PASS',originalModules:['SF43','SF52'],
    callsToOriginalBuyer:buyerCalls,originalVerifierRpcCalls:rpcCalls,
    receiptStatus:first.report.outcomes[0].status,
    lostResponse:failed.report.outcomes[0].status,
    freeResponse:free.report.outcomes[0].status,
    terminalEvidenceIsCreateOnly:true,noPaidEndpointContact:true}));
} finally {
  server.close();
  await rm(outputDir,{recursive:true,force:true});
}