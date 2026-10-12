// MIT. Client close procedures over the original accounting workspace and writer lease.
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {link,lstat,mkdir,open,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {accountingWorkspaceBinding} from './binding.mjs';
import {validateHandoff,validateRevision,inspectHandoff} from '../accountant/engine.mjs';

export const RUNBOOK_SCHEMA='stellar-forge.accounting-runbooks.v1';
export const RUNBOOK_PACKET_SCHEMA='stellar-forge.accounting-runbook-packet.v1';
export const RUNBOOK_FILE_BYTES=8*1024*1024;
export const RUNBOOK_PACKET_BYTES=64*1024*1024;
export const RUNBOOK_REQUEST_BYTES=Math.ceil(RUNBOOK_PACKET_BYTES*4/3)+100_000;
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const KEY=/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const PHASES=new Set(['DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED']);
const WORK_STATES=new Set(['PENDING','COMPLETE','NOT_APPLICABLE','BLOCKED']);
const now=()=>new Date().toISOString();
const clone=value=>structuredClone(value);
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const need=(ok,code,message,status=400)=>{if(!ok)throw Object.assign(new Error(message),{code,status});};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function runbookCanonical(value){
  if(Array.isArray(value))return '['+value.map(runbookCanonical).join(',')+']';
  if(plain(value))return '{'+Object.keys(value).filter(key=>value[key]!==undefined).sort().map(key=>JSON.stringify(key)+':'+runbookCanonical(value[key])).join(',')+'}';
  need(value===null||typeof value==='string'||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)),'RUNBOOK_INVALID_VALUE','Use ordinary JSON values.');
  return JSON.stringify(value);
}
const hash=value=>digest(Buffer.from(runbookCanonical(value)));
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
function text(value,label,max=1000,{empty=false,trim=true}={}){
  need(typeof value==='string','RUNBOOK_INVALID_FIELD','Enter '+label+'.');
  const result=trim?value.trim():value;
  need((empty||result.trim().length>0)&&result.length<=max&&!result.includes('\0'),'RUNBOOK_INVALID_FIELD','Check '+label+' and its length.');
  return result;
}
function uuid(value,label){need(typeof value==='string'&&UUID.test(value),'RUNBOOK_INVALID_ID','Choose a valid '+label+'.');return value;}
function key(value,label){need(typeof value==='string'&&KEY.test(value),'RUNBOOK_INVALID_KEY','Use a stable letter or number identifier for '+label+'.');return value;}
function filename(value){value=text(value,'filename',160);need(!/[\\/\r\n"]/.test(value)&&value!=='.'&&value!=='..','RUNBOOK_INVALID_FILENAME','Use a filename without directories.');return value;}
function mediaType(value){
  value=value??'application/octet-stream';
  need(typeof value==='string'&&/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(value)&&value.length<=120,'RUNBOOK_INVALID_MEDIA_TYPE','Use an ordinary file media type.');
  return value;
}
function date(value){
  const parsed=typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?new Date(value+'T00:00:00.000Z'):null;
  need(parsed&&Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value,'RUNBOOK_INVALID_DATE','Choose a calendar due date.');
  return value;
}
function instant(value,label){
  need(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value,'RUNBOOK_INVALID_DATE','Choose a valid '+label+'.');return value;
}
function base64(value,max,label){
  need(typeof value==='string'&&value.length<=Math.ceil(max/3)*4&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),'RUNBOOK_INVALID_FILE','Choose '+label+' within its supported size.');
  const bytes=Buffer.from(value,'base64');
  need(bytes.length>0&&bytes.length<=max&&bytes.toString('base64')===value,'RUNBOOK_INVALID_FILE','Choose a nonempty '+label+' within its supported size.');
  return bytes;
}
function uniqueList(value,label,{max=100,pattern=KEY}={}){
  need(Array.isArray(value)&&value.length<=max&&value.every(item=>typeof item==='string'&&pattern.test(item))&&new Set(value).size===value.length,'RUNBOOK_INVALID_SELECTION','Choose distinct '+label+'.');
  return [...value];
}
async function privateDir(path){
  try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  const info=await lstat(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077),'RUNBOOK_PRIVATE_DIRECTORY_REQUIRED','Use the original private runbook storage.');
}
async function readExact(path,expected,max=RUNBOOK_PACKET_BYTES){
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const info=await handle.stat();
    need(info.isFile()&&info.size===expected.bytes&&info.size<=max,'RUNBOOK_FILE_CHANGED','The retained file size changed.',409);
    const bytes=await handle.readFile();
    need(bytes.length===expected.bytes&&digest(bytes)===expected.sha256,'RUNBOOK_FILE_CHANGED','The retained file bytes changed.',409);
    return bytes;
  }finally{await handle.close();}
}
async function publishBlob(directory,name,bytes){
  const destination=join(directory,name),expected={bytes:bytes.length,sha256:digest(bytes)};
  try{await readExact(destination,expected);return expected;}catch(error){if(error.code!=='ENOENT')throw error;}
  const staging=join(directory,'.'+randomUUID()+'.pending');let handle;
  try{
    handle=await open(staging,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
    try{await link(staging,destination);}catch(error){if(error.code!=='EEXIST')throw error;await readExact(destination,expected);}
    await rm(staging);
    const parent=await open(directory,'r');try{await parent.sync();}finally{await parent.close();}
    return expected;
  }finally{if(handle)await handle.close();await rm(staging,{force:true});}
}
const emptyState=()=>({schema:RUNBOOK_SCHEMA,books:[],cycles:[],files:[],operations:[],received:[]});
function stepSummary(cycle){
  const result={total:cycle.edition.steps.length,complete:0,blocked:0,pending:0,notApplicable:0};
  for(const step of cycle.edition.steps){const status=cycle.work[step.id]?.status??'PENDING';if(status==='COMPLETE')result.complete++;else if(status==='BLOCKED')result.blocked++;else if(status==='NOT_APPLICABLE')result.notApplicable++;else result.pending++;}
  return result;
}
function cycleSummary(cycle){return {id:cycle.id,runbookId:cycle.runbookId,editionId:cycle.editionId,label:cycle.label,phase:cycle.phase,preparer:cycle.preparer,reviewer:cycle.reviewer,dueDate:cycle.dueDate,updatedAt:cycle.updatedAt,readOnly:cycle.readOnly===true,source:clone(cycle.source),progress:stepSummary(cycle)};}
function stripCycle(cycle){const result=clone(cycle);delete result.receivedPacket;return result;}
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paragraphs=value=>escape(value).replace(/\n/g,'<br>');
function csvCell(value){let s=String(value??'');if(/^[\s]*[=+@-]|^[\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}

export class RunbookWorkspace{
  constructor(workspace,accountant){this.workspace=workspace;this.accountant=accountant;}
  get state(){const state=this.workspace.state.runbooks;need(!state||state.schema===RUNBOOK_SCHEMA,'RUNBOOK_STATE_UNSUPPORTED','Open a supported client-runbook workspace.',409);return state??emptyState();}
  get workspaceId(){return accountingWorkspaceBinding(this.workspace.directory,this.workspace.state).workspaceId;}
  envelope(value={}){return {workspaceId:this.workspaceId,revision:this.workspace.state.revision,...value};}
  book(id){uuid(id,'runbook');const book=this.state.books.find(row=>row.id===id);need(book,'RUNBOOK_NOT_FOUND','Choose a saved client runbook.',404);return book;}
  cycle(id){uuid(id,'period work');const cycle=this.state.cycles.find(row=>row.id===id);need(cycle,'RUNBOOK_CYCLE_NOT_FOUND','Choose a saved period.',404);return cycle;}
  fileRow(id){uuid(id,'file');const file=this.state.files.find(row=>row.id===id);need(file,'RUNBOOK_FILE_NOT_FOUND','Choose a retained runbook file.',404);return file;}
  async view(){
    await this.workspace.tail;
    return this.envelope({runbooks:this.state.books.map(book=>{const latest=book.editions.find(row=>row.id===book.latestEditionId);return {id:book.id,name:latest.name,client:latest.client,latestEditionId:book.latestEditionId,editionCount:book.editions.length,updatedAt:book.updatedAt};}),cycles:this.state.cycles.map(cycleSummary),files:clone(this.state.files)});
  }
  async detail(id){await this.workspace.tail;return this.envelope({runbook:clone(this.book(id))});}
  async cycleDetail(id){await this.workspace.tail;return this.envelope({cycle:stripCycle(this.cycle(id))});}
  async sources(){
    await this.workspace.tail;const current=this.accountant.view();
    return this.envelope({handoffs:current.handoffs.map(row=>({id:row.id,name:row.name,runId:row.source.runId,createdAt:row.createdAt,closeId:row.source.periodClose?.id??null,revisions:[{id:'initial',label:'Original handoff'},...row.revisions.map(item=>({id:item.id,label:item.name,createdAt:item.createdAt}))]})),closes:current.closes.map(row=>({id:row.id,label:row.name??row.label??row.id,runId:row.runId}))});
  }
  async operation(id){
    await this.workspace.tail;uuid(id,'saved request');
    const operation=this.state.operations.find(row=>row.id===id);
    need(operation,'RUNBOOK_OPERATION_NOT_FOUND','This request has not been saved.',404);
    return this.envelope({operation:clone(operation)});
  }
  async mutate(kind,input,work,target=null){
    let committing=false;try{
    need(plain(input),'RUNBOOK_INVALID_REQUEST','Send a complete runbook request.');
    uuid(input.requestId,'request');
    need(input.workspaceId===this.workspaceId,'RUNBOOK_WORKSPACE_CHANGED','Reopen the original accounting workspace before saving this request.',409);
    const requestSha256=hash({kind,target,input}),actor=text(input.actor,'operator',160);
    return await this.workspace.serial(async()=>{
      const prior=this.state.operations.find(row=>row.id===input.requestId);
      if(prior){need(prior.kind===kind&&prior.requestSha256===requestSha256,'RUNBOOK_REQUEST_CONFLICT','This request ID belongs to different saved work. Keep the original request or create a new one.',409);return {...clone(prior.result),duplicate:true,currentRevision:this.workspace.state.revision};}
      this.workspace.expected(input.revision);
      this.workspace.state.runbooks??=emptyState();
      need(this.state.operations.length<20_000,'RUNBOOK_OPERATION_LIMIT','Move completed client work into its retained handover before growing this workspace.');
      const result=await work(this.state,actor);
      const accepted=this.envelope({...result,revision:this.workspace.state.revision+1,requestId:input.requestId});
      this.state.operations.push({id:input.requestId,kind,target,requestSha256,createdAt:now(),result:clone(accepted)});
      committing=true;
      await this.workspace.commit('runbook_'+kind,actor,{requestId:input.requestId,requestSha256,runbookId:result.runbookId??null,cycleId:result.cycleId??null});
      return accepted;
    });
    }catch(error){if(!committing)error.applied=false;throw error;}
  }
  normalizeEdition(input,files){
    const resources=input.resources??[];
    need(Array.isArray(resources)&&resources.length<=100,'RUNBOOK_RESOURCE_LIMIT','Use up to 100 supporting resources.');
    const selected=resources.map(resource=>{
      need(plain(resource),'RUNBOOK_INVALID_RESOURCE','Describe each supporting resource.');
      const item={id:key(resource.id,'resource'),title:text(resource.title,'resource title',240),kind:resource.kind};
      if(item.kind==='link'){
        const raw=text(resource.url,'resource link',4096);let url;try{url=new URL(raw);}catch{need(false,'RUNBOOK_INVALID_LINK','Use a complete HTTPS resource link.');}
        need(url.protocol==='https:'&&!url.username&&!url.password,'RUNBOOK_INVALID_LINK','Use an HTTPS link without embedded credentials.');
        item.url=url.href;
      }else if(item.kind==='note')item.text=text(resource.text,'supporting note',32_000,{trim:false});
      else if(item.kind==='file'){uuid(resource.fileId,'retained file');need(files.some(row=>row.id===resource.fileId),'RUNBOOK_FILE_NOT_FOUND','Upload the selected supporting file first.',404);item.fileId=resource.fileId;}
      else need(false,'RUNBOOK_INVALID_RESOURCE','Choose a link, note or retained file.');
      return item;
    });
    need(new Set(selected.map(row=>row.id)).size===selected.length,'RUNBOOK_DUPLICATE_RESOURCE','Give each supporting resource a distinct identifier.');
    need(Array.isArray(input.steps)&&input.steps.length>0&&input.steps.length<=100,'RUNBOOK_STEP_LIMIT','Describe between one and 100 procedures.');
    const steps=input.steps.map(step=>{
      need(plain(step)&&typeof step.required==='boolean','RUNBOOK_INVALID_STEP','Describe each procedure and whether it is required.');
      const resourceIds=uniqueList(step.resourceIds??[],'procedure resources');
      need(resourceIds.every(id=>selected.some(row=>row.id===id)),'RUNBOOK_RESOURCE_NOT_FOUND','Choose existing resources for the procedure.');
      return {id:key(step.id,'procedure'),title:text(step.title,'procedure title',240),instructions:text(step.instructions,'procedure instructions',32_000,{trim:false}),required:step.required,resourceIds};
    });
    need(new Set(steps.map(row=>row.id)).size===steps.length,'RUNBOOK_DUPLICATE_STEP','Give each procedure a distinct identifier.');
    return {name:text(input.name,'runbook name',240),client:text(input.client,'client name',240),description:text(input.description??'','description',16_000,{empty:true,trim:false}),steps,resources:selected};
  }
  async save(input){return this.mutate('edition_saved',input,async(state,actor)=>{
    const contents=this.normalizeEdition(input,state.files),createdAt=now();let book;
    if(input.runbookId){
      book=this.book(input.runbookId);
      need(input.expectedEditionId===book.latestEditionId,'RUNBOOK_EDITION_CHANGED','A later procedure edition is saved. Reopen it before publishing your retained changes.',409);
      need(book.editions.length<200,'RUNBOOK_EDITION_LIMIT','Use the retained history before creating another procedure edition.');
    }else{
      need(input.expectedEditionId===undefined||input.expectedEditionId===null,'RUNBOOK_INVALID_EDITION','Create the first edition without an earlier selection.');
      need(state.books.length<200,'RUNBOOK_CLIENT_LIMIT','This workspace supports 200 client runbooks.');
      book={id:input.requestId,name:contents.name,client:contents.client,latestEditionId:null,editions:[],createdAt,updatedAt:createdAt};
      state.books.unshift(book);
    }
    const edition={id:input.requestId,number:Math.max(0,...book.editions.map(row=>row.number))+1,...contents,actor,createdAt,originWorkspaceId:this.workspaceId};
    book.editions.push(edition);book.latestEditionId=edition.id;book.name=contents.name;book.client=contents.client;book.updatedAt=createdAt;
    return {runbookId:book.id,editionId:edition.id};
  });}
  async storage(part){
    const root=join(this.workspace.directory,'runbooks');await privateDir(root);
    const folder=join(root,part);await privateDir(folder);return folder;
  }
  async addFile(input){return this.mutate('file_retained',input,async(state,actor)=>{
    need(state.files.length<2000,'RUNBOOK_FILE_LIMIT','Use the existing retained files or a new client workspace.');
    const bytes=base64(input.content,RUNBOOK_FILE_BYTES,'supporting file'),sha256=digest(bytes),name=filename(input.name),type=mediaType(input.type);
    const folder=await this.storage('files');await publishBlob(folder,sha256+'.bin',bytes);
    const file={id:input.requestId,name,type,bytes:bytes.length,sha256,actor,createdAt:now()};
    state.files.push(file);return {file:clone(file)};
  });}
  async file(id){
    await this.workspace.tail;const row=clone(this.fileRow(id));
    const bytes=await readExact(join(this.workspace.directory,'runbooks','files',row.sha256+'.bin'),row,RUNBOOK_FILE_BYTES);
    return {bytes,name:row.name,type:row.type};
  }
  async createCycle(input){return this.mutate('cycle_created',input,async(state,actor)=>{
    const book=this.book(input.runbookId),edition=book.editions.find(row=>row.id===input.editionId);
    need(edition,'RUNBOOK_EDITION_NOT_FOUND','Choose a saved procedure edition.',404);
    need(state.cycles.length<2000,'RUNBOOK_CYCLE_LIMIT','Use retained period handovers before creating another period.');
    const kind=input.sourceKind??'accountant';need(['accountant','files'].includes(kind),'RUNBOOK_INVALID_SOURCE_KIND','Choose an accountant handoff or original client close files.');
    let source;
    if(kind==='files'){
      need(!input.handoffId&&!input.accountantRevisionId&&!input.periodCloseId,'RUNBOOK_AMBIGUOUS_SOURCE','Choose original client close files without an accountant handoff selection.');
      const ids=uniqueList(input.sourceFileIds,'client close files',{max:100,pattern:UUID});need(ids.length>0,'RUNBOOK_CLOSE_FILES_REQUIRED','Select at least one original client close file.');
      const files=ids.map(id=>clone(this.fileRow(id)));
      const value={kind,originWorkspaceId:this.workspaceId,label:text(input.sourceLabel,'close source label',240),note:text(input.sourceNote??'','close source note',16_000,{empty:true,trim:false}),files};
      source={...value,sha256:hash(value)};
    }else{
      need(!input.sourceFileIds?.length,'RUNBOOK_AMBIGUOUS_SOURCE','Use the selected accountant handoff as this period’s close source.');
      uuid(input.handoffId,'accountant handoff');const revisionId=input.accountantRevisionId;
      need(revisionId==='initial'||(typeof revisionId==='string'&&UUID.test(revisionId)),'RUNBOOK_ACCOUNTANT_REVISION_REQUIRED','Select the original handoff or an exact accountant return.');
      const record=this.accountant.row(input.handoffId),detail=await this.accountant.detail(input.handoffId,{revisionId}),selected=this.accountant.revisionRow(record,revisionId);
      if(input.periodCloseId){uuid(input.periodCloseId,'period close');need(detail.source.periodClose?.id===input.periodCloseId,'RUNBOOK_CLOSE_MISMATCH','Select the period close already frozen into this accountant handoff.');}
      const files=clone((selected?.files??record.files).filter(file=>!['accountant-handoff.tar','packet-manifest.json'].includes(file.name)));
      source={kind,originWorkspaceId:this.workspaceId,handoffId:record.id,handoffName:record.name,accountantRevisionId:revisionId,accountantRevisionName:selected?.name??'Original handoff',runId:record.source.runId,periodCloseId:record.source.periodClose?.id??null,source:clone(detail.source),summary:clone(detail.summary),files};
    }
    if(input.previousCycleId){const previous=this.cycle(input.previousCycleId);need(previous.runbookId===book.id,'RUNBOOK_PREVIOUS_PERIOD_MISMATCH','Choose a previous period for this client runbook.');}
    const work={};for(const step of edition.steps)work[step.id]={status:'PENDING',note:'',fileIds:[],actor:'',updatedAt:null};
    const createdAt=now(),cycle={id:input.requestId,runbookId:book.id,editionId:edition.id,label:text(input.label,'period label',240),preparer:text(input.preparer,'preparer',160),reviewer:text(input.reviewer,'reviewer',160),dueDate:date(input.dueDate),previousCycleId:input.previousCycleId??null,phase:'DRAFT',readOnly:false,edition:clone(edition),source,work,submissions:[],reviews:[],history:[{at:createdAt,actor,action:'created'}],createdAt,updatedAt:createdAt,originWorkspaceId:this.workspaceId};
    state.cycles.unshift(cycle);return {runbookId:cycle.runbookId,editionId:cycle.editionId,cycleId:cycle.id};
  });}
  writable(cycle,phases){
    need(cycle.readOnly!==true,'RUNBOOK_RECEIVED_READ_ONLY','This is a received period. Start a new local period from its procedures and select the local close source.',409);
    need(phases.includes(cycle.phase),'RUNBOOK_PHASE_CHANGED','Reopen the period at its current preparation or review stage.',409);
  }
  workFiles(cycle,fileIds){
    const ids=uniqueList(fileIds??[],'supporting files',{max:100,pattern:UUID});
    for(const id of ids)this.fileRow(id);
    return ids;
  }
  async saveWork(id,input){return this.mutate('procedure_saved',input,async(_state,actor)=>{
    const cycle=this.cycle(id);this.writable(cycle,['DRAFT','CHANGES_REQUESTED']);
    const step=cycle.edition.steps.find(row=>row.id===input.stepId);need(step,'RUNBOOK_STEP_NOT_FOUND','Choose a procedure in this saved edition.',404);
    need(WORK_STATES.has(input.status),'RUNBOOK_INVALID_STATUS','Choose the procedure progress.');
    const note=text(input.note??'','work note',32_000,{empty:true,trim:false});
    need(!['BLOCKED','NOT_APPLICABLE'].includes(input.status)||note.trim(),'RUNBOOK_REASON_REQUIRED','Describe the open item or why this procedure does not apply.');
    const record={status:input.status,note,fileIds:this.workFiles(cycle,input.fileIds),actor,updatedAt:now()};
    cycle.work[step.id]=record;cycle.updatedAt=record.updatedAt;cycle.history.push({at:record.updatedAt,actor,action:'procedure_saved',stepId:step.id,work:clone(record)});
    return {runbookId:cycle.runbookId,editionId:cycle.editionId,cycleId:cycle.id};
  },id);}
  async submit(id,input){return this.mutate('preparation_submitted',input,async(_state,actor)=>{
    const cycle=this.cycle(id);this.writable(cycle,['DRAFT','CHANGES_REQUESTED']);
    const pending=cycle.edition.steps.filter(step=>step.required&&cycle.work[step.id].status==='PENDING');
    need(!pending.length,'RUNBOOK_PREPARATION_INCOMPLETE','Complete required procedures or document their open items before handing this period to the reviewer.',409);
    need(cycle.submissions.length<2000,'RUNBOOK_PREPARATION_LIMIT','This period retains 2000 preparation rounds.');
    const at=now(),note=text(input.note??'','preparer handover note',16_000,{empty:true,trim:false}),work=clone(cycle.work);
    const submission={id:input.requestId,at,actor,note,work,workSha256:hash(work)};
    cycle.submissions.push(submission);cycle.phase='IN_REVIEW';cycle.updatedAt=at;cycle.history.push({at,actor,action:'submitted',submissionId:submission.id,workSha256:submission.workSha256});
    return {runbookId:cycle.runbookId,editionId:cycle.editionId,cycleId:cycle.id};
  },id);}
  async review(id,input){return this.mutate('review_saved',input,async(_state,actor)=>{
    const cycle=this.cycle(id);this.writable(cycle,['IN_REVIEW']);
    need(input.decision==='APPROVE'||input.decision==='RETURN','RUNBOOK_INVALID_DECISION','Approve this handover or return it with corrections.');
    const note=text(input.note??'','review note',16_000,{empty:true,trim:false}),accepted=uniqueList(input.acceptedExceptions??[],'accepted open items');
    need(accepted.every(id=>cycle.edition.steps.some(step=>step.id===id&&cycle.work[id].status==='BLOCKED')),'RUNBOOK_EXCEPTION_CHANGED','Select current open items for this review.');
    if(input.decision==='RETURN')need(note.trim(),'RUNBOOK_REVIEW_NOTE_REQUIRED','Describe the corrections needed by the preparer.');
    if(input.decision==='APPROVE'){
      const unresolved=cycle.edition.steps.filter(step=>step.required&&['PENDING','BLOCKED'].includes(cycle.work[step.id].status));
      need(unresolved.every(step=>cycle.work[step.id].status==='BLOCKED'&&accepted.includes(step.id)),'RUNBOOK_OPEN_ITEMS_REQUIRE_REVIEW','Resolve required open items or explicitly accept them in this review.',409);
      need(!accepted.length||note.trim(),'RUNBOOK_REVIEW_NOTE_REQUIRED','Explain the accepted open items and responsibility for follow-up.');
    }else need(!accepted.length,'RUNBOOK_REVIEW_SELECTION_INVALID','Return corrections without accepting open items.');
    const submission=cycle.submissions.at(-1);need(submission&&submission.workSha256===hash(cycle.work),'RUNBOOK_SUBMISSION_CHANGED','Review the unchanged submitted preparation.',409);
    need(cycle.reviews.length<2000,'RUNBOOK_REVIEW_LIMIT','This period retains 2000 review decisions.');
    const at=now(),review={id:input.requestId,at,actor,decision:input.decision,note,acceptedExceptions:accepted,submissionId:submission.id,workSha256:submission.workSha256};
    cycle.reviews.push(review);cycle.phase=input.decision==='APPROVE'?'APPROVED':'CHANGES_REQUESTED';cycle.updatedAt=at;cycle.history.push({at,actor,action:'reviewed',reviewId:review.id,decision:review.decision});
    return {runbookId:cycle.runbookId,editionId:cycle.editionId,cycleId:cycle.id};
  },id);}
  async retainedSourceFiles(cycle,budget=RUNBOOK_PACKET_BYTES){
    if(cycle.receivedPacket){const packet=await this.readReceivedPacket(cycle.receivedPacket);return packet.sourceFiles;}
    if(cycle.source.kind==='files')return [];
    const result=[];let used=0;
    for(const row of cycle.source.files){
      used+=Math.ceil(row.bytes/3)*4+Buffer.byteLength(JSON.stringify(row))+512;
      need(used<=budget,'RUNBOOK_PACKET_TOO_LARGE','This complete period exceeds the 64 MiB portable packet limit.');
      const file=await this.accountant.file(cycle.source.handoffId,row.name,{revisionId:cycle.source.accountantRevisionId});
      need(file.bytes.length===row.bytes&&digest(file.bytes)===row.sha256,'RUNBOOK_SOURCE_CHANGED','The original accountant file changed.',409);
      result.push({name:row.name,type:file.type,bytes:row.bytes,sha256:row.sha256,content:file.bytes.toString('base64')});
    }
    return result;
  }
  async readReceivedPacket(record){
    const bytes=await readExact(join(this.workspace.directory,'runbooks','packets',record.sha256+'.json'),record);
    return JSON.parse(bytes.toString('utf8'));
  }
  async packet(id){
    await this.workspace.tail;const cycle=clone(this.cycle(id)),revision=this.workspace.state.revision;
    if(cycle.receivedPacket){const bytes=await readExact(join(this.workspace.directory,'runbooks','packets',cycle.receivedPacket.sha256+'.json'),cycle.receivedPacket);return {bytes,name:'client-close-'+cycle.id+'.json',type:'application/json; charset=utf-8'};}
    const selected=new Set(cycle.edition.resources.filter(row=>row.kind==='file').map(row=>row.fileId));
    for(const item of Object.values(cycle.work))for(const id of item.fileIds)selected.add(id);
    for(const submission of cycle.submissions)for(const item of Object.values(submission.work))for(const id of item.fileIds)selected.add(id);
    if(cycle.source.kind==='files')for(const file of cycle.source.files)selected.add(file.id);
    for(const item of cycle.history)for(const id of item.work?.fileIds??[])selected.add(id);
    const attachments=[];let used=Buffer.byteLength(JSON.stringify(stripCycle(cycle)))+Buffer.byteLength(JSON.stringify(cycle.edition))+4096;
    for(const id of selected){
      const row=clone(this.fileRow(id));used+=Math.ceil(row.bytes/3)*4+Buffer.byteLength(JSON.stringify(row))+512;
      need(used<=RUNBOOK_PACKET_BYTES,'RUNBOOK_PACKET_TOO_LARGE','This complete period exceeds the 64 MiB portable packet limit.');
      const bytes=await readExact(join(this.workspace.directory,'runbooks','files',row.sha256+'.bin'),row,RUNBOOK_FILE_BYTES);attachments.push({...row,content:bytes.toString('base64')});
    }
    const sourceFiles=await this.retainedSourceFiles(cycle,RUNBOOK_PACKET_BYTES-used);
    const payload={schema:RUNBOOK_PACKET_SCHEMA,originWorkspaceId:this.workspaceId,asOfWorkspaceRevision:revision,runbookId:cycle.runbookId,edition:clone(cycle.edition),cycle:stripCycle(cycle),attachments,sourceFiles};
    const packet={...payload,sha256:hash(payload)},bytes=json(packet);
    need(bytes.length<=RUNBOOK_PACKET_BYTES,'RUNBOOK_PACKET_TOO_LARGE','This complete period exceeds the 64 MiB portable packet limit.');
    return {bytes,name:'client-close-'+cycle.id+'.json',type:'application/json; charset=utf-8'};
  }
  validatePacket(packet){
    need(plain(packet)&&packet.schema===RUNBOOK_PACKET_SCHEMA&&SHA.test(packet.sha256??''),'RUNBOOK_INVALID_PACKET','Choose a saved client-runbook packet.');
    const {sha256,...payload}=packet;need(hash(payload)===sha256,'RUNBOOK_PACKET_CHANGED','The saved handover packet changed.',409);
    need(typeof packet.originWorkspaceId==='string'&&packet.originWorkspaceId.length>0&&packet.originWorkspaceId.length<=240&&Number.isSafeInteger(packet.asOfWorkspaceRevision)&&packet.asOfWorkspaceRevision>=0,'RUNBOOK_INVALID_PACKET','The packet has no original workspace selection.');
    uuid(packet.runbookId,'original runbook');const cycle=packet.cycle,edition=packet.edition;
    need(plain(cycle)&&plain(edition)&&Array.isArray(packet.attachments)&&packet.attachments.length<=2000&&Array.isArray(packet.sourceFiles)&&packet.sourceFiles.length<=100,'RUNBOOK_INVALID_PACKET','The packet is missing its complete edition, period or files.');
    uuid(cycle.id,'original period');uuid(edition.id,'original edition');
    need(cycle.runbookId===packet.runbookId&&cycle.editionId===edition.id&&hash(cycle.edition)===hash(edition)&&PHASES.has(cycle.phase)&&cycle.originWorkspaceId===packet.originWorkspaceId,'RUNBOOK_PACKET_BINDING_CHANGED','The period and procedure edition do not belong to this packet.',409);
    const attachments=packet.attachments.map(row=>{
      need(plain(row),'RUNBOOK_INVALID_PACKET','Describe each retained packet file.');
      const bytes=base64(row.content,RUNBOOK_FILE_BYTES,'supporting file');uuid(row.id,'original file');filename(row.name);mediaType(row.type);text(row.actor,'file operator',160);instant(row.createdAt,'file date');
      need(row.bytes===bytes.length&&row.sha256===digest(bytes),'RUNBOOK_PACKET_FILE_CHANGED','A supporting packet file changed.',409);return {row,bytes};
    });
    need(new Set(attachments.map(item=>item.row.id)).size===attachments.length,'RUNBOOK_DUPLICATE_FILE','The packet repeats a supporting file ID.');
    const normalized=this.normalizeEdition(edition,attachments.map(item=>item.row));
    need(hash(normalized)===hash({name:edition.name,client:edition.client,description:edition.description,steps:edition.steps,resources:edition.resources}),'RUNBOOK_INVALID_PACKET','The packet procedure content is not normalized.');
    text(edition.actor,'edition author',160);instant(edition.createdAt,'edition date');
    need(Number.isSafeInteger(edition.number)&&edition.number>0&&edition.number<1_000_000_000,'RUNBOOK_INVALID_PACKET','The procedure edition number is invalid.');
    text(edition.originWorkspaceId,'edition workspace',240);
    text(cycle.label,'period label',240);text(cycle.preparer,'preparer',160);text(cycle.reviewer,'reviewer',160);date(cycle.dueDate);
    instant(cycle.createdAt,'period creation date');instant(cycle.updatedAt,'period update date');
    if(cycle.previousCycleId!==null&&cycle.previousCycleId!==undefined)uuid(cycle.previousCycleId,'previous period');
    need(plain(cycle.source)&&Array.isArray(cycle.source.files)&&cycle.source.files.length<=100&&plain(cycle.work)&&Array.isArray(cycle.submissions)&&cycle.submissions.length<=2000&&Array.isArray(cycle.reviews)&&cycle.reviews.length<=2000&&Array.isArray(cycle.history)&&cycle.history.length<=20_000,'RUNBOOK_INVALID_PACKET','The period is missing its source or preparation history.');
    need(['accountant','files'].includes(cycle.source.kind),'RUNBOOK_INVALID_SOURCE_KIND','Choose a packet with an original accountant handoff or client close files.');
    need(cycle.source.originWorkspaceId===packet.originWorkspaceId,'RUNBOOK_SOURCE_CHANGED','The accountant source belongs to another workspace.',409);
    const validateWork=work=>{
      need(plain(work)&&Object.keys(work).length===edition.steps.length,'RUNBOOK_INVALID_PACKET','The preparation must include every procedure.');
      for(const step of edition.steps){
        const item=work[step.id];
        need(own(work,step.id)&&plain(item)&&WORK_STATES.has(item.status),'RUNBOOK_INVALID_PACKET','A procedure has invalid progress.');
        text(item.note,'work note',32_000,{empty:true,trim:false});
        need(!['BLOCKED','NOT_APPLICABLE'].includes(item.status)||item.note.trim(),'RUNBOOK_REASON_REQUIRED','A retained open item or nonapplicable procedure needs its reason.');
        text(item.actor,'preparer',160,{empty:item.status==='PENDING'});
        if(item.updatedAt!==null)instant(item.updatedAt,'procedure update date');
        else need(item.status==='PENDING','RUNBOOK_INVALID_PACKET','Completed work needs its original update date.');
        const ids=uniqueList(item.fileIds,'supporting files',{pattern:UUID});
        need(ids.every(id=>attachments.some(value=>value.row.id===id)),'RUNBOOK_PACKET_FILE_MISSING','The packet omitted a selected supporting file.');
      }
    };
    validateWork(cycle.work);
    const submissionIds=new Set(),reviewIds=new Set(),reviewed=new Set();
    for(const item of cycle.submissions){
      need(plain(item),'RUNBOOK_INVALID_PACKET','Describe each preparation round.');uuid(item.id,'submission');
      need(!submissionIds.has(item.id),'RUNBOOK_INVALID_PACKET','The packet repeats a preparation round.');submissionIds.add(item.id);
      text(item.actor,'preparer',160);instant(item.at,'preparation date');text(item.note,'handover note',16_000,{empty:true,trim:false});validateWork(item.work);
      need(!edition.steps.some(step=>step.required&&item.work[step.id].status==='PENDING'),'RUNBOOK_PREPARATION_INCOMPLETE','A submitted preparation has unfinished required procedures.');
      need(item.workSha256===hash(item.work),'RUNBOOK_SUBMISSION_CHANGED','A retained preparation round changed.',409);
    }
    for(const item of cycle.reviews){
      need(plain(item),'RUNBOOK_INVALID_PACKET','Describe each review.');uuid(item.id,'review');
      need(!reviewIds.has(item.id)&&!reviewed.has(item.submissionId),'RUNBOOK_REVIEW_CHANGED','The packet repeats a review or reviews one submission twice.',409);reviewIds.add(item.id);reviewed.add(item.submissionId);
      text(item.actor,'reviewer',160);instant(item.at,'review date');text(item.note,'review note',16_000,{empty:true,trim:false});
      const submission=cycle.submissions.find(sub=>sub.id===item.submissionId&&sub.workSha256===item.workSha256);
      need(['APPROVE','RETURN'].includes(item.decision)&&submission,'RUNBOOK_REVIEW_CHANGED','A review lost its original preparation.',409);
      const accepted=uniqueList(item.acceptedExceptions,'accepted open items');
      need(accepted.every(id=>edition.steps.some(step=>step.id===id&&submission.work[id].status==='BLOCKED')),'RUNBOOK_REVIEW_CHANGED','Accepted open items must belong to the reviewed preparation.',409);
      if(item.decision==='RETURN')need(item.note.trim()&&!accepted.length,'RUNBOOK_REVIEW_CHANGED','A returned preparation needs corrections and no accepted exceptions.',409);
      else {
        need(!accepted.length||item.note.trim(),'RUNBOOK_REVIEW_CHANGED','Accepted open items need the reviewer’s explanation.',409);
        need(edition.steps.every(step=>!step.required||!['PENDING','BLOCKED'].includes(submission.work[step.id].status)||accepted.includes(step.id)),'RUNBOOK_REVIEW_CHANGED','The approval must account for required open items.',409);
      }
    }
    for(const item of cycle.history){need(plain(item),'RUNBOOK_INVALID_PACKET','Describe each preparation history item.');instant(item.at,'history date');text(item.actor,'history operator',160);text(item.action,'history action',80);}
    const lastSubmission=cycle.submissions.at(-1),lastReview=cycle.reviews.at(-1);
    if(cycle.phase==='DRAFT')need(!lastSubmission&&!lastReview,'RUNBOOK_PHASE_CHANGED','Draft preparation cannot contain a submitted review.',409);
    if(cycle.phase==='IN_REVIEW')need(lastSubmission&&!reviewed.has(lastSubmission.id)&&lastSubmission.workSha256===hash(cycle.work),'RUNBOOK_PHASE_CHANGED','The reviewer must receive the current complete preparation.',409);
    if(cycle.phase==='APPROVED'||cycle.phase==='CHANGES_REQUESTED'){
      need(lastSubmission&&lastReview?.submissionId===lastSubmission.id&&lastReview.decision===(cycle.phase==='APPROVED'?'APPROVE':'RETURN'),'RUNBOOK_PHASE_CHANGED','The retained review must explain the current period stage.',409);
      if(cycle.phase==='APPROVED')need(lastSubmission.workSha256===hash(cycle.work),'RUNBOOK_PHASE_CHANGED','Approved preparation must retain the reviewed work.',409);
    }
    if(cycle.source.kind==='files'){
      text(cycle.source.label,'close source label',240);text(cycle.source.note,'close source note',16_000,{empty:true,trim:false});
      need(cycle.source.files.length>0&&packet.sourceFiles.length===0,'RUNBOOK_SOURCE_CHANGED','A client-file close must retain its selected original files.',409);
      const {sha256:sourceSha256,...source}=cycle.source;
      need(SHA.test(sourceSha256??'')&&hash(source)===sourceSha256,'RUNBOOK_SOURCE_CHANGED','The original client close file selection changed.',409);
      need(new Set(source.files.map(row=>row?.id)).size===source.files.length,'RUNBOOK_SOURCE_CHANGED','The close source repeats a file identity.',409);
      for(const file of source.files){
        need(plain(file),'RUNBOOK_INVALID_PACKET','Describe each original client close file.');const selected=attachments.find(item=>item.row.id===file.id);
        const metadata=selected?Object.fromEntries(Object.entries(selected.row).filter(([key])=>key!=='content')):null;
        need(metadata&&hash(metadata)===hash(file),'RUNBOOK_SOURCE_CHANGED','The complete original client close file is missing or changed.',409);
      }
      return attachments;
    }
    uuid(cycle.source.handoffId,'original handoff');uuid(cycle.source.runId,'original reconciliation');
    need(cycle.source.accountantRevisionId==='initial'||UUID.test(cycle.source.accountantRevisionId??''),'RUNBOOK_INVALID_PACKET','The packet needs its exact accountant revision.');
    need(new Set(packet.sourceFiles.map(row=>row?.name)).size===packet.sourceFiles.length&&packet.sourceFiles.length===cycle.source.files.length,'RUNBOOK_SOURCE_CHANGED','The original source inventory changed.',409);
    const sourceBytes=new Map();
    for(const row of packet.sourceFiles){
      need(plain(row),'RUNBOOK_INVALID_PACKET','Describe each original accountant source file.');filename(row.name);
      const bytes=base64(row.content,RUNBOOK_PACKET_BYTES,'accountant source file'),expected=cycle.source.files.find(item=>item?.name===row.name);
      need(expected&&row.bytes===bytes.length&&row.sha256===digest(bytes)&&row.bytes===expected.bytes&&row.sha256===expected.sha256,'RUNBOOK_SOURCE_CHANGED','An original accountant source file changed.',409);
      sourceBytes.set(row.name,bytes);
    }
    const sourceJson=name=>{need(sourceBytes.has(name),'RUNBOOK_SOURCE_MISSING','The packet needs its original '+name+'.');try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(sourceBytes.get(name)));}catch{need(false,'RUNBOOK_INVALID_PACKET','The original '+name+' is not complete JSON.');}};
    const handoff=validateHandoff(sourceJson('handoff.json'));
    const revision=cycle.source.accountantRevisionId==='initial'?null:validateRevision(handoff,sourceJson('return.json'));
    need(handoff.id===cycle.source.handoffId&&handoff.name===cycle.source.handoffName&&(!revision||revision.id===cycle.source.accountantRevisionId),'RUNBOOK_SOURCE_CHANGED','The packet must retain the selected original handoff and accountant return.',409);
    const inspected=inspectHandoff(handoff,revision);
    need(hash(inspected.source)===hash(cycle.source.source)&&hash(inspected.summary)===hash(cycle.source.summary)&&cycle.source.runId===inspected.source.runId&&cycle.source.periodCloseId===(inspected.source.periodClose?.id??null)&&cycle.source.accountantRevisionName===(revision?.name??'Original handoff'),'RUNBOOK_SOURCE_CHANGED','The period source summary must come from its retained accountant files.',409);
    for(const [name,expected] of [['original-report.json',handoff.source.reportSha256],['original-manifest.json',handoff.source.manifestSha256],['input-manifest.json',handoff.source.inputManifestSha256],...(handoff.source.periodClose?[['period-close.json',handoff.source.periodClose.sha256]]:[]),...(handoff.source.adjustments?[['adjustments.json',handoff.source.adjustments.sha256]]:[]),...(revision?[['returned.csv',revision.importSha256]]:[])]){
      need(sourceBytes.has(name)&&digest(sourceBytes.get(name))===expected,'RUNBOOK_SOURCE_CHANGED','The original '+name+' no longer matches the accountant handoff.',409);
    }
    return attachments;
  }
  async receive(input){return this.mutate('packet_received',input,async(state,actor)=>{
    const bytes=base64(input.content,RUNBOOK_PACKET_BYTES,'handover packet');let packet;
    try{packet=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{need(false,'RUNBOOK_INVALID_PACKET','Choose a complete UTF-8 JSON handover packet.');}
    const attachments=this.validatePacket(packet),sha256=digest(bytes),prior=state.received.find(row=>row.sha256===sha256);
    if(prior)return {received:clone(prior),runbookId:prior.runbookId,cycleId:prior.cycleId,reused:true};
    const existingCycle=state.cycles.find(row=>row.id===packet.cycle.id);
    need(!existingCycle,'RUNBOOK_CYCLE_CONFLICT','A different or locally owned period already uses this identity.',409);
    const existingBook=state.books.find(row=>row.id===packet.runbookId),newFiles=attachments.filter(item=>!state.files.some(row=>row.id===item.row.id));
    need(state.cycles.length<2000&&(existingBook||state.books.length<200)&&state.files.length+newFiles.length<=2000,'RUNBOOK_RECEIVING_LIMIT','Use a client workspace with room for this complete handover.');
    const fileFolder=await this.storage('files');
    for(const {row,bytes} of attachments){
      const priorFile=state.files.find(item=>item.id===row.id);
      if(priorFile)need(priorFile.sha256===row.sha256&&priorFile.bytes===row.bytes&&priorFile.name===row.name&&priorFile.type===row.type&&priorFile.actor===row.actor&&priorFile.createdAt===row.createdAt,'RUNBOOK_FILE_CONFLICT','An existing file ID belongs to different retained bytes.',409);
      await publishBlob(fileFolder,row.sha256+'.bin',bytes);
      if(!priorFile){const {content,...metadata}=row;state.files.push(clone(metadata));}
    }
    const packetFolder=await this.storage('packets');await publishBlob(packetFolder,sha256+'.json',bytes);
    let book=state.books.find(row=>row.id===packet.runbookId);
    if(book){
      const existing=book.editions.find(row=>row.id===packet.edition.id);
      if(existing)need(hash(existing)===hash(packet.edition),'RUNBOOK_EDITION_CONFLICT','An existing edition ID has different procedures.',409);
      else {need(book.editions.length<200,'RUNBOOK_EDITION_LIMIT','This runbook already retains 200 procedure editions.');book.editions.push(clone(packet.edition));}
    }else{book={id:packet.runbookId,name:packet.edition.name,client:packet.edition.client,latestEditionId:packet.edition.id,editions:[clone(packet.edition)],createdAt:packet.edition.createdAt,updatedAt:now()};state.books.unshift(book);}
    const received={id:input.requestId,sha256,bytes:bytes.length,packetSha256:packet.sha256,runbookId:book.id,cycleId:packet.cycle.id,originWorkspaceId:packet.originWorkspaceId,actor,receivedAt:now()};
    const cycle={...clone(packet.cycle),readOnly:true,receivedPacket:{sha256,bytes:bytes.length}};state.cycles.unshift(cycle);state.received.push(received);
    return {received:clone(received),runbookId:book.id,editionId:packet.edition.id,cycleId:cycle.id,reused:false};
  });}
  async tasksCsv(id){
    await this.workspace.tail;const cycle=clone(this.cycle(id));
    const rows=[['Client','Period','Procedure','Preparer','Reviewer','Due date','Required','Status','Instructions','Result and open items','Supporting resources','Review stage']];
    for(const step of cycle.edition.steps){
      const work=cycle.work[step.id],resources=step.resourceIds.map(id=>cycle.edition.resources.find(row=>row.id===id)).map(row=>row.kind==='link'?row.title+' '+row.url:row.title);
      rows.push([cycle.edition.client,cycle.label,step.title,cycle.preparer,cycle.reviewer,cycle.dueDate,step.required?'Yes':'No',work.status,step.instructions,work.note,resources.join('\n'),cycle.phase]);
    }
    return {bytes:Buffer.from(rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n'),name:'client-close-'+cycle.id+'-tasks.csv',type:'text/csv; charset=utf-8'};
  }
  async print(id){
    await this.workspace.tail;const cycle=clone(this.cycle(id)),edition=cycle.edition;
    const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+escape(edition.client+' — '+cycle.label)+'</title><style>body{font:15px/1.55 system-ui,sans-serif;color:#202020;max-width:1000px;margin:40px auto;padding:0 24px}h1{font-size:28px}h2{font-size:21px;margin-top:34px}h3{font-size:17px}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;padding:9px;border-bottom:1px solid #ccc}th{width:180px}section{break-inside:avoid;border-top:1px solid #aaa;padding-top:12px;margin-top:20px}.meta{color:#555}.text{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#222;text-decoration:underline}@media print{body{margin:0;max-width:none}a{color:#000}}</style></head><body><p class="meta">Client close handover</p><h1>'+escape(edition.client+' — '+cycle.label)+'</h1><p>'+escape(edition.name)+' · Edition '+escape(edition.number)+'</p><p class="text">'+escape(edition.description)+'</p><table><tr><th>Preparer</th><td>'+escape(cycle.preparer)+'</td></tr><tr><th>Reviewer</th><td>'+escape(cycle.reviewer)+'</td></tr><tr><th>Due</th><td>'+escape(cycle.dueDate)+'</td></tr><tr><th>Stage</th><td>'+escape(cycle.phase)+'</td></tr><tr><th>Close source</th><td>'+escape(cycle.source.kind==='files'?cycle.source.label:cycle.source.handoffName)+' · '+escape(cycle.source.kind==='files'?cycle.source.note:cycle.source.accountantRevisionName)+'</td></tr></table><h2>Procedures and completed work</h2>'+
      edition.steps.map(step=>{const work=cycle.work[step.id];return '<section><h3>'+escape(step.title)+'</h3><p class="meta">'+escape(work.status)+' · '+(step.required?'Required procedure':'Supporting procedure')+'</p><div class="text">'+escape(step.instructions)+'</div><h4>Preparation</h4><div class="text">'+escape(work.note||'No work note retained.')+'</div><p class="meta">'+escape(work.actor)+(work.updatedAt?' · '+escape(work.updatedAt):'')+'</p>'+step.resourceIds.map(id=>{const row=edition.resources.find(item=>item.id===id);return row.kind==='link'?'<p><a rel="noreferrer noopener" href="'+escape(row.url)+'">'+escape(row.title)+'</a></p>':row.kind==='note'?'<p><strong>'+escape(row.title)+'</strong></p><div class="text">'+escape(row.text)+'</div>':'<p>Supporting file: '+escape(row.title)+' (included in the portable packet)</p>';}).join('')+'</section>';}).join('')+
      '<h2>Preparation and review history</h2>'+cycle.submissions.map(sub=>'<section><h3>Preparation handed over</h3><p class="meta">'+escape(sub.actor)+' · '+escape(sub.at)+'</p><div class="text">'+escape(sub.note)+'</div>'+cycle.reviews.filter(review=>review.submissionId===sub.id).map(review=>'<h4>'+escape(review.decision==='APPROVE'?'Approved':'Corrections returned')+'</h4><p class="meta">'+escape(review.actor)+' · '+escape(review.at)+'</p><div class="text">'+escape(review.note)+'</div>'+(review.acceptedExceptions.length?'<p>Accepted open items: '+review.acceptedExceptions.map(id=>escape(edition.steps.find(step=>step.id===id)?.title??id)).join(', ')+'</p>':'')).join('')+'</section>').join('')+
      '<h2>Original source files</h2><p>The portable JSON handover carries these original close files and selected supporting files with their retained content.</p><ul>'+cycle.source.files.map(file=>'<li>'+escape(file.name)+' · '+escape(file.bytes)+' bytes</li>').join('')+'</ul><p class="meta">Period '+escape(cycle.id)+' · Original workspace '+escape(cycle.originWorkspaceId)+'</p></body></html>';
    return {bytes:Buffer.from(html),name:'client-close-'+cycle.id+'.html',type:'text/html; charset=utf-8'};
  }
}

export async function handleRunbookRequest(runbooks,{method,path,query={},value}){
  const parts=path.split('/').filter(Boolean);if(parts[0]!=='api'||parts[1]!=='runbooks')return null;
  if(path==='/api/runbooks'&&method==='GET')return {value:await runbooks.view()};
  if(path==='/api/runbooks/sources'&&method==='GET')return {value:await runbooks.sources()};
  if(path==='/api/runbooks/books/save'&&method==='POST')return {value:await runbooks.save(value)};
  if(parts.length===4&&parts[2]==='books'&&method==='GET')return {value:await runbooks.detail(parts[3])};
  if(parts.length===4&&parts[2]==='operations'&&method==='GET')return {value:await runbooks.operation(parts[3])};
  if(path==='/api/runbooks/files'&&method==='POST')return {value:await runbooks.addFile(value)};
  if(parts.length===4&&parts[2]==='files'&&method==='GET')return {file:await runbooks.file(parts[3])};
  if(path==='/api/runbooks/receive'&&method==='POST')return {value:await runbooks.receive(value)};
  if(path==='/api/runbooks/cycles'&&method==='POST')return {value:await runbooks.createCycle(value)};
  if(parts[2]==='cycles'&&parts[3]){
    if(parts.length===4&&method==='GET')return {value:await runbooks.cycleDetail(parts[3])};
    if(parts.length===5&&method==='POST'){
      if(parts[4]==='work')return {value:await runbooks.saveWork(parts[3],value)};
      if(parts[4]==='submit')return {value:await runbooks.submit(parts[3],value)};
      if(parts[4]==='review')return {value:await runbooks.review(parts[3],value)};
    }
    if(parts.length===5&&method==='GET'){
      if(parts[4]==='packet')return {file:await runbooks.packet(parts[3])};
      if(parts[4]==='print')return {file:await runbooks.print(parts[3])};
      if(parts[4]==='tasks.csv')return {file:await runbooks.tasksCsv(parts[3])};
    }
  }
  need(false,'NOT_FOUND','This client-runbook operation was not found.',404);
}
