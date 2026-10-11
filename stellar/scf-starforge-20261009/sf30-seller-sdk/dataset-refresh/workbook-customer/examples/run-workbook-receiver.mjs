// MIT. Invoke inside the same host process namespace as the original merchant.
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const id = value => hash(value).slice(0,32);
const check = (value,code) => { if (!value) throw Object.assign(new Error(code),{code}); };
const namePattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const json = value => Buffer.from(JSON.stringify(value,null,2)+'\n');

function nativeAnalysisProcess(ready) {
  const spec=ready.analysis;
  const child=spawn(ready.pythonExecutable??'python3',
    ['-m','stellar_forge_buyer.analysis_workspace','--database',spec.database,
     '--checkout',ready.sourceRoot,'--node',ready.nodeExecutable??process.execPath,'serve','--port','0'],
    {env:{...process.env,PYTHONPATH:ready.pythonPath},stdio:['ignore','pipe','pipe']});
  let out='',err='';
  child.stderr.on('data',value=>{err=(err+value.toString()).slice(-65536);});
  const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
  const listening=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Object.assign(new Error('WORKBOOK_ANALYSIS_START_TIMEOUT'),
      {code:'WORKBOOK_ANALYSIS_START_TIMEOUT'})),30000);
    const fail=code=>{clearTimeout(timer);reject(Object.assign(new Error(code),{code}));};
    child.once('error',()=>fail('WORKBOOK_ANALYSIS_PROCESS_UNAVAILABLE'));
    child.once('close',()=>fail('WORKBOOK_ANALYSIS_PROCESS_EXITED'));
    child.stdout.on('data',value=>{
      out+=value.toString();
      if(out.length>65536)return fail('WORKBOOK_ANALYSIS_START_OUTPUT_LIMIT');
      for(const line of out.split('\n')) {
        try {
          const value=JSON.parse(line);
          if(value.status==='LISTENING') {
            clearTimeout(timer);resolve({pid:child.pid,address:value.address,privateLaunch:value.private_launch});
          }
        } catch {}
      }
    });
  });
  return {listening,async stop(){
    if(child.exitCode===null&&!child.killed)child.kill('SIGINT');
    return closed;
  },stderr:()=>err};
}

const receivePython=String.raw`
import json,sys
from pathlib import Path
from stellar_forge_buyer.analysis_export_delivery import receive_export
from stellar_forge_buyer.query_export import QueryExport

def cell(value):
    if value is None:return {"type":"null","value":None}
    if isinstance(value,bool):return {"type":"boolean","value":value}
    if isinstance(value,int):return {"type":"integer","value":str(value)}
    if isinstance(value,float):return {"type":"real","value":repr(value)}
    if isinstance(value,bytes):return {"type":"bytes","value":value.hex()}
    return {"type":"text","value":str(value)}

job,out,launch,copy=sys.argv[1:]
received=receive_export(job_id=job,destination=out,launch_file=launch)
native=received.export
offline=receive_export(job_id=job,destination=out)
if offline.network_requests!=0:raise RuntimeError("WORKBOOK_OFFLINE_EXPORT_REQUIRED")
if Path(copy).exists():
    reopened=QueryExport(copy)
    reopened.inspect()
    if (Path(copy)/'manifest.json').read_bytes() != (native.directory/'manifest.json').read_bytes():
        raise RuntimeError('WORKBOOK_QUERY_EXPORT_COPY_CHANGED')
else:
    reopened=native.copy_to(copy)
manifest=reopened.inspect()
count=0
sample=[]
for row in reopened.rows():
    count+=1
    if len(sample)<3:sample.append([cell(value) for value in row])
if count!=manifest["rowCount"]:raise RuntimeError("WORKBOOK_QUERY_EXPORT_ROW_COUNT_CHANGED")
print(json.dumps({"jobId":job,"workspaceId":received.workspace_id,
 "manifestSha256":received.manifest_sha256,"rowCount":manifest["rowCount"],
 "downloadedFiles":received.downloaded_files,"reusedFiles":received.reused_files,
 "networkRequests":received.network_requests,"offlineNetworkRequests":offline.network_requests,
 "directory":str(native.directory),"portableDirectory":str(reopened.directory),
 "typedRowSample":sample,"outputs":manifest["outputs"]}))
`;

async function receiveQueryFiles(ready,jobId) {
  const spec=ready.analysis;
  const child=spawn(ready.pythonExecutable??'python3',['-c',receivePython,jobId,
    spec.exportDirectory,join(spec.database,'analysis-launch.json'),spec.portableExportDirectory],
    {env:{...process.env,PYTHONPATH:ready.pythonPath},stdio:['ignore','pipe','pipe']});
  let out='',err='';
  child.stdout.on('data',data=>{out+=data;if(out.length>1024*1024)child.kill('SIGTERM');});
  child.stderr.on('data',data=>{err=(err+data).slice(-65536);});
  const result=await new Promise((resolve,reject)=>{
    child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));
  });
  if(result.code!==0)throw Object.assign(new Error('WORKBOOK_QUERY_EXPORT_RECEIVER_FAILED'),
    {code:'WORKBOOK_QUERY_EXPORT_RECEIVER_FAILED',nativeExitCode:result.code,diagnostic:err});
  return JSON.parse(out);
}

/** ready paths reference the original merchant's retained review/config and
 * existing runtime. This function owns one original Buyer Dataset acquisition
 * and optionally one original AnalysisWorkspace child for that same dataset.
 */
export async function runWorkbookReceiver(ready,{buyer,signal,progress=()=>{}}={}) {
  check(ready?.schema==='stellar-forge.workbook-customer-ready.v1','WORKBOOK_READY_REQUIRED');
  for(const key of ['customerDirectory','runtimeDirectory','buyerStateDirectory','packetDirectory',
    'reviewFile','configFile','deliveryDirectory','portableDirectory','resultFile'])
    check(typeof ready[key]==='string'&&isAbsolute(ready[key]),'WORKBOOK_READY_ABSOLUTE_PATH_REQUIRED');
  if(ready.analysis) {
    for(const key of ['sourceRoot','pythonPath'])check(isAbsolute(ready[key]??''),'WORKBOOK_ANALYSIS_SOURCE_REQUIRED');
    for(const key of ['database','exportDirectory','portableExportDirectory'])
      check(isAbsolute(ready.analysis[key]??''),'WORKBOOK_ANALYSIS_PATH_REQUIRED');
    for(const key of ['alias','source','view'])
      check(namePattern.test(ready.analysis[key]??''),'WORKBOOK_ANALYSIS_NAME_REQUIRED');
  }
  const product=await import(pathToFileURL(join(ready.customerDirectory,'index.mjs')));
  const {receiveWorkbook}=await import(pathToFileURL(join(ready.customerDirectory,'examples/receive-workbook.mjs')));
  const {retainSame}=await import(pathToFileURL(join(ready.customerDirectory,'packet.mjs')));
  try {
    const retained=JSON.parse(await readFile(ready.resultFile,'utf8'));
    const reopened=await product.WorkbookDelivery.open(ready.portableDirectory);
    check(retained.schema==='stellar-forge.workbook-customer-run.v1'&&
      retained.portable.bundleSha256===reopened.manifest.bundleSha256,
      'WORKBOOK_RETAINED_RUN_CHANGED');
    progress({complete:true,reopened:true,packetSha256:retained.packetSha256,rows:retained.portableRows});
    return retained;
  } catch(error) {if(error.code!=='ENOENT')throw error;}
  if(!buyer) {
    buyer=new product.Buyer({runtimeDirectory:ready.runtimeDirectory,stateDirectory:ready.buyerStateDirectory,
      ...(ready.operatorProfileFile?{operatorProfile:ready.operatorProfileFile}:{})});
    await buyer.ready();
  }
  const acquired=await receiveWorkbook({buyer,packetDirectory:ready.packetDirectory,
    reviewFile:ready.reviewFile,configFile:ready.configFile,datasetId:ready.datasetId,
    ...(ready.sessionDirectory?{sessionDirectory:ready.sessionDirectory}:{}),
    acquisition:ready.acquisition,deliveryDirectory:ready.deliveryDirectory,
    portableDirectory:ready.portableDirectory,signal,progress});
  const offline=await product.WorkbookDelivery.open(ready.portableDirectory);
  let rows=0;
  for await(const row of offline.rows()) {rows++; void row;}
  const reviewed=await acquired.customer.review();
  const result={schema:'stellar-forge.workbook-customer-run.v1',packetSha256:reviewed.packetSha256,
    request:reviewed.request,acquisition:acquired.acquisitionResult.native,
    acquisitionProcess:{exitCode:acquired.acquisitionResult.process.exitCode,
      errorCode:acquired.acquisitionResult.process.errorCode??null},
    delivery:acquired.delivery.native,portable:offline.manifest,
    portableRows:rows,analysis:null};
  let service=null,analysis=null;
  try {
    if(ready.analysis) {
      const spec=ready.analysis;
      if(spec.start!==false) {
        service=nativeAnalysisProcess(ready);
        result.analysisService=await service.listening;
      }
      analysis=new product.WorkbookAnalysis({customer:acquired.customer,
        room:ready.deliveryDirectory,alias:spec.alias});
      await analysis.register(spec.database);
      const imported=await analysis.receive({source:spec.source,view:spec.view,wait:true,
        expectedSourceRevision:spec.expectedSourceRevision??0,
        expectedViewRevision:spec.expectedViewRevision??0,
        columnsText:spec.columnsText??'{}',signal,progress});
      check(imported.job.result.status==='COMPLETE','WORKBOOK_ANALYSIS_IMPORT_INCOMPLETE');
      const resumed=await analysis.resume(imported.id,{signal});
      check(resumed.job.result.id===imported.id&&resumed.job.result.status==='COMPLETE',
        'WORKBOOK_ANALYSIS_INTAKE_REOPEN_CHANGED');
      const state=await analysis.call('state',{}, {signal});
      const queryId=id(reviewed.packetSha256+':'+spec.alias+':query-full-workbook');
      const exportId=id(reviewed.packetSha256+':'+spec.alias+':export-full-workbook');
      const jobDirectory=join(ready.packetDirectory,'analysis','workbook-native-query');
      await mkdir(jobDirectory,{recursive:true,mode:0o700});
      const requestPath=join(jobDirectory,'query.json');
      let queryRequest;
      try {queryRequest=JSON.parse(await readFile(requestPath,'utf8'));}
      catch(error) {
        if(error.code!=='ENOENT')throw error;
        queryRequest={id:queryId,sql:'SELECT * FROM "'+spec.view+'"',parameters_text:'[]',
          max_rows:1,expected_views:state.result.views};
        await retainSame(requestPath,json(queryRequest));
      }
      check(queryRequest.id===queryId&&queryRequest.sql==='SELECT * FROM "'+spec.view+'"',
        'WORKBOOK_ANALYSIS_QUERY_INTENT_CHANGED');
      async function originalJob(kind,request) {
        let job;
        try {job=await analysis.call('job',{id:request.id},{signal});}
        catch(error) {
          if(error.code!=='ANALYSIS_JOB_NOT_FOUND')throw error;
          job=await analysis.call(kind,request,{signal});
        }
        check(job.result.id===request.id&&job.result.kind===kind,'WORKBOOK_ANALYSIS_JOB_CHANGED');
        if(kind==='query')check(['id','sql','parameters_text','max_rows','expected_views'].every(key=>
          JSON.stringify(job.result.request[key])===JSON.stringify(request[key])),
          'WORKBOOK_ANALYSIS_QUERY_JOB_CHANGED');
        if(job.result.status==='RUNNING')job=await analysis.waitJob(request.id,{signal,progress});
        check(job.result.status==='COMPLETE','WORKBOOK_ANALYSIS_JOB_INCOMPLETE');
        return job;
      }
      const query=await originalJob('query',queryRequest);
      const exportRequest={id:exportId,query_id:queryId,result_sha256:query.result.result.result_sha256,
        label:'Census workbook complete rows',formats:['jsonl','csv','sqlite'],timeout:300,
        spreadsheet_safe:true};
      await retainSame(join(jobDirectory,'export.json'),json(exportRequest));
      const exported=await originalJob('query-export',exportRequest);
      const received=await receiveQueryFiles(ready,exportId);
      check(received.rowCount===rows,'WORKBOOK_ANALYSIS_EXPORT_ROW_COUNT_CHANGED');
      result.analysis={intake:imported,reopenedIntakeId:resumed.id,query,export:exported,received};
    }
  } finally {
    if(analysis)await analysis.close();
    if(service)result.analysisService.closed=await service.stop();
  }
  await retainSame(ready.resultFile,json(result));
  progress({complete:true,packetSha256:result.packetSha256,rows});
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(process.argv.length===2 || process.argv.length===3 && ['--help','-h','help'].includes(process.argv[2])) {
    process.stdout.write(`Complete workbook customer receiving

  starforge workbook-receive --ready /absolute/customer/ready.json
  node examples/run-workbook-receiver.mjs --ready /absolute/customer/ready.json

The private ready file uses stellar-forge.workbook-customer-ready.v1 and absolute
paths to the reviewed publisher/config, original completed dataset session,
native runtime, receiving rooms, and original Analysis workspace.
The workflow retains the acquisition, portable dataset, Analysis intake,
complete JSONL/CSV/SQLite query export, and offline receiving result.
Repeat the same ready file to reopen its retained completed result.

See workbook-customer/README.md for the full ready-file and installed API.
`);
  } else {
  try {
    check(process.argv.length===4&&process.argv[2]==='--ready','WORKBOOK_READY_ARGUMENT_REQUIRED');
    const raw=await readFile(process.argv[3]);
    check(raw.length<=1024*1024,'WORKBOOK_READY_SIZE_LIMIT');
    const result=await runWorkbookReceiver(JSON.parse(raw),{progress:value=>{
      if(value.complete)process.stdout.write(JSON.stringify({progress:value})+'\n');
    }});
    process.stdout.write(JSON.stringify({status:'COMPLETE',packetSha256:result.packetSha256,
      snapshot:result.request.snapshot,rows:result.portableRows,
      importId:result.analysis?.intake.id??null,exportId:result.analysis?.export.result.id??null,
      resultFile:JSON.parse(raw).resultFile})+'\n');
  } catch(error) {
    process.stderr.write(JSON.stringify({error:error.code??error.name})+'\n');
    process.exitCode=1;
  }
  }
}
