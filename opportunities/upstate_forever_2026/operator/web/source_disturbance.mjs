import {clone,canonical,createSourceDisturbanceStorage,workingCopyEnvelope,validateWorkingCopy} from './source_disturbance_storage.mjs';
const text=v=>String(v??''),list=v=>Array.isArray(v)?v:[],object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const esc=v=>text(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty=v=>JSON.stringify(v,null,2),short=v=>text(v).slice(0,12),human=v=>text(v).replaceAll('_',' ');
const date=v=>v?new Date(v).toLocaleString('en-US'):'Not yet saved';
const button=(action,label,attrs='')=>'<button type="button" data-sd-action="'+esc(action)+'" '+attrs+'>'+esc(label)+'</button>';
const option=(id,label,current)=>'<option value="'+esc(id)+'"'+(id===current?' selected':'')+'>'+esc(label)+'</option>';
const input=(field,label,value,attrs='')=>'<label class="sd-field"><span>'+esc(label)+'</span><input data-sd-field="'+esc(field)+'" value="'+esc(value)+'" '+attrs+'></label>';
const area=(field,label,value)=>'<label class="sd-field"><span>'+esc(label)+'</span><textarea data-sd-field="'+esc(field)+'" rows="3">'+esc(value)+'</textarea></label>';
const select=(field,label,choices,value,help='')=>'<label class="sd-field"><span>'+esc(label)+'</span><select data-sd-field="'+esc(field)+'">'+option('','Choose an original record',value)+[...choices,...(value&&!choices.some(r=>r[0]===value)?[[value,'Retained original · '+short(value)]]:[])].map(([id,name])=>option(id,name,value)).join('')+'</select>'+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
const ENDPOINT='/api/source-disturbance/';
function download(body,name,type='application/json'){const url=URL.createObjectURL(new Blob([body],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
function nativeSelection(value){const row=clone(value);row.schema??='upstate.source-disturbance-selection/v1';row.references??=[];row.baseline_run_ids??=[];row.cases??=[];for(const c of list(row.cases))for(const p of list(c.patches)){p.protections??=[];if(p.source&&p.source.layer===undefined)p.source.layer=null;for(const source of list(p.protections))if(source&&source.layer===undefined)source.layer=null;}return row;}
function set(obj,path,value){const keys=path.split('.');if(keys.some(k=>['__proto__','prototype','constructor'].includes(k)))throw Error('Choose an ordinary study field.');let p=obj;const last=keys.pop();for(const k of keys){if(!object(p[k])&&!Array.isArray(p[k]))p[k]={};p=p[k];}p[last]=value;}
export function createSourceDisturbanceDesk(host){
  const storage=createSourceDisturbanceStorage();let node=null,abort=null,workspace=null,project=null,scope=null,epoch=0,busy=false;
  let current=null,catalog=null,preview=null,study=null,results=null,picker=null,message='',failure=false,search='',polling=false;
  const saved=new Map(),dirty=new Map(),errors=new Map(),revisions=new Map(),chains=new Map();
  const $=q=>node?.querySelector(q),$$=q=>node?[...node.querySelectorAll(q)]:[];
  const context=()=>({workspace,scope,epoch,project:clone(project),draftId:current?.id});
  const active=c=>!!node&&epoch===c.epoch&&workspace===c.workspace&&host.getState()?.workspace_key===c.workspace;
  const key=(id,sc=scope)=>sc+':'+id;
  const draftSignature=d=>canonical(d.selection);
  const pending=d=>list(d?.operations).filter(op=>!['complete','rejected'].includes(op.state));
  const assert=()=>{if(!node||!project?.id||host.getState()?.workspace_key!==workspace)throw Error('Reopen this source-selected study in its original scientific workspace.');};
  const read=(name,payload={},origin=workspace)=>host.api(ENDPOINT+name,{method:'POST',body:{workspace:origin,...payload}});
  function status(value='',bad=false){message=text(value);failure=bad;const el=$('[data-sd-status]');if(el){el.textContent=message;el.hidden=!message;el.classList.toggle('sd-error',bad);}}
  function lock(){
    for(const el of $$('button,input,textarea,select'))if(!el.hasAttribute('data-sd-import'))el.disabled=busy||el.hasAttribute('data-sd-disabled');
    if(current?.frozen)for(const el of $$('[data-sd-editor] input,[data-sd-editor] textarea,[data-sd-editor] select,[data-sd-editor] button'))el.disabled=true;
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
    selection:nativeSelection(selection||{title:'',purpose:'',baseline_run_ids:[],cases:[]}),raw:{},study:null,operations:[],frozen:false,origin};}
  async function choose(draft){
    const c=context();if(current)await persist(current,{originScope:c.scope});if(!active(c))return false;
    current=clone(draft);study=null;results=null;preview=null;picker=null;
    await persist(current,{strict:true,originScope:c.scope});if(!active(c)||current?.id!==draft.id)return false;render();return true;
  }
  async function reload(){
    assert();const c=context();await recall(c.scope);if(!active(c))return;
    const value=await read('catalog',{},c.workspace);if(!active(c))return;
    if(value.project_id!==c.project.id)throw Error('The catalog belongs to another project.');
    const candidate=c.draftId?clone(dirty.get(key(c.draftId,c.scope))||saved.get(key(c.draftId,c.scope))||current):current;let selected=null;
    if(candidate?.study){selected=await read('item',{study_id:candidate.study.id},c.workspace);if(!active(c)||current?.id!==c.draftId)return;boundStudy(candidate,selected,c.project.id);}
    catalog=value;current=candidate;study=selected;render();
  }
  const run=id=>list(catalog?.runs).find(r=>r.id===id);
  const runName=r=>(list(host.getState()?.data?.scenarios).find(x=>x.id===r.selection?.scenario_id)?.title||short(r.id))+' · profile '+short(r.selection?.profile_id)+' · grid '+short(r.selection?.grid_id);
  const sourceKey=s=>s?canonical({source_collection_id:s.source_collection_id,source_id:s.source_id,layer:s.layer??null}):'';
  const sourceLabel=s=>(s.title||s.uri||short(s.source_id))+(s.layer?' · '+s.layer:'')+(s.vintage?' · '+s.vintage:'');
  const sourceChoices=()=>list(catalog?.sources).map(s=>[sourceKey(s),sourceLabel(s)]);
  function selectorAt(path){const parts=path.split('.');let v=current?.selection;for(const part of parts)v=v?.[part];return v;}
  function sourceHTML(source,path,label){
    const ids=list(source?.feature_ids),row=list(catalog?.sources).find(s=>s.source_collection_id===source?.source_collection_id&&s.source_id===source?.source_id),choices=sourceChoices();if(source&&!choices.some(r=>r[0]===sourceKey(source)))choices.push([sourceKey(source),sourceLabel({...row,...source})]);
    return '<section class="sd-source"><div class="sd-grid">'+select(path,label,choices,sourceKey(source),'Choose the retained original edition and layer; then explicitly select its source feature IDs.')+'</div>'+
      (row?'<p class="sd-note">'+esc(row.uri||'')+' · edition '+esc(short(row.source_collection_id))+' · '+esc(row.vintage||'Original retained source')+'</p>':'')+
      '<div class="sd-actions">'+button('features','Choose source features','data-sd-path="'+esc(path)+'"'+(!source?' data-sd-disabled':''))+
      '<span data-sd-count="'+esc(path)+'">'+ids.length.toLocaleString('en-US')+' selected features</span></div>'+
      '<details class="sd-selections"><summary>Selected original feature IDs</summary><p data-sd-selected="'+esc(path)+'">'+(ids.length?ids.map(esc).join(', '):'No features selected')+'</p></details>';
  }
  function pickerHTML(path){
    if(!picker||picker.path!==path)return '';
    const value=picker.value,source=selectorAt(path),ids=list(source?.feature_ids);
    if(value?.requires_layer)return '<section class="sd-feature-picker"><h5>Choose the original source layer</h5><p>This retained source contains multiple layers. Select the actual polygon layer before selecting its features.</p>'+select('@feature-layer','Retained source layer',list(value.layers).map(layer=>[typeof layer==='string'?layer:layer.name,typeof layer==='string'?layer:layer.name]),picker.selectedLayer||'')+button('feature-layer','Open selected layer')+button('feature-close','Close feature chooser')+'</section>';
    return '<section class="sd-feature-picker"><h5>Choose retained source features</h5><p>Selections remain attached to their original layer and survive page changes. The search below filters this page only.</p>'+
      '<div class="sd-feature-toolbar">'+input('@feature-filter','Filter this page',picker.filter||'')+button('feature-close','Close feature chooser')+'</div>'+
      (value?'<p>'+esc(value.offset+1)+'–'+esc(Math.min(value.offset+value.items.length,value.total))+' of '+esc(value.total)+' · '+esc(value.crs)+'</p>'+
      '<div class="sd-feature-list">'+list(value.items).filter(r=>!picker.filter||canonical([r.id,r.properties]).toLowerCase().includes(picker.filter.toLowerCase())).map(r=>'<label class="sd-check"><input type="checkbox" data-sd-feature="'+esc(r.id)+'"'+(ids.includes(r.id)?' checked':'')+(r.selectable===false?' disabled data-sd-disabled':'')+'><span><strong>Feature '+esc(r.id)+'</strong><br>'+Object.entries(r.properties||{}).map(([k,v])=>esc(k)+': '+esc(typeof v==='object'?pretty(v):v)).join(' · ')+(r.issue?'<br><strong>'+esc(r.issue)+'</strong>':'')+'<br><small>'+esc(r.geometry_type)+' · bounds '+esc(list(r.bounds).join(', '))+'</small></span></label>').join('')+'</div>'+
      '<div class="sd-actions">'+button('feature-page','Previous page','data-sd-offset="'+Math.max(0,value.offset-value.limit)+'"'+(value.offset<=0?' data-sd-disabled':''))+
      button('feature-page','Next page','data-sd-offset="'+esc(value.next_offset)+'"'+(value.next_offset===null||value.next_offset===undefined?' data-sd-disabled':''))+'</div>':'<p>Read the selected original layer.</p>')+'</section>';
  }
  function patchHTML(p,index,caseIndex){
    const base='cases.'+caseIndex+'.patches.'+index;
    return '<section class="sd-case" data-sd-patch="'+esc(p.id)+'"><header><h4>Patch '+(index+1)+' · '+esc(p.label||'Untitled patch')+'</h4>'+button('move-patch-up','Move patch up','data-sd-case="'+caseIndex+'" data-sd-index="'+index+'"'+(index===0?' data-sd-disabled':''))+button('move-patch-down','Move patch down','data-sd-case="'+caseIndex+'" data-sd-index="'+index+'"'+(index===current.selection.cases[caseIndex].patches.length-1?' data-sd-disabled':''))+button('remove-patch','Remove patch','data-sd-case="'+caseIndex+'" data-sd-index="'+index+'"')+'</header>'+
      '<div class="sd-grid">'+input(base+'.label','Patch label',p.label)+select(base+'.policy','Conversion policy',[['convert_selected','Convert selected eligible cells'],['retain_protection','Convert selected cells outside protected features']],p.policy)+'</div>'+
      area(base+'.reason','Reason for this land-cover change',p.reason||'')+
      sourceHTML(p.source,base+'.source','Conversion source polygons')+pickerHTML(base+'.source')+'</section>'+
      '<div class="sd-grid">'+input(base+'.from_codes','Existing land-cover codes',list(p.from_codes).join(', '),'placeholder="41, 42"')+
      input(base+'.to_code','Destination land-cover code',p.to_code??'','inputmode="numeric"')+'</div>'+
      (p.policy==='retain_protection'?'<h5>Protected source polygons</h5><p>Eligible cells intersecting these selected original features keep their existing class. No relocation is implied.</p>'+
      list(p.protections).map((source,i)=>sourceHTML(source,base+'.protections.'+i,'Protection source '+(i+1))+pickerHTML(base+'.protections.'+i)+button('remove-protection','Remove this protection source','data-sd-case="'+caseIndex+'" data-sd-patch="'+index+'" data-sd-index="'+i+'"')+'</section>').join('')+
      button('add-protection','Add protection source','data-sd-case="'+caseIndex+'" data-sd-patch="'+index+'"'):'')+
      '<p class="sd-note">Native cell-centre selection uses the original grid. Case and patch order are retained; the footprint preview reports the actual changed and excluded cells.</p></section>';
  }
  function caseHTML(row,index){
    return '<section class="sd-case" data-sd-case-id="'+esc(row.id)+'"><header><h3>Case '+(index+1)+' · '+esc(row.label||'Untitled case')+'</h3>'+button('move-case-up','Move case up','data-sd-index="'+index+'"'+(index===0?' data-sd-disabled':''))+button('move-case-down','Move case down','data-sd-index="'+index+'"'+(index===current.selection.cases.length-1?' data-sd-disabled':''))+button('remove-case','Remove case','data-sd-index="'+index+'"')+'</header>'+
      input('cases.'+index+'.label','Case label',row.label)+area('cases.'+index+'.reason','Scientific reason for this case',row.reason||'')+
      list(row.patches).map((p,i)=>patchHTML(p,i,index)).join('')+
      button('add-patch','Add a land-change patch','data-sd-case="'+index+'"')+'</section>';
  }
  function operationsHTML(){
    return list(current?.operations).map(op=>'<article class="sd-operation" data-sd-operation="'+esc(op.operation_id)+'"><div><strong>'+esc({'source-disturbance.prepare':'Save original study','run.start':'Run original native case','source-disturbance.report':'Create complete report'}[op.request.action])+'</strong><p>'+esc(human(op.state))+' · '+esc(date(op.created_at))+'</p>'+
      (op.error?'<p>'+esc(op.error.message||pretty(op.error))+'</p>':'')+'</div><div class="sd-actions">'+button('receive','Read original result','data-sd-operation="'+esc(op.operation_id)+'"')+
      (op.state==='not_found'&&!op.claimed_complete?button('retry','Retry this exact request','data-sd-operation="'+esc(op.operation_id)+'"'):'')+
      (op.task_id?button('task','Native task and logs','data-sd-id="'+esc(op.task_id)+'"'):'')+
      (op.task_id&&['interrupted','failed','cancelled'].includes(op.task_state)?button('resume','Resume original task','data-sd-operation="'+esc(op.operation_id)+'"'):'')+
      '</div><details><summary>Original request and receipt</summary><pre>'+esc(pretty(op))+'</pre></details></article>').join('');
  }
  function editor(){
    if(!current)return '<section class="sd-panel"><h2>Define source-selected land changes</h2><p>Choose completed original baselines, retained source features and named cases. Save and inspect the frozen scientific plan before running the original models.</p>'+button('new','New source-selected study')+'</section>';
    const d=current,s=d.selection,p=preview?.signature===draftSignature(d)?preview.value:null;
    const conflict=errors.has(key(d.id))?'<section class="sd-conflict"><h2>Keep your unsaved work</h2><p>'+esc(errors.get(key(d.id)).message)+'</p><div class="sd-actions">'+button('fork','Save these inputs as a separate copy')+button('reopen-local','Reopen the other saved copy')+button('download','Download this complete working copy')+'</div></section>':'';
    return conflict+'<section class="sd-panel"><header class="sd-heading"><div><h2>'+esc(s.title||'Untitled source-selected study')+'</h2><p>'+(d.frozen?'Original inputs retained; make a separate copy to change the scientific plan.':'Working copy saved in this browser before each original request.')+'</p></div><div class="sd-actions">'+button('download','Download working copy')+button('fork','Separate editable copy')+'</div></header>'+
      '<div data-sd-operations>'+operationsHTML()+'</div><form data-sd-editor><div class="sd-grid">'+input('title','Study title',s.title)+''+'</div>'+
      area('purpose','Purpose and expected interpretation',s.purpose)+
      area('references','Study source references (one per line)',list(s.references).map(v=>typeof v==='string'?v:pretty(v)).join('\n'))+
      (list(d.selection_history).length?'<details><summary>Earlier scientific selections retained in this working copy</summary><pre>'+esc(pretty(d.selection_history))+'</pre></details>':'')+
      '<p class="sd-note">Select original parcel or planning features and author explicit land-cover policies. These choices are counterfactual assumptions; source zoning or ownership does not establish a development forecast.</p>'+
      '<h3>Completed baseline profiles</h3><p>Every selected profile uses its retained baseline and coefficients on the same original grid.</p>'+
      list(catalog?.runs).filter(r=>r.state==='complete'&&r.baseline===true).map(r=>'<label class="sd-check"><input type="checkbox" data-sd-baseline="'+esc(r.id)+'"'+(list(s.baseline_run_ids).includes(r.id)?' checked':'')+'><span>'+esc(runName(r))+'</span></label>').join('')+
      '<h3>Named cases</h3>'+list(s.cases).map(caseHTML).join('')+
      '<div class="sd-actions">'+button('add-case','Add a case')+'</div>'+
      '<details><summary>Complete original selection (optional JSON)</summary><p>All original fields remain in the working copy. Applying JSON is an explicit edit of this plan.</p>'+area('@json','Full native selection',d.raw['@json']??pretty(s))+button('apply-json','Apply this complete selection')+'</details></form>'+
      '<p class="sd-note">Preparing a footprint preview saves or reuses derived masks, scenario records and native run selections in this project. It does not start a model solve.</p><div class="sd-actions">'+button('preview','Prepare footprint preview')+button('prepare','Save original study',d.frozen||pending(d).length?'data-sd-disabled':'')+'</div>'+
      (p?'<section class="sd-readiness"><h3>'+ (p.state==='prepared'?'Original footprints prepared':'Review the selected inputs')+'</h3>'+list(p.issues).map(issue=>'<p><strong>'+esc(issue.code)+'</strong> '+esc(issue.message)+(issue.case_id?' · '+esc(issue.case_id):'')+'</p>').join('')+planHTML(p)+'</section>':'')+'</section>'+studyHTML();
  }
  const number=v=>v===null||v===undefined?'Unavailable':typeof v==='number'&&Number.isFinite(v)?String(v):text(v);
  function recordsTable(rows,label){
    const records=list(rows).filter(object);if(!records.length)return '<p>No '+esc(label.toLowerCase())+' rows in this retained record.</p>';
    const keys=[...new Set(records.flatMap(row=>Object.keys(row)))];
    return '<div class="sd-table-scroll" tabindex="0"><table><caption>'+esc(label)+'</caption><thead><tr>'+keys.map(k=>'<th>'+esc(human(k))+'</th>').join('')+'</tr></thead><tbody>'+
      records.map(row=>'<tr>'+keys.map(k=>'<td>'+esc(object(row[k])||Array.isArray(row[k])?pretty(row[k]):number(row[k]))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  }
  function planHTML(value){
    if(!value)return '';const plan=value.plan||value;
    return '<section class="sd-plan"><h3>Retained footprint preview</h3><p>'+esc(value.side_effects||'The preview retains derived source masks, original scenario records and native run selections. Native model solving starts only when you queue the cases.')+'</p>'+
      '<p>Polygon geometry area and selected grid-cell area are different quantities. Raster selection uses the original cell centre and grid; excluded and nodata counts remain visible.</p>'+
      list(value.footprints||plan.footprints).map(c=>'<section class="sd-case"><h4>'+esc(c.label||c.case_id)+'</h4>'+
        '<div class="sd-table-scroll" tabindex="0"><table><thead><tr><th>Patch / policy</th><th>Source polygon area (ha)</th><th>Protection polygon area (ha)</th><th>Selected cells / valid / nodata</th><th>Excluded valid cells</th><th>Excluded baseline-eligible cells</th><th>Effective valid cells</th><th>Grid cell area (ha)</th></tr></thead><tbody>'+
        list(c.patches).map(p=>'<tr><td>'+esc(p.label||p.patch_id)+'<br>'+esc(human(p.policy))+'</td><td>'+esc(number(p.selected_polygon_hectares))+'</td><td>'+esc(number(p.protection_polygon_hectares))+'</td><td>'+esc(number(p.selected_mask_cells))+' / '+esc(number(p.selected_valid_cells))+' / '+esc(number(p.selected_nodata_cells))+'</td><td>'+esc(number(p.excluded_valid_cells))+'</td><td>'+esc(number(p.excluded_baseline_eligible_cells))+'</td><td>'+esc(number(p.effective_valid_cells))+'</td><td>'+esc(number(p.grid_cell_hectares))+'</td></tr>').join('')+'</tbody></table></div>'+
        list(c.native).map(n=>'<section><h5>Original profile '+esc(short(n.profile_id))+' · baseline '+esc(short(n.baseline_run_id))+'</h5>'+
          recordsTable(object(n.report?.summary)?[n.report.summary]:n.report?.summary,'Footprint totals')+
          recordsTable(n.report?.transitions,'Ordered land-cover transitions')+
          recordsTable(n.report?.final_classes,'Final land-cover classes')+
          '<details><summary>Complete native footprint, source classes and run identities</summary><pre>'+esc(pretty(n))+'</pre></details></section>').join('')+'</section>').join('')+
      '<details><summary>Complete source editions, model grid, baselines and scientific assumptions</summary><pre>'+esc(pretty(plan))+'</pre></details></section>';
  }
  function resultHTML(value){
    const rows=list(value.measurement_rows);
    return '<section class="sd-results"><h3>Modeled annual change</h3><p>Each case is paired with its original baseline and unchanged profile. Direction is alternative minus baseline. Nitrogen and phosphorus are kg/year; sediment is tonnes/year delivered to streams. Each row uses its own native valid support.</p>'+
      (rows.length?'<div class="sd-table-scroll" tabindex="0"><table><thead><tr><th>Case</th><th>Profile / baseline</th><th>Quantity</th><th>Change</th><th>Original units</th><th>Valid cells</th><th>Valid area (ha)</th></tr></thead><tbody>'+
      rows.map(r=>'<tr><td>'+esc(r.label||r.case_id)+'</td><td>'+esc(short(r.profile_id))+' / '+esc(short(r.baseline_run_id))+'</td><td>'+esc(human(r.artifact))+'</td><td>'+esc(r.valid_cells===0?'Unavailable — no shared valid cells':number(r.sum_change))+'</td><td>'+esc(r.units)+'</td><td>'+esc(number(r.valid_cells))+'</td><td>'+esc(number(r.valid_hectares))+'</td></tr>').join('')+'</tbody></table></div>':'<p>'+esc(human(value.state||'Awaiting the retained native report'))+'</p>')+
      list(value.comparisons).map(c=>'<details><summary>Complete original comparison · baseline '+esc(short(c.baseline_run_id))+'</summary><pre>'+esc(pretty(c.comparison))+'</pre></details>').join('')+
      '<details><summary>Complete original result and file inventory</summary><pre>'+esc(pretty(value))+'</pre></details></section>';
  }
  function studyHTML(){
    if(!study)return '';const st=study;
    const files=list(st._downloads);
    return '<section class="sd-panel" data-sd-study="'+esc(st.id)+'"><header class="sd-heading"><div><h2>Saved original study</h2><p>'+esc(human(st.state))+' · '+esc(st.id)+'</p></div><div class="sd-actions">'+button('refresh-study','Refresh saved study')+button('refresh-operations','Refresh all native results')+
      button('execute','Queue remaining original cases',pending(current).some(op=>op.request.action!=='run.start')?'data-sd-disabled':'')+
      button('report','Create or reopen complete report',!['native_complete','complete'].includes(st.state)||pending(current).length?'data-sd-disabled':'')+'</div></header>'+
      '<div class="sd-table-scroll" tabindex="0"><table><thead><tr><th>Case</th><th>State</th><th>Original run</th><th>Original grid</th><th></th></tr></thead><tbody>'+
      list(st.cases).map(c=>'<tr><td>'+esc(c.label)+'</td><td>'+esc(human(c.state))+(c.run_id===st.active_run_id?' · active':'')+'</td><td><code>'+esc(c.run_id)+'</code></td><td><code>'+esc(c.grid_id)+'</code></td><td>'+button('run','Inspect original run','data-sd-id="'+esc(c.run_id)+'"')+'</td></tr>').join('')+'</tbody></table></div>'+
      '<p>Use the original task controls to inspect native progress, logs and owned-worker stopping. Reopening retains each saved run identity.</p>'+
      planHTML(st)+
      '<div class="sd-actions">'+button('results','Read complete scientific results',st.state!=='complete'?'data-sd-disabled':'')+
      button('study-transfer','Prepare editable Study')+button('project-transfer','Transfer complete editable project')+'</div>'+
      (results?resultHTML(results):'')+
      (st.report?'<h3>Report and original files</h3><p>Review the readable report, its quantity tables, maps and complete source diagnostics. The standalone report package and editable scientific project have separate handoff controls.</p>'+
      '<div class="sd-actions">'+button('preview-report','Open readable report')+'</div><div class="sd-table-scroll" tabindex="0"><table><thead><tr><th>Original file</th><th>Size</th><th>Open or download</th></tr></thead><tbody>'+
      files.map(f=>'<tr><td>'+esc(f.label||f.filename)+'</td><td>'+esc(Number(f.bytes).toLocaleString('en-US'))+' bytes</td><td><a href="'+esc(f.url)+'" target="_blank" rel="noopener" download="'+esc(f.filename)+'">Download '+esc(f.filename)+'</a></td></tr>').join('')+
      '</tbody></table></div>':'')+
      '<details><summary>Full original study, report identities and execution history</summary><pre>'+esc(pretty(st))+'</pre></details></section>';
  }
  function render(){
    if(!node)return;node.classList.add('source-disturbance');
    node.innerHTML='<header class="sd-page-heading"><div><h1>Source-selected land changes</h1><p>Original polygons, explicit policies and native NDR/SDR cases</p></div><div class="sd-actions">'+button('new','New study')+button('import','Open working copy')+button('refresh','Refresh')+'</div></header>'+
      '<input data-sd-import type="file" accept=".json,application/json" hidden><p role="status" data-sd-status hidden></p>'+
      '<div class="sd-layout"><aside><label class="sd-field"><span>Find a study</span><input data-sd-search value="'+esc(search)+'"></label><nav data-sd-library aria-label="Source-selected land changes"></nav></aside><main data-sd-main>'+editor()+'</main></div>';
    library();status(message,failure);lock();
  }
  function invalidate(){current.updated_at=new Date().toISOString();preview=null;void persist();const el=$('.sd-readiness');if(el)el.remove();}
  function change(event){
    const el=event.target;
    if(el.hasAttribute('data-sd-search')){search=el.value;library();lock();return;}
    if(busy||!current||current.frozen)return;
    if(el.hasAttribute('data-sd-baseline')){
      const id=el.dataset.sdBaseline,ids=current.selection.baseline_run_ids;
      if(el.checked&&!ids.includes(id))ids.push(id);else if(!el.checked)current.selection.baseline_run_ids=ids.filter(x=>x!==id);
      invalidate();return;
    }
    if(el.hasAttribute('data-sd-feature')){
      if(!picker)throw Error('Reopen the original feature chooser.');
      const source=selectorAt(picker.path);if(sourceKey(source)!==picker.sourceKey)throw Error('The source selection changed. Reopen the matching layer.');
      const id=el.dataset.sdFeature;if(!list(picker.value?.items).some(r=>r.id===id&&r.selectable!==false))throw Error('Choose a feature from the received original page.');
      if(el.checked&&!source.feature_ids.includes(id))source.feature_ids.push(id);else if(!el.checked)source.feature_ids=source.feature_ids.filter(x=>x!==id);
      for(const row of $$('[data-sd-count]'))if(row.dataset.sdCount===picker.path)row.textContent=source.feature_ids.length.toLocaleString('en-US')+' selected features';
      for(const row of $$('[data-sd-selected]'))if(row.dataset.sdSelected===picker.path)row.textContent=source.feature_ids.join(', ')||'No features selected';
      invalidate();return;
    }
    const path=el.dataset.sdField;if(!path)return;
    if(path==='@feature-layer'){if(picker)picker.selectedLayer=el.value;return;}
    if(path==='@feature-filter'){if(picker){picker.filter=el.value;const selectionStart=el.selectionStart;render();const input=$('[data-sd-field="@feature-filter"]');input?.focus();input?.setSelectionRange(selectionStart,selectionStart);}return;}
    if(path==='@json')current.raw[path]=el.value;
    else if(path.endsWith('.source')||/\.protections\.\d+$/.test(path)){
      let value=null;if(el.value){const selected=list(catalog?.sources).find(row=>sourceKey(row)===el.value);if(!selected)throw Error('Choose a retained original source edition.');value={source_collection_id:selected.source_collection_id,source_id:selected.source_id,layer:selected.layer??null,feature_ids:[]};}
      current.selection_history??=[];current.selection_history.push({changed_at:new Date().toISOString(),path,prior:clone(selectorAt(path)),next:clone(value)});
      set(current.selection,path,value);picker=null;
    }else{
      let value=el.value;
      if(path==='references')value=value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
      if(path.endsWith('.from_codes'))value=value.split(',').map(x=>x.trim()).filter(Boolean).map(x=>/^-?\d+$/.test(x)?Number(x):x);
      if(path.endsWith('.to_code'))value=/^-?\d+$/.test(value.trim())?Number(value):value;
      if(path.endsWith('.policy')){
        const base=path.slice(0,-7),patch=selectorAt(base);
        if(value==='convert_selected'&&list(patch.protections).length){current.selection_history??=[];current.selection_history.push({changed_at:new Date().toISOString(),path:base+'.protections',prior:clone(patch.protections),reason:'Policy changed to convert selected'});patch.protections=[];}
      }
      set(current.selection,path,value);
    }
    invalidate();if(el.matches('select'))render();
  }
  async function featurePage(path,offset=0){
    const c=context(),source=clone(selectorAt(path)),signature=sourceKey(source);
    if(!source)throw Error('Choose the retained source edition first.');
    const value=await read('features',{source_collection_id:source.source_collection_id,source_id:source.source_id,layer:source.layer,offset,limit:100},c.workspace);
    if(!active(c)||current?.id!==c.draftId||sourceKey(selectorAt(path))!==signature)return;
    picker={path,sourceKey:signature,value,filter:'',selectedLayer:''};render();
  }
  function boundStudy(d,value,projectId=project?.id){
    if(!d?.study||value?.id!==d.study.id||value.project_id!==projectId||canonical(value.plan?.selection)!==canonical(nativeSelection(d.selection)))
      throw Error('The saved native study differs from this working copy’s complete selected inputs. Keep this copy for review or make a separate editable copy.');
    const expected=[...new Set(list(value.cases).map(row=>row.run_id))].sort(),retained=[...new Set(list(d.study.run_ids))].sort();
    if(canonical(expected)!==canonical(retained))throw Error('The working copy’s native run roster differs from the original saved study.');
    return value;
  }
  async function open(id){
    assert();const c=context();if(current)await persist(current,{originScope:c.scope});if(!active(c))return;
    const value=await read('item',{study_id:id},c.workspace);if(!active(c))return;
    if(value.project_id!==c.project.id||value.id!==id||!object(value.plan?.selection))throw Error('The original saved study does not match this project.');
    const found=localCopies().find(d=>d.study?.id===id);
    if(found){const candidate=clone(dirty.get(key(found.id,c.scope))||found);boundStudy(candidate,value,c.project.id);current=candidate;study=value;preview=null;results=null;render();return;}
    const draft=fresh(value.plan.selection,{kind:'saved-study',study_id:id});draft.study={id,run_ids:[...new Set(list(value.cases).map(r=>r.run_id))]};draft.frozen=true;
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
      if(op.request.action==='source-disturbance.prepare'){
        if(!result?.id||result.project_id!==c.project.id||canonical(result.plan?.selection)!==canonical(nativeSelection(op.request.payload)))
          throw Error('The original prepared result differs from its full selected inputs.');
        d.study={id:result.id,run_ids:[...new Set(list(result.cases).map(r=>r.run_id))]};d.frozen=true;
      }else if(op.request.action==='run.start'){
        if(!list(d.study?.run_ids).includes(op.request.payload.run_id))throw Error('The native task names a run outside this saved original study.');
      }else if(result?.study_id!==op.request.payload.study_id||result.schema!=='upstate.source-disturbance-report/v1')
        throw Error('The report does not match this original saved study.');
      op.result=clone(result);
    }
    saved.set(k,d);dirty.set(k,d);await persist(d,{strict:true,originScope:sc});
    if(active(c)&&scope===sc&&current?.id===draftId){current=clone(d);render();}
    return op;
  }
  async function receive(opId,{refreshStudy=true}={}){
    assert();const c=context(),draft=clone(current),op=draft.operations.find(x=>x.operation_id===opId);if(!op)throw Error('Choose an original request.');
    const receipt=await read('operation',{operation_id:op.operation_id,task_id:op.task_id||null,request:clone(op.request)},c.workspace);
    await retain(draft.id,c.scope,opId,receipt,c);
    if(refreshStudy&&active(c)&&current?.id===draft.id&&current.study){const record=await read('item',{study_id:current.study.id},c.workspace);if(active(c)&&current?.id===draft.id){study=boundStudy(current,record,c.project.id);render();}}
    return receipt;
  }
  async function send(op,draftId,sc,c){
    if(!active(c)||op.request.workspace!==c.workspace)throw Error('Resume this unchanged request in its original operator workspace; receive its exact alias history if needed.');
    const task=await host.api('/api/actions',{method:'POST',body:clone(op.request)});
    return retain(draftId,sc,op.operation_id,{status:task.state==='complete'?'COMPLETE':'PENDING',task},c);
  }
  async function submit(action,payload){
    assert();if(pending(current).some(op=>action!=='run.start'||op.request.action!=='run.start'))throw Error('Recover the pending original request before starting another command.');
    if(action==='run.start'&&list(current.operations).some(op=>op.request.action===action&&op.request.payload.run_id===payload.run_id))throw Error('This native run already has a retained request; read or resume that original task.');
    const c=context(),draft=clone(current);await persist(draft,{strict:true,originScope:c.scope});if(!active(c)||current?.id!==draft.id)return;
    const request={workspace:c.workspace,action,payload:clone(payload),operation_id:crypto.randomUUID()};
    draft.operations.push({operation_id:request.operation_id,request,signature:canonical(request),created_at:new Date().toISOString(),state:'prepared'});
    draft.frozen=true;if(Object.hasOwn(draft.raw,'@json')){draft.unapplied_editor_history??=[];draft.unapplied_editor_history.push({retained_at:new Date().toISOString(),text:draft.raw['@json']});delete draft.raw['@json'];}current=clone(draft);
    await persist(draft,{strict:true,originScope:c.scope});if(!active(c)||current?.id!==draft.id)return;render();
    try{await send(clone(draft.operations.at(-1)),draft.id,c.scope,c);}
    catch(error){if(active(c))status('The complete original request is retained. Read its original result before retrying. '+error.message,true);throw error;}
  }
  async function importCopy(file){
    if(!file||file.size>64*1024*1024)throw Error('Choose a complete JSON working copy up to 64 MiB; use project transfer for all native sources and files.');
    const c=context(),original=await file.text();let parsed;try{parsed=JSON.parse(original.replace(/^\uFEFF/,''));}catch{throw Error('This file is not complete working-copy JSON.');}
    const value=validateWorkingCopy(parsed,{projectId:c.project.id});if(!active(c))return;const d=value.draft;
    if(d.study){const found=await read('item',{study_id:d.study.id},c.workspace);if(!active(c))return;boundStudy(d,found,c.project.id);}
    d.id=crypto.randomUUID();d.imported_original={filename:file.name,bytes:file.size,text:original};
    for(const op of d.operations)if(op.state==='complete'){op.claimed_complete=true;op.state='pending_verification';}
    if(!await choose(d)||!active(c))return;
    for(const op of [...d.operations]){if(!active(c)||current?.id!==d.id)return;await receive(op.operation_id);}
    if(active(c)&&current?.id===d.id&&d.study){const found=await read('item',{study_id:d.study.id},c.workspace);if(active(c)&&current?.id===d.id){study=boundStudy(current,found,c.project.id);render();}}
  }
  async function action(name,control){
    assert();
    if(name==='new')return choose(fresh());
    if(name==='refresh')return reload();
    if(name==='open')return open(control.dataset.sdId);
    if(name==='local'){
      const c=context(),id=control.dataset.sdId;if(current)await persist(current,{originScope:c.scope});if(!active(c))return;
      const d=dirty.get(key(id,c.scope))||saved.get(key(id,c.scope));if(!d)throw Error('This retained working copy is unavailable.');
      let selected=null;if(d.study){selected=await read('item',{study_id:d.study.id},c.workspace);if(!active(c)||current?.id!==c.draftId)return;boundStudy(d,selected,c.project.id);}
      current=clone(d);preview=null;study=selected;results=null;picker=null;render();return;
    }
    if(name==='import'){$('[data-sd-import]').click();return;}
    if(name==='download'){download(pretty(workingCopyEnvelope(project,current))+'\n','source-disturbance-'+current.id+'.json');return;}
    if(name==='fork'){const d=fresh(current.selection,{kind:'separate-copy',prior_study:clone(current.study),prior_working_copy_id:current.id,prior_operations:clone(current.operations)});d.selection.title+=' · separate copy';d.raw=clone(current.raw);return choose(d);}
    if(name==='reopen-local'){
      const c=context(),id=current.id,stored=await storage.read(c.scope,id);if(!active(c)||current?.id!==id)return;
      if(!stored)throw Error('The saved copy is unavailable. Download your visible draft or save a separate copy.');
      const k=key(id,c.scope);dirty.delete(k);errors.delete(k);revisions.set(k,stored.revision);saved.set(k,stored.body);current=clone(stored.body);preview=null;study=null;results=null;return reload();
    }
    if(['move-case-up','move-case-down','move-patch-up','move-patch-down'].includes(name)){
      if(current.frozen)throw Error('Use a separate editable copy to change the case or patch order.');
      const values=name.includes('patch')?current.selection.cases[Number(control.dataset.sdCase)]?.patches:current.selection.cases;
      const index=Number(control.dataset.sdIndex),next=index+(name.endsWith('up')?-1:1);
      if(!values||index<0||index>=values.length||next<0||next>=values.length)return;
      const [row]=values.splice(index,1);values.splice(next,0,row);picker=null;invalidate();render();return;
    }
    if(name==='add-case'){
      if(current.frozen)throw Error('Use a separate editable copy to add cases.');
      if(current.selection.cases.length>=(catalog?.maximum_cases||16))throw Error('The native study case limit is reached.');
      current.selection.cases.push({id:crypto.randomUUID(),label:'Case '+(current.selection.cases.length+1),reason:'',patches:[]});invalidate();render();return;
    }
    if(name==='features')return featurePage(control.dataset.sdPath);
    if(name==='feature-layer'){
      if(!picker?.selectedLayer)throw Error('Choose one actual retained source layer.');
      const path=picker.path,source=selectorAt(path);current.selection_history??=[];current.selection_history.push({changed_at:new Date().toISOString(),path,prior:clone(source),reason:'Selected original source layer'});source.layer=picker.selectedLayer;source.feature_ids=[];invalidate();return featurePage(path,0);
    }
    if(name==='feature-page'){if(picker)return featurePage(picker.path,Number(control.dataset.sdOffset));return;}
    if(name==='feature-close'){picker=null;render();return;}
    if(['add-patch','remove-patch','add-protection','remove-protection'].includes(name)){
      if(current.frozen)throw Error('Use a separate editable copy to change source policies.');
      const row=current.selection.cases[Number(control.dataset.sdCase)];if(!row)throw Error('Choose an original case.');
      if(name==='add-patch'){
        if(row.patches.length>=(catalog?.maximum_patches||32))throw Error('The original patch limit is reached.');
        row.patches.push({id:crypto.randomUUID(),label:'Patch '+(row.patches.length+1),reason:'',source:null,from_codes:[],to_code:'',policy:'convert_selected',protections:[]});
      }else if(name==='remove-patch')row.patches.splice(Number(control.dataset.sdIndex),1);
      else{const patch=row.patches[Number(control.dataset.sdPatch)];if(!patch)throw Error('Choose a current patch.');
        if(name==='add-protection')patch.protections.push(null);else patch.protections.splice(Number(control.dataset.sdIndex),1);}
      picker=null;invalidate();render();return;
    }
    if(name==='remove-case'){if(current.frozen)throw Error('Use a separate editable copy to remove cases.');current.selection.cases.splice(Number(control.dataset.sdIndex),1);picker=null;invalidate();render();return;}
    if(name==='apply-json'){
      if(current.frozen)throw Error('The saved scientific inputs are frozen.');
      let value;try{value=JSON.parse(current.raw['@json']??pretty(current.selection));}catch{throw Error('Complete the selection JSON before applying it.');}
      if(!object(value)||!Array.isArray(value.cases))throw Error('Select a full original study object with its complete case array.');
      current.selection=nativeSelection(value);current.raw={};picker=null;invalidate();render();return;
    }
    if(name==='run')return host.openItem('runs',control.dataset.sdId);
    if(name==='preview'){
      const c=context(),d=clone(current),signature=draftSignature(d);await persist(d,{strict:true,originScope:c.scope});if(!active(c)||current?.id!==d.id)return;
      const value=await read('preview',d.selection,c.workspace);if(active(c)&&current?.id===d.id&&draftSignature(current)===signature){preview={signature,value};render();}return;
    }
    if(name==='prepare'){if(current.frozen)throw Error('This copy already retains an original study request.');return submit('source-disturbance.prepare',current.selection);}
    if(name==='execute'){
      if(!current.study)throw Error('Save the original study first.');
      const c=context(),id=current.study.id,value=await read('item',{study_id:id},c.workspace);
      if(!active(c)||current?.study?.id!==id)return;study=boundStudy(current,value,c.project.id);
      for(const runId of [...new Set(list(value.cases).filter(r=>r.state!=='complete').map(r=>r.run_id))]){
        if(!active(c)||current?.study?.id!==id)return;
        if(list(current.operations).some(op=>op.request.action==='run.start'&&op.request.payload.run_id===runId))continue;
        await submit('run.start',{run_id:runId});
      }
      status('Native cases use the original task queue. Read their retained results and use the original task controls to resume interrupted work.');render();return;
    }
    if(name==='report'){
      if(!current.study)throw Error('Save the original study first.');
      return submit('source-disturbance.report',{study_id:current.study.id});
    }
    if(name==='refresh-operations'){
      const c=context();for(const op of [...pending(current)]){if(!active(c)||current?.id!==c.draftId)return;await receive(op.operation_id,{refreshStudy:false});}
      if(active(c)&&current?.id===c.draftId&&current.study){const value=await read('item',{study_id:current.study.id},c.workspace);if(active(c)&&current?.id===c.draftId){study=boundStudy(current,value,c.project.id);render();}}return;
    }
    if(name==='refresh-study'){
      const c=context(),id=current.study.id,value=await read('item',{study_id:id},c.workspace);
      if(active(c)&&current?.study?.id===id){study=boundStudy(current,value,c.project.id);render();}return;
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
    if(name==='receive')return receive(control.dataset.sdOperation);
    if(name==='retry'){
      const c=context(),opId=control.dataset.sdOperation,receipt=await receive(opId);
      if(!active(c)||current?.id!==c.draftId)return;
      const op=current.operations.find(x=>x.operation_id===opId);
      if(receipt.status!=='NOT_FOUND'||op.claimed_complete)throw Error('Keep this retained outcome or receive its original operator journal; do not create another request.');
      return send(clone(op),current.id,c.scope,c);
    }
    if(name==='resume'){
      const c=context(),opId=control.dataset.sdOperation;await receive(opId);if(!active(c)||current?.id!==c.draftId)return;
      const op=current.operations.find(x=>x.operation_id===opId);if(op.state==='complete')return;
      if(!op.task_id)throw Error('Read the original task before resuming.');
      await host.api('/api/task/resume',{method:'POST',body:{id:op.task_id}});if(active(c)&&current?.id===c.draftId)return receive(opId);return;
    }
    if(name==='task')return host.showTask(control.dataset.sdId);
    if(name==='study-transfer'){if(!current.study)throw Error('Save the original study first.');return host.openDesk('study-transfer','openForStudies',{workspace_key:workspace,roots:[{kind:'source-disturbance-studies',id:current.study.id,title:current.selection.title,state:'Saved'}]});}
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
    node.addEventListener('click',event=>{const el=event.target.closest('[data-sd-action]');if(!el||!node.contains(el))return;event.preventDefault();event.stopPropagation();void guarded(()=>action(el.dataset.sdAction,el));},{signal});
    node.addEventListener('input',event=>{try{change(event);}catch(error){status(error.message,true);}},{signal});
    node.addEventListener('change',event=>{if(event.target.hasAttribute('data-sd-import')){const file=event.target.files?.[0];event.target.value='';void guarded(()=>importCopy(file));}else if(event.target.matches('select')){try{change(event);}catch(error){status(error.message,true);}}},{signal});
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
      polling=true;const c=context();void guarded(async()=>{for(const op of [...pending(current)].filter(op=>list(snapshot.tasks).some(t=>t.id===op.task_id&&t.state!==op.task_state))){if(!active(c)||current?.id!==c.draftId)return;await receive(op.operation_id,{refreshStudy:false});}if(active(c)&&current?.id===c.draftId&&current.study){const value=await read('item',{study_id:current.study.id},c.workspace);if(active(c)&&current?.id===c.draftId){study=boundStudy(current,value,c.project.id);render();}}}).finally(()=>{polling=false;});
    }
  }
  function detach(){if(current)void persist();abort?.abort();abort=null;epoch++;node?.classList.remove('source-disturbance');node=null;busy=false;preview=null;study=null;results=null;catalog=null;picker=null;}
  return {mount,update,detach,open};
}
