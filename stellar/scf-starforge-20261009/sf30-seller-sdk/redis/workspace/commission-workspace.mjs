// MIT. Customer commissioning contracts and handovers in the original workspace.
import { readFile, open, lstat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeRedisCommissioning, redisCommissioningRequestId } from './commission.mjs';
import { redisWorkspaceBinding } from './model.mjs';
import { REDIS_CERTIFICATE_FILES } from '../connection-profile.mjs';
import { compileRedisQueries, bindRedisQuery } from '../declaration.mjs';
import { compileRedisMerchantPlan } from '../prepare.mjs';
import { validateCustomerExportPlan } from './customer-export.mjs';
import { createScientificArchive } from '../../wqx-water-quality/jobs/archive.mjs';

export const COMMISSION_CONTRACT_KIND='commission-contract';
export const COMMISSION_RECEIVE_KIND='commission-receive';
export const COMMISSION_HANDOVER_KIND='commission-handover';
const KINDS=[COMMISSION_CONTRACT_KIND,COMMISSION_RECEIVE_KIND,COMMISSION_HANDOVER_KIND];
const MAX_ATOMIC=170141183460469231731687303715884105727n;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const ordered=v=>Array.isArray(v)?v.map(ordered):plain(v)
  ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
const stable=v=>JSON.stringify(ordered(v));
const sha=v=>createHash('sha256').update(v).digest('hex');
const encode=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const issue=(code,message,status=422)=>Object.assign(new Error(message),{code,status});
export function commissioningFields(value,allowed) {
  if(!plain(value)||Object.keys(value).some(name=>!allowed.includes(name)))
    throw issue('REDIS_COMMISSIONING_FIELDS_INVALID','Use the supported commissioning fields.');
}
function identifier(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value))
    throw issue('REDIS_COMMISSIONING_ID_INVALID','Select the original saved request ID.');
  return value;
}
function digest(value){
  if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))
    throw issue('REDIS_COMMISSIONING_DIGEST_INVALID','Select the reviewed complete input digest.');
  return value;
}
function blob(workspace,key){
  const row=workspace.db.prepare('SELECT bytes FROM blobs WHERE sha=?').get(digest(key));
  if(!row||sha(row.bytes)!==key)
    throw issue('REDIS_COMMISSIONING_BLOB_CHANGED','An original retained file is missing or changed.');
  return Buffer.from(row.bytes);
}
function sourceSetup(workspace,revisionId){
  const meta=workspace.metadata(),revision=workspace.revision(revisionId??meta.head),certificates={};
  for(const item of REDIS_CERTIFICATE_FILES)
    if(meta[item.fingerprint])certificates[item.profile]=new TextDecoder('utf-8',{fatal:true}).decode(blob(workspace,meta[item.fingerprint]));
  return {label:meta.label,source:structuredClone(revision.source),plan:structuredClone(revision.plan),certificates};
}
function defaultCustomerPlan(input) {
  const compiled=compileRedisMerchantPlan(input.setup.source.queries,input.setup.plan);
  let aggregate=0n;
  const products=input.setup.plan.routes.map(route=>{
    const spec=input.setup.source.queries[route.query],offer=compiled.service.routes.find(item=>item.id===route.id).offer;
    const selected=offer.accepts[0],amount=String(selected.amount);
    aggregate+=BigInt(amount);
    return {id:route.id,query:route.query,kind:spec.kind,
      ...(spec.kind==='set'?{cursorParameter:spec.cursor}:{}),
      input:Object.fromEntries(Object.entries(route.example??{}).map(([key,value])=>[key,String(value)])),
      maxAtomic:amount,acceptIndex:0,paymentFlow:'authorization'};
  });
  return {schema:'tjlabs.redis-customer-export.v1',operationId:input.operationId+'-customer',
    budget:{maxCalls:Math.max(products.length,1),maxAtomic:String(aggregate>MAX_ATOMIC?MAX_ATOMIC:aggregate)},
    response:{maxBytes:1048576,timeoutMs:30000},products};
}
export function commissioningTemplate(workspace,{revisionId}={}) {
  const setup=sourceSetup(workspace,revisionId),selected=workspace.revision(revisionId??workspace.metadata().head);
  const input={schema:'stellar-forge.redis-commissioning-input.v1',
    operationId:'customer-'+selected.id.slice(0,16),requestId:'customer-create-'+selected.id.slice(0,16),setup,
    checks:setup.plan.routes.map((route,index)=>({id:'example-'+(index+1),query:route.query,input:structuredClone(route.example??{}),
      allPages:false,maxPages:100,maxRows:10000,expected:{rowCount:1}}))};
  return {revisionId:selected.id,input,customerPlan:defaultCustomerPlan(input)};
}
function customerReview(selected,customerPlan){
  if(customerPlan===null||customerPlan===undefined)return null;
  if(encode(customerPlan).length>1048576)throw issue('REDIS_COMMISSIONING_CUSTOMER_PLAN_TOO_LARGE','Keep the complete customer export plan within 1 MiB.');
  const plan=validateCustomerExportPlan(customerPlan),compiled=compileRedisMerchantPlan(selected.setup.source.queries,selected.setup.plan);
  const queries=compileRedisQueries(selected.setup.source.queries),terms=[];
  for(const product of plan.products){
    const route=selected.setup.plan.routes.find(row=>row.id===product.id),native=route&&selected.setup.source.queries[route.query];
    const operation=compiled.service.routes.find(row=>row.id===product.id),offer=operation?.offer.accepts[product.acceptIndex];
    if(!route||!native||(route.method??'GET')!=='GET'||(product.query??product.id)!==route.query||product.kind!==native.kind||
        native.kind==='set'&&(product.cursorParameter??'cursor')!==native.cursor||!offer)
      throw issue('REDIS_COMMISSIONING_CUSTOMER_BINDING_CHANGED','Select the saved GET operation, source query, read kind and offer.');
    bindRedisQuery(queries[route.query],product.input);
    if(BigInt(offer.amount)>BigInt(product.maxAtomic))
      throw issue('REDIS_COMMISSIONING_CUSTOMER_BUDGET_INVALID','The selected product price exceeds its per-call ceiling.');
    terms.push({id:product.id,query:route.query,kind:native.kind,path:route.path,
      network:offer.network,asset:offer.asset,payTo:offer.payTo,advertisedAtomic:String(offer.amount),
      maxAtomic:product.maxAtomic,acceptIndex:product.acceptIndex,paymentFlow:product.paymentFlow});
  }
  if(new Set(terms.map(row=>stable([row.network,row.asset]))).size!==1)
    throw issue('REDIS_COMMISSIONING_CUSTOMER_CURRENCY_INVALID','Use one payment network and asset for an aggregate customer budget.');
  return {plan,terms};
}
export function reviewCommissioningContract(workspace,options){
  commissioningFields(options,['revisionId','input','customerPlan']);
  const selected=normalizeRedisCommissioning(options.input,workspace.environment),revision=workspace.revision(options.revisionId);
  const meta=workspace.metadata(),binding=redisWorkspaceBinding(meta);
  if(stable(selected.setup.source)!==stable(revision.source)||stable(selected.setup.plan)!==stable(revision.plan))
    throw issue('REDIS_COMMISSIONING_REVISION_CHANGED','Select the saved revision matching this complete source and merchant plan.',409);
  for(const item of REDIS_CERTIFICATE_FILES)
    if((selected.setup.certificates[item.profile]?sha(selected.setup.certificates[item.profile]):null)!==(meta[item.fingerprint]??null))
      throw issue('REDIS_COMMISSIONING_PROFILE_CHANGED','The commissioning contract differs from the retained connection authority.',409);
  const customer=customerReview(selected,options.customerPlan);
  const identity={workspaceId:binding.workspaceId,profileSha256:binding.profileSha256,revisionId:revision.id,
    input:options.input,customerPlan:customer?.plan??null};
  return {schema:'stellar-forge.redis-commissioning-contract-review.v1',
    digest:sha(stable(identity)),inputSha256:sha(stable(options.input)),revisionId:revision.id,
    workspace:{workspaceId:binding.workspaceId,profileSha256:binding.profileSha256,label:binding.label},
    review:selected.review,customer};
}
export function commissionRecord(workspace,requestId,kind){
  const record=workspace.operation(identifier(requestId));
  if(kind!==undefined&&record.kind!==kind)
    throw issue('REDIS_COMMISSIONING_RECORD_INVALID','Select the original '+kind+' operation.',409);
  return record;
}
export function commissionContract(workspace,requestId){
  const record=commissionRecord(workspace,requestId,COMMISSION_CONTRACT_KIND);
  if(record.status!=='COMPLETED')
    throw issue('REDIS_COMMISSIONING_CONTRACT_REQUIRED','Select a saved commissioning contract.',409);
  return record;
}
export function commissioningSummary(record){
  return {id:record.id,kind:record.kind,status:record.status,createdAt:record.createdAt,finishedAt:record.finishedAt,
    revisionId:record.input.revisionId??record.result?.revisionId??null,
    contractId:record.input.contractId??null,runId:record.input.runId??null,note:record.input.note??'',
    outcome:record.result?.status??null,error:record.error??null,progress:record.progress??null,
    attempts:record.attempts,resumable:record.status==='INTERRUPTED',
    ...(record.kind===COMMISSION_HANDOVER_KIND&&record.result?{file:record.result.file}:{}),
    ...(record.kind===COMMISSION_CONTRACT_KIND?{operationId:record.input.input.operationId,checks:record.input.input.checks.length}:{}),
    ...(record.kind===COMMISSION_RECEIVE_KIND&&record.result?{checks:record.result.checks?.map(check=>({
      id:check.id,query:check.query,passed:check.passed,rowCount:check.rowCount,pageCount:check.pages.length,mismatches:check.mismatches}))??[]}:{}),
  };
}
export function commissioningHistory(workspace,{after='',limit=20}={}){
  if(!Number.isInteger(limit)||limit<1||limit>100)
    throw issue('REDIS_COMMISSIONING_PAGE_INVALID','Choose a page size from 1 to 100.');
  let position=Number.MAX_SAFE_INTEGER;
  if(after){
    const row=workspace.db.prepare('SELECT rowid AS position FROM operations WHERE id=?').get(identifier(after));
    if(!row)throw issue('REDIS_COMMISSIONING_PAGE_INVALID','Select a retained history cursor.');
    position=row.position;
  }
  const rows=workspace.db.prepare("SELECT value FROM operations WHERE rowid<? AND json_extract(value,'$.kind') IN (?,?,?) ORDER BY rowid DESC LIMIT ?")
    .all(position,...KINDS,limit+1).map(row=>JSON.parse(row.value)),more=rows.length>limit;
  if(more)rows.pop();
  return {items:rows.map(commissioningSummary),nextCursor:more?rows.at(-1).id:null};
}
export function commissioningRows(workspace,{runId,checkId,cursor='',limit=50}={}){
  if(!Number.isInteger(limit)||limit<1||limit>100||typeof cursor!=='string'||cursor&&!/^(0|[1-9][0-9]*):(0|[1-9][0-9]*)$/.test(cursor))
    throw issue('REDIS_COMMISSIONING_PAGE_INVALID','Select the original result cursor and 1–100 rows.');
  const run=commissionRecord(workspace,runId,COMMISSION_RECEIVE_KIND),contract=commissionContract(workspace,run.input.contractId);
  const input=contract.input.input,original=input.checks.find(value=>value.id===checkId);
  const check=original?{...original,maxPages:original.maxPages??100,maxRows:original.maxRows??10000}:null;
  if(!check)throw issue('REDIS_COMMISSIONING_CHECK_INVALID','Select a check in this saved contract.',404);
  let [page,offset]=cursor?cursor.split(':').map(Number):[0,0];
  if(!Number.isSafeInteger(page)||!Number.isSafeInteger(offset)||page>=check.maxPages||offset>check.maxRows)
    throw issue('REDIS_COMMISSIONING_PAGE_INVALID','The result cursor is outside this receiving contract.');
  const rows=[],pages=[];let columns=null,nextCursor=null,complete=false,sourceIncomplete=null;
  const observed=run.result?.checks?.find(value=>value.id===checkId);
  for(let visited=0;visited<20&&rows.length<limit;visited++){
    const requestId=redisCommissioningRequestId(input,'preview-'+check.id+'-'+page,run.id);
    const record=workspace.record('operations',requestId,false);
    if(!record||record.status!=='COMPLETED'){
      nextCursor=page+':'+offset;
      return {runId,checkId,columns,rows,pages,nextCursor,complete:false,
        waiting:['RUNNING','QUEUED','INTERRUPTED'].includes(run.status),operation:record?workspace.operationSummary(record):null,expected:check.expected};
    }
    if(record.kind!=='preview'||record.input.revisionId!==contract.input.revisionId||record.input.query!==check.query)
      throw issue('REDIS_COMMISSIONING_RESULT_CHANGED','The saved page belongs to a different receiving source.',409);
    const data=record.result.data;
    if(!Array.isArray(data.columns)||!Array.isArray(data.rows)||offset>data.rows.length)
      throw issue('REDIS_COMMISSIONING_RESULT_INVALID','The retained source page is incomplete.');
    columns??=data.columns;
    if(stable(columns)!==stable(data.columns))throw issue('REDIS_COMMISSIONING_COLUMNS_CHANGED','The retained columns changed.');
    const selected=data.rows.slice(offset,offset+limit-rows.length);
    rows.push(...selected);pages.push({requestId,page,offset,rows:selected.length,observedAt:record.result.observedAt});
    offset+=selected.length;
    if(offset<data.rows.length){nextCursor=page+':'+offset;break;}
    const hasNext=check.allPages&&data.nextInput!==undefined&&data.nextInput!==null;
    if(!hasNext){
      const incomplete=check.allPages&&(data.truncated!==false||data.continuationUnavailable!==undefined&&data.continuationUnavailable!==null||
        data.kind==='set'&&(data.scanComplete!==true||data.scanCursor!=='0'));
      complete=!incomplete;nextCursor=null;
      if(incomplete)sourceIncomplete={requestId,truncated:data.truncated??null,continuationUnavailable:data.continuationUnavailable??null,
        scanCursor:data.scanCursor??null,scanComplete:data.scanComplete??null};
      break;
    }
    page++;offset=0;nextCursor=page+':0';
    if(page>=check.maxPages){complete=false;break;}
  }
  return {runId,checkId,columns,rows,pages,nextCursor,complete,sourceIncomplete,waiting:false,expected:check.expected,
    outcome:observed?{passed:observed.passed,mismatches:observed.mismatches,rowCount:observed.rowCount,rowsSha256:observed.rowsSha256}:null};
}
export async function captureCommissioningHandover(workspace,input){
  commissioningFields(input,['requestId','runId']);identifier(input.requestId);
  const existing=workspace.record('operations',input.requestId,false);
  if(existing){
    if(existing.kind!==COMMISSION_HANDOVER_KIND||existing.input.runId!==input.runId)
      throw issue('REDIS_WORKSPACE_REQUEST_CHANGED','This request ID belongs to different handover input.',409);
    return structuredClone(existing.input);
  }
  const run=commissionRecord(workspace,input.runId,COMMISSION_RECEIVE_KIND);
  if(run.status!=='COMPLETED'||run.result?.status!=='RECEIVED'||!run.result.package)
    throw issue('REDIS_COMMISSIONING_RECEIVING_REQUIRED','Complete the selected receiving run before making its customer handover.',409);
  const [application,guide]=await Promise.all(['customer-export.mjs','CUSTOMER_EXPORT.md'].map(path=>readFile(new URL('./'+path,import.meta.url))));
  const applicationSha256=sha(application),guideSha256=sha(guide);
  workspace.transaction(()=>{
    for(const bytes of [application,guide])workspace.db.prepare('INSERT OR IGNORE INTO blobs(sha,bytes) VALUES(?,?)').run(sha(bytes),bytes);
  });
  return {...input,applicationSha256,guideSha256};
}
export async function createCommissioningHandover(workspace,record){
  const input=record.input,run=commissionRecord(workspace,input.runId,COMMISSION_RECEIVE_KIND);
  if(run.status!=='COMPLETED'||run.result?.status!=='RECEIVED')
    throw issue('REDIS_COMMISSIONING_RECEIVING_REQUIRED','Select a completed receiving run.',409);
  const contract=commissionContract(workspace,run.input.contractId),result=run.result;
  const packageRecord=workspace.operation(result.package.requestId),customerPlan=contract.input.customerPlan??null;
  const path=join(workspace.root,'interrupted','commission-handover-'+record.id+'.zip');
  const prior=await lstat(path).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(prior){
    if(record.attempts<2||!prior.isFile()||prior.isSymbolicLink()||prior.nlink!==1||
        process.platform!=='win32'&&(prior.mode&0o077))
      throw issue('REDIS_COMMISSIONING_HANDOVER_PATH_CHANGED','The original handover staging path changed.',409);
    await unlink(path);
  }
  let archive;
  try{
    archive=await createScientificArchive(path);
    const publicFiles=[];
    for(const selected of result.package.customerFiles){
      const file=await workspace.file(result.package.requestId,selected.path);
      if(file.bytes.length!==selected.bytes||sha(file.bytes)!==selected.sha256)
        throw issue('REDIS_COMMISSIONING_CUSTOMER_FILE_CHANGED','The original customer package changed after receiving.',409);
      publicFiles.push(await archive.add(selected.path,file.bytes,{contentType:file.type,expected:selected}));
    }
    const acceptance={schema:'stellar-forge.redis-customer-handover.v1',
      workspace:contract.result.workspace,revisionId:contract.input.revisionId,
      contractId:contract.id,receivingId:run.id,inputSha256:contract.result.inputSha256,
      completedAt:run.finishedAt,status:result.status,
      products:contract.input.input.setup.plan.routes.map(route=>({id:route.id,query:route.query,path:route.path,
        kind:contract.input.input.setup.source.queries[route.query].kind,example:route.example??{}})),
      checks:result.checks,package:{requestId:result.package.requestId,manifestSha256:result.package.manifestSha256,customerFiles:publicFiles},
      release:result.release??null,
      application:customerPlan?{schema:customerPlan.schema,operationId:customerPlan.operationId,
        applicationSha256:input.applicationSha256,guideSha256:input.guideSha256}:null};
    await archive.add('receiving.json',encode(acceptance),{contentType:'application/json'});
    if(customerPlan){
      validateCustomerExportPlan(customerPlan);
      await archive.add('customer-export.plan.json',encode(customerPlan),{contentType:'application/json'});
      await archive.add('customer-export.mjs',blob(workspace,input.applicationSha256),{contentType:'text/javascript'});
      await archive.add('CUSTOMER_APPLICATION.md',blob(workspace,input.guideSha256),{contentType:'text/markdown'});
    }
    const readme=[
      '# Redis / Valkey customer handover','',
      'Received merchant: '+contract.input.input.setup.plan.publicOrigin,
      'Saved source revision: '+contract.input.revisionId,
      'Receiving run: '+run.id,'',
      'The client/ directory is the original complete generated seller-client export.',
      'Keep its module, types, OpenAPI, package metadata, README and client-export.json together.',
      'receiving.json contains the selected product mapping and original native receiving outcomes.',
      ...(customerPlan?['','## Review the customer export application','',
        'Use the existing installed Starforge SDK and the customer buyer context. Set SDK_ROOT to its stellar/scf-starforge-20261009 directory.',
        '', 'node customer-export.mjs review --sdk-root "$SDK_ROOT" --client ./client --plan ./customer-export.plan.json --out /CUSTOMER/new-export',
        '', 'node customer-export.mjs run --sdk-root "$SDK_ROOT" --client ./client --plan ./customer-export.plan.json --out /CUSTOMER/new-export --buyer-context /CUSTOMER/existing-buyer-context.mjs',
        '', 'The reviewed plan retains the selected call budget, atomic limits, offer and payment flow. CUSTOMER_APPLICATION.md describes the original buyer and response writer.']:[]),
      '', 'Use the original merchant release controls to select and operate the staged release.','',
    ].join('\n');
    await archive.add('README.md',Buffer.from(readme),{contentType:'text/markdown'});
    const packed=await archive.finish(),file=await open(path,'r');let bytes;
    try{const before=await file.stat();bytes=await file.readFile();if(!before.isFile()||bytes.length!==packed.bytes||before.size!==packed.bytes)
      throw issue('REDIS_COMMISSIONING_HANDOVER_CHANGED','The completed handover bytes changed.');}
    finally{await file.close();}
    const key=sha(bytes);
    workspace.db.prepare('INSERT OR IGNORE INTO blobs(sha,bytes) VALUES(?,?)').run(key,bytes);
    return {schema:'stellar-forge.redis-commissioning-handover.v1',status:'HANDOVER_READY',
      runId:run.id,contractId:contract.id,revisionId:contract.input.revisionId,
      file:{name:'redis-customer-'+run.id+'.zip',bytes:bytes.length,sha256:key,type:'application/zip'},
      members:packed.members,logicalBytes:packed.logicalBytes,packageId:packageRecord.id,
      customerPlan:customerPlan?{operationId:customerPlan.operationId,products:customerPlan.products.length}:null};
  } finally {await archive?.close();await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export function commissioningHandoverFile(workspace,requestId){
  const operation=commissionRecord(workspace,requestId,COMMISSION_HANDOVER_KIND);
  if(operation.status!=='COMPLETED'||operation.result?.status!=='HANDOVER_READY')
    throw issue('REDIS_COMMISSIONING_HANDOVER_REQUIRED','Choose the completed original handover.',409);
  const selected=operation.result.file,bytes=blob(workspace,selected.sha256);
  if(bytes.length!==selected.bytes)throw issue('REDIS_COMMISSIONING_HANDOVER_CHANGED','The retained handover size changed.');
  return {...selected,bytes};
}
