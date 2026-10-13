/* Upper Savannah parameter/scenario workflow. TokenJunkieLabs. */
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[c]));
const short = value => String(value ?? '').slice(0,12);
const numeric = value => value === null || value === undefined ? '—' :
  Number(value).toLocaleString(undefined, {maximumSignificantDigits:7});
const label = value => String(value ?? '').replaceAll('_',' ');
const pollutants = {nitrogen_export:'Nitrogen', phosphorus_export:'Phosphorus', sediment_export:'Sediment'};
const button = (action, text, id='', primary=false) =>
  '<button type="button" data-action="ensemble-design-'+escapeHTML(action)+'"'+
  (id?' data-id="'+escapeHTML(id)+'"':'')+' class="'+(primary?'primary':'')+'">'+escapeHTML(text)+'</button>';
const table = (headers, rows) => '<div class="table-scroll"><table><thead><tr>'+
  headers.map(x=>'<th>'+escapeHTML(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const cell = value => '<td>'+escapeHTML(value)+'</td>';
const field = (title, body, help='') => '<label class="field"><span>'+escapeHTML(title)+'</span>'+body+
  (help?'<small>'+escapeHTML(help)+'</small>':'')+'</label>';
const select = (name, values, title) => '<select name="'+escapeHTML(name)+'" required><option value="">'+
  escapeHTML(title)+'</option>'+values.map(x=>'<option value="'+escapeHTML(x.id)+'">'+
  escapeHTML(x.title||x.spec?.title||short(x.id))+'</option>').join('')+'</select>';
const referenceText = references => (Array.isArray(references)?references:[]).map(reference=>{
  if(typeof reference==='string')return reference;
  const value=reference?.url||reference?.citation||reference?.source_id||reference?.id||reference;
  return typeof value==='string'?value:JSON.stringify(value);
}).filter(Boolean).join('; ');
const choices = (name, rows, empty) => rows.length ? rows.map(row =>
  '<label class="check-row"><input type="checkbox" name="'+escapeHTML(name)+'" value="'+escapeHTML(row.id)+'">'+
  '<span><strong>'+escapeHTML(row.title||short(row.id))+'</strong><small>'+escapeHTML(row.reason||referenceText(row.references)||short(row.id))+
  '</small></span></label>').join('') : '<p class="note">'+escapeHTML(empty)+'</p>';

export function attachEnsembles(context) {
  const {getState, api, endpoint, openForm, submitAction, detail, toast, openItem, refresh, openDelivery, openScientificReport} = context;
  let root=null, generation=0, controller=null, catalog=null, axisCounter=0;
  let mountedWorkspace=null, rowSignature='', designVersion=0, receivedStudy=null;
  if(!document.querySelector('[data-view="ensembles"]')) {
    const navigation=document.createElement('button');
    navigation.type='button';
    navigation.dataset.view='ensembles';
    navigation.textContent='Scenario sensitivity';
    document.querySelector('[data-view="comparisons"]')?.after(navigation);
  }
  const currentWorkspace = () => getState()?.workspace_key;
  const form = () => document.querySelector('#operation-form');

  function detach() {
    generation++;
    controller?.abort();
    controller=null;
    root=null;
    mountedWorkspace=null;
    rowSignature='';
    receivedStudy=null;
    designVersion++;
  }

  function update(state) {
    if(!root || !catalog || state?.workspace_key!==mountedWorkspace)return;
    const data=state.data||{};
    const rows=data.ensembles;
    if(!Array.isArray(rows))return;
    catalog={...catalog,ensembles:rows,
      profiles:data.profiles||catalog.profiles,
      scenarios:data.scenarios||catalog.scenarios,
      grids:data.grids||catalog.grids};
    const signature=JSON.stringify(rows);
    if(signature!==rowSignature)draw(root,catalog);
  }

  async function mount(container) {
    const token=++generation, workspace=currentWorkspace();
    controller?.abort();
    controller=new AbortController();
    root=container;
    mountedWorkspace=workspace;
    if(!container.querySelector('[data-ensemble-page]')) {
      container.innerHTML='<div data-ensemble-page><header class="page-header"><div>'+
        '<p class="eyebrow">UPPER SAVANNAH SCIENTIFIC WORKBENCH</p><h1>Scenario sensitivity</h1>'+
        '<p>Compare land-cover choices across the selected scientific parameters.</p></div></header>'+
        '<p role="status">Opening retained designs and native run progress…</p></div>';
    }
    try {
      const result=await api(endpoint('/api/ensembles/catalog'), {signal:controller.signal});
      if(token!==generation || workspace!==currentWorkspace() || root!==container)return;
      catalog=result;
      draw(container,result);
      update(getState());
    } catch(error) {
      if(error.name==='AbortError' || token!==generation)return;
      container.innerHTML='<div data-ensemble-page><h1>Scenario sensitivity</h1><div class="notice error" role="alert">'+
        escapeHTML(error.message)+'</div>'+button('reload','Reload retained designs')+'</div>';
    }
  }

  function draw(container, data) {
    const rows=data.ensembles||[];
    rowSignature=JSON.stringify(rows);
    let html='<div data-ensemble-page><header class="page-header"><div><p class="eyebrow">'+
      'UPPER SAVANNAH SCIENTIFIC WORKBENCH</p><h1>Scenario sensitivity</h1><p>'+
      'Recalculate each baseline and alternative using the same parameter choices. Read the physical changes and their geographic coverage.'+
      '</p></div><div class="page-actions">'+button('new','New comparison design','',true)+'</div></header>';
    html+='<section class="section"><div class="section-body"><h2>What this answers</h2>'+
      '<p>Does a proposed land-cover change still reduce export when the selected scientific parameters change? '+
      'Each parameter case has its own matching baseline. Nitrogen and phosphorus retain kilograms per year; sediment retains tonnes per year.</p>'+
      '<p>Choose existing profiles to compare their retained coefficient tables, or add explicitly sourced parameter values. '+
      'The design shows its actual run count before execution.</p></div></section>';
    if(!rows.length) {
      html+='<div class="empty"><h2>Create the first paired design</h2><p>Use a complete model grid, a baseline, '+
        'the parameter profiles to explore, and any land-cover alternatives to compare.</p>'+
        button('new','Select existing inputs','',true)+'</div>';
    } else {
      html+=table(['Design','State','Parameter cases','Alternatives','Native runs',''],
        rows.map(row=>'<tr><td class="name-cell"><strong>'+escapeHTML(row.title)+'</strong><small>'+
          escapeHTML(row.reason||short(row.id))+'</small></td>'+cell(label(row.state))+
          cell(numeric(row.member_count))+cell(numeric(row.alternative_count))+
          cell(numeric(row.progress?.complete??row.completed_runs)+' / '+numeric(row.progress?.total??row.run_count))+
          '<td class="actions-cell">'+button('inspect','Open',row.id)+
          (row.state!=='complete'?button('run',row.state==='prepared'?'Run':'Continue',row.id):'')+'</td></tr>'));
    }
    html+='<section class="section"><div class="section-body"><h2>Explain it during the walkthrough</h2>'+
      '<p>“We keep the scientific assumptions attached to every run. This view shows whether the proposed land-cover '+
      'change has the same effect across the choices we selected, and lets us inspect and export every result.”</p></div></section></div>';
    container.innerHTML=html;
  }

  function axisRow(targets, selected=null) {
    const id='axis-'+(++axisCounter), selectedTargets=new Set(selected?.targets||[]);
    const selectedValues=selected?.values?.map(value=>String(value)).join(', ')||'';
    const references=(selected?.references||[]).map(reference=>
      typeof reference==='string'?reference:referenceText([reference])).join('\n');
    return '<fieldset class="full" data-ensemble-axis="'+id+'" data-axis-reference-records="'+
      escapeHTML(JSON.stringify(selected?.references||[]))+'"><legend>Parameter values</legend>'+
      '<div class="form-grid">'+field('Native parameter targets','<select data-axis-target multiple required size="4">'+
        targets.map(([key,meta])=>'<option value="'+escapeHTML(key)+'"'+(selectedTargets.has(key)?' selected':'')+'>'+escapeHTML(key)+
          (meta.units?' · '+escapeHTML(meta.units):'')+'</option>').join('')+'</select>',
        'Select multiple targets only when the same value must change together, such as matched NDR and SDR thresholds.')+
      field('Values to evaluate','<input data-axis-values required value="'+escapeHTML(selectedValues)+'" placeholder="Enter the actual selected values">',
        'Separate values with commas. Use mfd or d8 for a flow-routing choice; use numbers for physical parameters.')+
      field('Source references','<textarea data-axis-references required rows="3" placeholder="One source reference per line">'+escapeHTML(references)+'</textarea>')+
      field('Reason for this range','<textarea data-axis-reason required rows="3">'+escapeHTML(selected?.reason||'')+'</textarea>')+
      '</div>'+button('axis-remove','Remove parameter')+'</fieldset>';
  }

  function specFromForm() {
    const selected=form();
    const checked=name=>[...selected.querySelectorAll('input[name="'+name+'"]:checked')].map(x=>x.value);
    const baseline=selected.elements.namedItem('ensemble_baseline').value;
    const alternatives=checked('ensemble_alternative');
    const profiles=checked('ensemble_profile');
    if(!baseline || !profiles.length)
      throw Error('Select a baseline and at least one retained parameter profile.');
    const axes=[...selected.querySelectorAll('[data-ensemble-axis]')].map(row=>{
      const targets=[...row.querySelector('[data-axis-target]').selectedOptions].map(x=>x.value);
      const tokens=row.querySelector('[data-axis-values]').value.split(',').map(x=>x.trim());
      if(!targets.length || tokens.some(x=>!x))throw Error('Every parameter row needs selected targets and complete values.');
      const values=tokens.map(value=>{
        if(value==='mfd'||value==='d8')return value;
        const parsed=Number(value);
        if(!Number.isFinite(parsed))throw Error('Use finite numeric parameter values, or mfd/d8 for flow routing.');
        return parsed;
      });
      const referenceInput=row.querySelector('[data-axis-references]').value.trim();
      const retained=JSON.parse(row.dataset.axisReferenceRecords||'[]');
      const retainedDisplay=retained.map(reference=>
        typeof reference==='string'?reference:referenceText([reference])).join('\n').trim();
      const references=retained.length && referenceInput===retainedDisplay ? retained :
        referenceInput.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
      const reason=row.querySelector('[data-axis-reason]').value.trim();
      if(!references.length || !reason)throw Error('Retain the source and reason for every parameter range.');
      return {id:row.dataset.ensembleAxis,targets,values,references,reason};
    });
    return {
      title:selected.elements.namedItem('ensemble_title').value.trim(),
      reason:selected.elements.namedItem('ensemble_reason').value.trim(),
      grid_id:selected.elements.namedItem('ensemble_grid').value,
      baseline_scenario_id:baseline, alternative_scenario_ids:alternatives,
      ...(selected.elements.namedItem('ensemble_models').value==='grid'?{}:
        {models:selected.elements.namedItem('ensemble_models').value==='both'?['ndr','sdr']:
          [selected.elements.namedItem('ensemble_models').value]}),
      base_profile_ids:profiles,
      design:selected.elements.namedItem('ensemble_design').value, axes
    };
  }

  const recordModels = record => record?.spec?.models||record?.models||['ndr','sdr'];

  function selectedInputs() {
    const selected=form();
    const grid=(catalog?.grids||[]).find(item=>item.id===selected?.elements.namedItem('ensemble_grid')?.value);
    const profileIds=[...(selected?.querySelectorAll('input[name="ensemble_profile"]:checked')||[])].map(item=>item.value);
    const profiles=(catalog?.profiles||[]).filter(item=>profileIds.includes(item.id));
    const scope=selected?.elements.namedItem('ensemble_models')?.value||'grid';
    const models=scope==='grid'?(grid?recordModels(grid):['ndr','sdr']):
      scope==='both'?['ndr','sdr']:[scope];
    return {grid,profiles,models};
  }

  function compatibleStudies() {
    const {grid,profiles,models}=selectedInputs();
    return (catalog?.parameters?.studies||[]).filter(study=>{
      const requested=study.models||['ndr','sdr'];
      return requested.every(name=>models.includes(name)) &&
        (!grid || requested.every(name=>recordModels(grid).includes(name))) &&
        profiles.every(profile=>requested.every(name=>recordModels(profile).includes(name)));
    });
  }

  function refreshStudyChoices() {
    const choice=document.querySelector('#ensemble-study');
    if(!choice)return;
    const current=choice.value, studies=compatibleStudies();
    choice.innerHTML='<option value="">Choose a study</option>'+studies.map(study=>
      '<option value="'+escapeHTML(study.id)+'">'+escapeHTML(study.title)+'</option>').join('');
    if(studies.some(study=>study.id===current))choice.value=current;
    const question=document.querySelector('#ensemble-study-question');
    if(!studies.length && question)question.textContent='Choose a grid and profiles that share the models needed by a sourced study.';
    document.querySelector('#ensemble-preview').innerHTML='';
  }

  function studyChoices(studies) {
    if(!studies.length)return '';
    return '<div class="notice">'+field('Ready-to-use sourced study',
      '<select id="ensemble-study"><option value="">Choose a study</option>'+studies.map(study=>
        '<option value="'+escapeHTML(study.id)+'">'+escapeHTML(study.title)+'</option>').join('')+'</select>')+
      '<p class="note">Apply a study to fill its published parameter choices, sources and reasons. This replaces the parameter rows below. '+
      'Your selected grid, profiles and land-cover choices stay in this form.</p>'+
      button('study-apply','Apply selected study')+'<p id="ensemble-study-question"></p></div>';
  }

  function applyStudy() {
    const id=document.querySelector('#ensemble-study')?.value;
    const study=compatibleStudies().find(value=>value.id===id);
    if(!study)throw Error('Choose an available sourced study.');
    const targets=Object.entries(catalog?.parameters?.targets||{});
    if(!targets.length || !Array.isArray(study.axes) || !study.axes.length)
      throw Error('Reopen the comparison to load the complete sourced study.');
    document.querySelector('#ensemble-axes').innerHTML=study.axes.map(axis=>axisRow(targets,axis)).join('');
    const selected=form();
    selected.elements.namedItem('ensemble_design').value=study.design||'factorial';
    const requested=study.models||['ndr','sdr'];
    selected.elements.namedItem('ensemble_models').value=requested.length===2?'both':requested[0];
    const purpose=selected.elements.namedItem('ensemble_reason');
    if(!purpose.value.trim())purpose.value=study.question||study.title;
    document.querySelector('#ensemble-study-question').textContent=study.question||'';
    document.querySelector('#ensemble-preview').innerHTML='';
  }

  async function newDesign(selection={}) {
    if(!selection || typeof selection!=='object' || Array.isArray(selection))
      throw Error('Choose a retained study selection.');
    const workspace=currentWorkspace();
    const requestVersion=++designVersion;
    if(selection.workspace_key && selection.workspace_key!==workspace)
      throw Error('Open the workspace containing this retained profile comparison.');
    const data=await api(endpoint('/api/ensembles/catalog'));
    if(workspace!==currentWorkspace() || requestVersion!==designVersion)return;
    catalog=data;axisCounter=0;
    const grids=(data.grids||[]).filter(x=>x.state==='complete');
    const scenarios=data.scenarios||[];
    let profiles=data.profiles||[];
    const baselines=scenarios.filter(x=>x.kind==='baseline'), alternatives=scenarios.filter(x=>x.kind==='landcover');
    const retained=(name, rows, multiple=false)=>{
      const value=selection[name];
      if(value===undefined || value===null)return multiple?[]:null;
      const ids=multiple?value:[value];
      if(!Array.isArray(ids) || !ids.length || ids.some(id=>typeof id!=='string') ||
          new Set(ids).size!==ids.length || ids.some(id=>!rows.some(row=>row.id===id)))
        throw Error('Reopen the retained comparison: its '+name.replaceAll('_',' ')+' must belong to this workspace.');
      return multiple?ids:ids[0];
    };
    const selectedGrid=retained('grid_id',grids);
    const selectedBaseline=retained('baseline_scenario_id',baselines);
    const selectedProfiles=retained('base_profile_ids',profiles,true);
    const selectedAlternatives=Array.isArray(selection.alternative_scenario_ids) && selection.alternative_scenario_ids.length===0?[]:
      retained('alternative_scenario_ids',alternatives,true);
    const selectedModels=selection.models;
    if(selectedModels!==undefined) {
      if(!Array.isArray(selectedModels) || !selectedModels.length ||
          new Set(selectedModels).size!==selectedModels.length ||
          selectedModels.some(name=>!['ndr','sdr'].includes(name)))
        throw Error('Choose the retained nutrient and/or sediment model scope.');
      const requestedRecords=[
        ...(selectedGrid?[grids.find(row=>row.id===selectedGrid)]:[]),
        ...selectedProfiles.map(id=>profiles.find(row=>row.id===id))
      ];
      if(requestedRecords.some(row=>selectedModels.some(name=>!recordModels(row).includes(name))))
        throw Error('The retained source profiles and grid must support the selected models.');
    }
    for(const name of ['title','reason'])
      if(selection[name]!==undefined && typeof selection[name]!=='string')
        throw Error('Retain a text '+name+' for the comparison.');
    // The first selected source profile is the existing engine's reference.
    // Keep that ordering when the form collects its checked controls.
    if(selectedProfiles.length)profiles=[
      ...selectedProfiles.map(id=>profiles.find(row=>row.id===id)),
      ...profiles.filter(row=>!selectedProfiles.includes(row.id))
    ];
    if(!grids.length || !baselines.length || !profiles.length) {
      detail('Prepare the comparison inputs','<p>A paired design needs the following retained inputs:</p>'+
        table(['Input','Available'],[
          '<tr>'+cell('Complete model grid')+cell(grids.length)+'</tr>',
          '<tr>'+cell('Baseline scenario')+cell(baselines.length)+'</tr>',
          '<tr>'+cell('Optional land-cover alternatives')+cell(alternatives.length)+'</tr>',
          '<tr>'+cell('Parameter profiles')+cell(profiles.length)+'</tr>'])+
        '<p>Use Model grids, Land-cover scenarios and Parameter profiles to prepare the missing selections. '+
        'Their original sources and values stay attached to this comparison.</p>',{kind:'ensemble-inputs'});
      return;
    }
    const content='<div class="form-grid">'+
      field('Comparison title','<input name="ensemble_title" required>')+
      field('Model grid',select('ensemble_grid',grids,'Choose the complete reporting/model grid'))+
      field('Baseline',select('ensemble_baseline',baselines,'Choose the retained baseline'))+
      field('Models to compare','<select name="ensemble_models"><option value="grid">Use the selected grid models</option>'+
        '<option value="both">Nutrients and sediment</option><option value="ndr">Nutrients only</option>'+
        '<option value="sdr">Sediment only</option></select>',
        'Choose models supported by the selected grid and every profile. The preview checks the actual retained inputs.')+
      field('Parameter design','<select name="ensemble_design"><option value="one_at_a_time">One parameter axis at a time</option>'+
        '<option value="factorial">Every combination of the supplied values</option></select>',
        'With no extra parameter axes, the design compares the selected original profiles.')+
      '<div class="full">'+field('Purpose and comparison question','<textarea name="ensemble_reason" required rows="3"></textarea>')+'</div>'+
      '<fieldset class="full"><legend>Land-cover alternatives (optional)</legend>'+
        '<p class="note">Leave these unselected to compare at least two distinct parameter cases on the observed baseline.</p>'+
        choices('ensemble_alternative',alternatives,'Parameter-only designs can use the retained baseline.')+'</fieldset>'+
      '<fieldset class="full"><legend>Scientific parameter profiles</legend>'+choices('ensemble_profile',profiles,'Prepare a profile first.')+'</fieldset>'+
      '<section class="full"><h3>Optional sourced parameter exploration</h3><p class="note">Add the values you want to evaluate and their source. '+
      'Existing profile values remain the reference case.</p>'+studyChoices(data.parameters?.studies||[])+
      '<div id="ensemble-axes"></div>'+button('axis-add','Add parameter values')+'</section>'+
      '<div class="full">'+button('preview','Preview cases and run count')+'<div id="ensemble-preview" role="status" aria-live="polite"></div></div></div>';
    openForm('New paired scenario design','Retain the selected geography, land-cover choices and scientific assumptions together.',
      content,'Save design',async()=>{
        const spec=specFromForm();
        await api('/api/ensembles/preview',{method:'POST',body:{workspace,spec}});
        const result=await submitAction('ensemble.create',{spec});
        toast('The comparison design is saved. Open it to run the selected native calculations.');
        return result;
      },()=>{
        const selected=form();
        if(selection.title!==undefined)selected.elements.namedItem('ensemble_title').value=selection.title;
        if(selection.reason!==undefined)selected.elements.namedItem('ensemble_reason').value=selection.reason;
        if(selectedGrid)selected.elements.namedItem('ensemble_grid').value=selectedGrid;
        if(selectedBaseline)selected.elements.namedItem('ensemble_baseline').value=selectedBaseline;
        if(selectedModels)selected.elements.namedItem('ensemble_models').value=
          selectedModels.length===2?'both':selectedModels[0];
        for(const node of selected.querySelectorAll('[name="ensemble_profile"]'))
          node.checked=selectedProfiles.includes(node.value);
        for(const node of selected.querySelectorAll('[name="ensemble_alternative"]'))
          node.checked=selectedAlternatives.includes(node.value);
        for(const node of selected.querySelectorAll('[name="ensemble_grid"],[name="ensemble_profile"],[name="ensemble_models"]'))
          node.addEventListener('change',refreshStudyChoices);
        refreshStudyChoices();
      });
  }

  async function preview() {
    if(!form().reportValidity())return;
    const workspace=currentWorkspace(), version=designVersion, spec=specFromForm();
    const response=await api('/api/ensembles/preview',{
      method:'POST',body:{workspace,spec}
    });
    const result=response.preview, box=document.querySelector('#ensemble-preview');
    if(!box || workspace!==currentWorkspace() || version!==designVersion)return;
    if(JSON.stringify(spec)!==JSON.stringify(specFromForm())){
      box.innerHTML='<p class="note">The selection changed during the preview. Preview the updated choices.</p>';
      return;
    }
    box.innerHTML='<div class="notice"><strong>'+escapeHTML(numeric(result.member_count))+
      ' parameter cases · '+escapeHTML(numeric(result.run_count))+' native runs</strong><p>'+
      escapeHTML((result.selected_models||['ndr','sdr']).map(name=>name==='ndr'?'Nutrients':'Sediment').join(' and '))+'</p><p>'+
      escapeHTML(numeric(result.landcover_pair_count))+' paired land-cover comparisons · '+
      escapeHTML(numeric(result.parameter_pair_count))+' baseline parameter comparisons.</p>'+
      '<p>Saving retains the design. Use Run on the saved design to start the selected native calculations.</p></div>';
  }

  function pairTable(summary, kind='rows') {
    const parameter=kind==='sensitivity', rows=summary?.[kind]||[];
    if(!rows.length)return '<p class="note">'+(parameter?
      'Completed baseline parameter comparisons appear here when distinct parameter cases are selected.':
      'Completed land-cover comparisons appear here when alternatives are selected.')+'</p>';
    const members=new Map((summary.members||[]).map(x=>[x.id,x.label||short(x.id)]));
    const scenarios=new Map((summary.members||[]).flatMap(x=>(x.runs||[]).map(r=>[r.scenario_id,r.label||short(r.scenario_id)])));
    const headers=parameter?['Reference profile','Varied profile','Scenario']:['Parameter case','Alternative'];
    return table([...headers,'Pollutant',parameter?'Reference on common cells':'Baseline on common cells',
      parameter?'Varied on common cells':'Alternative on common cells','Annual change','Change %','Common cells','Unmatched cells'],
      rows.map(row=>'<tr>'+
        (parameter?cell(members.get(row.reference_member_id)||short(row.reference_member_id)):'')+
        cell(members.get(row.member_id)||short(row.member_id))+
        cell(scenarios.get(row.scenario_id)||short(row.scenario_id))+
        cell((pollutants[row.pollutant]||row.pollutant)+' · '+row.total_units)+
        cell(numeric(row.baseline_common))+cell(numeric(row.alternative_common))+
        cell(numeric(row.delta_common))+cell(numeric(row.percent_change))+
        cell(numeric(row.common_cells))+
        cell(numeric(row.baseline_only_cells)+(parameter?' reference / ':' baseline / ')+
          numeric(row.alternative_only_cells)+(parameter?' varied':' alternative'))+'</tr>'));
  }

  function downloadsHTML(files) {
    if(!files?.length)return '<p class="note">Generate a report to download its HTML, CSV, JSON and complete package.</p>';
    return '<div class="page-actions">'+files.map(file=>'<a class="button" href="'+escapeHTML(file.url)+
      '?download=1" download>'+escapeHTML(file.label||file.filename)+'</a>').join('')+'</div>';
  }


  const consumerRows = rows => !rows?.length ? '<p class="note">Use completed study runs for annual-load calibration or physical scenario decisions.</p>' :
    table(['Scientific result','State','Profiles','Outputs',''],rows.map(row=>'<tr>'+
      cell(row.title||label(row.mode))+cell(label(row.state))+
      cell(numeric(row.selected_member_count)+' / '+numeric(row.planned_member_count))+
      cell((row.pollutants||[]).map(name=>pollutants[name]||name).join(', '))+
      '<td>'+button('consumer-open','Open result',row.id)+'</td></tr>'));

  async function openConsumer(id) {
    const workspace=currentWorkspace(), version=++designVersion;
    const value=await api(endpoint('/api/ensembles/consumer',{consumer_id:id}));
    if(workspace!==currentWorkspace() || version!==designVersion)return;
    const plan=value.plan, result=value.result||{}, current=result.state||'prepared';
    let html='<div class="page-actions">'+button('consumer-open','Refresh saved result',id)+
      button('consumer-resume','Continue same handoff',id)+
      button('inspect','Open original study',plan.ensemble_id)+'</div>'+
      '<p>'+escapeHTML(label(plan.mode))+' · '+escapeHTML(label(current))+'</p>'+
      '<p>'+escapeHTML(numeric(plan.selected_member_count))+' selected profiles from '+
      escapeHTML(numeric(plan.catalog.planned_member_count))+' planned. Outputs: '+
      escapeHTML((plan.pollutants||[]).map(name=>pollutants[name]||name).join(', '))+'.</p>';
    if(result.error)html+='<div class="notice error" role="alert">'+escapeHTML(result.error.message)+'</div>';
    if(plan.mode==='calibration') {
      html+=table(['Original result','Saved identity'],[
        '<tr>'+cell('Calibration plan')+cell(plan.calibration_plan_id)+'</tr>',
        '<tr>'+cell('Calibration result')+cell(result.calibration_id||'Pending')+'</tr>',
        '<tr>'+cell('Selected native profile')+cell(result.selected_profile_id||'Pending')+'</tr>',
        '<tr>'+cell('Evaluated parameters')+cell((result.predicted_parameters||[]).join(', '))+'</tr>',
        '<tr>'+cell('Source-error sensitivity')+cell(result.selection_sensitivity?.state||result.uncertainty_state||'Not selected')+'</tr>']);
      if(result.candidate_failures?.length)html+='<h3>Candidate results needing attention</h3><pre class="json-view">'+
        escapeHTML(JSON.stringify(result.candidate_failures,null,2))+'</pre>';
    } else {
      html+='<p>Avoided export is baseline minus alternative. Positive values mean lower modeled export. '+
        'The original decision report includes its shared geographic support, units and supplied costs.</p>';
    }
    if(plan.mode==='calibration' && result.calibration_id) {
      const scientific=value.scientific_source;
      html+='<section class="section"><h3>Scientific report and original source package</h3>'+
        '<p>Publish this saved calibration with its original observations, physical quantities, source-error sensitivity, '+
        'daily-flow dates and qualifiers. The same typed content appears in PDF, HTML, Markdown and structured data.</p>'+
        '<div class="page-actions">'+button('scientific-prepare',
          scientific?.state==='complete'?'Refresh scientific report':'Prepare scientific report',id,true)+
        (scientific?.source?button('scientific-compose','Compose scientific report',id)+
          button('scientific-delivery','Include in delivery',id):'')+'</div>'+
        (scientific?.source?'<p class="note">Compose combines this saved source with other scientific studies in the Sources report draft. '+
          'The existing source order, title and contact remain editable.</p>':'')+
        (scientific?.error?'<div class="notice error">'+escapeHTML(scientific.error.message)+'</div>':'')+
        (scientific?.source?'<p>Registered scientific source: '+escapeHTML(scientific.source.source_id)+
          ' · '+escapeHTML(label(scientific.state))+'.</p>':'')+'</section>';
    }
    html+=annualReferenceHTML(plan.annual_reference);
    html+=flowSupportHTML(plan.flow_support);
    html+=downloadsHTML(value.downloads);
    html+='<details class="technical"><summary>Original handoff, pending members and scientific source identities</summary><pre class="json-view">'+
      escapeHTML(JSON.stringify({plan,result},null,2))+'</pre></details>';
    detail(plan.selection.title||'Saved scientific result',html,{kind:'ensemble-consumer',id});
  }


  async function scientificReport(selection={}) {
    const workspace=currentWorkspace(), version=++designVersion;
    if(selection.workspace_key && selection.workspace_key!==workspace)
      throw Error('Open the saved scientific source in its original workspace.');
    const value=await api(endpoint('/api/ensembles/scientific-source',{consumer_id:selection.consumer_id}));
    if(workspace!==currentWorkspace() || version!==designVersion)return;
    const prepared=value.scientific_report_selection;
    if(value.workspace_key!==workspace || prepared?.workspace_key!==workspace ||
        !Array.isArray(prepared.sources) || !prepared.sources.length)
      throw Error('Reopen this saved result with its current scientific source provider.');
    await refresh({force:true});
    if(workspace!==currentWorkspace() || version!==designVersion)return;
    return openScientificReport({
      workspace_key:workspace,
      sources:prepared.sources.map(row=>({
        source_collection_id:row.source_collection_id,source_id:row.source_id
      })),
      title:prepared.title
    });
  }

  async function studyScientificReport(selection={}) {
    const workspace=currentWorkspace(), version=++designVersion;
    if(selection.workspace_key && selection.workspace_key!==workspace)
      throw Error('Open this saved native study in its original workspace.');
    const value=await api(endpoint('/api/ensembles/study-source',{ensemble_id:selection.ensemble_id}));
    if(workspace!==currentWorkspace() || version!==designVersion)return;
    const prepared=value.scientific_report_selection;
    if(value.workspace_key!==workspace || prepared?.workspace_key!==workspace ||
        !Array.isArray(prepared.sources) || !prepared.sources.length)
      throw Error('Prepare the original native study scientific source before opening its composer.');
    await refresh({force:true});
    if(workspace!==currentWorkspace() || version!==designVersion)return;
    return openScientificReport({workspace_key:workspace,
      sources:prepared.sources.map(row=>({source_collection_id:row.source_collection_id,source_id:row.source_id})),
      title:prepared.title});
  }

  async function scientificDelivery(selection={}) {
    const workspace=currentWorkspace(), version=++designVersion;
    if(selection.workspace_key && selection.workspace_key!==workspace)
      throw Error('Open the saved scientific source in its original workspace.');
    const value=await api(endpoint('/api/ensembles/scientific-source',{consumer_id:selection.consumer_id}));
    if(workspace!==currentWorkspace() || version!==designVersion)return;
    const previous=JSON.parse(JSON.stringify(selection.delivery_selection||{}));
    const primary=previous.source_roles?.OBSERVED_CONTEXT;
    const choices=previous.observed_context_sources!==undefined?previous.observed_context_sources:(primary?[primary]:[]);
    if(!Array.isArray(choices))throw Error('The existing report selection needs an ordered scientific source list.');
    const source=value.source.source;
    const joined=[...choices];
    if(!joined.some(row=>row.source_collection_id===source.source_collection_id && row.source_id===source.source_id))
      joined.push(source);
    previous.observed_context_sources=joined;
    previous.source_roles={...(previous.source_roles||{}),OBSERVED_CONTEXT:joined[0]};
    delete previous.observed_context_binding;
    await refresh({force:true});
    if(workspace!==currentWorkspace() || version!==designVersion)return;
    return openDelivery(previous);
  }

  function annualReferenceHTML(reference) {
    if(!reference)return '';
    const summary=reference.summary||{};
    return '<section class="section"><h3>Original annual-load reference</h3><p><strong>'+
      escapeHTML(summary.title||reference.title)+'</strong> · '+escapeHTML(reference.source_edition)+
      ' · '+numeric(summary.admitted_count)+' admitted records</p><p>'+
      escapeHTML(summary.annualization_method||'')+'</p>'+
      table(['Constituent','Original unit','Comparison unit','Source period (end exclusive)','Original method','Records','Published SE'],
        (summary.period_method_groups||[]).map(row=>'<tr>'+cell(row.parameter)+cell(row.original_unit)+
          cell(row.comparison_unit)+cell(row.period_start+' → '+row.period_end_exclusive)+cell(row.method)+
          cell(row.records)+cell(row.published_standard_error_records)+'</tr>'))+
      '<p>Original catchments: '+escapeHTML((summary.catchment_ids||[]).join(', '))+
      '. Source-recommended temporal weighting: '+escapeHTML(summary.recommended_temporal_weighting)+'.</p>'+
      (summary.source_notes||[]).map(note=>'<p class="note">'+escapeHTML(note)+'</p>').join('')+
      '<details><summary>Original source and support identities</summary><pre class="json-view">'+
      escapeHTML(JSON.stringify({source_uri:summary.source_uri,release:summary.release,
        import_id:reference.import_id,observation_id:reference.binding?.observation_id,
        catchments:reference.binding?.catchments,catchment_source:reference.catchment_source,
        original_preparation_id:reference.original_preparation_id},null,2))+'</pre></details></section>';
  }

  function flowSupportHTML(support) {
    if(!support)return '';
    const rows=support.rows||[];
    return '<section class="section"><h3>Original daily-flow context</h3>'+
      '<p>'+escapeHTML(support.title||'Exact source periods')+' · '+
      escapeHTML(numeric(rows.length))+' original annual-reference records. Source interval: '+
      escapeHTML(support.source_period?.start)+' → '+escapeHTML(support.source_period?.end)+
      ' (end exclusive).</p>'+
      '<p>Daily coverage retains each reference’s original flow station, series and dates. '+
      'Covered-days volume uses the available numeric daily means. Annual calibration retains its original observations and temporal weighting.</p>'+
      table(['Record / constituent','Original observation / flow station','Source interval','Daily support','Numeric / requested days',
        'Outside source days','Approved / estimated / provisional days','Covered volume m³','Complete-period volume m³'],
        rows.map(row=>'<tr>'+cell(row.record_id+' · '+row.parameter)+
          cell((row.station_id||'Unspecified')+' / '+(row.flow_station_id||'Unresolved'))+
          cell(row.original_period_start+' → '+row.original_period_end)+cell(label(row.status))+
          cell(numeric(row.numeric_days)+' / '+numeric(row.expected_days))+cell(numeric(row.days_outside_captured_period))+
          cell(numeric(row.daily_summary?.approved_days)+' / '+numeric(row.daily_summary?.estimated_days)+' / '+
            numeric(row.daily_summary?.provisional_days))+cell(numeric(row.covered_days_volume_m3))+
          cell(numeric(row.complete_reference_period_volume_m3))+'</tr>'))+
      '<details><summary>Original flow sources and interpretation</summary><pre class="json-view">'+
      escapeHTML(JSON.stringify({source:support.source,source_operation_id:support.source_operation_id,
        source_originals:support.source_originals,methods:support.methods},null,2))+'</pre></details></section>';
  }

  async function openAnnualReference(selection={}) {
    const workspace=currentWorkspace(),version=++designVersion;
    if(selection.workspace_key && selection.workspace_key!==workspace)
      throw Error('Open the original annual import in its receiving workspace.');
    const data=await api(endpoint('/api/ensembles/annual-references'));
    if(workspace!==currentWorkspace() || version!==designVersion)return;
    const reference=(data.imports||[]).find(row=>row.import_id===selection.annual_import_id);
    if(!reference)throw Error('Choose a completed original annual-reference import in this workspace.');
    const rows=(data.ensembles||[]).map(row=>'<tr>'+cell(row.title)+cell(label(row.state))+
      cell(row.member_count)+cell(row.completed_runs+' / '+row.run_count)+
      '<td>'+button('inspect','Open study',row.id)+
      '<button type="button" data-action="ensemble-design-consumer-calibration" data-id="'+escapeHTML(row.id)+
      '" data-annual-import="'+escapeHTML(reference.import_id)+'">Evaluate this study</button></td></tr>');
    detail('Choose the saved scientific study',annualReferenceHTML(reference)+
      '<h3>Saved native parameter studies</h3><p>Choose the existing study whose completed baseline profiles you will evaluate against this original annual source. The next form selects its actual candidate profiles and outputs.</p>'+
      (rows.length?table(['Study','State','Profiles','Completed runs',''],rows):
        '<p>No saved scientific study is retained yet. Create its source profiles and native study in this same workspace.</p>'),
      {kind:'annual-reference',id:reference.import_id});
  }

  async function consumerForm(id, mode, prefill={}) {
    const workspace=currentWorkspace(), version=++designVersion;
    const data=await api(endpoint('/api/ensembles/consumers',{ensemble_id:id}));
    if(workspace!==currentWorkspace() || version!==designVersion)return;
    const study=data.catalog, ready=study.members.filter(member=>mode==='decision'?member.decision_ready:member.calibration_ready);
    if(!ready.length) {
      detail('Complete the selected native runs',
        '<p>This study currently has '+numeric(study.calibration_member_count)+' completed baseline candidates and '+
        numeric(study.decision_member_count)+' members with completed baseline/land-cover pairs.</p>'+
        '<p>'+escapeHTML(mode==='decision'?'A physical decision needs a completed matching baseline and land-cover alternative.':
          'Annual-load evaluation needs a completed baseline run and retained annual-load observations.')+'</p>'+
        button('inspect','Open saved native progress',id),{kind:'ensemble',id});
      return;
    }
    const members=ready.map(row=>({id:row.profile_id,title:row.label,
      reason:numeric(row.completed_scenario_count)+' completed alternatives; baseline '+short(row.baseline_run_id)}));
    const scope=study.expected_artifacts.filter(name=>ready.every(row=>
      (mode==='decision'?row.common_outputs:row.baseline_outputs).includes(name)));
    const scenarios=(data.scenarios||[]).filter(row=>study.scenario_ids.includes(row.id));
    const annualImports=data.annual_references?.imports||[];
    if(prefill.annual_import_id && !annualImports.some(row=>row.import_id===prefill.annual_import_id))
      throw Error('The original annual import is unavailable in this workspace.');
    const referenceChoices=[
      ...annualImports.map(row=>({id:'annual:'+row.import_id,title:'Imported source · '+row.title+' · '+row.source_edition})),
      ...(data.reference_selections||[]).map(row=>({id:'plan:'+row.id,title:'Saved evaluation · '+row.title}))];
    let content='<div class="form-grid">'+
      '<div class="full"><p>'+escapeHTML(study.title)+'. '+numeric(ready.length)+' usable profiles from '+
      numeric(study.planned_member_count)+' planned; unfinished runs retain their saved states.</p></div>'+
      field('Result title','<input name="consumer_title" required value="'+escapeHTML(study.title+(mode==='decision'?' — scenario decisions':' — annual-load evaluation'))+'">')+
      (mode==='decision'?field('Reference profile',select('consumer_reference',members,'Choose the original reference profile')):'')+
      '<fieldset class="full"><legend>Completed scientific profiles</legend>'+choices('consumer_profile',members,'')+'</fieldset>'+
      '<fieldset class="full"><legend>Physical outputs to evaluate</legend>'+
      choices('consumer_pollutant',scope.map(name=>({id:name,title:pollutants[name]})),'The selected members share no completed output.')+'</fieldset>';
    if(mode==='decision') {
      content+='<fieldset class="full"><legend>Original land-cover scenarios</legend>'+choices('consumer_scenario',scenarios,'')+'</fieldset>'+
        '<div class="full">'+field('Optional existing costs, targets and budget',
          '<textarea name="consumer_criteria" rows="5" spellcheck="false">{}</textarea>',
          'Use the original decision selection fields. Costs retain their source and exact primary run IDs. Leave {} for a physical edition.')+'</div>';
    } else {
      content+='<div class="full">'+field('Reuse an original annual-reference selection',
        '<select name="consumer_saved_references"><option value="">Select observations and catchments below</option>'+
        referenceChoices.map(row=>'<option value="'+escapeHTML(row.id)+'">'+escapeHTML(row.title)+'</option>').join('')+'</select>',
        'Imported sources preserve their exact observation and catchment binding. Saved evaluations retain their objectives, spatial groups and holdout choices.')+'</div>'+
        '<div class="full" id="ensemble-annual-reference-summary"></div>'+
        '<div class="full">'+field('Original daily-flow context',
          '<select name="consumer_flow_support"><option value="">Use annual reference alone</option></select>',
          'Choose existing exact-period source support, or replay the captured daily source for this original annual import.')+
          '<div id="ensemble-flow-prepare-control">'+button('flow-prepare','Prepare original flow context',id)+'</div></div>'+
        '<div class="full" id="ensemble-flow-support-summary"></div>'+
        field('Retained annual-load observations',select('consumer_observations',data.observations||[],'Choose an original annual-load edition'))+
        field('Original catchment source','<select name="consumer_catchments" required><option value="">Choose retained polygon geography</option>'+
          (data.catchment_sources||[]).map((row,index)=>'<option value="'+index+'">'+escapeHTML(row.title+' · '+row.id+' · '+short(row.collection_id))+'</option>').join('')+'</select>')+
        field('Original catchment identity field','<input name="consumer_id_field" required>',
          'The original polygon attribute whose values match the retained observation catchment IDs.')+
        field('Published standard-error multiplier (optional)','<input name="consumer_standard_errors" type="number" min="0" step="any">',
          'Uses the existing source-error sensitivity calculation after annual-load calibration. Leave blank to retain calibration alone.')+
        '<div class="full">'+field('Original reference options (optional JSON)',
          '<textarea name="consumer_reference_options" rows="5" spellcheck="false">{}</textarea>',
          'Optional observation_record_ids, objective, calibration/validation groups, catchment filters, external loads and temporal weighting. Existing saved selections can be reviewed below.')+'</div>';
    }
    content+='<div class="full"><details class="technical"><summary>Actual scientific cohort and source references</summary><pre class="json-view">'+
      escapeHTML(JSON.stringify(study,null,2))+'</pre></details></div></div>';
    openForm(mode==='decision'?'Physical scenario decisions':'Annual-load profile evaluation',
      mode==='decision'?'Use original completed same-profile comparisons and the existing physical/economic report.':
        'Compare completed baseline candidates with retained original annual loads and their source methods.',
      content,mode==='decision'?'Build decision report':'Evaluate baseline profiles',async()=>{
        const selected=form(), checked=name=>[...selected.querySelectorAll('[name="'+name+'"]:checked')].map(row=>row.value);
        const profileIds=checked('consumer_profile'), outputs=checked('consumer_pollutant');
        if(!profileIds.length || !outputs.length)throw Error('Select completed profiles and at least one actual output.');
        const parse=name=>{
          let value;try{value=JSON.parse(selected.elements.namedItem(name).value||'{}');}catch{throw Error('Enter valid JSON in the reference or criteria options.');}
          if(!value || Array.isArray(value) || typeof value!=='object')throw Error('Reference and criteria options must be JSON objects.');
          return value;
        };
        const payload={ensemble_id:id,profile_ids:profileIds,pollutants:outputs};
        const title=selected.elements.namedItem('consumer_title').value.trim();
        if(mode==='decision') {
          const reference=selected.elements.namedItem('consumer_reference').value;
          if(!profileIds.includes(reference))throw Error('Select the reference profile in the completed scientific profiles.');
          const scenarioIds=checked('consumer_scenario');
          if(!scenarioIds.length)throw Error('Select an original land-cover alternative.');
          Object.assign(payload,{reference_profile_id:reference,scenario_ids:scenarioIds,
            criteria:{...parse('consumer_criteria'),title}});
        } else {
          const saved=selected.elements.namedItem('consumer_saved_references').value;
          let reference;
          if(saved.startsWith('annual:')) {
            const retained=annualImports.find(row=>row.import_id===saved.slice(7));
            if(!retained)throw Error('Reopen the original annual-reference import.');
            payload.reference_import_id=retained.import_id;
            payload.reference_options={...parse('consumer_reference_options'),title};
            const flowChoice=selected.elements.namedItem('consumer_flow_support').value;
            if(flowChoice==='generate')payload.prepare_flow_support=true;
            else if(flowChoice) {
              const support=(data.flow_support?.sources||[]).find(row=>row.id===flowChoice &&
                row.import_id===retained.import_id && row.workspace_id===retained.workspace_id);
              if(!support)throw Error('Reopen the original flow-support source for this annual import.');
              payload.flow_support_source=support.source;
            }
          } else if(saved.startsWith('plan:')) {
            const retained=(data.reference_selections||[]).find(row=>row.id===saved.slice(5));
            if(!retained)throw Error('Reopen the original annual-reference selection.');
            reference=JSON.parse(JSON.stringify(retained.selection));
          } else {
            const sourceValue=selected.elements.namedItem('consumer_catchments').value;
            const source=sourceValue===''?null:(data.catchment_sources||[])[Number(sourceValue)];
            const observation=selected.elements.namedItem('consumer_observations').value;
            const fieldName=selected.elements.namedItem('consumer_id_field').value.trim();
            if(!source || !observation || !fieldName)throw Error('Select original observations, catchment geography and its matching identity field.');
            reference={observation_id:observation,catchments:{
              source_collection_id:source.collection_id,source_id:source.id,id_field:fieldName,
              ...(source.layer?{layer:source.layer}:{})}};
          }
          if(!payload.reference_import_id)payload.reference_selection={...reference,...parse('consumer_reference_options'),title};
          const raw=selected.elements.namedItem('consumer_standard_errors').value;
          if(raw!=='') {
            const value=Number(raw);
            if(!Number.isFinite(value)||value<0)throw Error('Use a finite nonnegative source-error multiplier.');
            payload.standard_errors=value;
          }
        }
        if(workspace!==currentWorkspace() || version!==designVersion)throw Error('Reopen this scientific form in its original workspace.');
        const result=await submitAction(mode==='decision'?'ensemble.decision':'ensemble.calibration',payload);
        toast('The original scientific consumer is queued. Open this study for its saved result and downloads.');
        return result;
      },()=>{
        const selected=form();
        for(const node of selected.querySelectorAll('[name="consumer_profile"],[name="consumer_pollutant"],[name="consumer_scenario"]'))node.checked=true;
        const first=study.members[0]?.profile_id;
        if(mode==='decision' && ready.some(row=>row.profile_id===first))selected.elements.namedItem('consumer_reference').value=first;
        if(mode==='calibration') {
          const choice=selected.elements.namedItem('consumer_saved_references');
          const flowChoice=selected.elements.namedItem('consumer_flow_support');
          const showFlow=()=>{
            const support=(data.flow_support?.sources||[]).find(row=>row.id===flowChoice.value);
            selected.querySelector('#ensemble-flow-support-summary').innerHTML=
              flowChoice.value==='generate'?'<p class="note">The original captured daily source will be replayed for this import’s exact admitted record periods, registered in this Workspace, and retained with the evaluation. Missing or unmatched source support remains explicit.</p>':
              flowSupportHTML(support);
          };
          flowChoice.addEventListener('change',showFlow);
          const showReference=()=>{
            const saved=!!choice.value;
            for(const name of ['consumer_observations','consumer_catchments','consumer_id_field']){
              selected.elements.namedItem(name).disabled=saved;
              selected.elements.namedItem(name).required=!saved;
            }
            const retained=(data.reference_selections||[]).find(row=>choice.value==='plan:'+row.id);
            const annual=annualImports.find(row=>choice.value==='annual:'+row.import_id);
            const box=selected.elements.namedItem('consumer_reference_options');
            box.value=retained?JSON.stringify(retained.selection,null,2):'{}';
            selected.querySelector('#ensemble-annual-reference-summary').innerHTML=annualReferenceHTML(annual);
            const supportRows=(data.flow_support?.sources||[]).filter(row=>annual &&
              row.import_id===annual.import_id && row.workspace_id===annual.workspace_id &&
              row.observation_id===annual.binding?.observation_id);
            flowChoice.innerHTML='<option value="">Use annual reference alone</option>'+
              (annual?'<option value="generate">Prepare original support and evaluate</option>':'')+
              supportRows.map(row=>'<option value="'+escapeHTML(row.id)+'">'+escapeHTML(row.title+' · '+
                numeric(row.record_count)+' records · '+short(row.source.collection_id))+'</option>').join('');
            flowChoice.disabled=!annual;
            selected.querySelector('#ensemble-flow-prepare-control').hidden=!annual;
            showFlow();
          };
          choice.addEventListener('change',showReference);
          if(prefill.annual_import_id)choice.value='annual:'+prefill.annual_import_id;
          showReference();
        }
      });
  }

  async function parameterStudies(id) {
    const workspace=currentWorkspace(), version=++designVersion, mounted=generation;
    const response=await api(endpoint('/api/parameter-studies/ensemble-studies',{id}));
    if(workspace!==currentWorkspace() || version!==designVersion || mounted!==generation)return;
    const preview=response.preview;
    if(response.workspace_key!==workspace || preview?.ensemble_id!==id)
      throw Error('Reopen the original ensemble in its saved Workspace.');
    const studyLinks=(response.latest?.studies||[]).map(row=>{
      const attrs=' data-id="'+escapeHTML(row.experiment_id)+'" data-workspace="'+escapeHTML(workspace)+'"';
      return '<li><strong>'+escapeHTML(row.title)+'</strong> · '+escapeHTML(label(row.state))+
        '<div class="page-actions"><button type="button" data-action="parameter-study-open"'+attrs+
        '>Open scenario parameter study</button>'+
        (row.source?.source?'<button type="button" data-action="parameter-study-source-open"'+attrs+
          ' data-source-id="'+escapeHTML(row.source.id)+'">Compose scientific report</button>':'')+
        '</div></li>';
    }).join('');
    const rows=preview.studies.map(row=>'<tr>'+cell(row.scenario_title)+cell(row.title)+
      cell(numeric(row.cases))+cell(short(row.base_profile_id))+'</tr>');
    const content='<p>'+escapeHTML(preview.method)+'</p>'+
      '<p><strong>'+numeric(preview.counts.complete_native_runs)+' / '+numeric(preview.counts.native_runs)+
      ' original native runs complete</strong> · '+numeric(preview.counts.study_count)+' parameter studies.</p>'+
      table(['Original scenario','Retained parameter study','Cases','Reference profile'],rows)+
      '<p class="note">Each study uses its original scenario, grid, coefficient source, run IDs and model arguments. '+
      'The output includes annual quantities, signed parameter changes and pair-specific valid coverage. '+
      'Its saved source retains the original ensemble plan and complete member mapping.</p>'+
      (studyLinks?'<h3>Saved continuation</h3><ul>'+studyLinks+'</ul>':'')+
      (!preview.ready?'<div class="notice">Continue the original ensemble first. '+
        escapeHTML(preview.counts.pending.length)+' original runs remain unfinished.</div>':'')+
      '<label class="check-row"><input type="checkbox" name="ensemble_parameter_reports" checked>'+
      '<span>Prepare scientific sources, figures and reports for every scenario</span></label>'+
      '<label class="check-row"><input type="checkbox" name="ensemble_parameter_maps">'+
      '<span>Retain original pairwise difference rasters in each Parameter export</span></label>';
    openForm('Parameter results by scenario','Continue completed original native runs into scenario-specific studies.',
      content,'Prepare scenario parameter studies',async()=>{
        if(workspace!==currentWorkspace() || version!==designVersion || mounted!==generation)
          throw Error('Reopen this original ensemble before preparing its parameter studies.');
        if(!preview.ready)throw Error('Complete the named original ensemble runs first.');
        const selected=form();
        const result=await submitAction('parameter-study.ensemble.continue',{
          ensemble_id:id,
          render_reports:!!selected?.elements.namedItem('ensemble_parameter_reports')?.checked,
          difference_maps:!!selected?.elements.namedItem('ensemble_parameter_maps')?.checked});
        toast('Original-run aggregation and reports are queued. Open each saved scenario study from the completed task.');
        return result;
      });
  }

  async function inspect(id) {
    const workspace=currentWorkspace(), version=++designVersion, mounted=generation;
    const result=await api(endpoint('/api/ensembles/inspect',{ensemble_id:id}));
    if(workspace!==currentWorkspace() || version!==designVersion || mounted!==generation)return;
    if(result.workspace_key!==workspace || result.ensemble?.id!==id)
      throw Error('Reopen this saved model study in its original Workspace.');
    const item=result.ensemble, summary=result.summary||{}, progress=item.progress||{};
    let content='<div id="ensemble-inspection" data-id="'+escapeHTML(id)+'"><div class="page-actions">'+
      button('inspect','Refresh results',id)+
      (item.state!=='complete'?button('run',item.state==='prepared'?'Run saved design':'Continue saved design',id):'')+
      button('report','Generate report and exports',id)+
      button('study-source','Prepare scientific study report',id)+
      button('parameter-studies','Parameter results by scenario',id)+
      button('consumer-decision','Physical decisions',id)+
      button('consumer-calibration','Evaluate annual loads',id)+'</div>'+
      '<div class="cards">'+[
        ['State',label(item.state)],['Complete native runs',numeric(progress.complete)+' / '+numeric(progress.total)],
        ['Parameter cases',numeric(item.members?.length)],['Reported physical rows',numeric((summary.rows?.length||0)+(summary.sensitivity?.length||0))]
      ].map(([title,value])=>'<div class="card"><h3>'+escapeHTML(title)+'</h3><strong class="number">'+escapeHTML(value)+'</strong></div>').join('')+'</div>'+
      '<p>'+escapeHTML(item.reason||'')+'</p>'+
      '<p>Selected models: '+escapeHTML((item.model_scope?.selected_models||item.models||['ndr','sdr'])
        .map(name=>name==='ndr'?'Nutrients':'Sediment').join(' and '))+'.</p>'+
      '<p class="note">Negative annual change means lower modeled export. Land-cover contrasts pair runs with the same parameter profile. '+
      'Parameter contrasts hold observed land cover fixed and compare the varied profile with the first reference profile. '+
      'Every contrast uses cells valid in both runs; source coverage and missing values remain visible.</p>';
    if(summary.report_state && summary.report_state!=='current')
      content+='<div class="notice">The saved result summary is '+escapeHTML(label(summary.report_state))+
        '. Generate the report after the selected runs complete to include their current results.</div>';
    const pendingErrors=[...(item.errors||summary.run_errors||[]),...(summary.errors||[])];
    if(item.execution_error||summary.execution_error)pendingErrors.push(item.execution_error||summary.execution_error);
    const errors=[...new Map(pendingErrors.map(error=>[JSON.stringify(error),error])).values()];
    if(errors.length)content+='<section class="section"><div class="section-body"><h3>Run and comparison messages</h3>'+
      '<ul>'+errors.map(error=>'<li>'+escapeHTML(
        (error?.run_id?'Run '+short(error.run_id)+': ':'')+
        (error?.message||error?.error?.message||JSON.stringify(error)))+'</li>').join('')+
      '</ul><p>Completed stages stay available. Inspect the named run, correct its input or runtime problem and continue this same design.</p></div></section>';
    content+='<h3 class="subheading">Land-cover physical quantities</h3>'+pairTable(summary);
    content+='<h3 class="subheading">Parameter sensitivity on the observed baseline</h3>'+pairTable(summary,'sensitivity');
    content+='<h3 class="subheading">Report downloads</h3>';
    if(result.export_state==='stale')
      content+='<div class="notice">The downloadable report needs to be refreshed. '+
        'Choose Generate report and exports to include the current study results.</div>';
    content+=downloadsHTML(result.downloads);
    content+='<h3 class="subheading">Scientific study source and figures</h3>'+
      '<p>The saved design can publish its original land-cover and parameter contrasts, exact support groups, '+
      'coefficient sources and figures into the ordered scientific report composer.</p>';
    if(result.study_source?.source?.source){
      const published=result.study_source.source;
      content+='<p>Saved source: '+escapeHTML(label(published.state))+
        ' · '+numeric(published.landcover_pairs)+' land-cover rows · '+numeric(published.parameter_pairs)+
        ' parameter rows · '+numeric(published.figure_count)+' figures.</p>'+
        (published.source_state==='stale'?'<div class="notice">This retained source describes an earlier study state. '+
          'Prepare scientific study report to create the current edition, or compose the retained edition below.</div>':'')+
        button('study-compose','Compose retained study report',id)+downloadsHTML(result.study_source.downloads);
    }else content+='<p class="note">Complete at least one paired native contrast, then choose Prepare scientific study report. '+
      'The existing action freezes actual report data and does not start another model run.</p>';
    content+='<h3 class="subheading">Calibration and decision results</h3>'+consumerRows(result.consumers);
    content+='<h3 class="subheading">Original runs and scientific choices</h3>'+
      table(['Parameter case','Scenario','Role','State',''],(item.members||[]).flatMap(member=>
        (member.runs||[]).map(run=>'<tr>'+cell(member.label||short(member.id))+
          cell(run.label||short(run.scenario_id))+cell(label(run.role))+
          cell(label(run.state||'prepared'))+
          '<td class="actions-cell">'+button('open-run','Open native run',run.run_id)+
          '<button type="button" data-action="spatial-item" data-kind="runs" data-id="'+escapeHTML(run.run_id)+'">Map</button></td></tr>')));
    content+='<details class="technical"><summary>Selected profile parameters and sources</summary><pre class="json-view">'+
      escapeHTML(JSON.stringify({grid_id:item.grid_id,baseline_scenario_id:item.baseline_scenario_id,
        axes:item.axes,model_scope:item.model_scope||summary.model_scope,sources:summary.sources,members:(item.members||[]).map(member=>({
          label:member.label,profile_id:member.profile_id,parent_profile_id:member.parent_profile_id,
          parameters:member.parameters,assignments:member.assignments
        }))},null,2))+'</pre></details></div>';
    detail(item.title||'Scenario sensitivity',content,{kind:'ensemble',id});
  }


  async function openSavedStudy(selection={}) {
    const workspace=currentWorkspace(), version=++designVersion, mounted=generation;
    if(selection.workspace_key!==workspace)
      throw Error('Open this received Study in its original receiving Workspace.');
    const studyID=selection.study_id, expected=selection.source;
    if(typeof studyID!=='string'||!/^[0-9a-f]{64}$/.test(studyID) ||
       !expected?.source_collection_id || !expected?.source_id)
      throw Error('Choose the saved Study and its original native model source.');
    const value=await api(endpoint('/api/study-transfer/received-detail',{study_id:studyID}));
    if(workspace!==currentWorkspace() || version!==designVersion || mounted!==generation)return;
    if(value.workspace_key!==workspace || value.id!==studyID)
      throw Error('The received Study returned another Workspace or saved identity.');
    const rows=(value.native_ensemble_sources||[]).filter(row=>
      row.source?.source_collection_id===expected.source_collection_id&&row.source?.source_id===expected.source_id);
    if(rows.length!==1)throw Error('The saved Study lost its original native model source.');
    const row=rows[0], captured=row.captured||{}, item=captured.ensemble, summary=captured.summary;
    for(const field of ['ensemble_id','report_id','source_operation_id'])
      if(selection[field] && selection[field]!==row[field])
        throw Error('The received native study changed its original '+field.replaceAll('_',' ')+'.');
    if(!item || !summary || item.id!==row.ensemble_id || summary.id!==row.ensemble_id ||
       captured.release?.id!==row.report_id)
      throw Error('The native scientific source lacks its original physical report.');
    receivedStudy={workspace,study_id:studyID,row};
    const local=row.relationship==='same_project';
    let html='<div data-native-received-study><p class="eyebrow">RECEIVED MODEL STUDY</p>'+
      '<p>This view opens the exact physical report retained with '+escapeHTML(value.title||'this Study')+
      '. Its original source, model choices and common-cell support stay attached to the values below.</p>'+
      '<div class="page-actions">'+button('received-compose','Add original source to report',row.source_operation_id)+
      (local?button('inspect','Open editable study',row.ensemble_id):'')+'</div>'+
      '<div class="cards">'+[
        ['Parameter cases',numeric(row.member_count)],['Land-cover alternatives',numeric(row.alternative_count)],
        ['Land-cover rows',numeric(row.landcover_rows)],['Parameter rows',numeric(row.parameter_rows)]
      ].map(([name,value])=>'<div class="card"><h3>'+escapeHTML(name)+'</h3><strong class="number">'+
        escapeHTML(value)+'</strong></div>').join('')+'</div>'+
      '<p>'+escapeHTML(item.reason||'')+'</p>'+
      '<p class="note">Annual change is alternative minus baseline: a negative value means lower modeled export. '+
      'Each land-cover contrast uses matching parameter choices; parameter contrasts retain the observed baseline. '+
      'The original annual units, common-cell coverage and undefined values remain unchanged.</p>';
    if(!local)html+='<p>This scientific source originated in another project. Its captured choices and results are available here.</p>';
    const errors=[...(summary.run_errors||[]),...(summary.errors||[])];
    if(summary.execution_error)errors.push(summary.execution_error);
    if(errors.length)html+='<section class="section"><h3>Original run and comparison messages</h3><ul>'+
      errors.map(error=>'<li>'+escapeHTML(error?.message||error?.error?.message||JSON.stringify(error))+'</li>').join('')+
      '</ul></section>';
    html+='<h3 class="subheading">Saved land-cover contrasts</h3>'+pairTable(summary)+
      '<h3 class="subheading">Saved baseline parameter sensitivity</h3>'+pairTable(summary,'sensitivity')+
      '<h3 class="subheading">Original physical report and tables</h3>'+downloadsHTML(row._numeric_downloads);
    const reports=(value.reports||[]).filter(report=>(row.report_ids||[]).includes(report.id));
    for(const report of reports)html+='<h3 class="subheading">'+escapeHTML(report.title||'Saved scientific report')+
      '</h3>'+downloadsHTML(report._downloads);
    html+='<h3 class="subheading">Original scientific choices</h3>'+
      table(['Parameter case','Scenario','Role',...(local?['Open']:[])],
        (item.members||[]).flatMap(member=>(member.runs||[]).map(run=>'<tr>'+
          cell(member.label||short(member.id))+cell(run.label||short(run.scenario_id))+cell(label(run.role))+
          (local?'<td>'+button('open-run','Native run',run.run_id)+'</td>':'')+'</tr>')))+
      '<details class="technical"><summary>Source data, methods and figures</summary>'+
      downloadsHTML(row._downloads)+'</details>'+
      '<details class="technical"><summary>Original model choices and source identities</summary><pre class="json-view">'+
      escapeHTML(JSON.stringify({
        source_project_id:row.source_project_id,study_id:studyID,ensemble_id:row.ensemble_id,
        report_id:row.report_id,source_operation_id:row.source_operation_id,
        model_scope:row.model_scope,grid_id:item.grid_id,axes:item.axes,
        sources:summary.sources,members:item.members
      },null,2))+'</pre></details></div>';
    detail(row.title||'Received model study',html,{kind:'ensemble-received-study',id:studyID});
  }

  async function composeReceivedStudy(operationID) {
    const selected=receivedStudy, workspace=currentWorkspace(), version=++designVersion, mounted=generation;
    if(!selected || selected.workspace!==workspace || selected.row.source_operation_id!==operationID)
      throw Error('Reopen this original native study from Received Studies.');
    await refresh({force:true});
    if(workspace!==currentWorkspace() || version!==designVersion || mounted!==generation || receivedStudy!==selected)return;
    return openScientificReport({workspace_key:workspace,sources:[{...selected.row.source}],title:selected.row.title});
  }

  async function dispatch(node) {
    const action=node.dataset.action.replace(/^ensemble-design-/,''), id=node.dataset.id;
    if(action==='new')return newDesign();
    if(action==='reload')return root?mount(root):undefined;
    if(action==='inspect')return inspect(id);
    if(action==='parameter-studies')return parameterStudies(id);
    if(action==='received-compose')return composeReceivedStudy(id);
    if(action==='consumer-decision')return consumerForm(id,'decision');
    if(action==='consumer-calibration')return consumerForm(id,'calibration',{annual_import_id:node.dataset.annualImport});
    if(action==='consumer-open')return openConsumer(id);
    if(action==='scientific-prepare') {
      const task=await submitAction('ensemble.scientific-source',{consumer_id:id});
      toast('The saved scientific report is queued. Reopen this result for PDF, original sources and Compose scientific report.');
      return task;
    }
    if(action==='study-source') {
      const task=await submitAction('ensemble.study-source',{ensemble_id:id});
      toast('The original native study report is queued. Reopen the study for its scientific source, figures and exports.');
      return task;
    }
    if(action==='study-compose')return studyScientificReport({ensemble_id:id});
    if(action==='scientific-compose')return scientificReport({consumer_id:id});
    if(action==='scientific-delivery')return scientificDelivery({consumer_id:id});
    if(action==='flow-prepare'){
      const choice=form()?.elements.namedItem('consumer_saved_references')?.value||'';
      if(!choice.startsWith('annual:'))throw Error('Choose an original annual-reference import first.');
      const result=await submitAction('ensemble.flow-support',{reference_import_id:choice.slice(7)});
      toast('The original flow replay is queued. Reopen this study’s annual-reference form for the retained support and use the task downloads to inspect its source periods.');
      return result;
    }
    if(action==='consumer-resume')return submitAction('ensemble.consumer.resume',{consumer_id:id});
    if(action==='preview')return preview();
    if(action==='study-apply')return applyStudy();
    if(action==='axis-add'){
      const targets=Object.entries(catalog?.parameters?.targets||{});
      if(!targets.length)throw Error('Reopen the design to load the source-supported parameter catalog.');
      document.querySelector('#ensemble-axes').insertAdjacentHTML('beforeend',axisRow(targets));
      return;
    }
    if(action==='axis-remove'){node.closest('[data-ensemble-axis]')?.remove();return;}
    if(action==='open-run')return openItem('runs',id);
    if(action==='run'){
      await submitAction('ensemble.run',{ensemble_id:id,continue_on_error:true});
      toast('The saved native design is queued. Follow Operations for progress.');
      return;
    }
    if(action==='report'){
      await submitAction('ensemble.report',{ensemble_id:id});
      toast('The physical report is queued. Reopen this design for its downloads.');
      return;
    }
    throw Error('Choose an available scenario-sensitivity action.');
  }
  return {mount,update,detach,dispatch,prepare:newDesign,annualReference:openAnnualReference,scientificReport,scientificDelivery,studyScientificReport,openSavedStudy};
}
