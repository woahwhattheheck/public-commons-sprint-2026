// MIT. Retained chart-change review and unused-plan replacement in the original Store.
import {constants} from 'node:fs';
import {lstat,mkdir,open,link,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {accountingWorkspaceBinding} from './binding.mjs';
import {validateQuickBooksSelection} from '../../sf30-seller-sdk/oauth-connections/quickbooks.mjs';
import {validateQboCompany} from '../accountant/qbo-company.mjs';
import {checkQboSource} from '../accountant/qbo.mjs';
import {createXeroContext} from '../accountant/xero.mjs';
import {SOURCE_CHANGE_SCHEMA,changeCanonical as canonical,changeHash as hash,changeClone as clone,
  changeCheck as need,changeId as id,changeText as text,changeKind as kind,
  sourceEdition,planIdentity,compareSourceEditions,successorDefaults,successorRequest,assertSameEconomicSource} from '../accountant/source-change.mjs';

export const SOURCE_CHANGE_REQUEST_BYTES=32*1024*1024;
const FILE_LIMIT=192*1024*1024,EXPORT_LIMIT=384*1024*1024,MAX_REVIEWS=2000;
const now=()=>new Date().toISOString(),json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const same=(a,b)=>canonical(a)===canonical(b);
const safeError=error=>({error:typeof error?.code==='string'?error.code:'SOURCE_CHANGE_FAILED',message:String(error?.message??error).slice(0,2000)});
const owner=()=>process.geteuid?.()??process.getuid?.();
const entries=workspace=>workspace.state.sourceChanges??[];
const fileName=value=>{need(typeof value==='string'&&value.length<=240&&value.split('/').every(part=>/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part)&&part!=='.'&&part!=='..'),
  'SOURCE_CHANGE_FILE','Choose an exact retained source file.');return value;};
async function privateDirectory(path,{create=false}={}){
  if(create)try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  const stat=await lstat(path);need(stat.isDirectory()&&!stat.isSymbolicLink()&&!(stat.mode&0o077)&&(owner()===undefined||stat.uid===owner()),
    'SOURCE_CHANGE_PRIVATE_DIRECTORY','Use the original owner-controlled private workspace.',409);
}
async function syncDirectory(path){const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}}
async function readExact(root,file){
  fileName(file?.name);const parts=file.name.split('/');let parent=root;
  await privateDirectory(root);
  for(const part of parts.slice(0,-1)){parent=join(parent,part);await privateDirectory(parent);}
  const handle=await open(join(root,file.name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await handle.stat();need(before.isFile()&&before.size>0&&before.size<=FILE_LIMIT&&!(before.mode&0o077)&&
      (owner()===undefined||before.uid===owner()),'SOURCE_CHANGE_FILE_CHANGED','A retained source is not the original private regular file.',409);
    const bytes=await handle.readFile(),after=await handle.stat();
    need(bytes.length===file.bytes&&hash(bytes)===file.sha256&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,
      'SOURCE_CHANGE_FILE_CHANGED','A retained source file changed.',409);return bytes;
  }finally{await handle.close();}
}
async function immutable(root,name,bytes){
  fileName(name);need(!name.includes('/'),'SOURCE_CHANGE_FILE','Use the original flat review filename.');
  bytes=Buffer.from(bytes);need(bytes.length>0&&bytes.length<=FILE_LIMIT,'SOURCE_CHANGE_REVIEW_LIMIT','The retained review exceeds its 192 MiB bound.');
  await privateDirectory(root,{create:true});
  const file={name,bytes:bytes.length,sha256:hash(bytes)},temporary=join(root,'.prepare-'+randomUUID());
  const handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{
    try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
    try{await link(temporary,join(root,name));}catch(error){if(error.code!=='EEXIST')throw error;await readExact(root,file);}
    await syncDirectory(root);return file;
  }finally{await rm(temporary,{force:true});}
}
function eligibility(provider,row){
  const blockers=[];
  if(provider==='qbo'){
    if(!['DRAFT','REVIEWED'].includes(row.status)||row.cancellation)blockers.push('The original journal is already cancelled or booked.');
    if(row.nativePost)blockers.push('The original journal retains a native posting request; continue that original operation.');
    if(row.responses?.length)blockers.push('The original journal retains a provider response; use its original reconciliation.');
  }else{
    if(row.cancelledAt)blockers.push('The original plan is already cancelled.');
    if(row.operations?.length)blockers.push('The original plan retains a native operation; preserve and reconcile its exact journals.');
    if(row.journals?.some(item=>item.attempted||item.journalId||item.status!=='READY'))blockers.push('A journal is already attempted, received or under reconciliation.');
    if(row.captures?.length||row.returnIntents?.length||row.returns?.length)blockers.push('The original plan retains a comparison or accountant return.');
  }
  return {eligible:blockers.length===0,blockers};
}
function publicRecord(row){
  const {files,inputSha256,predecessorRecordSha256,...result}=row;
  return clone(result);
}
function applyShape(value){
  id(value.id);text(value.actor,'the approving operator',1000);text(value.note,'the change approval',1500);
  need(/^[a-f0-9]{64}$/.test(value.previewSha256??''),'SOURCE_CHANGE_PREVIEW','Use the retained native successor preview.');
  need(value.unusedConfirmed===true&&value.noExternalImport===true&&value.mappingConfirmed===true,
    'SOURCE_CHANGE_CONFIRMATION','Confirm the original plan is unused, no exported journal was imported externally, and the exact mappings and values are reviewed.');
}

/** Shares the original lease, revisions, native controllers and complete backup. No provider is created. */
export class SourceChangeWorkspace{
  constructor(workspace,{qbo=null,xero,connections=null}={}){
    this.workspace=workspace;this.qbo=qbo;this.xero=xero;this.connections=connections;
    this.root=join(workspace.directory,'source-changes');this.tasks=new Set();this.runs=new Map();
    this.closing=false;this.closePromise=null;this.reopenRequired=false;
  }
  binding(){const {workspaceId,sourcesSha256}=accountingWorkspaceBinding(this.workspace.directory,this.workspace.state);return {workspaceId,sourcesSha256};}
  assertBinding(value){
    need(value&&same(value,this.binding()),'SOURCE_CHANGE_WORKSPACE_CHANGED',
      'This request belongs to a different original accounting workspace or source configuration.',409);
  }
  available(provider){kind(provider);const native=provider==='qbo'?this.qbo:this.xero;need(native,'SOURCE_CHANGE_PROVIDER_UNAVAILABLE',
    'This original workspace does not expose that accounting provider.',409);return native;}
  assertWritable(){this.workspace.assertWritable?.();need(!this.closing,'SOURCE_CHANGE_CLOSING','The original workspace is closing.',503);
    need(!this.reopenRequired,'SOURCE_CHANGE_REOPEN_REQUIRED','A source-change write had an uncertain outcome. Reopen the original workspace before continuing its retained request.',409);}
  track(work){this.assertWritable();const task=Promise.resolve().then(work);this.tasks.add(task);task.finally(()=>this.tasks.delete(task)).catch(()=>{});return task;}
  async committed(work){try{return await work();}catch(error){this.reopenRequired=true;throw error;}}
  row(changeId){const row=entries(this.workspace).find(row=>row.id===id(changeId));need(row,'SOURCE_CHANGE_NOT_FOUND',
    'This source-change review is not retained in this original workspace.',404);return row;}
  nativeRow(provider,planId){return this.available(provider).row(id(planId));}
  async review(row){
    const value=JSON.parse(await readExact(join(this.root,row.id),row.files.find(file=>file.name==='review.json')));
    need(value.schema===SOURCE_CHANGE_SCHEMA&&value.id===row.id&&same(value.binding,row.binding)&&value.inputSha256===row.inputSha256&&
      value.previewSha256===row.previewSha256&&value.comparison.sha256===row.comparisonSha256&&value.kind===row.kind&&
      value.predecessor.id===row.planId&&value.request.id===row.successorId&&planIdentity(row.kind,value.plan)===row.previewSha256,
      'SOURCE_CHANGE_REVIEW_CHANGED','The retained review or native preview identity changed.',409);
    assertSameEconomicSource(row.kind,value.predecessor,value.plan);return value;
  }
  async captureContext(contextId,sha256){
    const native=this.available('xero'),row=native.contextRow(id(contextId)),context=await native.context(contextId);
    need(context.sha256===sha256,'SOURCE_CHANGE_TARGET_CHANGED','The selected retained Xero context changed.',409);
    const files=[];for(const file of row.files){const bytes=await readExact(native.contextPath(contextId),file);
      files.push({...file,base64:bytes.toString('base64')});}
    const get=name=>Buffer.from(files.find(file=>file.name===name)?.base64??'','base64');
    const rebuilt=createXeroContext({id:context.id,name:context.name,actor:context.actor,createdAt:context.createdAt,
      tenantId:context.tenantId,organizationBytes:get('organization.json'),accountsBytes:get('accounts.json')});
    need(same(rebuilt,context),'SOURCE_CHANGE_TARGET_CHANGED','The Xero chart differs from its retained original response bytes.',409);
    return {edition:context,files};
  }
  async target(provider,target){
    need(target&&typeof target==='object','SOURCE_CHANGE_TARGET','Choose an original retained chart edition.');
    if(provider==='xero'){
      need(target.kind==='xero-context','SOURCE_CHANGE_TARGET','Choose an original Xero context from the same workspace.');
      const captured=await this.captureContext(target.id,target.sha256);
      return {...captured,descriptor:{kind:target.kind,id:captured.edition.id,sha256:captured.edition.sha256,name:captured.edition.name,
        tenantId:captured.edition.tenantId,createdAt:captured.edition.createdAt}};
    }
    if(target.kind==='qbo-review'){
      need(this.connections,'SOURCE_CHANGE_CONNECTIONS_REQUIRED','Use this managed application’s original Connections capture, or import an original company snapshot.',409);
      const downloaded=await this.connections.download(id(target.id),'selection.json'),bytes=Buffer.from(downloaded.bytes);
      need(bytes.length<=32*1024*1024,'SOURCE_CHANGE_TARGET_LIMIT','Use the original bounded QuickBooks selection.');
      const selection=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));validateQuickBooksSelection(selection);
      need(selection.integrity.sha256===target.sha256,'SOURCE_CHANGE_TARGET_CHANGED','The selected original company review changed.',409);
      return {edition:selection.company,descriptor:{kind:target.kind,id:target.id,sha256:selection.integrity.sha256,
        companySha256:selection.company.integrity.sha256,realmId:selection.realmId,environment:selection.environment,
        alias:selection.alias,profileSha256:selection.profileSha256,grantId:selection.grantId,capturedAt:selection.capturedAt},
        files:[{name:'selection.json',bytes:bytes.length,sha256:hash(bytes),base64:bytes.toString('base64')}]};
    }
    need(target.kind==='qbo-snapshot','SOURCE_CHANGE_TARGET','Choose a retained QuickBooks company review or normalized company snapshot.');
    validateQboCompany(target.snapshot);const bytes=json(target.snapshot);
    need(bytes.length<=SOURCE_CHANGE_REQUEST_BYTES,'SOURCE_CHANGE_TARGET_LIMIT','Use the original bounded company snapshot.');
    return {edition:clone(target.snapshot),descriptor:{kind:target.kind,sha256:target.snapshot.integrity.sha256,
      realmId:target.snapshot.realmId,name:target.snapshot.companyName},files:[{name:'company.json',bytes:bytes.length,sha256:hash(bytes),base64:bytes.toString('base64')}]};
  }
  async inspectInside(value){
    this.assertBinding(value.binding);const provider=kind(value.kind),native=this.available(provider),record=clone(native.row(id(value.planId))),previous=await native.plan(value.planId);
    const captured=await this.target(provider,value.target);let baseline;
    if(provider==='qbo'){
      need(previous.companySnapshot,'SOURCE_CHANGE_BASELINE_REQUIRED','This older journal has no retained native chart baseline. Continue it through the original QuickBooks page.',409);
      baseline={edition:previous.companySnapshot,files:[]};
      if(captured.descriptor.environment)need(captured.descriptor.environment===previous.environment,'SOURCE_CHANGE_ENVIRONMENT',
        'Retain the original QuickBooks sandbox or production environment.',409);
    }else baseline=await this.captureContext(previous.context.id,previous.context.sha256);
    const comparison=compareSourceEditions(provider,previous,baseline.edition,captured.edition),status=eligibility(provider,record);
    const before=sourceEdition(provider,baseline.edition),after=sourceEdition(provider,captured.edition);
    return {provider,native,record,previous,baseline,captured,comparison,
      public:{schema:SOURCE_CHANGE_SCHEMA,binding:this.binding(),revision:this.workspace.state.revision,kind:provider,planId:previous.id,
        predecessor:{id:previous.id,name:previous.name,sha256:planIdentity(provider,previous),...status},
        target:captured.descriptor,comparison,accounts:after.accounts,defaults:successorDefaults(provider,previous,captured.edition),
        source:{before:{sha256:before.sha256,company:before.company},after:{...captured.descriptor,company:after.company}}}};
  }
  inspect(value){value=clone(value);return this.workspace.serial(async()=>(await this.inspectInside(value)).public);}
  async catalog(){
    return this.workspace.serial(async()=>{
      const plans=[];
      for(const provider of ['qbo','xero']){
        if(provider==='qbo'&&!this.qbo||provider==='xero'&&!this.xero)continue;
        for(const row of provider==='qbo'?this.workspace.state.qboPlans??[]:this.workspace.state.xeroPlans??[]){
          const baselineAvailable=provider==='xero'||Boolean((await this.qbo.plan(row.id)).companySnapshot);
          const status=eligibility(provider,row);if(!baselineAvailable)status.blockers.push('This older plan has no retained native company chart.');
          plans.push({kind:provider,id:row.id,name:row.name,sha256:provider==='qbo'?row.integrity.sha256:row.planSha256,
            company:provider==='qbo'?row.companyName:(this.workspace.state.xeroContexts??[]).find(item=>item.id===row.contextId)?.organization?.name??row.tenantId,
            baseCurrency:provider==='qbo'?row.baseCurrency:row.summary.baseCurrency,baselineAvailable,
            eligible:status.eligible&&baselineAvailable,blockers:status.blockers});
        }
      }
      return {schema:SOURCE_CHANGE_SCHEMA,binding:this.binding(),revision:this.workspace.state.revision,reopenRequired:this.reopenRequired,plans,
        contexts:(this.workspace.state.xeroContexts??[]).map(row=>({id:row.id,name:row.name,tenantId:row.tenantId,sha256:row.contextSha256,createdAt:row.createdAt})),
        changes:entries(this.workspace).map(publicRecord),connectionsAvailable:Boolean(this.connections)};
    });
  }
  async sources({offset=0,limit=50}={}){
    need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,
      'SOURCE_CHANGE_PAGE','Choose a source page of 1–100 entries.');
    const result=this.connections?await this.connections.history({offset,limit}):{reviews:[],total:0,nextOffset:null};
    return {schema:SOURCE_CHANGE_SCHEMA,binding:this.binding(),...result};
  }
  async detailInside(changeId){
    const row=this.row(changeId),review=await this.review(row),native=this.available(row.kind),previous=native.row(row.planId);
    const records=row.kind==='qbo'?this.workspace.state.qboPlans??[]:this.workspace.state.xeroPlans??[];
    const successor=records.find(record=>record.id===row.successorId),status=eligibility(row.kind,previous);
    if(successor)need(planIdentity(row.kind,await native.plan(successor.id))===row.previewSha256,
      'SOURCE_CHANGE_SUCCESSOR_CHANGED','The original successor UUID now names different journal content.',409);
    return {schema:SOURCE_CHANGE_SCHEMA,binding:this.binding(),revision:this.workspace.state.revision,reopenRequired:this.reopenRequired,
      record:publicRecord(row),review:{comparison:review.comparison,source:review.source,request:review.request,plan:review.plan,predecessor:review.predecessor},
      current:{predecessorEligible:status.eligible,blockers:status.blockers,predecessorCancelled:row.kind==='qbo'?Boolean(previous.cancellation):Boolean(previous.cancelledAt),
        successorExists:Boolean(successor),successorStatus:successor?(row.kind==='qbo'?successor.status:successor.cancelledAt?'CANCELLED':successor.journals.map(item=>item.status).join(', ')):null}};
  }
  detail(changeId){id(changeId);return this.workspace.serial(()=>this.detailInside(changeId));}
  async originalPreview(provider,previous,target,input){
    let current;
    if(provider==='qbo'){
      current=await this.qbo.current(previous.handoffId);checkQboSource(previous,current.handoff,current.parent);
      const request=successorRequest(provider,previous,target,input,{accountantRevisionId:current.parent?.id??null});
      return this.qbo.preparePlan(request);
    }
    current=await this.xero.originals(previous.source.handoffId);
    need((current.revision?.id??null)===(previous.source.accountantRevisionId??null),'SOURCE_CHANGE_ACCOUNTANT_CHANGED',
      'The original accountant baseline changed. Review that retained return before replacing this plan.',409);
    return this.xero.preview(successorRequest(provider,previous,target,input,{accountantRevisionId:current.revision?.id??null}));
  }
  checkConflicts(provider,preview,predecessorId){
    if(provider==='xero'){
      const remaining=preview.conflicts.filter(conflict=>conflict.planId!==predecessorId);
      need(!remaining.length,'SOURCE_CHANGE_OTHER_RESERVATION','Other retained plans reserve selected components or buyer economic events. Resolve those original plans first.',409);
      return;
    }
    const selected=new Set(preview.plan.rows.map(row=>row.eventId));
    need(!(this.workspace.state.qboPlans??[]).some(row=>row.id!==predecessorId&&row.id!==preview.plan.id&&
      ['REVIEWED','BOOKED'].includes(row.status)&&row.realmId===preview.plan.realmId&&row.environment===preview.plan.environment&&row.eventIds.some(eventId=>selected.has(eventId))),
      'SOURCE_CHANGE_OTHER_RESERVATION','Another reviewed or booked QuickBooks plan already reserves these original events.',409);
  }
  prepare(value){
    value=clone(value);this.assertBinding(value.binding);id(value.id);kind(value.kind);id(value.planId);
    const inputSha256=hash(value);
    return this.track(()=>this.workspace.serial(async()=>{
      this.assertWritable();this.assertBinding(value.binding);
      const prior=entries(this.workspace).find(row=>row.id===value.id);
      if(prior){need(prior.inputSha256===inputSha256,'SOURCE_CHANGE_REQUEST_CHANGED','This review UUID belongs to another source or mapping request.',409);return this.detailInside(prior.id);}
      need(entries(this.workspace).length<MAX_REVIEWS,'SOURCE_CHANGE_LIMIT','This original workspace retains 2,000 source-change reviews.');
      const inspected=await this.inspectInside(value);
      need(inspected.public.predecessor.eligible,'SOURCE_CHANGE_PLAN_IN_USE',inspected.public.predecessor.blockers.join(' '),409);
      need(value.predecessorSha256===inspected.public.predecessor.sha256&&value.comparisonSha256===inspected.comparison.sha256,
        'SOURCE_CHANGE_INSPECTION_CHANGED','Inspect and review the exact current source editions before retaining mappings.',409);
      text(value.rationale,'the reason for this source change',4000);
      need(value.valuationConfirmed===true,'SOURCE_CHANGE_VALUATION','Review all values in the selected company’s base currency; this workflow does not infer exchange rates.');
      const prepared=await this.originalPreview(inspected.provider,inspected.previous,inspected.captured.edition,value.successor);
      assertSameEconomicSource(inspected.provider,inspected.previous,prepared.plan);
      this.checkConflicts(inspected.provider,prepared,inspected.previous.id);
      need(!(inspected.provider==='qbo'?this.workspace.state.qboPlans??[]:this.workspace.state.xeroPlans??[]).some(row=>row.id===prepared.request.id),
        'SOURCE_CHANGE_SUCCESSOR_EXISTS','Use a new successor UUID; retain an existing successor through its original change review.',409);
      need(!entries(this.workspace).some(row=>row.kind===inspected.provider&&row.successorId===prepared.request.id),
        'SOURCE_CHANGE_SUCCESSOR_CLAIMED','Another retained source-change review already owns that successor UUID.',409);
      const review={schema:SOURCE_CHANGE_SCHEMA,id:value.id,binding:this.binding(),kind:inspected.provider,inputSha256,
        actor:prepared.request.actor,createdAt:prepared.request.createdAt,rationale:value.rationale,valuationConfirmed:true,
        source:inspected.public.source,target:clone(value.target),comparison:inspected.comparison,
        predecessor:inspected.previous,predecessorRecord:inspected.record,
        baseline:{edition:inspected.baseline.edition,files:inspected.baseline.files},
        selected:{edition:inspected.captured.edition,files:inspected.captured.files},
        request:prepared.request,plan:prepared.plan,previewSha256:prepared.previewSha256};
      const entry={id:value.id,binding:this.binding(),kind:inspected.provider,planId:inspected.previous.id,
        predecessorSha256:planIdentity(inspected.provider,inspected.previous),predecessorRecordSha256:hash(inspected.record),
        successorId:prepared.request.id,name:prepared.request.name,actor:prepared.request.actor,createdAt:prepared.request.createdAt,rationale:value.rationale,
        inputSha256,previewSha256:prepared.previewSha256,comparisonSha256:inspected.comparison.sha256,
        phase:'PREPARED',intent:null,cancelledAt:null,completedAt:null,rejections:[],files:[]};
      await this.committed(async()=>{
        await privateDirectory(this.root,{create:true});entry.files=[await immutable(join(this.root,entry.id),'review.json',json(review))];
        await syncDirectory(this.root);this.workspace.state.sourceChanges??=[];this.workspace.state.sourceChanges.push(entry);
        await this.workspace.commit('accounting_source_change_prepared',entry.actor,{changeId:entry.id,kind:entry.kind,planId:entry.planId,successorId:entry.successorId});
      });
      return this.detailInside(entry.id);
    }));
  }
  async freshBeforeCancellation(row,review){
    const native=this.available(row.kind),actual=clone(native.row(row.planId)),status=eligibility(row.kind,actual);
    need(status.eligible,'SOURCE_CHANGE_PLAN_IN_USE',status.blockers.join(' '),409);
    need(hash(actual)===row.predecessorRecordSha256&&planIdentity(row.kind,await native.plan(row.planId))===row.predecessorSha256,
      'SOURCE_CHANGE_PREDECESSOR_CHANGED','The selected original plan or its review/operation state changed.',409);
    const existingPlans=row.kind==='qbo'?this.workspace.state.qboPlans??[]:this.workspace.state.xeroPlans??[];
    need(!existingPlans.some(item=>item.id===row.successorId),'SOURCE_CHANGE_SUCCESSOR_EXISTS',
      'The successor UUID appeared before this original cancellation. Review that original plan instead of cancelling another plan automatically.',409);
    const selected=await this.target(row.kind,review.target);
    need(sourceEdition(row.kind,selected.edition).sha256===sourceEdition(row.kind,review.selected.edition).sha256,
      'SOURCE_CHANGE_TARGET_CHANGED','The selected target source edition changed.',409);
    let preview;
    if(row.kind==='qbo')preview=await native.preparePlan(review.request);
    else{
      const current=await native.originals(review.request.handoffId);
      need((current.revision?.id??'initial')===review.request.accountantRevisionId,'SOURCE_CHANGE_ACCOUNTANT_CHANGED',
        'The original accountant baseline changed before cancellation.',409);
      preview=await native.preview(review.request);
    }
    assertSameEconomicSource(row.kind,review.predecessor,preview.plan);
    need(preview.previewSha256===row.previewSha256,'SOURCE_CHANGE_PREVIEW_CHANGED','The exact original successor preview changed.',409);
    this.checkConflicts(row.kind,preview,row.planId);
  }
  assertClaim(row){
    need(!entries(this.workspace).some(other=>other.id!==row.id&&other.kind===row.kind&&other.planId===row.planId&&other.intent),
      'SOURCE_CHANGE_ALREADY_CLAIMED','Another retained source-change request already owns this predecessor’s cancellation and successor.',409);
  }
  async retainRejection(row,input,inputSha256,error){
    need(row.rejections.length<100,'SOURCE_CHANGE_REJECTION_LIMIT','This review retains 100 rejected application requests; prepare a fresh review before further approval.');
    const rejection={id:input.id,requestSha256:inputSha256,state:'rejected',...safeError(error),createdAt:now()};
    row.rejections.push(rejection);
    await this.committed(()=>this.workspace.commit('accounting_source_change_rejected',String(input.actor??row.actor).slice(0,1000),
      {changeId:row.id,requestId:input.id,requestSha256:inputSha256,error:rejection.error}));
    return rejection;
  }
  rejected(rejection){const error=Object.assign(new Error(rejection.message),{code:rejection.error,status:409,
    sourceChangeRejection:clone(rejection)});throw error;}
  apply(changeId,value){
    id(changeId);value=clone(value);this.assertBinding(value.binding);id(value.id);const inputSha256=hash(value);
    return this.track(async()=>{
      const outcome=await this.workspace.serial(async()=>{
        this.assertWritable();this.assertBinding(value.binding);const row=this.row(changeId);
        const rejected=row.rejections.find(item=>item.id===value.id);
        if(rejected){need(rejected.requestSha256===inputSha256,'SOURCE_CHANGE_REQUEST_CHANGED','This application UUID belongs to another request.',409);return {rejection:rejected};}
        if(row.intent){need(row.intent.id===value.id&&row.intent.requestSha256===inputSha256,
          'SOURCE_CHANGE_REQUEST_CHANGED','Continue the exact retained original application request.',409);return {};}
        const review=await this.review(row);
        try{
          applyShape(value);this.workspace.expected(value.revision);
          need(value.previewSha256===row.previewSha256,'SOURCE_CHANGE_PREVIEW_CHANGED','Approve the exact retained successor preview.',409);
          this.assertClaim(row);await this.freshBeforeCancellation(row,review);
        }catch(error){
          if(Number.isInteger(error.status)&&error.status>=400&&error.status<500)return {rejection:await this.retainRejection(row,value,inputSha256,error)};
          throw error;
        }
        const actor=value.actor.trim(),reason='Source change '+row.id+' / application '+value.id+': '+value.note.trim();
        const cancellation=row.kind==='qbo'?{id:value.id,actor,note:reason,planSha256:row.predecessorSha256,unusedConfirmed:true}:
          {actor,reason,noExternalImport:true};
        row.intent={id:value.id,requestSha256:inputSha256,actor,note:value.note,createdAt:now(),cancellation,
          successorId:row.successorId,previewSha256:row.previewSha256};
        row.phase='APPLYING';
        await this.committed(()=>this.workspace.commit('accounting_source_change_application_prepared',value.actor,
          {changeId:row.id,requestId:value.id,planId:row.planId,successorId:row.successorId}));
        return {};
      });
      if(outcome.rejection)this.rejected(outcome.rejection);
      return this.run(changeId);
    });
  }
  resume(changeId,value){
    id(changeId);value=clone(value);this.assertBinding(value.binding);id(value.id);
    return this.track(async()=>{
      await this.workspace.serial(async()=>{this.assertWritable();this.assertBinding(value.binding);const row=this.row(changeId);
        need(row.intent?.id===value.id,'SOURCE_CHANGE_ORIGINAL_REQUEST','Resume the exact retained application UUID; no new cancellation is prepared.',409);});
      return this.run(changeId);
    });
  }
  async cancellationObserved(row,review){
    const actual=this.nativeRow(row.kind,row.planId),intent=row.intent;
    if(row.kind==='qbo'){
      if(!actual.cancellation)return false;
      const request=intent.cancellation,receipt=actual.cancellation;
      need(receipt.id===intent.id&&receipt.requestSha256===hash(request)&&Object.keys(request).every(key=>same(receipt[key],request[key]))&&
        same(actual,{...review.predecessorRecord,status:'CANCELLED',cancellation:receipt}),
        'SOURCE_CHANGE_CANCELLATION_CHANGED','The original QuickBooks cancellation is not this retained request.',409);
    }else{
      if(!actual.cancelledAt)return false;
      need(actual.cancellationReason===intent.cancellation.reason&&
        same(actual,{...review.predecessorRecord,cancelledAt:actual.cancelledAt,cancellationReason:intent.cancellation.reason}),
        'SOURCE_CHANGE_CANCELLATION_CHANGED','The original Xero plan was cancelled by a different request or subsequently changed.',409);
      const history=this.workspace.state.history.filter(item=>item.action==='xero_unused_plan_cancelled'&&item.planId===row.planId&&
        item.actor===intent.actor&&item.reason===intent.cancellation.reason);
      need(history.length===1,'SOURCE_CHANGE_CANCELLATION_CHANGED','The original Xero cancellation actor and retained history do not match this application.',409);
    }
    return true;
  }
  run(changeId){
    if(this.runs.has(changeId))return this.runs.get(changeId);
    const task=this.runOriginal(changeId);this.runs.set(changeId,task);
    task.finally(()=>this.runs.delete(changeId)).catch(()=>{});return task;
  }
  async runOriginal(changeId){
    this.assertWritable();
    let review,entry,cancelled,cancelRevision,createRevision;
    await this.workspace.serial(async()=>{
      entry=clone(this.row(changeId));need(entry.intent,'SOURCE_CHANGE_ORIGINAL_REQUEST','Retain an exact application request before continuing.',409);
      review=await this.review(entry);this.assertClaim(entry);
      cancelled=await this.cancellationObserved(entry,review);
      if(!cancelled)await this.freshBeforeCancellation(entry,review);
      cancelRevision=this.workspace.state.revision;
    });
    const native=this.available(entry.kind);
    if(!cancelled){
      // Original mutations acquire their own serial lease. Never nest these calls.
      await this.committed(()=>native.cancel(entry.planId,{...entry.intent.cancellation,revision:cancelRevision}));
    }
    await this.workspace.serial(async()=>{
      const row=this.row(changeId);need(await this.cancellationObserved(row,review),'SOURCE_CHANGE_CANCELLATION_MISSING',
        'The original cancellation has not been retained.',409);
      const nativeRows=row.kind==='qbo'?this.workspace.state.qboPlans??[]:this.workspace.state.xeroPlans??[];
      if(!nativeRows.some(item=>item.id===row.successorId)){
        const preview=await this.originalPreview(row.kind,review.predecessor,review.selected.edition,review.request);
        assertSameEconomicSource(row.kind,review.predecessor,preview.plan);
        need(preview.previewSha256===row.previewSha256,'SOURCE_CHANGE_PREVIEW_CHANGED','The retained successor source or mappings changed after cancellation.',409);
        this.checkConflicts(row.kind,preview,row.planId);
      }
      if(row.phase!=='COMPLETED'&&row.phase!=='CANCELLED_PENDING_SUCCESSOR'){
        row.phase='CANCELLED_PENDING_SUCCESSOR';row.cancelledAt=now();
        await this.committed(()=>this.workspace.commit('accounting_source_change_predecessor_cancelled',row.intent.actor,
          {changeId:row.id,requestId:row.intent.id,planId:row.planId,successorId:row.successorId}));
      }
      createRevision=this.workspace.state.revision;
    });
    // A completed call still uses the original create method's exact identity check.
    await this.committed(()=>native.create({...review.request,previewSha256:entry.previewSha256,revision:createRevision}));
    return this.workspace.serial(async()=>{
      const row=this.row(changeId),plan=await native.plan(row.successorId);
      need(planIdentity(row.kind,plan)===row.previewSha256,'SOURCE_CHANGE_SUCCESSOR_CHANGED','The original successor differs from the approved native preview.',409);
      assertSameEconomicSource(row.kind,review.predecessor,plan);
      if(row.phase!=='COMPLETED'){
        row.phase='COMPLETED';row.completedAt=now();
        await this.committed(()=>this.workspace.commit('accounting_source_change_completed',row.intent.actor,
          {changeId:row.id,requestId:row.intent.id,planId:row.planId,successorId:row.successorId,previewSha256:row.previewSha256}));
      }
      return this.detailInside(changeId);
    });
  }
  async download(changeId){
    return this.workspace.serial(async()=>{
      const row=this.row(changeId),detail=await this.detailInside(changeId),review=await this.review(row),files=[],withheld=[];let size=0;
      const add=(path,bytes)=>{fileName(path);bytes=Buffer.from(bytes);size+=Math.ceil(bytes.length*4/3)+path.length+240;
        need(size<=EXPORT_LIMIT,'SOURCE_CHANGE_EXPORT_LIMIT','This complete handoff exceeds 384 MiB. Use the original full operating backup.');
        files.push({path,bytes:bytes.length,sha256:hash(bytes),base64:bytes.toString('base64')});};
      add('source-change/review.json',await readExact(join(this.root,row.id),row.files[0]));
      add('source-change/record.json',json(row));add('source-change/current.json',json(detail));
      const native=this.available(row.kind),nativeRows=row.kind==='qbo'?this.workspace.state.qboPlans??[]:this.workspace.state.xeroPlans??[];
      for(const planId of [row.planId,row.successorId]){
        const nativeRow=nativeRows.find(item=>item.id===planId);if(!nativeRow)continue;
        add('plans/'+planId+'/record.json',json(nativeRow));
        const root=row.kind==='qbo'?native.directory(planId):native.path(planId);
        for(const file of nativeRow.files){
          // Preserve the original explicit QuickBooks journal export gate.
          if(row.kind==='qbo'&&file.name==='journal-entry.json'&&!['REVIEWED','BOOKED'].includes(nativeRow.status)){
            withheld.push({path:'plans/'+planId+'/'+file.name,bytes:file.bytes,sha256:file.sha256,
              reason:'The original QuickBooks export requires a reviewed or booked active plan. The cancelled predecessor remains in the complete operating backup.'});
            continue;
          }
          const opened=await native.file(planId,file.name);
          add('plans/'+planId+'/'+file.name,opened.bytes);
        }
        if(row.kind==='qbo')for(const response of nativeRow.responses??[])for(const file of response.files??[])
          add('plans/'+planId+'/responses/'+response.id+'/'+file.name,await readExact(join(root,'responses',response.id),file));
      }
      const body={schema:'stellar-forge.accounting-source-change-handoff.v1',binding:this.binding(),changeId:row.id,
        revision:this.workspace.state.revision,phase:row.phase,files,withheldNativeRequests:withheld,
        recovery:'Use the original full operating backup and restore commands for the complete private workspace, native files and provider-response history.'};
      return {bytes:json({...body,sha256:hash(body)}),name:'source-change-'+row.id+'.json',type:'application/json; charset=utf-8'};
    });
  }
  close(){
    if(!this.closePromise){this.closing=true;this.closePromise=Promise.allSettled([...this.tasks,...this.runs.values()]).then(()=>undefined);}
    return this.closePromise;
  }
}
export async function handleSourceChangeRequest(owner,{method,path,value,query={}}){
  if(path!=='/api/source-changes'&&!path.startsWith('/api/source-changes/'))return null;
  try{
    need(owner,'SOURCE_CHANGE_UNAVAILABLE','The original source-change controller is not available.',503);
    if(path==='/api/source-changes'&&method==='GET')return {value:await owner.catalog()};
    if(path==='/api/source-changes/sources'&&method==='GET')return {value:await owner.sources({offset:Number(query.offset??0),limit:Number(query.limit??50)})};
    if(path==='/api/source-changes/inspect'&&method==='POST')return {value:await owner.inspect(value)};
    if(path==='/api/source-changes/prepare'&&method==='POST')return {value:await owner.prepare(value)};
    const parts=path.split('/').filter(Boolean);
    if(parts.length>=3&&parts.length<=4){
      const changeId=id(parts[2]);
      if(parts.length===3&&method==='GET')return {value:await owner.detail(changeId)};
      if(parts[3]==='download'&&method==='GET')return {file:await owner.download(changeId)};
      if(parts[3]==='apply'&&method==='POST')return {value:await owner.apply(changeId,value)};
      if(parts[3]==='resume'&&method==='POST')return {value:await owner.resume(changeId,value)};
    }
    need(false,'SOURCE_CHANGE_ROUTE','Choose an original source-change action.',404);
  }catch(error){
    const command=error.sourceChangeRejection;
    return {status:error.status??400,value:{schema:SOURCE_CHANGE_SCHEMA,binding:owner?.binding()??null,reopenRequired:Boolean(owner?.reopenRequired||owner?.workspace?.commitUncertainty||error.reopenRequired),
      ...safeError(error),outcome:command?'rejected':error.code==='SOURCE_CHANGE_NOT_FOUND'?'not_found':'unknown',...(command?{command}:{})}};
  }
}
