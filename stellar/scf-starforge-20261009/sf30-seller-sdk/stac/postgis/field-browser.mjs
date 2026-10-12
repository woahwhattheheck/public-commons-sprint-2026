import {parseExactJSON,stringifyExactJSON} from '/exact-json.js';

export async function installFieldDesk(host) {
  const $=s=>document.querySelector(s), el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);return node;};
  const text=value=>value===undefined?'Absent':stringifyExactJSON(value,2);
  const clone=value=>parseExactJSON(stringifyExactJSON(value));
  const need=(ok,message)=>{if(!ok)throw {code:'POSTGIS_FIELD_OPERATOR_INPUT',message};};
  const size=100;
  let scope='',draft={},inventory=null,source=null,page=0,selected=null,targetPage=0,targetResult=null,preview=null;
  let previewInput=null,previewKey=null,expectedContext=null;
  const rows=new Map();
  const defaults=()=>({schema:'starforge.postgis-field-browser-draft.v1',bindings:{},requests:{},sourceOperationId:'',
    workspaceDirectory:'',importActor:'',importNote:'',reviewActor:'',reviewNote:'',reviewOperation:null,staged:null});
  function currentScope(){const c=host.context();return location.origin+':'+c.config.projectId+':'+c.project.selectedProfileSha256;}
  function key(){return 'postgis-field:'+scope;}
  function persist(){
    try{localStorage.setItem(key(),stringifyExactJSON(draft));}
    catch{throw {code:'POSTGIS_FIELD_DRAFT_NOT_SAVED',message:'The browser could not retain this original field request or decision. Save the draft to a file or make local storage available before dispatch.'};}
  }
  function saveInputs(){
    draft.workspaceDirectory=$('#field-workspace-directory').value;
    draft.importActor=$('#field-import-actor').value;draft.importNote=$('#field-import-note').value;
    draft.reviewActor=$('#field-review-actor').value;draft.reviewNote=$('#field-review-note').value;
    persist();
  }
  function restoreInputs(){
    $('#field-workspace-directory').value=draft.workspaceDirectory;
    $('#field-import-actor').value=draft.importActor;$('#field-import-note').value=draft.importNote;
    $('#field-review-actor').value=draft.reviewActor;$('#field-review-note').value=draft.reviewNote;
    $('#field-source-operation').value=draft.sourceOperationId;
  }
  function invalidate(){
    preview=null;previewInput=null;previewKey=null;
    $('#field-preview-panel').hidden=true;renderControls();
  }
  function scopeCheck(captured){need(scope===captured&&scope===currentScope(),'The selected database mapping changed while this field operation was being read. Reopen its retained result in Operations.');}
  async function hashBody(value){
    const bytes=new TextEncoder().encode(stringifyExactJSON(value));
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  }
  async function mutation(action,input){
    const captured=scope, profile=clone(host.context().profile);
    const identity=await hashBody({action,profile,input});
    scopeCheck(captured);
    let record=draft.requests[identity];
    if(record)need(host.sameValue(record.input,input)&&host.sameValue(record.profile,profile)&&record.action===action,
      'The saved original field request does not match these inputs.');
    else{
      record={action,input:clone(input),profile,request:{...clone(input),operationId:'field-operator-'+crypto.randomUUID()},
        createdAt:new Date().toISOString(),result:null};
      draft.requests[identity]=record;persist();
    }
    // The original per-project server journal remains authoritative after a lost response.
    const result=await host.perform(action,record.request,record);
    scopeCheck(captured);
    need(result.operationId===record.request.operationId,'The original field operation returned another identity.');
    record.result=clone(result);persist();return result;
  }
  function options(node,items,selectedValue,placeholder='Choose explicitly'){
    node.replaceChildren();
    if(placeholder!==null){const item=el('option',placeholder);item.value='';node.append(item);}
    for(const [value,label]of items){const item=el('option',label);item.value=value;node.append(item);}
    if([...node.options].some(x=>x.value===selectedValue))node.value=selectedValue;
  }
  function fact(label,value){const div=el('div');div.append(el('dt',label),el('dd',value??'Not recorded'));return div;}
  function replaceRows(selector,items,columns){
    const node=$(selector);node.replaceChildren(...items);
    if(!items.length){const tr=el('tr'),td=el('td','No rows to display.');td.colSpan=columns;tr.append(td);node.append(tr);}
  }
  function bindButton(label,fn){const button=el('button',label);button.type='button';button.addEventListener('click',()=>host.guarded(fn));return button;}
  async function pageRead(offset){
    const captured=scope, operation=draft.sourceOperationId;
    const result=await host.perform('field-source',{sourceOperationId:operation,offset,limit:size});
    scopeCheck(captured);need(operation===draft.sourceOperationId,'The selected field source changed during this read.');
    if(source)need(result.manifestFile.sha256===source.manifestFile.sha256,'The original retained field source changed.');
    need(Number.isSafeInteger(result.total)&&result.total>=0,'The field source count cannot be safely paged in this browser.');
    for(const row of result.rows)rows.set(row.changeId,row);
    return result;
  }
  function sourceFacts(){
    const m=source.source;
    $('#field-facts').replaceChildren(fact('Original office workspace',m.workspaceId),fact('Accepted office map',m.fieldProjectId),fact('Accepted field edition',m.fieldEditionSha256),
      fact('Field round / return',m.roundId+' / '+m.returnId),fact('Accepted by / at',m.acceptedBy+' / '+m.acceptedAt),
      fact('Original acceptance request',m.acceptanceRequestId),fact('Retained changes',source.total));
    $('#field-source-detail').textContent=text({manifestFile:source.manifestFile,source:m,originalImport:source.originalImport});
    $('#field-lineage').textContent=text({configuration:source.configuration,lineage:source.lineage});
    $('#field-source-panel').hidden=false;
  }
  async function openSource(operation,{bindings,reviewActor,reviewNote,reviewOperation}={}){
    saveInputs();invalidate();source=null;selected=null;rows.clear();page=0;targetResult=null;
    $('#field-editor').hidden=true;$('#field-source-panel').hidden=true;
    const changed=draft.sourceOperationId!==operation;
    draft.sourceOperationId=operation;
    if(changed){draft.bindings={};draft.reviewOperation=null;draft.staged=null;delete draft.manifestSha256;}
    if(bindings)draft.bindings=Object.fromEntries(bindings.map(x=>[x.changeId,clone(x)]));
    if(reviewActor!==undefined)draft.reviewActor=reviewActor;
    if(reviewNote!==undefined)draft.reviewNote=reviewNote;
    if(reviewOperation!==undefined)draft.reviewOperation=clone(reviewOperation);
    restoreInputs();persist();
    source=await pageRead(0);
    if(draft.manifestSha256)need(draft.manifestSha256===source.manifestFile.sha256,'The saved field draft belongs to different source bytes.');
    draft.manifestSha256=source.manifestFile.sha256;persist();sourceFacts();renderPage(source.rows);renderSaved();
  }
  function renderPage(items){
    replaceRows('#field-changes',items.map(row=>{
      const d=draft.bindings[row.changeId],change=row.change,tr=el('tr');
      tr.dataset.fieldChange=row.changeId;
      tr.append(el('td',String(row.sequence)+' / '+change.kind),el('td',change.layerId+'\n'+text(change.identity)),
        el('td',d?d.disposition+'\n'+(d.target?d.target.layerId+' / '+(d.target.rowKey||'new operator row'):'Retained evidence'):'Decision required'));
      const cell=el('td');cell.append(bindButton(d?'Open decision':'Review change',()=>edit(row)));tr.append(cell);return tr;
    }),4);
    renderControls();
  }
  function updateDecisionCounter(){
    const count=Object.keys(draft.bindings).length;
    $('#field-progress').textContent=source?count+' / '+source.total+' decisions saved':'';
  }
  function renderControls(){
    const busy=host.busy(),count=source?.total||0;
    $('#field-previous').disabled=busy||!source||page===0;
    $('#field-next').disabled=busy||!source||(page+1)*size>=count;
    $('#field-page').textContent=source?Math.min(page*size+1,count)+'–'+Math.min((page+1)*size,count)+' of '+count:'';
    $('#field-target-previous').disabled=busy||!targetResult||targetPage===0;
    $('#field-target-next').disabled=busy||!targetResult||BigInt((targetPage+1)*size)>=BigInt(targetResult.total);
    $('#field-preview-button').disabled=busy||!source||Object.keys(draft.bindings).length!==count||count===0;
    $('#field-save-review').disabled=busy||!preview||preview.counts.applied===0;
    const saved=draft.reviewOperation;
    $('#field-stage').disabled=busy||!saved||(!draft.staged&&saved.review.expectedRevision!==host.context().project.revision);
    $('#field-open-staged').disabled=busy||!draft.staged;
    $('#field-keep-remaining').disabled=busy||!source||Object.keys(draft.bindings).length===count;
    updateDecisionCounter();
  }
  function selectedLayer(){return host.context().profile.layers.find(x=>x.id===$('#field-target-layer').value);}
  function requiredPermission(){return selected?.change.kind==='added'?'insert':selected?.change.kind==='deleted'?'delete':'update';}
  function populateRoles(value){
    const layer=selectedLayer(),roles=(layer?.roles||[]).filter(r=>r.permissions.includes('select')&&r.permissions.includes(requiredPermission()));
    options($('#field-target-role'),roles.map(r=>[r.name,r.name+' ('+r.permissions.join(', ')+')']),value);
    roleDetails();targetResult=null;targetPage=0;replaceRows('#field-targets',[],3);renderControls();
  }
  function roleDetails(){
    const role=selectedLayer()?.roles.find(x=>x.name===$('#field-target-role').value);
    $('#field-role-scope').textContent=role?'Original role scope: '+text(role.scope)+'; permissions: '+role.permissions.join(', '):
      'Select an existing role that can read and perform this change.';
  }
  function attrValue(object,name){return object&&Object.hasOwn(object,name)?text(object[name]):'Absent';}
  function attributes(saved=[]){
    const c=selected.change,layer=selectedLayer(),items=[];
    if(c.kind==='deleted'){replaceRows('#field-attributes',[],4);return;}
    const after=c.after?.attributes||{},names=c.kind==='added'?(layer?.fields||[]).map(f=>f.name):(c.fields||[]).map(f=>f.field);
    for(const name of names){
      const prior=c.kind==='added'?saved.find(f=>f.targetName===name):saved.find(f=>f.sourceName===name);
      const tr=el('tr');tr.dataset.fieldAttribute=name;
      const sourceCell=el('td'),values=el('td'),decision=el('td'),targetCell=el('td');
      let sourceName;
      if(c.kind==='added'){
        sourceName=el('select');sourceName.dataset.sourceName='';options(sourceName,Object.keys(after).map(n=>[n,n]),prior?.sourceName);
        sourceCell.append(sourceName);
      }else{sourceName=el('input');sourceName.type='hidden';sourceName.value=name;sourceName.dataset.sourceName='';sourceCell.append(el('span',name),sourceName);}
      const value=el('pre');values.append(value);
      const showValues=()=>{value.textContent='Base: '+attrValue(c.before?.attributes,sourceName.value)+'\nAccepted: '+attrValue(after,sourceName.value);};
      sourceName.addEventListener('change',showValues);showValues();
      const choice=el('select');choice.dataset.fieldChoice='';
      options(choice,c.kind==='added'?[['field','Use accepted field value']]:[['current','Keep database value'],['field','Use accepted field value']],prior?.choice,
        c.kind==='added'?null:'Choose explicitly');
      if(c.kind==='added')choice.value='field';decision.append(choice);
      const target=el('select');target.dataset.targetName='';
      options(target,(layer?.fields||[]).map(f=>[f.name,f.name+' ('+f.type+(f.nullable?', nullable':'')+')']),
        c.kind==='added'?name:prior?.targetName,c.kind==='added'?null:'Select target column');
      if(c.kind==='added'){target.value=name;target.disabled=true;}targetCell.append(target);
      choice.addEventListener('change',()=>{target.disabled=c.kind==='added'||choice.value!=='field';});
      target.disabled=c.kind==='added'||choice.value!=='field';
      tr.append(sourceCell,values,decision,targetCell);items.push(tr);
    }
    replaceRows('#field-attributes',items,4);
  }
  function disposition(){
    const change=selected?.change,apply=$('#field-disposition').value==='apply';
    if(change?.kind==='attachment'&&apply){$('#field-disposition').value='keep';host.status('Attachment bytes are retained as original evidence. Choose the explicit keep reason for this change.');}
    $('#field-apply-controls').hidden=$('#field-disposition').value!=='apply';
    $('#field-existing-target').hidden=change?.kind==='added';
    $('#field-new-target').hidden=change?.kind!=='added';
    $('#field-attribute-panel').hidden=change?.kind==='deleted';
    $('#field-geometry').disabled=change?.kind==='added'||change?.kind==='deleted';
    if(change?.kind==='added')$('#field-geometry').value='field';
    if(change?.kind==='deleted')$('#field-geometry').value='current';
    $('#field-source-srid-label').hidden=$('#field-geometry').value!=='field';
  }
  async function edit(row){
    selected=row;targetPage=0;targetResult=null;
    const c=row.change,saved=draft.bindings[row.changeId]||{};
    $('#field-editor').hidden=false;
    $('#field-change-title').textContent='Original '+c.kind+' change / '+c.layerId;
    $('#field-change-id').textContent=row.changeId+' / field identity '+text(c.identity);
    $('#field-before').textContent=text(c.before);$('#field-after').textContent=text(c.after);
    $('#field-original-body').textContent=row.originalBody;
    $('#field-target-readback').textContent='Select a target row to read its exact current values.';
    $('#field-disposition').value=saved.disposition||'';
    $('#field-change-note').value=saved.note||'';
    const layers=host.context().profile.layers.filter(layer=>layer.roles.some(r=>r.permissions.includes('select')&&r.permissions.includes(requiredPermission())));
    options($('#field-target-layer'),layers.map(l=>[l.id,l.title+' / '+l.relation]),saved.target?.layerId);
    populateRoles(saved.target?.role);
    $('#field-target-key').value=saved.target?.rowKey||'';
    $('#field-target-search').value=saved.target?.rowKey||'';
    $('#field-source-srid').value=saved.target?.sourceSrid||'';
    $('#field-geometry').value=saved.geometry||'current';
    attributes(saved.fields||[]);disposition();
    $('#field-editor').scrollIntoView({block:'start'});
  }
  async function findTargets(){
    need(selected,'Choose an original field change first.');
    const captured=scope,changeId=selected.changeId,layerId=$('#field-target-layer').value,role=$('#field-target-role').value;
    need(layerId&&role,'Select the target layer and existing database role.');
    const result=await host.perform('field-targets',{layerId,role,offset:targetPage*size,limit:size,search:$('#field-target-search').value});
    scopeCheck(captured);
    need(selected?.changeId===changeId&&$('#field-target-layer').value===layerId&&$('#field-target-role').value===role,
      'The selected field change, target layer or role changed during the read. Read the target again.');
    targetResult=result;
    replaceRows('#field-targets',result.rows.map(row=>{
      const tr=el('tr');tr.append(el('td',row.rowKey+'\n'+row.sfId));
      const values=el('td');values.append(el('pre',row.attributesJSON));tr.append(values);
      const cell=el('td'),button=bindButton('Bind this row',async()=>{
        $('#field-target-key').value=row.rowKey;
        $('#field-target-readback').textContent='Observed revision '+result.revision+' / role '+role+
          '\nStable key '+row.rowKey+'\nRow SHA-256 '+row.rowHash+'\n\n'+row.attributesJSON;
      });button.dataset.fieldTarget=row.rowKey;cell.append(button);tr.append(cell);return tr;
    }),3);
    $('#field-target-page').textContent=Math.min(targetPage*size+1,Number(result.total))+'–'+Math.min((targetPage+1)*size,Number(result.total))+' of '+result.total+' visible rows';
    renderControls();
  }
  function editorBinding(){
    const c=selected.change,decision=$('#field-disposition').value,note=$('#field-change-note').value;
    need(['keep','apply'].includes(decision)&&note.trim(),'Select a decision and record its reason.');
    const result={changeId:selected.changeId,disposition:decision,note};
    if(decision==='keep')return result;
    need(c.kind!=='attachment','Attachments are retained as field evidence.');
    const layerId=$('#field-target-layer').value,role=$('#field-target-role').value;
    need(layerId&&role,'Select the target layer and original role.');
    result.target={layerId,role};
    if(c.kind!=='added'){result.target.rowKey=$('#field-target-key').value;need(result.target.rowKey,'Select the actual stable database key.');}
    result.geometry=$('#field-geometry').value;
    if(result.geometry==='field'){
      const value=Number($('#field-source-srid').value);need(Number.isSafeInteger(value)&&value>0,'Enter the original field CRS EPSG code.');
      result.target.sourceSrid=value;
    }
    result.fields=c.kind==='deleted'?[]:[...document.querySelectorAll('#field-attributes tr[data-field-attribute]')].map(tr=>{
      const sourceName=tr.querySelector('[data-source-name]').value,choice=tr.querySelector('[data-field-choice]').value;
      need(sourceName&&['field','current'].includes(choice),'Review every original attribute.');
      const field={sourceName,choice};
      if(choice==='field'){field.targetName=tr.querySelector('[data-target-name]').value;need(field.targetName,'Map every selected field value to an actual target column.');}
      return field;
    });
    return result;
  }
  async function keepRemaining(){
    const reason=$('#field-keep-reason').value;need(reason.trim(),'Record the reason for keeping every undecided change.');
    let count=0;
    for(let offset=0;offset<source.total;offset+=size){
      const result=await pageRead(offset);
      for(const row of result.rows)if(!draft.bindings[row.changeId]){draft.bindings[row.changeId]={changeId:row.changeId,disposition:'keep',note:reason};count++;}
      persist();
    }
    draft.reviewOperation=null;draft.staged=null;persist();invalidate();renderSaved();const current=await pageRead(page*size);renderPage(current.rows);host.status(count+' original changes were explicitly kept as field evidence.');
  }
  function input(){
    saveInputs();
    need(source&&draft.manifestSha256===source.manifestFile.sha256,'Open the retained original field source.');
    need(Object.keys(draft.bindings).length===source.total,'Save an explicit decision for every original change.');
    need(draft.reviewActor.trim()&&draft.reviewNote.trim(),'Record the reviewer and whole publication reason.');
    return {sourceOperationId:draft.sourceOperationId,expectedRevision:host.context().project.revision,
      bindings:Object.values(draft.bindings).sort((a,b)=>a.changeId.localeCompare(b.changeId)),
      actor:draft.reviewActor,note:draft.reviewNote};
  }
  function renderPreview(){
    $('#field-preview-panel').hidden=false;
    $('#field-preview-summary').textContent=preview.counts.applied+' changes to apply / '+preview.counts.retained+' kept as evidence.\nCurrent revision '+
      preview.expectedRevision+' / active edition '+preview.activeEditionId+'\nReview SHA-256 '+preview.reviewSha256;
    replaceRows('#field-preview-rows',preview.records.map(row=>{
      const tr=el('tr');tr.append(el('td',row.kind+'\n'+text(row.identity)+'\n'+row.disposition));
      tr.append(el('td',row.target?row.target.layerId+'\n'+(row.target.rowKey||'new operator row')+'\n'+row.target.role:'Retained evidence'));
      const detail=el('td');
      const observation={note:row.note,fields:row.fields||[],geometry:row.geometry||null,
        currentTarget:row.before||null};
      detail.append(el('pre',text(observation)));tr.append(detail);return tr;
    }),3);
    $('#field-preview-detail').textContent=text(preview);renderControls();
  }
  function renderSaved(){
    const saved=draft.reviewOperation;
    $('#field-saved-panel').hidden=!saved;
    if(saved){
      $('#field-saved-summary').textContent='Committed field review '+saved.operationId+' / revision '+saved.review.expectedRevision+
        (draft.staged?' / staged '+draft.staged.editionId:'')+
        (saved.review.expectedRevision!==host.context().project.revision?' / the current project has since advanced.':'');
      $('#field-saved-detail').textContent=text({review:saved,staged:draft.staged});
    }
    $('#field-open-staged').hidden=!draft.staged;renderControls();
  }
  async function refresh({initial=false}={}){
    const current=currentScope(),changed=scope!==current,c=host.context();
    if(changed){
      if(scope)persist();
      scope=current;draft=defaults();
      try{const saved=parseExactJSON(localStorage.getItem(key())||'null');
        if(saved&&saved.schema===draft.schema)draft={...draft,...saved};}catch{}
      inventory=null;source=null;selected=null;rows.clear();page=0;targetResult=null;invalidate();
      $('#field-inventory').hidden=true;$('#field-source-panel').hidden=true;$('#field-editor').hidden=true;
      restoreInputs();
    }
    const context={profileSha256:c.project.selectedProfileSha256,revision:c.project.revision,activeEditionId:c.project.activeEditionId};
    if(expectedContext&&!host.sameValue(context,expectedContext))invalidate();
    expectedContext=context;renderSaved();
    if(initial&&draft.sourceOperationId)await openSource(draft.sourceOperationId);
  }
  async function openOperation(operation){
    host.show('field');
    if(operation.kind==='field-import')return openSource(operation.operationId);
    if(operation.kind==='field-review'){
      const i=operation.request.input;
      return openSource(i.sourceOperationId,{bindings:i.bindings,reviewActor:i.actor,reviewNote:i.note,reviewOperation:operation.result});
    }
    need(false,'Select an original field import or field review operation.');
  }

  $('#field-inspect-form').addEventListener('submit',event=>{event.preventDefault();host.guarded(async()=>{
    saveInputs();const captured=scope;
    const result=await host.perform('field-inspect',{workspaceDirectory:draft.workspaceDirectory.trim()});
    scopeCheck(captured);inventory=result;$('#field-inventory').hidden=false;
    $('#field-inventory-summary').textContent=result.workspaceId+' / revision '+result.revision+' / '+result.projects.length+' accepted office maps';
    const available=result.projects.filter(p=>p.status==='accepted');
    options($('#field-accepted-map'),available.map(p=>[p.projectId,p.title+' / '+p.roundId+' / '+p.projectId]),'');
    $('#field-acceptance').textContent=text(result);
    host.status(available.length?'Original accepted office maps read. Select the exact map to retain.':'No accepted field map is available in this original workspace.');
  });});
  $('#field-accepted-map').addEventListener('change',()=>{$('#field-acceptance').textContent=text(inventory?.projects.find(x=>x.projectId===$('#field-accepted-map').value));});
  $('#field-import-form').addEventListener('submit',event=>{event.preventDefault();host.guarded(async()=>{
    saveInputs();const map=inventory?.projects.find(p=>p.projectId===$('#field-accepted-map').value);
    need(map&&map.status==='accepted','Select an actually accepted original office map.');
    const result=await mutation('field-import',{workspaceDirectory:draft.workspaceDirectory.trim(),workspaceId:inventory.workspaceId,
      fieldProjectId:map.projectId,fieldEditionSha256:map.fieldEditionSha256,actor:draft.importActor,note:draft.importNote});
    await openSource(result.operationId);host.status('The accepted office source and original review are retained. Bind and review their database changes.');
  });});
  $('#field-open-form').addEventListener('submit',event=>{event.preventDefault();host.guarded(()=>openSource($('#field-source-operation').value.trim()));});
  $('#field-previous').addEventListener('click',()=>host.guarded(async()=>{page--;renderPage((await pageRead(page*size)).rows);}));
  $('#field-next').addEventListener('click',()=>host.guarded(async()=>{page++;renderPage((await pageRead(page*size)).rows);}));
  $('#field-disposition').addEventListener('change',disposition);
  $('#field-target-layer').addEventListener('change',()=>{populateRoles('');attributes();$('#field-target-key').value='';
    $('#field-target-readback').textContent='Select a target row in this database layer.';});
  $('#field-target-role').addEventListener('change',()=>{roleDetails();targetResult=null;targetPage=0;
    $('#field-target-readback').textContent='Read the target through the newly selected role.';replaceRows('#field-targets',[],3);renderControls();});
  $('#field-geometry').addEventListener('change',disposition);
  $('#field-find-targets').addEventListener('click',()=>host.guarded(async()=>{targetPage=0;await findTargets();}));
  $('#field-target-previous').addEventListener('click',()=>host.guarded(async()=>{targetPage--;await findTargets();}));
  $('#field-target-next').addEventListener('click',()=>host.guarded(async()=>{targetPage++;await findTargets();}));
  $('#field-decision-form').addEventListener('submit',event=>{event.preventDefault();host.guarded(async()=>{
    const binding=editorBinding();draft.bindings[binding.changeId]=binding;draft.reviewOperation=null;draft.staged=null;persist();invalidate();renderSaved();
    renderPage((await pageRead(page*size)).rows);host.status('Original change decision saved. Preview the complete set before committing its review.');
  });});
  $('#field-keep-remaining').addEventListener('click',()=>host.guarded(keepRemaining));
  $('#field-preview-form').addEventListener('submit',event=>{event.preventDefault();host.guarded(async()=>{
    invalidate();const captured=scope,request=input();const result=await host.perform('field-preview',request);scopeCheck(captured);
    need(host.sameValue(input(),request),'The field decisions changed during this preview. Preview the current draft.');
    preview=result;previewInput=clone(request);previewKey=await hashBody(request);renderPreview();
    host.status('The complete field review uses actual current database values and native type/CRS checks.');
  });});
  for(const selector of ['#field-review-actor','#field-review-note'])$(selector).addEventListener('input',()=>{draft.reviewOperation=null;draft.staged=null;saveInputs();invalidate();renderSaved();});
  $('#field-save-review').addEventListener('click',()=>host.guarded(async()=>{
    need(preview&&previewInput&&await hashBody(input())===previewKey,'Preview the unchanged complete decisions first.');
    const result=await mutation('field-review',{...previewInput,reviewSha256:preview.reviewSha256});
    draft.reviewOperation=clone(result);draft.staged=null;persist();renderSaved();host.status('The exact field review is committed. Stage it for the normal publication review.');
  }));
  $('#field-stage').addEventListener('click',()=>host.guarded(async()=>{
    need(draft.reviewOperation,'Commit the reviewed field plan first.');
    const result=await mutation('field-stage',{reviewOperationId:draft.reviewOperation.operationId});
    draft.staged=clone(result);persist();await host.refreshProject();renderSaved();
    host.openStaged(result.editionId);host.status('The field successor is staged. Review and publish through the original edition workflow.');
  }));
  $('#field-open-staged').addEventListener('click',()=>{if(draft.staged)host.openStaged(draft.staged.editionId);});
  $('#field-open-delivery').addEventListener('click',()=>host.show('recovery'));
  await refresh({initial:true});
  return {refresh,renderControls,openOperation};
}
