// MIT. Complete customer handovers from existing immutable statement files.
import {constants} from 'node:fs';
import {open,mkdir,lstat,realpath,rename,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {privateSupportDirectory,writePrivate} from './host-files.mjs';
import {observeAccountingStatementCycle} from './accounting-statement-cycle.mjs';
import {accountingStatementPreview} from './accounting-statement-client.mjs';

const SCHEMA='stellar-forge.accounting-statement-customer-dossier.v1';
const GROUPS='stellar-forge.accounting-statement-customer-dossier-groups.v1';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,SHA=/^[a-f0-9]{64}$/;
const NAME=/^[a-z][a-z0-9_.-]{0,99}$/,MAX_FILE=128_000_000;
const BASE=['statement.json','statement.csv','usage.csv','statement.html','manifest.json'];
const PERIOD=['period.csv','period-summary.csv','usage-opening.json','usage-closing.json'];
const LOCAL=['status.json','index.html','delivery.json'];
const STATUS=['RETAINED','SUPERSEDED','WITHDRAWN'];
const PHASE=['REVIEWED','NOT_RETAINED','SENDING','RETAINED','DELIVERED','EXPORT_PENDING','RECONCILE_PENDING','REVIEW_REQUIRED'];
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const json=value=>JSON.stringify(value,null,2)+'\n';
const hash=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>hash(json(value));
const compare=(a,b)=>a<b?-1:a>b?1:0;
const fail=(code,message)=>Object.assign(new Error(message),{code:'ACCOUNTING_STATEMENT_DOSSIER_'+code});
function need(ok,message,code='ARGUMENTS'){if(!ok)throw fail(code,message);}
function exact(value,fields){need(plain(value)&&Object.keys(value).every(key=>fields.includes(key)),'Use the declared saved dossier fields.','MANIFEST');}
function timestamp(value){return typeof value==='string'&&Number.isFinite(Date.parse(value));}
function identity(value){
  need(plain(value)&&SHA.test(value.sha256??'')&&Number.isSafeInteger(value.bytes)&&value.bytes>=0&&value.bytes<=MAX_FILE,
    'The original customer file has invalid retained metadata.','FILE_IDENTITY');
  return {sha256:value.sha256,bytes:value.bytes};
}
async function optionalStat(path){try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function privateDirectory(path,{create=false}={}){
  path=resolve(path);
  if(create&&!await optionalStat(path)){
    await privateDirectory(dirname(path));
    await mkdir(path,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  }
  await privateSupportDirectory(path);const info=await lstat(path);
  need(await realpath(path)===path&&(!process.getuid||info.uid===process.getuid()),
    'Use the original private directory owned by this operator, without symlink ancestors.','DIRECTORY');
  return path;
}
async function syncDirectory(path){const file=await open(path,constants.O_RDONLY);try{await file.sync();}finally{await file.close();}}
async function readPrivate(path,{expected,maximum=MAX_FILE}={}){
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const info=await file.stat();
    need(info.isFile()&&info.nlink===1&&!(info.mode&0o077)&&(!process.getuid||info.uid===process.getuid())&&info.size<=maximum,
      'The original private customer file changed.','FILE_CHANGED');
    if(expected)need(info.size===expected.bytes,'The original customer file length changed.','FILE_CHANGED');
    const bytes=await file.readFile();
    need(bytes.length<=maximum&&bytes.length===info.size&&(!expected||bytes.length===expected.bytes&&hash(bytes)===expected.sha256),
      'The original customer file differs from its retained bytes.','FILE_CHANGED');
    return bytes;
  }finally{await file.close();}
}
async function readJson(path,options){
  const bytes=await readPrivate(path,options);
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw fail('FILE_CHANGED','The original customer file is not complete UTF-8 JSON.');}
  return {value,sha256:hash(bytes),bytes:bytes.length};
}
async function verifyFile(path,expected,signal){
  identity(expected);signal?.throwIfAborted();
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const info=await file.stat();
    need(info.isFile()&&info.nlink===1&&!(info.mode&0o077)&&(!process.getuid||info.uid===process.getuid())&&info.size===expected.bytes,
      'A customer handover file differs from its saved identity.','FILE_CHANGED');
    const digest=createHash('sha256'),buffer=Buffer.alloc(65536);let offset=0;
    while(offset<info.size){
      signal?.throwIfAborted();const result=await file.read(buffer,0,Math.min(buffer.length,info.size-offset),offset);
      need(result.bytesRead>0,'The customer file ended before its saved length.','FILE_CHANGED');
      digest.update(buffer.subarray(0,result.bytesRead));offset+=result.bytesRead;
    }
    need(digest.digest('hex')===expected.sha256,'A customer handover file differs from its saved SHA256.','FILE_CHANGED');
  }finally{await file.close();}
}
async function copyOriginal(source,target,expected,{signal,cycleLease,outputLease}){
  if(await optionalStat(target)){await verifyFile(target,expected,signal);return;}
  const input=await open(source,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  const temporary=join(dirname(target),'.dossier-copy-'+randomUUID()+'.partial');let output;
  try{
    const info=await input.stat();
    need(info.isFile()&&info.nlink===1&&!(info.mode&0o077)&&(!process.getuid||info.uid===process.getuid())&&info.size===expected.bytes,
      'The saved original customer file changed before copying.','FILE_CHANGED');
    output=await open(temporary,'wx',0o600);
    const digest=createHash('sha256'),buffer=Buffer.alloc(65536);let offset=0;
    while(offset<info.size){
      signal?.throwIfAborted();cycleLease.assertHeld();outputLease.assertHeld();
      const result=await input.read(buffer,0,Math.min(buffer.length,info.size-offset),offset);
      need(result.bytesRead>0,'The saved customer file ended early.','FILE_CHANGED');
      const bytes=buffer.subarray(0,result.bytesRead);digest.update(bytes);
      await output.writeFile(bytes);offset+=result.bytesRead;
    }
    need(digest.digest('hex')===expected.sha256,'The saved customer file changed during copying.','FILE_CHANGED');
    await output.sync();await output.close();output=undefined;cycleLease.assertHeld();outputLease.assertHeld();
    await rename(temporary,target);await syncDirectory(dirname(target));
  }finally{
    try{await input.close();await output?.close();}
    finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }
}
async function saveGenerated(path,bytes,signal){
  signal?.throwIfAborted();const expected={sha256:hash(bytes),bytes:Buffer.byteLength(bytes)};
  if(await optionalStat(path))await verifyFile(path,expected,signal);
  else{
    const temporary=join(dirname(path),'.dossier-generated-'+randomUUID()+'.partial');
    try{await writePrivate(temporary,bytes);signal?.throwIfAborted();await rename(temporary,path);await syncDirectory(dirname(path));}
    finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }
  return expected;
}
function cycleIdentity(report){
  return {cycleId:report.cycleId,label:report.label,workspace:report.workspace,requestSha256:report.requestSha256,
    manifestSha256:report.manifestSha256,preparedAt:report.preparedAt};
}
function statementIdentity(row){
  if(!row.statement)return null;
  const statement=row.statement,status=row.delivery?.observedStatus??statement.status;
  need(UUID.test(statement.id??'')&&STATUS.includes(status)&&typeof statement.number==='string',
    'The closing cycle no longer identifies its original statement.','STATEMENT_IDENTITY');
  return {id:statement.id,number:statement.number,status,createdAt:statement.createdAt,
    replacesId:statement.replacesId??null,supersededBy:statement.supersededBy??null};
}
function rowSummary(row,preparedAt){
  need(UUID.test(row.customer?.id??'')&&row.customer.id===row.intent?.customerId&&PHASE.includes(row.phase),
    'The closing-cycle row belongs to another customer.','CUSTOMER_IDENTITY');
  return {index:row.index,requestId:row.requestId,previewSha256:row.previewSha256,phase:row.phase,
    ready:row.phase==='DELIVERED'&&row.delivery?.complete===true,statement:statementIdentity(row),
    servicePeriod:structuredClone(row.servicePeriod),usageSource:structuredClone(row.usageSource),
    sourceObservedAt:row.delivery?.statusObservedAt??row.statement?.createdAt??preparedAt,errorCode:row.error?.code??null};
}
function counts(rows){
  const delivered=rows.filter(row=>row.ready).length;
  return {total:rows.length,retained:rows.filter(row=>row.statement!==null).length,delivered,pending:rows.length-delivered,
    current:rows.filter(row=>row.statement?.status==='RETAINED').length,
    superseded:rows.filter(row=>row.statement?.status==='SUPERSEDED').length,
    withdrawn:rows.filter(row=>row.statement?.status==='WITHDRAWN').length};
}
function customerGroups(report,labels=new Map()){
  const groups=new Map();
  for(const row of report.rows){
    const summary={...rowSummary(row,report.preparedAt),...(labels.get(row.index)??{plan:null,passes:[]})},id=row.customer.id;
    let group=groups.get(id);
    if(!group){group={customerId:id,reference:row.customer.reference,name:row.customer.name,rowIndexes:[],rows:[],profileRevision:-1};groups.set(id,group);}
    if(row.reviewedRevision>=group.profileRevision){group.reference=row.customer.reference;group.name=row.customer.name;group.profileRevision=row.reviewedRevision;}
    group.rowIndexes.push(row.index);group.rows.push(summary);
  }
  return [...groups.values()].map(({profileRevision,...group})=>{
    const summary=counts(group.rows);return {...group,counts:summary,complete:summary.pending===0};
  }).sort((a,b)=>compare(a.reference,b.reference)||compare(a.customerId,b.customerId));
}
function passLabels(draft,period){
  const passes=draft.items.map(item=>({orderRef:item.orderRef,label:item.label,
    plan:item.service?{id:item.service.planId,revision:item.service.planRevision,label:item.service.planLabel}:null}));
  const service=passes.filter(item=>item.plan),selected=period?service.find(item=>item.orderRef===period.orderRef):
    service.length===1?service[0]:null;
  return {passes,plan:selected?{...selected.plan,orderRef:selected.orderRef,orderLabel:selected.label}:null};
}
const reviewLabels=new Map();let reviewLabelBytes=0;
async function labelsForReview(directory,report,row,signal){
  const key=directory+'\0'+report.requestSha256+'\0'+row.index+'\0'+row.reviewFile.sha256,cached=reviewLabels.get(key);
  if(cached){reviewLabels.delete(key);reviewLabels.set(key,cached);return structuredClone(cached.value);}
  signal?.throwIfAborted();
  const item=await privateDirectory(join(directory,'items',String(row.index+1).padStart(6,'0')));
  const preview=accountingStatementPreview((await readJson(join(item,'review.json'),{expected:identity(row.reviewFile)})).value);
  need(preview.previewSha256===row.previewSha256&&JSON.stringify(preview.intent)===JSON.stringify(row.intent)&&Array.isArray(preview.draft.items),
    'The original customer review changed before reading its pass labels.','REVIEW_CHANGED');
  const value=passLabels(preview.draft,row.servicePeriod),bytes=Buffer.byteLength(json(value));
  if(bytes<=32_000_000){
    const previous=reviewLabels.get(key);if(previous){reviewLabelBytes-=previous.bytes;reviewLabels.delete(key);}
    while(reviewLabelBytes+bytes>32_000_000&&reviewLabels.size){
      const first=reviewLabels.keys().next().value;reviewLabelBytes-=reviewLabels.get(first).bytes;reviewLabels.delete(first);
    }
    reviewLabels.set(key,{value,bytes});reviewLabelBytes+=bytes;
  }
  return structuredClone(value);
}
/** Observe the existing saved cycle by customer without taking its writer lease. */
export async function inspectAccountingStatementCustomerDossiers({directory,signal}={}){
  signal?.throwIfAborted();const report=await observeAccountingStatementCycle({directory}),labels=new Map();
  for(const row of report.rows)labels.set(row.index,await labelsForReview(report.directory,report,row,signal));
  signal?.throwIfAborted();return {schema:GROUPS,cycle:cycleIdentity(report),customers:customerGroups(report,labels)};
}
function nativeFiles(statement){
  need(plain(statement.files),'The original statement has no retained file manifest.','FILE_IDENTITY');
  const names=Object.keys(statement.files).sort(compare);
  need(BASE.every(name=>names.includes(name))&&names.every(name=>NAME.test(name)&&name.length<=53&&!LOCAL.includes(name))&&
    (PERIOD.every(name=>names.includes(name))||PERIOD.every(name=>!names.includes(name))),
    'Receive the complete original statement artifact set before making a customer handover.','FILES_INCOMPLETE');
  return names.map(name=>({name,...identity(statement.files[name])}));
}
function sameFiles(actual,expected){
  if(!Array.isArray(actual)||actual.length!==expected.length)return false;
  const map=new Map(actual.map(file=>[file.name,file]));
  return map.size===expected.length&&expected.every(file=>map.get(file.name)?.sha256===file.sha256&&map.get(file.name)?.bytes===file.bytes);
}
async function sourceStatement(directory,report,row,summary){
  const path=await privateDirectory(join(directory,'items',String(row.index+1).padStart(6,'0'),'delivery'));
  const original=nativeFiles(row.statement),byName=new Map(original.map(file=>[file.name,file]));
  need(row.delivery.statementId===row.statement.id&&row.delivery.workspace===report.workspace&&sameFiles(row.delivery.files,original),
    'The saved delivery identifies a different original statement.','STATEMENT_IDENTITY');
  const document=(await readJson(join(path,'statement.json'),{expected:byName.get('statement.json')})).value;
  const {id,number,createdAt,retainedBy,previewSha256,...draft}=document;
  need(document.schema==='stellar-forge.merchant-customer-statement.v1'&&id===row.statement.id&&number===row.statement.number&&
    document.customer?.id===row.customer.id&&Array.isArray(document.items)&&previewSha256===row.previewSha256&&digest(draft)===row.previewSha256&&
    document.source?.runId===row.intent.runId&&
    (document.source.usage?.id??null)===row.intent.usageId&&
    (document.source.usageOpening?.id??null)===(row.intent.usageOpeningId??null),
    'The original statement document differs from this customer and frozen review.','STATEMENT_IDENTITY');
  need(Boolean(document.servicePeriod)===PERIOD.every(name=>byName.has(name)),
    'The original service-period statement is missing part of its native source set.','FILES_INCOMPLETE');
  const manifest=(await readJson(join(path,'manifest.json'),{expected:byName.get('manifest.json')})).value;
  need(manifest.schema==='stellar-forge.merchant-customer-statement-files.v1'&&manifest.id===id&&manifest.number===number&&
    manifest.customerId===row.customer.id&&plain(manifest.files)&&
    sameFiles(Object.entries(manifest.files).map(([name,metadata])=>({name,...metadata})),original.filter(file=>file.name!=='manifest.json'))&&
    JSON.stringify(manifest.source)===JSON.stringify(document.source),
    'The native artifact manifest belongs to another customer statement.','STATEMENT_IDENTITY');
  const statusIdentity=identity(row.delivery.statusFile),indexIdentity=identity(row.delivery.indexFile);
  need(row.delivery.statusFile.name==='status.json'&&row.delivery.indexFile.name==='index.html',
    'The customer delivery lost its original status or index identity.','FILES_INCOMPLETE');
  const status=(await readJson(join(path,'status.json'),{expected:statusIdentity,maximum:1_000_000})).value,record=status.statement;
  need(status.schema==='stellar-forge.merchant-customer-statement-status.v1'&&record?.id===id&&record.customerId===row.customer.id&&
    record.requestId===row.requestId&&record.previewSha256===row.previewSha256&&record.intentSha256===row.statement.intentSha256&&
    record.status===summary.statement.status&&status.observedAt===row.delivery.statusObservedAt&&
    sameFiles(Object.entries(record.files??{}).map(([name,metadata])=>({name,...metadata})),original)&&Array.isArray(record.history),
    'The native status snapshot belongs to a different original customer request.','STATEMENT_IDENTITY');
  const delivery=await readJson(join(path,'delivery.json'),{maximum:1_000_000});
  need(delivery.value.schema==='stellar-forge.accounting-statement-delivery.v1'&&delivery.value.workspace===report.workspace&&
    delivery.value.statementId===id&&delivery.value.number===number&&delivery.value.complete===true&&sameFiles(delivery.value.files,original),
    'The original exporter record differs from this customer packet.','STATEMENT_IDENTITY');
  const prefix='statements/'+id,files=[...original,{name:'status.json',...statusIdentity},{name:'index.html',...indexIdentity},
    {name:'delivery.json',sha256:delivery.sha256,bytes:delivery.bytes}].map(({name,...metadata})=>({path:prefix+'/'+name,...metadata,source:join(path,name)}));
  const labels=passLabels(document,summary.servicePeriod);
  const withdrawal=record.history.findLast(item=>item.action==='withdrawn')??null;
  return {files,statement:{...summary,included:true,path:prefix,statement:{...summary.statement,
      replacesId:record.replacesId??null,supersededBy:record.supersededBy??null},
    ...labels,
    statusObservedAt:status.observedAt,withdrawal:withdrawal?{at:withdrawal.at,actor:withdrawal.actor,reason:withdrawal.reason}:null,
    orders:document.items.length,reportSha256:document.source.reportSha256}};
}
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function csvCell(value){
  let text=value===null||value===undefined?'':String(value);
  const numeric=typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&/^-?(?:0|[1-9][0-9]*)$/.test(value);
  if(!numeric&&(/^\s*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text)))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
const csv=rows=>rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
function statementCsv(customer,rows){
  const headers=['customerReference','cycleRow','requestId','statementId','statementNumber','status','phase','included',
    'kind','orderRef','serviceFrom','serviceUntil','usageCapturedAt','statusObservedAt','replacesId','supersededBy','statementPath','planId','planRevision','planLabel','purchasePasses'];
  return csv([headers,...rows.map(row=>[customer.reference,row.index+1,row.requestId,row.statement?.id,row.statement?.number,row.statement?.status,
    row.phase,row.included?'yes':'no',row.servicePeriod?'SERVICE_PERIOD':row.usageSource?'CUMULATIVE':'PURCHASE',row.servicePeriod?.orderRef,row.servicePeriod?.from,
    row.servicePeriod?.until,row.usageSource?.createdAt,row.statusObservedAt,row.statement?.replacesId,row.statement?.supersededBy,
    row.path?row.path+'/statement.html':'',row.plan?.id,row.plan?.revision,row.plan?.label,
    row.passes.map(pass=>[pass.label,pass.plan?.label,pass.orderRef].filter(Boolean).join(' · ')).join('; ')])]);
}
function periodCsv(customer,rows){
  const headers=['customerReference','statementNumber','orderRef','planId','planRevision','planLabel','status','included','from','until',
    'openingSourceId','openingSourceSha256','closingSourceId','closingSourceSha256','openingPurchased','openingConsumed','openingReserved','openingAvailable',
    'closingPurchased','closingConsumed','closingReserved','closingAvailable','periodAdmitted','periodConsumed','periodReleased','reservedDelta','availableDelta','newCalls','resultRecoveries','periodPath'];
  return csv([headers,...rows.filter(row=>row.servicePeriod).map(row=>{
    const period=row.servicePeriod;
    return [customer.reference,row.statement?.number,period.orderRef,row.plan?.id,row.plan?.revision,row.plan?.label,row.statement?.status,row.included?'yes':'no',
      period.from,period.until,period.openingSource?.id,period.openingSource?.sha256,period.closingSource?.id,period.closingSource?.sha256,
      period.opening?.unitsPurchased,period.opening?.unitsUsed,period.opening?.unitsReserved,period.opening?.unitsRemaining,
      period.closing?.unitsPurchased,period.closing?.unitsUsed,period.closing?.unitsReserved,period.closing?.unitsRemaining,
      period.totals?.admittedUnits,period.totals?.consumedUnits,period.totals?.releasedUnits,period.totals?.reservedDeltaUnits,
      period.totals?.availableDeltaUnits,period.totals?.newCalls,period.totals?.resultRecoveries,
      row.path?row.path+'/period.csv':''];
  })]);
}
function displayDate(value){
  const date=new Date(value);if(!Number.isFinite(date.getTime()))return String(value??'Not recorded');
  const pad=number=>String(number).padStart(2,'0'),month=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][date.getUTCMonth()];
  return date.getUTCDate()+' '+month+' '+date.getUTCFullYear()+', '+pad(date.getUTCHours())+':'+pad(date.getUTCMinutes())+':'+
    pad(date.getUTCSeconds())+(date.getUTCMilliseconds()?'.'+String(date.getUTCMilliseconds()).padStart(3,'0'):'')+' UTC';
}
const displayStatus=value=>({RETAINED:'Current',SUPERSEDED:'Superseded',WITHDRAWN:'Withdrawn',REVIEWED:'Ready to issue',NOT_RETAINED:'Ready to issue',
  SENDING:'Issuing statement',DELIVERED:'Packet complete',EXPORT_PENDING:'Packet in progress',RECONCILE_PENDING:'Resume original statement',REVIEW_REQUIRED:'Review changed sources'}[value]??String(value??'Pending'));
function renderIndex({customer,cycle,counts:summary,statements,observedAt,complete}){
  const included=new Map(statements.filter(row=>row.included).map(row=>[row.statement.id,row]));
  function related(id,label){
    if(!id)return '';
    const target=included.get(id);
    return '<small>'+label+': '+(target?'<a href="'+target.path+'/index.html">'+escape(target.statement.number)+'</a>':escape(id))+'</small>';
  }
  function passes(row){return row.passes.map(pass=>'<strong>'+escape(pass.plan?.label??pass.label)+'</strong><small>'+escape(pass.orderRef)+
    (pass.plan&&pass.label!==pass.plan.label?' · '+escape(pass.label):'')+'</small>').join('');}
  const rows=statements.map(row=>{
    const period=row.servicePeriod,statement=row.statement,links=row.included?
      '<a href="'+row.path+'/index.html">Open complete packet</a><small><a href="'+row.path+'/statement.html">Statement</a> · '+
      '<a href="'+row.path+'/status.json">Status and history</a></small>':'<span>Packet pending</span>';
    return '<tr><td><strong>'+escape(statement?.number??'Statement pending')+'</strong><small>'+
      escape(period?'Service period':row.usageSource?'Cumulative statement':'Purchase statement')+'</small>'+related(statement?.replacesId,'Corrects')+
      related(statement?.supersededBy,'Replacement')+'</td><td>'+
      (period?'<strong>'+escape(row.plan?.label??period.orderRef)+'</strong><small>'+escape(period.orderRef)+'</small>'+
        escape(displayDate(period.from))+'<small>to '+escape(displayDate(period.until))+'</small>':
        passes(row)+'<small>'+(row.usageSource?'Usage captured '+escape(displayDate(row.usageSource.createdAt)):'Original customer purchases')+'</small>')+'</td><td>'+
      (period?escape(period.totals?.consumedUnits)+' consumed<small>'+escape(period.totals?.releasedUnits)+' released</small>'+
        '<small>Available '+escape(period.opening?.unitsRemaining)+' → '+escape(period.closing?.unitsRemaining)+'</small>':'See original statement')+
      '</td><td><strong>'+escape(displayStatus(statement?.status??row.phase))+'</strong>'+
      (row.statusObservedAt?'<small>Observed '+escape(displayDate(row.statusObservedAt))+'</small>':'')+
      (row.withdrawal?'<small>'+escape(row.withdrawal.reason)+' · '+escape(displayDate(row.withdrawal.at))+'</small>':'')+
      (!row.included?'<small>'+escape(displayStatus(row.phase))+'</small>':'')+'</td><td>'+links+'</td></tr>';
  }).join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+escape(customer.name)+' — customer statements</title><style>'+
    '*{box-sizing:border-box}body{margin:0;color:#222;background:#fff;font:15px/1.5 system-ui,sans-serif}main{max-width:1320px;margin:32px auto;padding:0 24px}'+
    'h1{font-size:28px;margin:0 0 6px}h2{font-size:19px;margin-top:28px}p{max-width:1000px}a{color:#222;text-underline-offset:3px}'+
    'small{display:block;color:#555;overflow-wrap:anywhere}strong{font-weight:650}.summary{display:flex;flex-wrap:wrap;gap:12px 30px;border-block:1px solid #bbb;padding:16px 0;margin:24px 0}'+
    '.summary strong{display:block;font-size:21px}.table{overflow:auto}table{width:100%;border-collapse:collapse;min-width:920px}th,td{text-align:left;padding:12px 10px;border-bottom:1px solid #bbb;vertical-align:top}'+
    'th{background:#f2f2f2}th:first-child,td:first-child{padding-left:0}details{margin-top:25px;padding:12px 0;border-top:1px solid #bbb}summary{cursor:pointer;font-weight:600}dl{font-size:13px;overflow-wrap:anywhere}dt{margin-top:10px;color:#555}dd{margin:0}footer{margin-top:30px;padding-top:16px;border-top:1px solid #bbb;color:#555;font-size:13px;overflow-wrap:anywhere}'+
    '@media(max-width:600px){main{margin:20px auto;padding:0 16px}h1{font-size:24px}.summary{gap:12px 20px}}@media print{main{margin:0;padding:0}.table{overflow:visible}table{min-width:0;font-size:11px}a{text-decoration:none}}'+
    '</style></head><body><main><h1>'+escape(customer.name)+'</h1><p>'+escape(customer.reference)+' · '+escape(cycle.label)+'</p>'+
    '<div class="summary"><div><strong>'+summary.delivered+' of '+summary.total+'</strong>Original packets included</div>'+
    '<div><strong>'+summary.current+'</strong>Current statements</div><div><strong>'+summary.superseded+'</strong>Superseded statements</div>'+
    '<div><strong>'+summary.withdrawn+'</strong>Withdrawn statements</div></div>'+
    '<p>'+(complete?'The complete selected customer handover is available below.':
      escape(summary.pending)+' selected packet'+(summary.pending===1?' is':'s are')+' still being completed. Every included packet is complete.')+
    ' Each statement keeps its original purchase, service capture period and status history.</p>'+
    '<p><a href="statements.csv">Statement register CSV</a> · <a href="periods.csv">Service periods CSV</a> · <a href="dossier.json">Complete file manifest</a></p>'+
    '<h2>Statements and service periods</h2><div class="table"><table><thead><tr><th>Statement</th><th>Purchased pass and period</th><th>Service activity</th><th>Observed status</th><th>Customer files</th></tr></thead><tbody>'+
    rows+'</tbody></table></div><p>Each purchased pass keeps its own plan, service units and original period. Purchase amounts and asset details appear in the original statement files.</p>'+
    '<details><summary>Source references</summary><dl><dt>Customer ID</dt><dd>'+escape(customer.customerId)+'</dd><dt>Original cycle</dt><dd>'+escape(cycle.cycleId)+
    '</dd><dt>Original request SHA256</dt><dd>'+escape(cycle.requestSha256)+'</dd><dt>Original manifest SHA256</dt><dd>'+escape(cycle.manifestSha256)+'</dd></dl></details>'+
    '<footer>Saved statement status through '+escape(displayDate(observedAt))+'</footer></main></body></html>\n';
}
function safePayloadPath(path){
  if(typeof path!=='string'||path.length>100)return false;
  if(['index.html','statements.csv','periods.csv'].includes(path))return true;
  const parts=typeof path==='string'?path.split('/'):[];
  return parts.length===3&&parts[0]==='statements'&&UUID.test(parts[1])&&NAME.test(parts[2]);
}
function validateSnapshot(value){
  exact(value,['schema','cycle','customer','observedAt','complete','counts','statements','files','snapshotSha256']);
  const {snapshotSha256,...payload}=value;
  need(value.schema===SCHEMA&&SHA.test(snapshotSha256??'')&&digest(payload)===snapshotSha256&&
    UUID.test(value.cycle?.cycleId??'')&&SHA.test(value.cycle?.requestSha256??'')&&SHA.test(value.cycle?.manifestSha256??'')&&
    UUID.test(value.customer?.customerId??'')&&typeof value.customer.reference==='string'&&typeof value.customer.name==='string'&&
    timestamp(value.observedAt)&&typeof value.complete==='boolean'&&Array.isArray(value.statements)&&value.statements.length>0&&
    Array.isArray(value.files),'The saved customer dossier manifest changed.','MANIFEST');
  const rows=value.statements,summary=counts(rows);
  need(JSON.stringify(summary)===JSON.stringify(value.counts)&&value.complete===(summary.pending===0)&&summary.delivered>0,
    'The saved customer dossier counts differ from its original rows.','MANIFEST');
  const paths=new Set(),included=new Map();
  for(const row of rows){
    need(Number.isSafeInteger(row.index)&&row.index>=0&&typeof row.requestId==='string'&&SHA.test(row.previewSha256??'')&&PHASE.includes(row.phase)&&
      typeof row.ready==='boolean'&&row.included===row.ready&&
      (!row.statement||UUID.test(row.statement.id??'')&&STATUS.includes(row.statement.status)),
      'The saved dossier row no longer identifies its original statement.','MANIFEST');
    if(row.included){
      need(row.path==='statements/'+row.statement.id&&!included.has(row.statement.id),'The customer dossier repeats a different original packet.','MANIFEST');
      included.set(row.statement.id,row);
    }else need(row.path===null,'A pending dossier row must keep its original pending state.','MANIFEST');
  }
  for(const file of value.files){
    need(safePayloadPath(file.path)&&!paths.has(file.path),'Use only the exact original relative dossier file paths.','MANIFEST');identity(file);paths.add(file.path);
    if(file.path.startsWith('statements/'))need(included.has(file.path.split('/')[1]),'A dossier file belongs to a different customer selection.','MANIFEST');
  }
  need(['index.html','statements.csv','periods.csv'].every(path=>paths.has(path))&&[...included.values()].every(row=>
    [...BASE,...LOCAL,...(row.servicePeriod?PERIOD:[])].every(name=>paths.has(row.path+'/'+name))),
    'The customer dossier no longer contains each complete original packet.','FILES_INCOMPLETE');
  return value;
}
/** Read a copied immutable snapshot without the cycle or merchant connection. */
export async function readAccountingStatementCustomerDossier({directory,signal,verifyFiles=false}={}){
  need(typeof verifyFiles==='boolean','Choose whether to verify every saved payload file.');signal?.throwIfAborted();
  directory=await privateDirectory(directory);
  const file=await readJson(join(directory,'dossier.json')),snapshot=validateSnapshot(file.value);
  if(verifyFiles)for(const item of snapshot.files){
    await privateDirectory(dirname(join(directory,item.path)));await verifyFile(join(directory,item.path),item,signal);
  }
  const files=[...snapshot.files,{path:'dossier.json',sha256:file.sha256,bytes:file.bytes}];
  return {directory,...snapshot,files,totalBytes:files.reduce((total,item)=>total+item.bytes,0)};
}
/** Export this customer's complete saved row packets, retaining each original request and lifecycle. */
export async function exportAccountingStatementCustomerDossier({directory,customerId,outputDirectory,signal}={}){
  need(UUID.test(customerId??''),'Choose the original customer UUID.');signal?.throwIfAborted();
  directory=await privateDirectory(directory);const cycleLease=await acquireStateLease(directory);let outputLease;
  try{
    const report=await observeAccountingStatementCycle({directory}),group=customerGroups(report).find(item=>item.customerId===customerId);
    need(group,'Choose a customer in this original saved cycle.','CUSTOMER_NOT_FOUND');
    need(group.counts.delivered>0,'Complete at least one original customer packet before exporting this handover.','DELIVERY_PENDING');
    outputDirectory=await privateDirectory(outputDirectory,{create:true});outputLease=await acquireStateLease(outputDirectory);
    const owner={schema:'stellar-forge.accounting-statement-customer-dossier-owner.v1',cycleId:report.cycleId,
      requestSha256:report.requestSha256,customerId},ownerPath=join(outputDirectory,'.dossier-owner.json');
    if(await optionalStat(ownerPath))need(JSON.stringify((await readJson(ownerPath,{maximum:65536})).value)===JSON.stringify(owner),
      'This customer export directory belongs to a different original customer or cycle.','OUTPUT_IDENTITY');
    else await saveGenerated(ownerPath,json(owner),signal);
    const statements=[],originalFiles=[];
    for(const index of group.rowIndexes){
      signal?.throwIfAborted();cycleLease.assertHeld();outputLease.assertHeld();
      const row=report.rows[index],summary=rowSummary(row,report.preparedAt);
      if(summary.ready){const original=await sourceStatement(directory,report,row,summary);statements.push(original.statement);originalFiles.push(...original.files);}
      else statements.push({...summary,...await labelsForReview(directory,report,row,signal),included:false,path:null,statusObservedAt:null,withdrawal:null,orders:null,reportSha256:null});
    }
    const customer={customerId:group.customerId,reference:group.reference,name:group.name},cycle=cycleIdentity(report),summary=counts(statements);
    const observedAt=[report.preparedAt,...statements.map(row=>row.sourceObservedAt)].filter(timestamp)
      .sort((a,b)=>Date.parse(a)-Date.parse(b)||compare(a,b)).at(-1);
    const base={schema:SCHEMA,cycle,customer,observedAt,complete:summary.pending===0,counts:summary,statements};
    const generated=new Map([['index.html',renderIndex(base)],['statements.csv',statementCsv(customer,statements)],['periods.csv',periodCsv(customer,statements)]]);
    const files=[...originalFiles.map(({source,...file})=>file),...[...generated].map(([path,bytes])=>({path,sha256:hash(bytes),bytes:Buffer.byteLength(bytes)}))]
      .sort((a,b)=>compare(a.path,b.path));
    const payload={...base,files},snapshot={...payload,snapshotSha256:digest(payload)};validateSnapshot(snapshot);
    const target=join(outputDirectory,snapshot.snapshotSha256);
    if(await optionalStat(target)){
      const saved=await readAccountingStatementCustomerDossier({directory:target,signal,verifyFiles:true});
      need(saved.snapshotSha256===snapshot.snapshotSha256,'The published customer snapshot differs from its original source.','SNAPSHOT_IDENTITY');
      return {...saved,reused:true};
    }
    const pending=await privateDirectory(join(outputDirectory,'.preparing-'+snapshot.snapshotSha256),{create:true});
    try{
      const copies=join(pending,'statements');await privateDirectory(copies,{create:true});
      for(const row of statements.filter(row=>row.included))await privateDirectory(join(pending,row.path),{create:true});
      for(const file of originalFiles)await copyOriginal(file.source,join(pending,file.path),file,{signal,cycleLease,outputLease});
      for(const [path,bytes] of generated)await saveGenerated(join(pending,path),bytes,signal);
      await saveGenerated(join(pending,'dossier.json'),json(snapshot),signal);
      cycleLease.assertHeld();outputLease.assertHeld();await syncDirectory(pending);await rename(pending,target);await syncDirectory(outputDirectory);
      return {...await readAccountingStatementCustomerDossier({directory:target,signal}),reused:false};
    }catch(error){error.dossierDirectory=pending;throw error;}
  }catch(error){error.cycleDirectory=directory;error.customerId=customerId;throw error;}
  finally{try{await outputLease?.close();}finally{await cycleLease.close();}}
}
