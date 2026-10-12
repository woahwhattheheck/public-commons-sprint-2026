// MIT. Installed client-runbook operations share the original accounting writer.
import {createHash,randomUUID} from 'node:crypto';
import {RunbookWorkspace,runbookCanonical,runbookAssignment,runbookCycleSteps,runbookProfileFields,RUNBOOK_FILE_BYTES,RUNBOOK_PACKET_BYTES} from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/runbooks-workspace.mjs';
import {RUNBOOK_TOOL_PREFIX,RUNBOOK_HOST_REQUEST_SCHEMA,RUNBOOK_ACTIONS,RUNBOOK_INPUT_FIELDS,RUNBOOK_FILE_SELECTORS,runbookDefinitions,runbookWireHash,runbookHostBinding,runbookHostRequest,runbookOperationMatches} from './accounting-runbooks-contract.mjs';
export {runbookDefinitions};
export const runbookFileSelectors=RUNBOOK_FILE_SELECTORS;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value),copy=value=>structuredClone(value);
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,SHA=/^[a-f0-9]{64}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const nativeHash=(kind,target,input)=>sha(runbookCanonical({kind,target,input}));
const fail=(code,message)=>Object.assign(new Error(message),{code});
function need(ok,code,message){if(!ok)throw fail(code,message);}
function id(value,label){need(typeof value==='string'&&UUID.test(value),'RUNBOOK_INVALID_ID','Choose the original '+label+' UUID.');return value;}
function page(items,args,view,project=value=>value){
  const offset=args.offset??0,limit=args.limit??50;
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=50,'RUNBOOK_INVALID_PAGE','Choose a nonnegative offset and 1–50 complete records.');
  const selected=[];let bytes=2;
  for(let index=offset;index<items.length&&selected.length<limit;index++){
    const value=project(items[index]),size=Buffer.byteLength(JSON.stringify(value))+(selected.length?1:0);
    // Keep each row complete, including a single row larger than this page target.
    if(selected.length&&bytes+size>512*1024)break;
    selected.push(value);bytes+=size;
  }
  const next=offset+selected.length;
  return {view,items:copy(selected),offset,limit,total:items.length,nextOffset:next<items.length?next:null};
}
function editionHeader(edition){
  const {steps,resources,profiles,...header}=edition;
  return {...copy(header),stepCount:steps.length,resourceCount:resources.length,...(profiles===undefined?{}:{profileCount:profiles.length})};
}
function sourceHeader(source){
  if(source.kind==='files')return {kind:'files',originWorkspaceId:source.originWorkspaceId,label:source.label,note:source.note,sha256:source.sha256,fileCount:source.files.length};
  const {files,...header}=source;return {...copy(header),fileCount:files.length};
}
function cycleHeader(cycle){
  const progress={total:runbookCycleSteps(cycle).length,pending:0,complete:0,blocked:0,notApplicable:0};
  for(const step of runbookCycleSteps(cycle)){const state=cycle.work[step.id]?.status??'PENDING';progress[({PENDING:'pending',COMPLETE:'complete',BLOCKED:'blocked',NOT_APPLICABLE:'notApplicable'})[state]]++;}
  return {...runbookProfileFields(cycle),id:cycle.id,runbookId:cycle.runbookId,editionId:cycle.editionId,label:cycle.label,phase:cycle.phase,
    preparer:cycle.preparer,reviewer:cycle.reviewer,dueDate:cycle.dueDate,previousCycleId:cycle.previousCycleId,
    readOnly:cycle.readOnly===true,originWorkspaceId:cycle.originWorkspaceId,createdAt:cycle.createdAt,updatedAt:cycle.updatedAt,
    assignmentSha256:runbookAssignment(cycle).sha256,handoverCount:cycle.handovers?.length??0,
    source:sourceHeader(cycle.source),progress,submissionCount:cycle.submissions.length,reviewCount:cycle.reviews.length,historyCount:cycle.history.length};
}
function bookHeader(book){
  const edition=book.editions.find(row=>row.id===book.latestEditionId);
  return {id:book.id,name:edition.name,client:edition.client,latestEditionId:book.latestEditionId,editionCount:book.editions.length,createdAt:book.createdAt,updatedAt:book.updatedAt};
}
export class MerchantRunbooks{
  constructor(workspace,accountant,{readSource}={}){
    need(typeof readSource==='function','RUNBOOK_CONFIGURATION_ERROR','Use the original host-configured accounting file reader.');
    this.workspace=workspace;this.controller=new RunbookWorkspace(workspace,accountant);this.readSource=readSource;
  }
  async close(){await this.workspace.tail;}
  binding(args){
    if(args.workspaceId!==undefined)need(args.workspaceId===this.controller.workspaceId,'RUNBOOK_WORKSPACE_CHANGED','Reopen this request in its original accounting workspace.');
    if(args.expectedRevision!==undefined)need(args.expectedRevision===this.workspace.state.revision,'RUNBOOK_OBSERVATION_CHANGED','This original workspace changed between observations. Reopen its current selection.');
  }
  result(value={}){return this.controller.envelope(value);}
  async selectedFile(action,selected,{pinned=false}={}){
    need(plain(selected)&&Object.keys(selected).every(key=>['source','name','bytes','sha256'].includes(key))&&
      /^[a-z0-9][a-z0-9_-]{0,63}$/.test(selected.source??'')&&typeof selected.name==='string'&&selected.name.trim()&&
      selected.name.length<=160&&!/[\\/\r\n\0"]/.test(selected.name)&&!['.','..'].includes(selected.name),
      'RUNBOOK_SOURCE_REQUIRED','Choose a runbookInputs alias and its original filename, up to160 characters.');
    if(pinned)need(SHA.test(selected.sha256??'')&&Number.isSafeInteger(selected.bytes)&&selected.bytes>0,
      'RUNBOOK_SOURCE_BINDING_REQUIRED','Keep the original file SHA256 and byte count.');
    const maximum=action==='receive'?RUNBOOK_PACKET_BYTES:RUNBOOK_FILE_BYTES;
    const bytes=Buffer.from(await this.readSource(selected.source,maximum));
    need(bytes.length>0&&bytes.length<=maximum,'RUNBOOK_SOURCE_SIZE','Select the complete original file within its native size limit.');
    const actual=sha(bytes);
    need((selected.sha256===undefined||selected.sha256===actual)&&(selected.bytes===undefined||selected.bytes===bytes.length),
      'RUNBOOK_SOURCE_CHANGED','The configured input differs from the reviewed file. Keep the original request or prepare the actual current file.');
    return {bytes,reference:{source:selected.source,name:selected.name,bytes:bytes.length,sha256:actual}};
  }
  async prepare(args){
    const route=RUNBOOK_ACTIONS[args.action];
    need(route&&plain(args.input)&&Object.keys(args.input).every(key=>RUNBOOK_INPUT_FIELDS[args.action].includes(key)),
      'RUNBOOK_INVALID_REQUEST','Supply actor and this action’s native fields; preparation supplies workspaceId, revision and requestId.');
    need(route.target?UUID.test(args.cycleId??''):args.cycleId===undefined,'RUNBOOK_INVALID_SELECTION','Choose a period only for work, assign, submit or review.');
    const withFile=['attach','receive'].includes(args.action);
    need(withFile?plain(args.file):args.file===undefined,'RUNBOOK_INVALID_SELECTION','Attach and receive select one original configured file.');
    // Capture the revision first. A concurrent edit during input reading keeps this
    // prepared request stale; execute never silently moves it to newer state.
    const input={...copy(args.input),workspaceId:this.controller.workspaceId,requestId:args.requestId??randomUUID(),revision:this.workspace.state.revision};
    id(input.requestId,'request');
    let selected;
    if(withFile){
      selected=await this.selectedFile(args.action,args.file);
      if(args.action==='attach'){
        need(input.name===undefined||input.name===selected.reference.name,'RUNBOOK_SOURCE_NAME_CHANGED','Use the reviewed original filename.');
        input.name=selected.reference.name;
      }
    }
    const nativeInput=selected?{...input,content:selected.bytes.toString('base64')}:input,target=route.target?args.cycleId:null;
    const prepared={schema:RUNBOOK_HOST_REQUEST_SCHEMA,action:args.action,kind:route.kind,target,input,
      ...(selected?{file:selected.reference}:{}),requestSha256:nativeHash(route.kind,target,nativeInput)};
    prepared.wireSha256=runbookWireHash(runbookHostBinding(prepared));runbookHostRequest(prepared);
    return {workspaceId:input.workspaceId,revision:input.revision,prepared};
  }
  async reconcile(prepared){
    runbookHostRequest(prepared);this.binding({workspaceId:prepared.input.workspaceId});
    try{
      const current=await this.controller.operation(prepared.input.requestId);
      const result=runbookOperationMatches(prepared,current.operation);
      return this.result({status:'COMMITTED',requestId:prepared.input.requestId,requestSha256:prepared.requestSha256,
        operation:current.operation,result:copy(result)});
    }catch(error){
      if(error.code!=='RUNBOOK_OPERATION_NOT_FOUND')throw error;
      return this.result({status:'NOT_FOUND',requestId:prepared.input.requestId,requestSha256:prepared.requestSha256});
    }
  }
  async execute(prepared){
    let dispatched=false;
    try{
      const prior=await this.reconcile(prepared);
      if(prior.status==='COMMITTED')return {...prior.result,duplicate:true,currentRevision:prior.revision};
      const input=copy(prepared.input);
      if(prepared.file){const selected=await this.selectedFile(prepared.action,prepared.file,{pinned:true});input.content=selected.bytes.toString('base64');}
      need(nativeHash(prepared.kind,prepared.target,input)===prepared.requestSha256,'RUNBOOK_HOST_REQUEST_CHANGED','The expanded original request differs from its saved native digest.');
      const route=RUNBOOK_ACTIONS[prepared.action];dispatched=true;
      return await (route.target?this.controller[route.method](prepared.target,input):this.controller[route.method](input));
    }catch(error){if(!dispatched)error.applied=false;throw error;}
  }
  async file(args){
    const {cycleId,fileId,file}=args;
    need(Boolean(cycleId)!==Boolean(fileId),'RUNBOOK_INVALID_DOWNLOAD','Choose one original period or retained file.');
    if(fileId){
      need(file===undefined||file==='original','RUNBOOK_INVALID_DOWNLOAD','A retained file selects only its original file ID.');
      return this.controller.file(id(fileId,'file'));
    }
    id(cycleId,'period');
    const method={packet:'packet',print:'print','tasks.csv':'tasksCsv'}[file];
    need(method,'RUNBOOK_INVALID_DOWNLOAD','Choose packet, print or tasks.csv for this period.');
    return this.controller[method](cycleId);
  }
  async call(operation,args){
    await this.workspace.tail;this.binding(args);
    const name=operation.slice(RUNBOOK_TOOL_PREFIX.length),state=this.controller.state;
    switch(name){
      case 'status':{
        const view=args.view??'summary';
        if(view==='summary')return this.result({counts:{books:state.books.length,cycles:state.cycles.length,files:state.files.length,received:state.received.length,operations:state.operations.length},
          supportedSources:['accountant','files'],phases:['DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED'],fileBytes:RUNBOOK_FILE_BYTES,packetBytes:RUNBOOK_PACKET_BYTES});
        const entries={books:state.books,cycles:state.cycles,files:state.files,received:state.received}[view];
        need(entries,'RUNBOOK_INVALID_VIEW','Choose books, cycles, files or received packets.');
        return this.result({page:page(entries,args,view,view==='books'?bookHeader:view==='cycles'?cycleHeader:value=>value)});
      }
      case 'sources':{
        const view=args.view??'handoffs';
        if(view==='files')return this.result({page:page(state.files,args,view)});
        const sources=await this.controller.sources();this.binding(args);
        if(view==='revisions'){
          id(args.handoffId,'accountant handoff');const handoff=sources.handoffs.find(row=>row.id===args.handoffId);
          need(handoff,'RUNBOOK_HANDOFF_NOT_FOUND','Choose an actual retained accountant handoff.');
          return this.result({handoffId:handoff.id,page:page(handoff.revisions,args,view)});
        }
        need(args.handoffId===undefined,'RUNBOOK_INVALID_SELECTION','Select a handoff only for its exact return revisions.');
        need(view==='handoffs'||view==='closes','RUNBOOK_INVALID_VIEW','Choose handoffs, revisions, closes or files.');
        return this.result({page:page(sources[view],args,view,view==='handoffs'?row=>{const {revisions,...head}=row;return {...head,revisionCount:revisions.length};}:value=>value)});
      }
      case 'book':{
        const book=this.controller.book(args.runbookId),view=args.view??'summary';
        const edition=book.editions.find(row=>row.id===(args.editionId??book.latestEditionId));
        need(edition,'RUNBOOK_EDITION_NOT_FOUND','Choose an immutable edition from this client book.');
        const header={runbook:bookHeader(book),edition:editionHeader(edition)};
        if(view==='summary')return this.result(header);
        const entries={editions:book.editions,steps:edition.steps,profiles:edition.profiles??[],resources:edition.resources}[view];
        need(entries,'RUNBOOK_INVALID_VIEW','Choose editions, steps, profiles or resources.');
        return this.result({...header,page:page(entries,args,view,view==='editions'?editionHeader:value=>value)});
      }
      case 'cycle':{
        const cycle=this.controller.cycle(args.cycleId),view=args.view??'summary',header={cycle:cycleHeader(cycle),edition:editionHeader(cycle.edition),assignment:runbookAssignment(cycle)};
        if(view==='summary'||view==='assignment'){
          need(args.submissionId===undefined&&args.handoverId===undefined,'RUNBOOK_INVALID_SELECTION','Choose a saved preparation or handover only for its work view.');
          return this.result({...header,initialAssignments:copy(cycle.initialAssignments??{preparer:cycle.preparer,reviewer:cycle.reviewer,dueDate:cycle.dueDate})});
        }
        let entries,project=value=>value;
        if(view==='steps'){entries=runbookCycleSteps(cycle);project=step=>({...step,work:cycle.work[step.id]});}
        else if(view==='resources')entries=cycle.edition.resources;
        else if(view==='source_files')entries=cycle.source.files;
        else if(view==='submissions'){entries=cycle.submissions;project=row=>{const {work,...head}=row;return {...head,workCount:Object.keys(work).length};};}
        else if(view==='submission_work'){
          id(args.submissionId,'preparation round');const submission=cycle.submissions.find(row=>row.id===args.submissionId);
          need(submission,'RUNBOOK_SUBMISSION_NOT_FOUND','Choose a saved preparation round in this period.');
          entries=runbookCycleSteps(cycle);project=step=>({stepId:step.id,title:step.title,work:submission.work[step.id]});
          header.submission={id:submission.id,at:submission.at,actor:submission.actor,note:submission.note,workSha256:submission.workSha256};
        }else if(view==='handovers'){
          entries=cycle.handovers??[];project=row=>{const {work,...head}=row;return {...head,workCount:Object.keys(work).length};};
        }else if(view==='handover_work'){
          id(args.handoverId,'responsibility handover');const handover=(cycle.handovers??[]).find(row=>row.id===args.handoverId);
          need(handover,'RUNBOOK_HANDOVER_NOT_FOUND','Choose a saved handover in this original period.');
          entries=runbookCycleSteps(cycle);project=step=>({stepId:step.id,title:step.title,work:handover.work[step.id]});
          const {work,...head}=handover;header.handover={...copy(head),workCount:Object.keys(work).length};
        }else if(view==='reviews')entries=cycle.reviews;
        else if(view==='history')entries=cycle.history;
        need(entries,'RUNBOOK_INVALID_VIEW','Choose a supported original period view.');
        need(view==='submission_work'||args.submissionId===undefined,'RUNBOOK_INVALID_SELECTION','Select a preparation round only for its saved work.');
        need(view==='handover_work'||args.handoverId===undefined,'RUNBOOK_INVALID_SELECTION','Select a responsibility handover only for its saved work.');
        return this.result({...header,page:page(entries,args,view,project)});
      }
      case 'operation':return this.controller.operation(args.requestId);
      case 'prepare':return this.prepare(args);
      case 'execute':return this.execute(args.prepared);
      case 'reconcile':return this.reconcile(args.prepared);
      default:throw fail('RUNBOOK_TOOL_NOT_FOUND','Choose an original client-runbook operation.');
    }
  }
}
