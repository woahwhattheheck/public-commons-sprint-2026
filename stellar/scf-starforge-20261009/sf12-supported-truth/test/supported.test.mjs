import test from 'node:test';
import assert from 'node:assert/strict';
import {TruthfulSupported,createSupportedServer} from '../supported.mjs';
const T='stellar:testnet',P='stellar:pubnet';
const USDC='CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const PUB='CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75';
const signer='G'+'A'.repeat(55); // offline structure fixture, not a live Stellar key
const kinds=[{x402Version:2,scheme:'exact',network:T,extra:{areFeesSponsored:true}},
 {x402Version:2,scheme:'exact',network:P,extra:{areFeesSponsored:true}},
 {x402Version:2,scheme:'upto',network:T,extra:{areFeesSponsored:true,settlementContract:'C'+'A'.repeat(55)}}];
const SDK=()=>({getSupported(){return {kinds:structuredClone(kinds),extensions:['bazaar'],signers:{'stellar:*':[signer]}};}});
const conf=()=>({[T]:{enabled:true,schemes:['exact','upto'],uptoContract:'C'+'A'.repeat(55),assets:[{asset:USDC,symbol:'USDC',decimals:7}]},
 [P]:{enabled:false,schemes:['exact'],assets:[{asset:PUB,symbol:'USDC',decimals:7}]}});
const now=1791612900;
const makeProof=network=>({network,rpcReachable:true,signingReady:true,feeReady:true,checkedAtUnix:now,
 signers:[signer],readyAssets:[network===T?USDC:PUB],uptoContractReady:false});
const gateway=(overrides={})=>new TruthfulSupported({facilitator:overrides.sdk??SDK(),
 config:overrides.config??conf(),probe:overrides.probe??(async ({network})=>makeProof(network)),time:()=>now,maxAgeSeconds:30});

test('canonical 2 kind+signer response has only registered, healthy testnet exact; no unsupported pubnet or upto or extensions',async()=>{
 const r=await gateway().snapshot();
 assert.deepEqual(r.supported,{kinds:[kinds[0]],extensions:[],signers:{'stellar:*':[signer]}});
 assert.deepEqual(r.assetManifest.assets,[{network:T,asset:USDC,symbol:'USDC',decimals:7}]);
});
test('upto only after actual SDK registration plus scheme-specific contract proof',async()=>{
 const yes=await gateway({probe:async ({network})=>({...makeProof(network),uptoContractReady:true})}).snapshot();
 assert.deepEqual(yes.supported.kinds.map(x=>x.scheme),['exact','upto']);
 const noUpstream=await gateway({sdk:{getSupported:()=>({...SDK().getSupported(),kinds:[kinds[0]]})},
  probe:async ({network})=>({...makeProof(network),uptoContractReady:true})}).snapshot();
 assert.deepEqual(noUpstream.supported.kinds.map(x=>x.scheme),['exact']);
});
test('no mainnet due to config even if upstream registers; explicit config + source + fresh probe required',async()=>{
 const a=conf();a[P].enabled=true;
 const s=await gateway({config:a}).snapshot();
 assert.deepEqual(s.supported.kinds.map(x=>x.network),[P,T]);
 const onlyDefault=await gateway().snapshot();
 assert.deepEqual(onlyDefault.supported.kinds.map(x=>x.network),[T]);
 const denyPub=await gateway({config:a,probe:async ({network})=>({...makeProof(network),rpcReachable:network!==P})}).snapshot();
 assert.deepEqual(denyPub.supported.kinds.map(x=>x.network),[T]);
});
test('readiness denial for stale, wrong network, no signer, asset mismatch, failure and false fee flag',async()=>{
 for(const change of [p=>{p.checkedAtUnix-=31;},p=>{p.network=P;},p=>{p.signers=[];},p=>{p.readyAssets=[PUB];},p=>{p.rpcReachable=false;},p=>{p.feeReady=false;}]){
  const p=makeProof(T);change(p);
  const r=await gateway({probe:async()=>p}).snapshot();assert.deepEqual(r.supported.kinds,[]);
 }
 const sdk={getSupported:()=>({...SDK().getSupported(),kinds:[{...kinds[0],extra:{areFeesSponsored:false}}]})};
 assert.deepEqual((await gateway({sdk}).snapshot()).supported.kinds,[]);
 const thrown=await gateway({probe:async()=>{throw Error('rpc down');}}).snapshot();
 assert.deepEqual(thrown.supported.kinds,[]);
});
test('truth and allowlist defenses against strange source records or operator config',async()=>{
 const bad=conf();bad[T].assets=[{asset:'not-a-token',symbol:'USDC',decimals:7}];
 assert.throws(()=>gateway({config:bad}),/BAD_ASSET/);
 const dup={getSupported:()=>({...SDK().getSupported(),kinds:[kinds[0],kinds[0]]})};
 await assert.rejects(gateway({sdk:dup}).snapshot(),/DUPLICATE/);
 const noSigner={getSupported:()=>({...SDK().getSupported(),signers:{'stellar:*':[]}})};
 assert.deepEqual((await gateway({sdk:noSigner}).snapshot()).supported.kinds,[]);
});
test('actual loopback Node HTTP GET /supported and /assets truth shape; invalid methods fail closed',async()=>{
 const http=createSupportedServer({gateway:gateway()});
 await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
 try{
  const base='http://127.0.0.1:'+http.address().port;
  let res=await fetch(base+'/supported');assert.equal(res.status,200);
  assert.deepEqual((await res.json()).kinds,[kinds[0]]);
  res=await fetch(base+'/supported/assets');assert.equal(res.status,200);
  assert.deepEqual((await res.json()).assets.map(x=>x.asset),[USDC]);
  res=await fetch(base+'/supported',{method:'POST'});assert.equal(res.status,405);
  res=await fetch(base+'/health');assert.equal(res.status,200);
 }finally{await new Promise(resolve=>http.close(resolve));}
});
