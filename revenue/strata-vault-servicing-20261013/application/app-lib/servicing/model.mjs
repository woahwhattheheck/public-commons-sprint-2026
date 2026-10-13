import { Address, StrKey, scValToNative, xdr } from "@stellar/stellar-sdk";

export const SOURCE_COMMIT = "400754230a3fecaa69385687ba8457f1c2250d13";
export const ROLES = ["async_vault","share_token","nav_oracle","identity_verifier","compliance","asset"];
const own = (v,k) => Object.prototype.hasOwnProperty.call(v,k);
const obj = v => v !== null && typeof v === "object" && !Array.isArray(v);
function need(v,m) { if (!v) throw new Error(m); }
const text = (v,max=10000) => typeof v === "string" && v.length <= max;
const uint = v => Number.isSafeInteger(v) && v >= 0 && v <= 4294967295;
const atom = v => typeof v === "string" && /^-?(0|[1-9][0-9]*)$/.test(v);
const positive = v => atom(v) && BigInt(v) >= 0n;
const iso = v => text(v,40) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === (v.includes(".")?v:v.replace("Z",".000Z"));
export function canonical(v) {
  if(v===null || typeof v==="boolean" || typeof v==="string") return JSON.stringify(v);
  if(typeof v==="number") { need(Number.isFinite(v),"Non-finite JSON number."); return JSON.stringify(v); }
  if(Array.isArray(v)) return "["+v.map(canonical).join(",")+"]";
  need(obj(v),"Keep complete JSON values.");
  return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}";
}
export function parseJSON(raw) {
  need(text(raw,134217728),"Keep a complete UTF-8 JSON document within 128 MiB.");
  let p=0;
  function ws(){ while(/\s/.test(raw[p]||"") && p<raw.length)p++; }
  function string(){const s=p++;while(p<raw.length){if(raw[p]==="\\"){p+=2;continue;}if(raw[p++]==='"')return JSON.parse(raw.slice(s,p));}throw new Error("Unclosed JSON text.");}
  function val(depth){need(depth<128,"JSON nesting exceeds 128.");ws();const c=raw[p];if(c==='"'){string();return;}if(c==="{"||c==="["){p++;ws();const end=c==="{"?"}":"]",keys=new Set();if(raw[p]===end){p++;return;}for(;;){if(c==="{"){need(raw[p]==='"',"JSON object key missing.");const k=string();need(!keys.has(k),"Duplicate JSON key: "+k);keys.add(k);ws();need(raw[p++]===":","JSON colon missing.");}val(depth+1);ws();if(raw[p]===end){p++;break;}need(raw[p++]===",","JSON separator missing.");ws();}return;}const m=/^(?:-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null)/.exec(raw.slice(p));need(m,"Invalid JSON value.");p+=m[0].length;}
  val(0);ws();need(p===raw.length,"Trailing JSON content.");return JSON.parse(raw);
}
export async function digest(raw) {
  const b=typeof raw==="string"?new TextEncoder().encode(raw):raw;
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256",b))).map(x=>x.toString(16).padStart(2,"0")).join("");
}
const bytes = s => new TextEncoder().encode(s).length;
export function validateBinding(b) {
  need(obj(b)&&obj(b.network)&&obj(b.contracts),"Supply the complete deployment binding.");
  need(text(b.network.id,80)&&b.network.id.length&&text(b.network.passphrase,1000)&&b.network.passphrase.length,"Supply the selected network and passphrase.");
  const url=new URL(b.network.rpcUrl);
  need(!url.username&&!url.password&&!url.hash&&(url.protocol==="https:"||(url.protocol==="http:"&&["localhost","127.0.0.1","[::1]"].includes(url.hostname))),"RPC must use HTTPS or an explicit loopback development endpoint.");
  need(Object.keys(b.contracts).sort().join("|")===[...ROLES].sort().join("|"),"Bind all six original deployed contracts.");
  need(ROLES.every(k=>StrKey.isValidContract(b.contracts[k]))&&new Set(ROLES.map(k=>b.contracts[k])).size===6,"Supply six distinct actual contract addresses.");
  need(uint(b.startLedger)&&b.startLedger>0&&b.sourceCommit===SOURCE_COMMIT,"Select the current source edition and first ledger.");
  return b;
}
export function eventFilters(binding) {
  const ids=ROLES.map(k=>binding.contracts[k]);
  return [{type:"contract",contractIds:ids.slice(0,5)},{type:"contract",contractIds:ids.slice(5)}];
}
export function instanceKeys(binding) {
  return ROLES.map(role=>xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
    contract:Address.fromString(binding.contracts[role]).toScAddress(),
    key:xdr.ScVal.scvLedgerKeyContractInstance(),
    durability:xdr.ContractDataDurability.persistent()
  })).toXDR("base64"));
}
export function responseOf(source) {
  const body=parseJSON(source.responseText);
  need(obj(body)&&body.jsonrpc==="2.0"&&body.id===source.request.id,"RPC response does not match its retained original request.");
  if(source.httpStatus!==200 || own(body,"error"))return null;
  return obj(body.result)?body.result:null;
}
export async function makeSource(request,endpoint,observedAt,httpStatus,responseText,responseHeaders={}) {
  const value={request,endpoint,observedAt,httpStatus,responseText,responseHeaders,bytes:bytes(responseText),sha256:await digest(responseText)};
  return {id:"rpc:"+await digest(canonical(value)),...value};
}
const freeze=v=>{if(v&&typeof v==="object"&&!Object.isFrozen(v)){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
function rawEvents(source,binding) {
  const r=responseOf(source); if(!r)return [];
  need(Array.isArray(r.events),"RPC events list missing.");
  const allowed=new Set(Object.values(binding.contracts));
  for(const e of r.events)need(obj(e)&&text(e.id,120)&&/^[0-9]{19}-[0-9]{10}$/.test(e.id)&&uint(e.ledger)&&e.ledger>0&&iso(e.ledgerClosedAt)&&allowed.has(e.contractId)&&e.type==="contract"&&/^[0-9a-f]{64}$/.test(e.txHash)&&Array.isArray(e.topic)&&e.topic.length>=1&&e.topic.length<=4&&e.topic.every(t=>text(t,1048576))&&text(e.value,16777216),"Invalid or out-of-binding original event.");
  return r.events;
}
export function validateBatch(batch,sources,binding) {
  need(obj(batch)&&text(batch.id,200)&&uint(batch.fromLedger)&&uint(batch.toLedger)&&batch.fromLedger>0&&batch.fromLedger<=batch.toLedger&&["COMPLETE","INCOMPLETE","GAP"].includes(batch.status)&&(batch.requestedToLedger===null||uint(batch.requestedToLedger))&&Array.isArray(batch.sourceIds)&&new Set(batch.sourceIds).size===batch.sourceIds.length&&(batch.reason===null||text(batch.reason,10000)),"Invalid retained capture range.");
  const network=sources.get(batch.networkSourceId);need(network&&network.request.method==="getNetwork"&&responseOf(network)?.passphrase===binding.network.passphrase,"Capture has no matching original network proof.");
  const health=sources.get(batch.healthSourceId),bounds=health&&health.request.method==="getHealth"?responseOf(health):null;
  need(bounds&&uint(bounds.oldestLedger)&&uint(bounds.latestLedger)&&bounds.oldestLedger>0&&bounds.latestLedger>=bounds.oldestLedger,"Capture has no original retention bounds.");
  if(batch.status==="GAP"){need(text(batch.captureId,200)&&batch.captureId.length&&batch.sourceIds.length===0&&batch.reason&&batch.toLedger<bounds.oldestLedger,"A retention gap needs its original health bounds and reason.");return;}
  let previous=null,done=false,lastId=null;
  for(let i=0;i<batch.sourceIds.length;i++){
    const s=sources.get(batch.sourceIds[i]);need(s&&s.request.method==="getEvents","Capture page source missing.");
    const p=s.request.params;
    need(obj(p)&&canonical(p.filters)===canonical(eventFilters(binding))&&obj(p.pagination)&&p.pagination.limit===1000&&p.xdrFormat==="base64","Capture filter or page limit changed.");
    if(i===0)need(p.startLedger===batch.fromLedger&&p.endLedger===batch.toLedger+1&&!own(p.pagination,"cursor"),"First capture range changed.");
    else need(previous&&text(previous.cursor,200)&&p.pagination.cursor===previous.cursor&&!own(p,"startLedger")&&!own(p,"endLedger"),"Capture cursor chain changed.");
    need(!done,"Capture continued after its retained end.");
    let r;try{r=responseOf(s);}catch{r=null;}if(!r){need(batch.status==="INCOMPLETE"&&i===batch.sourceIds.length-1,"Failed original page cannot prove completion.");return;}
    need(uint(r.latestLedger)&&uint(r.oldestLedger)&&r.oldestLedger<=batch.fromLedger,"Original event range is outside retained RPC history.");
    const events=rawEvents(s,binding);
    need(events.length<=1000,"Original provider page exceeds selected limit.");
    for(const e of events){need(e.ledger>=batch.fromLedger&&(!lastId||e.id>=lastId),"Event order or original lower bound changed.");lastId=e.id;}
    done=events.some(e=>e.ledger>batch.toLedger)||(events.length<1000&&r.latestLedger>=batch.toLedger);
    need(done||text(r.cursor,200)&&r.cursor.length&&r.cursor!==previous?.cursor,"Nonterminal capture cursor did not advance.");
    previous=r;
  }
  need(batch.status!=="COMPLETE"||done,"Complete range lacks a terminal original page.");
}
export async function inspectArchive(raw, prior = new Map(), depth = 0) {
  need(depth < 64,"Original receiving lineage exceeds the supported archive depth.");
  const a=parseJSON(raw);
  need(obj(a)&&a.schema==="strata.servicing-archive.v1"&&a.edition===1&&text(a.id,200)&&a.id.length&&iso(a.createdAt)&&/^[0-9a-f]{64}$/.test(a.sha256),"Unsupported servicing archive.");
  validateBinding(a.binding);
  need(obj(a.journal)&&Array.isArray(a.journal.commands)&&Array.isArray(a.journal.attempts)&&Array.isArray(a.journal.captures)&&Array.isArray(a.journal.received)&&obj(a.journal.producer),"Complete original collector journal missing.");
  for(const k of ["sources","batches","snapshots","notes"])need(Array.isArray(a[k]),"Complete archive collection missing: "+k);
  const {sha256,...body}=a;need(await digest(canonical(body))===sha256,"Archive seal differs from the complete body.");
  if(prior.has(sha256))return prior.get(sha256);
  const sources=new Map();
  for(const s of a.sources){
    need(obj(s)&&obj(s.request)&&s.request.jsonrpc==="2.0"&&text(s.request.id,200)&&text(s.request.method,100)&&["getNetwork","getHealth","getEvents","getLedgerEntries","getVersionInfo"].includes(s.request.method)&&s.endpoint===a.binding.network.rpcUrl&&obj(s.responseHeaders)&&Object.entries(s.responseHeaders).every(([k,v])=>text(k,1000)&&text(v,10000))&&iso(s.observedAt)&&Number.isInteger(s.httpStatus)&&s.httpStatus>=100&&s.httpStatus<=599&&text(s.responseText,134217728),"Invalid original RPC source.");
    need(s.bytes===bytes(s.responseText)&&s.sha256===await digest(s.responseText),"Original RPC source bytes changed.");
    const {id,...original}=s;need(id==="rpc:"+await digest(canonical(original))&&!sources.has(id),"Original source identity changed or duplicated.");sources.set(id,s);
    if(s.httpStatus===200){let r;try{r=responseOf(s);}catch{r=null;}
      // Foreign or failed original network reads remain source evidence; only matching proofs bind captures.
    }
  }
  const ids=new Set();
  for(const b of a.batches){need(!ids.has(b.id),"Capture range identity duplicated.");ids.add(b.id);validateBatch(b,sources,a.binding);}
  const ranges=[...a.batches].sort((x,y)=>x.fromLedger-y.fromLedger);let end=a.binding.startLedger-1;
  for(const b of ranges){need(b.fromLedger>end,"Retained capture ranges overlap or precede the selected beginning.");end=b.toLedger;}
  const commandIds=new Set(),attemptIds=new Set();
  for(const c of a.journal.commands){need(obj(c)&&text(c.id,200)&&c.id.length&&!commandIds.has(c.id)&&text(c.method,100)&&["RUNNING","COMPLETE"].includes(c.status),"Original command identity invalid.");commandIds.add(c.id);}
  for(const t of a.journal.attempts){
    need(obj(t)&&obj(t.request)&&text(t.request.id,200)&&!attemptIds.has(t.request.id)&&["DISPATCHING","RETAINED","FAILED"].includes(t.status),"Original read-attempt identity invalid.");attemptIds.add(t.request.id);
    const retained=t.status==="RETAINED"?sources.get(t.sourceId):null;
    if(t.status==="RETAINED")need(retained&&canonical(t.request)===canonical(retained.request)&&t.endpoint===retained.endpoint,"Original retained read differs from its source.");
    if(t.rawResponse){
      const r=t.rawResponse;need(obj(r)&&Number.isSafeInteger(r.bytes)&&r.bytes>=0&&typeof r.complete==="boolean"&&obj(r.responseHeaders)&&Number.isInteger(r.httpStatus)&&r.httpStatus>=0&&r.httpStatus<=599,"Original raw read receipt invalid.");
      let bytesValue;
      if(r.bodyBase64===null){const s=sources.get(r.sourceId);need(s&&s===retained,"Original raw response source missing.");bytesValue=new TextEncoder().encode(s.responseText);need(r.complete&&r.httpStatus===s.httpStatus&&canonical(r.responseHeaders)===canonical(s.responseHeaders),"Original raw receipt differs from retained source.");}
      else{need(typeof r.bodyBase64==="string","Full original raw response missing.");let binary;try{binary=atob(r.bodyBase64);}catch{throw new Error("Original raw response base64 invalid.");}need(btoa(binary)===r.bodyBase64,"Original raw response base64 is not exact.");bytesValue=Uint8Array.from(binary,c=>c.charCodeAt(0));}
      need(bytesValue.length===r.bytes&&await digest(bytesValue)===r.sha256,"Original complete/partial raw response bytes changed.");
    }else need(t.status==="DISPATCHING","A finished original read must retain its complete or partial response bytes.");
  }
  const snapIds=new Set();
  for(const s of a.snapshots){need(obj(s)&&text(s.id,200)&&!snapIds.has(s.id)&&text(s.label,1000),"Invalid snapshot identity.");snapIds.add(s.id);const proof=sources.get(s.networkSourceId);need(proof&&proof.request.method==="getNetwork"&&responseOf(proof)?.passphrase===a.binding.network.passphrase,"Snapshot network proof missing.");const raw=sources.get(s.sourceId);need(raw&&raw.request.method==="getLedgerEntries"&&canonical(raw.request.params.keys)===canonical(instanceKeys(a.binding)),"Snapshot must retain all six original instance keys.");const r=responseOf(raw);need(r&&uint(r.latestLedger)&&Array.isArray(r.entries),"Snapshot original response missing.");const keys=new Set(raw.request.params.keys),seen=new Set();for(const row of r.entries){need(obj(row)&&keys.has(row.key)&&!seen.has(row.key)&&text(row.xdr,16777216)&&uint(row.lastModifiedLedgerSeq)&&(row.liveUntilLedgerSeq===undefined||uint(row.liveUntilLedgerSeq)),"Snapshot original key/body identity invalid.");seen.add(row.key);
    const key=xdr.LedgerKey.fromXDR(row.key,"base64"),body=xdr.LedgerEntryData.fromXDR(row.xdr,"base64");
    need(key.switch().name==="contractData"&&body.switch().name==="contractData","Snapshot entry is not original contract data.");
    const k=key.contractData(),v=body.contractData();
    need(k.contract().toXDR("base64")===v.contract().toXDR("base64")&&k.key().toXDR("base64")===v.key().toXDR("base64")&&k.durability().value===v.durability().value&&v.val().switch().name==="scvContractInstance","Snapshot entry body differs from its selected instance key.");
  }}
  const notes=new Set();for(const n of a.notes){need(obj(n)&&text(n.id,200)&&!notes.has(n.id)&&text(n.text,1000000)&&iso(n.recordedAt),"Invalid operator note.");notes.add(n.id);}
  const captures=new Map(),commands=new Map(a.journal.commands.map(c=>[c.id,c])),snapshotMap=new Map(a.snapshots.map(s=>[s.id,s]));
  for(const c of a.journal.captures){
    need(obj(c)&&text(c.id,200)&&!captures.has(c.id)&&["COMPLETE","INCOMPLETE","GAP"].includes(c.status)&&Array.isArray(c.sourceIds)&&Array.isArray(c.failedSourceIds)&&iso(c.startedAt)&&uint(c.initialFromLedger)&&c.initialFromLedger>=a.binding.startLedger&&c.fromLedger>=c.initialFromLedger,"Original capture record invalid.");
    captures.set(c.id,c);
    const batch=a.batches.find(b=>c.status==="GAP"?b.status==="GAP"&&b.captureId===c.id&&b.fromLedger===c.fromLedger&&b.toLedger===c.toLedger:b.id===c.id);
    need(batch,"Original capture has no actual retained range.");
    if(c.status==="GAP")need(batch.status==="GAP"&&c.fromLedger===batch.fromLedger&&c.toLedger===batch.toLedger&&c.sourceIds.length===0,"Original expired capture differs from its range.");
    else{
      const projected={id:c.id,networkSourceId:c.networkSourceId,healthSourceId:c.healthSourceId,requestedToLedger:c.requestedToLedger,fromLedger:c.fromLedger,toLedger:c.toLedger,status:c.status,sourceIds:c.sourceIds,reason:c.reason};
      need(canonical(projected)===canonical(batch),"Original capture differs from its published range.");
    }
    need(c.failedSourceIds.every(id=>sources.has(id)),"Original failed page source missing.");
    const cursor=c.sourceIds.length?responseOf(sources.get(c.sourceIds.at(-1)))?.cursor??null:null;
    need(c.cursor===cursor,"Original capture cursor differs from its last source.");
    need(commands.get(c.id)?.method==="collect","Original capture command missing.");
  }
  for(const b of a.batches)need(b.status==="GAP"||captures.has(b.id),"Retained range has no original capture.");
  const received=new Map();
  for(const original of a.journal.received){
    need(obj(original)&&text(original.raw,134217728)&&typeof original.archiveSha256==="string"&&!received.has(original.archiveSha256),"Original received archive invalid.");
    const imported=await inspectArchive(original.raw,prior,depth+1);
    need(imported.sha256===original.archiveSha256&&imported.id===a.id&&canonical(imported.binding)===canonical(a.binding),"Original received archive binding changed.");
    need(imported.createdAt===a.createdAt,"Original receiving changed archive creation identity.");
    const preserve=(originals,current,key,label)=>{
      const rows=new Map(current.map(r=>[key(r),r]));
      for(const row of originals)need(rows.has(key(row))&&canonical(rows.get(key(row)))===canonical(row),"Received child lost or changed original "+label+".");
    };
    preserve(imported.sources,a.sources,r=>r.id,"source bytes");
    preserve(imported.snapshots,a.snapshots,r=>r.id,"snapshot");
    preserve(imported.notes,a.notes,r=>r.id,"operator note");
    preserve(imported.journal.attempts,a.journal.attempts,r=>r.request.id,"read attempt");
    preserve(imported.journal.received,a.journal.received,r=>r.archiveSha256,"received envelope");
    for(const priorCommand of imported.journal.commands){
      const current=commands.get(priorCommand.id);
      need(current,"Received child lost an original command.");
      if(priorCommand.status==="COMPLETE")need(canonical(current)===canonical(priorCommand),"Received child changed an accepted original command.");
      else{
        need(priorCommand.method==="collect"&&current.method==="collect"&&canonical(current.args)===canonical(priorCommand.args)&&current.createdAt===priorCommand.createdAt,"Received child changed an unfinished original capture intent.");
      }
    }
    for(const originalCapture of imported.journal.captures){
      const current=captures.get(originalCapture.id);need(current,"Received child lost an original capture.");
      if(originalCapture.status!=="INCOMPLETE"){need(canonical(current)===canonical(originalCapture),"Received child changed a completed original capture.");continue;}
      for(const key of ["id","requestedToLedger","initialFromLedger","toLedger","startedAt","networkSourceId","healthSourceId"])need(canonical(current[key])===canonical(originalCapture[key]),"Received continuation changed its original capture selection.");
      for(const key of ["sourceIds","failedSourceIds"])need(current[key].length>=originalCapture[key].length&&canonical(current[key].slice(0,originalCapture[key].length))===canonical(originalCapture[key]),"Received continuation changed an original page prefix.");
      need(current.fromLedger>=originalCapture.fromLedger,"Received continuation moved the original beginning backwards.");
      if(current.fromLedger!==originalCapture.fromLedger){
        need(originalCapture.sourceIds.length===0,"Received continuation skipped retained original pages.");
        let next=originalCapture.fromLedger;
        for(const gap of a.batches.filter(b=>b.status==="GAP"&&b.captureId===originalCapture.id).sort((x,y)=>x.fromLedger-y.fromLedger)){
          if(gap.toLedger<next)continue;need(gap.fromLedger<=next,"Received continuation has an unexplained missing interval.");next=gap.toLedger+1;if(next>=current.fromLedger)break;
        }
        need(next===current.fromLedger,"Received continuation lacks exact original gap progression.");
      }
    }
    preserve(imported.batches.filter(b=>b.status==="GAP"),a.batches.filter(b=>b.status==="GAP"),r=>r.id,"retention gap");
    received.set(imported.sha256,imported);
  }
  for(const c of a.journal.commands){
    need(obj(c.args),"Original command selection missing.");
    if(c.method==="collect"){
      const original=captures.get(c.id);need(original&&c.args.toLedger===original.requestedToLedger,"Original capture command selection changed.");
      if(c.status==="COMPLETE")need(["COMPLETE","GAP"].includes(original.status)&&canonical(c.result)===canonical(original),"Completed capture result differs from actual retained capture.");
      else need(original.status==="INCOMPLETE","Running capture status differs from actual retained capture.");
    }else if(c.method==="snapshot"){
      const original=snapshotMap.get(c.id);need(c.status==="COMPLETE"&&original&&c.args.label===original.label&&canonical(c.result)===canonical(original),"Original snapshot result differs from actual retained snapshot.");
    }else if(c.method==="initialize"){
      need(c.status==="COMPLETE"&&canonical(c.args)===canonical(a.binding)&&obj(c.result)&&c.result.id===a.id&&canonical(c.result.binding)===canonical(a.binding)&&c.result.createdAt===a.createdAt&&c.result.nextLedger===a.binding.startLedger,"Original initialization receipt differs from its archive.");
    }else if(c.method==="receive"){
      const original=received.get(c.args.archiveSha256);let next=original?.binding.startLedger;
      if(original)for(const range of coverageOf(original)){if(range.fromLedger>next||range.status==="INCOMPLETE")break;next=Math.max(next,range.toLedger+1);}
      need(c.status==="COMPLETE"&&original&&obj(c.result)&&c.result.id===a.id&&c.result.createdAt===a.createdAt&&canonical(c.result.binding)===canonical(a.binding)&&c.result.nextLedger===next&&c.result.receivedFrom?.archiveSha256===original.sha256,"Original receive receipt differs from its full retained original archive.");
    }else throw new Error("Unsupported original servicing command: "+c.method);
  }
  for(const s of a.snapshots)need(commands.get(s.id)?.method==="snapshot","Original snapshot command missing.");
  const result=freeze(a);prior.set(sha256,result);return result;
}
export async function sealArchive(body) {
  need(!own(body,"sha256"),"Supply the complete unsealed archive body.");
  return inspectArchive(canonical({...body,sha256:await digest(canonical(body))}));
}
function native(v) {
  if(typeof v==="bigint")return v.toString();
  if(v===undefined)return null;
  if(v instanceof Uint8Array)return {bytesHex:Array.from(v).map(x=>x.toString(16).padStart(2,"0")).join("")};
  if(Array.isArray(v))return v.map(native);
  if(obj(v)){const out=Object.create(null);for(const [k,x]of Object.entries(v))out[k]=native(x);return out;}
  return v;
}
function validateFinancialXdr(role,name,topics,value){
  const address="scvAddress",u64="scvU64",i128="scvI128";
  const vault={
    deposit_requested:[address,{epoch:u64,amount:i128}],deposit_cancelled:[address,{epoch:u64,amount:i128}],
    deposit_claimed:[address,{epoch:u64,amount:i128,shares:i128}],
    redeem_requested:[address,{epoch:u64,shares:i128}],redeem_cancelled:[address,{epoch:u64,shares:i128}],
    redeem_claimed:[address,{epoch:u64,shares:i128,assets:i128}],
    epoch_closed:[u64,{total_deposited:i128,total_shares_redeeming:i128}],
    epoch_fulfilled:[u64,{share_price:i128,total_deposited:i128}],
    deployed:[address,{assets:i128,net_deployed:i128}],funded:[address,{assets:i128,net_deployed:i128}],
    wind_down_claimed:[address,{surrendered:i128,assets:i128}],
    wind_down_round_finalized:["scvU32",{pot:i128,credited:i128,acc_per_share:i128}]
  };
  const spec=role==="async_vault"?vault[name]:role==="nav_oracle"&&name==="nav_attested"?[address,{nav_per_share:i128,expires_at:u64}]:null;
  if(!spec)return;
  need(topics.length===2&&topics[0].switch().name==="scvSymbol"&&topics[1].switch().name===spec[0],"Original "+name+" topic type differs from the selected contract.");
  need(value.switch().name==="scvMap","Original "+name+" body is not the selected contract map.");
  const fields=new Map();
  for(const pair of value.map()||[]){need(pair.key().switch().name==="scvSymbol","Original event field key is not a symbol.");const key=pair.key().sym().toString();need(!fields.has(key),"Original event field repeated.");fields.set(key,pair.val());}
  need(canonical([...fields.keys()].sort())===canonical(Object.keys(spec[1]).sort()),"Original "+name+" fields differ from the selected contract.");
  for(const [key,type]of Object.entries(spec[1]))need(fields.get(key).switch().name===type,"Original "+name+" "+key+" XDR type differs from "+type+".");
}
function decodedEvent(e,source,binding) {
  const role=ROLES.find(r=>binding.contracts[r]===e.contractId);
  let name="unreadable_event",topics=[],data=null,decodeError=null;
  try{const originals=e.topic.map(v=>xdr.ScVal.fromXDR(v,"base64")),value=xdr.ScVal.fromXDR(e.value,"base64");const decoded=originals.map(v=>native(scValToNative(v)));need(typeof decoded[0]==="string"&&originals[0].switch().name==="scvSymbol","Event name is not a symbol.");name=decoded[0];topics=decoded.slice(1);data=native(scValToNative(value));validateFinancialXdr(role,name,originals,value);}catch(err){decodeError=err.message;}
  return {id:e.id,sourceId:source.id,contractId:e.contractId,role,name,ledger:e.ledger,closedAt:e.ledgerClosedAt,txHash:e.txHash,topics,data,decodeError,topicXdr:e.topic,valueXdr:e.value};
}
function snapshotValue(s,source,binding) {
  const r=responseOf(source),entries=[],vault=Object.create(null);
  for(const row of r.entries){
    const key=xdr.LedgerKey.fromXDR(row.key,"base64"),value=xdr.LedgerEntryData.fromXDR(row.xdr,"base64");
    let contractId=null,role=null,decoded=null;
    if(key.switch().name==="contractData"){contractId=Address.fromScAddress(key.contractData().contract()).toString();role=ROLES.find(k=>binding.contracts[k]===contractId)||null;}
    if(value.switch().name==="contractData"){
      const v=value.contractData().val();
      if(v.switch().name==="scvContractInstance"){
        const map=Object.create(null);for(const pair of v.instance().storage()||[]){const k=native(scValToNative(pair.key()));map[canonical(k)]=native(scValToNative(pair.val()));if(role==="async_vault"&&Array.isArray(k)&&k.length===1&&typeof k[0]==="string"){if(k[0]==="NetDeployed")need(pair.key().switch().name==="scvVec"&&pair.key().vec()[0].switch().name==="scvSymbol"&&pair.val().switch().name==="scvI128","Original NetDeployed storage type differs from the selected contract.");vault[k[0]]=native(scValToNative(pair.val()));}}
        decoded={instanceStorage:map,executableXdr:v.instance().executable().toXDR("base64")};
      }else decoded=native(scValToNative(v));
    }
    entries.push({contractId,role,keyXdr:row.key,valueXdr:row.xdr,lastModifiedLedger:row.lastModifiedLedgerSeq,liveUntilLedger:row.liveUntilLedgerSeq??null,value:decoded});
  }
  return {id:s.id,sourceId:s.sourceId,label:s.label,ledger:r.latestLedger,observedAt:source.observedAt,entries,vault};
}
const str=v=>typeof v==="number"&&Number.isSafeInteger(v)?String(v):typeof v==="string"?v:null;
const field=(e,k)=>obj(e.data)?str(e.data[k]):null;
function eventAmount(e,key){const v=field(e,key);need(v!==null&&positive(v),"Original "+e.name+" "+key+" is not a nonnegative integer.");return v;}
function epochId(e){const v=field(e,"epoch")??str(e.topics[0]);need(v&&positive(v),"Original epoch identity missing.");return v;}
function controller(e){const v=str(e.topics[0]);need(v&&(StrKey.isValidEd25519PublicKey(v)||StrKey.isValidContract(v)),"Original controller address missing.");return v;}
function coverageOf(a) {
  const sorted=[...a.batches].sort((x,y)=>x.fromLedger-y.fromLedger||x.toLedger-y.toLedger);
  const out=[];let at=a.binding.startLedger;
  for(const b of sorted){
    if(b.toLedger<at)continue;
    if(b.fromLedger>at)out.push({fromLedger:at,toLedger:b.fromLedger-1,status:"GAP",batchIds:[],reason:"No retained original capture covers these ledgers."});
    out.push({fromLedger:Math.max(at,b.fromLedger),toLedger:b.toLedger,status:b.status,batchIds:[b.id],reason:b.reason});at=b.toLedger+1;
  }
  return out;
}
function covers(rows,from,to) {if(from>to)return true;let at=from;for(const r of rows){if(r.toLedger<at)continue;if(r.fromLedger>at||r.status!=="COMPLETE")return false;at=r.toLedger+1;if(at>to)return true;}return false;}
export function deriveHistory(a) {
  validateBinding(a.binding);
  const sources=new Map(a.sources.map(s=>[s.id,s])),eventsMap=new Map(),warnings=[],coverage=coverageOf(a);
  for(const batch of a.batches)for(const id of batch.sourceIds){
    const s=sources.get(id);if(!s||s.request.method!=="getEvents")continue;
    let raw;try{raw=rawEvents(s,a.binding);}catch(error){warnings.push(error.message);continue;}
    for(const e of raw){if(e.ledger<batch.fromLedger||e.ledger>batch.toLedger)continue;const old=eventsMap.get(e.id);if(old){need(canonical(old.raw)===canonical(e),"Conflicting original event identity "+e.id);continue;}eventsMap.set(e.id,{raw:e,event:decodedEvent(e,s,a.binding)});}
  }
  const events=[...eventsMap.values()].map(v=>v.event).sort((x,y)=>x.id.localeCompare(y.id));
  const requests=[],active=new Map(),epochsMap=new Map(),valuations=[],treasury=[];
  const getEpoch=id=>{if(!epochsMap.has(id))epochsMap.set(id,{id,status:"OBSERVED",totalDeposited:null,totalSharesRedeeming:null,sharePrice:null,closedAt:null,pricedAt:null,eventIds:[]});return epochsMap.get(id);};
  for(const e of events){
    if(e.decodeError){warnings.push("Undecoded original event "+e.id+": "+e.decodeError);continue;}
    try{
      if(e.role==="nav_oracle"&&e.name==="nav_attested"){
        valuations.push({id:e.id,ledger:e.ledger,closedAt:e.closedAt,attester:controller(e),price:eventAmount(e,"nav_per_share"),expiresAt:eventAmount(e,"expires_at"),eventIds:[e.id]});continue;
      }
      if(e.role!=="async_vault")continue;
      if(e.name==="epoch_closed"||e.name==="epoch_fulfilled"){
        const id=epochId(e),ep=getEpoch(id);ep.eventIds.push(e.id);ep.totalDeposited=eventAmount(e,"total_deposited");
        if(e.name==="epoch_closed"){ep.status="SEALED";ep.closedAt=e.closedAt;ep.totalSharesRedeeming=eventAmount(e,"total_shares_redeeming");}
        else{ep.status="PRICED";ep.pricedAt=e.closedAt;ep.sharePrice=eventAmount(e,"share_price");for(const q of requests)if(q.epoch===id&&q.status==="REQUESTED"){if(covers(coverage,q.lastLedger,e.ledger)){q.status="PRICED";q.sharePrice=ep.sharePrice;q.lastLedger=e.ledger;q.eventIds.push(e.id);}else{q.status="INCOMPLETE";q.notes.push("A later pricing observation follows unproven coverage; original episode continuity is unknown.");}}}
        continue;
      }
      if(e.name==="deployed"||e.name==="funded"){
        const net=field(e,"net_deployed");need(atom(net),"Original signed net-deployed counter missing.");
        treasury.push({id:e.id,direction:e.name==="deployed"?"TO_CUSTODIAN":"INTO_VAULT",account:controller(e),assets:eventAmount(e,"assets"),netDeployed:net,ledger:e.ledger,closedAt:e.closedAt,txHash:e.txHash,eventIds:[e.id]});continue;
      }
      const m=/^(deposit|redeem)_(requested|claimed|cancelled)$/.exec(e.name);if(!m)continue;
      const side=m[1],verb=m[2],who=controller(e),epoch=epochId(e),key=canonical([side,epoch,who]),ep=getEpoch(epoch);
      const originalAmount=eventAmount(e,side==="deposit"?"amount":"shares");
      const claimedShares=side==="deposit"&&verb==="claimed"?eventAmount(e,"shares"):null,claimedAssets=side==="redeem"&&verb==="claimed"?eventAmount(e,"assets"):null;
      let q=active.get(key);
      if(verb!=="requested"&&q&&!["CLAIMED","CANCELLED"].includes(q.status)){
        const previousAmount=side==="deposit"?q.amount:q.shares;
        if(!covers(coverage,q.lastLedger,e.ledger)||previousAmount!==originalAmount){
          q.status="INCOMPLETE";q.notes.push("A later conclusion has unproven continuous coverage or different original quantity; it is retained as a separate uncertain episode.");q=null;
        }
      }
      if(verb==="requested"){
        if(q&&!["CLAIMED","CANCELLED"].includes(q.status)){q.notes.push("A later original request appeared before a retained conclusion.");q.status="INCOMPLETE";}
        q={id:side+":"+e.id,side,controller:who,epoch,status:"REQUESTED",amount:null,shares:null,assets:null,sharePrice:null,requestedAt:e.closedAt,concludedAt:null,firstLedger:e.ledger,lastLedger:e.ledger,missingStart:false,eventIds:[],notes:[]};requests.push(q);active.set(key,q);
      }else if(!q||["CLAIMED","CANCELLED"].includes(q.status)){
        q={id:side+":"+e.id,side,controller:who,epoch,status:"INCOMPLETE",amount:null,shares:null,assets:null,sharePrice:ep.sharePrice,requestedAt:null,concludedAt:null,firstLedger:e.ledger,lastLedger:e.ledger,missingStart:true,eventIds:[],notes:["Original request creation is outside the retained evidence."]};requests.push(q);active.set(key,q);
      }
      q.eventIds.push(e.id);q.lastLedger=e.ledger;
      if(side==="deposit")q.amount=originalAmount;else q.shares=originalAmount;
      if(verb==="claimed"){q.status="CLAIMED";q.concludedAt=e.closedAt;q.sharePrice=ep.sharePrice;if(side==="deposit")q.shares=claimedShares;else q.assets=claimedAssets;}
      if(verb==="cancelled"){q.status="CANCELLED";q.concludedAt=e.closedAt;if(side==="deposit"&&ep.status==="PRICED")q.notes.push("The native cancellation event follows pricing: it may be the zero-share refund path.");}
    }catch(error){e.decodeError=error.message;warnings.push("Event "+e.id+": "+error.message);}
  }
  const snapshots=[];
  for(const s of a.snapshots)try{snapshots.push(snapshotValue(s,sources.get(s.sourceId),a.binding));}catch(e){warnings.push("Snapshot "+s.id+": "+e.message);}
  snapshots.sort((x,y)=>x.ledger-y.ledger||x.id.localeCompare(y.id));
  const reconciliations=[];
  for(let i=1;i<snapshots.length;i++){
    const x=snapshots[i-1],y=snapshots[i],rows=treasury.filter(e=>e.ledger>x.ledger&&e.ledger<=y.ledger);
    const deployed=rows.filter(r=>r.direction==="TO_CUSTODIAN").reduce((n,r)=>n+BigInt(r.assets),0n),funded=rows.filter(r=>r.direction==="INTO_VAULT").reduce((n,r)=>n+BigInt(r.assets),0n);
    const opening=str(x.vault.NetDeployed??"0"),closing=str(y.vault.NetDeployed??"0");
    const known=atom(opening)&&atom(closing)&&x.entries.some(e=>e.role==="async_vault")&&y.entries.some(e=>e.role==="async_vault")&&covers(coverage,x.ledger+1,y.ledger)&&!events.some(e=>e.role==="async_vault"&&e.decodeError&&e.ledger>x.ledger&&e.ledger<=y.ledger);
    const expected=known?BigInt(opening)+deployed-funded:null,difference=known?BigInt(closing)-expected:null;
    reconciliations.push({id:x.id+"→"+y.id,fromSnapshotId:x.id,toSnapshotId:y.id,fromLedger:x.ledger+1,toLedger:y.ledger,status:!known?"UNKNOWN":difference===0n?"MATCH":"DIFFERENCE",openingNetDeployed:opening,closingNetDeployed:closing,observedDeployed:String(deployed),observedFunded:String(funded),expectedNetDeployed:expected===null?null:String(expected),difference:difference===null?null:String(difference),reason:!known?"The same original counter and complete intervening event range are required.":difference===0n?"Original net-deployed movement equals deployments minus all funding.":"Original state differs from retained native movement; inspect source and intervening upgrades.",eventIds:rows.map(r=>r.id)});
  }
  if(!a.sources.some(s=>{try{return s.request.method==="getNetwork"&&responseOf(s)?.passphrase===a.binding.network.passphrase;}catch{return false;}}))warnings.push("No successful original network response is retained.");
  if(coverage.some(c=>c.status!=="COMPLETE"))warnings.push("The archive contains incomplete or missing ledger intervals; totals cover observed events only.");
  warnings.push("Start ledger is operator-selected. Complete selected coverage is not proof of deployment-to-present completeness.","Statements report original on-chain observations; they do not value off-chain custody assets or establish KYC status.");
  return {schema:"strata.servicing-report.v1",archiveId:a.id,archiveSha256:a.sha256,binding:a.binding,createdAt:a.createdAt,events,requests,valuations,epochs:[...epochsMap.values()].sort((x,y)=>BigInt(x.id)<BigInt(y.id)?-1:1),treasury,windDown:events.filter(e=>e.role==="async_vault"&&e.name.startsWith("wind_down_")),coverage,snapshots,reconciliations,warnings:[...new Set(warnings)],sources:a.sources.map(s=>({id:s.id,method:s.request.method,observedAt:s.observedAt,bytes:s.bytes,sha256:s.sha256}))};
}
export function investorStatement(report,selection) {
  need(obj(selection)&&text(selection.controller,100)&&(StrKey.isValidEd25519PublicKey(selection.controller)||StrKey.isValidContract(selection.controller)),"Select an exact investor account.");
  const from=selection.fromLedger??report.binding.startLedger,to=selection.toLedger??Math.max(from,...report.coverage.map(c=>c.toLedger));
  need(uint(from)&&uint(to)&&from<=to,"Select an ordered ledger interval.");
  const events=report.events.filter(e=>e.ledger>=from&&e.ledger<=to&&e.topics.includes(selection.controller));
  const totals={depositRequested:"0",depositRefunded:"0",sharesClaimed:"0",sharesRequestedForRedemption:"0",sharesReturned:"0",redemptionAssetsPaid:"0",windDownAssetsPaid:"0",windDownSharesSurrendered:"0"};
  const maps={deposit_requested:[["depositRequested","amount"]],deposit_cancelled:[["depositRefunded","amount"]],deposit_claimed:[["sharesClaimed","shares"]],redeem_requested:[["sharesRequestedForRedemption","shares"]],redeem_cancelled:[["sharesReturned","shares"]],redeem_claimed:[["redemptionAssetsPaid","assets"]],wind_down_claimed:[["windDownAssetsPaid","assets"],["windDownSharesSurrendered","surrendered"]]};
  for(const e of events)if(e.role==="async_vault"&&!e.decodeError)for(const [dest,key] of maps[e.name]||[])try{totals[dest]=String(BigInt(totals[dest])+BigInt(eventAmount(e,key)));}catch{}
  return {schema:"strata.investor-statement.v1",archiveId:report.archiveId,archiveSha256:report.archiveSha256,binding:report.binding,selection:{controller:selection.controller,fromLedger:from,toLedger:to},requests:report.requests.filter(r=>r.controller===selection.controller&&r.lastLedger>=from&&r.firstLedger<=to),events,coverage:report.coverage.filter(c=>c.toLedger>=from&&c.fromLedger<=to).map(c=>({...c,fromLedger:Math.max(c.fromLedger,from),toLedger:Math.min(c.toLedger,to)})),warnings:[...report.warnings,...(covers(report.coverage,from,to)?[]:["The requested statement interval is not fully covered by complete retained pages."])],totals};
}
function csv(rows){return rows.map(row=>row.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(",")).join("\r\n")+"\r\n";}
function flattenCSV(schema,archiveId,archiveSha256,binding,rows) {
  return csv([["schema","archive_id","archive_sha256","network","vault","row_type","row_id","original_row_json"],...rows.map(([kind,row])=>[schema,archiveId,archiveSha256,binding.network.id,binding.contracts.async_vault,kind,row.id??"",canonical(row)])]);
}
export function statementCSV(s){return flattenCSV(s.schema,s.archiveId,s.archiveSha256,s.binding,[["selection",s.selection],["totals",s.totals],...s.coverage.map(r=>["coverage",r]),...s.requests.map(r=>["request",r]),...s.events.map(r=>["event",r]),...s.warnings.map(text=>["warning",{text}])]);}
export function reportCSV(r,view="activity"){const key={activity:"events",requests:"requests",valuations:"valuations",epochs:"epochs",treasury:"treasury",coverage:"coverage"}[view];need(key,"Select an existing history view.");return flattenCSV(r.schema,r.archiveId,r.archiveSha256,r.binding,r[key].map(row=>[view,row]));}
