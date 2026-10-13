#!/usr/bin/env node
// MIT. Preserve the reviewed preview and original request before the native write.
import { promises as fs, constants as FS } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LineageWorkspace } from "./store.mjs";
import { PolicyRolloutClient } from "./service-policy-rollout-client.mjs";
import { normalizePolicyPlan, PREVIEW_SCHEMA } from "./service-policy-rollout.mjs";
import { digest, canonical, sha256 } from "./model.mjs";

export const POLICY_ROLLOUT_HELP = [
 "OpenLineage reviewed multi-job service policies",
 "",
 "  openlineage policy-rollout status --workspace DIR",
 "  openlineage policy-rollout preview --workspace DIR --input PLAN.json --out NEW_PREVIEW.json",
 "  openlineage policy-rollout prepare --preview PREVIEW.json --expected-preview-sha256 HASH --operation-id ID --out NEW_REQUEST.json",
 "  openlineage policy-rollout request --workspace DIR --request REQUEST.json --expected-request-sha256 HASH",
 "  openlineage policy-rollout apply --workspace DIR --request REQUEST.json --expected-request-sha256 HASH --out RECEIPT.json",
 "  openlineage policy-rollout resume --workspace DIR --request REQUEST.json --expected-request-sha256 HASH --out RECEIPT.json",
 "  openlineage policy-rollout show --workspace DIR --id ROLLOUT_ID [--out NEW_FILE]",
 "  openlineage policy-rollout report --workspace DIR --id ROLLOUT_ID --format json|csv|html --out NEW_FILE",
 "",
 "Replace --workspace DIR with --url URL [--token-file FILE].",
 "HTTP connections accept --expected-workspace-id ID and --instance-id ID.",
 "prepare performs no native write and requires no workspace or URL.",
 "apply and resume first inspect the original operation journal, then dispatch the same request only if absent.",
 "A changed original operation body, selected workspace, preview, policy version or revision rejects the write.",
 "Outputs are create-only; an identical complete existing file can be reopened. Keep the full original request.",
 "Use the original export/verify/receive commands for all sources, policies, history and editable application."
].join("\n");
const REQUEST_SCHEMA="commons.openlineage.service-policy-request.v1";
const HASH=/^[0-9a-f]{64}$/;
const same=(a,b)=>canonical(a)===canonical(b);
const required=(x,name)=>{if(typeof x!=="string"||!x.trim())throw new Error(name+" is required");return x;};
function parse(args) {
 const options={};
 for(let i=0;i<args.length;i++) {
  const flag=args[i];
  if(typeof flag!=="string"||!/^--[a-z-]+$/.test(flag)||Object.hasOwn(options,flag.slice(2)))throw new Error("Unexpected or repeated option "+flag);
  const value=args[++i];
  if(typeof value!=="string"||!value.length||value.startsWith("--"))throw new Error("Missing value for "+flag);
  options[flag.slice(2)]=value;
 }
 return options;
}
function allowed(options,names,connection=true) {
 const keys=new Set([...(connection?["workspace","url","token-file","expected-workspace-id","instance-id"]:[]),...names]);
 for(const key of Object.keys(options))if(!keys.has(key))throw new Error("Unsupported option --"+key);
}
function stable(a,b) {return ["dev","ino","size","mtimeNs","ctimeNs"].every(key=>a[key]===b[key]);}
function filesOwner() {
 const handles=new Set();
 async function open(path,flags,mode) {const handle=await fs.open(path,flags,mode);handles.add(handle);return handle;}
 async function close(handle) {try{await handle.close();}finally{if(handle.fd===-1)handles.delete(handle);}}
 async function drain() {
  let first;
  for(const handle of [...handles])try{await close(handle);}catch(error){first??=error;}
  if(first) {Object.defineProperty(first,"close",{value:drain,configurable:true});throw first;}
 }
 async function read(path,max=64*1024*1024) {
  const handle=await open(resolve(path),FS.O_RDONLY|FS.O_NOFOLLOW);let first,body;
  try {
   const before=await handle.stat({bigint:true});
   if(!before.isFile()||before.size>BigInt(max))throw new Error("Use a bounded ordinary original file");
   body=await handle.readFile();
   if(BigInt(body.length)!==before.size||!stable(before,await handle.stat({bigint:true})))throw new Error("Original file changed during read");
  }catch(error){first=error;}
  try{await close(handle);}catch(error){first??=error;}
  if(first)throw first;return body;
 }
 async function write(path,body) {
  path=resolve(required(path,"--out"));body=Buffer.from(body);let handle,first;
  try{handle=await open(path,FS.O_WRONLY|FS.O_CREAT|FS.O_EXCL|FS.O_NOFOLLOW,0o600);}
  catch(error){if(error.code!=="EEXIST")throw error;if(!(await read(path)).equals(body))throw new Error("Output contains a different original file");}
  if(handle) {
   try{await handle.writeFile(body);await handle.sync();}catch(error){first=error;}
   try{await close(handle);}catch(error){first??=error;}
   if(first)throw first;
  }
  const parent=await open(dirname(path),FS.O_RDONLY|FS.O_DIRECTORY|FS.O_NOFOLLOW);
  try{await parent.sync();}catch(error){first=error;}
  try{await close(parent);}catch(error){first??=error;}
  if(first)throw first;
  return {path,bytes:body.length,sha256:sha256(body)};
 }
 return {read,write,drain};
}
async function jsonFile(files,path) {
 return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(await files.read(required(path,"input path"))));
}
function checkPreview(value) {
 if(!value||value.schema!==PREVIEW_SCHEMA||typeof value.workspaceId!=="string"||!value.workspaceId||
    !Number.isSafeInteger(value.sourceRevision)||value.sourceRevision<0||!HASH.test(value.previewSha256))throw new Error("Use the complete original preview");
 const {previewSha256,...payload}=value;
 if(digest(payload)!==previewSha256||!same(normalizePolicyPlan(value.plan),value.plan))throw new Error("Original preview contents changed");
 return value;
}
function checkRequest(value,expected) {
 if(!value||value.schema!==REQUEST_SCHEMA||value.action!=="service-policy-rollout.apply"||!HASH.test(expected))throw new Error("Use the complete original request and its reviewed checksum");
 const {requestSha256,...payload}=value;
 if(requestSha256!==expected||digest(payload)!==requestSha256)throw new Error("Original request checksum changed");
 const preview=checkPreview(value.preview),args=value.args;
 if(value.workspaceId!==preview.workspaceId||!args||Object.keys(args).sort().join(",")!=="expectedPreviewSha256,expectedRevision,operationId,plan"||
    required(args.operationId,"operationId")!==args.operationId.trim()||args.operationId.length>400||args.operationId.includes("\0")||
    args.expectedRevision!==preview.sourceRevision||args.expectedPreviewSha256!==preview.previewSha256||!same(args.plan,preview.plan))throw new Error("Original request differs from its reviewed preview");
 return value;
}
async function destination(options,files,requiredWorkspaceId) {
 if(Boolean(options.workspace)===Boolean(options.url))throw new Error("Choose exactly one of --workspace and --url");
 if(options["expected-workspace-id"]&&requiredWorkspaceId&&options["expected-workspace-id"]!==requiredWorkspaceId)throw new Error("Requested workspace identity differs from original preview");
 const expectedWorkspaceId=requiredWorkspaceId??options["expected-workspace-id"];
 if(options.workspace) {
  if(options["token-file"]||options["instance-id"])throw new Error("Token and instance options require an HTTP connection");
  const workspace=new LineageWorkspace(options.workspace),metadata=await workspace.metadata();
  if(expectedWorkspaceId&&metadata.workspaceId!==expectedWorkspaceId)throw new Error("Selected workspace differs from the original reviewed workspace");
  return {dispatch:(action,args)=>workspace.dispatch(action,args),metadata:()=>workspace.metadata()};
 }
 const token=options["token-file"]?new TextDecoder("utf-8",{fatal:true}).decode(await files.read(options["token-file"],1024*1024)).trim():null;
 const client=new PolicyRolloutClient(options.url,{token,expectedWorkspaceId:expectedWorkspaceId??null,instanceId:options["instance-id"]??null});
 const identity=await client.requestJSON("/api/identity");
 if(identity?.schema!=="commons.openlineage.startup.v1"||typeof identity.workspaceId!=="string"||typeof identity.instanceId!=="string"||
    expectedWorkspaceId&&identity.workspaceId!==expectedWorkspaceId||options["instance-id"]&&identity.instanceId!==options["instance-id"])throw new Error("The original HTTP identity differs from the selected workspace");
 client.expectedWorkspaceId=identity.workspaceId;client.instanceId=identity.instanceId;
 return {dispatch:(action,args)=>client.action(action,args),metadata:()=>client.metadata()};
}
async function lookup(target,request) {
 const metadata=await target.metadata();
 if(metadata.workspaceId!==request.workspaceId)throw new Error("Original workspace identity changed");
 const args=request.args,requestHash=digest({action:request.action,plan:args.plan,expectedPreviewSha256:args.expectedPreviewSha256});
 let offset=0;
 for(;;) {
  const page=await target.dispatch("records.read",{collection:"operations",expectedRevision:metadata.revision,offset,limit:1000});
  const row=page.items.find(item=>item.id===args.operationId);
  if(row) {
   if(row.requestHash!==requestHash)throw Object.assign(new Error("Original operation ID belongs to different arguments"),{status:409});
   return {found:true,workspaceId:metadata.workspaceId,revision:metadata.revision,requestHash,result:row.result};
  }
  if(page.nextOffset===null)return {found:false,workspaceId:metadata.workspaceId,revision:metadata.revision,requestHash};
  if(!Number.isSafeInteger(page.nextOffset)||page.nextOffset<=offset)throw new Error("Original operation history made no progress");
  offset=page.nextOffset;
 }
}
async function main(argv,files) {
 const [command,...args]=argv;
 if(!command||["help","--help","-h"].includes(command))return POLICY_ROLLOUT_HELP;
 const o=parse(args);
 const choices={status:[],preview:["input","out"],prepare:["preview","expected-preview-sha256","operation-id","out"],
 request:["request","expected-request-sha256"],apply:["request","expected-request-sha256","out"],resume:["request","expected-request-sha256","out"],
 show:["id","out"],report:["id","format","out"]};
 if(!Object.hasOwn(choices,command))throw new Error("Unknown policy-rollout command");
 allowed(o,choices[command],command!=="prepare");
 if(command==="prepare") {
  const preview=checkPreview(await jsonFile(files,o.preview));
  if(preview.previewSha256!==required(o["expected-preview-sha256"],"--expected-preview-sha256"))throw new Error("Selected preview checksum differs");
  const operationId=required(o["operation-id"],"--operation-id");
  if(operationId!==operationId.trim()||operationId.length>400||operationId.includes("\0"))throw new Error("Use the exact nonempty operation ID");
  const payload={schema:REQUEST_SCHEMA,workspaceId:preview.workspaceId,action:"service-policy-rollout.apply",preview,
   args:{operationId,expectedRevision:preview.sourceRevision,plan:preview.plan,expectedPreviewSha256:preview.previewSha256}};
  const request={...payload,requestSha256:digest(payload)};
  return {requestSha256:request.requestSha256,request:await files.write(o.out,JSON.stringify(request,null,2)+"\n"),workspaceId:request.workspaceId,operationId};
 }
 let request=null;
 if(["request","apply","resume"].includes(command))request=checkRequest(await jsonFile(files,o.request),required(o["expected-request-sha256"],"--expected-request-sha256"));
 if(["preview","apply","resume","report"].includes(command))required(o.out,"--out");
 const target=await destination(o,files,request?.workspaceId);
 if(command==="status")return target.dispatch("service-policy-rollout.read",{});
 if(command==="preview") {
  const value=await target.dispatch("service-policy-rollout.preview",{plan:await jsonFile(files,o.input)});
  checkPreview(value);return {preview:value,file:await files.write(o.out,JSON.stringify(value,null,2)+"\n")};
 }
 if(request) {
  const observed=await lookup(target,request);
  if(command==="request")return observed;
  const result=observed.found?observed.result:await target.dispatch(request.action,request.args);
  if(result.workspaceId!==request.workspaceId||result.operationId!==request.args.operationId||
     result.rollout?.previewSha256!==request.args.expectedPreviewSha256)throw new Error("Original accepted rollout receipt differs");
  // The retained result is the immutable native receipt, not the transient replay marker.
  const {replayed,...receipt}=result;
  return {receipt,file:await files.write(o.out,JSON.stringify(receipt,null,2)+"\n"),recovered:observed.found||replayed===true};
 }
 if(command==="show") {
  const result=await target.dispatch("service-policy-rollout.get",{id:required(o.id,"--id")});
  if(o.out)return {result,file:await files.write(o.out,JSON.stringify(result,null,2)+"\n")};
  return result;
 }
 const report=await target.dispatch("service-policy-rollout.report",{id:required(o.id,"--id"),format:required(o.format,"--format")});
 return {...await files.write(o.out,report.text),mediaType:report.mediaType};
}
export async function policyRolloutMain(argv=process.argv.slice(2)) {
 const files=filesOwner();let first,result;
 try{result=await main(argv,files);}catch(error){first=error;}
 try{await files.drain();}catch(error){first??=error;Object.defineProperty(first,"close",{value:files.drain,configurable:true});}
 if(first)throw first;
 const output=typeof result==="string"?result:JSON.stringify(result,null,2);
 await new Promise((resolve,reject)=>{
  let first=null;const error=value=>{first??=value;};process.stdout.on("error",error);
  process.stdout.write(output+"\n",failure=>{first??=failure;setImmediate(()=>{process.stdout.off("error",error);first?reject(first):resolve();});});
 });
 return 0;
}
if(process.argv[1]&&await fs.realpath(resolve(process.argv[1])).then(path=>path===fileURLToPath(import.meta.url),()=>false))
 policyRolloutMain().then(code=>{process.exitCode=code;}).catch(async error=>{
  if(typeof error.close==="function")try{await error.close();}catch(cleanup){error.cleanupError={message:cleanup.message};}
  process.stderr.on("error",()=>{process.exitCode=1;});
  process.stderr.write(JSON.stringify({error:error.message,status:error.status??1,details:error.details,cleanupError:error.cleanupError})+"\n");
  process.exitCode=1;
 });
