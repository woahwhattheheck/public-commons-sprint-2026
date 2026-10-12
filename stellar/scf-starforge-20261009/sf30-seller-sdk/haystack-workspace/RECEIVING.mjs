#!/usr/bin/env node
// MIT. One complete native operator journey over the untouched public Charlie building export.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { startServer } from "./server.mjs";
import { HaystackWorkspace } from "./store.mjs";
import { HaystackClient } from "./client.mjs";
import { APPLICATION_FILES, verifyBundle, receiveBundle } from "./portable.mjs";
import { parseGrid, encodeGrid } from "./haystack-types.mjs";
import { analyzeGrids } from "./haystack-index.mjs";
import { tools as nativeTools } from "./catalog.mjs";
import { MerchantHaystackWorkspaces, readHaystackWorkspaceConfiguration } from "./merchant.mjs";
import { stringifyJson, canonicalJson } from "./json-codec.mjs";
import { atomicWrite, createOnlyFile, plainRead, exists } from "./files.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PROGRAMME = "commons.haystack.complete-receiving.v1";
const SOURCE_URL = "https://project-haystack.org/example/download/charlie.json";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const bytesFor = value => Buffer.from(stringifyJson(value, 2) + "\n");
const same = (left, right, message) => assert.equal(canonicalJson(left), canonicalJson(right), message);
const withoutReplay = value => { const result = structuredClone(value); delete result.replayed; return result; };
const timestamp = () => new Date().toISOString();

async function readJson(path) { return JSON.parse(await fs.readFile(path, "utf8")); }
async function saveJson(path, value) { await atomicWrite(path, bytesFor(value)); }
async function completeFile(path, bytes) {
  bytes = Buffer.from(bytes); await fs.mkdir(dirname(path), {recursive:true, mode:0o700});
  await createOnlyFile(path, bytes);
  return {path, bytes:bytes.length, sha256:sha256(bytes)};
}
async function completeJson(path, value) { return completeFile(path, bytesFor(value)); }
async function runCli(args, {applicationRoot=ROOT, input="", maximum=16*1024*1024}={}) {
  return new Promise((resolveDone, reject) => {
    const child = spawn(process.execPath, [join(applicationRoot,"cli.mjs"), ...args], {stdio:["pipe","pipe","pipe"]});
    const stdout=[], stderr=[]; let size=0, overflow=false;
    child.stdout.on("data", bytes => { size+=bytes.length; if(size>maximum){overflow=true;child.kill("SIGTERM");} else stdout.push(bytes); });
    child.stderr.on("data", bytes => { size+=bytes.length; if(size>maximum){overflow=true;child.kill("SIGTERM");} else stderr.push(bytes); });
    child.once("error",reject);
    child.once("close",(code,signal) => {
      const result={args,code,signal,stdout:Buffer.concat(stdout).toString("utf8"),stderr:Buffer.concat(stderr).toString("utf8")};
      if(overflow)return reject(Object.assign(new Error("The complete native CLI output exceeded its declared capacity."),{result}));
      if(code!==0)return reject(Object.assign(new Error("The native CLI operation failed."),{result}));
      resolveDone(result);
    });
    child.stdin.end(input);
  });
}

const STOPPED_WRITER_CHILD = "// MIT. The original native receiving child stops after retaining its complete writer and legacy request.\nimport assert from \"node:assert/strict\";\nimport { promises as fs } from \"node:fs\";\nimport { join, resolve } from \"node:path\";\nimport { pathToFileURL } from \"node:url\";\nimport { createHash } from \"node:crypto\";\nimport { hostname } from \"node:os\";\nconst [applicationRoot, requestPath] = process.argv.slice(2);\nconst {HaystackWorkspace} = await import(pathToFileURL(join(applicationRoot,\"store.mjs\")).href);\nconst {createOnlyFile,plainRead} = await import(pathToFileURL(join(applicationRoot,\"files.mjs\")).href);\nconst {canonicalJson,stringifyJson} = await import(pathToFileURL(join(applicationRoot,\"json-codec.mjs\")).href);\nconst requestBytes=await plainRead(requestPath,65536),request=JSON.parse(requestBytes);\nassert.equal(request.format,\"commons.haystack.receiving-writer-request.v1\");\nassert.equal(resolve(request.directory),request.directory);\nlet gate=\"\";for await(const part of process.stdin){gate+=part.toString(\"utf8\");assert(gate.length<=128);}\nassert.equal(gate,request.childRequestId+\"\\n\",\"The original parent retains this child's identity before it enters the writer.\");\nconst workspace=new HaystackWorkspace(request.directory),state=await workspace.read();\nassert.equal(state.workspaceId,request.workspaceId);assert.equal(state.sha256,request.stateSha256);\nconst hash=bytes=>createHash(\"sha256\").update(bytes).digest(\"hex\");\nawait workspace.withWriter(async()=>{\n  const lockBytes=await plainRead(workspace.lockPath,16384),writer=JSON.parse(lockBytes);\n  assert.equal(writer.pid,process.pid);assert.equal(writer.host,hostname());\n  const retainedAt=new Date().toISOString();\n  // This is the exact supported legacy journal shape, retained before unlink.\n  const legacy={writer,recoveredAt:retainedAt,recoveredBy:process.pid};\n  const legacyBytes=Buffer.from(canonicalJson(legacy)+\"\\n\");\n  const legacyPath=join(workspace.directory,\"writer-recovery-\"+writer.id+\".json\");\n  await createOnlyFile(legacyPath,legacyBytes);\n  await createOnlyFile(request.lockCopyPath,lockBytes);\n  await createOnlyFile(request.legacyCopyPath,legacyBytes);\n  const outcome={format:\"commons.haystack.receiving-stopped-writer.v1\",childRequestId:request.childRequestId,\n    programmeOperationId:request.programmeOperationId,workspaceId:state.workspaceId,\n    requestSha256:hash(requestBytes),writer,lockSha256:hash(lockBytes),\n    legacyPath,legacySha256:hash(legacyBytes),stateSha256:state.sha256,retainedAt,\n    stoppedBeforeUnlink:true};\n  await createOnlyFile(request.outcomePath,Buffer.from(stringifyJson(outcome,2)+\"\\n\"));\n  process.exit(73);\n});\nthrow new Error(\"The original stopped-writer child unexpectedly released its writer.\");\n";

function receivingProcessPresent(pid) {
  assert(Number.isSafeInteger(pid)&&pid>0,"Retain the actual original native process identity.");
  try{process.kill(pid,0);return true;}
  catch(error){if(error.code==="ESRCH")return false;if(error.code==="EPERM")return true;throw error;}
}
function receivingActive(message,details) {
  return Object.assign(new Error(message),{code:"HAYSTACK_RECEIVING_NATIVE_ACTIVE",status:423,details});
}
async function stoppedWriterRecovery({root,workspace,journal,journalPath,outputs}) {
  const phaseDirectory=join(root,"writer-recovery"),requestPath=join(phaseDirectory,"request.json");
  await fs.mkdir(phaseDirectory,{recursive:true,mode:0o700});
  assert(!(await fs.lstat(phaseDirectory)).isSymbolicLink());
  const resultPath=join(phaseDirectory,"result.json");
  if(await exists(resultPath)){
    const completed=await readJson(resultPath);
    assert.equal(completed.programmeOperationId,journal.operationId);assert.equal(completed.workspaceId,journal.workspaceId);
    return completed;
  }
  let request;
  if(await exists(requestPath)){
    request=await readJson(requestPath);
    assert.equal(request.format,"commons.haystack.receiving-writer-request.v1");
    assert.equal(request.programmeOperationId,journal.operationId);assert.equal(request.workspaceId,journal.workspaceId);
    assert.equal(request.directory,workspace.directory);
  }else{
    const state=await workspace.read();
    assert.equal(state.workspaceId,journal.workspaceId);
    request={format:"commons.haystack.receiving-writer-request.v1",programmeOperationId:journal.operationId,
      childRequestId:randomUUID(),workspaceId:journal.workspaceId,directory:workspace.directory,createdAt:timestamp(),
      stateSha256:state.sha256,revision:state.revision,
      outcomePath:join(phaseDirectory,"stopped-writer.json"),lockCopyPath:join(phaseDirectory,"original-writer.lock"),
      legacyCopyPath:join(phaseDirectory,"original-legacy-recovery.json")};
    await completeJson(requestPath,request);
  }
  for(const [field,name] of [["outcomePath","stopped-writer.json"],["lockCopyPath","original-writer.lock"],["legacyCopyPath","original-legacy-recovery.json"]])
    assert.equal(request[field],join(phaseDirectory,name));
  const requestSha256=sha256(await plainRead(requestPath,65536));
  if(journal.writerRecovery){
    assert.equal(journal.writerRecovery.childRequestId,request.childRequestId);
    assert.equal(journal.writerRecovery.requestSha256,requestSha256);
  }else{
    journal.writerRecovery={childRequestId:request.childRequestId,requestPath,requestSha256};
    await saveJson(journalPath,journal);
  }
  const childPath=join(phaseDirectory,"stopped-writer-child.mjs");
  await completeFile(childPath,Buffer.from(STOPPED_WRITER_CHILD));
  const startedPath=join(phaseDirectory,"child-started.json"),exitPath=join(phaseDirectory,"child-exit.json");
  if(!(await exists(request.outcomePath))){
    if(await exists(startedPath)){
      const original=await readJson(startedPath);
      assert.equal(original.childRequestId,request.childRequestId);assert.equal(original.host,hostname());
      if(receivingProcessPresent(original.pid))throw receivingActive("The original stopped-writer child is still present.",original);
      throw Object.assign(new Error("The original child stopped before its complete writer handoff. Read its retained stdout, stderr and workspace writer before continuing."),
        {code:"HAYSTACK_RECEIVING_CHILD_INCOMPLETE",details:original});
    }
    assert.equal(await workspace.writer(),null,"Start the actual child while this original workspace has no writer.");
    const stdoutPath=join(phaseDirectory,"child.stdout.log"),stderrPath=join(phaseDirectory,"child.stderr.log");
    const stdout=await fs.open(stdoutPath,"a",0o600),stderr=await fs.open(stderrPath,"a",0o600);
    let child,gateSent=false;
    try{
      child=spawn(process.execPath,[childPath,ROOT,requestPath],{stdio:["pipe",stdout.fd,stderr.fd]});
      let spawnError=null;
      const ended=new Promise(resolveDone=>{
        child.once("error",error=>{spawnError={message:error.message,code:error.code??null};});
        child.once("close",(code,signal)=>resolveDone({code,signal,spawnError,endedAt:timestamp()}));
      });
      child.stdin?.on("error",()=>{});
      if(!Number.isSafeInteger(child.pid)||child.pid<1){
        const failed=await ended;throw Object.assign(new Error("The original writer child did not start."),{result:failed});
      }
      const started={format:"commons.haystack.receiving-writer-child.v1",childRequestId:request.childRequestId,
        programmeOperationId:journal.operationId,workspaceId:journal.workspaceId,pid:child.pid,host:hostname(),
        executable:process.execPath,args:[childPath,ROOT,requestPath],startedAt:timestamp(),stdoutPath,stderrPath};
      await completeJson(startedPath,started);
      child.stdin.end(request.childRequestId+"\n");gateSent=true;
      const endedResult=await ended;
      await completeJson(exitPath,{...endedResult,childRequestId:request.childRequestId,pid:child.pid});
      assert.equal(endedResult.spawnError,null);assert.equal(endedResult.signal,null);assert.equal(endedResult.code,73);
    }finally{
      if(child?.stdin&&!gateSent)child.stdin.end();
      await stdout.close();await stderr.close();
    }
  }
  const started=await readJson(startedPath),outcome=await readJson(request.outcomePath);
  assert.equal(started.childRequestId,request.childRequestId);assert.equal(started.host,hostname());
  assert.equal(outcome.childRequestId,request.childRequestId);assert.equal(outcome.requestSha256,requestSha256);
  assert.equal(outcome.programmeOperationId,journal.operationId);assert.equal(outcome.workspaceId,journal.workspaceId);
  assert.equal(outcome.writer.pid,started.pid);assert.equal(outcome.writer.host,hostname());
  assert.equal(outcome.stoppedBeforeUnlink,true);assert.equal(outcome.stateSha256,request.stateSha256);
  if(receivingProcessPresent(started.pid))throw receivingActive("Continue this same recovery after the original child has stopped.",started);
  if(!(await exists(exitPath)))await completeJson(exitPath,{childRequestId:request.childRequestId,pid:started.pid,
    code:null,signal:null,observedStoppedAt:timestamp(),observation:"Original PID absent after its complete retained writer handoff."});
  const originalLock=await plainRead(request.lockCopyPath,16384),legacyBytes=await plainRead(request.legacyCopyPath,65536);
  assert.equal(sha256(originalLock),outcome.lockSha256);same(JSON.parse(originalLock),outcome.writer);
  assert.equal(sha256(legacyBytes),outcome.legacySha256);
  const legacy=JSON.parse(legacyBytes);
  assert.equal(legacy.format,undefined);assert.equal(legacy.recoveredBy,started.pid);
  assert.equal(typeof legacy.recoveredAt,"string");same(legacy.writer,outcome.writer);
  assert.equal(outcome.legacyPath,join(workspace.directory,"writer-recovery-"+outcome.writer.id+".json"));
  assert((await plainRead(outcome.legacyPath,65536)).equals(legacyBytes),"Resume the same retained legacy before-unlink journal.");
  const before=await workspace.read();assert.equal(before.sha256,request.stateSha256);assert.equal(before.revision,request.revision);
  const completedPath=join(workspace.directory,"writer-recovery-"+outcome.writer.id+".completed.json");
  if(!(await exists(completedPath))){
    const selected=await workspace.writer();
    if(selected){same(selected,outcome.writer);assert.equal(sha256(await plainRead(workspace.lockPath,16384)),outcome.lockSha256);}
  }
  const recovered=await workspace.recoverWriter(outcome.writer.id);
  assert.equal(recovered.recovered,outcome.writer.id);assert(["removed","already-absent"].includes(recovered.originalLockState));
  same(recovered.writer,outcome.writer);
  const recoveredFile=await completeJson(join(phaseDirectory,"original-recovery-result.json"),withoutReplay(recovered));
  const completedRecovery=await readJson(completedPath);
  assert.equal(completedRecovery.journalSha256,outcome.legacySha256);
  same(completedRecovery.result,withoutReplay(recovered));

  const attemptsDirectory=join(phaseDirectory,"newer-writers");
  await fs.mkdir(attemptsDirectory,{recursive:true,mode:0o700});
  const attempts=[];
  for(const name of (await fs.readdir(attemptsDirectory)).filter(name=>/^[0-9a-f-]+\.started\.json$/.test(name)).sort()){
    const path=join(attemptsDirectory,name),retained=await readJson(path);
    assert.equal(retained.childRequestId,request.childRequestId);assert.equal(retained.programmeOperationId,journal.operationId);
    assert.equal(retained.workspaceId,journal.workspaceId);assert.equal(retained.writer.host,hostname());
    assert.equal(name,retained.writer.id+".started.json");
    attempts.push(retained);
  }
  let proof=null;
  for(const attempt of attempts){
    const proofPath=join(attemptsDirectory,attempt.writer.id+".verified.json");
    if(await exists(proofPath)){const saved=await readJson(proofPath);same(saved.started,attempt);proof??=saved;}
  }
  const retainedWriter=await workspace.writer();
  if(retainedWriter){
    const owned=attempts.find(attempt=>attempt.writer.id===retainedWriter.id);
    assert(owned,"Retain any different original writer while continuing this exact native recovery phase.");
    same(owned.writer,retainedWriter);
    if(receivingProcessPresent(retainedWriter.pid))throw receivingActive("The original newer-writer replay is still running.",retainedWriter);
    const cleanup=await workspace.recoverWriter(retainedWriter.id);
    await completeJson(join(attemptsDirectory,retainedWriter.id+".continued.json"),withoutReplay(cleanup));
  }
  if(!proof){
    await workspace.withWriter(async()=>{
      const writer=await workspace.writer();
      assert.equal(writer.pid,process.pid);assert.notEqual(writer.id,outcome.writer.id);
      const rawBefore=await plainRead(workspace.lockPath,16384),statBefore=await fs.lstat(workspace.lockPath,{bigint:true});
      const started={childRequestId:request.childRequestId,programmeOperationId:journal.operationId,workspaceId:journal.workspaceId,
        writer,startedAt:timestamp(),lockSha256:sha256(rawBefore),device:statBefore.dev.toString(),inode:statBefore.ino.toString()};
      await completeJson(join(attemptsDirectory,writer.id+".started.json"),started);
      const replayed=await workspace.recoverWriter(outcome.writer.id);
      assert.equal(replayed.replayed,true);same(withoutReplay(replayed),withoutReplay(recovered));
      const rawAfter=await plainRead(workspace.lockPath,16384),statAfter=await fs.lstat(workspace.lockPath,{bigint:true});
      assert(rawAfter.equals(rawBefore),"Replaying the original recovery retains every byte of the newer live writer.");
      assert.equal(statAfter.dev,statBefore.dev);assert.equal(statAfter.ino,statBefore.ino);
      same(await workspace.writer(),writer);
      proof={started,replayed,verifiedAt:timestamp(),newerWriterRetained:true,
        after:{lockSha256:sha256(rawAfter),device:statAfter.dev.toString(),inode:statAfter.ino.toString()}};
      await completeJson(join(attemptsDirectory,writer.id+".verified.json"),proof);
    });
  }
  assert.equal(proof.newerWriterRetained,true);assert.equal(proof.replayed.replayed,true);
  same(withoutReplay(proof.replayed),withoutReplay(recovered));
  assert.equal(proof.after.lockSha256,proof.started.lockSha256);
  assert.equal(proof.after.device,proof.started.device);assert.equal(proof.after.inode,proof.started.inode);
  assert.equal(await workspace.writer(),null,"The normal newer withWriter releases its own writer after the replay.");
  const after=await workspace.read();same(after,before,"Stopped-writer recovery and replay preserve the complete original workspace.");
  const files=[];
  for(const name of ["request.json","stopped-writer-child.mjs","child-started.json","child-exit.json","child.stdout.log","child.stderr.log",
    "stopped-writer.json","original-writer.lock","original-legacy-recovery.json","original-recovery-result.json"]){
    const path=join(phaseDirectory,name),bytes=await plainRead(path,16*1024*1024);files.push({path,bytes:bytes.length,sha256:sha256(bytes)});
  }
  const result={programmeOperationId:journal.operationId,workspaceId:journal.workspaceId,
    childRequestId:request.childRequestId,requestSha256,originalWriter:outcome.writer,
    childExit:await readJson(exitPath),legacy:{path:outcome.legacyPath,sha256:outcome.legacySha256},
    recovered:withoutReplay(recovered),recoveredFile,replayedUnderNewerWriter:proof,
    stateSha256:after.sha256,revision:after.revision,files,completedAt:proof.verifiedAt};
  const report=await completeJson(join(outputs,"stopped-writer-recovery.json"),result);
  return completeJson(resultPath,{...result,report}).then(()=>({...result,report}));
}

export async function main(directory) {
  assert.equal(typeof directory,"string","Supply one explicit original operation directory.");
  const root=resolve(directory), journalPath=join(root,"receiving-programme.json");
  await fs.mkdir(root,{recursive:true,mode:0o700});
  assert(!(await fs.lstat(root)).isSymbolicLink(),"Use the actual owned operation directory.");
  const sourceBytes=await plainRead(join(ROOT,"fixture-charlie.json"),32*1024*1024);
  const sourceSha256=sha256(sourceBytes), parsed=parseGrid(sourceBytes,{format:"json-v4"});
  assert.equal(parsed.grid._kind,"grid"); assert(parsed.grid.rows.length>0);
  const sourceAnalysis=analyzeGrids([{sourceId:sourceSha256,grid:parsed.grid}]);
  assert(sourceAnalysis.records.some(record=>record.roles.includes("site")),"The original building grid needs its sites.");
  assert(sourceAnalysis.records.some(record=>record.roles.includes("equip")),"The original building grid needs its equipment.");
  assert(sourceAnalysis.records.some(record=>record.roles.includes("point")),"The original building grid needs its points.");
  let journal;
  if(await exists(journalPath)){
    journal=await readJson(journalPath);
    assert.equal(journal.format,PROGRAMME);assert.equal(journal.directory,root);
    assert.equal(journal.source.sha256,sourceSha256,"Continue with the original complete upstream source bytes.");
  }else{
    assert(!(await exists(join(root,"workspace"))),"This destination already has work without this original programme.");
    journal={format:PROGRAMME,operationId:randomUUID(),directory:root,startedAt:timestamp(),
      source:{name:"charlie.json",url:SOURCE_URL,sha256:sourceSha256,bytes:sourceBytes.length,rows:parsed.grid.rows.length,columns:parsed.grid.cols.length},
      workspaceId:null,requests:{},stages:{},invocations:[]};
    await saveJson(journalPath,journal);
  }
  const application=[];
  for(const name of APPLICATION_FILES){const bytes=await plainRead(join(ROOT,name),8*1024*1024);application.push({name,bytes:bytes.length,sha256:sha256(bytes)});}
  const invocation={id:randomUUID(),startedAt:timestamp(),node:process.version,platform:process.platform,application};
  journal.invocations.push(invocation); await saveJson(journalPath,journal);
  const outputs=join(root,"outputs");await fs.mkdir(outputs,{recursive:true,mode:0o700});
  await completeFile(join(root,"original-charlie.json"),sourceBytes);
  await completeJson(join(root,"original-source-metadata.json"),journal.source);
  const workspaceDirectory=join(root,"workspace"),workspace=new HaystackWorkspace(workspaceDirectory);
  let server=null, client=null, merchant=null, recipient=null;
  const status=()=>client.request("workspace.status",{});
  const connect=async()=>{
    server=await startServer({directory:workspaceDirectory,host:"127.0.0.1",port:0,expectedWorkspaceId:journal.workspaceId});
    client=new HaystackClient({url:server.url,workspaceId:journal.workspaceId});
    return client.connect();
  };
  async function stage(name, operation){
    if(journal.stages[name])return structuredClone(journal.stages[name].result);
    const result=await operation();
    journal.stages[name]={completedAt:timestamp(),result};await saveJson(journalPath,journal);
    process.stdout.write(stringifyJson({stage:name,completedAt:journal.stages[name].completedAt,operationId:journal.operationId})+"\n");
    return result;
  }
  async function mutation(name,action,fields,{send=null,expectedRevision}={}){
    let original=journal.requests[name];
    if(original){
      assert.equal(original.action,action);
      const retained=structuredClone(original.args);delete retained.operationId;delete retained.expectedRevision;
      same(retained,fields,"Keep the original complete mutation fields for "+name);
    }else{
      original={format:"commons.haystack.operator.request.v1",workspaceId:journal.workspaceId,action,
        args:{...structuredClone(fields),expectedRevision:expectedRevision??(await status()).revision,operationId:randomUUID()},createdAt:timestamp()};
      journal.requests[name]=original;await saveJson(journalPath,journal);
    }
    await completeJson(join(root,"requests",name+".request.json"),original);
    let result;
    try{result=await client.request("operation.read",{operationId:original.args.operationId});}
    catch(error){if(error.status!==404)throw error;result=send?await send(original.args):await client.request(action,original.args);}
    assert.equal(result.operationId,original.args.operationId);assert.equal(result.workspaceId,journal.workspaceId);
    return result;
  }
  async function pages(action,args={}){
    const revision=(await status()).revision;
    let offset=0,total=null;const items=[],pageSizes=[];
    for(;;){
      const page=await client.request(action,{...args,expectedRevision:revision,offset,limit:137});
      assert.equal(page.workspaceId,journal.workspaceId);assert.equal(page.revision,revision);assert.equal(page.offset,offset);
      if(total!==null)assert.equal(page.total,total);
      total=page.total;items.push(...page.items);pageSizes.push(page.items.length);
      if(!page.hasMore){assert.equal(items.length,total);return {workspaceId:journal.workspaceId,revision,total,pageSizes,items,
        ...(page.counts?{counts:page.counts}:{}),...(page.sourcePairs?{sourcePairs:page.sourcePairs}:{})};}
      assert(page.nextOffset>offset&&page.nextOffset<=total);offset=page.nextOffset;
    }
  }
  async function delivery(name,fields){
    return stage(name,async()=>{
      const result=await mutation(name,"delivery.prepare",fields);
      const bytes=Buffer.from(await client.deliveryBytes(result.operationId));
      assert.equal(bytes.length,result.bytes);assert.equal(sha256(bytes),result.sha256);
      const file=await completeFile(join(outputs,name+"."+ (fields.kind==="workspace"||fields.kind==="native-grid"?"json":fields.format||"json")),bytes);
      const recovered=await client.request("operation.read",{operationId:result.operationId});
      same(withoutReplay(result),withoutReplay(recovered));assert.equal(recovered.replayed,true);
      return {receipt:withoutReplay(result),file};
    });
  }
  try{
    // Resume this same retained stopped writer before initialize() tries to acquire a new writer.
    if(journal.writerRecovery&&!journal.stages["stopped-writer-recovery"])
      await stage("stopped-writer-recovery",()=>stoppedWriterRecovery({root,workspace,journal,journalPath,outputs}));
    const initial=await workspace.initialize("Charlie building turnover");
    if(journal.workspaceId)assert.equal(initial.workspaceId,journal.workspaceId);
    else {journal.workspaceId=initial.workspaceId;await saveJson(journalPath,journal);}
    const connected=await connect();
    const imported=await stage("original-source-intake",()=>mutation("original-source-intake","source.import",{
      name:"charlie.json",sourceUrl:SOURCE_URL,format:"json-v4",select:true,base64:sourceBytes.toString("base64")}));
    assert.equal(imported.source.id,sourceSha256);
    const baseline=await stage("original-edition",()=>mutation("original-edition","edition.save",{
      title:"Charlie — original upstream export",note:"Complete original upstream building grid, before operator review."}));
    const originalRegister=await stage("complete-original-register",async()=>{
      const register=await pages("records.list",{editionId:baseline.edition.id});
      assert.equal(register.total,parsed.grid.rows.length);
      same(register.items.map(row=>row.tags),parsed.grid.rows);
      const findings=await pages("diagnostics.list",{editionId:baseline.edition.id});
      const file=await completeJson(join(outputs,"original-register.json"),register);
      const diagnosticsFile=await completeJson(join(outputs,"original-diagnostics.json"),findings);
      const hierarchy=sourceAnalysis.relations;
      assert(hierarchy.every(link=>link.targetKeys.every(key=>key.startsWith(link.sourceId+":"))));
      const hierarchyFile=await completeJson(join(outputs,"original-source-local-hierarchy.json"),hierarchy);
      return {file,diagnosticsFile,hierarchyFile,rows:register.total,pages:register.pageSizes,counts:sourceAnalysis.counts,
        pointKey:register.items.find(row=>row.roles.includes("point")).key,
        equipmentKey:register.items.find(row=>row.roles.includes("equip")).key};
    });
    const pointIndex=Number(originalRegister.pointKey.split(":")[1]);
    const equipmentIndex=Number(originalRegister.equipmentKey.split(":")[1]);
    const point=parsed.grid.rows[pointIndex],equipment=parsed.grid.rows[equipmentIndex];
    const edits=[
      {recordKey:originalRegister.pointKey,tag:"dis",action:"set",value:String(point.dis??point.id?.dis??"Point")+" — reviewed"},
      {recordKey:originalRegister.pointKey,tag:"turnoverZero",action:"set",value:-0},
      {recordKey:originalRegister.equipmentKey,tag:"turnoverReviewed",action:"set",value:{_kind:"marker"}},
      {recordKey:originalRegister.equipmentKey,tag:"turnoverReference",action:"set",value:structuredClone(point.id)}
    ];
    assert(point.id?._kind==="ref","The actual selected upstream point needs its original native reference.");
    await stage("complete-typed-preview",async()=>{
      const preview=await client.request("proposal.preview",{expectedRevision:(await status()).revision,edits});
      assert.equal(preview.changes.length,edits.length);assert(Object.is(preview.changes.find(row=>row.tag==="turnoverZero").after.value,-0));
      const file=await completeJson(join(outputs,"typed-review-preview.json"),preview);return {file,changes:preview.changes.length,counts:preview.counts};
    });
    const proposal=await stage("prepared-turnover-review",()=>mutation("prepared-turnover-review","proposal.prepare",{
      title:"Review selected point and equipment turnover tags",note:"Native operator exercise over original Charlie rows; review markers are local working changes.",edits}));
    const alternative=await stage("prepared-alternative-review",()=>mutation("prepared-alternative-review","proposal.prepare",{
      title:"Alternative equipment display review",note:"Retain this original proposal while another review changes the working material.",
      edits:[{recordKey:originalRegister.equipmentKey,tag:"dis",action:"set",value:String(equipment.dis??equipment.id?.dis??"Equipment")+" — alternate review"}]}));
    await stage("accepted-turnover-review",()=>mutation("accepted-turnover-review","proposal.review",{
      proposalId:proposal.proposal.id,decision:"accept",note:"Accepted the complete typed tag changes after reading the source-linked preview."}));
    await stage("stale-alternative-preserved",async()=>{
      const result=await client.request("proposal.read",{expectedRevision:(await status()).revision,proposalId:alternative.proposal.id});
      assert.equal(result.proposal.stale,true);assert.equal(result.preview,null);
      return {proposalId:result.proposal.id,state:result.proposal.state,stale:result.proposal.stale};
    });
    await stage("rejected-alternative-review",()=>mutation("rejected-alternative-review","proposal.review",{
      proposalId:alternative.proposal.id,decision:"reject",note:"Keep the selected accepted review; the original alternate proposal remains in history."}));
    const reviewed=await stage("reviewed-edition",()=>mutation("reviewed-edition","edition.save",{
      title:"Charlie — reviewed turnover edition",note:"Complete selected original source and accepted typed tag proposal."}));
    await stage("complete-edition-comparison",async()=>{
      const comparison=await pages("edition.compare",{beforeEditionId:baseline.edition.id,afterEditionId:reviewed.edition.id});
      assert.equal(comparison.counts.changed,2);assert.equal(comparison.counts.added,0);assert.equal(comparison.counts.removed,0);
      const change=comparison.items.flatMap(item=>item.changes).find(item=>item.tag==="turnoverZero");
      assert(Object.is(change.after.value,-0));assert.equal(change.before.present,false);
      return {file:await completeJson(join(outputs,"original-to-reviewed-comparison.json"),comparison),counts:comparison.counts};
    });
    await stage("complete-native-protocol",async()=>{
      const headers={"Content-Type":"application/json","X-Haystack-Workspace":journal.workspaceId,"X-Haystack-Instance":server.identity.instanceId};
      const responses=[];
      for(const request of [
        {jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"original-haystack-receiving",version:"1"}}},
        {jsonrpc:"2.0",id:2,method:"tools/list"},
        {jsonrpc:"2.0",id:3,method:"tools/call",params:{name:nativeTools.find(tool=>tool.action==="workspace.status").name,arguments:{}}}
      ]){
        const response=await fetch(server.url+"/mcp",{method:"POST",headers,body:stringifyJson(request)});
        assert.equal(response.status,200);responses.push(await response.json());
      }
      assert.equal(responses[1].result.tools.length,nativeTools.length);
      assert.equal(responses[2].result.structuredContent.workspaceId,journal.workspaceId);
      const stdioInput=stringifyJson({jsonrpc:"2.0",id:4,method:"tools/call",params:{name:nativeTools.find(tool=>tool.action==="workspace.status").name,arguments:{}}})+"\n";
      const stdio=await runCli(["rpc","--directory",workspaceDirectory],{input:stdioInput});
      const stdioResult=JSON.parse(stdio.stdout.trim());assert.equal(stdioResult.result.structuredContent.workspaceId,journal.workspaceId);
      const assets=[];
      for(const path of ["/","/app.js","/style.css","/client.mjs","/json-codec.mjs","/OPERATING.md","/fixture-charlie.json","/fixtures.json"]){
        const response=await fetch(server.url+path),bytes=Buffer.from(await response.arrayBuffer());assert.equal(response.status,200);
        if(path==="/fixture-charlie.json")assert.equal(sha256(bytes),sourceSha256);
        assets.push({path,bytes:bytes.length,sha256:sha256(bytes),contentType:response.headers.get("content-type")});
      }
      return {file:await completeJson(join(outputs,"native-http-mcp-stdio-assets.json"),{responses,stdio,assets}),tools:nativeTools.length,assets:assets.length};
    });

    await stage("stopped-writer-recovery",()=>stoppedWriterRecovery({root,workspace,journal,journalPath,outputs}));

    const hostPath=join(root,"merchant-host-connection.json");
    const hostConfig={schema:"stellar-forge.haystack-workspace-host.v1",workspaces:{turnover:{
      label:"Original Charlie turnover",workspaceId:journal.workspaceId,connectionFile:join(workspaceDirectory,"connection.json"),
      inputs:{charlie:{label:"Untouched upstream Charlie grid",path:join(root,"original-charlie.json"),kind:"source",
        name:"charlie.json",mediaType:"application/json",sha256:sourceSha256,sourceReference:SOURCE_URL}}
    }}};
    await completeJson(hostPath,hostConfig);
    merchant=new MerchantHaystackWorkspaces({haystackWorkspaces:await readHaystackWorkspaceConfiguration(hostPath)});
    const hostTool=action=>"merchant_"+nativeTools.find(tool=>tool.action===action).name;
    await stage("managed-source-alias-and-import",async()=>{
      const inputs=await merchant.call("merchant_haystack_workspaces",{});
      assert.equal(inputs.workspaces[0].workspaceId,journal.workspaceId);
      const input=await merchant.call("merchant_haystack_input",{workspace:"turnover",input:"charlie",expectedSha256:sourceSha256});
      assert.equal(input.bytes,sourceBytes.length);
      const result=await mutation("managed-original-import","source.import",{
        name:"charlie.json",sourceUrl:SOURCE_URL,format:"json-v4",select:true,base64:sourceBytes.toString("base64")
      },{send:args=>merchant.call("merchant_haystack_import_file",{workspace:"turnover",input:"charlie",
        expectedSha256:sourceSha256,operationId:args.operationId,expectedRevision:args.expectedRevision,select:true,sourceUrl:SOURCE_URL})});
      assert.equal(result.source.id,sourceSha256);assert.equal(result.alreadyRetained,true);
      const current=await merchant.call(hostTool("workspace.status"),{workspace:"turnover"});
      assert.equal(current.sourceCount,1);
      const rows=[];let offset=0;
      for(;;){
        const page=await merchant.call(hostTool("records.list"),{workspace:"turnover",expectedRevision:current.revision,editionId:reviewed.edition.id,offset,limit:137});
        rows.push(...page.items);if(!page.hasMore){assert.equal(rows.length,page.total);break;}assert(page.nextOffset>offset);offset=page.nextOffset;
      }
      assert.equal(rows.length,parsed.grid.rows.length);
      return {file:await completeJson(join(outputs,"managed-complete-source-register.json"),{inputs,input,imported:result,rows}),rows:rows.length,sourceId:sourceSha256};
    });
    await stage("same-workspace-server-restart",async()=>{
      const priorIdentity=structuredClone(server.identity),originalClient=client;
      await merchant.call("merchant_haystack_connection",{workspace:"turnover"});
      await server.close();server=null;
      await connect();assert.notEqual(server.identity.instanceId,priorIdentity.instanceId);assert.equal(server.identity.workspaceId,priorIdentity.workspaceId);
      const selected=await merchant.call("merchant_haystack_connection",{workspace:"turnover"});
      const reconnected=await merchant.call("merchant_haystack_reconnect",{workspace:"turnover",expectedInstanceId:server.identity.instanceId});
      const current=await merchant.call(hostTool("workspace.status"),{workspace:"turnover"});
      assert.equal(current.workspaceId,journal.workspaceId);
      const original=journal.requests["original-source-intake"];
      const replayed=await merchant.call(hostTool("source.import"),{workspace:"turnover",...original.args});
      assert.equal(replayed.replayed,true);same(withoutReplay(replayed),withoutReplay(imported));
      return {before:priorIdentity,after:server.identity,selected,reconnected,replayed:withoutReplay(replayed),revision:current.revision};
    });
    await stage("original-mutation-recovery-after-review",async()=>{
      const original=journal.requests["prepared-turnover-review"],replayed=await client.request(original.action,original.args);
      assert.equal(replayed.replayed,true);same(withoutReplay(replayed),withoutReplay(proposal));
      assert.equal((await status()).workspaceId,journal.workspaceId);
      const originalAgain=Buffer.from(await client.sourceBytes(sourceSha256));
      assert(originalAgain.equals(sourceBytes),"Original source bytes survive accepted typed edits.");
      const cli=await runCli(["replay","--directory",workspaceDirectory,"--request-file",join(root,"requests","prepared-turnover-review.request.json")]);
      const receipt=JSON.parse(cli.stdout);assert.equal(receipt.operationId,original.args.operationId);
      same(withoutReplay(receipt),withoutReplay(proposal));
      return {file:await completeJson(join(outputs,"original-request-recovery.json"),{replayed,cli}),originalSourceSha256:sha256(originalAgain)};
    });
    const native=await delivery("reviewed-native-grid",{kind:"native-grid",format:"json",sourceId:sourceSha256,editionId:reviewed.edition.id});
    await stage("typed-native-export",async()=>{
      const bytes=await fs.readFile(native.file.path),grid=parseGrid(bytes).grid;
      assert(Object.is(grid.rows[pointIndex].turnoverZero,-0));
      assert.equal(grid.rows[equipmentIndex].turnoverReviewed._kind,"marker");
      same(grid.rows[equipmentIndex].turnoverReference,point.id);
      same(parsed.grid.cols,grid.cols.slice(0,parsed.grid.cols.length),"Original column metadata and order survive accepted additions.");
      same(parseGrid(encodeGrid(grid)).grid,grid,"Complete native JSON-v4 encoding remains equivalent.");
      return {sourceFile:native.file,rows:grid.rows.length,columns:grid.cols.length};
    });
    const replacementBytes=await fs.readFile(native.file.path);
    const replacement=await stage("replacement-export-intake",()=>mutation("replacement-export-intake","source.import",{
      name:"charlie-reviewed-export.json",sourceUrl:"workspace:"+journal.workspaceId+"/editions/"+reviewed.edition.id,
      format:"json-v4",select:false,base64:replacementBytes.toString("base64")}));
    await stage("explicit-replacement-selection",()=>mutation("explicit-replacement-selection","source.select",{sourceIds:[replacement.source.id]}));
    const replacementEdition=await stage("replacement-export-edition",()=>mutation("replacement-export-edition","edition.save",{
      title:"Charlie — received native export",note:"Explicit replacement source selection from the complete reviewed native grid."}));
    await stage("explicit-source-pair-comparison",async()=>{
      const sourcePairs=[{beforeSourceId:sourceSha256,afterSourceId:replacement.source.id}];
      const comparison=await pages("edition.compare",{beforeEditionId:reviewed.edition.id,afterEditionId:replacementEdition.edition.id,sourcePairs});
      const uniqueIds=new Map();
      for(const row of parsed.grid.rows)if(row.id?._kind==="ref")uniqueIds.set(row.id.val,(uniqueIds.get(row.id.val)||0)+1);
      const uniquelyAligned=[...uniqueIds.values()].filter(count=>count===1).length;
      assert.equal(comparison.counts.changed,0);assert.equal(comparison.counts.same,uniquelyAligned);
      same(comparison.sourcePairs,sourcePairs);
      return {file:await completeJson(join(outputs,"explicit-source-pair-comparison.json"),comparison),counts:comparison.counts,sourcePairs};
    });
    await stage("return-to-reviewed-original-source",()=>mutation("return-to-reviewed-original-source","source.select",{sourceIds:[sourceSha256]}));
    for(const kind of ["register","diagnostics"])for(const format of ["json","csv","html"])
      await delivery("reviewed-"+kind+"-"+format,{kind,format,editionId:reviewed.edition.id});
    await stage("complete-report-content",async()=>{
      const register=await readJson(journal.stages["reviewed-register-json"].result.file.path);
      const diagnostics=await readJson(journal.stages["reviewed-diagnostics-json"].result.file.path);
      assert.equal(register.records.length,parsed.grid.rows.length);assert.equal(register.edition.id,reviewed.edition.id);
      assert(Object.is(register.records.find(row=>row.key===originalRegister.pointKey).tags.turnoverZero,-0));
      const current=await pages("diagnostics.list",{editionId:reviewed.edition.id});
      same(diagnostics.diagnostics,current.items);
      const cli=await runCli(["records","--directory",workspaceDirectory,"--edition",reviewed.edition.id,
        "--out",join(outputs,"cli-complete-reviewed-register.json")]);
      const cliOutput=await readJson(join(outputs,"cli-complete-reviewed-register.json"));
      assert.equal(cliOutput.items.length,register.records.length);assert.equal(cliOutput.complete,true);
      const csv=await fs.readFile(journal.stages["reviewed-register-csv"].result.file.path,"utf8");
      const html=await fs.readFile(journal.stages["reviewed-register-html"].result.file.path,"utf8");
      assert(csv.includes("tags_json"));assert(html.includes("Complete register"));
      for(const row of register.records)assert(html.includes(row.key),"The exported HTML contains every original record identity.");
      return {rows:register.records.length,diagnostics:diagnostics.diagnostics.length,cli};
    });
    const packaged=await delivery("complete-editable-workspace",{kind:"workspace"});
    const packageBytes=await fs.readFile(packaged.file.path);
    await stage("full-application-receiving",async()=>{
      const verified=verifyBundle(packageBytes);
      assert.equal(verified.state.workspaceId,journal.workspaceId);
      assert.equal(verified.application.size,APPLICATION_FILES.length);
      assert.equal(verified.state.sources.length,2);assert.equal(verified.state.editions.length,3);
      assert.equal(verified.state.proposals.length,2);
      const cliVerified=await runCli(["verify","--file",packaged.file.path]);
      assert.equal(JSON.parse(cliVerified.stdout).packageSha256,sha256(packageBytes));
      const receipt=await receiveBundle(packageBytes,join(root,"received"));
      const replayed=await receiveBundle(packageBytes,join(root,"received"));
      assert.equal(replayed.installationId,receipt.installationId);assert.equal(replayed.replayed,true);
      for(const [name,original] of verified.application){
        const installed=await fs.readFile(join(root,"received","application",name));assert(installed.equals(original),name);
      }
      const recipientRoot=join(root,"received","application");
      const {HaystackWorkspace:ReceivedWorkspace}=await import(pathToFileURL(join(recipientRoot,"store.mjs")).href);
      const receivedState=await new ReceivedWorkspace(join(root,"received")).read();
      same(receivedState,verified.state);
      const cliStatus=await runCli(["status","--directory",join(root,"received")],{applicationRoot:recipientRoot});
      assert.equal(JSON.parse(cliStatus.stdout).workspaceId,journal.workspaceId);
      return {receipt,replayed,packageSha256:sha256(packageBytes),applicationFiles:verified.application.size,cliVerified,cliStatus};
    });
    await stage("reopened-recipient-application",async()=>{
      const recipientRoot=join(root,"received","application");
      const {startServer:receivedServer}=await import(pathToFileURL(join(recipientRoot,"server.mjs")).href);
      const {HaystackClient:ReceivedClient}=await import(pathToFileURL(join(recipientRoot,"client.mjs")).href);
      recipient=await receivedServer({directory:join(root,"received"),host:"127.0.0.1",port:0,expectedWorkspaceId:journal.workspaceId});
      const receivingClient=new ReceivedClient({url:recipient.url,workspaceId:journal.workspaceId});
      await receivingClient.connect();
      const current=await receivingClient.request("workspace.status",{});
      assert.equal(current.revision,packaged.receipt.revision);
      const recovered=Buffer.from(await receivingClient.sourceBytes(sourceSha256));assert(recovered.equals(sourceBytes));
      const selected=await receivingClient.request("record.read",{expectedRevision:current.revision,editionId:reviewed.edition.id,recordKey:originalRegister.pointKey});
      assert(Object.is(selected.record.tags.turnoverZero,-0));assert.equal(selected.record.tags.dis,edits[0].value);
      const original=journal.requests["prepared-turnover-review"];
      const replayed=await receivingClient.request(original.action,original.args);
      assert.equal(replayed.replayed,true);same(withoutReplay(replayed),withoutReplay(proposal));
      const originalEdition=await receivingClient.request("record.read",{expectedRevision:current.revision,editionId:baseline.edition.id,recordKey:originalRegister.pointKey});
      same(originalEdition.record.tags,point);
      const result={identity:recipient.identity,workspace:current,sourceSha256:sha256(recovered),selected,
        replayed:withoutReplay(replayed),originalRecord:originalEdition.record};
      await recipient.close();recipient=null;
      return {file:await completeJson(join(outputs,"reopened-recipient-application.json"),result),workspaceId:current.workspaceId,revision:current.revision};
    });
    await stage("complete-saved-operation-history",async()=>{
      const operations=await pages("operations.list"),proposals=await pages("proposals.list"),editions=await pages("editions.list"),sources=await pages("sources.list");
      const current=await status();
      assert.equal(operations.items.length,current.revision);assert.equal(proposals.total,2);assert.equal(editions.total,3);assert.equal(sources.total,2);
      assert.equal(proposals.items.filter(value=>value.state==="accepted").length,1);
      assert.equal(proposals.items.filter(value=>value.state==="rejected").length,1);
      const state=await workspace.read(),recipientState=await new HaystackWorkspace(join(root,"received")).read();
      same(state,recipientState,"The original and delivered full histories remain equal.");
      return {file:await completeJson(join(outputs,"complete-saved-operation-history.json"),{operations,proposals,editions,sources}),
        mutations:operations.total,proposals:proposals.total,editions:editions.total,sources:sources.total};
    });
    invocation.completedAt=timestamp();journal.completedAt=invocation.completedAt;journal.state="COMPLETED";
    await saveJson(journalPath,journal);
    const result={format:PROGRAMME,operationId:journal.operationId,workspaceId:journal.workspaceId,directory:root,
      startedAt:journal.startedAt,completedAt:journal.completedAt,source:journal.source,
      application,stages:journal.stages,requests:Object.fromEntries(Object.entries(journal.requests).map(([name,value])=>[name,{
        action:value.action,operationId:value.args.operationId,expectedRevision:value.args.expectedRevision,argumentsSha256:sha256(Buffer.from(canonicalJson(value.args)))}])),
      outputDirectory:outputs,package:packaged,received:join(root,"received"),programmeJournal:journalPath};
    await saveJson(join(root,"complete-result.json"),result);
    process.stdout.write(stringifyJson({completed:true,operationId:journal.operationId,workspaceId:journal.workspaceId,
      stages:Object.keys(journal.stages).length,sourceRows:parsed.grid.rows.length,
      result:join(root,"complete-result.json"),package:packaged.file})+"\n");
    return result;
  }catch(error){
    invocation.failedAt=timestamp();invocation.error={message:error.message,code:error.code??null,
      details:error.details??null,...(error.result?{nativeCommand:error.result}:{})};
    journal.state="CONTINUING";await saveJson(journalPath,journal).catch(()=>{});
    throw error;
  }finally{
    if(merchant)await merchant.close().catch(()=>{});
    if(recipient)await recipient.close().catch(()=>{});
    if(server)await server.close().catch(()=>{});
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3){process.stderr.write("Use node RECEIVING.mjs /absolute/original-operation-directory\n");process.exitCode=2;}
  else main(process.argv[2]).catch(error=>{process.stderr.write(stringifyJson({error:error.message,code:error.code??null,
    details:error.details??null,...(error.result?{nativeCommand:error.result}:{})})+"\n");process.exitCode=1;});
}
