/** In-workbench coefficient citation/range authoring. Copyright TokenJunkieLabs. */
import * as core from './biophysical_authoring_core.mjs';
const copy=x=>JSON.parse(JSON.stringify(x));
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=x=>String(x||'').slice(0,12);
const button=(action,label,attrs='')=>'<button type="button" data-ba-action="'+esc(action)+'" '+attrs+'>'+esc(label)+'</button>';
const field=(key,label,value,{area=false,attrs=''}={})=>'<label class="pw-field"><span>'+esc(label)+'</span>'+(area?'<textarea rows="3" data-ba-field="'+esc(key)+'" '+attrs+'>'+esc(value)+'</textarea>':'<input type="text" data-ba-field="'+esc(key)+'" value="'+esc(value)+'" '+attrs+'>')+'</label>';
const LABELS={source_title:'Source title',source_uri:'Source URI or citation identifier',source_locator:'Page, table, row or other locator',source_period:'Source period',lower:'Sourced lower endpoint',upper:'Sourced upper endpoint',range_basis:'Basis for the range',notes:'Cell notes'};
const recoverySchema='upstate.biophysical-evidence-browser/v1';
const uuid=()=>{if(!globalThis.crypto?.randomUUID)throw Error('This browser cannot create an operation identifier.');return globalThis.crypto.randomUUID();};
export function createBiophysicalAuthoring(host,{service,onEvidence=async()=>{},getEvidence=()=>null}={}){
  if(!service||typeof service.read!=='function'||typeof service.write!=='function')throw Error('Open authoring through the original profile workbench.');
  let root=null,events=null,workspace=null,catalog=null,bindingKey='',storageKey='',state=null,recovery=null,recoveryRaw=null;
  let busy=false,message='',error=false,intent=0,generation=0,processing=false,saved=[],savedSelection='',editKey='',filePreview=null,fileToken=0,open=false,history=[];
  const $=q=>root?.querySelector(q);
  const scope=()=>({workspace,bindingKey,generation});
  const alive=s=>Boolean(root?.isConnected&&s.workspace===workspace&&s.bindingKey===bindingKey&&s.generation===generation&&host.getState()?.workspace_key===workspace);
  const tasks=()=>host.getState()?.tasks||[];
  const taskFor=r=>tasks().find(t=>t.id===r.task_id)||r.task||null;
  const terminal=t=>['complete','failed','interrupted','cancelled'].includes(t?.state);
  function notify(text='',bad=false){message=String(text);error=bad;const n=$('[data-ba-message]');if(n){n.textContent=message;n.hidden=!message;n.classList.toggle('pw-error',bad);}}
  function assertActive(s=scope()){if(!alive(s))throw Error('The original project or profile changed. Reopen its evidence editor.');}
  function validateState(value){
    if(value?.schema!==recoverySchema||!Array.isArray(value.requests))throw Error('The saved browser copy has an unsupported format.');
    core.inspectDraft(value.draft,catalog);
    if(typeof value.series_id!=='string'||!value.series_id||value.parent_id!==null&&typeof value.parent_id!=='string')throw Error('The saved revision identity is invalid.');
    for(const r of value.requests)if(!r||typeof r.operation_id!=='string'||!['save','register'].includes(r.kind)||!r.payload||typeof r.payload!=='object')throw Error('A retained native request is invalid.');
    return value;
  }
  function persist({required=false}={}){
    if(!state||recovery||!storageKey)return false;
    try{const raw=JSON.stringify(state);localStorage.setItem(storageKey,raw);if(localStorage.getItem(storageKey)!==raw)throw Error('Readback differs');return true;}
    catch{notify('Browser recovery storage is unavailable. Download the complete working JSON to keep your edits.',true);if(required)throw Error('The native request could not be retained in browser recovery storage. Download your work and retry after restoring storage.');return false;}
  }
  function changed(next){
    core.inspectDraft(next,catalog);state.draft=next;intent++;filePreview=null;persist();renderSummary();renderPreview();
  }
  function download(name,body,type='application/json'){
    const url=URL.createObjectURL(new Blob([body],{type:type+';charset=utf-8'})),a=document.createElement('a');
    a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function stateFilename(){return 'coefficient-evidence-'+short(catalog.profile.id)+'-working.json';}
  function recoveryHTML(){
    if(!recovery)return '';
    return '<section class="pw-original-source"><h3>Previous working copy</h3><p>'+esc(recovery.valid?'This profile has an existing browser working copy. Choose it before entering new evidence.':'The browser contains an unreadable or differently bound working copy. Keep its original file before starting a replacement.')+'</p><div class="pw-actions">'+(recovery.valid?button('recover','Recover previous work'):'')+button('download-recovery','Download previous copy')+button('keep-current','Start from the displayed original table')+'</div></section>';
  }
  function requestsHTML(){
    if(!state?.requests.length)return '';
    return '<details class="pw-original-source"><summary>Saved operations</summary>'+state.requests.slice().reverse().map(r=>{
      const t=taskFor(r),status=t?.state||'request retained';
      return '<div class="pw-inline-form"><p><strong>'+esc(r.kind==='save'?'Save working revision':'Register evidence')+'</strong> · '+esc(status)+(t?.error?.message?'<br>'+esc(t.error.message):'')+'</p><div class="pw-actions">'+(t?.id?button('task','Open operation','data-ba-id="'+esc(t.id)+'"'):'')+(!r.task_id?button('retry','Retry the same request','data-ba-id="'+esc(r.operation_id)+'"'):['failed','interrupted'].includes(status)?button('resume','Resume operation','data-ba-id="'+esc(t.id)+'"'):'')+'</div></div>';
    }).join('')+'</details>';
  }
  function renderSummary(){
    const node=$('[data-ba-summary]');if(!node||!state)return;
    const c=core.inspectRows(state.draft);
    node.innerHTML='<p><strong>'+c.documented+'</strong> documented · <strong>'+c.unknown+'</strong> unknown · <strong>'+c.unfinished+'</strong> unfinished · <strong>'+c.ranged+'</strong> with ranges. '+c.total+' original coefficient cells.</p>'+(Object.values(state.draft.view.batch).some(v=>v.trim())?'<p class="pw-note">The citation form has unapplied entries. They are retained in working JSON and native revisions.</p>':'')+'<p class="pw-note">Lower and upper describe coefficient values. The original native model determines the resulting load response.</p>';
  }
  function renderRows(){
    const node=$('[data-ba-rows]');if(!node||!state)return;
    const d=state.draft,view=core.visibleRows(d),selected=new Set(d.view.selected);
    node.innerHTML='<div class="pw-table-scroll"><table class="pw-table"><thead><tr><th>Select citation</th><th>Land cover / coefficient</th><th>Original value</th><th>Evidence</th><th>Source / range</th><th>Edit</th></tr></thead><tbody>'+view.rows.map(item=>{const r=item.row;return '<tr><td><input type="checkbox" data-ba-select="'+esc(item.key)+'" aria-label="Select '+esc(item.key)+'"'+(selected.has(item.key)?' checked':'')+'></td><td>'+esc(r.lucode)+' / '+esc(r.parameter)+'</td><td>'+esc(r.value)+'<small>'+esc(r.units)+(r.load_type?' · '+esc(r.load_type):'')+'</small></td><td>'+esc(item.status)+(item.errors.length?'<small>'+esc(item.errors.map(e=>e.message).join(' '))+'</small>':'')+'</td><td>'+esc(r.source_title||'Unknown')+(r.lower||r.upper?'<small>'+esc(r.lower)+' / '+esc(r.upper)+'</small>':'')+'</td><td>'+button('edit','Edit cell','data-ba-key="'+esc(item.key)+'"')+'</td></tr>';}).join('')+'</tbody></table></div><div class="pw-inline-form"><span>Page '+(view.page+1)+' of '+view.pages+' · '+view.total+' matching cells · '+d.view.selected.length+' selected</span><div class="pw-actions">'+button('previous','Previous',view.page===0?'disabled':'')+button('next','Next',view.page+1>=view.pages?'disabled':'')+button('select-page','Select this page')+button('clear-selection','Clear selected cells',d.view.selected.length?'':'disabled')+'</div></div>';
  }
  function renderEditor(){
    const node=$('[data-ba-editor]');if(!node||!state)return;
    const row=state.draft.rows.find(r=>core.cellKey(r)===editKey);
    if(!row){node.innerHTML='';return;}
    const check=core.inspectRow(row);
    node.innerHTML='<section class="pw-original-source"><header class="pw-panel-heading"><div><h4>'+esc(row.lucode+' / '+row.parameter)+'</h4><p>Original '+esc(row.value)+' '+esc(row.units)+(row.load_type?' · '+esc(row.load_type):'')+'</p></div>'+button('close-cell','Close cell')+'</header><p data-ba-cell-errors class="'+(check.errors.length?'pw-error':'pw-note')+'">'+esc(check.errors.map(e=>e.message).join(' ')||'All working entries are retained as you type.')+'</p><div class="pw-form-grid">'+core.EDITABLE.map(k=>'<div class="'+(['source_uri','notes','range_basis'].includes(k)?'pw-full':'')+'">'+field(k,LABELS[k],row[k],{area:['notes','range_basis'].includes(k),attrs:'data-ba-cell="'+esc(editKey)+'"'})+'</div>').join('')+'</div><div class="pw-actions">'+button('clear-cell','Clear this cell’s attribution and range')+'</div></section>';
  }
  function renderPreview(){
    const node=$('[data-ba-file-preview]');if(!node)return;
    if(!filePreview){node.innerHTML='';return;}
    const p=filePreview;
    node.innerHTML='<section class="pw-original-source"><h4>Inspect selected '+esc(p.kind==='json'?'working JSON':'evidence CSV')+'</h4><p>'+esc(p.kind==='json'?p.draft.title+' — '+p.draft.rows.length+' original cells':p.preview.changedRows+' changed cells; '+p.preview.untouchedRows+' other cells stay as they are.')+'</p>'+(p.kind==='csv'?'<div class="pw-table-scroll"><table class="pw-table"><thead><tr><th>Cell</th><th>Previous source</th><th>Incoming source</th><th>Incoming range</th></tr></thead><tbody>'+p.preview.changes.map(c=>'<tr><td>'+esc(c.key)+'</td><td>'+esc(c.before.source_title||'Unknown')+'</td><td>'+esc(c.after.source_title||'Unknown')+'</td><td>'+esc(c.after.lower)+' / '+esc(c.after.upper)+'</td></tr>').join('')+'</tbody></table></div>':'<p>Applying this file replaces the displayed working copy. Download the current work first if you want to keep both.</p>')+'<div class="pw-actions">'+button('apply-file',p.kind==='json'?'Open this complete working copy':'Apply these exact CSV rows')+button('close-file','Keep current work')+'</div></section>';
  }
  function revisionChoices(){
    const ids=new Set(saved.map(r=>r.id));return [...saved,...history.filter(r=>!ids.has(r.id)).map(r=>({...r,earlier:true}))];
  }
  function render(){
    if(!root?.isConnected||!state)return;
    const d=state.draft,disabled=busy||Boolean(recovery);
    root.innerHTML='<details class="pw-original-source" data-ba-panel'+(open?' open':'')+'><summary>Author cell citations and sourced ranges</summary><p>Work directly beside the exact original coefficient table. Unfinished entries are retained in working JSON and saved revisions; completed evidence enters the original source workflow.</p><p data-ba-message class="pw-message" role="status" aria-live="polite" hidden></p>'+recoveryHTML()+'<fieldset data-ba-body'+(disabled?' disabled':'')+' style="border:0;padding:0;margin:0;min-width:0"><div class="pw-form-grid"><div class="pw-full">'+field('title','Working revision title',d.title)+'</div><div class="pw-full">'+field('note','Working notes',d.note,{area:true})+'</div></div><p class="mono">Original profile '+esc(catalog.profile.id)+'<br>Original table '+esc(catalog.table.sha256)+'</p><div data-ba-summary></div><div class="pw-actions">'+button('save','Save working revision')+button('download-json','Download complete working JSON')+button('download-csv','Download completed evidence CSV')+button('register','Register and save completed evidence')+'</div><p class="pw-note">Registering retains a new ordinary source CSV and saves its evidence through the original native validator. It keeps previous evidence and the original model profile.</p><div class="pw-two-columns"><section><h4>Open a saved revision</h4><label class="pw-field"><span>Native working revisions</span><select data-ba-field="saved"><option value="">Choose a saved revision</option>'+revisionChoices().map(r=>'<option value="'+esc(r.id)+'"'+(r.id===savedSelection?' selected':'')+'>'+esc(r.title||r.draft?.title||short(r.id))+' · '+(r.earlier?'earlier ':'')+'revision '+esc(r.revision)+' · '+esc(short(r.id))+'</option>').join('')+'</select></label><div class="pw-actions">'+button('open-saved','Open selected revision',savedSelection?'':'disabled')+button('refresh','Refresh saved revisions')+button('export-package','Download saved revision and history',state.parent_id?'':'disabled')+button('fork','Fork complete saved history',state.parent_id?'':'disabled')+button('copy-evidence','Start from displayed saved evidence',getEvidence()?'':'disabled')+button('new','Start a new working copy')+'</div></section><section><h4>Import a complete file</h4><label class="pw-field"><span>Working JSON or original evidence CSV</span><input type="file" data-ba-file accept=".json,.csv,application/json,text/csv"></label><p class="pw-note">Inspect the selected file before applying it. CSV imports update only the exact cells included in that file.</p></section></div><div data-ba-file-preview></div><div class="pw-inline-form"><label class="pw-field"><span>Find coefficient, citation or note</span><input type="search" data-ba-field="search" value="'+esc(d.view.search)+'"></label><label class="pw-field"><span>Show cells</span><select data-ba-field="filter">'+core.FILTERS.map(f=>'<option value="'+f+'"'+(d.view.filter===f?' selected':'')+'>'+esc(f)+'</option>').join('')+'</select></label></div><div data-ba-rows></div><div data-ba-editor></div><details class="pw-original-source"><summary>Apply a citation to selected cells</summary><p>Replace the five citation fields on the explicitly selected cells. Each cell keeps its own original value and range.</p><div class="pw-form-grid">'+['source_title','source_uri','source_locator','source_period','notes'].map(k=>field('batch-'+k,LABELS[k],d.view.batch[k]||'',{area:k==='notes'})).join('')+'</div>'+button('batch','Replace citation on selected cells',d.view.selected.length?'':'disabled')+button('clear-batch','Clear the unapplied citation form')+'</details></fieldset><div data-ba-operations>'+requestsHTML()+'</div></details>';
    notify(message,error);renderSummary();renderRows();renderEditor();renderPreview();
  }
  function refreshSavedControls(){
    for(const name of ['export-package','fork']){
      const node=$('[data-ba-action="'+name+'"]');if(node)node.disabled=busy||Boolean(recovery)||!state?.parent_id;
    }
    const select=$('[data-ba-field="saved"]');
    if(select)select.innerHTML='<option value="">Choose a saved revision</option>'+revisionChoices().map(r=>'<option value="'+esc(r.id)+'"'+(r.id===savedSelection?' selected':'')+'>'+esc(r.title||short(r.id))+' · '+(r.earlier?'earlier ':'')+'revision '+esc(r.revision)+' · '+esc(short(r.id))+'</option>').join('');
  }
  async function read(operation,payload={},s=scope()){assertActive(s);const r=await service.read(operation,{workspace:s.workspace,...payload});assertActive(s);return r;}
  async function refresh(){
    const s=scope(),result=await read('list',{profile_id:catalog.profile.id},s);
    saved=(result.series||[]).map(r=>({...r,id:r.head_id}));
    render();return result;
  }
  function retain(r,patch={}){
    let original=state.requests.find(x=>x.operation_id===r.operation_id);
    if(!original){original=copy(r);state.requests.push(original);}
    Object.assign(original,copy(patch));persist();return original;
  }
  async function issue(r,s=scope()){
    assertActive(s);
    retain(r);persist({required:true});
    const envelope={workspace:s.workspace,action:'profile.biophysical.authoring.'+r.kind,payload:r.payload,operation_id:r.operation_id};
    const body=JSON.stringify(envelope);
    if(new TextEncoder().encode(body).byteLength>4*1024*1024)throw Error('The complete native request exceeds the operator’s 4 MiB JSON limit. Your working JSON and original history remain available to download.');
    const task=await service.write(r.kind,r.payload,r.operation_id,s.workspace);
    if(!task?.id)throw Error('The native operation did not return an identity. Retry the retained request.');
    if(!alive(s))return task;
    retain(r,{task_id:task.id,task:copy(task)});
    await host.refreshState?.({force:true});
    if(alive(s)){await complete();render();}
    return task;
  }
  async function queue(kind){
    assertActive();core.inspectDraft(state.draft,catalog);
    if(filePreview)throw Error('Apply or close the inspected file before saving the displayed work.');
    if(kind==='register')core.toCSV(state.draft,catalog);
    const follow=kind==='register'?{title:state.draft.title,note:state.draft.note}:null;
    if(kind==='register'&&state.parent_id&&state.saved_signature===canonical(state.draft)){
      return registerRevision(state.parent_id,follow);
    }
    const payload={series_id:state.series_id,parent_id:state.parent_id,draft:copy(state.draft),...(state.imported_package?{imported_package:copy(state.imported_package)}:{})};
    const signature=canonical({kind:'save',payload}),existing=state.requests.find(r=>r.signature===signature);
    const request=existing||{operation_id:uuid(),kind:'save',payload,signature,working_signature:canonical(state.draft),created_at:new Date().toISOString(),handled:false};
    if(!existing)request.payload.request_id=request.operation_id;
    if(follow){
      if(existing?.handled&&existing.result?.record?.id)return registerRevision(existing.result.record.id,follow);
      request.follow_register=follow;
    }
    retain(request);return issue(request);
  }
  async function registerRevision(revision_id,selection,s=scope()){
    assertActive(s);
    const payload={revision_id,title:selection.title,note:selection.note},signature=canonical({kind:'register',payload});
    const existing=state.requests.find(r=>r.signature===signature);
    const request=existing||{operation_id:uuid(),kind:'register',payload,signature,created_at:new Date().toISOString(),handled:false};
    if(!existing)request.payload.request_id=request.operation_id;
    retain(request);return issue(request,s);
  }
  async function complete(){
    if(processing||!state||recovery||!root?.isConnected)return;
    const s=scope();processing=true;
    try{
      for(const r of state.requests){
        if(r.handled)continue;
        const task=taskFor(r);if(!task)continue;
        retain(r,{task:copy(task)});
        if(task.state!=='complete')continue;
        const result=task.result;
        if(!result)throw Error('The completed operation did not return its saved revision.');
        if(r.kind==='save'){
          const record=result.record;
          if(!record?.id||!record.draft)throw Error('The completed operation did not return its original working revision.');
          core.inspectDraft(record.draft,catalog);
          if(record.series_id===state.series_id&&state.parent_id===r.payload.parent_id){
            state.parent_id=record.id;state.saved_signature=canonical(record.draft);state.imported_package=null;
            history=result.history||[];
            saved=saved.filter(item=>item.series_id!==record.series_id);
            saved.unshift({id:record.id,series_id:record.series_id,title:record.draft.title,revision:record.revision});
            savedSelection=record.id;refreshSavedControls();
          }
        }
        if(r.kind==='save'&&r.follow_register){
          await registerRevision(result.record.id,r.follow_register,s);if(!alive(s))return;
        }
        retain(r,{handled:true,result:copy(result)});
        if(r.kind==='register'&&result.evidence?.id){await onEvidence(result.evidence.id);if(!alive(s))return;}
        notify(r.kind==='save'?'The complete working revision is saved.':'The original evidence source is registered and saved.');

      }
    }finally{if(alive(s))processing=false;}
  }
  async function loadSaved(){
    const id=savedSelection;if(!id)throw Error('Choose a saved working revision.');
    const s=scope(),before=intent,token=++fileToken,record=await read('inspect',{revision_id:id},s);
    if(!alive(s)||before!==intent||token!==fileToken||savedSelection!==id)throw Error('The working copy changed while loading. Open the selected revision again.');
    const item=record.record,draft=item?.draft;core.inspectDraft(draft,catalog);
    filePreview={kind:'json',draft:copy(draft),parent_id:item.id,series_id:item.series_id,history:record.history||[],anchor:canonical(state.draft)};renderPreview();
  }
  async function loadFile(file){
    const s=scope(),before=intent,token=++fileToken;
    if(!file)return;const raw=await file.text();
    if(!alive(s)||before!==intent||token!==fileToken)throw Error('The working copy changed while reading the file. Select the file again.');
    if(/\.json$/i.test(file.name)||/^\s*\{/.test(raw)){
      const item=JSON.parse(raw),pack=item.schema==='upstate.biophysical-evidence-authoring-package/v1'?item:null;
      const draft=pack?pack.records?.find(r=>r.id===pack.revision_id)?.draft:item;
      core.inspectDraft(draft,catalog);
      filePreview={kind:'json',draft,parent_id:null,series_id:uuid(),imported_package:pack,anchor:canonical(state.draft)};
    }
    else filePreview={kind:'csv',preview:core.previewCSV(state.draft,raw,catalog),anchor:canonical(state.draft)};
    renderPreview();notify('The whole file is inspected. Apply it when its shown changes are correct.');
  }
  async function action(name,target){
    if(name==='download-recovery'){download('previous-coefficient-evidence-browser-copy.json',recoveryRaw);recovery.downloaded=true;return;}
    if(name==='recover'){
      if(!recovery?.valid)throw Error('Download the previous copy before replacing it.');
      state=validateState(copy(recovery.value));recovery=null;recoveryRaw=null;intent++;render();notify('The previous working copy is restored.');return;
    }
    if(name==='keep-current'){
      if(!recovery)return;
      try{const backup=storageKey+':recovered:'+uuid();localStorage.setItem(backup,recoveryRaw);if(localStorage.getItem(backup)!==recoveryRaw)throw Error('Backup readback differs');}
      catch{if(!recovery.downloaded)throw Error('Download the previous copy first; browser storage could not preserve it.');}
      recovery=null;recoveryRaw=null;persist();render();return;
    }
    if(recovery)throw Error('Choose the existing working copy first.');
    if(name==='download-json'){download(stateFilename(),JSON.stringify(state.draft,null,2)+'\n');notify('The complete working JSON includes unfinished entries and selected cells.');return;}
    if(name==='download-csv'){download('coefficient-evidence-'+short(catalog.profile.id)+'.csv',core.toCSV(state.draft,catalog),'text/csv');return;}
    if(name==='save'||name==='register')return queue(name);
    if(name==='refresh'){await refresh();await complete();return;}
    if(name==='open-saved')return loadSaved();
    if(name==='export-package'||name==='fork'){
      if(!state.parent_id)throw Error('Save this working copy to retain its complete native history.');
      const s=scope(),before=intent,id=state.parent_id,pack=await read('export',{revision_id:id},s);
      if(name==='export-package'){download('coefficient-evidence-'+short(catalog.profile.id)+'-history.json',JSON.stringify(pack.package,null,2)+'\n');return;}
      if(!alive(s)||before!==intent||id!==state.parent_id)throw Error('The working copy changed while its history was loading. Fork again.');
      filePreview={kind:'json',draft:copy(state.draft),parent_id:null,series_id:uuid(),imported_package:pack.package,anchor:canonical(state.draft)};renderPreview();return;
    }
    if(name==='new'||name==='copy-evidence'){
      const evidence=name==='copy-evidence'?getEvidence():null;
      if(name==='copy-evidence'&&!evidence)throw Error('Open saved evidence in the original panel first.');
      const draft=core.createDraft(catalog,{evidence});filePreview={kind:'json',draft,parent_id:null,series_id:uuid(),anchor:canonical(state.draft)};renderPreview();return;
    }
    if(name==='apply-file'){
      const p=filePreview;if(!p||p.anchor!==canonical(state.draft))throw Error('The working copy changed. Inspect the file again.');
      const next=p.kind==='json'?copy(p.draft):core.mergeCSV(state.draft,p.preview,catalog);
      if(p.kind==='json'){state.parent_id=p.parent_id;state.series_id=p.series_id||uuid();state.imported_package=p.imported_package||null;state.saved_signature=p.parent_id?canonical(next):null;history=p.history||[];}
      changed(next);editKey='';render();return;
    }
    if(name==='close-file'){filePreview=null;fileToken++;renderPreview();return;}
    if(name==='edit'){editKey=target.dataset.baKey;renderEditor();return;}
    if(name==='close-cell'){editKey='';renderEditor();return;}
    if(name==='clear-cell'){
      changed(core.updateRows(state.draft,[editKey],Object.fromEntries(core.EDITABLE.map(k=>[k,''])),catalog));render();return;
    }
    if(name==='previous'||name==='next'){
      const v=core.visibleRows(state.draft);changed(core.updateDraft(state.draft,{view:{...state.draft.view,page:Math.max(0,Math.min(v.pages-1,v.page+(name==='next'?1:-1)))}},catalog));renderRows();return;
    }
    if(name==='select-page'||name==='clear-selection'){
      const selected=name==='clear-selection'?[]:[...new Set([...state.draft.view.selected,...core.visibleRows(state.draft).rows.map(r=>r.key)])];
      changed(core.updateDraft(state.draft,{view:{...state.draft.view,selected}},catalog));render();return;
    }
    if(name==='batch'){
      const patch=Object.fromEntries(['source_title','source_uri','source_locator','source_period','notes'].map(k=>[k,state.draft.view.batch[k]]));
      const next=core.updateRows(state.draft,state.draft.view.selected,patch,catalog);
      changed(core.updateDraft(next,{view:{...next.view,batch:Object.fromEntries(Object.keys(next.view.batch).map(k=>[k,'']))}},catalog));render();return;
    }
    if(name==='clear-batch'){changed(core.updateDraft(state.draft,{view:{...state.draft.view,batch:Object.fromEntries(Object.keys(state.draft.view.batch).map(k=>[k,'']))}},catalog));render();return;}
    if(name==='task')return host.showTask?.(target.dataset.baId);
    if(name==='retry'){
      const r=state.requests.find(r=>r.operation_id===target.dataset.baId);if(!r)throw Error('The retained operation is unavailable.');return issue(r);
    }
    if(name==='resume'){
      const s=scope();await host.api('/api/task/resume',{method:'POST',body:{id:target.dataset.baId}});
      await host.refreshState?.({force:true});if(alive(s))await complete();return;
    }
  }
  async function clicked(event){
    const target=event.target.closest('[data-ba-action]');if(!target||!root?.contains(target))return;
    event.preventDefault();event.stopPropagation();if(busy)return;
    const s=scope();busy=true;const fieldset=$('[data-ba-body]');if(fieldset)fieldset.disabled=true;target.disabled=true;
    try{notify();await action(target.dataset.baAction,target);}
    catch(e){if(alive(s))notify(e.message||e,true);}
    finally{if(alive(s)){busy=false;render();}}
  }
  async function input(event){
    const node=event.target;if(!root?.contains(node)||busy||recovery)return;
    const s=scope(),key=node.dataset.baField;
    try{
      if(node.matches?.('[data-ba-file]')){await loadFile(node.files?.[0]);return;}
      if(node.dataset.baSelect){
        const selected=node.checked?[...new Set([...state.draft.view.selected,node.dataset.baSelect])]:state.draft.view.selected.filter(k=>k!==node.dataset.baSelect);
        changed(core.updateDraft(state.draft,{view:{...state.draft.view,selected}},catalog));render();return;
      }
      if(!key)return;
      if(key==='saved'){savedSelection=node.value;fileToken++;render();return;}
      if(key.startsWith('batch-')){changed(core.updateDraft(state.draft,{view:{...state.draft.view,batch:{...state.draft.view.batch,[key.slice(6)]:node.value}}},catalog));return;}
      if(node.dataset.baCell){
        changed(core.updateRows(state.draft,[node.dataset.baCell],{[key]:node.value},catalog));
        const row=state.draft.rows.find(r=>core.cellKey(r)===node.dataset.baCell),errors=core.inspectRow(row).errors,n=$('[data-ba-cell-errors]');
        if(n){n.textContent=errors.map(e=>e.message).join(' ')||'All working entries are retained as you type.';n.classList.toggle('pw-error',Boolean(errors.length));}
        renderRows();return;
      }
      if(key==='title'||key==='note'){changed(core.updateDraft(state.draft,{[key]:node.value},catalog));return;}
      if(key==='search'||key==='filter'){changed(core.updateDraft(state.draft,{view:{...state.draft.view,[key]:node.value,page:0}},catalog));renderRows();}
    }catch(e){if(alive(s))notify(e.message||e,true);}
  }
  async function mount(node,selection){
    const nextCatalog=selection.catalog;if(!nextCatalog)return;
    const fresh=core.createDraft(nextCatalog),nextKey=canonical(fresh.binding),same=selection.workspace_key===workspace&&nextKey===bindingKey;
    events?.abort();events=null;root=node;
    if(!same){
      persist();workspace=selection.workspace_key;catalog=nextCatalog;bindingKey=nextKey;generation++;intent++;fileToken++;
      storageKey='upstate-biophysical-authoring-v1:'+workspace+':'+catalog.profile.id+':'+catalog.table.sha256;
      state={schema:recoverySchema,draft:fresh,series_id:uuid(),parent_id:null,saved_signature:null,imported_package:null,requests:[]};
      recovery=null;recoveryRaw=null;filePreview=null;editKey='';saved=[];history=[];savedSelection='';message='';error=false;busy=false;processing=false;open=false;
      try{
        const raw=localStorage.getItem(storageKey);
        if(raw){recoveryRaw=raw;let value=null,valid=false;try{value=validateState(JSON.parse(raw));valid=true;}catch{}recovery={value,valid,downloaded:false};}
      }catch{notify('Browser recovery storage is unavailable. Keep complete working JSON downloads.',true);}
    }else catalog=nextCatalog;
    events=new AbortController();root.addEventListener('click',clicked,{signal:events.signal});
    root.addEventListener('input',event=>{if(event.target.type!=='checkbox'&&event.target.tagName!=='SELECT'&&event.target.type!=='file')input(event);},{signal:events.signal});
    root.addEventListener('change',event=>{if(event.target.type==='checkbox'||event.target.tagName==='SELECT'||event.target.type==='file')input(event);},{signal:events.signal});
    root.addEventListener('toggle',event=>{if(event.target.matches?.('[data-ba-panel]'))open=event.target.open;},{signal:events.signal,capture:true});
    render();
    if(!same){const s=scope();try{await refresh();if(alive(s))await complete();}catch(e){if(alive(s))notify(e.message||e,true);}}
  }
  function update(){const s=scope();if(!root)return;if(host.getState()?.workspace_key!==workspace){detach();return;}complete().then(()=>{if(alive(s)){const n=$('[data-ba-operations]');if(n)n.innerHTML=requestsHTML();refreshSavedControls();}}).catch(e=>{if(alive(s))notify(e.message||e,true);});}
  function detach(){persist();events?.abort();events=null;root=null;workspace=null;bindingKey='';generation++;intent++;fileToken++;busy=false;processing=false;}
  return {mount,update,detach};
}
