// MIT. Returned workbook review inside the original Customer task outcomes desk.
import {createOutcomeWorkbook,receiveOutcomeWorkbook,reconcileOutcomeWorkbook,validateOutcomeWorkbookReturn,
  workbookUpload,decodeWorkbookBytes,MAX_OUTCOMES_WORKBOOK_BYTES} from './task-outcomes-workbook.mjs';
const clone=value=>JSON.parse(JSON.stringify(value));
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const show=value=>value?.present?JSON.stringify(value.value,null,2):'(absent)';
const action=(label,name,disabled=false)=>'<button type="button" data-task-wb="'+name+'"'+(disabled?' data-fixed="true" disabled':'')+'>'+esc(label)+'</button>';
function download(value,name,type){
  const blob=value instanceof Blob?value:new Blob([value],{type}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function valueCell(value){return '<details><summary>'+esc(value?.present?typeof value.value==='string'?value.value.slice(0,140):JSON.stringify(value.value).slice(0,140):'(absent)')+
  '</summary><pre>'+esc(show(value))+'</pre></details>';}
export function createOutcomeWorkbookDesk(context){
  const {root}=context;
  const draft=()=>context.getDraft(),current=()=>context.getCurrent(),session=context.session;
  const state=()=>draft()?.workbook;
  const nativeReceived=new WeakSet();
  const opts=()=>({caseId:current().program.id,originCaseId:current().program.origin?.programId,
    planContentSha256:current().plan.contentSha256});
  const persist=()=>context.persist();
  const repaint=()=>{persist();if(context.available())context.render();};
  function plan(){
    const d=draft(),s=state();if(!d||!s?.received)return null;
    return reconcileOutcomeWorkbook(s.received,d.inputs,s.choices||{});
  }
  function render(){
    const d=draft(),s=state(),inputs=context.getInputs();
    let out='<section class="task-workbook"><h4>Customer measurement workbook</h4>'+
      '<p>Export all comparison, recurring, work and cost fields. Receive the complete returned XLSX, review its changes against this draft, then use the original comparison preview and save.</p>'+
      '<div class="task-actions">'+action('Download editable workbook','export',!inputs)+
      action('Download workbook and original input','export-kit',!inputs)+action('Receive returned workbook','choose',!d||!context.editable()||Boolean(session.pending||session.pendingWorkbook))+'</div>'+
      '<input hidden type="file" data-task-wb-file accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">';
    if(session.pendingWorkbook)out+='<div class="task-pending"><strong>Original workbook source request retained</strong><p>'+
      esc(session.pendingWorkbook.request.requestId)+'</p>'+action('Recover original workbook source','recover')+'</div>';
    if(!s?.received)return out+'</section>';
    const source=s.received.source;
    out+='<p><strong>Returned source:</strong> '+esc(source.filename)+' · '+esc(source.bytes)+' bytes · '+esc(source.sha256)+
      '</p><div class="task-actions">'+action('Download original returned XLSX','source')+action('Download complete workbook review','review-download')+'</div>'+
      '<label>Workbook source / review note<textarea data-task-wb-note data-editor="true" rows="3">'+esc(s.note||'')+'</textarea></label>';
    if(s.sourceReceipt)out+='<p>Original source retained in this case: '+esc(s.sourceReceipt.id)+' · case version '+esc(s.sourceReceipt.version)+'.</p>';
    let reviewed;try{reviewed=plan();}catch(error){return out+'<p role="alert">'+esc(error.message)+'</p>'+action('Review current draft again','refresh-review')+'</section>';}
    if(s.appliedSignature&&s.appliedSignature===JSON.stringify(d.inputs))out+='<p>The reviewed workbook is applied to this draft. Calculate the native comparison preview and save its next edition.</p>';
    out+='<p>'+reviewed.changes.length+' proposed field or row changes · '+reviewed.conflicts.length+' conflicting fields · '+
      reviewed.unresolved+' choices remaining. Existing rows omitted from a return stay in the draft.</p>';
    const page=Math.max(0,Math.min(s.page||0,Math.max(0,Math.ceil(reviewed.changes.length/25)-1)));
    s.page=page;
    out+='<div class="task-table"><table><thead><tr><th>Field / original row</th><th>Current</th><th>Reviewed return</th></tr></thead><tbody>'+
      reviewed.changes.slice(page*25,(page+1)*25).map(row=>'<tr><th>'+esc(row.path)+'</th><td>'+valueCell(row.before)+'</td><td>'+valueCell(row.after)+'</td></tr>').join('')+
      '</tbody></table></div><div class="task-actions">'+action('Previous changes','previous',page===0)+
      '<span>Change page '+(page+1)+' of '+Math.max(1,Math.ceil(reviewed.changes.length/25))+'</span>'+
      action('Next changes','next',(page+1)*25>=reviewed.changes.length)+'</div>';
    if(reviewed.conflicts.length)out+='<h5>Resolve concurrent edits</h5><div class="task-table"><table><thead><tr><th>Field / original row</th><th>Original export</th><th>Current desk</th><th>Returned workbook</th><th>Keep</th></tr></thead><tbody>'+
      reviewed.conflicts.map(row=>'<tr><th>'+esc(row.path)+'</th><td>'+valueCell(row.original)+'</td><td>'+valueCell(row.current)+'</td><td>'+valueCell(row.returned)+'</td><td>'+
        '<select data-task-wb-choice="'+esc(row.path)+'" data-editor="true"><option value="">Choose</option><option value="current"'+(row.choice==='current'?' selected':'')+
        '>Current desk</option><option value="returned"'+(row.choice==='returned'?' selected':'')+'>Returned workbook</option></select></td></tr>').join('')+'</tbody></table></div>';
    const sheet=s.received.projections.find(row=>row.sheet===s.sheet)||s.received.projections[0];
    const projected=JSON.parse(sheet.projection.text),rows=projected.rows;
    const sourcePage=Math.max(0,Math.min(s.sourcePage||0,Math.max(0,Math.ceil(rows.length/20)-1)));
    s.sourcePage=sourcePage;
    out+='<details><summary>Complete worksheet selections and original cell references</summary><label>Worksheet <select data-task-wb-sheet>'+
      s.received.projections.map(row=>'<option value="'+esc(row.sheet)+'"'+(row.sheet===sheet.sheet?' selected':'')+'>'+esc(row.sheet)+'</option>').join('')+
      '</select></label><p>Selected worksheet '+esc(projected.mapping.plan.range)+' · '+rows.length+' source rows. Page '+(sourcePage+1)+' of '+Math.max(1,Math.ceil(rows.length/20))+'.</p>'+
      '<div class="task-table"><table><thead><tr><th>Original row</th>'+projected.mapping.plan.columns.map(col=>'<th>'+esc(col.name)+'</th>').join('')+'</tr></thead><tbody>'+
      rows.slice(sourcePage*20,(sourcePage+1)*20).map(row=>'<tr><th>'+esc(row.row)+'</th>'+row.cells.map(cell=>'<td>'+valueCell({present:true,value:cell.output})+
        '<small>'+esc(cell.original.cell)+'</small></td>').join('')+'</tr>').join('')+'</tbody></table></div>'+
      '<div class="task-actions">'+action('Previous source rows','source-previous',sourcePage===0)+
      action('Next source rows','source-next',(sourcePage+1)*20>=rows.length)+'</div></details>';
    out+='<div class="task-actions">'+action('Apply reviewed measurements','apply',!context.editable()||Boolean(session.pending||session.pendingWorkbook)||reviewed.unresolved>0||!s.note?.trim())+
      action('Review current draft again','refresh-review')+'</div></section>';
    return out;
  }
  async function exportWorkbook(kit){
    const inputs=context.getInputs();if(!inputs)throw Error('Open an original comparison or working draft.');
    const d=draft(),value=await createOutcomeWorkbook(inputs,{...opts(),unsavedFollowupIds:d?.unsavedFollowupIds||[]});
    download(kit?value.kit.data:value.workbook.data,kit?value.kit.filename:value.workbook.filename,
      kit?'application/zip':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    context.notify('Complete editable workbook downloaded with its original comparison and exact-text values.');
  }
  async function receive(file){
    const d=draft();if(!d||!context.editable())throw Error('Open the original editable comparison first.');
    if(session.pending||session.pendingWorkbook)throw Error('Recover the retained original request first.');
    if(file.size<=0||file.size>MAX_OUTCOMES_WORKBOOK_BYTES)throw Error('Choose the complete XLSX within the original 8 MiB case-source allowance.');
    const id=d.inputs.id,signature=JSON.stringify(d.inputs),upload=await workbookUpload(file.name,new Uint8Array(await file.arrayBuffer()));
    const received=await receiveOutcomeWorkbook(upload,{...opts(),
      inspectWorkbook:body=>context.api('/api/source-tables/workbook/inspect',body),
      projectWorkbook:body=>context.api('/api/source-tables/workbook/project',body)});
    if(!context.available())return;
    if(draft()!==d||d.inputs.id!==id||JSON.stringify(d.inputs)!==signature)throw Error('The selected draft changed while the workbook was read. Receive it against the current original draft.');
    if(received.baseInputs.id!==id)throw Error('This workbook belongs to another comparison. Open that original comparison first.');
    d.workbook={received,choices:{},note:'',page:0};nativeReceived.add(d.workbook);
    delete d.preview;delete d.previewSignature;repaint();
    context.notify('Complete returned workbook retained. Review the changes and any concurrent edits before applying.');
  }
  function addSource(inputs,id){
    const result=clone(inputs),document=result.document;
    for(const method of [document.baseline,document.installed,...(document.followups||[]).map(row=>row.method)])
      if(!method.sourceIds.includes(id))method.sourceIds.push(id);
    return result;
  }
  function applyToDraft(d,reviewed,sourceId){
    const s=d.workbook;
    s.appliedReview={beforeInputs:clone(d.inputs),reviewedInputs:clone(reviewed.inputs),choices:clone(s.choices||{}),
      sourceId,appliedAt:new Date().toISOString()};
    d.inputs=addSource(reviewed.inputs,sourceId);
    d.unsavedFollowupIds=[...new Set([...(d.unsavedFollowupIds||[]),...reviewed.unsavedFollowupIds])]
      .filter(id=>(d.inputs.document.followups||[]).some(row=>row.id===id));
    s.choices={};s.page=0;s.appliedSignature=JSON.stringify(d.inputs);delete d.preview;delete d.previewSignature;
  }
  async function completeSource(pending){
    if(pending.caseId!==current().program.id)throw Error('Recover this source request in its original case.');
    let result;
    try{result=await context.saveApi('/api/operations/'+current().program.id+'/command',pending.request);}
    catch(error){
      if(context.terminalRejection(error)&&session.pendingWorkbook===pending){session.pendingWorkbook=null;persist();}
      throw error;
    }
    if(!result?.recordId)throw Error('The source response has no original source identity. Recover this same retained request.');
    const d=session.drafts[pending.comparisonId];
    if(!d?.workbook||d.workbook.received.source.sha256!==pending.sourceSha256)
      throw Error('The original source is saved; retain this request until its original workbook draft is reopened.');
    d.workbook.sourceReceipt={id:result.recordId,version:result.version,requestId:pending.request.requestId,sha256:pending.sourceSha256};
    session.pendingWorkbook=null;persist();
    if(!context.available())return;
    await context.reload();if(!context.available())return;
    const metadata=current().sources.find(row=>row.id===result.recordId);
    if(!metadata||metadata.sha256!==pending.sourceSha256)throw Error('Reopen the original case to receive the matching saved workbook source.');
    if(JSON.stringify(d.inputs)===pending.draftSignature){
      applyToDraft(d,{inputs:pending.reviewedInputs,unsavedFollowupIds:pending.unsavedFollowupIds},result.recordId);
      session.notice='Reviewed workbook measurements applied; calculate the native comparison preview and save the next edition.';
    }else session.notice='Original workbook source saved. This draft also changed; review those changes before applying the retained source.';
    persist();if(context.available())context.render();
    if(context.available()&&context.onCase)await context.onCase(current(),result);
  }
  async function apply(){
    const d=draft(),s=state();if(!d||!s?.received||!context.editable())throw Error('Open the complete returned-workbook review.');
    if(session.pending||session.pendingWorkbook)throw Error('Recover the original pending request first.');
    if(!s.note?.trim())throw Error('Enter the original workbook source and review note.');
    await validateOutcomeWorkbookReturn(s.received,opts());
    if(!nativeReceived.has(s)){
      const replay=await receiveOutcomeWorkbook(s.received.source,{...opts(),receivedAt:s.received.receivedAt,
        inspectWorkbook:body=>context.api('/api/source-tables/workbook/inspect',body),
        projectWorkbook:body=>context.api('/api/source-tables/workbook/project',body)});
      if(!equal(replay.baseInputs,s.received.baseInputs)||!equal(replay.returnedInputs,s.received.returnedInputs))
        throw Error('The recovered workbook review differs from the original file. Receive that file again.');
      s.received=replay;nativeReceived.add(s);
    }
    const reviewed=plan();if(reviewed.unresolved)throw Error('Resolve each conflicting field before applying.');
    context.validateInput(reviewed.inputs);
    if(s.sourceReceipt){
      const metadata=current().sources.find(row=>row.id===s.sourceReceipt.id);
      if(!metadata||metadata.sha256!==s.received.source.sha256)throw Error('Reopen the original case to receive its saved workbook source.');
      applyToDraft(d,reviewed,metadata.id);repaint();
      context.notify('Reviewed measurements applied to the same draft. Calculate the native preview and save the next edition.');return;
    }
    const source=s.received.source;
    if(current().sources.length>=200||current().sources.reduce((sum,row)=>sum+row.bytes,0)+source.bytes>24*1024*1024)
      throw Error('The original case source allowance is full. Keep this complete review and use the existing case source/receiving workflow.');
    const request={expectedVersion:current().program.version,actor:context.recordingActor(),note:s.note,
      action:'source.add',data:{filename:source.filename,contentBase64:source.dataBase64,kind:'other',
        mediaType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',sourceUrl:'',observedAt:s.received.receivedAt}};
    request.requestId=await context.mutationId('task-outcomes-workbook:'+current().program.id,request);
    const pending={caseId:current().program.id,request,comparisonId:d.inputs.id,sourceSha256:source.sha256,
      draftSignature:JSON.stringify(d.inputs),reviewedInputs:clone(reviewed.inputs),unsavedFollowupIds:reviewed.unsavedFollowupIds};
    session.pendingWorkbook=pending;persist();if(context.available())context.render();
    await completeSource(pending);
  }
  async function recoverDraftWorkbook(value,inputs){
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Retain the complete returned workbook review.');
    const received=await validateOutcomeWorkbookReturn(value.received,opts());
    if(received.baseInputs.id!==inputs.id)throw Error('The workbook belongs to another original comparison.');
    if(typeof value.note!=='string'||value.note.length>16000)throw Error('Retain the original workbook review note.');
    const choices=value.choices||{};
    reconcileOutcomeWorkbook(received,inputs,choices);
    const result={received,choices:clone(choices),note:value.note,page:Number.isSafeInteger(value.page)&&value.page>=0?value.page:0};
    if(value.sourceReceipt){
      const r=value.sourceReceipt;
      if(typeof r.id!=='string'||!Number.isSafeInteger(r.version)||r.version<1||r.sha256!==received.source.sha256||typeof r.requestId!=='string')
        throw Error('Retain the original workbook source receipt.');
      result.sourceReceipt=clone(r);
    }
    if(value.appliedReview){
      const applied=value.appliedReview;
      context.validateInput(applied.beforeInputs);context.validateInput(applied.reviewedInputs);
      if(applied.beforeInputs.id!==inputs.id||applied.reviewedInputs.id!==inputs.id||
         applied.sourceId!==result.sourceReceipt?.id||typeof applied.appliedAt!=='string')
        throw Error('Retain the complete applied workbook review and original source identity.');
      const historical=reconcileOutcomeWorkbook(received,applied.beforeInputs,applied.choices||{});
      if(historical.unresolved||!equal(historical.inputs,applied.reviewedInputs)||
         value.appliedSignature!==JSON.stringify(addSource(applied.reviewedInputs,applied.sourceId)))
        throw Error('The completed workbook review differs from its original explicit choices.');
      result.appliedReview=clone(applied);result.appliedSignature=value.appliedSignature;
    }
    return result;
  }
  function recoverPending(value,drafts){
    if(!value)return null;
    const d=drafts[value.comparisonId],s=d?.workbook,request=value.request;
    if(value.caseId!==current().program.id||!s?.received||value.sourceSha256!==s.received.source.sha256||
       typeof value.draftSignature!=='string'||typeof request?.requestId!=='string'||!request.requestId||
       !Number.isSafeInteger(request.expectedVersion)||request.expectedVersion<0||
       typeof request.actor!=='string'||!request.actor.trim()||typeof request.note!=='string'||
       request.action!=='source.add'||request.data?.contentBase64!==s.received.source.dataBase64||
       request.data.filename!==s.received.source.filename||request.data.kind!=='other'||
       request.data.mediaType!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'||
       request.data.sourceUrl!==''||request.data.observedAt!==s.received.receivedAt)
      throw Error('Recover the complete retained workbook source request in its original case.');
    context.validateInput(value.reviewedInputs);
    if(value.reviewedInputs.id!==value.comparisonId||!Array.isArray(value.unsavedFollowupIds)||
       value.unsavedFollowupIds.some(id=>!(value.reviewedInputs.document.followups||[]).some(row=>row.id===id)))
      throw Error('Retain the source request and its original reviewed comparison.');
    const reviewed=reconcileOutcomeWorkbook(s.received,JSON.parse(value.draftSignature),s.choices||{});
    if(reviewed.unresolved||!equal(reviewed.inputs,value.reviewedInputs)||!equal(reviewed.unsavedFollowupIds,value.unsavedFollowupIds))
      throw Error('The pending source request differs from its original reviewed workbook.');
    return clone(value);
  }
  const onClick=event=>{
    const element=event.target.closest('[data-task-wb]');if(!element||element.disabled)return;
    const name=element.dataset.taskWb;
    if(name==='choose'){root.querySelector('[data-task-wb-file]')?.click();return;}
    void context.run(async()=>{
      if(name==='export'||name==='export-kit'){await exportWorkbook(name==='export-kit');return;}
      if(name==='recover'){if(session.pendingWorkbook){recoverPending(session.pendingWorkbook,session.drafts);await completeSource(session.pendingWorkbook);}return;}
      const s=state();if(!s?.received)return;
      if(name==='apply'){await apply();return;}
      if(name==='source'){
        const data=decodeWorkbookBytes(s.received.source.dataBase64);
        download(data,s.received.source.filename,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');return;
      }
      if(name==='review-download'){
        download(JSON.stringify(s,null,2)+'\n',s.received.baseInputs.id+'-workbook-review.json','application/json');return;
      }
      if(name==='source-previous')s.sourcePage=Math.max(0,(s.sourcePage||0)-1);
      if(name==='source-next')s.sourcePage=(s.sourcePage||0)+1;
      if(name==='previous')s.page=Math.max(0,(s.page||0)-1);
      if(name==='next')s.page=(s.page||0)+1;
      if(name==='refresh-review'){s.choices={};s.page=0;}
      repaint();
    });
  };
  const onChange=event=>{
    const file=event.target.matches('[data-task-wb-file]')?event.target.files?.[0]:null;
    if(file){void context.run(()=>receive(file));return;}
    if(event.target.matches('[data-task-wb-sheet]')&&state()){
      state().sheet=event.target.value;state().sourcePage=0;repaint();return;
    }
    if(event.target.dataset.taskWbChoice!==undefined){
      const s=state();if(!s)return;s.choices||={};
      if(event.target.value)s.choices[event.target.dataset.taskWbChoice]=event.target.value;
      else delete s.choices[event.target.dataset.taskWbChoice];
      repaint();
    }
  };
  const onInput=event=>{if(event.target.matches('[data-task-wb-note]')&&state()){
    state().note=event.target.value;persist();
    const button=root.querySelector('[data-task-wb="apply"]');let disabled=true;
    try{disabled=!context.editable()||Boolean(session.pending||session.pendingWorkbook)||plan().unresolved>0||!state().note.trim();}catch{}
    if(button){if(disabled)button.dataset.fixed='true';else delete button.dataset.fixed;}
    context.controls();
  }};
  root.addEventListener('click',onClick);root.addEventListener('change',onChange);root.addEventListener('input',onInput);
  return {render,recoverDraftWorkbook,recoverPending,dispose(){root.removeEventListener('click',onClick);root.removeEventListener('change',onChange);root.removeEventListener('input',onInput);}};
}
