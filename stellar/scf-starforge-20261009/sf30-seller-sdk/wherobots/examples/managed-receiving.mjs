#!/usr/bin/env node
// MIT. Continue the original populated Wherobots workspace through managed browser receiving.
import {open,mkdir,realpath,lstat,readFile,rename,unlink} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {setTimeout as delay} from "node:timers/promises";
import {prepareWherobotsApplication,startWherobotsApplication} from "../application-launcher.mjs";

const sha=value=>createHash("sha256").update(value).digest("hex");
const plain=value=>!!value&&typeof value==="object"&&!Array.isArray(value);
const stable=value=>JSON.stringify(value&&typeof value==="object"
  ?Array.isArray(value)?value.map(item=>JSON.parse(stable(item)))
  :Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(stable(value[key]))])):value);
function need(value,message){if(!value)throw new Error(message);}
async function atomic(filename,bytes){
  const temporary=filename+".writing-"+randomUUID();let file;
  try{
    file=await open(temporary,"wx",0o600);await file.writeFile(bytes);await file.sync();await file.close();file=null;
    await rename(temporary,filename);
  }finally{await file?.close();await unlink(temporary).catch(error=>{if(error.code!=="ENOENT")throw error;});}
}
async function fileIdentity(filename){
  const file=await open(filename,"r");
  try{
    const digest=createHash("sha256"),buffer=Buffer.alloc(1024*1024);let bytes=0;
    for(;;){const item=await file.read(buffer,0,buffer.length,bytes);if(!item.bytesRead)break;
      digest.update(buffer.subarray(0,item.bytesRead));bytes+=item.bytesRead;}
    return {path:filename,bytes,sha256:digest.digest("hex")};
  }finally{await file.close();}
}
export async function receiveManagedWherobots({
  connection,workspace,workflowId,outputDirectory,python,environment=process.env,signal,
}={}){
  need(typeof outputDirectory==="string"&&path.isAbsolute(outputDirectory)&&
    typeof workflowId==="string"&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$/.test(workflowId),
    "Select the original workflow ID and absolute private receiving directory.");
  outputDirectory=path.resolve(outputDirectory);
  await mkdir(outputDirectory,{recursive:true,mode:0o700});
  const info=await lstat(outputDirectory);
  need(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(outputDirectory)===outputDirectory&&
    (process.platform==="win32"||!(info.mode&0o077)),"Select a canonical private receiving directory.");
  const save=(name,value)=>atomic(path.join(outputDirectory,name),Buffer.from(JSON.stringify(value,null,2)+"\n"));
  const selection=await prepareWherobotsApplication({connection,workspace,python});
  const selectionPath=path.join(outputDirectory,"selection.json");
  const receivingSelection={schema:"stellar-forge.wherobots-managed-receiving-selection.v1",
    workflow_id:workflowId,selection};
  try{
    const retained=JSON.parse(await readFile(selectionPath,"utf8"));
    need(stable(retained)===stable(receivingSelection),
      "This receiving directory belongs to another original source, workspace or workflow selection.");
  }catch(error){if(error.code!=="ENOENT")throw error;await save("selection.json",receivingSelection);}
  const report={schema:"stellar-forge.wherobots-managed-receiving.v1",state:"RUNNING",
    startedAt:new Date().toISOString(),workspace,workspace_id:selection.binding.workspaceId,workflow_id:workflowId,
    sourceSha256:selection.source.sha256,bindingSha256:selection.binding.bindingSha256,phases:[],datasets:[],files:[]};
  try{
    const previous=await readFile(path.join(outputDirectory,"receiving.json"));
    await mkdir(path.join(outputDirectory,"attempts"),{mode:0o700,recursive:true});
    await atomic(path.join(outputDirectory,"attempts",sha(previous)+".json"),previous);
  }catch(error){if(error.code!=="ENOENT")throw error;}
  async function phase(name,value){
    report.phases.push({name,at:new Date().toISOString(),value});
    await save("receiving.json",report);process.stdout.write(JSON.stringify({phase:name,value})+"\n");
  }
  let app,rowFile,rowPath;
  async function request(route,{body}={}){
    signal?.throwIfAborted();
    const address=new URL(app.url);
    const response=await fetch(new URL(route,address),{
      method:body===undefined?"GET":"POST",redirect:"error",
      headers:{authorization:"Bearer "+address.hash.slice("#token=".length),connection:"close",
        ...(body===undefined?{}:{"content-type":"application/json"})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
      signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000),
    });
    need(response.ok,"Original browser returned HTTP "+response.status+" for "+route);
    return response;
  }
  async function json(route,options){
    const value=await (await request(route,options)).json();
    need(plain(value),"The original browser returned an incomplete JSON object.");return value;
  }
  const snapshot=state=>state.editions.filter(item=>item.workflow_id===workflowId)
    .map(({id,revision_sha256})=>({id,revision_sha256})).sort((a,b)=>a.id.localeCompare(b.id));
  try{
    app=await startWherobotsApplication({connection,workspace,python,environment,selection,signal});
    const first=app.startup;
    const state=await json("/api/state"),workflow=await json("/api/workflows/"+encodeURIComponent(workflowId));
    need(state.workspace_id===selection.binding.workspaceId&&workflow.id===workflowId,
      "The browser must open the selected original workspace and workflow.");
    const editions=snapshot(state);need(editions.length>0,"Select a populated original workflow with output editions.");
    await save("workflow.json",workflow);
    await phase("opened original managed workspace",{pid:first.pid,workerPid:first.workerPid,
      instanceId:first.instanceId,workspace_id:state.workspace_id,workflow_id:workflowId,editions,runtime:first.runtime});
    rowPath=path.join(outputDirectory,"rows.jsonl.writing-"+randomUUID());
    rowFile=await open(rowPath,"wx",0o600);
    const rowDigest=createHash("sha256");let rowBytes=0,totalRows=0;
    for(const selectedEdition of editions){
      const edition=await json("/api/editions/"+encodeURIComponent(selectedEdition.id));
      need(edition.revision_sha256===selectedEdition.revision_sha256,"The original edition changed while selected.");
      for(const dataset of edition.datasets){
        const datasetId=dataset.dataset_id??dataset.id;let offset=0,count=0,pages=0;
        for(;;){
          const route="/api/editions/"+encodeURIComponent(edition.id)+"/rows?"+
            new URLSearchParams({dataset:datasetId,offset:String(offset),limit:"100"}).toString();
          const result=await json(route);
          need(result.edition_id===edition.id&&result.dataset_id===datasetId&&
            result.source_binding_sha256===edition.source_binding_sha256&&result.offset===offset&&
            result.total===dataset.row_count&&Array.isArray(result.rows),
            "The original row page changed its edition, dataset or source binding.");
          for(const row of result.rows){
            const bytes=Buffer.from(JSON.stringify({edition_id:edition.id,dataset_id:datasetId,row})+"\n");
            await rowFile.writeFile(bytes);rowDigest.update(bytes);rowBytes+=bytes.length;
          }
          count+=result.rows.length;pages++;
          if(result.next_offset===null)break;
          need(Number.isSafeInteger(result.next_offset)&&result.next_offset===offset+result.rows.length&&
            result.next_offset>offset,"The original row cursor did not advance.");
          offset=result.next_offset;
        }
        need(count===dataset.row_count,"Receive every row from the original dataset.");
        totalRows+=count;
        report.datasets.push({edition_id:edition.id,dataset_id:datasetId,rows:count,pages,
          source_binding_sha256:edition.source_binding_sha256,columns:dataset.columns,
          preview_encoding:dataset.preview_encoding,geometry:dataset.geometry});
      }
    }
    await rowFile.sync();await rowFile.close();rowFile=null;
    const rowsFile=path.join(outputDirectory,"rows.jsonl");await rename(rowPath,rowsFile);rowPath=null;
    report.files.push({path:rowsFile,bytes:rowBytes,sha256:rowDigest.digest("hex")});
    await phase("received every original edition and typed row",{editions:editions.length,datasets:report.datasets.length,rows:totalRows});
    const originalRequestId=sha(stable({workspace_id:state.workspace_id,workflow_id:workflowId,
      workflow_revision:workflow.revision_sha256,editions,purpose:"managed-browser-handover"})).slice(0,48);
    let requestId=originalRequestId,task;
    const interruptedRequests=new Set();
    for(;;){
      task=await json("/api/export",{body:{workflow_id:workflowId,request_id:requestId}});
      need(task.id===requestId&&task.action==="export"&&task.arguments?.workflow_id===workflowId,
        "The retained original export task changed its request or workflow identity.");
      if(task.state!=="INTERRUPTED")break;
      need(!interruptedRequests.has(requestId)&&/^[a-f0-9]{64}$/.test(task.revision_sha256??""),
        "The original interrupted export must retain its stable task revision.");
      interruptedRequests.add(requestId);
      const successor=sha(stable({original_request_id:originalRequestId,
        interrupted_request_id:requestId,interrupted_revision:task.revision_sha256,
        purpose:"resume-original-managed-browser-handover"})).slice(0,48);
      await phase("resumed interrupted original export",{original_request_id:originalRequestId,
        interrupted_request_id:requestId,interrupted_revision:task.revision_sha256,
        request_id:successor});
      requestId=successor;
    }
    while(["QUEUED","RUNNING"].includes(task.state)){
      await delay(250,undefined,{signal});
      task=await json("/api/tasks/"+encodeURIComponent(requestId));
    }
    need(task.state==="COMPLETE"&&task.action==="export"&&task.result?.receipt?.workflow_id===workflowId&&
      task.result.receipt.source_workspace_id===state.workspace_id,"The original complete handover did not finish.");
    const receipt=task.result.receipt,exportFile=path.join(outputDirectory,"complete-handover.zip");
    const temporary=exportFile+".writing-"+randomUUID();let file;
    try{
      const response=await request("/api/exports/"+encodeURIComponent(task.id));
      file=await open(temporary,"wx",0o600);const digest=createHash("sha256");let received=0;
      for await(const chunk of response.body){
        await file.writeFile(chunk);digest.update(chunk);received+=chunk.length;
        need(received<=receipt.bytes,"The complete download exceeded its original size.");
      }
      need(received===receipt.bytes&&digest.digest("hex")===receipt.sha256,
        "The complete handover bytes differ from the original export.");
      await file.sync();await file.close();file=null;await rename(temporary,exportFile);
    }finally{await file?.close();await unlink(temporary).catch(error=>{if(error.code!=="ENOENT")throw error;});}
    need(stable(receipt.editions.slice().sort())===stable(editions.map(item=>item.id).sort()),
      "The complete handover must contain every selected original edition.");
    report.files.push(await fileIdentity(exportFile));await save("handover.json",task);
    const finalState=await json("/api/state"),finalWorkflow=await json("/api/workflows/"+encodeURIComponent(workflowId));
    need(stable(snapshot(finalState))===stable(editions)&&finalWorkflow.revision_sha256===workflow.revision_sha256,
      "The original workflow changed during receiving; retain this attempt and select its current complete edition.");
    await phase("received complete original handover",{request_id:requestId,package_id:receipt.package_id,
      editions:receipt.editions,files:receipt.files,objects:receipt.objects,bytes:receipt.bytes,sha256:receipt.sha256});
    await app.close();app=null;
    await phase("closed original managed browser",{instanceId:first.instanceId,workerPid:first.workerPid});
    app=await startWherobotsApplication({connection,workspace,python,environment,selection,signal});
    const reopened=await json("/api/state"),reopenedWorkflow=await json("/api/workflows/"+encodeURIComponent(workflowId));
    need(app.startup.instanceId!==first.instanceId&&reopened.workspace_id===state.workspace_id&&
      stable(snapshot(reopened))===stable(editions)&&reopenedWorkflow.revision_sha256===workflow.revision_sha256,
      "Reopen the same original workspace, workflow and complete edition identities.");
    for(const selectedEdition of editions){
      const edition=await json("/api/editions/"+encodeURIComponent(selectedEdition.id));
      need(edition.revision_sha256===selectedEdition.revision_sha256,"An original edition changed after reopening.");
      for(const dataset of edition.datasets){
        const datasetId=dataset.dataset_id??dataset.id;
        const before=report.datasets.find(item=>item.edition_id===edition.id&&item.dataset_id===datasetId);
        need(before&&before.rows===dataset.row_count&&before.source_binding_sha256===edition.source_binding_sha256,
          "The original dataset binding changed after reopening.");
      }
    }
    await phase("reopened same complete workspace",{instanceId:app.startup.instanceId,workerPid:app.startup.workerPid,
      workspace_id:reopened.workspace_id,editions});
    await app.close();app=null;report.state="COMPLETE";report.completedAt=new Date().toISOString();
    await save("receiving.json",report);return report;
  }catch(error){
    report.state="INTERRUPTED";report.error={code:error.code??error.name,message:error.message};
    await save("receiving.json",report);throw error;
  }finally{
    await rowFile?.close();if(rowPath)await unlink(rowPath).catch(error=>{if(error.code!=="ENOENT")throw error;});
    await app?.close();
  }
}
async function main(argv){
  const names=new Map([["--connection","connection"],["--workspace","workspace"],["--workflow-id","workflowId"],
    ["--out","outputDirectory"],["--python","python"]]),options={};
  for(let i=0;i<argv.length;i+=2){
    const key=names.get(argv[i]),value=argv[i+1];
    need(key&&value&&!value.startsWith("--")&&!Object.hasOwn(options,key),"Use each named option once with its value.");
    options[key]=value;
  }
  for(const key of ["connection","workspace","workflowId","outputDirectory"])need(options[key],"Missing "+key+".");
  const controller=new AbortController(),stop=()=>controller.abort();
  process.on("SIGINT",stop);process.on("SIGTERM",stop);
  try{
    const result=await receiveManagedWherobots({...options,signal:controller.signal});
    process.stdout.write(JSON.stringify({state:result.state,datasets:result.datasets.length,
      files:result.files,workspace_id:result.workspace_id})+"\n");
  }finally{process.off("SIGINT",stop);process.off("SIGTERM",stop);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch(error=>{process.stderr.write(JSON.stringify({error:error.code??error.name,message:error.message})+"\n");process.exitCode=1;});
