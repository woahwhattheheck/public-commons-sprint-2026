#!/usr/bin/env node
// MIT. Continue the completed original citation workspace through the Python analyst.
// This is a source-native child command, not another worker or admission controller.
import {parseArgs} from 'node:util';
import {resolve,join,dirname,delimiter,isAbsolute,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {open,lstat,mkdtemp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {startDossierWorkspace} from '../../research-dossiers/server.mjs';
import {openDossierStore} from '../../research-dossiers/dossier.mjs';
import {citationDigest} from '../../research-dossiers/citation-updates.mjs';
import {readResearchHostFile,openResearchSource} from '../../research-dossiers/workspace-files.mjs';
import {privateDirectory,withPrivateLock} from '../../../sf30-seller-sdk/routescan/quota.mjs';
import {need,readJson,writeJson,writeBytes,jsonBytes,parseJson} from '../../node/store.mjs';

const SCHEMA='stellar-forge.python-citation-native-continuation.v1';
const MAX=512*1024*1024;
const same=(a,b)=>citationDigest(a)===citationDigest(b);
async function exists(file){
  try{const stat=await lstat(file);need(stat.isFile()&&!stat.isSymbolicLink(),'PYTHON_CITATION_FILE_INVALID');return true;}
  catch(error){if(error.code==='ENOENT')return false;throw error;}
}
async function pin(file){
  const source=await openResearchSource(file,MAX);
  try{return {file,bytes:source.bytes,sha256:source.sha256};}finally{await source.close();}
}
async function immutable(file,value){
  if(await exists(file)){need(same(await readJson(file,32*1024*1024),value),'PYTHON_CITATION_RECORD_CHANGED');return;}
  try{await writeJson(file,value,{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;
    need(same(await readJson(file,32*1024*1024),value),'PYTHON_CITATION_RECORD_CHANGED');}
}
function childRun(executable,args,options,signal){
  return new Promise((done,reject)=>{
    const child=spawn(executable,args,options);
    let error=null,stopping=false,timer;
    const stop=()=>{
      if(stopping)return;stopping=true;
      child.kill('SIGTERM');
      timer=setTimeout(()=>child.kill('SIGKILL'),10000);
      timer.unref();
    };
    child.once('error',value=>{error=value;});
    child.once('close',(code,terminated)=>{
      clearTimeout(timer);signal?.removeEventListener('abort',stop);
      if(error)reject(error);else done({exitCode:code,signal:terminated,stopped:stopping});
    });
    if(signal?.aborted)stop();else signal?.addEventListener('abort',stop,{once:true});
  });
}

export async function receiveCompletedCitation({existingRun,directory,checkout,python='python3',
                                                operationId,withWorkbook=false,signal}){
  existingRun=resolve(existingRun);directory=await privateDirectory(resolve(directory));checkout=resolve(checkout);
  need(typeof operationId==='string'&&operationId.length>=8&&operationId.length<=100,
    'PYTHON_CITATION_OPERATION_REQUIRED');
  need(directory!==existingRun&&!relative(existingRun,directory).split(sep).includes('workspace'),
    'PYTHON_CITATION_SEPARATE_CALLER_REQUIRED');
  return withPrivateLock(directory,'native-receiving.lock',async()=>{
    const resultFile=join(existingRun,'result.json'),raw=await readResearchHostFile(resultFile,32*1024*1024);
    const original=parseJson(raw);
    need(original.schema==='sf88-citation-review-workflow.v1'&&original.state==='COMPLETE'&&original.selection,
      'PYTHON_CITATION_COMPLETED_ORIGINAL_REQUIRED');
    const selection=original.selection;
    const sourceFiles={};
    for(const path of [
      'python/examples/research_citation_analyst.mjs','python/examples/research_citation_analyst.py',
      'python/stellar_forge_buyer/research_citations.py','python/stellar_forge_buyer/research_citation_analysis.py',
      'python/research-citation-delivery.mjs','research-dossiers/dossier.mjs','research-dossiers/citation-updates.mjs',
      'research-dossiers/server.mjs','research-dossiers/workspace-client.mjs',
    ]){
      const selected=await pin(join(checkout,'stellar/scf-starforge-20261009/sf88-operator-buyer-cli',path));
      sourceFiles[path]={bytes:selected.bytes,sha256:selected.sha256};
    }
    const binding={schema:SCHEMA,operationId,existingResult:{bytes:raw.length,
      sha256:createHash('sha256').update(raw).digest('hex')},selection,withWorkbook,sourceFiles};
    await immutable(join(directory,'operation.json'),binding);
    if(await exists(join(directory,'complete.json'))){
      const previous=await readJson(join(directory,'complete.json'),32*1024*1024);
      need(same(previous.binding,binding),'PYTHON_CITATION_INPUT_CHANGED');
      for(const artifact of previous.files){
        const checked=await pin(artifact.file);
        need(checked.bytes===artifact.bytes&&checked.sha256===artifact.sha256,'PYTHON_CITATION_OUTPUT_CHANGED');
      }
      return previous;
    }
    const workspace=join(existingRun,'workspace'),store=await openDossierStore(workspace);
    const detail=await store.citationUpdates(selection.dossierId,{
      noticeId:selection.noticeId,revision:selection.currentRevision});
    const review=detail.detail.reviews.find(item=>item.id===selection.reviewId);
    need(review&&review.originalRevision===selection.originalRevision&&review.revision===selection.reviewedRevision,
      'PYTHON_CITATION_SAVED_REVIEW_REQUIRED');
    const request=join(directory,'review-request.original.json');
    await immutable(request,review.request);
    const before=(await store.getMetadata(selection.dossierId)).revision;
    // The caller starts the original listener only after the old complete
    // workflow has closed it. Its own lock refuses another live listener.
    const app=await startDossierWorkspace({directory:workspace,port:0});
    let child,attempt,output,error;
    try{
      attempt=await mkdtemp(join(directory,'attempt-'));
      output=await open(join(attempt,'stdout.json'),'wx',0o600);
      error=await open(join(attempt,'stderr.json'),'wx',0o600);
      need(app.workspaceId===original.merchant?.workspaceId,'PYTHON_CITATION_WORKSPACE_CHANGED');
      const connection=join(attempt,'connection.private.json');
      await writeJson(connection,{schema:'stellar-forge.research-workspace-connection.v1',
        mode:'RESEARCH_DOSSIER_WORKSPACE',directory:workspace,url:app.url,
        workspaceId:app.workspaceId,instanceId:app.instanceId},{exclusive:true});
      const source=join(checkout,'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python');
      const args=[join(source,'examples/research_citation_analyst.py'),
        '--checkout',checkout,'--node',process.execPath,'--connection',connection,
        '--directory',join(directory,'analyst'),'--workspace-id',app.workspaceId,
        '--dossier',selection.dossierId,'--request-file',request,'--operation-id',operationId,
        '--current-revision',String(selection.currentRevision),'--wait-seconds','900',
        ...(withWorkbook?['--with-workbook']:[])];
      child=await childRun(python,args,{cwd:directory,env:{...process.env,
        PYTHONPATH:[source,process.env.PYTHONPATH].filter(Boolean).join(delimiter)},
        stdio:['ignore',output.fd,error.fd]},signal);
      await immutable(join(attempt,'outcome.json'),child);
    }finally{
      await Promise.allSettled([output?.close(),error?.close()]);
      await app.close();
    }
    need(child?.exitCode===0&&!child.stopped,'PYTHON_CITATION_CHILD_INCOMPLETE');
    const result=await readJson(join(directory,'analyst','complete.json'),32*1024*1024);
    need(result.state==='COMPLETE'&&result.reviewId===selection.reviewId&&
      result.originalRevision===selection.originalRevision&&result.reviewedRevision===selection.reviewedRevision&&
      result.currentRevision===selection.currentRevision&&result.originalHeadUnchanged&&
      result.exactSavedRequestRecovered&&(!withWorkbook||result.workbook),
      'PYTHON_CITATION_RECEIVING_INCOMPLETE');
    need((await store.getMetadata(selection.dossierId)).revision===before,'PYTHON_CITATION_ORIGINAL_HEAD_CHANGED');
    const files=[];
    for(const artifact of result.files){
      need(typeof artifact.file==='string'&&isAbsolute(artifact.file)&&
        relative(join(directory,'analyst'),artifact.file)&&
        !relative(join(directory,'analyst'),artifact.file).split(sep).includes('..')&&
        !artifact.file.split(sep).some(part=>['connection.json','connection.private.json'].includes(part)),
        'PYTHON_CITATION_PRIVATE_OUTPUT_REFUSED');
      const checked=await pin(artifact.file);
      need(checked.bytes===artifact.bytes&&checked.sha256===artifact.sha256,'PYTHON_CITATION_OUTPUT_CHANGED');
      files.push(checked);
    }
    files.push(await pin(join(directory,'analyst','complete.json')));
    const completed={schema:SCHEMA,state:'COMPLETE',binding,workspaceId:app.workspaceId,
      reviewId:selection.reviewId,selection,files};
    await immutable(join(directory,'complete.json'),completed);
    return completed;
  });
}
async function main(){
  const {values}=parseArgs({options:{
    'existing-run':{type:'string'},directory:{type:'string'},checkout:{type:'string'},
    python:{type:'string',default:'python3'},'operation-id':{type:'string'},
    'with-workbook':{type:'boolean',default:false},help:{type:'boolean',short:'h',default:false}
  }});
  if(values.help){
    process.stdout.write('Receive an already completed original citation review through Python.\n'+
      'Usage: research-citation-python-receive --existing-run DIR --directory NEW_DIR --checkout SOURCE\n'+
      '  --operation-id ORIGINAL_CONTINUATION_ID [--python EXISTING_PYTHON] [--with-workbook]\n'+
      'Uses the saved review, original listener/readers and Python call history; no provider request is created.\n');
    return;
  }
  for(const name of ['existing-run','directory','checkout','operation-id'])
    need(values[name],'PYTHON_CITATION_ARGUMENT_REQUIRED');
  const controller=new AbortController(),stop=()=>controller.abort();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const result=await receiveCompletedCitation({existingRun:values['existing-run'],directory:values.directory,
      checkout:values.checkout,python:values.python,operationId:values['operation-id'],
      withWorkbook:values['with-workbook'],signal:controller.signal});
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch(error){
    process.stderr.write(JSON.stringify({state:'INCOMPLETE',error:error.code??error.name})+'\n');
    process.exitCode=1;
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
