// MIT. Retained Bitwave delivery inside the original accounting workspace.
import {constants} from 'node:fs';
import {lstat,mkdir,open,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {renderCsv,renderHtml} from '../accountant/engine.mjs';
import {BitwaveHttpClient,BITWAVE_API_BASE,BITWAVE_TOKEN_ENV} from '../accountant/bitwave-http.mjs';
import {BITWAVE_DOCS,bitwaveHash,bitwaveCheck as check,bitwaveCanonical,bitwaveId as id,bitwaveText as text,
  bitwaveTargetId,bitwaveJson as json,createBitwavePlan,validateBitwavePlan,bitwaveCreateRequest,bitwaveBatchRequest,
  bitwaveRowsCsv,bitwavePlanColumns,readBitwavePage,compareBitwavePages,prepareBitwaveReturn} from '../accountant/bitwave.mjs';

export const BITWAVE_REQUEST_BYTES=Math.ceil(64*1024*1024*4/3)+1000000;
const now=()=>new Date().toISOString(),copy=value=>structuredClone(value);
const records=workspace=>workspace.state.bitwavePlans??[];
const adjustmentNames=['adjustments.json','adjustments.csv','adjustments.html'];
const fileType=name=>({json:'application/json; charset=utf-8',csv:'text/csv; charset=utf-8',html:'text/html; charset=utf-8',tar:'application/x-tar'})[name.split('.').at(-1)]??'application/octet-stream';
const page=query=>{const offset=Number(query.offset??0),limit=Number(query.limit??50);check(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=200,'INVALID_BITWAVE_PAGE','Choose a nonnegative offset and 1 to 200 rows.');return {offset,limit};};
const requestHash=value=>bitwaveHash(bitwaveCanonical(value));
async function privateDir(path){
  try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  const stat=await lstat(path);check(stat.isDirectory()&&!stat.isSymbolicLink()&&!(stat.mode&0o077),'PRIVATE_BITWAVE_DIRECTORY','The retained Bitwave directory must be private.');
}
async function syncDir(path){const file=await open(path,'r');try{await file.sync();}finally{await file.close();}}
async function writeExact(directory,name,bytes){
  const file=await open(join(directory,name),'wx',0o600);
  try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  return {name,bytes:bytes.length,sha256:bitwaveHash(bytes)};
}
async function readExact(directory,file){
  const handle=await open(join(directory,file.name),constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const stat=await handle.stat();check(stat.isFile()&&stat.size===file.bytes&&stat.size<=256*1024*1024,'BITWAVE_FILE_CHANGED','The retained file size or type changed.',409);
    const bytes=await handle.readFile();check(bitwaveHash(bytes)===file.sha256,'BITWAVE_FILE_CHANGED','The retained file contents changed.',409);return bytes;
  }finally{await handle.close();}
}
function decodeFile(file){
  check(file&&typeof file.dataBase64==='string'&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.dataBase64),'INVALID_BITWAVE_UPLOAD','Choose an original JSON response file.');
  const bytes=Buffer.from(file.dataBase64,'base64');check(bytes.length>0&&bytes.length<=64*1024*1024&&bytes.toString('base64')===file.dataBase64,'BITWAVE_UPLOAD_SIZE','Choose a file up to 64 MiB.');return bytes;
}
function archive(entries){
  const chunks=[];let size=0;
  for(const {name,bytes} of entries){
    check(/^[A-Za-z0-9._/-]+$/.test(name)&&!name.split('/').includes('..'),'INVALID_ARCHIVE_NAME','An export path is invalid.');
    const header=Buffer.alloc(512);let leaf=name,prefix='';
    if(Buffer.byteLength(name)>100){const split=name.lastIndexOf('/');prefix=name.slice(0,split);leaf=name.slice(split+1);}
    check(Buffer.byteLength(leaf)<=100&&Buffer.byteLength(prefix)<=155,'ARCHIVE_PATH_TOO_LONG','An export path is too long.');
    header.write(leaf,0,100);header.write('0000600\0',100,8);header.write('0000000\0',108,8);header.write('0000000\0',116,8);
    header.write(bytes.length.toString(8).padStart(11,'0')+'\0',124,12);header.write('00000000000\0',136,12);header.fill(32,148,156);header.write('0',156);header.write('ustar\0',257,6);header.write('00',263,2);header.write(prefix,345,155);
    const checksum=header.reduce((sum,byte)=>sum+byte,0);header.write(checksum.toString(8).padStart(6,'0')+'\0 ',148,8);
    const padding=Buffer.alloc((512-bytes.length%512)%512);size+=512+bytes.length+padding.length;
    check(size<=512*1024*1024,'BITWAVE_ARCHIVE_SIZE','The complete handoff exceeds 512 MiB. Download its retained files individually.');chunks.push(header,bytes,padding);
  }
  chunks.push(Buffer.alloc(1024));return Buffer.concat(chunks);
}

export class BitwaveWorkspace{
  constructor(workspace,accountant,{client=new BitwaveHttpClient()}={}){this.workspace=workspace;this.accountant=accountant;this.client=client;this.tasks=new Set();this.closing=false;}
  async recover(){
    const changed=records(this.workspace).some(record=>record.operations.some(operation=>operation.status==='RUNNING'));
    if(changed)await this.workspace.serial(async()=>{
      for(const record of records(this.workspace))for(const operation of record.operations)if(operation.status==='RUNNING'){
        operation.status=operation.action==='capture'?'FAILED':'UNCERTAIN';operation.finishedAt=now();operation.message='The host stopped during this operation. Retained native requests and responses remain available.';
        if(operation.action==='create')record.createUncertain=true;
        for(const batch of record.batches)if(batch.status==='SENDING'){batch.status='UNCERTAIN';batch.message='Capture native rows to reconcile this interrupted request.';}
      }
      await this.workspace.commit('bitwave_interrupted_operations_retained','workspace');
    });
  }
  row(planId){id(planId);const record=records(this.workspace).find(item=>item.id===planId);check(record,'BITWAVE_PLAN_NOT_FOUND','Choose an existing Bitwave data-source plan.',404);return record;}
  directory(planId){return join(this.workspace.directory,'bitwave',id(planId));}
  async plan(planId){const record=this.row(planId),file=record.files.find(item=>item.name==='plan.json');const plan=JSON.parse((await readExact(this.directory(planId),file)).toString('utf8'));validateBitwavePlan(plan);return plan;}
  view(){return {revision:this.workspace.state.revision,handoffs:copy(this.workspace.state.accountantHandoffs??[]),plans:copy(records(this.workspace)),connection:{baseUrl:BITWAVE_API_BASE,tokenEnv:BITWAVE_TOKEN_ENV,configured:this.client.available()},docs:BITWAVE_DOCS};}
  async detail(planId){const record=this.row(planId),{rows,...plan}=await this.plan(planId);return {revision:this.workspace.state.revision,record:copy(record),plan,binding:copy(record.binding),operations:copy(record.operations),captures:copy(record.captures),files:copy(record.files)};}
  async create(value){
    return this.workspace.serial(async()=>{
      const planId=id(value.id??randomUUID()),request={handoffId:id(value.handoffId),accountantRevisionId:value.accountantRevisionId??null,name:text(value.name,'plan name'),actor:text(value.actor,'operator',1000),orgId:bitwaveTargetId(value.orgId,'organization ID'),description:text(value.description??'','description',2000,{empty:true}),batchSize:value.batchSize??250};
      const digest=requestHash(request),prior=records(this.workspace).find(item=>item.id===planId);
      if(prior){check(prior.requestSha256===digest,'BITWAVE_PLAN_REQUEST_CHANGED','This request ID already belongs to another plan.',409);return {record:copy(prior),duplicate:true,state:this.workspace.view()};}
      this.workspace.expected(value.revision);check(records(this.workspace).length<500,'BITWAVE_PLAN_LIMIT','This workspace retains 500 data-source plans.');
      const handoffRecord=this.accountant.row(request.handoffId),handoff=await this.accountant.readHandoff(request.handoffId),revision=await this.accountant.readRevision(handoffRecord,handoff,request.accountantRevisionId??'initial');
      const plan=createBitwavePlan({...request,handoff,revision,id:planId});
      await privateDir(join(this.workspace.directory,'bitwave'));const directory=this.directory(planId);
      await mkdir(directory,{mode:0o700});let committed=false;
      try{
        await privateDir(join(directory,'captures'));await privateDir(join(directory,'operations'));
        const contents={'plan.json':json(plan),'create-data-source.json':json(bitwaveCreateRequest(plan)),'expected-rows.json':json({items:plan.rows,totalRows:plan.rowCount,nextPageToken:null}),
          'data-source.csv':bitwaveRowsCsv(plan.rows,bitwavePlanColumns(plan)),'handoff.json':json(handoff),'accountant.csv':renderCsv(handoff,revision),'review.html':renderHtml(handoff,revision)};
        if(revision)contents['accountant-return.json']=json(revision);
        check(!handoff.source.adjustments||adjustmentNames.every(name=>handoffRecord.files.some(file=>file.name===name)),
          'BITWAVE_ADJUSTMENT_FILES_REQUIRED','Retain all three adjustment files from the selected original handoff.',409);
        for(const name of ['original-report.json','original-manifest.json','input-manifest.json','period-close.json','review-notes.json',...adjustmentNames])if(handoffRecord.files.some(file=>file.name===name))contents[name]=(await this.accountant.file(request.handoffId,name,{revisionId:'initial'})).bytes;
        if(handoff.source.adjustments)check(bitwaveHash(contents['adjustments.json'])===handoff.source.adjustments.sha256&&
          contents['adjustments.json'].length===handoff.source.adjustments.bytes,'BITWAVE_ADJUSTMENT_SOURCE_CHANGED','Use the exact adjustment snapshot frozen by this handoff.',409);
        for(const batch of plan.batches)contents[batch.file]=json(bitwaveBatchRequest(plan,batch.index));
        const files=[];for(const [name,bytes] of Object.entries(contents))files.push(await writeExact(directory,name,bytes));
        const record={id:planId,name:plan.name,actor:plan.actor,orgId:plan.orgId,createdAt:plan.createdAt,handoffId:plan.handoffId,accountantRevisionId:plan.accountantRevisionId,rowCount:plan.rowCount,source:plan.source,
          integrity:plan.integrity,requestSha256:digest,files,binding:null,createUncertain:false,operations:[],captures:[],returns:[],batches:plan.batches.map(batch=>({...batch,status:'PENDING',attempts:[]}))};
        this.workspace.state.bitwavePlans??=[];this.workspace.state.bitwavePlans.unshift(record);await syncDir(directory);await syncDir(join(this.workspace.directory,'bitwave'));
        await this.workspace.commit('bitwave_plan_created',request.actor,{planId,handoffId:plan.handoffId,orgId:plan.orgId});committed=true;
        return {record:copy(record),duplicate:false,state:this.workspace.view()};
      }finally{if(!committed)await rm(directory,{recursive:true,force:true});}
    });
  }
  async rows(planId,query={}){const {offset,limit}=page(query);let items=(await this.plan(planId)).rows;if(query.search){const search=String(query.search).toLowerCase().slice(0,500);items=items.filter(row=>JSON.stringify(row).toLowerCase().includes(search));}return {items:items.slice(offset,offset+limit),total:items.length,offset,limit};}
  async bind(planId,value){
    return this.workspace.serial(async()=>{
      this.workspace.expected(value.revision);const record=this.row(planId),dataSourceId=bitwaveTargetId(value.dataSourceId),actor=text(value.actor,'operator',1000),note=text(value.note,'target selection note',2000);
      check(!record.operations.some(item=>item.status==='RUNNING'),'BITWAVE_OPERATION_ACTIVE','Finish the active native operation before choosing its target.',409);
      check(!record.binding||record.binding.dataSourceId===dataSourceId,'BITWAVE_TARGET_ALREADY_BOUND','This frozen plan already belongs to another target. Create a new plan for a different table.',409);
      const columns=bitwaveCanonical(bitwavePlanColumns(record));
      check(!records(this.workspace).some(prior=>prior.id!==planId&&prior.orgId===record.orgId&&
        prior.binding?.dataSourceId===dataSourceId&&bitwaveCanonical(bitwavePlanColumns(prior))!==columns),
        'BITWAVE_TARGET_SCHEMA_MISMATCH','Choose a data source created for this complete schema; the selected retained table uses different columns.',409);
      if(!record.binding){record.binding={orgId:record.orgId,dataSourceId,selectedAt:now(),selectedBy:actor,note,source:'operator selected native table'};await this.workspace.commit('bitwave_target_selected',actor,{planId,orgId:record.orgId,dataSourceId});}
      return {record:copy(record),state:this.workspace.view()};
    });
  }
  async saveCapture(planId,{captureId,actor,name,rawFiles,source,operationId=null,requestSha256}){
    const plan=await this.plan(planId),calculated=compareBitwavePages(plan,rawFiles.map(file=>file.bytes));
    return this.workspace.serial(async()=>{
      const record=this.row(planId),prior=record.captures.find(item=>item.id===captureId);
      if(prior){check(prior.requestSha256===requestSha256,'BITWAVE_CAPTURE_REQUEST_CHANGED','This request ID already identifies another capture.',409);return copy(prior);}
      check(record.captures.length<1000,'BITWAVE_CAPTURE_LIMIT','This plan already has 1,000 retained captures.');
      const directory=join(this.directory(planId),'captures',id(captureId));await mkdir(directory,{mode:0o700});let committed=false;
      try{
        const files=[];for(let index=0;index<rawFiles.length;index++)files.push({...await writeExact(directory,'native-page-'+String(index+1).padStart(4,'0')+'.json',rawFiles[index].bytes),originalName:rawFiles[index].name});
        files.push(await writeExact(directory,'comparison.json',json(calculated.comparison)),await writeExact(directory,'source-matched-return.csv',calculated.csvBytes));
        const capture={id:captureId,name,actor,createdAt:now(),status:calculated.comparison.status,summary:calculated.comparison.summary,source,operationId,requestSha256,integrity:calculated.comparison.integrity,files,returns:[]};
        record.captures.push(capture);for(const file of files)record.files.push({...file,name:'captures/'+captureId+'/'+file.name});
        if(source.kind==='native-api'&&calculated.comparison.status==='COMPLETE'){
          const exact=new Set(calculated.comparison.items.filter(item=>item.status==='MATCHED').map(item=>item.rowId));
          for(const batch of record.batches)if(plan.rows.slice(batch.offset,batch.offset+batch.rowCount).every(row=>exact.has(row.rowId))){batch.status='VERIFIED';batch.captureId=captureId;}
        }
        await syncDir(directory);await syncDir(join(this.directory(planId),'captures'));await this.workspace.commit('bitwave_rows_retained',actor,{planId,captureId,source:source.kind,summary:capture.summary});committed=true;return copy(capture);
      }finally{if(!committed)await rm(directory,{recursive:true,force:true});}
    });
  }
  async importPages(planId,value){
    const actor=text(value.actor,'operator',1000),name=text(value.name,'capture name'),captureId=id(value.id??randomUUID());
    check(Array.isArray(value.files)&&value.files.length>=1&&value.files.length<=500,'BITWAVE_FILES_REQUIRED','Choose the ordered native JSON page files.');
    const rawFiles=value.files.map(file=>({name:text(file.name,'filename',200),bytes:decodeFile(file)})),digest=requestHash({actor,name,files:rawFiles.map(file=>({name:file.name,sha256:bitwaveHash(file.bytes)}))});
    const prior=this.row(planId).captures.find(item=>item.id===captureId);if(prior){check(prior.requestSha256===digest,'BITWAVE_CAPTURE_REQUEST_CHANGED','This request ID already identifies another capture.',409);return {capture:copy(prior),duplicate:true,state:this.workspace.view()};}
    this.workspace.expected(value.revision);
    const capture=await this.saveCapture(planId,{captureId,actor,name,rawFiles,source:{kind:'operator-file',orgId:this.row(planId).orgId,dataSourceId:this.row(planId).binding?.dataSourceId??null},requestSha256:digest});
    return {capture,state:this.workspace.view()};
  }
  captureRow(planId,captureId){id(captureId);const capture=this.row(planId).captures.find(item=>item.id===captureId);check(capture,'BITWAVE_CAPTURE_NOT_FOUND','Choose a retained native-row capture.',404);return capture;}
  async comparison(planId,captureId){const capture=this.captureRow(planId,captureId),file=capture.files.find(item=>item.name==='comparison.json');return JSON.parse((await readExact(join(this.directory(planId),'captures',captureId),file)).toString('utf8'));}
  async capture(planId,captureId){const comparison=await this.comparison(planId,captureId);return {capture:copy(this.captureRow(planId,captureId)),comparison:{...comparison,items:undefined}};}
  async captureRows(planId,captureId,query={}){const {offset,limit}=page(query);let items=(await this.comparison(planId,captureId)).items;if(query.status)items=items.filter(item=>item.status===query.status);if(query.search){const search=String(query.search).toLowerCase().slice(0,500);items=items.filter(item=>JSON.stringify(item).toLowerCase().includes(search));}return {items:items.slice(offset,offset+limit),total:items.length,offset,limit};}
  async preview(planId,captureId,value){
    const plan=await this.plan(planId),comparison=await this.comparison(planId,captureId),handoff=await this.accountant.readHandoff(plan.handoffId),parent=await this.accountant.readRevision(this.accountant.row(plan.handoffId),handoff);
    check((value.expectedParentId??null)===(parent?.id??null),'STALE_ACCOUNTANT_RETURN','A newer accountant return is saved. Refresh and preview against the current return.',409);
    const prepared=prepareBitwaveReturn(plan,comparison,handoff,parent);
    const csvBase64=prepared.csvBytes.toString('base64'),preview=prepared.matchedRows>0?await this.accountant.preview(plan.handoffId,{...value,csvBase64}):null;
    return {preview,csvBase64,comparison:{status:comparison.status,summary:comparison.summary,issues:comparison.issues},editConflicts:prepared.editConflicts};
  }
  async apply(planId,captureId,value){
    const plan=await this.plan(planId),returnId=id(value.id),request={id:returnId,captureId:id(captureId),actor:text(value.actor,'operator',1000),name:text(value.name,'return name'),expectedParentId:value.expectedParentId==null?null:id(value.expectedParentId),previewSha256:value.previewSha256,createdAt:value.createdAt};
    check(typeof request.previewSha256==='string'&&/^[a-f0-9]{64}$/.test(request.previewSha256)&&typeof request.createdAt==='string','BITWAVE_RETURN_PREVIEW_REQUIRED','Preview this return before saving its matched changes.');
    const digest=requestHash(request),prior=this.row(planId).returns.find(item=>item.id===returnId);
    if(prior){check(prior.requestSha256===digest,'BITWAVE_RETURN_REQUEST_CHANGED','This return ID belongs to another source preview.',409);return {savedReturn:copy(prior),duplicate:true,state:this.workspace.view()};}
    let intent=this.row(planId).returnIntents?.find(item=>item.id===returnId);
    if(!intent){
      const prepared=await this.preview(planId,captureId,request);
      check(prepared.preview,'NO_BITWAVE_MATCHED_ROWS','No source-matched rows can be returned. Review source or concurrent-edit conflicts first.');
      check(prepared.preview.revision.integrity.sha256===request.previewSha256,'ACCOUNTANT_PREVIEW_CHANGED','Preview the current returned rows before saving their matched changes.',409);
      intent=await this.workspace.serial(async()=>{
        const record=this.row(planId),existing=record.returnIntents?.find(item=>item.id===returnId);
        if(existing){check(existing.requestSha256===digest,'BITWAVE_RETURN_REQUEST_CHANGED','This return ID belongs to another source preview.',409);return copy(existing);}
        this.workspace.expected(value.revision);await privateDir(join(this.directory(planId),'return-intents'));
        const directory=join(this.directory(planId),'return-intents',returnId);await mkdir(directory,{mode:0o700});let committed=false;
        try{
          const files=[await writeExact(directory,'returned.csv',Buffer.from(prepared.csvBase64,'base64')),await writeExact(directory,'return-request.json',json({request,editConflicts:prepared.editConflicts}))];
          const saved={id:returnId,captureId,requestSha256:digest,createdAt:now(),status:'PENDING',files};
          record.returnIntents??=[];record.returnIntents.push(saved);for(const file of files)record.files.push({...file,name:'return-intents/'+returnId+'/'+file.name});
          await syncDir(directory);await syncDir(join(this.directory(planId),'return-intents'));
          await this.workspace.commit('bitwave_accountant_return_reserved',request.actor,{planId,captureId,returnId});committed=true;return copy(saved);
        }finally{if(!committed)await rm(directory,{recursive:true,force:true});}
      });
    }
    check(intent.requestSha256===digest,'BITWAVE_RETURN_REQUEST_CHANGED','This return ID belongs to another source preview.',409);
    const directory=join(this.directory(planId),'return-intents',returnId),csvBytes=await readExact(directory,intent.files.find(file=>file.name==='returned.csv'));
    const retained=JSON.parse((await readExact(directory,intent.files.find(file=>file.name==='return-request.json'))).toString('utf8'));
    check(requestHash(retained.request)===digest,'BITWAVE_RETURN_REQUEST_CHANGED','The retained return request changed.',409);
    // The original accountant checks an existing return ID before its current parent.
    // Reuse the retained request so an interrupted second commit can finish the link.
    const result=await this.accountant.apply(plan.handoffId,{...retained.request,csvBase64:csvBytes.toString('base64'),revision:this.workspace.state.revision});
    await this.linkReturn(planId,captureId,intent,result);
    return {...result,editConflicts:retained.editConflicts,state:this.workspace.view()};
  }
  async linkReturn(planId,captureId,intent,result){
    await this.workspace.serial(async()=>{
      const record=this.row(planId);if(record.returns.some(item=>item.id===intent.id))return;
      const saved=result.savedReturn,link={id:intent.id,captureId,requestSha256:intent.requestSha256,previewSha256:saved.integrity.sha256,handoffId:record.handoffId,name:saved.name,actor:saved.actor,createdAt:saved.createdAt,summary:saved.summary};
      record.returns.push(link);this.captureRow(planId,captureId).returns.push(link);record.returnIntents.find(item=>item.id===intent.id).status='SAVED';
      await this.workspace.commit('bitwave_accountant_return_saved',saved.actor,{planId,captureId,returnId:intent.id});
    });
  }
  async file(planId,name){
    const record=this.row(planId);await this.plan(planId);
    if(name==='bitwave-handoff.tar'){
      const snapshot=copy(record),entries=[];for(const file of snapshot.files)entries.push({name:file.name,bytes:await readExact(this.directory(planId),file)});
      for(const returned of snapshot.returns)for(const name of ['return.json','returned.csv','accountant.csv','review.html',...(snapshot.source.adjustments?adjustmentNames:[])]){
        const file=await this.accountant.file(snapshot.handoffId,name,{revisionId:returned.id});entries.push({name:'accountant-returns/'+returned.id+'/'+name,bytes:file.bytes});
      }
      entries.push({name:'delivery-state.json',bytes:json(snapshot)});
      entries.push({name:'file-manifest.json',bytes:json({schema:'stellar-forge.bitwave-files.v1',planId,files:entries.map(file=>({name:file.name,bytes:file.bytes.length,sha256:bitwaveHash(file.bytes)}))})});
      return {bytes:archive(entries),name:'merchant-bitwave-'+planId+'.tar',type:'application/x-tar'};
    }
    const file=record.files.find(item=>item.name===name);check(file,'BITWAVE_FILE_NOT_FOUND','Choose a retained Bitwave file.',404);
    return {bytes:await readExact(this.directory(planId),file),name:'merchant-bitwave-'+planId+'-'+name.replaceAll('/','-'),type:fileType(name)};
  }

  operationRow(planId,operationId){const operation=this.row(planId).operations.find(item=>item.id===operationId);check(operation,'BITWAVE_OPERATION_NOT_FOUND','Choose a retained native operation.',404);return operation;}
  async operate(planId,value){
    const operationId=id(value.id??randomUUID()),actor=text(value.actor,'operator',1000),action=value.action;
    check(['create','upload','capture','repair'].includes(action),'INVALID_BITWAVE_OPERATION','Choose create, upload, capture or repair.');
    const request={actor,action,resumeCaptureId:value.resumeCaptureId??null,captureId:value.captureId??null,comparisonSha256:value.comparisonSha256??null},digest=requestHash(request);
    const result=await this.workspace.serial(async()=>{
      const record=this.row(planId),prior=record.operations.find(item=>item.id===operationId);
      if(prior){check(prior.requestSha256===digest,'BITWAVE_OPERATION_REQUEST_CHANGED','This operation ID belongs to a different native request.',409);return {operation:copy(prior),duplicate:true,record:copy(record),state:this.workspace.view()};}
      this.workspace.expected(value.revision);check(!this.closing,'CLOSING','The merchant workspace is closing.',503);
      check(this.client.available(),'BITWAVE_TOKEN_REQUIRED','Configure BITWAVE_ACCESS_TOKEN in this merchant host before native delivery.');
      check(!records(this.workspace).some(item=>item.orgId===record.orgId&&item.operations.some(operation=>operation.status==='RUNNING')),'BITWAVE_OPERATION_ACTIVE','Finish the current operation for this organization first.',409);
      check(record.operations.length<1000,'BITWAVE_OPERATION_LIMIT','This plan already has 1,000 native operations.');
      if(action==='create'){
        check(!record.binding,'BITWAVE_TARGET_ALREADY_BOUND','This plan already has a native data source.',409);
        check(!record.createUncertain,'BITWAVE_CREATE_UNCERTAIN','Open the native data-source list and select the table created by the retained request.',409);
      }else check(record.binding,'BITWAVE_SOURCE_REQUIRED','Create or select the exact native data source first.');
      if(action==='upload')check(!record.batches.some(batch=>['SENDING','UNCERTAIN'].includes(batch.status)),'BITWAVE_CAPTURE_REQUIRED','Capture the native rows to reconcile the interrupted upload before sending missing rows.',409);
      if(action==='repair'){
        const capture=this.captureRow(planId,id(request.captureId));
        check(capture.source.kind==='native-api'&&capture.status==='COMPLETE'&&capture.integrity.sha256===request.comparisonSha256,'BITWAVE_REPAIR_REVIEW_REQUIRED','Select and review a complete native capture before sending its missing rows.',409);
        const lastWrite=Math.max(0,...record.operations.filter(item=>['create','upload','repair'].includes(item.action)).map(item=>Date.parse(item.finishedAt??item.startedAt)));
        check(Date.parse(capture.createdAt)>=lastWrite,'BITWAVE_CAPTURE_IS_OLDER','Capture native rows after the latest delivery attempt before preparing a repair.',409);
      }
      if(request.resumeCaptureId){const previous=this.captureRow(planId,id(request.resumeCaptureId));check(action==='capture'&&previous.source.kind==='native-api'&&previous.status==='PARTIAL'&&previous.source.orgId===record.orgId&&previous.source.dataSourceId===record.binding.dataSourceId,'BITWAVE_RESUME_SOURCE_CHANGED','Continue an incomplete capture of this exact native table.',409);}
      const directory=join(this.directory(planId),'operations',operationId);await mkdir(directory,{mode:0o700});
      const operation={id:operationId,...request,requestSha256:digest,status:'RUNNING',startedAt:now(),finishedAt:null,completedBatches:0,totalBatches:record.batches.length,message:'Starting '+action+'.',steps:[],stopRequested:false};
      record.operations.push(operation);await syncDir(join(this.directory(planId),'operations'));
      await this.workspace.commit('bitwave_operation_started',actor,{planId,operationId,action});
      return {operation:copy(operation),duplicate:false,record:copy(record),state:this.workspace.view()};
    });
    if(!result.duplicate){const task=this.runOperation(planId,operationId).finally(()=>this.tasks.delete(task));this.tasks.add(task);}
    return result;
  }
  async stop(planId,operationId,{actor}){
    return this.workspace.serial(async()=>{
      actor=text(actor,'operator',1000);const operation=this.operationRow(planId,id(operationId));
      if(operation.status==='RUNNING'&&!operation.stopRequested){operation.stopRequested=true;operation.message='Stopping after the current native request finishes.';await this.workspace.commit('bitwave_stop_requested',actor,{planId,operationId});}
      return {operation:copy(operation),state:this.workspace.view()};
    });
  }
  continueOperation(planId,operationId){const operation=this.operationRow(planId,operationId);check(!this.closing&&!operation.stopRequested,'BITWAVE_OPERATION_STOPPED','Stopped after the current request; completed source and native responses are retained.');}
  async nativeRequest(planId,operationId,{kind,body,pageToken,batchIndex}){
    this.continueOperation(planId,operationId);const plan=await this.plan(planId),record=this.row(planId),dataSourceId=record.binding?.dataSourceId;
    const operation=this.operationRow(planId,operationId),stepIndex=operation.steps.length+1,prefix='step-'+String(stepIndex).padStart(4,'0'),directory=join(this.directory(planId),'operations',operationId);
    const request={kind,orgId:plan.orgId,dataSourceId:dataSourceId??null,pageToken:pageToken??null,body:body??null};
    await this.workspace.serial(async()=>{
      const current=this.operationRow(planId,operationId),file=await writeExact(directory,prefix+'-request.json',json(request));
      this.row(planId).files.push({...file,name:'operations/'+operationId+'/'+file.name});
      current.steps.push({index:stepIndex,kind,batchIndex:batchIndex??null,status:'SENDING',startedAt:now(),requestFile:file.name,requestSha256:file.sha256});
      if(kind==='create')this.row(planId).createUncertain=true;
      if(batchIndex){const batch=this.row(planId).batches.find(item=>item.index===batchIndex);batch.status='SENDING';batch.attempts.push({operationId,stepIndex});}
      await syncDir(directory);await this.workspace.commit('bitwave_native_request_reserved',current.actor,{planId,operationId,stepIndex,kind,batchIndex:batchIndex??null});
    });
    let response;
    try{response=await this.client.request({orgId:plan.orgId,dataSourceId,kind,pageToken,body:body===undefined?undefined:json(body)});}
    catch(error){
      await this.workspace.serial(async()=>{const current=this.operationRow(planId,operationId),step=current.steps.find(item=>item.index===stepIndex);step.status=kind==='rows'?'FAILED':'UNCERTAIN';step.finishedAt=now();step.message=String(error.message??error).slice(0,1000);
        if(batchIndex)this.row(planId).batches.find(item=>item.index===batchIndex).status='UNCERTAIN';
        if(kind==='create')this.row(planId).createUncertain=true;
        await this.workspace.commit('bitwave_native_response_interrupted',current.actor,{planId,operationId,stepIndex,status:step.status});});
      throw Object.assign(new Error('The native response was interrupted. Open the retained request and capture the table to recover its outcome.'),{code:'BITWAVE_NATIVE_UNCERTAIN',uncertain:kind!=='rows'});
    }
    await this.workspace.serial(async()=>{
      const current=this.operationRow(planId,operationId),files=[await writeExact(directory,prefix+'-response.json',response.bytes),await writeExact(directory,prefix+'-response-meta.json',json({status:response.status,headers:response.headers,url:response.url,receivedAt:response.receivedAt}))];
      for(const file of files)this.row(planId).files.push({...file,name:'operations/'+operationId+'/'+file.name});
      const step=current.steps.find(item=>item.index===stepIndex);Object.assign(step,{status:'RECEIVED',httpStatus:response.status,finishedAt:response.receivedAt,responseFile:files[0].name,responseSha256:files[0].sha256});
      await syncDir(directory);await this.workspace.commit('bitwave_native_response_retained',current.actor,{planId,operationId,stepIndex,httpStatus:response.status});
    });
    return response;
  }
  async responseFailure(planId,operationId,response,{kind,batchIndex}){
    const definitive=[400,401,403,404,413,415,422,429].includes(response.status),uncertain=kind!=='rows'&&!definitive;
    let message='Native Bitwave request returned HTTP '+response.status+'.';
    if(typeof response.value?.error==='string')message+=' '+response.value.error.slice(0,800);
    await this.workspace.serial(async()=>{
      const record=this.row(planId),operation=this.operationRow(planId,operationId);operation.steps.at(-1).status=uncertain?'UNCERTAIN':'FAILED';
      if(kind==='create')record.createUncertain=uncertain;
      if(batchIndex){const batch=record.batches.find(item=>item.index===batchIndex);batch.status=uncertain?'UNCERTAIN':'FAILED';batch.message=message;}
      if(response.status===429){const raw=response.headers['retry-after'];const time=/^\d+$/.test(raw??'')?Date.now()+Number(raw)*1000:Date.parse(raw??'');if(Number.isFinite(time))record.retryAfter=new Date(time).toISOString();}
      await this.workspace.commit('bitwave_native_request_failed',operation.actor,{planId,operationId,httpStatus:response.status});
    });
    throw Object.assign(new Error(message),{code:'BITWAVE_NATIVE_REQUEST_FAILED',uncertain});
  }
  async runOperation(planId,operationId){
    let rawFiles=[];
    try{
      const plan=await this.plan(planId),operation=copy(this.operationRow(planId,operationId));
      const retryAfter=this.row(planId).retryAfter;if(retryAfter&&Date.parse(retryAfter)>Date.now())throw new Error('Bitwave requested a retry after '+retryAfter+'.');
      if(operation.action==='create'){
        const response=await this.nativeRequest(planId,operationId,{kind:'create',body:bitwaveCreateRequest(plan)});
        if(response.status<200||response.status>=300)await this.responseFailure(planId,operationId,response,{kind:'create'});
        const value=response.value?.data??response.value;
        if(!value||typeof value.id!=='string'||value.name!==plan.name||value.type!=='loaded'){
          await this.workspace.serial(async()=>{this.row(planId).createUncertain=true;await this.workspace.commit('bitwave_create_identity_unconfirmed',operation.actor,{planId,operationId});});
          throw Object.assign(new Error('The native create response needs review. Select its exact data-source ID from Bitwave.'),{uncertain:true});
        }
        bitwaveTargetId(value.id);
        await this.workspace.serial(async()=>{const record=this.row(planId);record.binding={orgId:plan.orgId,dataSourceId:value.id,selectedAt:now(),selectedBy:operation.actor,note:'Original native create response.',source:'native-api',operationId};record.createUncertain=false;await this.workspace.commit('bitwave_native_source_created',operation.actor,{planId,operationId,dataSourceId:value.id});});
      }else if(operation.action==='upload'||operation.action==='repair'){
        let repairRows=null;
        if(operation.action==='repair'){
          const comparison=await this.comparison(planId,operation.captureId);
          check(comparison.summary.changedRows===0&&comparison.summary.duplicateRows===0,'BITWAVE_SOURCE_CORRECTION_REQUIRED','Correct changed or duplicate source rows in Bitwave before adding missing rows.');
          repairRows=new Set(comparison.items.filter(item=>item.status==='MISSING').map(item=>item.rowId));
        }
        for(const batch of plan.batches){
          this.continueOperation(planId,operationId);const saved=this.row(planId).batches.find(item=>item.index===batch.index);
          if(operation.action==='upload'&&['ACCEPTED','VERIFIED'].includes(saved.status))continue;
          const all=bitwaveBatchRequest(plan,batch.index).rows,rows=repairRows?all.filter(row=>repairRows.has(row.rowId)):all;
          if(rows.length===0)continue;
          const response=await this.nativeRequest(planId,operationId,{kind:'add',body:{rows},batchIndex:batch.index});
          if(response.status<200||response.status>=300)await this.responseFailure(planId,operationId,response,{kind:'add',batchIndex:batch.index});
          if(response.value?.success!==true||response.value?.rowCount!==rows.length){
            await this.workspace.serial(async()=>{this.row(planId).batches.find(item=>item.index===batch.index).status='UNCERTAIN';await this.workspace.commit('bitwave_batch_count_unconfirmed',operation.actor,{planId,operationId,batchIndex:batch.index});});
            throw Object.assign(new Error('The native response did not confirm the complete submitted row count. Capture rows to reconcile this batch.'),{uncertain:true});
          }
          await this.workspace.serial(async()=>{const current=this.operationRow(planId,operationId),saved=this.row(planId).batches.find(item=>item.index===batch.index);saved.status='ACCEPTED';saved.acceptedAt=now();saved.acceptedRows=rows.length;saved.message='Native response accepted '+rows.length+' rows.';current.completedBatches++;current.message='Accepted '+current.completedBatches+' request batches.';await this.workspace.commit('bitwave_batch_accepted',current.actor,{planId,operationId,batchIndex:batch.index,rows:rows.length});});
        }
      }else{
        let token=null;const tokens=new Set();
        if(operation.resumeCaptureId){
          const previous=this.captureRow(planId,operation.resumeCaptureId);
          for(const file of previous.files.filter(file=>file.name.startsWith('native-page-')))rawFiles.push({name:file.originalName??file.name,bytes:await readExact(join(this.directory(planId),'captures',previous.id),file)});
          token=readBitwavePage(rawFiles.at(-1).bytes).nextPageToken;check(token,'BITWAVE_CAPTURE_RESTART_REQUIRED','This incomplete capture has no continuation cursor. Start a fresh capture.');
        }
        do{
          this.continueOperation(planId,operationId);check(rawFiles.length<500,'BITWAVE_CAPTURE_PAGE_LIMIT','The capture reached 500 native pages. Its completed pages are retained.');
          if(token){check(!tokens.has(token),'BITWAVE_CURSOR_REPEATED','The native pagination cursor repeated. The completed pages are retained.');tokens.add(token);}
          const response=await this.nativeRequest(planId,operationId,{kind:'rows',pageToken:token});
          if(response.status<200||response.status>=300)await this.responseFailure(planId,operationId,response,{kind:'rows'});
          const parsed=readBitwavePage(response.bytes);rawFiles.push({name:'native-table-page-'+String(rawFiles.length+1).padStart(4,'0')+'.json',bytes:response.bytes});token=parsed.nextPageToken;
          check(rawFiles.reduce((sum,file)=>sum+file.bytes.length,0)<=64*1024*1024,'BITWAVE_CAPTURE_SIZE','The capture reached 64 MiB. Completed native response files are retained.');
        }while(token);
        await this.finishNativeCapture(planId,operationId,rawFiles);rawFiles=[];
      }
      await this.finishOperation(planId,operationId,'COMPLETE','Completed '+operation.action+'; original native responses are retained.');
    }catch(error){
      const action=this.operationRow(planId,operationId).action;
      if(action==='capture'&&rawFiles.length)try{await this.finishNativeCapture(planId,operationId,rawFiles);}catch{}
      const record=this.row(planId),writeUncertain=(action==='create'&&record.createUncertain)||(['upload','repair'].includes(action)&&record.batches.some(batch=>['SENDING','UNCERTAIN'].includes(batch.status)));
      const status=error.code==='BITWAVE_OPERATION_STOPPED'?'PAUSED':error.uncertain||writeUncertain?'UNCERTAIN':'FAILED';
      try{await this.finishOperation(planId,operationId,status,String(error.message??error).slice(0,1500));}catch{}
    }
  }
  async finishNativeCapture(planId,operationId,rawFiles){
    const operation=this.operationRow(planId,operationId),record=this.row(planId),captureId=randomUUID();
    const capture=await this.saveCapture(planId,{captureId,actor:operation.actor,name:'Native rows '+now(),rawFiles,operationId,
      source:{kind:'native-api',orgId:record.orgId,dataSourceId:record.binding.dataSourceId,startedAt:operation.startedAt,resumedFrom:operation.resumeCaptureId??null},
      requestSha256:requestHash({operationId,files:rawFiles.map(file=>bitwaveHash(file.bytes))})});
    await this.workspace.serial(async()=>{const current=this.operationRow(planId,operationId);current.captureId=capture.id;current.message='Retained '+capture.summary.receivedRows+' native rows across '+capture.summary.pages+' pages.';await this.workspace.commit('bitwave_native_capture_complete',current.actor,{planId,operationId,captureId});});
  }
  async finishOperation(planId,operationId,status,message){await this.workspace.serial(async()=>{const operation=this.operationRow(planId,operationId);Object.assign(operation,{status,message,finishedAt:now()});await this.workspace.commit('bitwave_operation_finished',operation.actor,{planId,operationId,status});});}
  async close(){this.closing=true;this.client.abort();await Promise.allSettled([...this.tasks]);}
}

export async function handleBitwaveRequest(bitwave,{method,path,query={},value}){
  const parts=path.split('/').filter(Boolean);if(parts[0]!=='api'||parts[1]!=='bitwave')return null;
  if(parts.length===2&&method==='GET')return {value:bitwave.view()};
  if(parts.length===3&&parts[2]==='plans'&&method==='POST')return {value:await bitwave.create(value)};
  if(parts[2]==='plans'&&parts[3]){
    const planId=parts[3];if(parts.length===4&&method==='GET')return {value:await bitwave.detail(planId)};
    if(parts[4]==='download'&&parts.length>=6&&method==='GET')return {file:await bitwave.file(planId,decodeURIComponent(parts.slice(5).join('/')))};
    if(parts[4]==='operations'&&parts[5]&&parts[6]==='stop'&&parts.length===7&&method==='POST')return {value:await bitwave.stop(planId,parts[5],value)};
    if(parts.length===5){
      if(parts[4]==='rows'&&method==='GET')return {value:await bitwave.rows(planId,query)};
      if(parts[4]==='bind'&&method==='POST')return {value:await bitwave.bind(planId,value)};
      if(parts[4]==='imports'&&method==='POST')return {value:await bitwave.importPages(planId,value)};
      if(parts[4]==='operations'&&method==='POST')return {value:await bitwave.operate(planId,value)};
    }
    if(parts[4]==='captures'&&parts[5]){
      const captureId=parts[5];if(parts.length===6&&method==='GET')return {value:await bitwave.capture(planId,captureId)};
      if(parts.length===7){
        if(parts[6]==='rows'&&method==='GET')return {value:await bitwave.captureRows(planId,captureId,query)};
        if(parts[6]==='preview'&&method==='POST')return {value:await bitwave.preview(planId,captureId,value)};
        if(parts[6]==='returns'&&method==='POST')return {value:await bitwave.apply(planId,captureId,value)};
      }
    }
  }
  check(false,'NOT_FOUND','This Bitwave workspace operation was not found.',404);
}
