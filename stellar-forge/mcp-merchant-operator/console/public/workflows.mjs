// MIT. Saved native workflows in the original merchant operator interface.
export function createWorkflowPage({state,$,node,text,pretty,when,tag,properties,selectionList,action,busy,api,notice,uid,requireProfile,loadProfile,openCall,chooseTool,download,schedulePoll}){
  const own={profileId:null,definitions:[],runs:[],definition:null,steps:[],editorId:null,dirty:false,run:null,pendingRun:null,pendingHandover:null};
  const unchanged=(a,b)=>JSON.stringify(order(a))===JSON.stringify(order(b));
  function order(value){if(Array.isArray(value))return value.map(order);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,order(value[key])]));return value;}
  const owned=run=>run?.ownerWorkspaceId===state.host?.console.workspaceId;
  const finished=step=>['COMPLETE','RECOVERED'].includes(step.state);
  const invoke=async(path,body)=>api(path,{method:'POST',body});
  function parsed(value,label,kind='array'){
    let result;try{result=JSON.parse(value);}catch(error){throw new Error(label+' must be complete JSON: '+error.message);}
    if(kind==='array'?!Array.isArray(result):!result||typeof result!=='object'||Array.isArray(result))throw new Error(label+' must be a JSON '+kind+'.');
    return result;
  }
  function changed(){own.dirty=true;sync();}
  function readSteps(){
    return [...$('workflow-steps').querySelectorAll('[data-step-id]')].map(card=>{
      const source=own.steps.find(step=>step.id===card.dataset.stepId);
      return{...source,name:card.querySelector('[data-field="name"]').value,
        bindings:parsed(card.querySelector('[data-field="bindings"]').value,'Input mappings'),
        expect:parsed(card.querySelector('[data-field="expect"]').value,'Required result values')};
    });
  }
  function reset(){
    own.profileId=state.profile?.id??null;own.definitions=[];own.runs=[];own.definition=null;own.steps=[];own.editorId=null;
    own.dirty=false;own.run=null;own.pendingRun=null;own.pendingHandover=null;
    $('workflow-editor').hidden=true;$('workflow-run-detail').hidden=true;
    $('workflow-name').value='';$('workflow-inputs').value='{}';$('workflow-steps').replaceChildren();
    for(const id of ['workflow-run-json','workflow-run-events','workflow-run-inputs'])text($(id),'');
    for(const id of ['workflow-recipient-workspace','workflow-recipient-host','workflow-handover-note','workflow-recovery-note'])$(id).value='';
    renderLists();sync();
  }
  function profileChanged(){if(own.profileId!==(state.profile?.id??null))reset();refreshDraftPicker();sync();}
  function refreshDraftPicker(){
    const selected=$('workflow-add-draft').value;
    const drafts=(state.details?.drafts??[]).filter(draft=>!draft.id.startsWith('workflow-draft-'));
    $('workflow-add-draft').replaceChildren(new Option('Choose a saved request',''),...drafts.map(draft=>new Option(draft.name+' · r'+draft.revision+' · '+draft.tool,draft.id)));
    if(drafts.some(draft=>draft.id===selected))$('workflow-add-draft').value=selected;
  }
  function editor(definition=null){
    requireProfile();own.definition=definition;own.editorId=definition?.id??uid();own.steps=JSON.parse(JSON.stringify(definition?.steps??[]));own.dirty=!definition;
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
        const packet=await api('draft/'+encodeURIComponent(step.draftId)+'?revision='+step.draftRevision);
        return chooseTool(packet.draft.tool,{draft:packet.draft});
      });
      card.append(label,name,identity,open,node('p','Step identifier: '+step.id,'hint'));
      const mappingLabel=node('label','Input mappings (JSON)'),mappings=node('textarea');
      mappings.id='workflow-mappings-'+step.id;mappings.dataset.field='bindings';mappings.className='code-input workflow-json';mappings.rows=4;mappings.spellcheck=false;mappings.value=pretty(step.bindings);mappingLabel.htmlFor=mappings.id;mappings.addEventListener('input',changed);
      const expectationLabel=node('label','Required result values (JSON)'),expect=node('textarea');
      expect.id='workflow-expect-'+step.id;expect.dataset.field='expect';expect.className='code-input workflow-json';expect.rows=3;expect.spellcheck=false;expect.value=pretty(step.expect??[]);expectationLabel.htmlFor=expect.id;expect.addEventListener('input',changed);
      card.append(mappingLabel,mappings,expectationLabel,expect);$('workflow-steps').append(card);
    });
    if(!own.steps.length)$('workflow-steps').append(node('p','Add saved requests in the order this workflow should perform them.','empty'));
  }
  function addStep(){
    const draft=state.details?.drafts.find(value=>value.id===$('workflow-add-draft').value);
    if(!draft)throw new Error('Choose a saved request to add.');
    if(own.steps.length)own.steps=readSteps();
    let number=1;while(own.steps.some(step=>step.id==='step'+number))number++;
    own.steps.push({id:'step'+number,name:draft.name,draftId:draft.id,draftRevision:draft.revision,bindings:[],expect:[]});changed();renderSteps();
  }
  async function openDefinition(id,revision){
    const profileId=requireProfile().id;
    const packet=await api('workflow/'+encodeURIComponent(id)+(revision?'?revision='+revision:''));
    if(state.profile?.id!==profileId)return;
    editor(packet.definition);renderLists();
  }
  async function save(copy=false){
    const profile=requireProfile(),steps=readSteps();
    if(!steps.length)throw new Error('Add at least one saved request.');
    const id=copy?uid():own.editorId??uid();own.editorId=id;
    const body={id,profileId:profile.id,name:$('workflow-name').value,steps,
      ...(!copy&&own.definition?{expectedRevision:own.definition.revision}:{})};
    let packet;
    try{packet=await invoke('workflows',body);}
    catch(error){
      try{const retained=await api('workflow/'+encodeURIComponent(id));
        if(retained.definition.name===body.name.trim()&&unchanged(retained.definition.steps,steps))packet=retained;
      }catch{}
      if(!packet)throw error;
    }
    editor(packet.definition);await refresh();notice('Saved '+packet.definition.name+' · revision '+packet.definition.revision+'.');
  }
  async function start(){
    const profile=requireProfile(),definition=own.definition;
    if(!definition||own.dirty)throw new Error('Save the displayed workflow revision first.');
    const input=parsed($('workflow-inputs').value,'Workflow inputs','object');
    if(!own.pendingRun)own.pendingRun={id:uid(),profileId:profile.id,workflowId:definition.id,workflowRevision:definition.revision,
      expectedWorkflowSha256:definition.contentSha256,expectedHostFingerprint:state.host.configurationFingerprint,inputs:input};
    const intent=own.pendingRun;
    let result;
    try{result=await invoke('workflow-runs',intent);}
    catch(error){try{result=await api('workflow-run/'+encodeURIComponent(intent.id));}catch{}if(!result){if(error.status>=400&&error.status<500)own.pendingRun=null;throw error;}}
    own.pendingRun=null;await loadProfile();await openRun(result.run.id);
    notice((result.reused?'Reopened':'Started')+' workflow '+result.run.id+'.');schedulePoll();
  }
  async function openRun(id){
    const profileId=requireProfile().id,packet=await api('workflow-run/'+encodeURIComponent(id));
    if(state.profile?.id!==profileId)return;
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
    profileChanged();const profileId=state.profile?.id;if(!profileId)return;
    const packet=await api('workflows?'+new URLSearchParams({profile:profileId}));
    if(state.profile?.id!==profileId)return;
    own.definitions=packet.workflows;own.runs=packet.runs;
    if(own.run){
      const current=own.runs.find(value=>value.id===own.run.id);
      if(current&&(current.revision!==own.run.revision||current.active!==own.run.active||own.run.state==='WAITING'||own.run.state==='PAUSED'))
        await openRun(current.id);
    }
    renderLists();sync();
  }
  async function control(kind){
    const run=own.run;if(!run)throw new Error('Open a saved run.');
    const packet=await invoke('workflow-'+kind,{id:run.id,expectedRevision:run.revision});
    own.run=packet.run;await loadProfile();await openRun(run.id);schedulePoll();
    notice(kind==='pause'?'Pause requested after the current native request.':'Continuing the same saved workflow.');
  }
  async function resolveStep(){
    const run=own.run,step=run?.steps.find(value=>!finished(value));
    if(!step)throw new Error('Open an unfinished workflow step.');
    await invoke('workflow-resolve',{id:run.id,expectedRevision:run.revision,stepId:step.id,callId:$('workflow-recovery-call').value,note:$('workflow-recovery-note').value});
    $('workflow-recovery-note').value='';await loadProfile();await openRun(run.id);notice('The native recovery is attached to this step. Continue the saved run when ready.');
  }
  async function handover(){
    const run=own.run;if(!run)throw new Error('Open the paused run.');
    if(!own.pendingHandover)own.pendingHandover={id:run.id,expectedRevision:run.revision,handoverId:uid(),
      workspaceId:$('workflow-recipient-workspace').value.trim(),hostFingerprint:$('workflow-recipient-host').value.trim(),note:$('workflow-handover-note').value};
    const request=own.pendingHandover;
    try{await invoke('workflow-handover',request);}
    catch(error){
      let retained;try{retained=await api('workflow-run/'+encodeURIComponent(run.id));}catch{}
      if(!retained?.run.events.some(event=>event.kind==='HANDED_OVER'&&event.detail.id===request.handoverId)){
        if(error.status>=400&&error.status<500)own.pendingHandover=null;throw error;
      }
    }
    own.pendingHandover=null;
    await openRun(run.id);await download('export/'+encodeURIComponent(run.profileId),run.profileId+'-operator-profile.json');
    notice('Handed the saved run to '+request.workspaceId+' and exported its complete profile.');
  }
  function sync(){
    const selected=Boolean(state.profile),saved=Boolean(own.definition)&&!own.dirty,bound=state.profile?.hostFingerprint===state.host?.configurationFingerprint;
    $('new-workflow').disabled=!selected;$('workflow-add-step').disabled=!selected||!own.editorId;
    $('workflow-save').disabled=!selected||!own.editorId;$('workflow-copy').disabled=!selected||!own.editorId;
    $('workflow-start').disabled=!saved||!bound||Boolean(state.host?.console.closing);
    text($('workflow-start'),own.pendingRun?'Retry same start':'Run saved workflow');
    text($('workflow-edition'),own.definition?'Revision '+own.definition.revision+(own.dirty?' · unsaved changes':' · saved'):'New workflow');
    text($('workflow-definition-sha'),own.definition?.contentSha256??'');
    const run=own.run,can=Boolean(run)&&owned(run)&&run.state!=='COMPLETE';
    $('workflow-continue').disabled=!can||run.active||Boolean(state.host?.console.closing);
    $('workflow-pause').disabled=!can||run.pauseRequested;
    $('workflow-resolve').disabled=!can||run.active||!$('workflow-recovery-call').value;
    $('workflow-handover-submit').disabled=!can||run.active||!['PAUSED','WAITING'].includes(run.state);
    $('workflow-open-edition').disabled=!run;$('workflow-export').disabled=!run;
    $('workflow-open-original').disabled=!run?.steps.find(step=>!finished(step)&&step.draftRevision!==null);
  }
  action($('new-workflow'),()=>editor());
  action($('refresh-workflows'),async()=>{await loadProfile();if(own.run)await openRun(own.run.id);});
  action($('workflow-add-step'),addStep);action($('workflow-copy'),()=>save(true));action($('workflow-start'),start);
  $('workflow-form').addEventListener('submit',event=>{event.preventDefault();busy(event.submitter,()=>save());});
  $('workflow-name').addEventListener('input',changed);
  action($('workflow-continue'),()=>control('resume'));action($('workflow-pause'),()=>control('pause'));
  action($('workflow-open-edition'),()=>openDefinition(own.run.workflowId,own.run.workflowRevision));
  action($('workflow-export'),()=>download('export/'+encodeURIComponent(own.run.profileId),own.run.profileId+'-operator-profile.json'));
  action($('workflow-open-original'),()=>openCall(own.run.steps.find(step=>!finished(step)).callId));
  $('workflow-recovery-call').addEventListener('change',sync);
  $('workflow-recovery-form').addEventListener('submit',event=>{event.preventDefault();busy(event.submitter,resolveStep);});
  $('workflow-handover-form').addEventListener('submit',event=>{event.preventDefault();busy(event.submitter,handover);});
  return{refresh,profileChanged,reset,sync,get hasActive(){return own.runs.some(run=>run.active);}};
}
