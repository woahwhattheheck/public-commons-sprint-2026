// MIT. Focused changed-behavior source checks, no hosted CI or chain submission.
import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectSupported,inspectRequest,inspectResponse,auditCapture,
  probeSupported,checkHorizonInclusion} from '../conformance.mjs';
const network='stellar:testnet';
const kind={x402Version:2,scheme:'exact',network,extra:{areFeesSponsored:true}};
const supported={kinds:[kind],extensions:[],signers:{'stellar:*':[]}};
const pay={scheme:'exact',network,amount:'10000',asset:'CUSDC',payTo:'GSELLER',maxTimeoutSeconds:60};
const make=(scheme='exact',n=network,maximum='10000',actual=maximum)=>({x402Version:2,
  paymentPayload:{x402Version:2,accepted:{...pay,scheme,network:n,amount:maximum},payload:{transaction:'XDR'}} ,
  paymentRequirements:{...pay,scheme,network:n,amount:actual}});
test('stock /supported v2 truth: advertised is not proven settled',()=>{
  assert.equal(inspectSupported(supported,{network,scheme:'exact'}).advertised,true);
  assert.equal(inspectSupported(supported,{network,scheme:'upto'}).advertised,false);
  assert.throws(()=>inspectSupported({...supported,kinds:[kind,kind]}),/DUPLICATE/);
  assert.throws(()=>inspectSupported({...supported,kinds:[{...kind,extra:{areFeesSponsored:'yes'}}]}),/BAD_FEE/);
});
test('strict exact canonical envelopes and verify non-null error',()=>{
  assert.equal(inspectRequest('verify',make(),{network,scheme:'exact'}).maximumAtomic,'10000');
  assert.equal(inspectResponse('verify',{isValid:false,invalidReason:'invalid_payload'},
    {network,scheme:'exact',request:make()}).rejection,'invalid_payload');
  assert.throws(()=>inspectResponse('verify',{isValid:false},
    {network,scheme:'exact',request:make()}),/REASON_MISSING/);
  assert.throws(()=>inspectRequest('settle',make('exact',network,'10000','9999'),
    {network,scheme:'exact'}),/EXACT_AMOUNT_DRIFT/);
});
test('upto verify is ceiling, settle is metered; zero allowed and overcap denied',()=>{
  assert.equal(inspectRequest('verify',make('upto'),{network,scheme:'upto'}).requestedAtomic,'10000');
  assert.equal(inspectRequest('settle',make('upto',network,'10000','0'),
    {network,scheme:'upto'}).requestedAtomic,'0');
  assert.throws(()=>inspectRequest('verify',make('upto',network,'10000','10'),
    {network,scheme:'upto'}),/SIGNED_MAX/);
  assert.throws(()=>inspectRequest('settle',make('upto',network,'10000','10001'),
    {network,scheme:'upto'}),/UPTO_OVER_MAX/);
});
test('settle transaction presence, pending reason and cross-network drift',()=>{
  const r=make();
  assert.equal(inspectResponse('settle',{success:true,transaction:'deadbeef',network},
    {network,scheme:'exact',request:r}).valid,true);
  assert.throws(()=>inspectResponse('settle',{success:false,errorReason:'settlement_pending',transaction:'',network},
    {network,scheme:'exact',request:r}),/PENDING_TX_REQUIRED/);
  assert.throws(()=>inspectResponse('settle',{success:true,transaction:'tx',network:'stellar:pubnet'},
    {network,scheme:'exact',request:r}),/NETWORK_DRIFT/);
});
test('captured responses never mark onchain and preserve four coverage cells',()=>{
  const result=auditCapture({schema:'sf38.v1',observations:[{id:'r1',phase:'supported',network,
    scheme:'exact',response:supported},{id:'r2',phase:'settle',network,scheme:'exact',
    request:make(),response:{success:false,transaction:'',network,errorReason:'invalid_payload'}},
    {id:'bad',phase:'verify',network,scheme:'exact',request:make(),response:{isValid:false}}]});
  assert.equal(Object.keys(result.coverage).length,4);
  assert.equal(result.entries[0].evidence,'RECORDING_NOT_CHAIN_PROOF');
  assert.equal(result.entries[2].validWire,false);
  assert.equal(result.coverage['stellar:pubnet/upto'].claim,'UNMEASURED');
});
test('actual GET /supported captures hash and forbids POST',async()=>{
  const calls=[];
  const fake=async(url,options)=>{calls.push([url,options.method]);return new Response(JSON.stringify(supported),{status:200});};
  const result=await probeSupported('https://public.example.com',{fetchImpl:fake});
  assert.equal(result.assertion,'REAL_GET_SUPPORTED_ONLY_NO_PAYMENT');
  assert.deepEqual(calls,[['https://public.example.com/supported','GET']]);
  await assert.rejects(probeSupported('http://localhost:3000'),/HTTPS/);
});
test('official network passphrase+tx inclusion separate from transfer proof',async()=>{
  const tx='a'.repeat(64),calls=[];
  const mock=async(url,options)=>{
    calls.push([url,options.method]);
    if(url.endsWith('/'))return new Response(JSON.stringify({network_passphrase:'Test SDF Network ; September 2015'}));
    return new Response(JSON.stringify({hash:tx,successful:true,ledger:123,created_at:'2026-10-10T00:00:00Z'}));
  };
  const proof=await checkHorizonInclusion({network,transaction:tx,fetchImpl:mock});
  assert.equal(proof.evidence,'INDEPENDENT_OFFICIAL_HORIZON_TX_INCLUDED_ONLY');
  assert.equal(proof.amountVerified,false);
  assert.deepEqual(calls.map(x=>x[1]),['GET','GET']);
  const wrong=async url=>new Response(JSON.stringify({network_passphrase:'Public Global Stellar Network ; September 2015'}));
  await assert.rejects(checkHorizonInclusion({network,transaction:tx,fetchImpl:wrong}),/PASSPHRASE_MISMATCH/);
});