// MIT. Complete customer closing cycles over the existing original statement client.
import {constants} from 'node:fs';
import {open,mkdir,realpath,lstat,rename,unlink,link} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {writePrivate,privateSupportDirectory} from './host-files.mjs';
import {accountingStatementSelection,accountingStatementPreview,accountingStatementRetentionArguments,connectAccountingStatementClient} from './accounting-statement-client.mjs';
import {exportAccountingStatement,downloadAccountingStatementStatus} from './accounting-statement-cli.mjs';

const PREFIX='stellar-forge.accounting-statement-cycle',UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/,REQUEST_LIMIT=20_000_000,REVIEW_LIMIT=128_000_000;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const json=value=>JSON.stringify(value)+'\n';
const sha=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>sha(JSON.stringify(value));
const now=()=>new Date().toISOString();
const fail=(code,message)=>Object.assign(new Error(message),{code:'ACCOUNTING_STATEMENT_CYCLE_'+code});
const problem=error=>({code:error.code??'ERROR',message:String(error.message).slice(0,1000)});
function need(ok,message,code='ARGUMENTS'){if(!ok)throw fail(code,message);}
function exact(value,fields){need(plain(value)&&Object.keys(value).every(key=>fields.includes(key)),'Use the declared closing-cycle fields.');}
function label(value,name,max){need(typeof value==='string'&&value.trim().length>0&&value.trim().length<=max&&!/[\u0000-\u001f\u007f]/.test(value),'Supply the '+name+'.');return value.trim();}
function endpoint(url){
  let value;try{value=new URL(url);}catch{throw fail('CONNECTION','Supply the existing merchant MCP endpoint.');}
  need(!value.username&&!value.password&&!value.search&&!value.hash&&(value.protocol==='https:'||
    value.protocol==='http:'&&['127.0.0.1','[::1]'].includes(value.hostname)),
    'Use the existing HTTPS or loopback HTTP endpoint without credentials, query or fragment.','CONNECTION');
  return value.href;
}
async function privateDirectory(path,{create=false}={}){
  path=resolve(path);
  if(create){await privateDirectory(dirname(path));await mkdir(path,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});}
  await privateSupportDirectory(path);const info=await lstat(path);
  need(await realpath(path)===path&&(!process.getuid||info.uid===process.getuid()),
    'Use an owner-controlled private directory without symlink ancestors.','DIRECTORY');
  return path;
}
async function syncDirectory(path){const handle=await open(path,constants.O_RDONLY);try{await handle.sync();}finally{await handle.close();}}
async function saved(path,maximum){
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const info=await handle.stat();
    need(info.isFile()&&info.size<=maximum&&!(info.mode&0o077)&&(!process.getuid||info.uid===process.getuid()),
      'Use the original private closing-cycle file.','FILE');
    const bytes=await handle.readFile();need(bytes.length<=maximum,'The closing-cycle file exceeds its original size limit.','SIZE');
    let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
    catch{throw fail('FILE','The original closing-cycle file is not complete UTF-8 JSON.');}
    return {value,sha256:sha(bytes),bytes:bytes.length};
  }finally{await handle.close();}
}
async function optional(path,maximum){try{return await saved(path,maximum);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function publish(path,value,{replace=false,lease}={}){
  const bytes=typeof value==='string'?value:json(value),temporary=join(dirname(path),'cycle-write-'+randomUUID()+'.partial');
  try{
    await writePrivate(temporary,bytes);lease?.assertHeld();
    if(replace)await rename(temporary,path);
    else await link(temporary,path);
    await syncDirectory(dirname(path));
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return {sha256:sha(bytes),bytes:Buffer.byteLength(bytes)};
}
function validateRequest(value){
  exact(value,['schema','cycleId','createdAt','url','workspace','tokenEnv','actor','label','selections','sha256']);
  const {sha256,...content}=value;
  need(value.schema===PREFIX+'-request.v1'&&UUID.test(value.cycleId??'')&&Number.isFinite(Date.parse(value.createdAt))&&
    SHA.test(sha256??'')&&digest(content)===sha256&&endpoint(value.url)===value.url&&
    /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.workspace??'')&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.tokenEnv??'')&&
    label(value.actor,'operator',1000)===value.actor&&label(value.label,'cycle label',200)===value.label&&
    Array.isArray(value.selections)&&value.selections.length>0,'The original closing-cycle request changed.','REQUEST');
  const seen=new Set();
  for(const selection of value.selections){
    const normalized=accountingStatementSelection(selection),key=JSON.stringify(normalized);
    need(key===JSON.stringify(selection)&&!seen.has(key),'Retain each normalized original selection once per cycle.','REQUEST');
    seen.add(key);
  }
  return value;
}
const itemDirectory=(directory,index)=>join(directory,'items',String(index+1).padStart(6,'0'));
const requestId=(request,index)=>'statement-cycle-'+request.cycleId+'-'+String(index+1);
function metadata(request,index,preview,file){
  const period=preview.draft.servicePeriod;
  return {index,requestId:requestId(request,index),intent:structuredClone(preview.intent),
    customer:{id:preview.draft.customer.id,reference:preview.draft.customer.reference,name:preview.draft.customer.name},
    previewSha256:preview.previewSha256,reviewedRevision:preview.revision,reviewFile:file,
    servicePeriod:period?{orderRef:period.orderRef,from:period.from,until:period.until,
      openingSource:period.openingSource,closingSource:period.closingSource,opening:period.opening,closing:period.closing,totals:period.totals}:null,
    usageSource:preview.draft.source.usage??null,orders:preview.draft.items.length};
}
function validateManifest(manifest,request){
  exact(manifest,['schema','cycleId','requestSha256','preparedAt','rows','sha256']);const {sha256,...content}=manifest;
  need(manifest.schema===PREFIX+'.v1'&&manifest.cycleId===request.cycleId&&manifest.requestSha256===request.sha256&&
    Number.isFinite(Date.parse(manifest.preparedAt))&&digest(content)===sha256&&Array.isArray(manifest.rows)&&
    manifest.rows.length===request.selections.length,'The complete closing-cycle review changed.','MANIFEST');
  manifest.rows.forEach((row,index)=>need(row.index===index&&row.requestId===requestId(request,index)&&
    JSON.stringify(row.intent)===JSON.stringify(request.selections[index])&&SHA.test(row.previewSha256??'')&&
    SHA.test(row.reviewFile?.sha256??'')&&Number.isSafeInteger(row.reviewFile?.bytes)&&row.reviewFile.bytes>0&&row.reviewFile.bytes<=REVIEW_LIMIT,
    'The closing-cycle row no longer matches its original reviewed selection.','MANIFEST'));
  return manifest;
}
async function reviewed(directory,request,row){
  const file=await saved(join(itemDirectory(directory,row.index),'review.json'),REVIEW_LIMIT),preview=accountingStatementPreview(file.value);
  need(file.sha256===row.reviewFile.sha256&&file.bytes===row.reviewFile.bytes&&preview.previewSha256===row.previewSha256&&
    JSON.stringify(preview.intent)===JSON.stringify(request.selections[row.index]),
    'The complete original customer review changed.','REVIEW_CHANGED');
  return preview;
}
function initialState(request,row){return {schema:PREFIX+'-item.v1',cycleId:request.cycleId,requestSha256:request.sha256,
  index:row.index,requestId:row.requestId,phase:'REVIEWED',submissionAttempted:false,statement:null,delivery:null,error:null,updatedAt:now()};}
function validateState(state,request,row){
  need(state.schema===PREFIX+'-item.v1'&&state.cycleId===request.cycleId&&state.requestSha256===request.sha256&&
    state.index===row.index&&state.requestId===row.requestId&&typeof state.submissionAttempted==='boolean'&&
    ['REVIEWED','NOT_RETAINED','SENDING','RETAINED','DELIVERED','EXPORT_PENDING','RECONCILE_PENDING','REVIEW_REQUIRED'].includes(state.phase),
    'This customer progress record belongs to another original closing cycle.','STATE');
  return state;
}
async function currentState(directory,request,row){
  const record=await optional(join(itemDirectory(directory,row.index),'state.json'),1_000_000);
  return record?validateState(record.value,request,row):initialState(request,row);
}
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function customerHtml(row,delivery,statement){
  const period=row.servicePeriod,withdrawal=statement.history?.findLast(item=>item.action==='withdrawn');
  const artifacts=[...delivery.files,delivery.statusFile];
  const links=artifacts.map(file=>'<li><a href="'+encodeURIComponent(file.name)+'">'+escape(file.name)+'</a></li>').join('');
  const balances=period?'<h2>Service activity</h2><p>'+escape(period.from)+' to '+escape(period.until)+'</p>'+
    '<table><tr><th>Allowance</th><th>Opening</th><th>Closing</th></tr>'+
    ['unitsPurchased','unitsUsed','unitsReserved','unitsRemaining'].map((key,index)=>'<tr><td>'+
      ['Purchased units','Consumed units','Reserved units','Available units'][index]+'</td><td>'+escape(period.opening[key])+
      '</td><td>'+escape(period.closing[key])+'</td></tr>').join('')+'</table><p>During this period: '+
    escape(period.totals.consumedUnits)+' units consumed, '+escape(period.totals.releasedUnits)+' units released, '+
    escape(period.totals.resultRecoveries)+' saved results recovered.</p>':
    '<p>Service capture: '+escape(row.usageSource?.createdAt??'No service capture selected')+'</p>';
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+escape(statement.number)+' — '+escape(row.customer.name)+'</title><style>'+
    'body{font:16px/1.55 system-ui,sans-serif;color:#222;background:#fff;max-width:960px;margin:36px auto;padding:0 20px}'+
    'h1{font-size:26px}h2{font-size:20px;margin-top:28px}a{color:#222}table{border-collapse:collapse;min-width:340px;max-width:100%}'+
    'td,th{padding:8px 16px 8px 0;text-align:left;border-bottom:1px solid #bbb}small{color:#555}'+
    '@media print{body{margin:0}a{text-decoration:none}}</style><h1>'+escape(statement.number)+'</h1><p>'+
    escape(row.customer.name)+' · '+escape(row.customer.reference)+'</p><p><strong>'+escape(statement.status)+
    '</strong> · Status observed '+escape(delivery.statusObservedAt)+'</p>'+
    (withdrawal?'<p>Withdrawal: '+escape(withdrawal.reason)+' · '+escape(withdrawal.at)+'</p>':'')+
    (statement.supersededBy?'<p>Replacement statement reference: '+escape(statement.supersededBy)+'</p>':'')+
    '<p><a href="statement.html">Open the complete original statement</a></p>'+balances+'<h2>Customer files</h2><ul>'+links+
    '</ul><p><small>The statement retains its original purchases, source capture identities and service activity. '+
    'The current status snapshot records the original statement lifecycle at the observation above.</small></p></html>\n';
}
function registerHtml(report){
  const rows=report.rows.map(row=>{
    const period=row.servicePeriod,folder='items/'+String(row.index+1).padStart(6,'0')+'/delivery/';
    const files=row.delivery?.indexFile?'<a href="'+folder+'index.html">Open customer packet</a><small><a href="'+folder+
      'statement.html">Statement</a> · <a href="'+folder+'status.json">Status snapshot</a></small>':'';
    return '<tr><td>'+escape(row.customer.name)+'<small>'+escape(row.customer.reference)+'</small></td><td>'+
      (period?escape(period.from)+'<small>to '+escape(period.until)+'</small>':escape(row.usageSource?.createdAt??'No service capture'))+
      '</td><td>'+(period?escape(period.totals.consumedUnits)+'<small>original service units consumed</small>':'—')+
      '</td><td>'+escape(row.phase)+'<small>'+escape(row.statement?.number??row.requestId)+'</small>'+
      (row.error?'<small>'+escape(row.error.code+': '+row.error.message)+'</small>':'')+
      (row.statement?'<small>'+escape(row.delivery?.observedStatus??row.statement.status)+'</small>':'')+
      '</td><td>'+files+'</td></tr>';
  }).join('');
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+escape(report.label)+' — customer statements</title><style>'+
    'body{font:15px/1.5 system-ui,sans-serif;color:#222;background:#fff;margin:32px;max-width:1400px}h1{font-size:24px}p{max-width:1000px}'+
    'table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:12px 10px;border-bottom:1px solid #bbb;vertical-align:top}'+
    'th{background:#f2f2f2}small{display:block;color:#555;overflow-wrap:anywhere}a{color:#222}td:last-child{max-width:360px}'+
    '@media(max-width:760px){body{margin:16px}.table{overflow:auto}table{min-width:760px}}@media print{body{margin:0}a{text-decoration:none}}'+
    '</style><h1>'+escape(report.label)+'</h1><p>'+report.counts.delivered+' of '+report.counts.total+
    ' complete customer packets · '+report.counts.retained+' retained statements · '+escape(report.phase)+
    '</p><p>Each row uses its own original purchased pass and source capture period. Consumption is stated in that plan’s service units. '+
    'Each customer packet contains its original statement, purchase rows and source files.</p><div class="table"><table><thead><tr>'+
    '<th>Customer</th><th>Service capture period</th><th>Period consumption</th><th>Progress</th><th>Original customer files</th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table></div><p><small>Cycle '+escape(report.cycleId)+' · Workspace '+escape(report.workspace)+
    ' · Prepared '+escape(report.preparedAt)+' · Observed '+escape(report.observedAt)+'</small></p></html>\n';
}
async function reportFor(directory,request,manifest){
  const rows=[];
  for(const row of manifest.rows){
    await privateDirectory(itemDirectory(directory,row.index));
    const state=await currentState(directory,request,row);
    rows.push({...row,phase:state.phase,submissionAttempted:state.submissionAttempted,statement:state.statement,
      delivery:state.delivery,error:state.error,updatedAt:state.updatedAt});
  }
  const counts={total:rows.length,retained:rows.filter(row=>row.statement!==null).length,
    delivered:rows.filter(row=>row.phase==='DELIVERED'&&row.delivery?.complete===true).length,
    errors:rows.filter(row=>row.error!==null).length};
  const complete=counts.delivered===counts.total;
  return {schema:PREFIX+'-register.v1',cycleId:request.cycleId,label:request.label,workspace:request.workspace,
    requestSha256:request.sha256,manifestSha256:manifest.sha256,preparedAt:manifest.preparedAt,observedAt:now(),
    phase:complete?'COMPLETE':rows.every(row=>row.phase==='REVIEWED')?'READY':'INCOMPLETE',complete,counts,rows};
}
async function publishRegister(directory,request,manifest,lease){
  const report=await reportFor(directory,request,manifest);lease.assertHeld();
  await publish(join(directory,'register.json'),report,{replace:true,lease});
  await publish(join(directory,'register.html'),registerHtml(report),{replace:true,lease});
  return {directory,...report};
}
async function connection(request,provided,environment,signal){
  const client=provided??await connectAccountingStatementClient({url:request.url,workspace:request.workspace,tokenEnv:request.tokenEnv,environment,signal});
  need(client.workspace===request.workspace&&(!client.endpoint||client.endpoint===request.url),
    'Use the recorded original merchant endpoint and workspace.','CONNECTION');
  return client;
}
/** Freeze every complete native review before the cycle may retain any statement. */
export async function prepareAccountingStatementCycle({directory,url,workspace,tokenEnv='MCP_ACCESS_TOKEN',actor,label:cycleLabel,
  selections,client:provided,environment=process.env,signal}={}){
  signal?.throwIfAborted();need(Array.isArray(selections)&&selections.length>0,'Choose the original customer statement selections.');
  const normalized=selections.map(accountingStatementSelection),input={url:endpoint(url),workspace,tokenEnv,
    actor:label(actor,'operator',1000),label:label(cycleLabel,'cycle label',200),selections:normalized};
  const content={schema:PREFIX+'-request.v1',cycleId:randomUUID(),createdAt:now(),...input};
  let request=validateRequest({...content,sha256:digest(content)});
  need(Buffer.byteLength(json(request))<=REQUEST_LIMIT,'The complete closing-cycle selection exceeds 20 MB.','SIZE');
  directory=await privateDirectory(directory,{create:true});const lease=await acquireStateLease(directory);let client,failure;
  try{
    const existing=await optional(join(directory,'request.json'),REQUEST_LIMIT);
    if(existing){
      request=validateRequest(existing.value);
      need(Object.keys(input).every(key=>JSON.stringify(request[key])===JSON.stringify(input[key])),
        'This cycle directory belongs to different reviewed customer selections.','REQUEST');
    }else await publish(join(directory,'request.json'),request,{lease});
    const completed=await optional(join(directory,'manifest.json'),REQUEST_LIMIT);
    if(completed)return await publishRegister(directory,request,validateManifest(completed.value,request),lease);
    await privateDirectory(join(directory,'items'),{create:true});client=await connection(request,provided,environment,signal);
    await client.open({requestSignal:signal});const rows=[];
    for(let index=0;index<request.selections.length;index++){
      signal?.throwIfAborted();lease.assertHeld();const item=await privateDirectory(itemDirectory(directory,index),{create:true});
      let file=await optional(join(item,'review.json'),REVIEW_LIMIT);
      if(!file){
        const preview=await client.preview(request.selections[index],{requestSignal:signal});accountingStatementPreview(preview);
        const bytes=json(preview);need(Buffer.byteLength(bytes)<=REVIEW_LIMIT,'The complete original review exceeds 128 MB.','SIZE');
        const identity=await publish(join(item,'review.json'),bytes,{lease});file={value:preview,...identity};
      }
      const preview=accountingStatementPreview(file.value);
      need(JSON.stringify(preview.intent)===JSON.stringify(request.selections[index]),
        'The saved customer review differs from its selected original source.','REVIEW_CHANGED');
      accountingStatementRetentionArguments(preview,{requestId:requestId(request,index),actor:request.actor});
      rows.push(metadata(request,index,preview,{sha256:file.sha256,bytes:file.bytes}));
    }
    const review={schema:PREFIX+'.v1',cycleId:request.cycleId,requestSha256:request.sha256,preparedAt:now(),rows};
    const manifest=validateManifest({...review,sha256:digest(review)},request);
    need(Buffer.byteLength(json(manifest))<=REQUEST_LIMIT,'The complete closing-cycle register exceeds 20 MB.','SIZE');
    await publish(join(directory,'manifest.json'),manifest,{lease});
    return await publishRegister(directory,request,manifest,lease);
  }catch(error){failure=error;error.cycleDirectory=directory;throw error;}
  finally{
    try{if(client&&!provided)await client.disconnect();}catch(error){if(failure)failure.releaseError=problem(error);else throw error;}
    finally{await lease.close();}
  }
}
/** Recover each native request first, then retain unchanged reviews and finish their exact exports. */
export async function runAccountingStatementCycle({directory,execute=false,client:provided,environment=process.env,signal}={}){
  need(typeof execute==='boolean','Choose whether to execute the reviewed closing cycle.');signal?.throwIfAborted();
  directory=await privateDirectory(directory);const lease=await acquireStateLease(directory);let client,failure,request,manifest;
  try{
    request=validateRequest((await saved(join(directory,'request.json'),REQUEST_LIMIT)).value);
    manifest=validateManifest((await saved(join(directory,'manifest.json'),REQUEST_LIMIT)).value,request);
    client=await connection(request,provided,environment,signal);await client.open({requestSignal:signal});
    for(const row of manifest.rows){
      signal?.throwIfAborted();lease.assertHeld();await privateDirectory(itemDirectory(directory,row.index));
      let state=await currentState(directory,request,row);
      const checkpoint=async changes=>{
        state={...state,...changes,updatedAt:now()};validateState(state,request,row);
        await publish(join(itemDirectory(directory,row.index),'state.json'),state,{replace:true,lease});
      };
      try{
        const preview=await reviewed(directory,request,row),identity={requestId:row.requestId,actor:request.actor};
        let observed=await client.reconcileRetention(preview,identity,{requestSignal:signal});
        need(!state.statement||observed.found&&observed.statement.id===state.statement.id,
          'The original workspace no longer returns this cycle’s recorded retained statement. Reconcile its saved accounting state and original request before continuing.','STATEMENT_IDENTITY');
        if(!observed.found){
          if(!execute){await checkpoint({phase:'NOT_RETAINED',statement:null,delivery:null,error:null});continue;}
          const fresh=await client.preview(row.intent,{requestSignal:signal});
          need(fresh.previewSha256===row.previewSha256&&JSON.stringify(fresh.intent)===JSON.stringify(row.intent),
            'This customer source changed after the complete cycle review. Prepare a new reviewed cycle for its changed selection.','REVIEW_CHANGED');
          await checkpoint({phase:'SENDING',submissionAttempted:true,sendRevision:fresh.revision,error:null});
          try{observed={found:true,...await client.retain(fresh,identity,{requestSignal:signal})};}
          catch(error){
            try{observed=await client.reconcileRetention(preview,identity,{timeoutMs:10000});}
            catch(lookupError){error.lookupError=problem(lookupError);throw error;}
            if(!observed.found)throw error;
          }
        }
        await checkpoint({phase:'RETAINED',statement:observed.statement,error:null});
        const target=await privateDirectory(join(itemDirectory(directory,row.index),'delivery'),{create:true});
        const exported=await exportAccountingStatement({client,statementId:observed.statement.id,directory:target,signal});
        const {directory:unused,...delivery}=exported;
        const deliveryLease=await acquireStateLease(target),statusPath=join(target,'cycle-status-'+randomUUID()+'.json');
        try{
          const result=await downloadAccountingStatementStatus({client,statementId:observed.statement.id,output:statusPath,signal});
          const file=await saved(statusPath,1_000_000),snapshot=file.value;
          need(file.sha256===result.file.sha256&&file.bytes===result.file.bytes&&
            snapshot.schema==='stellar-forge.merchant-customer-statement-status.v1'&&
            snapshot.statement?.id===observed.statement.id&&snapshot.statement.requestId===row.requestId&&
            snapshot.statement.previewSha256===row.previewSha256&&
            snapshot.statement.intentSha256===observed.statement.intentSha256,
            'The original status snapshot differs from this retained customer request.','STATEMENT_IDENTITY');
          deliveryLease.assertHeld();lease.assertHeld();await rename(statusPath,join(target,'status.json'));await syncDirectory(target);
          const {history=[],...record}=snapshot.statement;
          Object.assign(delivery,{observedStatus:record.status,observedRevision:snapshot.revision,
            statusObservedAt:snapshot.observedAt,statusFile:{name:'status.json',sha256:file.sha256,bytes:file.bytes}});
          delivery.indexFile={name:'index.html',...await publish(join(target,'index.html'),customerHtml(row,delivery,snapshot.statement),{replace:true,lease:deliveryLease})};
          await checkpoint({phase:'DELIVERED',statement:{...record,historyCount:history.length},delivery,error:null});
        }finally{
          try{await unlink(statusPath).catch(error=>{if(error.code!=='ENOENT')throw error;});}
          finally{await deliveryLease.close();}
        }
      }catch(error){
        await checkpoint({phase:error.code==='ACCOUNTING_STATEMENT_CYCLE_REVIEW_CHANGED'?'REVIEW_REQUIRED':
          error.code==='ACCOUNTING_STATEMENT_CYCLE_STATEMENT_IDENTITY'?'RECONCILE_PENDING':
          state.statement?'EXPORT_PENDING':'RECONCILE_PENDING',error:problem(error)});
        if(signal?.aborted)throw error;
      }
    }
    return await publishRegister(directory,request,manifest,lease);
  }catch(error){
    failure=error;error.cycleDirectory=directory;
    if(request&&manifest)try{await publishRegister(directory,request,manifest,lease);}catch(registerError){error.registerError=problem(registerError);}
    throw error;
  }finally{
    try{if(client&&!provided)await client.disconnect();}catch(error){if(failure)failure.releaseError=problem(error);else throw error;}
    finally{await lease.close();}
  }
}
/** Refresh the portable register from saved per-customer progress, without an MCP call. */
export async function inspectAccountingStatementCycle({directory}={}){
  directory=await privateDirectory(directory);const lease=await acquireStateLease(directory);
  try{
    const request=validateRequest((await saved(join(directory,'request.json'),REQUEST_LIMIT)).value);
    const manifest=validateManifest((await saved(join(directory,'manifest.json'),REQUEST_LIMIT)).value,request);
    return await publishRegister(directory,request,manifest,lease);
  }finally{await lease.close();}
}

/** Observe atomic customer progress during an active close without taking its writer lease. */
export async function observeAccountingStatementCycle({directory}={}){
  directory=await privateDirectory(directory);
  const request=validateRequest((await saved(join(directory,'request.json'),REQUEST_LIMIT)).value);
  const manifest=validateManifest((await saved(join(directory,'manifest.json'),REQUEST_LIMIT)).value,request);
  return {directory,...await reportFor(directory,request,manifest)};
}
