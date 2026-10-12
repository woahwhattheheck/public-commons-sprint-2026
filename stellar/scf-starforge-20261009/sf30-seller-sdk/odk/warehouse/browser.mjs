// MIT. Original Central approved periods, SQL review and complete report UI.
const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const format=value=>JSON.stringify(value,null,2),copy=value=>JSON.parse(JSON.stringify(value));
const id=()=>crypto.randomUUID().replaceAll('-','');
const authKey='central-warehouse-token:'+location.origin;
let token=new URLSearchParams(location.hash.slice(1)).get('token')??sessionStorage.getItem(authKey);
if(token){sessionStorage.setItem(authKey,token);history.replaceState(null,'',location.pathname);}
let state=null,busy=false,pendingKey=null,pending={},loadedInspection=null;
const types=['text','boolean','bigint','numeric','double precision','date','timestamp with time zone','json'];
const labelFor=op=>[op.context?.period?.label,op.context?.table?.formId,op.context?.table?.name].filter(Boolean).join(' / ');
const tell=value=>{$('message').textContent=value;};
const options=(element,values,empty='Choose a saved item')=>{
  const selected=element.value;
  element.innerHTML='<option value="">'+esc(empty)+'</option>'+values.map(x=>'<option value="'+esc(x.value)+'">'+esc(x.label)+'</option>').join('');
  if(values.some(x=>x.value===selected))element.value=selected;
};
const button=(label,data)=>'<button type="button" '+Object.entries(data).map(([k,v])=>'data-'+k+'="'+esc(v)+'"').join(' ')+'>'+esc(label)+'</button>';
const facts=entries=>'<dl class="facts">'+entries.map(([label,value])=>'<dt>'+esc(label)+'</dt><dd>'+esc(value??'')+'</dd>').join('')+'</dl>';
const detail=(label,value)=>'<details><summary>'+esc(label)+'</summary><pre>'+esc(format(value))+'</pre></details>';
const receiptButton=(receipt,label)=>receipt?button(label,{'download-hash':receipt.sha256,'download-name':receipt.name??label}):'';
function setBusy(value){
  busy=value;document.querySelectorAll('button,input,select,textarea').forEach(element=>{element.disabled=value;});
  if(!value)document.querySelectorAll('[data-native-key="true"]').forEach(element=>{element.disabled=true;});
}
async function request(path,input){
  const response=await fetch(path,{method:input===undefined?'GET':'POST',redirect:'error',
    headers:{Authorization:'Bearer '+(token??''),...(input===undefined?{}:{'Content-Type':'application/json'})},
    ...(input===undefined?{}:{body:JSON.stringify(input)})});
  let value;try{value=await response.json();}catch{throw new Error('The original response was interrupted. Reopen its saved request.');}
  if(!response.ok||value.ok===false)throw Object.assign(new Error(value.error?.message??'The original workspace request failed.'),value.error??{status:response.status});
  return value.result??value;
}
function savePending(){if(pendingKey)sessionStorage.setItem(pendingKey,JSON.stringify(pending));}
function renderPending(){
  $('pending').innerHTML=Object.keys(pending).length?'<h2>Reopen original requests</h2>'+Object.values(pending).map(item=>
    '<div class="card"><strong>'+esc(item.action)+'</strong><p>Retained request <code>'+esc(item.body.requestId)+'</code></p>'+
    button('Reopen this request',{'pending':item.body.requestId})+detail('Exact saved selection',item.body)+'</div>').join(''):'';
}
function renderProfile(){
  const selected=state?.profiles.find(p=>p.id===$('profile').value);
  $('profile-detail').innerHTML=selected?facts([
    ['Profile',selected.name],['Warehouse ID',selected.binding?.warehouseId??'Open this existing warehouse to read its identity'],
    ['SQL schema',selected.schema],['Private operator directory',selected.workspace],['Connection reference',selected.connectionEnv],
    ['PostgreSQL',selected.binding?.postgresqlVersion??'']]):'<p class="muted">A host operator supplies the original warehouse profiles when this application starts.</p>';
}
function renderDatasets(){
  const delivery=state?.deliveries.find(x=>x.id===$('delivery').value);
  options($('dataset'),(delivery?.datasets??[]).map(x=>({value:x.id,label:x.periodLabel+' / '+x.name})));
}
function renderOperations(){
  $('operations').innerHTML=state.operations.slice().reverse().map(op=>'<tr><td><strong>'+esc(op.action)+'</strong><br><code>'+esc(op.id)+'</code></td><td>'+
    esc(labelFor(op)||op.profile?.id||'Warehouse identity')+'</td><td>'+esc(op.status)+'</td><td>'+esc(op.rowCount??'')+'</td><td>'+
    button('Open',{'operation':op.id})+'</td></tr>').join('')||'<tr><td colspan="5">No warehouse operations are saved yet.</td></tr>';
}
function renderState(){
  $('workspace-name').textContent='Central workspace '+state.workspaceId;
  $('workspace-detail').textContent='Saved revision '+state.revision+(state.activeRequestId?' · Running original request '+state.activeRequestId:'');
  options($('profile'),state.profiles.map(p=>({value:p.id,label:p.name})),state.profiles.length?'Choose a host profile':'No host warehouse profiles configured');
  options($('delivery'),state.deliveries.map(x=>({value:x.id,label:x.name+' / '+x.id})));
  renderDatasets();renderProfile();
  options($('approval'),state.approvals.filter(x=>x.status==='COMPLETE').map(x=>({value:x.id,label:
    x.context.period.label+' / '+x.context.table.formId+' / '+x.context.table.name+' / '+x.id.slice(0,8)})));
  options($('inspection'),state.operations.filter(x=>x.action==='inspect'&&x.status==='COMPLETE').map(x=>({value:x.id,label:labelFor(x)+' / '+x.id.slice(0,8)})));
  options($('review'),state.operations.filter(x=>x.action==='review'&&x.status==='COMPLETE').map(x=>({value:x.id,label:labelFor(x)+' / '+x.id.slice(0,8)})));
  for(const [element,period]of [[$('previous-import'),0],[$('current-import'),1]])
    options(element,state.operations.filter(x=>x.action==='import'&&x.status==='COMPLETE'&&x.context.period.index===period)
      .map(x=>({value:x.id,label:labelFor(x)+' / '+x.profile.id+' / '+x.versionId?.slice(0,12)})));
  renderOperations();renderPending();
}
async function refresh(){
  const next=await request('/api/warehouse/state');
  if(next.schema!=='stellar-forge.central-warehouse.v1')throw new Error('This listener has another warehouse interface.');
  if(state&&state.workspaceId!==next.workspaceId)throw new Error('The original workspace identity changed. Open the current private link.');
  state=next;
  if(!pendingKey){
    pendingKey='central-warehouse-requests:'+location.origin+':'+state.workspaceId;
    try{pending=JSON.parse(sessionStorage.getItem(pendingKey)??'{}');}catch{pending={};}
  }
  renderState();
  if(state.storageReopenRequired)tell('A storage operation needs recovery. Reopen this same native workspace, then resume its original request.');
}
async function run(action,input,existing){
  const body=existing?copy(existing):{requestId:id(),...copy(input)};
  pending[body.requestId]={action,body,createdAt:pending[body.requestId]?.createdAt??new Date().toISOString()};
  savePending();renderPending();
  const result=await request('/api/warehouse/'+action,body);
  await refresh();
  const saved=action==='prepare'?state.approvals.find(x=>x.id===body.requestId):state.operations.find(x=>x.id===body.requestId);
  if(saved?.status==='COMPLETE'){delete pending[body.requestId];savePending();renderPending();}
  return result;
}
async function guarded(fn){
  if(busy)return;setBusy(true);tell('');
  try{await fn();}
  catch(error){tell((error.code?error.code+': ':'')+error.message);try{await refresh();}catch{}}
  finally{setBusy(false);}
}
async function download(input){
  const file=await request('/api/downloads',input),anchor=document.createElement('a');
  anchor.href=file.url;anchor.download=file.name;anchor.rel='noopener';document.body.append(anchor);anchor.click();anchor.remove();
}
function renderApproval(record){
  const a=record.approval;
  $('approval-detail').innerHTML=facts([
    ['Commissioning',a.commissioning.id],['Period',a.period.label],
    ['Native table',[a.table.projectId,a.table.formId,a.table.name].join(' / ')],
    ['Capture',a.capture.id],['Accepted review',a.review.id],['Approved rows',a.export.rowCount],
    ['Original keys',a.table.keyFields.join(', ')],['Repeat parent',a.table.relationship?.parentField??'Root table'],
    ['Approval SHA-256',record.receipt.sha256]
  ])+'<div class="actions">'+receiptButton(record.receipt,'Download approval')+
    button('Download approved CSV',{'export-id':a.export.id,'export-path':'dataset.csv'})+
    button('Download field dictionary',{'export-id':a.export.id,'export-path':'semantics.json'})+'</div>'+
    detail('Complete approved source binding',a)+
    '<details><summary>All original retained export files</summary><div class="scroll"><table><thead><tr><th>File</th><th>Bytes</th><th>SHA-256</th><th>Download</th></tr></thead><tbody>'+
    a.files.map(f=>'<tr><td>'+esc(f.path)+'</td><td>'+esc(f.bytes)+'</td><td><code>'+esc(f.sha256)+'</code></td><td>'+
      button('Download',{'export-id':a.export.id,'export-path':f.path})+'</td></tr>').join('')+'</tbody></table></div></details>';
}
async function openApproval(){
  const selected=$('approval').value;if(!selected)throw new Error('Select a saved export approval.');
  const record=await request('/api/warehouse/approval',{requestId:selected});renderApproval(record);return record;
}
async function openInspection(selected=$('inspection').value){
  if(!selected)throw new Error('Select a saved complete inspection.');
  const record=await request('/api/warehouse/operation',{requestId:selected});
  if(record.action!=='inspect'||record.status!=='COMPLETE')throw new Error('Open a complete original SQL inspection.');
  loadedInspection=record;
  const result=record.result;
  $('inspection-detail').innerHTML=facts([
    ['Original inspection',record.id],['Warehouse',record.profile.warehouseId],['Rows',result.row_count],
    ['Source approval',record.context.approvalSha256],['Native keys',record.context.keyColumns.join(', ')],
    ['Repeat-parent column',record.context.parentColumn??'Root table']
  ])+detail('Original source preview (up to five rows)',result.preview)+
    detail('Complete retained field dictionary',result.semantic_dictionary)+
    '<div class="actions">'+receiptButton(record.resultReceipt,'Download complete inspection')+'</div>';
  $('mapping').innerHTML=result.mapping.columns.map((column,index)=>{
    const key=record.context.keyColumns.includes(column.source);
    return '<tr data-column="'+index+'"><td><code>'+esc(column.source)+'</code></td><td><input aria-label="SQL name for '+esc(column.source)+
      '" data-sql-name value="'+esc(column.column)+'" maxlength="63" required></td><td><select aria-label="SQL type for '+esc(column.source)+
      '" data-sql-type>'+types.map(type=>'<option value="'+esc(type)+'"'+(type===column.type?' selected':'')+'>'+esc(type)+'</option>').join('')+
      '</select></td><td><input type="checkbox" aria-label="Nullable '+esc(column.source)+'" data-nullable'+
      (!key&&column.nullable?' checked':'')+(key?' data-native-key="true" disabled':'')+'></td><td>'+esc(key?'Native row key':'')+'</td></tr>';
  }).join('');
  $('review-form').hidden=false;
}
function mappingInput(){
  if(!loadedInspection)throw new Error('Open the complete original inspection before reviewing SQL.');
  const mapping=copy(loadedInspection.result.mapping);
  mapping.keys=[...loadedInspection.context.keyColumns];
  mapping.columns=mapping.columns.map((column,index)=>{
    const row=$('mapping').querySelector('[data-column="'+index+'"]');
    return {source:column.source,column:row.querySelector('[data-sql-name]').value,
      type:row.querySelector('[data-sql-type]').value,nullable:row.querySelector('[data-nullable]').checked};
  });
  return mapping;
}
async function openOperation(selected){
  const record=await request('/api/warehouse/operation',{requestId:selected});
  $('operation-detail').innerHTML=facts([
    ['Operation',record.action],['Request ID',record.id],['State',record.status],
    ['Warehouse',record.profile?.warehouseId??''],['Period / table',labelFor(record)],
    ['Created',record.createdAt],['Updated',record.updatedAt]
  ])+'<div class="actions">'+
    (record.status!=='COMPLETE'?button('Resume original request',{'resume':record.id}):'')+
    receiptButton(record.report,'Download full period report')+
    receiptButton(record.resultReceipt,'Download complete result')+'</div>'+
    (record.error?detail('Original operation error',record.error):'')+
    detail('Complete original selection',record.intent)+
    (record.result?detail('Complete original result',record.result):'')+
    (record.attempts?.length?'<details><summary>Original command outputs</summary>'+record.attempts.map(a=>'<div class="card"><strong>Attempt '+esc(a.number)+'</strong>'+
      facts([['Started',a.startedAt],['Finished',a.finishedAt??'Open the original request'],['Exit code',a.code??''],['Signal',a.signal??'']])+
      '<div class="actions">'+receiptButton(a.stdout,'Download stdout')+receiptButton(a.stderr,'Download stderr')+'</div></div>').join('')+'</details>':'');
  return record;
}
$('refresh').addEventListener('click',()=>guarded(async()=>{await refresh();tell('Saved original workspace refreshed.');}));
$('profile').addEventListener('change',renderProfile);$('delivery').addEventListener('change',renderDatasets);
$('connect-form').addEventListener('submit',event=>{event.preventDefault();guarded(async()=>{
  const selected=$('profile').value;if(!selected)throw new Error('Choose an existing host warehouse profile.');
  const record=await run('connect',{profileId:selected});await openOperation(record.id);tell('Original warehouse '+record.profile.warehouseId+' is retained.');});});
$('prepare-form').addEventListener('submit',event=>{event.preventDefault();guarded(async()=>{
  const delivery=state.deliveries.find(x=>x.id===$('delivery').value),dataset=delivery?.datasets.find(x=>x.id===$('dataset').value);
  if(!dataset)throw new Error('Choose an original commissioning delivery, table and period.');
  const record=await run('prepare',{deliveryId:delivery.id,datasetId:dataset.id,period:dataset.period});
  $('approval').value=record.id;renderApproval(record);tell('Complete original export approval retained.');});});
$('open-approval').addEventListener('click',()=>guarded(openApproval));
$('inspect').addEventListener('click',()=>guarded(async()=>{
  if(!$('approval').value||!$('profile').value)throw new Error('Choose a saved approval and an opened warehouse profile.');
  const record=await run('inspect',{approvalId:$('approval').value,profileId:$('profile').value});
  $('inspection').value=record.id;await openInspection(record.id);tell('Every original approved row was inspected for the SQL mapping.');}));
$('open-inspection').addEventListener('click',()=>guarded(()=>openInspection()));
$('review-form').addEventListener('submit',event=>{event.preventDefault();guarded(async()=>{
  const record=await run('review',{inspectionId:loadedInspection.id,mapping:mappingInput(),reviewer:$('reviewer').value,note:$('review-note').value});
  $('review').value=record.id;await openOperation(record.id);tell('SQL review saved as original review '+record.result.record_id+'.');});});
$('import-form').addEventListener('submit',event=>{event.preventDefault();guarded(async()=>{
  if(!$('review').value)throw new Error('Choose a saved complete SQL review.');
  const record=await run('import',{reviewId:$('review').value});
  await openOperation(record.id);tell('Complete edition '+record.result.result.version_id+' is retained in the original warehouse.');});});
$('report-form').addEventListener('submit',event=>{event.preventDefault();guarded(async()=>{
  if(!$('previous-import').value||!$('current-import').value)throw new Error('Select both imported periods of the same original table.');
  const record=await run('periodReport',{previousImportId:$('previous-import').value,currentImportId:$('current-import').value,title:$('report-title').value});
  await openOperation(record.id);tell('Full period report retained: '+record.report.bytes+' bytes.');});});
document.addEventListener('click',event=>{
  const target=event.target.closest('button');if(!target||busy)return;
  if(target.dataset.operation)guarded(()=>openOperation(target.dataset.operation));
  else if(target.dataset.resume)guarded(async()=>{const record=await request('/api/warehouse/resume',{requestId:target.dataset.resume});await refresh();await openOperation(record.id);tell('Original request '+record.id+' reopened.');});
  else if(target.dataset.downloadHash)guarded(()=>download({kind:'source',hash:target.dataset.downloadHash,name:target.dataset.downloadName}));
  else if(target.dataset.exportId)guarded(()=>download({kind:'export',id:target.dataset.exportId,path:target.dataset.exportPath}));
  else if(target.dataset.pending)guarded(async()=>{
    const original=pending[target.dataset.pending];if(!original)throw new Error('The retained request is no longer in this browser.');
    const result=await run(original.action,{},original.body);
    if(original.action==='prepare'){$('approval').value=result.id;renderApproval(result);}else await openOperation(result.id);
    tell('Original saved request reconciled.');});
});
for(const [link,path]of [[$('field-link'),'/'],[$('commissioning-link'),'/commissioning/']])
  link.href=path+(token?'#token='+encodeURIComponent(token):'');
guarded(async()=>{await refresh();if(!token)throw new Error('Open the original private warehouse link supplied by this host.');});
