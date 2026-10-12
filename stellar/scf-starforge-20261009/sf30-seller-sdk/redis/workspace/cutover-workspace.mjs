// MIT. Operator over the original cutover directories and Redis workspace owners.
import {lstat,mkdir,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {acquirePrivateDirectoryWriter} from '../../operations/history.mjs';
import {normalizeRedisCutover,receiveRedisCutover,redisCutoverTemplate,redisCutoverStable as stable,
  privateRedisCutoverDirectory,readRedisCutoverJson,writeRedisCutoverJson} from './cutover.mjs';
import {openRedisAuthoringWorkspace,inspectRedisWorkspaceBinding} from './model.mjs';
import {startRedisAuthoringServer} from './server.mjs';
import {pageRedisCutoverDifference,openRedisCutoverFile} from './cutover-files.mjs';
import {createRedisCutoverHandover} from './cutover-handover.mjs';

const ROOT='original',SIDES=['baseline','candidate'];
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sha=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>structuredClone(value);
const issue=(code,message,status=409,details)=>Object.assign(new Error(message),{code,status,details});
function fields(input,allowed){
  if(!plain(input)||Object.keys(input).some(name=>!allowed.includes(name)))
    throw issue('REDIS_CUTOVER_OPERATOR_INPUT_INVALID','Use the supported operator fields.',422);
}
function identifier(value,label='Operation ID'){
  if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value))
    throw issue('REDIS_CUTOVER_OPERATOR_ID_INVALID',label+' needs 1–80 letters, digits, underscores or hyphens.',422);
  return value;
}
function digest(value,nullable=false){
  if(nullable&&value===null)return value;
  if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))
    throw issue('REDIS_CUTOVER_OPERATOR_DIGEST_INVALID','Use the complete saved SHA256.',422);
  return value;
}
async function optional(path,maximum){
  return readRedisCutoverJson(path,maximum).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
}
async function existingDirectory(path){
  const info=await lstat(path);
  if(!info.isDirectory()||info.isSymbolicLink())throw issue('REDIS_CUTOVER_EDITION_INVALID','Choose an original saved receiving edition.');
  return privateRedisCutoverDirectory(path);
}
function summary(input,edition,origin=null){
  return {schema:'stellar-forge.redis-cutover-edition.v1',edition,operationId:input.operationId,
    label:input.candidate.setup.label,baseline:input.baseline.setup.label,candidate:input.candidate.setup.label,
    inputCanonicalSha256:sha(stable(input)),checks:input.comparisons.length,origin,updatedAt:new Date().toISOString()};
}
function sourceView(file){
  if(!file)return null;
  const value=file.value;
  return {sha256:file.sha256,inputSha256:value.inputSha256??sha(stable(value.input)),
    inputCanonicalSha256:sha(stable(value.input)),input:clone(value.input)};
}
export async function openRedisCutoverWorkspace({directory,input,inputSha256,environment=process.env}={}){
  const root=await privateRedisCutoverDirectory(directory);
  if(input!==undefined)normalizeRedisCutover(input,environment);
  if(inputSha256!==undefined)digest(inputSha256);
  return new RedisCutoverWorkspace(root,{input:input??await redisCutoverTemplate(),inputSha256,environment});
}
export class RedisCutoverWorkspace{
  constructor(root,{input,inputSha256,environment}){
    this.root=root;this.environment=environment;this.initial={input:clone(input),inputSha256:inputSha256??sha(stable(input))};
    this.active=null;this.lastFailure=null;this.editors=new Map();this.tail=Promise.resolve();this.closing=null;this.closed=false;
  }
  writable(){if(this.closed||this.closing)throw issue('REDIS_CUTOVER_OPERATOR_CLOSING','The cutover operator is closing.',503);}
  mutation(action){
    this.writable();
    const task=this.tail.catch(()=>{}).then(()=>{this.writable();return action();});
    this.tail=task;return task;
  }
  idle(){
    if(this.active)throw issue('REDIS_CUTOVER_OPERATOR_BUSY','Continue or pause the attached original operation before another action.');
  }
  async path(edition=ROOT){
    if(edition===ROOT)return this.root;
    identifier(edition,'Receiving edition');
    await existingDirectory(join(this.root,'editions'));
    const root=await existingDirectory(join(this.root,'editions',edition));
    const origin=(await readRedisCutoverJson(join(root,'cutover-origin.json'),16777216)).value;
    if(origin?.schema!=='stellar-forge.redis-cutover-edition-origin.v1'||origin.edition!==edition||
        origin.parentDirectory!==this.root)
      throw issue('REDIS_CUTOVER_EDITION_ORIGIN_CHANGED','Open the original child receiving edition in its owning cutover directory.');
    return root;
  }
  async selected(edition=ROOT){
    const root=await this.path(edition);
    const [bound,draft,origin]=await Promise.all([
      optional(join(root,'cutover-input.json')),optional(join(root,'cutover-draft.json')),
      optional(join(root,'cutover-origin.json'))]);
    if(bound&&(bound.value?.schema!=='stellar-forge.redis-cutover-selection.v1'||
        !/^[a-f0-9]{64}$/.test(bound.value.inputSha256??'')))
      throw issue('REDIS_CUTOVER_SELECTION_INVALID','Keep the original complete cutover selection.');
    if(draft&&draft.value?.schema!=='stellar-forge.redis-cutover-draft.v1')
      throw issue('REDIS_CUTOVER_DRAFT_INVALID','Keep the saved editable cutover input.');
    const current=bound??draft;
    const value=current?sourceView(current):{input:clone(this.initial.input),inputSha256:this.initial.inputSha256,
      inputCanonicalSha256:sha(stable(this.initial.input)),sha256:null};
    if(edition!==ROOT&&!current)throw issue('REDIS_CUTOVER_EDITION_INCOMPLETE','Continue the original receiving-edition creation.');
    return {root,edition,bound,draft,origin:origin?.value??null,...value};
  }
  async state({edition=ROOT,includeInput=true}={}){
    const selected=await this.selected(edition);
    const [progress,result,created,handover]=await Promise.all(['cutover-progress.json','cutover-result.json','cutover-created.json','cutover-handover.json']
      .map(name=>optional(join(selected.root,name))));
    const attached=this.active?.edition===edition?this.active:null;
    const parentCreation=selected.origin?await optional(join(this.root,'cutover-edition-creation.json')):null;
    const creation=selected.origin?{requestId:selected.origin.requestId,
      state:parentCreation?.value.requestId===selected.origin.requestId?parentCreation.value.state:parentCreation?'COMPLETED':'UNKNOWN',
      arguments:parentCreation?.value.requestId===selected.origin.requestId?clone(parentCreation.value.arguments):undefined,
      receipt:parentCreation?.value.requestId===selected.origin.requestId?'original-parent-record':'retained-child-origin'}:null;
    const bindingSource=result?.value.workspaceBindings??created?.value.workspaceBindings??{};
    const bindings={};
    for(const side of SIDES){
      try{
        const actual=await inspectRedisWorkspaceBinding(join(selected.root,side),{includeConnection:true});
        const expected=bindingSource[side];
        if(expected&&(actual.workspaceId!==expected.workspaceId||actual.profileSha256!==expected.profileSha256))
          throw issue('REDIS_CUTOVER_BINDING_CHANGED','The original '+side+' workspace binding changed.');
        bindings[side]=actual;
      }catch(error){
        if(error.code==='ENOENT')bindings[side]=null;
        else bindings[side]={error:{code:error.code??'REDIS_CUTOVER_BINDING_UNAVAILABLE',message:error.message}};
      }
    }
    return {schema:'stellar-forge.redis-cutover-operator.v1',directory:this.root,edition,editionDirectory:selected.root,
      operationId:selected.input.operationId,bound:Boolean(selected.bound),inputSha256:selected.inputSha256,
      inputCanonicalSha256:selected.inputCanonicalSha256,draftSha256:selected.draft?.sha256??null,
      input:includeInput?clone(selected.input):undefined,origin:selected.origin,creation,
      state:attached?'RUNNING':progress?.value.state==='RUNNING'?'RETAINED_RUNNING':
        progress?.value.state??(result?.value.status??(selected.bound?'CREATED':'DRAFT')),
      attached:attached?{mode:attached.mode,startedAt:attached.startedAt,pauseRequested:attached.controller.signal.aborted,
        progress:attached.progress??null}:null,
      progress:progress?.value??null,result:result?.value??null,resultSha256:result?.sha256??null,
      handover:handover?.value??null,bindings,
      editors:Object.fromEntries(SIDES.map(side=>[side,this.editors.get(edition+':'+side)?.operatorUrl??null])),
      lastFailure:this.lastFailure?.edition===edition?this.lastFailure.error:null};
  }
  async progress({edition=ROOT}={}){
    const root=await this.path(edition),attached=this.active?.edition===edition?this.active:null;
    const [progress,handover]=await Promise.all([
      optional(join(root,'cutover-progress.json'),2097152),optional(join(root,'cutover-handover.json'),2097152)]);
    return {schema:'stellar-forge.redis-cutover-operator-progress.v1',edition,
      attached:attached?{mode:attached.mode,startedAt:attached.startedAt,pauseRequested:attached.controller.signal.aborted,
        progress:attached.progress??null}:null,
      state:attached?'RUNNING':progress?.value.state==='RUNNING'?'RETAINED_RUNNING':progress?.value.state??'DRAFT',
      progress:progress?.value??null,handover:handover?.value??null,
      lastFailure:this.lastFailure?.edition===edition?this.lastFailure.error:null};
  }
  closeWindows(input={}){
    fields(input,['edition']);
    return this.mutation(async()=>{this.idle();await this.closeEditors();return this.state({edition:input.edition??ROOT});});
  }
  async review(input={}){
    fields(input,['edition','input']);const edition=input.edition??ROOT,selected=await this.selected(edition);
    const draft=input.input??selected.input,normalized=normalizeRedisCutover(draft,this.environment);
    if(selected.bound&&stable(draft)!==stable(selected.input))
      throw issue('REDIS_CUTOVER_INPUT_CHANGED','Create a new receiving edition to change an already-bound contract.');
    const identity={directory:selected.root,edition,inputCanonicalSha256:sha(stable(draft)),
      boundSha256:selected.bound?.sha256??null,draftSha256:selected.draft?.sha256??null};
    return {schema:'stellar-forge.redis-cutover-operator-review.v1',digest:sha(stable(identity)),...identity,
      inputSha256:selected.bound?selected.inputSha256:sha(stable(draft)),
      operationId:draft.operationId,bound:Boolean(selected.bound),review:normalized.review,input:clone(draft),
      actions:{create:true,receive:true,compare:Boolean(selected.bound)}};
  }
  save(input){
    fields(input,['edition','input','requestId','expectedDraftSha256']);
    identifier(input.requestId,'Draft save request');digest(input.expectedDraftSha256,true);
    return this.mutation(async()=>{
      this.idle();const edition=input.edition??ROOT,root=await this.path(edition),lease=await acquirePrivateDirectoryWriter(root);
      try{
        const selected=await this.selected(edition);normalizeRedisCutover(input.input,this.environment);
        if(selected.bound){
          if(stable(input.input)!==stable(selected.input))throw issue('REDIS_CUTOVER_INPUT_CHANGED','Use New edition for a different complete receiving input.');
          return this.state({edition});
        }
        if(selected.draft?.value.requestId===input.requestId){
          if(stable(selected.draft.value.input)!==stable(input.input))
            throw issue('REDIS_CUTOVER_DRAFT_REQUEST_CHANGED','This original save request belongs to different input.');
          return this.state({edition});
        }
        if((selected.draft?.sha256??null)!==input.expectedDraftSha256)
          throw issue('REDIS_CUTOVER_DRAFT_CHANGED','The saved draft changed. Reload it before saving these edits.');
        const saved={schema:'stellar-forge.redis-cutover-draft.v1',requestId:input.requestId,
          previousSha256:input.expectedDraftSha256,inputSha256:sha(stable(input.input)),input:clone(input.input),
          updatedAt:new Date().toISOString()};
        await writeRedisCutoverJson(root,'cutover-draft.json',saved);
        await writeRedisCutoverJson(root,'cutover-edition.json',summary(input.input,edition,selected.origin));
        return this.state({edition});
      }finally{await lease.release();}
    });
  }
  newEdition(input){
    fields(input,['edition','operationId','requestId','sourceInputCanonicalSha256','note']);
    identifier(input.operationId);identifier(input.requestId,'Edition creation request');digest(input.sourceInputCanonicalSha256);
    if(input.operationId===ROOT||typeof input.note!=='string'||input.note.length>2000||!input.note.isWellFormed())
      throw issue('REDIS_CUTOVER_EDITION_INPUT_INVALID','Choose a distinct receiving operation and a note within 2,000 characters.',422);
    return this.mutation(async()=>{
      this.idle();await this.closeEditors();
      const lease=await acquirePrivateDirectoryWriter(this.root);
      try{
        const old=await optional(join(this.root,'cutover-edition-creation.json'));
        // A completed child is its own durable creation receipt even after the
        // parent's single in-progress creation record advances to a later child.
        const retainedRoot=join(this.root,'editions',input.operationId);
        const retainedOrigin=await optional(join(retainedRoot,'cutover-origin.json'));
        if(retainedOrigin){
          const origin=retainedOrigin.value;
          if(origin.schema==='stellar-forge.redis-cutover-edition-origin.v1'&&origin.parentDirectory===this.root&&
              origin.edition===input.operationId&&origin.requestId===input.requestId&&
              origin.parentEdition===(input.edition??ROOT)&&origin.parentInputCanonicalSha256===input.sourceInputCanonicalSha256&&origin.note===input.note){
            if(old?.value.requestId!==input.requestId&&old&&
                (await optional(join(retainedRoot,'cutover-draft.json'))||await optional(join(retainedRoot,'cutover-input.json'))))
              return this.state({edition:input.operationId});
            // Matching PREPARED creation must finish the original parent record
            // even when its child already contains a newer edited draft.
            if(!old)throw issue('REDIS_CUTOVER_EDITION_CREATION_MISSING','Keep the original parent creation record for this retained child.');
          }else throw issue('REDIS_CUTOVER_EDITION_EXISTS','That original receiving edition belongs to another creation request.');
        }
        let request;
        if(old?.value.requestId===input.requestId){
          request=old.value;
          if(stable(request.arguments)!==stable(input))
            throw issue('REDIS_CUTOVER_EDITION_REQUEST_CHANGED','This original edition request belongs to different arguments.');
        }else{
          if(old&&old.value.state!=='COMPLETED')
            throw issue('REDIS_CUTOVER_EDITION_CREATION_PENDING','Finish the original pending receiving-edition creation.',409,
              {requestId:old.value.requestId,arguments:old.value.arguments});
          const parent=await this.selected(input.edition??ROOT);
          if(parent.inputCanonicalSha256!==input.sourceInputCanonicalSha256)
            throw issue('REDIS_CUTOVER_EDITION_SOURCE_CHANGED','Reload the original source edition before copying its complete contract.');
          const directories=await readdir(join(this.root,'editions')).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
          if(directories.length>=1000)throw issue('REDIS_CUTOVER_EDITION_CAPACITY','This receiving root already has 1,000 saved editions.');
          if(await lstat(join(this.root,'editions',input.operationId)).catch(error=>{if(error.code==='ENOENT')return null;throw error;}))
            throw issue('REDIS_CUTOVER_EDITION_EXISTS','Choose a new receiving edition directory; the selected name already exists.');
          const selected=clone(parent.input);selected.operationId=input.operationId;
          for(const side of SIDES){
            const key=sha(input.operationId+'\n'+side).slice(0,48);
            selected[side].operationId='cutover-'+key;selected[side].requestId='create-'+key;
          }
          normalizeRedisCutover(selected,this.environment);
          const previousResult=await optional(join(parent.root,'cutover-result.json'));
          request={schema:'stellar-forge.redis-cutover-edition-creation.v1',state:'PREPARED',requestId:input.requestId,
            arguments:clone(input),input:selected,origin:{schema:'stellar-forge.redis-cutover-edition-origin.v1',
              edition:input.operationId,parentDirectory:this.root,parentEdition:parent.edition,
              parentOperationId:parent.input.operationId,parentInputSha256:parent.inputSha256,
              parentInputCanonicalSha256:parent.inputCanonicalSha256,parentResultSha256:previousResult?.sha256??null,
              requestId:input.requestId,note:input.note,createdAt:new Date().toISOString()}};
          await writeRedisCutoverJson(this.root,'cutover-edition-creation.json',request);
        }
        await mkdir(join(this.root,'editions'),{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
        await existingDirectory(join(this.root,'editions'));
        const root=join(this.root,'editions',input.operationId);
        const before=await lstat(root).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
        if(!before){
          await mkdir(root,{mode:0o700});
        }else{
          await existingDirectory(root);
          const origin=await optional(join(root,'cutover-origin.json'));
          const names=await readdir(root);
          if(origin&&stable(origin.value)!==stable(request.origin)||!origin&&names.length)
            throw issue('REDIS_CUTOVER_EDITION_EXISTS','That original receiving directory belongs to another edition.');
        }
        const origin=await optional(join(root,'cutover-origin.json'));
        if(!origin)await writeRedisCutoverJson(root,'cutover-origin.json',request.origin);
        const draft=await optional(join(root,'cutover-draft.json'));
        if(!draft)await writeRedisCutoverJson(root,'cutover-draft.json',{
          schema:'stellar-forge.redis-cutover-draft.v1',requestId:input.requestId,previousSha256:null,
          inputSha256:sha(stable(request.input)),input:request.input,updatedAt:request.origin.createdAt});
        if(!(await optional(join(root,'cutover-edition.json'))))
          await writeRedisCutoverJson(root,'cutover-edition.json',summary(request.input,input.operationId,request.origin));
        await writeRedisCutoverJson(this.root,'cutover-edition-creation.json',{...request,state:'COMPLETED'});
        return this.state({edition:input.operationId});
      }finally{await lease.release();}
    });
  }
  async history({after='',limit=25}={}){
    if(typeof after!=='string'||after&&after!==ROOT&&!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(after)||
        !Number.isInteger(limit)||limit<1||limit>100)
      throw issue('REDIS_CUTOVER_HISTORY_QUERY_INVALID','Choose the original cursor and 1–100 editions.',422);
    const pending=await optional(join(this.root,'cutover-edition-creation.json'));
    const names=await readdir(join(this.root,'editions'),{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
    const keys=[ROOT,...names.filter(value=>value.isDirectory()&&!value.isSymbolicLink()&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value.name))
      .map(value=>value.name).sort()];
    const position=after?keys.indexOf(after)+1:0;
    if(after&&!position)throw issue('REDIS_CUTOVER_HISTORY_CURSOR_CHANGED','Choose a cursor from this original edition list.');
    const selected=keys.slice(position,position+limit),items=[];
    for(const edition of selected){
      if(pending?.value.state==='PREPARED'&&pending.value.arguments.operationId===edition){
        const preparedRoot=await existingDirectory(join(this.root,'editions',edition));
        const origin=await optional(join(preparedRoot,'cutover-origin.json'));
        if(origin&&stable(origin.value)!==stable(pending.value.origin))
          throw issue('REDIS_CUTOVER_EDITION_ORIGIN_CHANGED','The pending original child belongs to another creation.');
        if(!origin||!(await optional(join(preparedRoot,'cutover-draft.json')))&&!(await optional(join(preparedRoot,'cutover-input.json')))){
          items.push({...summary(pending.value.input,edition,pending.value.origin),state:'PREPARED',outcome:null,pending:true});
          continue;
        }
      }
      const root=await this.path(edition),retained=await optional(join(root,'cutover-edition.json'),65536);
      const item=retained?.value??summary((await this.selected(edition)).input,edition);
      const progress=await optional(join(root,'cutover-progress.json'),2097152);
      items.push({...item,state:this.active?.edition===edition?'RUNNING':progress?.value.state??null,
        outcome:progress?.value.outcome??null});
    }
    return {items,nextCursor:position+selected.length<keys.length?selected.at(-1):null,
      pendingEdition:pending?.value.state==='PREPARED'?{requestId:pending.value.requestId,arguments:pending.value.arguments}:null};
  }
  async closeEditors(){
    const errors=[];
    for(const [key,value] of this.editors){try{await value.close();this.editors.delete(key);}catch(error){errors.push(error);}}
    if(errors.length)throw new AggregateError(errors,'Close the original paired authoring windows.');
  }
  start(input){
    fields(input,['edition','mode','digest']);digest(input.digest);
    if(!['create','receive','compare','handover'].includes(input.mode))
      throw issue('REDIS_CUTOVER_OPERATOR_MODE_INVALID','Choose create, receive, compare or handover.',422);
    return this.mutation(async()=>{
      const edition=input.edition??ROOT;
      if(this.active){
        if(this.active.edition===edition&&this.active.mode===input.mode)return this.state({edition});
        this.idle();
      }
      const review=await this.review({edition});
      if(review.digest!==input.digest)throw issue('REDIS_CUTOVER_REVIEW_CHANGED','Review the complete current saved input before starting.');
      const selected=await this.selected(edition);
      if((selected.bound?.sha256??null)!==review.boundSha256||(selected.draft?.sha256??null)!==review.draftSha256||
          selected.inputCanonicalSha256!==review.inputCanonicalSha256)
        throw issue('REDIS_CUTOVER_REVIEW_CHANGED','The saved input changed during review. Reload its complete current draft.');
      if(!selected.bound&&!selected.draft)
        throw issue('REDIS_CUTOVER_DRAFT_REQUIRED','Save the complete receiving input before starting.');
      if(['compare','handover'].includes(input.mode)&&!selected.bound)
        throw issue('REDIS_CUTOVER_RECEIVING_REQUIRED','Receive the original saved pair before comparing or exporting its results.');
      await this.closeEditors();this.lastFailure=null;
      const controller=new AbortController(),active={edition,mode:input.mode,controller,startedAt:new Date().toISOString(),task:null};
      this.active=active;
      let admitted;const admission=new Promise(resolve=>{admitted=resolve;});
      const observed=value=>{active.progress=clone(value);admitted();};
      active.task=Promise.resolve().then(async()=>{
        if(input.mode==='handover')return createRedisCutoverHandover({directory:selected.root,environment:this.environment,
          signal:controller.signal,onProgress:value=>{observed(value);
            if(controller.signal.aborted)throw issue('REDIS_CUTOVER_PAUSED','The original handover is paused after its retained operation.');}});
        return receiveRedisCutover({input:selected.input,inputSha256:selected.inputSha256,directory:selected.root,
          environment:this.environment,mode:input.mode,signal:controller.signal,onProgress:observed,
          expectedSelection:{boundSha256:review.boundSha256,draftSha256:review.draftSha256}});
      }).catch(error=>{
        this.lastFailure={edition,error:{code:error.code??'REDIS_CUTOVER_OPERATOR_FAILED',message:error.message,details:error.details??null}};
        throw error;
      }).finally(()=>{if(this.active===active)this.active=null;admitted();});
      active.task.catch(()=>{});
      // Return the original admission only after its first retained progress
      // write, or its actual terminal outcome. Old completed progress cannot
      // stand in for a newly accepted same-mode comparison.
      await admission;return this.state({edition});
    });
  }
  continue(input={}){
    fields(input,['edition']);const edition=input.edition??ROOT;
    return (async()=>{
      if(this.active?.edition===edition)return this.state({edition});
      const current=await this.state({edition,includeInput:false}),review=await this.review({edition});
      const pendingHandover=current.handover&&current.handover.state!=='READY';
      const mode=pendingHandover?'handover':current.progress?.mode;
      if(!['create','receive','compare','handover'].includes(mode))
        throw issue('REDIS_CUTOVER_CONTINUATION_REQUIRED','Choose the original saved receiving operation to continue.');
      return this.start({edition,mode,digest:review.digest});
    })();
  }
  async wait({edition=ROOT}={}){
    const active=this.active;if(active?.edition===edition)await active.task.catch(()=>{});
    return this.state({edition});
  }
  pause(input={}){
    fields(input,['edition']);const edition=input.edition??ROOT;
    if(!this.active||this.active.edition!==edition)
      throw issue('REDIS_CUTOVER_NOT_ATTACHED','This process has no attached receiving operation. Read its saved progress or Continue through the original writer.');
    this.active.controller.abort();return this.state({edition});
  }
  openSide(input){
    fields(input,['edition','side']);if(!SIDES.includes(input.side))throw issue('REDIS_CUTOVER_SIDE_INVALID','Choose baseline or candidate.',422);
    return this.mutation(async()=>{
      this.idle();const edition=input.edition??ROOT,key=edition+':'+input.side;
      if(this.editors.has(key))return {side:input.side,operatorUrl:this.editors.get(key).operatorUrl};
      const selected=await this.selected(edition),path=join(selected.root,input.side);
      const binding=await inspectRedisWorkspaceBinding(path,{includeSetupOrigin:true});
      if(binding.setupOrigin?.operationId!==selected.input[input.side].operationId||
          binding.setupOrigin.inputSha256!==sha(stable(selected.input[input.side])))
        throw issue('REDIS_CUTOVER_BINDING_CHANGED','The selected workspace belongs to a different original source setup.');
      const report=(await optional(join(selected.root,input.side+'-receiving.json')))?.value;
      const expected=report?.workspace;
      if(expected&&(binding.workspaceId!==expected.workspaceId||binding.profileSha256!==expected.profileSha256))
        throw issue('REDIS_CUTOVER_BINDING_CHANGED','The selected original workspace binding changed.');
      const workspace=await openRedisAuthoringWorkspace(path,{environment:this.environment,
        expectedWorkspaceId:binding.workspaceId,expectedProfileSha256:binding.profileSha256});
      let server;
      try{server=await startRedisAuthoringServer({workspace,port:0});}
      catch(error){await workspace.close().catch(cleanup=>{error.cleanupError=cleanup;});throw error;}
      this.editors.set(key,server);return {side:input.side,operatorUrl:server.operatorUrl,binding};
    });
  }
  async difference(input){
    fields(input,['edition','checkId','kind','offset','limit']);identifier(input.checkId,'Receiving example');
    const selected=await this.selected(input.edition??ROOT),saved=await readRedisCutoverJson(join(selected.root,'cutover-result.json'));
    const item=saved.value.comparisons?.find(value=>value.checkId===input.checkId);
    if(!item||item.file!=='difference-'+input.checkId+'.json'||
        !selected.input.comparisons.some(value=>value.checkId===input.checkId&&value.mode===item.mode))
      throw issue('REDIS_CUTOVER_DIFFERENCE_NOT_FOUND','Choose an original saved comparison.',404);
    if(saved.value.operationId!==selected.input.operationId||saved.value.inputSha256!==selected.inputSha256)
      throw issue('REDIS_CUTOVER_RESULT_CHANGED','The result belongs to another original receiving input.');
    return {...await pageRedisCutoverDifference(join(selected.root,item.file),{sha256:item.differenceSha256,
      kind:input.kind??(item.mode==='ordered'?'changed':'removed'),offset:input.offset??0,limit:input.limit??25}),
      file:item.file,resultSha256:saved.sha256};
  }
  async file(input){
    fields(input,['edition','kind','checkId']);const selected=await this.selected(input.edition??ROOT);
    if(input.kind==='input'){
      const bytes=Buffer.from(JSON.stringify(selected.input,null,2)+'\n');
      return {name:'cutover-input.json',type:'application/json',bytes:bytes.length,sha256:sha(bytes),
        stream:async function*({start=0,end=bytes.length}={}){yield bytes.subarray(start,end);},close:async()=>{}};
    }
    if(input.kind==='handover'){
      const receipt=(await readRedisCutoverJson(join(selected.root,'cutover-handover.json'))).value;
      if(receipt.state!=='READY')throw issue('REDIS_CUTOVER_HANDOVER_REQUIRED','Complete the original handover first.');
      const result=await readRedisCutoverJson(join(selected.root,'cutover-result.json'));
      if(receipt.operationId!==selected.input.operationId||receipt.inputSha256!==selected.inputSha256||
          receipt.resultSha256!==result.sha256||receipt.file?.name!=='redis-valkey-'+result.sha256+'.zip')
        throw issue('REDIS_CUTOVER_HANDOVER_SELECTION_CHANGED','Choose the retained handover for this exact original result.');
      return {name:receipt.file.name,type:'application/zip',
        ...await openRedisCutoverFile(join(selected.root,receipt.file.name),{sha256:receipt.file.sha256,maximum:67108864})};
    }
    if(input.kind==='difference'){
      identifier(input.checkId,'Receiving example');
      const result=(await readRedisCutoverJson(join(selected.root,'cutover-result.json'))).value;
      const item=result.comparisons?.find(value=>value.checkId===input.checkId);
      if(!item||item.file!=='difference-'+input.checkId+'.json'||
          result.operationId!==selected.input.operationId||result.inputSha256!==selected.inputSha256||
          !selected.input.comparisons.some(value=>value.checkId===input.checkId&&value.mode===item.mode))
        throw issue('REDIS_CUTOVER_DIFFERENCE_NOT_FOUND','Choose a complete saved difference file.',404);
      return {name:item.file,type:'application/json',
        ...await openRedisCutoverFile(join(selected.root,item.file),{sha256:item.differenceSha256})};
    }
    throw issue('REDIS_CUTOVER_FILE_KIND_INVALID','Choose the complete input, difference or customer handover.',422);
  }
  close(){
    if(this.closing)return this.closing;
    this.closing=(async()=>{
      await this.tail.catch(()=>{});
      if(this.active){this.active.controller.abort();await this.active.task.catch(()=>{});}
      await this.closeEditors();this.closed=true;
    })();return this.closing;
  }
}
