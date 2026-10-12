// MIT. Receive every approved period on the original Central workspace and warehouse.
import { mkdir, lstat, realpath, readFile, open, link, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, join, relative, resolve, isAbsolute, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireReleaseLease } from '../../../sf82-seller-pilot/release-process.mjs';
import { atomic, digest, formatted, now, stable, writeNew } from '../../odata/state.mjs';
import { restoreCentralArchive } from '../archive.mjs';
import { fingerprint } from '../commissioning/agreement.mjs';
import { normalizeWarehouseProfiles } from './bridge.mjs';
import { serveCentralWarehouse } from './open.mjs';

export const RECEIVING_SCHEMA='stellar-forge.central-approved-period-receiving.v1';
export const NATIVE_SELECTION_SCHEMA='stellar-forge.central-native-warehouse-selection.v1';
const POLICY='native-inspected-scalars-with-original-keys';
const HASH=/^[a-f0-9]{64}$/;
const need=(value,code,message)=>{if(!value)throw Object.assign(Error(message),{code});};
const copy=value=>JSON.parse(JSON.stringify(value));
const same=(a,b)=>stable(a)===stable(b);
const inside=(parent,child)=>{const path=relative(parent,child);return path===''||(!path.startsWith('..'+sep)&&path!=='..'&&!isAbsolute(path));};
const actionId=(operation,label)=>digest(operation+'\n'+label).slice(0,32);
async function privateDirectory(path){
  await mkdir(path,{recursive:true,mode:0o700});const info=await lstat(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(path)===resolve(path)&&
    (process.platform==='win32'||!(info.mode&0o077)),'CENTRAL_WAREHOUSE_RECEIVING_DIRECTORY',
    'Use canonical private receiving directories.');
}
async function jsonFile(path,{missing=false,max=16*1024*1024}={}){
  let info;try{info=await lstat(path);}catch(error){if(missing&&error.code==='ENOENT')return null;throw error;}
  need(info.isFile()&&!info.isSymbolicLink()&&info.size<=max,
    'CENTRAL_WAREHOUSE_RECEIVING_FILE','Use a complete regular receiving JSON file.');
  const bytes=await readFile(path);
  need(bytes.length===info.size&&bytes.length<=max,'CENTRAL_WAREHOUSE_RECEIVING_FILE','The receiving JSON changed while reading.');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
async function fileDigest(path){
  const info=await lstat(path);
  need(info.isFile()&&!info.isSymbolicLink(),'CENTRAL_WAREHOUSE_RECEIVING_FILE','Keep retained outputs as regular original files.');
  const hash=createHash('sha256');let bytes=0;
  for await(const block of createReadStream(path)){hash.update(block);bytes+=block.length;}
  need(bytes===info.size,'CENTRAL_WAREHOUSE_RECEIVING_FILE','The original receiving file changed.');
  return {bytes,sha256:hash.digest('hex')};
}
async function exactJson(path,value){
  const bytes=formatted(value);
  try{await writeNew(path,bytes);}
  catch(error){if(error.code!=='EEXIST')throw error;
    const found=await fileDigest(path);need(found.bytes===bytes.length&&found.sha256===digest(bytes),
      'CENTRAL_WAREHOUSE_RECEIVING_CHANGED','Keep the complete original receiving artifact unchanged.');}
  return {path,bytes:bytes.length,sha256:digest(bytes)};
}
function specification(input){
  need(input&&typeof input==='object'&&!Array.isArray(input),'CENTRAL_WAREHOUSE_RECEIVING_INPUT','Supply the complete original receiving selection.');
  const allowed=new Set(['schema','operationId','workspaceId','deliveryId','profileId','reviewer','note','mappingPolicy','commissioningDefinitionSha256','expectedTables','nativeSelection']);
  need(Object.keys(input).every(key=>allowed.has(key))&&input.schema===RECEIVING_SCHEMA,
    'CENTRAL_WAREHOUSE_RECEIVING_INPUT','Use the documented original receiving schema.');
  for(const [key,max]of [['operationId',160],['workspaceId',160],['deliveryId',160],['profileId',160],['reviewer',160],['note',4000]])
    need(typeof input[key]==='string'&&input[key].trim()&&input[key].length<=max&&!input[key].includes('\0'),
      'CENTRAL_WAREHOUSE_RECEIVING_INPUT','Supply the retained '+key+'.');
  need(input.mappingPolicy===POLICY&&(HASH.test(input.commissioningDefinitionSha256)||input.nativeSelection),
    'CENTRAL_WAREHOUSE_RECEIVING_MAPPING','Select the native full scalar mapping and the exact original commissioning definition.');
  if(input.nativeSelection){
    const source=input.nativeSelection;
    need(source.schema===NATIVE_SELECTION_SCHEMA&&source.operationId===input.operationId&&
      source.workspaceId===input.workspaceId&&source.deliveryId===input.deliveryId&&
      typeof source.sourceWorkspace==='string'&&isAbsolute(source.sourceWorkspace)&&
      typeof source.commissionId==='string'&&source.commissionId&&
      Array.isArray(source.datasets)&&source.datasets.length===2&&
      source.datasets.every(value=>value&&[0,1].includes(value.period)&&typeof value.id==='string'&&value.id&&
        typeof value.captureId==='string'&&typeof value.tableId==='string'&&
        Array.isArray(value.files)&&value.receipts&&typeof value.receipts==='object')&&
      new Set(source.datasets.map(value=>value.period)).size===2&&
      Array.isArray(source.captures)&&source.captures.length===2&&
      Array.isArray(source.periods)&&source.periods.length===2,
      'CENTRAL_WAREHOUSE_NATIVE_SELECTION','Use the complete original two-period native commissioning selection.');
    const ids=source.requestIds;
    need(ids&&['approvals','reviews','imports'].every(key=>Array.isArray(ids[key])&&ids[key].length===source.datasets.length&&
      ids[key].every(value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value)))&&
      typeof ids.report==='string'&&/^[a-f0-9]{32}$/.test(ids.report),
      'CENTRAL_WAREHOUSE_NATIVE_REQUEST','Retain the original lowercase 32-hex approval, review, import and report IDs.');
    const all=[...ids.approvals,...ids.reviews,...ids.imports,ids.report];
    need(new Set(all).size===all.length,'CENTRAL_WAREHOUSE_NATIVE_REQUEST','Each original action needs its original distinct request ID.');
  }
  const expected=input.expectedTables??[];
  need(Array.isArray(expected),'CENTRAL_WAREHOUSE_RECEIVING_TABLES','Use original table expectations.');
  const keys=new Set();
  for(const item of expected){
    need(item&&typeof item==='object'&&Object.keys(item).every(key=>['projectId','formId','table','previousRows','currentRows'].includes(key))&&
      ['projectId','formId','table'].every(key=>typeof item[key]==='string'&&item[key])&&
      Number.isSafeInteger(item.previousRows)&&item.previousRows>=0&&
      Number.isSafeInteger(item.currentRows)&&item.currentRows>=0,
      'CENTRAL_WAREHOUSE_RECEIVING_TABLES','Retain real project/form/table identities and full period row counts.');
    const key=stable([item.projectId,item.formId,item.table]);
    need(!keys.has(key),'CENTRAL_WAREHOUSE_RECEIVING_TABLES','Select each original root or repeat table once.');keys.add(key);
  }
  return copy({...input,expectedTables:expected});
}
async function request(owner,path,input){
  const response=await fetch(owner.origin+path,{method:input===undefined?'GET':'POST',redirect:'error',
    headers:{Origin:owner.origin,Authorization:'Bearer '+owner.token,...(input===undefined?{}:{'Content-Type':'application/json'})},
    ...(input===undefined?{}:{body:JSON.stringify(input)})});
  const result=await response.json();
  if(!response.ok)throw Object.assign(Error(result.error?.message??'Reopen the same original HTTP operation.'),
    {code:result.error?.code??'CENTRAL_WAREHOUSE_RECEIVING_HTTP',status:response.status});
  return result.result??result;
}
async function receiveDownload(owner,input,expected,path){
  need(HASH.test(expected.sha256)&&Number.isSafeInteger(expected.bytes)&&expected.bytes>=0,
    'CENTRAL_WAREHOUSE_RECEIVING_RECEIPT','Use complete original download bytes and hash.');
  const ticket=await request(owner,'/api/downloads',input);
  need(ticket.sha256===expected.sha256&&ticket.bytes===expected.bytes,
    'CENTRAL_WAREHOUSE_RECEIVING_DOWNLOAD','The native download selection differs from its original receipt.');
  const url=new URL(ticket.url,owner.origin);
  need(url.origin===owner.origin&&/^\/api\/downloads\/[a-f0-9]{48}$/.test(url.pathname)&&!url.search&&!url.hash,
    'CENTRAL_WAREHOUSE_RECEIVING_DOWNLOAD','Use the original fixed download ticket.');
  const existing=await lstat(path).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(existing){
    need(same(await fileDigest(path),{bytes:expected.bytes,sha256:expected.sha256}),
      'CENTRAL_WAREHOUSE_RECEIVING_CHANGED','Keep the already-received complete native file.');
    return {path,bytes:expected.bytes,sha256:expected.sha256,status:200};
  }
  const response=await fetch(url,{redirect:'error'});
  need(response.status===200&&response.body,'CENTRAL_WAREHOUSE_RECEIVING_DOWNLOAD','Receive the complete original native file.');
  await privateDirectory(dirname(path));
  const temporary=path+'.'+randomUUID()+'.part',hash=createHash('sha256');let bytes=0,file=null;
  try{
    file=await open(temporary,'wx',0o600);
    const checked=new Transform({transform(block,_encoding,done){
      bytes+=block.length;
      if(bytes>expected.bytes){done(Object.assign(Error('The native file exceeds its retained byte count.'),{code:'CENTRAL_WAREHOUSE_RECEIVING_DOWNLOAD'}));return;}
      hash.update(block);done(null,block);
    }});
    await pipeline(Readable.fromWeb(response.body),checked,async source=>{
      for await(const block of source){
        let offset=0;
        while(offset<block.length){
          const {bytesWritten}=await file.write(block,offset,block.length-offset,null);
          need(bytesWritten>0,'CENTRAL_WAREHOUSE_RECEIVING_WRITE','The native output writer made no progress.');
          offset+=bytesWritten;
        }
      }
    });
    await file.sync();await file.close();file=null;
    const observed={bytes,sha256:hash.digest('hex')};
    need(same(observed,{bytes:expected.bytes,sha256:expected.sha256}),
      'CENTRAL_WAREHOUSE_RECEIVING_DOWNLOAD','The complete received original file differs.');
    try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;
      need(same(await fileDigest(path),observed),'CENTRAL_WAREHOUSE_RECEIVING_CHANGED','The original downloaded artifact changed.');}
    const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}
    return {path,...observed,status:response.status};
  }finally{if(file)await file.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
const sourceDownload=(receipt,name)=>({kind:'source',hash:receipt.sha256,name:name??receipt.name??receipt.sha256});
const exportDownload=(id,path)=>({kind:'export',id,path});

function originalRows(expected,current,label){
  const rows=new Map(current.map(value=>[value.id,value]));
  need(rows.size===current.length&&expected.every(value=>same(rows.get(value.id),value)),
    'CENTRAL_WAREHOUSE_RECEIVING_RESTORE','The independent recipient must preserve every original '+label+'.');
}
async function retainedSnapshot(path,current){
  const prior=await jsonFile(path,{missing:true});
  if(prior){
    need(prior.workspaceId===current.workspaceId,'CENTRAL_WAREHOUSE_RECEIVING_WORKSPACE','The retained snapshot belongs to another workspace.');
    originalRows(prior.approvals,current.approvals,'approval');
    originalRows(prior.operations,current.operations,'warehouse operation');
    return {value:prior,receipt:{path,...await fileDigest(path)}};
  }
  return {value:current,receipt:await exactJson(path,current)};
}
/** Use the original native commissioner's emitted selection without creating new action IDs. */
export function nativeReceivingSelection(input,{profileId,reviewer,note}={}){
  need(input?.schema===NATIVE_SELECTION_SCHEMA,'CENTRAL_WAREHOUSE_NATIVE_SELECTION',
    'Select the complete original warehouse-selections.json.');
  return specification({schema:RECEIVING_SCHEMA,operationId:input.operationId,workspaceId:input.workspaceId,
    deliveryId:input.deliveryId,profileId,reviewer,note,mappingPolicy:POLICY,nativeSelection:copy(input)});
}


/**
 * Direct source-owned continuation of an already-issued commissioning delivery.
 * It starts one original authenticated listener and borrows its Store. It never
 * creates a Central service, provider project, source plan or source capture.
 */
export async function receiveApprovedCentralPeriods({specification:input,directory,profiles,
  outputDirectory,restoreDirectory,onStage=async()=>{}}={}){
  const spec=specification(input),root=resolve(outputDirectory),original=resolve(directory),restored=resolve(restoreDirectory);
  need(!inside(original,root)&&!inside(root,original)&&!inside(restored,root)&&!inside(root,restored)&&
    !inside(original,restored)&&!inside(restored,original),
    'CENTRAL_WAREHOUSE_RECEIVING_DIRECTORIES','Use separate original, output and independent restored workspace directories.');
  need(!spec.nativeSelection||resolve(spec.nativeSelection.sourceWorkspace)===original,
    'CENTRAL_WAREHOUSE_NATIVE_WORKSPACE','Use the exact original source workspace from the native selection.');
  const selectedProfiles=normalizeWarehouseProfiles(profiles),profile=selectedProfiles.find(value=>value.id===spec.profileId);
  need(profile,'CENTRAL_WAREHOUSE_RECEIVING_PROFILE','Use the selected existing private PostgreSQL profile.');
  await privateDirectory(root);
  const lease=await acquireReleaseLease(root,'receiving.lock');
  need(lease,'CENTRAL_WAREHOUSE_RECEIVING_LEASE','Use the existing original native receiving host.');
  const retainedRequest={specification:spec,directory:original,restoreDirectory:restored,profile};
  const requestSha256=digest(stable(retainedRequest)),journalPath=join(root,'operation.json'),resultPath=join(root,'result.json');
  let journal=null,owner=null,completed=false;
  const checkpoint=async(stage,values={})=>{
    lease.assertHeld();Object.assign(journal,values,{updatedAt:now()});
    if(stage)journal.stages.push({stage,at:journal.updatedAt});
    await atomic(journalPath,journal);
    if(stage)await onStage({stage,operationId:spec.operationId,...values});
  };
  const run=async(method,body)=>{
    const inputReceipt=await exactJson(join(root,'requests',method+'-'+body.requestId+'.json'),body);
    await checkpoint('request',{currentRequest:{method,id:body.requestId,input:inputReceipt}});
    const value=await request(owner,'/api/warehouse/'+method,body);
    const result=await exactJson(join(root,'responses',method+'-'+body.requestId+'.json'),value);
    journal.calls[body.requestId]={method,input:inputReceipt,result,status:value.status};
    await checkpoint('request-complete',{currentRequest:null});return value;
  };
  try{
    await privateDirectory(join(root,'requests'));await privateDirectory(join(root,'responses'));
    journal=await jsonFile(journalPath,{missing:true});
    if(journal)need(journal.schema===RECEIVING_SCHEMA&&journal.requestSha256===requestSha256,
      'CENTRAL_WAREHOUSE_RECEIVING_CHANGED','Resume the exact original receiving selection and directories.');
    else{
      journal={schema:RECEIVING_SCHEMA,operationId:spec.operationId,requestSha256,request:retainedRequest,
        status:'RECEIVING',createdAt:now(),stages:[],calls:{},datasets:[],reports:[],downloads:[]};
      await exactJson(journalPath,journal);
    }
    const prior=await jsonFile(resultPath,{missing:true});
    if(prior){
      need(prior.requestSha256===requestSha256&&prior.listenersClosed===true,
        'CENTRAL_WAREHOUSE_RECEIVING_CHANGED','Keep the completed original receiving result.');
      for(const file of prior.files)need(inside(root,resolve(file.path))&&same(await fileDigest(file.path),{bytes:file.bytes,sha256:file.sha256}),
        'CENTRAL_WAREHOUSE_RECEIVING_CHANGED','A complete retained receiving artifact changed.');
      if(journal.status!=='COMPLETE')
        await checkpoint('complete',{status:'COMPLETE',completedAt:prior.completedAt,resultPath});
      completed=true;return prior;
    }
    owner=await serveCentralWarehouse({directory:original,profiles:selectedProfiles});
    let state=await request(owner,'/api/warehouse/state');
    need(state.workspaceId===spec.workspaceId,'CENTRAL_WAREHOUSE_RECEIVING_WORKSPACE','Use the original already-delivered workspace identity.');
    const delivery=state.deliveries.find(value=>value.id===spec.deliveryId);
    need(delivery?.datasets?.length&&delivery.datasets.length%2===0,
      'CENTRAL_WAREHOUSE_RECEIVING_DELIVERY','Select the complete original two-period commissioning delivery.');
    const commission=owner.commissioning.state().commissions.find(value=>value.id===delivery.commissioningId),
      definitionSha256=commission?fingerprint(commission.definition):null;
    need(commission&&HASH.test(definitionSha256)&&(!spec.commissioningDefinitionSha256||
      definitionSha256===spec.commissioningDefinitionSha256)&&
      (!journal.definitionSha256||journal.definitionSha256===definitionSha256),
      'CENTRAL_WAREHOUSE_RECEIVING_DEFINITION','Retain the exact original complete commissioning definition.');
    if(spec.nativeSelection){
      const selected=spec.nativeSelection,originalDelivery=commission.deliveries.find(value=>value.id===selected.deliveryId);
      need(commission.id===selected.commissionId&&originalDelivery&&
        same(originalDelivery.datasets,selected.datasets)&&same(originalDelivery.selection.captures,selected.captures)&&
        same(commission.definition.periods.map((value,period)=>({period,label:value.label})),selected.periods),
        'CENTRAL_WAREHOUSE_NATIVE_SELECTION','The full native delivery, accepted reviews or period labels changed.');
    }
    await checkpoint('original-selection',{definitionSha256});
    const selectedId=(kind,source,fallback)=>{
      if(!spec.nativeSelection)return actionId(spec.operationId,fallback);
      const index=spec.nativeSelection.datasets.findIndex(value=>value.period===source.period&&value.id===source.id);
      need(index>=0,'CENTRAL_WAREHOUSE_NATIVE_SELECTION','A native approved dataset is missing from the retained selection.');
      return spec.nativeSelection.requestIds[kind][index];
    };
    const opened=await run('connect',{requestId:actionId(spec.operationId,'warehouse-connect'),profileId:spec.profileId});
    await checkpoint('warehouse-opened',{warehouse:opened.profile});
    const datasets=[],pairs=new Map(),downloads=[];
    for(const source of [...delivery.datasets].sort((a,b)=>a.period-b.period||a.id.localeCompare(b.id))){
      const key=source.period+':'+source.id;
      const approved=await run('prepare',{requestId:selectedId('approvals',source,'approval:'+key),deliveryId:delivery.id,datasetId:source.id,period:source.period});
      const a=approved.approval;
      need(a.commissioning.definitionSha256===definitionSha256&&a.workspace.id===spec.workspaceId,
        'CENTRAL_WAREHOUSE_RECEIVING_DEFINITION','Keep the original approved definition and workspace through every table.');
      const identity=[a.table.projectId,a.table.formId,a.table.name],tableKey=stable(identity);
      const expected=spec.expectedTables.find(item=>same([item.projectId,item.formId,item.table],identity));
      if(spec.expectedTables.length)need(expected&&a.export.rowCount===(source.period===0?expected.previousRows:expected.currentRows),
        'CENTRAL_WAREHOUSE_RECEIVING_ROWS','The actual full source row count differs from the original table expectation.');
      const inspected=await run('inspect',{requestId:actionId(spec.operationId,'inspect:'+key),approvalId:approved.id,profileId:spec.profileId});
      const mapping=copy(inspected.result.mapping);
      need(same(mapping.keys,inspected.context.keyColumns)&&mapping.columns.length===Object.keys(a.projection.columns).length,
        'CENTRAL_WAREHOUSE_RECEIVING_MAPPING','The original inspection must preserve all approved columns and native keys.');
      const reviewed=await run('review',{requestId:selectedId('reviews',source,'review:'+key),inspectionId:inspected.id,
        mapping,reviewer:spec.reviewer,note:spec.note});
      const imported=await run('import',{requestId:selectedId('imports',source,'import:'+key),reviewId:reviewed.id});
      const selection={period:source.period,identity,approvalId:approved.id,inspectionId:inspected.id,reviewId:reviewed.id,
        importId:imported.id,versionId:imported.result.result.version_id,rowCount:a.export.rowCount,
        approvalSha256:approved.receipt.sha256,captureId:a.capture.id,exportId:a.export.id,
        mapping,originalKeys:a.table.keyFields,repeatParent:a.table.relationship?.parentField??null};
      if(!pairs.has(tableKey))pairs.set(tableKey,new Map());
      need(!pairs.get(tableKey).has(source.period),'CENTRAL_WAREHOUSE_RECEIVING_TABLE','Select one native dataset for each original table and period.');
      pairs.get(tableKey).set(source.period,selection);datasets.push(selection);
      const target=join(root,'downloads','dataset-'+approved.id);
      const approvalFile=await receiveDownload(owner,sourceDownload(approved.receipt,'central-approved-export.json'),
        approved.receipt,join(target,'central-approved-export.json'));downloads.push(approvalFile);
      for(const name of ['dataset.csv','semantics.json','table-schema.json','source.json']){
        const receipt=a.files.find(file=>file.path===name);
        need(receipt,'CENTRAL_WAREHOUSE_RECEIVING_FILE','Retain the complete original approved CSV and dictionary.');
        downloads.push(await receiveDownload(owner,exportDownload(a.export.id,name),receipt,join(target,name)));
      }
      await checkpoint('dataset-received',{datasets,downloads});
    }
    need(pairs.size*2===datasets.length&&(!spec.expectedTables.length||pairs.size===spec.expectedTables.length),
      'CENTRAL_WAREHOUSE_RECEIVING_PERIODS','Receive both complete periods for every approved original root/repeat table.');
    const reports=[];
    for(const [key,periods]of pairs){
      const previous=periods.get(0),current=periods.get(1);
      need(previous&&current,'CENTRAL_WAREHOUSE_RECEIVING_PERIODS','The original table requires both reporting periods.');
      const report=await run('periodReport',{requestId:spec.nativeSelection?.requestIds.report??actionId(spec.operationId,'period-report:'+key),
        previousImportId:previous.importId,currentImportId:current.importId,title:current.identity.join(' / ')+' — approved periods'});
      const actual=report.result.result?.report,totals=actual?.totals;
      need(actual&&actual.previous.row_count===previous.rowCount&&actual.current.row_count===current.rowCount&&
        actual.selection.previous_version===previous.versionId&&actual.selection.current_version===current.versionId&&
        totals.ADDED+totals.CHANGED+totals.UNCHANGED===current.rowCount&&
        totals.REMOVED+totals.CHANGED+totals.UNCHANGED===previous.rowCount,
        'CENTRAL_WAREHOUSE_RECEIVING_REPORT','The complete period report must cover both original editions and every native row.');
      const file=await receiveDownload(owner,sourceDownload(report.report),report.report,
        join(root,'downloads','reports',report.id+'.zip'));downloads.push(file);
      reports.push({id:report.id,identity:current.identity,previousVersion:previous.versionId,currentVersion:current.versionId,
        result:report.result,file});
      await checkpoint('period-report-received',{reports,downloads});
    }
    const savedSnapshot=await retainedSnapshot(join(root,'original-warehouse-state.json'),
      await request(owner,'/api/warehouse/state')),before=savedSnapshot.value,retained=savedSnapshot.receipt;
    const archiveId='warehouse-receive-'+digest(spec.operationId).slice(0,40);
    await checkpoint('workspace-backup',{archiveId});
    const archive=await owner.workspace.backup({id:archiveId}),name='central-workspace.tar.gz';
    const nativeArchive=await owner.workspace.exportFile({id:archive.id,path:name});
    const archiveFile=await receiveDownload(owner,exportDownload(archive.id,name),archive.receipts[name],join(root,name));
    downloads.push(archiveFile);
    await checkpoint('workspace-backed-up',{archive:{id:archive.id,nativePath:nativeArchive.path,...archiveFile},downloads});
    await owner.close();owner=null;
    const restoredReceipt=await restoreCentralArchive({archive:archiveFile.path,directory:restored,expectedSha256:archiveFile.sha256});
    await checkpoint('workspace-restored',{restored:restoredReceipt});
    owner=await serveCentralWarehouse({directory:restored,profiles:selectedProfiles});
    state=await request(owner,'/api/warehouse/state');
    need(state.workspaceId===before.workspaceId,
      'CENTRAL_WAREHOUSE_RECEIVING_RESTORE','The independent recipient must retain the original workspace identity.');
    originalRows(before.approvals,state.approvals,'approval');
    originalRows(before.operations,state.operations,'warehouse operation');
    const reopened=await run('connect',{requestId:actionId(spec.operationId,'received-warehouse-connect'),profileId:spec.profileId});
    need(same(reopened.profile,opened.profile),'CENTRAL_WAREHOUSE_RECEIVING_WAREHOUSE','The recipient must reopen the same original PostgreSQL warehouse.');
    const received=[];
    for(const dataset of datasets){
      const inspection=await run('inspect',{requestId:actionId(spec.operationId,'received-inspect:'+dataset.approvalId),
        approvalId:dataset.approvalId,profileId:spec.profileId});
      need(inspection.result.row_count===dataset.rowCount&&same(inspection.result.mapping,dataset.mapping),
        'CENTRAL_WAREHOUSE_RECEIVING_PROJECTION','The recipient must reopen the complete same approved projection and SQL mapping.');
      const operation=await request(owner,'/api/warehouse/operation',{requestId:dataset.importId});
      need(operation.status==='COMPLETE'&&operation.result.result.version_id===dataset.versionId,
        'CENTRAL_WAREHOUSE_RECEIVING_EDITION','The recipient must retain the same complete immutable warehouse edition.');
      received.push({approvalId:dataset.approvalId,inspectionId:inspection.id,rows:dataset.rowCount,versionId:dataset.versionId});
    }
    for(const report of reports){
      const originalReport=await request(owner,'/api/warehouse/operation',{requestId:report.id});
      const file=await receiveDownload(owner,sourceDownload(originalReport.report),originalReport.report,
        join(root,'received-reports',report.id+'.zip'));
      need(file.sha256===report.file.sha256&&file.bytes===report.file.bytes,
        'CENTRAL_WAREHOUSE_RECEIVING_REPORT','The received full period report must retain its original bytes.');
      downloads.push(file);
    }
    const finalState=await request(owner,'/api/warehouse/state');
    const receivedSnapshot=await retainedSnapshot(join(root,'received-warehouse-state.json'),finalState),
      receivedState=receivedSnapshot.receipt;
    await owner.close();owner=null;
    const result={schema:RECEIVING_SCHEMA,operationId:spec.operationId,requestSha256,
      workspaceId:spec.workspaceId,deliveryId:spec.deliveryId,commissioningDefinitionSha256:definitionSha256,
      originalDirectory:original,restoredDirectory:restored,warehouse:opened.profile,
      datasets,reports,received,archive:journal.archive,restored:restoredReceipt,
      files:[retained,receivedState,...downloads],listenersClosed:true,completedAt:now()};
    await exactJson(resultPath,result);
    await checkpoint('complete',{status:'COMPLETE',completedAt:result.completedAt,resultPath});
    completed=true;return result;
  }catch(error){
    if(journal)try{await checkpoint('interrupted',{status:'INTERRUPTED',
      error:{code:error.code??'CENTRAL_WAREHOUSE_RECEIVING',message:error.message}});}catch(journalError){error.journalError=journalError.message;}
    throw error;
  }finally{
    try{await owner?.close();}finally{await lease.close();}
    if(completed)await onStage({stage:'closed',operationId:spec.operationId});
  }
}
export async function main(argv=process.argv.slice(2)){
  if(!argv.length||argv.includes('--help')){
    process.stdout.write(
      'node odk/warehouse/receiving.mjs --request INPUT.json --directory ORIGINAL --profiles HOST_PROFILES.json --output RECEIVING --restore-directory REOPENED\n'+
      'Native warehouse-selections.json: add --profile PROFILE --reviewer NAME --note TEXT; --directory is read from that exact source selection.\n');return;
  }
  const options={};
  for(let index=0;index<argv.length;index+=2){
    const key=argv[index],value=argv[index+1];
    need(['--request','--directory','--profiles','--output','--restore-directory','--profile','--reviewer','--note'].includes(key)&&
      typeof value==='string'&&!value.startsWith('--')&&!Object.hasOwn(options,key),
      'CENTRAL_WAREHOUSE_RECEIVING_ARGUMENT','Use each documented original receiving argument once.');options[key]=value;
  }
  need(['--request','--profiles','--output','--restore-directory'].every(key=>options[key]),
    'CENTRAL_WAREHOUSE_RECEIVING_ARGUMENT','Supply the original request, host profiles and complete receiving paths.');
  const rawProfiles=await jsonFile(resolve(options['--profiles']),{max:1024*1024}),
    profileInfo=await lstat(resolve(options['--profiles']));
  need(process.platform==='win32'||!(profileInfo.mode&0o077),
    'CENTRAL_WAREHOUSE_RECEIVING_PROFILE','Use the existing private host profile file.');
  const profiles=Array.isArray(rawProfiles)?rawProfiles:
    rawProfiles?.schema==='stellar-forge.central-warehouse-profiles.v1'?rawProfiles.profiles:null;
  const input=await jsonFile(resolve(options['--request']),{max:2*1024*1024});
  const native=input.schema===NATIVE_SELECTION_SCHEMA;
  need(native?options['--profile']&&options['--reviewer']&&options['--note']:
    options['--directory']&&!['--profile','--reviewer','--note'].some(key=>options[key]),
    'CENTRAL_WAREHOUSE_RECEIVING_ARGUMENT','Use native profile/reviewer/note arguments only with the original native selection.');
  const selected=native?nativeReceivingSelection(input,{profileId:options['--profile'],
    reviewer:options['--reviewer'],note:options['--note']}):input;
  const directory=options['--directory']??input.sourceWorkspace;
  let interruption=null;
  const signals=['SIGTERM','SIGINT','SIGHUP'],handlers=new Map();
  for(const name of signals){const handler=()=>{interruption??=name;};handlers.set(name,handler);process.on(name,handler);}
  try{
    const result=await receiveApprovedCentralPeriods({
      specification:selected,directory,profiles,outputDirectory:options['--output'],restoreDirectory:options['--restore-directory'],
      onStage:async value=>{
        process.stdout.write(JSON.stringify({stage:value.stage,operationId:value.operationId})+'\n');
        if(value.stage!=='closed'&&value.stage!=='complete')need(!interruption,'CENTRAL_WAREHOUSE_RECEIVING_INTERRUPTED',
          'The original receiving was interrupted by '+interruption+'; resume the same retained request.');
      }});
    process.stdout.write(JSON.stringify({schema:result.schema,operationId:result.operationId,workspaceId:result.workspaceId,
      tables:result.reports.length,datasets:result.datasets.length,result:resolve(options['--output'],'result.json'),
      completeFiles:result.files.length,listenersClosed:result.listenersClosed})+'\n');
  }finally{for(const[name,handler]of handlers)process.removeListener(name,handler);}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{process.stderr.write(JSON.stringify({code:error.code??'CENTRAL_WAREHOUSE_RECEIVING',message:error.message})+'\n');process.exitCode=1;});
