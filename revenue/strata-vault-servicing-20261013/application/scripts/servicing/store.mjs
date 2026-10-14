import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { directory, lease, syncDirectory, writeExact, fileDescriptor } from "./files.mjs";
import { canonical, parseJSON, digest, validateBinding, makeSource, responseOf, eventFilters, instanceKeys, validateBatch, inspectArchive, sealArchive, deriveHistory } from "../../app-lib/servicing/model.mjs";

const now=()=>new Date().toISOString();
const need=(v,m)=>{if(!v)throw new Error(m);};
const hash=s=>createHash("sha256").update(s).digest("hex");
const clone=v=>parseJSON(canonical(v));
export async function sourceIdentity(){
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
  const manifestRaw=await fs.readFile(path.join(root,"scripts/servicing/SOURCE.json"),"utf8"),manifest=parseJSON(manifestRaw);
  need(manifest.schema==="strata.servicing-source.v1"&&Array.isArray(manifest.files),"Installed servicing source manifest missing.");
  for(const f of manifest.files){need(typeof f.path==="string"&&!path.isAbsolute(f.path)&&f.path.split("/").every(p=>p&&p!=="."&&p!==".."),"Unsafe source member.");const d=await fileDescriptor(path.join(root,f.path),f.path);need(d.bytes===f.bytes&&d.sha256===f.sha256,"Installed servicing source changed: "+f.path);}
  let p=path.dirname(createRequire(import.meta.url).resolve("@stellar/stellar-sdk")),sdk=null;
  while(p!==path.dirname(p)){try{const raw=await fs.readFile(path.join(p,"package.json"),"utf8"),v=JSON.parse(raw);if(v.name==="@stellar/stellar-sdk"){sdk={version:v.version,packageSha256:hash(raw)};break;}}catch{}p=path.dirname(p);}
  need(sdk?.version==="16.1.0","Use the original selected Stellar SDK 16.1.0.");
  return {manifestSha256:hash(manifestRaw),manifest,sdk,node:process.version};
}
export class ServicingStore {
  constructor(directory,db,owner,identity){this.directory=directory;this.db=db;this.owner=owner;this.identity=identity;this.closed=false;}
  get(kind,id){const r=this.db.prepare("SELECT body FROM records WHERE kind=? AND id=?").get(kind,id);return r?parseJSON(r.body):null;}
  list(kind){return this.db.prepare("SELECT body FROM records WHERE kind=? ORDER BY seq").all(kind).map(r=>parseJSON(r.body));}
  put(kind,id,v){this.db.prepare("INSERT INTO records(kind,id,body) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body").run(kind,id,canonical(v));}
  immutable(kind,id,v){const old=this.get(kind,id);need(!old||canonical(old)===canonical(v),"Original "+kind+" identity changed.");if(!old)this.put(kind,id,v);return old||v;}
  tx(fn){this.db.exec("BEGIN IMMEDIATE");try{const v=fn();this.db.exec("COMMIT");return v;}catch(e){this.db.exec("ROLLBACK");throw e;}}
  config(){const c=this.get("meta","workspace");need(c,"Initialize or receive the original servicing workspace first.");return c;}
  async initialize(binding,requestId){
    validateBinding(binding);need(typeof requestId==="string"&&requestId.length&&requestId.length<=200,"Supply the original request ID.");
    const old=this.get("commands",requestId);if(old){need(old.method==="initialize"&&canonical(old.args)===canonical(binding),"Original request ID has another intent.");return old.result;}
    const existing=this.get("meta","workspace");need(!existing,"A workspace already exists; receive into a new directory.");
    const value={id:"strata:"+randomUUID(),binding:clone(binding),createdAt:now(),nextLedger:binding.startLedger,source:this.identity};
    this.tx(()=>{this.put("meta","workspace",value);this.put("commands",requestId,{id:requestId,method:"initialize",args:binding,result:value,status:"COMPLETE",createdAt:now()});});
    return value;
  }
  async rpc(method,params,{captureId=null,signal,fetchImpl=fetch}={}){
    const cfg=this.config(),request={jsonrpc:"2.0",id:randomUUID(),method,params};
    const intent={request,endpoint:cfg.binding.network.rpcUrl,createdAt:now(),captureId,status:"DISPATCHING"};
    this.tx(()=>this.put("attempts",request.id,intent));
    let responseText="",status=0,responseHeaders={},complete=false,rawResponse=null;
    const chunks=[];let length=0;
    const retainRaw=()=>{
      const all=Buffer.concat(chunks,length);
      rawResponse={bodyBase64:all.toString("base64"),bytes:all.length,sha256:hash(all),httpStatus:status,responseHeaders,complete};
      this.tx(()=>this.put("attempts",request.id,{...intent,status:"DISPATCHING",rawResponse}));
      return all;
    };
    const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(new Error("Original RPC read timed out.")),30000);
    const cancel=()=>abort.abort(signal.reason);signal?.addEventListener("abort",cancel,{once:true});if(signal?.aborted)cancel();
    try{
      const response=await fetchImpl(intent.endpoint,{method:"POST",headers:{"content-type":"application/json","accept":"application/json"},body:canonical(request),signal:abort.signal,redirect:"error"});
      status=response.status;responseHeaders=Object.fromEntries(response.headers);
      const reader=response.body?.getReader();need(reader,"Original RPC response has no body.");
      try{for(;;){const r=await reader.read();if(r.done){complete=true;break;}chunks.push(Buffer.from(r.value));length+=r.value.byteLength;need(length<=67108864,"Original RPC response exceeds 64 MiB; use a smaller source selection.");}}catch(error){await reader.cancel(error).catch(()=>{});throw error;}finally{reader.releaseLock();}
      const all=retainRaw();
      responseText=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(all);
      const source=await makeSource(request,intent.endpoint,now(),status,responseText,responseHeaders);
      this.tx(()=>{this.immutable("sources",source.id,source);this.put("attempts",request.id,{...intent,status:"RETAINED",sourceId:source.id,rawResponse:{...rawResponse,bodyBase64:null,sourceId:source.id}});});
      return source;
    }catch(error){
      if(!rawResponse)retainRaw();
      this.tx(()=>this.put("attempts",request.id,{...intent,status:"FAILED",error:String(error.message),rawResponse,receivedText:responseText||null,finishedAt:now()}));throw error;
    }
    finally{clearTimeout(timeout);signal?.removeEventListener("abort",cancel);}
  }
  async network(options={}){
    const source=await this.rpc("getNetwork",{},options),r=responseOf(source);
    need(r&&r.passphrase===this.config().binding.network.passphrase,"Original RPC network does not match the selected passphrase.");
    return source;
  }
  async snapshot(requestId,label="",options={}){
    need(typeof label==="string"&&label.length<=1000,"Keep a short snapshot label.");
    const old=this.get("commands",requestId);if(old){need(old.method==="snapshot"&&old.args.label===label,"Original snapshot intent differs.");return old.result;}
    const networkSource=await this.network(options);
    const source=await this.rpc("getLedgerEntries",{keys:instanceKeys(this.config().binding),xdrFormat:"base64"},options),r=responseOf(source);
    need(r&&Number.isSafeInteger(r.latestLedger)&&Array.isArray(r.entries),"Original snapshot did not return ledger entries.");
    const result={id:requestId,networkSourceId:networkSource.id,sourceId:source.id,label};
    this.tx(()=>{this.immutable("snapshots",requestId,result);this.put("commands",requestId,{id:requestId,method:"snapshot",args:{label},result,status:"COMPLETE",createdAt:now()});});
    return result;
  }
  async collect(requestId,{toLedger=null,maxPages=100}={},options={}){
    need(typeof requestId==="string"&&requestId.length&&requestId.length<=200,"Supply the original capture request ID.");
    need(Number.isSafeInteger(maxPages)&&maxPages>=1&&maxPages<=10000,"Select 1–10000 pages per continuation.");
    const cfg=this.config(),args={toLedger},old=this.get("commands",requestId);
    if(old){need(old.method==="collect"&&canonical(old.args)===canonical(args),"Original capture intent differs.");if(old.status==="COMPLETE")return old.result;}
    let capture=this.get("captures",requestId);
    need(!this.list("captures").some(c=>c.id!==requestId&&c.status==="INCOMPLETE"),"Continue the existing unfinished original capture before starting another.");
    const networkSource=await this.network(options),healthSource=await this.rpc("getHealth",{},options),health=responseOf(healthSource);
    need(health&&Number.isSafeInteger(health.oldestLedger)&&Number.isSafeInteger(health.latestLedger)&&health.oldestLedger>0&&health.latestLedger>=health.oldestLedger,"Original RPC retention bounds missing.");
    if(!capture){
      const start=this.config().nextLedger,end=toLedger===null?health.latestLedger:toLedger;
      need(Number.isSafeInteger(end)&&end>=start&&end<=health.latestLedger&&end<4294967295,"Select a retained ending ledger at or after the durable next ledger.");
      capture={id:requestId,requestedToLedger:toLedger,initialFromLedger:start,fromLedger:start,toLedger:end,status:"INCOMPLETE",sourceIds:[],reason:null,cursor:null,startedAt:now(),networkSourceId:networkSource.id,healthSourceId:healthSource.id,failedSourceIds:[]};
      this.tx(()=>{this.put("captures",requestId,capture);this.put("commands",requestId,{id:requestId,method:"collect",args,status:"RUNNING",createdAt:now()});});
    }
    if(health.oldestLedger>capture.fromLedger){
      if(capture.sourceIds.length){
        capture={...capture,reason:"RPC history expired before this original selected range could finish. Retained pages remain incomplete."};
        this.tx(()=>this.put("captures",requestId,capture));return capture;
      }
      const gapEnd=Math.min(health.oldestLedger-1,capture.toLedger),gap={id:requestId+":gap:"+capture.fromLedger+":"+gapEnd,captureId:requestId,networkSourceId:networkSource.id,healthSourceId:healthSource.id,requestedToLedger:toLedger,fromLedger:capture.fromLedger,toLedger:gapEnd,status:"GAP",sourceIds:[],reason:"Original getHealth "+healthSource.id+" reports oldest retained ledger "+health.oldestLedger+"."};
      const terminal=gapEnd===capture.toLedger;
      capture=terminal?{...capture,status:"GAP",reason:gap.reason}:{...capture,fromLedger:gapEnd+1};
      this.tx(()=>{
        this.immutable("gaps",gap.id,gap);const c=this.config();c.nextLedger=gapEnd+1;this.put("meta","workspace",c);
        this.put("captures",requestId,capture);
        if(terminal)this.put("commands",requestId,{...this.get("commands",requestId),status:"COMPLETE",result:capture});
      });
      if(terminal)return capture;
    }
    for(let page=0;page<maxPages;page++){
      options.signal?.throwIfAborted();
      const params={filters:eventFilters(cfg.binding),pagination:{limit:1000},xdrFormat:"base64"};
      if(capture.cursor)params.pagination.cursor=capture.cursor;else{params.startLedger=capture.fromLedger;params.endLedger=capture.toLedger+1;}
      const retained=this.list("attempts").find(a=>a.captureId===requestId&&a.status==="RETAINED"&&canonical(a.request.params)===canonical(params)&&!capture.failedSourceIds.includes(a.sourceId)&&!capture.sourceIds.includes(a.sourceId));
      const source=retained?this.get("sources",retained.sourceId):await this.rpc("getEvents",params,{...options,captureId:requestId});
      let result;try{result=responseOf(source);}catch{result=null;}
      if(!result||!Array.isArray(result.events)){capture={...capture,reason:"Original page did not return a successful events response.",failedSourceIds:[...capture.failedSourceIds,source.id]};this.tx(()=>this.put("captures",requestId,capture));return capture;}
      const next={...capture,sourceIds:[...capture.sourceIds,source.id],reason:null};
      const done=result.events.some(e=>e.ledger>capture.toLedger)||(result.events.length<1000&&result.latestLedger>=capture.toLedger);
      next.status=done?"COMPLETE":"INCOMPLETE";next.cursor=result.cursor??null;
      validateBatch(next,new Map(this.list("sources").map(s=>[s.id,s])),cfg.binding);
      this.tx(()=>{
        this.put("captures",requestId,next);
        if(done){const current=this.config();need(current.nextLedger===next.fromLedger,"Another capture advanced this selected source.");current.nextLedger=next.toLedger+1;this.put("meta","workspace",current);this.put("commands",requestId,{...this.get("commands",requestId),status:"COMPLETE",result:next});}
      });
      capture=next;if(done)return capture;
    }
    return capture;
  }
  async note(requestId,text){
    need(typeof text==="string"&&text.length<=1000000,"Keep the complete note within 1 million characters.");
    const old=this.get("notes",requestId);if(old){need(old.text===text,"Original note ID differs.");return old;}
    const n={id:requestId,text,recordedAt:now()};this.tx(()=>this.immutable("notes",requestId,n));return n;
  }
  async archive(){
    const cfg=this.config(),captureRows=this.list("captures").filter(x=>x.status!=="GAP");
    const batches=[...this.list("gaps"),...captureRows.map(c=>({id:c.id,networkSourceId:c.networkSourceId,healthSourceId:c.healthSourceId,requestedToLedger:c.requestedToLedger,fromLedger:c.fromLedger,toLedger:c.toLedger,status:c.status,sourceIds:c.sourceIds,reason:c.reason}))].sort((a,b)=>a.fromLedger-b.fromLedger);
    return sealArchive({schema:"strata.servicing-archive.v1",edition:1,id:cfg.id,binding:cfg.binding,createdAt:cfg.createdAt,sources:this.list("sources"),batches,snapshots:this.list("snapshots"),notes:this.list("notes"),journal:{commands:this.list("commands"),attempts:this.list("attempts"),captures:this.list("captures"),received:this.list("received"),producer:cfg.source,receivedFrom:cfg.receivedFrom??null}});
  }
  async export(destination){
    const archive=await this.archive(),raw=canonical(archive)+"\n";
    await writeExact(destination,Buffer.from(raw));return {path:destination,bytes:Buffer.byteLength(raw),sha256:hash(raw),archiveSha256:archive.sha256};
  }
  async receive(raw,requestId){
    const a=await inspectArchive(raw),existing=this.get("meta","workspace");
    const old=this.get("commands",requestId);if(old){need(old.method==="receive"&&old.args.archiveSha256===a.sha256,"Original receive intent differs.");return old.result;}
    need(!existing,"Receive into a new selected workspace; preserve original workspaces.");
    need(!a.journal.commands.some(c=>c.id===requestId),"Choose a receive request ID distinct from every imported original command.");
    const coverage=deriveHistory(a).coverage;let next=a.binding.startLedger;
    for(const c of coverage){if(c.fromLedger>next||c.status==="INCOMPLETE")break;next=Math.max(next,c.toLedger+1);}
    this.tx(()=>{
      const cfg={id:a.id,binding:a.binding,createdAt:a.createdAt,nextLedger:next,source:this.identity,receivedFrom:{archiveSha256:a.sha256,receivedAt:now()}};
      this.put("meta","workspace",cfg);
      for(const s of a.sources)this.immutable("sources",s.id,s);
      for(const r of a.journal.commands){need(r&&typeof r.id==="string","Original command identity missing.");this.immutable("commands",r.id,r);}
      for(const r of a.journal.attempts){need(r&&typeof r.request?.id==="string","Original read attempt identity missing.");this.immutable("attempts",r.request.id,r);}
      for(const b of a.batches)if(b.status==="GAP")this.immutable("gaps",b.id,b);
      for(const capture of a.journal.captures)this.immutable("captures",capture.id,capture);
      for(const received of a.journal.received)this.immutable("received",received.archiveSha256,received);
      for(const s of a.snapshots)this.immutable("snapshots",s.id,s);
      for(const n of a.notes)this.immutable("notes",n.id,n);
      this.immutable("received",a.sha256,{raw,archiveSha256:a.sha256});
      this.put("commands",requestId,{id:requestId,method:"receive",args:{archiveSha256:a.sha256},status:"COMPLETE",result:cfg});
    });return this.config();
  }
  async close(){
    if(this.closed)return;
    if(this.db){this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");this.db.close();this.db=null;}
    await syncDirectory(this.directory);await this.owner.release();this.closed=true;
  }
}
export async function openStore(selected,{identity=null}={}){
  need(path.isAbsolute(selected),"Select an absolute private workspace directory.");
  const v=process.versions.node.split(".").map(Number);need(v[0]>22||(v[0]===22&&v[1]>=16),"Node 22.16 or newer is required.");
  identity??=await sourceIdentity();
  await directory(selected);const owner=await lease(selected,"strata-servicing");
  let db;
  try{
    const file=path.join(selected,"servicing.sqlite");
    try{const st=await fs.lstat(file);need(st.isFile()&&!st.isSymbolicLink(),"Workspace database must be an ordinary file.");}catch(e){if(e.code!=="ENOENT")throw e;}
    db=new DatabaseSync(file);db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records(seq INTEGER PRIMARY KEY,kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(kind,id));");
    await syncDirectory(selected);
    const store=new ServicingStore(selected,db,owner,identity),cfg=store.get("meta","workspace");
    if(cfg)need(cfg.source.manifestSha256===identity.manifestSha256,"Open this workspace with its original servicing source edition.");
    return store;
  }catch(error){if(db)db.close();await owner.release();throw error;}
}
