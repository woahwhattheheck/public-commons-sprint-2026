/** Guided original-file intake in the maintained scientific operator. */
const clone = value => JSON.parse(JSON.stringify(value));
const esc = value => String(value ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const arr = value => Array.isArray(value) ? value : [];
const keyPattern = /^[0-9a-f]{64}$/;
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const fresh = () => ({schema:'upstate.client-source-draft/v1',title:'',uploads:[],inspection_id:null,
  selections:[],requests:[],selected_task:null,selected_result:null,workspace_key:null,recovery:[]});
const canonical = value => Array.isArray(value) ? '['+value.map(canonical).join(',')+']' :
  value && typeof value==='object' ? '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}' : JSON.stringify(value);
const hash = async raw => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const actionButton = (name,label,extra='') => '<button type="button" data-ci-action="'+name+'" '+extra+'>'+esc(label)+'</button>';
const bytes = value => Number(value).toLocaleString()+' bytes';
const roles = {raster:['CONTEXT','DEM','NLCD','PRECIPITATION','R_FACTOR','K_FACTOR'],
  vector:['CONTEXT','MODEL_DOMAIN','REPORTING_AREA','WATERSHEDS','STATIONS'],
  table:['CONTEXT','BIOPHYSICAL','MEASUREMENTS'],document:['CONTEXT']};
const bioFields = ['lucode','load_n','load_p','load_type_n','load_type_p','eff_n','eff_p','crit_len_n','crit_len_p','proportion_subsurface_n','usle_c','usle_p'];
const bioLabels = {lucode:'Land-cover code',load_n:'Nitrogen load',load_p:'Phosphorus load',
  load_type_n:'Nitrogen loading definition',load_type_p:'Phosphorus loading definition',
  eff_n:'Nitrogen retention efficiency',eff_p:'Phosphorus retention efficiency',
  crit_len_n:'Nitrogen critical retention length',crit_len_p:'Phosphorus critical retention length',
  proportion_subsurface_n:'Subsurface nitrogen fraction',usle_c:'Sediment cover-management factor',
  usle_p:'Sediment support-practice factor'};
const roleLabels = {CONTEXT:'Context / reference',DEM:'Elevation',NLCD:'Land-cover classes',PRECIPITATION:'Precipitation / reviewed runoff proxy',
  R_FACTOR:'Rainfall erosivity',K_FACTOR:'Soil erodibility',MODEL_DOMAIN:'Complete model domain',REPORTING_AREA:'Reporting area',
  WATERSHEDS:'Watershed polygons',STATIONS:'Monitoring locations',BIOPHYSICAL:'Native biophysical parameters',MEASUREMENTS:'Original measurements'};
const WORKING_LIMIT=64*1024*1024;
const object = value => value!==null && typeof value==='object' && !Array.isArray(value);
const need = (value,message) => {if(!value)throw Error(message);};
function encoded(value){
  const raw=JSON.stringify(value,null,2)+'\n';
  need(new TextEncoder().encode(raw).length<=WORKING_LIMIT,'The complete working copy exceeds 64 MiB. The previous complete copy remains available; retain separate source intakes.');
  return raw;
}
function validateDraft(value,expectedWorkspace=null,withRecovery=true){
  need(object(value)&&value.schema==='upstate.client-source-draft/v1','Choose a complete saved intake working copy.');
  need(typeof value.workspace_key==='string'&&value.workspace_key.length>0,'The working copy needs its original Workspace.');
  need(expectedWorkspace===null||value.workspace_key===expectedWorkspace,'Open this working copy in its original Workspace.');
  need(typeof value.title==='string'&&value.title.length<=16000,'The source title is invalid.');
  for(const name of ['uploads','selections','requests'])need(Array.isArray(value[name]),'The complete '+name+' list is missing.');
  for(const name of ['inspection_id','selected_task','selected_result'])need(value[name]===null||keyPattern.test(value[name]),'A retained native identity is invalid.');
  const seen=new Set();
  for(const x of value.uploads){
    need(object(x)&&keyPattern.test(x.id)&&keyPattern.test(x.sha256)&&typeof x.filename==='string'&&x.filename.length>0&&Number.isSafeInteger(x.bytes)&&x.bytes>=0,'A retained original upload identity is invalid.');
    need(!seen.has(x.id),'A retained original upload is repeated.');seen.add(x.id);
    need(object(x.options),'Original file reading choices are missing.');
    need(['utf-8-sig','utf-16','cp1252'].includes(x.options.encoding)&&['',',',';','\t','|',undefined].includes(x.options.delimiter),'Original text reading choices are invalid.');
    need(Number.isInteger(x.options.header_row)&&x.options.header_row>=1&&x.options.header_row<=10000&&['formulas','cached'].includes(x.options.formula_mode),'Original workbook reading choices are invalid.');
  }
  for(const x of value.selections){
    need(object(x)&&Number.isInteger(x.file_index)&&x.file_index>=0&&Number.isInteger(x.part_index)&&x.part_index>=0,'An original source selection is invalid.');
    for(const name of ['title','role','units','uri','vintage','period','timezone','reviewer','reference','notes','identifier_field','label_field','resampling'])
      need(typeof x[name]==='string'&&x[name].length<=16000,'The saved '+name+' field is invalid.');
    need(Object.values(roles).some(list=>list.includes(x.role))&&typeof x.confirmed==='boolean','A saved scientific role or review is invalid.');
    need(object(x.mapping)&&Object.entries(x.mapping).every(([name,column])=>bioFields.includes(name)&&typeof column==='string'),'The complete native column mapping is invalid.');
    need(Array.isArray(x.models)&&x.models.length>0&&new Set(x.models).size===x.models.length&&x.models.every(model=>['ndr','sdr'].includes(model)),'The native model selection is invalid.');
    need(['nearest','bilinear','cubic','average','mode'].includes(x.resampling),'The native resampling choice is invalid.');
    if(x.conversion!==undefined){
      need(object(x.conversion)&&['string','number'].includes(typeof x.conversion.factor)&&
        (typeof x.conversion.factor!=='number'||Number.isFinite(x.conversion.factor))&&
        typeof x.conversion.target_units==='string'&&typeof x.conversion.reference==='string','The complete unit conversion fields are invalid.');
    }
  }
  need(!value.selections.length||value.inspection_id!==null,'Source choices require their original inspection.');
  for(const x of value.requests){
    need(object(x)&&/^client-source-[0-9a-f]{64}$/.test(x.id)&&typeof x.key==='string'&&
      ['client-source.inspect','client-source.commit'].includes(x.action)&&object(x.payload),'An original request identity is missing.');
    need(x.key===canonical({workspace:value.workspace_key,action:x.action,payload:x.payload}),'An original request selection differs.');
  }
  if(withRecovery){
    need(Array.isArray(value.recovery),'The retained working-copy history is missing.');
    for(const item of value.recovery){
      need(object(item)&&typeof item.raw==='string'&&typeof item.reason==='string'&&typeof item.saved_at==='string','A retained original working copy is invalid.');
      const old=JSON.parse(item.raw);need(!Object.hasOwn(old,'recovery'),'A retained working copy must not recursively duplicate its history.');
      validateDraft({...old,recovery:[]},expectedWorkspace,false);
    }
  }
  encoded(value);
  return clone(value);
}
function preserveWorking(candidate,previous,reason){
  const history=[...candidate.recovery,...previous.recovery];
  const body=clone(previous);delete body.recovery;
  const raw=JSON.stringify(body,null,2)+'\n';
  if(!history.some(row=>row.raw===raw))history.push({raw,reason,saved_at:new Date().toISOString()});
  const unique=new Map(history.map(row=>[row.raw,row]));
  return validateDraft({...candidate,recovery:[...unique.values()]},previous.workspace_key);
}
export function createClientSourceIntake(host){
  let root=null,workspace=null,state=null,generation=0,busy=false,notice='',problem='',storageProblem='';
  let draft=fresh(),catalog=null,inspection=null,result=null,controller=null,invalidRaw=null,reading=0;
  const detachedUploads=new Map();
  const receiptKey=(key,id)=>localKey(key)+':upload:'+id;
  const localKey = key => 'upstate-client-source-intake-v1:'+key;
  const q = selector => root?.querySelector(selector);
  const current = (key,epoch) => root&&workspace===key&&generation===epoch;
  function retainFor(key,value){
    const raw=encoded(value);
    try{sessionStorage.setItem(localKey(key),raw);if(sessionStorage.getItem(localKey(key))!==raw)throw Error('Saved bytes did not read back.');
      if(key===workspace)storageProblem='';return true;
    }catch(error){if(key===workspace)storageProblem='Browser storage is unavailable. This complete working copy remains in this page; download it before leaving. Original native operations and files stay saved. '+error.message;return false;}
  }
  function retain(){ if(invalidRaw!==null){storageProblem='The previous unreadable browser copy is preserved. Download it and this working copy before leaving.';return false;}return retainFor(workspace,draft); }
  function load(){
    draft={...fresh(),workspace_key:workspace};invalidRaw=null;storageProblem='';
    let raw;
    try{raw=sessionStorage.getItem(localKey(workspace));}
    catch(error){storageProblem='Browser storage is unavailable. You can work here and download the complete working copy. '+error.message;return;}
    if(!raw)return;
    try{draft=validateDraft(JSON.parse(raw),workspace);}
    catch(error){invalidRaw=raw;storageProblem='The previous browser copy could not be read and is unchanged. Download its exact bytes; a separate empty working copy is available here. '+error.message;}
  }
  function bankUpload(key,value){
    const receipt={...value,options:{encoding:'utf-8-sig',header_row:1,formula_mode:'formulas'}};
    validateDraft({...fresh(),workspace_key:key,uploads:[receipt]},key);
    const index=receiptKey(key,receipt.id),raw=JSON.stringify(receipt);
    detachedUploads.set(index,receipt);
    try{sessionStorage.setItem(index,raw);}
    catch(error){if(key===workspace)storageProblem='The original upload is saved by the operator. Its receipt remains in this page; download the complete working copy after selecting it. '+error.message;}
    return receipt;
  }
  function availableUploads(){
    const prefix=localKey(workspace)+':upload:';
    try{
      for(let index=0;index<sessionStorage.length;index++){
        const key=sessionStorage.key(index);if(!key?.startsWith(prefix))continue;
        try{
          const value=JSON.parse(sessionStorage.getItem(key));
          validateDraft({...fresh(),workspace_key:workspace,uploads:[value]},workspace);
          need(key===receiptKey(workspace,value.id),'The original upload receipt key differs.');
          detachedUploads.set(key,value);
        }catch{/* Keep the exact unreadable receipt in browser storage. */}
      }
    }catch{/* Valid in-memory receipts remain available. */}
    return [...detachedUploads].filter(([key,value])=>key.startsWith(prefix)&&!draft.uploads.some(row=>row.id===value.id)).map(([,value])=>value);
  }
  function renderRecovered(){
    const target=q('[data-ci-recovered]');if(!target)return;
    target.innerHTML=availableUploads().map(value=>'<div class="ci-operation"><span>'+esc(value.filename)+' · '+bytes(value.bytes)+'</span>'+
      actionButton('recover-upload','Select retained original','data-ci-id="'+value.id+'" data-ci-mutating')+'</div>').join('');
  }
  function boundInspection(candidate,value){
    need(value?.action==='client-source.inspect'&&value.id===candidate.inspection_id&&value.project_id===catalog?.project_id,
      'The retained inspection does not match this original Workspace.');
    need(value.state==='complete'&&Array.isArray(value.files),'Wait for the complete original inspection.');
    for(const choice of candidate.selections){
      const file=value.files[choice.file_index],part=file?.inspection?.parts?.[choice.part_index];
      need(part&&!file.error&&!part.error&&roles[part.kind]?.includes(choice.role),'A saved choice does not match an inspected original part.');
      const ids=new Set(arr(part.fields).map(field=>field.id));
      need(Object.values(choice.mapping).every(column=>ids.has(column))&&
        ['identifier_field','label_field'].every(name=>choice[name]===''||ids.has(choice[name])),
        'A saved column choice is absent from its original source.');
    }
    return value;
  }
  function messages(){
    if(!root)return;
    q('[data-ci-notice]').textContent=notice;
    q('[data-ci-error]').textContent=problem;
    q('[data-ci-storage]').textContent=storageProblem;
    q('[data-ci-invalid]').hidden=invalidRaw===null;
    q('[data-ci-recovery-count]').textContent=draft.recovery.length+' previous working selections retained in the complete download.';
    root.querySelectorAll('[data-ci-mutating]').forEach(el=>el.disabled=busy);
  }
  function download(raw,name,type='application/json'){
    const url=URL.createObjectURL(new Blob([raw],{type})),a=document.createElement('a');
    a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  function documentCopy(){return encoded(draft);}
  function saveChange(change){
    if(busy)throw Error('Wait for this original intake operation to return.');
    const candidate=clone(draft);change(candidate);validateDraft(candidate,workspace);
    draft=candidate;retain();problem='';messages();
  }
  function option(value,label,selected){return '<option value="'+esc(value)+'"'+(value===selected?' selected':'')+'>'+esc(label)+'</option>';}
  function inputField(label,field,value,type='text',extra=''){
    return '<label><span>'+esc(label)+'</span><input type="'+type+'" data-ci-field="'+field+'" value="'+esc(value)+'" data-ci-mutating '+extra+'></label>';
  }
  function selectField(label,field,values,selected){
    return '<label><span>'+esc(label)+'</span><select data-ci-field="'+field+'" data-ci-mutating>'+(!values.some(([v])=>v===selected)?'<option selected disabled value="'+esc(selected)+'">'+esc('Saved choice: '+selected+' — choose a supported option')+'</option>':'')+values.map(([v,l])=>option(v,l,selected)).join('')+'</select></label>';
  }
  function fileRows(){
    return draft.uploads.length?'<table><thead><tr><th scope="col">Original file</th><th scope="col">Size</th><th scope="col">Reading choices</th><th scope="col">Selection</th></tr></thead><tbody>'+draft.uploads.map((f,i)=>'<tr data-ci-upload="'+i+'"><td>'+esc(f.filename)+'<details><summary>Original identity</summary><code>'+esc(f.sha256)+'</code></details></td><td>'+bytes(f.bytes)+'</td><td><div class="ci-reading">'+
      selectField('Text encoding','encoding',[['utf-8-sig','UTF-8'],['utf-16','UTF-16'],['cp1252','Windows-1252']],f.options.encoding)+
      selectField('CSV separator','delimiter',[['','Detect for review'],[',','Comma'],[';','Semicolon'],['\t','Tab'],['|','Pipe']],f.options.delimiter||'')+
      inputField('Header row','header_row',f.options.header_row,'number','min="1" max="10000"')+
      selectField('Workbook formulas','formula_mode',[['formulas','Show original formulas'],['cached','Use original cached values']],f.options.formula_mode)+'</div></td><td>'+actionButton('remove-upload','Remove selection','data-ci-index="'+i+'" data-ci-mutating')+'</td></tr>').join('')+'</tbody></table>':'<p>No files selected. Choose the actual originals, including shapefile sidecars.</p>';
  }
  function table(part){
    if(!part.fields?.length)return '';
    return '<div class="ci-scroll" role="region" tabindex="0" aria-label="'+esc(part.name+' original preview')+'"><table><caption>Original sample'+(part.more_rows?' — additional records remain in the retained file':'')+'</caption><thead><tr><th scope="col">Source row</th>'+part.fields.map(x=>'<th scope="col">'+esc(x.display||x.label)+'</th>').join('')+'</tr></thead><tbody>'+arr(part.rows).map(row=>'<tr><th scope="row">'+esc(row.feature_id??row.row)+'</th>'+part.fields.map((x,i)=>'<td>'+esc(row.cells[i]??'')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  }
  function requiredFields(choice){
    const definitions=catalog?.required_table_fields;
    if(!definitions||!choice.models.every(model=>Array.isArray(definitions[model])))return null;
    const wanted=new Set(choice.models.flatMap(model=>definitions[model]));
    return bioFields.filter(name=>wanted.has(name));
  }
  function mappingStatus(choice){
    const required=requiredFields(choice);
    if(!required)return 'Review each original column against the selected native model requirements.';
    const missing=required.filter(name=>!choice.mapping[name]);
    return (required.length-missing.length)+' of '+required.length+' required fields mapped for '+choice.models.map(x=>x.toUpperCase()).join(' and ')+'. '+
      (missing.length?'Choose original columns for: '+missing.map(name=>bioLabels[name]+' ('+name+')').join(', ')+'.':'Review their meanings and units before confirming.');
  }
  function mappingControls(choice,fieldValues){
    const required=requiredFields(choice),primary=required||bioFields;
    const additional=required?bioFields.filter(name=>!required.includes(name)):[];
    const fields=names=>'<div class="ci-fields">'+names.map(name=>selectField(bioLabels[name]+' ('+name+')','mapping.'+name,fieldValues,choice.mapping[name]||'')).join('')+'</div>';
    return '<p data-ci-mapping-status role="status" aria-live="polite">'+esc(mappingStatus(choice))+'</p>'+fields(primary)+
      (additional.length?'<details><summary data-ci-additional-summary>Additional native columns · '+additional.filter(name=>choice.mapping[name]).length+' selected</summary><p>These optional selections remain saved and included in the projected table. They are not required by the chosen model.</p>'+fields(additional)+'</details>':'');
  }
  function interpretation(choice,index){
    const file=inspection.files[choice.file_index],part=file.inspection.parts[choice.part_index];
    const fieldValues=[['','Not selected'],...arr(part.fields).map(x=>[x.id,x.display||x.label])];
    return '<article class="ci-choice" data-ci-choice="'+index+'"><h3>'+esc(file.filename)+' · '+esc(part.name)+'</h3>'+(choice.role==='CONTEXT'?'<p>Retained context: not selected for scientific calculation. Choose and review a scientific role before preparing this source.</p>':'')+'<div class="ci-fields">'+
      inputField('Source title','title',choice.title)+selectField('Scientific role','role',roles[part.kind].map(x=>[x,roleLabels[x]]),choice.role)+
      inputField('Publisher / original reference URL or citation','uri',choice.uri)+inputField('Source edition / vintage','vintage',choice.vintage)+
      inputField('Original physical units','units',choice.units)+inputField('Period represented','period',choice.period)+
      inputField('Time zone, where relevant','timezone',choice.timezone)+inputField('Reviewing scientist','reviewer',choice.reviewer)+
      selectField('Original identifier column','identifier_field',fieldValues,choice.identifier_field)+
      selectField('Original label column','label_field',fieldValues,choice.label_field)+
      inputField('Methods / unit interpretation reference','reference',choice.reference)+
      '<label class="ci-wide"><span>Interpretation and limitations</span><textarea data-ci-field="notes" data-ci-mutating>'+esc(choice.notes)+'</textarea></label></div>'+
      (part.kind==='raster'?'<fieldset><legend>Native grid preparation</legend><p>Pixels are retained unchanged. An explicit scale is applied later by the existing grid engine, once.</p><div class="ci-fields">'+
        selectField('Resampling on the chosen model grid','resampling',[['nearest','Nearest'],['bilinear','Bilinear'],['average','Average'],['mode','Mode']],choice.resampling)+
        inputField('Conversion factor (blank means none)','conversion.factor',choice.conversion?.factor??'','number','step="any" min="0"')+
        inputField('Converted target units','conversion.target_units',choice.conversion?.target_units??'')+
        inputField('Conversion source / reference','conversion.reference',choice.conversion?.reference??'')+'</div></fieldset>':'')+
      (part.kind==='table'&&choice.role==='BIOPHYSICAL'?'<fieldset><legend>Map original columns to native parameters</legend><p>Only reviewed column selections produce the native CSV. The complete original workbook, all sheets, formulas and extra columns remain retained. Values are validated by the existing NDR/SDR table reader.</p>'+
        selectField('Native model validation','models',[['ndr,sdr','NDR and SDR'],['ndr','NDR'],['sdr','SDR']],choice.models.join(','))+
        mappingControls(choice,fieldValues)+'</fieldset>':'')+
      '<label class="ci-confirm"><input type="checkbox" data-ci-field="confirmed" '+(choice.confirmed?'checked':'')+' data-ci-mutating> I reviewed this original source, its scientific meaning, units and selected transformations.</label>'+
      actionButton('remove-choice','Remove this source selection','data-ci-index="'+index+'" data-ci-mutating')+'</article>';
  }
  function renderInspection(){
    const area=q('[data-ci-inspection]');if(!area)return;
    if(!inspection){area.innerHTML='<p>A retained inspection will show the actual original sheets, layers, fields and raster metadata here.</p>';return;}
    area.innerHTML='<h2>Review original files</h2><p>'+esc(inspection.title)+' · '+esc(inspection.created_at)+'</p>'+inspection.files.map((f,fi)=>{
      if(f.error)return '<article class="ci-file"><h3>'+esc(f.filename)+'</h3><p role="alert">'+esc(f.error.message)+'</p><p>The exact original is retained. Correct the reading choices or supply the missing native reader, then inspect again.</p></article>';
      return '<article class="ci-file"><h3>'+esc(f.filename)+'</h3>'+arr(f.inspection.questions).map(x=>'<p>'+esc(x)+'</p>').join('')+
        f.inspection.parts.map((part,pi)=>'<details class="ci-part" open><summary>'+esc(part.name)+' · '+esc(part.kind)+'</summary>'+
          '<dl>'+Object.entries(part).filter(([k])=>['crs','bounds','geometry','feature_count','width','height','dtype','nodata','band','declared_unit','scale','offset','header_row','formula_mode'].includes(k)).map(([k,v])=>'<div><dt>'+esc(k.replaceAll('_',' '))+'</dt><dd>'+esc(Array.isArray(v)?v.join(', '):v??'Not supplied')+'</dd></div>').join('')+'</dl>'+
          (part.error?'<p role="alert">'+esc(part.error.message)+'</p><p>This worksheet remains in the original workbook. Other readable worksheets remain available. Choose a different header row and inspect again to review this sheet.</p>':
            arr(part.questions).map(x=>'<p>'+esc(x)+'</p>').join('')+table(part)+
            actionButton('add-choice','Review this source','data-ci-file="'+fi+'" data-ci-part="'+pi+'" data-ci-mutating'))+'</details>').join('')+'</article>';
    }).join('')+'<div class="ci-downloads">'+arr(inspection._downloads).map(x=>'<a href="'+esc(x.url)+'?download=1" download>'+esc(x.label||x.filename)+'</a>').join('')+'</div>';
  }
  function renderChoices(){
    const area=q('[data-ci-choices]');if(!area)return;
    area.innerHTML=inspection&&draft.inspection_id===inspection.id ? draft.selections.map(interpretation).join('') : '<p>Open the original inspection before editing its retained choices.</p>';
    messages();
  }
  function renderFiles(){if(q('[data-ci-files]'))q('[data-ci-files]').innerHTML='<div class="ci-scroll" role="region" tabindex="0" aria-label="Selected original files">'+fileRows()+'</div>';renderRecovered();messages();}
  function renderHistory(){
    if(!root)return;
    const tasks=arr(state?.tasks).filter(t=>['client-source.inspect','client-source.commit'].includes(t.action));
    const records=arr(catalog?.operations);
    q('[data-ci-history]').innerHTML=records.length?records.map(r=>'<div class="ci-operation"><strong>'+esc(r.title)+'</strong><span>'+esc(r.action==='client-source.inspect'?'Original inspection':'Reviewed edition')+' · '+esc(r.state)+'</span>'+
      actionButton('open-result','Open retained result','data-ci-id="'+r.id+'" data-ci-mutating')+
      actionButton('task','Progress / original request','data-ci-id="'+r.id+'"')+
      (r.source_collection_id?actionButton('source','Open source edition','data-ci-id="'+r.source_collection_id+'"'):'')+'</div>').join(''):'<p>No saved source intake in this Workspace yet.</p>';
    q('[data-ci-tasks]').innerHTML=tasks.map(t=>'<div class="ci-operation"><span>'+esc(t.payload?.title||t.id)+' · '+esc(t.state)+'</span>'+
      actionButton('task','Open operation','data-ci-id="'+t.id+'"')+(t.state==='complete'?actionButton('open-result','Open result','data-ci-id="'+t.id+'" data-ci-mutating'):'')+
      (['failed','interrupted','cancelled'].includes(t.state)?actionButton('resume','Resume original operation','data-ci-id="'+t.id+'" data-ci-mutating'):'')+'</div>').join('');
    messages();
  }
  function renderResult(){
    const area=q('[data-ci-result]');if(!area)return;
    if(!result||result.action!=='client-source.commit'){area.innerHTML='';return;}
    area.innerHTML='<h2>Saved scientific source edition</h2><p>'+esc(result.title)+' · '+esc(result.state)+'</p>'+
      (result.source_collection_id?'<p>These originals and reviewed interpretations are available in the existing source, grid, profile and run controls.</p>'+actionButton('source','Open exact saved source edition','data-ci-id="'+result.source_collection_id+'"'):'')+
      '<ol>'+arr(result.next_steps).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ol><div class="ci-actions">'+
      actionButton('navigate','Prepare study inputs','data-ci-view="source-preparation"')+
      actionButton('navigate','Choose native model grid','data-ci-view="grids"')+
      actionButton('navigate','Profiles and scientific settings','data-ci-view="profiles"')+
      actionButton('navigate','Runs and results','data-ci-view="runs"')+'</div><div class="ci-downloads">'+
      arr(result._downloads).map(x=>'<a href="'+esc(x.url)+'?download=1" download>'+esc(x.label||x.filename)+'</a>').join('')+'</div>';
  }
  async function refreshCatalog(){
    const expected=workspace,epoch=generation;
    const value=await host.api('/api/client-source/catalog',{method:'POST',body:{workspace:expected}});
    if(!current(expected,epoch))return;
    catalog=value;renderHistory();
  }
  async function openResult(id,adopt=true){
    const expected=workspace,epoch=generation,version=++reading;
    const value=await host.api('/api/client-source/result',{method:'POST',body:{workspace:expected,id}});
    if(!current(expected,epoch)||version!==reading)return;
    need(value.id===id&&value.project_id===catalog?.project_id,'The retained result belongs to another original project.');
    if(value.action==='client-source.inspect'){
      let candidate=clone(draft);
      if(adopt&&draft.inspection_id!==id){
        if(draft.selections.length&&!confirm('Open this original inspection? Your complete previous source choices remain in the working-copy history.'))return;
        candidate.inspection_id=id;candidate.selections=[];
        candidate=preserveWorking(candidate,draft,'Opened another original inspection');
      }
      need(candidate.inspection_id===id,'The selected inspection differs from this working copy.');
      boundInspection(candidate,value);
      candidate.selected_result=id;validateDraft(candidate,workspace);
      draft=candidate;inspection=value;retain();renderInspection();renderChoices();
    }else{
      need(value.action==='client-source.commit','This is not a client-source result.');
      const candidate=clone(draft);candidate.selected_result=id;validateDraft(candidate,workspace);
      draft=candidate;result=value;retain();renderResult();
    }
  }
  async function request(action,payload){
    const expected=workspace,epoch=generation;
    const exact=clone(payload),key=canonical({workspace:expected,action,payload:exact});
    need(new TextEncoder().encode(JSON.stringify({workspace:expected,action,payload:exact,operation_id:'client-source-'+'0'.repeat(64)})).length<=4*1024*1024,
      'These selected source choices exceed the original operator’s 4 MiB request capacity. Keep the complete working copy and save smaller source intakes.');
    const id='client-source-'+await hash(key);
    if(!current(expected,epoch))return;
    if(!draft.requests.some(x=>x.id===id)){
      const candidate=clone(draft);candidate.requests.push({id,key,action,payload:exact});
      draft=validateDraft(candidate,workspace);
    }
    retain();
    notice='Submitting the retained original source operation…';messages();
    const task=await host.api('/api/actions',{method:'POST',body:{workspace:expected,action,payload:exact,operation_id:id}});
    if(!current(expected,epoch))return;
    draft.selected_task=task.id;retain();
    notice='Original operation '+task.state+'. Repeating these exact choices reopens the same request.';
    await host.refresh({force:true});if(!current(expected,epoch))return;
    state=host.getState();await refreshCatalog();renderHistory();messages();
  }
  async function run(work){
    if(busy)throw Error('Wait for the selected original operation.');
    const expected=workspace,epoch=generation;
    busy=true;problem='';messages();
    try{await work();return true;}
    catch(error){if(current(expected,epoch)){problem=error.message||String(error);messages();}return false;}
    finally{if(current(expected,epoch)){busy=false;messages();}}
  }
  async function uploadFiles(files){
    const expected=workspace,epoch=generation;
    for(const file of files){
      const maximum=state?.limits?.upload_bytes;
      if(maximum&&file.size>maximum)throw Error(file.name+' exceeds the operator upload capacity. Use the existing registered source-file route.');
      notice='Retaining '+file.name+'…';messages();
      const value=await host.api('/api/upload',{method:'POST',raw:file,filename:file.name});
      const receipt=bankUpload(expected,value);
      // A completed request from a detached view never overwrites later working choices.
      if(!current(expected,epoch))return;
      const candidate=clone(draft);
      if(!candidate.uploads.some(x=>x.id===receipt.id))candidate.uploads.push(receipt);
      draft=validateDraft(candidate,workspace);retain();renderFiles();
    }
    notice='Original files retained. Review reading choices, then inspect their actual contents.';messages();
  }
  function addChoice(fi,pi){
    const file=inspection.files[fi],part=file.inspection.parts[pi];
    need(!file.error&&!part.error,'Correct this worksheet’s reading choices and inspect again before selecting it.');
    if(draft.selections.some(x=>x.file_index===fi&&x.part_index===pi))throw Error('This source is already in your reviewed choices.');
    saveChange(v=>{
      v.inspection_id=inspection.id;
      v.selections.push({file_index:fi,part_index:pi,title:file.filename+' — '+part.name,
        role:'CONTEXT',units:part.declared_unit||'',uri:'urn:sha256:'+file.original.sha256,vintage:'',
        period:'',timezone:'',reviewer:'',reference:'',notes:'',identifier_field:'',label_field:'',
        mapping:{},models:['ndr','sdr'],resampling:'bilinear',confirmed:false});
    });renderChoices();
  }
  function change(event){
    const target=event.target,field=target.dataset.ciField;
    if(!field)return;
    try{
      const choice=target.closest('[data-ci-choice]'),upload=target.closest('[data-ci-upload]');
      if(choice){
        const index=Number(choice.dataset.ciChoice);
        saveChange(v=>{
          const item=v.selections[index],value=target.type==='checkbox'?target.checked:target.value;
          if(field.startsWith('mapping.')){
            const name=field.slice(8);if(value)item.mapping[name]=value;else delete item.mapping[name];
          }else if(field.startsWith('conversion.')){
            const name=field.slice(11);item.conversion??={factor:'',target_units:'',reference:''};
            item.conversion[name]=value;
            if(Object.values(item.conversion).every(x=>x===''))delete item.conversion;
          }else if(field==='models')item.models=value.split(',');
          else item[field]=value;
          if(field!=='confirmed')item.confirmed=false;
          if(field==='role'&&value==='NLCD')item.resampling='nearest';
          if(field==='role'&&value!=='BIOPHYSICAL')item.mapping={};
          if(field==='role'&&value==='BIOPHYSICAL'&&!Object.keys(item.mapping).length){
            const part=inspection.files[item.file_index].inspection.parts[item.part_index];
            item.mapping=clone(part.suggested_mapping||{});
            notice='Exact native heading matches were suggested. Review every original column and confirm this interpretation.';
          }
        });
        if(['role','models'].includes(field))renderChoices();
        else{const checked=choice.querySelector('[data-ci-field="confirmed"]');if(checked)checked.checked=draft.selections[index].confirmed;
          const status=choice.querySelector('[data-ci-mapping-status]');if(status)status.textContent=mappingStatus(draft.selections[index]);
          const extra=choice.querySelector('[data-ci-additional-summary]'),required=requiredFields(draft.selections[index]);
          if(extra&&required)extra.textContent='Additional native columns · '+bioFields.filter(name=>!required.includes(name)&&draft.selections[index].mapping[name]).length+' selected';}
      }else if(upload){
        const index=Number(upload.dataset.ciUpload);
        saveChange(v=>{v.uploads[index].options[field]=field==='header_row'?Number(target.value):target.value;});
      }else if(field==='title')saveChange(v=>{v.title=target.value;});
    }catch(error){problem=error.message;messages();}
  }
  async function click(event){
    const button=event.target.closest('[data-ci-action]');if(!button)return;
    const action=button.dataset.ciAction;
    if(action==='download'){download(documentCopy(),'Scientific_Source_Intake_Working.json');return;}
    if(action==='invalid'){download(invalidRaw,'Original_Unreadable_Intake_Browser.json');return;}
    if(action==='task'){await host.showTask(button.dataset.ciId);return;}
    if(action==='source'){await host.openItem('sources',button.dataset.ciId);return;}
    if(action==='navigate'){host.navigate(button.dataset.ciView);return;}
    await run(async()=>{
      if(action==='refresh'){await refreshCatalog();return;}
      if(action==='open-result'){await openResult(button.dataset.ciId);return;}
      if(action==='resume'){await host.api('/api/task/resume',{method:'POST',body:{id:button.dataset.ciId}});await host.refresh({force:true});return;}
      if(action==='inspect'){
        if(!draft.title.trim())throw Error('Name this source intake.');
        if(!draft.uploads.length)throw Error('Choose original files first.');
        await request('client-source.inspect',{title:draft.title,uploads:draft.uploads.map(x=>({upload_id:x.id,options:clone(x.options)}))});return;
      }
      if(action==='commit'){
        if(!inspection||draft.inspection_id!==inspection.id)throw Error('Open the complete original inspection first.');
        if(!draft.selections.length||draft.selections.some(x=>!x.confirmed))throw Error('Review and confirm every selected source.');
        await request('client-source.commit',{title:draft.title,inspection_id:draft.inspection_id,selections:draft.selections.map(value=>{
          const selected=clone(value);
          if(selected.conversion){const factor=Number(selected.conversion.factor);need(String(selected.conversion.factor).trim()!==''&&Number.isFinite(factor)&&factor>0,'Enter a positive conversion factor or remove all conversion fields.');selected.conversion.factor=factor;}
          return selected;
        })});return;
      }
      // Synchronous edits are performed outside the operation's busy guard.
      if(action==='add-choice'||action==='remove-choice'||action==='remove-upload'||action==='recover-upload'){
        busy=false;
        if(action==='recover-upload'){
          const receipt=availableUploads().find(row=>row.id===button.dataset.ciId);need(receipt,'The original upload receipt is no longer selected.');
          saveChange(value=>value.uploads.push(clone(receipt)));renderFiles();
        }else if(action==='add-choice')addChoice(Number(button.dataset.ciFile),Number(button.dataset.ciPart));
        else if(action==='remove-choice'){saveChange(v=>{v.selections.splice(Number(button.dataset.ciIndex),1);});renderChoices();}
        else{saveChange(v=>{v.uploads.splice(Number(button.dataset.ciIndex),1);});renderFiles();}
      }
    });
  }
  async function fileChange(event){
    if(event.target.matches('[data-ci-upload-files]')){
      const files=Array.from(event.target.files||[]);event.target.value='';
      await run(()=>uploadFiles(files));
    }else if(event.target.matches('[data-ci-open-working]')){
      const file=event.target.files?.[0];event.target.value='';if(!file)return;
      await run(async()=>{
        if(file.size>64*1024*1024)throw Error('This working copy exceeds 64 MiB. Keep the original and open it with its producing application.');
        const expected=workspace,epoch=generation;
        let candidate=validateDraft(JSON.parse(await file.text()),expected),opened=null;
        if(!current(expected,epoch))return;
        if(candidate.inspection_id){
          if(!catalog)await refreshCatalog();
          if(!current(expected,epoch))return;
          opened=await host.api('/api/client-source/result',{method:'POST',body:{workspace:expected,id:candidate.inspection_id}});
          if(!current(expected,epoch))return;
          boundInspection(candidate,opened);
        }
        if(!confirm('Open this complete working copy? The current unfinished choices will remain in its retained history. Original native sources and operations stay saved.'))return;
        candidate=preserveWorking(candidate,draft,'Opened '+file.name);
        draft=candidate;inspection=opened;result=null;retain();q('[data-ci-field="title"]').value=draft.title;
        renderFiles();renderChoices();renderInspection();renderResult();
        notice='Complete working copy opened against this original Workspace. Original request identities are retained.';messages();
      });
    }
  }
  function mount(target,currentState=host.getState()){
    const key=host.getWorkspace();if(root===target&&workspace===key){update(currentState);return;}
    suspend();root=target;workspace=key;state=currentState;generation++;load();
    catalog=null;inspection=null;result=null;busy=false;notice='';problem='';
    root.innerHTML='<main class="ci-desk"><header><p class="eyebrow">SCIENTIFIC WORKBENCH</p><h1>Open my data</h1><p>Keep your original files and labels. Review their meaning here, then use the existing scientific preparation and run controls.</p></header>'+
      '<p data-ci-error role="alert" class="ci-error"></p><p data-ci-notice role="status" aria-live="polite"></p><p data-ci-storage role="status" class="ci-warning"></p>'+
      '<section><h2>1. Choose original files</h2>'+inputField('Name this source intake','title',draft.title)+
      '<label class="ci-file-picker"><span>CSV, TSV, Excel, GeoTIFF, GeoPackage, GeoJSON or shapefile and its sidecars</span><input type="file" multiple data-ci-upload-files data-ci-mutating></label><div data-ci-files></div><div data-ci-recovered></div>'+
      '<div class="ci-actions">'+actionButton('inspect','Inspect original files','data-ci-mutating')+actionButton('download','Download complete working copy')+
      '<label>Open working copy<input type="file" accept=".json,application/json" data-ci-open-working data-ci-mutating></label>'+
      '<p data-ci-recovery-count></p><span data-ci-invalid hidden>'+actionButton('invalid','Download exact previous browser copy')+'</span></div></section>'+
      '<section data-ci-inspection></section><section><h2>2. Review source meaning</h2><p>Use the source’s actual units and metadata. Nothing here invents measurements, chooses a scientific conclusion or runs a model automatically.</p><div data-ci-choices></div>'+
      '<div class="ci-actions">'+actionButton('commit','Save reviewed scientific source edition','data-ci-mutating')+'</div></section>'+
      '<section data-ci-result></section><section><h2>3. Original operations and saved editions</h2>'+actionButton('refresh','Refresh saved results','data-ci-mutating')+
      '<div data-ci-tasks></div><div data-ci-history></div></section></main>';
    controller=new AbortController();
    root.addEventListener('click',event=>{void click(event).catch(error=>{problem=error.message;messages();});},{signal:controller.signal});
    root.addEventListener('input',change,{signal:controller.signal});
    root.addEventListener('change',event=>{if(event.target.type==='file')void fileChange(event);},{signal:controller.signal});
    renderFiles();renderChoices();renderInspection();renderResult();messages();
    void run(async()=>{await refreshCatalog();if(draft.inspection_id)await openResult(draft.inspection_id,false);});
  }
  function update(currentState=host.getState()){
    if(!root||workspace!==host.getWorkspace())return;
    state=currentState;renderHistory();
  }
  function suspend(){
    controller?.abort();controller=null;root=null;generation++;reading++;busy=false;
  }
  return {mount,update,suspend};
}
