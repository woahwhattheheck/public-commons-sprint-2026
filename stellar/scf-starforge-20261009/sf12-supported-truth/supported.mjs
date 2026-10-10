// MIT License. SF-12 source-coupled x402 v2 /supported readiness filter.
// Real x402Facilitator.getSupported() is the source of candidate kinds;
// operator-provided runtime probes must be live, fresh and positive before advertising.
// No wallet custody, signing, funding, fee claims, network calls or SDK replacement.
import {createServer} from 'node:http';

const NETWORKS = new Set(['stellar:testnet', 'stellar:pubnet']);
const PLAIN = o => o !== null && typeof o === 'object' && !Array.isArray(o);
const isName = x => typeof x === 'string' && x.length > 0 && x.length < 256;
const isAddr = x => typeof x === 'string' && /^(?:[GC][ABCD][A-Z2-7]{54})$/.test(x);
const isAsset = x => typeof x === 'string' && /^(?:C[ABCD][A-Z2-7]{54})$/.test(x);
const JSON_LIMIT = 32768;

export class SupportedError extends Error {
  constructor(code){super(code);this.name='SupportedError';this.code=code;}
}
function cleanConfig(config){
  if(!PLAIN(config))throw new SupportedError('BAD_OPERATOR_CONFIG');
  const output={};
  for(const [network,value] of Object.entries(config)) {
    if(!NETWORKS.has(network) || !PLAIN(value) || typeof value.enabled!=='boolean')
      throw new SupportedError('BAD_NETWORK_POLICY');
    if (!Array.isArray(value.schemes) || value.schemes.length<1 || value.schemes.some(s=>!['exact','upto'].includes(s)))
      throw new SupportedError('BAD_SCHEME_POLICY');
    if (!Array.isArray(value.assets) || value.assets.length===0 || value.assets.length>32)
      throw new SupportedError('BAD_ASSET_POLICY');
    const set=new Set();
    const assets=value.assets.map(x=>{
      if(!PLAIN(x)||!isAsset(x.asset)||!Number.isInteger(x.decimals)||x.decimals<0||x.decimals>18||!isName(x.symbol)||set.has(x.asset))
        throw new SupportedError('BAD_ASSET_POLICY');
      set.add(x.asset);
      return Object.freeze({asset:x.asset,decimals:x.decimals,symbol:x.symbol});
    });
    if (value.schemes.includes('upto') && (!value.uptoContract || !isAsset(value.uptoContract)))
      throw new SupportedError('UPTO_CONTRACT_PIN_REQUIRED');
    output[network]=Object.freeze({enabled:value.enabled,schemes:new Set(value.schemes),assets,
      uptoContract:value.uptoContract??null});
  }
  return Object.freeze(output);
}
function checkCanonical(result){
  if(!PLAIN(result)||!Array.isArray(result.kinds)||!Array.isArray(result.extensions)||!PLAIN(result.signers))
    throw new SupportedError('BAD_CANONICAL_SDK_SUPPORTED');
  if(result.kinds.length>128 || result.extensions.length>128)throw new SupportedError('OVERSIZED_SUPPORTED');
  const signers=result.signers['stellar:*'];
  if(!Array.isArray(signers)||signers.some(s=>!isAddr(s)))throw new SupportedError('NO_CANONICAL_STELLAR_SIGNERS');
  if(new Set(signers).size!==signers.length)throw new SupportedError('DUPLICATE_SIGNERS');
  return {signers};
}
function checkProbe(proof,network,nowSec,maxAgeSeconds,assetSet){
  if(!PLAIN(proof)||proof.network!==network||proof.rpcReachable!==true||proof.signingReady!==true||proof.feeReady!==true||
     !Number.isInteger(proof.checkedAtUnix)||proof.checkedAtUnix>nowSec+2||
     (nowSec-proof.checkedAtUnix)>maxAgeSeconds || !Array.isArray(proof.signers)|| !Array.isArray(proof.readyAssets))
    return false;
  if(proof.signers.length<1 || proof.signers.some(s=>!isAddr(s)) || proof.readyAssets.length<1) return false;
  if(proof.readyAssets.some(a=>!assetSet.has(a)))return false;
  if(new Set(proof.signers).size!==proof.signers.length)return false;
  return true;
}
const advertisedExtra = extra=>PLAIN(extra)&&extra.areFeesSponsored===true;
/**
 * Never construct a facilitator, signer or network capability here.
 * caller MUST pass actual @x402/core/facilitator x402Facilitator instance
 * already registered with actual @x402/stellar mechanism(s), and an actual
 * no-spend operator readiness probe running against the target network.
 */
export class TruthfulSupported {
  #facilitator;
  #config;
  #probe;
  #maxAgeSeconds;
  #time;
  constructor({facilitator,config,probe,time=()=>Math.floor(Date.now()/1000),maxAgeSeconds=30}={}){
    if(typeof facilitator?.getSupported!=='function'||typeof probe!=='function'||typeof time!=='function'||
       !Number.isSafeInteger(maxAgeSeconds)||maxAgeSeconds<1||maxAgeSeconds>300)
      throw new SupportedError('CANONICAL_ADAPTER_OR_PROBE_REQUIRED');
    this.#facilitator=facilitator;
    this.#config=cleanConfig(config);
    this.#probe=probe;
    this.#time=time;
    this.#maxAgeSeconds=maxAgeSeconds;
  }
  async snapshot(){
    const canonical=this.#facilitator.getSupported();
    const {signers}=checkCanonical(canonical);
    const kinds=[];
    const readyAssets=[];
    const signerSet=new Set();
    const seenKinds=new Set();
    const now=this.#time();
    if(!Number.isSafeInteger(now)||now<0)throw new SupportedError('BAD_CLOCK');
    for(const network of NETWORKS) {
      const policy=this.#config[network];
      if(!policy?.enabled) continue;
      let proof;
      try{proof=await this.#probe({network,assets:policy.assets.map(x=>({...x})),schemes:[...policy.schemes]});}
      catch {continue;}
      const assets=new Set(policy.assets.map(x=>x.asset));
      if(!checkProbe(proof,network,now,this.#maxAgeSeconds,assets)) continue;
      const commonSigners=proof.signers.filter(s=>signers.includes(s));
      if(commonSigners.length===0)continue;
      const healthyAssets=policy.assets.filter(a=>proof.readyAssets.includes(a.asset));
      if(!healthyAssets.length)continue;
      for(const entry of canonical.kinds) {
        if(!PLAIN(entry)||entry.x402Version!==2||entry.network!==network||
           !policy.schemes.has(entry.scheme)||!['exact','upto'].includes(entry.scheme)||
           !advertisedExtra(entry.extra))continue;
        // The x402 /supported standard cannot express per-asset availability.
        // Keep independent asset inventory and require proof of ready assets.
        if(entry.scheme==='upto') {
          if(proof.uptoContractReady!==true||entry.extra.settlementContract!==policy.uptoContract)
            continue;
        }
        const id=entry.scheme+'@'+entry.network;
        if(seenKinds.has(id))throw new SupportedError('DUPLICATE_CANONICAL_KIND');
        seenKinds.add(id);
        kinds.push({x402Version:2,scheme:entry.scheme,network,extra:{...entry.extra}});
      }
      if(kinds.some(k=>k.network===network)){
        for(const signer of commonSigners)signerSet.add(signer);
        for(const asset of healthyAssets)readyAssets.push({network,...asset});
      }
    }
    kinds.sort((a,b)=>a.network.localeCompare(b.network)||a.scheme.localeCompare(b.scheme));
    readyAssets.sort((a,b)=>a.network.localeCompare(b.network)||a.asset.localeCompare(b.asset));
    // Disabling unsupported extensions is safer than advertising a registered
    // global extension with unknown runtime network or scheme dependencies.
    const response={kinds,extensions:[],signers:{'stellar:*':[...signerSet].sort()}};
    return {supported:response,assetManifest:{x402Version:2,assets:readyAssets},ready:kinds.length>0};
  }
}
function json(res,status,body){
  const content=JSON.stringify(body);
  if(Buffer.byteLength(content)>JSON_LIMIT){res.writeHead(503);res.end();return;}
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff','content-length':Buffer.byteLength(content)});
  res.end(content);
}
/** Embed on a dedicated private loopback listener or put auth/proxy upstream. */
export function createSupportedServer({gateway,hostname='127.0.0.1'}={}){
  if(typeof gateway?.snapshot!=='function')throw new SupportedError('GATEWAY_REQUIRED');
  if(hostname!=='127.0.0.1'&&hostname!=='::1')throw new SupportedError('LOOPBACK_ONLY');
  return createServer(async(req,res)=>{
    if(req.method!=='GET'){json(res,405,{error:'METHOD_NOT_ALLOWED'});return;}
    if(req.url!=='/supported'&&req.url!=='/supported/assets'&&req.url!=='/health'){
      json(res,404,{error:'NOT_FOUND'});return;
    }
    try {
      const snapshot=await gateway.snapshot();
      if(req.url==='/health'){json(res,snapshot.ready?200:503,{ready:snapshot.ready});return;}
      if(req.url==='/supported'){json(res,200,snapshot.supported);return;}
      json(res,200,snapshot.assetManifest);
    }catch{json(res,503,{error:'SUPPORTED_UNAVAILABLE'});}
  }).on('listening',function(){
    const bound=this.address();
    if(bound&&typeof bound!=='string'&&bound.address!==hostname) this.close();
  });
}
