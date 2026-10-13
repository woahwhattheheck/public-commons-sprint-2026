import {clone,esc} from './implementation_core.mjs';
const button=(action,label,disabled=false)=>'<button type="button" data-impl="briefing-'+action+'" '+(disabled?'disabled':'')+'>'+esc(label)+'</button>';
const busy=s=>['uploading','opening','saving','previewing','importing'].includes(s?.stage);
function active(w,s=w.briefingIntake){
 if(!w.native||w.gone||w.host.getState?.()?.workspace_key!==w.workspace)throw Error('Open briefing follow-up in its original workspace.');
 if(!s||s.plan_id!==w.plan?.id)throw Error('Open the selected working plan first.');
 return s;
}
function editable(w){const s=active(w);if(w.pending||busy(s))throw Error('Finish the retained operation before changing this selection.');return s;}
function current(w,s,turn){return !w.gone&&w.briefingIntake===s&&w.generation===turn&&w.plan?.id===s.plan_id&&w.host.getState?.()?.workspace_key===w.workspace;}
function changed(w,s){s.preview=null;s.stage='selecting';s.result=null;s.operation_id=null;w.cache();}
function payload(w,s){
 const out={plan_id:w.plan.id,revision:w.plan.revision,notes_upload_id:s.notes?.id};
 if(s.mode==='saved'){if(s.delivery_id.startsWith('source-context:'))out.source_export_id=s.delivery_id.slice(15);else out.delivery_id=s.delivery_id;}
 else{out.report_upload_id=s.report?.id;out.index_upload_id=s.index?.id;}
 if(s.selected_entry_ids!==null)out.selected_entry_ids=s.selected_entry_ids;
 return out;
}
async function post(w,name,value){return w.host.api('/api/implementation/'+name,{method:'POST',body:{workspace:w.workspace,...value}});}
function canApply(w){
 const s=w.briefingIntake,p=s?.preview;
 return !!(p&&s.stage==='review'&&p.can_import&&!w.dirty&&w.nativePlan&&
 p.plan_id===w.plan.id&&p.revision===w.plan.revision&&p.workspace_key===w.workspace&&
 p.operation_id&&p.document_digest);
}
function render(w){
 if(!w.native)return '';
 const s=w.briefingIntake;
 if(!s)return '<section class="iw-notice"><h3>Follow up a report review</h3><p>Receive original client-briefing meeting notes, select their actions, and retain the report page beside editable work.</p>'+button('open','Receive briefing follow-up')+'</section>';
 const disabled=busy(s)||!!w.pending;
 const file=(role,label)=>'<label class="iw-field"><span>'+esc(label)+'</span><input type="file" accept=".json,application/json" data-briefing-file="'+role+'" '+(disabled?'disabled':'')+'><small>'+esc(s[role]?.filename||'Choose original JSON')+'</small></label>';
 let out='<section class="iw-notice"><div class="iw-section-head"><h3>Report review follow-up</h3>'+button('close','Close receiving form',disabled)+'</div><p>The original report and page index identify each note. Due dates remain source deadlines; working durations and costs are entered separately.</p>'+
 '<label class="iw-field"><span>Original report</span><select data-briefing-field="mode" '+(disabled?'disabled':'')+'><option value="saved" '+(s.mode==='saved'?'selected':'')+'>Saved report in this workspace</option><option value="uploaded" '+(s.mode==='uploaded'?'selected':'')+'>Report from an exported delivery</option></select></label>';
 if(s.mode==='saved')out+='<label class="iw-field"><span>Saved report or utility source briefing</span><select data-briefing-field="delivery_id" '+(disabled?'disabled':'')+'><option value="">Choose original report</option>'+(s.reports||[]).map(r=>'<option value="'+esc(r.choice_key||r.id)+'" '+((r.choice_key||r.id)===s.delivery_id?'selected':'')+' '+(!r.available?'disabled':'')+'>'+esc(r.title+(r.available?'':' — '+r.reason))+'</option>').join('')+'</select></label>'+button('refresh','Refresh saved reports',disabled);
 else out+=file('report','Original report model JSON')+file('index','Original briefing page index JSON');
 out+=file('notes','Exported meeting-notes JSON')+'<div class="iw-actions">'+button('preview',w.dirty||!w.nativePlan?'Save plan and preview follow-up':'Preview follow-up',disabled)+'</div>';
 const p=s.preview;
 if(p){
  out+='<h4>'+esc(p.meeting?.title||p.report_binding?.title||'Original meeting')+'</h4><p>'+esc(p.meeting?.date||'Date not entered')+' · '+esc(p.meeting?.participants||'Participants not entered')+'</p><p>'+esc(p.meeting?.purpose||'')+'</p><p>'+p.summary.selected_entries+' selected; '+p.summary.create+' new tasks; '+p.summary.update+' updated; '+p.summary.conflicts+' preserved local differences.</p>'+
  '<div class="iw-scroll"><table><thead><tr><th>Receive</th><th>Original entry / report page</th><th>Owner / source due date</th><th>Status</th><th>Working-plan change</th></tr></thead><tbody>'+
  p.rows.map(r=>'<tr><td><input type="checkbox" aria-label="Receive '+esc(r.entry_id)+'" data-briefing-entry="'+esc(r.entry_id)+'" '+(r.selected?'checked':'')+' '+(disabled?'disabled':'')+'></td><td><b>'+esc(r.kind)+'</b><p>'+esc(r.body)+'</p><small>'+esc(r.source_context?.slide?.title||r.source_context?.slide?.id||'')+'</small></td><td>'+esc(r.owner||'Unassigned')+'<br>'+esc(r.due||'No source due date')+'</td><td>'+esc(r.source_status)+'</td><td>'+esc(r.action.replaceAll('_',' '))+(r.preserved_fields?.length?'<br>Kept local: '+esc(r.preserved_fields.join(', ')):'')+'</td></tr>').join('')+'</tbody></table></div>'+
  '<p>Questions and decisions stay in the original notes. Select a row when it should also become work in this plan. Removing a selection keeps previously created work for explicit review.</p><div class="iw-actions">'+button('apply',p.already_received?'Reopen received follow-up':'Receive reviewed follow-up',!canApply(w))+button('export-preview','Download complete preview')+'</div>';
 }
 if(s.result)out+='<p>Received at native revision '+esc(s.result.applied_revision)+'. Original source files appear in Source register and native downloads; Work plan contains the editable tasks.</p>';
 return out+'</section>';
}
async function open(w){
 if(!w.native||w.pending)throw Error('Open an available native plan before receiving follow-up.');
 const s=w.briefingIntake||{plan_id:w.plan.id,stage:'selecting',mode:'saved',delivery_id:'',selected_entry_ids:null,reports:[]};
 w.briefingIntake=s;w.tab='sources';w.cache();w.render();await refresh(w);
}
async function refresh(w){
 const s=editable(w),turn=w.generation;s.stage='opening';w.cache();w.render();
 try{const r=await w.read('/api/implementation/briefing-catalog');if(!current(w,s,turn))return;
  if(!Array.isArray(r.reports))throw Error('The saved report catalogue is unavailable.');
  s.reports=r.reports;s.stage='selecting';w.cache();w.render();
 }catch(e){if(current(w,s,turn)){s.stage='selecting';w.cache();}throw e;}
}
async function preview(w){
 const s=editable(w);
 if(!s.notes?.id)throw Error('Choose the original exported meeting-notes JSON.');
 if(s.mode==='saved'?!s.delivery_id:!s.report?.id||!s.index?.id)throw Error('Choose the original report and its retained briefing page index.');
 if(w.dirty||!w.nativePlan){
  s.stage='saving';s.operation_id=null;w.cache();
  const action=w.importedFile?'implementation.plan.import':w.nativePlan?'implementation.plan.save':'implementation.plan.create';
  try{await w.queue(action,{document:w.plan,expected_revision:w.plan.revision});}catch(e){if(!w.pending){s.stage='selecting';w.cache();}throw e;}return;
 }
 const selected=clone(w.plan),turn=w.generation;s.stage='previewing';s.preview=null;w.cache();w.render();
 try{
  const r=await post(w,'briefing-preview',payload(w,s));if(!current(w,s,turn))return;
  if(w.dirty||JSON.stringify(w.plan)!==JSON.stringify(selected))throw Error('Save and preview the revised working plan.');
  if(r.schema!=='upstate.implementation-briefing-preview/v1'||r.workspace_key!==w.workspace||r.plan_id!==selected.id||r.revision!==selected.revision||!r.operation_id||!r.document_digest)throw Error('The preview differs from its selected source and saved plan.');
  s.preview=r;s.selected_entry_ids=[...r.selected_entry_ids];s.stage='review';w.cache();w.render();
 }catch(e){if(current(w,s,turn)){s.stage='selecting';s.preview=null;w.cache();}throw e;}
}
async function apply(w){
 const s=editable(w);if(!canApply(w))throw Error('Preview these original sources and the saved plan before receiving.');
 const p=s.preview;s.stage='importing';s.operation_id=null;w.cache();
 try{await w.queue('implementation.briefing.import',{...payload(w,s),document_digest:p.document_digest,briefing_operation_id:p.operation_id});}
 catch(e){if(!w.pending){s.stage='review';w.cache();}throw e;}
}
function validateReceipt(w,pending,r){
 if(r?.schema!=='upstate.implementation-briefing-import/v1'||r.workspace_key!==w.workspace||r.plan_id!==pending.plan_id||r.plan?.id!==pending.plan_id||r.operation_id!==pending.payload.briefing_operation_id||r.base_revision!==pending.payload.revision||r.base_document_digest!==pending.payload.document_digest||!Number.isSafeInteger(r.applied_revision))throw Error('The completed follow-up differs from its reviewed original operation.');
}
async function finish(w,pending,r){
 const s=w.briefingIntake;if(!s||s.operation_id!==pending.operation_id||s.plan_id!==pending.plan_id)return;
 if(pending.action==='implementation.briefing.import'){
  validateReceipt(w,pending,r);s.result=clone(r);s.preview=null;s.stage='complete';s.operation_id=null;w.cache();w.render();return;
 }
 if(s.stage==='saving'){s.operation_id=null;s.stage='selecting';w.cache();
  if(w.dirty){w.message='The saved revision is ready; retain or save later edits before previewing follow-up.';w.render();return;}
  await preview(w);
 }
}
async function act(w,b){
 const a=b.dataset.impl.slice(9);
 if(a==='open')return open(w);
 if(a==='close'){editable(w);w.briefingIntake=null;w.cache();w.render();return;}
 if(a==='refresh')return refresh(w);
 if(a==='preview')return preview(w);
 if(a==='apply')return apply(w);
 if(a==='export-preview'){
  const p=active(w).preview;if(!p)throw Error('Preview the selected notes first.');
  const url=URL.createObjectURL(new Blob([JSON.stringify(p,null,2)+'\n'],{type:'application/json'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=w.plan.id+'-briefing-follow-up.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
}
async function change(w,e){
 const t=e.target,s=editable(w);
 if(t.dataset.briefingFile){
  const role=t.dataset.briefingFile,file=t.files?.[0];if(!file)return;
  const limit=w.host.getState?.()?.limits?.upload_bytes;if(limit&&file.size>limit)throw Error('The original JSON exceeds the operator upload size.');
  const turn=w.generation;s.stage='uploading';s.preview=null;s.result=null;s[role]=null;if(role==='notes')s.selected_entry_ids=null;w.cache();w.render();
  try{const r=await w.host.api('/api/upload',{method:'POST',raw:file,filename:file.name});if(!current(w,s,turn))return;
   if(!r?.id||!r.sha256||r.bytes!==file.size)throw Error('The complete original upload identity was not returned.');
   s[role]=r;s.stage='selecting';w.cache();w.render();
  }catch(error){if(current(w,s,turn)){s.stage='selecting';w.cache();}throw error;}return;
 }
 if(t.dataset.briefingField){s[t.dataset.briefingField]=t.value;changed(w,s);w.render();return;}
 if(t.dataset.briefingEntry){
  const rows=s.preview?.rows||[],chosen=new Set(s.selected_entry_ids||rows.filter(r=>r.selected).map(r=>r.entry_id));
  if(t.checked)chosen.add(t.dataset.briefingEntry);else chosen.delete(t.dataset.briefingEntry);
  s.selected_entry_ids=[...chosen];s.stage='selecting';s.operation_id=null;
  if(s.preview){s.preview={...s.preview,can_import:false,rows:rows.map(r=>({...r,selected:chosen.has(r.entry_id)}))};}
  w.cache();w.render();
 }
}

export const briefingFollowup={render,act,change,validateReceipt,finish};
