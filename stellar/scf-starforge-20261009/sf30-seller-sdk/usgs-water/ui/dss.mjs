// MIT. Analyst controls in the original retained Water operations workspace.
export function mountDss({ api, notice, make, getState, refresh }) {
  const $ = id => document.getElementById(id);
  let source = null, mapping = null, preview = null;
  const fields = new Map(), completed = new Set();
  const copy = value => JSON.parse(JSON.stringify(value));
  function invalidate() { preview = null; $('dss-create').disabled = true; $('dss-preview-status').textContent = 'Review the current mapping before creating a native file.'; }
  function label(title, input, help) {
    const box = make('label', title); box.append(input); if (help) box.append(make('small', help)); return box;
  }
  function input(value, attrs = {}) { const el = make('input', null, attrs); el.value = value ?? ''; el.addEventListener('input', invalidate); return el; }
  function select(values, value) {
    const el = make('select'); for (const [key, title] of values) el.append(make('option', title, { value: key }));
    el.value = value; el.addEventListener('change', invalidate); return el;
  }
  function textArea(value, rows = 2) {
    const el = make('textarea', null, { rows, spellcheck: 'false' }); el.value = value ?? ''; el.addEventListener('input', invalidate); return el;
  }
  function action(work) {
    return async event => {
      event?.preventDefault();
      const button = event?.currentTarget, previous = button?.disabled;
      if (button?.tagName === 'BUTTON') button.disabled = true;
      try { await work(); } catch (error) { notice(error.message, true); if (error.detail?.conflicts) showConflicts(error.detail); }
      finally { if (button?.tagName === 'BUTTON' && button.isConnected) button.disabled = previous; }
    };
  }
  function defaultConfig(series) {
    const daily = series.collection === 'daily', mean = daily && series.statisticId === '00003';
    const units = series.unit === 'ft^3/s' ? 'CFS' : String(series.unit).toUpperCase();
    return { key: series.key, kind: daily ? 'regular' : 'irregular',
      path: { a: 'USGS', b: series.locationId.toUpperCase(), c: series.parameterCode === '00060' ? 'FLOW' : 'PARAM-' + series.parameterCode, f: 'REVIEWED-EDITION' },
      interval: daily ? '1Day' : 'Ir-Month', units,
      unitMeaning: series.unit === 'ft^3/s' ? 'CFS is the receiving spelling of the original ft^3/s; measurement values are unchanged.' : 'The receiving unit spelling preserves the original ' + series.unit + '; measurement values are unchanged.',
      dataType: mean ? 'PER-AVER' : daily ? 'PER-AVER' : 'INST-VAL',
      measurementMeaning: mean ? 'USGS statistic 00003: mean discharge during the original calendar day.' : '',
      time: { mode: daily ? 'calendar-day' : 'utc-instant', zone: daily ? '' : 'UTC', label: daily ? 'end-of-day' : null,
        basis: daily ? '' : 'Each original timestamp supplies its offset; native clocks are normalized to UTC.' },
      selection: { quality: 'all', window: null }, choices: {}, nativeNotes: 'approval', acceptBinary64: false };
  }
  function renderMapping() {
    const container = $('dss-series'); container.replaceChildren(); fields.clear();
    if (!source) return;
    for (const series of source.series) {
      const retained = mapping?.series?.find(item => item.key === series.key), config = copy(retained ?? defaultConfig(series));
      const box = make('section', null, { class: 'dss-series' }), daily = series.collection === 'daily';
      const include = input('', { type: 'checkbox' }); include.checked = Boolean(retained) || !mapping;
      include.addEventListener('change', invalidate);
      box.append(label(series.locationId + ' · ' + series.parameterCode + (series.statisticId ? ' / ' + series.statisticId : '') + ' · ' + series.unit, include));
      box.append(make('p', series.observations + ' original observations · ' + series.from + ' through ' + series.through + ' · ' +
        Object.entries(series.approvals).map(([name, count]) => name + ': ' + count).join(', '), { class: 'caption' }));
      const path = {};
      const pathBox = make('div', null, { class: 'two' });
      for (const [key, title] of [['a','A · basin or group'],['b','B · location'],['c','C · parameter'],['f','F · version']]) {
        path[key] = input(config.path[key], { maxlength: '64' }); pathBox.append(label(title, path[key]));
      }
      box.append(pathBox);
      const kind = select([['regular','Regular interval'],['irregular','Irregular observations']], config.kind);
      if (daily) kind.disabled = true;
      const interval = select((config.kind === 'regular' ? source.intervals : source.irregularBlocks).map(value => [value,value]), config.interval);
      if (daily) interval.disabled = true;
      kind.addEventListener('change', () => {
        interval.replaceChildren(...(kind.value === 'regular' ? source.intervals : source.irregularBlocks).map(value => make('option', value, { value })));
        interval.value = kind.value === 'regular' ? '15Minute' : 'Ir-Month';
      });
      const units = input(config.units, { maxlength: '39' });
      const type = select(['INST-VAL','INST-CUM','PER-AVER','PER-CUM'].map(value => [value,value]), config.dataType);
      const formatBox = make('div', null, { class: 'two' });
      formatBox.append(label('Record spacing', kind),label('Interval or physical block', interval),label('Receiving unit spelling', units),label('Measurement type', type)); box.append(formatBox);
      const unitMeaning = textArea(config.unitMeaning), meaning = textArea(config.measurementMeaning);
      box.append(label('Unit equivalence', unitMeaning, 'The exporter retains the values. It does not perform a unit conversion.'));
      box.append(label('Measurement and period meaning', meaning, 'PER-AVER describes the preceding interval. USGS daily mean statistic 00003 uses this type.'));
      const zone = input(config.time.zone, { placeholder: daily ? 'America/New_York' : 'UTC', maxlength: '39' }); zone.readOnly = !daily;
      const basis = textArea(config.time.basis, 3);
      box.append(label(daily ? 'Local calendar time zone' : 'Normalized time zone', zone,
        daily ? 'Choose the source station’s IANA zone. Each source date is labeled at the end of that local day; the original date remains attached.' : 'The original timestamp and its offset are retained alongside each UTC instant.'));
      box.append(label('Source clock convention and basis', basis, 'Record the source documentation and the analyst’s chosen period labeling.'));
      const quality = select([['all','All returned observations'],['approved','Approved only'],['provisional','Provisional only']], config.selection?.quality ?? 'all');
      const start = input(config.selection?.window?.start, { type: daily ? 'date' : 'text', placeholder: daily ? '' : 'ISO timestamp with offset' });
      const end = input(config.selection?.window?.end, { type: daily ? 'date' : 'text', placeholder: daily ? '' : 'ISO timestamp with offset' });
      const selection = make('div', null, { class: 'three' }); selection.append(label('Source approval selection', quality),label('From (optional)',start),label('Through (optional)',end)); box.append(selection);
      const notes = select([['approval','Original approval text'],['none','Keep full metadata in source only']],config.nativeNotes ?? 'none');
      box.append(label('Native short notes', notes, 'Full qualifiers always remain in the original edition. Native notes are never silently truncated.'));
      const accept = input('', { type: 'checkbox' }); accept.checked = config.acceptBinary64 === true; accept.addEventListener('change',invalidate);
      box.append(label('Use native double-precision numbers and retain the original decimal text', accept));
      const advanced = make('details'), qualityWords = textArea(config.qualityWords === undefined ? '' : JSON.stringify(config.qualityWords,null,2),3);
      advanced.append(make('summary','Optional analyst quality coding'),label('Explicit quality words (JSON)',qualityWords,
        'Leave blank to avoid assigning numerical quality meaning. Keys are JSON pairs [approval,qualifier]; each value is one signed 32-bit word. Missing grid positions use the key missing-grid-position.')); box.append(advanced);
      fields.set(series.key,{ include,path,kind,interval,units,type,unitMeaning,meaning,zone,basis,quality,start,end,notes,accept,qualityWords,config });
      container.append(box);
    }
    $('dss-mapping-area').hidden = false; $('dss-preview').disabled = false;
    invalidate();
  }
  function collect() {
    if (!source) throw new Error('Load an original edition first.');
    const selected = [], excludedSeries = [];
    for (const series of source.series) {
      const f = fields.get(series.key);
      if (!f.include.checked) { excludedSeries.push(series.key); continue; }
      const window = {};
      if (f.start.value) window.start = f.start.value; if (f.end.value) window.end = f.end.value;
      const daily = series.collection === 'daily';
      selected.push({ key: series.key, kind: f.kind.value, path: Object.fromEntries(Object.entries(f.path).map(([key,input])=>[key,input.value.trim()])),
        interval: f.interval.value, units:f.units.value.trim(),unitMeaning:f.unitMeaning.value.trim(),dataType:f.type.value,
        measurementMeaning:f.meaning.value.trim(),time:{mode:daily?'calendar-day':'utc-instant',zone:f.zone.value.trim(),label:daily?'end-of-day':null,basis:f.basis.value.trim()},
        selection:{quality:f.quality.value,window:Object.keys(window).length?window:null},choices:f.config.choices??{},
        nativeNotes:f.notes.value,acceptBinary64:f.accept.checked,
        ...(f.qualityWords.value.trim()?{qualityWords:JSON.parse(f.qualityWords.value)}:{}) });
    }
    return { schema:'starforge.usgs-dss-mapping.v1',title:$('dss-title').value.trim(),excludedSeries,series:selected };
  }
  async function loadEdition(retained) {
    const id = $('dss-edition').value;
    if (!id) throw new Error('Choose an immutable source edition.');
    source = await api('/api/dss/source/' + encodeURIComponent(id));
    mapping = retained ?? null;
    if (retained) $('dss-title').value = retained.title;
    else if (!$('dss-title').value.trim()) $('dss-title').value = 'USGS analyst handover';
    $('dss-source-summary').textContent = source.source.rowCount + ' retained source rows · ' + source.source.operationId;
    renderMapping(); $('dss-conflicts').replaceChildren(); $('dss-plan').replaceChildren();
  }
  function showConflicts(detail) {
    const container = $('dss-conflicts');container.replaceChildren(make('h3','Choose the original record at each repeated timestamp'));
    for (const conflict of detail.conflicts) {
      const choice = select([['','Select the source record'],...conflict.choices.map(row=>[row.rowId,
        String(row.value??'(missing)')+' · '+String(row.approval??'no approval')+' · '+String(row.lastModified??row.featureId)])],'');
      choice.addEventListener('change',()=>{fields.get(detail.key).config.choices[conflict.clock]=choice.value;invalidate();});
      container.append(label(conflict.clock,choice));
    }
  }
  function showPlan(plan) {
    const container=$('dss-plan');container.replaceChildren();
    container.append(make('h3','Receiving plan'),make('p',plan.totals.sourceObservations+' selected source observations → '+plan.totals.nativeValues+
      ' DSS positions. '+plan.totals.insertedMissingPositions+' absent grid positions will carry the native missing flag.'));
    const table=make('table'),head=make('tr');
    for(const name of ['DSS dataset','Source / native','Clock meaning','Missing positions'])head.append(make('th',name));
    table.append(make('thead'));table.firstChild.append(head);const body=make('tbody');
    for(const series of plan.series){
      const config=plan.mapping.series.find(row=>row.key===series.key),tr=make('tr');
      for(const value of [series.pathname,series.selectedSourceRows+' / '+series.nativeCount,
        series.firstClock+' through '+series.lastClock+' · '+config.time.zone,series.insertedMissingPositions])tr.append(make('td',value));
      body.append(tr);
    }
    table.append(body);const scroll=make('div',null,{class:'table-wrap',role:'region',tabindex:'0','aria-label':'DSS receiving plan. Scroll horizontally to view every column.'});scroll.append(table);container.append(scroll);
    container.append(make('small','Scroll the table horizontally to inspect the complete pathname and clock window.',{class:'dss-table-help'}));
    if(plan.comparison)container.append(make('p','Previous source: '+Object.entries(plan.comparison.counts).map(([key,value])=>key+': '+value).join(' · ')));
    const details=make('details');details.append(make('summary','Source and mapping identifiers'),make('pre',JSON.stringify({source:plan.source,mappingSha256:plan.mappingSha256,planSha256:plan.planSha256},null,2)));container.append(details);
    $('dss-json').value=JSON.stringify(plan.mapping,null,2);$('dss-preview-status').textContent='The complete mapping is ready to create or reopen under the chosen export name.';
    $('dss-create').disabled=false;
  }
  async function prepare() {
    mapping=collect();
    preview=await api('/api/dss/preview',{editionId:$('dss-edition').value,mapping,previousExportId:$('dss-previous').value||undefined});
    $('dss-conflicts').replaceChildren();showPlan(preview);
  }
  function fileLink(id,kind,title) {
    return make('a',title,{href:'/api/dss/'+encodeURIComponent(id)+'/files/'+kind,class:'download'});
  }
  function renderExports(state) {
    const container=$('dss-exports');container.replaceChildren();
    const exports=state.dssExports??[];
    if(!exports.length)container.append(make('p','Completed native handovers and interrupted operations will appear here.',{class:'empty'}));
    for(const row of exports){
      const running=(state.jobs??[]).some(job=>job.id==='dss-'+row.exportId&&job.status==='RUNNING');
      const box=make('section',null,{class:'record'});
      box.append(make('strong',row.title??row.exportId),make('p',row.exportId+' · '+(running?'RUNNING':row.status)));
      if(row.totals)box.append(make('small',row.totals.sourceObservations+' original observations · '+row.totals.nativeValues+' native positions'));
      if(row.error)box.append(make('p',row.error.message));
      const controls=make('div',null,{class:'actions'});
      const reopen=make('button',row.status==='READY'?'Open saved mapping':'Reopen interrupted work',{type:'button'});
      reopen.addEventListener('click',action(async()=>{
        const saved=await api('/api/dss/'+encodeURIComponent(row.exportId)),plan=saved.plan??saved;
        $('dss-edition').value=plan.source.workspaceEditionId??plan.source.editionId;
        $('dss-export-id').value=row.exportId;$('dss-previous').value=plan.previous?.exportId??'';
        await loadEdition(plan.mapping);await prepare();
      }));controls.append(reopen);
      if(row.status==='READY'){
        controls.append(fileLink(row.exportId,'dss','Native DSS file'),fileLink(row.exportId,'report','Analyst report'),fileLink(row.exportId,'rows','Observation mapping'));
        const verify=make('button','Verify native receiving',{type:'button'});
        verify.addEventListener('click',action(async()=>{await api('/api/dss/'+encodeURIComponent(row.exportId)+'/verify',{});await refresh();}));controls.append(verify);
        const handover=make('button','Prepare complete handover',{type:'button'});
        handover.addEventListener('click',action(async()=>{await api('/api/dss/'+encodeURIComponent(row.exportId)+'/handover',{});await refresh();}));controls.append(handover);
        controls.append(fileLink(row.exportId,'handover','Download complete handover'));
      }
      box.append(controls);container.append(box);
    }
    for(const job of state.jobs??[]){
      if(!job.id.startsWith('dss-')||['RUNNING','FAILED'].includes(job.status)||completed.has(job.id+job.startedAt))continue;
      completed.add(job.id+job.startedAt);
      if(job.id.startsWith('dss-verify-'))notice('Native receiving verified. The retained DSS file is unchanged.');
      else if(job.id.startsWith('dss-handover-'))notice('The complete DSS and original-source handover is ready to download.');
      else notice('The native DSS export is ready.');
    }
  }
  function updateChoices(selectId,rows,key,label) {
    const target=$(selectId),current=target.value;
    target.replaceChildren(make('option',selectId==='dss-previous'?'No preceding export':'Choose a saved edition',{value:''}));
    for(const row of rows)target.append(make('option',label(row),{value:key(row)}));
    if([...target.options].some(option=>option.value===current))target.value=current;
  }
  function update(state) {
    updateChoices('dss-edition',(state.editions??[]).filter(row=>row.status==='READY'),row=>row.workspaceEditionId,row=>row.workspaceEditionId+' · '+row.rowCount+' original rows');
    updateChoices('dss-previous',(state.dssExports??[]).filter(row=>row.status==='READY'),row=>row.exportId,row=>row.exportId+' · '+row.source.operationId);
    renderExports(state);
  }
  $('dss-load').addEventListener('click',action(()=>loadEdition()));
  $('dss-edition').addEventListener('change',()=>{source=null;mapping=null;fields.clear();$('dss-mapping-area').hidden=true;invalidate();});
  $('dss-previous').addEventListener('change',invalidate);$('dss-title').addEventListener('input',invalidate);
  $('dss-preview').addEventListener('click',action(prepare));
  $('dss-create').addEventListener('click',action(async()=>{
    if(!preview)throw new Error('Review the complete source mapping first.');
    const exportId=$('dss-export-id').value.trim();
    if(!exportId)throw new Error('Choose a stable export name.');
    await api('/api/dss/exports',{editionId:$('dss-edition').value,exportId,mapping:preview.mapping,
      expectedPlanSha256:preview.planSha256,previousExportId:$('dss-previous').value||undefined});
    notice('Native DSS generation and receiving have started. This original operation can be reopened.');await refresh();
  }));
  $('dss-apply-json').addEventListener('click',action(async()=>{
    if(!source)await loadEdition();
    const value=JSON.parse($('dss-json').value);
    if(value.schema!=='starforge.usgs-dss-mapping.v1'||!Array.isArray(value.series))throw new Error('Choose a complete DSS mapping JSON.');
    mapping=value;$('dss-title').value=value.title;renderMapping();notice('The supplied mapping is loaded for review.');
  }));
  $('dss-mapping-file').addEventListener('change',action(async()=>{
    const file=$('dss-mapping-file').files[0];if(!file)return;
    if(file.size>2*1024*1024)throw new Error('The mapping exceeds the workspace request limit.');
    $('dss-json').value=await file.text();$('dss-apply-json').click();
  }));
  $('dss-runtime').addEventListener('click',action(async()=>{
    $('dss-runtime-status').textContent='Checking the selected native runtime…';
    const result=await api('/api/dss/runtime',{});
    $('dss-runtime-status').textContent=result.status==='READY'?'Official native HEC-DSS7 binding is ready.':'Native runtime: '+result.status;
  }));
  $('dss-receive-form').addEventListener('submit',action(async()=>{
    const file=$('dss-receive-file').files[0];if(!file)throw new Error('Choose a complete DSS handover ZIP.');
    $('dss-receive-status').textContent='Receiving and reopening the complete archive…';
    const response=await fetch('/api/dss/receive',{method:'POST',headers:{'content-type':'application/zip','x-workspace-token':getState()?.token??''},body:file});
    const result=await response.json();if(!response.ok||result.error)throw new Error(result.error?.message??'The handover could not be received.');
    $('dss-receive-status').textContent='Received '+result.exportId+' with its original edition. '+(result.reopened?'The same existing work was reopened.':'The saved work is ready.');
    await refresh();
  }));
  $('dss-export-id').value='dss-'+new Date().toISOString().replace(/[-:]/g,'').slice(0,15).replace('T','-');
  return { refresh:update };
}
