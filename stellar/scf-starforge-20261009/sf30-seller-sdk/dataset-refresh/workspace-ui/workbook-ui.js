// MIT. Workbook controls compose the existing merchant state and action lock.
function createWorkbookControls(host) {
  const $=id=>document.getElementById(id), el=(tag,value,cls)=>{
    const n=document.createElement(tag);if(value!==undefined)n.textContent=value;if(cls)n.className=cls;return n;};
  const copy=value=>structuredClone(value),short=value=>String(value??'').slice(0,12);
  const state=()=>host.getState(),all=()=>state().workspace?.workbookSources??[];
  let current=null,plan=null,sourceRevision=null,planRevision=null,schema=null,runtime=null;
  let historical=false,dirty=true,inspection=null,inspected=null,generation=0,lastSchemaHash=null;
  const fieldRows=[];
  const originalId=()=>current?.id??null;
  const number=value=>value===''?null:Number(value);
  const option=(value,label)=>{const x=el('option',label);x.value=value;return x;};
  const select=(items,value,label)=>{
    const x=el('select');x.setAttribute('aria-label',label);
    for(const [v,t]of items)x.append(option(v,t));x.value=value;return x;};
  const button=(label,fn,cls='small-button')=>{
    const x=el('button',label,cls);x.type='button';x.addEventListener('click',fn);return x;};
  const message=(value,kind)=>host.notice(value,kind);
  const pins=()=>schema?{expectedSnapshot:schema.snapshot,expectedRevision:schema.revision}:null;
  const field=id=>$(id).value;
  const selection=()=>({id:originalId(),sheet:field('wb-sheet'),range:field('wb-range').trim().toUpperCase()});
  const sameSelection=()=>inspected&&['id','sheet','range'].every(k=>inspected[k]===selection()[k]);
  function markDirty(){
    dirty=true;$('wb-errors').hidden=true;renderPlanState();controls();
  }
  function renderPlanState(){
    const actual=current&&all().find(x=>x.id===current.id);
    const sourceChanged=actual&&actual.revision!==sourceRevision;
    const stale=plan&&schema&&(plan.expectedSnapshot!==schema.snapshot||plan.expectedRevision!==schema.revision||plan.configHash!==schema.configHash);
    $('wb-plan-state').textContent=sourceChanged?'Saved source changed':historical?'Retained historical edition':dirty?'Unsaved changes':stale?'Earlier native review':`Mapping edition ${planRevision}`;
    $('wb-plan-warning').textContent=historical?'This is the candidate’s exact earlier mapping edition. Download it or copy its choices into a new mapping; the later saved edition stays intact.':sourceChanged?'Another action saved a mapping for this source. Reopen the saved source before saving your edits.':
      dirty?'Review the original cells, public fields and conversion choices, then save this mapping.':
      stale?'This saved mapping belongs to an earlier publication review. Its existing candidate can reopen; save a new edition to prepare against the displayed current schema.':
      plan?`Saved against native revision ${plan.expectedRevision} / ${plan.expectedSnapshot}.`:'Save the explicit source mapping before preparing a candidate.';
  }
  function renderSources(){
    const tbody=$('wb-sources').tBodies[0];tbody.replaceChildren();
    for(const source of [...all()].reverse()){
      const row=el('tr',undefined,current?.id===source.id?'candidate-selected':undefined),name=el('td');
      name.append(el('strong',source.filename),el('div',source.sha256,'small mono wrap'));
      row.append(name,el('td',`${source.workbook.sheets.length} sheets / ${source.sourceBytes.toLocaleString()} bytes`),
        el('td',String(source.plans.length)));
      const action=el('td'),open=button('Open workbook',()=>host.action('Opening the retained original workbook…',()=>openSource(source.id)));
      open.dataset.workbook=source.id;action.append(open);row.append(action);tbody.append(row);
    }
    $('wb-empty').hidden=all().length>0;
    const copySelect=$('wb-copy-select'),prior=copySelect.value;copySelect.replaceChildren(option('','Choose a source and mapping'));
    for(const source of all())for(const item of source.plans)
      copySelect.append(option(source.id+'/'+item.id,`${source.filename} / ${item.plan.name} / edition ${item.revision}`));
    copySelect.value=prior;
    const origin=state().draft?.workbookSource;
    $('wb-candidate-origin').hidden=!origin;
    if(origin)$('wb-candidate-summary').textContent=`${origin.filename} / ${origin.sheet}!${origin.range} / mapping edition ${origin.planRevision}\nSource SHA-256 ${origin.sourceSha256}`;
  }
  function sourceMetadata(){
    $('wb-source-title').textContent=current.filename;
    $('wb-source-id').textContent=`Source ${current.id} / SHA-256 ${current.sha256}`;
    const list=$('wb-source-details');list.replaceChildren();
    for(const [label,value]of [['Original bytes',current.sourceBytes.toLocaleString()],['Date system',current.workbook.epoch],
      ['Retained',current.createdAt],['External relationships',current.workbook.externalRelationships],
      ['Original calculation properties',JSON.stringify(current.workbook.calculationProperties)]]){
      list.append(el('dt',label),el('dd',String(value),'wrap'));
    }
  }
  function renderPlans(){
    const selected=$('wb-plan-select');selected.replaceChildren(option('','New mapping'));
    for(const item of current.plans)selected.append(option(item.id,`${item.plan.name} / edition ${item.revision}`));
    if(historical&&plan)selected.append(option(plan.id+'@'+plan.revision,`${plan.plan.name} / retained edition ${plan.revision}`));
    selected.value=historical?plan.id+'@'+plan.revision:plan?.id??'';
    const history=$('wb-history-content');history.replaceChildren();
    const editions=current.plans.flatMap(item=>[...(item.editions??[]),Object.fromEntries(Object.entries(item).filter(([k])=>k!=='editions'))]);
    if(!editions.length)history.append(el('p','No saved mapping editions.','small muted'));
    for(const edition of editions.reverse()){
      const line=el('div',undefined,'wb-history-row'),description=el('div');
      description.append(el('strong',`${edition.plan.name} / edition ${edition.revision}`),
        el('p',`${edition.plan.sheet}!${edition.plan.range} · native revision ${edition.expectedRevision} · ${edition.updatedAt}`,'small'),
        el('p',edition.plan.notes||'No review notes.','small muted'));
      line.append(description,button('Download mapping JSON',()=>{
        host.download(JSON.stringify(edition,null,2)+'\n','workbook-mapping-'+edition.id+'-'+edition.revision+'.json');}));
      history.append(line);
    }
  }
  function renderSchemaLabel(){
    $('wb-schema-label').textContent=schema?`Current native revision ${schema.revision} / ${schema.columns.length} declared fields. Original names, types and nullability remain unchanged.`:'Read the current native schema before mapping.';
  }
  function mapPair(container,value,changed){
    const row=el('div',undefined,'wb-value-row'),from=el('input'),to=el('input'),nullLabel=el('label',undefined,'wb-check'),nullValue=el('input');
    from.value=value.from;from.setAttribute('aria-label','Exact original value');from.placeholder='Original literal';
    to.value=value.to??'';to.setAttribute('aria-label','Replacement literal');to.placeholder='Replacement literal';
    nullValue.type='checkbox';nullValue.checked=value.to===null;nullLabel.append(nullValue,document.createTextNode('Null'));
    const remove=button('Remove',()=>{row.remove();changed();});
    row.append(from,to,nullLabel,remove);container.append(row);
    const sync=()=>{to.disabled=state().busy||nullValue.checked;changed();};
    nullValue.addEventListener('change',sync);from.addEventListener('input',changed);to.addEventListener('input',changed);
    row._mapping=()=>({from:from.value,to:nullValue.checked?null:to.value});
    row._controls=()=>{to.disabled=state().busy||nullValue.checked;};row._controls();
  }
  function renderMappings(bindings=[]){
    fieldRows.length=0;$('wb-mappings').replaceChildren();
    for(const spec of schema?.columns??[]){
      const old=bindings.find(x=>x.name===spec.name),record=el('section',undefined,'wb-field');
      record.dataset.field=spec.name;
      const heading=el('div',undefined,'section-head'),identity=el('div');
      identity.append(el('strong',spec.name),el('span',`${spec.type}${spec.nullable?' / nullable':''}`,'small muted'));
      heading.append(identity);record.append(heading);
      const basic=el('div',undefined,'wb-field-grid'),sourceLabel=el('label','Source column coordinate'),source=el('input');
      source.value=old?.source??'';source.placeholder='A';source.pattern='[A-Z]{1,3}';source.required=true;
      source.setAttribute('aria-label',spec.name+' source column');sourceLabel.append(source);
      const blankChoices=[['reject','Require a value'],...(spec.nullable?[['null','Original blank → null']]:spec.type==='string'?[['empty','Original blank → empty text']]:[])];
      const blank=select(blankChoices,old?.blank??'reject',spec.name+' blank cells');
      const formula=select([['reject','Require literal cells'],['cached','Use original saved cache'],...(spec.type==='string'?[['text','Keep original formula text']]:[])],old?.formula??'reject',spec.name+' formulas');
      const error=select([['reject','Require non-error cells'],['text','Keep error literal / apply value mapping'],...(spec.nullable?[['null','Excel error → null']]:[])],old?.error??'reject',spec.name+' errors');
      for(const [label,input]of [['Original blank cells',blank],['Original formulas',formula],['Original errors',error]]){
        const wrap=el('label',label);wrap.append(input);basic.append(wrap);}
      basic.prepend(sourceLabel);record.append(basic);
      const advanced=el('details'),summary=el('summary','Date / whitespace / exact value mappings'),area=el('div',undefined,'wb-transforms');
      const date=select([['raw','Preserve original serial or ISO token'],...(spec.type==='string'?[['iso-date','ISO date; refuse time loss'],['iso-datetime-ms','ISO datetime; half-even milliseconds']]:[])],old?.date??'raw',spec.name+' date conversion');
      const dateLabel=el('label','Date interpretation');dateLabel.append(date);
      const trimLabel=el('label',undefined,'wb-check'),trim=el('input');trim.type='checkbox';trim.checked=old?.trim??false;
      trimLabel.append(trim,document.createTextNode('Trim leading and trailing whitespace explicitly'));
      const mappings=el('div',undefined,'wb-values');
      for(const pair of old?.valueMap??[])mapPair(mappings,pair,markDirty);
      const add=button('Add exact value mapping',()=>{mapPair(mappings,{from:'',to:''},markDirty);markDirty();controls();});
      area.append(dateLabel,trimLabel,el('p','Saved formula caches are observations from the original file. Calendar conversion uses its retained date system and invents no timezone.','small muted'),mappings,add);
      advanced.append(summary,area);record.append(advanced);$('wb-mappings').append(record);
      for(const input of [source,blank,formula,error,date,trim])input.addEventListener('change',markDirty);
      source.addEventListener('input',markDirty);
      fieldRows.push({read:()=>({name:spec.name,source:source.value.trim().toUpperCase(),blank:blank.value,
        formula:formula.value,error:error.value,date:date.value,trim:trim.checked,
        valueMap:[...mappings.children].map(row=>row._mapping())}),controls:()=>{for(const row of mappings.children)row._controls();}});
    }
    lastSchemaHash=schema?.configHash;renderSchemaLabel();
  }
  function applyPlan(selected,isCopy=false){
    historical=!isCopy&&!!selected&&current.plans.find(x=>x.id===selected.id)?.revision!==selected.revision;
    plan=isCopy?null:selected?copy(selected):null;planRevision=plan?.revision??null;
    const saved=selected?.plan,oldSheet=saved?.sheet;
    $('wb-sheet').value=current.workbook.sheets.some(x=>x.name===oldSheet)?oldSheet:current.workbook.sheets[0]?.name??'';
    const meta=current.workbook.sheets.find(x=>x.name===field('wb-sheet'));
    $('wb-range').value=saved?.range??meta?.observedRange??'A1:A1';
    $('wb-header').value=saved?.headerRow??'';
    $('wb-plan-name').value=saved?.name?(isCopy?saved.name+' / copy':saved.name):current.filename.replace(/\.xlsx$/i,'')+' public projection';
    $('wb-notes').value=saved?.notes??'';
    $('wb-hidden').value=saved?.hiddenRows??'include';$('wb-blank-rows').value=saved?.blankRows??'skip';$('wb-merged').value=saved?.mergedCells??'reject';
    renderMappings(saved?.columns??[]);dirty=!plan;
    inspection=null;inspected=null;generation++;renderInspection();renderPlans();renderPlanState();controls();
  }
  async function openSource(id,requestedPlan,requestedRevision){
    const source=all().find(x=>x.id===id);if(!source)throw new Error('Refresh and choose a retained original workbook.');
    current=copy(source);sourceRevision=current.revision;$('wb-editor').hidden=false;$('wb-errors').hidden=true;
    const sheet=$('wb-sheet');sheet.replaceChildren();
    for(const item of current.workbook.sheets)sheet.append(option(item.name,`${item.name}${item.state!=='visible'?' / '+item.state:''}`));
    sourceMetadata();renderSources();
    let selected=current.plans.find(x=>x.id===requestedPlan)??(requestedPlan===null?null:current.plans.at(-1));
    if(requestedRevision!==undefined&&selected?.revision!==requestedRevision){
      selected=selected?.editions?.find(x=>x.revision===requestedRevision);
      if(!selected)throw new Error('The candidate’s original mapping edition is unavailable. Preserve its private source bundle for repair.');
    }
    applyPlan(selected);
    await inspectRows(0);$('wb-editor').scrollIntoView({block:'start'});
  }
  function renderInspection(){
    const head=el('tr');head.append(el('th','Row'));
    for(const col of inspection?.columns??[])head.append(el('th',col));
    $('wb-cells').tHead.replaceChildren(head);const body=$('wb-cells').tBodies[0];body.replaceChildren();
    for(const row of inspection?.rows??[]){
      const tr=el('tr');tr.append(el('th',String(row.row)+(row.hidden?' / hidden':'')));
      for(const cell of row.cells){
        const td=el('td'),raw=cell.value,shown=raw===null?(cell.present?'Blank cell':'Missing cell'):raw===''?'Empty text':raw;
        const b=button(String(shown).slice(0,160),()=>showCell(cell),'wb-cell');
        b.dataset.cell=cell.cell;b.title=`${cell.cell} / ${cell.type}${cell.formula?' / formula':''}`;
        td.append(b,el('span',`${cell.cell} · ${cell.type}${cell.formula?' · formula':''}${cell.dateStyle?' · date format':''}`,'wb-cell-meta'));tr.append(td);}
      body.append(tr);
    }
    if(inspection){
      const meta=inspection.metadata;
      $('wb-inspection-summary').textContent=`Original ${inspected.sheet}!${inspection.range} · ${meta.formulaCells} formula cells, ${meta.errorCells} errors, ${meta.hiddenRowCount} hidden rows and ${meta.mergedRangeCount} merged ranges in the worksheet. Choose a cell for exact source details.`;
      $('wb-page').textContent=`Source rows ${inspection.offset+1}–${inspection.offset+inspection.rows.length} of ${inspection.totalRows}`;
    }else{
      $('wb-inspection-summary').textContent='Inspect the selected source range before saving its public mapping.';
      $('wb-page').textContent='';
    }
  }
  function showCell(cell){
    const panel=$('wb-cell-content');panel.replaceChildren();$('wb-cell-detail').open=true;
    panel.append(el('h3',`${cell.cell} / ${cell.type}`));
    const detail=el('dl',undefined,'details');
    for(const [label,value]of [['Present original cell',cell.present?'Yes':'No'],['Hidden row',cell.hiddenRow?'Yes':'No'],
      ['Number format',cell.numberFormat??'No supplied format'],['Style index',cell.styleId??'No supplied style'],
      ['Original saved cache',cell.formula?(cell.cachedPresent?'Present':'Absent'):'Literal cell'],
      ['Formula attributes',cell.formula?JSON.stringify(cell.formula.attributes):'No formula']])
      detail.append(el('dt',label),el('dd',String(value),'wrap'));
    panel.append(detail);
    for(const [label,value]of [['Original literal value',cell.value],['Original XML value token',cell.raw],
      ...(cell.formula?[['Original formula text',cell.formula.text]]:[])]) {
      panel.append(el('label',label));const v=el('pre',value===null?'(absent)':value,'wb-literal');panel.append(v);
    }
  }
  async function inspectRows(offset){
    const request={...selection(),offset,limit:25},serial=++generation;
    const data=await host.api('workbook/inspect',request);
    if(serial!==generation||request.id!==originalId())return;
    host.accept(data);inspection=data.inspection;inspected={id:request.id,sheet:request.sheet,range:inspection.range};
    $('wb-range').value=inspection.range;renderInspection();controls();
  }
  function readPlan(){
    return {name:field('wb-plan-name'),notes:field('wb-notes'),sheet:field('wb-sheet'),
      range:field('wb-range').trim().toUpperCase(),headerRow:number(field('wb-header')),
      hiddenRows:field('wb-hidden'),blankRows:field('wb-blank-rows'),mergedCells:field('wb-merged'),
      columns:fieldRows.map(row=>row.read())};
  }
  function controls(){
    const busy=state().busy,ready=!!state().status;
    for(const input of $('workbook-panel').querySelectorAll('button,input,select,textarea'))input.disabled=busy||!ready;
    for(const row of fieldRows)row.controls();
    $('wb-copy').disabled=busy||!current||!field('wb-copy-select');
    $('wb-previous').disabled=busy||!sameSelection()||!inspection||inspection.offset===0;
    $('wb-next').disabled=busy||!sameSelection()||!inspection||inspection.nextOffset===null;
    $('wb-prepare').disabled=busy||!plan||dirty||historical;
    $('wb-save-plan').disabled=busy||!current||!schema||historical;
    $('wb-copy-edition').hidden=!historical;
    $('wb-private-export').disabled=busy||!state().draft?.workbookSource;
  }
  function accept(data){
    if(data.workbookSchema)schema=copy(data.workbookSchema);
    if(data.workbookRuntime)runtime=data.workbookRuntime;
    if(runtime)$('wb-runtime').textContent=`Original XLSX limit ${runtime.limits.sourceBytes.toLocaleString()} bytes. Extractor ${runtime.parser} / ${short(runtime.parserSha256)}. Python ${runtime.python}; no workbook recalculation.`;
    renderSources();
    if(current&&!all().some(x=>x.id===current.id)){
      current=null;plan=null;generation++;inspection=null;inspected=null;$('wb-editor').hidden=true;
    }
    if(current&&schema?.configHash!==lastSchemaHash){
      const values=fieldRows.map(x=>x.read());renderMappings(values);dirty=true;
    }
    renderSchemaLabel();renderPlanState();controls();
  }
  function error(error){
    if(!error.code?.startsWith('WORKBOOK')&&!error.code?.startsWith('INVALID_WORKBOOK')&&!error.details?.issues)return;
    const panel=$('wb-errors');panel.hidden=false;panel.replaceChildren(el('strong',error.message));
    for(const item of error.details?.issues??[])panel.append(el('p',`${item.cell} → ${item.field}: ${item.message}${item.sourceValue===null?'':` Original: ${String(item.sourceValue)}${item.sourceValueTruncated?'…':''}`}`));
    if(error.details?.range)panel.append(el('p','Merged range '+error.details.range));
  }
  async function binary(path,payload,fallback){
    const response=await fetch('/api/'+path,{method:'POST',headers:{authorization:'Bearer '+host.token(),'content-type':'application/json'},
      body:JSON.stringify(payload),redirect:'error',credentials:'omit'});
    if(!response.ok){const value=await response.json();throw Object.assign(new Error(value.message||value.error),{code:value.error,details:value.details,status:response.status});}
    let name=fallback;const disposition=response.headers.get('content-disposition')??'',match=/filename\*=UTF-8''([^;]+)/i.exec(disposition);
    try{if(match)name=decodeURIComponent(match[1]);}catch{}
    if(/[\\/\x00-\x1f\x7f]/.test(name))name=fallback;
    host.download(await response.blob(),name,response.headers.get('content-type')??'application/octet-stream');
  }
  $('wb-upload-form').addEventListener('submit',event=>{
    event.preventDefault();const file=$('wb-file').files[0];if(!file)return;
    host.action('Retaining and inspecting the original workbook…',async()=>{
      const data=await host.api('workbook',file,'PUT',{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','x-upload-name':encodeURIComponent(file.name)});
      host.accept(data);await openSource(data.source.id);$('wb-file').value='';message('Original workbook retained. Review its actual range and public column mapping.');
    });
  });
  $('wb-selection-form').addEventListener('submit',event=>{event.preventDefault();host.action('Reading the selected original cells…',()=>inspectRows(0));});
  for(const id of ['wb-sheet','wb-range','wb-header','wb-plan-name','wb-notes','wb-hidden','wb-blank-rows','wb-merged'])
    $(id).addEventListener('input',markDirty);
  $('wb-sheet').addEventListener('change',()=>{
    const meta=current.workbook.sheets.find(x=>x.name===field('wb-sheet'));
    $('wb-range').value=meta?.observedRange??'A1:A1';inspection=null;inspected=null;generation++;renderInspection();markDirty();
  });
  $('wb-plan-select').addEventListener('change',()=>{
    const [id,edition]=field('wb-plan-select').split('@');
    host.action('Opening the retained mapping edition…',async()=>{const item=current.plans.find(x=>x.id===id);applyPlan(edition?item?.editions?.find(x=>x.revision===Number(edition)):item);await inspectRows(0);});
  });
  $('wb-copy-select').addEventListener('change',controls);
  $('wb-copy').addEventListener('click',()=>{
    const [sourceId,planId]=field('wb-copy-select').split('/'),selected=all().find(x=>x.id===sourceId)?.plans.find(x=>x.id===planId);
    if(!selected)return;
    host.action('Copying mapping choices for explicit review on this source…',async()=>{applyPlan(selected,true);await inspectRows(0);message('Copied mapping choices. Inspect this original source and save a new reviewed mapping.');});
  });
  $('wb-copy-edition').addEventListener('click',()=>{applyPlan(plan,true);message('Historical mapping choices copied into a new review.');});
  $('wb-new-plan').addEventListener('click',()=>{applyPlan(null);message('New mapping ready for this retained original.');});
  $('wb-previous').addEventListener('click',()=>host.action('Reading the preceding original rows…',()=>inspectRows(Math.max(0,inspection.offset-inspection.limit))));
  $('wb-next').addEventListener('click',()=>host.action('Reading the next original rows…',()=>inspectRows(inspection.nextOffset)));
  $('wb-plan-form').addEventListener('submit',event=>{
    event.preventDefault();const payload={id:originalId(),planId:plan?.id??null,expectedSourceRevision:sourceRevision,
      expectedPlanRevision:planRevision,plan:readPlan(),...pins()};
    host.action('Saving the source mapping against the current native schema…',async()=>{
      const data=await host.api('workbook/plan',payload);host.accept(data);
      current=copy(data.source);sourceRevision=current.revision;plan=copy(data.plan);planRevision=plan.revision;dirty=false;
      renderPlans();renderPlanState();message('Exact source mapping and native revision saved. Prepare the original typed CSV candidate.');
    });
  });
  $('wb-prepare').addEventListener('click',()=>{
    const payload={id:originalId(),planId:plan?.id,expectedPlanRevision:planRevision};
    host.action('Preparing and validating the original native CSV candidate…',async()=>{
      const data=await host.api('workbook/prepare',payload);host.accept(data);
      await host.select(host.draftTarget(),host.savedQuery(host.draftTarget()));
      message(data.reused?'The same retained workbook candidate reopened.':'Workbook candidate prepared. Its native typed preview is ready for publication review.');
      $('draft-title').scrollIntoView({block:'start'});
    });
  });
  $('wb-original').addEventListener('click',()=>{
    const id=originalId(),name=current.filename;host.action('Downloading the unchanged original workbook…',async()=>{await binary('workbook/download',{id},name);message('Original workbook downloaded.');});
  });
  $('wb-remove').addEventListener('click',()=>{
    const payload={id:originalId(),expectedSourceRevision:sourceRevision};
    host.action('Removing the unused retained workbook…',async()=>{host.accept(await host.api('workbook/remove',payload));message('Unused original removed. Retained candidate sources cannot be removed.');});
  });
  $('wb-private-export').addEventListener('click',()=>{
    const id=state().draft?.id;if(!id)return;
    host.action('Preparing the exact private workbook source bundle…',async()=>{await binary('workbook/export',{candidateId:id},'workbook-private-source.zip');message('Private original workbook, exact candidate and mapping edition exported.');});
  });
  $('wb-candidate-source').addEventListener('click',()=>{
    const origin=state().draft?.workbookSource;if(!origin)return;
    host.action('Opening the selected candidate’s retained original source…',()=>openSource(origin.sourceId,origin.planId,origin.planRevision));
  });
  return {accept,controls,error,openSource};
}
