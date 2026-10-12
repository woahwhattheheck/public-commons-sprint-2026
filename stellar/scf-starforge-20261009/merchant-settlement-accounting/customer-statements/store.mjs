// MIT. Customer statements share the original accounting lease, state and source closure.
import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open,mkdir,rename,unlink,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {STATEMENT_SCHEMA,normalizeCustomer,normalizeUsage,compileCustomerStatement,renderStatementCsv,renderStatementHtml,renderStatementUsageCsv,
  sha,json,need,label,orderReference} from './core.mjs';

const SCHEMA='stellar-forge.merchant-customer-statements-workspace.v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX=/^[a-f0-9]{64}$/;
export const MAX_USAGE_BYTES=24_000_000;
export const STATEMENT_REQUEST_BYTES=32_100_000;
const now=()=>new Date().toISOString();
const idValue=(value,name)=>{need(typeof value==='string'&&UUID.test(value),'INVALID_STATEMENT_ID','Choose an existing '+name+'.');return value;};
const actorValue=value=>label(value,'operator',1000);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const pagination=query=>{
  const offset=Number(query.offset??0),limit=Number(query.limit??100);
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=200,
    'INVALID_STATEMENT_PAGE','Use a nonnegative offset and up to 200 rows.');return {offset,limit};
};
function parse(bytes,name){try{return JSON.parse(bytes.toString('utf8'));}catch{need(false,'INVALID_STATEMENT_JSON','Check the '+name+' JSON.');}}
async function readPlain(path,max){
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{const info=await handle.stat();need(info.isFile()&&info.size>0&&info.size<=max,'STATEMENT_FILE_CHANGED','The retained source file changed.',409);return await handle.readFile();}
  finally{await handle.close();}
}
async function readVerified(path,record,max=128_000_000){
  const bytes=await readPlain(path,max);
  need(sha(bytes)===record.sha256&&(record.bytes===undefined||record.bytes===bytes.length),
    'STATEMENT_FILE_CHANGED','The retained file differs from its recorded hash or byte count.',409);return bytes;
}
async function syncDirectory(path){
  const handle=await open(path,constants.O_RDONLY|(constants.O_DIRECTORY??0)|(constants.O_NOFOLLOW??0));
  try{await handle.sync();}finally{await handle.close();}
}
async function exclusiveFile(path,bytes){
  const handle=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
}
async function immutableInput(directory,name,bytes){
  const path=join(directory,name);
  try{const current=await readPlain(path,MAX_USAGE_BYTES);need(sha(current)===sha(bytes),'STATEMENT_INPUT_CHANGED','The retained usage input changed.',409);return;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const temp=join(directory,'.customer-usage-'+randomUUID()+'.tmp');
  try{await exclusiveFile(temp,bytes);await rename(temp,path);await syncDirectory(directory);}
  catch(error){await unlink(temp).catch(()=>{});throw error;}
}
function normalizedIntent(value){
  need(object(value),'INVALID_STATEMENT_REQUEST','Send a statement request.');
  const result={customerId:idValue(value.customerId,'customer'),runId:idValue(value.runId,'completed run'),
    usageId:value.usageId===undefined||value.usageId===null||value.usageId===''?null:idValue(value.usageId,'service usage import'),
    replacesId:value.replacesId===undefined||value.replacesId===null||value.replacesId===''?null:idValue(value.replacesId,'retained statement')};
  if(value.from!==undefined||value.until!==undefined){result.from=value.from;result.until=value.until;}
  return result;
}

export class CustomerStatementWorkspace{
  constructor(workspace){this.workspace=workspace;}
  async init(){
    return this.workspace.serial(async()=>{
      const state=this.workspace.state;
      if(state.customerStatements===undefined){
        state.customerStatements={schema:SCHEMA,customers:[],bindings:[],imports:[],statements:[],sequence:0};
        await this.workspace.commit('customer_statements_initialized','workspace startup');
      }
      const saved=state.customerStatements;
      need(object(saved)&&saved.schema===SCHEMA&&['customers','bindings','imports','statements'].every(key=>Array.isArray(saved[key]))&&
        Number.isSafeInteger(saved.sequence)&&saved.sequence>=0,'INVALID_CUSTOMER_STATEMENTS','The saved customer statement workspace is invalid.',409);
      return this;
    });
  }
  data(){this.workspace.lease.assertHeld();return this.workspace.state.customerStatements;}
  customer(id){idValue(id,'customer');const row=this.data().customers.find(row=>row.id===id);need(row,'CUSTOMER_NOT_FOUND','Choose a saved customer.',404);return row;}
  statement(id){idValue(id,'statement');const row=this.data().statements.find(row=>row.id===id);need(row,'STATEMENT_NOT_FOUND','Choose a retained statement.',404);return row;}
  usageRow(id){idValue(id,'usage import');const row=this.data().imports.find(row=>row.id===id);need(row,'USAGE_IMPORT_NOT_FOUND','Choose a retained usage import.',404);return row;}
  view(){
    const data=this.data(),counts=new Map();
    for(const row of data.bindings)counts.set(row.customerId,(counts.get(row.customerId)??0)+1);
    return structuredClone({schema:SCHEMA,revision:this.workspace.state.revision,
      customers:data.customers.map(row=>({...row,orders:counts.get(row.id)??0})),
      usageImports:data.imports,usageImportCount:data.imports.length,
      statements:data.statements.slice(0,100),statementCount:data.statements.length,bindingCount:data.bindings.length,
      runs:this.workspace.state.runs.filter(row=>row.status==='complete').map(row=>({id:row.id,name:row.name,status:row.status,createdAt:row.createdAt,
        completedAt:row.completedAt,reportSha256:row.reportSha256,period:row.period??null})),
      history:this.workspace.state.history.filter(row=>row.action.startsWith('customer_')).slice(-80).reverse()});
  }
  async state(){return this.workspace.serial(async()=>this.view());}
  async listBindings(query={}){
    return this.workspace.serial(async()=>{
      const {offset,limit}=pagination(query);
      let rows=this.data().bindings;
      if(query.customerId){this.customer(query.customerId);rows=rows.filter(row=>row.customerId===query.customerId);}
      if(query.search){const search=String(query.search).toLowerCase().slice(0,300);rows=rows.filter(row=>(row.orderRef+'\n'+row.label).toLowerCase().includes(search));}
      return structuredClone({items:rows.slice(offset,offset+limit),total:rows.length,offset,limit,revision:this.workspace.state.revision});
    });
  }
  async listStatements(query={}){
    return this.workspace.serial(async()=>{
      const {offset,limit}=pagination(query);let rows=this.data().statements;
      if(query.customerId){this.customer(query.customerId);rows=rows.filter(row=>row.customerId===query.customerId);}
      if(query.status){need(['RETAINED','WITHDRAWN','SUPERSEDED'].includes(query.status),'INVALID_STATEMENT_STATUS','Choose a document status.');rows=rows.filter(row=>row.status===query.status);}
      return structuredClone({items:rows.slice(offset,offset+limit),total:rows.length,offset,limit,revision:this.workspace.state.revision});
    });
  }
  async saveCustomer(value){
    return this.workspace.serial(async()=>{
      this.workspace.expected(value.revision);const actor=actorValue(value.actor),profile=normalizeCustomer(value),data=this.data();
      const current=value.id?this.customer(value.id):null;
      need(!data.customers.some(row=>row.reference===profile.reference&&row.id!==current?.id),'CUSTOMER_REFERENCE_EXISTS','This customer reference is already assigned.',409);
      if(current){
        need(value.expectedVersion===current.version,'STALE_CUSTOMER','Reload the current customer profile before saving its edited version.',409);
        if(Object.keys(profile).every(key=>profile[key]===current[key]))return {customer:structuredClone(current),state:this.view()};
        Object.assign(current,profile,{version:current.version+1,updatedAt:now(),actor});
      }else{
        need(data.customers.length<1000,'CUSTOMER_LIMIT','This workspace supports 1,000 customer profiles.');
        data.customers.push({...profile,id:randomUUID(),version:1,createdAt:now(),updatedAt:now(),actor});
      }
      const row=current??data.customers.at(-1);
      await this.workspace.commit('customer_profile_saved',actor,{customerId:row.id,version:row.version});
      return {customer:structuredClone(row),state:this.view()};
    });
  }
  async assign(value){
    return this.workspace.serial(async()=>{
      this.workspace.expected(value.revision);const actor=actorValue(value.actor),customer=this.customer(value.customerId),data=this.data();
      need(Array.isArray(value.orders)&&value.orders.length>0&&value.orders.length<=2000,'INVALID_ORDER_ASSIGNMENTS','Assign between one and 2,000 original order references.');
      need(value.reassign===undefined||typeof value.reassign==='boolean','INVALID_ORDER_REASSIGNMENT','Choose whether to reassign existing customer orders.');
      const reason=label(value.reason??'','assignment reason',2000,true),seen=new Set();
      const rows=value.orders.map(row=>{
        need(object(row),'INVALID_ORDER_ASSIGNMENT','Check the original order assignment.');
        const orderRef=orderReference(row.orderRef);need(!seen.has(orderRef),'DUPLICATE_ORDER_ASSIGNMENT','List each order once.');seen.add(orderRef);
        const current=data.bindings.find(item=>item.orderRef===orderRef);
        if(current&&current.customerId!==customer.id)need(value.reassign===true&&reason.length>0,
          'ORDER_ALREADY_ASSIGNED','This original order belongs to another customer. Choose explicit reassignment and enter the correction reason.',409);
        return {orderRef,label:label(row.label??'','customer-facing description',300,true),current};
      });
      need(data.bindings.length+rows.filter(row=>!row.current).length<=20000,'ORDER_BINDING_LIMIT','This workspace supports 20,000 original customer order assignments.');
      const changes=[];
      for(const row of rows){
        const current=row.current;
        if(current?.customerId===customer.id&&current.label===row.label)continue;
        if(current){
          need(current.history.length<200,'ORDER_ASSIGNMENT_HISTORY_LIMIT','This order has reached its retained assignment history limit.');
          const previous={customerId:current.customerId,label:current.label,version:current.version};
          current.history.push({at:now(),actor,reason,previous});
          Object.assign(current,{customerId:customer.id,label:row.label,version:current.version+1,updatedAt:now(),actor});
          changes.push({bindingId:current.id,previousCustomerId:previous.customerId,version:current.version});
        }else{
          const created={id:randomUUID(),orderRef:row.orderRef,orderReferenceDigest:sha(row.orderRef),customerId:customer.id,label:row.label,
            version:1,createdAt:now(),updatedAt:now(),actor,history:[]};
          data.bindings.push(created);changes.push({bindingId:created.id,version:1});
        }
      }
      if(changes.length)await this.workspace.commit('customer_orders_assigned',actor,{customerId:customer.id,changes,reason});
      return {assigned:rows.length,changed:changes.length,state:this.view()};
    });
  }
  async importUsage(value){
    need(typeof value.content==='string'&&Buffer.byteLength(value.content)>0&&Buffer.byteLength(value.content)<=MAX_USAGE_BYTES,
      'SERVICE_USAGE_SIZE','Import a service usage JSON file up to 24 MB.');
    const bytes=Buffer.from(value.content),usage=normalizeUsage(parse(bytes,'service usage')),digest=sha(bytes);
    return this.workspace.serial(async()=>{
      const actor=actorValue(value.actor),name=label(value.name??'Service usage','usage import name',200),data=this.data();
      const prior=data.imports.find(row=>row.sha256===digest);
      if(prior){await this._readUsage(prior);return {import:structuredClone(prior),reused:true,state:this.view()};}
      this.workspace.expected(value.revision);need(data.imports.length<1000,'USAGE_IMPORT_LIMIT','This workspace supports 1,000 retained usage captures.');
      await immutableInput(join(this.workspace.directory,'inputs'),'customer-usage-'+digest+'.json',bytes);
      const record={id:randomUUID(),name,sha256:digest,bytes:bytes.length,createdAt:now(),sourceCreatedAt:usage.createdAt,
        sourceRevision:usage.revision,sourceSchema:usage.sourceSchema,orderCount:usage.orders.length,actor};
      data.imports.unshift(record);
      await this.workspace.commit('customer_service_usage_imported',actor,{importId:record.id,sha256:digest,orderCount:record.orderCount});
      return {import:structuredClone(record),reused:false,state:this.view()};
    });
  }
  async _readUsage(record){
    need(HEX.test(record.sha256),'INVALID_USAGE_RECORD','The saved usage import has an invalid file digest.',409);
    return normalizeUsage(parse(await readVerified(join(this.workspace.directory,'inputs','customer-usage-'+record.sha256+'.json'),record,MAX_USAGE_BYTES),'retained service usage'));
  }
  async _preview(intent){
    const customer=this.customer(intent.customerId),run=this.workspace.runRow(intent.runId);
    need(run.status==='complete','RUN_NOT_COMPLETE','Choose a completed original reconciliation.',409);
    const report=parse(await readVerified(join(this.workspace.runPath(run.id),'report','report.json'),{sha256:run.reportSha256}),'original accounting report');
    let usage=null,usageSource=null;
    if(intent.usageId){usageSource=this.usageRow(intent.usageId);usage=await this._readUsage(usageSource);}
    if(intent.replacesId){
      const previous=this.statement(intent.replacesId);
      need(previous.customerId===customer.id&&previous.status==='RETAINED','INVALID_STATEMENT_REPLACEMENT','Replace the current retained statement for this same customer.',409);
    }
    const draft=compileCustomerStatement({report,run,customer,bindings:this.data().bindings,usage,usageSource,
      ...(intent.from!==undefined||intent.until!==undefined?{from:intent.from,until:intent.until}:{}),adjustments:this.workspace.state.adjustments??[]});
    if(intent.replacesId)draft.replacesId=intent.replacesId;
    return {intent:structuredClone(intent),draft,previewSha256:sha(json(draft)),revision:this.workspace.state.revision};
  }
  async preview(value){
    const intent=normalizedIntent(value);return this.workspace.serial(async()=>this._preview(intent));
  }
  async retain(value){
    const intent=normalizedIntent(value),actor=actorValue(value.actor),requestId=label(value.requestId,'stable retention request ID',160);
    need(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(requestId),'INVALID_STATEMENT_REQUEST_ID','Use a stable retention request ID.');
    need(typeof value.previewSha256==='string'&&HEX.test(value.previewSha256),'PREVIEW_REQUIRED','Prepare and review the statement before retaining it.');
    const intentSha256=sha(json({intent,previewSha256:value.previewSha256,actor}));
    return this.workspace.serial(async()=>{
      const data=this.data(),prior=data.statements.find(row=>row.requestId===requestId);
      if(prior){
        need(prior.intentSha256===intentSha256,'STATEMENT_REQUEST_REUSED','This retention request ID already belongs to different statement content.',409);
        return {...await this._detail(prior.id),reused:true,state:this.view()};
      }
      this.workspace.expected(value.revision);need(data.statements.length<5000,'STATEMENT_LIMIT','This workspace supports 5,000 retained customer statements.');
      const preview=await this._preview(intent);
      need(preview.previewSha256===value.previewSha256,'STATEMENT_PREVIEW_CHANGED','The original statement inputs changed. Review a fresh preview before retaining.',409);
      need(preview.draft.items.length>0,'EMPTY_STATEMENT','Resolve the assigned orders or choose a report containing this customer’s original purchases.');
      const createdAt=now(),id=randomUUID(),number='STMT-'+createdAt.slice(0,4)+'-'+String(data.sequence+1).padStart(6,'0');
      const document={...preview.draft,id,number,createdAt,retainedBy:actor,previewSha256:preview.previewSha256};
      const files={
        'statement.json':Buffer.from(json(document)),
        'statement.csv':Buffer.from(renderStatementCsv(document)),
        'usage.csv':Buffer.from(renderStatementUsageCsv(document)),
        'statement.html':Buffer.from(renderStatementHtml(document))
      };
      const metadata=Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,{sha256:sha(bytes),bytes:bytes.length}]));
      files['manifest.json']=Buffer.from(json({schema:'stellar-forge.merchant-customer-statement-files.v1',id,number,createdAt,
        documentSchema:STATEMENT_SCHEMA,customerId:intent.customerId,files:metadata,source:document.source}));
      metadata['manifest.json']={sha256:sha(files['manifest.json']),bytes:files['manifest.json'].length};
      need(Object.values(metadata).reduce((total,row)=>total+row.bytes,0)<=128_000_000,'STATEMENT_EXPORT_LIMIT','This customer statement exceeds the retained export size limit.');
      const exportsDir=join(this.workspace.directory,'exports'),temporary=join(exportsDir,'.customer-statement-'+id+'.tmp'),target=join(exportsDir,id);
      await mkdir(temporary,{mode:0o700});
      // Unique staged files are fsynced before the original workspace points to them.
      for(const [name,bytes] of Object.entries(files))await exclusiveFile(join(temporary,name),bytes);
      await syncDirectory(temporary);
      await rename(temporary,target);await syncDirectory(exportsDir);
      const record={id,number,requestId,intentSha256,previewSha256:preview.previewSha256,customerId:intent.customerId,
        customerReference:document.customer.reference,customerName:document.customer.name,runId:intent.runId,usageId:intent.usageId,
        createdAt,actor,status:'RETAINED',replacesId:intent.replacesId,supersededBy:null,files:metadata,
        orderCount:document.items.length,excludedOrderCount:document.excluded.length,from:document.selection.from,until:document.selection.until,
        history:[{at:createdAt,actor,action:'retained'}]};
      if(intent.replacesId){
        const previous=this.statement(intent.replacesId);previous.status='SUPERSEDED';previous.supersededBy=id;
        previous.history.push({at:createdAt,actor,action:'superseded',statementId:id});
      }
      data.sequence++;data.statements.unshift(record);
      await this.workspace.commit('customer_statement_retained',actor,{statementId:id,number,customerId:intent.customerId,
        reportSha256:document.source.reportSha256,statementSha256:metadata['statement.json'].sha256,replacesId:intent.replacesId});
      return {statement:structuredClone(record),document,reused:false,state:this.view()};
    });
  }
  async _file(id,name){
    const record=this.statement(id);
    if(name==='status.json'){
      const bytes=Buffer.from(json({schema:'stellar-forge.merchant-customer-statement-status.v1',observedAt:now(),
        revision:this.workspace.state.revision,statement:record}));
      return {bytes,name:record.number+'-'+record.status.toLowerCase()+'-status.json',type:'application/json; charset=utf-8'};
    }
    need(Object.hasOwn(record.files,name),'STATEMENT_FILE_NOT_FOUND','Choose a retained statement, CSV, print view or manifest.',404);
    const folder=join(this.workspace.directory,'exports',record.id),folderInfo=await lstat(folder);
    need(folderInfo.isDirectory()&&!folderInfo.isSymbolicLink(),'STATEMENT_DIRECTORY_CHANGED','The retained statement directory changed.',409);
    const bytes=await readVerified(join(folder,name),record.files[name]);
    const type=name.endsWith('.csv')?'text/csv; charset=utf-8':name.endsWith('.html')?'text/html; charset=utf-8':'application/json; charset=utf-8';
    return {bytes,name:record.number+'-'+record.status.toLowerCase()+'-'+name,type};
  }
  async file(id,name){return this.workspace.serial(async()=>this._file(id,name));}
  async _detail(id){
    const statement=structuredClone(this.statement(id));
    const document=parse((await this._file(id,'statement.json')).bytes,'retained statement');
    return {statement,document,revision:this.workspace.state.revision};
  }
  async detail(id){return this.workspace.serial(async()=>this._detail(id));}
  async withdraw(id,value){
    return this.workspace.serial(async()=>{
      this.workspace.expected(value.revision);const actor=actorValue(value.actor),reason=label(value.reason,'withdrawal reason',2000),record=this.statement(id);
      need(record.status==='RETAINED','STATEMENT_ALREADY_CLOSED','Choose a current retained statement to withdraw.',409);
      record.status='WITHDRAWN';record.history.push({at:now(),actor,action:'withdrawn',reason});
      await this.workspace.commit('customer_statement_withdrawn',actor,{statementId:id,reason});
      return {...await this._detail(id),state:this.view()};
    });
  }
}
