// MIT. Complete saved workflows over the original native console requests.
import { canonical, digest, fail } from './records.mjs';
import { WorkflowRecords, workflowPointer, workflowDispatchActive } from './workflow-records.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const plain=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const need=(test,code,message)=>{if(!test)throw fail(code,message,409);};
const errorValue=error=>({code:error.code??'CONSOLE_WORKFLOW_ERROR',message:error.message??String(error)});
const done=step=>['COMPLETE','RECOVERED'].includes(step.state);
const successful=call=>call.state==='COMPLETE'&&JSON.parse(call.resultJson)?.isError!==true;
function select(value,pointer,label){
  for(const part of workflowPointer(pointer)){
    need(value!==null&&typeof value==='object'&&Object.hasOwn(value,part),
      'CONSOLE_WORKFLOW_VALUE_MISSING','The selected '+label+' does not contain '+pointer+'. Open its complete original result or inputs.');
    value=value[part];
  }
  return clone(value);
}
function assign(argumentsValue,pointer,value){
  const parts=workflowPointer(pointer);
  if(!parts.length){
    need(plain(value),'CONSOLE_WORKFLOW_ARGUMENTS','The selected complete native arguments must be one JSON object.');return clone(value);
  }
  let parent=argumentsValue;
  for(const part of parts.slice(0,-1)){
    need(parent!==null&&typeof parent==='object'&&Object.hasOwn(parent,part),
      'CONSOLE_WORKFLOW_ARGUMENT_TARGET','Keep the selected argument container in the saved original request.');
    parent=parent[part];
  }
  need(parent!==null&&typeof parent==='object','CONSOLE_WORKFLOW_ARGUMENT_TARGET','Select an original object or array argument container.');
  const leaf=parts.at(-1);
  if(Array.isArray(parent))need(/^(0|[1-9][0-9]*)$/.test(leaf)&&Number(leaf)<parent.length,
    'CONSOLE_WORKFLOW_ARGUMENT_TARGET','Select an existing native array argument position.');
  Object.defineProperty(parent,leaf,{value:clone(value),writable:true,enumerable:true,configurable:true});
  return argumentsValue;
}
export function createMerchantWorkflows({store,definitions,getHost,startCall,waitCall,isCallActive,requireTool}){
  const records=new WorkflowRecords(store),active=new Map();
  let closing=false;
  const updateOwned=(id,kind,mutate,options={})=>records.update(id,kind,mutate,{...options,ownerWorkspaceId:store.id});
  const dispatchActive=run=>run.steps.some(step=>{const call=currentCall(step.callId);return call?.state==='RUNNING'&&workflowDispatchActive(step,store.id);});
  const originalDraft=(definition,step)=>store.draft(step.draftId,step.draftRevision);
  async function authorizeDefinition(definition,context){
    for(const step of definition.steps){const draft=originalDraft(definition,step);await requireTool(context,draft.tool,JSON.parse(draft.argumentsJson));}
  }
  async function authorizeRun(run,context){
    const definition=records.definition(run.workflowId,run.workflowRevision);await authorizeDefinition(definition,context);
    for(const step of run.steps)for(const id of [step.callId,step.resolvedCallId].filter(Boolean)){
      let call;try{call=store.call(id);}catch(error){if(error.code==='CONSOLE_CALL_NOT_FOUND')continue;throw error;}
      await requireTool(context,call.tool,JSON.parse(call.argumentsJson));
    }
    return definition;
  }
  const definitionView=definition=>({...definition,requests:definition.steps.map(step=>{
    const draft=originalDraft(definition,step);
    return{stepId:step.id,draftId:draft.id,draftRevision:draft.revision,name:draft.name,tool:draft.tool,
      toolSchemaSha256:draft.toolSchemaSha256,argumentsSha256:draft.argumentsSha256,argumentsBytes:Buffer.byteLength(draft.argumentsJson)};
  })});
  const runView=(run,full=false)=>{
    const {inputsJson,events,...value}=run;
    return{...value,active:active.has(run.id)||dispatchActive(run),stepsComplete:run.steps.filter(done).length,stepCount:run.steps.length,
      inputsBytes:Buffer.byteLength(inputsJson),inputsSha256:digest(inputsJson),eventCount:events.length,
      custody:run.ownerWorkspaceId===store.id?'OWNED':'RECEIVED_COPY',...(full?{inputsJson,events}:{})};
  };
  function materialize(definition,run,index){
    const step=definition.steps[index],progress=run.steps[index],draft=originalDraft(definition,step);
    let args=JSON.parse(draft.argumentsJson);
    for(const binding of step.bindings){
      let source;
      if(binding.from==='inputs')source=JSON.parse(run.inputsJson);
      else if(binding.from==='run')source={id:run.id,profileId:run.profileId,stepId:step.id,requestId:progress.callId};
      else{
        const previous=run.steps.find(item=>item.id===binding.stepId);
        need(previous&&done(previous),'CONSOLE_WORKFLOW_STEP_PENDING','Finish the original earlier step before using its result.');
        const call=store.call(previous.resolvedCallId??previous.callId);
        need(successful(call),'CONSOLE_WORKFLOW_RESULT_PENDING','Open and reconcile the original earlier native result.');
        source=JSON.parse(call.resultJson);
      }
      args=assign(args,binding.target,select(source,binding.pointer,binding.from==='step'?'earlier result':'workflow '+binding.from));
    }
    return{draft,args};
  }
  function currentCall(id){try{return store.call(id);}catch(error){if(error.code==='CONSOLE_CALL_NOT_FOUND')return null;throw error;}}
  function requireResult(step,call){
    need(successful(call),'CONSOLE_WORKFLOW_NATIVE_RESULT','Open the saved result and recover this request through its native tools.');
    const result=JSON.parse(call.resultJson);
    for(const condition of step.expect){
      const actual=select(result,condition.pointer,'native result');
      const values=Object.hasOwn(condition,'equals')?[condition.equals]:condition.oneOf;
      need(values.some(value=>canonical(value)===canonical(actual)),'CONSOLE_WORKFLOW_EXPECTATION',
        'The native result at '+(condition.pointer||'/')+' has not reached this step’s saved required value. Open its recovery request.');
    }
  }
  function requireOwner(run){
    need(run.ownerWorkspaceId===store.id,'CONSOLE_WORKFLOW_RECEIVING_OWNER',
      'Continue on the receiving workspace named in this run. To move unfinished work, pause it and hand it over to the destination workspace shown on its Host page.');
  }
  function requireRevision(input){
    need(Number.isSafeInteger(input.expectedRevision)&&input.expectedRevision>0,'CONSOLE_WORKFLOW_REVISION','Reopen the current saved run before changing it.');
  }
  function requireHost(run){
    const host=getHost(),profile=store.profile(run.profileId);
    need(run.executionHostFingerprint===host.configurationFingerprint&&profile.hostFingerprint===host.configurationFingerprint,
      'CONSOLE_HOST_CHANGED','Bind this profile to the configured host selected for the current workflow owner.');
  }
  function waiting(id,error,stepId=null){
    return records.update(id,'ATTENTION_REQUIRED',run=>{
      if(run.ownerWorkspaceId!==store.id)return;
      if(run.state==='COMPLETE')return;
      run.state='WAITING';run.error=errorValue(error);
      const step=run.steps.find(value=>value.id===stepId);
      if(step&&step.draftRevision!==null&&!done(step))step.state='WAITING';
    },{stepId,detail:errorValue(error)});
  }
  async function drive(id,context){
    let stepId=null;
    try{
      let run=records.run(id),definition=await authorizeRun(run,context);
      if(run.state==='COMPLETE')return;
      requireOwner(run);
      while(true){
        run=records.run(id);
        if(run.ownerWorkspaceId!==store.id)return;
        if(run.state==='COMPLETE')return;
        const index=run.steps.findIndex(step=>!done(step));
        if(index<0){
          updateOwned(id,'COMPLETED',value=>{value.state='COMPLETE';value.completedAt=new Date().toISOString();value.pauseRequested=false;value.error=null;});return;
        }
        if(closing||run.pauseRequested){
          updateOwned(id,'PAUSED',value=>{value.state='PAUSED';value.pauseRequested=true;value.error=null;});return;
        }
        let step=run.steps[index];stepId=step.id;
        const original=originalDraft(definition,definition.steps[index]),native=definitions.get(original.tool);
        let call=currentCall(step.callId);
        if(!call){
          requireHost(run);
          need(native&&digest(canonical(native))===original.toolSchemaSha256,'CONSOLE_TOOL_CHANGED','Review the configured native tool and the original step before continuing.');
        }
        if(step.draftRevision===null){
          const selected=materialize(definition,run,index);
          await requireTool(context,original.tool,selected.args);
          run=store.transaction(()=>{
            const current=records.run(id);requireOwner(current);
            need(!current.pauseRequested&&current.revision===run.revision,'CONSOLE_WORKFLOW_RUN_CHANGED','Reopen the current saved workflow before preparing its next request.');
            let prepared;
            try{prepared=store.draft(step.draftId,1);}
            catch(error){
              if(error.code!=='CONSOLE_DRAFT_NOT_FOUND')throw error;
              prepared=store.saveDraft({id:step.draftId,profileId:run.profileId,name:(definition.name+' / '+definition.steps[index].name).slice(0,160),
                tool:original.tool,arguments:selected.args},native);
            }
            need(prepared.profileId===run.profileId&&prepared.tool===original.tool&&prepared.toolSchemaSha256===original.toolSchemaSha256&&
              canonical(JSON.parse(prepared.argumentsJson))===canonical(selected.args),'CONSOLE_WORKFLOW_REQUEST_CHANGED','The original prepared workflow request has different arguments.');
            return updateOwned(id,'STEP_PREPARED',value=>{
              const selected=value.steps[index];selected.draftRevision=prepared.revision;selected.argumentsSha256=prepared.argumentsSha256;
              selected.state='RESERVED';value.state='RUNNING';value.error=null;
            },{expectedRevision:current.revision,stepId,callId:step.callId,detail:{draftId:prepared.id,draftRevision:prepared.revision,argumentsSha256:prepared.argumentsSha256}});
          });
          step=run.steps[index];
        }
        call=currentCall(step.callId);
        if(!call){
          if(closing||records.run(id).pauseRequested)continue;
          await startCall({id:step.callId,profileId:run.profileId,draftId:step.draftId,draftRevision:step.draftRevision,
            expectedHostFingerprint:run.executionHostFingerprint},context,{runId:id,stepId:step.id,expectedRevision:records.run(id).revision});
          call=currentCall(step.callId);
          need(call,'CONSOLE_WORKFLOW_REQUEST_PENDING','Reopen the original prepared request to recover its dispatch.');

        }
        await requireTool(context,call.tool,JSON.parse(call.argumentsJson));
        if(call.state==='RUNNING'&&isCallActive(call.id))call=await waitCall(call.id);
        if(call.state==='RUNNING'&&workflowDispatchActive(records.run(id).steps[index],store.id))return;
        if(call.state==='RUNNING'){
          waiting(id,fail('CONSOLE_WORKFLOW_NATIVE_PENDING','This original request is still awaiting its native outcome. Open its existing recovery tools and then continue this same workflow.'),stepId);return;
        }
        const current=records.run(id);if(current.ownerWorkspaceId!==store.id)return;if(done(current.steps[index]))continue;
        requireResult(definition.steps[index],call);
        updateOwned(id,'STEP_COMPLETED',value=>{
          const step=value.steps[index];step.state='COMPLETE';step.completedAt=call.completedAt;value.state='RUNNING';value.error=null;
        },{stepId,callId:call.id,detail:{resultSha256:call.resultSha256}});
      }
    }catch(error){waiting(id,error,stepId);}
  }
  function launch(id,context){
    if(active.has(id))return;
    const task=drive(id,context).finally(()=>active.delete(id));
    active.set(id,task);task.catch(()=>{});
  }
  return{
    records,
    get summary(){return{activeRuns:active.size,closing};},
    async list(profileId,context){
      const workflows=[],runs=[];
      for(const definition of records.definitions(profileId).values()){
        try{await authorizeDefinition(definition,context);workflows.push({id:definition.id,profileId:definition.profileId,name:definition.name,
          revision:definition.revision,contentSha256:definition.contentSha256,steps:definition.steps.length,updatedAt:definition.updatedAt});}
        catch(error){if(!error.merchantConsoleAuthorization)throw error;}
      }
      for(const run of records.runs(profileId)){
        try{await authorizeRun(run,context);runs.push(runView(run));}
        catch(error){if(!error.merchantConsoleAuthorization)throw error;}
      }
      return{workflows,runs};
    },
    async definition(id,revision,context){const value=records.definition(id,revision);await authorizeDefinition(value,context);return definitionView(value);},
    async run(id,context){
      const value=records.run(id),definition=await authorizeRun(value,context),recoveryCalls=[];
      const index=value.steps.findIndex(step=>!done(step)),step=value.steps[index];
      if(step)for(const call of store.calls(value.profileId)){
        if(!successful(call))continue;
        const draft=store.draft(call.draftId,call.draftRevision);
        if(draft.recoveryOf!==step.callId)continue;
        try{await requireTool(context,call.tool,JSON.parse(call.argumentsJson));requireResult(definition.steps[index],call);
          recoveryCalls.push({id:call.id,tool:call.tool,name:draft.name,completedAt:call.completedAt,resultSha256:call.resultSha256});}
        catch(error){if(!error.merchantConsoleAuthorization&&!String(error.code??'').startsWith('CONSOLE_WORKFLOW_'))throw error;}
      }
      return{...runView(value,true),recoveryCalls};
    },
    async save(input,context){
      for(const step of input.steps??[]){const draft=store.draft(step.draftId,step.draftRevision);await requireTool(context,draft.tool,JSON.parse(draft.argumentsJson));}
      const value=records.save(input);return{...value,definition:definitionView(value.definition)};
    },
    async start(input,context){
      need(!closing,'CONSOLE_CLOSING','The original operator interface is closing.');
      const definition=records.definition(input.workflowId,input.workflowRevision);await authorizeDefinition(definition,context);
      const reserved=records.reserve(input,getHost());
      // A repeated start only reopens its original run; continuing is a distinct visible action.
      if(!reserved.reused)launch(reserved.run.id,context);
      return{run:runView(records.run(reserved.run.id),true),reused:reserved.reused};
    },
    async resume(input,context){
      need(!closing,'CONSOLE_CLOSING','The original operator interface is closing.');
      requireRevision(input);const run=records.run(input.id);await authorizeRun(run,context);requireOwner(run);
      const updated=updateOwned(run.id,'CONTINUED',value=>{
        if(value.state==='COMPLETE')return;
        value.pauseRequested=false;value.state='READY';value.error=null;
      },{expectedRevision:input.expectedRevision});
      if(updated.state!=='COMPLETE')launch(updated.id,context);
      return{run:runView(records.run(updated.id),true)};
    },
    async pause(input,context){
      requireRevision(input);const run=records.run(input.id);await authorizeRun(run,context);requireOwner(run);
      const updated=updateOwned(run.id,'PAUSE_REQUESTED',value=>{
        if(value.state==='COMPLETE')return;
        value.pauseRequested=true;if(!active.has(value.id))value.state='PAUSED';
      },{expectedRevision:input.expectedRevision});
      return{run:runView(updated,true)};
    },
    async resolve(input,context){
      requireRevision(input);const run=records.run(input.id),definition=await authorizeRun(run,context);requireOwner(run);
      need(!active.has(run.id),'CONSOLE_WORKFLOW_ACTIVE','Wait for the current native request to return before resolving this step.');
      const index=run.steps.findIndex(step=>!done(step)),step=run.steps[index];
      need(step&&step.id===input.stepId&&step.draftRevision!==null,'CONSOLE_WORKFLOW_RECOVERY','Select the original unfinished workflow step.');
      const original=currentCall(step.callId),recovered=store.call(input.callId),draft=store.draft(recovered.draftId,recovered.draftRevision);
      need(original&&!isCallActive(original.id)&&recovered.profileId===run.profileId&&successful(recovered)&&draft.recoveryOf===original.id,
        'CONSOLE_WORKFLOW_RECOVERY','Select a completed native recovery request linked to this original call.');
      await requireTool(context,recovered.tool,JSON.parse(recovered.argumentsJson));
      requireResult(definition.steps[index],recovered);
      need(typeof input.note==='string'&&input.note.trim()&&input.note.length<=8000,'CONSOLE_WORKFLOW_RECOVERY_NOTE','Record how this completed native recovery resolves the original step.');
      const updated=updateOwned(run.id,'STEP_RECOVERED',value=>{
        const selected=value.steps[index];selected.state='RECOVERED';selected.resolvedCallId=recovered.id;
        selected.resolutionNote=input.note.trim();selected.completedAt=new Date().toISOString();value.state='PAUSED';value.pauseRequested=true;value.error=null;
      },{expectedRevision:input.expectedRevision,stepId:step.id,callId:recovered.id,detail:{originalCallId:original.id,resultSha256:recovered.resultSha256,note:input.note.trim()}});
      return{run:runView(updated,true)};
    },
    async handover(input,context){
      requireRevision(input);
      const run=records.run(input.id);await authorizeRun(run,context);
      const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
      need(id(input.handoverId)&&id(input.workspaceId)&&typeof input.hostFingerprint==='string'&&/^[a-f0-9]{64}$/.test(input.hostFingerprint)&&
        typeof input.note==='string'&&input.note.trim()&&input.note.length<=8000,'CONSOLE_WORKFLOW_HANDOVER','Select the destination Host page’s workspace and configuration fingerprint, and write its handover note.');
      const previous=run.events.find(event=>event.kind==='HANDED_OVER'&&event.detail.id===input.handoverId)?.detail;
      if(previous){
        need(previous.toWorkspaceId===input.workspaceId&&previous.hostFingerprint===input.hostFingerprint&&previous.sourceRevision===input.expectedRevision&&previous.note===input.note.trim(),
          'CONSOLE_WORKFLOW_HANDOVER_CONFLICT','Reopen the original handover; that identifier already names a different receiving request.');
        return{run:runView(run,true),reused:true};
      }
      requireOwner(run);
      need(!active.has(run.id)&&run.state!=='COMPLETE'&&['PAUSED','WAITING'].includes(run.state)&&input.workspaceId!==store.id,
        'CONSOLE_WORKFLOW_HANDOVER','Pause this unfinished run and let its current native request return, then select the destination workspace.');
      const handover={id:input.handoverId,fromWorkspaceId:store.id,toWorkspaceId:input.workspaceId,hostFingerprint:input.hostFingerprint,
        note:input.note.trim(),at:new Date().toISOString(),sourceRevision:run.revision};
      const updated=updateOwned(run.id,'HANDED_OVER',value=>{
        need(!dispatchActive(value),'CONSOLE_WORKFLOW_ACTIVE','Let the original native request return before handing this run to another workspace.');
        value.ownerWorkspaceId=handover.toWorkspaceId;value.executionHostFingerprint=handover.hostFingerprint;value.handover=handover;
        value.state='PAUSED';value.pauseRequested=true;value.error=null;
      },{expectedRevision:input.expectedRevision,detail:handover});
      return{run:runView(updated,true),reused:false};
    },
    beginClose(){
      closing=true;
      for(const id of active.keys())records.update(id,'HOST_DRAIN_REQUESTED',run=>{if(run.ownerWorkspaceId===store.id)run.pauseRequested=true;});
    },
    async close(){this.beginClose();const values=await Promise.allSettled([...active.values()]);
      const errors=values.filter(value=>value.status==='rejected').map(value=>value.reason);
      if(errors.length)throw new AggregateError(errors,'The original workflow owner has not completed its drain.');
    }
  };
}
