// MIT. Saved native workflows in the original merchant operator interface.
import { createWorkflowRecipes } from './workflow-recipes.mjs';
export function createWorkflowPage({state,$,node,text,pretty,when,tag,properties,selectionList,action,busy,api,notice,uid,requireProfile,loadProfile,openCall,chooseTool,download,schedulePoll,customerCallReady,prepareCustomer}){
  const own={profileId:null,definitions:[],runs:[],definition:null,steps:[],editorId:null,dirty:false,run:null,pendingRun:null,pendingHandover:null,editorVersion:0,inputsVersion:0,definitionOpenSeq:0,runOpenSeq:0,refreshSeq:0,intentReady:false,mutating:false,sessionEpoch:null};
  const unchanged=(a,b)=>JSON.stringify(order(a))===JSON.stringify(order(b));
  function order(value){if(Array.isArray(value))return value.map(order);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,order(value[key])]));return value;}
  const owned=run=>run?.ownerWorkspaceId===state.host?.console.workspaceId;
  const finished=step=>['COMPLETE','RECOVERED'].includes(step.state);
  const context=()=>({session:state.sessionEpoch,selection:state.profileEpoch,profileId:state.profile?.id,workspaceId:state.host?.console.workspaceId});
  const current=ctx=>ctx.session===state.sessionEpoch&&ctx.selection===state.profileEpoch&&ctx.profileId===state.profile?.id&&ctx.workspaceId===state.host?.console.workspaceId;
  const invoke=async(path,body,ctx=context())=>api(path,{method:'POST',body,epoch:ctx.session});
  let intentDatabase,recipes=null;
  function database(){
    if(!intentDatabase)intentDatabase=new Promise((resolve,reject)=>{
      const request=indexedDB.open('starforge-merchant-operator-actions',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('intents',{keyPath:'key'});
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    }).catch(error=>{intentDatabase=null;throw error;});
    return intentDatabase;
  }
  const intentKey=(ctx,kind)=>[ctx.workspaceId,ctx.profileId,kind].join('/');
  async function intentRecord(ctx,kind,change){
    const db=await database(),key=intentKey(ctx,kind);
    return new Promise((resolve,reject)=>{
      const transaction=db.transaction('intents',change?'readwrite':'readonly'),store=transaction.objectStore('intents');
      const request=store.get(key);let result;
      request.onsuccess=()=>{
        try{
          result=request.result??null;
          if(change){
            const next=change(result);
            if(next===null){store.delete(key);result=null;}
            else if(next!==result){result={...next,key};store.put(result);}
          }
        }catch(error){transaction.abort();reject(error);}
      };
      transaction.oncomplete=()=>resolve(result);
      transaction.onerror=()=>reject(transaction.error);
      transaction.onabort=()=>reject(transaction.error??new Error('The pending action could not be saved.'));
    });
  }
  async function retainIntent(ctx,kind,body){
    const value=await intentRecord(ctx,kind,old=>old??{kind,body,attempts:0,createdAt:new Date().toISOString()});
    return value.body;
  }
  const intentId=(kind,body)=>body[kind==='handover'?'handoverId':'id'];
  async function markAttempt(ctx,kind,body){
    let attempt=null;
    await intentRecord(ctx,kind,old=>{
      if(!old||intentId(kind,old.body)!==intentId(kind,body)||!unchanged(old.body,body))return old;
      const number=(old.attempts??1)+1;attempt={number,prior:old.attempts!==0};
      return {...old,attempts:number,lastAttemptAt:new Date().toISOString()};
    });
    if(!attempt){
      if(current(ctx))await restoreIntents(ctx);
      throw new Error('This pending action changed in another tab. Review the current original action.');
    }
    return attempt;
  }
  async function releaseIntent(ctx,kind,body,attempt=null){
    return intentRecord(ctx,kind,old=>{
      if(!old)return null;
      if(attempt&&old.attempts!==attempt.number)return old;
      return intentId(kind,old.body)===intentId(kind,body)&&unchanged(old.body,body)?null:old;
    });
  }
  async function restoreIntents(ctx){
    const [start,handover]=await Promise.all([intentRecord(ctx,'start'),intentRecord(ctx,'handover')]);
    if(!current(ctx))return;
    own.pendingRun=start?.body??null;own.pendingHandover=handover?.body??null;own.intentReady=true;renderPending();sync();
  }
  function renderPending(){
    const pending=Boolean(own.pendingRun||own.pendingHandover);$('workflow-pending').hidden=!pending;
    $('workflow-retry-start').hidden=!own.pendingRun;$('workflow-retry-handover').hidden=!own.pendingHandover;
    text($('workflow-pending-start'),own.pendingRun?'Original start '+own.pendingRun.id+' · '+own.pendingRun.workflowId+' / r'+own.pendingRun.workflowRevision:'');
    text($('workflow-pending-handover'),own.pendingHandover?'Original handover '+own.pendingHandover.handoverId+' · run '+own.pendingHandover.id+' → '+own.pendingHandover.workspaceId:'');
  }
  async function mutate(fn){
    if(own.mutating)throw new Error('Let the current workflow action return.');
    own.mutating=true;sync();try{return await fn();}finally{own.mutating=false;sync();}
  }
  function getSelection(){
    return {...context(),id:own.definition?.id??null,editorId:own.editorId,revision:own.definition?.revision??null,
      contentSha256:own.definition?.contentSha256??null,name:$('workflow-name').value,dirty:own.dirty,
      editorVersion:own.editorVersion,definitionOpenSeq:own.definitionOpenSeq,inputsVersion:own.inputsVersion,
      inputsText:$('workflow-inputs').value};
  }
  const selectionCurrent=selection=>current(selection)&&unchanged(selection,getSelection());
  function prefillInputs(inputs,selection){
    if(!selectionCurrent(selection))return false;
    $('workflow-inputs').value=pretty(inputs);own.inputsVersion++;sync();return true;
  }
  function parsed(value,label,kind='array'){
    let result;try{result=JSON.parse(value);}catch(error){throw new Error(label+' must be complete JSON: '+error.message);}
    if(kind==='array'?!Array.isArray(result):!result||typeof result!=='object'||Array.isArray(result))throw new Error(label+' must be a JSON '+kind+'.');
    return result;
  }
  function changed(){own.dirty=true;own.editorVersion++;sync();}
  function readSteps(){
    return [...$('workflow-steps').querySelectorAll('[data-step-id]')].map(card=>{
      const source=own.steps.find(step=>step.id===card.dataset.stepId);
      return{...source,name:card.querySelector('[data-field="name"]').value,
        bindings:parsed(card.querySelector('[data-field="bindings"]').value,'Input mappings'),
        expect:parsed(card.querySelector('[data-field="expect"]').value,'Required result values'),pauseAfter:card.querySelector('[data-field="pauseAfter"]').checked};
    });
  }
  function reset(){
    own.profileId=state.profile?.id??null;own.sessionEpoch=state.sessionEpoch;own.editorVersion++;own.inputsVersion++;own.definitionOpenSeq++;own.runOpenSeq++;own.refreshSeq++;own.intentReady=false;own.definitions=[];own.runs=[];own.definition=null;own.steps=[];own.editorId=null;
    own.dirty=false;own.run=null;own.pendingRun=null;own.pendingHandover=null;
    $('workflow-editor').hidden=true;$('workflow-run-detail').hidden=true;
    $('workflow-name').value='';$('workflow-inputs').value='{}';$('workflow-steps').replaceChildren();
    for(const id of ['workflow-run-json','workflow-run-events','workflow-run-inputs'])text($(id),'');
    for(const id of ['workflow-recipient-workspace','workflow-recipient-host','workflow-handover-note','workflow-recovery-note'])$(id).value='';
    recipes?.reset();renderLists();renderPending();sync();
  }
  function profileChanged(){if(own.profileId!==(state.profile?.id??null)||own.sessionEpoch!==state.sessionEpoch)reset();refreshDraftPicker();recipes?.profileChanged();sync();}
  function refreshDraftPicker(){
    const selected=$('workflow-add-draft').value;
    const drafts=(state.details?.drafts??[]).filter(draft=>!draft.id.startsWith('workflow-draft-'));
    $('workflow-add-draft').replaceChildren(new Option('Choose a saved request',''),...drafts.map(draft=>new Option(draft.name+' · r'+draft.revision+' · '+draft.tool,draft.id)));
    if(drafts.some(draft=>draft.id===selected))$('workflow-add-draft').value=selected;
  }
  function editor(definition=null){
    requireProfile();own.editorVersion++;own.definitionOpenSeq++;own.definition=definition;own.editorId=definition?.id??uid();own.steps=JSON.parse(JSON.stringify(definition?.steps??[]));own.dirty=!definition;
    $('workflow-editor').hidden=false;$('workflow-name').value=definition?.name??'';
    renderSteps();sync();
    if(!definition)$('workflow-name').focus();
  }
  function renderSteps(){
    $('workflow-steps').replaceChildren();
    own.steps.forEach((step,index)=>{
      const card=node('section',undefined,'workflow-step');card.dataset.stepId=step.id;
      const heading=node('div',undefined,'section-heading'),number=node('strong','Step '+(index+1)),actions=node('div',undefined,'actions');
      for(const [label,delta] of [['Move up',-1],['Move down',1]]){
        const button=node('button',label);button.type='button';button.disabled=index+delta<0||index+delta>=own.steps.length;
        action(button,()=>{own.steps=readSteps();[own.steps[index],own.steps[index+delta]]=[own.steps[index+delta],own.steps[index]];changed();renderSteps();});actions.append(button);
      }
      const remove=node('button','Remove');remove.type='button';action(remove,()=>{own.steps=readSteps().filter(value=>value.id!==step.id);changed();renderSteps();});actions.append(remove);
      heading.append(number,actions);card.append(heading);
      const label=node('label','Step name'),name=node('input');name.dataset.field='name';name.id='workflow-step-name-'+step.id;label.htmlFor=name.id;name.maxLength=160;name.value=step.name;name.required=true;name.addEventListener('input',changed);
      const request=own.definition?.requests.find(value=>value.stepId===step.id)??state.details?.drafts.find(value=>value.id===step.draftId);
      const identity=node('p',(request?.tool??'Saved request')+' · '+step.draftId+' / r'+step.draftRevision,'hint break');
      const open=node('button','Open saved request');open.type='button';action(open,async()=>{
        const ctx=context(),packet=await api('draft/'+encodeURIComponent(step.draftId)+'?revision='+step.draftRevision,{epoch:ctx.session});
        if(current(ctx))return chooseTool(packet.draft.tool,{draft:packet.draft});
      });
      card.append(label,name,identity,open,node('p','Step identifier: '+step.id,'hint'));
      const mappingLabel=node('label','Input mappings (JSON)'),mappings=node('textarea');
      mappings.id='workflow-mappings-'+step.id;mappings.dataset.field='bindings';mappings.className='code-input workflow-json';mappings.rows=4;mappings.spellcheck=false;mappings.value=pretty(step.bindings);mappingLabel.htmlFor=mappings.id;mappings.addEventListener('input',changed);
      const expectationLabel=node('label','Required result values (JSON)'),expect=node('textarea');
      expect.id='workflow-expect-'+step.id;expect.dataset.field='expect';expect.className='code-input workflow-json';expect.rows=3;expect.spellcheck=false;expect.value=pretty(step.expect??[]);expectationLabel.htmlFor=expect.id;expect.addEventListener('input',changed);
      const pauseLabel=node('label',undefined,'checkbox'),pause=node('input');pause.type='checkbox';pause.dataset.field='pauseAfter';pause.checked=step.pauseAfter??false;pause.addEventListener('change',changed);
      pauseLabel.append(pause,node('span','Pause after this step'));
      card.append(mappingLabel,mappings,expectationLabel,expect,pauseLabel);$('workflow-steps').append(card);
    });
    if(!own.steps.length)$('workflow-steps').append(node('p','Add saved requests in the order this workflow should perform them.','empty'));
  }
  function addStep(){
    const draft=state.details?.drafts.find(value=>value.id===$('workflow-add-draft').value);
    if(!draft)throw new Error('Choose a saved request to add.');
    if(own.steps.length)own.steps=readSteps();
    let number=1;while(own.steps.some(step=>step.id==='step'+number))number++;
    own.steps.push({id:'step'+number,name:draft.name,draftId:draft.id,draftRevision:draft.revision,bindings:[],expect:[],pauseAfter:false});changed();renderSteps();
  }
  async function openDefinition(id,revision){
    requireProfile();const ctx=context(),sequence=++own.definitionOpenSeq,editVersion=own.editorVersion;
    const packet=await api('workflow/'+encodeURIComponent(id)+(revision?'?revision='+revision:''),{epoch:ctx.session});
    if(!current(ctx)||sequence!==own.definitionOpenSeq||editVersion!==own.editorVersion)return;
    editor(packet.definition);renderLists();
    await recipes?.prefillDefinition(packet.definition,getSelection());
  }
  async function save(copy=false){
    const profile=requireProfile(),ctx=context(),steps=readSteps(),version=own.editorVersion,selection=own.definitionOpenSeq;
    if(!steps.length)throw new Error('Add at least one saved request.');
    const id=copy?uid():own.editorId??uid();
    const body={id,profileId:profile.id,name:$('workflow-name').value,steps,
      ...(!copy&&own.definition?{expectedRevision:own.definition.revision}:{})};
    let packet;
    try{packet=await invoke('workflows',body,ctx);}
    catch(error){
      try{const retained=await api('workflow/'+encodeURIComponent(id),{epoch:ctx.session});
        if(retained.definition.name===body.name.trim()&&unchanged(retained.definition.steps,steps))packet=retained;
      }catch{}
      if(!packet)throw error;
    }
    if(!current(ctx))return;
    if(version===own.editorVersion&&selection===own.definitionOpenSeq)editor(packet.definition);
    await refresh();notice('Saved '+packet.definition.name+' · revision '+packet.definition.revision+'.');
  }
  async function start(recover=false){
    const profile=requireProfile(),ctx=context(),definition=own.definition,version=own.editorVersion,selection=own.runOpenSeq;
    if(!own.intentReady)throw new Error('Let this profile’s original pending actions load first.');
    let intent;
    if(recover){intent=own.pendingRun;if(!intent)throw new Error('There is no pending original start.');}
    else{
      if(own.pendingRun)throw new Error('Recover the displayed original start before starting a new run.');
      if(!definition||own.dirty)throw new Error('Save the displayed workflow revision first.');
      const inputs=parsed($('workflow-inputs').value,'Workflow inputs','object');
      const proposed={id:uid(),profileId:profile.id,workflowId:definition.id,workflowRevision:definition.revision,
        expectedWorkflowSha256:definition.contentSha256,expectedHostFingerprint:state.host.configurationFingerprint,inputs};
      intent=await retainIntent(ctx,'start',proposed);
      if(!current(ctx))return;
      own.pendingRun=intent;renderPending();sync();
      if(intent.id!==proposed.id){notice('Another tab retained the displayed original start. Use Recover original action to continue it.');return;}
    }
    const attempt=await markAttempt(ctx,'start',intent);if(!current(ctx))return;
    let result;
    try{result=await invoke('workflow-runs',intent,ctx);}
    catch(error){
      try{result={...await api('workflow-run/'+encodeURIComponent(intent.id),{epoch:ctx.session}),reused:true};}catch{}
      if(!result){
        if(!attempt.prior&&error.status>=400&&error.status<500){
          await releaseIntent(ctx,'start',intent,attempt);if(current(ctx))await restoreIntents(ctx);
        }
        throw error;
      }
    }
    await releaseIntent(ctx,'start',intent);
    if(!current(ctx))return;
    await restoreIntents(ctx);await loadProfile();
    if(current(ctx)&&selection===own.runOpenSeq&&(recover||version===own.editorVersion))await openRun(result.run.id);
    if(current(ctx))notice((result.reused?'Reopened':'Started')+' workflow '+result.run.id+'.');
    schedulePoll();
  }
  async function openRun(id,{background=false}={}){
    requireProfile();const ctx=context(),sequence=background?own.runOpenSeq:++own.runOpenSeq;
    const packet=await api('workflow-run/'+encodeURIComponent(id),{epoch:ctx.session});
    if(!current(ctx)||sequence!==own.runOpenSeq||background&&own.run?.id!==id)return;
    own.run=packet.run;renderRun();renderLists();sync();
  }
  function renderLists(){
    text($('workflow-count'),own.definitions.length);
    selectionList($('workflow-list'),own.definitions,own.definition?.id,(button,value)=>{
      button.append(node('strong',value.name),node('p',value.steps+' steps · revision '+value.revision+' · '+when(value.updatedAt)));
    },value=>openDefinition(value.id),state.profile?'No saved workflows yet.':'Select or create a profile.');
    selectionList($('workflow-runs'),[...own.runs].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),own.run?.id,(button,value)=>{
      const definition=own.definitions.find(item=>item.id===value.workflowId);
      button.append(node('strong',definition?.name??value.workflowId),node('p',value.stepsComplete+' / '+value.stepCount+' steps · '+when(value.createdAt)));
      const meta=node('div',undefined,'meta');meta.append(tag(value.state),node('span',value.id));button.append(meta);
    },value=>openRun(value.id),state.profile?'Run a saved workflow to retain its complete progress.':'Select or create a profile.');
  }
  function renderRun(){
    const run=own.run;$('workflow-run-detail').hidden=!run;if(!run)return;
    const definition=own.definitions.find(value=>value.id===run.workflowId);
    text($('workflow-run-title'),definition?.name??run.workflowId);text($('workflow-run-state'),run.state);$('workflow-run-state').dataset.state=run.state;
    properties($('workflow-run-properties'),[
      ['Run',run.id,true],['Saved workflow',run.workflowId+' / r'+run.workflowRevision,true],['Progress',run.stepsComplete+' / '+run.stepCount+' complete'],
      ['Started',when(run.createdAt)],['Updated',when(run.updatedAt)],['Current revision',run.revision],
      ['Source workspace',run.workspaceId,true],['Current owner',run.ownerWorkspaceId,true],['Configured host',run.executionHostFingerprint,true],
      ['Request SHA-256',run.requestSha256,true],['Inputs SHA-256',run.inputsSha256,true]
    ]);
    text($('workflow-run-message'),run.error?run.error.message:run.state==='COMPLETE'?'All saved steps have returned their required native results.':!owned(run)?'This run is assigned to the displayed receiving workspace. Export its profile to take the complete history there.':run.pauseRequested?'The workflow will stay paused after its current request.':'The current owner retains each native request before continuing.');
    $('workflow-run-steps').replaceChildren(...run.steps.map((step,index)=>{
      const row=node('tr'),stateCell=node('td'),actionCell=node('td');stateCell.append(tag(step.state));
      const button=node('button','Open request');button.type='button';button.disabled=step.draftRevision===null;
      action(button,()=>openCall(step.resolvedCallId??step.callId));actionCell.append(button);
      const callId=step.resolvedCallId??step.callId,call=state.details?.calls.find(value=>value.id===callId);
      if(finished(step)&&customerCallReady?.(call)){
        const receive=node('button','Prepare customer');receive.type='button';
        action(receive,()=>{
          const ctx=context(),sequence=own.runOpenSeq,runId=run.id;
          return prepareCustomer(callId,{isCurrent:()=>current(ctx)&&sequence===own.runOpenSeq&&own.run?.id===runId});
        });
        actionCell.append(receive);
      }
      row.append(node('td',String(index+1)),node('td',step.id),stateCell,node('td',step.callId,'mono break'),actionCell);return row;
    }));
    const step=run.steps.find(value=>!finished(value)),choices=run.recoveryCalls??[];
    $('workflow-recovery').hidden=!step||run.state==='COMPLETE'||!owned(run);
    const selected=$('workflow-recovery-call').value;
    $('workflow-recovery-call').replaceChildren(new Option('Choose a completed linked recovery',''),...choices.map(value=>new Option(value.name+' · '+value.id,value.id)));
    if(choices.some(value=>value.id===selected))$('workflow-recovery-call').value=selected;
    text($('workflow-recovery-hint'),step?'Use Requests to prepare and run a native recovery linked to '+step.callId+'. Matching completed results appear here.':'');
    text($('workflow-run-inputs'),pretty(JSON.parse(run.inputsJson)));text($('workflow-run-events'),pretty(run.events));text($('workflow-run-json'),pretty(run));
    sync();
  }
  async function refresh(){
    profileChanged();const ctx=context();if(!ctx.profileId)return;const sequence=++own.refreshSeq;
    try{await restoreIntents(ctx);}catch(error){if(current(ctx)){own.intentReady=false;notice('Pending workflow actions could not be opened: '+error.message,true);}}
    if(!current(ctx)||sequence!==own.refreshSeq)return;
    const packet=await api('workflows?'+new URLSearchParams({profile:ctx.profileId}),{epoch:ctx.session});
    if(!current(ctx)||sequence!==own.refreshSeq)return;
    own.definitions=packet.workflows;own.runs=packet.runs;
    if(own.run){
      const selected=own.runs.find(value=>value.id===own.run.id);
      if(selected&&(selected.revision!==own.run.revision||selected.active!==own.run.active||own.run.state==='WAITING'||own.run.state==='PAUSED'))
        await openRun(selected.id,{background:true});
    }
    if(current(ctx)){renderLists();sync();await recipes?.refresh();}
  }
  async function control(kind){
    const run=own.run,ctx=context(),selection=own.runOpenSeq;if(!run)throw new Error('Open a saved run.');
    await invoke('workflow-'+kind,{id:run.id,expectedRevision:run.revision},ctx);
    if(!current(ctx))return;
    await loadProfile();if(current(ctx)&&selection===own.runOpenSeq&&own.run?.id===run.id)await openRun(run.id,{background:true});
    schedulePoll();if(current(ctx))notice(kind==='pause'?'Pause requested after the current native request.':'Continuing the same saved workflow.');
  }
  async function resolveStep(){
    const run=own.run,ctx=context(),selection=own.runOpenSeq,step=run?.steps.find(value=>!finished(value)),note=$('workflow-recovery-note').value;
    if(!step)throw new Error('Open an unfinished workflow step.');
    await invoke('workflow-resolve',{id:run.id,expectedRevision:run.revision,stepId:step.id,callId:$('workflow-recovery-call').value,note},ctx);
    if(!current(ctx))return;
    await loadProfile();if(current(ctx)&&selection===own.runOpenSeq&&own.run?.id===run.id){
      if($('workflow-recovery-note').value===note)$('workflow-recovery-note').value='';
      await openRun(run.id,{background:true});notice('The native recovery is attached to this step. Continue the saved run when ready.');
    }
  }
  async function handover(recover=false){
    const run=own.run,ctx=context(),selection=own.runOpenSeq;
    if(!own.intentReady)throw new Error('Let this profile’s original pending actions load first.');
    let request;
    if(recover){request=own.pendingHandover;if(!request)throw new Error('There is no pending original handover.');}
    else{
      if(!run)throw new Error('Open the paused run.');
      if(own.pendingHandover)throw new Error('Recover the displayed original handover first.');
      const proposed={id:run.id,expectedRevision:run.revision,handoverId:uid(),
        workspaceId:$('workflow-recipient-workspace').value.trim(),hostFingerprint:$('workflow-recipient-host').value.trim(),note:$('workflow-handover-note').value};
      request=await retainIntent(ctx,'handover',proposed);
      if(!current(ctx))return;own.pendingHandover=request;renderPending();sync();
      if(request.handoverId!==proposed.handoverId){notice('Another tab retained the displayed original handover. Use Recover original action to continue it.');return;}
    }
    const attempt=await markAttempt(ctx,'handover',request);if(!current(ctx))return;
    let response;
    try{response=await invoke('workflow-handover',request,ctx);}
    catch(error){
      try{const retained=await api('workflow-run/'+encodeURIComponent(request.id),{epoch:ctx.session});
        if(retained.run.events.some(event=>event.kind==='HANDED_OVER'&&event.detail.id===request.handoverId))response={...retained,reused:true};
      }catch{}
      if(!response){
        if(!attempt.prior&&error.status>=400&&error.status<500){
          await releaseIntent(ctx,'handover',request,attempt);if(current(ctx))await restoreIntents(ctx);
        }
        throw error;
      }
    }
    await releaseIntent(ctx,'handover',request);
    if(!current(ctx))return;
    await restoreIntents(ctx);await refresh();
    if(current(ctx)&&selection===own.runOpenSeq&&(recover||own.run?.id===request.id))await openRun(request.id);
    if(!current(ctx))return;
    await download('export/'+encodeURIComponent(response.run.profileId),response.run.profileId+'-operator-profile.json');
    if(current(ctx))notice(response.reused?'Recovered original handover '+request.handoverId+'. Current owner: '+response.run.ownerWorkspaceId+'. Complete profile exported.':'Handed run '+request.id+' to '+request.workspaceId+' and exported its complete profile.');
  }
  function sync(){
    const selected=Boolean(state.profile),saved=Boolean(own.definition)&&!own.dirty,bound=state.profile?.hostFingerprint===state.host?.configurationFingerprint;
    $('new-workflow').disabled=!selected;$('workflow-add-step').disabled=!selected||!own.editorId;
    $('workflow-save').disabled=!selected||!own.editorId;$('workflow-copy').disabled=!selected||!own.editorId;
    $('workflow-start').disabled=!saved||!bound||!own.intentReady||Boolean(own.pendingRun)||Boolean(state.host?.console.closing);
    text($('workflow-start'),'Run saved workflow');
    $('workflow-retry-start').disabled=!own.intentReady||!own.pendingRun;$('workflow-retry-handover').disabled=!own.intentReady||!own.pendingHandover;
    text($('workflow-edition'),own.definition?'Revision '+own.definition.revision+(own.dirty?' · unsaved changes':' · saved'):'New workflow');
    text($('workflow-definition-sha'),own.definition?.contentSha256??'');
    const run=own.run,can=Boolean(run)&&owned(run)&&run.state!=='COMPLETE';
    $('workflow-continue').disabled=!can||run.active||Boolean(state.host?.console.closing);
    $('workflow-pause').disabled=!can||run.pauseRequested;
    $('workflow-resolve').disabled=!can||run.active||!$('workflow-recovery-call').value;
    $('workflow-handover-submit').disabled=!can||run.active||!own.intentReady||Boolean(own.pendingHandover)||!['PAUSED','WAITING'].includes(run.state);
    $('workflow-open-edition').disabled=!run;$('workflow-export').disabled=!run;
    $('workflow-open-original').disabled=!run?.steps.find(step=>!finished(step)&&step.draftRevision!==null);
    if(own.mutating)for(const id of ['workflow-save','workflow-copy','workflow-start','workflow-continue','workflow-pause','workflow-resolve','workflow-handover-submit','workflow-retry-start','workflow-retry-handover'])$(id).disabled=true;
    recipes?.sync();
  }
  recipes=createWorkflowRecipes({state,$,node,text,pretty,when,tag,properties,selectionList,action,busy,api,notice,
    uid,requireProfile,loadProfile,context,current,intentRecord,markAttempt,releaseIntent,mutate,
    mutationActive:()=>own.mutating,openDefinition,getSelection,selectionCurrent,prefillInputs});
  action($('new-workflow'),()=>editor());
  action($('refresh-workflows'),async()=>{await loadProfile();if(own.run)await openRun(own.run.id);});
  action($('workflow-add-step'),addStep);action($('workflow-copy'),()=>mutate(()=>save(true)));action($('workflow-start'),()=>mutate(()=>start()));
  $('workflow-form').addEventListener('submit',event=>{event.preventDefault();busy(event.submitter,()=>mutate(()=>save()));});
  $('workflow-name').addEventListener('input',changed);
  $('workflow-inputs').addEventListener('input',()=>{own.inputsVersion++;sync();});
  action($('workflow-continue'),()=>mutate(()=>control('resume')));action($('workflow-pause'),()=>mutate(()=>control('pause')));
  action($('workflow-open-edition'),()=>openDefinition(own.run.workflowId,own.run.workflowRevision));
  action($('workflow-export'),()=>download('export/'+encodeURIComponent(own.run.profileId),own.run.profileId+'-operator-profile.json'));
  action($('workflow-open-original'),()=>openCall(own.run.steps.find(step=>!finished(step)).callId));
  $('workflow-recovery-call').addEventListener('change',sync);
  $('workflow-recovery-form').addEventListener('submit',event=>{event.preventDefault();busy(event.submitter,()=>mutate(resolveStep));});
  $('workflow-handover-form').addEventListener('submit',event=>{event.preventDefault();busy(event.submitter,()=>mutate(()=>handover()));});
  action($('workflow-retry-start'),()=>mutate(()=>start(true)));action($('workflow-retry-handover'),()=>mutate(()=>handover(true)));
  return{refresh,profileChanged,reset,sync,useRecipe:(recipe,inputs)=>recipes.useRecipe(recipe,inputs),get hasActive(){return own.runs.some(run=>run.active);}};
}
