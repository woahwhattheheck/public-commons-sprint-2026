#!/usr/bin/env node
import {promises as fs} from "node:fs";
import {resolve, join, dirname, basename} from "node:path";
import {fileURLToPath} from "node:url";
import {randomUUID, createHash} from "node:crypto";
import {HaystackClient} from "./client.mjs";
import {stringifyJson} from "./json-codec.mjs";
import {HaystackWorkspace} from "./store.mjs";
import {verifyBundle, receiveBundle, PACKAGE_MAX_BYTES} from "./portable.mjs";
import {startServer} from "./server.mjs";
import {serveStdio} from "./protocol.mjs";
import {actions, validateArguments} from "./catalog.mjs";
import {plainRead, createOnlyFile} from "./files.mjs";
import {canonical} from "./util.mjs";

const REQUEST_FORMAT="commons.haystack.operator.request.v1";
const SOURCE_LIMIT=32*1024*1024;
const REQUEST_LIMIT=288*1024*1024;
const RECEIPT_LIMIT=192*1024*1024;
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const sha256=bytes=>createHash("sha256").update(bytes).digest("hex");
const stringify=value=>stringifyJson(value,2)+"\n";
const clean=object=>Object.fromEntries(Object.entries(object).filter(([,value])=>value!==undefined));
const one=(flags,key,fallback)=>{const value=flags[key];if(value===undefined)return fallback;if(typeof value!=="string")throw new Error("--"+key+" needs one value.");return value;};
const required=(flags,key)=>{const value=one(flags,key);if(value===undefined||!value.trim())throw new Error("Supply --"+key+".");return value;};
const integer=(value,label,min=0,max=Number.MAX_SAFE_INTEGER)=>{if(!/^(0|[1-9][0-9]*)$/.test(String(value)))throw new Error(label+" needs an integer.");const number=Number(value);if(!Number.isSafeInteger(number)||number<min||number>max)throw new Error(label+" is outside its supported range.");return number;};
const uuid=value=>{if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value))throw new Error("Supply a complete operation UUID.");return value;};
const booleanFlags=new Set(["help","page","reconnect","no-select"]);
const sharedFlags=["directory","url","connection","token-file","workspace-id","instance-id","reconnect","expected-revision","out","help"];
const mutationFlags=["request-file","request-directory","operation-id"];
const pageFlags=["page","offset","limit"];
function parse(argv){
  const command=argv[0]&&!argv[0].startsWith("--")?argv.shift():"help",flags={},positionals=[];
  while(argv.length){
    const raw=argv.shift();
    if(raw==="--"){positionals.push(...argv);break;}
    if(!raw.startsWith("--")){positionals.push(raw);continue;}
    const split=raw.indexOf("="),key=raw.slice(2,split<0?undefined:split);
    if(!/^[a-z][a-z0-9-]*$/.test(key))throw new Error("Use complete --option names.");
    const value=split>=0?raw.slice(split+1):booleanFlags.has(key)?true:argv.shift();
    if(booleanFlags.has(key)&&value!==true)throw new Error("--"+key+" is a flag and takes no value.");
    if(value===undefined||(typeof value==="string"&&value.startsWith("--")))throw new Error("--"+key+" needs a value.");
    if(own(flags,key)){if(key!=="source-id")throw new Error("--"+key+" was supplied more than once.");flags[key]=[...(Array.isArray(flags[key])?flags[key]:[flags[key]]),value];}
    else flags[key]=value;
  }
  return {command,flags,positionals};
}
function options(flags,allowed){
  for(const key of Object.keys(flags))if(!allowed.includes(key))throw new Error("Unknown option --"+key+" for this command.");
}
async function readJson(path,maximum=REQUEST_LIMIT){
  const bytes=await plainRead(resolve(path),maximum);
  try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}
  catch{throw new Error("The complete UTF-8 JSON file could not be parsed: "+path);}
}
async function readText(path,maximum=16384){
  const bytes=await plainRead(resolve(path),maximum);
  return new TextDecoder("utf-8",{fatal:true}).decode(bytes);
}
async function exactFile(path,bytes){
  const target=resolve(path);await fs.mkdir(dirname(target),{recursive:true,mode:0o700});
  await createOnlyFile(target,Buffer.from(bytes));
  return {path:target,bytes:bytes.length,sha256:sha256(bytes)};
}
async function output(value,flags){
  const bytes=Buffer.from(stringify(value));
  if(flags.out){const saved=await exactFile(required(flags,"out"),bytes);process.stdout.write(stringify(saved));}
  else process.stdout.write(bytes);
}
async function tokenFor(flags){
  if(!flags["token-file"])return "";
  const token=(await readText(required(flags,"token-file"))).trim();
  if(!token||/[\r\n\0]/.test(token))throw new Error("The token file must contain one nonempty line.");
  return token;
}
async function targetFor(flags){
  const directory=one(flags,"directory");
  if(directory&&(flags.url||flags.connection))throw new Error("Choose one explicit local directory or one server connection.");
  if(directory){
    if(flags["token-file"]||flags["instance-id"]||flags.reconnect)throw new Error("Server token and instance options apply to a server connection.");
    const workspace=new HaystackWorkspace(directory),state=await workspace.read();
    if(flags["workspace-id"]&&state.workspaceId!==one(flags,"workspace-id"))throw new Error("The selected local workspace identity differs.");
    return {workspaceId:state.workspaceId,directory:workspace.directory,workspace,
      request:(action,args={})=>workspace.dispatch(action,args),
      sourceBytes:async sourceId=>(await workspace.originalSource(sourceId)).bytes,
      deliveryBytes:async operationId=>(await workspace.deliveryBytes(operationId)).bytes};
  }
  let connection={};
  if(flags.connection)connection=await readJson(required(flags,"connection"),65536);
  const url=one(flags,"url",connection.url);
  if(!url)throw new Error("Choose --directory, --url, or the original --connection file.");
  const workspaceId=one(flags,"workspace-id",connection.workspaceId),instanceId=flags.reconnect?undefined:one(flags,"instance-id",connection.instanceId);
  if(flags.reconnect&&!workspaceId)throw new Error("--reconnect needs the original workspace identity.");
  const client=new HaystackClient(clean({url,token:await tokenFor(flags),workspaceId,instanceId}));
  const identity=await client.connect();
  return {workspaceId:identity.workspaceId,identity,client,
    request:(action,args={})=>client.request(action,args),
    sourceBytes:sourceId=>client.sourceBytes(sourceId),
    deliveryBytes:operationId=>client.deliveryBytes(operationId)};
}
async function expectedRevision(target,flags){
  if(flags["expected-revision"]!==undefined)return integer(one(flags,"expected-revision"),"Expected revision");
  return (await target.request("workspace.status",{})).revision;
}
function definition(action){
  const found=actions.find(item=>item.action===action);
  if(!found)throw new Error("Choose a declared action. Use catalog to read the complete action definitions.");
  return found;
}
async function retainRequest(target,action,args,flags){
  if(flags["request-file"]&&flags["request-directory"])throw new Error("Choose one request file or one request directory.");
  const operationId=args.operationId;
  const path=flags["request-file"]?resolve(required(flags,"request-file")):
    join(resolve(one(flags,"request-directory",target.directory?join(target.directory,"requests"):"./haystack-requests")),operationId+".request.json");
  const envelope={format:REQUEST_FORMAT,workspaceId:target.workspaceId,action,args:structuredClone(args),createdAt:new Date().toISOString()};
  await fs.mkdir(dirname(path),{recursive:true,mode:0o700});
  let handle;
  try{handle=await fs.open(path,"wx",0o600);}
  catch(error){if(error.code==="EEXIST")throw new Error("The original request file already exists. Use replay --request-file with that exact file, or choose a new file for a new operation.");throw error;}
  try{await handle.writeFile(stringify(envelope));await handle.sync();}
  finally{await handle.close();}
  process.stderr.write("Original request retained: "+path+"\n");
  return {path,envelope};
}
async function retainReceipt(path,receipt){
  const receiptPath=path+".receipt.json";
  try{return await exactFile(receiptPath,Buffer.from(stringify(receipt)));}
  catch(error){
    let prior;try{prior=await readJson(receiptPath,RECEIPT_LIMIT);}catch{throw error;}
    const comparable=value=>{const copy=structuredClone(value);delete copy.replayed;return canonical(copy);};
    if(comparable(prior)!==comparable(receipt))throw new Error("A different receipt already occupies "+receiptPath+".");
    return {path:receiptPath,retained:true};
  }
}
async function performMutation(target,action,fields,flags){
  const operationId=flags["operation-id"]?uuid(one(flags,"operation-id")):randomUUID();
  const args={...fields,expectedRevision:await expectedRevision(target,flags),operationId};
  validateArguments(action,args);
  const original=await retainRequest(target,action,args,flags);
  let result;
  try{result=await target.request(action,args);}
  catch(error){error.requestFile=original.path;error.operationId=operationId;throw error;}
  try{await retainReceipt(original.path,result);}
  catch(error){error.serverCompleted=true;error.result=result;error.requestFile=original.path;throw error;}
  return result;
}
async function allPages(target,action,args,flags){
  const limit=flags.limit===undefined?250:integer(one(flags,"limit"),"Page limit",1,250);
  if(!flags.page&&(flags.offset!==undefined||flags.limit!==undefined))throw new Error("--offset and --limit select a single explicit --page.");
  let offset=flags.offset===undefined?0:integer(one(flags,"offset"),"Page offset"),total=null,first=null;
  const items=[];
  for(;;){
    const result=await target.request(action,{...args,offset,limit});
    if(!result||!Array.isArray(result.items)||result.workspaceId!==target.workspaceId||result.revision!==args.expectedRevision||result.offset!==offset)throw new Error("The returned page does not match the original workspace revision and cursor.");
    if(total!==null&&result.total!==total)throw new Error("The complete collection changed during paging.");
    if(flags.page)return result;
    if(first===null)first=result;total=result.total;items.push(...result.items);
    if(!result.hasMore)return {...first,items,offset:0,limit:items.length,total,nextOffset:items.length,hasMore:false,complete:true};
    if(!Number.isSafeInteger(result.nextOffset)||result.nextOffset<=offset||result.nextOffset>total)throw new Error("The original record cursor did not advance.");
    offset=result.nextOffset;
  }
}
async function revisionArgs(target,flags,extra={}){return {expectedRevision:await expectedRevision(target,flags),...extra};}
function editionArgs(flags){return clean({editionId:one(flags,"edition")});}
function listArgs(flags){return clean({editionId:one(flags,"edition"),sourceId:one(flags,"source-id"),role:one(flags,"role"),query:one(flags,"query")});}
async function optionalNote(flags){
  if(flags.note!==undefined&&flags["note-file"]!==undefined)throw new Error("Choose --note or --note-file.");
  return flags["note-file"]?await readText(required(flags,"note-file"),32768):one(flags,"note","");
}
async function deliveryToFile(target,result,flags){
  if(!flags.out)return output(result,flags);
  const bytes=await target.deliveryBytes(result.operationId);
  if(bytes.length!==result.bytes||sha256(bytes)!==result.sha256)throw new Error("The complete prepared delivery differs from its original receipt.");
  const saved=await exactFile(required(flags,"out"),bytes);
  process.stdout.write(stringify({receipt:result,file:saved}));
}
async function replay(target,flags){
  if(flags["expected-revision"]!==undefined)throw new Error("The original replay request already supplies its exact expected revision; omit --expected-revision.");
  const path=resolve(required(flags,"request-file")),original=await readJson(path,REQUEST_LIMIT);
  if(original?.format!==REQUEST_FORMAT||original.workspaceId!==target.workspaceId||typeof original.action!=="string"||!original.args)throw new Error("The retained request belongs to a different workspace or format.");
  const def=definition(original.action);
  if(!def.writes)throw new Error("Replay requires a retained original mutation.");
  validateArguments(original.action,original.args);uuid(original.args.operationId);
  let result;
  try{result=await target.request("operation.read",{operationId:original.args.operationId});}
  catch(error){
    if(error.status!==404)throw error;
    result=await target.request(original.action,structuredClone(original.args));
  }
  await retainReceipt(path,result);
  if(original.action==="delivery.prepare")return deliveryToFile(target,result,flags);
  return output(result,flags);
}
const HELP=`Haystack turnover workspace

Run with Node.js 22 or later. Commands use one explicit local --directory DIR,
or --url ORIGIN / --connection FILE for a running workspace server.
--token-file FILE supplies a configured server token. --workspace-id UUID pins
the workspace. --reconnect deliberately reconnects its original workspace after
a server restart; the request's original mutation identity is preserved.

Local lifecycle
  init             --directory DIR [--title TEXT]
  serve            --directory DIR [--title TEXT] [--host 127.0.0.1] [--port 8768]
                   [--token-file FILE] [--workspace-id UUID]
  receive          --file BUNDLE --destination NEW_DIR
  verify           --file BUNDLE
  writer           --directory DIR
  recover-writer   --directory DIR --lock-id UUID
  rpc              --directory DIR

Read original and working material
  status
  sources
  records          [--edition SHA] [--source-id SHA] [--role site|equip|point|all]
                   [--query TEXT]
  record           --record-key SHA:ROW [--edition SHA]
  diagnostics      [--edition SHA] [--source-id SHA] [--severity error|warning|info]
                   [--record-key SHA:ROW]
  proposals        [--state proposed|accepted|rejected]
  proposal         --proposal-id UUID
  editions
  edition          --edition SHA
  operations
  operation        --operation-id UUID
  source-download  --source-id SHA --out FILE
  delivery-download --operation-id UUID --out FILE
  catalog

Prepare and review work
  rename           --title TEXT
  import           --file GRID.json [--name TEXT] [--source-url TEXT] [--no-select]
  select           --source-id SHA [--source-id SHA ...]
                   OR --sources-file ARRAY.json
  preview          --edits ARRAY.json
  propose          --title TEXT --edits ARRAY.json [--note TEXT|--note-file FILE]
  review           --proposal-id UUID --decision accept|reject [--note TEXT|--note-file FILE]
  save             --title TEXT [--note TEXT|--note-file FILE]
  compare          --before SHA --after SHA [--source-pairs ARRAY.json]
                   [--state added|removed|changed|same]

Complete delivery
  report           --kind register|diagnostics [--format json|csv|html]
                   [--edition SHA] [--role site|equip|point|all] [--out FILE]
  native-grid      --source-id SHA [--edition SHA] [--out FILE]
  export-workspace [--out FILE]
  replay           --request-file ORIGINAL.request.json [--out FILE]

General action access
  request          ACTION --args OBJECT.json [--out FILE]

Every mutation retains its complete request before sending. Use
--request-file FILE or --request-directory DIR to choose where; the default is
DIR/requests locally or ./haystack-requests for server connections.
--operation-id UUID selects an original operation identity for a new retained
request. --expected-revision N uses the exact revision you reviewed; otherwise
the command reads current status once before preparing its request.
replay first reads the original receipt, then resends the exact request only
when no completed receipt exists. It never changes its operation ID, expected
revision, source bytes or arguments.

List commands read every page by default. --page [--offset N] [--limit 1..250]
returns one explicit page with its original continuation.
--out FILE saves complete JSON for reads; delivery commands save the full file.
Existing output files are accepted only when their complete bytes already match.
`;
export async function main(argv=process.argv.slice(2)){
  const {command,flags,positionals}=parse([...argv]);
  if(command==="help"||flags.help){process.stdout.write(HELP);return;}
  if(command==="request"){
    if(positionals.length!==1)throw new Error("Use request ACTION --args OBJECT.json.");
  }else if(positionals.length)throw new Error("Unexpected positional argument: "+positionals[0]);
  if(command==="catalog"){options(flags,["out"]);return output(actions,flags);}
  if(command==="init"){
    options(flags,["directory","title","out"]);
    const workspace=new HaystackWorkspace(required(flags,"directory"));
    await workspace.initialize(one(flags,"title","Building turnover"));
    return output(await workspace.dispatch("workspace.status",{}),flags);
  }
  if(command==="verify"){
    options(flags,["file","out"]);
    const result=verifyBundle(await plainRead(resolve(required(flags,"file")),PACKAGE_MAX_BYTES));
    return output({format:"commons.haystack.verification.v1",workspaceId:result.state.workspaceId,title:result.state.title,revision:result.state.revision,
      packageSha256:result.packageSha256,payloadSha256:result.payloadSha256,bytes:result.bytes,
      sourceCount:result.state.sources.length,editionCount:result.state.editions.length,proposalCount:result.state.proposals.length,
      applicationFiles:[...result.application].map(([name,bytes])=>({name,bytes:bytes.length,sha256:sha256(bytes)}))},flags);
  }
  if(command==="receive"){
    options(flags,["file","destination","out"]);
    const bytes=await plainRead(resolve(required(flags,"file")),PACKAGE_MAX_BYTES);
    const result=await receiveBundle(bytes,required(flags,"destination"));
    return output({...result,launch:{executable:process.execPath,args:[join(result.directory,"application","cli.mjs"),"serve","--directory",result.directory]}},flags);
  }
  if(command==="serve"){
    options(flags,["directory","title","host","port","token-file","workspace-id"]);
    const server=await startServer({directory:required(flags,"directory"),title:one(flags,"title","Building turnover"),host:one(flags,"host","127.0.0.1"),
      port:integer(one(flags,"port","8768"),"Port",0,65535),token:await tokenFor(flags),expectedWorkspaceId:one(flags,"workspace-id",null)});
    const startup={...server.identity,tokenConfigured:!!flags["token-file"],...(flags["token-file"]?{tokenFile:resolve(one(flags,"token-file"))}:{}),
      browser:server.url,connectionFile:join(server.workspace.directory,"connection.json")};
    process.stdout.write(stringifyJson(startup)+"\n");
    process.stderr.write("Workspace server ready. Open "+server.url+" in your browser."+(flags["token-file"]?" Use the token from the configured private file.":" Leave the access token blank for this local connection.")+"\n");
    await new Promise((resolveDone,reject)=>{
      let stopping=false;
      const stop=()=>{if(stopping)return;stopping=true;server.close().then(resolveDone,reject);};
      process.once("SIGINT",stop);process.once("SIGTERM",stop);
      server.server.once("close",resolveDone);server.server.once("error",reject);
    });
    return;
  }
  if(command==="writer"||command==="recover-writer"||command==="rpc"){
    options(flags,command==="recover-writer"?["directory","lock-id","out"]:command==="writer"?["directory","out"]:["directory"]);
    const workspace=new HaystackWorkspace(required(flags,"directory"));
    if(command==="writer")return output(await workspace.writer(),flags);
    if(command==="recover-writer")return output(await workspace.recoverWriter(required(flags,"lock-id")),flags);
    await workspace.read();return serveStdio(workspace);
  }
  const specific={
    status:[],sources:pageFlags,records:[...pageFlags,"edition","source-id","role","query"],
    record:["record-key","edition"],diagnostics:[...pageFlags,"edition","source-id","severity","record-key"],
    proposals:[...pageFlags,"state"],proposal:["proposal-id"],editions:pageFlags,edition:["edition"],
    operations:pageFlags,operation:["operation-id"],"source-download":["source-id"],"delivery-download":["operation-id"],
    rename:[...mutationFlags,"title"],import:[...mutationFlags,"file","name","source-url","no-select"],
    select:[...mutationFlags,"source-id","sources-file"],preview:["edits"],
    propose:[...mutationFlags,"title","edits","note","note-file"],
    review:[...mutationFlags,"proposal-id","decision","note","note-file"],
    save:[...mutationFlags,"title","note","note-file"],
    compare:[...pageFlags,"before","after","source-pairs","state"],
    report:[...mutationFlags,"kind","format","edition","role"],
    "native-grid":[...mutationFlags,"source-id","edition"],
    "export-workspace":mutationFlags,replay:["request-file"],
    request:[...mutationFlags,"args"]
  };
  if(!specific[command])throw new Error("Unknown command "+command+". Use help for the complete workflow.");
  options(flags,[...sharedFlags,...specific[command]]);
  const target=await targetFor(flags);
  if(command==="status")return output(await target.request("workspace.status",{}),flags);
  if(command==="sources")return output(await allPages(target,"sources.list",await revisionArgs(target,flags),flags),flags);
  if(command==="records")return output(await allPages(target,"records.list",await revisionArgs(target,flags,listArgs(flags)),flags),flags);
  if(command==="record")return output(await target.request("record.read",await revisionArgs(target,flags,{...editionArgs(flags),recordKey:required(flags,"record-key")})),flags);
  if(command==="diagnostics")return output(await allPages(target,"diagnostics.list",await revisionArgs(target,flags,clean({editionId:one(flags,"edition"),sourceId:one(flags,"source-id"),severity:one(flags,"severity"),recordKey:one(flags,"record-key")})),flags),flags);
  if(command==="proposals")return output(await allPages(target,"proposals.list",await revisionArgs(target,flags,clean({state:one(flags,"state")})),flags),flags);
  if(command==="proposal")return output(await target.request("proposal.read",await revisionArgs(target,flags,{proposalId:required(flags,"proposal-id")})),flags);
  if(command==="editions")return output(await allPages(target,"editions.list",await revisionArgs(target,flags),flags),flags);
  if(command==="edition")return output(await target.request("edition.read",await revisionArgs(target,flags,{editionId:required(flags,"edition")})),flags);
  if(command==="operations")return output(await allPages(target,"operations.list",await revisionArgs(target,flags),flags),flags);
  if(command==="operation")return output(await target.request("operation.read",{operationId:required(flags,"operation-id")}),flags);
  if(command==="source-download"||command==="delivery-download"){
    const bytes=command==="source-download"?await target.sourceBytes(required(flags,"source-id")):await target.deliveryBytes(required(flags,"operation-id"));
    const file=await exactFile(required(flags,"out"),bytes);process.stdout.write(stringify(file));return;
  }
  if(command==="preview"){
    const edits=await readJson(required(flags,"edits"));
    return output(await target.request("proposal.preview",await revisionArgs(target,flags,{edits})),flags);
  }
  if(command==="compare"){
    const args=await revisionArgs(target,flags,clean({beforeEditionId:required(flags,"before"),afterEditionId:required(flags,"after"),
      state:one(flags,"state"),sourcePairs:flags["source-pairs"]?await readJson(required(flags,"source-pairs")):undefined}));
    return output(await allPages(target,"edition.compare",args,flags),flags);
  }
  if(command==="replay")return replay(target,flags);
  if(command==="request"){
    const action=positionals[0],args=await readJson(required(flags,"args")),def=definition(action);
    if(!args||typeof args!=="object"||Array.isArray(args))throw new Error("Supply a complete JSON arguments object.");
    if(def.writes){
      const operationId=own(args,"operationId")?uuid(args.operationId):flags["operation-id"]?uuid(one(flags,"operation-id")):randomUUID();
      if(flags["operation-id"]&&operationId!==one(flags,"operation-id"))throw new Error("The arguments and requested operation identities differ.");
      const expected=own(args,"expectedRevision")?args.expectedRevision:await expectedRevision(target,flags);
      if(flags["expected-revision"]!==undefined&&expected!==integer(one(flags,"expected-revision"),"Expected revision"))throw new Error("The arguments and requested workspace revisions differ.");
      const prepared={...args,operationId,expectedRevision:expected};validateArguments(action,prepared);
      const original=await retainRequest(target,action,prepared,flags);
      let result;
      try{result=await target.request(action,prepared);}
      catch(error){error.requestFile=original.path;error.operationId=operationId;throw error;}
      try{await retainReceipt(original.path,result);}catch(error){error.serverCompleted=true;error.result=result;error.requestFile=original.path;throw error;}
      return action==="delivery.prepare"?deliveryToFile(target,result,flags):output(result,flags);
    }
    if(def.inputSchema.required.includes("expectedRevision")&&!own(args,"expectedRevision"))args.expectedRevision=await expectedRevision(target,flags);
    validateArguments(action,args);return output(await target.request(action,args),flags);
  }
  let action,fields;
  if(command==="rename"){action="workspace.rename";fields={title:required(flags,"title")};}
  else if(command==="import"){
    action="source.import";const file=resolve(required(flags,"file")),bytes=await plainRead(file,SOURCE_LIMIT);
    fields={name:one(flags,"name",basename(file)),base64:bytes.toString("base64"),sourceUrl:one(flags,"source-url",""),format:"json-v4",select:!flags["no-select"]};
  }else if(command==="select"){
    action="source.select";
    if(flags["sources-file"]&&flags["source-id"])throw new Error("Choose a complete source array file or repeated --source-id options.");
    const sourceIds=flags["sources-file"]?await readJson(required(flags,"sources-file")):Array.isArray(flags["source-id"])?flags["source-id"]:flags["source-id"]?[one(flags,"source-id")]:null;
    if(!Array.isArray(sourceIds))throw new Error("Choose --source-id or a complete --sources-file array. Use an empty array to clear the selection.");
    fields={sourceIds};
  }else if(command==="propose"){action="proposal.prepare";fields={title:required(flags,"title"),note:await optionalNote(flags),edits:await readJson(required(flags,"edits"))};}
  else if(command==="review"){action="proposal.review";fields={proposalId:required(flags,"proposal-id"),decision:required(flags,"decision"),note:await optionalNote(flags)};}
  else if(command==="save"){action="edition.save";fields={title:required(flags,"title"),note:await optionalNote(flags)};}
  else if(command==="report"){
    action="delivery.prepare";const kind=required(flags,"kind");
    if(!["register","diagnostics"].includes(kind))throw new Error("Use report --kind register|diagnostics, native-grid, or export-workspace.");
    if(kind==="diagnostics"&&flags.role!==undefined)throw new Error("The diagnostic delivery retains the complete selected finding set; omit --role.");
    fields=clean({kind,format:one(flags,"format","json"),editionId:one(flags,"edition"),role:kind==="register"?one(flags,"role","all"):undefined});
  }else if(command==="native-grid"){action="delivery.prepare";fields=clean({kind:"native-grid",format:"json",sourceId:required(flags,"source-id"),editionId:one(flags,"edition")});}
  else if(command==="export-workspace"){action="delivery.prepare";fields={kind:"workspace"};}
  const result=await performMutation(target,action,fields,flags);
  return action==="delivery.prepare"?deliveryToFile(target,result,flags):output(result,flags);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{
    process.stderr.write(stringify(clean({error:error.message,code:error.code,status:error.status,details:error.details,
      outcomeUnknown:error.outcomeUnknown,requestFile:error.requestFile,operationId:error.operationId,serverCompleted:error.serverCompleted,result:error.result})));
    process.exitCode=1;
  });
}
