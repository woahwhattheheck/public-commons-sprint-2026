/* Ecosystem HTTPS transport v1. Edge metadata only; original native operator remains authoritative. */
import {previewStorage,signPreviewSession,readPreviewSession} from "./preview_storage.mjs";
const VERSION = "upstate.eco-relay/v1";
const CHUNK_BYTES = 1048576;
const META_BYTES = 65536;
const SESSION_COOKIE = "__Host-eco_session";
const TOKEN_RE = /^[0-9a-f]{64}$/;
const ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const TERMINAL = new Set(["complete", "uncertain", "failed"]);
const CORE_ROUTES = [
  ["GET","/api/extensions"],["GET","/api/state"],["GET","/api/item"],
  ["GET","/api/source-info"],["GET","/api/task"],["GET","/api/native-job"],
  ["GET","/api/run-log"],["GET","/api/runtime"],["GET","/api/whoami"],
  ["POST","/api/upload"],["POST","/api/session"],["POST","/api/operator-session"],
  ["POST","/api/source-preview"],["POST","/api/actions"],
  ["POST","/api/task/resume"],["POST","/api/task/cancel"]
];
const DENIED = new Set(["/api/team","/api/logout"]);
const REQUEST_HEADERS = new Set(["accept","content-type","range","if-range","if-none-match",
  "if-modified-since","if-match","x-upload-filename","x-workspace","x-file-sha256","x-source-sha256",
  "x-request-id","x-idempotency-key","idempotency-key"]);
const RESPONSE_HEADERS = new Set(["content-type","content-length","content-disposition",
  "content-range","accept-ranges","etag","last-modified","content-encoding",
  "x-content-sha256","x-file-sha256","x-download-sha256","x-workspace",
  "content-security-policy","x-content-type-options","referrer-policy","vary",
  "location","retry-after","x-eco-reconciled-operation"]);
class RelayError extends Error {
  constructor(status, code, message) { super(message); this.status=status; this.code=code; }
}
const problem=(status,code,message)=>{ throw new RelayError(status,code,message); };
const timestamp=()=>Date.now();
function json(value,status=200,extra={}) {
  return new Response(JSON.stringify(value),{status,headers:{
    "Content-Type":"application/json; charset=utf-8","Cache-Control":"private, no-store",
    "X-Content-Type-Options":"nosniff",...extra
  }});
}
function same(a,b) {
  if (typeof a!=="string" || typeof b!=="string" || a.length!==b.length) return false;
  let difference=0; for(let i=0;i<a.length;i++) difference|=a.charCodeAt(i)^b.charCodeAt(i);
  return difference===0;
}
async function sha256(bytes) {
  const raw=typeof bytes==="string"?new TextEncoder().encode(bytes):bytes;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",raw)))
    .map(x=>x.toString(16).padStart(2,"0")).join("");
}
function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,"0")).join("");
}
function integer(value,label) {
  if(!Number.isSafeInteger(value)||value<0) problem(400,"INVALID_INTEGER","Invalid "+label+".");
  return value;
}
function offsetOf(url) {
  const value=url.searchParams.get("offset");
  if(value===null || !/^(0|[1-9][0-9]*)$/.test(value)) problem(400,"OFFSET_REQUIRED","Supply the exact byte offset.");
  return integer(Number(value),"offset");
}
function canonicalOrigin(value) {
  const url=new URL(value);
  if(url.protocol!=="https:" || url.port || url.username || url.password ||
     url.pathname!=="/" || url.search || url.hash || url.origin!==value.replace(/\/$/,""))
    problem(503,"ORIGIN_CONFIG","Configure one exact canonical HTTPS origin.");
  return url.origin;
}
function cleanPath(value) {
  if(typeof value!=="string" || !value.startsWith("/") || value.startsWith("//") ||
     value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value) || value.includes("#"))
    problem(400,"INVALID_PATH","Use an ordinary same-origin application path.");
  const parsed=new URL(value,"https://relay.invalid");
  if(parsed.origin!=="https://relay.invalid" || parsed.pathname!==value.split("?")[0] ||
     /%(?:2f|5c|2e|00)/i.test(parsed.pathname))
    problem(400,"INVALID_PATH","Encoded separators and normalized traversal are not accepted.");
  return parsed.pathname+parsed.search;
}
function validFilePathname(pathname) {
  if(!pathname.startsWith("/api/file/"))return false;
  try {
    return pathname.slice("/api/file/".length).split("/").every(part=>{
      const decoded=decodeURIComponent(part);
      return decoded.length>0&&decoded!=="."&&decoded!==".."&&!/[\u0000-\u001f\u007f\\/]/.test(decoded);
    });
  } catch { return false; }
}
function selectedHeaders(value,allowed) {
  const source=value instanceof Headers?value:new Headers(value||{});
  const out={};
  for(const [name,body] of source) {
    if(allowed.has(name.toLowerCase())) {
      if(body.length>8192) problem(400,"HEADER_SIZE","A selected header is too large.");
      out[name.toLowerCase()]=body;
    }
  }
  return out;
}
async function readLimited(request,maximum) {
  const length=request.headers.get("content-length");
  if(length && Number(length)>maximum) problem(413,"BODY_SIZE","Use the documented binary chunk transport.");
  if(!request.body) return new Uint8Array();
  const reader=request.body.getReader(), chunks=[]; let total=0;
  try {
    while(true) {
      const part=await reader.read(); if(part.done) break;
      total+=part.value.byteLength;
      if(total>maximum) { await reader.cancel(); problem(413,"BODY_SIZE","Use the documented binary chunk transport."); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes=new Uint8Array(total); let offset=0;
  for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}
  return bytes;
}
async function readJSON(request) {
  try { return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(await readLimited(request,META_BYTES))); }
  catch(error) { if(error instanceof RelayError) throw error; problem(400,"INVALID_JSON","Use a complete JSON metadata object."); }
}
function pending(record) {
  return json({id:record.id,state:record.state,input_offset:record.input_offset,
    response_offset:record.response_offset||0,sealed:record.sealed},202,
    {"X-Eco-Pending":"1","X-Eco-Request-ID":record.id,"Retry-After":"1"});
}
function metadata(record) {
  const {id,method,path,headers,body_bytes,body_sha256,input_offset,sealed,state,
    response_offset,response,connector_instance,error,created,updated}=record;
  return {schema:VERSION,transport_epoch:record.transport_epoch||null,id,method,path,headers,body_bytes,body_sha256,input_offset,sealed,
    state,response_offset,response,connector_instance,error,created,updated,chunk_bytes:CHUNK_BYTES};
}
function nonceHTML(body,script="") {
  const nonce=randomToken();
  const markup="<!doctype html><html lang=\"en\"><meta charset=\"utf-8\">"+
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"+
    "<title>Ecosystem workbench</title><style nonce=\""+nonce+"\">"+
    "body{font:16px system-ui,sans-serif;max-width:34rem;margin:12vh auto;padding:1.5rem;color:#181818;background:#fff}"+
    "h1{font-size:1.4rem}label{display:block;margin:1.5rem 0 .4rem}input{box-sizing:border-box;width:100%;padding:.75rem;font:inherit}"+
    "button{margin-top:1rem;padding:.7rem 1.1rem;font:inherit;background:#222;color:white;border:0}p{line-height:1.5}"+
    "</style><body>"+body+(script?"<script nonce=\""+nonce+"\">"+script+"</script>":"")+"</body></html>";
  return new Response(markup,{headers:{"Content-Type":"text/html; charset=utf-8",
    "Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer",
    "Content-Security-Policy":"default-src 'none'; style-src 'nonce-"+nonce+"'; script-src 'nonce-"+nonce+
      "'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
}

function deploymentEnv(env) {
  return {...env,
    ECO_PUBLIC_ORIGIN:env.PUBLIC_ORIGIN||env.ECO_PUBLIC_ORIGIN,
    ECO_OPERATOR_ID:env.WORKSPACE_KEY||env.ECO_OPERATOR_ID,
    ECO_RELAY:env.RELAY||env.ECO_RELAY
  };
}

export class EcoRelay {
  constructor(ctx,env) {
    this.preview=env.ECO_PREVIEW_MEMORY==="true";this.transportEpoch=randomToken();this.previewRevoked=new Set();this.previewRegistered=false;
    const storage=this.preview?previewStorage(ctx.storage):ctx.storage;
    this.ctx=this.preview?{storage}:ctx; this.env=deploymentEnv(env); this.sql=storage.sql;
    // Existing deployment secret names remain authoritative; derive digests privately.
    this.credentialsReady=(async()=>{
      if(typeof env.RECIPIENT_TOKEN==="string"&&env.RECIPIENT_TOKEN)
        this.env.ECO_RECIPIENT_TOKEN_SHA256=await sha256(env.RECIPIENT_TOKEN);
      if(typeof env.CONNECTOR_TOKEN==="string"&&env.CONNECTOR_TOKEN)
        this.env.ECO_CONNECTOR_TOKEN_SHA256=await sha256(env.CONNECTOR_TOKEN);
    })();
    this.inputs=new Map(); this.outputs=new Map(); this.readers=new Map(); this.waiters=new Map();
    this.sql.exec("CREATE TABLE IF NOT EXISTS relay_requests (id TEXT PRIMARY KEY,state TEXT NOT NULL,updated INTEGER NOT NULL,last_polled INTEGER NOT NULL DEFAULT 0,record TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS relay_chunks (id TEXT NOT NULL,side TEXT NOT NULL,offset INTEGER NOT NULL,bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(id,side,offset))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS relay_sessions (digest TEXT PRIMARY KEY,epoch TEXT NOT NULL,expires INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS relay_routes (method TEXT NOT NULL,path TEXT NOT NULL,PRIMARY KEY(method,path))");
  }
  load(id) {
    if(!ID_RE.test(id)) problem(400,"REQUEST_ID","Use the original valid request identifier.");
    const row=this.sql.exec("SELECT record FROM relay_requests WHERE id=?",id).toArray()[0];
    return row?JSON.parse(row.record):null;
  }
  require(id) { const record=this.load(id); if(!record) problem(this.preview?409:404,this.preview?"PREVIEW_STATE_LOST":"REQUEST_MISSING",this.preview?"Preview connection state is unavailable. Reconcile this SAME original operation/task against the native durable journal; never repeat an unknown mutation.":"This original request is not retained."); return record; }
  save(record) {
    record.updated=timestamp();
    this.sql.exec("INSERT INTO relay_requests(id,state,updated,record) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,updated=excluded.updated,record=excluded.record",
      record.id,record.state,record.updated,JSON.stringify(record));
    this.wake(record.id); this.wake("poll");
    return record;
  }
  wake(key) { const set=this.waiters.get(key); if(set) { this.waiters.delete(key); for(const resolve of set) resolve(); } }
  wait(key,ms=20000) {
    return new Promise(resolve=>{
      let finished=false;
      const done=()=>{if(finished)return;finished=true;clearTimeout(timer);const set=this.waiters.get(key);if(set){set.delete(done);if(!set.size)this.waiters.delete(key);}resolve();};
      const timer=setTimeout(done,ms);
      if(!this.waiters.has(key))this.waiters.set(key,new Set());
      this.waiters.get(key).add(done);
    });
  }
  chunk(id,side,offset) {
    return this.sql.exec("SELECT bytes,sha256 FROM relay_chunks WHERE id=? AND side=? AND offset=?",id,side,offset).toArray()[0]||null;
  }
  saveChunk(id,side,offset,bytes,digest) {
    this.sql.exec("INSERT INTO relay_chunks(id,side,offset,bytes,sha256) VALUES(?,?,?,?,?) ON CONFLICT(id,side,offset) DO NOTHING",id,side,offset,bytes,digest);
  }
  origin(request,required=false) {
    const expected=canonicalOrigin(this.env.ECO_PUBLIC_ORIGIN||"");
    if(new URL(request.url).origin!==expected) problem(421,"WRONG_ORIGIN","Use the configured workbench origin.");
    const actual=request.headers.get("origin");
    if((required&&!actual)||(actual&&actual!==expected)) problem(403,"ORIGIN_REJECTED","Use the same workbench origin.");
    const site=request.headers.get("sec-fetch-site");
    if(site && !["same-origin","none"].includes(site)) problem(403,"SITE_REJECTED","Cross-site workbench requests are not accepted.");
    return expected;
  }
  async token(request,expected) {
    if(!TOKEN_RE.test(expected||"")) problem(503,"AUTH_CONFIG","Transport credentials are not configured.");
    const value=request.headers.get("authorization")||"";
    if(!value.startsWith("Bearer "))return false;
    const token=value.slice(7);
    if(token.length>4096)return false;
    return same(await sha256(token),expected);
  }
  async recipient(request) {
    if(await this.token(request,this.env.ECO_RECIPIENT_TOKEN_SHA256)) {
      this.origin(request,false); return "recipient";
    }
    this.origin(request,!["GET","HEAD"].includes(request.method));
    const cookie=(request.headers.get("cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith(SESSION_COOKIE+"="));
    if(!cookie) return null;
    const value=cookie.slice(SESSION_COOKIE.length+1);
    if(this.preview){if(this.previewRevoked.has(await sha256(value)))return null;return await readPreviewSession(value,this.env.RECIPIENT_TOKEN,this.env.ECO_RECIPIENT_TOKEN_SHA256,this.transportEpoch)?"recipient":null;}
    if(!TOKEN_RE.test(value)) return null;
    const digest=await sha256(value);
    const row=this.sql.exec("SELECT epoch,expires FROM relay_sessions WHERE digest=?",digest).toArray()[0];
    return row&&row.expires>timestamp()&&same(row.epoch,this.env.ECO_RECIPIENT_TOKEN_SHA256)?"recipient":null;
  }
  async connector(request) {
    this.origin(request,false);
    if(!await this.token(request,this.env.ECO_CONNECTOR_TOKEN_SHA256))
      problem(401,"CONNECTOR_AUTH","The connector credential is required.");
    const instance=request.headers.get("x-eco-connector-instance")||"";
    if(!ID_RE.test(instance)) problem(400,"CONNECTOR_INSTANCE","Supply the original connector instance identifier.");
    return instance;
  }
  allowed(method,path) {
    path=cleanPath(path); const pathname=path.split("?")[0];
    if(DENIED.has(pathname)||pathname==="/_eco"||pathname.startsWith("/_eco/")) return false;
    if(method==="GET"&&(pathname==="/"||pathname==="/health"||pathname==="/favicon.ico"||
      /^\/web\/[A-Za-z0-9_./-]+$/.test(pathname)||validFilePathname(pathname))) return true;
    if(CORE_ROUTES.some(row=>row[0]===method&&row[1]===pathname)) return true;
    return this.sql.exec("SELECT path FROM relay_routes WHERE method=? AND path=?",method,pathname).toArray().length>0;
  }
  create(spec) {
    if(!spec||typeof spec!=="object"||Array.isArray(spec)) problem(400,"REQUEST_METADATA","Use complete request metadata.");
    const id=spec.id||crypto.randomUUID();
    if(!ID_RE.test(id))problem(400,"REQUEST_ID","Use an 8–128 character request identifier.");
    const method=String(spec.method||"").toUpperCase(),path=cleanPath(spec.path);
    if(!this.allowed(method,path))problem(403,"ROUTE_REJECTED","This method and path are not in the original operator route manifest.");
    const headers=selectedHeaders(spec.headers,REQUEST_HEADERS);
    const body_bytes=integer(spec.body_bytes??0,"body byte count");
    if(["GET","HEAD"].includes(method)&&body_bytes!==0)problem(400,"READ_BODY","Read requests have no body.");
    if(spec.body_sha256!==undefined&&!TOKEN_RE.test(spec.body_sha256))problem(400,"BODY_HASH","Use a SHA-256 body identity.");
    const immutable={method,path,headers,body_bytes,body_sha256:spec.body_sha256||null};
    const old=this.load(id);
    if(old) {
      if(old.request_identity!==JSON.stringify(immutable))problem(409,"REQUEST_CONFLICT","The same identifier already belongs to different request metadata.");
      return {record:old,reused:true};
    }
    const record={id,...immutable,request_identity:JSON.stringify(immutable),input_offset:0,
      sealed:body_bytes===0,state:body_bytes===0?"queued":"receiving",response_offset:0,
      created:timestamp(),updated:timestamp(),principal:"recipient",response_demand:false,transport_epoch:this.transportEpoch};
    return {record:this.save(record),reused:false};
  }
  assertInputOutcome(record) {
    if(record.state==="uncertain") {
      const error=new RelayError(409,"UPSTREAM_UNCERTAIN","Reconcile this same original native operation/task before another write.");
      error.id=record.id;error.recovery=record.error;throw error;
    }
    if(record.state==="failed")problem(502,"RELAY_FAILED","The original native request failed; inspect its retained outcome.");
  }
  async input(id,offset,bytes,digest) {
    let record;
    if(bytes.byteLength===0||bytes.byteLength>CHUNK_BYTES)problem(400,"CHUNK_SIZE","Send a nonempty binary chunk of at most 1 MiB.");
    if(!TOKEN_RE.test(digest||"")||!same(await sha256(bytes),digest))problem(422,"CHUNK_HASH","The binary chunk SHA-256 does not match.");
    record=this.require(id);this.assertInputOutcome(record);
    if(offset<record.input_offset) {
      const old=this.chunk(id,"input",offset);
      if(!old||old.bytes!==bytes.byteLength||!same(old.sha256,digest))problem(409,"CHUNK_CONFLICT","Previously received bytes differ.");
      return {id,input_offset:offset+old.bytes,bytes:old.bytes,sha256:old.sha256,reused:true};
    }
    if(offset!==record.input_offset)problem(409,"INPUT_OFFSET","Resume at the retained input offset.");
    if(record.sealed||!["receiving","input_interrupted"].includes(record.state))problem(409,"INPUT_SEALED","The original input is already sealed.");
    if(record.body_bytes!==null&&offset+bytes.byteLength>record.body_bytes)problem(400,"INPUT_LENGTH","Chunk exceeds the declared original body.");
    const staged=this.chunk(id,"staged_input",offset);
    if(staged&&(staged.bytes!==bytes.byteLength||staged.sha256!==digest))problem(409,"CHUNK_CONFLICT","The original staged chunk identity differs.");
    let slot=this.inputs.get(id);
    if(slot) {
      if(slot.offset!==offset||slot.bytes.byteLength!==bytes.byteLength||slot.sha256!==digest)problem(409,"INPUT_PENDING","Another original chunk is awaiting acknowledgement.");
    } else {
      if(this.inputs.size+this.outputs.size>=24)problem(503,"TRANSPORT_BACKPRESSURE","The native receiver is consuming existing chunks; retry this same chunk.");
      slot={offset,bytes,sha256:digest};
      this.saveChunk(id,"staged_input",offset,bytes.byteLength,digest);
      this.inputs.set(id,slot);record.state="receiving";this.save(record);
    }
    const deadline=timestamp()+25000;
    while(timestamp()<deadline) {
      record=this.require(id);this.assertInputOutcome(record);
      if(record.input_offset>=offset+bytes.byteLength)
        return {id,input_offset:offset+bytes.byteLength,bytes:bytes.byteLength,sha256:digest};
      await this.wait(id,Math.max(1,deadline-timestamp()));
    }
    problem(503,"INPUT_PENDING","The original chunk is retained until the native receiver acknowledges it; retry the same identifier, offset and bytes.");
  }
  acknowledgeInput(id,value) {
    const record=this.require(id),offset=integer(value.offset,"offset"),count=integer(value.bytes,"chunk byte count");
    this.assertInputOutcome(record);
    if(!TOKEN_RE.test(value.sha256||""))problem(400,"CHUNK_HASH","Retain the original chunk hash.");
    if(offset<record.input_offset) {
      const old=this.chunk(id,"input",offset);
      if(!old||old.bytes!==count||old.sha256!==value.sha256)problem(409,"ACK_CONFLICT","The acknowledged original chunk differs.");
      return {id,input_offset:offset+count,bytes:count,sha256:value.sha256,reused:true};
    }
    const staged=this.chunk(id,"staged_input",offset);
    if(!staged||offset!==record.input_offset||staged.bytes!==count||staged.sha256!==value.sha256)
      problem(409,"ACK_CONFLICT","Acknowledge exactly the retained original input chunk.");
    this.ctx.storage.transactionSync(()=>{
      this.saveChunk(id,"input",offset,count,value.sha256);
      record.input_offset=offset+count;
      if(record.direct_auto_seal&&record.input_offset===record.body_bytes){record.sealed=true;record.state="queued";}
      this.save(record);
    });
    this.inputs.delete(id);this.wake(id);
    return {id,input_offset:record.input_offset,bytes:count,sha256:value.sha256};
  }
  seal(id,value) {
    const record=this.require(id),size=integer(value.body_bytes,"body byte count");
    this.assertInputOutcome(record);
    if(record.input_offset!==size||(record.body_bytes!==null&&record.body_bytes!==size))
      problem(409,"INPUT_INCOMPLETE","Seal only the complete natively acknowledged original body.");
    if(value.body_sha256!==undefined&&!TOKEN_RE.test(value.body_sha256))problem(400,"BODY_HASH","Use the original complete body hash.");
    if(record.body_sha256&&value.body_sha256&&record.body_sha256!==value.body_sha256)
      problem(409,"BODY_HASH_CHANGED","The original complete body identity differs.");
    if(!record.sealed) {
      record.body_bytes=size;record.sealed_sha256=value.body_sha256||null;
      record.sealed=true;record.state="queued";this.save(record);
    }
    return metadata(record);
  }
  async pump(request,id) {
    const reader=request.body?.getReader();let offset=0,buffer=new Uint8Array(CHUNK_BYTES),used=0;
    try {
      if(reader)while(true) {
        const part=await reader.read();if(part.done)break;
        let p=0;
        while(p<part.value.byteLength) {
          const count=Math.min(CHUNK_BYTES-used,part.value.byteLength-p);
          buffer.set(part.value.subarray(p,p+count),used);p+=count;used+=count;
          if(used===CHUNK_BYTES) {
            await this.input(id,offset,buffer,await sha256(buffer));
            offset+=used;buffer=new Uint8Array(CHUNK_BYTES);used=0;
          }
        }
      }
      if(used) {const tail=buffer.slice(0,used);await this.input(id,offset,tail,await sha256(tail));offset+=used;}
      this.seal(id,{body_bytes:offset});
    } finally {if(reader)reader.releaseLock();}
  }
  async result(id,waitForOriginal=false,signal=null) {
    let record=this.require(id),deadline=timestamp()+20000;
    while(!record.response&&!TERMINAL.has(record.state)&&(waitForOriginal||timestamp()<deadline)) {
      if(signal?.aborted)problem(499,"RECIPIENT_DISCONNECTED","The original request remains retained under its identifier.");
      await this.wait(id,waitForOriginal?20000:Math.max(1,deadline-timestamp()));record=this.require(id);
    }
    if(record.state==="uncertain")return json({id,code:"UPSTREAM_UNCERTAIN",error:record.error},409,
      {"X-Eco-Uncertain":"1","X-Eco-Request-ID":id});
    if(record.state==="failed")return json({id,code:"RELAY_FAILED",error:record.error},502,{"X-Eco-Request-ID":id,"X-Eco-Transport-Error":"RELAY_FAILED"});
    if(!record.response)return pending(record);
    if(this.readers.has(id))problem(409,"RESULT_OPEN","The original response is already being streamed; keep that response or wait for its cancellation.");
    const response=record.response,headers=new Headers(response.headers);
    if(response.status===304)headers.delete("Content-Length");
    else headers.set("Content-Length",String(response.body_bytes));
    headers.set("Cache-Control","private, no-store, no-transform");
    if(!headers.has("Content-Encoding"))headers.set("Content-Encoding","identity");
    headers.set("X-Eco-Request-ID",id);
    if(response.body_sha256)headers.set("X-Eco-Body-SHA256",response.body_sha256);
    if(response.body_bytes===0) {
      record.state="complete";record.response_demand=false;this.save(record);
      return new Response(null,{status:response.status,headers});
    }
    const readerId=randomToken();this.readers.set(id,readerId);
    record.response_offset=0;record.response_demand=true;record.state="responding";this.save(record);
    const self=this;
    const stream=new ReadableStream({
      async pull(controller) {
        try {
          let current=self.require(id);
          if(self.readers.get(id)!==readerId)throw new Error("Original response reader changed");
          if(current.response_offset>=response.body_bytes) {
            current.state="complete";current.response_demand=false;self.save(current);
            self.readers.delete(id);controller.close();return;
          }
          const timeout=timestamp()+45000;
          let slot=self.outputs.get(id);
          while(!slot&&timestamp()<timeout) {
            await self.wait(id,Math.max(1,timeout-timestamp()));
            slot=self.outputs.get(id);
          }
          if(!slot)throw new Error("Native response stream timed out; reopen the original retained result");
          if(self.readers.get(id)!==readerId)throw new Error("Original response reader changed");
          current=self.require(id);
          if(slot.offset!==current.response_offset)throw new Error("Original response offset changed");
          controller.enqueue(slot.bytes);
          self.ctx.storage.transactionSync(()=>{
            self.saveChunk(id,"response",slot.offset,slot.bytes.byteLength,slot.sha256);
            current.response_offset+=slot.bytes.byteLength;self.save(current);
          });
          self.outputs.delete(id);self.wake(id);
        } catch(error) {
          if(self.readers.get(id)===readerId){
            const current=self.require(id);current.response_demand=false;current.state="response_ready";self.save(current);
            self.readers.delete(id);self.outputs.delete(id);self.wake(id);
          }
          controller.error(error);
        }
      },
      cancel() {
        if(self.readers.get(id)!==readerId)return;
        const current=self.require(id);current.response_demand=false;current.state="response_ready";self.save(current);
        self.readers.delete(id);self.outputs.delete(id);self.wake(id);
      }
    },{highWaterMark:0});
    const fixed=new FixedLengthStream(response.body_bytes);
    // Returned fixed readable keeps request streaming alive; pipe cancellation cancels the source.
    stream.pipeTo(fixed.writable).catch(()=>{});
    return new Response(fixed.readable,{status:response.status,headers,encodeBody:"manual"});
  }
  async connectorRoute(request,url,instance) {
    const path=url.pathname,method=request.method;
    if(path==="/_eco/v1/connector/migration-status"&&method==="GET") {
      const counts={},storage=this.ctx.storage;let startAfter;
      for(;;) {
        const page=await storage.list({prefix:"job:",limit:128,...(startAfter?{startAfter}:{})});
        for(const [key,record] of page) {counts[record.state||"unknown"]=(counts[record.state||"unknown"]||0)+1;startAfter=key;}
        if(page.size<128)break;
      }
      const bound=!!(this.env.NATIVE_WORKSPACE_KEY||await storage.get("native-workspace-binding"));
      return json({schema:VERSION,operator_id:this.env.ECO_OPERATOR_ID,legacy_states:counts,
        native_workspace_bound:bound,legacy_storage_preserved:true,transport_epoch:this.transportEpoch,transport_persistence:this.preview?"memory-preview-native-journal-authoritative":"durable-edge-metadata"});
    }
    if(path==="/_eco/v1/connector/register"&&method==="POST") {
      const value=await readJSON(request);
      if(!TOKEN_RE.test(value.native_workspace_key||""))
        problem(400,"NATIVE_WORKSPACE","Supply the original private launcher's workspace identity.");
      if(!Array.isArray(value.routes)||value.routes.length>10000)problem(400,"ROUTE_MANIFEST","Supply the actual installed route manifest.");
      const rows=value.routes.map(row=>{
        const method=String(row.method||"").toUpperCase(),path=cleanPath(row.path);
        // Only exact rows registered by the authenticated native connector are admitted.
        const pageRead=method==="GET";
        if(!["GET","POST","PUT","PATCH","DELETE"].includes(method)||(!path.startsWith("/api/")&&!pageRead)||path.includes("?")||DENIED.has(path)||path==="/_eco"||path.startsWith("/_eco/"))
          problem(400,"ROUTE_MANIFEST","Register only exact installed application methods/routes and GET pages/assets.");
        return [method,path];
      });
      await this.ctx.storage.transaction(async transaction=>{
        const stored=await transaction.get("native-workspace-binding");
        const expected=this.env.NATIVE_WORKSPACE_KEY||stored;
        if(expected&&expected!==value.native_workspace_key)
          problem(409,"NATIVE_WORKSPACE","The transport is bound to a different original native workspace.");
        if(!stored)await transaction.put("native-workspace-binding",value.native_workspace_key);
      });
      this.ctx.storage.transactionSync(()=>{this.sql.exec("DELETE FROM relay_routes");for(const row of rows)this.sql.exec("INSERT OR IGNORE INTO relay_routes(method,path) VALUES(?,?)",...row);});
      this.previewRegistered=true;
      return json({schema:VERSION,registered:rows.length,chunk_bytes:CHUNK_BYTES,operator_id:this.env.ECO_OPERATOR_ID,
        transport_epoch:this.transportEpoch,transport_persistence:this.preview?"memory-preview-native-journal-authoritative":"durable-edge-metadata"});
    }
    if(path==="/_eco/v1/connector/poll"&&method==="GET") {
      if(this.preview&&!this.previewRegistered)
        problem(409,"REGISTRATION_REQUIRED","Register this same native instance, workspace pin and installed route manifest after the connection reset.");
      const requested=Number(url.searchParams.get("wait")||20),wait=Math.min(20,Math.max(0,Number.isFinite(requested)?requested:20));
      const excluded=[...new Set((url.searchParams.get("exclude")||"").split(",").filter(Boolean))];
      if(excluded.length>64||excluded.some(id=>!ID_RE.test(id)))problem(400,"POLL_EXCLUDE","Exclude at most 64 original active request IDs.");
      const excludeClause=excluded.length?" AND id NOT IN ("+excluded.map(()=>"?").join(",")+")":"";
      const deadline=timestamp()+wait*1000;
      do {
        const liveInputs=[...this.inputs.keys()];
        const inputClause=liveInputs.length?" OR id IN ("+liveInputs.map(()=>"?").join(",")+")":"";
        const rows=this.sql.exec("SELECT record FROM relay_requests WHERE (state IN ('queued','executing','responding')"+inputClause+")"+excludeClause+" ORDER BY last_polled ASC LIMIT 64",...liveInputs,...excluded).toArray();
        for(const row of rows) {
          const record=JSON.parse(row.record);
          if(!record.response&&!record.sealed&&!this.inputs.has(record.id))continue;
          if(record.response) {
            if(record.response_demand&&!this.readers.has(record.id)) {
              record.response_demand=false;record.state="response_ready";this.save(record);
            }
            if(!record.response_demand)continue;
          }
          this.sql.exec("UPDATE relay_requests SET last_polled=? WHERE id=?",timestamp(),record.id);
          return json(metadata(record));
        }
        if(timestamp()>=deadline)break;
        await this.wait("poll",Math.max(1,deadline-timestamp()));
      } while(timestamp()<deadline);
      return new Response(null,{status:204,headers:{"Cache-Control":"no-store"}});
    }
    const match=path.match(/^\/_eco\/v1\/connector\/requests\/([A-Za-z0-9_-]{8,128})\/(status|input|input-ack|executing|response|uncertain)$/);
    if(!match)problem(404,"CONNECTOR_ROUTE","Unknown connector endpoint.");
    const [,id,action]=match;let record=this.require(id);
    if(action==="status"&&method==="GET")return json(metadata(record));
    if(action==="input"&&method==="GET") {
      const offset=offsetOf(url),deadline=timestamp()+20000;
      while(timestamp()<deadline) {
        record=this.require(id);
        if(offset<record.input_offset)problem(409,"INPUT_ACKNOWLEDGED","The chunk is already natively acknowledged; reconcile retained local bytes.");
        if(offset!==record.input_offset)problem(409,"INPUT_OFFSET","Read from the original retained input offset.");
        const slot=this.inputs.get(id);
        if(slot&&slot.offset===offset)return new Response(slot.bytes.slice(),{headers:{
          "Content-Type":"application/octet-stream","Content-Length":String(slot.bytes.byteLength),
          "X-Chunk-SHA256":slot.sha256,"X-Eco-Offset":String(offset),"Cache-Control":"no-store"}});
        if(record.sealed)return new Response(null,{status:204,headers:{"X-Eco-Input-Sealed":"1"}});
        await this.wait(id,Math.max(1,deadline-timestamp()));
      }
      return new Response(null,{status:204,headers:{"X-Eco-Input-Sealed":"0"}});
    }
    if(action==="input-ack"&&method==="POST")return json(this.acknowledgeInput(id,await readJSON(request)));
    if(action==="executing"&&method==="POST") {
      const value=await readJSON(request);record=this.require(id);
      if(!record.sealed||record.input_offset!==record.body_bytes)problem(409,"INPUT_INCOMPLETE","The complete original input must be natively acknowledged first.");
      if(record.connector_instance&&record.connector_instance!==instance)problem(409,"EXECUTION_OWNER","The original upstream execution belongs to another connector instance; reconcile its durable journal.");
      if(record.state==="uncertain")problem(409,"UPSTREAM_UNCERTAIN","Reconcile the original uncertain upstream operation.");
      if((record.body_sha256&&value.body_sha256!==record.body_sha256)||(record.sealed_sha256&&value.body_sha256!==record.sealed_sha256))problem(422,"BODY_HASH","Native full input identity differs.");
      if(value.body_sha256!==undefined&&!TOKEN_RE.test(value.body_sha256))problem(400,"BODY_HASH","Use the native complete input hash.");
      if(!record.connector_instance){record.connector_instance=instance;record.state="executing";record.native_body_sha256=value.body_sha256||null;this.save(record);}
      return json(metadata(record));
    }
    if(action==="uncertain"&&method==="POST") {
      const value=await readJSON(request);record=this.require(id);
      if(record.response)return json(metadata(record));
      record.state="uncertain";record.error={
        code:String(value.code||"UPSTREAM_UNCERTAIN").slice(0,100),
        message:String(value.message||"The original upstream outcome requires reconciliation.").slice(0,800),
        ...(TOKEN_RE.test(value.task_id||"")?{task_id:value.task_id}:{}),
        ...(/^[A-Za-z0-9_-]{16,100}$/.test(value.operation_id||"")?{operation_id:value.operation_id}:{}),
        ...(/^[A-Za-z0-9_-]{1,200}$/.test(value.workspace||"")?{workspace:value.workspace}:{}),
        ...(TOKEN_RE.test(value.task_id||"")&&value.lookup_path==="/api/task?id="+value.task_id?{lookup_path:value.lookup_path}:{})};
      this.save(record);this.inputs.delete(id);this.wake(id);this.wake("poll");return json(metadata(record));
    }
    if(action==="response"&&method==="POST") {
      const value=await readJSON(request),status=integer(value.status,"HTTP status");record=this.require(id);
      if(status<200||status>599)problem(400,"RESPONSE_STATUS","Use the original final upstream status.");
      if(record.connector_instance!==instance)problem(409,"EXECUTION_OWNER","Retain the original connector execution identity.");
      const body_bytes=integer(value.body_bytes,"response byte count");
      if([204,205,304].includes(status)&&body_bytes!==0)problem(400,"RESPONSE_BODY","This upstream status cannot contain a body.");
      if(value.body_sha256!==undefined&&!TOKEN_RE.test(value.body_sha256))problem(400,"BODY_HASH","Use the native complete response hash.");
      const response={status,headers:selectedHeaders(value.headers,RESPONSE_HEADERS),body_bytes,body_sha256:value.body_sha256||null};
      if(record.response&&JSON.stringify(record.response)!==JSON.stringify(response))
        problem(409,"RESPONSE_CONFLICT","The retained original response identity differs.");
      if(!record.response){record.response=response;record.state="response_ready";record.response_offset=0;this.save(record);}
      return json(metadata(record));
    }
    if(action==="response"&&method==="PUT") {
      const offset=offsetOf(url),bytes=await readLimited(request,CHUNK_BYTES),digest=request.headers.get("x-chunk-sha256");
      if(!TOKEN_RE.test(digest||"")||!same(await sha256(bytes),digest))problem(422,"CHUNK_HASH","The response chunk SHA-256 differs.");
      record=this.require(id);
      const retainedChunk=this.chunk(id,"response",offset);
      if(retainedChunk&&(retainedChunk.bytes!==bytes.byteLength||retainedChunk.sha256!==digest))
        problem(409,"RESPONSE_CONFLICT","The original response chunk identity differs.");
      if(!record.response||record.connector_instance!==instance)problem(409,"RESPONSE_METADATA","Post the original response metadata first.");
      if(offset<record.response_offset) {
        const old=this.chunk(id,"response",offset);
        if(!old||old.bytes!==bytes.byteLength||old.sha256!==digest)problem(409,"RESPONSE_CONFLICT","Retained response bytes differ.");
        return json({id,response_offset:offset+old.bytes,reused:true});
      }
      if(!record.response_demand||!this.readers.has(id))problem(409,"RESULT_NOT_OPEN","The recipient can reopen the retained original result.");
      if(offset!==record.response_offset||!bytes.byteLength||offset+bytes.byteLength>record.response.body_bytes)
        problem(409,"RESPONSE_OFFSET","Resume at the current original response offset.");
      const existing=this.outputs.get(id);
      if(existing&&(existing.offset!==offset||existing.sha256!==digest||existing.bytes.byteLength!==bytes.byteLength))
        problem(409,"RESPONSE_PENDING","A different response chunk is pending.");
      if(!existing){
        if(this.inputs.size+this.outputs.size>=24)problem(503,"TRANSPORT_BACKPRESSURE","Existing chunks are being consumed; retry the same response chunk.");
        this.outputs.set(id,{offset,bytes,sha256:digest});
      }
      this.wake(id);
      const deadline=timestamp()+25000;
      while(timestamp()<deadline) {
        record=this.require(id);
        if(record.response_offset>=offset+bytes.byteLength)return json({id,response_offset:offset+bytes.byteLength});
        if(!record.response_demand)problem(409,"RESULT_NOT_OPEN","The recipient can reopen the original retained result.");
        await this.wait(id,Math.max(1,deadline-timestamp()));
      }
      problem(503,"RESPONSE_PENDING","Retry the same retained response chunk after reading status.");
    }
    problem(405,"CONNECTOR_METHOD","Use the documented connector method.");
  }
  async publicRoute(request,url) {
    const method=request.method,path=url.pathname;
    if(path==="/_eco/v1/requests"&&method==="POST") {
      const result=this.create(await readJSON(request));
      return json(metadata(result.record),result.reused?200:201,{"X-Eco-Request-ID":result.record.id});
    }
    const match=path.match(/^\/_eco\/v1\/requests\/([A-Za-z0-9_-]{8,128})\/(status|input|seal|result)$/);
    if(match) {
      const [,id,action]=match;this.require(id);
      if(action==="status"&&method==="GET")return json(metadata(this.require(id)));
      if(action==="input"&&method==="PUT")return json(await this.input(id,offsetOf(url),await readLimited(request,CHUNK_BYTES),request.headers.get("x-chunk-sha256")));
      if(action==="seal"&&method==="POST")return json(this.seal(id,await readJSON(request)));
      if(action==="result"&&method==="GET")return this.result(id);
      problem(405,"RELAY_METHOD","Use the documented recipient method.");
    }
    const length=request.headers.get("content-length");
    const buffered=request.body&&length===null?await readLimited(request,CHUNK_BYTES):null;
    const size=buffered?buffered.byteLength:request.body?integer(Number(length),"body byte count"):0;
    const created=this.create({id:request.headers.get("x-eco-request-id")||undefined,
      method,path:cleanPath(url.pathname+url.search),headers:request.headers,body_bytes:size});
    if(!created.reused&&!created.record.sealed){
      created.record.direct_auto_seal=true;this.save(created.record);
    }
    if(buffered){
      if(buffered.byteLength)await this.input(created.record.id,0,buffered,await sha256(buffered));
      this.seal(created.record.id,{body_bytes:buffered.byteLength});
    } else if(request.body)await this.pump(request,created.record.id);
    return this.result(created.record.id,method==="GET",request.signal);
  }
  async fetch(request) {
    try {
      await this.credentialsReady;
      this.origin(request,false);
      const url=new URL(request.url),path=url.pathname;
      if(path==="/_eco/health"&&request.method==="GET")
        return json({service:"Ecosystem private transport",schema:VERSION,chunk_bytes:CHUNK_BYTES,transport_epoch:this.transportEpoch,transport_persistence:this.preview?"memory-preview-native-journal-authoritative":"durable-edge-metadata"});
      if(path==="/_eco/login"&&request.method==="GET")
        return nonceHTML("<h1>Ecosystem workbench</h1><p>Enter the private workbench access token.</p>"+
          "<form method=\"post\" action=\"/_eco/login\"><label for=\"access\">Access token</label>"+
          "<input id=\"access\" name=\"token\" type=\"password\" autocomplete=\"current-password\" required>"+
          "<button type=\"submit\">Open workbench</button></form>");
      if(path==="/_eco/login"&&request.method==="POST") {
        this.origin(request,true);
        const value=new URLSearchParams(new TextDecoder().decode(await readLimited(request,8192))).get("token")||"";
        if(!TOKEN_RE.test(this.env.ECO_RECIPIENT_TOKEN_SHA256||"")||!same(await sha256(value),this.env.ECO_RECIPIENT_TOKEN_SHA256))
          problem(401,"RECIPIENT_AUTH","The private workbench access token was not accepted.");
        const expiry=timestamp()+28800000;
        const token=this.preview?await signPreviewSession({expires:expiry,epoch:this.env.ECO_RECIPIENT_TOKEN_SHA256,transport_epoch:this.transportEpoch,nonce:randomToken()},this.env.RECIPIENT_TOKEN):randomToken();
        if(!this.preview){const digest=await sha256(token);this.sql.exec("DELETE FROM relay_sessions WHERE expires<?",timestamp());this.sql.exec("INSERT INTO relay_sessions(digest,epoch,expires) VALUES(?,?,?)",digest,this.env.ECO_RECIPIENT_TOKEN_SHA256,expiry);}
        const response=nonceHTML("<h1>Opening workbench</h1><p>Your private session is connected.</p>",
          "sessionStorage.setItem('upstate-operator-capability','eco-edge-session');location.replace('/');");
        response.headers.set("Set-Cookie",SESSION_COOKIE+"="+token+"; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800");
        return response;
      }
      if(path.startsWith("/_eco/v1/connector/"))
        return await this.connectorRoute(request,url,await this.connector(request));
      if(!await this.recipient(request)) {
        if(request.method==="GET"&&!path.startsWith("/api/")&&!path.startsWith("/_eco/v1/"))
          return Response.redirect(this.env.ECO_PUBLIC_ORIGIN.replace(/\/$/,"")+"/_eco/login",303);
        problem(401,"RECIPIENT_AUTH","Open a private workbench session or supply its scoped recipient bearer.");
      }
      if((path==="/_eco/logout"||path==="/api/logout")&&request.method==="POST") {
        const cookie=(request.headers.get("cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith(SESSION_COOKIE+"="));
        if(cookie){const digest=await sha256(cookie.slice(SESSION_COOKIE.length+1));if(this.preview)this.previewRevoked.add(digest);else this.sql.exec("DELETE FROM relay_sessions WHERE digest=?",digest);}
        return json({connected:false},200,{"Set-Cookie":SESSION_COOKIE+"=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0"});
      }
      return await this.publicRoute(request,url);
    } catch(error) {
      if(error instanceof RelayError||error?.code==="TRANSPORT_BACKPRESSURE") {
        const uncertain=["PREVIEW_STATE_LOST","EDGE_STATE_LOST","UPSTREAM_UNCERTAIN"].includes(error.code);
        const candidate=error.id||new URL(request.url).pathname.match(/\/requests\/([A-Za-z0-9_-]{8,128})(?:\/|$)/)?.[1]||request.headers.get("X-Eco-Request-ID");
        const id=ID_RE.test(candidate||"")?candidate:null;
        return json({schema:VERSION,code:error.code,message:error.message,...(id?{id}:{}),...(error.recovery?{error:error.recovery}:{})},error.status,
          {"X-Eco-Transport-Error":error.code,...(id?{"X-Eco-Request-ID":id}:{}),...(uncertain?{"X-Eco-Uncertain":"1"}:{})});
      }
      return json({schema:VERSION,code:"RELAY_INTERNAL",message:"The retained request can be reconciled through its original identifier."},500,{"X-Eco-Transport-Error":"RELAY_INTERNAL"});
    }
  }
}

// Preserve the already-deployed SQLite namespace and exported class.
export class WorkbenchRelay extends EcoRelay {}

export default {
  async fetch(request,env) {
    try {
      env=deploymentEnv(env);
      const expected=canonicalOrigin(env.ECO_PUBLIC_ORIGIN||"");
      if(new URL(request.url).origin!==expected)problem(421,"WRONG_ORIGIN","Use the configured workbench origin.");
      if(!ID_RE.test(env.ECO_OPERATOR_ID||""))problem(503,"OPERATOR_CONFIG","Configure the original fixed operator mapping.");
      const id=env.ECO_RELAY.idFromName(env.ECO_OPERATOR_ID);
      return await env.ECO_RELAY.get(id).fetch(request);
    } catch(error) {
      return json({schema:VERSION,code:error.code||"RELAY_CONFIG",message:error.message||"Transport configuration is incomplete."},error.status||503,{"X-Eco-Transport-Error":error.code||"RELAY_CONFIG"});
    }
  }
};
