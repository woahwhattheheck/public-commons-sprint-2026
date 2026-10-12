// MIT. Continue one original Central receiving operation through its portable workspace.
import { open, mkdir, readFile, rename, unlink, lstat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join, relative, isAbsolute, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openCentralWorkspace } from '../workspace.mjs';
import { restoreCentralArchive } from '../archive.mjs';

const SCHEMA='stellar-forge.odk-native-receiving.v1';
const stable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item);
const sha=value=>createHash('sha256').update(value).digest('hex');
const now=()=>new Date().toISOString();
function requireValue(condition,code,message){if(!condition)throw Object.assign(Error(message),{code});}
function equal(a,b){return stable(a)===stable(b);}
function boundedText(value,label,max=1000){
  requireValue(typeof value==='string'&&value.trim()&&value.length<=max,'CENTRAL_RECEIVE_INPUT','Supply '+label+'.');
  return value;
}
function uniqueId(operation,name){return 'receive-'+sha(operation+'\n'+name).slice(0,40);}
function inside(parent,child){const path=relative(parent,child);return path===''||(!path.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&path!=='..'&&!isAbsolute(path));}
async function regularJSON(path){
  try{const entry=await lstat(path);requireValue(entry.isFile()&&!entry.isSymbolicLink(),'CENTRAL_RECEIVE_FILE','Keep the original receiving journal as a regular file.');
    return JSON.parse(await readFile(path,'utf8'));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function saveJSON(path,value,{create=false}={}){
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const body=Buffer.from(JSON.stringify(value,null,2)+'\n'),temporary=path+'.'+randomUUID()+'.part';
  const file=await open(temporary,'wx',0o600);
  try{await file.writeFile(body);await file.sync();}finally{await file.close();}
  try{
    if(create){
      const {link}=await import('node:fs/promises');
      await link(temporary,path);
    }else await rename(temporary,path);
    const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function fileDigest(path){
  const entry=await lstat(path);
  requireValue(entry.isFile()&&!entry.isSymbolicLink(),'CENTRAL_RECEIVE_FILE','Receive an original regular file.');
  const hash=createHash('sha256');let bytes=0;
  for await(const part of createReadStream(path)){hash.update(part);bytes+=part.length;}
  requireValue(bytes===entry.size,'CENTRAL_RECEIVE_FILE_CHANGED','An original source file changed during receiving.');
  return {sha256:hash.digest('hex'),bytes};
}
function tableSelection(capture,input){
  requireValue(input&&typeof input==='object','CENTRAL_RECEIVE_TABLE','Choose a project, form and native table name.');
  const form=capture.forms.find(item=>String(item.projectId)===String(input.projectId)&&item.formId===input.formId);
  const table=form&&capture.tables.find(item=>item.formKey===form.key&&item.name===input.table);
  requireValue(table,'CENTRAL_RECEIVE_TABLE','The selected native table is absent from this captured cohort.');
  return table;
}
function indicator(capture,input){
  const {selector,...definition}=input;
  requireValue(selector,'CENTRAL_RECEIVE_INDICATOR','Bind each indicator to its original project, form and table.');
  return {...definition,tableId:tableSelection(capture,selector).id};
}
function coverage(capture,quality,expected={}){
  const observed={tables:[],history:quality.history,formHistory:quality.formHistory,issues:quality.issues};
  for(const selected of expected.tables??[]){
    const table=tableSelection(capture,selected);
    if(selected.rows!==undefined)requireValue(table.rowCount===selected.rows,'CENTRAL_RECEIVE_ROWS','The actual retained row count differs from the selected original source expectation.');
    if(selected.minimumPages!==undefined)requireValue(table.pageCount>=selected.minimumPages,'CENTRAL_RECEIVE_PAGES','The actual source did not exercise the requested continuation pages.');
    observed.tables.push({projectId:String(selected.projectId),formId:selected.formId,table:table.name,rows:table.rowCount,pages:table.pageCount});
  }
  for(const [name,value]of Object.entries(expected.history??{}))
    requireValue(quality.history[name]===value,'CENTRAL_RECEIVE_HISTORY','The actual submission history differs for '+name+'.');
  for(const [name,value]of Object.entries(expected.formHistory??{}))
    requireValue(quality.formHistory[name]===value,'CENTRAL_RECEIVE_FORM_HISTORY','The actual form history differs for '+name+'.');
  return observed;
}
async function retainedFile(workspace,record,name){
  const file=await workspace.exportFile({id:record.id,path:name}),actual=await fileDigest(file.path),expected=record.receipts?.[name];
  requireValue(expected&&actual.sha256===expected.sha256&&actual.bytes===expected.bytes,'CENTRAL_RECEIVE_EXPORT','The original retained export does not match its saved file identity.');
  return {name,...actual};
}
async function exportFiles(workspace,record){
  const files=[];for(const name of record.files)files.push(await retainedFile(workspace,record,name));
  return {id:record.id,kind:record.kind,fingerprint:record.fingerprint??null,files};
}
async function inspectCapture(workspace,captureId){
  const capture=workspace.edition({id:captureId}),tables=[];
  for(const table of capture.tables){
    const rowsHash=createHash('sha256'),historyHash=createHash('sha256');
    let after='',rows=0,histories=0,versions=0,previous=null;
    while(true){
      const page=workspace.rows({id:captureId,tableId:table.id,after,limit:250});
      for(const row of page.rows){
        requireValue(typeof row.__id==='string'&&row.__id!==previous,'CENTRAL_RECEIVE_ROW_ID','The original native row identity is missing or repeated.');
        previous=row.__id;rows++;rowsHash.update(stable(row)+'\n');
        if(table.name==='Submissions'){
          const detail=workspace.row({id:captureId,tableId:table.id,rowId:row.__id});
          requireValue(detail.history?.complete&&equal(detail.row,row),'CENTRAL_RECEIVE_SUBMISSION','The retained original submission history is incomplete.');
          histories++;versions+=detail.history.versions.length;historyHash.update(stable(detail.history)+'\n');
        }
      }
      if(page.next===null)break;
      requireValue(typeof page.next==='string'&&page.next!==after&&page.rows.length>0,'CENTRAL_RECEIVE_CURSOR','The original retained row cursor did not advance.');
      after=page.next;
    }
    requireValue(rows===table.rowCount,'CENTRAL_RECEIVE_ROW_COUNT','The saved cohort count differs from its retained rows.');
    tables.push({id:table.id,name:table.name,formKey:table.formKey,rows,pages:table.pageCount,
      rowsSha256:rowsHash.digest('hex'),histories,versions,historySha256:historyHash.digest('hex')});
  }
  const indexHash=createHash('sha256'),sources=new Map();let after=0,resourceCount=0;
  while(true){
    const page=workspace.resources({id:captureId,after,limit:250});
    for(const entry of page.resources){
      resourceCount++;const {cursor,...record}=entry;indexHash.update(stable(record)+'\n');
      if(entry.sha256&&!sources.has(entry.sha256)){
        const file=await workspace.sourceFile({hash:entry.sha256});
        requireValue(file.sha256===entry.sha256&&file.bytes===entry.bytes,'CENTRAL_RECEIVE_SOURCE','An original retained source body differs from its resource receipt.');
        sources.set(entry.sha256,file.bytes);
      }
    }
    if(page.next===null)break;
    requireValue(Number.isSafeInteger(page.next)&&page.next>after&&page.resources.length>0,'CENTRAL_RECEIVE_CURSOR','The original source cursor did not advance.');
    after=page.next;
  }
  return {captureId,contentHash:capture.contentHash,scope:capture.scope,
    tables,resourceCount,sourceIndexSha256:indexHash.digest('hex'),uniqueSources:sources.size,
    sourceBytes:[...sources.values()].reduce((sum,value)=>sum+value,0),
    formsSha256:sha(stable(capture.forms)),decisionsSha256:sha(stable(capture.decisions))};
}
function parseSpecification(specification){
  requireValue(specification&&typeof specification==='object'&&!Array.isArray(specification),'CENTRAL_RECEIVE_INPUT','Use the original receiving JSON object.');
  requireValue(!Object.keys(specification).some(key=>!['operationId','connection','plan','capture','review','datasets','report','archiveId','expected'].includes(key)),
    'CENTRAL_RECEIVE_INPUT','Use only the documented receiving request fields.');
  boundedText(specification.operationId,'the original operation ID',160);
  const connection=specification.connection;
  requireValue(connection&&typeof connection==='object','CENTRAL_RECEIVE_INPUT','Supply the existing Central connection.');
  boundedText(connection.name,'a connection label',128);
  const url=new URL(connection.url);
  requireValue(!url.username&&!url.password&&!url.search&&!url.hash,'CENTRAL_RECEIVE_AUTH','Keep credential values in the host environment and use a plain Central base URL.');
  requireValue(/^[A-Z][A-Z0-9_]{0,127}$/.test(connection.authEnv??''),'CENTRAL_RECEIVE_AUTH','Name the existing environment variable containing the complete Authorization header.');
  requireValue(!Object.keys(connection).some(key=>!['id','name','url','authEnv','allowLoopback'].includes(key)),'CENTRAL_RECEIVE_AUTH','The connection contains an unsupported field; pass only the original endpoint and credential reference.');
  requireValue(Array.isArray(specification.plan?.forms)&&specification.plan.forms.length>0,'CENTRAL_RECEIVE_INPUT','Select original Central project/form identities.');
  requireValue(Array.isArray(specification.datasets)&&specification.datasets.length>0,'CENTRAL_RECEIVE_INPUT','Select at least one native table projection to receive.');
  boundedText(specification.review?.reviewer,'the receiving reviewer',240);
  boundedText(specification.review?.note,'the authored source review',16000);
  boundedText(specification.report?.title,'the report title',240);
  requireValue(specification.review.acceptedIssueCodes===undefined||Array.isArray(specification.review.acceptedIssueCodes),
    'CENTRAL_RECEIVE_INPUT','List the source issue codes covered by the authored review.');
  requireValue(Buffer.byteLength(stable(specification))<=2*1024*1024,'CENTRAL_RECEIVE_INPUT','Keep the original receiving request below 2 MiB.');
  return specification;
}

/** One original SDK operation. A retry uses this exact specification and these same directories. */
export async function receiveCentralWorkspace({specification,directory,outputDirectory,restoreDirectory,onStage=async()=>{}}={}){
  const spec=parseSpecification(specification),root=resolve(directory),output=resolve(outputDirectory),restored=resolve(restoreDirectory);
  requireValue([root,output,restored].every((path,index,array)=>array.every((other,j)=>index===j||(!inside(path,other)&&!inside(other,path)))),
    'CENTRAL_RECEIVE_PATHS','Use separate original, receiving-output and restored workspace directories.');
  const request={specification:spec,directory:root,outputDirectory:output,restoreDirectory:restored},
    requestSha256=sha(stable(request)),journalPath=join(output,'receiving.json'),resultPath=join(output,'result.json'),
    ids={connection:spec.connection.id??uniqueId(spec.operationId,'connection'),plan:spec.plan.id??uniqueId(spec.operationId,'plan'),
      capture:spec.capture?.id??uniqueId(spec.operationId,'capture'),report:spec.report.id??uniqueId(spec.operationId,'report'),
      archive:spec.archiveId??uniqueId(spec.operationId,'archive')};
  let journal=await regularJSON(journalPath);
  if(journal)requireValue(journal.schema===SCHEMA&&journal.requestSha256===requestSha256&&equal(journal.ids,ids),
    'CENTRAL_RECEIVE_REQUEST_CHANGED','Resume the saved original receiving request and directories.');
  else{
    journal={schema:SCHEMA,operationId:spec.operationId,requestSha256,request,ids,startedAt:now(),stages:[],exports:[],status:'READY'};
    try{await saveJSON(journalPath,journal,{create:true});}
    catch(error){if(error.code!=='EEXIST')throw error;journal=await regularJSON(journalPath);
      requireValue(journal?.requestSha256===requestSha256,'CENTRAL_RECEIVE_REQUEST_CHANGED','Preserve the other retained receiving request.');}
  }
  const completedResult=await regularJSON(resultPath);
  if(completedResult){
    requireValue(completedResult.schema===SCHEMA&&completedResult.requestSha256===requestSha256&&equal(completedResult.ids,ids)&&
      equal(completedResult.original,completedResult.received)&&equal(completedResult.original,journal.original)&&
      equal(completedResult.archive,journal.archive)&&typeof completedResult.completedAt==='string',
      'CENTRAL_RECEIVE_RESULT','The original completed receiving result differs.');
    const resultSha256=sha(stable(completedResult));
    if(journal.status==='COMPLETE')requireValue(resultSha256===journal.resultSha256,'CENTRAL_RECEIVE_RESULT','The completed result changed.');
    else{
      Object.assign(journal,{status:'COMPLETE',resultSha256,completedAt:completedResult.completedAt,error:null});
      journal.stages.push({stage:'completed-result-recovered',at:now()});await saveJSON(journalPath,journal);
    }
    return completedResult;
  }
  requireValue(journal.status!=='COMPLETE','CENTRAL_RECEIVE_RESULT','The completed original receiving result is missing.');
  let workspace=null,reopened=null;
  const checkpoint=async(stage,values={})=>{
    Object.assign(journal,values,{status:'RUNNING',updatedAt:now()});journal.stages.push({stage,at:journal.updatedAt});
    await saveJSON(journalPath,journal);await onStage({stage,operationId:spec.operationId,ids,...values});
  };
  try{
    workspace=await openCentralWorkspace({directory:root});
    await checkpoint('connection');
    await workspace.connect({...spec.connection,id:ids.connection});
    workspace.createPlan({...spec.plan,id:ids.plan,connectionId:ids.connection});
    await checkpoint('capture',{workspaceId:workspace.state().id});
    workspace.capture({id:ids.capture,planId:ids.plan,label:spec.capture?.label??spec.plan.name??spec.operationId});
    let current=workspace.edition({id:ids.capture});
    if(current.status!=='COMPLETE'){workspace.resume({id:ids.capture});await workspace.wait({id:ids.capture});current=workspace.edition({id:ids.capture});}
    requireValue(current.status==='COMPLETE',current.error?.code??'CENTRAL_RECEIVE_CAPTURE',current.error?.message??'Continue the retained original capture.');
    const quality=workspace.quality({id:ids.capture}),observedCoverage=coverage(current,quality,spec.expected);
    const allowed=new Set(spec.review.acceptedIssueCodes??[]);
    const unreviewed=quality.issues.filter(issue=>!allowed.has(issue.code));
    await checkpoint('source-review',{quality,coverage:observedCoverage});
    requireValue(unreviewed.length===0,'CENTRAL_RECEIVE_QUALITY','Review the actual source issues listed in receiving.json before accepting this reporting edition.');
    const reviewBody={decision:'accept',note:spec.review.note,reviewer:spec.review.reviewer,
      findings:spec.review.findings??[],indicators:(spec.review.indicators??[]).map(item=>indicator(current,item))};
    if(!journal.reviewPrepared){
      await checkpoint('review-prepared',{reviewPrepared:{revision:current.revision,decisionIndex:current.decisions.length,contentHash:current.contentHash,body:reviewBody}});
    }
    requireValue(equal(journal.reviewPrepared.body,reviewBody)&&journal.reviewPrepared.contentHash===current.contentHash,
      'CENTRAL_RECEIVE_REVIEW_CHANGED','Preserve the original source review input.');
    const selected=current.decisions[journal.reviewPrepared.decisionIndex];
    if(selected){
      requireValue(selected.contentHash===current.contentHash&&Object.keys(reviewBody).every(key=>equal(selected[key],reviewBody[key])),
        'CENTRAL_RECEIVE_REVIEW_CHANGED','Another authored decision occupies the original review boundary.');
    }else{
      requireValue(current.revision===journal.reviewPrepared.revision,'CENTRAL_RECEIVE_REVIEW_CHANGED','Reopen the changed capture before altering its source decision.');
      current=workspace.review({id:ids.capture,expectedRevision:journal.reviewPrepared.revision,...reviewBody});
    }
    const decision=current.decisions[journal.reviewPrepared.decisionIndex];
    requireValue(current.decisions.at(-1)?.id===decision.id,'CENTRAL_RECEIVE_REVIEW_CHANGED','A later source review exists; preserve its original decision before receiving exports.');
    await checkpoint('reviewed',{reviewId:decision.id});
    const exported=[];
    for(let index=0;index<spec.datasets.length;index++){
      const {selector,...configuration}=spec.datasets[index],table=tableSelection(current,selector),
        exportId=uniqueId(spec.operationId,'dataset:'+index+':'+table.id);
      const record=await workspace.exportDataset({...configuration,id:ids.capture,tableId:table.id,exportId});
      exported.push(await exportFiles(workspace,record));
      await checkpoint('dataset',{exports:exported});
    }
    const {id:ignoredReportId,indicators:reportIndicators,...reportInput}=spec.report;
    const report=await workspace.report({...reportInput,id:ids.capture,reportId:ids.report,
      ...(reportIndicators?{indicators:reportIndicators.map(item=>indicator(current,item))}:{})});
    const reportReceipt=await exportFiles(workspace,report);
    const original=await inspectCapture(workspace,ids.capture);
    await checkpoint('report',{report:reportReceipt,original});
    const archive=await workspace.backup({id:ids.archive}),archiveName='central-workspace.tar.gz',
      archiveDescriptor=await workspace.exportFile({id:archive.id,path:archiveName}),archiveReceipt=await retainedFile(workspace,archive,archiveName);
    await checkpoint('archive',{archive:{id:archive.id,path:archiveDescriptor.path,...archiveReceipt}});
    await workspace.close();workspace=null;
    const restoredReceipt=await restoreCentralArchive({archive:archiveDescriptor.path,directory:restored,expectedSha256:archiveReceipt.sha256});
    await checkpoint('restored',{restored:restoredReceipt});
    reopened=await openCentralWorkspace({directory:restored});
    requireValue(reopened.state().id===journal.workspaceId,'CENTRAL_RECEIVE_WORKSPACE','The archive reopened a different original workspace.');
    const received=await inspectCapture(reopened,ids.capture);
    requireValue(equal(original,received),'CENTRAL_RECEIVE_REOPEN','The reopened source rows, submission history or source file identities differ.');
    const receivedState=reopened.state();
    for(const saved of [...exported,reportReceipt]){
      const record=[...receivedState.exports,...receivedState.reports].find(item=>item.id===saved.id);
      requireValue(record,'CENTRAL_RECEIVE_EXPORT','The original dataset or report is missing after restore.');
      // State projections omit receipts; exportFile returns their original per-file identities.
      const files=[];
      for(const entry of saved.files){
        const file=await reopened.exportFile({id:saved.id,path:entry.name}),actual=await fileDigest(file.path);
        requireValue(equal(actual,{sha256:entry.sha256,bytes:entry.bytes}),'CENTRAL_RECEIVE_EXPORT','A reopened export file differs from its original saved bytes.');
        files.push({name:entry.name,...actual});
      }
      requireValue(equal(files,saved.files),'CENTRAL_RECEIVE_EXPORT','The reopened original file set differs.');
    }
    await reopened.close();reopened=null;
    const result={schema:SCHEMA,operationId:spec.operationId,requestSha256,workspaceId:journal.workspaceId,ids,
      original,received,quality,coverage:observedCoverage,reviewId:decision.id,exports:exported,report:reportReceipt,
      archive:journal.archive,restored:restoredReceipt,completedAt:now()};
    const existing=await regularJSON(resultPath);
    if(existing)requireValue(equal({...existing,completedAt:null},{...result,completedAt:null}),'CENTRAL_RECEIVE_RESULT','Preserve the original complete receiving result.');
    const saved=existing??result;if(!existing)await saveJSON(resultPath,saved,{create:true});
    Object.assign(journal,{status:'COMPLETE',resultSha256:sha(stable(saved)),completedAt:saved.completedAt,error:null});
    journal.stages.push({stage:'complete',at:now()});await saveJSON(journalPath,journal);
    return saved;
  }catch(error){
    Object.assign(journal,{status:'INTERRUPTED',updatedAt:now(),error:{code:error.code??'CENTRAL_RECEIVE',message:error.message}});
    try{await saveJSON(journalPath,journal);}catch(journalError){error.journalError=journalError.message;}
    throw error;
  }finally{if(reopened)await reopened.close();if(workspace)await workspace.close();}
}

export async function main(argv=process.argv.slice(2)){
  if(argv.includes('--help')||argv.length===0){
    console.log('node odk/native/receive.mjs --request INPUT.json --directory ORIGINAL --output RECEIVING --restore-directory REOPENED');
    return;
  }
  const options={};for(let index=0;index<argv.length;index+=2){
    requireValue(['--request','--directory','--output','--restore-directory'].includes(argv[index])&&typeof argv[index+1]==='string'&&!argv[index+1].startsWith('--'),
      'CENTRAL_RECEIVE_ARGUMENT','Use the documented original receiving arguments.');
    requireValue(!Object.hasOwn(options,argv[index]),'CENTRAL_RECEIVE_ARGUMENT','Supply each original receiving argument once.');
    options[argv[index]]=argv[index+1];
  }
  requireValue(Object.keys(options).length===4,'CENTRAL_RECEIVE_ARGUMENT','Supply request, original workspace, output and restored workspace paths.');
  const raw=await readFile(options['--request']);
  requireValue(raw.length<=2*1024*1024,'CENTRAL_RECEIVE_INPUT','Keep the original receiving request below 2 MiB.');
  const specification=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  const result=await receiveCentralWorkspace({specification,directory:options['--directory'],outputDirectory:options['--output'],
    restoreDirectory:options['--restore-directory'],onStage:async value=>console.log(JSON.stringify({stage:value.stage,operationId:value.operationId,ids:value.ids}))});
  console.log(JSON.stringify({operationId:result.operationId,workspaceId:result.workspaceId,captureId:result.ids.capture,
    archive:result.archive,result:resolve(options['--output'],'result.json')}));
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{console.error(JSON.stringify({code:error.code??'CENTRAL_RECEIVE',message:error.message}));process.exitCode=1;});
