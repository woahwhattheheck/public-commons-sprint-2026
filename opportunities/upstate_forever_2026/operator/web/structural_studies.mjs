import {clone,canonical,createStructuralStorage,workingCopyEnvelope,validateWorkingCopy} from './structural_study_storage.mjs';
const text=v=>String(v??''),list=v=>Array.isArray(v)?v:[],object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const esc=v=>text(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty=v=>JSON.stringify(v,null,2),short=v=>text(v).slice(0,12),human=v=>text(v).replaceAll('_',' ');
const date=v=>v?new Date(v).toLocaleString('en-US'):'Not yet saved';
const button=(action,label,attrs='')=>'<button type="button" data-ss-action="'+esc(action)+'" '+attrs+'>'+esc(label)+'</button>';
const option=(id,label,current)=>'<option value="'+esc(id)+'"'+(id===current?' selected':'')+'>'+esc(label)+'</option>';
const input=(field,label,value,attrs='')=>'<label class="ss-field"><span>'+esc(label)+'</span><input data-ss-field="'+esc(field)+'" value="'+esc(value)+'" '+attrs+'></label>';
const area=(field,label,value)=>'<label class="ss-field"><span>'+esc(label)+'</span><textarea data-ss-field="'+esc(field)+'" rows="3">'+esc(value)+'</textarea></label>';
const select=(field,label,choices,value,help='')=>'<label class="ss-field"><span>'+esc(label)+'</span><select data-ss-field="'+esc(field)+'">'+option('','Choose an original record',value)+[...choices,...(value&&!choices.some(r=>r[0]===value)?[[value,'Retained original · '+short(value)]]:[])].map(([id,name])=>option(id,name,value)).join('')+'</select>'+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
const FAMILIES={resolution:['Grid resolution','Compare explicitly prepared grid sizes while retaining the reference physical stream-definition areas.'],
 terrain:['Terrain representation','Use an original changed DEM on the same lattice and reporting and model domains.'],
 domain:['Model domain','Compare explicit prepared model domains and review their common and nonoverlapping coverage.'],
 routing:['Flow routing','Compare MFD and D8 on the reference grid. The original scientific model performs each calculation.'],
 stream_definition:['Stream definition','Choose explicit NDR and SDR stream-definition areas in square meters on the reference grid.']};
const ENDPOINT='/api/structural-studies/';
function download(body,name,type='application/json'){const url=URL.createObjectURL(new Blob([body],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
function nativeSelection(value){const row=clone(value);row.schema??='upstate.structural-study-selection/v1';row.references??=[];for(const c of list(row.cases))c.references??=[];return row;}
function set(obj,path,value){const keys=path.split('.');if(keys.some(k=>['__proto__','prototype','constructor'].includes(k)))throw Error('Choose an ordinary study field.');let p=obj;const last=keys.pop();for(const k of keys){if(!object(p[k]))p[k]={};p=p[k];}p[last]=value;}
export function createStructuralStudyDesk(host){
  const storage=createStructuralStorage();let node=null,abort=null,workspace=null,project=null,scope=null,epoch=0,busy=false;
  let current=null,catalog=null,preview=null,study=null,results=null,message='',failure=false,search='',polling=false;
  const saved=new Map(),dirty=new Map(),errors=new Map(),revisions=new Map(),chains=new Map();
  const $=q=>node?.querySelector(q),$$=q=>node?[...node.querySelectorAll(q)]:[];
  const context=()=>({workspace,scope,epoch,project:clone(project),draftId:current?.id});
  const active=c=>!!node&&epoch===c.epoch&&workspace===c.workspace&&host.getState()?.workspace_key===c.workspace;
  const key=(id,sc=scope)=>sc+':'+id;
  const draftSignature=d=>canonical(d.selection);
  const pending=d=>list(d?.operations).filter(op=>!['complete','rejected'].includes(op.state));
  const assert=()=>{if(!node||!project?.id||host.getState()?.workspace_key!==workspace)throw Error('Reopen this structural study in its original scientific workspace.');};
  const read=(name,payload={},origin=workspace)=>host.api(ENDPOINT+name,{method:'POST',body:{workspace:origin,...payload}});
  function status(value='',bad=false){message=text(value);failure=bad;const el=$('[data-ss-status]');if(el){el.textContent=message;el.hidden=!message;el.classList.toggle('ss-error',bad);}}
  function lock(){
    for(const el of $$('button,input,textarea,select'))if(!el.hasAttribute('data-ss-import'))el.disabled=busy||el.hasAttribute('data-ss-disabled');
    if(current?.frozen)for(const el of $$('[data-ss-editor] input,[data-ss-editor] textarea,[data-ss-editor] select,[data-ss-editor] button'))el.disabled=true;
  }
  async function persist(draft=current,{strict=false,originScope=scope}={}){
    if(!draft)return null;const body=clone(draft),k=key(body.id,originScope);dirty.set(k,body);saved.set(k,body);
    const prior=chains.get(k)||Promise.resolve();
    const next=prior.catch(()=>{}).then(async()=>{
      if(errors.has(k))throw errors.get(k);
      try{const row=await storage.write(originScope,body.id,revisions.get(k)||0,body);revisions.set(k,row.revision);if(canonical(dirty.get(k))===canonical(body))dirty.delete(k);return row;}
      catch(error){errors.set(k,error);throw error;}
    });chains.set(k,next);
    try{return await next;}catch(error){if(scope===originScope&&current?.id===body.id)status(error.message,true);if(strict)throw error;return null;}
  }
  async function recall(sc){const rows=await storage.list(sc);for(const row of rows){const k=key(row.id,sc);if(dirty.has(k)||errors.has(k))continue;saved.set(k,row.body);revisions.set(k,row.revision);}return rows;}
  const localCopies=()=>[...saved.entries()].filter(([k])=>k.startsWith(scope+':')).map(([,v])=>v);
  function fresh(selection=null,origin=null){return {id:crypto.randomUUID(),created_at:new Date().toISOString(),updated_at:new Date().toISOString(),
    selection:nativeSelection(selection||{title:'',purpose:'',family:'resolution',reference_run_id:'',cases:[]}),raw:{},study:null,operations:[],frozen:false,origin};}
  async function choose(draft){
    const c=context();if(current)await persist(current,{originScope:c.scope});if(!active(c))return false;
    current=clone(draft);study=null;results=null;preview=null;
    await persist(current,{strict:true,originScope:c.scope});if(!active(c)||current?.id!==draft.id)return false;render();return true;
  }
  async function reload(){
    assert();const c=context();await recall(c.scope);if(!active(c))return;
    const value=await read('catalog',{},c.workspace);if(!active(c))return;
    if(value.project_id!==c.project.id)throw Error('The catalog belongs to another project.');
    catalog=value;if(c.draftId)current=clone(dirty.get(key(c.draftId,c.scope))||saved.get(key(c.draftId,c.scope))||current);
    if(current?.study){const selected=await read('item',{study_id:current.study.id},c.workspace);if(!active(c)||current?.id!==c.draftId)return;study=selected;}
    render();
  }
  const run=id=>list(catalog?.runs).find(r=>r.id===id),grid=id=>list(catalog?.grids).find(g=>g.id===id);
  const runName=r=>(list(host.getState()?.data?.scenarios).find(x=>x.id===r.selection?.scenario_id)?.title||short(r.id))+' · '+short(r.selection?.grid_id);
  const gridName=g=>(g.spec?.title||g.spec?.name||short(g.id))+' · '+list(g.shape?.pixel_size_m).join(' × ')+' m · '+g.shape?.width+' × '+g.shape?.height;
  function library(){
    const el=$('[data-ss-library]');if(!el)return;const matching=row=>!search||canonical([row.id,row.title,row.selection?.title]).toLowerCase().includes(search.toLowerCase());
    el.innerHTML='<h2>Saved studies</h2>'+list(catalog?.studies).filter(matching).map(row=>button('open',row.title||short(row.id),'data-ss-id="'+esc(row.id)+'"')+'<small>'+esc(FAMILIES[row.family]?.[0]||human(row.family))+' · '+esc(human(row.state))+'</small>').join('')+
      (!list(catalog?.studies).length?'<p>No saved structural study yet.</p>':'')+
      '<h2>Working copies</h2>'+localCopies().filter(matching).map(d=>button('local',d.selection.title||'Untitled study','data-ss-id="'+esc(d.id)+'"')+'<small>'+(errors.has(key(d.id))?'Local save needs attention':pending(d).length?'Original request pending':d.frozen?'Retained original study':'Editable draft')+'</small>').join('');
  }
  function referenceModels(){return list(run(current?.selection.reference_run_id)?.models).filter(m=>['ndr','sdr'].includes(m));}
  function adaptCase(row){
    const family=current.selection.family,models=referenceModels(),reference=run(current.selection.reference_run_id);
    const profile=list(catalog?.profiles).find(p=>p.id===reference?.selection?.profile_id);
    if(family==='routing')row.routing=Object.fromEntries(models.map(m=>[m,row.routing?.[m]??profile?.[m]?.flow_dir_algorithm??'']));
    else delete row.routing;
    if(family==='stream_definition')row.stream_area_m2=Object.fromEntries(models.map(m=>[m,row.stream_area_m2?.[m]??'']));
    else delete row.stream_area_m2;
    if(['routing','stream_definition'].includes(family)&&reference)row.grid_id=reference.selection.grid_id;
  }
  function changeBasis(field,value){
    if(current.selection[field]===value)return;
    current.selection_history??=[];
    current.selection_history.push({changed_at:new Date().toISOString(),field,from:current.selection[field],to:value,selection:clone(current.selection)});
    current.selection[field]=value;
    for(const row of current.selection.cases){delete row.existing_run_id;adaptCase(row);}
    current.raw={};
    status('The earlier full selection is retained in this working copy. Review each active-model field and explicitly reselect any original case run for the new scientific basis.');
  }
  function caseHTML(row,index){
    const family=current.selection.family,reference=run(current.selection.reference_run_id),fixed=['routing','stream_definition'].includes(family);
    const choices=list(catalog?.grids).filter(g=>!fixed||g.id===reference?.selection?.grid_id).map(g=>[g.id,gridName(g)]);
    const selected=grid(row.grid_id),facts=selected?.shape;
    const reusable=list(catalog?.runs).filter(r=>r.state==='complete'&&r.id!==reference?.id&&r.selection.grid_id===row.grid_id&&r.selection.scenario_id===reference?.selection?.scenario_id&&canonical([...list(r.models)].sort())===canonical([...list(reference?.models)].sort()));
    const caseField=(field,label,value,attrs='')=>input('cases.'+index+'.'+field,label,value,attrs);
    return '<section class="ss-case" data-ss-case="'+esc(row.id)+'"><header><h3>Case '+(index+1)+' · '+esc(row.label||short(row.id))+'</h3>'+button('remove-case','Remove case','data-ss-index="'+index+'"')+'</header>'+
      '<div class="ss-grid">'+caseField('label','Case label',row.label)+select('cases.'+index+'.grid_id','Prepared original grid',choices,row.grid_id,fixed?'This family uses the reference grid.':'Preview checks the complete original grid, input and domain changes.')+'</div>'+
      select('cases.'+index+'.existing_run_id','Reuse an original completed case (optional)',reusable.map(r=>[r.id,runName(r)]),row.existing_run_id||'','Leave blank to prepare this named case. Selecting a producer run retains its original profile and run IDs; readiness checks its complete parameters, sources and artifacts.')+
      area('cases.'+index+'.reason','Scientific reason for this comparison',row.reason||'')+
      area('cases.'+index+'.references','Source references (one per line)',list(row.references).map(v=>typeof v==='string'?v:pretty(v)).join('\n'))+
      (family==='routing'?'<div class="ss-grid">'+referenceModels().map(m=>select('cases.'+index+'.routing.'+m,m.toUpperCase()+' routing',list(catalog?.routing_values).map(v=>[v,v.toUpperCase()]),row.routing?.[m]||'')).join('')+'</div>':'')+
      (family==='stream_definition'?'<div class="ss-grid">'+referenceModels().map(m=>caseField('stream_area_m2.'+m,m.toUpperCase()+' stream-definition area (m²)',row.stream_area_m2?.[m]??'','inputmode="decimal"')).join('')+'</div><p class="ss-note">Enter physical contributing area. The model derives each pixel threshold from the exact retained grid cell area.</p>':'')+
      (facts?'<dl class="ss-facts"><div><dt>Grid size</dt><dd>'+esc(facts.width)+' × '+esc(facts.height)+'</dd></div><div><dt>Cell dimensions</dt><dd>'+esc(list(facts.pixel_size_m).join(' × '))+' m</dd></div><div><dt>Cell area</dt><dd>'+esc(facts.pixel_area_m2)+' m²</dd></div><div><dt>Original CRS</dt><dd>'+esc(facts.crs)+'</dd></div></dl>':'')+
      '<details><summary>Complete original case and grid sources</summary><pre>'+esc(pretty({case:row,grid:selected||null}))+'</pre></details></section>';
  }
  function operationsHTML(){
    return list(current?.operations).map(op=>'<article class="ss-operation" data-ss-operation="'+esc(op.operation_id)+'"><div><strong>'+esc({'structural-study.prepare':'Save original study','structural-study.run':'Run original native cases','structural-study.report':'Create complete report'}[op.request.action])+'</strong><p>'+esc(human(op.state))+' · '+esc(date(op.created_at))+'</p>'+
      (op.error?'<p>'+esc(op.error.message||pretty(op.error))+'</p>':'')+'</div><div class="ss-actions">'+button('receive','Read original result','data-ss-operation="'+esc(op.operation_id)+'"')+
      (op.state==='not_found'&&!op.claimed_complete?button('retry','Retry this exact request','data-ss-operation="'+esc(op.operation_id)+'"'):'')+
      (op.task_id?button('task','Native task and logs','data-ss-id="'+esc(op.task_id)+'"'):'')+
      (op.task_id&&['interrupted','failed','cancelled'].includes(op.task_state)?button('resume','Resume original task','data-ss-operation="'+esc(op.operation_id)+'"'):'')+
      '</div><details><summary>Original request and receipt</summary><pre>'+esc(pretty(op))+'</pre></details></article>').join('');
  }
  function editor(){
    if(!current)return '<section class="ss-panel"><h2>Compare model structure</h2><p>Choose a completed original reference run and named cases. Save and inspect the frozen scientific plan before running the original models.</p>'+button('new','New structural study')+'</section>';
    const d=current,s=d.selection,p=preview?.signature===draftSignature(d)?preview.value:null;
    const conflict=errors.has(key(d.id))?'<section class="ss-conflict"><h2>Keep your unsaved work</h2><p>'+esc(errors.get(key(d.id)).message)+'</p><div class="ss-actions">'+button('fork','Save these inputs as a separate copy')+button('reopen-local','Reopen the other saved copy')+button('download','Download this complete working copy')+'</div></section>':'';
    return conflict+'<section class="ss-panel"><header class="ss-heading"><div><h2>'+esc(s.title||'Untitled structural study')+'</h2><p>'+(d.frozen?'Original inputs retained; make a separate copy to change the scientific plan.':'Working copy saved in this browser before each original request.')+'</p></div><div class="ss-actions">'+button('download','Download working copy')+button('fork','Separate editable copy')+'</div></header>'+
      '<div data-ss-operations>'+operationsHTML()+'</div><form data-ss-editor><div class="ss-grid">'+input('title','Study title',s.title)+select('family','Scientific question',Object.entries(FAMILIES).map(([id,v])=>[id,v[0]]),s.family)+'</div>'+
      area('purpose','Purpose and expected interpretation',s.purpose)+
      area('references','Study source references (one per line)',list(s.references).map(v=>typeof v==='string'?v:pretty(v)).join('\n'))+
      (list(d.selection_history).length?'<details><summary>Earlier scientific selections retained in this working copy</summary><pre>'+esc(pretty(d.selection_history))+'</pre></details>':'')+
      '<p class="ss-note">'+esc(FAMILIES[s.family]?.[1]||'Choose a supported study family.')+' Production remains designated at 30 m; this comparison does not replace that designation.</p>'+
      select('reference_run_id','Completed original reference',list(catalog?.runs).filter(r=>r.state==='complete').map(r=>[r.id,runName(r)]),s.reference_run_id,'The reference scenario, source table and profile remain attached. Rainfall and R-source experiments belong to the rainfall study workflow.')+
      '<div class="ss-actions">'+button('reference','Inspect original reference')+'</div>'+
      '<h3>Named cases</h3>'+list(s.cases).map(caseHTML).join('')+
      '<div class="ss-actions">'+button('add-case','Add a case')+'</div>'+
      '<details><summary>Complete original selection (optional JSON)</summary><p>All original fields remain in the working copy. Applying JSON is an explicit edit of this plan.</p>'+area('@json','Full native selection',d.raw['@json']??pretty(s))+button('apply-json','Apply this complete selection')+'</details></form>'+
      '<div class="ss-actions">'+button('preview','Review scientific readiness')+button('prepare','Save original study',d.frozen||pending(d).length?'data-ss-disabled':'')+'</div>'+
      (p?'<section class="ss-readiness"><h3>'+ (p.eligible?'Ready for original preparation':'Review the selected inputs')+'</h3>'+list(p.issues).map(issue=>'<p><strong>'+esc(issue.code)+'</strong> '+esc(issue.message)+(issue.case_id?' · '+esc(issue.case_id):'')+'</p>').join('')+planHTML(p.plan)+'</section>':'')+'</section>'+studyHTML();
  }
  function planHTML(plan){
    if(!plan)return '';const changes=list(plan.cases).flatMap(c=>list(c.changes).map(change=>({case_label:c.label,...change})));
    return '<h3>Proposed changes</h3><div class="ss-table-scroll" tabindex="0"><table><thead><tr><th>Case</th><th>Native field</th><th>Reference</th><th>Case value</th><th>Meaning</th></tr></thead><tbody>'+
      changes.map(c=>'<tr><td>'+esc(c.case_label)+'</td><td>'+esc(c.field)+'</td><td>'+esc(typeof c.reference==='object'?pretty(c.reference):c.reference)+'</td><td>'+esc(typeof c.case==='object'?pretty(c.case):c.case)+'</td><td>'+esc(c.meaning)+'</td></tr>').join('')+
      '</tbody></table></div><details><summary>Complete scientific method, support and source plan</summary><pre>'+esc(pretty(plan))+'</pre></details>';
  }
  function resultHTML(value){
    const number=v=>v===null||v===undefined?'Undefined':typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('en-US',{maximumSignificantDigits:8}):text(v);
    const titles={nitrogen_export:'Nitrogen export',phosphorus_export:'Phosphorus export',sediment_export:'Sediment export'};
    const designation=value.production_designation||{};
    return '<section class="ss-results"><h3>Scientific comparison</h3><p>'+esc(value.purpose)+'</p>'+
      '<p class="ss-note">Production designation: '+esc(designation.rfp_resolution_m)+' m. Reference cell dimensions: '+esc(list(designation.reference_resolution_m).join(' × '))+' m. '+esc(designation.meaning)+'</p>'+
      '<p>'+esc(value.support_policy)+'. Direction: '+esc(value.direction)+'.</p>'+
      list(value.cases).map(c=>'<section class="ss-case"><h3>'+esc(c.label)+'</h3><p><strong>Reason:</strong> '+esc(c.reason)+'</p>'+
        Object.entries(c.comparisons||{}).map(([pollutant,p])=>{
          const undefinedPercent=p.shared_valid_area_m2<=0?'Undefined — no shared valid area':p.reference?.shared_mass===0?'Undefined — reference shared mass is zero':'Undefined in the original result';
          const side=(label,r)=>'<tr><th scope="row">'+label+'</th><td>'+esc(number(r.valid_area_m2))+'</td><td>'+esc(number(r.mass))+'</td><td>'+esc(number(r.shared_area_m2))+'</td><td>'+esc(number(r.shared_mass))+'</td><td>'+esc(number(r.omitted_valid_area_m2))+'</td><td>'+esc(number(r.omitted_mass))+'</td></tr>';
          return '<h4>'+esc(titles[pollutant]||human(pollutant))+'</h4><p>Area: square meters in the original projected CRS. Mass: '+esc(p.mass_units)+'.</p>'+
            '<div class="ss-table-scroll" tabindex="0"><table><thead><tr><th>Original output</th><th>Own valid area (m²)</th><th>Own mass</th><th>Shared valid area (m²)</th><th>Shared mass</th><th>Omitted valid area (m²)</th><th>Omitted mass</th></tr></thead><tbody>'+
            side('Reference',p.reference)+side('Case',p.case)+'</tbody></table></div>'+
            '<dl class="ss-facts"><div><dt>Shared-support change ('+esc(p.mass_units)+')</dt><dd>'+esc(number(p.change_shared_mass))+'</dd></div><div><dt>Shared-support percent change</dt><dd>'+esc(p.percent_change_shared===null?undefinedPercent:number(p.percent_change_shared)+'%')+'</dd></div></dl>'+
            '<ul>'+list(p.limitations).map(item=>'<li>'+esc(item)+'</li>').join('')+'</ul>';
        }).join('')+
        (list(c.references).length?'<h4>Original references</h4><ul>'+c.references.map(item=>'<li>'+esc(item)+'</li>').join('')+'</ul>':'')+
        '<p>'+esc(c.scientific_interpretation)+'</p></section>').join('')+
      '<p>'+esc(value.interpretation)+'</p><details><summary>Complete original result JSON and source identities</summary><pre>'+esc(pretty(value))+'</pre></details></section>';
  }
  function studyHTML(){
    if(!study)return '';const st=study;
    const files=list(st._downloads);
    return '<section class="ss-panel" data-ss-study="'+esc(st.id)+'"><header class="ss-heading"><div><h2>Saved original study</h2><p>'+esc(human(st.state))+' · '+esc(st.id)+'</p></div><div class="ss-actions">'+button('refresh-study','Refresh saved study')+
      button('execute','Run or continue original cases',pending(current).length?'data-ss-disabled':'')+
      button('report','Create or reopen complete report',st.state!=='complete'||pending(current).length?'data-ss-disabled':'')+'</div></header>'+
      '<div class="ss-table-scroll" tabindex="0"><table><thead><tr><th>Case</th><th>State</th><th>Original run</th><th>Original grid</th><th></th></tr></thead><tbody>'+
      list(st.cases).map(c=>'<tr><td>'+esc(c.label)+'</td><td>'+esc(human(c.state))+(c.run_id===st.active_run_id?' · active':'')+'</td><td><code>'+esc(c.run_id)+'</code></td><td><code>'+esc(c.grid_id)+'</code></td><td>'+button('run','Inspect original run','data-ss-id="'+esc(c.run_id)+'"')+'</td></tr>').join('')+'</tbody></table></div>'+
      '<p>Use the original task controls to inspect native progress, logs and owned-worker stopping. Reopening retains each saved run identity.</p>'+
      planHTML(st.plan)+
      '<div class="ss-actions">'+button('results','Read complete scientific results',st.state!=='complete'?'data-ss-disabled':'')+
      button('project-transfer','Transfer complete editable project')+'</div>'+
      (results?resultHTML(results):'')+
      (st.report?'<h3>Report and original files</h3><p>Review the readable report, its quantity tables, maps and complete source diagnostics. The standalone report package and editable scientific project have separate handoff controls.</p>'+
      '<div class="ss-actions">'+button('preview-report','Open readable report')+'</div><div class="ss-table-scroll" tabindex="0"><table><thead><tr><th>Original file</th><th>Size</th><th>Open or download</th></tr></thead><tbody>'+
      files.map(f=>'<tr><td>'+esc(f.label||f.filename)+'</td><td>'+esc(Number(f.bytes).toLocaleString('en-US'))+' bytes</td><td><a href="'+esc(f.url)+'" target="_blank" rel="noopener" download="'+esc(f.filename)+'">Download '+esc(f.filename)+'</a></td></tr>').join('')+
      '</tbody></table></div>':'')+
      '<details><summary>Full original study, report identities and execution history</summary><pre>'+esc(pretty(st))+'</pre></details></section>';
  }
  function render(){
    if(!node)return;node.classList.add('structural-studies');
    node.innerHTML='<header class="ss-page-heading"><div><h1>Structural studies</h1><p>Resolution, terrain, model domain, routing and stream definition</p></div><div class="ss-actions">'+button('new','New study')+button('import','Open working copy')+button('refresh','Refresh')+'</div></header>'+
      '<input data-ss-import type="file" accept=".json,application/json" hidden><p role="status" data-ss-status hidden></p>'+
      '<div class="ss-layout"><aside><label class="ss-field"><span>Find a study</span><input data-ss-search value="'+esc(search)+'"></label><nav data-ss-library aria-label="Structural studies"></nav></aside><main data-ss-main>'+editor()+'</main></div>';
    library();status(message,failure);lock();
  }
  function invalidate(){current.updated_at=new Date().toISOString();preview=null;void persist();const el=$('.ss-readiness');if(el)el.remove();}
  function change(event){
    const el=event.target;if(el.hasAttribute('data-ss-search')){search=el.value;library();lock();return;}
    if(busy||!current||current.frozen||!el.dataset.ssField)return;
    const path=el.dataset.ssField;
    if(path==='@json')current.raw[path]=el.value;
    else if(path.startsWith('cases.')){
      const parts=path.split('.'),index=Number(parts[1]),field=parts.slice(2).join('.');const row=current.selection.cases[index];if(!row)throw Error('This original case is unavailable.');
      let value=el.value;if(field==='references')value=value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
      if(field.startsWith('stream_area_m2.'))value=value.trim()!==''&&Number.isFinite(Number(value))?Number(value):value;
      if(field==='existing_run_id'&&!value)delete row.existing_run_id;else set(row,field,value);
    }else if(['family','reference_run_id'].includes(path))changeBasis(path,el.value);
    else current.selection[path]=path==='references'?el.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean):el.value;
    invalidate();if(['family','reference_run_id'].includes(path)||path.endsWith('.grid_id'))render();
  }
  async function open(id){
    assert();const c=context();if(current)await persist(current,{originScope:c.scope});if(!active(c))return;
    const value=await read('item',{study_id:id},c.workspace);if(!active(c))return;
    if(value.project_id!==c.project.id||value.id!==id||!object(value.plan?.selection))throw Error('The original saved study does not match this project.');
    const found=localCopies().find(d=>d.study?.id===id);
    if(found){current=clone(dirty.get(key(found.id,c.scope))||found);study=value;preview=null;results=null;render();return;}
    const draft=fresh(value.plan.selection,{kind:'saved-study',study_id:id});draft.study={id};draft.frozen=true;
    if(await choose(draft)&&active(c)){study=value;render();}
  }
  async function retain(draftId,sc,opId,receipt,c){
    const k=key(draftId,sc),d=clone(dirty.get(k)||saved.get(k));if(!d)throw Error('The original full working copy is unavailable; the server result remains retained.');
    const op=d.operations.find(r=>r.operation_id===opId);if(!op)throw Error('The original full request is unavailable.');
    const task=receipt.task;
    if(task&&(task.workspace!==op.request.workspace||task.action!==op.request.action||canonical(task.payload)!==canonical(op.request.payload)))throw Error('The returned task belongs to another full original request.');
    op.receipt=clone(receipt);op.received_at=new Date().toISOString();
    op.task_id=task?.id||receipt.task_id||op.task_id;op.task_state=task?.state||op.task_state;op.error=receipt.error||task?.error||null;
    op.state=receipt.status==='NOT_FOUND'?(op.claimed_complete?'verification_required':'not_found'):
      task?.state==='complete'||receipt.status==='COMPLETE'?'complete':task?.state||text(receipt.status||'pending').toLowerCase();
    const result=receipt.result||task?.result;
    if(op.state==='complete'){
      if(op.request.action==='structural-study.prepare'){
        if(!result?.id||result.project_id!==c.project.id||canonical(result.plan?.selection)!==canonical(nativeSelection(op.request.payload)))
          throw Error('The original prepared result differs from its full selected inputs.');
        d.study={id:result.id};d.frozen=true;
      }else if(op.request.action==='structural-study.run'){
        if(result?.id!==op.request.payload.study_id||result.state!=='complete')throw Error('The native completion does not match the original saved study.');
      }else if(result?.study_id!==op.request.payload.study_id||result.schema!=='upstate.structural-report/v1')
        throw Error('The report does not match this original saved study.');
      op.result=clone(result);
    }
    saved.set(k,d);dirty.set(k,d);await persist(d,{strict:true,originScope:sc});
    if(active(c)&&scope===sc&&current?.id===draftId){current=clone(d);render();}
    return op;
  }
  async function receive(opId){
    assert();const c=context(),draft=clone(current),op=draft.operations.find(x=>x.operation_id===opId);if(!op)throw Error('Choose an original request.');
    const receipt=await read('operation',{operation_id:op.operation_id,task_id:op.task_id||null,request:clone(op.request)},c.workspace);
    await retain(draft.id,c.scope,opId,receipt,c);
    if(active(c)&&current?.id===draft.id&&current.study){const record=await read('item',{study_id:current.study.id},c.workspace);if(active(c)&&current?.id===draft.id){study=record;render();}}
    return receipt;
  }
  async function send(op,draftId,sc,c){
    if(!active(c)||op.request.workspace!==c.workspace)throw Error('Resume this unchanged request in its original operator workspace; receive its exact alias history if needed.');
    const task=await host.api('/api/actions',{method:'POST',body:clone(op.request)});
    return retain(draftId,sc,op.operation_id,{status:task.state==='complete'?'COMPLETE':'PENDING',task},c);
  }
  async function submit(action,payload){
    assert();if(pending(current).length)throw Error('Recover the pending original request before starting another command.');
    const c=context(),draft=clone(current);await persist(draft,{strict:true,originScope:c.scope});if(!active(c)||current?.id!==draft.id)return;
    const request={workspace:c.workspace,action,payload:clone(payload),operation_id:crypto.randomUUID()};
    draft.operations.push({operation_id:request.operation_id,request,signature:canonical(request),created_at:new Date().toISOString(),state:'prepared'});
    draft.frozen=true;delete draft.raw['@json'];current=clone(draft);
    await persist(draft,{strict:true,originScope:c.scope});if(!active(c)||current?.id!==draft.id)return;render();
    try{await send(clone(draft.operations.at(-1)),draft.id,c.scope,c);}
    catch(error){if(active(c))status('The complete original request is retained. Read its original result before retrying. '+error.message,true);throw error;}
  }
  async function importCopy(file){
    if(!file||file.size>16*1024*1024)throw Error('Choose a complete JSON working copy up to 16 MiB; use project transfer for all native sources and files.');
    const c=context(),original=await file.text();let parsed;try{parsed=JSON.parse(original.replace(/^\uFEFF/,''));}catch{throw Error('This file is not complete working-copy JSON.');}
    const value=validateWorkingCopy(parsed,{projectId:c.project.id});if(!active(c))return;const d=value.draft;d.id=crypto.randomUUID();d.imported_original={filename:file.name,bytes:file.size,text:original};
    for(const op of d.operations)if(op.state==='complete'){op.claimed_complete=true;op.state='pending_verification';}
    if(!await choose(d)||!active(c))return;
    for(const op of [...d.operations]){if(!active(c)||current?.id!==d.id)return;await receive(op.operation_id);}
    if(active(c)&&current?.id===d.id&&d.study){const found=await read('item',{study_id:d.study.id},c.workspace);if(active(c)&&current?.id===d.id){study=found;render();}}
  }
  async function action(name,control){
    assert();
    if(name==='new')return choose(fresh());
    if(name==='refresh')return reload();
    if(name==='open')return open(control.dataset.ssId);
    if(name==='local'){
      const c=context(),id=control.dataset.ssId;if(current)await persist(current,{originScope:c.scope});if(!active(c))return;
      const d=dirty.get(key(id,c.scope))||saved.get(key(id,c.scope));if(!d)throw Error('This retained working copy is unavailable.');
      current=clone(d);preview=null;study=null;results=null;
      if(d.study){const value=await read('item',{study_id:d.study.id},c.workspace);if(!active(c)||current?.id!==id)return;study=value;}render();return;
    }
    if(name==='import'){$('[data-ss-import]').click();return;}
    if(name==='download'){download(pretty(workingCopyEnvelope(project,current))+'\n','structural-study-'+current.id+'.json');return;}
    if(name==='fork'){const d=fresh(current.selection,{kind:'separate-copy',prior_study:clone(current.study),prior_working_copy_id:current.id,prior_operations:clone(current.operations)});d.selection.title+=' · separate copy';d.raw=clone(current.raw);return choose(d);}
    if(name==='reopen-local'){
      const c=context(),id=current.id,stored=await storage.read(c.scope,id);if(!active(c)||current?.id!==id)return;
      if(!stored)throw Error('The saved copy is unavailable. Download your visible draft or save a separate copy.');
      const k=key(id,c.scope);dirty.delete(k);errors.delete(k);revisions.set(k,stored.revision);saved.set(k,stored.body);current=clone(stored.body);preview=null;study=null;results=null;return reload();
    }
    if(name==='add-case'){
      if(current.frozen)throw Error('Use a separate editable copy to add cases.');
      if(current.selection.cases.length>=(catalog?.maximum_cases||32))throw Error('The native study case limit is reached.');
      const reference=run(current.selection.reference_run_id),profile=list(catalog?.profiles).find(p=>p.id===reference?.selection?.profile_id);
      const row={id:crypto.randomUUID(),label:'Case '+(current.selection.cases.length+1),grid_id:reference?.selection?.grid_id||'',reason:'',references:[]};
      adaptCase(row);
      current.selection.cases.push(row);invalidate();render();return;
    }
    if(name==='remove-case'){if(current.frozen)throw Error('Use a separate editable copy to remove cases.');current.selection.cases.splice(Number(control.dataset.ssIndex),1);invalidate();render();return;}
    if(name==='apply-json'){
      if(current.frozen)throw Error('The saved scientific inputs are frozen.');
      let value;try{value=JSON.parse(current.raw['@json']??pretty(current.selection));}catch{throw Error('Complete the selection JSON before applying it.');}
      if(!object(value)||!Array.isArray(value.cases))throw Error('Select a full original study object with its complete case array.');
      current.selection=nativeSelection(value);current.raw={};invalidate();render();return;
    }
    if(name==='reference'){if(current.selection.reference_run_id)return host.openItem('runs',current.selection.reference_run_id);throw Error('Choose a completed reference run.');}
    if(name==='run')return host.openItem('runs',control.dataset.ssId);
    if(name==='preview'){
      const c=context(),d=clone(current),signature=draftSignature(d);await persist(d,{strict:true,originScope:c.scope});if(!active(c)||current?.id!==d.id)return;
      const value=await read('preview',d.selection,c.workspace);if(active(c)&&current?.id===d.id&&draftSignature(current)===signature){preview={signature,value};render();}return;
    }
    if(name==='prepare'){if(current.frozen)throw Error('This copy already retains an original study request.');return submit('structural-study.prepare',current.selection);}
    if(name==='execute'||name==='report'){
      if(!current.study)throw Error('Save the original study first.');
      return submit(name==='execute'?'structural-study.run':'structural-study.report',{study_id:current.study.id});
    }
    if(name==='refresh-study'){
      const c=context(),id=current.study.id,value=await read('item',{study_id:id},c.workspace);
      if(active(c)&&current?.study?.id===id){study=value;render();}return;
    }
    if(name==='results'){
      const c=context(),id=current.study.id,value=await read('result',{study_id:id},c.workspace);
      if(active(c)&&current?.study?.id===id){results=value;render();}return;
    }
    if(name==='preview-report'){
      if(!study?.report)throw Error('Create the completed report first.');
      if(!study._report_preview_url)throw Error('The retained report has no readable preview. Download its original HTML and complete report package.');
      window.open(study._report_preview_url,'_blank','noopener');return;
    }
    if(name==='receive')return receive(control.dataset.ssOperation);
    if(name==='retry'){
      const c=context(),opId=control.dataset.ssOperation,receipt=await receive(opId);
      if(!active(c)||current?.id!==c.draftId)return;
      const op=current.operations.find(x=>x.operation_id===opId);
      if(receipt.status!=='NOT_FOUND'||op.claimed_complete)throw Error('Keep this retained outcome or receive its original operator journal; do not create another request.');
      return send(clone(op),current.id,c.scope,c);
    }
    if(name==='resume'){
      const c=context(),opId=control.dataset.ssOperation;await receive(opId);if(!active(c)||current?.id!==c.draftId)return;
      const op=current.operations.find(x=>x.operation_id===opId);if(op.state==='complete')return;
      if(!op.task_id)throw Error('Read the original task before resuming.');
      await host.api('/api/task/resume',{method:'POST',body:{id:op.task_id}});if(active(c)&&current?.id===c.draftId)return receive(opId);return;
    }
    if(name==='task')return host.showTask(control.dataset.ssId);
    if(name==='project-transfer')return host.navigate('project-transfer');
  }
  async function guarded(fn){
    if(busy)return;busy=true;lock();const c=context();
    try{status();await fn();}catch(error){if(active(c))status(error.message,true);}
    finally{if(active(c)){busy=false;lock();}}
  }
  async function mount(target,snapshot=host.getState()){
    detach();node=target;workspace=snapshot.workspace_key;project={id:snapshot.data?.project?.id,title:snapshot.data?.project?.title||'Scientific workspace'};scope=workspace+':'+project.id;
    assert();abort=new AbortController();const signal=abort.signal,c=context();
    node.addEventListener('click',event=>{const el=event.target.closest('[data-ss-action]');if(!el||!node.contains(el))return;event.preventDefault();event.stopPropagation();void guarded(()=>action(el.dataset.ssAction,el));},{signal});
    node.addEventListener('input',event=>{try{change(event);}catch(error){status(error.message,true);}},{signal});
    node.addEventListener('change',event=>{if(event.target.hasAttribute('data-ss-import')){const file=event.target.files?.[0];event.target.value='';void guarded(()=>importCopy(file));}else if(event.target.matches('select')){try{change(event);}catch(error){status(error.message,true);}}},{signal});
    node.addEventListener('submit',event=>event.preventDefault(),{signal});
    document.addEventListener('click',event=>{if(busy&&event.target.closest('.sidebar [data-view]')){event.preventDefault();event.stopImmediatePropagation();status('Finish the retained operation before changing the workspace view.');}},{signal,capture:true});
    window.addEventListener('beforeunload',event=>{if(current&&(dirty.has(key(current.id))||errors.has(key(current.id)))){event.preventDefault();event.returnValue='';}},{signal});
    current=null;catalog=null;preview=null;study=null;results=null;busy=true;render();
    try{await recall(c.scope);if(!active(c))return;const rows=localCopies().sort((a,b)=>text(b.updated_at).localeCompare(text(a.updated_at)));if(rows.length)current=clone(rows[0]);await reload();}
    catch(error){if(active(c))status(error.message,true);}
    finally{if(active(c)){busy=false;lock();}}
  }
  function update(snapshot=host.getState()){
    if(!node)return;if(snapshot.workspace_key!==workspace){detach();return;}
    if(!busy&&!polling&&current&&pending(current).some(op=>op.task_id&&list(snapshot.tasks).some(t=>t.id===op.task_id&&t.state!==op.task_state))){
      polling=true;const c=context();void guarded(async()=>{for(const op of [...pending(current)]){if(!active(c)||current?.id!==c.draftId)return;await receive(op.operation_id);}}).finally(()=>{polling=false;});
    }
  }
  function detach(){if(current)void persist();abort?.abort();abort=null;epoch++;node?.classList.remove('structural-studies');node=null;busy=false;preview=null;study=null;results=null;catalog=null;}
  return {mount,update,detach,open};
}
