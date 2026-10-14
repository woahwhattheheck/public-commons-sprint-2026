/** Guided original-file intake in the maintained scientific operator. */
import {validateMappingLibrary, createMappingTemplate, verifyMappingTemplate,
  previewMappingTemplate, applyMappingTemplate} from './client_source_mapping.mjs';
const clone = value => JSON.parse(JSON.stringify(value));
const esc = value => String(value ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const arr = value => Array.isArray(value) ? value : [];
const keyPattern = /^[0-9a-f]{64}$/;
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const fresh = () => ({schema:'upstate.client-source-draft/v1',title:'',uploads:[],inspection_id:null,
  selections:[],requests:[],selected_task:null,selected_result:null,workspace_key:null,recovery:[],mapping_templates:[],mapping_reuse:{}});
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
  validateMappingLibrary(value.mapping_templates??[]);
  need(object(value.mapping_reuse??{}),'The saved mapping choices are invalid.');
  for(const [identity,form] of Object.entries(value.mapping_reuse??{})){
    need(/^[0-9a-f]{64}:\d+:\d+$/.test(identity)&&object(form)&&typeof form.name==='string'&&form.name.length<=160&&
      (form.selected_id===''||keyPattern.test(form.selected_id)),'A saved mapping form is invalid.');
    need(!form.selected_id||(value.mapping_templates??[]).some(item=>item.id===form.selected_id),'A selected saved mapping is missing from the complete working copy.');
  }
  for(const x of value.requests){
    need(object(x)&&/^client-source-[0-9a-f]{64}$/.test(x.id)&&typeof x.key==='string'&&
      ['client-source.inspect','client-source.commit'].includes(x.action)&&object(x.payload),'An original request identity is missing.');
    const requestWorkspace=x.workspace_key??value.workspace_key;
    need(typeof requestWorkspace==='string'&&requestWorkspace.length>0,'An original request Workspace is missing.');
    need(x.key===canonical({workspace:requestWorkspace,action:x.action,payload:x.payload}),'An original request selection differs.');
  }
  if(withRecovery){
    need(Array.isArray(value.recovery),'The retained working-copy history is missing.');
    for(const item of value.recovery){
      need(object(item)&&typeof item.raw==='string'&&typeof item.reason==='string'&&typeof item.saved_at==='string','A retained original working copy is invalid.');
      const old=JSON.parse(item.raw);need(!Object.hasOwn(old,'recovery'),'A retained working copy must not recursively duplicate its history.');
      validateDraft({...old,recovery:[]},old.workspace_key,false);
    }
  }
  encoded(value);
  return clone({...value,mapping_templates:value.mapping_templates??[],mapping_reuse:value.mapping_reuse??{}});
}
function preserveWorking(candidate,previous,reason){
  const history=[...candidate.recovery,...previous.recovery];
  const body=clone(previous);delete body.recovery;
  const raw=JSON.stringify(body,null,2)+'\n';
  if(!history.some(row=>row.raw===raw))history.push({raw,reason,saved_at:new Date().toISOString()});
  const unique=new Map(history.map(row=>[row.raw,row]));
  return validateDraft({...candidate,recovery:[...unique.values()]},candidate.workspace_key);
}
function readingRecipe(uploads){
  return canonical(uploads.map(file=>({id:file.id,filename:file.filename,sha256:file.sha256,bytes:file.bytes,
    options:{encoding:file.options.encoding,header_row:file.options.header_row,
      formula_mode:file.options.formula_mode,...(file.options.delimiter?{delimiter:file.options.delimiter}:{})}})));
}
function inspectedUploads(value){
  return value.files.map(file=>({id:file.upload_id,filename:file.filename,
    sha256:file.original.sha256,bytes:file.original.bytes,options:clone(file.options)}));
}
export function createClientSourceIntake(host){
  let root=null,workspace=null,state=null,generation=0,busy=false,notice='',problem='',storageProblem='';
  let draft=fresh(),catalog=null,inspection=null,result=null,controller=null,invalidRaw=null,reading=0,acceptedTask=null;
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
    need(!candidate.uploads.length||readingRecipe(candidate.uploads)===readingRecipe(inspectedUploads(value)),
      'The selected files or reading choices differ from this inspection. Inspect the current files, or deliberately reopen the retained original result.');
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
    renderOperationStatus();
    q('[data-ci-error]').textContent=problem;
    q('[data-ci-storage]').textContent=storageProblem;
    q('[data-ci-invalid]').hidden=invalidRaw===null;
    q('[data-ci-recovery-count]').textContent=draft.recovery.length+' previous working selections retained in the complete download.';
    root.querySelectorAll('[data-ci-mutating]').forEach(el=>el.disabled=busy||el.hasAttribute('data-ci-unavailable'));
  }
  function download(raw,name,type='application/json'){
    const url=URL.createObjectURL(new Blob([raw],{type})),a=document.createElement('a');
    a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  function documentCopy(){return encoded(draft);}
  function applyChoices(candidate){
    validateDraft(candidate,workspace);
    const changed=readingRecipe(candidate.uploads)!==readingRecipe(draft.uploads);
    if(changed){
      if(draft.inspection_id||draft.selections.length)
        candidate=preserveWorking(candidate,draft,'Changed original files or reading choices');
      candidate.inspection_id=null;candidate.selections=[];
      if(candidate.selected_result===inspection?.id||candidate.selected_result===draft.inspection_id)
        candidate.selected_result=null;
      if(candidate.selected_task===draft.inspection_id)candidate.selected_task=null;
      inspection=null;reading++;
      notice='Files or reading choices changed. Inspect the current selection and review its source meaning before saving. Previous choices remain in the complete working copy.';
    }
    draft=validateDraft(candidate,workspace);retain();problem='';
    if(changed){renderInspection();renderChoices();}
    messages();
  }
  function saveChange(change){
    if(busy)throw Error('Wait for this original intake operation to return.');
    const candidate=clone(draft);change(candidate);applyChoices(candidate);
  }
  function option(value,label,selected){return '<option value="'+esc(value)+'"'+(value===selected?' selected':'')+'>'+esc(label)+'</option>';}
  function inputField(label,field,value,type='text',extra=''){
    return '<label><span>'+esc(label)+'</span><input type="'+type+'" data-ci-field="'+field+'" value="'+esc(value)+'" data-ci-mutating '+extra+'></label>';
  }
  function selectField(label,field,values,selected){
    return '<label><span>'+esc(label)+'</span><select data-ci-field="'+field+'" data-ci-mutating>'+(!values.some(([v])=>v===selected)?'<option selected disabled value="'+esc(selected)+'">'+esc('Saved choice: '+selected+' — choose a supported option')+'</option>':'')+values.map(([v,l])=>option(v,l,selected)).join('')+'</select></label>';
  }
  function readingChoices(file){
    const suffix=file.filename.toLowerCase().match(/\.[^.]+$/)?.[0]||'';
    const workbook=['.xlsx','.xlsm'].includes(suffix),delimited=['.csv','.tsv','.txt'].includes(suffix);
    if(!workbook&&!delimited)return '<p>Read the original file’s layers, bands or document metadata during inspection.</p>';
    return '<div class="ci-reading">'+(delimited?
      selectField('Text encoding','encoding',[['utf-8-sig','UTF-8'],['utf-16','UTF-16'],['cp1252','Windows-1252']],file.options.encoding)+
      selectField('Column separator','delimiter',[['','Detect for review'],[',','Comma'],[';','Semicolon'],['\t','Tab'],['|','Pipe']],file.options.delimiter||''):'')+
      inputField('Header row','header_row',file.options.header_row,'number','min="1" max="10000"')+
      (workbook?selectField('Workbook formulas','formula_mode',[['formulas','Show original formulas'],['cached','Use original cached values']],file.options.formula_mode):'')+'</div>'+
      (workbook?'<p>Inspect every original worksheet. A sheet with a different header row can be inspected again with its own reading choice.</p>':'');
  }
  function facts(values){
    return '<dl>'+values.map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(value??'Not supplied')+'</dd></div>').join('')+'</dl>';
  }
  function columnLabel(part,id){
    if(!id)return 'Not selected';
    const field=arr(part.fields).find(value=>value.id===id);
    return field?(field.display||field.label||id):'Unavailable in this original source';
  }
  function partFacts(part){
    if(part.error)return facts([['Reading status','Review the reading error below'],['Selected header row',part.header_row]]);
    const fields=arr(part.fields),rows=arr(part.rows),values=[];
    if(part.kind==='table'){
      values.push(['Original columns',fields.length],['Preview rows',rows.length+
        (part.more_rows?' shown; additional rows remain in the original file':' shown')],
        ['Header row',part.header_row]);
      if(part.sheet!==null&&part.sheet!==undefined)values.push(['Formula reading',part.formula_mode==='cached'?'Original cached values':
          part.formula_mode==='formulas'?'Original formulas':'Not supplied']);
    }else if(part.kind==='vector'){
      values.push(['Features in this layer',part.feature_count],['Original fields',fields.length],
        ['Preview features',rows.length+' shown'],['Geometry',part.geometry],['Coordinate reference system',part.crs]);
    }else if(part.kind==='raster'){
      values.push(['Band',part.band],['Dimensions',part.width+' × '+part.height+' pixels'],
        ['Declared units',part.declared_unit||'Not supplied'],['Coordinate reference system',part.crs],
        ['NoData value',part.nodata],['Stored scale',part.scale],['Stored offset',part.offset]);
    }
    return facts(values);
  }
  function reviewSummary(choice,part,saved=false){
    const value=text=>String(text??'').trim()||'Not supplied';
    const values=[['Scientific role',roleLabels[choice.role]||choice.role],
      ['Identifier column',columnLabel(part,choice.identifier_field)],['Label column',columnLabel(part,choice.label_field)],
      ['Physical units',value(choice.units)],['Period represented',value(choice.period)],
      ['Time zone',value(choice.timezone)],['Reviewing scientist',value(choice.reviewer)]];
    if(choice.role==='BIOPHYSICAL')values.push(['Selected models',arr(choice.models).map(x=>x.toUpperCase()).join(' + ')]);
    if(choice.conversion)values.push(['Explicit conversion',value(choice.conversion.factor)+' × original value → '+value(choice.conversion.target_units)]);
    return '<p><strong>'+esc(saved?'Saved source interpretation':choice.confirmed?'Confirmed for the source edition':'Interpretation awaiting confirmation')+'</strong></p>'+facts(values)+
      (choice.reference?'<p><strong>Method reference:</strong> '+esc(choice.reference)+'</p>':'')+
      (choice.notes?'<p><strong>Interpretation:</strong> '+esc(choice.notes)+'</p>':'');
  }
  function downloadsHTML(items){
    return arr(items).map(item=>{
      const label=esc(item.label||item.filename||'Retained file'),url=esc(item.url);
      const readable=item.kind==='html'||/\.html?$/i.test(item.filename||'');
      return readable?'<span><a href="'+url+'" target="_blank" rel="noopener">Read '+label+'</a> · <a href="'+url+'?download=1" download>Download HTML</a></span>':
        '<a href="'+url+'?download=1" download>'+label+'</a>';
    }).join('');
  }
  function renderOperationStatus(){
    const area=q('[data-ci-operation-status]');if(!area)return;
    const id=draft.selected_task;
    if(!id){area.innerHTML='';return;}
    const saved=arr(catalog?.operations).find(item=>item.id===id);
    const running=arr(state?.tasks).find(item=>item.id===id);
    const opened=[inspection,result].find(item=>item?.id===id&&item.state==='complete');
    const operation=opened||(saved?.state==='complete'?saved:null)||running||saved||(acceptedTask?.id===id?acceptedTask:null);
    if(!operation){area.innerHTML='<p>Refresh saved results to read the selected operation’s current progress.</p>';return;}
    const inspectionOperation=operation.action==='client-source.inspect';
    const title=inspectionOperation?'File inspection':'Reviewed source edition';
    const wording={queued:'Waiting in the existing work queue.',pending:'Waiting in the existing work queue.',
      running:inspectionOperation?'Reading the original files.':'Saving the reviewed source choices.',
      working:inspectionOperation?'Reading the original files.':'Saving the reviewed source choices.',
      complete:inspectionOperation?'Complete. Review the original worksheets, layers or bands below.':'Saved. Open the source edition and its reviewed meaning.',
      failed:'Stopped with an error. Open the operation to inspect the cause and resume the same request.',
      interrupted:'Interrupted. Open the operation to continue the same saved request.',
      cancelled:'Cancelled. The retained originals and saved choices remain available.'}[operation.state]||'Current state: '+operation.state+'.';
    const error=operation.error?.message||'';
    const html='<p><strong>'+esc(title)+':</strong> '+esc(wording)+(error?' '+esc(error):'')+'</p>'+
      (operation.state==='complete'&&draft.selected_result!==id?actionButton('open-result',inspectionOperation?'Open completed inspection':'Open saved source edition','data-ci-id="'+esc(id)+'" data-ci-mutating'):'')+
      actionButton('task','Operation details','data-ci-id="'+esc(id)+'"');
    if(area.innerHTML!==html)area.innerHTML=html;
  }
  function fileRows(){
    return draft.uploads.length?'<div class="ci-scroll" role="region" tabindex="0" aria-label="Selected original files and reading choices"><table><thead><tr><th scope="col">Original file</th><th scope="col">Size</th><th scope="col">Reading choices</th><th scope="col">Selection</th></tr></thead><tbody>'+draft.uploads.map((f,i)=>'<tr data-ci-upload="'+i+'"><td>'+esc(f.filename)+'<details><summary>Original identity</summary><code>'+esc(f.sha256)+'</code></details></td><td>'+bytes(f.bytes)+'</td><td>'+
      readingChoices(f)+'</td><td>'+actionButton('remove-upload','Remove selection','data-ci-index="'+i+'" data-ci-mutating')+'</td></tr>').join('')+'</tbody></table></div>':'<p>No files selected. Choose the actual originals, including shapefile sidecars.</p>';
  }
  function table(part){
    const fields=arr(part.fields),rows=arr(part.rows);
    const count=Math.max(fields.length,0,...rows.map(row=>arr(row.cells).length));
    if(!count)return '';
    const columns=Array.from({length:count},(_,index)=>fields[index]||{display:'Unlabeled original column '+(index+1)});
    return '<div class="ci-scroll" role="region" tabindex="0" aria-label="'+esc(part.name+' original preview')+'"><table><caption>Original sample'+(part.more_rows?' — additional records remain in the retained file':'')+'</caption><thead><tr><th scope="col">Source row</th>'+columns.map(field=>'<th scope="col">'+esc(field.display||field.label)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr><th scope="row">'+esc(row.feature_id??row.row)+'</th>'+columns.map((field,index)=>'<td>'+esc(index<arr(row.cells).length?row.cells[index]??'':'No cell in this row')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
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
  function rasterPreparation(choice,index){
    const clear=choice.conversion?actionButton('remove-conversion','Remove incompatible conversion',
      'data-ci-index="'+index+'" data-ci-mutating'):'';
    if(choice.role==='CONTEXT')return '<p>Context retains the original raster for reference. Grid preparation and physical unit conversion are not applied to this role.</p>'+clear;
    const categorical=choice.role==='NLCD';
    const methods=categorical?[['nearest','Nearest'],['mode','Mode']]:
      [['nearest','Nearest'],['bilinear','Bilinear'],['average','Average'],['mode','Mode']];
    return '<fieldset><legend>Native grid preparation</legend><p>Pixels are retained unchanged. Reviewed preparation is applied later by the existing grid engine.</p><div class="ci-fields">'+
      selectField('Resampling on the chosen model grid','resampling',methods,choice.resampling)+
      (categorical?'<p>Land-cover classes keep their original codes. Choose nearest or mode resampling; physical unit conversion does not apply.</p>'+clear:
        inputField('Conversion factor (blank means none)','conversion.factor',choice.conversion?.factor??'','number','step="any" min="0"')+
        inputField('Converted target units','conversion.target_units',choice.conversion?.target_units??'')+
        inputField('Conversion source / reference','conversion.reference',choice.conversion?.reference??''))+'</div></fieldset>';
  }
  const mappingKey = choice => draft.inspection_id+':'+choice.file_index+':'+choice.part_index;
  function mappingForm(choice){return draft.mapping_reuse[mappingKey(choice)]||{name:'',selected_id:''};}
  function savedMappingControls(choice,part){
    const form=mappingForm(choice),template=draft.mapping_templates.find(item=>item.id===form.selected_id);
    const preview=template?previewMappingTemplate(template,part,requiredFields(choice)||[]):null;
    const status={matched:'Matching original header', 'missing-header':'Missing from this file',
      'blank-original-header':'Blank original header — choose manually',
      'ambiguous-original-header':'Repeated original header — choose manually',
      'ambiguous-current-header':'Repeated current header — choose manually'};
    return '<details class="ci-reuse"'+(template?' open':'')+'><summary>Save or reuse column mapping'+
      (draft.mapping_templates.length?' · '+draft.mapping_templates.length+' saved':'')+'</summary>'+
      '<p>Reuse named column choices when another table uses familiar headings. Review the new file’s values, units and scientific meaning before saving its source edition.</p>'+
      '<div class="ci-fields"><label><span>Name for these column choices</span><input type="text" maxlength="160" data-ci-mapping-name value="'+esc(form.name)+'" data-ci-mutating></label>'+
      '<div class="ci-actions">'+actionButton('mapping-save','Save named mapping','data-ci-mutating')+'</div></div>'+
      (draft.mapping_templates.length?'<label><span>Saved column mapping</span><select data-ci-mapping-selection data-ci-mutating>'+option('','Choose a saved mapping',form.selected_id)+
        draft.mapping_templates.map(item=>option(item.id,item.name+' — '+item.source.filename+' / '+item.source.part_name,form.selected_id)).join('')+'</select></label>':'<p>No named mapping saved yet. Choose the parameter columns below, give the mapping a name and save it here.</p>')+
      (preview?'<p><strong>'+esc(template.name)+'</strong> · '+esc(template.source.filename)+' / '+esc(template.source.part_name)+
        '. '+preview.matched+' of '+preview.rows.length+' saved columns match this file unambiguously.</p>'+
        '<div class="ci-scroll" role="region" tabindex="0" aria-label="Saved column mapping preview"><table><caption>Original headings compared with this table</caption><thead><tr><th scope="col">Parameter</th><th scope="col">Original heading</th><th scope="col">This file</th></tr></thead><tbody>'+
        preview.rows.map(row=>'<tr><th scope="row">'+esc(bioLabels[row.parameter])+'</th><td>'+esc(row.label||'(blank)')+'</td><td>'+esc(status[row.status])+'</td></tr>').join('')+'</tbody></table></div>'+
        (preview.missing_required.length?'<p class="ci-warning">After applying, select original columns for: '+esc(preview.missing_required.map(name=>bioLabels[name]).join(', '))+'.</p>':'')+
        '<p>Apply replaces the current column mapping. It keeps this source’s selected models, units, references and other scientific choices, and clears its confirmation.</p>'+
        actionButton('mapping-apply','Apply matching columns','data-ci-mutating'+(preview.matched?'':' data-ci-unavailable disabled')):'')+'</details>';
  }
  function interpretation(choice,index){
    const file=inspection.files[choice.file_index],part=file.inspection.parts[choice.part_index];
    const fieldValues=[['','Not selected'],...arr(part.fields).map(x=>[x.id,x.display||x.label])];
    return '<article class="ci-choice" data-ci-choice="'+index+'"><h3>'+esc(file.filename)+' · '+esc(part.name)+'</h3><div data-ci-meaning>'+reviewSummary(choice,part)+'</div>'+(choice.role==='CONTEXT'?'<p>Retained context: not selected for scientific calculation. Choose and review a scientific role before preparing this source.</p>':'')+'<div class="ci-fields">'+
      inputField('Source title','title',choice.title)+selectField('Scientific role','role',roles[part.kind].map(x=>[x,roleLabels[x]]),choice.role)+
      inputField('Publisher / original reference URL or citation','uri',choice.uri)+inputField('Source edition / vintage','vintage',choice.vintage)+
      inputField('Original physical units','units',choice.units)+inputField('Period represented','period',choice.period)+
      inputField('Time zone, where relevant','timezone',choice.timezone)+inputField('Reviewing scientist','reviewer',choice.reviewer)+
      selectField('Original identifier column','identifier_field',fieldValues,choice.identifier_field)+
      selectField('Original label column','label_field',fieldValues,choice.label_field)+
      inputField('Methods / unit interpretation reference','reference',choice.reference)+
      '<label class="ci-wide"><span>Interpretation and limitations</span><textarea data-ci-field="notes" data-ci-mutating>'+esc(choice.notes)+'</textarea></label></div>'+
      (part.kind==='raster'?rasterPreparation(choice,index):'')+
      (part.kind==='table'&&choice.role==='BIOPHYSICAL'?'<fieldset><legend>Map original columns to native parameters</legend><p>Only reviewed column selections produce the native CSV. The complete original workbook, all sheets, formulas and extra columns remain retained. Values are validated by the existing NDR/SDR table reader.</p>'+
        selectField('Native model validation','models',[['ndr,sdr','NDR and SDR'],['ndr','NDR'],['sdr','SDR']],choice.models.join(','))+
        savedMappingControls(choice,part)+mappingControls(choice,fieldValues)+'</fieldset>':'')+
      '<label class="ci-confirm"><input type="checkbox" data-ci-field="confirmed" '+(choice.confirmed?'checked':'')+' data-ci-mutating> I reviewed this original source, its scientific meaning, units and selected transformations.</label>'+
      actionButton('remove-choice','Remove this source selection','data-ci-index="'+index+'" data-ci-mutating')+'</article>';
  }
  function renderInspection(){
    const area=q('[data-ci-inspection]');if(!area)return;
    if(!inspection){area.innerHTML='<p>A retained inspection will show the actual original sheets, layers, fields and raster metadata here.</p>';return;}
    area.innerHTML='<h2>Review original files</h2><p>'+esc(inspection.title)+' · '+esc(inspection.created_at)+'</p>'+inspection.files.map((f,fi)=>{
      if(f.error)return '<article class="ci-file"><h3>'+esc(f.filename)+'</h3><p role="alert">'+esc(f.error.message)+'</p><p>The exact original is retained. Correct the reading choices or supply the missing native reader, then inspect again.</p></article>';
      return '<article class="ci-file"><h3>'+esc(f.filename)+'</h3><p>'+esc(f.inspection.format?.toUpperCase()||'Original file')+' · '+f.inspection.parts.length+' original '+(f.inspection.parts.length===1?'part':'parts')+' available for review.</p>'+arr(f.inspection.questions).map(x=>'<p>'+esc(x)+'</p>').join('')+
        f.inspection.parts.map((part,pi)=>'<details class="ci-part" open><summary>'+esc(part.sheet!==undefined&&part.sheet!==null?'Worksheet: '+part.name:part.kind==='vector'?'Layer: '+part.name:part.name)+' · '+esc(part.kind)+'</summary>'+partFacts(part)+
          '<details><summary>Original spatial and reading metadata</summary><dl>'+Object.entries(part).filter(([k])=>['crs','bounds','geometry','feature_count','width','height','dtype','nodata','band','declared_unit','scale','offset','header_row','formula_mode'].includes(k)).map(([k,v])=>'<div><dt>'+esc(k.replaceAll('_',' '))+'</dt><dd>'+esc(Array.isArray(v)?v.join(', '):v??'Not supplied')+'</dd></div>').join('')+'</dl></details>'+
          (part.error?'<p role="alert">'+esc(part.error.message)+'</p><p>This worksheet remains in the original workbook. Other readable worksheets remain available. Choose a different header row and inspect again to review this sheet.</p>':
            arr(part.questions).map(x=>'<p>'+esc(x)+'</p>').join('')+table(part)+
            actionButton('add-choice','Review this source','data-ci-file="'+fi+'" data-ci-part="'+pi+'" data-ci-mutating'))+'</details>').join('')+'</article>';
    }).join('')+'<div class="ci-downloads">'+downloadsHTML(inspection._downloads)+'</div>';
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
  function profileTables(){
    const edition=arr(state?.data?.sources).find(row=>row.id===result?.source_collection_id);
    return arr(edition?.entries).filter(row=>arr(result?.source_ids).includes(row.id)&&
      row.kind==='table'&&row.role==='BIOPHYSICAL'&&row.client_source?.selection?.confirmed===true&&
      arr(row.client_source.selection.models).length>0);
  }
  function profileLinks(){
    const tables=profileTables();if(!tables.length)return '';
    return '<h3>Prepare parameter profiles</h3><p>Continue with each exact reviewed table and its selected native models. Enter the scientific parameters in the Profile workbench.</p>'+tables.map(row=>
      '<div class="ci-operation"><strong>'+esc(row.title)+'</strong><span>'+esc(row.client_source.selection.models.map(name=>name.toUpperCase()).join(' + '))+' coefficient table</span>'+
      actionButton('profile','Prepare parameter profile','data-ci-source="'+esc(row.id)+'" data-ci-mutating')+'</div>').join('');
  }
  function savedSourceMeaning(){
    if(result?.state!=='complete')return '';
    const collection=arr(state?.data?.sources).find(row=>row.id===result.source_collection_id);
    return arr(collection?.entries).filter(row=>arr(result.source_ids).includes(row.id)&&row.client_source?.selection).map(row=>{
      const choice=row.client_source.selection;
      const part=result.files?.[choice.file_index]?.inspection?.parts?.[choice.part_index];
      if(!part)return '';
      return '<details><summary>'+esc(row.title||choice.title)+' · '+esc(roleLabels[choice.role]||choice.role)+'</summary>'+reviewSummary(choice,part,true)+'</details>';
    }).join('');
  }
  function renderResult(){
    const area=q('[data-ci-result]');if(!area)return;
    if(!result||result.action!=='client-source.commit'){area.innerHTML='';return;}
    area.innerHTML='<h2>Saved scientific source edition</h2><p>'+esc(result.title)+' · '+esc(result.state)+'</p>'+
      (result.source_collection_id?'<p>These originals and reviewed interpretations are available in the existing source, grid, profile and run controls.</p>'+actionButton('source','Open exact saved source edition','data-ci-id="'+result.source_collection_id+'"'):'')+
      savedSourceMeaning()+profileLinks()+'<ol>'+arr(result.next_steps).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ol><div class="ci-actions">'+
      actionButton('navigate','Prepare workbook measurements','data-ci-view="client-measurement-sources"')+
      actionButton('navigate','Prepare study inputs','data-ci-view="source-preparation"')+
      actionButton('navigate','Choose native model grid','data-ci-view="grids"')+
      actionButton('navigate','Profiles and scientific settings','data-ci-view="profiles"')+
      actionButton('navigate','Runs and results','data-ci-view="runs"')+'</div><div class="ci-downloads">'+
      downloadsHTML(result._downloads)+'</div>';
  }
  async function refreshCatalog(){
    const expected=workspace,epoch=generation;
    const value=await host.api('/api/client-source/catalog',{method:'POST',body:{workspace:expected}});
    if(!current(expected,epoch))return;
    catalog=value;renderHistory();
  }
  async function openResult(id,adopt=true){
    const expected=workspace,epoch=generation,version=++reading,recipe=readingRecipe(draft.uploads);
    const value=await host.api('/api/client-source/result',{method:'POST',body:{workspace:expected,id}});
    if(!current(expected,epoch)||version!==reading||recipe!==readingRecipe(draft.uploads))return;
    need(value.id===id&&value.project_id===catalog?.project_id,'The retained result belongs to another original project.');
    if(value.action==='client-source.inspect'){
      let candidate=clone(draft);
      if(adopt){
        need(value.state==='complete'&&Array.isArray(value.files),'Wait for the complete original inspection.');
        const originals=inspectedUploads(value);
        const known=new Map([...draft.uploads,...availableUploads()].map(file=>[file.id,file]));
        // Retained inspections keep their original files even after Study transfer.
        // Only local retained receipts can be submitted for another inspection.
        const selected=originals.every(file=>known.has(file.id))?originals:[];
        const different=draft.inspection_id!==id||readingRecipe(draft.uploads)!==readingRecipe(selected);
        if(different){
          if(draft.selections.length&&!confirm('Open this original inspection and its reading choices? Your complete previous source choices remain in the working-copy history.'))return;
          candidate.inspection_id=id;candidate.selections=[];candidate.uploads=selected;
          candidate=preserveWorking(candidate,draft,'Opened the retained original inspection and reading choices');
        }
      }
      need(candidate.inspection_id===id,'The selected inspection differs from this working copy.');
      boundInspection(candidate,value);
      if(!candidate.title.trim()&&typeof value.title==='string'&&value.title.trim())candidate.title=value.title;
      candidate.selected_result=id;validateDraft(candidate,workspace);
      draft=candidate;inspection=value;retain();
      const titleInput=q('[data-ci-field="title"]');if(titleInput)titleInput.value=draft.title;
      renderFiles();renderInspection();renderChoices();
      notice='Showing the retained inspection: '+value.title+'. Review each selected source’s meaning before saving.';messages();
    }else{
      need(value.action==='client-source.commit','This is not a client-source result.');
      const candidate=clone(draft);candidate.selected_result=id;validateDraft(candidate,workspace);
      draft=candidate;result=value;retain();renderResult();
      notice='Showing the saved source edition: '+value.title+'.';messages();
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
    acceptedTask=task;notice='';renderOperationStatus();
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
      applyChoices(candidate);renderFiles();
    }
    notice='Original files retained. Review reading choices, then inspect their actual contents.';messages();
  }
  function addChoice(fi,pi){
    need(inspection&&draft.inspection_id===inspection.id,'Open the complete original inspection first.');
    boundInspection(draft,inspection);
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
    if(target.matches('[data-ci-mapping-name],[data-ci-mapping-selection]')){
      try{
        const index=Number(target.closest('[data-ci-choice]').dataset.ciChoice),choice=draft.selections[index];
        saveChange(value=>{
          const identity=mappingKey(choice),form={...mappingForm(choice)};
          if(target.matches('[data-ci-mapping-name]'))form.name=target.value;
          else form.selected_id=target.value;
          value.mapping_reuse[identity]=form;
        });
        if(target.matches('[data-ci-mapping-selection]'))renderChoices();
      }catch(error){problem=error.message;messages();}
      return;
    }
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
          if(field==='role'&&['CONTEXT','NLCD'].includes(value))delete item.conversion;
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
          if(extra&&required)extra.textContent='Additional native columns · '+bioFields.filter(name=>!required.includes(name)&&draft.selections[index].mapping[name]).length+' selected';
          const meaning=choice.querySelector('[data-ci-meaning]'),item=draft.selections[index];
          if(meaning)meaning.innerHTML=reviewSummary(item,inspection.files[item.file_index].inspection.parts[item.part_index]);}
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
      if(action==='mapping-save'||action==='mapping-apply'){
        const expected=workspace,epoch=generation,index=Number(button.closest('[data-ci-choice]').dataset.ciChoice);
        const choice=draft.selections[index],file=inspection?.files[choice.file_index],part=file?.inspection?.parts[choice.part_index];
        need(inspection&&draft.inspection_id===inspection.id,'Open the original inspection first.');
        const identity=mappingKey(choice),form=mappingForm(choice);
        let candidate=clone(draft);
        if(action==='mapping-save'){
          const template=await createMappingTemplate({name:form.name,choice,part,file,inspection});
          if(!current(expected,epoch))return;
          candidate.mapping_templates.push(template);
          candidate.mapping_reuse[identity]={...form,selected_id:template.id};
          notice='Saved “'+template.name+'” with its original headers. This mapping travels in the complete working copy.';
        }else{
          const template=draft.mapping_templates.find(item=>item.id===form.selected_id);
          await verifyMappingTemplate(template);if(!current(expected,epoch))return;
          const applied=applyMappingTemplate(choice,template,part,requiredFields(choice)||[]);
          candidate=preserveWorking(candidate,draft,'Before applying saved column mapping '+template.name);
          candidate.selections[index]=applied.choice;
          notice='Applied '+applied.preview.matched+' matching column choices from “'+template.name+'”. '+
            (applied.preview.unresolved.length?applied.preview.unresolved.length+' missing or ambiguous choices need manual selection. ':'')+
            'Review this file’s values, units and scientific meaning, then confirm it again.';
        }
        draft=validateDraft(candidate,workspace);retain();renderChoices();return;
      }
      if(action==='profile'){
        const table=profileTables().find(row=>row.id===button.dataset.ciSource);
        need(table,'Open the saved biophysical source edition before preparing its profile.');
        need(typeof host.openDesk==='function','Open the Profile workbench in this complete application.');
        await host.openDesk('profile-workbench','openSource',{workspace_key:workspace,
          source_collection_id:result.source_collection_id,biophysical_source_id:table.id,
          expected_table_sha256:table.body.sha256});return;
      }
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
        boundInspection(draft,inspection);
        if(!draft.selections.length||draft.selections.some(x=>!x.confirmed))throw Error('Review and confirm every selected source.');
        await request('client-source.commit',{title:draft.title,inspection_id:draft.inspection_id,selections:draft.selections.map(value=>{
          const selected=clone(value);
          if(selected.conversion){const factor=Number(selected.conversion.factor);need(String(selected.conversion.factor).trim()!==''&&Number.isFinite(factor)&&factor>0,'Enter a positive conversion factor or remove all conversion fields.');selected.conversion.factor=factor;}
          return selected;
        })});return;
      }
      // Synchronous edits are performed outside the operation's busy guard.
      if(action==='add-choice'||action==='remove-choice'||action==='remove-upload'||action==='recover-upload'||action==='remove-conversion'){
        busy=false;
        if(action==='recover-upload'){
          const receipt=availableUploads().find(row=>row.id===button.dataset.ciId);need(receipt,'The original upload receipt is no longer selected.');
          saveChange(value=>value.uploads.push(clone(receipt)));renderFiles();
        }else if(action==='remove-conversion'){
          saveChange(value=>{
            const choice=value.selections[Number(button.dataset.ciIndex)];
            need(choice&&['CONTEXT','NLCD'].includes(choice.role),'Select a context or land-cover interpretation.');
            delete choice.conversion;choice.confirmed=false;
          });
          notice='Incompatible conversion removed. Review and confirm this source interpretation before saving.';
          renderChoices();messages();
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
        const expected=workspace,epoch=generation,version=++reading;
        let candidate=validateDraft(JSON.parse(await file.text())),opened=null;
        const receiving=candidate.workspace_key!==expected;
        if(!current(expected,epoch)||version!==reading)return;
        if(receiving&&!candidate.inspection_id)throw Error('This unfinished copy has no saved inspection to verify here. Open it in its original Workspace, inspect the originals, then back up and restore that Workspace.');
        if(candidate.inspection_id){
          if(!catalog)await refreshCatalog();
          if(!current(expected,epoch)||version!==reading)return;
          opened=await host.api('/api/client-source/result',{method:'POST',body:{workspace:expected,id:candidate.inspection_id}});
          if(!current(expected,epoch)||version!==reading)return;
          boundInspection(candidate,opened);
        }
        if(!confirm(receiving?'Open these saved source choices against their verified restored inspection? The current and original working copies remain in history. Choose the original files again only when you need a new inspection.':'Open this complete working copy? The current unfinished choices will remain in its retained history. Original native sources and operations stay saved.'))return;
        if(receiving){
          const original=clone(candidate);
          candidate.workspace_key=expected;
          candidate.requests=candidate.requests.map(request=>({...request,workspace_key:request.workspace_key??original.workspace_key}));
          // Upload handles belong to the producing operator; the verified native
          // inspection already retains the complete originals for these choices.
          candidate.uploads=[];
          candidate=preserveWorking(candidate,original,'Received source choices against their original restored inspection');
        }
        candidate=preserveWorking(candidate,draft,'Opened '+file.name);
        draft=candidate;inspection=opened;result=null;retain();q('[data-ci-field="title"]').value=draft.title;
        renderFiles();renderChoices();renderInspection();renderResult();
        notice=receiving?'Saved choices opened against the verified restored inspection. Originals remain there; choose files again only for a new inspection. Original request identities and working copies are retained.':'Complete working copy opened against this original Workspace. Original request identities are retained.';messages();
      });
    }
  }
  function mount(target,currentState=host.getState()){
    const key=host.getWorkspace();if(root===target&&workspace===key){update(currentState);return;}
    suspend();root=target;workspace=key;state=currentState;generation++;load();
    catalog=null;inspection=null;result=null;acceptedTask=null;busy=false;notice='';problem='';
    root.innerHTML='<main class="ci-desk"><header><p class="eyebrow">SCIENTIFIC WORKBENCH</p><h1>Open my data</h1><p>Keep your original files and labels. Review their meaning here, then use the existing scientific preparation and run controls.</p></header>'+
      '<p data-ci-error role="alert" class="ci-error"></p><p data-ci-notice role="status" aria-live="polite"></p><div data-ci-operation-status role="status" aria-live="polite"></div><p data-ci-storage role="status" class="ci-warning"></p>'+
      '<section><h2>1. Choose original files</h2>'+inputField('Name this source intake','title',draft.title)+
      '<label class="ci-file-picker"><span>CSV, TSV, Excel, GeoTIFF, GeoPackage, GeoJSON or shapefile and its sidecars</span><input type="file" multiple data-ci-upload-files data-ci-mutating></label><div data-ci-files></div><div data-ci-recovered></div>'+
      '<div class="ci-actions">'+actionButton('inspect','Inspect original files','data-ci-mutating')+actionButton('download','Download complete working copy')+
      '<label>Open working copy<input type="file" accept=".json,application/json" data-ci-open-working data-ci-mutating></label>'+
      '<p data-ci-recovery-count></p><span data-ci-invalid hidden>'+actionButton('invalid','Download exact previous browser copy')+'</span></div></section>'+
      '<section data-ci-inspection></section><section><h2>2. Review source meaning</h2><p>Review the original columns, units and period. Save the interpretation you intend to use in the existing scientific preparation and run controls.</p><div data-ci-choices></div>'+
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
    state=currentState;renderHistory();renderResult();
  }
  function suspend(){
    controller?.abort();controller=null;root=null;generation++;reading++;busy=false;
  }
  return {mount,update,suspend};
}
