#!/usr/bin/env node
// MIT. Continue one actual source workspace through the generic merchant receiver.
import {mkdir,readFile,writeFile,open,link,unlink,realpath,access} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {initializeWherobotsMerchant} from "../merchant-setup.mjs";
import {createWherobotsMerchantClient,inspectReceivedWherobotsExport,
  importReceivedWherobotsWorkflow} from "../merchant-client.mjs";
import {openMerchantOperator} from "../../../../../../stellar-forge/mcp-merchant-operator/operator.mjs";
import {loadDatasetConfig} from "../../../dataset-handler.mjs";
import {readDatasetSourceFiles} from "../../../../sf82-seller-pilot/release-dataset.mjs";

const here=path.dirname(fileURLToPath(import.meta.url));
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const stable=value=>JSON.stringify(value&&typeof value==="object"?
  Array.isArray(value)?value.map(item=>JSON.parse(stable(item))):
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(stable(value[key]))])):value);
const exists=filename=>access(filename).then(()=>true,error=>{if(error.code==="ENOENT")return false;throw error;});
const flags={};
for(let index=2;index<process.argv.length;index+=2){
  const name=process.argv[index],value=process.argv[index+1];
  if(!["--connection","--workspace","--workflow-id","--edition-id","--out","--python"].includes(name)||
     !value||Object.hasOwn(flags,name))throw new Error("Use distinct --connection/--workspace/--workflow-id/--edition-id/--out/--python selections.");
  flags[name]=value;
}
for(const name of ["--connection","--workspace","--workflow-id","--edition-id","--out"])if(!flags[name])throw new Error("Missing "+name);
const connection=await realpath(path.resolve(flags["--connection"])),output=path.resolve(flags["--out"]);
await mkdir(output,{recursive:true,mode:0o700});
if(await realpath(output)!==output)throw new Error("Use the original canonical private operation directory.");
async function save(filename,value,{replace=false}={}){
  const temporary=filename+".writing-"+randomUUID(),bytes=Buffer.from(JSON.stringify(value,null,2)+"\n");let handle;
  try{
    handle=await open(temporary,"wx",0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
    if(replace){await (await import("node:fs/promises")).rename(temporary,filename);}
    else{
      try{await link(temporary,filename);}catch(error){
        if(error.code!=="EEXIST"||stable(JSON.parse(await readFile(filename)))!==stable(value))throw error;
      }
    }
  }finally{await handle?.close();await unlink(temporary).catch(error=>{if(error.code!=="ENOENT")throw error;});}
}
const source=JSON.parse(await readFile(connection)),entry=source.workspaces?.[flags["--workspace"]];
if(source.schema!=="stellar-forge.wherobots-workspace-connection.v1"||!entry?.workspaceId)
  throw new Error("Select the original host-declared Wherobots workspace.");
const selected={schema:"stellar-forge.wherobots-merchant-receiving-operation.v1",
  driver_sha256:sha(await readFile(fileURLToPath(import.meta.url))),
  connection_sha256:sha(await readFile(connection)),workspace:flags["--workspace"],workspace_id:entry.workspaceId,
  workflow_id:flags["--workflow-id"],edition_id:flags["--edition-id"]};
const selectionSha=sha(stable(selected));
await save(path.join(output,"selection.json"),selected);
const host=path.join(output,"merchant"),configuration=path.join(host,"merchant-mcp.json");
if(!await exists(configuration))await initializeWherobotsMerchant({directory:host,connection,name:"Original Wherobots receiving"});
let merchant=await openMerchantOperator(configuration),client=createWherobotsMerchantClient({
  merchant,workspace:selected.workspace,workspaceId:selected.workspace_id
});
const operationFile=path.join(output,"operation.json"),steps=[],datasetPackages=[];
const originalMerchantTools=merchant.tools.filter(tool=>tool.name.startsWith("merchant_wherobots_")).map(tool=>tool.name).sort();
if(originalMerchantTools.length!==27)throw new Error("The selected original host must expose its complete 27-tool Wherobots provider.");
async function call(name,args){const result=await client.call(name,args);steps.push({tool:"merchant_wherobots_"+name});return result;}
async function inFreshReceiverProcess(args){
  const child=spawn(process.execPath,[path.join(here,"../merchant-client.mjs"),...args],{
    env:process.env,shell:false,stdio:["ignore","pipe","pipe"],windowsHide:true
  });
  let stdout=[],bytes=0,overflow=false,launchError;
  const progress=[];
  child.stdout.on("data",chunk=>{bytes+=chunk.length;if(bytes>64*1024*1024){overflow=true;child.kill("SIGTERM");}else stdout.push(chunk);});
  child.stderr.on("data",chunk=>{if(progress.reduce((size,value)=>size+value.length,0)<1024*1024)progress.push(chunk.toString("utf8"));});
  child.on("error",error=>{launchError=error;});
  return new Promise((resolve,reject)=>child.on("close",(code,signal)=>{
    if(launchError)return reject(launchError);
    if(code!==0||overflow)return reject(Object.assign(new Error("The original fresh receiving process ended before completion."),
      {code:"WHEROBOTS_RECEIVING_PROCESS",details:{exitCode:code,signal,progress:progress.join("")}}));
    try{resolve({result:JSON.parse(Buffer.concat(stdout).toString("utf8")),process:{pid:child.pid,exit_code:code}});}
    catch(error){reject(error);}
  }));
}
try{
  const status=await call("status",{}),runtime=await call("runtime",{});
  const workflow=await call("get",{kind:"workflow",id:selected.workflow_id});
  const edition=await call("get",{kind:"edition",id:selected.edition_id});
  if(edition.workflow_id!==workflow.id)throw new Error("The selected edition belongs to another original workflow.");
  const exportId="receiver-workflow-"+sha(selectionSha+workflow.revision_sha256).slice(0,24);
  const manifest=await call("export",{workflow_id:workflow.id,expected_revision:workflow.revision_sha256,export_id:exportId});
  const downloaded=path.join(output,"workflow-export"),pausedFile=path.join(output,"paused.json");
  let paused=await exists(pausedFile)?JSON.parse(await readFile(pausedFile)):null;
  if(!paused){
    const controller=new AbortController();let committed;
    try{
      await client.receiveExport({exportId,directory:downloaded,expectedManifestSha256:manifest.manifest_sha256,
        chunkBytes:4096,signal:controller.signal,onProgress:value=>{
          if(value.phase==="CHUNK"){committed=value;controller.abort();}
        }});
    }catch(error){if(error.code!=="WHEROBOTS_RECEIVE_INTERRUPTED")throw error;}
    if(!committed)throw new Error("The complete original export did not produce a retained receiving range.");
    paused={selection_sha256:selectionSha,manifest_sha256:manifest.manifest_sha256,committed};
    await save(pausedFile,paused);
  }
  if(paused.selection_sha256!==selectionSha||paused.manifest_sha256!==manifest.manifest_sha256)
    throw new Error("The saved interruption belongs to another original export.");
  await merchant.close();merchant=null;
  const restarted=await inFreshReceiverProcess(["receive","--config",configuration,"--workspace",selected.workspace,
    "--workspace-id",selected.workspace_id,"--export-id",exportId,"--directory",downloaded,
    "--manifest-sha256",manifest.manifest_sha256,"--chunk-bytes","196608"]);
  const received=await inspectReceivedWherobotsExport(downloaded,{exportId,workspaceId:selected.workspace_id,
    expectedManifestSha256:manifest.manifest_sha256});
  merchant=await openMerchantOperator(configuration);client=createWherobotsMerchantClient({
    merchant,workspace:selected.workspace,workspaceId:selected.workspace_id
  });
  const repeatedManifest=await call("export",{workflow_id:workflow.id,expected_revision:workflow.revision_sha256,export_id:exportId});
  if(stable(repeatedManifest)!==stable(manifest))throw new Error("The same original export ID changed after merchant restart.");
  for(const dataset of edition.datasets){
    const datasetExportId="receiver-dataset-"+sha(selectionSha+edition.revision_sha256+dataset.id).slice(0,24);
    const exported=await call("export_dataset",{edition_id:edition.id,dataset_id:dataset.id,
      expected_revision:edition.revision_sha256,export_id:datasetExportId});
    const retained=await client.receiveExport({exportId:datasetExportId,
      directory:path.join(output,"datasets",sha(dataset.id)),expectedManifestSha256:exported.manifest_sha256,chunkBytes:196608});
    const loaded=await loadDatasetConfig(path.join(retained.datasetDirectory,"dataset.json"));
    const description=loaded.describe();
    const source=JSON.parse(await readFile(path.join(retained.datasetDirectory,"source.json")));
    const originals=await readDatasetSourceFiles(retained.datasetDirectory,source);
    if(description.rowCount!==dataset.row_count||source.edition_id!==edition.id||source.dataset_id!==dataset.id||
       source.source_binding_sha256!==edition.source_binding_sha256||!originals.length||
       originals.length!==source.sourceFiles.length||stable(source.sourceFiles)!==stable(source.original_objects))
      throw new Error("The complete original SF30/SF82 dataset receiving binding differs.");
    datasetPackages.push({dataset_id:dataset.id,edition_id:edition.id,row_count:description.rowCount,
      snapshot:description.snapshot,source_files:originals.length,
      manifest_sha256:retained.manifest_sha256,directory:retained.directory,files:retained.files.length,
      bytes:retained.bytes,source_binding_sha256:source.source_binding_sha256});
  }
  const receivingEnv={...process.env,PYTHONDONTWRITEBYTECODE:"1"};
  if(entry.pythonPath?.length)receivingEnv.PYTHONPATH=[
    ...entry.pythonPath.map(directory=>path.resolve(path.dirname(connection),directory)),
    ...(process.env.PYTHONPATH?[process.env.PYTHONPATH]:[])
  ].join(path.delimiter);
  const receivingOptions={directory:downloaded,workspace:path.join(output,"independent-customer"),env:receivingEnv,
    python:flags["--python"]??entry.python,create:true,title:"Independent Wherobots merchant customer"};
  const imported=await importReceivedWherobotsWorkflow(receivingOptions);
  const repeated=await importReceivedWherobotsWorkflow({...receivingOptions,workspaceId:imported.workspace_id,create:false});
  if(imported.package_id!==repeated.package_id||imported.workspace_id!==repeated.workspace_id||
     imported.workflow.revision_sha256!==repeated.workflow.revision_sha256)
    throw new Error("Repeated original receiving changed the customer or workflow identity.");
  const editableSource=imported.receiving.source_directory;
  await access(path.join(editableSource,"index.d.mts"));
  const installed=await import(pathToFileURL(path.join(editableSource,"index.mjs")).href);
  const customer=installed.createWherobotsWorkspace({directory:imported.directory,workspaceId:imported.workspace_id,
    python:receivingOptions.python,env:receivingEnv});
  const pages=[];
  try{
    if(customer.tools().length!==21||typeof installed.createWherobotsMerchantClient!=="function")
      throw new Error("The independently received source does not expose the complete typed workspace/consumer SDK.");
    for(const originalEdition of imported.editions){
      const sourceEdition=await call("get",{kind:"edition",id:originalEdition.id});
      if(stable(sourceEdition)!==stable(originalEdition))throw new Error("The archive changed an original edition record.");
      for(const dataset of originalEdition.datasets){
        let offset=0,count=0;
        do{
          const selection={edition_id:originalEdition.id,dataset_id:dataset.id,offset,limit:1000};
          const sourceRows=await call("rows",selection),receivedRows=await customer.rows(selection);
          if(stable(sourceRows)!==stable(receivedRows))throw new Error("The received row page changed an exact original value.");
          count+=receivedRows.rows.length;offset=receivedRows.next_offset;
        }while(offset!==null);
        if(count!==dataset.row_count)throw new Error("The receiving page chain omitted original rows.");
        pages.push({edition_id:originalEdition.id,dataset_id:dataset.id,rows:count,
          source_binding_sha256:originalEdition.source_binding_sha256});
      }
    }
  }finally{await customer.close();}
  const result={schema:selected.schema,state:"COMPLETE",selection_sha256:selectionSha,selection:selected,
    runtime,status,tools:originalMerchantTools,workflow_revision:workflow.revision_sha256,
    edition_id:edition.id,source_binding_sha256:edition.source_binding_sha256,
    workflow_export:{directory:received.directory,manifest_sha256:received.manifest_sha256,bytes:received.bytes,
      export_id:received.export_id,archive_sha256:received.files[0].sha256},
    interruption:paused.committed,restarted_process:restarted.process,
    dataset_packages:datasetPackages,independent_receiving:{workspace_id:imported.workspace_id,
      directory:imported.directory,source_directory:editableSource,package_id:imported.package_id,
      workflow_id:imported.workflow.id,edition_ids:imported.editions.map(item=>item.id),
      repeated_import:repeated.receiving},complete_rows:pages,steps};
  await save(operationFile,result,{replace:true});
  process.stdout.write(JSON.stringify({state:result.state,operation:operationFile,
    export_id:received.export_id,manifest_sha256:received.manifest_sha256,source_workspace_id:selected.workspace_id,
    customer_workspace_id:imported.workspace_id,datasets:datasetPackages.length,received_editions:imported.editions.length,
    rows:pages.reduce((total,page)=>total+page.rows,0),restarted_process:restarted.process})+"\n");
}finally{await merchant?.close();}
