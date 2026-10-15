#!/usr/bin/env node
/** Native source transfer command. Existing connected tools supply service calls. MIT. */
import fs from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import readline from "node:readline";
import {createArchiveCodec} from "../../opportunities/upstate_forever_2026/source_tools/archive_codec.mjs";
import {createNativeSourceTransfer} from "./native_source_transfer.mjs";
import {openSourceTransferJournal} from "./native_source_transfer_journal.mjs";
const HELP = "native_source_transfer_cli.mjs preview|inspect-request --spec FILE [--max-request-bytes BYTES]\nOr: prepare|advance|inspect|receive|reconcile-draft|refresh-original|to-notion|reconcile-notion-upload|download-notion|to-drive|reconcile-drive-upload|verify-drive|inspect-lock|recover-lock [--journal PRIVATE_DIR] [--key OPERATION_KEY] [--spec FILE] [--index N] [--caller EXISTING_MODULE | --bridge stdio] [--verify-original]";
function argumentsOf(values){
  const command=values.shift(),opts={};
  while(values.length){const k=values.shift();if(k==="--verify-original"){opts.verify=true;continue;}if(k==="--confirm-quiescent"){opts.quiescent=true;continue;}if(!k.startsWith("--")||!values.length)throw new Error(HELP);if(opts[k]!==undefined)throw new Error("DUPLICATE_OPTION "+k);opts[k]=values.shift();}
  const allowed=new Set(["--journal","--key","--spec","--index","--caller","--bridge","--draft","--message","--upload","--expect-lock-sha256","--max-request-bytes","--file-id"]);
  for(const k of Object.keys(opts))if(k!=="verify"&&k!=="quiescent"&&!allowed.has(k))throw new Error("UNKNOWN_OPTION "+k);
  return {command,opts};
}
async function jsonFile(filename){if(!filename)throw new Error("SPEC_REQUIRED");const b=await fs.readFile(path.resolve(filename));if(b.length>32*1024*1024)throw new Error("SPEC_TOO_LARGE");return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(b));}
async function sourceSpec(opts){
  const spec=await jsonFile(opts["--spec"]),base=path.dirname(path.resolve(opts["--spec"]));
  spec.files=await Promise.all(spec.files.map(async f=>{
      if(typeof f.content==="string"&&f.source_path!==undefined)throw new Error("CHOOSE_CONTENT_OR_SOURCE_PATH");
      if(typeof f.content==="string")return f;
      if(typeof f.source_path!=="string")throw new Error("SOURCE_PATH_REQUIRED");
      const bytes=await fs.readFile(path.resolve(base,f.source_path));
      return {...f,content:new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes)};
    }));
  return spec;
}
function stdioBridge(){
  const reader=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
  let waiter=null,ended=false,counter=0;const queued=[];
  reader.on("line",line=>{if(waiter){const w=waiter;waiter=null;w.resolve(line);}else queued.push(line);});
  reader.on("close",()=>{ended=true;if(waiter){waiter.reject(new Error("BRIDGE_CLOSED"));waiter=null;}});
  const line=()=>queued.length?Promise.resolve(queued.shift()):ended?Promise.reject(new Error("BRIDGE_CLOSED")):new Promise((resolve,reject)=>{waiter={resolve,reject};});
  async function request(kind,payload){
    const id="source-transfer-"+(++counter);
    process.stdout.write(JSON.stringify({kind,id,...payload})+"\n");
    const answer=JSON.parse(await line());
    if(answer.id!==id)throw new Error("BRIDGE_RESPONSE_ID_MISMATCH");
    if(answer.error){const e=new Error(answer.error.message||"BRIDGE_ERROR");e.detail=answer.error;throw e;}
    return answer;
  }
  return {call:async(name,args)=>(await request("native_tool_request",{name,arguments:args})).result,
    readOriginal:async(file_uri)=>(await request("complete_original_read",{file_uri})).content,
    close:()=>reader.close()};
}
function summary(result){
  if(!result?.record)return result;
  const s=result.record;
  return {...result,record:{schema:s.schema,key:s.key,operation_id:s.plan.operation_id,transport:s.plan.transport||"inline-manifest-v1",manifest:s.manifest||null,revision:s.revision,phase:s.phase,draft:s.draft,files:s.files,errors:s.errors}};
}
let bridge;
try{
  const {command,opts}=argumentsOf(process.argv.slice(2));
  const previewOnly=["preview","inspect-request"].includes(command);
  if(opts["--max-request-bytes"]!==undefined&&!previewOnly)throw new Error("BYTE_ADVISORY_IS_PREVIEW_ONLY");
  if(previewOnly&&(opts["--journal"]||opts["--caller"]||opts["--bridge"]||opts.verify||opts["--key"]))throw new Error("PREVIEW_HAS_NO_JOURNAL_OR_PROVIDER");
  let maxRequestBytes=null;
  if(opts["--max-request-bytes"]!==undefined){
    if(!/^[1-9][0-9]*$/.test(opts["--max-request-bytes"]))throw new Error("INVALID_REQUEST_BYTE_ADVISORY");
    maxRequestBytes=Number(opts["--max-request-bytes"]);
    if(!Number.isSafeInteger(maxRequestBytes))throw new Error("INVALID_REQUEST_BYTE_ADVISORY");
  }
  const codec=createArchiveCodec();
  const journal=opts["--journal"]?await openSourceTransferJournal(opts["--journal"]):null;
  let call=async()=>{throw new Error("USE_EXISTING_CALLER_OR_STDIO_BRIDGE");},readOriginal=null;
  if(opts["--caller"]&&opts["--bridge"])throw new Error("CHOOSE_ONE_CALLER");
  if(opts["--caller"]){
    const caller=await import(pathToFileURL(path.resolve(opts["--caller"])).href);
    if(typeof caller.call!=="function")throw new Error("CALLER_MUST_EXPORT_CALL");
    call=caller.call;
    if(opts.verify){if(typeof caller.readOriginal!=="function")throw new Error("CALLER_MUST_EXPORT_COMPLETE_ORIGINAL_READER");readOriginal=caller.readOriginal;}
  }else if(opts["--bridge"]){
    if(opts["--bridge"]!=="stdio")throw new Error("UNKNOWN_BRIDGE");
    bridge=stdioBridge();call=bridge.call;if(opts.verify)readOriginal=bridge.readOriginal;
  }
  const api=createNativeSourceTransfer({codec,call,journal,readOriginal});
  let result;
  if(command==="preview"){
    const plan=api.prepare(await sourceSpec(opts));
    result={state:"request_preview",operation_id:plan.operation_id,key:plan.key,manifest:plan.manifest,preview:api.preview(plan,{maxRequestBytes})};
  }else if(command==="inspect-request"){
    result={state:"request_inspection",preview:api.inspectDraftArguments(await jsonFile(opts["--spec"]),{maxRequestBytes})};
  }else if(command==="prepare"){
    if(!journal)throw new Error("PRIVATE_JOURNAL_REQUIRED");
    const spec=await sourceSpec(opts);
    const record=await api.start(api.prepare(spec));
    result={state:record.phase,record};
  }else if(command==="receive"){
    result=await api.receiveExisting(await jsonFile(opts["--spec"]));
  }else{
    if(!journal||!opts["--key"])throw new Error("PRIVATE_JOURNAL_AND_KEY_REQUIRED");
    const key=opts["--key"],index=Number(opts["--index"]);
    if(command==="advance")result=await api.advance(key);
    else if(command==="inspect-lock")result=await journal.inspectLock(key);
    else if(command==="recover-lock")result=await journal.recoverLock(key,{expected_sha256:opts["--expect-lock-sha256"],confirm_quiescent:opts.quiescent});
    else if(command==="inspect"){const s=await journal.load(key);if(!s)throw new Error("UNKNOWN_OPERATION");result={state:s.phase,record:s};}
    else if(command==="reconcile-draft")result=await api.reconcileDraft(key,{draft_id:opts["--draft"],message_id:opts["--message"]});
    else if(["refresh-original","to-notion","reconcile-notion-upload","download-notion","to-drive","reconcile-drive-upload","verify-drive"].includes(command)){
      if(!Number.isSafeInteger(index)||index<0)throw new Error("FILE_INDEX_REQUIRED");
      if(command==="to-drive")result=await api.toDrive(key,index,await jsonFile(opts["--spec"]));
      if(command==="reconcile-drive-upload")result=await api.reconcileDriveUpload(key,index,opts["--file-id"]);
      if(command==="verify-drive")result=await api.verifyDrive(key,index);
      if(command==="refresh-original")result={state:"original_reference_refreshed",record:await api.refreshOriginal(key,index)};
      if(command==="to-notion")result=await api.toNotion(key,index,await jsonFile(opts["--spec"]));
      if(command==="reconcile-notion-upload")result=await api.reconcileNotionUpload(key,index,opts["--upload"]);
      if(command==="download-notion")result=(await api.downloadNotion(key,index)).raw;
    }else throw new Error(HELP);
  }
  process.stdout.write(JSON.stringify({kind:"result",value:summary(result)})+"\n");
}catch(error){
  process.stdout.write(JSON.stringify({kind:"error",code:error.code||"SOURCE_TRANSFER_ERROR",message:error.message,detail:error.detail||null})+"\n");
  process.exitCode=1;
}finally{bridge?.close();}
