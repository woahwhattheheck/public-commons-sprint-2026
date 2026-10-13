// MIT. Complete cohort commissioning inside the original industrial Tyk workspace.
export function createCommissioningBrowser({$,el,button,detail,table,read,action,run,refresh,notice,tab,showRollout,state}) {
  let opened=null;const drafts=new Map();
  const fmt=value=>JSON.stringify(value,null,2);
  const controls=(...nodes)=>{const row=el('div',undefined,'actions');row.append(...nodes);return row;};
  const label=(title,input)=>{const node=el('label',title);node.append(input);return node;};
  const input=(name,value='',type='text')=>{const node=el('input');node.name=name;node.type=type;node.value=value;return node;};
  const area=(name,value='',rows=3)=>{const node=el('textarea');node.name=name;node.rows=rows;node.value=value;return node;};
  function download(name,value,type='application/json'){
    const blob=new Blob([typeof value==='string'?value:fmt(value)+'\n'],{type}),url=URL.createObjectURL(blob),a=el('a');
    a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  function fileDownload(file){
    return button(file.name+' · '+file.bytes.toLocaleString()+' bytes',()=>{
      const bytes=Uint8Array.from(atob(file.content),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:file.mediaType})),a=el('a');
      a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
    });
  }
  const form=$('commissioning-form');
  form.addEventListener('submit',event=>{event.preventDefault();run('Saving complete cohort commissioning',async signal=>{
    const selected=await read('getRecord',{kind:'cohort',id:form.elements.cohortId.value});
    const args={cohortId:selected.id,cohortRevision:selected.revision,label:form.elements.label.value,
      customer:form.elements.customer.value,operator:form.elements.operator.value,
      checkNames:form.elements.checkNames.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),
      abortOnFailure:form.elements.abortOnFailure.checked,overrideStaged:form.elements.overrideStaged.checked};
    const file=form.elements.workshare.files[0];
    if(file){
      if(file.size>24*1024*1024)throw new Error(file.name+' exceeds 24 MiB.');
      const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
      for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
      args.workshare={name:file.name,mediaType:file.type||'application/octet-stream',contentBase64:btoa(binary)};
    }
    const record=await action('createCommissioning',args,'Save complete cohort commissioning',{signal});
    await refresh();await open(record.id);notice('Complete cohort commissioning saved.');
  });});
  async function updateCohorts(records){
    const select=form.elements.cohortId,prior=select.value;select.replaceChildren();
    const choices=records.filter(item=>item.summary?.classic===item.summary?.apis&&item.summary?.apis>0&&state.workspace.connections.some(target=>target.id===item.connectionId&&target.connection.kind==='dashboard'));
    for(const record of choices){const option=el('option',record.label+' · '+record.summary.apis+' APIs');option.value=record.id;select.append(option);}
    if(choices.some(row=>row.id===prior))select.value=prior;
    form.querySelector('button[type="submit"]').disabled=!choices.length;
    $('commissioning-empty').hidden=Boolean(choices.length);
  }
  async function open(id,{navigate=true}={}){
    const value=await read('readCommissioning',{id});opened=id;
    if(navigate)tab('commissioning');
    render(value);return value;
  }
  async function change(method,args,labelText,after){
    return run(labelText,async signal=>{
      const record=await action(method,args,labelText,{signal});await refresh();
      const current=await open(record.id);
      if(after)await after(current);notice(labelText+' complete.');
    });
  }
  function showSource(value,phase,row){
    run('Reading complete native source',async()=>{
      const observation=phase==='final'?value.finalObservation:value.observation;
      const result=await read('readDefinition',{captureId:observation.capture.id,revision:observation.capture.revision,apiId:row.stagedApiId});
      const box=$('commissioning-source');box.hidden=false;box.replaceChildren(el('h3','Complete original '+row.stagedApiId),
        detail('SHA-256',result.definition.sha256));
      const source=area('commissioningSource',result.definition.definitionText,18);source.readOnly=true;source.spellcheck=false;box.append(source,
        controls(button('Download original definition',()=>download(row.stagedApiId+'.json',result.definition.definitionText)),
          button('Close source',()=>{box.hidden=true;})));box.scrollIntoView({block:'start'});
    });
  }
  function render(value){
    const {record,progress,cohort}=value,panel=$('commissioning-current');panel.hidden=false;panel.replaceChildren();
    panel.append(el('h3',record.value.label),detail('Customer',record.value.customer||'—'),
      detail('Original cohort',cohort.value.label+' · '+cohort.value.apiIds.length+' APIs'),
      detail('Progress',progress.summary.completed+' of '+progress.summary.steps+' steps · '+progress.state),
      detail('Saved commissioning',record.id+' · revision '+record.revision));
    if(value.workshare)panel.append(el('h3','Complete workshare source'),
      el('p','Original scope and acceptance material bound to this cohort, Dashboard configuration and operational checks.'),
      controls(fileDownload(value.workshare.source)),detail('Source SHA-256',value.workshare.sourceSha256),
      detail('Source target configuration',value.workshare.configurationSha256));
    if(record.value.pending)panel.append(el('p','The original commissioning request is retained. Use Recover original request to finish that same operation.','hint'));
    panel.append(controls(button('Refresh saved progress',()=>run('Reading saved commissioning progress',()=>open(record.id))),
      button('Download complete operating plan',()=>download('tyk-'+record.id+'-operating-plan.json',value.plan)),
      button('Download complete commissioning record',()=>download('tyk-'+record.id+'-commissioning.json',value)),
      button('Open complete workspace handover',()=>{tab('handover');$('export-form').elements.label.value=record.value.label+' · complete handover';})));
    const stepTable=el('div',undefined,'table-wrap');stepTable.id='commissioning-step-table';panel.append(stepTable);
    table(stepTable.id,['Step','Status','Original request',''],progress.steps.map(step=>{
      const buttons=controls(),native=value.rollouts[step.id];
      if(native)buttons.append(button('Open native review',()=>run('Opening original native rollout',async()=>showRollout(await read('getRecord',{kind:'rollout',id:native.id})))));
      const superseded=step.id==='promotion'&&native?.value.phase==='PREPARED'&&!native.value.dispatchedAt&&
        native.value.commissioning?.reviewContextSha256!==value.reviewContexts['production-review']?.sha256;
      if(step.ready&&['conversion','staging','promotion'].includes(step.id)&&(!native||['PREPARE_FAILED','STALE','INTERRUPTED'].includes(native.value.phase)||superseded))
        buttons.append(button(native?'Prepare reviewed replacement':'Prepare native request',()=>change('prepareCommissioningStep',
          {id:record.id,expectedRevision:record.revision,stepId:step.id},'Prepare '+step.title,async current=>{
            const binding=current.record.value.bindings[step.id];if(binding)await showRollout(await read('getRecord',{kind:'rollout',id:binding.id}));
          })));
      if(step.ready&&['staged-capture','final-capture'].includes(step.id))buttons.append(button('Capture complete current portfolio',
        ()=>change('refreshCommissioning',{id:record.id,expectedRevision:record.revision,phase:step.id==='staged-capture'?'staged':'final'},'Capture complete current portfolio')));
      return [step.title,step.complete?'Complete':step.ready?'Ready':'Awaiting prior steps',step.nativeState??'—',buttons];
    }));
    for(const [phase,observation] of [['staged',value.observation],['final',value.finalObservation]]){
      if(!observation)continue;
      const section=el('section');section.append(el('h3',phase==='staged'?'Current staged definitions':'Promoted definitions'));
      const box=el('div',undefined,'table-wrap');box.id='commissioning-'+phase+'-sources';section.append(box);panel.append(section);
      table(box.id,['Canonical API','Native definition','SHA-256',''],observation.apis.map(row=>[row.apiId,row.stagedApiId,
        el('code',row.sha256),button('Open complete source',()=>showSource(value,phase,row))]));
      if(phase==='staged'&&!value.rollouts.promotion?.value.dispatchedAt)section.append(button('Recapture staged definitions',
        ()=>change('refreshCommissioning',{id:record.id,expectedRevision:record.revision,phase:'staged'},'Capture current staged definitions')));
    }
    for(const stepId of ['conversion-review','production-review']){
      const step=progress.steps.find(row=>row.id===stepId),context=value.reviewContexts[stepId];
      if(!context||(!step.ready&&!step.complete))continue;
      renderReview(value,stepId,context,panel);
    }
    const history=el('details',undefined,'panel');history.append(el('summary','Complete operating history and supporting files'));
    for(const edition of value.plan.revisions){
      const section=el('section');section.append(el('h3','Edition '+edition.revision+' · '+edition.savedAt));
      for(const step of edition.steps.filter(step=>step.recordedResult||step.files?.length)){
        const block=el('details');block.append(el('summary',step.title+' · '+step.status));
        if(step.recordedResult)block.append(el('pre',step.recordedResult));
        if(step.files?.length)block.append(controls(...step.files.map(fileDownload)));section.append(block);
      }history.append(section);
    }panel.append(history);
  }
  function renderReview(value,stepId,context,panel){
    const {record,cohort}=value,production=stepId==='production-review',
      key=record.id+':'+stepId+':'+context.sha256;
    const prior=record.value.reviews[stepId];
    let draft=drafts.get(key);
    if(!draft){draft={reviewer:prior?.reviewer??record.value.operator??'',note:prior?.note??'',
      checks:production?cohort.value.apiIds.flatMap(apiId=>record.value.checkNames.map(name=>({apiId,name,outcome:'',note:''}))):[],files:[]};drafts.set(key,draft);}
    const section=el('section',undefined,'panel');section.id='commissioning-'+stepId;panel.append(section);
    section.append(el('h3',production?'Production acceptance':'Native conversion acceptance'),
      el('p',production?'Record the selected operational checks against every current staged API. Attach complete logs, request/response samples or other supporting files.':
        'Open the original conversion review above and inspect the complete Classic and converted definitions for every API.'),
      detail('Review source identity',context.sha256));
    const following=production?value.rollouts.promotion:value.rollouts.staging;
    if(following?.value.dispatchedAt){section.append(el('p','This acceptance and its supporting material are retained in the operating history.'));return;}
    const form=el('form'),fields=el('div',undefined,'fields'),reviewer=input('reviewer',draft.reviewer),note=area('note',draft.note);
    reviewer.required=true;reviewer.maxLength=300;note.required=true;note.maxLength=20000;
    reviewer.addEventListener('input',()=>draft.reviewer=reviewer.value);note.addEventListener('input',()=>draft.note=note.value);
    fields.append(label('Reviewer',reviewer),label('Review and acceptance note',note));form.append(fields);
    if(production){
      const tableNode=el('div',undefined,'table-wrap');tableNode.id='commissioning-checks';form.append(tableNode);section.append(form);
      table(tableNode.id,['API','Operational check','Result','Observed result and evidence'],draft.checks.map(row=>{
        const select=el('select');select.required=true;select.setAttribute('aria-label',row.apiId+' · '+row.name+' · result');
        for(const [value,title]of [['','Select result'],['passed','Passed'],['failed','Failed']]){const option=el('option',title);option.value=value;select.append(option);}
        select.value=row.outcome;select.addEventListener('change',()=>row.outcome=select.value);
        const observed=area('checkNote',row.note,3);observed.required=true;observed.maxLength=20000;
        observed.setAttribute('aria-label',row.apiId+' · '+row.name+' · observed result');observed.addEventListener('input',()=>row.note=observed.value);
        return [el('code',row.apiId),row.name,select,observed];
      }));
    }else section.append(form);
    const attachments=el('div'),files=input('files','','file');files.multiple=true;
    const fileLabel=label('Complete supporting files',files);form.append(fileLabel,attachments);
    const showFiles=()=>{attachments.replaceChildren();draft.files.forEach((file,index)=>attachments.append(
      controls(el('span',file.name+' · '+file.bytes.toLocaleString()+' bytes'),button('Remove',()=>{draft.files.splice(index,1);showFiles();}))));};
    let readingFiles=false;
    files.addEventListener('change',async()=>{
      readingFiles=true;save.disabled=true;
      try{
        const selected=[...files.files];if(draft.files.length+selected.length>50)throw new Error('Use at most fifty complete supporting files.');
        const captured=[];
        for(const file of selected){
          if(file.size>24*1024*1024)throw new Error(file.name+' exceeds 24 MiB.');
          const data=new Uint8Array(await file.arrayBuffer());let binary='';
          for(let i=0;i<data.length;i+=16384)binary+=String.fromCharCode(...data.subarray(i,i+16384));
          captured.push({name:file.name,mediaType:file.type||'application/octet-stream',contentBase64:btoa(binary),bytes:data.length});
        }
        draft.files.push(...captured);files.value='';showFiles();
      }catch(error){notice(error.message);}finally{readingFiles=false;save.disabled=false;}
    });
    showFiles();
    const accept=input('accepted','','checkbox');accept.required=true;
    const consent=label(production?'I reviewed these current staged definitions and recorded each operational check.':
      'I reviewed the complete native conversion for this saved cohort.',accept);consent.className='checkbox';form.append(consent);
    const save=el('button',production?'Save production review':'Accept native conversion');save.type='submit';form.append(save);
    form.addEventListener('submit',event=>{
      event.preventDefault();if(readingFiles){notice('Finish reading the complete supporting files before saving.');return;}
      const args={id:record.id,expectedRevision:record.revision,stepId,contextSha256:context.sha256,
        reviewer:draft.reviewer,note:draft.note,checks:draft.checks,
        files:draft.files.map(({bytes,...file})=>file)};
      change('recordCommissioningReview',args,production?'Save production review':'Accept native conversion');
    });
  }
  return {open,updateCohorts,get opened(){return opened;}};
}
