// MIT. Xero delivery belongs to the original accountant workspace and its root lease.
import {constants} from 'node:fs';
import {lstat,mkdir,open,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {XeroHttpClient} from '../accountant/xero-http.mjs';
import {XERO_DOCS,xeroCheck as need,xeroId,xeroText,xeroHash as hash,xeroJson as json,xeroCanonical,
  createXeroContext,validateXeroContext,xeroSourceComponents,createXeroPlan,validateXeroPlan,
  compareXeroJournals,prepareXeroReturn,renderXeroReview,xeroCreateRequest} from '../accountant/xero.mjs';

export const XERO_REQUEST_BYTES=96_000_000;
const FILE_LIMIT=128_000_000;
const clone=value=>structuredClone(value);
const now=()=>new Date().toISOString();
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fileName=value=>{need(typeof value==='string'&&value.length<=100&&value.split('/').every(part=>/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part)&&part!=='.'&&part!=='..'),'INVALID_XERO_FILE_NAME','Choose an original retained file.');return value;};
function base64(value,label){need(typeof value==='string'&&value.length<=Math.ceil(64_000_000*4/3)+4&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),'INVALID_XERO_UPLOAD','Choose a nonempty original '+label+' JSON file up to 64 MB.');const bytes=Buffer.from(value,'base64');need(bytes.length>0&&bytes.length<=64_000_000&&bytes.toString('base64')===value,'INVALID_XERO_UPLOAD','The original '+label+' file is not valid base64.');return bytes;}
async function directory(path,{create=false}={}){if(create){try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}}const info=await lstat(path);need(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077),'PRIVATE_XERO_DIRECTORY_REQUIRED','Use the original private accounting workspace.');}
async function syncDir(path){const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}}
async function write(directoryPath,name,bytes){fileName(name);const path=join(directoryPath,name),handle=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);bytes=Buffer.from(bytes);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}return {name,bytes:bytes.length,sha256:hash(bytes)};}
async function exact(directoryPath,file){fileName(file?.name);const handle=await open(join(directoryPath,file.name),constants.O_RDONLY|constants.O_NOFOLLOW);try{const before=await handle.stat();need(before.isFile()&&before.size<=FILE_LIMIT,'XERO_FILE_CHANGED','A retained Xero source is not a supported regular file.',409);const bytes=await handle.readFile(),after=await handle.stat();need(bytes.length===file.bytes&&hash(bytes)===file.sha256&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'XERO_FILE_CHANGED','The retained Xero source bytes changed.',409);return bytes;}finally{await handle.close();}}
async function writeFiles(path,files){const saved=[];for(const [name,bytes]of Object.entries(files))saved.push(await write(path,name,bytes));await syncDir(path);return saved;}
function tar(files){
  let size=1024;const parts=[];
  for(const [name,value]of Object.entries(files)){fileName(name);const bytes=Buffer.from(value),header=Buffer.alloc(512);size+=512+Math.ceil(bytes.length/512)*512;need(size<=512_000_000,'XERO_ARCHIVE_TOO_LARGE','Download the retained files individually when the complete archive exceeds 512 MB.');
    const field=(offset,length,value)=>header.write(value,offset,length,'ascii'),octal=(value,length)=>value.toString(8).padStart(length-1,'0')+'\0';
    field(0,100,name);field(100,8,octal(0o600,8));field(108,8,octal(0,8));field(116,8,octal(0,8));field(124,12,octal(bytes.length,12));field(136,12,octal(0,12));header.fill(32,148,156);field(156,1,'0');field(257,6,'ustar\0');field(263,2,'00');field(148,8,[...header].reduce((sum,byte)=>sum+byte,0).toString(8).padStart(6,'0')+'\0 ');
    parts.push(header,bytes,Buffer.alloc((512-bytes.length%512)%512));
  }
  parts.push(Buffer.alloc(1024));return Buffer.concat(parts);
}
const safeError=error=>({code:error.code??'XERO_NATIVE_OPERATION_FAILED',message:String(error.message??error).slice(0,2000)});
export class XeroWorkspace{
  constructor(workspace,accountant,{client=new XeroHttpClient()}={}){this.workspace=workspace;this.accountant=accountant;this.client=client;this.root=join(workspace.directory,'xero');this.tasks=new Set();this.controllers=new Set();this.closing=false;}
  async init(){
    await directory(this.root,{create:true});await directory(join(this.root,'contexts'),{create:true});await directory(join(this.root,'plans'),{create:true});
    return this.workspace.serial(async()=>{this.workspace.state.xeroContexts??=[];this.workspace.state.xeroPlans??=[];let changed=false;
      for(const row of this.workspace.state.xeroPlans)for(const operation of row.operations)if(operation.status==='RUNNING'){
        operation.status='INTERRUPTED';operation.finishedAt=now();operation.error={code:'XERO_PROCESS_INTERRUPTED',message:'The original server stopped during this retained native operation. Refresh its exact journals before a new creation.'};
        for(const journal of row.journals)if(journal.status==='SENDING')journal.status='UNCERTAIN';changed=true;
      }
      if(changed)await this.workspace.commit('xero_interrupted_operations_recovered','workspace',{plans:this.workspace.state.xeroPlans.filter(row=>row.operations.some(operation=>operation.status==='INTERRUPTED')).map(row=>row.id)});
      return this.view();
    });
  }
  view(){const state=this.workspace.state;return {revision:state.revision,
    handoffs:(state.accountantHandoffs??[]).map(row=>({id:row.id,name:row.name,rowCount:row.rowCount,createdAt:row.createdAt,source:clone(row.source),accountantRevisionId:row.revisions.at(-1)?.id??null})),
    contexts:clone(state.xeroContexts??[]).map(({files,...row})=>row),
    plans:(state.xeroPlans??[]).map(row=>({id:row.id,name:row.name,actor:row.actor,createdAt:row.createdAt,handoffId:row.handoffId,tenantId:row.tenantId,planSha256:row.planSha256,cancelledAt:row.cancelledAt,summary:clone(row.summary),operations:row.operations.length,returns:row.returns.length})),
    connection:{available:this.client.available(),tokenEnv:this.client.tokenEnv??null},docs:XERO_DOCS};}
  contextRow(id){xeroId(id);const row=(this.workspace.state.xeroContexts??[]).find(row=>row.id===id);need(row,'XERO_CONTEXT_NOT_FOUND','Choose a retained Xero organization.',404);return row;}
  row(id){xeroId(id);const row=(this.workspace.state.xeroPlans??[]).find(row=>row.id===id);need(row,'XERO_PLAN_NOT_FOUND','Choose a retained Xero journal plan.',404);return row;}
  path(id){return join(this.root,'plans',xeroId(id));}
  contextPath(id){return join(this.root,'contexts',xeroId(id));}
  async context(id){const row=this.contextRow(id),value=JSON.parse(await exact(this.contextPath(id),row.files.find(file=>file.name==='context.json')));validateXeroContext(value);need(value.id===row.id&&value.sha256===row.contextSha256,'XERO_CONTEXT_CHANGED','The retained context identity changed.',409);return value;}
  async plan(id){const row=this.row(id),value=JSON.parse(await exact(this.path(id),row.files.find(file=>file.name==='plan.json')));validateXeroPlan(value);need(value.id===row.id&&value.sha256===row.planSha256,'XERO_PLAN_CHANGED','The retained journal plan identity changed.',409);return value;}
  async importContext(value,{nativeSource=null}={}){
    return this.workspace.serial(async()=>{const id=xeroId(value.id??randomUUID()),organizationBytes=base64(value.organizationBase64,'organization'),accountsBytes=base64(value.accountsBase64,'accounts'),request={id,name:xeroText(value.name,'Organization label',160),actor:xeroText(value.actor,'Operator',1000),tenantId:xeroId(value.tenantId),organizationSha256:hash(organizationBytes),accountsSha256:hash(accountsBytes)},requestSha256=hash(xeroCanonical(request));
      const prior=(this.workspace.state.xeroContexts??[]).find(row=>row.id===id);if(prior){need(prior.requestSha256===requestSha256,'XERO_CONTEXT_REQUEST_CONFLICT','This context UUID belongs to another source import.',409);return {record:clone(prior),duplicate:true,state:this.view()};}
      this.workspace.expected(value.revision);need((this.workspace.state.xeroContexts??[]).length<2000,'XERO_CONTEXT_LIMIT','This workspace already retains 2,000 Xero contexts.');
      const context=createXeroContext({...request,organizationBytes,accountsBytes}),path=this.contextPath(id);await mkdir(path,{mode:0o700});let committed=false;
      try{const files=await writeFiles(path,{'context.json':json(context),'organization.json':organizationBytes,'accounts.json':accountsBytes,'source.json':json(nativeSource??{kind:'operator-file',actor:request.actor,tenantId:request.tenantId})});
        const row={id,name:context.name,actor:context.actor,createdAt:context.createdAt,tenantId:context.tenantId,organization:clone(context.organization),baseCurrency:context.organization.baseCurrency,accountCount:context.accounts.length,eligibleAccountCount:context.accounts.filter(row=>row.eligible).length,requestSha256,contextSha256:context.sha256,files};
        this.workspace.state.xeroContexts??=[];this.workspace.state.xeroContexts.push(row);await syncDir(join(this.root,'contexts'));await this.workspace.commit('xero_context_imported',request.actor,{contextId:id,tenantId:context.tenantId,sourceKind:nativeSource?'native-api':'operator-file'});committed=true;return {record:clone(row),duplicate:false,state:this.view()};
      }finally{if(!committed)await rm(path,{recursive:true,force:true});}
    });
  }
  async captureContext(value){
    need(!this.closing,'XERO_WORKSPACE_CLOSING','The original workspace is closing.',409);
    const controller=new AbortController();this.controllers.add(controller);
    const task=(async()=>{const source=await this.client.context(xeroId(value.tenantId),{signal:controller.signal});controller.signal.throwIfAborted();
      need(source.organization.ok&&source.accounts?.ok,'XERO_CONTEXT_READ_FAILED','Xero organization/accounts read returned HTTP '+(!source.organization.ok?source.organization.status:source.accounts?.status)+'.');
      const describe=response=>({request:response.request,status:response.status,headers:response.headers,receivedAt:response.receivedAt,sha256:hash(response.bytes),bytes:response.bytes.length});
      return this.importContext({...value,organizationBase64:source.organization.bytes.toString('base64'),accountsBase64:source.accounts.bytes.toString('base64')},{nativeSource:{kind:'native-api',tenantId:value.tenantId,organization:describe(source.organization),accounts:describe(source.accounts)}});
    })();this.tasks.add(task);try{return await task;}finally{this.tasks.delete(task);this.controllers.delete(controller);}
  }
  async originals(handoffId,revisionId){
    const record=this.accountant.row(handoffId),handoff=await this.accountant.readHandoff(handoffId),revision=await this.accountant.readRevision(record,handoff,revisionId);
    const adjustmentsBytes=handoff.source.adjustments?(await this.accountant.file(handoffId,'adjustments.json',{revisionId:'initial'})).bytes:null;
    return {record,handoff,revision,adjustmentsBytes};
  }
  async source(handoffId,contextId){
    const original=await this.originals(handoffId),context=await this.context(contextId),components=xeroSourceComponents(original.handoff,original.adjustmentsBytes);
    return {handoff:original.handoff,handoffId,context,contextId,accountantRevisionId:original.revision?.id??null,components,
      reserved:(this.workspace.state.xeroPlans??[]).filter(row=>!row.cancelledAt&&row.tenantId===context.tenantId).map(row=>({planId:row.id,name:row.name,componentIds:clone(row.componentIds)}))};
  }
  async preview(value){
    const request={id:xeroId(value.id??randomUUID()),name:xeroText(value.name,'Journal plan name',160),actor:xeroText(value.actor,'Operator',1000),createdAt:value.createdAt??now(),handoffId:xeroId(value.handoffId),contextId:xeroId(value.contextId),accountantRevisionId:value.accountantRevisionId??'initial',entries:clone(value.entries),purpose:value.purpose,valuationBasis:value.valuationBasis,showOnCashBasisReports:value.showOnCashBasisReports??false};
    const original=await this.originals(request.handoffId,request.accountantRevisionId),context=await this.context(request.contextId),plan=createXeroPlan({...request,...original,context}),ids=new Set(plan.entries.map(entry=>entry.id));
    const conflicts=(this.workspace.state.xeroPlans??[]).filter(row=>!row.cancelledAt&&row.tenantId===context.tenantId).flatMap(row=>row.componentIds.filter(id=>ids.has(id)).map(componentId=>({componentId,planId:row.id,name:row.name})));
    return {request,plan,conflicts,previewSha256:plan.sha256,workspaceRevision:this.workspace.state.revision};
  }
  async create(value){
    return this.workspace.serial(async()=>{const id=xeroId(value.id),prior=(this.workspace.state.xeroPlans??[]).find(row=>row.id===id);
      if(prior){need(prior.planSha256===value.previewSha256,'XERO_PLAN_REQUEST_CONFLICT','This plan UUID belongs to another reviewed journal plan.',409);const stored=JSON.parse(await exact(this.path(id),prior.files.find(file=>file.name==='plan-request.json')));need(Object.keys(stored).every(key=>xeroCanonical(stored[key])===xeroCanonical(value[key])),'XERO_PLAN_REQUEST_CONFLICT','The replayed plan request differs from its original.',409);return {record:clone(prior),plan:await this.plan(id),duplicate:true,state:this.view()};}
      this.workspace.expected(value.revision);need((this.workspace.state.xeroPlans??[]).length<2000,'XERO_PLAN_LIMIT','This workspace already retains 2,000 Xero plans.');
      const preview=await this.preview(value);need(preview.previewSha256===value.previewSha256,'XERO_PREVIEW_CHANGED','Review the current exact journal plan before saving it.',409);need(preview.conflicts.length===0,'XERO_SOURCE_ALREADY_RESERVED','A selected source component is already in an active plan for this Xero organization.',409);
      const original=await this.originals(value.handoffId,preview.request.accountantRevisionId),contextRow=this.contextRow(value.contextId),path=this.path(id);await mkdir(path,{mode:0o700});let committed=false;
      try{
        for(const name of ['captures','operations','returns'])await mkdir(join(path,name),{mode:0o700});
        const files={'plan.json':json(preview.plan),'plan-request.json':json(preview.request),'review.html':renderXeroReview(preview.plan)};
        for(const filename of ['handoff.json','accountant.csv','original-report.json','original-manifest.json','input-manifest.json','period-close.json','review-notes.json','adjustments.json','adjustments.csv','adjustments.html']){
          const selected=original.record.files.find(file=>file.name===filename);if(selected)files[filename]=(await this.accountant.file(value.handoffId,filename,{revisionId:'initial'})).bytes;
        }
        if(original.revision)files['accountant-baseline-return.json']=json(original.revision);
        for(const file of contextRow.files)files['xero-'+file.name]=await exact(this.contextPath(value.contextId),file);
        for(const journal of preview.plan.journals)files['manual-journal-'+String(journal.index).padStart(4,'0')+'.json']=json(xeroCreateRequest(preview.plan,journal.index).body);
        const saved=await writeFiles(path,files),row={id,name:preview.plan.name,actor:preview.plan.actor,createdAt:preview.plan.createdAt,handoffId:preview.plan.source.handoffId,contextId:value.contextId,tenantId:preview.plan.context.tenantId,planSha256:preview.plan.sha256,requestSha256:hash(xeroCanonical(preview.request)),summary:clone(preview.plan.summary),componentIds:preview.plan.entries.map(entry=>entry.id),files:saved,cancelledAt:null,cancellationReason:null,journals:preview.plan.journals.map(journal=>({index:journal.index,status:'READY',attempted:false,journalId:null,sourceFiles:[]})),operations:[],captures:[],returnIntents:[],returns:[]};
        this.workspace.state.xeroPlans??=[];this.workspace.state.xeroPlans.push(row);await syncDir(join(this.root,'plans'));await this.workspace.commit('xero_plan_created',row.actor,{planId:id,handoffId:row.handoffId,planSha256:row.planSha256,components:row.componentIds.length});committed=true;return {record:clone(row),plan:preview.plan,duplicate:false,state:this.view()};
      }finally{if(!committed)await rm(path,{recursive:true,force:true});}
    });
  }
  async detail(id){return {record:clone(this.row(id)),plan:await this.plan(id),state:this.view()};}
  async cancel(id,value){return this.workspace.serial(async()=>{const row=this.row(id);if(row.cancelledAt)return {record:clone(row),duplicate:true,state:this.view()};this.workspace.expected(value.revision);need(value.noExternalImport===true,'XERO_EXTERNAL_IMPORT_CONFIRMATION_REQUIRED','Confirm that no downloaded journal from this plan was imported externally.');need(!row.journals.some(journal=>journal.attempted||journal.journalId)&&row.captures.every(capture=>capture.nativeJournalCount===0),'XERO_PLAN_ALREADY_DELIVERED','This plan has native delivery activity; review its original journals.');row.cancelledAt=now();row.cancellationReason=xeroText(value.reason,'Cancellation reason',2000,{multiline:true});const actor=xeroText(value.actor,'Operator',1000);await this.workspace.commit('xero_unused_plan_cancelled',actor,{planId:id,reason:row.cancellationReason});return {record:clone(row),duplicate:false,state:this.view()};});}
  async retainCapture(id,{captureId=randomUUID(),actor,responseFiles,source}){
    const row=this.row(id),plan=await this.plan(id),comparison=compareXeroJournals({id:captureId,plan,responseFiles,actor,source}),root='captures/'+captureId,path=join(this.path(id),root);await mkdir(path,{mode:0o700});let committed=false;
    try{const files={};responseFiles.forEach((file,index)=>{files['response-'+String(index).padStart(4,'0')+'.json']=file.bytes;});files['comparison.json']=json(comparison);files['review.html']=renderXeroReview(plan,comparison);
      const saved=(await writeFiles(path,files)).map(file=>({...file,name:root+'/'+file.name}));row.files.push(...saved);
      const capture={id:captureId,actor,createdAt:comparison.createdAt,comparisonSha256:comparison.sha256,comparisonFile:root+'/comparison.json',source:clone(source),summary:clone(comparison.summary),nativeJournalCount:comparison.journals.filter(journal=>journal.journalId||journal.status==='DUPLICATE').length,files:saved.map(file=>file.name)};
      row.captures.push(capture);for(const matched of comparison.journals){const journal=row.journals[matched.index];if(matched.journalId&&matched.status==='MATCHED'){journal.journalId=matched.journalId;journal.status=matched.nativeStatus;}else if(matched.status!=='MATCHED'&&(matched.status!=='MISSING'||source.kind!=='native-api'||source.observedIndexes.includes(matched.index)))journal.status=matched.status;}
      await syncDir(join(this.path(id),'captures'));await this.workspace.commit('xero_native_comparison_retained',actor,{planId:id,captureId,summary:comparison.summary});committed=true;return {capture:clone(capture),comparison,state:this.view()};
    }finally{if(!committed)await rm(path,{recursive:true,force:true});}
  }
  async importResponses(id,value){return this.workspace.serial(async()=>{const row=this.row(id),captureId=xeroId(value.id??randomUUID()),prior=row.captures.find(capture=>capture.id===captureId);need(Array.isArray(value.files)&&value.files.length>0&&value.files.length<=1000,'XERO_RESPONSES_REQUIRED','Choose the original native journal response files.');
      const responseFiles=value.files.map((file,index)=>({name:'response-'+String(index).padStart(4,'0')+'.json',bytes:base64(file.base64,'ManualJournals response')})),requestSha256=hash(xeroCanonical(responseFiles.map(file=>({name:file.name,sha256:hash(file.bytes)}))));
      if(prior){need(prior.source.requestSha256===requestSha256&&prior.actor===value.actor,'XERO_CAPTURE_REQUEST_CONFLICT','This comparison UUID belongs to another source import.',409);return {capture:clone(prior),comparison:await this.comparison(id,captureId),duplicate:true,state:this.view()};}
      this.workspace.expected(value.revision);need(!row.cancelledAt,'XERO_PLAN_CANCELLED','Choose an active journal plan.');return this.retainCapture(id,{captureId,actor:xeroText(value.actor,'Operator',1000),responseFiles,source:{kind:'operator-file',tenantId:row.tenantId,requestSha256,originalNames:value.files.map(file=>xeroText(file.name??'response.json','Original filename',255))}});
    });
  }
  async comparison(id,captureId){const row=this.row(id),capture=row.captures.find(capture=>capture.id===xeroId(captureId));need(capture,'XERO_CAPTURE_NOT_FOUND','Choose a retained native comparison.',404);const value=JSON.parse(await exact(this.path(id),row.files.find(file=>file.name===capture.comparisonFile)));need(value.sha256===capture.comparisonSha256&&value.planSha256===row.planSha256,'XERO_COMPARISON_CHANGED','The retained native comparison changed.',409);const {sha256,...body}=value;need(hash(xeroCanonical(body))===sha256,'XERO_COMPARISON_CHANGED','The retained native comparison content changed.',409);return value;}
  async previousAssignments(row,handoff){const selected=new Map();for(const saved of [...row.returns].reverse()){
      const source=JSON.parse(await exact(this.path(row.id),row.files.find(file=>file.name===saved.assignmentRowsFile))),revision=await this.accountant.readRevision(this.accountant.row(row.handoffId),handoff,saved.returnId);
      const actual=new Map(revision.assignments.map(assignment=>[assignment.rowId,assignment]));for(const assignment of source){const value=actual.get(assignment.rowId);need(value&&Object.keys(assignment).every(key=>value[key]===assignment[key]),'XERO_RETURN_LINK_CHANGED','A linked original accountant return differs from its retained Xero proposal.',409);if(!selected.has(assignment.rowId))selected.set(assignment.rowId,value);}
    }return [...selected.values()];}
  async returnPreview(id,captureId,value){
    const row=this.row(id),plan=await this.plan(id),capture=await this.comparison(id,captureId),original=await this.originals(row.handoffId),previousAssignments=await this.previousAssignments(row,original.handoff);
    const prepared=prepareXeroReturn({plan,capture,handoff:original.handoff,revision:original.revision,previousAssignments});
    const request={id:xeroId(value.id??randomUUID()),name:xeroText(value.name,'Return name',160),actor:xeroText(value.actor,'Operator',1000),createdAt:value.createdAt??now(),expectedParentId:original.revision?.id??null,csvBase64:prepared.csvBytes.toString('base64')};
    if(Object.hasOwn(value,'expectedParentId'))need(value.expectedParentId===request.expectedParentId,'STALE_XERO_RETURN','Preview against the current original accountant return.',409);
    const preview=await this.accountant.preview(row.handoffId,request);
    return {request,preview:preview.revision,previewSha256:preview.revision.integrity.sha256,workspaceRevision:preview.workspaceRevision,conflicts:prepared.conflicts,skipped:prepared.skipped,matchedRows:prepared.matchedRows,assignments:prepared.assignments,captureId,planId:id};
  }
  async applyReturn(id,captureId,value){
    let intent,request;
    await this.workspace.serial(async()=>{const row=this.row(id),returnId=xeroId(value.id),prior=row.returnIntents.find(intent=>intent.id===returnId);
      if(prior){need(prior.captureId===captureId&&(!value.previewSha256||value.previewSha256===prior.previewSha256),'XERO_RETURN_REQUEST_CONFLICT','This return UUID belongs to another original preview.',409);intent=clone(prior);request=JSON.parse(await exact(this.path(id),row.files.find(file=>file.name===prior.requestFile)));return;}
      this.workspace.expected(value.revision);const preview=await this.returnPreview(id,captureId,value);
      need(preview.matchedRows>0,'XERO_RETURN_HAS_NO_MATCHES','Resolve the displayed source differences before applying this accountant return.');need(preview.previewSha256===value.previewSha256&&preview.request.csvBase64===value.csvBase64,'XERO_RETURN_PREVIEW_CHANGED','Review the current original accountant return before applying it.',409);
      request={...preview.request,previewSha256:preview.previewSha256};const root='returns/'+returnId,path=join(this.path(id),root);await mkdir(path,{mode:0o700});let committed=false;
      try{const saved=(await writeFiles(path,{'request.json':json(request),'assignments.json':json(preview.assignments),'preview.json':json(preview.preview)})).map(file=>({...file,name:root+'/'+file.name}));row.files.push(...saved);
        intent={id:returnId,captureId,actor:request.actor,createdAt:request.createdAt,previewSha256:request.previewSha256,requestFile:root+'/request.json',assignmentRowsFile:root+'/assignments.json',status:'PREPARED'};row.returnIntents.push(clone(intent));await syncDir(join(this.path(id),'returns'));await this.workspace.commit('xero_accountant_return_prepared',request.actor,{planId:id,captureId,returnId});committed=true;
      }finally{if(!committed)await rm(path,{recursive:true,force:true});}
    });
    const applied=await this.accountant.apply(this.row(id).handoffId,{...request,revision:this.workspace.state.revision});
    return this.workspace.serial(async()=>{const row=this.row(id),existing=row.returns.find(saved=>saved.returnId===intent.id);if(existing)return {savedReturn:applied.savedReturn,link:clone(existing),duplicate:true,state:this.view()};
      const link={returnId:intent.id,captureId,createdAt:now(),assignmentRowsFile:intent.assignmentRowsFile,sourceReturnSha256:applied.savedReturn.integrity.sha256};row.returns.push(link);row.returnIntents.find(saved=>saved.id===intent.id).status='APPLIED';await this.workspace.commit('xero_accountant_return_linked',request.actor,{planId:id,captureId,returnId:intent.id});return {savedReturn:applied.savedReturn,link:clone(link),duplicate:applied.duplicate,state:this.view()};});
  }
  operation(id,operationId){const operation=this.row(id).operations.find(operation=>operation.id===xeroId(operationId));need(operation,'XERO_OPERATION_NOT_FOUND','Choose a retained native operation.',404);return operation;}
  async operate(id,value){
    need(!this.closing,'XERO_WORKSPACE_CLOSING','The original workspace is closing.',409);
    const operationId=xeroId(value.id??randomUUID()),actor=xeroText(value.actor,'Operator',1000),plan=await this.plan(id),request={actor,action:value.action,planSha256:value.planSha256},requestSha256=hash(xeroCanonical(request));
    need(['create-drafts','refresh'].includes(request.action),'INVALID_XERO_ACTION','Choose create-drafts or refresh.');
    const result=await this.workspace.serial(async()=>{const row=this.row(id),prior=row.operations.find(operation=>operation.id===operationId);if(prior){need(prior.requestSha256===requestSha256,'XERO_OPERATION_REQUEST_CONFLICT','This operation UUID belongs to another request.',409);return {operation:clone(prior),duplicate:true};}
      this.workspace.expected(value.revision);need(value.planSha256===plan.sha256,'XERO_PLAN_CHANGED','Operate the exact saved journal plan.',409);need(!row.cancelledAt,'XERO_PLAN_CANCELLED','Choose an active journal plan.');
      need(!(this.workspace.state.xeroPlans??[]).some(row=>row.operations.some(operation=>operation.status==='RUNNING')),'XERO_OPERATION_ACTIVE','Wait for the retained native operation to finish before starting another.',409);
      need(this.client.available(),'XERO_CONNECTION_REQUIRED','Configure the existing Xero access token in the original server process.');
      const indexes=request.action==='refresh'?row.journals.map(journal=>journal.index):row.journals.filter(journal=>(!journal.attempted||journal.status==='REJECTED')&&!journal.journalId).map(journal=>journal.index);
      need(indexes.length>0,'XERO_NO_PENDING_DRAFTS','Refresh the retained original journal attempts before preparing another creation.');
      const root='operations/'+operationId,path=join(this.path(id),root);await mkdir(path,{mode:0o700});let committed=false;
      try{const saved=await write(path,'operation.json',json({...request,id:operationId,tenantId:plan.context.tenantId,indexes}));row.files.push({...saved,name:root+'/'+saved.name});const operation={id:operationId,...request,requestSha256,status:'RUNNING',startedAt:now(),finishedAt:null,indexes,journalSources:{},files:[root+'/'+saved.name],captureId:null,error:null};row.operations.push(operation);
        await syncDir(path);await syncDir(join(this.path(id),'operations'));await this.workspace.commit('xero_native_operation_started',actor,{planId:id,operationId,action:request.action});committed=true;return {operation:clone(operation),duplicate:false};
      }finally{if(!committed)await rm(path,{recursive:true,force:true});}
    });
    if(!result.duplicate){const controller=new AbortController();this.controllers.add(controller);const task=new Promise(resolve=>setImmediate(resolve)).then(()=>this.execute(id,operationId,controller));this.tasks.add(task);task.finally(()=>{this.tasks.delete(task);this.controllers.delete(controller);}).catch(()=>{});}
    return {...result,state:this.view()};
  }
  async appendOperationFile(id,operationId,name,bytes){
    return this.workspace.serial(async()=>{const row=this.row(id),operation=this.operation(id,operationId),path=join(this.path(id),'operations',operationId),saved=await write(path,name,bytes),file={...saved,name:'operations/'+operationId+'/'+name};row.files.push(file);operation.files.push(file.name);await syncDir(path);await this.workspace.commit('xero_native_source_retained',operation.actor,{planId:id,operationId,name,sha256:file.sha256});return file;});
  }
  async captureOperation(id,operationId){
    const row=this.row(id),operation=clone(this.operation(id,operationId)),names=[];
    for(const journal of row.journals){const selected=operation.indexes.includes(journal.index)?operation.journalSources[journal.index]??[]:journal.sourceFiles;names.push(...selected);}
    const responseFiles=[];for(const name of [...new Set(names)])responseFiles.push({name,bytes:await exact(this.path(id),row.files.find(file=>file.name===name))});
    if(!responseFiles.length)return null;
    return this.workspace.serial(()=>this.retainCapture(id,{actor:operation.actor,responseFiles,source:{kind:'native-api',tenantId:row.tenantId,operationId,action:operation.action,requestedIndexes:operation.indexes,observedIndexes:Object.keys(operation.journalSources).map(Number),originalFiles:responseFiles.map(file=>file.name)}}));
  }
  async execute(id,operationId,controller){
    let failure=null;
    try{
      const plan=await this.plan(id),operation=clone(this.operation(id,operationId));
      if(operation.action==='create-drafts'){
        const current=await this.client.context(plan.context.tenantId,{signal:controller.signal});
        for(const [name,response]of Object.entries(current)){if(!response)continue;await this.appendOperationFile(id,operationId,'current-'+name+'.json',response.bytes);await this.appendOperationFile(id,operationId,'current-'+name+'-metadata.json',json({request:response.request,status:response.status,headers:response.headers,receivedAt:response.receivedAt}));}
        need(current.organization.ok&&current.accounts?.ok,'XERO_CURRENT_CONTEXT_UNAVAILABLE','The current native organization/account read failed. Its exact response is retained before any draft creation.');
        const context=createXeroContext({id:plan.context.id,tenantId:plan.context.tenantId,name:plan.context.organization.name,actor:operation.actor,organizationBytes:current.organization.bytes,accountsBytes:current.accounts.bytes});
        need(context.organization.baseCurrency===plan.context.organization.baseCurrency&&context.organization.isDemoCompany===plan.context.organization.isDemoCompany,'XERO_CURRENT_ORGANIZATION_CHANGED','The current native organization base currency or demo identity differs from the reviewed plan.',409);
        const accounts=new Map(context.accounts.map(account=>[account.code,account]));
        for(const entry of plan.entries)for(const selected of [entry.debitAccount,entry.creditAccount]){const actual=accounts.get(selected.code);need(actual?.eligible&&actual.id===selected.id,'XERO_CURRENT_ACCOUNT_CHANGED','A selected native account is no longer the same active journal account. Review the retained current chart before creating drafts.',409);}
      }
      for(const index of operation.indexes){
        controller.signal.throwIfAborted();let responses;
        if(operation.action==='create-drafts'){
          await this.appendOperationFile(id,operationId,'request-'+index+'.json',json(xeroCreateRequest(plan,index)));
          await this.workspace.serial(async()=>{const journal=this.row(id).journals[index];need((!journal.attempted||journal.status==='REJECTED')&&!journal.journalId,'XERO_DRAFT_ALREADY_ATTEMPTED','Refresh the retained native journal attempt.');journal.attempted=true;journal.status='SENDING';journal.operationId=operationId;await this.workspace.commit('xero_draft_request_reserved',operation.actor,{planId:id,operationId,index});});
          responses=[await this.client.createDraft(plan,index,{signal:controller.signal})];
        }else responses=await this.client.readJournal(plan,index,{journalId:this.row(id).journals[index].journalId,signal:controller.signal});
        const sourceFiles=[];
        for(const [page,response]of responses.entries()){
          const file=await this.appendOperationFile(id,operationId,'response-'+index+'-'+page+'.json',response.bytes);
          await this.appendOperationFile(id,operationId,'response-'+index+'-'+page+'-metadata.json',json({request:response.request,status:response.status,headers:response.headers,receivedAt:response.receivedAt}));
          if(!response.ok){
            if(operation.action==='create-drafts'&&[401,403,404,405,413,415,429].includes(response.status))await this.workspace.serial(async()=>{this.row(id).journals[index].status='REJECTED';await this.workspace.commit('xero_draft_provider_rejected',operation.actor,{planId:id,operationId,index,httpStatus:response.status});});
            throw Object.assign(new Error('Xero returned HTTP '+response.status+'. The exact response and retry headers are retained with this operation.'),{code:'XERO_PROVIDER_RESPONSE',httpStatus:response.status});
          }
          let native;try{native=JSON.parse(response.bytes);}catch{}
          need(Array.isArray(native?.ManualJournals),'INVALID_XERO_NATIVE_RESPONSE','The native response did not contain a ManualJournals array; its exact bytes are retained.');
          sourceFiles.push(file.name);
        }
        await this.workspace.serial(async()=>{const row=this.row(id),journal=row.journals[index],current=this.operation(id,operationId);journal.sourceFiles=sourceFiles;current.journalSources[index]=sourceFiles;if(journal.status==='SENDING')journal.status='RESPONSE_RETAINED';await this.workspace.commit('xero_native_journal_source_selected',operation.actor,{planId:id,operationId,index});});
      }
    }catch(error){failure=error;}
    let capture;
    try{capture=await this.captureOperation(id,operationId);}catch(error){failure??=error;}
    await this.workspace.serial(async()=>{const row=this.row(id),operation=this.operation(id,operationId);operation.status=failure?(controller.signal.aborted?'INTERRUPTED':'FAILED'):'COMPLETE';operation.error=failure?safeError(failure):null;operation.finishedAt=now();operation.captureId=capture?.capture.id??null;
      for(const journal of row.journals)if(journal.status==='SENDING')journal.status='UNCERTAIN';
      await this.workspace.commit('xero_native_operation_finished',operation.actor,{planId:id,operationId,status:operation.status,captureId:operation.captureId,errorCode:operation.error?.code??null});});
  }
  async file(id,name){
    const row=clone(this.row(id));await this.plan(id);
    if(name==='xero-handoff.tar'){
      const files={};for(const file of row.files)files[file.name]=await exact(this.path(id),file);
      for(const saved of row.returns){const original=this.accountant.row(row.handoffId).revisions.find(revision=>revision.id===saved.returnId);need(original?.integrity.sha256===saved.sourceReturnSha256,'XERO_RETURN_LINK_CHANGED','A linked original accountant return changed.',409);
        for(const file of original.files){if(file.name.endsWith('.tar'))continue;files['accountant-returns/'+saved.returnId+'/'+file.name]=(await this.accountant.file(row.handoffId,file.name,{revisionId:saved.returnId})).bytes;}}
      files['delivery-state.json']=json(row);files['file-manifest.json']=json({schema:'stellar-forge.xero-files.v1',planId:id,files:Object.entries(files).map(([name,bytes])=>({name,bytes:bytes.length,sha256:hash(bytes)}))});
      return {bytes:tar(files),name:'merchant-xero-'+id+'.tar',type:'application/x-tar'};
    }
    const file=row.files.find(file=>file.name===name);need(file,'XERO_FILE_NOT_FOUND','Choose a retained Xero source file.',404);
    const type=({json:'application/json; charset=utf-8',csv:'text/csv; charset=utf-8',html:'text/html; charset=utf-8'})[name.split('.').at(-1)]??'application/octet-stream';
    return {bytes:await exact(this.path(id),file),name:'merchant-xero-'+id+'-'+name.replaceAll('/','-'),type};
  }
  async close(){this.closing=true;for(const controller of this.controllers)controller.abort();await Promise.allSettled([...this.tasks]);}
}
export async function handleXeroRequest(xero,{method,path,query={},value}){
  const parts=path.split('/').filter(Boolean);if(parts[0]!=='api'||parts[1]!=='xero')return null;
  if(parts.length===2&&method==='GET')return {value:xero.view()};
  if(path==='/api/xero/contexts/import'&&method==='POST')return {value:await xero.importContext(value)};
  if(path==='/api/xero/contexts/capture'&&method==='POST')return {value:await xero.captureContext(value)};
  if(path==='/api/xero/source'&&method==='GET')return {value:await xero.source(query.handoffId,query.contextId)};
  if(path==='/api/xero/preview'&&method==='POST')return {value:await xero.preview(value)};
  if(path==='/api/xero/plans'&&method==='POST')return {value:await xero.create(value)};
  if(parts[2]==='plans'&&parts[3]){
    const id=parts[3];if(parts.length===4&&method==='GET')return {value:await xero.detail(id)};
    if(parts[4]==='cancel'&&parts.length===5&&method==='POST')return {value:await xero.cancel(id,value)};
    if(parts[4]==='captures'&&parts.length===5&&method==='POST')return {value:await xero.importResponses(id,value)};
    if(parts[4]==='captures'&&parts[5]&&parts.length===6&&method==='GET')return {value:await xero.comparison(id,parts[5])};
    if(parts[4]==='captures'&&parts[5]&&parts[6]==='preview'&&parts.length===7&&method==='POST')return {value:await xero.returnPreview(id,parts[5],value)};
    if(parts[4]==='captures'&&parts[5]&&parts[6]==='returns'&&parts.length===7&&method==='POST')return {value:await xero.applyReturn(id,parts[5],value)};
    if(parts[4]==='operations'&&parts.length===5&&method==='POST')return {value:await xero.operate(id,value)};
    if(parts[4]==='operations'&&parts[5]&&parts.length===6&&method==='GET')return {value:clone(xero.operation(id,parts[5]))};
    if(parts[4]==='download'&&parts.length>=6&&method==='GET')return {file:await xero.file(id,parts.slice(5).map(decodeURIComponent).join('/'))};
  }
  need(false,'XERO_NOT_FOUND','This Xero workspace operation was not found.',404);
}
