/** Review saved field records and return them through the original campaign queue. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>JSON.parse(JSON.stringify(value));
const FORMAT='upstate.monitoring-field-return/v1';
export function attachMonitoringFieldReturn(host){
 let panel=null,workspace=null,generation=0;
 const states=new Map(),busy=new Set();
 const current=(key,turn)=>panel&&workspace===key&&host.getState()?.workspace_key===key&&generation===turn;
 const state=key=>{
  if(!states.has(key)){
   let saved=null;try{saved=JSON.parse(sessionStorage.getItem('eco-monitoring-field-return:'+key)||'null');}catch{}
   states.set(key,saved?.schema===FORMAT?saved:{schema:FORMAT,campaign_id:'',revision_id:'',rows:[],times:{},selected:null,preview:null,result:null,stage:'selecting'});
  }
  return states.get(key);
 };
 function save(key){try{sessionStorage.setItem('eco-monitoring-field-return:'+key,JSON.stringify(state(key)));}catch{}}
 function invalidate(s){s.stage='selecting';s.result=null;if(s.preview)s.preview={...s.preview,can_return:false};}
 function render(){
  if(!panel||!workspace)return;
  const s=state(workspace),waiting=busy.has(workspace),p=s.preview;
  let html='<h2>Return field records to the campaign</h2><p>Review the original saved fieldwork revision, select actual completed records, and update the campaign with its source stations and original sample identities.</p>'+
   '<label>Saved campaign <select data-field-return-campaign '+(waiting?'disabled':'')+'><option value="">Choose a campaign</option>'+
   (s.campaigns||[]).map(row=>'<option value="'+esc(row.campaign_id)+'" '+(row.campaign_id===s.campaign_id?'selected':'')+'>'+esc(row.title)+' · revision '+esc(row.revision)+'</option>').join('')+'</select></label> '+
   '<button type="button" data-field-return-action="refresh" '+(waiting?'disabled':'')+'>Refresh campaigns</button> '+
   '<button type="button" data-field-return-action="preview" '+(waiting||!s.campaign_id?'disabled':'')+'>Review saved field records</button>';
  if(p){
   html+='<p>Fieldwork revision '+esc(p.selection.plan_revision)+' · '+esc(p.rows.filter(row=>row.selected).length)+' selected entries. Campaign source '+esc(p.selection.expected_revision_id.slice(0,12))+'.</p>'+
    '<div class="table-scroll"><table><thead><tr><th>Return</th><th>Original visit / sample</th><th>Event / actual time</th><th>Original evidence</th><th>Review</th></tr></thead><tbody>';
   for(const row of p.rows){
    const cancelled=row.status==='cancelled';
    html+='<tr><td><input type="checkbox" data-field-return-entry="'+esc(row.entry_id)+'" aria-label="Return '+esc(row.entry_id)+'" '+(row.selected?'checked':'')+' '+(waiting||!row.available?'disabled':'')+'></td>'+
     '<td>'+esc(row.visit_key)+'<br>'+esc(row.sample_id||row.entry_id)+'</td><td>'+esc(row.status)+'<br>'+esc(row.occurred_at||'Actual timestamp required')+
     (cancelled?'<label>Cancellation time including timezone <input type="text" data-field-return-time="'+esc(row.visit_id)+'" value="'+esc(s.times[row.visit_id]||row.occurred_at||'')+'" placeholder="YYYY-MM-DDThh:mm:ss±hh:mm" '+(waiting?'disabled':'')+'></label>':'')+
     '</td><td>'+esc(row.observation_count||0)+' saved observation records'+
     (row.payload?'<details><summary>Original field evidence and units</summary><pre>'+esc(JSON.stringify(row.payload.values.fieldwork_evidence,null,2))+'</pre></details>':'')+
     '</td><td>'+esc(row.action.replaceAll('_',' '))+(row.issues?.length?'<p>'+esc(row.issues.join('; '))+'</p>':'')+'</td></tr>';
   }
   html+='</tbody></table></div><p>Selected records retain their actual timestamps, original sample IDs, measurement values, units and field revision. A completed visit without a sample returns as a visit note. Campaign sample status requires an actual collected sample.</p>'+
    '<button type="button" data-field-return-action="apply" '+(waiting||s.stage!=='review'||!p.can_return?'disabled':'')+'>Return reviewed records</button>';
   if(s.stage==='selecting')html+='<p>Review the changed selection again before returning it.</p>';
  }
  if(s.result){
   const r=s.result,href=r.campaign_report?.download_url;
   html+='<p>Returned '+esc(r.events.length)+' field records. Campaign revision '+esc(r.campaign_revision_id.slice(0,12))+' and fieldwork revision '+esc(r.fieldwork.revision)+' are retained together.</p>'+
    '<button type="button" data-field-return-action="open">Open saved fieldwork</button> '+
    (typeof href==='string'&&href.startsWith('/api/file/')?'<a href="'+esc(href)+'">Download campaign report</a>':'');
  }
  html+='<p role="status">'+esc(waiting?'The original native operation is running.':s.message||'')+'</p>';
  if(s.error)html+='<p role="alert">'+esc(s.error)+'</p>';
  panel.innerHTML=html;
 }
 async function refresh(){
  if(!panel||busy.has(workspace))return;
  const key=workspace,turn=generation,s=state(key);
  const rows=await host.transport(key,'campaign.list',{});
  if(!current(key,turn)||busy.has(key))return;
  s.campaigns=rows;
  if(s.campaign_id&&!s.preview&&!s.result)s.revision_id=rows.find(row=>row.campaign_id===s.campaign_id)?.id||'';
  save(key);render();
 }
 async function preview(){
  const key=workspace,turn=generation,s=state(key);if(busy.has(key))return;
  if(!s.campaign_id||!s.revision_id)throw Error('Choose the original saved campaign.');
  busy.add(key);s.error='';render();
  try{
   const args={campaign_id:s.campaign_id,expected_revision_id:s.revision_id,event_times:s.times};
   if(s.selected!==null)args.selected_entry_ids=s.selected;
   const result=await host.transport(key,'campaign.fieldwork.preview-return',args);
   if(!current(key,turn))return;
   if(result.schema!=='upstate.monitoring-field-return-preview/v1'||result.workspace_key!==key||
      result.selection.campaign_id!==s.campaign_id||result.selection.expected_revision_id!==s.revision_id||
      !result.request_id||!Array.isArray(result.rows))throw Error('The preview differs from the selected original campaign.');
   s.preview=result;s.selected=[...result.selection.selected_entry_ids];s.stage='review';s.result=null;s.message='';
   save(key);
  }catch(error){s.error=error.message;s.stage='selecting';save(key);throw error;}
  finally{busy.delete(key);if(current(key,turn))render();}
 }
 async function apply(){
  const key=workspace,turn=generation,s=state(key),p=s.preview;
  if(busy.has(key))return;
  if(!p||s.stage!=='review'||!p.can_return)throw Error('Review the exact saved records and selection first.');
  const selection=p.selection;
  const args={campaign_id:selection.campaign_id,expected_revision_id:selection.expected_revision_id,
   plan_revision:selection.plan_revision,selected_entry_ids:selection.selected_entry_ids,
   event_times:selection.event_times,expected_request_id:p.request_id};
  busy.add(key);s.error='';s.stage='returning';save(key);render();
  try{
   const result=await host.transport(key,'campaign.fieldwork.return',args);
   if(result.schema!==FORMAT||result.request_id!==p.request_id||result.workspace_key!==key||
      result.source_plan_id!==selection.plan_id||result.source_plan_revision!==selection.plan_revision||
      result.source_document_digest!==selection.document_digest||result.campaign_id!==selection.campaign_id||
      result.state!=='complete')throw Error('The completed return differs from its reviewed source selection.');
   s.result=result;s.preview=null;s.selected=null;s.times={};s.stage='complete';
   s.revision_id=result.campaign_revision_id;s.message='Original events, campaign report and refreshed fieldwork are ready.';save(key);
  }catch(error){s.error=error.message;s.stage='review';save(key);throw error;}
  finally{busy.delete(key);if(current(key,turn))render();}
 }
 async function open(){
  const key=workspace,r=state(key).result;
  if(!r||host.getState()?.workspace_key!==key)return;
  await host.openDesk('implementation','openSavedPlan',{workspace_key:key,plan_id:r.fieldwork.plan_id,revision:r.fieldwork.revision});
 }
 function fail(error,key=workspace,turn=generation){if(!current(key,turn))return;state(key).error=error.message;save(key);render();host.toast?.(error.message);}
 async function click(event){
  const button=event.target.closest('[data-field-return-action]');if(!button||!panel?.contains(button))return;
  const action=button.dataset.fieldReturnAction;
  if(action==='refresh'){const s=state(workspace);if(!busy.has(workspace)){s.preview=null;s.selected=null;s.result=null;s.times={};s.stage='selecting';await refresh();}}
  if(action==='preview')await preview();
  if(action==='apply')await apply();
  if(action==='open')await open();
 }
 function change(event){
  if(!panel||busy.has(workspace))return;
  const t=event.target,s=state(workspace);
  if(t.matches('[data-field-return-campaign]')){
   s.campaign_id=t.value;s.revision_id=s.campaigns.find(row=>row.campaign_id===t.value)?.id||'';
   s.preview=null;s.result=null;s.selected=null;s.times={};s.stage='selecting';s.error='';s.message='';
  }else if(t.dataset.fieldReturnEntry){
   const chosen=new Set(s.selected||[]);t.checked?chosen.add(t.dataset.fieldReturnEntry):chosen.delete(t.dataset.fieldReturnEntry);
   s.selected=[...chosen];invalidate(s);
   if(s.preview)s.preview.rows=s.preview.rows.map(row=>({...row,selected:chosen.has(row.entry_id)}));
  }else if(t.dataset.fieldReturnTime){
   s.times[t.dataset.fieldReturnTime]=t.value.trim();s.selected=null;invalidate(s);
  }else return;
  save(workspace);render();
 }
 async function mount(root,key){
  generation++;workspace=key;panel?.remove();
  panel=root.ownerDocument.createElement('section');panel.className='monitoring-fieldwork-return';
  panel.setAttribute('aria-label','Return field records');root.prepend(panel);
  panel.addEventListener('click',event=>{const key=workspace,turn=generation;return click(event).catch(error=>fail(error,key,turn));});panel.addEventListener('change',change);
  panel.addEventListener('input',event=>{if(!event.target.dataset.fieldReturnTime||busy.has(workspace))return;const s=state(workspace);s.times[event.target.dataset.fieldReturnTime]=event.target.value.trim();s.selected=null;invalidate(s);save(workspace);});
  const s=state(key);if(s.stage==='returning')s.stage='review';
  const turn=generation;render();try{await refresh();}catch(error){fail(error,key,turn);}
 }
 function detach(){generation++;panel?.remove();panel=null;workspace=null;}
 return {mount,update:refresh,detach};
}
