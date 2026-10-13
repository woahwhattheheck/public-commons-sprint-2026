/** Single-profile editing over the original native coefficient materializer. */
import {createProfileCustomerReview} from './profile_customer_review.mjs';
import {createBiophysicalEvidence} from './biophysical_evidence.mjs';
const text = value => String(value ?? '');
const esc = value => text(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list = value => Array.isArray(value) ? value : [];
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item);
const short = value => text(value).slice(0,12);
const human = value => text(value).replaceAll('_',' ');
const date = value => value ? new Date(value).toLocaleString() : '—';
const valueText = value => value && typeof value === 'object' ? JSON.stringify(value) : text(value);
const lines = value => list(value).map(valueText).join('\n');
const splitLines = value => text(value).split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
const states = {working:'Working',reviewed:'Scientist reviewed',changes_requested:'Changes requested'};
const reviewOf = row => typeof row?.review_state === 'string' ? {status:row.review_state} : row?.review_state || {status:'working'};
const badge = row => '<span class="pw-status">'+esc(states[reviewOf(row).status] || states.working)+'</span>';
const button = (action,caption,attrs='',primary=false) => '<button type="button" data-pw-action="'+esc(action)+'" '+attrs+' class="'+(primary?'primary':'')+'">'+esc(caption)+'</button>';
const option = (value,caption,selected=false) => '<option value="'+esc(value)+'"'+(selected?' selected':'')+'>'+esc(caption)+'</option>';
const input = (name,caption,value,attrs='',help='') => '<label class="pw-field"><span>'+esc(caption)+'</span><input data-pw-field="'+esc(name)+'" value="'+esc(valueText(value))+'" '+attrs+'>'+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
const area = (name,caption,value,help='',attrs='') => '<label class="pw-field"><span>'+esc(caption)+'</span><textarea data-pw-field="'+esc(name)+'" rows="3" '+attrs+'>'+esc(valueText(value))+'</textarea>'+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
const descriptors = value => Array.isArray(value) ? value.map(v=>typeof v==='string'?{name:v,label:human(v)}:{...v,name:v.name||v.key||v.path}) : value&&typeof value==='object'?Object.entries(value).map(([name,v])=>typeof v==='object'?{name,...v}:{name,label:text(v)}):[];

/** RFC 4180 records; quoted line breaks and UTF-8 BOM are preserved correctly. */
export function parseCoefficientCSV(source) {
  const value=text(source).replace(/^\uFEFF/,'');
  const records=[];let row=[],cell='',quoted=false,closed=false,started=false;
  const endCell=()=>{row.push(cell);cell='';closed=false;started=false;};
  const endRow=()=>{endCell();records.push(row);row=[];};
  for(let i=0;i<value.length;i++){
    const c=value[i];
    if(quoted){if(c==='"'){if(value[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;}
    else if(c===',')endCell();
    else if(c==='\r'||c==='\n'){if(c==='\r'&&value[i+1]==='\n')i++;endRow();}
    else if(c==='"'&&!started&&!cell){quoted=true;started=true;}
    else {if(closed||c==='"')throw Error('The CSV contains a misplaced quote. Keep embedded quotes inside a quoted field.');cell+=c;started=true;}
  }
  if(quoted)throw Error('The CSV ends inside a quoted field.');
  if(cell||row.length||started||closed)endRow();
  while(records.length&&records.at(-1).every(v=>v===''))records.pop();
  if(records.length<2)throw Error('The CSV needs a header and at least one land-cover row.');
  const columns=records.shift();
  if(columns.some(v=>!v.trim())||new Set(columns).size!==columns.length)throw Error('CSV column names must be nonempty and distinct.');
  if(!columns.includes('lucode'))throw Error('The CSV requires the original lucode column.');
  return {columns,rows:records.map((record,i)=>{
    if(record.length!==columns.length)throw Error('CSV record '+(i+2)+' has '+record.length+' fields; the header has '+columns.length+'.');
    return Object.fromEntries(columns.map((name,j)=>[name,record[j]]));
  })};
}
export function coefficientCSV(table) {
  const cell=value=>/[",\r\n]/.test(text(value))?'"'+text(value).replaceAll('"','""')+'"':text(value);
  return [table.columns,...table.rows.map(row=>table.columns.map(column=>row[column]??''))].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
/** A coefficient revision retains original row identities, ordering and source descriptions. */
export function mergeCoefficientCSV(original,incoming,editableFields) {
  const allowed=new Set(editableFields);
  if(canonical(original.columns)!==canonical(incoming.columns))throw Error('Keep the original CSV columns and their order. Import a different source table through Original sources.');
  if(original.rows.length!==incoming.rows.length)throw Error('Keep the original land-cover rows. Import a different source table through Original sources.');
  incoming.rows.forEach((row,i)=>{
    if(text(row.lucode)!==text(original.rows[i].lucode))throw Error('Keep the original land-cover codes and row order (row '+(i+2)+').');
    for(const column of original.columns)if(!allowed.has(column)&&text(row[column])!==text(original.rows[i][column]))
      throw Error('Keep the original '+column+' source value for code '+row.lucode+'. Only native coefficient cells can change in this revision.');
  });
  return copy(incoming);
}
export function coefficientChanges(before,after) {
  const original=new Map(list(before?.rows).map(row=>[text(row.lucode),row])),changed=[];
  for(const row of list(after?.rows))for(const column of list(after.columns)){
    const prior=original.get(text(row.lucode));
    if(column!=='lucode'&&text(prior?.[column])!==text(row[column]))changed.push({lucode:row.lucode,column,before:prior?.[column],after:row[column]});
  }
  return changed;
}

export function createProfileWorkbench(host) {
  if(typeof host.api!=='function'||typeof host.getState!=='function')throw Error('Open this desk through the original scientific operator.');
  let root=null,events=null,workspace=null,catalog=null,opened=null,editor=null,draftKey=null,preview=null,comparison=null;
  let memory={drafts:{},requests:[],selected:null,open_draft:null},mode='empty',busy=false,disposed=true,epoch=0,lifecycle=0,taskSignature='';
  let profileSearch='',profileState='all',tableSearch='',tableGroup='all',message='',isError=false;
  let reviewDraft={status:'working',reviewer:'',reviewer_role:'',reference:'',notes:''};
  const $=s=>root?.querySelector(s),$$=s=>root?[...root.querySelectorAll(s)]:[];
  const current=()=>host.getState()?.workspace_key||null;
  const profiles=()=>list(catalog?.profiles),tables=()=>list(catalog?.tables),methods=()=>catalog?.methods||{};
  const parameters=model=>descriptors(methods().parameters?.[model]||methods().parameter_fields?.[model]);
  const fields=()=>descriptors(methods().table_fields||methods().coefficient_fields||methods().table?.fields);
  const descriptor=name=>fields().find(field=>field.name===name)||{name,label:name};
  const models=profile=>list(profile?.models).length?profile.models:['ndr','sdr'];
  const profileId=row=>row?.profile_id||row?.profile?.id||row?.id;
  const titleFor=id=>profiles().find(row=>profileId(row)===id)?.title||short(id);
  const storageKey=key=>'upstate-profile-workbench-v1:'+key;
  const nativeColumns=()=>fields().filter(field=>field.name!=='lucode'&&field.editable!==false&&(list(field.models).length||field.editable===true)).map(field=>field.name);
  const tasks=()=>list(host.getState()?.tasks).filter(task=>['profile.edition.save','profile.edition.review'].includes(task.action));
  const biophysicalEvidence=createBiophysicalEvidence(host,{onProfile:id=>openProfile(id)});
  const customerReview=createProfileCustomerReview(host,{onApplied:async selected=>{
    const origin=workspace,generation=lifecycle,id=profileId(opened);
    if(!activeScope(origin,generation)||selected.workspace_key!==origin||selected.profile_id!==id||mode!=='detail')return;
    const refreshed=await refreshCatalog(false,true);
    if(refreshed&&activeScope(origin,generation)&&mode==='detail'&&profileId(opened)===id)
      await openProfile(id,{guard:()=>activeScope(origin,generation)&&mode==='detail'&&profileId(opened)===id});
  }});
  function setMessage(value='',error=false){message=text(value);isError=error;const node=$('[data-pw-message]');if(node){node.textContent=message;node.hidden=!message;node.classList.toggle('pw-error',isError);}}
  function persist(){
    if(!workspace)return;
    if(editor&&draftKey)memory.drafts[draftKey]=copy(editor);
    memory.open_draft=mode==='editor'?draftKey:null;
    if(opened)memory.selected=profileId(opened);
    try{localStorage.setItem(storageKey(workspace),JSON.stringify(memory));}catch{setMessage('Browser draft storage is unavailable. Save the working profile to retain it with the project.');}
  }
  function storedMemory(key){
    try{const found=JSON.parse(localStorage.getItem(storageKey(key))||'null');if(found&&found.drafts&&typeof found.drafts==='object'&&!Array.isArray(found.drafts))return {...found,requests:list(found.requests)};}catch{}
    return {drafts:{},requests:[],selected:null,open_draft:null};
  }
  function recall(key){memory=storedMemory(key);}
  function activeScope(key,generation){return !disposed&&key===workspace&&key===current()&&generation===lifecycle;}
  function retainTaskReceipt(key,request,taskId){
    const target=key===workspace?memory:storedMemory(key);
    let retained=target.requests.find(row=>row.operation_id===request.operation_id);
    if(!retained){retained=copy(request);target.requests.push(retained);}
    retained.task_id=taskId;
    if(key===workspace){persist();return;}
    try{localStorage.setItem(storageKey(key),JSON.stringify(target));}catch{}
  }
  function assertWorkspace(key=workspace){if(!key||key!==current())throw Error('The selected project changed. Reopen the profile in its original workspace.');}
  async function read(operation,payload={}){
    const key=workspace,generation=lifecycle;assertWorkspace(key);
    const value=await host.api('/api/profile-workbench/'+operation,{method:'POST',body:{workspace:key,...payload}});
    assertWorkspace(key);if(!activeScope(key,generation))throw Error('The profile view changed while its data was loading.');return value;
  }
  function scaffold(){
    root.classList.add('profile-workbench');
    root.innerHTML='<header class="pw-heading"><div><p class="eyebrow">SCIENTIFIC CONFIGURATION</p><h1>Profile workbench</h1><p>Edit native coefficients, retain parameter revisions and record their scientific review.</p></div><div class="pw-actions">'+button('refresh','Refresh')+button('new','New from source table','',true)+'</div></header><p data-pw-message class="pw-message" role="status" aria-live="polite" hidden></p><div data-pw-tasks></div><div class="pw-layout"><aside class="pw-library" aria-label="Saved parameter profiles"><div class="pw-library-heading"><h2>Profile library</h2><label class="pw-field"><span>Find a profile</span><input type="search" data-pw-filter="profiles" value="'+esc(profileSearch)+'" placeholder="Title or profile ID"></label><label class="pw-field"><span>Review state</span><select data-pw-filter="status">'+[['all','All profiles'],...Object.entries(states)].map(([k,v])=>option(k,v,k===profileState)).join('')+'</select></label></div><div data-pw-library></div><div data-pw-drafts></div></aside><div class="pw-main" data-pw-main></div></div>';
    setMessage(message,isError);paintLibrary();paintTasks();paintMain();
  }
  function paintLibrary(){
    const node=$('[data-pw-library]');if(!node)return;
    const rows=profiles().filter(row=>(profileState==='all'||reviewOf(row).status===profileState)&&(!profileSearch||canonical([row.title,profileId(row)]).toLowerCase().includes(profileSearch.toLowerCase())));
    node.innerHTML=rows.length?rows.map(row=>'<button type="button" class="pw-profile" data-pw-action="open" data-pw-id="'+esc(profileId(row))+'"'+(profileId(opened)===profileId(row)&&mode==='detail'?' aria-current="true"':'')+'><strong>'+esc(row.title||short(profileId(row)))+'</strong><span>'+esc(models(row).map(m=>m.toUpperCase()).join(' + '))+' · '+esc(short(profileId(row)))+'</span>'+badge(row)+'</button>').join(''):'<p class="pw-empty">'+(profiles().length?'No profiles match these filters.':'Create a profile from an imported native coefficient table.')+'</p>';
    const drafts=$('[data-pw-drafts]');if(drafts)drafts.innerHTML=Object.keys(memory.drafts).length?'<h3>Browser drafts</h3>'+Object.entries(memory.drafts).map(([key,value])=>button('draft',value.profile?.title||'Untitled draft','data-pw-draft="'+esc(key)+'"')).join(''):'';
  }
  function paintTasks(){
    const node=$('[data-pw-tasks]');if(!node)return;
    const active=tasks().filter(task=>['queued','running','failed','interrupted'].includes(task.state));
    node.innerHTML=active.length?'<section class="pw-operations"><h2>Profile operations</h2>'+active.map(task=>'<div><span><strong>'+esc(task.action==='profile.edition.save'?'Save profile revision':'Record review')+'</strong> · '+esc(human(task.state))+(task.error?.message?'<small>'+esc(task.error.message)+'</small>':'')+'</span>'+button('task','Open operation','data-pw-id="'+esc(task.id)+'"')+(['failed','interrupted'].includes(task.state)?button('resume','Resume same operation','data-pw-id="'+esc(task.id)+'"'):'')+'</div>').join('')+'</section>':'';
  }
  function sourceHTML(table){
    const source=table?.source||{},uri=source.uri||'';
    return '<dl class="pw-metadata"><dt>Table</dt><dd>'+esc(source.title||table?.biophysical_source_id||'Imported coefficients')+'</dd><dt>Source edition</dt><dd>'+esc(source.vintage||'—')+'</dd><dt>Source reference</dt><dd>'+(/^https?:\/\//i.test(uri)?'<a href="'+esc(uri)+'" target="_blank" rel="noopener noreferrer">'+esc(uri)+'</a>':esc(uri||'—'))+'</dd><dt>Table SHA-256</dt><dd class="mono">'+esc(table?.sha256||source.body?.sha256||'—')+'</dd></dl>';
  }
  function readTable(table){return '<div class="pw-table-scroll" tabindex="0" aria-label="Biophysical coefficient table"><table><thead><tr>'+list(table?.columns).map(name=>'<th scope="col">'+esc(name)+'</th>').join('')+'</tr></thead><tbody>'+list(table?.rows).map(row=>'<tr>'+table.columns.map(name=>'<td>'+esc(row[name])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
  function parameterSummary(profile){return models(profile).map(model=>'<section class="pw-parameter-summary"><h3>'+esc(model.toUpperCase())+' parameters</h3><dl class="pw-metadata">'+Object.entries(profile[model]||{}).map(([key,value])=>'<dt>'+esc(parameters(model).find(field=>field.name===key)?.label||human(key))+'</dt><dd>'+esc(value)+'</dd>').join('')+'</dl></section>').join('');}
  function historyHTML(){
    return list(opened.reviews).length?'<ol class="pw-review-history">'+[...opened.reviews].reverse().map(row=>'<li><div><strong>'+esc(states[row.status]||human(row.status))+'</strong><span>'+esc(date(row.created_at||row.reviewed_at))+'</span></div><p>'+esc(row.reviewer)+(row.reviewer_role?' · '+esc(row.reviewer_role):'')+'</p>'+(row.reference?'<p>Reference: '+esc(row.reference)+'</p>':'')+(row.notes?'<p class="pw-multiline">'+esc(Array.isArray(row.notes)?lines(row.notes):row.notes)+'</p>':'')+'</li>').join('')+'</ol>':'<p class="pw-empty">This is a working scientific configuration. Record an actual scientific review when it has been completed.</p>';
  }
  function downloads(record){return list(record?._downloads).map(file=>/^\/api\/file\/[A-Za-z0-9/_-]+$/.test(file.url||'')?'<a class="pw-download" href="'+esc(file.url)+'?download=1" download>'+esc(file.label||file.filename)+'</a>':'').join('');}
  function paintDetail(){
    customerReview.detach();biophysicalEvidence.detach();
    if(!opened||!$('[data-pw-main]'))return;const profile=opened.profile,table=opened.table,id=profileId(opened),prior=opened.edition?.base_profile_id||opened.edition?.selection?.base_profile_id;
    $('[data-pw-main]').innerHTML='<section class="pw-panel"><header class="pw-panel-heading"><div><h2>'+esc(profile.title)+'</h2><p class="mono">'+esc(id)+'</p><div class="pw-meta-line">'+badge(opened)+'<span>'+esc(models(profile).map(m=>m.toUpperCase()).join(' + '))+'</span></div></div><div class="pw-actions">'+button('revise','Create revision','',true)+button('review','Record review')+'</div></header><div class="pw-panel-body"><div class="pw-two-columns"><div><h3>Scientific sources</h3><ul class="pw-reference-list">'+list(profile.references).map(value=>'<li>'+esc(valueText(value))+'</li>').join('')+'</ul><p><strong>Model period:</strong> '+esc(valueText(profile.model_period)||'Not supplied')+'</p></div><div><h3>Original coefficient table</h3>'+sourceHTML(table)+'</div></div>'+(list(profile.notes).length?'<p class="pw-note pw-multiline">'+esc(lines(profile.notes))+'</p>':'')+'<div class="pw-two-columns">'+parameterSummary(profile)+'</div></div></section><section class="pw-panel"><header class="pw-panel-heading"><div><h2>Biophysical coefficients</h2><p>'+table.rows.length+' land-cover rows · '+table.columns.length+' source columns</p></div>'+button('export-table','Download CSV')+'</header>'+readTable(table)+'</section><section class="pw-panel"><header class="pw-panel-heading"><div><h2>Compare saved revisions</h2><p>Inspect native parameters and coefficient changes against a saved reference profile.</p></div></header><div class="pw-panel-body"><div class="pw-inline-form"><label class="pw-field"><span>Reference profile</span><select data-pw-reference>'+option('','Select a saved profile',!prior)+profiles().filter(row=>profileId(row)!==id).map(row=>option(profileId(row),row.title||short(profileId(row)),profileId(row)===prior)).join('')+'</select></label>'+button('compare','Compare with this profile')+'</div><div data-pw-comparison></div></div></section><section class="pw-panel"><header class="pw-panel-heading"><div><h2>Scientific review history</h2><p>A review applies to the exact saved profile and table.</p></div></header><div class="pw-panel-body">'+historyHTML()+'</div></section>'+(list(opened.lineage).length?'<section class="pw-panel"><header class="pw-panel-heading"><h2>Profile lineage</h2></header><div class="pw-panel-body pw-lineage">'+opened.lineage.map(row=>button('open',row.title||short(row.profile_id||row.id),'data-pw-id="'+esc(row.profile_id||row.id)+'"')).join('')+'</div></section>':'')+(list(opened._downloads).length?'<section class="pw-panel"><div class="pw-panel-body"><h2>Saved files</h2>'+downloads(opened)+'</div></section>':'');
    if(comparison)paintComparison();
    const evidenceNode=document.createElement('div');evidenceNode.setAttribute('data-pw-biophysical-evidence','');$('[data-pw-main]').append(evidenceNode);
    biophysicalEvidence.mount(evidenceNode,{workspace_key:workspace,profile_id:id,title:profile.title});
    const reviewNode=document.createElement('div');reviewNode.setAttribute('data-pw-customer-review','');$('[data-pw-main]').append(reviewNode);
    customerReview.mount(reviewNode,{workspace_key:workspace,profile_id:id,title:profile.title});
  }
  function paintNew(){
    customerReview.detach();biophysicalEvidence.detach();
    $('[data-pw-main]').innerHTML='<section class="pw-panel"><header class="pw-panel-heading"><div><h2>New profile from an original table</h2><p>Select a retained biophysical CSV and the native models it will configure.</p></div></header><form data-pw-new-form class="pw-panel-body"><label class="pw-field"><span>Original coefficient table</span><select data-pw-table-choice required>'+option('','Select an imported CSV',true)+tables().map((row,i)=>option(i,(row.title||row.source?.title||row.biophysical_source_id||row.source_id)+' · '+(row.collection_title||short(row.source_collection_id||row.collection_id)))).join('')+'</select></label><fieldset class="pw-model-choice"><legend>Native models</legend><label><input type="checkbox" data-pw-new-model="ndr" checked> NDR — nutrient export</label><label><input type="checkbox" data-pw-new-model="sdr" checked> SDR — sediment export</label></fieldset><p class="pw-note">Save this original table with the intended native parameters first. Open that saved profile to revise individual coefficients.</p><div class="pw-actions">'+button('new-open','Open profile editor',tables().length?'':'disabled',true)+'</div>'+(!tables().length?'<p class="pw-note">Import a biophysical CSV in Original sources, then refresh the table choices here.</p>':'')+'</form></section>';
  }
  function paintMain(){if(!$('[data-pw-main]'))return;if(mode==='editor'&&editor)return paintEditor();if(mode==='review'&&opened)return paintReview();if(mode==='new')return paintNew();if(opened)return paintDetail();$('[data-pw-main]').innerHTML='<section class="pw-panel"><div class="pw-welcome"><h2>Open a scientific configuration</h2><p>Select a saved profile to inspect its sources, coefficients, native parameters and review history, or create a working profile from an imported table.</p>'+button('new','Select a source table','',true)+'</div></section>';}
  function control(field,value,attrs){
    const choices=list(field.choices||field.options);if(choices.length)return '<select '+attrs+'>'+option('','Select…',value===''||value==null)+choices.map(choice=>{const id=typeof choice==='object'?choice.value??choice.id:choice;return option(id,typeof choice==='object'?choice.label||choice.title||id:choice,text(id)===text(value));}).join('')+'</select>';
    const numeric=['number','integer','float'].includes(field.type)||field.numeric;
    return '<input '+attrs+' type="'+(numeric?'number':'text')+'" value="'+esc(value)+'"'+(numeric?' step="'+(field.type==='integer'?'1':'any')+'"':'')+(field.min!=null?' min="'+esc(field.min)+'"':'')+(field.max!=null?' max="'+esc(field.max)+'"':'')+'>';
  }
  function parameterEditor(model){
    const rows=parameters(model);return '<fieldset class="pw-parameters"'+(!editor.profile.models.includes(model)?' hidden disabled':'')+'><legend>'+model.toUpperCase()+' parameters</legend><div class="pw-form-grid">'+rows.map(field=>'<label class="pw-field"><span>'+esc(field.label||human(field.name))+(field.units?' ('+esc(field.units)+')':'')+'</span>'+control(field,editor.profile[model]?.[field.name]??'','data-pw-model="'+model+'" data-pw-parameter="'+esc(field.name)+'"'+(field.required===false?'':' required'))+(field.help||field.description?'<small>'+esc(field.help||field.description)+'</small>':'')+'</label>').join('')+'</div></fieldset>';
  }
  function paintEditor(){
    customerReview.detach();biophysicalEvidence.detach();
    if(!editor||!$('[data-pw-main]'))return;const canEdit=Boolean(editor.base_profile_id);
    $('[data-pw-main]').innerHTML='<section class="pw-panel pw-editor"><header class="pw-panel-heading"><div><h2>'+(canEdit?'Create a parameter revision':'Create a working profile')+'</h2><p>Save the actual source table, native choices and purpose of this configuration.</p></div>'+button('close-editor','Keep draft and close')+'</header><form data-pw-editor-form><div class="pw-panel-body"><div class="pw-form-grid">'+input('profile.title','Profile title',editor.profile.title,'required autocomplete="off"')+input('profile.model_period','Model period',editor.profile.model_period,'','Use the period represented by these sources.')+area('profile.references','Scientific references',lines(editor.profile.references),'One citation or URL per line.','required')+area('profile.notes','Profile notes',lines(editor.profile.notes))+'</div><fieldset class="pw-model-choice"><legend>Native models</legend>'+['ndr','sdr'].map(model=>'<label><input type="checkbox" data-pw-editor-model="'+model+'"'+(editor.profile.models.includes(model)?' checked':'')+'> '+model.toUpperCase()+'</label>').join('')+'</fieldset><p class="pw-note">To change the selected native models, save that selection with the unchanged coefficient table first. Open the saved edition to revise its coefficients.</p><div class="pw-two-columns">'+parameterEditor('ndr')+parameterEditor('sdr')+'</div><details class="pw-original-source"><summary>Original coefficient source</summary>'+sourceHTML(editor.original_table)+'</details></div><div class="pw-coefficient-heading"><div><h3>Biophysical coefficients</h3><p>'+(canEdit?'Edit native coefficient cells. Original codes and source descriptions stay attached to each row.':'Save and reopen this profile to revise its coefficient cells.')+'</p></div><div class="pw-actions">'+(canEdit?'<label class="pw-upload">Load revised CSV<input type="file" accept=".csv,text/csv" data-pw-csv-upload></label>':'')+button('export-draft','Download draft CSV')+'</div></div><p class="pw-coefficient-note">N/P loads use kg per hectare per year; load type records application-rate or measured-runoff. Retention and USLE factors are dimensionless; critical lengths use metres. Keep each load’s original basis.</p><div class="pw-table-toolbar"><label class="pw-field"><span>Find land-cover rows</span><input type="search" data-pw-filter="table" value="'+esc(tableSearch)+'" placeholder="Code or source description"></label><label class="pw-field"><span>Columns</span><select data-pw-filter="table-group">'+[['all','All source columns'],['ndr','NDR coefficients'],['sdr','SDR coefficients'],['extra','Source descriptions']].map(([key,caption])=>option(key,caption,key===tableGroup)).join('')+'</select></label><p data-pw-table-summary></p></div><div data-pw-table-editor></div><div class="pw-panel-body"><h3>Revision record</h3><div class="pw-form-grid">'+input('revision.author','Prepared by',editor.revision.author,'required','Person or team responsible for the configuration.')+input('revision.title','Coefficient source title',editor.revision.title,'','Title for the revised coefficient edition.')+input('revision.vintage','Coefficient edition or date',editor.revision.vintage,'','Actual edition or date of this revision.')+area('revision.reason','Reason for this revision',editor.revision.reason,'Explain the scientific or operational purpose.','required')+'</div></div><footer class="pw-editor-footer"><p data-pw-draft-state>Working draft</p><div class="pw-actions">'+button('preview','Review changes','',true)+button('save','Save working profile','disabled')+'</div></footer></form><div data-pw-preview></div></section>';
    paintTableEditor();paintPreview();
  }
  function paintTableEditor(){
    const node=$('[data-pw-table-editor]');if(!node||!editor)return;
    const allowed=new Set(nativeColumns()),columns=editor.table.columns.filter(column=>tableGroup==='all'||column==='lucode'||(tableGroup==='extra'?!allowed.has(column):list(descriptor(column).models).includes(tableGroup)));
    const rows=editor.table.rows.map((row,index)=>({row,index})).filter(({row})=>!tableSearch||Object.values(row).some(value=>text(value).toLowerCase().includes(tableSearch.toLowerCase())));
    const original=new Map(editor.original_table.rows.map(row=>[text(row.lucode),row]));
    node.innerHTML='<div class="pw-table-scroll pw-edit-table" tabindex="0" aria-label="Biophysical coefficient editor"><table><thead><tr>'+columns.map(column=>'<th scope="col" title="'+esc(descriptor(column).help||descriptor(column).description||'')+'">'+esc(column)+(descriptor(column).units?'<small>'+esc(descriptor(column).units)+'</small>':'')+'</th>').join('')+'</tr></thead><tbody>'+rows.map(({row,index})=>'<tr>'+columns.map(column=>{
      const prior=original.get(text(row.lucode)),changed=text(prior?.[column])!==text(row[column]),editable=editor.base_profile_id&&allowed.has(column);
      return '<td'+(changed?' class="pw-cell-changed"':'')+'>'+(editable?control(descriptor(column),row[column]??'','data-pw-row="'+index+'" data-pw-column="'+esc(column)+'" aria-label="'+esc(column+', land-cover code '+row.lucode)+'" title="'+esc('Original: '+text(prior?.[column]))+'"'):'<span class="pw-source-cell" title="Original source value">'+esc(row[column])+'</span>')+'</td>';
    }).join('')+'</tr>').join('')+'</tbody></table>'+(!rows.length?'<p class="pw-empty">No rows match this search.</p>':'')+'</div>';
    $('[data-pw-table-summary]').textContent=rows.length+' of '+editor.table.rows.length+' rows · '+coefficientChanges(editor.original_table,editor.table).length+' coefficient changes';
  }
  function invalidate(){preview=null;const node=$('[data-pw-preview]');if(node)node.innerHTML='';const save=$('[data-pw-action="save"]');if(save)save.disabled=true;const state=$('[data-pw-draft-state]');if(state)state.textContent='Draft retained in this browser · review changes to save it to the project';persist();}
  function diffRows(diff,fallback=[]){
    const out=[];const visit=(value,path='')=>{if(Array.isArray(value)){value.forEach(item=>visit(item,path));return;}if(!value||typeof value!=='object')return;if(('before'in value&&'after'in value)||('old'in value&&'new'in value)){out.push({field:[value.lucode!=null?'Code '+value.lucode:null,value.column||value.path||value.field||path].filter(Boolean).join(' · '),before:value.before??value.old,after:value.after??value.new});return;}for(const [key,item]of Object.entries(value))if(!['summary','counts','added','removed','columns_added','columns_removed'].includes(key))visit(item,path?path+'.'+key:key);};
    visit(diff);for(const row of list(diff?.table?.added))out.push({field:'Code '+row.lucode,before:'Absent',after:'Row added'});
    for(const row of list(diff?.table?.removed))out.push({field:'Code '+row.lucode,before:'Row present',after:'Removed'});
    for(const column of list(diff?.table?.columns_added))out.push({field:column,before:'Absent',after:'Column added'});
    for(const column of list(diff?.table?.columns_removed))out.push({field:column,before:'Column present',after:'Removed'});
    if(diff?.table?.order_changed)out.push({field:'Source row order',before:'Original order',after:'Changed'});
    if(!out.length)out.push(...fallback.map(row=>({field:'Code '+row.lucode+' · '+row.column,before:row.before,after:row.after})));return out;
  }
  function diffHTML(diff,fallback=[]){const rows=diffRows(diff,fallback);return rows.length?'<div class="pw-table-scroll"><table><thead><tr><th>Changed field</th><th>Reference</th><th>Revision</th></tr></thead><tbody>'+rows.map(row=>'<tr><th scope="row">'+esc(row.field)+'</th><td>'+esc(valueText(row.before)||'—')+'</td><td>'+esc(valueText(row.after)||'—')+'</td></tr>').join('')+'</tbody></table></div>':'<p class="pw-note">No coefficient or native parameter values differ.</p>';}
  function coverageHTML(coverage){
    const grids=list(coverage.grids),scenarios=list(coverage.scenarios),codes=list(coverage.lucodes);
    const missing=values=>list(values).length?list(values).map(esc).join(', '):'None';
    const identity=(row,key)=>esc(row.title||row[key])+(row.title&&row[key]?'<div class="mono">'+esc(row[key])+'</div>':'');
    return '<section class="pw-coverage"><h4>Land-cover compatibility</h4><p>Coefficient table codes: '+(codes.length?codes.map(esc).join(', '):'None')+'.</p>'+
      (grids.length?'<p><strong>'+grids.filter(row=>row.compatible===true).length+' of '+grids.length+' retained grids compatible.</strong></p><div class="pw-table-scroll" tabindex="0" aria-label="Retained grid compatibility"><table><caption>Retained grids</caption><thead><tr><th scope="col">Grid</th><th scope="col">State</th><th scope="col">Selected models</th><th scope="col">Missing land-cover codes</th><th scope="col">Result</th></tr></thead><tbody>'+grids.map(row=>'<tr><td>'+identity(row,'grid_id')+'</td><td>'+esc(row.state)+'</td><td>'+(row.selected_models_available===true?'Available':'Unavailable')+'</td><td>'+missing(row.missing_lucodes)+'</td><td><strong>'+(row.compatible===true?'Compatible':'Incompatible')+'</strong></td></tr>').join('')+'</tbody></table></div>':'<p>No retained grids are available for this compatibility check.</p>')+
      (scenarios.length?'<div class="pw-table-scroll" tabindex="0" aria-label="Scenario land-cover coverage"><table><caption>Saved scenarios — replacement land-cover codes</caption><thead><tr><th scope="col">Scenario</th><th scope="col">Missing replacement codes</th><th scope="col">Code coverage</th></tr></thead><tbody>'+scenarios.map(row=>'<tr><td>'+identity(row,'scenario_id')+'</td><td>'+missing(row.missing_lucodes)+'</td><td>'+(list(row.missing_lucodes).length?'Add coefficients for the named codes':'All replacement codes covered')+'</td></tr>').join('')+'</tbody></table></div>':'<p>No saved scenarios are available for a replacement-code check.</p>')+'</section>';
  }
  function paintPreview(){
    const node=$('[data-pw-preview]');if(!node)return;const save=$('[data-pw-action="save"]');if(save)save.disabled=busy||!preview?.valid;
    if(!preview){node.innerHTML='';return;}
    node.innerHTML='<section class="pw-preview"><header><h3>'+(preview.valid?'Revision ready to save':'Correct these native configuration fields')+'</h3><p>'+(preview.valid?'The installed model accepted this selection. Saving retains a working profile.':'Your edits remain available. Correct the named values, then review changes again.')+'</p></header>'+(list(preview.errors).length?'<ul class="pw-validation-errors">'+preview.errors.map(error=>'<li>'+esc(typeof error==='string'?error:[error.path||error.field,error.message||valueText(error)].filter(Boolean).join(': '))+'</li>').join('')+'</ul>':'')+diffHTML(preview.diff,coefficientChanges(editor.original_table,editor.table))+(preview.coverage?coverageHTML(preview.coverage):'')+'</section>';
    const state=$('[data-pw-draft-state]');if(state)state.textContent=preview.valid?'Native selection accepted · save the working profile':'Review needs corrections';
  }
  function paintComparison(){const node=$('[data-pw-comparison]');if(node&&comparison)node.innerHTML='<h3>'+esc(titleFor(comparison.left_profile_id||comparison.left?.profile_id))+' → '+esc(opened.profile.title)+'</h3>'+diffHTML(comparison.diff||comparison)+downloads(comparison);}
  function paintReview(){
    customerReview.detach();biophysicalEvidence.detach();
    $('[data-pw-main]').innerHTML='<section class="pw-panel"><header class="pw-panel-heading"><div><h2>Record a scientific review</h2><p>'+esc(opened.profile.title)+'</p><p class="mono">'+esc(profileId(opened))+'</p></div>'+button('review-close','Back to profile')+'</header><form data-pw-review-form class="pw-panel-body"><p class="pw-note">Record the outcome and source of a completed scientific review. The review belongs to this exact saved profile.</p><div class="pw-form-grid"><label class="pw-field"><span>Review outcome</span><select data-pw-review-field="status">'+Object.entries(states).map(([key,caption])=>option(key,caption,reviewDraft.status===key)).join('')+'</select></label><label class="pw-field"><span>Reviewer</span><input data-pw-review-field="reviewer" value="'+esc(reviewDraft.reviewer)+'" required autocomplete="name"></label><label class="pw-field"><span>Reviewer role or organization</span><input data-pw-review-field="reviewer_role" value="'+esc(reviewDraft.reviewer_role)+'" required></label><label class="pw-field"><span>Review reference</span><input data-pw-review-field="reference" value="'+esc(reviewDraft.reference)+'"'+(reviewDraft.status==='reviewed'?' required':'')+'><small>Required for a reviewed outcome. Use the actual scientific review document, correspondence or meeting record.</small></label><label class="pw-field pw-full"><span>Review notes</span><textarea data-pw-review-field="notes" rows="4">'+esc(reviewDraft.notes)+'</textarea></label></div><div class="pw-actions">'+button('review-save','Save review record','',true)+'</div></form></section>';
  }
  async function openProfile(id,options={}){
    persist();const token=++epoch;setMessage('Opening the saved profile and original coefficients…');const result=await read('inspect',{profile_id:id});if(disposed||token!==epoch||(options.guard&&!options.guard()))return;
    if(options.retireDraft&&sameDraft(options.retireDraft,memory.drafts[options.retireDraft.draft_key]))delete memory.drafts[options.retireDraft.draft_key];
    opened=result;opened.profile_id||=id;editor=null;draftKey=null;preview=null;comparison=null;mode='detail';memory.selected=id;persist();paintLibrary();paintDetail();setMessage();
  }
  function startDraft(record,key,baseId=null){
    persist();draftKey=key;
    if(memory.drafts[key])editor=copy(memory.drafts[key]);else{
      const table=copy(record.table),profile=copy(record.profile||{});profile.title=profile.title?profile.title+' · revision':'';profile.models=models(profile);profile.references||=[];profile.notes||=[];profile.ndr||={};profile.sdr||={};
      editor={base_profile_id:baseId,source_collection_id:table.source_collection_id,biophysical_source_id:table.biophysical_source_id,expected_table_sha256:table.sha256,profile,table:{columns:copy(table.columns),rows:copy(table.rows)},original_table:copy(table),revision:{author:'',reason:'',title:table.source?.title||'',vintage:table.source?.vintage||''}};
    }
    mode='editor';tableSearch='';tableGroup='all';preview=null;persist();paintLibrary();paintEditor();setMessage();
  }
  function selection(){
    if(!editor)throw Error('Open a profile draft first.');const profile=copy(editor.profile);
    if(!profile.models.length)throw Error('Select at least one native model.');
    for(const model of ['ndr','sdr']){if(!profile.models.includes(model)){delete profile[model];continue;}for(const field of parameters(model)){
      const value=profile[model]?.[field.name];if(field.required===false&&(value===''||value==null)){delete profile[model][field.name];continue;}
      if((['number','integer','float'].includes(field.type)||field.numeric)&&value!==''&&value!=null&&Number.isFinite(Number(value)))profile[model][field.name]=Number(value);
    }}
    const result={source_collection_id:editor.source_collection_id,biophysical_source_id:editor.biophysical_source_id,expected_table_sha256:editor.expected_table_sha256,profile,table:copy(editor.table),revision:copy(editor.revision)};
    if(editor.base_profile_id)result.base_profile_id=editor.base_profile_id;return result;
  }
  async function refreshCatalog(reopen=false,preserveMain=false){
    const token=++epoch,key=workspace;const result=await read('catalog');if(disposed||key!==workspace||token!==epoch)return false;catalog=result;paintLibrary();paintTasks();
    if(reopen){if(memory.open_draft&&memory.drafts[memory.open_draft]){draftKey=memory.open_draft;editor=copy(memory.drafts[draftKey]);mode='editor';paintEditor();}else if(memory.selected&&profiles().some(row=>profileId(row)===memory.selected))await openProfile(memory.selected);else paintMain();}
    else if(!preserveMain&&mode==='new')paintNew();return true;
  }
  function sameDraft(request,value){return Boolean(request.draft_signature&&value&&canonical(value)===request.draft_signature);}
  function submittedEditor(request){return mode==='editor'&&draftKey===request.draft_key&&sameDraft(request,editor);}
  async function receiveCompleted(){
    if(disposed||!workspace)return;const origin=workspace,generation=lifecycle,completedTasks=tasks(),saved=[],reviews=[];let changed=false;
    for(const request of memory.requests){
      if(request.handled||!request.task_id)continue;const task=completedTasks.find(row=>row.id===request.task_id);if(!task||task.state!=='complete')continue;
      request.handled=true;changed=true;
      if(request.action==='profile.edition.save'){
        const currentDraft=editor&&draftKey===request.draft_key;
        if(!currentDraft&&sameDraft(request,memory.drafts[request.draft_key]))delete memory.drafts[request.draft_key];
        const id=task.result?.profile_id||task.result?.profile?.id;
        if(id&&submittedEditor(request))saved.push({id,request});
      }else if(request.action==='profile.edition.review')reviews.push(request);
    }
    if(!changed)return;persist();paintLibrary();
    const refreshed=await refreshCatalog(false,true);if(!refreshed||!activeScope(origin,generation))return;
    const next=[...saved].reverse().find(row=>submittedEditor(row.request));
    if(next){await openProfile(next.id,{guard:()=>activeScope(origin,generation)&&submittedEditor(next.request),retireDraft:next.request});return;}
    const reviewed=[...reviews].reverse().find(request=>request.profile_id===profileId(opened));
    if(reviewed&&['detail','review'].includes(mode)){
      const id=profileId(opened),token=++epoch,result=await read('inspect',{profile_id:id});
      if(!activeScope(origin,generation)||token!==epoch||profileId(opened)!==id)return;
      opened=result;opened.profile_id||=id;
      if(mode==='review'&&reviewed.review_signature===canonical(reviewDraft))mode='detail';
      if(mode==='detail')paintDetail();persist();paintLibrary();
    }
  }
  async function submit(action,payload){
    const origin=workspace,generation=lifecycle;assertWorkspace(origin);
    const key=canonical({action,payload});let request=memory.requests.find(row=>row.key===key);
    if(!request){request={key,action,operation_id:crypto.randomUUID(),handled:false};memory.requests.push(request);}
    Object.assign(request,{draft_key:action==='profile.edition.save'?draftKey:null,profile_id:profileId(opened),handled:false,
      draft_signature:action==='profile.edition.save'&&editor?canonical(editor):null,
      review_signature:action==='profile.edition.review'?canonical(reviewDraft):null});
    persist();const originalRequest=copy(request);
    const task=await host.api('/api/actions',{method:'POST',body:{workspace:origin,action,payload,operation_id:request.operation_id}});
    retainTaskReceipt(origin,originalRequest,task.id);if(!activeScope(origin,generation))return task;
    await (host.refreshState||host.refresh)?.({force:true});if(!activeScope(origin,generation))return task;
    await receiveCompleted();if(!activeScope(origin,generation))return task;
    paintTasks();setMessage(task.state==='complete'?'The profile operation completed.':'The original operator retained the operation. Its progress appears above.');return task;
  }
  function download(table,name){const url=URL.createObjectURL(new Blob([coefficientCSV(table)],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function action(name,target){
    assertWorkspace();
    if(name==='open')return openProfile(target.dataset.pwId);
    if(name==='refresh'){await refreshCatalog(false);if(opened&&mode==='detail')await openProfile(profileId(opened));return;}
    if(name==='new'){persist();editor=null;draftKey=null;mode='new';preview=null;paintMain();setMessage();return;}
    if(name==='new-open'){
      if(!$('[data-pw-new-form]').reportValidity())return;const chosen=tables()[Number($('[data-pw-table-choice]').value)];if(!chosen)throw Error('Select an original biophysical table.');
      const selected=$$('[data-pw-new-model]:checked').map(node=>node.dataset.pwNewModel);if(!selected.length)throw Error('Select at least one native model.');
      const source={source_collection_id:chosen.source_collection_id||chosen.collection_id,biophysical_source_id:chosen.biophysical_source_id||chosen.source_id||chosen.id,models:selected};
      const result=await read('table',source),table=result.table||result;
      return startDraft({table:{...table,...source},profile:{models:selected}},'new:'+canonical(source));
    }
    if(name==='draft'){persist();const key=target.dataset.pwDraft;if(!memory.drafts[key])throw Error('This draft is no longer available.');draftKey=key;editor=copy(memory.drafts[key]);preview=null;mode='editor';paintEditor();persist();return;}
    if(name==='revise')return startDraft(opened,'revision:'+profileId(opened),profileId(opened));
    if(name==='close-editor'){persist();editor=null;draftKey=null;mode=opened?'detail':'empty';persist();paintMain();return;}
    if(name==='export-table')return download(opened.table,'biophysical-'+short(profileId(opened))+'.csv');
    if(name==='export-draft')return download(editor.table,'biophysical-working-draft.csv');
    if(name==='preview'){
      if(!$('[data-pw-editor-form]').reportValidity())return;const payload=selection();setMessage('Checking this configuration with the original native profile engine…');
      const result=await read('preview',payload);if(canonical(payload)!==canonical(selection()))throw Error('The draft changed while it was being checked. Review the current values again.');
      preview={...result,request:payload};paintPreview();setMessage(result.valid?'Review the changes and save the working profile.':'Correct the named configuration fields and review again.',!result.valid);$('[data-pw-preview]')?.scrollIntoView({block:'nearest'});return;
    }
    if(name==='save'){if(!preview?.valid||canonical(preview.request)!==canonical(selection()))throw Error('Review the current changes before saving.');return submit('profile.edition.save',preview.request);}
    if(name==='review'){reviewDraft={status:'working',reviewer:'',reviewer_role:'',reference:'',notes:''};mode='review';paintReview();return;}
    if(name==='review-close'){mode='detail';paintDetail();return;}
    if(name==='review-save'){if(!$('[data-pw-review-form]').reportValidity())return;const state=reviewOf(opened);return submit('profile.edition.review',{profile_id:profileId(opened),...reviewDraft,expected_review_id:state.review_id||state.id||list(opened.reviews).at(-1)?.id||null});}
    if(name==='compare'){const id=$('[data-pw-reference]').value;if(!id)throw Error('Select a saved reference profile.');comparison=await read('compare',{left_profile_id:id,right_profile_id:profileId(opened)});paintComparison();return;}
    if(name==='task')return host.showTask?.(target.dataset.pwId);
    if(name==='resume'){await host.api('/api/task/resume',{method:'POST',body:{id:target.dataset.pwId}});await (host.refreshState||host.refresh)?.({force:true});paintTasks();return;}
  }
  async function clicked(event){
    const target=event.target.closest('[data-pw-action]');if(!target||!root.contains(target))return;event.preventDefault();event.stopPropagation();if(busy)return;busy=true;target.disabled=true;
    const origin=workspace,generation=lifecycle;
    try{setMessage();await action(target.dataset.pwAction,target);}catch(error){if(activeScope(origin,generation))setMessage(error.message||error,true);}finally{if(activeScope(origin,generation)){busy=false;if(target.isConnected)target.disabled=false;paintPreview();}}
  }
  async function changed(event){
    const node=event.target,filter=node.dataset.pwFilter;
    if(filter==='profiles'){profileSearch=node.value;paintLibrary();return;}if(filter==='status'){profileState=node.value;paintLibrary();return;}
    if(filter==='table'){tableSearch=node.value;paintTableEditor();return;}if(filter==='table-group'){tableGroup=node.value;paintTableEditor();return;}
    if(node.dataset.pwReviewField){reviewDraft[node.dataset.pwReviewField]=node.value;const reference=$('[data-pw-review-field="reference"]');if(reference)reference.required=reviewDraft.status==='reviewed';return;}if(!editor)return;
    if(node.dataset.pwField){const [part,key]=node.dataset.pwField.split('.');editor[part][key]=part==='profile'&&['references','notes'].includes(key)?splitLines(node.value):node.value;invalidate();return;}
    if(node.dataset.pwParameter){editor.profile[node.dataset.pwModel]||={};editor.profile[node.dataset.pwModel][node.dataset.pwParameter]=node.value;invalidate();return;}
    if(node.dataset.pwEditorModel){editor.profile.models=$$('[data-pw-editor-model]:checked').map(node=>node.dataset.pwEditorModel);invalidate();paintEditor();return;}
    if(node.dataset.pwColumn&&node.dataset.pwRow!==undefined){
      editor.table.rows[Number(node.dataset.pwRow)][node.dataset.pwColumn]=node.value;node.closest('td')?.classList.add('pw-cell-changed');invalidate();
      const summary=$('[data-pw-table-summary]');if(summary)summary.textContent=editor.table.rows.length+' rows · '+coefficientChanges(editor.original_table,editor.table).length+' coefficient changes';return;
    }
    if(node.hasAttribute('data-pw-csv-upload')&&event.type==='change'&&node.files?.[0]){
      const key=draftKey,origin=workspace,generation=lifecycle;
      try{const incoming=parseCoefficientCSV(await node.files[0].text());if(!activeScope(origin,generation)||key!==draftKey||!editor)return;if(!editor.base_profile_id)throw Error('Save and reopen the original profile before revising coefficients.');
        editor.table=mergeCoefficientCSV(editor.original_table,incoming,nativeColumns());tableSearch='';invalidate();paintTableEditor();setMessage('The revised native coefficients are loaded into this draft. Review changes to save them.');}
      catch(error){if(activeScope(origin,generation))setMessage(error.message,true);}node.value='';
    }
  }
  async function mount(node,snapshot=host.getState()){
    detach();root=node;disposed=false;workspace=snapshot?.workspace_key||current();if(!workspace)throw Error('Open a retained scientific workspace.');
    catalog=null;opened=null;editor=null;draftKey=null;preview=null;comparison=null;mode='empty';taskSignature='';recall(workspace);events=new AbortController();
    root.addEventListener('click',clicked,{signal:events.signal});root.addEventListener('input',changed,{signal:events.signal});root.addEventListener('change',changed,{signal:events.signal});root.addEventListener('submit',event=>event.preventDefault(),{signal:events.signal});
    scaffold();setMessage('Reading saved scientific profiles…');const origin=workspace,generation=lifecycle;try{await refreshCatalog(true);if(!activeScope(origin,generation))return;await receiveCompleted();if(activeScope(origin,generation))setMessage();}catch(error){if(activeScope(origin,generation))setMessage(error.message,true);}
  }
  function update(snapshot=host.getState()){
    if(disposed||!root)return;if(snapshot?.workspace_key!==workspace){detach();return;}
    customerReview.update(snapshot);
    biophysicalEvidence.update(snapshot);
    const signature=canonical(tasks().map(task=>[task.id,task.state]));if(signature!==taskSignature){taskSignature=signature;paintTasks();const origin=workspace,generation=lifecycle;receiveCompleted().catch(error=>{if(activeScope(origin,generation))setMessage(error.message,true);});}
  }
  function detach(){customerReview.detach();biophysicalEvidence.detach();persist();disposed=true;epoch++;lifecycle++;busy=false;events?.abort();events=null;root?.classList.remove('profile-workbench');root=null;}
  return {mount,update,detach,open:openProfile};
}
