#!/usr/bin/env node
// MIT. Complete retained request files feed the original native workspace or HTTP client.
import { promises as fs, constants } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LineageWorkspace } from "./store.mjs";
import { ReviewReturnClient } from "./review-return-client.mjs";
import { sha256 } from "./model.mjs";
export const REVIEW_RETURN_HELP = [
 "OpenLineage customer review returns",
 "node review-return-cli.mjs --workspace DIR --request FULL_REQUEST.json --expected-request-sha256 HASH --out NEW_RESULT.json",
 "Replace --workspace DIR with --url URL --token-file FILE [--instance-id ID].",
 "Every request file is {schema:'commons.openlineage.review-return-action.v1',workspaceId,action,args}.",
 "Use one of the declared review-return actions. Mutation args retain operationId, expectedRevision and expectedPreviewSha256.",
 "The complete request file and expected byte hash are required for reads and writes. Resume with that exact same file.",
 "Report actions write the complete original report text; other actions write the original JSON receipt.",
 "The output is create-only; an identical complete existing output is reopened."
].join("\n");
async function read(path,maximum=16000000){
 const h=await fs.open(resolve(path),constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=await h.stat({bigint:true});
  if(!before.isFile()||before.size>BigInt(maximum))throw Error("Choose a bounded ordinary complete file");
  const bytes=await h.readFile(),after=await h.stat({bigint:true});
  if(BigInt(bytes.length)!==before.size||["dev","ino","size","mtimeNs","ctimeNs"].some(k=>before[k]!==after[k]))throw Error("Original file changed during read");
  return bytes;
 }finally{await h.close();}
}
async function output(path,body){
 const bytes=Buffer.from(body),target=resolve(path);let h;
 try{h=await fs.open(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
 catch(error){if(error.code!=="EEXIST")throw error;if(!(await read(target,100000000)).equals(bytes))throw Error("Output contains a different complete result");}
 if(h){try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}}
 const parent=await fs.open(dirname(target),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{await parent.sync();}finally{await parent.close();}
 return {path:target,bytes:bytes.length,sha256:sha256(bytes)};
}
export async function reviewReturnMain(argv=process.argv.slice(2)){
 if(!argv.length||argv.includes("--help")){process.stdout.write(REVIEW_RETURN_HELP+"\n");return 0;}
 const options={};for(let i=0;i<argv.length;i+=2){
  const name=argv[i],value=argv[i+1];if(!/^--[a-z-]+$/.test(name)||typeof value!=="string"||value.startsWith("--")||Object.hasOwn(options,name))throw Error("Keep distinct named options and complete values");options[name]=value;
 }
 const allowed=["--workspace","--url","--token-file","--instance-id","--request","--expected-request-sha256","--out"];
 if(Object.keys(options).some(k=>!allowed.includes(k))||Boolean(options["--workspace"])===Boolean(options["--url"])||
   !options["--request"]||!options["--out"]||!/^[a-f0-9]{64}$/.test(options["--expected-request-sha256"]??""))throw Error(REVIEW_RETURN_HELP);
 const bytes=await read(options["--request"]);if(sha256(bytes)!==options["--expected-request-sha256"])throw Error("Complete original request bytes differ");
 const packet=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
 if(packet.schema!=="commons.openlineage.review-return-action.v1"||typeof packet.workspaceId!=="string"||!packet.workspaceId||
   typeof packet.action!=="string"||!packet.action.startsWith("review-return.")||!packet.args||typeof packet.args!=="object"||Array.isArray(packet.args)||
   Object.keys(packet).some(k=>!["schema","workspaceId","action","args"].includes(k)))throw Error("Use the complete original review return action file");
 let dispatch;
 if(options["--workspace"]){
  if(options["--token-file"]||options["--instance-id"])throw Error("Token/instance options belong to an HTTP workspace");
  const workspace=new LineageWorkspace(resolve(options["--workspace"])),meta=await workspace.metadata();
  if(meta.workspaceId!==packet.workspaceId)throw Error("Selected workspace differs from the complete original request");
  dispatch=(action,args)=>workspace.dispatch(action,args);
 }else{
  const token=options["--token-file"]?new TextDecoder("utf-8",{fatal:true}).decode(await read(options["--token-file"],1000000)).trim():null;
  const client=new ReviewReturnClient(options["--url"],{token,expectedWorkspaceId:packet.workspaceId,instanceId:options["--instance-id"]??null});
  const identity=await client.requestJSON("/api/identity");
  if(identity.workspaceId!==packet.workspaceId||typeof identity.instanceId!=="string"||
    options["--instance-id"]&&identity.instanceId!==options["--instance-id"])throw Error("The original HTTP workspace identity differs");
  client.instanceId=identity.instanceId;dispatch=(action,args)=>client.action(action,args);
 }
 const result=await dispatch(packet.action,packet.args);
 if(result.workspaceId!==packet.workspaceId)throw Error("Received another workspace's result");
 const{replayed,...receipt}=result;
 const saved=await output(options["--out"],packet.action==="review-return.report"?result.text:JSON.stringify(receipt,null,2)+"\n");
 process.stdout.write(JSON.stringify({...saved,workspaceId:packet.workspaceId,action:packet.action,replayed:replayed===true})+"\n");return 0;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 reviewReturnMain().then(code=>{process.exitCode=code;}).catch(error=>{process.stderr.write(JSON.stringify({error:error.message,status:error.status??1})+"\n");process.exitCode=1;});
