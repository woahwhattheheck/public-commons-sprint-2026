/** Native-study and regional delivery planner with retained PDF atlas viewer. */
import {createSpatialWorkspace} from './spatial.mjs';
import {createAtlasReviewCollection} from './atlas_review_collection.mjs';
const FAMILIES = [
 ['future_sediment_loss','Potential future sediment export'],
 ['future_nutrient_runoff','Potential future nitrogen and phosphorus export'],
 ['critical_drinking_water','Drinking-water source areas and export priorities'],
 ['high_quality_waters','Designated high-quality waters and modeled exports'],
 ['current_nutrient_export','Current nitrogen and phosphorus export'],
 ['current_sediment_export','Current sediment export'],
 ['combined_pollutant_export','Combined pollutant export priority']
];
const ROLES = [['PROTECTED_LANDS','Protected lands'],['PARCEL','Parcels'],
 ['NHD','Hydrography'],['NWI','Wetlands']];
const OPTIONAL_ROLES = [['OBSERVED_CONTEXT','Observed water-quality context']];
const OVERLAYS = [['drinking_water','Drinking-water source areas',true],
 ['high_quality_waters','Designated high-quality waters',true],
 ['protected_lands','Protected-land map overlay',false],['parcels','Parcel priority inventory',false]];
const isStudy = selection => selection?.delivery_mode==='native_study';
const releaseFamilies = selection => FAMILIES.filter(([id])=>{const role=id==='critical_drinking_water'?'drinking_water':'high_quality_waters';return !isStudy(selection)||!['critical_drinking_water','high_quality_waters'].includes(id)||Boolean(selection.overlays?.[role])||(selection.receptor_spec?.receptors||[]).some(row=>row.role===role);});
const MASS = ['nitrogen_export','phosphorus_export','sediment_export'];
const STEPS = ['Native runs','Source context','Map settings','Review and build'];
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = v => JSON.parse(JSON.stringify(v));
function syncWaterOverlayRoles(selection) {
 const sourceRoles={...(selection.source_roles||{})},overlays=selection.overlays||{};
 for(const [name,role] of [['high_quality_waters','HIGH_QUALITY_WATERS'],['drinking_water','SOURCE_WATER_PROTECTION_AREAS'],['protected_lands','PROTECTED_LANDS_OVERLAY']]){
  const choice=overlays[name];
  if(choice&&typeof choice==='object'&&!Array.isArray(choice))sourceRoles[role]=clone(choice);
  else delete sourceRoles[role];
 }
 return {...selection,source_roles:sourceRoles};
}
const short = v => String(v || '').slice(0,12);
const titleOf = r => r?.title || r?.selection?.title || r?.spec?.title || r?.metadata?.title || short(r?.id);
const modelNames = r => r?.selection?.models || ['ndr','sdr'];
const safeFileURL = u => typeof u==='string' && /^\/api\/file\/[^?#]+$/.test(u) ? u : null;
const human = v => String(v).replaceAll('_',' ');
const pretty = v => JSON.stringify(v,null,2);
const referenceText = value => typeof value==='string'?value:
 [value?.title,value?.edition,value?.section].filter(Boolean).join(' · ')||value?.uri||'';
const sourceLabel = role => OVERLAYS.find(row=>row[0]===role)?.[1]||human(role);
function receptorIssues(spec){
 const issues=[];
 if(!spec||typeof spec!=='object'||Array.isArray(spec)||!Array.isArray(spec.receptors)||!spec.receptors.length)return ['Choose an original contributing-area profile containing receptors.'];
 const seen=new Set();
 for(const row of spec.receptors){
  if(!row||typeof row!=='object'){issues.push('Each contributing area must contain its named source choices.');continue;}
  const title=row.title||row.id||'Contributing area';
  if(typeof row.id!=='string'||!row.id.trim()||seen.has(row.id))issues.push(title+': use a unique area ID.');
  seen.add(row.id);
  if(typeof row.title!=='string'||!row.title.trim())issues.push(title+': enter the original area name.');
  if(!['drinking_water','high_quality_waters'].includes(row.role))issues.push(title+': choose its native receiving-water role.');
  if(!Array.isArray(row.anchor_huc12s)||!row.anchor_huc12s.length||row.anchor_huc12s.some(v=>typeof v!=='string'||!/^\d{12}$/.test(v)))issues.push(title+': retain complete 12-character HUC12 strings.');
  else if(new Set(row.anchor_huc12s).size!==row.anchor_huc12s.length)issues.push(title+': an anchor HUC12 is repeated.');
  if(typeof row.reference?.uri!=='string'||!row.reference.uri.trim()||typeof row.reference?.basis!=='string'||!row.reference.basis.trim())issues.push(title+': retain its original source URI and geographic basis.');
 }
 return issues;
}
const rowBy = (data,kind,id) => (data?.[kind]||[]).find(x=>x.id===id);
const runName = (data,id) => {const r=rowBy(data,'runs',id);return r ?
 titleOf(rowBy(data,'scenarios',r.selection.scenario_id))+' · '+titleOf(rowBy(data,'profiles',r.selection.profile_id))+' · '+short(id) : short(id)+' (unavailable)';};
const hasNativeOutputs = r => r?.state==='complete' && ['ndr','sdr'].every(n=>modelNames(r).includes(n)) &&
 MASS.every(n=>r.artifacts?.[n]) && ['ndr','sdr'].every(n=>r.stages?.[n] || r.stage_summary?.[n] || r.model_scope?.completed_models?.includes(n));

export function deliveryEligibility(data, selection) {
 const reasons=[], baseline=rowBy(data,'runs',selection.baseline_run_id);
 if(!baseline) reasons.push('Choose the retained baseline run.');
 else {
  if(!hasNativeOutputs(baseline)) reasons.push('The baseline needs completed NDR and SDR outputs.');
  if(rowBy(data,'scenarios',baseline.selection.scenario_id)?.kind!=='baseline') reasons.push('Choose an original baseline scenario for the current-condition maps.');
 }
 const ids=selection.scenario_run_ids||[];
 if(!ids.length) reasons.push('Select at least one completed land-cover alternative.');
 if(new Set(ids).size!==ids.length) reasons.push('Each alternative can appear only once.');
 const cases=ids.map(id=>{
  const run=rowBy(data,'runs',id),issues=[];
  if(!run) issues.push('This retained run is unavailable.');
  else{
   if(!hasNativeOutputs(run)) issues.push('Complete both NDR and SDR.');
   if(id===selection.baseline_run_id) issues.push('Choose an alternative distinct from the baseline.');
   if(baseline && run.selection.grid_id!==baseline.selection.grid_id) issues.push('Use the baseline grid.');
   if(baseline && run.selection.profile_id!==baseline.selection.profile_id) issues.push('Use the baseline parameter profile.');
   if(rowBy(data,'scenarios',run.selection.scenario_id)?.kind!=='landcover') issues.push('Use an explicit land-cover scenario.');
  }
  return {id,run,issues};
 });
 for(const c of cases) for(const issue of c.issues) reasons.push(runName(data,c.id)+': '+issue);
 return {ready:!reasons.length,reasons,cases,baseline};
}

function button(action,label,attrs='') {return '<button type="button" data-atlas-action="'+action+'" '+attrs+'>'+esc(label)+'</button>';}
function field(label,body,note='',wide=false) {return '<label class="atlas-field'+(wide?' atlas-wide':'')+'"><span>'+esc(label)+'</span>'+body+(note?'<small>'+esc(note)+'</small>':'')+'</label>';}
function input(name,value='',attrs='') {return '<input name="'+esc(name)+'" value="'+esc(value)+'" '+attrs+'>';}
function textarea(name,value='',attrs='') {return '<textarea name="'+esc(name)+'" '+attrs+'>'+esc(value)+'</textarea>';}
function select(name,rows,value='',attrs='') {
 const available=rows.some(r=>r[0]===value);
 const extra=value&&!available?[[value,short(value)+' (retained choice unavailable)']]:[];
 return '<select name="'+esc(name)+'" '+attrs+'><option value="">Choose…</option>'+[...extra,...rows].map(([id,label])=>'<option value="'+esc(id)+'" '+(id===value?'selected':'')+'>'+esc(label)+'</option>').join('')+'</select>';
}
function check(name,value,label,checked,attrs='') {return '<label class="atlas-check"><input type="checkbox" name="'+esc(name)+'" value="'+esc(value)+'" '+(checked?'checked ':'')+attrs+'><span>'+esc(label)+'</span></label>';}
function table(headers,rows){return '<div class="atlas-table"><table><thead><tr>'+headers.map(v=>'<th>'+esc(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';}
function choices(name,rows,selected) {
 const missing=selected.filter(id=>!rows.some(r=>r.id===id)).map(id=>({id,title:short(id)+' (retained choice unavailable)'}));
 return [...missing,...rows].map(r=>check(name,r.id,titleOf(r),selected.includes(r.id))).join('') || '<p class="atlas-note">No retained items are available.</p>';
}
const cohortLinked = selection => Boolean(selection.source_report_id || selection.source_report_sha256 ||
 selection.economic_edition_id || selection.economic_edition_sha256 ||
 selection.source_scenario_analysis_id || selection.source_scenario_analysis_sha256 || selection.source_decision);
function defaultSelection(data) {
 return {delivery_mode:'regional_rfp',native_study:{title:'',purpose:'',reference:''},title:data?.project?.title||'',baseline_run_id:'',scenario_run_ids:[],source_roles:{},overlays:{},
  map_settings:{paper:'a4',dpi:220,display_percentile:98,weights:Object.fromEntries(MASS.map(k=>[k,1]))},
  contact:{name:'',organization:'',email:''},notes:[],observation_comparison_ids:[],spatial_review_ids:[],spatial_export_ids:[]};
}

export function attachMapAtlas(host) {
 let root=null, state=host.getState(), workspace='', draft=null, step=0, mode='prepare';
 let opened=null, error='', busy=false, operationId=null, generation=0, storageWarned=false, handoff=0, draftEdits=0;
 const drafts=new Map(), sourcePreview=new Map();
 let sourceContext=null, contextLoading=false, contextError='', inspection=null, inspectionRequest=0;
 let economicChoices=null, economicLoading=false, economicError='', economicRequest=0, economicScope='';
 const pairDrafts=new Map();
 const inspector=createSpatialWorkspace({
  request:(...args)=>host.api(...args),
  getWorkspace:()=>host.getWorkspace?.()||host.getState()?.workspace_key||'',
  refreshState:options=>host.refreshState?.(options),
  showTask:id=>host.showTask?.(id),openItem:(...args)=>host.openItem?.(...args),
  toast:message=>host.toast?.(message)
 });

 const reviews=createAtlasReviewCollection({
  getWorkspace:()=>host.getWorkspace?.()||host.getState()?.workspace_key||'',
  getDelivery:()=>opened,getData:()=>data(),request:(...args)=>host.api(...args),
  openReview:openSavedReview,prepareRelease:prepareReviewedRelease,
  openItem:(...args)=>host.openItem?.(...args)
 });
 const data=()=>state?.data||{};
 const key=()=>host.getWorkspace?.()||state?.workspace_key||'';
 const endpoint=(path,values={})=>path+'?'+new URLSearchParams({workspace,...values});
 const form=()=>{const node=root?.querySelector('[data-atlas-form]');return node?.dataset.atlasWorkspace===workspace?node:null;};
 function ensure(next=host.getState()) {
  state=next||state;const current=key();if(current===workspace&&draft)return;
  inspector.suspend();inspection=null;inspectionRequest++;
  workspace=current;generation++;handoff++;opened=null;operationId=null;error='';busy=false;sourcePreview.clear();sourceContext=null;contextLoading=false;contextError='';
  economicChoices=null;economicLoading=false;economicError='';economicRequest++;
  let saved=drafts.get(workspace);
  if(!saved){try{saved=JSON.parse(sessionStorage.getItem('upstate-atlas-draft:'+workspace)||'null');}catch{}}
  draft=clone(saved?.selection||defaultSelection(data()));step=saved?.step||0;operationId=saved?.operation_id||null;mode='prepare';
 }
 function persist() {
  draft=syncWaterOverlayRoles(draft);
  const saved={selection:clone(draft),step,operation_id:operationId};drafts.set(workspace,saved);
  try{sessionStorage.setItem('upstate-atlas-draft:'+workspace,JSON.stringify(saved));}
  catch{if(!storageWarned){storageWarned=true;host.toast?.('Use Download selection to preserve this draft outside the tab.');}}
 }
 function value(name,f=form()){return f?.elements.namedItem(name)?.value??'';}
 function selected(name,f=form()){return [...(f?.querySelectorAll('input[name="'+name+'"]:checked')||[])].map(el=>el.value);}
 function numeric(name,{optional=false,minimum=0,maximum=Infinity,integer=false}={}) {
  const raw=value(name).trim();if(optional&&!raw)return undefined;
  const n=Number(raw);if(!raw||!Number.isFinite(n)||n<minimum||n>maximum||(integer&&!Number.isInteger(n)))throw Error('Choose a valid '+human(name)+'.');
  return n;
 }
 function runIssues(run,baseline) {
  const selection={baseline_run_id:baseline?.id||'',scenario_run_ids:[run.id]};
  return deliveryEligibility(data(),selection).cases[0].issues;
 }
 function sourceEntry(choice) {
  return rowBy(data(),'sources',choice?.source_collection_id)?.entries?.find(e=>e.id===choice?.source_id);
 }
 function sourceCard(group,key,label,required) {
  const name=group+'__'+key,choice=draft[group]?.[key]||{},enabled=required||Object.prototype.hasOwnProperty.call(draft[group]||{},key);
  const eligible=e=>key==='OBSERVED_CONTEXT'?e.kind==='document'&&e.metadata?.report_schema==='upstate.observed-report/v1':group==='overlays'?e.kind==='vector':true;
  const sources=(data().sources||[]).filter(collection=>key!=='OBSERVED_CONTEXT'||collection.entries?.some(eligible));
  const rows=(rowBy(data(),'sources',choice.source_collection_id)?.entries||[]).filter(eligible);
  const bound=Boolean(choice.selection_id||choice.native_source_sha256||choice.rule_reference),disabled=!enabled?'disabled':'';
  const previews=sourcePreview.get(name),saved=(data().water_designations||[]).filter(row=>row.purpose===key);
  return '<fieldset class="atlas-source" data-source-card="'+name+'"><legend>'+esc(label)+'</legend>'+
   (required?'':check(name+'__enabled','yes','Include this source',enabled))+
   (group==='overlays'&&saved.length?'<div class="atlas-grid">'+field('Retained water selection',select(name+'__designation',saved.map(row=>[row.id,row.title+' · '+(row.summary?.selected_features??row.summary?.feature_count??'saved')+' features']),choice.selection_id||'',disabled))+'<div class="atlas-actions">'+button('apply-designation','Use saved selection','data-role="'+key+'" '+disabled)+'</div></div>':'')+
   (bound?'<p class="atlas-note">Saved water selection '+esc(short(choice.selection_id))+' · '+esc(referenceText(choice.rule_reference))+' '+(choice.selection_id?button('item','Open saved designation','data-kind="water-designations" data-id="'+esc(choice.selection_id)+'"'):'')+'</p>':'')+
   '<div class="atlas-grid">'+field('Source edition',select(name+'__collection',sources.map(s=>[s.id,titleOf(s)]),choice.source_collection_id||'',disabled+(bound?' disabled':'')))+
   field('Original source',select(name+'__source',rows.map(e=>[e.id,e.title+' · '+e.kind]),choice.source_id||'',disabled+(bound?' disabled':'')))+
   (group==='overlays'?field('Native layer',input(name+'__layer',choice.layer||'',disabled+(bound?' disabled':'')),'Leave blank to use the retained source layer.')+
   field('Exact field filters',textarea(name+'__where',choice.where?pretty(choice.where):'',disabled+(bound?' disabled':'')),'JSON object with original field names and typed values, for example {"HUC12":"030601010101"}.',true):'')+
   '</div><div class="atlas-actions">'+button('inspect-source','Inspect original fields','data-source-card-id="'+name+'" '+(!enabled||!choice.source_id?'disabled':''))+
   (bound?button('release-source','Choose another original source','data-source-card-id="'+name+'"'): '')+'</div>'+
   (previews?'<details open class="atlas-source-preview"><summary>'+esc(previews.geometry_type||'Original source')+' · '+esc(previews.feature_count??previews.width??'')+'</summary>'+
    '<p class="atlas-note">'+esc(previews.selected_layer||'')+' · '+esc(previews.crs||'')+'</p>'+
    '<pre>'+esc(pretty({layers:previews.layers,fields:previews.fields,sample:previews.sample,bounds:previews.bounds}))+'</pre></details>':'')+'</fieldset>';
 }
 function collect(options={}) {
  const f=form();if(!f)return clone(draft);
  const next=clone(draft);
  if(step===0){
   next.title=value('title').trim();
   if(!cohortLinked(next)){next.baseline_run_id=value('baseline');next.scenario_run_ids=selected('alternatives');}
   next.delivery_mode=value('delivery_mode')||'regional_rfp';
   if(isStudy(next)){
    const study={...(next.native_study||{})};
    for(const [field,name] of [['title','study_title'],['purpose','study_purpose'],['reference','study_reference']]){
     const control=f.elements.namedItem(name);if(control)study[field]=control.value.trim();
    }
    study.title=study.title||next.title;next.native_study=study;
   }
  }
  if(step===1){
   for(const [group,items] of [['source_roles',[...ROLES.map(r=>[...r,true]),...OPTIONAL_ROLES.map(r=>[...r,false])]],['overlays',OVERLAYS]]){
    next[group]??={};for(const [key,,required] of items){
     const name=group+'__'+key,enabled=(!isStudy(next)&&required)||f.elements.namedItem(name+'__enabled')?.checked;
     if(!enabled){delete next[group][key];continue;}
     const previous=next[group][key]||{};
     if(previous.selection_id||previous.native_source_sha256||previous.rule_reference)continue;
     const choice={...previous,source_collection_id:value(name+'__collection'),source_id:value(name+'__source')};
     if(group==='overlays'){
      const layer=value(name+'__layer').trim(),raw=value(name+'__where').trim();
      if(layer)choice.layer=layer;else delete choice.layer;
      if(raw){let where;try{where=JSON.parse(raw);}catch{throw Error(human(key)+': enter a valid JSON field-filter object.');}
       if(!where||Array.isArray(where)||typeof where!=='object'||Object.values(where).some(v=>v!==null&&typeof v==='object'))throw Error(human(key)+': field filters use scalar values.');
       choice.where=where;
      }else delete choice.where;
     }
     next[group][key]=choice;
    }
   }
   const receptorField=f.elements.namedItem('receptor_json');
   if(receptorField&&!options.replaceReceptors){
    let spec;try{spec=JSON.parse(receptorField.value);}catch{throw Error('Enter valid JSON for the original contributing-area profile.');}
    const issues=receptorIssues(spec);if(issues.length)throw Error(issues.join('\n'));
    next.receptor_spec=spec;
   }
  }
  if(step===2){
   const m={...next.map_settings};
   m.title=value('map_title').trim();m.subtitle=value('map_subtitle').trim();m.paper=value('paper');
   m.dpi=numeric('dpi',{minimum:120,maximum:600,integer:true});
   m.display_percentile=numeric('display_percentile',{minimum:0,maximum:100});
   m.weights={};m.caps={};m.family_titles={};
   for(const name of MASS){m.weights[name]=numeric('weight_'+name);const cap=numeric('cap_'+name,{optional:true});
    if(cap!==undefined){if(cap<=0)throw Error('Priority caps must be positive.');m.caps[name]=cap;}}
   if(Object.values(m.weights).every(x=>x===0))throw Error('Choose at least one positive pollutant weight.');
   for(const [id]of releaseFamilies(next)){const title=value('family_'+id).trim();if(title)m.family_titles[id]=title;}
   next.map_settings=m;
  }
  if(step===3){
   next.contact={...next.contact,name:value('contact_name').trim(),organization:value('contact_organization').trim(),email:value('contact_email').trim()};
   next.notes=value('notes').split('\n').map(s=>s.trim()).filter(Boolean);
   next.observation_comparison_ids=selected('observations');next.spatial_review_ids=selected('reviews');next.spatial_export_ids=selected('exports');
  }
  draft=next;return next;
 }
 function problems(selection=draft) {
  const out=[...deliveryEligibility(data(),selection).reasons];
  if(!selection.title?.trim())out.push('Enter the release title.');
  for(const [group,items]of [['source_roles',[...ROLES.filter(r=>!isStudy(selection)||selection.source_roles?.[r[0]]),...OPTIONAL_ROLES.filter(r=>selection.source_roles?.[r[0]])]],['overlays',OVERLAYS.filter(r=>(!isStudy(selection)&&r[2])||selection.overlays?.[r[0]])]]){
   for(const [key,label]of items){const choice=selection[group]?.[key],entry=sourceEntry(choice);
    if(!choice?.source_collection_id||!choice?.source_id)out.push('Choose '+label.toLowerCase()+'.');
    else if(!entry)out.push(label+': the retained source is unavailable.');
    else if(group==='overlays'&&entry.kind!=='vector')out.push(label+': choose a vector source.');}
  }
  if(!isStudy(selection))for(const k of ['name','organization','email'])if(!selection.contact?.[k]?.trim())out.push('Enter the contact '+k+'.');
  if(isStudy(selection)){if(!selection.native_study?.title?.trim())out.push('Enter the original study title.');if(!selection.native_study?.purpose?.trim())out.push('Describe the original study purpose.');}
  if(selection.receptor_spec){
   out.push(...receptorIssues(selection.receptor_spec));
   const baseline=rowBy(data(),'runs',selection.baseline_run_id),grid=rowBy(data(),'grids',baseline?.selection.grid_id);
   const collection=selection.receptor_spec.source_collection_id||grid?.spec?.source_collection_id;
   const source=selection.receptor_spec.network_source_id||grid?.spec?.model_domain?.source_id;
   if(grid&&!sourceEntry({source_collection_id:collection,source_id:source}))out.push('The contributing-area network must belong to this workspace and baseline grid selection.');
  }
  const runs=[selection.baseline_run_id,...(selection.scenario_run_ids||[])];
  for(const id of selection.observation_comparison_ids||[]){const row=rowBy(data(),'observation_comparisons',id);
   if(!row||!runs.includes(row.run_id))out.push('Observed comparison '+short(id)+' must belong to a selected run.');}
  return out;
 }

 function receptorProfiles(){
  const rows=(sourceContext?.receptor_profiles||[]).map(row=>({...row,key:'profile:'+row.id}));
  for(const delivery of data().deliveries||[])if(delivery.selection?.receptor_spec){
   rows.push({key:'delivery:'+delivery.id,id:delivery.id,title:titleOf(delivery)+' · retained release',
    spec:delivery.selection.receptor_spec,source:delivery.selection.receptor_profile_source||{kind:'retained_delivery',delivery_id:delivery.id}});
  }
  return rows;
 }
 function receptorSummary(spec){
  const rows=Array.isArray(spec?.receptors)?spec.receptors:[];
  return rows.length?table(['Contributing area','Role / anchors','Original selection basis'],rows.map(row=>
   '<tr><td>'+esc(row.title)+'<small>'+esc(row.id)+'</small></td><td>'+esc(sourceLabel(row.role))+'<small>'+esc((row.anchor_huc12s||[]).join(', '))+'</small></td><td>'+esc(row.reference?.basis||'')+'<small>'+esc(row.reference?.uri||'')+'</small></td></tr>')):'';
 }
 function receptorPanel(){
  const spec=draft.receptor_spec,profiles=receptorProfiles(),baseline=rowBy(data(),'runs',draft.baseline_run_id);
  const grid=rowBy(data(),'grids',baseline?.selection.grid_id),collection=spec?.source_collection_id||grid?.spec?.source_collection_id;
  const network=spec?.network_source_id||grid?.spec?.model_domain?.source_id,entry=sourceEntry({source_collection_id:collection,source_id:network}),preview=sourcePreview.get('receptor-network');
  return '<fieldset class="atlas-source"><legend>Upstream contributing areas</legend>'+
   '<p class="atlas-note">Choose the retained receiving-water profile to add upstream HUC12 footprints, native annual exports and scenario changes. Published protection polygons remain separate source overlays.</p>'+
   '<div class="atlas-grid">'+field('Original receptor profile',select('receptor_profile_choice',profiles.map(row=>[row.key,row.title]),''))+
   '<div class="atlas-actions">'+button('load-receptor','Use profile',profiles.length?'':'disabled')+
   button('load-context',contextLoading?'Loading profiles…':'Load installed profiles',contextLoading?'disabled':'')+
   '<label class="atlas-file-button">Load profile JSON<input type="file" data-atlas-receptor-import accept=".json,application/json"></label></div></div>'+
   (contextError?'<p class="atlas-note">'+esc(contextError)+'</p>':'')+
   (spec?'<h3>'+esc(spec.title||'Selected contributing areas')+'</h3>'+receptorSummary(spec)+
    '<p class="atlas-note">Original network: '+esc(entry?.title||network||'the baseline grid’s model-domain source')+
    (entry?.vintage?' · '+esc(entry.vintage):'')+'<br>Collection '+esc(collection||'baseline grid')+' · source '+esc(network||'baseline model domain')+'</p>'+
    '<div class="atlas-actions">'+button('inspect-network','Inspect original network fields',entry?'':'disabled')+'</div>'+
    (preview?'<details open><summary>Original network fields and sample</summary><pre>'+esc(pretty(preview))+'</pre></details>':'')+
    '<details><summary>Edit the original receptor profile</summary>'+field('Full native profile',textarea('receptor_json',pretty(spec),'rows="14"'),'Retain full HUC12 strings, source references and any original network-field selections.',true)+
    (draft.receptor_profile_source?'<p class="atlas-note">Starting profile: '+esc(referenceText(draft.receptor_profile_source)||draft.receptor_profile_source.path||draft.receptor_profile_source.delivery_id||'retained selection')+'</p>':'')+'</details>'+
    '<div class="atlas-actions">'+button('remove-receptors','Remove contributing-area selection')+'</div>':'<p class="atlas-note">Choose a profile here to include the regional contributing-area products.</p>')+'</fieldset>';
 }
 function sourceSummary(selection,bindings={}){
  const rows=Object.entries(selection.overlays||{}).map(([role,choice])=>{
   const saved=bindings[role]||(data().water_designations||[]).find(row=>row.id===choice.selection_id);
   return '<tr><td>'+esc(sourceLabel(role))+'</td><td>'+esc(saved?.title||choice.source_id||'')+
    '<small>'+esc(choice.selection_id?'Saved selection '+choice.selection_id:'Original source '+(choice.source_collection_id||''))+'</small></td><td>'+
    esc(referenceText(choice.rule_reference||saved?.rule_reference))+
    (choice.native_source_sha256?'<small>Native source SHA256 '+esc(choice.native_source_sha256)+'</small>':'')+'</td></tr>';
  });
  return '<details class="atlas-inclusions"><summary>Source-water and contributing-area choices</summary>'+
   table(['Overlay','Retained selection','Rule / original source identity'],rows)+
   (selection.receptor_spec?'<h4>'+esc(selection.receptor_spec.title||'Upstream contributing areas')+'</h4>'+receptorSummary(selection.receptor_spec):'')+
   '</details>';
 }

 function runStep(){
  const baseline=rowBy(data(),'runs',draft.baseline_run_id),all=data().runs||[],chosen=draft.scenario_run_ids||[];
  const linked=cohortLinked(draft);
  const complete=all.filter(run=>hasNativeOutputs(run)&&rowBy(data(),'scenarios',run.selection.scenario_id)?.kind==='baseline');
  const alternatives=all.filter(r=>chosen.includes(r.id)||(r.id!==draft.baseline_run_id&&!runIssues(r,baseline).length));
  const missing=chosen.filter(id=>!all.some(r=>r.id===id)).map(id=>({id,selection:{}}));
  const ordered=[...missing,...alternatives].sort((a,b)=>{
   const ai=chosen.indexOf(a.id),bi=chosen.indexOf(b.id);return (ai<0?Infinity:ai)-(bi<0?Infinity:bi);
  });
  const rows=ordered.map(run=>{
   const issues=run.selection.grid_id?runIssues(run,baseline):['Retained run unavailable.'];
   return '<tr><td>'+check('alternatives',run.id,runName(data(),run.id),chosen.includes(run.id),linked||(issues.length&&!chosen.includes(run.id))?'disabled':'')+'</td><td>'+esc(issues.join(' ')||'Same grid, profile and complete land-cover alternative')+'</td><td>'+button('item','Open run','data-kind="runs" data-id="'+esc(run.id)+'"')+
    (chosen.includes(run.id)?button('move','Move up','data-id="'+esc(run.id)+'" data-direction="-1" '+(linked||chosen.indexOf(run.id)===0?'disabled':''))+
     button('move','Move down','data-id="'+esc(run.id)+'" data-direction="1" '+(linked||chosen.indexOf(run.id)===chosen.length-1?'disabled':'')):'')+'</td></tr>';
  });
  return '<div class="atlas-grid">'+field('Delivery mode',select('delivery_mode',[['regional_rfp','Regional RFP · complete seven-family specification'],['native_study','Original native study · original grid and source domain']],draft.delivery_mode||'regional_rfp','required'),'The original study retains its actual grid and source coverage. Regional RFP requirements remain unchanged.',true)+
   (isStudy(draft)?field('Original study title',input('study_title',draft.native_study?.title||draft.title,'required maxlength="140"'),'',true)+field('Study purpose',textarea('study_purpose',draft.native_study?.purpose||'','required rows="3"'),'State the intended scientific question and geographic scope.',true)+field('Study reference',input('study_reference',draft.native_study?.reference||''),'Original source, publication or release reference.',true):'')+
   field('Release title',input('title',draft.title,'required maxlength="140"'),'',true)+
   field('Completed baseline',select('baseline',complete.map(r=>[r.id,runName(data(),r.id)]),draft.baseline_run_id,'required'+(linked?' disabled':'')),linked?'The attached saved analysis supplies this ordered run selection.':'',true)+'</div>'+
   '<h3>Future land-cover alternatives</h3><p class="atlas-note">The first selected alternative supplies the principal future maps. Additional alternatives receive their own sheets. Each uses the baseline grid and parameter profile.</p>'+
   (rows.length?table(['Include','Scientific pairing',''],rows):'<p class="atlas-note">Complete a compatible land-cover alternative in the Native run desk to add it here.</p>')+
   (linked?'<div class="atlas-linked"><p>The attached saved analysis supplies this exact baseline and ordered alternatives. Choose a different run cohort to remove these retained result links from this draft and edit the runs.</p>'+
    '<div class="atlas-actions">'+(draft.source_report_id?button('source-report','Open source report','data-id="'+esc(draft.source_report_id)+'"'):'')+
    button('independent-release','Choose a different run cohort')+'</div></div>':'');
 }
 function settingsStep(){
  const m=draft.map_settings||{},baseline=rowBy(data(),'runs',draft.baseline_run_id);
  return '<div class="atlas-grid">'+field('Printed atlas title',input('map_title',m.title||'','maxlength="140"'),'Uses the release title when blank.',true)+
   field('Atlas subtitle',input('map_subtitle',m.subtitle||'','maxlength="220"'),'',true)+
   field('Landscape paper',select('paper',[['letter','US Letter · 11 × 8.5 in'],['a4','A4 · 297 × 210 mm'],['a3','A3 · 420 × 297 mm']],m.paper||'a4'))+
   field('Print DPI',input('dpi',m.dpi??220,'type="number" min="120" max="600" step="1" required'))+
   field('Shared display percentile',input('display_percentile',m.display_percentile??98,'type="number" min="0" max="100" step="any" required'),'The largest exact per-raster cap applies to every alternative for that pollutant.')+'</div>'+
   '<h3>Family titles</h3><div class="atlas-grid">'+releaseFamilies(draft).map(([id,label])=>field(label,input('family_'+id,m.family_titles?.[id]||'','maxlength="110" placeholder="'+esc(label)+'"'),'',true)).join('')+'</div>'+
   '<h3>Combined export priority</h3><p class="atlas-note">Weights and positive-cell caps define the saved dimensionless planning index. Blank caps use the existing positive-cell 95th percentile. The display percentile above controls the printed legends.</p>'+
   table(['Pollutant','Weight','Explicit priority cap'],MASS.map(id=>'<tr><td>'+esc(human(id))+'<small>'+esc(baseline?.artifacts?.[id]?.units||'Native export units')+'</small></td><td>'+
    input('weight_'+id,m.weights?.[id]??1,'type="number" min="0" step="any" required aria-label="'+esc(human(id)+' weight')+'"')+'</td><td>'+
    input('cap_'+id,m.caps?.[id]??'','type="number" min="0" step="any" aria-label="'+esc(human(id)+' priority cap')+'"')+'</td></tr>'));
 }

 function economicKey(selection=draft){
  return pretty([selection.baseline_run_id,selection.scenario_run_ids||[],
   selection.source_report_id||null,selection.source_report_sha256||null]);
 }
 function economicPair(selection=draft){
  return pretty([selection.economic_edition_id||null,selection.economic_edition_sha256||null]);
 }
 function economicRelease(release,selection=draft){
  const expected=[selection.baseline_run_id,...(selection.scenario_run_ids||[])],chosen=release?.selection;
  if(!chosen||pretty([chosen.baseline_run_id,...(chosen.scenario_run_ids||[])])!==pretty(expected))
   throw Error('The watershed report no longer matches this ordered run cohort. Refresh the compatible choices.');
  if(selection.source_report_id&&chosen.source_report_id!==selection.source_report_id)
   throw Error('Choose an economic edition from the linked watershed report.');
  if(selection.source_report_sha256&&chosen.source_report_sha256!==selection.source_report_sha256)
   throw Error('The linked watershed report bytes differ. Reopen its original selection.');
  if(!release.ready)throw Error((release.issues||[]).map(row=>row.message).join(' ')||'Complete the original report cohort before selecting its economic edition.');
  const editions=release.economic_editions||[];
  if(!Array.isArray(editions)||editions.some(row=>!/^[0-9a-f]{64}$/.test(row.id||'')||!/^[0-9a-f]{64}$/.test(row.edition_sha256||'')))
   throw Error('The economic choices need their retained edition identities. Refresh the original report.');
  return editions;
 }
 function syncEconomicScope(){
  const scope=pretty([workspace,generation,handoff,economicKey()]);
  if(scope!==economicScope){
   economicScope=scope;if(economicChoices?.key!==economicKey())economicChoices=null;
   economicLoading=false;economicError='';economicRequest++;
  }
 }
 function economicPanel(){
  syncEconomicScope();
  const linked=draft.economic_edition_id,valid=economicChoices?.key===economicKey(),choices=valid?economicChoices:null;
  const editions=choices?.editions||[],selected=choices?.chosen_id||'',disabled=economicLoading?'disabled':'';
  const bound=linked?'<p>Economic edition '+esc(short(linked))+' adds its selected-zone physical response, costs, budget criteria and complete decision package to the client report.</p>'+
   button('remove-economics','Remove economic edition')+(draft.source_report_id?'<p class="atlas-note">The physical report and map selection remain linked to the original watershed report.</p>':''):'<p class="atlas-note">This draft includes the physical client report and maps. An optional completed economic edition adds its original selected-zone assessment.</p>';
  return '<h3>Economic decision edition</h3>'+bound+
   '<p class="atlas-note">Choose a compatible saved edition here to retain the current sources, layout, contact and notes. The current binding stays in place until a replacement is applied.</p>'+
   '<div class="atlas-actions">'+button('load-economics',economicLoading?'Reading original editions…':'Refresh compatible economic editions',disabled)+'</div>'+
   (economicError?'<p class="atlas-error" role="alert">'+esc(economicError)+'</p>':'')+
   (choices?'<div class="atlas-grid">'+
    field('Original watershed report',select('economic_report_choice',choices.reports.map(row=>[row.id,row.title||short(row.id)]),choices.report_id,disabled+(draft.source_report_id?' disabled':'')))+
    field('Completed economic edition',select('economic_edition_choice',editions.map(row=>[row.id,row.title+' · '+row.zone_title]),selected,disabled+(editions.length?'':' disabled')))+'</div>'+
    '<div class="atlas-actions">'+button('apply-economics','Use selected economic edition',disabled+(!selected?' disabled':''))+
     (choices.report_id?button('source-report','Open compatible watershed report','data-id="'+esc(choices.report_id)+'"'):'')+'</div>'+
    (editions.length?'':'<p class="atlas-note">This watershed report has no compatible completed economic edition. Save one in the Economic desk, return to this atlas draft and refresh its choices.</p>')+
    ((choices.release?.economic_issues||[]).length?'<p class="atlas-note">'+esc(choices.release.economic_issues.map(row=>row.message).join(' '))+'</p>':''):'');
 }
 function renderEconomics(){
  const panel=root?.querySelector('[data-atlas-economics]');
  if(panel)panel.innerHTML=economicPanel();
 }
 async function loadEconomicChoices(reportId=''){
  collect();persist();ensure();syncEconomicScope();
  const panel=root?.querySelector('[data-atlas-economics]');if(!panel)return;
  const atWorkspace=workspace,epoch=generation,intent=handoff,request=++economicRequest,keyAtStart=economicKey();
  const owns=()=>workspace===atWorkspace&&generation===epoch&&handoff===intent&&economicRequest===request&&
   economicKey()===keyAtStart&&panel===root?.querySelector('[data-atlas-economics]');
  economicLoading=true;economicError='';renderEconomics();
  try{
   let reports;
   if(draft.source_report_id)reports=[{id:draft.source_report_id,title:'Linked watershed report '+short(draft.source_report_id)}];
   else{
    const catalog=await host.api(endpoint('/api/scenario-reports/catalog'));
    ensure();if(!owns())return;
    const ids=[draft.baseline_run_id,...(draft.scenario_run_ids||[])];
    reports=(catalog.reports||[]).filter(row=>pretty(row.selection?.run_ids)===pretty(ids))
     .sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||'')||a.id.localeCompare(b.id));
   }
   if(!reports.length)throw Error('Save a watershed report containing this exact baseline and ordered alternatives, then refresh its economic choices.');
   const chosen=reportId||((economicChoices?.key===keyAtStart&&reports.some(row=>row.id===economicChoices.report_id))?economicChoices.report_id:reports[0].id);
   if(!reports.some(row=>row.id===chosen))throw Error('Choose an available watershed report for this cohort.');
   const release=await host.api(endpoint('/api/scenario-reports/release',{report_id:chosen}));
   ensure();if(!owns())return;
   if(release.selection?.source_report_id!==chosen)throw Error('The returned watershed report differs from the selected original. Refresh its choices.');
   const editions=economicRelease(release);
   reports=reports.map(row=>row.id===chosen?{...row,title:release.source_report?.report_title||row.title}:row);
   const prior=economicChoices?.key===keyAtStart?economicChoices.chosen_id:'';
   const wanted=editions.some(row=>row.id===prior)?prior:editions.some(row=>row.id===draft.economic_edition_id)?draft.economic_edition_id:'';
   economicChoices={key:keyAtStart,reports,report_id:chosen,release,editions,chosen_id:wanted};
  }catch(error){if(owns())economicError=error.message||String(error);}
  finally{
   if(workspace===atWorkspace&&generation===epoch&&economicRequest===request){
    economicLoading=false;if(panel===root?.querySelector('[data-atlas-economics]'))renderEconomics();
   }
  }
 }
 async function applyEconomicChoice(){
  collect();persist();ensure();syncEconomicScope();
  const choices=economicChoices,keyAtStart=economicKey(),panel=root?.querySelector('[data-atlas-economics]');
  if(!panel||choices?.key!==keyAtStart)throw Error('Refresh the economic editions for this run cohort.');
  const chosenId=value('economic_edition_choice'),edition=choices.editions.find(row=>row.id===chosenId);
  if(!edition)throw Error('Choose a compatible completed economic edition.');
  choices.chosen_id=chosenId;
  const atWorkspace=workspace,epoch=generation,intent=handoff,request=++economicRequest,previous=economicPair();
  const owns=()=>workspace===atWorkspace&&generation===epoch&&handoff===intent&&economicRequest===request&&
   economicKey()===keyAtStart&&panel===root?.querySelector('[data-atlas-economics]');
  economicLoading=true;economicError='';renderEconomics();
  try{
   const release=await host.api(endpoint('/api/scenario-reports/release',{report_id:choices.report_id}));
   ensure();if(!owns())return;
   if(economicPair()!==previous)throw Error('The economic binding changed while its replacement loaded. Refresh and choose the intended edition.');
   if(release.selection?.source_report_id!==choices.report_id)throw Error('The returned watershed report differs from the selected original. Refresh its choices.');
   const editions=economicRelease(release),current=editions.find(row=>row.id===chosenId);
   if(!current||current.edition_sha256!==edition.edition_sha256)
    throw Error('The selected economic edition changed or is unavailable. Refresh the original choices.');
   collect();
   draft.economic_edition_id=current.id;draft.economic_edition_sha256=current.edition_sha256;
   operationId=null;economicChoices={...choices,release,editions,chosen_id:current.id};persist();
   host.toast?.('The selected economic edition is linked to this prepared atlas.');
  }catch(error){if(owns())economicError=error.message||String(error);}
  finally{
   if(workspace===atWorkspace&&generation===epoch&&economicRequest===request){
    economicLoading=false;if(panel===root?.querySelector('[data-atlas-economics]'))renderEconomics();
   }
  }
 }

 function decisionSummary(selection=draft){
  const decision=selection?.source_decision;if(!decision)return '';
  const profile=rowBy(data(),'profiles',decision.profile_id);
  const attributes='data-study-id="'+esc(decision.study_id)+'" data-run-id="'+esc(decision.run_id)+'" data-revision="'+esc(decision.revision)+'" data-profile-id="'+esc(decision.profile_id)+'"'+
   (Number.isInteger(decision.point_index)?' data-point-index="'+decision.point_index+'"':'');
  return '<section class="atlas-summary"><h3>Saved Decision calculation</h3>'+
   '<p>These maps show the chosen modeled alternative under '+esc(profile?.title||decision.profile_id)+'. The attached Decision report retains its complete comparison across scientific profiles, economic inputs, objective and calculation.</p>'+
   '<p>Study revision '+esc(decision.revision)+(Number.isInteger(decision.point_index)?' · selected budget point '+(decision.point_index+1):'')+'</p>'+
   (typeof host.openDesk==='function'?'<div class="atlas-actions">'+button('source-decision','Open saved Decision calculation',attributes)+'</div>':'')+'</section>';
 }

 function reviewStep(){
  const included=[draft.baseline_run_id,...(draft.scenario_run_ids||[])],c=draft.contact||{};
  return '<div class="atlas-grid">'+field('Responsible contact',input('contact_name',c.name||'',isStudy(draft)?'':'required'))+
   field('Organization',input('contact_organization',c.organization||'',isStudy(draft)?'':'required'))+
   field('Email',input('contact_email',c.email||'',isStudy(draft)?'type="email"':'type="email" required'),'',true)+
   field('Interpretation and delivery notes',textarea('notes',(draft.notes||[]).join('\n'),'rows="5"'),'One retained note per line.',true)+'</div>'+
   '<details class="atlas-inclusions"><summary>Original observations and editable spatial work</summary>'+
   '<h4>Observed annual-load comparisons</h4>'+choices('observations',(data().observation_comparisons||[]).filter(r=>included.includes(r.run_id)).map(r=>({...r,title:short(r.id)+' · '+runName(data(),r.run_id)})),draft.observation_comparison_ids||[])+
   '<h4>Saved map views</h4>'+choices('reviews',data().spatial_reviews||[],draft.spatial_review_ids||[])+
   '<h4>Completed map exports</h4>'+choices('exports',(data().spatial_exports||[]).filter(r=>r.state==='complete'),draft.spatial_export_ids||[])+'</details>'+
   '<div class="atlas-summary"><h3>Complete release</h3><p>'+esc(draft.title||'Untitled release')+'</p><p>'+esc(runName(data(),draft.baseline_run_id))+' · '+(draft.scenario_run_ids||[]).length+' alternatives</p>'+
   '<p>'+releaseFamilies(draft).length+' selected map families'+(draft.receiving_waters?' plus the selected receiving-water analysis families':'')+', combined atlas, separate map PDFs, JSON/CSV page index, physical GeoTIFFs, metadata, PDF/HTML/Markdown report and editable working archive.</p>'+
   '</div><section class="atlas-summary" data-atlas-economics>'+economicPanel()+'</section>'+
   decisionSummary(draft)+sourceSummary(draft)+
   '<div data-atlas-problems></div>';
 }

 function renderProblems(){
  const node=root?.querySelector('[data-atlas-problems]');if(!node)return;
  const issues=problems();
  node.innerHTML=issues.length?'<h3>Complete these selections</h3><ul>'+issues.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>':'<p>Ready to submit the complete native delivery.</p>';
 }
 function catalogue(){
  const rows=(data().deliveries||[]).slice().reverse();
  return rows.length?table(['Release','State','Map sheets',''],rows.map(row=>'<tr><td>'+esc(titleOf(row))+'<small>'+esc(short(row.id))+'</small></td><td>'+esc(row.state)+'</td><td>'+
   Object.keys(row.maps||{}).length+'</td><td>'+button('open','Open atlas and files','data-id="'+esc(row.id)+'"')+'</td></tr>')):
   '<p class="atlas-note">Completed and in-progress delivery builds appear here.</p>';
 }
 function downloadLink(file,label){
  const url=safeFileURL(file?.url);
  return url?'<a href="'+esc(url)+'?download=1" download>'+esc(label||file.filename)+'</a>':'';
 }
 function retainedFile(record){
  return opened?._downloads?.find(f=>f.sha256===record?.sha256&&f.bytes===record?.bytes);
 }
 function pairChoices(){
  const entries=[];
  for(const row of opened?.atlas?.pages||[]){
   if(!row.scenario_run_id)continue;
   for(const [index,panel] of (row.panels||[]).entries()){
    const scale=panel.display_scale;
    if(!scale||!Number.isFinite(scale.minimum)||!Number.isFinite(scale.maximum)||scale.minimum>=scale.maximum)continue;
    const units=['dimensionless','dimensionless (0-1)','dimensionless (0–1)'].includes(panel.units)?'dimensionless':panel.units;
    const group=JSON.stringify([row.family,panel.title,Boolean(panel.signed),units,scale.minimum,scale.maximum]);
    entries.push({id:JSON.stringify([row.map_key,index]),group,row,panel,index,
     label:(row.subtitle||row.scenario_run_id)+' · '+panel.title+' · page '+row.page});
   }
  }
  return entries.filter(entry=>entries.some(other=>other.group===entry.group&&other.row.scenario_run_id!==entry.row.scenario_run_id));
 }
 function pairDraft(choices=pairChoices()){
  const key=workspace+'/'+opened?.id,value=pairDrafts.get(key)||{mode:'compare'};
  const left=choices.find(item=>item.id===value.left)||choices[0];
  const rights=left?choices.filter(item=>item.group===left.group&&item.row.scenario_run_id!==left.row.scenario_run_id):[];
  const right=rights.find(item=>item.id===value.right)||rights[0];
  const result={left:left?.id||'',right:right?.id||'',mode:['compare','swipe'].includes(value.mode)?value.mode:'compare'};
  pairDrafts.set(key,result);return {value:result,left,right,rights,choices};
 }
 function pairControls(){
  const {value,left,right,rights,choices}=pairDraft();
  if(!left||!right)return '<h3>Compare alternative maps</h3><p class="atlas-note">Paired inspection is available when this release retains the same quantity for at least two alternatives. You can revise the selection to include other completed alternatives.</p>';
  const options=(items,selected)=>items.map(item=>'<option value="'+esc(item.id)+'" '+(item.id===selected?'selected':'')+'>'+esc(item.label)+'</option>').join('');
  return '<h3>Compare alternative maps</h3><p class="atlas-note">Choose the same map family and pollutant from two alternatives. Original pixels, native geography and the common atlas scale stay together.</p>'+
   '<div class="atlas-grid"><label class="atlas-field"><span>Left source</span><select data-atlas-pair="left">'+options(choices,value.left)+'</select></label>'+
   '<label class="atlas-field"><span>Right source</span><select data-atlas-pair="right">'+options(rights,value.right)+'</select></label>'+
   '<label class="atlas-field"><span>View</span><select data-atlas-pair="mode"><option value="compare" '+(value.mode==='compare'?'selected':'')+'>Linked side by side</option><option value="swipe" '+(value.mode==='swipe'?'selected':'')+'>Swipe between sources</option></select></label></div>'+
   '<p class="atlas-note">'+(left.panel.signed?'Each source is its selected alternative minus the release’s original baseline. Negative values show lower modeled export; positive values show higher export.':'Both sources show the same original absolute quantity.')+
   ' Shared range: '+esc(left.panel.display_scale.minimum)+' to '+esc(left.panel.display_scale.maximum)+' '+esc(left.panel.units)+'.</p>'+
   button('compare-panels','Open paired inspection');
 }
 function changePair(target){
  const {value}=pairDraft();value[target.dataset.atlasPair]=target.value;
  pairDrafts.set(workspace+'/'+opened.id,value);
  const node=root.querySelector('[data-atlas-pair-controls]');
  if(node){node.innerHTML=pairControls();node.querySelector('[data-atlas-pair="'+target.dataset.atlasPair+'"]')?.focus();}
 }
 function outputPanel(){
  if(!opened)return '<h2>Saved releases</h2><div data-atlas-catalogue>'+catalogue()+'</div>';
  const atlas=opened.atlas,all=opened._downloads||[],atlasFile=retainedFile(opened.files?.map_atlas);
  const sourceReportId=opened.selection?.source_report_id;
  const reportPDF=retainedFile(opened.files?.report),reportHTML=retainedFile(opened.files?.report_html);
  const reportMarkdown=retainedFile(opened.files?.report_markdown),reportModel=retainedFile(opened.files?.report_data||opened.files?.report_model);
  const economicPackagePath=opened.economic_decision?.original_edition?.files?.complete_package?.path;
  const economicPackage=retainedFile(opened.economic_decision?.files?.[economicPackagePath]);
  const indexFile=retainedFile(opened.files?.map_atlas_index),csvFile=retainedFile(opened.files?.map_atlas_csv);
  const sourceContextFile=retainedFile(opened.files?.map_atlas_sources);
  const archive=retainedFile(opened.files?.delivery_archive),rows=atlas?.pages||Object.entries(opened.maps||{}).map(([k,file])=>{
   const family=FAMILIES.find(([id])=>k===id||k.startsWith(id+'-'));
   return {map_key:k,family:family?.[0],title:family?.[1]||k,file,page:null,panels:[]};
  });
  return '<div class="atlas-release"><h2>'+esc(titleOf(opened))+'</h2><p>'+esc(opened.state)+' · '+rows.length+' map sheets'+
   (atlas?' · '+atlas.page_count+' atlas pages':'')+'</p><div class="atlas-actions">'+
   (atlasFile?button('preview','Open complete atlas','data-url="'+esc(atlasFile.url)+'"')+downloadLink(atlasFile,'Download atlas PDF'):'')+
   downloadLink(archive,'Download complete GIS package')+
   downloadLink(reportPDF,'Download report PDF')+downloadLink(reportHTML,'Download report HTML')+
   downloadLink(reportMarkdown,'Download report Markdown')+downloadLink(reportModel,'Download structured report data')+
   downloadLink(economicPackage,'Download economic decision package')+downloadLink(indexFile,'Download JSON index')+
   downloadLink(csvFile,'Download CSV index')+downloadLink(sourceContextFile,'Download source choices')+(sourceReportId?button('source-report','Open source watershed report','data-id="'+esc(sourceReportId)+'"'):'')+
   button('clone','Revise this selection')+button('item','Open complete record','data-kind="deliveries" data-id="'+esc(opened.id)+'"')+'</div>'+
   '<p class="atlas-note">For offline map review, extract the complete GIS package and open <code>index.html</code>.</p>'+
   (opened.error?'<p class="atlas-error">'+esc(opened.error.message||opened.error)+'</p>':'')+
   decisionSummary(opened.selection||{})+
   '<div class="atlas-actions">'+Object.entries(opened.files||{}).filter(([name])=>name.startsWith('decision_')).map(([name,record])=>downloadLink(retainedFile(record),'Download '+human(name.replace(/^decision_/,'')))).join('')+'</div>'+
   sourceSummary(opened.selection||{},atlas?.source_context?.water_designations||{})+
   (['complete','received_snapshot'].includes(opened.state)&&atlas?'<section class="atlas-pair atlas-source" data-atlas-pair-controls>'+pairControls()+'</section>':'')+
   (opened.atlas&&['complete','received_snapshot'].includes(opened.state)?'<section class="atlas-source" data-atlas-review-collection></section>':'')+
   '<div class="atlas-actions">'+Object.entries(opened.files||{}).filter(([name])=>name.startsWith('receptor_')).map(([name,record])=>downloadLink(retainedFile(record),'Download '+human(name.replace(/^receptor_/,'')))).join('')+'</div>'+
   table(['Page / family','Map','Legend and units',''],rows.map(row=>{
    const file=retainedFile(row.file);
    return '<tr><td>'+esc(row.page??'—')+'<small>'+esc(human(row.family||''))+'</small></td><td>'+esc(row.title)+'<small>'+esc(row.subtitle||'')+'</small></td><td>'+
     (row.panels||[]).map((p,index)=>'<div>'+esc(p.title)+' · '+esc(p.units)+
      (p.display_scale?'<small>'+esc(p.display_scale.minimum)+' to '+esc(p.display_scale.maximum)+'</small>':'')+
      (['complete','received_snapshot'].includes(opened.state)?button('inspect-panel','Inspect pixels and geography','data-map-key="'+esc(row.map_key)+'" data-panel-index="'+index+'"'):'')+'</div>').join('')+'</td><td>'+
      (atlasFile&&row.page?button('preview','Atlas page','data-url="'+esc(atlasFile.url)+'" data-page="'+row.page+'"'):'')+
      (file?button('preview','Map PDF','data-url="'+esc(file.url)+'"')+downloadLink(file,'Download'):'')+'</td></tr>';
   }))+'<div class="atlas-pdf" data-atlas-pdf hidden></div><details><summary>All retained delivery files</summary>'+
   table(['File','Bytes',''],all.map(f=>'<tr><td>'+esc(f.label||f.filename)+'<small>'+esc(f.filename)+'</small></td><td>'+esc(f.bytes)+'</td><td>'+downloadLink(f,'Download')+'</td></tr>'))+
   '</details></div><h3>Other retained releases</h3><div data-atlas-catalogue>'+catalogue()+'</div>';
 }
 function inspectionPanel(){
  const target=inspection.target,lineage=target.lineage;
  return '<section class="atlas-inspection"><div class="atlas-actions">'+button('return-release','Back to atlas and files')+
   (target.comparison?target.sides.map(side=>button('show-print','Open '+side.slot+' original sheet','data-side="'+esc(side.slot)+'"')).join(''):button('show-print','Open original printed sheet'))+'</div><h2>'+esc(target.title)+' / '+esc(target.panel)+'</h2>'+
   (target.comparison?table(['Side','Alternative','Atlas page'],target.sides.map(side=>'<tr><td>'+esc(human(side.slot))+'</td><td>'+esc(side.label)+'<small>'+esc(side.scenario_run_id)+'</small></td><td>'+esc(side.atlas_page)+'</td></tr>')):'')+
   '<p class="atlas-note">Original raster: '+esc(target.units)+' · retained range '+esc(target.scale.minimum)+' to '+esc(target.scale.maximum)+
   ' · '+(target.comparison?'atlas pages '+target.sides.map(side=>esc(side.atlas_page)).join(' / '):'atlas page '+esc(lineage.atlas_page))+'. Pan, inspect original pixels, annotate, save a spatial review or export a map pack below.</p>'+
   (target.review_id?'<p class="atlas-note">Saved revision '+esc(short(target.review_id))+' · '+esc(target.review_context?.status)+' · '+esc(target.review_context?.reviewer||'Reviewer not entered')+'. Saving changes retains a successor in this atlas collection.</p>':'')+
   (target.context_notes||[]).map(note=>'<p class="atlas-note">'+esc(note)+'</p>').join('')+
   '<div data-atlas-spatial></div></section>';
 }
 function render(){
  if(!root)return;
  reviews.detach();
  inspector.suspend();
  root.innerHTML='<section class="map-atlas"><header class="atlas-header"><div><p class="atlas-eyebrow">SCIENTIFIC WORKBENCH</p>'+
   '<h1>Map atlas and delivery</h1><p>Prepare regional or original-study releases, compare scenario maps on shared legends, and open the complete GIS package.</p></div>'+
   '<div class="atlas-actions">'+button('prepare','Prepare release')+button('releases','Saved releases')+'</div></header>'+
   '<div class="atlas-error" role="alert" data-atlas-error '+(!error?'hidden':'')+'>'+esc(error)+'</div>'+
   (mode==='inspect'&&inspection?inspectionPanel():mode==='outputs'?outputPanel():
   '<nav class="atlas-steps" aria-label="Delivery preparation">'+STEPS.map((label,i)=>'<button type="button" data-atlas-action="step" data-step="'+i+'" '+(i===step?'aria-current="step"':'')+'>'+String(i+1)+'. '+esc(label)+'</button>').join('')+'</nav>'+
   '<form data-atlas-form data-atlas-workspace="'+esc(workspace)+'"><h2>'+STEPS[step]+'</h2>'+
   (step===0?runStep():step===1?'<p class="atlas-note">Use the original source editions and selected legal or operating geography. Source titles, native fields and saved designation bindings travel with the release.</p>'+ROLES.map(([k,l])=>sourceCard('source_roles',k,l,!isStudy(draft))).join('')+OPTIONAL_ROLES.map(([k,l])=>sourceCard('source_roles',k,l,false)).join('')+OVERLAYS.map(([k,l,r])=>sourceCard('overlays',k,l,r&&!isStudy(draft))).join('')+receptorPanel():step===2?settingsStep():reviewStep())+
   '<footer class="atlas-footer"><div class="atlas-actions">'+(step?button('previous','Back'):'')+
    (step<3?'<button type="submit">Continue</button>':'<button type="submit" class="atlas-primary" '+(busy?'disabled':'')+'>'+(busy?'Submitting…':'Build atlas and complete GIS delivery')+'</button>')+
    '</div><div class="atlas-actions">'+button('download-selection','Download selection')+
    '<label class="atlas-file-button">Load selection JSON<input type="file" data-atlas-import accept=".json,application/json"></label>'+
    button('refresh','Refresh choices')+'</div></footer></form>')+'</section>';
  renderProblems();
  if(mode==='inspect'&&inspection)inspector.mount(root.querySelector('[data-atlas-spatial]'),state);
  const reviewRoot=root.querySelector('[data-atlas-review-collection]');if(reviewRoot)reviews.mount(reviewRoot);
 }
 function showError(e){error=e?.message||String(e);const node=root?.querySelector('[data-atlas-error]');if(node){node.hidden=false;node.textContent=error;node.scrollIntoView({block:'nearest'});}}
 function clearError(){error='';const node=root?.querySelector('[data-atlas-error]');if(node){node.hidden=true;node.textContent='';}}
 function edit(event){
  if(event?.target?.closest?.('[data-atlas-spatial], [data-atlas-pair-controls], [data-atlas-review-collection]'))return;
  draftEdits++;operationId=null;
  try{collect();persist();renderProblems();}catch{/* Keep incomplete field text until the next explicit action. */}
 }

 async function loadSourceContext(){
  collect();persist();ensure();const atWorkspace=workspace,epoch=generation;
  contextLoading=true;contextError='';render();
  try{
   const result=await host.api(endpoint('/api/map-atlas/source-context'));
   ensure();if(workspace!==atWorkspace||generation!==epoch)return;
   if(result.workspace_key!==atWorkspace)throw Error('The source profiles belong to another workspace.');
   sourceContext=result;
  }catch(error){if(workspace===atWorkspace&&generation===epoch)contextError=error.message||String(error);}
  finally{if(workspace===atWorkspace&&generation===epoch){contextLoading=false;render();}}
 }
 async function applyDesignation(role){
  collect();persist();const selectionId=value('overlays__'+role+'__designation');
  if(!selectionId)throw Error('Choose a retained water designation first.');
  const atWorkspace=workspace,epoch=generation,original=pretty(draft),request=clone(draft);
  const result=await host.api('/api/water-designations/apply',{method:'POST',body:{workspace:atWorkspace,selection_id:selectionId,delivery_selection:request}});
  ensure();if(workspace!==atWorkspace||generation!==epoch)return;
  collect();if(pretty(draft)!==original)throw Error('The draft changed while the saved designation loaded. Apply it again to the current draft.');
  if(result?.overlays?.[role]?.selection_id!==selectionId)throw Error('The saved designation has another overlay purpose.');
  draft=result;operationId=null;sourcePreview.delete('overlays__'+role);persist();render();
 }
 function useReceptorProfile(){
  collect({replaceReceptors:true});const profile=receptorProfiles().find(row=>row.key===value('receptor_profile_choice'));
  if(!profile)throw Error('Choose an original receptor profile.');
  const issues=receptorIssues(profile.spec);if(issues.length)throw Error(issues.join('\n'));
  draft.receptor_spec=clone(profile.spec);sourcePreview.delete('receptor-network');draft.receptor_profile_source=clone(profile.source||{kind:'retained_selection',id:profile.id});
  operationId=null;persist();render();
 }
 async function importReceptors(file){
  if(!file)return;if(file.size>4*1024*1024)throw Error('The receptor profile exceeds the operator’s 4 MiB JSON request size.');
  collect({replaceReceptors:true});persist();
  const atWorkspace=workspace,epoch=generation,request=++handoff,original=pretty(draft),edits=draftEdits;
  const received=await file.text().then(text=>({text}),error=>({error}));
  ensure();if(workspace!==atWorkspace||generation!==epoch||request!==handoff)return;
  collect({replaceReceptors:true});
  if(edits!==draftEdits||pretty(draft)!==original)throw Error('The release draft changed while the receptor profile loaded. Load it again to use it with the current draft.');
  if('error' in received)throw received.error;
  const body=JSON.parse(received.text);
  const spec=body.receptor_spec||body.selection?.receptor_spec||body.spec||body;
  const issues=receptorIssues(spec);if(issues.length)throw Error(issues.join('\n'));
  collect({replaceReceptors:true});draft.receptor_spec=clone(spec);sourcePreview.delete('receptor-network');
  const profileSource=(body.selection||body).receptor_profile_source;
  if(profileSource)draft.receptor_profile_source=clone(profileSource);
  else delete draft.receptor_profile_source;
  operationId=null;persist();render();
 }


 async function inspectReceptorNetwork(){
  collect();persist();const spec=draft.receptor_spec;
  const baseline=rowBy(data(),'runs',draft.baseline_run_id),grid=rowBy(data(),'grids',baseline?.selection.grid_id);
  const collection=spec?.source_collection_id||grid?.spec?.source_collection_id,source=spec?.network_source_id||grid?.spec?.model_domain?.source_id;
  if(!collection||!source)throw Error('Choose a baseline grid and its original network source.');
  const atWorkspace=workspace,epoch=generation,selection=pretty(spec);
  const info=await host.api(endpoint('/api/source-info',{collection,source,...(spec?.layer?{layer:spec.layer}:{})}));
  ensure();if(workspace!==atWorkspace||generation!==epoch||pretty(draft.receptor_spec)!==selection)return;
  sourcePreview.set('receptor-network',{layer:info.selected_layer,crs:info.crs,fields:info.fields,sample:info.sample});
  render();
 }

 async function inspectSource(name){
  collect();persist();const [group,id]=name.split('__'),choice=clone(draft[group]?.[id]||{});
  if(!choice.source_collection_id||!choice.source_id)throw Error('Choose an original source first.');
  const epoch=generation,atWorkspace=workspace;
  const info=await host.api(endpoint('/api/source-info',{collection:choice.source_collection_id,source:choice.source_id,...(choice.layer?{layer:choice.layer}:{})}));
  ensure();if(epoch!==generation||atWorkspace!==workspace)return;
  if(JSON.stringify(draft[group]?.[id])!==JSON.stringify(choice))return;
  sourcePreview.set(name,info);render();
 }
 async function build(){
  collect();persist();const f=form();if(f&&!f.reportValidity())return;
  const issues=problems();if(issues.length){renderProblems();throw Error('Finish the required run, source and contact selections shown below.');}
  const request=clone(draft),atWorkspace=workspace,epoch=generation;
  operationId??=crypto.randomUUID();persist();busy=true;render();
  try{
   const result=await host.api('/api/actions',{method:'POST',body:{workspace:atWorkspace,action:'delivery.build',payload:request,operation_id:operationId}});
   ensure();if(epoch!==generation||workspace!==atWorkspace)return;
   host.toast?.('The atlas and complete GIS delivery are queued.');
   await host.refreshState?.({force:true});
   ensure();if(epoch===generation&&workspace===atWorkspace)await host.showTask?.(result.id);
  }catch(e){if(epoch===generation&&workspace===atWorkspace)throw e;}
  finally{if(epoch===generation&&workspace===atWorkspace){busy=false;render();}}
 }
 function exportSelection(){
  collect();persist();const body=JSON.stringify({schema:'upstate.delivery-selection/v1',selection:draft},null,2)+'\n';
  const url=URL.createObjectURL(new Blob([body],{type:'application/json'})),a=document.createElement('a');
  a.href=url;a.download='watershed-delivery-selection.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 async function importSelection(file){
  if(!file)return;if(file.size>4*1024*1024)throw Error('The selection JSON exceeds the operator’s 4 MiB JSON request size.');
  const epoch=generation,atWorkspace=workspace,request=++handoff,original=pretty(draft),edits=draftEdits;
  const received=await file.text().then(text=>({text}),error=>({error}));
  ensure();if(epoch!==generation||workspace!==atWorkspace||request!==handoff)return;
  if(edits!==draftEdits||pretty(draft)!==original)throw Error('The release draft changed while the selection file loaded. Load it again to replace the current draft.');
  if('error' in received)throw received.error;
  const body=JSON.parse(received.text),selection=body.selection||body;
  if(!selection||typeof selection!=='object'||Array.isArray(selection)||!Array.isArray(selection.scenario_run_ids))throw Error('Choose a delivery selection with an ordered scenario_run_ids array.');
  draft={...defaultSelection(data()),...clone(selection)};operationId=null;step=0;mode='prepare';opened=null;persist();render();
 }
 async function inspectPanel(mapKey,panelIndex){
  ensure();if(!opened||!['complete','received_snapshot'].includes(opened.state))throw Error('Open an original retained atlas release first.');
  const atWorkspace=workspace,epoch=generation,deliveryId=opened.id,request=++inspectionRequest;
  const existing=inspection?.target?.lineage;
  if(!inspection?.target?.comparison&&existing?.delivery_id===deliveryId&&existing.map_key===mapKey&&existing.panel_index===panelIndex){
   mode='inspect';render();return;
  }
  const result=await host.api('/api/map-atlas/inspect',{method:'POST',body:{workspace:atWorkspace,delivery_id:deliveryId,map_key:mapKey,panel_index:panelIndex}});
  ensure();if(workspace!==atWorkspace||generation!==epoch||opened?.id!==deliveryId||request!==inspectionRequest)return;
  if(result.workspace_key!==atWorkspace||result.target?.kind!=='atlas-panel')throw Error('The native atlas inspection belongs to another workspace.');
  inspection={target:result.target};inspector.suspend();
  await inspector.openTarget({...result.target,workspace:atWorkspace});
  ensure();if(workspace!==atWorkspace||generation!==epoch||opened?.id!==deliveryId||request!==inspectionRequest)return;
  mode='inspect';render();
 }
 async function inspectPair(){
  ensure();if(!opened||!['complete','received_snapshot'].includes(opened.state))throw Error('Open an original retained atlas release first.');
  const {left,right,value}=pairDraft();
  if(!left||!right)throw Error('Choose the same panel from two retained alternatives.');
  const atWorkspace=workspace,epoch=generation,deliveryId=opened.id,request=++inspectionRequest;
  const cache=JSON.stringify([deliveryId,value.left,value.right,value.mode]);
  if(inspection?.comparisonKey===cache){mode='inspect';render();return;}
  const choice=item=>({map_key:item.row.map_key,panel_index:item.index});
  const result=await host.api('/api/map-atlas/compare',{method:'POST',body:{workspace:atWorkspace,delivery_id:deliveryId,left:choice(left),right:choice(right),mode:value.mode}});
  ensure();if(workspace!==atWorkspace||generation!==epoch||opened?.id!==deliveryId||request!==inspectionRequest)return;
  if(result.workspace_key!==atWorkspace||result.target?.kind!=='atlas-panel'||!result.target.comparison)throw Error('The paired atlas inspection belongs to another workspace or selection.');
  inspection={target:result.target,comparisonKey:cache};inspector.suspend();
  await inspector.openTarget({...result.target,workspace:atWorkspace});
  ensure();if(workspace!==atWorkspace||generation!==epoch||opened?.id!==deliveryId||request!==inspectionRequest)return;
  mode='inspect';render();
 }
 async function openSavedReview(id){
  ensure();if(!opened||!['complete','received_snapshot'].includes(opened.state))throw Error('Open the original retained atlas first.');
  const atWorkspace=workspace,epoch=generation,deliveryId=opened.id,request=++inspectionRequest;
  const result=await host.api('/api/map-atlas/review',{method:'POST',body:{workspace:atWorkspace,delivery_id:deliveryId,review_id:id}});
  ensure();if(workspace!==atWorkspace||generation!==epoch||opened?.id!==deliveryId||request!==inspectionRequest)return;
  if(result.workspace_key!==atWorkspace||result.target?.review_id!==id)throw Error('The saved review belongs to another project or selection.');
  inspection={target:result.target,reviewId:id};inspector.suspend();
  await inspector.openTarget({kind:'spatial_reviews',id,workspace:atWorkspace});
  ensure();if(workspace!==atWorkspace||generation!==epoch||opened?.id!==deliveryId||request!==inspectionRequest)return;
  mode='inspect';render();
 }
 async function prepareReviewedRelease(value){
  ensure();requireWorkspace(value.workspace);
  if(opened?.id!==value.delivery_id)throw Error('Reopen the original atlas before preparing its reviewed release.');
  const selection=clone(opened.selection),reviewSet=new Set(value.all_review_ids),exportSet=new Set(value.all_export_ids);
  selection.spatial_review_ids=[...new Set([...(selection.spatial_review_ids||[]).filter(id=>!reviewSet.has(id)),...value.review_ids])];
  selection.spatial_export_ids=[...new Set([...(selection.spatial_export_ids||[]).filter(id=>!exportSet.has(id)),...value.export_ids])];
  await create({workspace_key:value.workspace,selection});
  ensure();requireWorkspace(value.workspace);step=3;persist();render();
 }
 async function click(event){
  const b=event.target.closest('[data-atlas-action]');if(!b||!root?.contains(b))return;
  event.preventDefault();clearError();const atWorkspace=workspace,epoch=generation;
  try{
   const action=b.dataset.atlasAction;
   if(action==='step'||action==='previous'){
    collect();persist();step=action==='previous'?Math.max(0,step-1):Number(b.dataset.step);persist();render();
   }else if(action==='prepare'){mode='prepare';render();}
   else if(action==='releases'){if(mode==='prepare'){collect();persist();}mode='outputs';opened=null;render();}
   else if(action==='open')await open(b.dataset.id);
   else if(action==='clone'){const selection=clone(opened.selection);await create({workspace_key:atWorkspace,selection});}
   else if(action==='source-report')await host.openExtension('scenario-reports','open',b.dataset.id,{workspace_key:atWorkspace});
   else if(action==='source-decision'){
    const selected={workspace_key:atWorkspace,study_id:b.dataset.studyId,revision:Number(b.dataset.revision),run_id:b.dataset.runId,profile_id:b.dataset.profileId};
    if(b.dataset.pointIndex!==undefined)selected.point_index=Number(b.dataset.pointIndex);
    await host.openDesk('robust-workbench','openForCalculation',selected);
   }
   else if(action==='independent-release'){
    collect();for(const key of ['source_report_id','source_report_sha256','economic_edition_id','economic_edition_sha256','source_scenario_analysis_id','source_scenario_analysis_sha256','source_decision'])delete draft[key];
    operationId=null;step=0;mode='prepare';persist();render();
   }else if(action==='remove-economics'){
    collect();delete draft.economic_edition_id;delete draft.economic_edition_sha256;
    operationId=null;persist();render();
   }
   else if(action==='item')await host.openItem?.(b.dataset.kind,b.dataset.id);
   else if(action==='inspect-source')await inspectSource(b.dataset.sourceCardId);
   else if(action==='inspect-panel')await inspectPanel(b.dataset.mapKey,Number(b.dataset.panelIndex));
   else if(action==='compare-panels')await inspectPair();
   else if(action==='return-release'){mode='outputs';render();await reviews.refresh();}
   else if(action==='show-print'){
    const mapKey=b.dataset.side?inspection?.target?.sides?.find(side=>side.slot===b.dataset.side)?.map_key:inspection?.target?.lineage?.map_key;
    const row=opened?.atlas?.pages?.find(item=>item.map_key===mapKey);
    const file=retainedFile(row?.file),url=safeFileURL(file?.url);
    if(!url)throw Error('The original printed map is unavailable.');
    const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener';link.click();
   }
   else if(action==='apply-designation')await applyDesignation(b.dataset.role);
   else if(action==='load-context')await loadSourceContext();
   else if(action==='load-economics')await loadEconomicChoices();
   else if(action==='apply-economics')await applyEconomicChoice();
   else if(action==='load-receptor')useReceptorProfile();
   else if(action==='remove-receptors'){collect({replaceReceptors:true});delete draft.receptor_spec;delete draft.receptor_profile_source;sourcePreview.delete('receptor-network');operationId=null;persist();render();}
   else if(action==='inspect-network')await inspectReceptorNetwork();
   else if(action==='release-source'){
    collect();const [group,id]=b.dataset.sourceCardId.split('__');
    draft[group][id]={source_collection_id:draft[group][id]?.source_collection_id||'',source_id:''};
    operationId=null;persist();render();
   }else if(action==='download-selection')exportSelection();
   else if(action==='refresh'){collect();persist();const current=workspace;await host.refreshState?.({force:true});if(workspace===current){ensure();render();}}
   else if(action==='move'){
    if(cohortLinked(draft))throw Error('Choose a different run cohort before changing the linked report order.');
    collect();const list=draft.scenario_run_ids,index=list.indexOf(b.dataset.id),target=index+Number(b.dataset.direction);
    if(index>=0&&target>=0&&target<list.length){[list[index],list[target]]=[list[target],list[index]];operationId=null;persist();render();}
   }else if(action==='preview'){
    const url=safeFileURL(b.dataset.url);if(!url)throw Error('The retained PDF download is unavailable.');
    const frame=root.querySelector('[data-atlas-pdf]'),page=Number(b.dataset.page||1);
    frame.hidden=false;frame.innerHTML='<div class="atlas-actions"><a href="'+esc(url)+'#page='+page+'" target="_blank" rel="noopener">Open in a separate tab</a></div><iframe title="Retained watershed map PDF" src="'+esc(url)+'#page='+page+'"></iframe>';
    frame.scrollIntoView({block:'start',behavior:'smooth'});
   }
  }catch(e){if(atWorkspace===workspace&&epoch===generation)showError(e);}
 }
 async function change(event){
  if(event.target.closest?.('[data-atlas-spatial]'))return;
  const target=event.target,atWorkspace=workspace,epoch=generation;
  try{
   if(target.matches('[data-atlas-pair]')){changePair(target);return;}
   if(target.matches('[data-atlas-import]')){clearError();await importSelection(target.files?.[0]);return;}
   if(target.matches('[data-atlas-receptor-import]')){clearError();await importReceptors(target.files?.[0]);return;}
   if(target.name==='economic_report_choice'){clearError();await loadEconomicChoices(target.value);return;}
   if(target.name==='economic_edition_choice'){if(economicChoices?.key===economicKey()){economicChoices.chosen_id=target.value;renderEconomics();}return;}
   if(target.name==='baseline'||target.name==='delivery_mode'||/__collection$|__source$|__enabled$/.test(target.name||'')){
    collect();
    const match=target.name.match(/^(source_roles|overlays)__([^_].*?)__(collection|source|enabled)$/);
    if(match&&match[3]==='collection'){
     const [,,id]=match;draft[match[1]][id]={source_collection_id:target.value,source_id:''};
     sourcePreview.delete(match[1]+'__'+id);
    }
    if(match&&match[3]==='source')sourcePreview.delete(match[1]+'__'+match[2]);
    operationId=null;persist();render();
   }else edit();
  }catch(e){if(atWorkspace===workspace&&epoch===generation)showError(e);}
 }
 async function submit(event){
  if(!event.target.matches('[data-atlas-form]'))return;
  event.preventDefault();clearError();const atWorkspace=workspace,epoch=generation;
  try{if(step<3){collect();persist();step++;persist();render();}else await build();}catch(e){if(atWorkspace===workspace&&epoch===generation)showError(e);}
 }
 function mount(node,next){
  if(root&&root!==node)detach();
  root=node;ensure(next);
  root.removeEventListener('click',click);root.addEventListener('click',click);
  root.removeEventListener('change',change);root.addEventListener('change',change);
  root.removeEventListener('input',edit);root.addEventListener('input',edit);
  root.removeEventListener('submit',submit);root.addEventListener('submit',submit);
  render();
 }
 function update(next){
  const previous=workspace;ensure(next);
  reviews.update();
  if(previous!==workspace){render();return;}
  const catalog=root?.querySelector('[data-atlas-catalogue]');if(catalog)catalog.innerHTML=catalogue();
  renderProblems();
  if(mode==='inspect'&&inspection&&root?.querySelector('[data-atlas-spatial]'))inspector.mount(root.querySelector('[data-atlas-spatial]'),state);
 }
 function detach(){
  reviews.detach();
  inspector.suspend();
  if(root){try{if(mode==='prepare'){collect();persist();}}catch{}
   root.removeEventListener('click',click);root.removeEventListener('change',change);
   root.removeEventListener('input',edit);root.removeEventListener('submit',submit);}
  root=null;busy=false;generation++;
 }
 function requireWorkspace(origin){
  if(origin!=null&&origin!==workspace)throw Error('The originating workspace changed. Open this atlas from its original project.');
 }
 async function create(args={}){
  ensure();const atWorkspace=workspace,request=++handoff;
  requireWorkspace(args.workspace_key);
  const {workspace_key:origin,selection:incoming,...fields}=args;
  const selection=clone(incoming||fields);
  await host.navigate?.('map-atlas');
  ensure();requireWorkspace(atWorkspace);requireWorkspace(origin);
  if(request!==handoff)return;
  draft={...defaultSelection(data()),...selection};
  draft.source_roles??={};draft.overlays??={};draft.map_settings??={};draft.contact??={};
  operationId=null;step=0;mode='prepare';opened=null;error='';persist();
  render();return {view:'map-atlas',workspace_key:workspace,selection:clone(draft)};
 }
 async function open(id,options={}){
  ensure();const atWorkspace=workspace,epoch=generation,request=++handoff;
  requireWorkspace(options.workspace_key);
  const result=await host.api(endpoint('/api/item',{kind:'deliveries',id}));
  ensure();requireWorkspace(atWorkspace);requireWorkspace(options.workspace_key);
  if(request!==handoff||generation!==epoch)return;
  await host.navigate?.('map-atlas');
  ensure();requireWorkspace(atWorkspace);requireWorkspace(options.workspace_key);
  if(request!==handoff)return;
  opened=result;mode='outputs';error='';render();return result;
 }
 ensure();
 return {mount,update,detach,create,open};
}
