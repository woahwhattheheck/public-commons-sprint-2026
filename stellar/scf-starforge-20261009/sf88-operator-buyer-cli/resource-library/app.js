// MIT — All provider material is rendered as text; actions use original resource IDs.
const $ = id => document.getElementById(id);
const key = 'sf-resource-session';
let token = location.hash.slice(1) || sessionStorage.getItem(key) || '';
if (location.hash) {sessionStorage.setItem(key,token);history.replaceState(null,'',location.pathname);}
let selected = null, page = 0, total = 0, selectionEpoch = 0, searchEpoch = 0, timer, pendingDownload = false;
const operationId = () => crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join('');
const draftKey = id => 'sf-resource-draft:' + id;
const readDraft = id => {try {return JSON.parse(sessionStorage.getItem(draftKey(id)));} catch {return null;}};
const writeDraft = (id,value) => sessionStorage.setItem(draftKey(id),JSON.stringify(value));
const message = text => {$('message').textContent = text;};
async function api(path,method='GET',payload) {
  const response = await fetch('/api' + path,{method,headers:{Authorization:'Bearer ' + token,
    ...(payload === undefined ? {} : {'Content-Type':'application/json'})},
    body:payload === undefined ? undefined : JSON.stringify(payload)});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP_${response.status}`);
  return data;
}
const run = task => Promise.resolve().then(task).catch(e => message(e.message));
function node(tag,text,className) {
  const el = document.createElement(tag);if(text !== undefined)el.textContent=text;if(className)el.className=className;return el;
}
function draftInput() {
  return {note:$('note').value,tags:[...new Set($('tags').value.split(',').map(t=>t.trim()).filter(Boolean))].sort(),starred:$('starred').checked};
}
function rememberDraft() {
  if (!selected) return;
  const previous = readDraft(selected.id);
  writeDraft(selected.id,{...draftInput(),expectedRevision:previous?.expectedRevision ?? selected.annotation.revision,
    pending:previous?.pending ?? null});
  $('draft-status').textContent='Draft retained in this browser session.';
}
function setDraft(record) {
  const draft = readDraft(record.id), value = draft ?? record.annotation;
  $('note').value=value.note;$('tags').value=value.tags.join(', ');$('starred').checked=value.starred;
  $('revision').textContent=`Saved revision ${record.annotation.revision}`;
  $('draft-status').textContent=draft ? `Restored browser draft based on revision ${draft.expectedRevision}.` : 'Saved review loaded.';
}
async function updateStatus() {
  const status=await api('/status');
  $('source').textContent=`${status.config.kind} · ${status.config.source}`;
  $('refreshed').textContent=status.scan?.completedAt ?? 'No completed refresh';
  const counts=status.scan?.counts ?? {};
  $('counts').textContent=`${counts.VERIFIED ?? 0} verified · ${counts.UNAVAILABLE ?? 0} unavailable · ${counts.INCOMPLETE ?? 0} incomplete`;
  $('scan-details').textContent=JSON.stringify(status.scan ?? {source:status.config.source},null,2);
  const active=Boolean(status.activity || status.lastScan?.state==='RUNNING');
  $('scan').disabled=active;$('cancel').hidden=!active;
  if(active)message(`Refreshing source · ${status.activity?.completed ?? 0} of ${status.activity?.total ?? '?'} files checked`);
  clearTimeout(timer);
  if(active)timer=setTimeout(()=>run(async()=>{const next=await updateStatus();if(!next.activity && next.lastScan?.state!=='RUNNING'){await list();if(selected){try{await select(selected.id);}catch{selected=null;$('selected').hidden=true;$('empty').hidden=false;}}message(next.lastScan?.error ?? 'Resource index refreshed.');}}),700);
  return status;
}
async function list() {
  const epoch=++searchEpoch;
  const params=new URLSearchParams({q:$('query').value,offset:String(page*50),limit:'50',status:$('status').value,starred:String($('only-starred').checked)});
  const data=await api('/resources?' + params);
  if(epoch!==searchEpoch)return;
  total=data.total;if(page>0 && page*50>=total){page=0;return list();}$('results').replaceChildren();
  $('results-count').textContent=`${total} resources · text search covers the bytes shown in each file’s coverage`;
  for(const record of data.items){
    const button=node('button',undefined,'result');button.type='button';button.setAttribute('aria-current',String(record.id===selected?.id));
    button.append(node('strong',(record.annotation.starred?'★ ':'')+record.name),node('span',`${record.intentId} · ${record.status} · ${record.bytes ?? 0} bytes`));
    if(record.verification)button.append(node('span',`${record.verification.coverage} · ${record.verification.indexedBytes} indexed bytes`));
    if(record.snippet)button.append(node('span',record.snippet,'snippet'));
    button.addEventListener('click',()=>run(()=>select(record.id)));$('results').append(button);
  }
  if(!data.items.length)$('results').append(node('p','No matching resources. Refresh the inbox or adjust the search.','small'));
  $('previous').disabled=page===0;$('next').disabled=(page+1)*50>=total;
  $('page').textContent=total?`${page*50+1}–${Math.min((page+1)*50,total)} of ${total}`:'0 results';
}
async function select(id) {
  const epoch=++selectionEpoch;
  const record=await api('/resources/' + id);
  if(epoch!==selectionEpoch)return;
  selected=record;$('empty').hidden=true;$('selected').hidden=false;
  $('intent').textContent=record.intentId;$('name').textContent=record.name;
  $('file-status').textContent=`${record.status}${record.error?' · '+record.error:''} · original delivery ${record.deliveryStatus}`;
  $('identity').replaceChildren();
  for(const [label,value] of [['Request',`${record.method} ${record.url}`],['Content type',record.contentType ?? 'Unspecified'],
    ['Bytes',record.bytes],['SHA-256',record.sha256 ?? 'Unrecorded'],['Buyer outcome',record.buyerStatus ?? 'Unrecorded'],
    ['HTTP status',record.httpStatus ?? 'Unrecorded'],['Inbox state',record.queueState]])
    $('identity').append(node('dt',label),node('dd',String(value)));
  $('source-detail').textContent=JSON.stringify(record,null,2);$('content').textContent='';
  $('coverage').textContent='Open a preview to check the current file.';
  $('download').disabled=record.deliveryStatus!=='SAVED';$('preview').disabled=record.deliveryStatus!=='SAVED';
  setDraft(record);await api('/selection','PUT',{id});
  if(epoch!==selectionEpoch)return;
  await historyView();await list();
  if(epoch===selectionEpoch && matchMedia('(max-width:900px)').matches)$('selected').scrollIntoView({block:'start'});
}
async function historyView() {
  const id=selected?.id;if(!id)return;
  const revisions=await api(`/resources/${id}/revisions`);if(selected?.id!==id)return;
  $('revisions').replaceChildren();
  for(const revision of revisions){
    const card=node('div',undefined,'revision-card');card.append(node('strong',`Revision ${revision.revision} · ${revision.updatedAt}`),node('pre',revision.note));
    const use=node('button','Use this revision as draft');use.type='button';
    use.onclick=()=>{if(selected?.id!==id)return;$('note').value=revision.note;$('tags').value=revision.tags.join(', ');$('starred').checked=revision.starred;rememberDraft();};
    card.append(use);$('revisions').append(card);
  }
  if(!revisions.length)$('revisions').append(node('p','No saved analyst revisions yet.'));
}
$('search-form').onsubmit=e=>{e.preventDefault();page=0;run(list);};
$('status').onchange=$('only-starred').onchange=()=>{page=0;run(list);};
$('previous').onclick=()=>{page--;run(list);};$('next').onclick=()=>{page++;run(list);};
$('scan').onclick=()=>run(async()=>{await api('/scan','POST',{});await updateStatus();});
$('cancel').onclick=()=>run(async()=>{await api('/scan/cancel','POST',{});await updateStatus();});
$('preview').onclick=()=>run(async()=>{
  const id=selected.id,epoch=selectionEpoch;$('coverage').textContent='Verifying the complete original file…';
  const data=await api(`/resources/${id}/preview`);if(epoch!==selectionEpoch)return;
  $('content').textContent=data.text ?? '';
  $('coverage').textContent=`${data.coverage} · ${data.indexedBytes} displayed UTF-8 bytes of ${data.bytes} · verified ${data.verifiedAt}`;
  message(data.text===null?'Verified binary file. Use Download exact file to open it in your own application.':'Original bytes verified; preview loaded.');
});
$('download').onclick=()=>run(async()=>{
  if(pendingDownload)return;pendingDownload=true;$('download').disabled=true;
  try{message('Verifying and preparing the exact file…');const data=await api(`/resources/${selected.id}/download`,'POST',{});
    const a=node('a');a.href=data.url;a.download='';document.body.append(a);a.click();a.remove();message(`Download prepared · ${data.bytes} bytes · SHA-256 ${data.sha256}`);
  }finally{pendingDownload=false;$('download').disabled=selected?.deliveryStatus!=='SAVED';}
});
$('export').onclick=()=>run(async()=>{const data=await api('/export');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'}));
  const a=node('a');a.href=url;a.download='resource-review.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);message('Exported source references and every saved analyst revision.');});
for(const id of ['note','tags','starred'])$(id).addEventListener('input',rememberDraft);
$('note-form').onsubmit=e=>{e.preventDefault();run(async()=>{
  const id=selected.id;rememberDraft();let draft=readDraft(id);
  const payload=draft.pending ?? {expectedRevision:draft.expectedRevision,operationId:operationId(),note:draft.note,tags:draft.tags,starred:draft.starred};
  writeDraft(id,{...draft,pending:payload});$('save').disabled=true;
  try{const saved=await api(`/resources/${id}/note`,'PATCH',payload);draft=readDraft(id);
    const edited=JSON.stringify([draft.note,draft.tags,draft.starred])!==JSON.stringify([saved.note,saved.tags,saved.starred]);
    if(edited)writeDraft(id,{...draft,pending:null,expectedRevision:saved.revision});else sessionStorage.removeItem(draftKey(id));
    if(selected?.id===id){selected.annotation=saved;setDraft(selected);await historyView();}
    await list();message(`Saved analyst revision ${saved.revision}.${edited?' Your later edits remain in the draft.':''}`);
  }finally{$('save').disabled=false;}
});};
$('load-saved').onclick=()=>run(async()=>{if(!confirm('Replace this browser draft with the latest saved review?'))return;
  sessionStorage.removeItem(draftKey(selected.id));await select(selected.id);message('Latest saved review loaded.');});
window.addEventListener('pagehide',()=>clearTimeout(timer));
run(async()=>{if(!token)throw new Error('Open the private URL printed by the library command.');const status=await updateStatus();await list();
  if(status.selection)try{await select(status.selection);message('Workspace reopened with the saved resource selection.');}catch{message('Previous selection is outside the latest source. Select a current resource.');}
  else message('Workspace ready. Refresh from inbox to update the searchable files.');});
