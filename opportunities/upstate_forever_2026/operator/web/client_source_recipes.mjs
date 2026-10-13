/** Complete source-collection recipes on the original operator queue. */
const clone=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const arr=value=>Array.isArray(value)?value:[];
const obj=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const need=(test,message)=>{if(!test)throw Error(message);};
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':obj(value)?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const equal=(a,b)=>canonical(a)===canonical(b);
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:canonical(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');
const NATIVE_ID=/^[0-9a-f]{64}$/;
const WORKING_SCHEMA='upstate.client-source-recipes-working/v1';
const REQUEST_LIMIT=4*1024*1024;
const action=(name,label,attrs='')=>'<button type="button" data-cr-action="'+name+'" '+attrs+'>'+esc(label)+'</button>';
const input=(label,name,value,type='text',attrs='')=>'<label><span>'+esc(label)+'</span><input type="'+type+'" data-cr-field="'+esc(name)+'" value="'+esc(value)+'" data-cr-mutate '+attrs+'></label>';
const textarea=(label,name,value)=>'<label class="cr-wide"><span>'+esc(label)+'</span><textarea data-cr-field="'+esc(name)+'" data-cr-mutate>'+esc(value)+'</textarea></label>';
const select=(label,name,choices,value,attrs='')=>'<label><span>'+esc(label)+'</span><select data-cr-field="'+esc(name)+'" data-cr-mutate '+attrs+'>'+choices.map(([key,title])=>'<option value="'+esc(key)+'"'+(String(value??'')===String(key)?' selected':'')+'>'+esc(title)+'</option>').join('')+'</select></label>';
const check=(label,name,value)=>'<label class="cr-check"><input type="checkbox" data-cr-field="'+esc(name)+'" '+(value?'checked':'')+' data-cr-mutate><span>'+esc(label)+'</span></label>';
const details=(title,value)=>'<details><summary>'+esc(title)+'</summary><pre>'+esc(JSON.stringify(value,null,2))+'</pre></details>';
const fresh=workspace=>({schema:WORKING_SCHEMA,workspace_key:workspace,project_id:null,recipe_id:null,revision:null,inspection_id:null,commit_id:null,name:'',description:'',title:'',reviewer:'',bindings:[],reviews:[],use_id:null,selected_task:null,requests:[],history:[],archive_upload:null,archive_uploads:[]});
const workingText=value=>JSON.stringify(value,null,2)+'\n';
function validateWorking(value,workspace=null,history=true){
  need(obj(value)&&value.schema===WORKING_SCHEMA,'Choose a complete source-recipes working copy.');
  need(typeof value.workspace_key==='string'&&value.workspace_key.length>0&&(!workspace||value.workspace_key===workspace),'Open this working copy in its original Workspace.');
  need(value.project_id===null||typeof value.project_id==='string','The original project identity is invalid.');
  for(const name of ['recipe_id','inspection_id','commit_id','use_id','selected_task'])need(value[name]===null||NATIVE_ID.test(value[name]),'A retained '+name+' identity is invalid.');
  need(value.revision===null||Number.isInteger(value.revision)&&value.revision>0,'Choose a saved recipe revision.');
  for(const name of ['name','description','title','reviewer'])need(typeof value[name]==='string'&&value[name].length<=16000,'The complete '+name+' field is invalid.');
  for(const name of ['bindings','reviews','requests','history'])need(Array.isArray(value[name]),'The complete '+name+' list is missing.');
  value=clone(value);value.archive_upload??=null;value.archive_uploads??=[];
  need(value.archive_upload===null||NATIVE_ID.test(value.archive_upload),'The selected recipe archive upload is invalid.');
  need(Array.isArray(value.archive_uploads),'Keep all original archive upload receipts.');
  const uploadIds=new Set();
  for(const row of value.archive_uploads){need(obj(row)&&NATIVE_ID.test(row.id)&&NATIVE_ID.test(row.sha256)&&typeof row.filename==='string'&&Number.isSafeInteger(row.bytes)&&row.bytes>=0&&!uploadIds.has(row.id),'A full original archive upload receipt is invalid.');uploadIds.add(row.id);}
  need(value.archive_upload===null||uploadIds.has(value.archive_upload),'The selected archive must keep its original upload receipt.');
  const slots=new Set();
  for(const row of value.bindings){need(obj(row)&&typeof row.slot_id==='string'&&!slots.has(row.slot_id),'A source-part binding is repeated or invalid.');slots.add(row.slot_id);need(Number.isInteger(row.file_index)&&row.file_index>=0&&Number.isInteger(row.part_index)&&row.part_index>=0&&obj(row.columns)&&Object.values(row.columns).every(x=>typeof x==='string'),'The complete source-part binding is invalid.');}
  const reviewSlots=new Set();
  for(const row of value.reviews){need(obj(row)&&typeof row.slot_id==='string'&&!reviewSlots.has(row.slot_id)&&obj(row.selection)&&Array.isArray(row.reviewed)&&new Set(row.reviewed).size===row.reviewed.length&&row.reviewed.every(x=>['source','mapping','scientific_role','units'].includes(x)),'A reviewed source selection is invalid.');reviewSlots.add(row.slot_id);}
  const requests=new Set();
  for(const row of value.requests){need(obj(row)&&typeof row.id==='string'&&/^(source-recipe-|recipe-commit-)[0-9a-f]{64}$/.test(row.id)&&!requests.has(row.id)&&typeof row.workspace==='string'&&typeof row.action==='string'&&obj(row.payload),'An original queued request is invalid.');requests.add(row.id);need(row.key===canonical({workspace:row.workspace,action:row.action,payload:row.payload}),'A saved original request body differs.');need(row.task_id===null||NATIVE_ID.test(row.task_id),'The saved original task is invalid.');}
  if(history)for(const row of value.history){need(obj(row)&&typeof row.raw==='string'&&typeof row.reason==='string'&&typeof row.saved_at==='string','A retained earlier working copy is invalid.');const old=JSON.parse(row.raw);need(!Object.hasOwn(old,'history'),'A prior working copy cannot recursively duplicate history.');validateWorking({...old,history:[]},null,false);}
  workingText(value);return clone(value);
}
function preserve(candidate,prior,reason){
  const old=clone(prior);delete old.history;const raw=JSON.stringify(old,null,2)+'\n';
  const rows=[...candidate.history,...prior.history,{raw,reason,saved_at:new Date().toISOString()}];
  return validateWorking({...candidate,history:[...new Map(rows.map(row=>[row.raw,row])).values()]});
}
export function createClientSourceRecipes(host){
  let root=null,workspace=null,state=null,generation=0,controller=null,busy=false,problem='',notice='',storageProblem='',invalidRaw=null;
  const lateArchiveUploads=new Map();
  let working=fresh('unmounted'),catalog=null,intakes=null,record=null,plan=null,inspection=null,use=null,operation=null;
  const q=s=>root?.querySelector(s),storageKey=key=>'upstate-source-recipes-v1:'+key;
  const current=(key,epoch)=>root&&workspace===key&&generation===epoch;
  const download=(value,name,type='application/json')=>{const raw=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n';const url=URL.createObjectURL(new Blob([raw],{type})),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);};
  function retain(){
    if(invalidRaw!==null){storageProblem='The previous unreadable browser copy is preserved. Download its exact bytes and the complete current working copy before leaving.';return false;}
    const raw=workingText(working);
    try{sessionStorage.setItem(storageKey(workspace),raw);need(sessionStorage.getItem(storageKey(workspace))===raw,'The saved browser bytes did not read back.');storageProblem='';return true;}
    catch(error){storageProblem='Browser storage is unavailable. The complete current working copy remains in this page; download it before leaving. Completed native records remain saved. '+error.message;return false;}
  }
  function load(){working=fresh(workspace);invalidRaw=null;storageProblem='';try{const raw=sessionStorage.getItem(storageKey(workspace));if(raw){try{working=validateWorking(JSON.parse(raw),workspace);}catch(error){invalidRaw=raw;storageProblem='The prior browser copy is unchanged and could not be read: '+error.message;}}}catch(error){storageProblem='Browser storage is unavailable. Download your complete working copy before leaving. '+error.message;}}
  function save(change,{resetUse=false}={}){need(!busy,'Wait for the current original operation.');const next=clone(working);change(next);if(resetUse)next.use_id=null;working=validateWorking(next,workspace);retain();problem='';messages();}
  function messages(){if(!root)return;q('[data-cr-error]').textContent=problem;q('[data-cr-notice]').textContent=notice;q('[data-cr-storage]').textContent=storageProblem;root.setAttribute('aria-busy',busy?'true':'false');root.querySelectorAll('[data-cr-mutate]').forEach(el=>el.disabled=busy);q('[data-cr-invalid]').hidden=invalidRaw===null;}
  async function run(fn){need(!busy,'Wait for the selected original operation.');const key=workspace,epoch=generation;busy=true;problem='';messages();try{await fn(key,epoch);}catch(error){if(current(key,epoch)){problem=error.message||String(error);messages();}}finally{if(current(key,epoch)){busy=false;messages();}}}
  async function post(path,body,key=workspace){return host.api(path,{method:'POST',body:{...body,workspace:key}});}
  async function submit(actionName,payload,{original=null}={}){
    const key=workspace,epoch=generation,body=clone(payload),requestKey=canonical({workspace:key,action:actionName,payload:body});
    if(original)need(original.workspace===key&&original.action===actionName&&equal(original.payload,body),'Keep the exact local prepared commit request.');
    const id=original?.operation_id||'source-recipe-'+await digest(requestKey);if(!current(key,epoch))return null;
    need(new TextEncoder().encode(JSON.stringify({workspace:key,action:actionName,payload:body,operation_id:id})).length<=REQUEST_LIMIT,'The complete request exceeds the original operator 4 MiB capacity. Download the working copy and select a smaller source collection.');
    let row=working.requests.find(item=>item.id===id);
    if(row)need(row.workspace===key&&row.key===requestKey,'Keep the exact selected original request.');
    else{row={id,workspace:key,action:actionName,payload:body,key:requestKey,task_id:null};working.requests.push(row);}
    retain();renderRequests();notice='Submitting the saved original request. A lost response keeps this same request available.';messages();
    const task=await host.api('/api/actions',{method:'POST',body:{workspace:key,action:row.action,payload:row.payload,operation_id:row.id}});
    if(!current(key,epoch))return null;
    need(NATIVE_ID.test(task?.id),'The operator did not return an original task identity.');
    row=working.requests.find(item=>item.id===id);row.task_id=task.id;working.selected_task=task.id;retain();
    notice='Original operation '+String(task.state||'accepted')+'. Open its progress or refresh its retained result.';await host.refresh({force:true});if(!current(key,epoch))return null;state=host.getState();await refresh(key,epoch);return task;
  }
  function renderRequests(){
    if(!root)return;const rows=working.requests;
    q('[data-cr-requests]').innerHTML=rows.length?rows.map((row,index)=>'<div class="cr-row"><span><strong>'+esc(row.action)+'</strong><br><code>'+esc(row.id)+'</code></span>'+action('resume','Resume exact request','data-cr-index="'+index+'" data-cr-mutate')+(row.task_id?action('task','Original progress','data-cr-id="'+row.task_id+'"'):'')+'</div>').join(''):'<p>No original request has been submitted from this working copy.</p>';
  }

  const read=(name,payload={},key=workspace)=>post('/api/client-source-recipes/'+name,payload,key);
  const selectedEvent=()=>record?.events?.find(row=>row.revision===working.revision);
  function downloads(rows){return arr(rows).map(row=>{need(typeof row.url==='string'&&/^\/api\/file\/[0-9a-f]{64}$/.test(row.url),'A retained file ticket is invalid.');return '<a class="cr-link" href="'+esc(row.url)+'?download=1" target="_blank" rel="noopener">'+esc(row.label||row.filename)+' · '+Number(row.bytes).toLocaleString()+' bytes</a>';}).join('');}
  async function refresh(key=workspace,epoch=generation){
    const [recipes,sources]=await Promise.all([read('catalog',{},key),post('/api/client-source/catalog',{},key)]);
    if(!current(key,epoch))return;
    need(recipes.project_id===sources.project_id,'The recipe and original source project identities differ.');
    if(working.project_id)need(working.project_id===recipes.project_id,'The retained recipe working copy belongs to another project.');
    working.project_id=recipes.project_id;catalog=recipes;intakes=sources;retain();render();
  }
  async function openRecipe(id,revision=null,{reset=true}={}){
    const key=workspace,epoch=generation,value=await read('result',{recipe_id:id},key);if(!current(key,epoch))return;
    need(value?.record?.id===id&&Array.isArray(value.record.events)&&value.record.events.length,'The complete recipe record is missing.');
    const selected=revision??value.record.events.at(-1).revision;need(value.record.events.some(row=>row.revision===selected),'Select an actual saved recipe revision.');
    if(reset){const next={...working,recipe_id:id,revision:selected,bindings:[],reviews:[],use_id:null};working=preserve(next,working,'Selected recipe '+id+' revision '+selected);plan=null;use=null;}
    record=value.record;working.recipe_id=id;working.revision=selected;retain();render();
    if(working.inspection_id)await preview();
  }
  async function preview(){
    need(working.recipe_id&&working.revision&&working.inspection_id,'Choose a saved recipe revision and a completed new inspection.');
    const key=workspace,epoch=generation,choice={recipe_id:working.recipe_id,revision:working.revision,inspection_id:working.inspection_id,bindings:clone(working.bindings)};
    const [value,original]=await Promise.all([read('plan',choice,key),post('/api/client-source/result',{id:choice.inspection_id},key)]);if(!current(key,epoch))return;
    need(value.schema==='upstate.client-source-recipe-plan/v1'&&value.recipe_id===choice.recipe_id&&value.recipe_revision===choice.revision&&value.inspection_id===choice.inspection_id&&value.project_id===working.project_id,'The selected recipe plan or inspection changed.');
    need(original.id===choice.inspection_id&&original.action==='client-source.inspect'&&original.state==='complete'&&original.project_id===working.project_id,'Open the exact complete local source inspection.');
    plan=value;inspection=original;
    const previous=new Map(working.reviews.map(row=>[row.slot_id,row]));
    working.reviews=value.rows.filter(row=>row.selection).map(row=>{
      const old=previous.get(row.slot_id),selection=clone(row.selection);selection.reviewer=working.reviewer;
      const keys=['file_index','part_index','role','models','mapping','identifier_field','label_field'];
      return old&&keys.every(name=>equal(old.selection[name],selection[name]))?old:{slot_id:row.slot_id,selection,reviewed:[]};
    });
    retain();renderPlan();renderUse();messages();
  }
  async function openUse(id){
    const key=workspace,epoch=generation,value=await read('use',{use_id:id},key);if(!current(key,epoch))return;
    need(value?.use?.id===id&&value.use.schema==='upstate.client-source-recipe-use/v1','The complete prepared use is missing.');
    use=value;working.use_id=id;retain();renderUse();messages();
  }
  async function openTask(id){
    const key=workspace,epoch=generation,task=await host.api('/api/task?id='+encodeURIComponent(id));
    if(!current(key,epoch))return;
    need(task.id===id&&task.workspace===key,'The original operation belongs to another Workspace.');
    operation=task;
    if(task.state==='complete'){
      const result=task._client_source_recipe||task.result;
      if(result?.recipe_id&&result?.record)await openRecipe(result.recipe_id,result.revision);
      else if(result?.use_id)await openUse(result.use_id);
      else if(result?.portable?.recipe_id)await openRecipe(result.portable.recipe_id);
      else if(task.action==='client-source.commit'&&use&&equal(task.payload,use.use.commit_request.payload)){
        const row=working.requests.find(item=>item.id===use.use.commit_request.operation_id);if(row){row.task_id=task.id;retain();}
      }
    }
    renderOperation();renderUse();messages();
  }
  function renderCatalog(){
    const recipes=arr(catalog?.recipes),commits=arr(intakes?.operations).filter(row=>row.action==='client-source.commit'&&row.state==='complete'),inspections=arr(intakes?.operations).filter(row=>row.action==='client-source.inspect'&&row.state==='complete');
    q('[data-cr-capture]').innerHTML='<div class="cr-grid">'+select('Completed reviewed source edition','commit_id',[['','Select a completed original commit'],...commits.map(row=>[row.id,row.title+' · '+row.id.slice(0,12)])],working.commit_id)+input('Recipe name','name',working.name,'text','maxlength="240"')+textarea('Scope and limitations','description',working.description)+'</div><div class="cr-actions">'+action('create','Save new recipe','data-cr-mutate')+action('revise','Save next recipe revision','data-cr-mutate')+'</div><p class="cr-muted">Revising uses the latest saved revision and digest explicitly. Received recipes keep their original history; create a local recipe from a local completed commit to change the interpretation.</p>';
    q('[data-cr-select]').innerHTML='<div class="cr-grid">'+select('Saved recipe','recipe_id',[['','Choose a source recipe'],...recipes.map(row=>[row.id,row.name+' · '+row.selections+' source parts'+(row.local?'':' · received origin')])],working.recipe_id)+select('Exact recipe revision','revision',[['','Choose a revision'],...arr(record?.events).map(row=>[String(row.revision),'Revision '+row.revision+' · '+row.created_at])],working.revision)+select('New completed source inspection','inspection_id',[['','Choose the actual new inspection'],...inspections.map(row=>[row.id,row.title+' · '+row.id.slice(0,12)])],working.inspection_id)+input('New scientific source edition title','title',working.title,'text','maxlength="8000"')+input('Current reviewing scientist','reviewer',working.reviewer)+'</div><div class="cr-actions">'+action('preview','Preview complete source bindings','data-cr-mutate')+action('intake','Open original file intake')+'</div>';
    q('[data-cr-record]').innerHTML=record?'<p><strong>'+esc(selectedEvent()?.definition.name)+'</strong> · revision '+working.revision+' · original project <code>'+esc(record.origin_project_id)+'</code></p>'+details('Full recipe, original source selection and every revision',record):'<p>No recipe is selected. Save one from a completed reviewed source edition, or receive its complete archive.</p>';
    q('[data-cr-uses]').innerHTML=arr(catalog?.uses).length?catalog.uses.map(row=>'<div class="cr-row"><span><code>'+esc(row.id)+'</code><br>Recipe revision '+row.revision+' · '+(row.attached?'native result attached':'prepared use')+' · '+(row.local?'this Workspace':'retained producer scope')+'</span>'+action('open-use','Open complete use','data-cr-id="'+row.id+'" data-cr-mutate')+'</div>').join(''):'<p>No recipe use has been saved.</p>';
  }
  function renderPlan(){
    const target=q('[data-cr-plan]');if(!target)return;
    if(!plan){target.innerHTML='<p>Choose a completed inspection to compare it with the exact recipe revision. Every source part needs an explicit binding.</p>';return;}
    target.innerHTML='<p>'+plan.rows.length+' original source selections · '+(plan.ready_for_review?'all file and column bindings resolved':'some source or column bindings remain unresolved')+'. Physical units and scientific review remain explicit.</p>'+plan.rows.map(row=>{
      const stored=working.reviews.find(item=>item.slot_id===row.slot_id),choice=stored?.selection,origin=row.original;
      const binding=working.bindings.find(item=>item.slot_id===row.slot_id);
      const targetKey=binding?binding.file_index+':'+binding.part_index:'';
      const choices=[['','Explicitly choose a new file and part'],...row.candidates.map(c=>[c.file_index+':'+c.part_index,c.filename+' · '+c.part.name+' · '+c.part.kind])];
      const part=inspection.files[choice?.file_index]?.inspection?.parts?.[choice?.part_index];
      const fieldChoices=[['','Use unique exact-label suggestion if available'],...arr(part?.fields).map(field=>[field.id,(field.display||field.label||'(blank label)')+' ['+field.id+']'])];
      const cols=row.columns.length?'<div class="cr-scroll" tabindex="0" role="region" aria-label="Original and new source columns"><table><thead><tr><th>Meaning</th><th>Original column</th><th>Observed match</th><th>Explicit new column</th></tr></thead><tbody>'+row.columns.map(col=>'<tr><th scope="row">'+esc(col.key)+'</th><td>'+esc(col.original.display||col.original.label||'(blank label)')+'<br><code>'+esc(col.original.id)+'</code></td><td>'+esc(col.status)+(col.selected?'<br>'+esc(col.selected.display||col.selected.label||'(blank label)')+' ['+esc(col.selected.id)+']':'')+'</td><td>'+select('New column for '+col.key,'column:'+col.key,fieldChoices,binding?.columns?.[col.key]||'')+'</td></tr>').join('')+'</tbody></table></div>':'<p>No original field references need remapping for this selection.</p>';
      const reviews=choice?'<div class="cr-grid">'+input('New source title','selection:title',choice.title)+input('Publisher or original reference','selection:uri',choice.uri)+input('Source edition or vintage','selection:vintage',choice.vintage)+input('Original physical units','selection:units',choice.units)+input('Period represented','selection:period',choice.period)+input('Time zone','selection:timezone',choice.timezone)+input('Methods and unit interpretation reference','selection:reference',choice.reference)+textarea('Interpretation and limitations','selection:notes',choice.notes)+'</div><p>Scientific role: <strong>'+esc(choice.role)+'</strong> · native models: '+esc(arr(choice.models).join(', '))+'. Change these meanings through an explicitly revised source intake.</p>'+(part?.kind==='raster'?'<fieldset><legend>Current native grid interpretation</legend><div class="cr-grid">'+select('Reviewed resampling','selection:resampling',[['nearest','Nearest'],['bilinear','Bilinear'],['average','Average'],['mode','Mode']],choice.resampling)+input('Explicit conversion factor, if any','conversion:factor',choice.conversion?.factor??'','number','min="0" step="any"')+input('Converted target units','conversion:target_units',choice.conversion?.target_units??'')+input('Conversion source and reference','conversion:reference',choice.conversion?.reference??'')+'</div></fieldset>':'')+'<fieldset><legend>Fresh review for this exact new source</legend>'+[['source','I reviewed this original file, part, reference, time and source edition.'],['mapping','I reviewed the actual column and identifier mappings.'],['scientific_role','I reviewed the scientific role and native model requirements.'],['units','I reviewed the actual physical units and any explicit transformation.']].map(([name,label])=>check(label,'review:'+name,stored.reviewed.includes(name))).join('')+check('I confirm this complete new source interpretation.','selection:confirmed',choice.confirmed)+'</fieldset>':'';
      return '<article data-cr-slot="'+esc(row.slot_id)+'"><h3>'+esc(origin.filename)+' · '+esc(origin.part.name)+'</h3><p>Original '+esc(origin.part.kind)+' · role '+esc(origin.selection.role)+' · slot '+esc(row.slot_id)+'</p>'+select('New original file and part','target',choices,targetKey)+(row.suggested_target&&!binding?'<p class="cr-notice">An exact-name suggestion exists; explicitly choose the file and part above to accept it.</p>':'')+(row.unresolved.length?'<p class="cr-warning">'+row.unresolved.map(esc).join('<br>')+'</p>':'')+cols+details('Original complete source selection',origin)+(Object.keys(row.part_changes||{}).length?details('Observed source part changes',row.part_changes):'')+(row.previous_conversion?details('Previous conversion for context only',row.previous_conversion):'')+(part?details('Complete new inspection part and original sample',part):'')+reviews+'</article>';
    }).join('')+'<div class="cr-actions">'+action('prepare','Save fully reviewed recipe use','data-cr-mutate')+'</div>';
  }
  function renderUse(){
    const target=q('[data-cr-use]');if(!target)return;if(!use){target.innerHTML='<p>A prepared use retains the exact reviewed payload before an original scientific source commit is submitted.</p>';return;}
    const local=use.use.workspace_key===workspace&&use.use.project_id===working.project_id;
    const request=use.use.commit_request,row=working.requests.find(item=>item.id===request.operation_id);
    target.innerHTML='<p><strong>'+(use.applied?'Original source result attached':'Prepared source use')+'</strong> · <code>'+esc(use.use.id)+'</code> · '+(local?'selected local Workspace':'retained producer Workspace; prepare a new local use to commit')+'</p>'+details('Complete prepared review and exact original commit request',use.use)+(use.applied?details('Original attached commit and complete source collection',use.applied):'')+'<div class="cr-actions">'+downloads(use._downloads)+(use.applied?.commit?.source_collection_id?action('source','Open native scientific source edition','data-cr-id="'+esc(use.applied.commit.source_collection_id)+'"'):'')+(local&&!use.applied?action('commit','Submit exact saved source commit','data-cr-mutate'):'')+(row?.task_id?action('task','Open original commit progress','data-cr-id="'+row.task_id+'"'):'')+(local&&!use.applied?action('attach','Attach completed original source result','data-cr-mutate'):'')+'</div>';
  }
  function renderOperation(){
    const target=q('[data-cr-operation]');if(!target)return;
    target.innerHTML=operation?'<h3>Original operation '+esc(operation.state)+'</h3><p>'+esc(operation.action)+' · <code>'+esc(operation.id)+'</code></p><div class="cr-actions">'+action('task','Open progress and original request','data-cr-id="'+operation.id+'"')+(['failed','interrupted','cancelled'].includes(operation.state)?action('resume-task','Resume this native task','data-cr-id="'+operation.id+'" data-cr-mutate'):'')+downloads(operation._downloads)+'</div>'+details('Complete original operation result',operation):'';
  }
  function render(){
    if(!root)return;renderCatalog();renderPlan();renderUse();renderRequests();renderOperation();renderNativeTasks();renderPortable();messages();
  }

  function clearReview(next,slot){next.use_id=null;next.reviews=next.reviews.filter(row=>row.slot_id!==slot);}
  async function change(event){
    const target=event.target,field=target.dataset.crField;if(!field)return;
    const slot=target.closest('[data-cr-slot]')?.dataset.crSlot;
    const value=target.type==='checkbox'?target.checked:target.value;
    if(slot&&(field==='target'||field.startsWith('column:'))){
      await run(async()=>{
        const next=clone(working);
        if(field==='target'){
          next.bindings=next.bindings.filter(row=>row.slot_id!==slot);
          if(value){const [fi,pi]=value.split(':').map(Number);const row=plan.rows.find(row=>row.slot_id===slot);need(row.candidates.some(item=>item.file_index===fi&&item.part_index===pi),'Select a part in this exact new inspection.');next.bindings.push({slot_id:slot,file_index:fi,part_index:pi,columns:{}});}
        }else{const binding=next.bindings.find(row=>row.slot_id===slot);need(binding,'Explicitly choose a file and part before remapping columns.');if(value)binding.columns[field.slice(7)]=value;else delete binding.columns[field.slice(7)];}
        clearReview(next,slot);working=validateWorking(next,workspace);use=null;retain();await preview();
      });return;
    }
    if(field==='recipe_id'){
      await run(async()=>{if(value)await openRecipe(value);else{working=preserve({...working,recipe_id:null,revision:null,bindings:[],reviews:[],use_id:null},working,'Cleared selected recipe');record=null;plan=null;use=null;retain();render();}});return;
    }
    if(field==='revision'){await run(async()=>{need(working.recipe_id&&value,'Select an actual saved recipe revision.');await openRecipe(working.recipe_id,Number(value));});return;}
    if(field==='inspection_id'){
      await run(async()=>{const next={...working,inspection_id:value||null,bindings:[],reviews:[],use_id:null};working=preserve(next,working,'Selected a new original inspection');inspection=null;plan=null;use=null;retain();render();if(value&&working.recipe_id)await preview();});return;
    }
    save(next=>{
      if(slot){
        const review=next.reviews.find(row=>row.slot_id===slot);need(review,'Bind the original part before entering its review.');
        if(field.startsWith('review:')){const name=field.slice(7);review.reviewed=review.reviewed.filter(x=>x!==name);if(value)review.reviewed.push(name);}
        else if(field.startsWith('selection:')){const name=field.slice(10);review.selection[name]=value;if(name!=='confirmed'){review.selection.confirmed=false;review.reviewed=[];}}
        else if(field.startsWith('conversion:')){
          const name=field.slice(11);review.selection.conversion??={factor:'',target_units:'',reference:''};review.selection.conversion[name]=value;
          if(Object.values(review.selection.conversion).every(x=>x===''))delete review.selection.conversion;
          review.selection.confirmed=false;review.reviewed=[];
        }
        next.use_id=null;use=null;
      }else{
        need(['commit_id','name','description','title','reviewer'].includes(field),'Choose a declared recipe field.');
        next[field]=field==='commit_id'?(value||null):value;
        if(field==='reviewer'){for(const row of next.reviews){row.selection.reviewer=value;row.selection.confirmed=false;row.reviewed=[];}next.use_id=null;use=null;}
        if(field==='title'){next.use_id=null;use=null;}
      }
    });
    if(slot&&field!=='selection:confirmed'&&!field.startsWith('review:')){
      const article=target.closest('[data-cr-slot]');article?.querySelectorAll('input[type=checkbox]').forEach(el=>el.checked=false);
    }
    if(field==='reviewer')root.querySelectorAll('[data-cr-slot] input[type=checkbox]').forEach(el=>el.checked=false);
    renderUse();
  }
  async function click(event){
    const button=event.target.closest('[data-cr-action]');if(!button||!root.contains(button))return;
    const name=button.dataset.crAction,id=button.dataset.crId;
    if(name==='download'){download(workingText(working),'source-recipes-working.json');return;}
    if(name==='invalid'){if(invalidRaw!==null)download(invalidRaw,'source-recipes-previous-browser-copy.txt','text/plain');return;}
    if(name==='intake'){host.navigate('client-source-intake');return;}
    if(name==='task'){await host.showTask(id);return;}
    if(name==='source'){await host.openItem('sources',id);return;}
    await run(async(key,epoch)=>{
      if(name==='refresh'){await host.refresh({force:true});if(!current(key,epoch))return;state=host.getState();await refresh(key,epoch);return;}
      if(name==='preview'){await preview();return;}
      if(name==='export'){
        need(working.recipe_id,'Select the complete saved recipe to export.');
        await submit('client-source-recipe.export',{recipe_id:working.recipe_id});return;
      }
      if(name==='receive'){
        need(working.archive_upload&&working.archive_uploads.some(row=>row.id===working.archive_upload),'Choose and retain the complete incoming recipe archive first.');
        await submit('client-source-recipe.receive',{upload_id:working.archive_upload});return;
      }
      if(name==='select-archive'){
        const receipt=archiveUploads().find(row=>row.id===id);need(receipt,'The original archive upload receipt is unavailable.');
        if(!working.archive_uploads.some(row=>row.id===receipt.id))working.archive_uploads.push(receipt);
        working.archive_upload=id;retain();renderPortable();messages();return;
      }
      if(name==='open-use'){await openUse(id);return;}
      if(name==='open-task'){await openTask(id);return;}
      if(name==='resume-task'){await host.api('/api/task/resume',{method:'POST',body:{id}});if(current(key,epoch)){await host.refresh({force:true});state=host.getState();await openTask(id);}return;}
      if(name==='resume'){
        const row=working.requests[Number(button.dataset.crIndex)];need(row,'The saved original request is missing.');
        need(row.workspace===workspace,'This request belongs to the producer Workspace; inspect its retained history rather than resubmitting it here.');
        await submit(row.action,row.payload,{original:{workspace:row.workspace,action:row.action,payload:row.payload,operation_id:row.id}});return;
      }
      if(name==='create'||name==='revise'){
        need(working.commit_id&&working.name.trim(),'Select the completed source commit and give the recipe a name.');
        const payload={name:working.name.trim(),description:working.description.trim(),commit_id:working.commit_id};
        if(name==='revise'){need(record&&record.origin_project_id===working.project_id,'Revise a recipe only in its original project.');const latest=record.events.at(-1);need(working.revision===latest.revision,'Open the latest recipe revision before adding its successor.');Object.assign(payload,{recipe_id:record.id,expected_revision:latest.revision,expected_sha256:latest.sha256});}
        await submit('client-source-recipe.'+name,payload);return;
      }
      if(name==='prepare'){
        need(plan?.ready_for_review&&selectedEvent(),'Resolve every explicit source and column binding.');
        need(working.title.trim()&&working.title.trim().length<=8000&&working.reviewer.trim(),'Enter a new source edition title within the original 8,000-character capacity and the current reviewer.');
        need(working.reviews.length===plan.rows.length,'Review every selected source part.');
        for(const row of working.reviews){need(row.selection.confirmed&&['source','mapping','scientific_role','units'].every(area=>row.reviewed.includes(area)),'Complete fresh source, mapping, role and units review for every part.');need(row.selection.reviewer===working.reviewer,'Keep the same current reviewer on every source.');}
        const reviewed=clone(working.reviews),reviewer=working.reviewer.trim();
        for(const row of reviewed){row.selection.reviewer=reviewer;if(row.selection.conversion){const raw=row.selection.conversion.factor;need(String(raw).trim()!=='','Enter a positive finite conversion factor or clear the complete optional conversion.');const factor=Number(raw);need(Number.isFinite(factor)&&factor>0,'A conversion factor must be a positive finite number.');need(!Number.isInteger(factor)||Number.isSafeInteger(factor),'Keep an exactly represented numerical conversion factor.');row.selection.conversion.factor=factor;}}
        await submit('client-source-recipe.prepare-use',{recipe_id:working.recipe_id,revision:working.revision,recipe_sha256:selectedEvent().sha256,inspection_id:working.inspection_id,bindings:clone(working.bindings),selections:reviewed,title:working.title.trim(),reviewer});return;
      }
      if(name==='commit'){
        need(use&&!use.applied,'Open the exact saved prepared source use.');
        const request=use.use.commit_request;need(use.use.project_id===working.project_id&&request.workspace===workspace,'Prepare a new local use for this receiving Workspace.');
        const task=await submit(request.action,request.payload,{original:request});if(task&&current(key,epoch)){notice='The exact prepared original source commit is '+task.state+'. Wait for completion, then attach this same result.';renderUse();messages();}return;
      }
      if(name==='attach'){
        need(use&&!use.applied&&use.use.workspace_key===workspace,'Open the exact unattached local prepared use.');
        const request=use.use.commit_request;let row=working.requests.find(item=>item.id===request.operation_id);
        // Original queue deduplication can return an earlier equivalent native task.
        // Use its actual observed ID, never derive a substitute task identity here.
        if(!row?.task_id){
          const existing=arr(state?.tasks).filter(task=>task.action===request.action&&equal(task.payload,request.payload)&&task.workspace===workspace);
          if(existing.length===1){const task=await host.api('/api/task?id='+encodeURIComponent(existing[0].id));need(task.state==='complete','Finish the original source commit before attaching it.');row={task_id:task.id};}
        }
        need(row?.task_id,'Submit or resume the saved original commit to recover its actual task identity.');
        const task=await host.api('/api/task?id='+encodeURIComponent(row.task_id));if(!current(key,epoch))return;
        need(task.state==='complete'&&task.workspace===workspace&&task.action===request.action&&equal(task.payload,request.payload),'The actual original commit is not complete or selects another source review.');
        await submit('client-source-recipe.attach-result',{use_id:use.use.id,use_sha256:use.use.sha256,commit_id:task.id});return;
      }
      throw Error('This source recipe control is unavailable.');
    });
  }
  function archiveUploads(){
    const prefix=storageKey(workspace)+':archive:';
    try{for(let i=0;i<sessionStorage.length;i++){const key=sessionStorage.key(i);if(key?.startsWith(prefix)){try{const value=JSON.parse(sessionStorage.getItem(key));validateWorking({...fresh(workspace),archive_upload:value.id,archive_uploads:[value]});need(key===prefix+value.id,'The archive receipt key differs.');lateArchiveUploads.set(key,value);}catch{/* Preserve unreadable original receipts unchanged. */}}}}catch{/* In-memory complete receipts remain available. */}
    return [...new Map([...working.archive_uploads,...[...lateArchiveUploads].filter(([key])=>key.startsWith(prefix)).map(([,value])=>value)].map(row=>[row.id,row])).values()];
  }
  function renderPortable(){
    const target=q('[data-cr-portable]');if(!target)return;
    const selected=working.archive_uploads.find(row=>row.id===working.archive_upload);
    target.innerHTML='<p>Export the selected recipe with every saved revision, its original and projected files, and linked prepared uses and native results. Receive a complete archive into this Workspace while preserving its producer history.</p><div class="cr-actions">'+action('export','Export complete selected recipe','data-cr-mutate')+'<label>Choose complete incoming recipe ZIP<input class="cr-file" type="file" accept=".zip,application/zip" data-cr-archive data-cr-mutate></label>'+action('receive','Receive selected archive','data-cr-mutate')+'</div>'+(selected?'<p>Selected original upload: <strong>'+esc(selected.filename)+'</strong> · '+selected.bytes.toLocaleString()+' bytes<br><code>'+esc(selected.sha256)+'</code></p>':'<p>No incoming archive is selected.</p>')+archiveUploads().filter(row=>row.id!==working.archive_upload).map(row=>'<div class="cr-row"><span>'+esc(row.filename)+' · '+row.bytes.toLocaleString()+' bytes</span>'+action('select-archive','Select retained archive','data-cr-id="'+row.id+'" data-cr-mutate')+'</div>').join('')+'<p class="cr-muted">Open the completed original export or receiving operation above for its full receipt and verified downloads. Whole-Workspace delivery also retains recipe history and source custody.</p>';
  }
  async function fileChange(event){
    const file=event.target.files?.[0];if(!file)return;
    if(event.target.matches('[data-cr-archive]')){
      await run(async(key,epoch)=>{
        const maximum=state?.limits?.upload_bytes;need(!maximum||file.size<=maximum,'This archive exceeds the original operator upload capacity.');
        const value=await host.api('/api/upload',{method:'POST',raw:file,filename:file.name});
        const receipt={id:value.id,filename:value.filename,bytes:value.bytes,sha256:value.sha256};
        validateWorking({...fresh(key),archive_upload:receipt.id,archive_uploads:[receipt]});
        const savedKey=storageKey(key)+':archive:'+receipt.id;lateArchiveUploads.set(savedKey,receipt);
        try{sessionStorage.setItem(savedKey,JSON.stringify(receipt));}catch{/* Keep the actual receipt in memory. */}
        if(!current(key,epoch))return;
        if(!working.archive_uploads.some(row=>row.id===receipt.id))working.archive_uploads.push(receipt);
        working.archive_upload=receipt.id;retain();notice='The complete archive upload is retained. Select Receive to run the original queued import.';renderPortable();messages();
      });event.target.value='';return;
    }
    if(event.target.matches('[data-cr-open-working]')){
      await run(async(key,epoch)=>{
        const raw=await file.text();if(!current(key,epoch))return;
        const incoming=validateWorking(JSON.parse(raw),workspace);
        need(!incoming.project_id||incoming.project_id===catalog?.project_id,'The working copy selects another project.');
        // Reopen the selected saved native record before replacing active choices.
        if(incoming.recipe_id){const value=await read('result',{recipe_id:incoming.recipe_id},key);if(!current(key,epoch))return;need(value.record.events.some(row=>row.revision===incoming.revision),'The original recipe revision is unavailable here.');}
        if(incoming.inspection_id){const value=await post('/api/client-source/result',{id:incoming.inspection_id},key);if(!current(key,epoch))return;need(value.project_id===catalog.project_id&&value.state==='complete'&&value.action==='client-source.inspect','The original new-source inspection is unavailable here.');}
        if(!globalThis.confirm('Open this complete recipe working copy? The current choices and original requests will remain in its retained history.'))return;
        working=preserve(incoming,working,'Opened '+file.name);record=null;plan=null;use=null;operation=null;retain();
        if(working.recipe_id)await openRecipe(working.recipe_id,working.revision,{reset:false});
        if(working.use_id)await openUse(working.use_id);
        notice='The original working copy and earlier active selection are retained. Complete native recipe and use records remain authoritative.';render();
      });
      event.target.value='';
    }
  }
  function mount(target,currentState=host.getState()){
    const key=host.getWorkspace();if(root===target&&workspace===key){update(currentState);return;}
    suspend();root=target;workspace=key;state=currentState;generation++;load();catalog=null;intakes=null;record=null;plan=null;inspection=null;use=null;operation=null;busy=false;notice='';problem='';
    root.innerHTML='<main class="cr-desk"><header><p class="eyebrow">SCIENTIFIC WORKBENCH</p><h1>Source recipes</h1><p>Reuse a reviewed collection of original files, sheets, layers and bands. Bind the actual new sources and review their scientific meaning before saving through the original source writer.</p></header>'+
      '<p class="cr-error" role="alert" data-cr-error></p><p class="cr-notice" role="status" aria-live="polite" data-cr-notice></p><p class="cr-warning" role="status" data-cr-storage></p>'+
      '<div class="cr-actions">'+action('refresh','Refresh native records','data-cr-mutate')+action('download','Download complete working copy')+'<label>Open working copy<input class="cr-file" type="file" accept=".json,application/json" data-cr-open-working data-cr-mutate></label><span data-cr-invalid hidden>'+action('invalid','Download exact previous browser copy')+'</span></div>'+
      '<section><h2>1. Capture a reviewed source edition</h2><p>Choose a completed original scientific source commit. Its complete inspection, selections and source collection stay with every recipe revision.</p><div data-cr-capture></div></section>'+
      '<section><h2>2. Select a recipe and the new inspection</h2><div data-cr-select></div><div data-cr-record></div></section>'+
      '<section class="cr-active-form"><h2>3. Bind and review every source part</h2><div data-cr-plan></div></section>'+
      '<section><h2>4. Commit the saved use</h2><div data-cr-use></div></section>'+
      '<section><h2>Retained uses and original operations</h2><div data-cr-uses></div><h3>Requests saved before submission</h3><div data-cr-requests></div><div data-cr-native-tasks></div><div data-cr-operation></div></section>'+
      '<section><h2>Complete portable recipes</h2><div data-cr-portable><p>Use the maintained whole-Workspace delivery to preserve native source records, recipe editions and originals together. Standalone recipe export and receive use the same original task queue.</p></div></section></main>';
    controller=new AbortController();
    root.addEventListener('click',event=>{void click(event).catch(error=>{problem=error.message;messages();});},{signal:controller.signal});
    root.addEventListener('change',event=>{void (event.target.type==='file'?fileChange(event):change(event)).catch(error=>{problem=error.message;messages();});},{signal:controller.signal});
    root.addEventListener('input',event=>{if(event.target.matches('input:not([type=checkbox]):not([type=file]),textarea'))void change(event).catch(error=>{problem=error.message;messages();});},{signal:controller.signal});
    render();void run(async(expected,epoch)=>{await refresh(expected,epoch);if(!current(expected,epoch))return;if(working.recipe_id)await openRecipe(working.recipe_id,working.revision,{reset:false});if(working.use_id)await openUse(working.use_id);renderNativeTasks();});
  }
  function renderNativeTasks(){
    const target=q('[data-cr-native-tasks]');if(!target)return;
    const rows=arr(state?.tasks).filter(row=>row.action?.startsWith('client-source-recipe.')||row.action==='client-source.commit'&&working.requests.some(request=>request.task_id===row.id));
    target.innerHTML=rows.length?'<h3>Native queue</h3>'+rows.map(row=>'<div class="cr-row"><span>'+esc(row.action)+' · '+esc(row.state)+'<br><code>'+esc(row.id)+'</code></span>'+action('task','Original progress','data-cr-id="'+row.id+'"')+action('open-task','Open retained result','data-cr-id="'+row.id+'" data-cr-mutate')+'</div>').join(''):'';
  }
  function update(currentState=host.getState()){if(!root||workspace!==host.getWorkspace())return;state=currentState;renderNativeTasks();messages();}
  function suspend(){controller?.abort();controller=null;root=null;generation++;busy=false;}
  return {mount,update,suspend};
}
