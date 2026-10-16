import http from "node:http";
import {readFile,writeFile,mkdir,rename,open,unlink,stat,readdir} from "node:fs/promises";
import {createHash,createHmac,randomBytes} from "node:crypto";
import {resolve,join,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {hostname} from "node:os";
import * as core from "./core.mjs";
import {decodeReceivedCase,receiveCaseState,ORIGINAL_TEXT_SCHEMA} from "./case-receiving.mjs";
import {recipientHTML} from "./offline-recipient.mjs";
const hash=text=>createHash("sha256").update(text).digest("hex"),now=()=>new Date().toISOString();
const root=resolve(process.env.DEFARM_DESK_DIR||"./partner-workspace");
const port=Number(process.env.DEFARM_DESK_PORT||4317),host="127.0.0.1";
core.need(Number.isInteger(port)&&port>0&&port<65536,"Invalid port");
const here=dirname(fileURLToPath(import.meta.url)),apiKey=process.env.DEFARM_API_KEY||"";
const gateway=process.env.DEFARM_GATEWAY||"https://gateway.defarm.net",network=process.env.DEFARM_NETWORK||"testnet";
const gatewayURL=new URL(gateway);core.need(gatewayURL.protocol==="https:"&&!gatewayURL.username&&!gatewayURL.password&&gatewayURL.pathname==="/"&&!gatewayURL.search&&!gatewayURL.hash,"Gateway must be a plain HTTPS origin");
process.umask(0o077);await mkdir(join(root,"cases"),{recursive:true});
const lockPath=join(root,".desk.lock");
if(process.argv.includes("--recover-lock")){
 const previous=JSON.parse(await readFile(lockPath,"utf8"));
 core.need(previous.hostname===hostname()&&Number.isInteger(previous.pid),"Lock belongs to another host");
 let live=true;try{process.kill(previous.pid,0);}catch(e){if(e.code==="ESRCH")live=false;else throw e;}
 core.need(!live,"The original desk process is still alive; use its existing address");
 await unlink(lockPath);
}
const lock=await open(lockPath,"wx",0o600);await lock.writeFile(JSON.stringify({pid:process.pid,hostname:hostname(),started_at:now(),root}));await lock.sync();
let secret;try{secret=await readFile(join(root,".scope"));}catch(e){if(e.code!=="ENOENT")throw e;secret=randomBytes(32);await writeFile(join(root,".scope"),secret,{flag:"wx",mode:0o600});}
const scope=createHmac("sha256",secret).update(gatewayURL.origin+"\n"+apiKey).digest("hex");
const token=randomBytes(32).toString("hex");
let sdkPromise;async function SDK(){return sdkPromise??=import("./upstream/defarm-sdk-ts/dist/index.js").then(m=>{core.need(typeof m.DefarmClient==="function","Expected original @defarm/sdk0.2.1 DefarmClient");return m;});}
async function atomic(path,body){const tmp=path+"."+randomBytes(8).toString("hex")+".tmp",f=await open(tmp,"wx",0o600);try{await f.writeFile(body);await f.sync();}finally{await f.close();}await rename(tmp,path);const d=await open(dirname(path),"r");try{await d.sync();}finally{await d.close();}}
const casePath=id=>{core.need(/^[a-f0-9]{64}$/.test(id),"Invalid case ID");return join(root,"cases",id+".json");};
async function get(id){return core.assertCase(JSON.parse(await readFile(casePath(id),"utf8")),hash);}
async function save(c){core.assertCase(c,hash);await atomic(casePath(c.id),JSON.stringify(c,null,2)+"\n");return c;}
const busy=new Map();function exclusive(id,fn){core.need(!stopping,"The original desk is closing; reopen it before starting another operation");core.need(!busy.has(id),"This case has an active operation; refresh its retained state");const p=Promise.resolve().then(fn);busy.set(id,p);return p.finally(()=>busy.delete(id));}
for(const name of await readdir(join(root,"cases")))if(/^[a-f0-9]{64}\.json$/.test(name)){const c=await get(name.slice(0,-5)),r=core.interrupted(c,now(),hash);if(r!==c)await save(r);}
function safeError(e){return {name:String(e?.name||"Error"),message:String(e?.message||e).replaceAll(apiKey||"\u0000","[configured key]"),status:Number.isFinite(e?.status)?e.status:null,code:typeof e?.code==="string"?e.code:null,details:e?.details??e?.body??null};}
async function invoke(c,kind,eventId){
 let wire=null;
 const {DefarmClient}=await SDK();
 const client=new DefarmClient({gateway:c.identity.gateway,network:c.identity.network,auth:{apiKey},fetch:async(url,init)=>{
   const response=await fetch(url,{...init,signal:AbortSignal.timeout(45000)});
   const text=await response.clone().text();
   wire={url:String(url),method:init?.method||"GET",status:response.status,content_type:response.headers.get("content-type"),received_at:now(),text};
   // Preserve the original returned bytes before SDK interpretation or caller completion.
   const current=await get(c.id),event=current.events.find(e=>e.id===eventId);
   core.need(event?.status==="running","Original operation lost its receiving state");
   event.wire={...wire,bytes:core.bytes(text),sha256:hash(text)};await save(current);
   return response;
 }});
 try{return {result:await client.ingest(c.items,{preview:kind==="preview"}),wire};}
 catch(e){return {error:safeError(e),wire};}
}
async function operate(id,kind,revision){
 core.need(apiKey,"Start this local desk with the partner API key in DEFARM_API_KEY");
 return exclusive(id,async()=>{
  await SDK();let c=await get(id);core.need(c.identity.gateway===gatewayURL.origin&&c.identity.network===network,"Select the original gateway/network configuration before using this case");
  if(kind==="commit"){const p=[...c.events].reverse().find(e=>e.kind==="preview");core.need(p?.execution_scope===scope,"Preview these exact bytes with the currently configured partner key");}
  c=core.begin(c,kind,hash,now(),revision);const e=c.events.at(-1);e.execution_scope=scope;await save(c);
  let result;try{result=await invoke(c,kind,e.id);}catch(error){result={error:safeError(error)};}
  const latest=await get(id);return save(core.finish(latest,e.id,result,hash,now()));
 });
}
async function verify(id,revision){
 return exclusive(id,async()=>{
  let c=await get(id);core.need(c.revision===revision,"This case changed; refresh before verification");
  const {DefarmClient}=await SDK();
  for(const dfid of core.returnedDfids(c)){
   let wire=null;const client=new DefarmClient({gateway:c.identity.gateway,network:c.identity.network,fetch:async(url,init)=>{
    const res=await fetch(url,{...init,signal:AbortSignal.timeout(45000)}),text=await res.clone().text();
    wire={url:String(url),method:"GET",status:res.status,received_at:now(),text,bytes:core.bytes(text),sha256:hash(text)};return res;
   }});
   const record={dfid,read_at:now()};try{record.result=await client.verify(dfid);}catch(e){record.error=safeError(e);}if(wire)record.wire=wire;
   c.verifications.push(record);c.revision++;await save(c);
  }
  return c;
 });
}
async function body(req){let size=0,chunks=[];for await(const c of req){size+=c.length;core.need(size<=80*1024*1024,"Request exceeds 80 MiB receiving limit");chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString("utf8"));}
function reply(res,status,value,type="application/json"){res.writeHead(status,{"Content-Type":type+"; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});res.end(type==="application/json"?JSON.stringify(value):value);}
function admitted(req){
 core.need(req.headers.host===host+":"+port,"Use the local desk address");
 if(req.method!=="GET"){core.need(req.headers.origin==="http://"+host+":"+port,"Use the local desk page");core.need(req.headers["x-desk-token"]===token,"Refresh the local desk page before acting");core.need(req.headers["content-type"]?.startsWith("application/json"),"Expected a JSON request");}
}
const server=http.createServer(async(req,res)=>{try{
 admitted(req);const url=new URL(req.url,"http://"+host+":"+port),path=url.pathname;
 if(req.method==="GET"&&path==="/"){res.setHeader("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");return reply(res,200,await readFile(join(here,"index.html"),"utf8"),"text/html");}
 if(req.method==="GET"&&["/app.mjs","/core.mjs","/source-reader.mjs","/style.css"].includes(path))return reply(res,200,await readFile(join(here,path.slice(1)),"utf8"),path.endsWith("css")?"text/css":"text/javascript");
 if(req.method==="GET"&&path==="/recipient.html")return reply(res,200,await recipientHTML(),"text/html");
 if(req.method==="GET"&&path==="/api/config")return reply(res,200,{gateway:gatewayURL.origin,network,key_configured:!!apiKey,token,sdk:core.SDK_PIN});
 if(req.method==="GET"&&path==="/api/cases"){const list=[];for(const name of await readdir(join(root,"cases")))if(/^[a-f0-9]{64}\.json$/.test(name)){const c=await get(name.slice(0,-5));list.push({id:c.id,title:c.title,state:c.state,revision:c.revision,created_at:c.created_at,rows:c.items.length,source:c.source.name});}return reply(res,200,list.sort((a,b)=>b.created_at.localeCompare(a.created_at)));}
 if(req.method==="POST"&&path==="/api/cases"){
  const b=await body(req),c=core.newCase({...b,gateway:gatewayURL.origin,network},hash,now());
  return await exclusive(c.id,async()=>{try{const prior=await get(c.id);return reply(res,200,prior);}catch(e){if(e.code!=="ENOENT")throw e;}await save(c);reply(res,201,c);});
 }
 if(req.method==="POST"&&path==="/api/import"){
  const selected=decodeReceivedCase(await body(req),hash),original=selected.original;
  return await exclusive(original.id,async()=>{
   const packagePath=join(root,"cases",original.id+".received-package.json");
   let previousPackageText=null,current=null;
   try{previousPackageText=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(await readFile(packagePath));}
   catch(e){if(e.code!=="ENOENT")throw e;}
   try{current=await get(original.id);}catch(e){if(e.code!=="ENOENT")throw e;}
   const received=receiveCaseState(selected,{previousPackageText,current,at:now()},hash);
   // Retain every admitted original text independently; wrapper whitespace and
   // the original BOM remain available even when the same case body is replayed.
   const exactPath=join(root,"cases",original.id+".received-original-"+selected.sha256+".json");
   try{const retained=await readFile(exactPath);core.need(retained.length===selected.bytes&&hash(retained)===selected.sha256,"The retained received original changed");}
   catch(e){if(e.code!=="ENOENT")throw e;await atomic(exactPath,selected.text);}
   if(previousPackageText===null)await atomic(packagePath,selected.text);
   if(received.replayed)return reply(res,200,received.case);
   await save(received.case);return reply(res,201,received.case);
  });
 }
 const match=path.match(/^\/api\/cases\/([a-f0-9]{64})(?:\/([a-z-]+))?$/);
 if(match){
  const[,id,action]=match;
  if(req.method==="GET"&&!action)return reply(res,200,await get(id));
  if(req.method==="GET"&&action==="received"){
   const originalText=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(await readFile(join(root,"cases",id+".received-package.json")));
   const selected=decodeReceivedCase({schema:ORIGINAL_TEXT_SCHEMA,original_package_text:originalText},hash);
   core.need(selected.original.id===id,"Received original belongs to another case");
   return reply(res,200,{schema:ORIGINAL_TEXT_SCHEMA,original_package_text:originalText,bytes:selected.bytes,sha256:selected.sha256});
  }
  if(req.method==="GET"&&action==="export")return reply(res,200,core.exportCase(await get(id),hash,now()));
  if(req.method==="GET"&&action==="offline"){const c=await get(id);return reply(res,200,await recipientHTML(JSON.stringify(core.exportCase(c,hash,now()),null,2)+"\n"),"text/html");}
  if(req.method==="GET"&&action==="report"){res.setHeader("Content-Security-Policy","default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'");return reply(res,200,core.report(await get(id)),"text/html");}
  if(req.method==="GET"&&action==="rows"){const c=await get(id);return reply(res,200,core.csvOutput([["source_row","original_cells_json","selected_item_json"],...c.source_rows.map(r=>[r.row,JSON.stringify(r.cells??r.item),JSON.stringify(r.item)])]),"text/csv");}
  if(req.method==="POST"){
   const b=await body(req);
   if(action==="preview"||action==="commit")return reply(res,200,await operate(id,action,b.revision));
   if(action==="verify")return reply(res,200,await verify(id,b.revision));
   if(action==="reconcile")return reply(res,200,await exclusive(id,async()=>save(core.reconcile(await get(id),b,hash,now(),b.revision))));
   if(action==="note")return reply(res,200,await exclusive(id,async()=>{const c=await get(id);core.need(c.revision===b.revision,"Case changed; refresh");core.need(typeof b.note==="string"&&b.note.trim().length>0,"Write a note");c.notes.push({at:now(),text:b.note.trim().slice(0,20000)});c.revision++;return save(c);}));
  }
 }
 reply(res,404,{error:"No such desk route"});
}catch(e){reply(res,400,{error:safeError(e).message});}});
let stopping=false;async function stop(){if(stopping)return;stopping=true;server.close();await Promise.allSettled([...busy.values()]);await lock.close();await unlink(lockPath);process.exit(0);}
process.once("SIGINT",stop);process.once("SIGTERM",stop);
server.on("error",async e=>{console.error(String(e.message));await lock.close();await unlink(lockPath).catch(()=>{});process.exit(1);});
server.listen(port,host,()=>console.log("Partner Batch Desk: http://"+host+":"+port+"\nWorkspace: "+root+"\nSDK: "+core.SDK_PIN.name+"@"+core.SDK_PIN.version));
