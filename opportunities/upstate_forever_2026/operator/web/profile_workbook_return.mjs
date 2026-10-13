/** Return exact saved native values to explicitly selected cells of an original workbook. */
import {clone,canonical,sourceKey,baseSelection,createProfileWorkbookReturnStorage,workingCopyEnvelope,validateWorkingCopy} from './profile_workbook_return_storage.mjs';
const text=v=>String(v??''),list=v=>Array.isArray(v)?v:[],object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const esc=v=>text(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty=v=>JSON.stringify(v,null,2),short=v=>text(v).slice(0,12),date=v=>v?new Date(v).toLocaleString():'Not yet saved';
const button=(action,label,attrs='')=>'<button type="button" data-pwr-action="'+esc(action)+'" '+attrs+'>'+esc(label)+'</button>';
const option=(id,label,current)=>'<option value="'+esc(id)+'"'+(id===current?' selected':'')+'>'+esc(label)+'</option>';
const input=(field,label,value,attrs='')=>'<label class="pw-field"><span>'+esc(label)+'</span><input data-pwr-field="'+esc(field)+'" value="'+esc(value)+'" '+attrs+'></label>';
const area=(field,label,value)=>'<label class="pw-field"><span>'+esc(label)+'</span><textarea data-pwr-field="'+esc(field)+'" rows="3">'+esc(value)+'</textarea></label>';
const ACTION='profile.workbook_return.create',ENDPOINT='/api/profile-workbench/workbook-return/';
function download(body,name,type='application/json'){const url=URL.createObjectURL(new Blob([body],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
export function bindWorkbookReturn(draft,record,projectId){
  if(!record||record.id!==draft.record?.id||record.project_id!==projectId||
    canonical(baseSelection(record.preview?.selection))!==canonical(draft.selection))
    throw Error('The saved workbook return differs from this complete profile, original workbook or cell mapping.');
  return record;
}
export function createProfileWorkbookReturn(host){
  const storage=createProfileWorkbookReturnStorage();
  const copies=new Map(),dirty=new Map(),revisions=new Map(),errors=new Map(),tails=new Map();
  let node=null,events=null,workspace=null,profileId=null,profileTitle='',project=null,scope=null,generation=0,busy=false;
  let current=null,catalog=null,profile=null,book=null,preview=null,record=null,sourceFilter='',sourceOffset=0,cellSheet='',cellOffset=0,cellPage=null;
  let selectedSource='',message='',failure=false,polling=null,readFlight=0;
  const $=q=>node?.querySelector(q),$$=q=>node?[...node.querySelectorAll(q)]:[];
  const key=(id,sc=scope)=>sc+':'+id;
  const context=()=>({workspace,scope,profileId,generation,project:clone(project),draftId:current?.id});
  const alive=c=>!!node&&node.isConnected&&c.generation===generation&&c.workspace===workspace&&c.profileId===profileId&&host.getState()?.workspace_key===workspace;
  const sameDraft=c=>alive(c)&&current?.id===c.draftId;
  const assert=()=>{if(!node||!project?.id||host.getState()?.workspace_key!==workspace)throw Error('Reopen this saved profile in its original workspace.');};
  const signature=d=>canonical(d.selection);
  const read=(name,payload={},c=context())=>host.api(ENDPOINT+name,{method:'POST',body:{workspace:c.workspace,...payload}});
  const values=()=>list(profile?.source_values);
  const workbooks=()=>list(catalog?.workbooks);
  const workbookKey=w=>w?canonical({source_collection_id:w.source_collection_id,source_id:w.source_id,part:w.part,sha256:w.sha256}):'';
  const workbookName=w=>(w.filename||w.title||w.source_id)+' · '+short(w.source_collection_id)+' · member '+w.part;
  const nativeName=row=>row.label||(row.source.kind==='table'?'Land cover '+row.source.lucode+' · '+row.source.column:row.source.model.toUpperCase()+' · '+row.source.name);
  const selected=row=>list(current?.selection.mappings).find(x=>sourceKey(x.source)===sourceKey(row.source));
  const excluded=row=>list(current?.selection.exclusions).find(x=>sourceKey(x.source)===sourceKey(row.source));
  const localCopies=()=>[...copies.entries()].filter(([k])=>k.startsWith(scope+':')).map(([,v])=>v);
  const pending=d=>list(d?.operations).filter(op=>op.state!=='complete');
  function status(value='',bad=false){message=text(value);failure=bad;const el=$('[data-pwr-status]');if(el){el.textContent=message;el.hidden=!message;el.classList.toggle('pw-error',bad);}}
  function lock(){
    for(const el of $$('button,input,textarea,select'))el.disabled=busy||el.hasAttribute('data-pwr-disabled');
    if(current?.frozen)for(const el of $$('[data-pwr-editor] input,[data-pwr-editor] textarea,[data-pwr-editor] select,[data-pwr-editor] button'))el.disabled=true;
  }
  async function persist(draft=current,{strict=false,originScope=scope}={}){
    if(!draft)return null;const body=clone(draft),k=key(body.id,originScope);dirty.set(k,body);copies.set(k,body);
    const tail=(tails.get(k)||Promise.resolve()).catch(()=>{}).then(async()=>{
      if(errors.has(k))throw errors.get(k);
      try{const row=await storage.write(originScope,body.id,revisions.get(k)||0,body);revisions.set(k,row.revision);if(canonical(dirty.get(k))===canonical(body))dirty.delete(k);return row;}
      catch(error){errors.set(k,error);throw error;}
    });tails.set(k,tail);
    try{return await tail;}catch(error){if(scope===originScope&&current?.id===body.id)status(error.message,true);if(strict)throw error;return null;}
  }
  async function recall(sc){for(const row of await storage.list(sc)){const k=key(row.id,sc);if(dirty.has(k)||errors.has(k))continue;copies.set(k,row.body);revisions.set(k,row.revision);}}
  function fresh(selection=null,origin=null){return {id:crypto.randomUUID(),created_at:new Date().toISOString(),updated_at:new Date().toISOString(),
    selection:clone(selection||{profile_id:profileId,workbook:null,title:profileTitle+' · original workbook return',author:'',reason:'',mappings:[],exclusions:[]}),
    record:null,operations:[],frozen:false,origin};}
  function invalidate(){current.updated_at=new Date().toISOString();preview=null;void persist();const el=$('[data-pwr-preview]');if(el)el.innerHTML='';}
  async function choose(draft){
    const c=context();if(current)await persist(current,{originScope:c.scope});if(!alive(c))return false;
    current=clone(draft);preview=null;record=null;book=null;cellPage=null;selectedSource='';sourceOffset=0;
    await persist(current,{strict:true,originScope:c.scope});if(!alive(c)||current?.id!==draft.id)return false;
    if(current.selection.workbook)await readBook();if(alive(c)&&current?.id===draft.id)render();return true;
  }
  function fileLinks(value){
    return list(value?._downloads).filter(f=>/^\/api\/file\/[A-Za-z0-9/_-]+$/.test(f.url||'')).map(f=>'<a class="pw-download" href="'+esc(f.url)+'?download=1" download>'+esc(f.label||f.filename)+'</a>').join('');
  }
  function valueText(v){return v===null?'Blank / null':typeof v==='object'?pretty(v):text(v);}
  function originalHTML(value){
    return '<dl class="pw-metadata"><dt>Saved profile</dt><dd class="mono">'+esc(profileId)+'</dd><dt>Coefficient table</dt><dd class="mono">'+esc(profile?.table?.sha256||'')+'</dd>'+
    (value?'<dt>Original workbook</dt><dd>'+esc(value.filename||value.title||value.source_id)+'</dd><dt>Original SHA-256</dt><dd class="mono">'+esc(value.sha256||value.workbook?.sha256)+'</dd>':'')+'</dl>';
  }
  function sourceRowsHTML(){
    const filtered=values().filter(r=>!sourceFilter||canonical([nativeName(r),r.source,r.value,r.units]).toLowerCase().includes(sourceFilter.toLowerCase()));
    sourceOffset=Math.min(sourceOffset,Math.max(0,Math.floor((filtered.length-1)/40)*40));const page=filtered.slice(sourceOffset,sourceOffset+40);
    return '<div class="pwr-toolbar">'+input('@filter','Find a saved value',sourceFilter,'type="search"')+'<p>'+filtered.length+' applicable values · '+current.selection.mappings.length+' mapped · '+current.selection.exclusions.length+' excluded</p></div>'+
      '<div class="pw-table-scroll" tabindex="0" aria-label="Saved values and explicit workbook destinations"><table><thead><tr><th>Exact saved value</th><th>Value and units</th><th>Return choice</th><th>Original sheet and cell / exclusion reason</th><th>Original cell</th></tr></thead><tbody>'+page.map(row=>{
        const k=sourceKey(row.source),m=selected(row),e=excluded(row),choice=m?'map':e?'exclude':'unassigned';
        return '<tr data-pwr-source-row="'+esc(k)+'"><th scope="row">'+esc(nativeName(row))+'<small>'+esc(row.description||'')+'</small></th><td>'+esc(valueText(row.value))+'<small>'+esc(row.units||'Native saved units')+'</small></td>'+
          '<td><select data-pwr-choice="'+esc(k)+'" aria-label="Return choice for '+esc(nativeName(row))+'">'+[['unassigned','Choose explicitly'],['map','Write exact saved value'],['exclude','Exclude with reason']].map(([v,l])=>option(v,l,choice)).join('')+'</select></td>'+
          '<td>'+(m?'<label class="pw-field"><span>Worksheet</span><select data-pwr-sheet="'+esc(k)+'">'+option('','Choose original sheet',m.sheet)+list(book?.sheets).map(s=>option(s.name,s.name,m.sheet)).join('')+'</select></label><label class="pw-field"><span>Cell address</span><input data-pwr-cell="'+esc(k)+'" value="'+esc(m.cell)+'" placeholder="B12" aria-label="Cell for '+esc(nativeName(row))+'"></label>':
            e?'<label class="pw-field"><span>Why this saved value is excluded</span><textarea data-pwr-exclusion="'+esc(k)+'" rows="2">'+esc(e.reason)+'</textarea></label>':'Select a destination or record an explicit exclusion.')+'</td>'+
          '<td>'+button('target','Choose or inspect original cell','data-pwr-source="'+esc(k)+'"'+(!current.selection.workbook?' data-pwr-disabled':''))+'</td></tr>';
      }).join('')+'</tbody></table></div><div class="pw-actions">'+button('source-page','Previous values','data-pwr-offset="'+Math.max(0,sourceOffset-40)+'"'+(sourceOffset===0?' data-pwr-disabled':''))+
      '<span>'+Math.min(sourceOffset+1,filtered.length)+'–'+Math.min(sourceOffset+40,filtered.length)+' of '+filtered.length+'</span>'+
      button('source-page','Next values','data-pwr-offset="'+(sourceOffset+40)+'"'+(sourceOffset+40>=filtered.length?' data-pwr-disabled':''))+'</div>';
  }
  function cellHTML(){
    if(!selectedSource||!book)return '';
    const row=values().find(r=>sourceKey(r.source)===selectedSource),page=cellPage;
    return '<section class="pwr-cell-picker"><h4>Original workbook cells'+(row?' · '+esc(nativeName(row)):'')+'</h4><p>Inspect the original value and formula before assigning a cell. Only targets the native reader identifies as writable are available; original formulas, merged cells and effective protection are respected.</p>'+
      '<div class="pwr-toolbar"><label class="pw-field"><span>Original worksheet</span><select data-pwr-field="@sheet">'+option('','Choose original sheet',cellSheet)+list(book.sheets).map(s=>option(s.name,s.name,cellSheet)).join('')+'</select></label>'+
      input('@address','Inspect exact cell address',book.requestedCell||'','placeholder="B12"')+button('inspect-cell','Inspect cell')+button('close-cells','Close cell chooser')+'</div>'+
      (page?'<div class="pw-table-scroll" tabindex="0" aria-label="Original workbook cells"><table><thead><tr><th>Cell</th><th>Original value</th><th>Formula</th><th>Style / restrictions</th><th>Selection</th></tr></thead><tbody>'+list(page.cells).map(cell=>'<tr><th scope="row">'+esc(cell.cell)+'</th><td>'+esc(valueText(cell.value))+'</td><td>'+esc(cell.formula||'None')+'</td><td>'+esc([cell.style!=null?'Style '+cell.style:'',cell.protected?'Worksheet protection active':'',cell.merged?'Merged range':'',...list(cell.issues)].filter(Boolean).join(' · '))+'</td><td>'+button('assign-cell','Use this cell','data-pwr-cell-address="'+esc(cell.cell)+'"'+(cell.selectable===false?' data-pwr-disabled':''))+'</td></tr>').join('')+'</tbody></table></div>'+
        '<div class="pw-actions">'+button('cell-page','Previous cells','data-pwr-offset="'+Math.max(0,(page.offset||0)-(page.limit||100))+'"'+(!(page.offset>0)?' data-pwr-disabled':''))+
        '<span>'+esc(page.offset||0)+' · '+esc(page.total||0)+' source cells</span>'+
        button('cell-page','Next cells','data-pwr-offset="'+esc(page.next_offset)+'"'+(page.next_offset==null?' data-pwr-disabled':''))+'</div>':'<p>Choose an original worksheet to view its source cells.</p>')+'</section>';
  }
  function changesHTML(value){
    return '<div class="pw-table-scroll" tabindex="0" aria-label="Exact proposed workbook changes"><table><thead><tr><th>Worksheet / cell</th><th>Saved native value</th><th>Original value</th><th>Returned value</th><th>Units / interpretation</th></tr></thead><tbody>'+
      list(value?.changes).map(r=>'<tr><th scope="row">'+esc(r.sheet)+'!'+esc(r.cell)+'</th><td>'+esc(r.source_value?.label||sourceKey(r.source))+'</td><td>'+esc(valueText(r.original?.value))+'</td><td>'+esc(valueText(r.value))+'</td><td>'+esc(r.source_value?.units||'')+'</td></tr>').join('')+'</tbody></table></div>';
  }
  function previewHTML(){
    const p=preview?.signature===signature(current)?preview.value:null;
    if(!p)return '';
    return '<section class="pw-preview"><h3>'+(p.eligible?'Original workbook return is ready to create':'Review the named mappings')+'</h3><p>Only the displayed saved native values will be written to the explicitly selected cells. The original workbook remains retained.</p>'+
      (list(p.issues).length?'<ul class="pw-validation-errors">'+p.issues.map(i=>'<li>'+esc(typeof i==='string'?i:i.message||pretty(i))+'</li>').join(''):'')+
      changesHTML(p)+(list(p.exclusions).length?'<h4>Explicit exclusions</h4><ul>'+p.exclusions.map(e=>'<li>'+esc(e.label||sourceKey(e.source))+': '+esc(e.reason)+'</li>').join('')+'</ul>':'')+
      '<div class="pw-actions">'+button('create','Create named workbook return',!p.eligible||current.frozen?' data-pwr-disabled':'')+'</div></section>';
  }
  function operationsHTML(){
    return list(current?.operations).map(op=>'<article class="pwr-operation"><strong>Original workbook return request</strong><p>'+esc(op.state)+' · '+esc(date(op.created_at))+'</p>'+
      (op.error?'<p class="pw-error">'+esc(op.error.message||pretty(op.error))+'</p>':'')+
      '<div class="pw-actions">'+button('receive','Read original result','data-pwr-operation="'+esc(op.operation_id)+'"')+
      (!op.task_id&&op.state!=='complete'?button('retry','Retry exact retained request','data-pwr-operation="'+esc(op.operation_id)+'"'):'')+
      (op.task_id?button('task','Open native operation','data-pwr-task="'+esc(op.task_id)+'"'):'')+
      (op.task_id&&['failed','interrupted','cancelled'].includes(op.task_state)?button('resume','Resume original operation','data-pwr-operation="'+esc(op.operation_id)+'"'):'')+'</div>'+
      '<details><summary>Complete original request and receipt</summary><pre>'+esc(pretty(op))+'</pre></details></article>').join('');
  }
  function render(){
    if(!node?.isConnected)return;
    const locals=localCopies().sort((a,b)=>text(b.updated_at).localeCompare(text(a.updated_at))),returns=list(catalog?.returns).filter(r=>r.profile_id===profileId);
    node.classList.add('profile-workbook-return');
    node.innerHTML='<section class="pw-panel" data-pwr-profile="'+esc(profileId)+'" data-pwr-project="'+esc(project?.id)+'"><header class="pw-panel-heading"><div><h2>Return profile values to an original workbook</h2><p>Map this saved profile’s coefficients and native parameters to explicitly reviewed original cells. Retain the original workbook, derived edition and complete change record together.</p></div><div class="pw-actions">'+button('new','New workbook return')+button('refresh','Refresh')+'</div></header>'+
      '<div class="pw-panel-body"><p data-pwr-status class="pw-message" role="status" aria-live="polite" hidden></p>'+
      '<div class="pw-two-columns"><section><h3>Working copies</h3><div class="pw-actions">'+button('import','Open working file')+'<input data-pwr-import type="file" accept=".json,application/json" hidden></div>'+
      (locals.length?'<ul class="pwr-copies">'+locals.map(d=>'<li>'+button('local',d.selection.title||'Untitled return','data-pwr-id="'+esc(d.id)+'"')+' <span>'+esc(date(d.updated_at))+(d.frozen?' · original request retained':' · editable')+'</span></li>').join('')+'</ul>':'<p>No local workbook mapping is saved for this profile.</p>')+'</section>'+
      '<section><h3>Saved workbook returns</h3>'+(returns.length?'<ul class="pwr-copies">'+returns.map(r=>'<li>'+button('open',r.title||short(r.id),'data-pwr-id="'+esc(r.id)+'"')+' · '+esc(date(r.created_at))+'</li>').join('')+'</ul>':'<p>No named return has been created for this profile.</p>')+'</section></div>'+
      (current?'<section class="pwr-current">'+(errors.has(key(current.id))?'<section class="pw-error"><h3>Your visible changes are retained separately</h3><p>'+esc(errors.get(key(current.id)).message)+'</p>'+button('fork','Save visible work as separate copy')+button('reopen','Explicitly reopen saved copy')+'</section>':'')+
        '<div class="pw-actions">'+button('download','Download complete working file')+button('fork','Separate editable copy')+'</div><div data-pwr-operations>'+operationsHTML()+'</div>'+
        '<div data-pwr-editor>'+originalHTML(current.selection.workbook)+'<div class="pw-form-grid">'+input('title','Return title',current.selection.title,'maxlength="300"')+input('author','Prepared by',current.selection.author,'maxlength="300"')+area('reason','Reason for this return',current.selection.reason)+'</div>'+
        '<label class="pw-field"><span>Original retained workbook</span><select data-pwr-field="workbook">'+option('','Choose an original workbook',workbookKey(current.selection.workbook))+
        [...workbooks(),...(current.selection.workbook&&!workbooks().some(w=>workbookKey(w)===workbookKey(current.selection.workbook))?[current.selection.workbook]:[])].map(w=>option(workbookKey(w),workbookName(w),workbookKey(current.selection.workbook))).join('')+'</select></label>'+
        '<p class="pw-note">Changing the original workbook clears only the new draft’s cell destinations and retains that prior choice in its working history. Each applicable saved value requires a destination or an explicit exclusion.</p>'+
        (book?'<div class="pw-actions">'+button('suggestions','Apply source mapping suggestions',!list(book.suggestions?.mappings).length?' data-pwr-disabled':'')+'</div><p class="pw-note">Suggestions use retained source mappings only; they remain subject to complete native cell review.</p>':'')+
        (profile?sourceRowsHTML():'<p>Reading the exact saved native values…</p>')+cellHTML()+
        '<div class="pw-actions">'+button('preview','Review complete workbook changes',!current.selection.workbook?' data-pwr-disabled':'')+'</div></div><div data-pwr-preview>'+previewHTML()+'</div>'+
        (record?'<section class="pwr-result"><h3>'+esc(record.title||record.preview?.selection?.title||'Retained workbook return')+'</h3><p>Original and derived workbook bytes, complete profile values, exact cell mapping and all changes are retained in this scientific project.</p>'+fileLinks(record)+changesHTML(record.preview)+
        '<details><summary>Complete retained source and result</summary><pre>'+esc(pretty(record))+'</pre></details><div class="pw-actions">'+button('project-transfer','Open complete project handover')+'</div></section>':'')+'</section>':'<p>Create a named working copy to choose the original workbook and its exact cell mapping.</p>')+
      '</div></section>';
    status(message,failure);lock();
  }
  async function loadProfile(c=context()){
    const value=await read('profile',{profile_id:c.profileId},c);if(!alive(c))return null;
    if(value.profile_id!==c.profileId||value.project_id!==c.project.id)throw Error('The native values belong to a different profile or project.');
    return value;
  }
  async function reload(){
    assert();const c=context(),flight=++readFlight;await recall(c.scope);if(!alive(c))return;
    const [cat,p]=await Promise.all([read('catalog',{},c),loadProfile(c)]);if(!alive(c)||flight!==readFlight)return;
    if(cat.project_id!==c.project.id)throw Error('The workbook catalog belongs to another scientific project.');
    catalog=cat;profile=p;
    if(!current){const rows=localCopies().sort((a,b)=>text(b.updated_at).localeCompare(text(a.updated_at)));if(rows.length)current=clone(rows[0]);}
    if(current){
      validateWorkingCopy(workingCopyEnvelope(project,current),{projectId:c.project.id,profileId:c.profileId});
      if(current.record){const value=await read('inspect',{id:current.record.id},c);if(!alive(c)||flight!==readFlight)return;record=bindWorkbookReturn(current,value,c.project.id);}
      if(current.selection.workbook)await readBook();
    }
    if(alive(c)&&flight===readFlight)render();
  }
  async function readBook({sheet=null,offset=0,cell=null}={}){
    const c=context(),identity=clone(current?.selection.workbook);if(!identity)throw Error('Choose an original workbook.');
    const payload={...identity,profile_id:c.profileId,offset,limit:100};if(sheet)payload.sheet=sheet;if(cell)payload.cell=cell;
    const value=await read('book',payload,c);
    if(!sameDraft(c)||workbookKey(current.selection.workbook)!==workbookKey(identity))return null;
    if(workbookKey(value.workbook)!==workbookKey(identity)||value.project_id!==c.project.id)throw Error('The source cell response belongs to a different original workbook.');
    book={...value,requestedCell:cell||book?.requestedCell||''};
    if(sheet){cellSheet=sheet;cellOffset=offset;cellPage=value;}
    return value;
  }
  async function open(id){
    assert();const c=context();if(current)await persist(current,{originScope:c.scope});if(!alive(c))return;
    const value=await read('inspect',{id},c);if(!alive(c))return;
    if(value.id!==id||value.project_id!==c.project.id||value.preview?.selection?.profile_id!==c.profileId)throw Error('The saved return belongs to another original profile.');
    const old=localCopies().find(d=>d.record?.id===id),d=old?clone(dirty.get(key(old.id,c.scope))||old):fresh(baseSelection(value.preview?.selection),{kind:'saved-return',id});
    d.record={id};d.frozen=true;bindWorkbookReturn(d,value,c.project.id);
    if(await choose(d)&&alive(c)){record=value;render();}
  }
  async function retain(draftId,sc,operationId,receipt,c){
    const k=key(draftId,sc),d=clone(dirty.get(k)||copies.get(k));if(!d)throw Error('The original working copy is unavailable; receive the retained native result.');
    const op=d.operations.find(o=>o.operation_id===operationId);if(!op)throw Error('The full original request is unavailable.');
    const task=receipt.task;
    if(task&&(task.workspace!==op.request.workspace||task.action!==op.request.action||canonical(task.payload)!==canonical(op.request.payload)))throw Error('The native task differs from the complete original request.');
    op.receipt=clone(receipt);op.received_at=new Date().toISOString();op.task_id=task?.id||receipt.task_id||op.task_id;op.task_state=task?.state||op.task_state;
    op.error=receipt.error||task?.error||null;
    op.state=receipt.status==='NOT_FOUND'?(op.claimed_complete?'verification_required':'not_found'):task?.state==='complete'||receipt.status==='COMPLETE'?'complete':task?.state||text(receipt.status||'pending').toLowerCase();
    const result=receipt.result||task?.result;
    if(op.state==='complete'){
      d.record={id:result?.id};bindWorkbookReturn(d,result,c.project.id);
      if(result.preview_sha256!==op.request.payload.preview_sha256)throw Error('The accepted return used a different complete cell preview.');
      op.result=clone(result);d.frozen=true;
    }
    copies.set(k,d);dirty.set(k,d);await persist(d,{strict:true,originScope:sc});
    if(alive(c)&&current?.id===draftId){current=clone(d);if(op.state==='complete')record=result;render();}
    return op;
  }
  async function receive(operationId){
    const c=context(),d=clone(current),op=d.operations.find(r=>r.operation_id===operationId);if(!op)throw Error('Choose the retained original request.');
    const receipt=await read('operation',{operation_id:op.operation_id,task_id:op.task_id||null,request:clone(op.request)},c);
    await retain(d.id,c.scope,op.operation_id,receipt,c);
    if(sameDraft(c)&&current.record){const value=await read('inspect',{id:current.record.id},c);if(sameDraft(c)){record=bindWorkbookReturn(current,value,c.project.id);render();}}
    return receipt;
  }
  async function send(op,draftId,sc,c){
    if(!alive(c)||op.request.workspace!==c.workspace)throw Error('Continue this exact request through its original operator workspace and journal.');
    const task=await host.api('/api/actions',{method:'POST',body:clone(op.request)});
    const result=await retain(draftId,sc,op.operation_id,{status:task.state==='complete'?'COMPLETE':'PENDING',task},c);
    if(alive(c)&&current?.id===draftId&&current.record){const found=await read('inspect',{id:current.record.id},c);if(alive(c)&&current?.id===draftId){record=bindWorkbookReturn(current,found,c.project.id);render();}}
    return result;
  }
  async function submit(){
    if(current.frozen||current.operations.length)throw Error('Recover the retained original request or make an explicit separate editable copy.');
    if(!preview?.value.eligible||preview.signature!==signature(current))throw Error('Review every current mapping and exclusion before creating the workbook.');
    const c=context(),d=clone(current),payload={...clone(d.selection),preview_sha256:preview.value.preview_sha256};
    const request={workspace:c.workspace,action:ACTION,payload,operation_id:crypto.randomUUID()};
    d.operations.push({operation_id:request.operation_id,request,signature:canonical(request),state:'prepared',created_at:new Date().toISOString()});d.frozen=true;
    current=clone(d);await persist(d,{strict:true,originScope:c.scope});if(!sameDraft(c))return;render();
    try{return await send(clone(d.operations[0]),d.id,c.scope,c);}
    catch(error){if(alive(c))status('The complete original request is retained. Read or retry that exact request. '+error.message,true);throw error;}
  }
  async function importCopy(file){
    if(!file||file.size>32*1024*1024)throw Error('Choose a complete workbook working file up to 32 MiB. Original workbooks travel in the full project.');
    const c=context(),raw=await file.text();let parsed;try{parsed=JSON.parse(raw.replace(/^\uFEFF/,''));}catch{throw Error('The working file is not complete JSON.');}
    const value=validateWorkingCopy(parsed,{projectId:c.project.id,profileId:c.profileId});if(!sameDraft(c))return;
    const d=value.draft;
    if(d.record){const found=await read('inspect',{id:d.record.id},c);if(!sameDraft(c))return;bindWorkbookReturn(d,found,c.project.id);}
    if(d.selection.workbook){const found=await read('book',{...d.selection.workbook,profile_id:c.profileId,offset:0,limit:1},c);if(!sameDraft(c))return;if(workbookKey(found.workbook)!==workbookKey(d.selection.workbook))throw Error('The imported working copy names a different retained workbook.');}
    d.id=crypto.randomUUID();d.imported_original={filename:file.name,bytes:file.size,text:raw};for(const op of d.operations)if(op.state==='complete'){op.claimed_complete=true;op.state='pending_verification';}
    if(!await choose(d)||!alive(c))return;
    for(const op of d.operations){if(!alive(c)||current?.id!==d.id)return;await receive(op.operation_id);}
  }
  function editSource(k,change){
    if(current.frozen)throw Error('Use a separate editable copy to change this original request.');
    const row=values().find(r=>sourceKey(r.source)===k);if(!row)throw Error('Choose one exact saved native value.');
    change(row);invalidate();
  }
  function setChoice(row,choice){
    const k=sourceKey(row.source);
    current.selection.mappings=current.selection.mappings.filter(r=>sourceKey(r.source)!==k);
    current.selection.exclusions=current.selection.exclusions.filter(r=>sourceKey(r.source)!==k);
    if(choice==='map')current.selection.mappings.push({sheet:cellSheet||book?.sheets?.[0]?.name||'',cell:'',source:clone(row.source)});
    if(choice==='exclude')current.selection.exclusions.push({source:clone(row.source),reason:''});
  }
  function changed(event){
    const el=event.target;if(busy||!current)return;
    if(el.dataset.pwrField==='@filter'){sourceFilter=el.value;sourceOffset=0;const box=$('[data-pwr-editor]');render();const field=$('[data-pwr-field="@filter"]');field?.focus();field?.setSelectionRange(sourceFilter.length,sourceFilter.length);return;}
    if(el.dataset.pwrField==='@sheet'){cellSheet=el.value;cellPage=null;void guarded(async()=>{if(cellSheet)await readBook({sheet:cellSheet});render();});return;}
    if(el.dataset.pwrField==='@address'){if(book)book.requestedCell=el.value;return;}
    if(current.frozen)return;
    if(['title','author','reason'].includes(el.dataset.pwrField)){current.selection[el.dataset.pwrField]=el.value;invalidate();return;}
    if(el.dataset.pwrField==='workbook'&&event.type==='change'){
      const prior=clone(current.selection);current.selection.workbook=el.value?JSON.parse(el.value):null;
      current.selection_history??=[];current.selection_history.push({at:new Date().toISOString(),selection:prior,reason:'Changed explicitly selected original workbook'});
      current.selection.mappings=[];current.selection.exclusions=[];book=null;cellPage=null;selectedSource='';invalidate();
      void guarded(async()=>{if(current.selection.workbook)await readBook();render();});return;
    }
    if(el.dataset.pwrChoice){editSource(el.dataset.pwrChoice,row=>setChoice(row,el.value));render();return;}
    if(el.dataset.pwrSheet){editSource(el.dataset.pwrSheet,row=>{const m=selected(row);if(m)m.sheet=el.value;});return;}
    if(el.dataset.pwrCell){editSource(el.dataset.pwrCell,row=>{const m=selected(row);if(m)m.cell=el.value;});return;}
    if(el.dataset.pwrExclusion){editSource(el.dataset.pwrExclusion,row=>{const e=excluded(row);if(e)e.reason=el.value;});}
  }
  async function action(name,control){
    assert();
    if(name==='new')return choose(fresh());
    if(name==='refresh')return reload();
    if(name==='local'){
      const c=context(),id=control.dataset.pwrId;if(current)await persist(current,{originScope:c.scope});if(!alive(c))return;
      const d=clone(dirty.get(key(id,c.scope))||copies.get(key(id,c.scope)));validateWorkingCopy(workingCopyEnvelope(project,d),{projectId:project.id,profileId});
      let found=null;if(d.record){found=await read('inspect',{id:d.record.id},c);if(!alive(c))return;bindWorkbookReturn(d,found,c.project.id);}
      if(await choose(d)&&alive(c)){record=found;render();}return;
    }
    if(name==='open')return open(control.dataset.pwrId);
    if(name==='import'){$('[data-pwr-import]').click();return;}
    if(name==='download'){download(pretty(workingCopyEnvelope(project,current))+'\n','profile-workbook-return-'+current.id+'.json');return;}
    if(name==='fork'){const d=fresh(current.selection,{kind:'separate-copy',working_copy_id:current.id,record:clone(current.record),operations:clone(current.operations)});d.selection.title+=' · separate copy';return choose(d);}
    if(name==='reopen'){
      const c=context(),row=await storage.read(c.scope,current.id);if(!sameDraft(c))return;if(!row)throw Error('The original saved copy is unavailable.');
      const k=key(row.id,c.scope);dirty.delete(k);errors.delete(k);revisions.set(k,row.revision);copies.set(k,row.body);current=clone(row.body);preview=null;record=null;return reload();
    }
    if(name==='source-page'){sourceOffset=Number(control.dataset.pwrOffset);render();return;}
    if(name==='target'){
      selectedSource=control.dataset.pwrSource;const row=values().find(r=>sourceKey(r.source)===selectedSource),m=row&&selected(row);cellSheet=m?.sheet||book?.sheets?.[0]?.name||'';
      if(cellSheet)await readBook({sheet:cellSheet,cell:m?.cell||null});render();return;
    }
    if(name==='cell-page'){if(cellSheet)await readBook({sheet:cellSheet,offset:Number(control.dataset.pwrOffset)});render();return;}
    if(name==='inspect-cell'){if(!cellSheet||!book?.requestedCell)throw Error('Choose an original worksheet and exact cell address.');await readBook({sheet:cellSheet,cell:book.requestedCell});render();return;}
    if(name==='close-cells'){selectedSource='';cellPage=null;render();return;}
    if(name==='assign-cell'){
      const cell=list(cellPage?.cells).find(r=>r.cell===control.dataset.pwrCellAddress);
      if(!cell||cell.selectable===false)throw Error('Choose a native-approved writable original cell.');
      editSource(selectedSource,row=>{setChoice(row,'map');const m=selected(row);m.sheet=cellSheet;m.cell=cell.cell;});render();return;
    }
    if(name==='suggestions'){
      if(current.frozen)throw Error('Use a separate editable copy to change original mappings.');
      const known=new Map(values().map(v=>[sourceKey(v.source),v]));
      current.suggestion_history??=[];current.suggestion_history.push({at:new Date().toISOString(),prior:clone(current.selection),suggestions:clone(book.suggestions)});
      for(const s of list(book.suggestions?.mappings)){const row=known.get(sourceKey(s.source));if(!row||selected(row)||excluded(row))continue;current.selection.mappings.push({sheet:s.sheet,cell:s.cell,source:clone(s.source)});}
      invalidate();render();return;
    }
    if(name==='preview'){
      const c=context(),d=clone(current),sig=signature(d);await persist(d,{strict:true,originScope:c.scope});if(!sameDraft(c))return;
      const value=await read('preview',d.selection,c);if(!sameDraft(c)||signature(current)!==sig)return;
      if(value.project_id!==c.project.id||canonical(baseSelection(value.selection))!==canonical(d.selection))throw Error('The workbook preview differs from the selected saved values and source cells.');
      preview={signature:sig,value};render();return;
    }
    if(name==='create')return submit();
    if(name==='receive')return receive(control.dataset.pwrOperation);
    if(name==='retry'){
      const c=context(),id=control.dataset.pwrOperation,receipt=await receive(id);if(!sameDraft(c))return;
      const op=current.operations.find(r=>r.operation_id===id);if(op.state==='complete')return;
      if(receipt.status!=='NOT_FOUND'||op.claimed_complete)throw Error('Retain this original operation and use its native task continuation.');
      return send(clone(op),current.id,c.scope,c);
    }
    if(name==='resume'){
      const c=context(),id=control.dataset.pwrOperation;await receive(id);if(!sameDraft(c))return;
      const op=current.operations.find(r=>r.operation_id===id);if(op.state==='complete')return;if(!op.task_id)throw Error('Read the retained native task first.');
      await host.api('/api/task/resume',{method:'POST',body:{id:op.task_id}});if(sameDraft(c))await receive(id);return;
    }
    if(name==='task')return host.showTask?.(control.dataset.pwrTask);
    if(name==='project-transfer')return host.openDesk('study-transfer','openForStudies',{workspace_key:workspace,roots:[{kind:'profile-workbook-returns',id:record.id,title:record.title,state:'Saved'}]});
  }
  async function guarded(fn){
    if(busy)return;const c=context();busy=true;lock();
    try{status();await fn();}catch(error){if(alive(c))status(error.message,true);}
    finally{if(alive(c)){busy=false;lock();}}
  }
  async function mount(target,selection){
    detach();node=target;workspace=selection?.workspace_key;profileId=selection?.profile_id;profileTitle=selection?.title||'Saved profile';
    const state=host.getState();project={id:state?.data?.project?.id||state?.project?.id,title:state?.data?.project?.title||'Scientific workspace'};scope=workspace+':'+project.id+':'+profileId;assert();
    current=null;catalog=null;profile=null;record=null;preview=null;book=null;cellPage=null;selectedSource='';sourceFilter='';message='';failure=false;busy=true;
    events=new AbortController();const signal=events.signal,c=context();
    node.addEventListener('click',event=>{const el=event.target.closest('[data-pwr-action]');if(!el||!node.contains(el))return;event.preventDefault();event.stopPropagation();void guarded(()=>action(el.dataset.pwrAction,el));},{signal});
    node.addEventListener('input',event=>{if(event.target.matches('select'))return;try{changed(event);}catch(e){status(e.message,true);}},{signal});
    node.addEventListener('change',event=>{if(event.target.hasAttribute('data-pwr-import')){const f=event.target.files?.[0];event.target.value='';void guarded(()=>importCopy(f));}else if(event.target.matches('select')){try{changed(event);}catch(e){status(e.message,true);}}},{signal});
    node.addEventListener('submit',event=>event.preventDefault(),{signal});
    window.addEventListener('beforeunload',event=>{if(current&&(dirty.has(key(current.id))||errors.has(key(current.id)))){event.preventDefault();event.returnValue='';}},{signal});
    render();try{await reload();}catch(e){if(alive(c))status(e.message,true);}finally{if(alive(c)){busy=false;lock();}}
  }
  function update(snapshot=host.getState()){
    if(!node)return;if(snapshot?.workspace_key!==workspace){detach();return;}if(busy||polling||!current)return;
    const changedOps=pending(current).filter(op=>op.task_id&&list(snapshot.tasks).some(t=>t.id===op.task_id&&t.state!==op.task_state));if(!changedOps.length)return;
    const c=context(),flight={};polling=flight;
    void guarded(async()=>{for(const op of changedOps){if(!sameDraft(c))return;await receive(op.operation_id);}}).finally(()=>{if(polling===flight)polling=null;});
  }
  function detach(){if(current)void persist();events?.abort();events=null;generation++;readFlight++;node=null;busy=false;polling=null;book=null;cellPage=null;preview=null;record=null;catalog=null;profile=null;}
  return {mount,update,detach,open};
}
