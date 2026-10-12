// MIT. Retained workbook update review in the original publisher session.
function createWorkbookEditionControls(host) {
  const root=document.createElement('section');root.id='workbook-editions-panel';root.className='panel';
  root.setAttribute('aria-labelledby','we-title');
  // Application-owned markup only. Every workbook value is rendered as text.
  root.innerHTML='<div class="section-head"><div><h2 id="we-title">Review workbook updates</h2><p>Compare a saved mapping with a replacement workbook, review the complete selection, and carry it into the next publication.</p></div><a href="#workbook-title">Workbook sources</a></div>'+
  '<form id="we-source-form" class="we-source-grid"><div><label for="we-baseline">Earlier workbook</label><select id="we-baseline" required></select></div><div><label for="we-baseline-plan">Saved mapping</label><select id="we-baseline-plan" required></select></div><div><label for="we-target">Replacement workbook</label><select id="we-target" required></select></div><div><label for="we-initial-sheet">Replacement worksheet</label><select id="we-initial-sheet" required></select></div><button id="we-suggest" type="submit">Review replacement</button></form>'+
  '<p id="we-source-hint" class="small muted"></p><div id="we-editor" hidden>'+
  '<section class="we-section"><h3>Replacement selection</h3><p id="we-source-identity" class="small wrap"></p><div id="we-workbook-changes"></div>'+
  '<form id="we-remap-form" class="we-selection-grid"><div><label for="we-sheet">Worksheet</label><select id="we-sheet" required></select></div><div><label for="we-range">Source range</label><input id="we-range" required placeholder="A1:G40" pattern="[A-Za-z]{1,3}[1-9][0-9]*(:[A-Za-z]{1,3}[1-9][0-9]*)?"></div><div><label for="we-header">Header row</label><input id="we-header" type="number" min="1" max="1048576" placeholder="No header"></div><button id="we-remap" type="submit">Read headers</button></form>'+
  '<p class="small muted">Header matches suggest coordinates. Review every field; duplicate or missing headers require an explicit choice.</p></section>'+
  '<form id="we-compare-form"><section class="we-section"><h3>Public fields and row identity</h3><p>Choose the fields that identify a row across editions. The complete selections must have unique, present keys.</p><div id="we-fields"></div></section>'+
  '<div class="we-plan-grid"><div><label for="we-name">Replacement mapping name</label><input id="we-name" required maxlength="160"></div><div><label for="we-hidden">Hidden rows</label><select id="we-hidden"><option value="include">Include hidden rows</option><option value="exclude">Exclude hidden rows</option></select></div><div><label for="we-blank">Empty selected rows</label><select id="we-blank"><option value="skip">Skip empty rows</option><option value="keep">Keep empty rows</option></select></div><div><label for="we-merged">Merged cells</label><select id="we-merged"><option value="reject">Require unmerged cells</option><option value="anchor">Use original anchor only</option></select></div></div>'+
  '<label for="we-notes">Review notes</label><textarea id="we-notes" rows="3" maxlength="2000"></textarea><div class="actions"><button id="we-compare" type="submit" class="primary">Compare complete selections</button><span id="we-form-status" class="small muted"></span></div></form></div>'+
  '<p id="we-error" class="notice small" role="alert" hidden></p><div id="we-pending" class="notice small" hidden><p id="we-pending-label"></p><button id="we-recover" type="button">Reopen this comparison</button></div>'+
  '<section id="we-result" class="we-section" hidden><div class="section-head"><div><h3>Saved comparison</h3><p id="we-result-subtitle" class="small wrap"></p></div><span id="we-review-state" class="tag"></span></div><div id="we-counts" class="we-counts" aria-label="Complete comparison totals"></div>'+
  '<details class="we-section"><summary>Reviewed mapping, row keys and original sources</summary><pre id="we-review-detail" class="wb-literal"></pre></details><details class="we-section"><summary>Column and conversion changes</summary><div id="we-column-changes" class="table-scroll"></div></details>'+
  '<div class="we-result-tools"><div><label for="we-kind">Rows to show</label><select id="we-kind"><option value="all">All rows</option><option value="added">Added</option><option value="removed">Removed</option><option value="changed">Published values changed</option><option value="source">Source details changed</option><option value="unchanged">Unchanged</option><option value="moved">Moved rows</option></select></div><div class="actions"><button id="we-export" type="button">Download complete review</button><button id="we-export-page" type="button">Download displayed rows</button></div></div>'+
  '<div class="table-scroll" tabindex="0" aria-label="Workbook row comparison"><table id="we-rows"><thead><tr><th>Change</th><th>Row key</th><th>Earlier row</th><th>Replacement row</th><th>Details</th></tr></thead><tbody></tbody></table><p id="we-no-rows" class="empty" hidden>No rows match this view.</p></div>'+
  '<nav class="pagination" aria-label="Comparison pages"><button id="we-previous" type="button">Previous rows</button><span id="we-position" class="small muted"></span><button id="we-next" type="button">Next rows</button></nav>'+
  '<div id="we-cell-detail" class="we-section" hidden><div class="section-head"><h3 id="we-cell-title">Row details</h3><button id="we-close-detail" type="button" class="small-button">Close details</button></div><div id="we-cell-body"></div></div>'+
  '<div class="activation"><strong>Adopt this reviewed mapping</strong><p id="we-apply-description" class="small"></p><label class="wb-check"><input id="we-reviewed" type="checkbox">I have reviewed the selection, row identity, column decisions and complete totals.</label><div class="actions"><button id="we-apply" type="button" class="primary">Save replacement mapping</button><button id="we-open-applied" type="button" hidden>Open saved mapping</button></div><p class="small muted">Continue with the publisher’s existing candidate preparation, preview and publication controls.</p></div></section>'+
  '<section class="we-section"><div class="section-head"><div><h3>Saved update reviews</h3><p class="small muted">Reopen a complete comparison and its original selections.</p></div><button id="we-refresh-history" type="button" class="small-button">Refresh reviews</button></div><div class="table-scroll" tabindex="0" aria-label="Saved workbook update reviews"><table id="we-history"><thead><tr><th>Earlier → replacement</th><th>Rows changed</th><th>Saved</th><th>Action</th></tr></thead><tbody></tbody></table><p id="we-no-history" class="empty">No saved comparisons yet.</p><p id="we-history-warning" class="notice small wrap" role="status" hidden></p></div></section>';
  document.getElementById('workbook-panel').after(root);
  const $=id=>document.getElementById(id), field=id=>$(id).value;
  const el=(tag,value,cls)=>{const n=document.createElement(tag);if(value!==undefined)n.textContent=value;if(cls)n.className=cls;return n;};
  const option=(value,label)=>{const n=el('option',label);n.value=value;return n;};
  const clone=value=>structuredClone(value), state=()=>host.getState();
  const sources=()=>state().workspace?.workbookSources??[], source=id=>sources().find(s=>s.id===id);
  const availablePlans=()=>(source(field('we-baseline'))?.plans??[]).flatMap(p=>[p,...[...(p.editions??[])].reverse().map(edition=>({...edition,id:p.id}))]);
  const selectedPlan=()=>availablePlans().find(p=>p.id+':'+p.revision===field('we-baseline-plan'));
  const selection=()=>({sourceId:field('we-baseline'),planId:selectedPlan()?.id??'',targetId:field('we-target')});
  const literal=value=>value===undefined?'(missing)':value===null?'null':value===''?'""':String(value);
  const number=value=>Number.isSafeInteger(value)?value.toLocaleString():'—';
  const names={added:'Added',removed:'Removed',changed:'Value changed',source:'Source changed',unchanged:'Unchanged',moved:'Moved'};
  let suggestion=null,schema=null,formBaseline=null,report=null,page=null,applied=null,saved=[],savedWarnings=[],stamp='',edit=0,reviewEdit=null,targetRevision=null,pendingId=null;
  const bindings=[];
  function options(node,items,value=node.value){node.replaceChildren(...items.map(([id,text])=>option(id,text)));node.value=items.some(([id])=>id===value)?value:items[0]?.[0]??'';}
  function plans(){options($('we-baseline-plan'),[['','Choose saved mapping'],...availablePlans().map(p=>[p.id+':'+p.revision,p.plan.name+' / edition '+p.revision])]);}
  function initialSheets(reset=false){const items=source(field('we-target'))?.workbook.sheets??[],prior=selectedPlan()?.plan.sheet;const current=reset?'':field('we-initial-sheet');options($('we-initial-sheet'),[['','Choose actual worksheet'],...items.map(s=>[s.name,s.name+(s.state==='visible'?'':' / '+s.state)])],items.some(s=>s.name===current)?current:items.some(s=>s.name===prior)?prior:'');}
  function refreshSources(){
    const next=JSON.stringify(sources().map(s=>[s.id,s.revision,s.plans.map(p=>[p.id,p.revision])]));if(next===stamp)return;stamp=next;
    options($('we-baseline'),[['','Choose earlier workbook'],...sources().filter(s=>s.plans.length).map(s=>[s.id,s.filename])]);
    options($('we-target'),[['','Choose replacement workbook'],...sources().map(s=>[s.id,s.filename])]);plans();initialSheets();
    $('we-source-hint').textContent=sources().some(s=>s.plans.length)?'Use retained original workbooks and a saved earlier mapping.':'Retain a workbook and save its first mapping in Workbook sources above.';
  }
  function changed(){edit++;$('we-reviewed').checked=false;$('we-error').hidden=true;$('we-form-status').textContent='Compare these selections to save a complete review.';controls();}
  function resetSelection(){suggestion=null;formBaseline=null;initialSheets(true);$('we-editor').hidden=true;changed();}
  function label(text,input){const n=el('label',text);n.append(input);return n;}
  function chooser(choices,value,name){const n=el('select');for(const [v,t]of choices)n.append(option(v,t));n.value=value;n.setAttribute('aria-label',name);return n;}
  function mapLiteral(container,value){
    const row=el('div',undefined,'wb-value-row'),from=el('input'),to=el('input'),nil=el('input'),nilLabel=el('label',undefined,'wb-check'),remove=el('button','Remove','small-button');
    from.value=value.from;from.setAttribute('aria-label','Exact source literal');to.value=value.to??'';to.setAttribute('aria-label','Replacement literal');nil.type='checkbox';nil.checked=value.to===null;nilLabel.append(nil,document.createTextNode('Null'));remove.type='button';
    row.append(from,to,nilLabel,remove);container.append(row);row.value=()=>({from:from.value,to:nil.checked?null:to.value});row.control=()=>{to.disabled=state().busy||nil.checked;};
    remove.addEventListener('click',()=>{row.remove();changed();});for(const input of [from,to,nil])input.addEventListener('input',()=>{row.control();changed();});row.control();
  }
  function renderBindings(){
    bindings.length=0;$('we-fields').replaceChildren();
    for(const mapping of suggestion.columnMappings){
      const prior=suggestion.plan.columns.find(c=>c.name===mapping.field),spec=schema.columns.find(c=>c.name===mapping.field)??mapping;
      const card=el('section',undefined,'we-field'),head=el('div',undefined,'section-head'),title=el('div'),key=el('input'),keyLabel=el('label',undefined,'wb-check');
      title.append(el('strong',mapping.field),el('span',' '+mapping.type+(mapping.nullable?' / nullable':''),'small muted'));key.type='checkbox';key.dataset.key=mapping.field;keyLabel.append(key,document.createTextNode('Row key'));head.append(title,keyLabel);card.append(head);
      const line=el('div',undefined,'we-field-map'),old=el('div'),coordinate=el('input'),list=el('datalist');
      old.append(el('span','Earlier source','small muted'),el('p',mapping.beforeSource+' · '+literal(mapping.beforeHeader),'small wrap'));
      coordinate.value=prior.source??mapping.source??'';coordinate.required=true;coordinate.pattern='[A-Za-z]{1,3}';coordinate.maxLength=3;coordinate.placeholder='Column';coordinate.dataset.mapping=mapping.field;
      list.id='we-coordinate-'+bindings.length;coordinate.setAttribute('list',list.id);for(const item of mapping.choices??[])list.append(option(item.source,item.source+' · '+literal(item.header)));
      const position=label('Replacement coordinate',coordinate);position.append(list);line.append(old,position,el('p',String(mapping.status).replaceAll('_',' '),'small muted'));card.append(line);
      const advanced=el('details'),grid=el('div',undefined,'we-policy-grid');
      const blank=chooser([['reject','Require a value'],...(spec.nullable?[['null','Blank → null']]:spec.type==='string'?[['empty','Blank → empty text']]:[])],prior.blank,mapping.field+' blank cells');
      const formula=chooser([['reject','Require literal cells'],['cached','Use original saved cache'],...(spec.type==='string'?[['text','Retain formula text']]:[])],prior.formula,mapping.field+' formulas');
      const error=chooser([['reject','Require non-error cells'],['text','Retain error / apply mapping'],...(spec.nullable?[['null','Error → null']]:[])],prior.error,mapping.field+' error cells');
      const date=chooser([['raw','Keep original token'],...(spec.type==='string'?[['iso-date','ISO date'],['iso-datetime-ms','ISO datetime / milliseconds']]:[])],prior.date,mapping.field+' dates');
      for(const [text,input]of [['Blank cells',blank],['Formula cells',formula],['Error cells',error],['Date interpretation',date]])grid.append(label(text,input));
      const trim=el('input'),trimLabel=el('label',undefined,'wb-check');trim.type='checkbox';trim.checked=prior.trim;trimLabel.append(trim,document.createTextNode('Trim surrounding whitespace'));
      const maps=el('div',undefined,'wb-values');for(const value of prior.valueMap??[])mapLiteral(maps,value);
      const add=el('button','Add literal mapping','small-button');add.type='button';add.addEventListener('click',()=>{mapLiteral(maps,{from:'',to:''});changed();controls();});
      advanced.append(el('summary','Conversion choices'),grid,trimLabel,el('p','These choices carry forward from the saved mapping. Review changes before comparing.','small muted'),maps,add);card.append(advanced);$('we-fields').append(card);
      for(const input of [key,coordinate,blank,formula,error,date,trim])input.addEventListener('input',changed);
      bindings.push({field:mapping.field,key,read:()=>({name:mapping.field,source:coordinate.value.trim().toUpperCase(),blank:blank.value,formula:formula.value,error:error.value,date:date.value,trim:trim.checked,valueMap:[...maps.children].map(n=>n.value())}),control:()=>{for(const n of maps.children)n.control();}});
    }
  }
  function readPlan(){return {name:field('we-name'),notes:field('we-notes'),sheet:field('we-sheet'),range:field('we-range').trim().toUpperCase(),headerRow:field('we-header')===''?null:Number(field('we-header')),hiddenRows:field('we-hidden'),blankRows:field('we-blank'),mergedCells:field('we-merged'),columns:bindings.map(b=>b.read())};}
  async function suggest(explicit=false){
    const baseline=selectedPlan();if(!baseline)throw new Error('Choose a saved earlier mapping.');
    const request={...selection(),planRevision:baseline.revision,...(explicit?{sheet:field('we-sheet'),range:field('we-range').trim().toUpperCase(),headerRow:field('we-header')===''?null:Number(field('we-header'))}:{sheet:field('we-initial-sheet')})};
    const target=source(request.targetId),observedTargetRevision=target.revision;
    suggestion=await host.api('workbook/editions/suggest',request);schema=clone(suggestion.nativeSchema);formBaseline={sourceId:request.sourceId,planId:request.planId,planRevision:request.planRevision,targetId:request.targetId};
    const plan=suggestion.plan;targetRevision=suggestion.expectedTargetRevision??suggestion.target.sourceRevision??observedTargetRevision;
    options($('we-sheet'),target.workbook.sheets.map(s=>[s.name,s.name+(s.state==='visible'?'':' / '+s.state)]),plan.sheet);
    for(const [id,value]of [['we-range',plan.range],['we-header',plan.headerRow??''],['we-name',plan.name],['we-notes',plan.notes],['we-hidden',plan.hiddenRows],['we-blank',plan.blankRows],['we-merged',plan.mergedCells]])$(id).value=value;
    $('we-source-identity').textContent=target.filename+' / '+target.sourceBytes.toLocaleString()+' original bytes';
    const drift=$('we-workbook-changes');drift.replaceChildren();if(suggestion.workbookChanges){const detail=el('details');detail.append(el('summary','Workbook structure changes'),el('pre',JSON.stringify(suggestion.workbookChanges,null,2),'wb-literal'));drift.append(detail);}
    renderBindings();$('we-editor').hidden=false;changed();host.notice('Replacement headers loaded. Review the field coordinates and choose the row key.');
  }
  const keyText=row=>row.key.map(part=>part.type+': '+literal(part.text)).join(' · ');
  function table(headers){const n=el('table'),head=el('thead'),tr=el('tr');for(const value of headers)tr.append(el('th',value));head.append(tr);n.append(head);const body=el('tbody');n.append(body);return {node:n,body};}
  function showRow(row){
    $('we-cell-detail').hidden=false;$('we-cell-title').textContent=(names[row.kind]??row.kind)+' · '+keyText(row);const body=$('we-cell-body');body.replaceChildren();
    const t=table(['Field','Earlier public value','Replacement public value','Original coordinates']);
    for(const name of report.columns??report.plan.columns.map(c=>c.name)){const tr=el('tr');tr.append(el('th',name),el('td',literal(row.before?.values[name]),'mono'),el('td',literal(row.after?.values[name]),'mono'),el('td',(row.before?.cells[name]?.cell??'—')+' → '+(row.after?.cells[name]?.cell??'—')));t.body.append(tr);}
    const scroll=el('div',undefined,'table-scroll');scroll.append(t.node);body.append(scroll);
    const detail=el('details');detail.append(el('summary','Exact source cells, saved formulas and formats'),el('pre',JSON.stringify({before:row.before,after:row.after,changes:row.changes},null,2),'wb-literal'));body.append(detail);$('we-cell-detail').scrollIntoView({block:'nearest'});
  }
  function renderRows(){
    const body=$('we-rows').tBodies[0];body.replaceChildren();for(const row of page?.rows??[]){
      const tr=el('tr');tr.append(el('td',(names[row.kind]??row.kind)+(row.moved?' / moved':'')),el('td',keyText(row),'mono wrap'),el('td',row.before?String(row.before.row):'—'),el('td',row.after?String(row.after.row):'—'));
      const cell=el('td'),button=el('button','Inspect cells','small-button');button.type='button';button.addEventListener('click',()=>showRow(row));cell.append(button);tr.append(cell);body.append(tr);
    }
    $('we-no-rows').hidden=Boolean(page?.rows.length);$('we-position').textContent=page?(page.rows.length?number(page.offset+1):'0')+'–'+number(page.offset+page.rows.length)+' of '+number(page.total)+' rows in this view':'';controls();
  }
  function formFresh(){return Boolean(suggestion&&formBaseline&&schema&&state().status?.current===schema.snapshot&&state().status?.revision===schema.revision&&source(formBaseline.targetId)?.revision===targetRevision&&selectedPlan()?.revision===formBaseline.planRevision&&Object.entries(selection()).every(([key,value])=>formBaseline[key]===value));}
  function fresh(){return report&&state().status?.current===report.nativeSchema.snapshot&&state().status?.revision===report.nativeSchema.revision&&source(report.target.sourceId)?.revision===report.expectedTargetRevision;}
  function renderReport(data,fromForm=false){
    report=data.comparison;page=data.page;applied=report.applied??null;reviewEdit=fromForm?edit:null;
    if(!fromForm){suggestion=null;$('we-editor').hidden=true;}
    pendingId=null;$('we-pending').hidden=true;$('we-result').hidden=false;$('we-cell-detail').hidden=true;$('we-reviewed').checked=false;
    $('we-result-subtitle').textContent=report.baseline.filename+' / '+report.baseline.sheet+'!'+report.baseline.range+' → '+report.target.filename+' / '+report.target.sheet+'!'+report.target.range;
    $('we-review-detail').textContent=JSON.stringify({id:report.id,sha256:report.sha256,baseline:report.baseline,target:report.target,keys:report.keys,plan:report.plan,nativeSchema:report.nativeSchema,expectedTargetRevision:report.expectedTargetRevision},null,2);
    const totals=$('we-counts');totals.replaceChildren();for(const [key,title]of [['added','Added'],['removed','Removed'],['changed','Value changes'],['source','Source changes'],['unchanged','Unchanged'],['moved','Moved']]){const card=el('div');card.append(el('span',title),el('strong',number(key==='moved'?report.positionsChanged:report.counts[key])));totals.append(card);}
    const t=table(['Public field','Earlier coordinate','Replacement coordinate','Changes']);for(const c of report.columnChanges??[]){const row=el('tr');row.append(el('td',c.field),el('td',c.beforeSource??c.from??'—'),el('td',c.source??c.to??'—'),el('td',JSON.stringify({changes:c.changes??[],policies:c.policies??c.policyChanges??[],headerBefore:c.headerBefore??null,headerAfter:c.headerAfter??null}),'wrap'));t.body.append(row);}$('we-column-changes').replaceChildren(t.node);
    $('we-kind').value=page.kind;renderRows();controls();
  }
  async function read(id,offset=0,kind='all'){const data=await host.api('workbook/editions/read',{id,offset,limit:50,kind});renderReport(data);return data;}
  function setSaved(result){saved=Array.isArray(result)?result:result.comparisons??[];savedWarnings=Array.isArray(result)?[]:result.warnings??[];renderSaved();}
  function renderSaved(){
    const body=$('we-history').tBodies[0];body.replaceChildren();for(const item of saved){
      const row=el('tr'),name=el('td');name.append(el('strong',item.baseline.filename+' → '+item.target.filename),el('div',item.id,'small mono wrap'));row.append(name,el('td',number(item.counts.added)+' added / '+number(item.counts.removed)+' removed / '+number(item.counts.changed)+' changed'),el('td',item.createdAt??'—'));
      const cell=el('td'),button=el('button','Open review','small-button');button.type='button';button.addEventListener('click',()=>host.action('Opening the saved workbook comparison…',()=>read(item.id)));cell.append(button);row.append(cell);body.append(row);
    }$('we-no-history').hidden=saved.length>0;$('we-history-warning').hidden=savedWarnings.length===0;$('we-history-warning').textContent=savedWarnings.length?'Saved reviews needing attention: '+savedWarnings.map(item=>item.id+' / '+item.code).join('; '):'';controls();
  }
  function controls(){
    const busy=state().busy||!state().status;for(const input of root.querySelectorAll('button,input,select,textarea'))input.disabled=busy;for(const binding of bindings)binding.control();
    $('we-suggest').disabled=busy||!selectedPlan()||!source(field('we-target'))||!field('we-initial-sheet');$('we-compare').disabled=busy||!formFresh()||!bindings.some(b=>b.key.checked);if(suggestion&&!formFresh())$('we-form-status').textContent='The saved mapping or publication changed. Read the replacement again to review the current revision.';$('we-remap').disabled=busy||!suggestion;
    const altered=reviewEdit!==null&&reviewEdit!==edit,ready=Boolean(report&&fresh()&&!altered&&!applied);
    $('we-review-state').textContent=applied?'Mapping saved':altered?'Selections changed':fresh()?'Ready to review':'Earlier revision';
    $('we-apply-description').textContent=applied?'This review produced a retained mapping. Open it to continue candidate preparation.':altered?'The form changed after this comparison. Compare the new selection before adopting it.':fresh()?'Save this exact reviewed selection as a new mapping on the replacement workbook.':'Source mappings or the current publication changed. Create a comparison against the current displayed revision.';
    $('we-reviewed').disabled=busy||!ready;$('we-apply').disabled=busy||!ready||!$('we-reviewed').checked;$('we-open-applied').hidden=!applied;
    $('we-export').disabled=$('we-export-page').disabled=$('we-kind').disabled=busy||!report;$('we-previous').disabled=busy||!page||page.offset===0;$('we-next').disabled=busy||!page||page.nextOffset===null;$('we-recover').disabled=busy||!pendingId;
  }
  function accept(data){refreshSources();if(data.workbookComparisons)setSaved(data.workbookComparisons);controls();}
  function error(err){if(!String(err.code??'').includes('WORKBOOK')&&!err.details)return;$('we-error').hidden=false;$('we-error').textContent=err.message+(err.details?'\n'+JSON.stringify(err.details,null,2):'');}
  $('we-baseline').addEventListener('change',()=>{plans();resetSelection();});for(const id of ['we-baseline-plan','we-target'])$(id).addEventListener('change',resetSelection);
  $('we-initial-sheet').addEventListener('change',()=>{suggestion=null;formBaseline=null;$('we-editor').hidden=true;changed();});
  $('we-source-form').addEventListener('submit',e=>{e.preventDefault();host.action('Reading replacement headers…',()=>suggest());});
  $('we-remap-form').addEventListener('submit',e=>{e.preventDefault();host.action('Reading the selected replacement headers…',()=>suggest(true));});
  for(const id of ['we-sheet','we-range','we-header','we-name','we-notes','we-hidden','we-blank','we-merged'])$(id).addEventListener('input',changed);
  $('we-compare-form').addEventListener('submit',e=>{
    e.preventDefault();if(!formFresh())return;const id=crypto.randomUUID();pendingId=id;$('we-pending').hidden=false;$('we-pending-label').textContent='Comparison '+id+' is being retained. Reopen this ID if its response is interrupted.';
    const input={id,...formBaseline,expectedTargetRevision:targetRevision,plan:readPlan(),keys:bindings.filter(b=>b.key.checked).map(b=>b.field),expectedSnapshot:schema.snapshot,expectedRevision:schema.revision};
    host.action('Comparing both complete workbook selections…',async()=>{const data=await host.api('workbook/editions/compare',input);host.accept(data);renderReport(data,true);setSaved(await host.api('workbook/editions/list',undefined,'GET'));host.notice('Complete workbook comparison saved. Review the totals and original cell changes.');});
  });
  $('we-reviewed').addEventListener('change',controls);
  $('we-apply').addEventListener('click',()=>{if(!report)return;const current=report;host.action('Saving the reviewed replacement mapping…',async()=>{
    const data=await host.api('workbook/editions/apply',{id:current.id,sha256:current.sha256,expectedTargetRevision:current.expectedTargetRevision,expectedSnapshot:current.nativeSchema.snapshot,expectedRevision:current.nativeSchema.revision});host.accept(data);applied={sourceId:data.source.id,planId:data.plan.id,planRevision:data.plan.revision};report=data.comparison??report;controls();host.notice('Replacement mapping saved. Open it to prepare the native candidate.');});
  });
  $('we-open-applied').addEventListener('click',()=>host.action('Opening the replacement mapping…',()=>host.openMapping(applied.sourceId,applied.planId,applied.planRevision)));
  $('we-kind').addEventListener('change',()=>host.action('Opening this row view…',()=>read(report.id,0,field('we-kind'))));
  $('we-previous').addEventListener('click',()=>host.action('Opening preceding rows…',()=>read(report.id,Math.max(0,page.offset-50),page.kind)));
  $('we-next').addEventListener('click',()=>host.action('Opening the next rows…',()=>read(report.id,page.nextOffset,page.kind)));
  $('we-close-detail').addEventListener('click',()=>{$('we-cell-detail').hidden=true;});
  $('we-recover').addEventListener('click',()=>host.action('Reopening the original comparison ID…',()=>read(pendingId)));
  $('we-refresh-history').addEventListener('click',()=>host.action('Reading retained comparisons…',async()=>{setSaved(await host.api('workbook/editions/list',undefined,'GET'));host.notice('Saved comparisons refreshed.');}));
  $('we-export-page').addEventListener('click',()=>host.download(JSON.stringify({comparisonId:report.id,comparisonSha256:report.sha256,page},null,2)+'\n','workbook-comparison-'+report.id+'-rows.json'));
  $('we-export').addEventListener('click',()=>host.action('Downloading the complete saved review…',async()=>{
    const response=await fetch('/api/workbook/editions/export',{method:'POST',headers:{authorization:'Bearer '+host.token(),'content-type':'application/json'},body:JSON.stringify({id:report.id}),redirect:'error',credentials:'omit'});
    if(!response.ok){const data=await response.json();throw Object.assign(new Error(data.message??data.error),{code:data.error,details:data.details});}host.download(await response.blob(),'workbook-comparison-'+report.id+'.json',response.headers.get('content-type')??'application/json');host.notice('Complete comparison downloaded with original source and mapping identities.');
  }));
  controls();return {accept,controls,error};
}
