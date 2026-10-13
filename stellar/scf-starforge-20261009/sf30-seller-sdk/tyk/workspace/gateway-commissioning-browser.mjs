// MIT. Complete source intake and two-Gateway operation through the existing saved rollout controls.
import { readGatewayDraft, saveGatewayDraft, listGatewayDrafts } from './gateway-commissioning-drafts.mjs';
export function createGatewayCommissioningBrowser({$,el,button,detail,table,read,action,run,refresh,notice,tab,showRollout,state}){
  const form=$('gateway-course-form'),editor=$('gateway-entry-form'),fmt=v=>JSON.stringify(v,null,2),MAX=16*1024*1024;
  let entries=[],editing=null,entryDirty=false,workshare=null,workspace=null,draftRevision=0,draftError=null,timer=null,
    saving=Promise.resolve(),epoch=0,opened=null;
  const reviewDrafts=new Map(),controls=(...nodes)=>{const n=el('div',undefined,'actions');n.append(...nodes);return n;};
  const label=(title,input)=>{const n=el('label',title);n.append(input);return n;};
  const input=(name,value='',type='text')=>{const n=el('input');n.name=name;n.type=type;n.value=value;return n;};
  const area=(value,rows=4)=>{const n=el('textarea');n.value=value;n.rows=rows;n.spellcheck=false;return n;};
  const key=()=>location.origin+':'+workspace+':gateway-intake';
  function download(name,value,type='application/json'){
    const blob=new Blob([typeof value==='string'?value:fmt(value)+'\n'],{type}),url=URL.createObjectURL(blob),a=el('a');
    a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  async function fileValue(file,limit=24*1024*1024){
    if(file.size>limit)throw new Error(file.name+' exceeds '+limit.toLocaleString()+' bytes.');
    const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
    for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
    return {name:file.name,mediaType:file.type||'application/octet-stream',contentBase64:btoa(binary)};
  }
  const completeText=async file=>{if(file.size>MAX)throw new Error('The complete source exceeds 16 MiB.');
    return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());};
  function sourceButton(file){return button('Download '+file.name,()=>{
    const bytes=Uint8Array.from(atob(file.content),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:file.mediaType})),a=el('a');
    a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  });}
  function fields(f){return Object.fromEntries([...f.elements].filter(n=>n.name&&n.type!=='file'&&n.type!=='submit')
    .map(n=>[n.name,n.type==='checkbox'?n.checked:n.value]));}
  function fill(f,values){for(const [name,value]of Object.entries(values??{})){const n=f.elements.namedItem(name);if(n&&n.type!=='file'){
    if(n.type==='checkbox')n.checked=Boolean(value);else n.value=value;}}}
  function snapshot(){return {schema:'stellar-forge.tyk-gateway-intake-draft.v1',workspaceId:workspace,
    fields:fields(form),entries,editor:fields(editor),editing,entryDirty,workshare};}
  function status(){ $('gateway-draft-status').textContent=draftError?'Draft not saved: '+draftError.message:
    draftRevision?'Complete draft saved locally · revision '+draftRevision:'Draft stays in this browser until saved as a commissioning record.'; }
  function persist(){
    clearTimeout(timer);if(!workspace||draftError?.code==='GATEWAY_DRAFT_CONFLICT')return saving;
    const value=structuredClone(snapshot()),boundKey=key(),boundEpoch=epoch;
    saving=saving.catch(()=>{}).then(async()=>{if(boundEpoch!==epoch)return;
      try{const result=await saveGatewayDraft(boundKey,value,draftRevision);if(boundEpoch===epoch){draftRevision=result.revision;draftError=null;status();}}
      catch(error){if(boundEpoch===epoch){draftError=error;status();}}});
    return saving;
  }
  function changed(){if(draftError?.code!=='GATEWAY_DRAFT_CONFLICT')draftError=null;clearTimeout(timer);timer=setTimeout(persist,350);}
  function applyDraft(value){fill(form,value?.fields);entries=structuredClone(value?.entries??[]);editing=value?.editing??null;
    entryDirty=Boolean(value?.entryDirty);workshare=value?.workshare??null;fill(editor,value?.editor);renderEntries();showWorkshare();}
  async function reopen(){
    clearTimeout(timer);await saving;const saved=await readGatewayDraft(key());epoch++;draftRevision=saved?.revision??0;draftError=null;
    if(saved)applyDraft(saved.value);status();
  }
  $('gateway-save-draft').addEventListener('click',()=>run('Saving complete local intake',async()=>{await persist();if(draftError)throw draftError;notice('Complete local intake saved.');}));
  $('gateway-reopen-draft').addEventListener('click',()=>run('Reopening saved Gateway intake',reopen));
  $('gateway-download-draft').addEventListener('click',()=>download('gateway-intake-working-copy.json',snapshot()));
  $('gateway-intake-file').addEventListener('change',event=>{const file=event.target.files?.[0];if(!file)return;
    run('Reading complete Gateway intake',async()=>{const value=JSON.parse(await completeText(file));
      if(value.schema!=='stellar-forge.tyk-gateway-intake-draft.v1'||!Array.isArray(value.entries))throw new Error('Select a complete Gateway intake draft.');
      if(value.entries.length>200)throw new Error('Use at most 200 source entries.');
      applyDraft(value);changed();event.target.value='';notice('Full draft loaded. Select this workspace’s named targets and review every original source before saving.');});
  });
  form.addEventListener('input',changed);form.addEventListener('change',changed);
  editor.addEventListener('input',()=>{entryDirty=true;changed();});
  editor.addEventListener('change',()=>{entryDirty=true;changed();});
  $('gateway-definition-file').addEventListener('change',event=>{const file=event.target.files?.[0];if(!file)return;
    run('Reading complete native definition',async()=>{editor.elements.definitionText.value=await completeText(file);
      entryDirty=true;changed();event.target.value='';notice('Complete original source loaded. Save this source entry to include it.');});});
  form.elements.workshare.addEventListener('change',event=>{const file=event.target.files?.[0];if(!file)return;
    run('Reading complete workshare source',async()=>{workshare=await fileValue(file);showWorkshare();changed();event.target.value='';});});
  function showWorkshare(){const box=$('gateway-workshare');box.replaceChildren();if(workshare)box.append(
    el('span',workshare.name),button('Remove workshare',()=>{workshare=null;showWorkshare();changed();}));}
  function blankEntry(){editor.reset();editing=null;entryDirty=false;$('gateway-entry-title').textContent='Add complete API source';}
  $('gateway-new-entry').addEventListener('click',()=>{if(entryDirty){notice('Save the edited source entry before opening another.');return;}blankEntry();changed();});
  function renderEntries(){
    table('gateway-entry-list',['Source','Staging request','Production request','Format','Complete bytes',''],entries.map(entry=>[
      entry.label||entry.key,entry.selection.operation,entry.productionOperation,entry.selection.kind,
      new TextEncoder().encode(entry.selection.definitionText).length.toLocaleString(),
      controls(button('Edit full source',()=>{if(entryDirty&&editing!==entry.key){notice('Save the edited source before opening another.');return;}
        editing=entry.key;fill(editor,{key:entry.key,label:entry.label,operation:entry.selection.operation,productionOperation:entry.productionOperation,
          kind:entry.selection.kind,apiId:entry.selection.apiId??'',definitionText:entry.selection.definitionText,query:entry.selection.query?fmt(entry.selection.query):''});
        entryDirty=false;$('gateway-entry-title').textContent='Edit complete source · '+entry.key;changed();}),
        button('Remove source',()=>{if(entryDirty){notice('Save the edited source first.');return;}entries=entries.filter(row=>row.key!==entry.key);
          if(editing===entry.key)blankEntry();renderEntries();changed();}))]));
    $('gateway-source-count').textContent=entries.length+' complete API sources · '+entries.reduce((n,e)=>n+new TextEncoder().encode(e.selection.definitionText).length,0).toLocaleString()+' bytes';
  }
  editor.addEventListener('submit',event=>{event.preventDefault();
    try{const v=fields(editor);if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(v.key))throw new Error('Use a stable source key with letters, digits, dots, dashes or underscores.');
      if(entries.some(row=>row.key===v.key&&row.key!==editing))throw new Error('This source key is already used.');
      if(!v.definitionText.trim())throw new Error('Supply the complete native definition.');
      const selection={operation:v.operation,kind:v.operation==='import'?'oas':v.kind,definitionText:v.definitionText,contentType:'application/json',
        ...(v.apiId?{apiId:v.apiId}:{}),...(v.query.trim()?{query:JSON.parse(v.query)}:{})};
      const next=entries.filter(row=>row.key!==editing);next.push({key:v.key,label:v.label||v.key,productionOperation:v.productionOperation,selection});
      if(next.length>200||next.reduce((n,e)=>n+new TextEncoder().encode(e.selection.definitionText).length,0)>MAX)throw new Error('Select at most 200 APIs and 16 MiB of complete definition source.');
      entries=next;blankEntry();renderEntries();changed();notice('Complete source entry saved in the intake.');
    }catch(error){notice(error.message);}
  });
  form.addEventListener('submit',event=>{event.preventDefault();
    if(entryDirty){notice('Save the edited complete source entry before freezing this course.');return;}
    const v=fields(form),args={stagingConnectionId:v.stagingConnectionId,productionConnectionId:v.productionConnectionId,label:v.label,
      customer:v.customer,operator:v.operator,entries:structuredClone(entries),checkNames:v.checkNames.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),
      reload:v.scope==='group'?{scope:'group'}:{scope:'node',block:v.block},...(workshare?{workshare:structuredClone(workshare)}:{})};
    run('Saving complete Gateway commissioning',async signal=>{await persist();
      if(draftError)throw draftError;
      const record=await action('createGatewayCommissioning',args,'Save complete Gateway commissioning',{signal});
      await refresh();await open(record.id);notice('The complete source edition and both Gateway targets are saved.');});
  });
  async function updateTargets(targets){
    const choices=targets.filter(row=>row.connection.kind==='gateway');
    for(const name of ['stagingConnectionId','productionConnectionId']){const select=form.elements[name],prior=select.value;select.replaceChildren(el('option','Select Gateway'));
      select.options[0].value='';for(const row of choices){const option=el('option',row.connection.label+' · '+row.connection.baseUrl);option.value=row.id;select.append(option);}
      if(choices.some(row=>row.id===prior))select.value=prior;}
    $('gateway-target-help').hidden=choices.length>=2;
    form.querySelector('button[type="submit"]').disabled=choices.length<2;
    if(workspace!==state.workspace.workspaceId){workspace=state.workspace.workspaceId;epoch++;draftRevision=0;
      try{await reopen();}catch(error){draftError=error;status();}}
    renderEntries();
  }
  async function open(id){const value=await read('readGatewayCommissioning',{id});opened=id;tab('gateway-commissioning');await render(value);return value;}
  async function change(method,args,title,after,before){return run(title,async signal=>{
    if(before)await before();const record=await action(method,args,title,{signal});await refresh();const value=await open(record.id);if(after)await after(value);notice(title+' complete.');});}
  function showOriginal(value,phase,row){run('Opening submitted and active API source',async()=>{
    const original=value.source.entries.find(entry=>entry.key===row.key),capture=value.observations[phase].capture;
    const actual=await read('readDefinition',{captureId:capture.id,revision:capture.revision,apiId:row.apiId});
    const box=$('gateway-course-source');box.hidden=false;box.replaceChildren(el('h3',row.label+' · '+phase),
      detail('Actual native API ID',row.apiId),detail('Submitted source SHA-256',original.sourceSha256),
      detail('Active source SHA-256',actual.definition.sha256));
    for(const [name,text]of [['Submitted original source',original.selection.definitionText],['Active native source',actual.definition.definitionText]]){
      const body=area(text,18);body.readOnly=true;box.append(label(name,body),button('Download '+name,()=>download(row.key+'-'+(name.startsWith('Submitted')?'submitted':'active')+'.json',text)));}
    box.append(button('Close source',()=>{box.hidden=true;}));box.scrollIntoView({block:'start'});
  });}
  async function render(value){
    const {record,progress}=value,panel=$('gateway-course-current');panel.hidden=false;panel.replaceChildren(
      el('h3',record.value.label),detail('Saved course',record.id+' · revision '+record.revision),
      detail('Progress',progress.summary.completed+' of '+progress.summary.steps+' steps · '+progress.state),
      detail('Staging Gateway',record.value.targets.staging.connection.baseUrl),
      detail('Production Gateway',record.value.targets.production.connection.baseUrl));
    panel.append(controls(button('Refresh Gateway progress',()=>run('Reading saved Gateway course',()=>open(record.id))),
      button('Download complete Gateway operating plan',()=>download('gateway-'+record.id+'-plan.json',value.plan)),
      button('Download complete Gateway course',()=>download('gateway-'+record.id+'-course.json',value)),
      button('Open complete Gateway handover',()=>{tab('handover');$('export-form').elements.label.value=record.value.label+' · full history';})));
    if(value.workshare)panel.append(el('h4','Complete original workshare'),sourceButton(value.workshare.source),detail('Workshare SHA-256',value.workshare.sourceSha256));
    if(record.value.pending)panel.append(el('p','The original request is retained. Recover original request above to continue it.','hint'));
    const list=el('div',undefined,'table-wrap');list.id='gateway-course-steps';panel.append(list);
    table(list.id,['Step','Status','Native state',''],progress.steps.map(step=>{
      const native=value.rollouts[step.id],buttons=controls();
      if(native)buttons.append(button('Open Gateway native review',()=>run('Opening original native request',async()=>showRollout(await read('getRecord',{kind:'rollout',id:native.id})))));
      const superseded=step.phase==='production'&&native?.value.phase==='PREPARED'&&!native.value.dispatchedAt&&
        native.value.gatewayCommissioning?.sourceContextSha256!==value.reviewContexts.staging?.sha256;
      if(step.type==='native'&&step.ready&&(!native||['STALE','PREPARE_FAILED','INTERRUPTED'].includes(native.value.phase)||superseded)){
        const acknowledged=input('acknowledgeUncertain','','checkbox');
        if(step.uncertainWrites.length)buttons.append(label('I inspected the original uncertain writes: '+step.uncertainWrites.join(', '),acknowledged));
        buttons.append(button(native?'Prepare Gateway replacement':'Prepare Gateway request',()=>{
          if(step.uncertainWrites.length&&!acknowledged.checked){notice('Inspect and acknowledge the listed original uncertain requests before this reload.');return;}
          change('prepareGatewayCommissioningStep',{id:record.id,expectedRevision:record.revision,stepId:step.id,acknowledgeUncertain:acknowledged.checked},
            'Prepare '+step.title,async current=>{const binding=current.record.value.bindings[step.id];if(binding)await showRollout(await read('getRecord',{kind:'rollout',id:binding.id}));});
        }));
      }
      if(step.type==='capture'&&step.ready)buttons.append(button('Capture active Gateway portfolio',()=>change('refreshGatewayCommissioning',
        {id:record.id,expectedRevision:record.revision,phase:step.phase},'Capture '+step.phase+' active source')));
      return [step.title,step.complete?'Complete':step.ready?'Ready':'Awaiting original work',step.nativeState??'—',buttons];
    }));
    for(const phase of ['staging','production']){
      const observation=value.observations[phase];if(!observation)continue;
      const section=el('section');section.append(el('h3',phase==='staging'?'Accepted-source staging review':'Production source and operation review'));
      const node=el('div',undefined,'table-wrap');node.id='gateway-'+phase+'-definitions';section.append(node);panel.append(section);
      table(node.id,['API','Format','Source SHA-256','Native evidence',''],observation.apis.map(row=>[row.apiId,row.kind,el('code',row.sha256),
        row.transformationRequired?'Native import: explicit transformation review required':'Complete native correspondence',
        button('Open submitted and active source',()=>showOriginal(value,phase,row))]));
      const productionStarted=Object.entries(value.rollouts).some(([id,r])=>id.startsWith('production')&&r.value.dispatchedAt);
      if(phase==='production'||!productionStarted)section.append(button('Recapture '+phase+' active source',()=>change('refreshGatewayCommissioning',
        {id:record.id,expectedRevision:record.revision,phase},'Recapture '+phase+' source')));
      const context=value.reviewContexts[phase],step=progress.steps.find(row=>row.id===(phase==='staging'?'stage':'production')+'-review');
      if(context&&(step.ready||step.complete))await renderReview(value,phase,context,section,phase==='staging'&&productionStarted);
    }
    if(!value.observations.staging&&value.captures.staging)panel.append(el('p','The staging capture is retained, but one or more active definitions do not yet correspond to the original requests. Open native review and read back those exact requests; do not resend them.','hint'));
    const history=el('details',undefined,'panel');history.append(el('summary','Complete Gateway operating history and supporting files'));
    for(const revision of value.plan.revisions){const section=el('section');section.append(el('h4','Edition '+revision.revision+' · '+revision.savedAt));
      for(const step of revision.steps.filter(row=>row.recordedResult||row.files?.length)){const row=el('details');row.append(el('summary',step.title+' · '+step.status));
        if(step.recordedResult)row.append(el('pre',step.recordedResult));for(const file of step.files??[])row.append(sourceButton(file));section.append(row);}history.append(section);}
    panel.append(history);
  }
  async function renderReview(value,phase,context,panel,locked){
    const {record}=value,key=location.origin+':'+workspace+':gateway-review:'+record.id+':'+phase+':'+context.sha256,prior=record.value.reviews[phase];
    const currentPrior=prior?.contextSha256===context.sha256?prior:null;
    if(locked){panel.append(el('p','Production uses this frozen staging acceptance. All original checks and files remain in the operating history.'));return;}
    let retained=reviewDrafts.get(key);if(!retained){let saved=null,error=null;try{saved=await readGatewayDraft(key);}catch(value){error=value;}
      const draft=saved?.value?.contextSha256===context.sha256?saved.value.draft:{reviewer:prior?.reviewer??record.value.operator,note:currentPrior?.note??'',
      checks:currentPrior?.checks??context.context.observation.apis.flatMap(api=>record.value.checkNames.map(name=>({apiId:api.apiId,name,outcome:'',note:''}))),
      transformations:currentPrior?.transformations??context.context.observation.apis.filter(api=>api.transformationRequired).map(api=>({key:api.key,apiId:api.apiId,
        submittedSha256:api.submittedSha256,observedSha256:api.sha256,decision:'',note:''})),files:currentPrior?(record.value.supportingFiles[phase]??[]).map(file=>({name:file.name,mediaType:file.mediaType,contentBase64:file.content,note:file.note})):[]};
      retained={draft,revision:saved?.revision??0,error,tail:Promise.resolve(),timer:null,epoch:0};reviewDrafts.set(key,retained);}
    const draft=retained.draft;
    const form=el('form');form.id='gateway-'+phase+'-review';form.append(el('h4',phase==='staging'?'Record staging acceptance':'Record production acceptance'),
      detail('Exact review context',context.sha256));panel.append(form);
    const draftStatus=el('p',undefined,'hint');form.append(draftStatus);
    function showDraftStatus(){draftStatus.textContent=retained.error?'Review draft not saved: '+retained.error.message:
      retained.revision?'Complete review draft saved locally · revision '+retained.revision:'Observed results and files will be saved as a complete review draft.';}
    function saveReview(){clearTimeout(retained.timer);if(retained.error?.code==='GATEWAY_DRAFT_CONFLICT')return retained.tail;
      const value={contextSha256:context.sha256,context:context.context,draft:structuredClone(draft)},generation=retained.epoch;
      retained.tail=retained.tail.catch(()=>{}).then(async()=>{if(generation!==retained.epoch)return;
        try{const saved=await saveGatewayDraft(key,value,retained.revision);retained.revision=saved.revision;retained.error=null;}
        catch(error){retained.error=error;}showDraftStatus();});return retained.tail;}
    function reviewChanged(){if(retained.error?.code!=='GATEWAY_DRAFT_CONFLICT')retained.error=null;
      clearTimeout(retained.timer);retained.timer=setTimeout(saveReview,350);}
    form.addEventListener('input',reviewChanged);form.addEventListener('change',reviewChanged);showDraftStatus();
    form.append(controls(button('Save '+phase+' review draft',()=>run('Saving complete local review',async()=>{await saveReview();if(retained.error)throw retained.error;notice('Complete local review draft saved.');})),button('Download working '+phase+' review',()=>download('gateway-'+record.id+'-'+phase+'-working-review.json',
      {contextSha256:context.sha256,context:context.context,draft})),
      button('Reopen saved '+phase+' review',()=>run('Reopening complete saved review',async()=>{
        clearTimeout(retained.timer);await retained.tail;retained.epoch++;reviewDrafts.delete(key);await open(record.id);}))));
    const old=el('details');old.append(el('summary','Saved source editions of this operational review'));form.append(old);
    try{for(const saved of await listGatewayDrafts(location.origin+':'+workspace+':gateway-review:'+record.id+':'+phase+':')){
      old.append(button('Open review source '+saved.value.contextSha256.slice(0,12)+' · revision '+saved.revision,()=>{
        const box=$('gateway-course-source');box.hidden=false;const text=fmt(saved.value),body=area(text,18);body.readOnly=true;
        box.replaceChildren(el('h3','Saved operational review source'),detail('Exact review context',saved.value.contextSha256),body,
          button('Download complete saved review',()=>download('gateway-review-'+saved.value.contextSha256+'.json',saved.value)),
          button('Close source',()=>{box.hidden=true;}));box.scrollIntoView({block:'start'});
      }));}
    }catch(error){old.append(el('p','Saved review editions could not be read: '+error.message));}
    const reviewer=input('reviewer',draft.reviewer??''),note=area(draft.note);reviewer.required=true;reviewer.maxLength=300;note.required=true;note.maxLength=20000;
    reviewer.oninput=()=>draft.reviewer=reviewer.value;note.oninput=()=>draft.note=note.value;
    form.append(label('Reviewer',reviewer),label('Acceptance and actual evidence',note));
    const matrix=el('div',undefined,'table-wrap');matrix.id='gateway-'+phase+'-checks';form.append(matrix);
    table(matrix.id,['API','Check','Result','Observed result'],draft.checks.map(row=>{
      const select=el('select');select.required=true;select.setAttribute('aria-label',row.apiId+' · '+row.name+' · result');
      for(const [value,title]of [['','Select result'],['passed','Passed'],['failed','Failed']]){const option=el('option',title);option.value=value;select.append(option);}
      select.value=row.outcome;select.onchange=()=>row.outcome=select.value;
      const observed=area(row.note,3);observed.required=true;observed.maxLength=20000;observed.setAttribute('aria-label',row.apiId+' · '+row.name+' · observed result');
      observed.oninput=()=>row.note=observed.value;return [el('code',row.apiId),row.name,select,observed];
    }));
    for(const row of draft.transformations){const group=el('fieldset');group.append(el('legend','Native OpenAPI transformation · '+row.apiId),
      el('p','Open both complete sources above. Acceptance binds the actual provider-assigned ID and both source hashes.'),
      detail('Submitted SHA-256',row.submittedSha256),detail('Active SHA-256',row.observedSha256));
      const select=el('select');select.required=true;select.setAttribute('aria-label',row.apiId+' · transformation decision');
      for(const [value,title]of [['','Select decision'],['accepted','Accept native transformation'],['changes-requested','Changes requested']]){
        const option=el('option',title);option.value=value;select.append(option);}select.value=row.decision;select.onchange=()=>row.decision=select.value;
      const observed=area(row.note,3);observed.required=true;observed.maxLength=20000;observed.setAttribute('aria-label',row.apiId+' · transformation review');
      observed.oninput=()=>row.note=observed.value;group.append(label('Transformation decision',select),label('Source review',observed));form.append(group);}
    const files=input('files','','file');files.multiple=true;const fileList=el('div');let reading=false;
    function showFiles(){fileList.replaceChildren(...draft.files.map((file,index)=>controls(el('span',file.name),button('Remove file',()=>{draft.files.splice(index,1);showFiles();reviewChanged();}))));}
    const save=el('button','Save '+phase+' operational review');save.type='submit';
    files.onchange=()=>run('Reading complete operational evidence',async()=>{reading=true;save.disabled=true;
      try{if(draft.files.length+files.files.length>50)throw new Error('Use at most fifty complete supporting files.');
        const captured=[];for(const file of files.files)captured.push(await fileValue(file));draft.files.push(...captured);files.value='';showFiles();reviewChanged();}
      finally{reading=false;save.disabled=false;}});
    const consent=input('reviewed','','checkbox');consent.required=true;
    form.append(label('Complete supporting files',files),fileList,label('I inspected these exact active definitions and recorded each actual check.',consent),save);showFiles();
    form.onsubmit=event=>{event.preventDefault();if(reading)return;
      const args={id:record.id,expectedRevision:record.revision,phase,contextSha256:context.sha256,...structuredClone(draft)};
      change('recordGatewayCommissioningReview',args,'Save '+phase+' operational review',undefined,async()=>{await saveReview();if(retained.error)throw retained.error;});};
  }
  return {open,updateTargets,get opened(){return opened;}};
}
