import {currentStaffContext,staffDeskStorageKey,assertStaffRequestActor} from './staff-session.mjs';
import {workPreparationDraftStore} from './operations_work_intake.mjs';
import {createOperationsWorkbookArchive} from './source-workbook-export.mjs';

const FIELDS={
  WORK:['rowId','contributor','costId','description','startDate','endDate','hours','fundingBasis'],
  INVOICES:['rowId','invoiceId','contributor','number','issuedDate','dueDate','lineId','description','amountUsd','currency','costId','workIds']
};
const LABEL={rowId:'Row ID',invoiceId:'Invoice ID',contributor:'Contributor / supplier',costId:'Work package',
  description:'Description',startDate:'Work start',endDate:'Work end',hours:'Hours',fundingBasis:'Funding basis',
  number:'Invoice number',issuedDate:'Invoice date',dueDate:'Due date',lineId:'Line ID',amountUsd:'USD amount',currency:'Currency',workIds:'Native work IDs'};
const copy=v=>structuredClone(v);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const b64=buffer=>{let out='';const raw=new Uint8Array(buffer);for(let i=0;i<raw.length;i+=8192)out+=String.fromCharCode(...raw.subarray(i,i+8192));return btoa(out);};
const download=(data,name,type='application/json')=>{const url=URL.createObjectURL(data instanceof Blob?data:new Blob([data],{type}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};
const button=(name,action,value='',disabled=false)=>'<button type="button" data-wb-action="'+esc(action)+'" data-value="'+esc(value)+'"'+(disabled?' disabled data-fixed="true"':'')+'>'+esc(name)+'</button>';
const table=(headers,rows)=>'<div class="wb-table"><table><thead><tr>'+headers.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const options=(rows,value)=>rows.map(([id,name])=>'<option value="'+esc(id)+'"'+(id===value?' selected':'')+'>'+esc(name)+'</option>').join('');

export function mountWorkWorkbook({container,current,saveApi,session={},mutationId,recordingActor,onCase,onOpen,staffContext=currentStaffContext(),isCurrent=()=>true}){
  const pinned=staffContext?{...staffContext}:null;
  const storage=workPreparationDraftStore(staffDeskStorageKey('sf47-work-invoice-workbooks',pinned));
  const root=document.createElement('section');root.className='workbook-desk';root.setAttribute('aria-label','Work and invoice workbook');container.replaceChildren(root);
  if(!document.querySelector('link[data-workbook-style]')){const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./operations_workbook.css',import.meta.url).href;link.dataset.workbookStyle='true';document.head.append(link);}
  const s=session,caseId=current.program.id,base='/api/operations/'+caseId;
  let active=true,busy=false,hostBusy=false,caseView=current,books=[],selected=null,comparison=null,returnView=null,message='',error=false,page=0,tab='WORK',timer=null,storageConflict=false;
  s.selectedId??=null;s.drafts??={};s.pending??=null;s.lastRequest??=null;s.name??='Work and invoice preparation';s.note??='';
  s.editing??=null;s.upload??=null;s.returnDecisions??={};s.selections??={WORK:{lastRow:5001,hiddenRows:'include'},INVOICES:{lastRow:5001,hiddenRows:'include'}};
  s.storageVersion??=0;s.persistQueue??=Promise.resolve();
  const alive=()=>active&&root.isConnected&&isCurrent(),$=q=>root.querySelector(q);
  const draft=()=>s.drafts[s.selectedId];
  const editable=()=>selected&&selected.workbook.state==='DRAFT'&&!s.pending&&!storageConflict;
  const snapshot=()=>copy({schema:'stellar-forge.sf47-workbook-browser.v1',caseId,staff:pinned,
    selectedId:s.selectedId,drafts:s.drafts,pending:s.pending,lastRequest:s.lastRequest,name:s.name,note:s.note,
    upload:s.upload,returnDecisions:s.returnDecisions,selections:s.selections,editing:s.editing});
  function persist(){
    if(timer!==null){clearTimeout(timer);timer=null;}
    const value=snapshot();
    s.persistQueue=s.persistQueue.catch(()=>{}).then(async()=>{s.storageVersion=await storage.cacheWrite(caseId,value,s.storageVersion);});
    return s.persistQueue.catch(e=>{storageConflict=e.code==='WORK_INTAKE_DRAFT_CONFLICT';throw e;});
  }
  function retain(){if(timer!==null)clearTimeout(timer);timer=setTimeout(()=>{timer=null;persist().catch(e=>setMessage(e.message,true));},200);}
  function setMessage(value,bad=false){message=value;error=bad;const el=$('[data-wb-message]');if(el){el.textContent=value;el.setAttribute('role',bad?'alert':'status');}}
  function controls(){if(!alive())return;root.setAttribute('aria-busy',String(busy||hostBusy));root.querySelectorAll('input,button,select,textarea').forEach(el=>el.disabled=busy||hostBusy||el.dataset.fixed==='true');}
  async function run(fn){if(busy||hostBusy||!alive())return;busy=true;controls();try{await fn();}catch(e){setMessage(e.message,true);}finally{busy=false;if(alive())controls();}}
  function changed(){draft().dirty=true;comparison=null;retain();const save=$('[data-wb-action="save"]');if(save){save.dataset.fixed=String(!editable());save.disabled=!editable()||busy||hostBusy;}const apply=$('[data-wb-action="apply"]');if(apply){apply.dataset.fixed='true';apply.disabled=true;}}
  function showComparison(value,scope){
    if(!value)return '';
    const merge=scope==='draft'?value.comparison:value.comparison;
    let html='<h3>'+(scope==='draft'?'Returned workbook comparison':'Current case comparison')+'</h3>'+
      '<p>'+merge.changes.length+' changed fields or new rows; '+merge.omitted.length+' omitted rows retained; '+merge.conflicts.length+' unresolved field conflicts.</p>';
    html+=table(['Record','Field','Original','Current','Returned','Choice'],merge.changes.map(c=>{
      let choice=esc(c.status);
      if(c.status==='CONFLICT'){
        const value=(scope==='draft'?s.returnDecisions:draft().decisions)[c.key]||{};
        choice='<label>Use<select data-choice="'+esc(c.key)+'" data-scope="'+scope+'">'+options([['','Choose'],['CURRENT','Current'],['RETURNED','Returned']],value.choice||'')+'</select></label>'+
          '<label>Reason<input data-reason="'+esc(c.key)+'" data-scope="'+scope+'" value="'+esc(value.reason||'')+'"></label>';
      }else if(c.decision)choice=esc(c.decision.choice)+'<small>'+esc(c.decision.reason)+'</small>';
      return [esc(c.rowId),esc(LABEL[c.field]||c.field),esc(c.original),esc(c.current),esc(c.returned),choice];
    }));
    if(scope==='case'){
      html+='<h4>Native record changes</h4><p>'+value.updates.length+' retained records will be updated through their original edit actions.</p>';
      if(value.issues.length)html+=table(['Record','Finding'],value.issues.map(r=>[esc(r.rowId),esc(r.message)]));
      for(const batch of value.intakes){
        html+='<h4>New '+(batch.kind==='WORK'?'work':'invoice')+' intake</h4><p>'+batch.preview.summary.newRecords+' new; '+batch.preview.summary.matchedRecords+' matched; '+batch.preview.summary.newHours+' new hours; USD '+batch.preview.summary.newInvoiceUsd+' new invoices.</p>';
        html+=table(['Source','Description','Existing match','Decision'],batch.preview.candidates.map(c=>{
          const d=(draft().intakeDecisions[batch.kind]||[]).find(x=>x.key===c.key)||{};
          return [esc(c.key),esc(c.data.description||c.data.number)+(c.errors||[]).map(x=>'<small>'+esc(x)+'</small>').join(''),
            c.matches.map(m=>esc(m.id)+' · '+esc(m.state)).join('<br>'),
            '<label>Action<select data-intake-action="'+esc(c.key)+'" data-kind="'+batch.kind+'">'+options([['','Automatic'],['CREATE','Separate new record'],['REUSE','Use matching record'],['SKIP','Exclude source']],d.action||'')+'</select></label>'+
            '<label>Record<select data-intake-record="'+esc(c.key)+'" data-kind="'+batch.kind+'">'+options([['','Select'],...c.matches.map(m=>[m.id,m.id])],d.recordId||'')+'</select></label>'+
            '<label>Reason<input data-intake-reason="'+esc(c.key)+'" data-kind="'+batch.kind+'" value="'+esc(d.reason||'')+'"></label>'];
        }));
        if(batch.preview.issues.length)html+=table(['Finding'],batch.preview.issues.map(i=>[esc(i.message)]));
      }
    }
    return html;
  }
  function render(){
    if(!alive())return;
    const d=draft(),applied=selected?.workbook.state==='APPLIED',rows=d?.rows?.[tab]||[],start=page*40,visible=rows.slice(start,start+40);
    root.innerHTML='<header><h2>Work / invoice workbook</h2><p>Prepare complete contributor work and supplier invoices, exchange an editable workbook, then review the return against this case.</p></header>'+
      '<p data-wb-message role="'+(error?'alert':'status')+'">'+esc(message)+'</p>'+
      (s.pending?'<aside><h3>Retained '+esc(s.pending.state.toLowerCase())+' request</h3><p>'+esc(s.pending.error||'The original request is saved in this browser.')+'</p>'+button('Resume original request','resume')+(s.pending.state==='REJECTED'?button('Keep rejected request and reopen','rejected'):'')+'</aside>':'')+
      (storageConflict?'<aside><p>Another browser tab has saved a newer working copy. Download this copy, then open the saved browser copy.</p>'+button('Download working copy','working-download')+button('Open saved browser copy','cache-open')+'</aside>':'')+
      '<div class="wb-actions"><label>Saved edition<select data-book>'+options([['','Select a preparation'],...books.map(b=>[b.id,b.name+' · '+b.state+' · case version '+b.version])],s.selectedId||'')+'</select></label>'+
      button('Refresh saved editions','refresh')+button('Download working copy','working-download')+'<label>Open working copy<input type="file" data-working accept=".json"></label></div>'+
      '<details'+(!selected?' open':'')+'><summary>Prepare a workbook from this case</summary><label>Name<input data-name value="'+esc(s.name)+'"></label>'+
      '<label>Contributors / suppliers<select data-people multiple size="5">'+options(caseView.records.contributors.map(r=>[r.id,r.name]),'')+'</select></label><p>Leave the selection empty to include all retained contributors.</p>'+button('Prepare and save workbook','prepare','',Boolean(s.pending)||storageConflict)+'</details>'+
      (selected?'<section><h3>'+esc(selected.workbook.name)+'</h3><p>Saved case version '+selected.version+' · '+esc(selected.workbook.state)+(d.dirty?' · edited working copy':'')+'</p>'+
      '<div class="wb-actions">'+button('Work','tab','WORK')+button('Invoices','tab','INVOICES')+
      button('Add '+(tab==='WORK'?'work':'invoice line'),'add','',!editable())+
      button('Save edition','save','',!editable()||!d.dirty)+button('Compare with current case','preview','',Boolean(s.pending))+
      button('Apply saved preparation','apply','',!editable()||d.dirty||!comparison?.ready)+
      button('Download saved XLSX','xlsx')+button('Download complete case','case')+
      button('Recorded work','work')+button('Invoices','invoices')+button('Supplier accounts','accounts')+button('Work Intake','intake')+'</div>'+
      '<label>Edition / application note<textarea data-note rows="2">'+esc(s.note)+'</textarea></label>'+
      '<p>'+rows.length+' '+(tab==='WORK'?'work rows':'invoice lines')+'. Native IDs remain attached. New rows use a new- ID.</p>'+
      (rows.length?table(['Row','Contributor / supplier','Description','Hours / USD','Dates','Action'],visible.map(r=>[
        '<code>'+esc(r.rowId)+'</code>',esc(caseView.records.contributors.find(p=>p.id===r.contributor)?.name||r.contributor),
        esc(r.description),esc(tab==='WORK'?r.hours:r.amountUsd),
        esc(tab==='WORK'?r.startDate+' – '+r.endDate:r.issuedDate+(r.dueDate?' · due '+r.dueDate:'')),
        button('Open row','edit',r.rowId,!editable())])):'<p class="wb-empty">No '+(tab==='WORK'?'work':'invoice')+' rows. Add a row here or in the exported workbook.</p>')+
      '<div class="wb-actions">'+button('Previous rows','page',String(page-1),page===0)+
      '<span>Rows '+(rows.length?start+1:0)+'–'+Math.min(start+40,rows.length)+' of '+rows.length+'</span>'+
      button('Next rows','page',String(page+1),start+40>=rows.length)+'</div>'+
      (!applied?'<details><summary>Receive returned XLSX</summary><p>The Read me sheet identifies its saved source edition. Existing rows omitted from the file are retained.</p>'+
      '<label>Original workbook<input type="file" data-xlsx accept=".xlsx"></label><p>'+esc(s.upload?.filename||'Choose the complete saved XLSX.')+'</p>'+
      Object.keys(FIELDS).map(k=>'<fieldset><legend>'+esc(k)+'</legend><label>Last worksheet row<input type="number" min="2" max="5001" data-last="'+k+'" value="'+s.selections[k].lastRow+'"></label><label>Hidden rows<select data-hidden="'+k+'">'+options([['include','Include'],['exclude','Exclude']],s.selections[k].hiddenRows)+'</select></label></fieldset>').join('')+
      button('Compare returned workbook','return-preview','',Boolean(s.pending)||d.dirty)+
      button('Save returned edition','return-save','',!returnView||returnView.comparison.conflicts.length>0||Boolean(s.pending)||d.dirty)+
      showComparison(returnView,'draft')+'</details>':'<h4>Applied native operations</h4>'+table(['Action','Native record','Case version'],selected.workbook.application.operations.map(r=>[esc(r.action),esc(r.recordId),esc(r.version)])))+
      showComparison(comparison,'case')+'</section>':'')+
      '<dialog aria-labelledby="wb-row-title"><form data-row-form><h3 id="wb-row-title"></h3><div data-row-fields></div><p data-row-error role="alert"></p><div class="wb-actions">'+button('Cancel','close-row')+button('Remove pending row','remove-row')+'<button type="submit">Keep row changes</button></div></form></dialog>';
    controls();if(s.editing&&(!s.editing.bookId||s.editing.bookId===s.selectedId)&&editable())drawRow();
  }
  async function refresh(){
    caseView=await saveApi(base);books=(await saveApi(base+'/workbooks')).workbooks;
    if(s.selectedId)await open(s.selectedId,false);else render();
  }
  async function open(id,save=true){
    selected=await saveApi(base+'/workbooks/'+encodeURIComponent(id));s.selectedId=id;
    if(!s.drafts[id])s.drafts[id]={rows:copy(selected.workbook.rows),decisions:copy(selected.workbook.decisions),
      intakeDecisions:copy(selected.workbook.intakeDecisions),dirty:false};
    comparison=null;returnView=null;page=0;if(save)await persist();render();
  }
  async function finish(receipt){
    s.pending.receipt=copy(receipt);s.pending.state='COMMITTED';await persist();
    const next=await saveApi(base);const savedBook=await saveApi(base+'/workbooks/'+encodeURIComponent(receipt.recordId));
    s.lastRequest=copy(s.pending);s.pending=null;s.selectedId=savedBook.id;
    s.drafts[savedBook.id]={rows:copy(savedBook.workbook.rows),decisions:copy(savedBook.workbook.decisions),
      intakeDecisions:copy(savedBook.workbook.intakeDecisions),dirty:false};
    await persist();caseView=next;selected=savedBook;
    setMessage(savedBook.workbook.state==='APPLIED'?'Applied the saved preparation through its native records and source intakes.':'Saved the complete workbook edition.');
    await onCase?.(next,receipt);
  }
  function validatePending(pending){
    if(!pending)return;
    if(!['/command','/workbook-apply'].includes(pending.path)||!pending.body||typeof pending.body.requestId!=='string')
      throw new Error('Open an original workbook request with its retained request identity.');
    if(pending.path==='/command'&&!['workbook.prepare','workbook.save','workbook.return'].includes(pending.body.action))
      throw new Error('This working copy contains an action outside the workbook desk.');
    assertStaffRequestActor(pending.body,pinned);
  }
  async function send(){
    if(s.inFlight){await s.inFlight;return;}
    const dispatch=async()=>{
      const pending=s.pending;if(!pending)throw new Error('No retained request is pending.');
      if(pending.receipt)return finish(pending.receipt);
      try{validatePending(pending);const receipt=await saveApi(base+pending.path,copy(pending.body));return await finish(receipt);}
      catch(e){if(!pending.receipt){pending.state=[400,409,413,415,422].includes(e.status)?'REJECTED':'UNCERTAIN';pending.error=e.message;}
        await persist().catch(()=>{});render();throw e;}
    };
    const running=dispatch();s.inFlight=running;try{return await running;}finally{if(s.inFlight===running)s.inFlight=null;}
  }
  async function change(action,data,path='/command'){
    if(s.pending)throw new Error('Resume the retained request first.');
    if(storageConflict)throw new Error('Open the saved browser copy before sending.');
    const body=path==='/command'?{expectedVersion:caseView.program.version,actor:recordingActor(),note:s.note||action,action,data}:
      {expectedVersion:comparison.caseVersion,actor:recordingActor(),note:s.note||'Applied reviewed workbook',...data};
    body.requestId=await mutationId('workbook:'+caseId,body);
    s.pending={path,body:copy(body),state:'PREPARED',receipt:null,createdAt:new Date().toISOString()};
    try{await persist();}catch(e){s.pending=null;throw e;}
    render();return send();
  }
  function editRow(id){
    const found=draft().rows[tab].find(r=>r.rowId===id);
    const row=found?copy(found):Object.fromEntries(FIELDS[tab].map(k=>[k,'']));
    if(!found){row.rowId='new-'+crypto.randomUUID();if(tab==='WORK')row.fundingBasis='PREAWARD';else{row.currency='USD';row.lineId='line-1';}}
    s.editing={bookId:s.selectedId,kind:tab,original:found?.rowId||null,row};retain();drawRow();
  }
  function drawRow(){
    const row=s.editing.row,found=s.editing.original,kind=s.editing.kind;
    $('#wb-row-title').textContent=found?'Edit retained row':'Add '+(kind==='WORK'?'work':'invoice line');
    $('[data-row-fields]').innerHTML=FIELDS[kind].map(k=>{
      const fixed=k==='rowId'||(found&&!found.startsWith('new-')&&['invoiceId','lineId'].includes(k));
      if(k==='contributor')return '<label>'+LABEL[k]+'<select name="'+k+'">'+options([['','Select'],...caseView.records.contributors.map(r=>[r.id,r.name+' · '+r.id])],row[k])+'</select></label>';
      if(k==='costId')return '<label>'+LABEL[k]+'<select name="'+k+'">'+options([['','Unplanned work'],...caseView.plan.scenario.future_costs.map(r=>[r.id,r.id])],row[k])+'</select></label>';
      return '<label>'+LABEL[k]+'<textarea name="'+k+'" rows="'+(k==='description'?3:1)+'"'+(fixed?' readonly':'')+'>'+esc(row[k])+'</textarea></label>';
    }).join('');$('[data-row-error]').textContent='';$('[data-wb-action="remove-row"]').hidden=!found?.startsWith('new-');$('dialog').showModal();
  }
  root.addEventListener('submit',e=>{
    if(!e.target.matches('[data-row-form]'))return;e.preventDefault();
    try{const row={...s.editing.row};for(const [k,v] of new FormData(e.target))row[k]=String(v);
      const rows=draft().rows[s.editing.kind],at=rows.findIndex(r=>r.rowId===s.editing.original);
      if(at>=0)rows[at]=row;else rows.push(row);s.editing=null;changed();$('dialog').close();render();
    }catch(e){$('[data-row-error]').textContent=e.message;}
  });
  root.addEventListener('input',e=>{
    const el=e.target;
    if(s.editing&&el.closest('[data-row-form]')&&FIELDS[s.editing.kind].includes(el.name)){s.editing.row[el.name]=el.value;retain();}
    if(el.matches('[data-name]')){s.name=el.value;retain();}
    if(el.matches('[data-note]')){s.note=el.value;retain();}
    if(el.dataset.last){s.selections[el.dataset.last].lastRow=Number(el.value);returnView=null;retain();}
    if(el.dataset.reason){const map=el.dataset.scope==='draft'?s.returnDecisions:draft().decisions;map[el.dataset.reason]??={choice:'',reason:''};map[el.dataset.reason].reason=el.value;if(el.dataset.scope==='case')changed();else{ returnView=null;retain();}}
    if(el.dataset.intakeReason){const list=draft().intakeDecisions[el.dataset.kind]??=[];let d=list.find(x=>x.key===el.dataset.intakeReason);if(!d){d={key:el.dataset.intakeReason,action:'CREATE',reason:''};list.push(d);}d.reason=el.value;changed();}
  });
  root.addEventListener('change',e=>run(async()=>{
    const el=e.target;
    if(el.matches('[data-book]')){if(el.value)await open(el.value);return;}
    if(el.dataset.choice){const map=el.dataset.scope==='draft'?s.returnDecisions:draft().decisions;map[el.dataset.choice]??={choice:'',reason:''};map[el.dataset.choice].choice=el.value;if(el.dataset.scope==='case')changed();else{returnView=null;retain();}return;}
    if(el.dataset.hidden){s.selections[el.dataset.hidden].hiddenRows=el.value;returnView=null;retain();return;}
    if(el.dataset.intakeAction||el.dataset.intakeRecord){
      const key=el.dataset.intakeAction||el.dataset.intakeRecord,list=draft().intakeDecisions[el.dataset.kind]??=[];
      let item=list.find(x=>x.key===key);
      if(el.dataset.intakeAction&&!el.value){draft().intakeDecisions[el.dataset.kind]=list.filter(x=>x.key!==key);}
      else{if(!item){item={key,action:'CREATE',reason:''};list.push(item);}if(el.dataset.intakeAction){item.action=el.value;if(item.action!=='REUSE')delete item.recordId;}else{item.recordId=el.value;item.action='REUSE';}}
      changed();return;
    }
    if(el.matches('[data-xlsx]')){const f=el.files?.[0];if(!f)return;if(f.size>8*1024*1024)throw new Error('The original attachment limit is 8 MiB.');
      s.upload={filename:f.name,dataBase64:b64(await f.arrayBuffer())};s.returnDecisions={};returnView=null;await persist();render();return;}
    if(el.matches('[data-working]')){
      const f=el.files?.[0];if(!f)return;const value=JSON.parse(await f.text());
      if(value.schema!=='stellar-forge.sf47-workbook-browser.v1'||value.caseId!==caseId)throw new Error('Open the original case for this complete working copy.');
      if(s.pending||Object.values(s.drafts).some(d=>d.dirty))throw new Error('Save or download current work before opening another copy.');
      validatePending(value.pending);
      for(const k of ['selectedId','drafts','pending','lastRequest','name','note','upload','returnDecisions','selections','editing'])s[k]=copy(value[k]);
      await persist();await refresh();
    }
  }));
  root.addEventListener('click',e=>{
    const el=e.target.closest('[data-wb-action]');if(!el)return;
    run(async()=>{
      const action=el.dataset.wbAction,value=el.dataset.value;
      if(action==='tab'){tab=value;page=0;render();}
      else if(action==='page'){page=Number(value);render();}
      else if(action==='close-row'){s.editing=null;retain();$('dialog').close();}
      else if(action==='remove-row'){if(!s.editing?.original?.startsWith('new-'))throw new Error('Only a pending new row can be removed here.');draft().rows[s.editing.kind]=draft().rows[s.editing.kind].filter(r=>r.rowId!==s.editing.original);s.editing=null;changed();$('dialog').close();render();}
      else if(action==='add')editRow(null);
      else if(action==='edit')editRow(value);
      else if(action==='prepare'){const ids=[...$('[data-people]').selectedOptions].map(o=>o.value);await change('workbook.prepare',{name:s.name,...(ids.length?{contributorIds:ids}:{})});}
      else if(action==='refresh')await refresh();
      else if(action==='save')await change('workbook.save',{bookId:s.selectedId,...copy(draft())});
      else if(action==='preview'){caseView=await saveApi(base);comparison=await saveApi(base+'/workbook-preview',{expectedVersion:caseView.program.version,bookId:s.selectedId,...copy(draft())});setMessage(comparison.ready?'Complete comparison ready. Save edited inputs before applying.':'Resolve the displayed findings and compare again.');render();}
      else if(action==='apply')await change(null,{bookId:s.selectedId,expectedPreviewSha256:comparison.previewSha256},'/workbook-apply');
      else if(action==='resume')await send();
      else if(action==='rejected'){s.lastRequest=copy(s.pending);s.pending=null;await persist();await refresh();}
      else if(action==='xlsx'){const output=await createOperationsWorkbookArchive(selected,caseView);download(output.workbook.data,output.workbook.filename,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');setMessage('Downloaded the saved workbook edition.');}
      else if(action==='case'){const response=await saveApi(base+'/export.zip',undefined,{download:true});download(await response.blob(),caseId+'.zip','application/zip');}
      else if(action==='working-download')download(JSON.stringify(snapshot(),null,2)+'\n','work-invoice-working-copy.json');
      else if(action==='cache-open'){const value=await storage.cacheRead(caseId);if(!value)throw new Error('No saved browser copy exists.');for(const k of ['selectedId','drafts','pending','lastRequest','name','note','upload','returnDecisions','selections','editing'])s[k]=copy(value[k]);s.storageVersion=storage.cacheRevision(value);storageConflict=false;await refresh();}
      else if(action==='return-preview'){if(!s.upload)throw new Error('Choose a returned workbook.');returnView=await saveApi(base+'/workbook-return-preview',{bookId:s.selectedId,source:s.upload,selections:s.selections,decisions:s.returnDecisions});render();}
      else if(action==='return-save')await change('workbook.return',{bookId:returnView.bookId,return:{bookId:s.selectedId,source:s.upload,selections:s.selections,decisions:s.returnDecisions}});
      else if(action==='work')onOpen?.('work');
      else if(action==='invoices')onOpen?.('invoices');
      else if(action==='accounts')onOpen?.('supplier-account');
      else if(action==='intake')onOpen?.('work-intake');
    });
  });
  root.innerHTML='<p role="status">Opening retained workbook preparations…</p>';
  const ready=(async()=>{
    if(!s.initialized){const value=await storage.cacheRead(caseId);if(value){for(const k of ['selectedId','drafts','pending','lastRequest','name','note','upload','returnDecisions','selections','editing'])if(Object.hasOwn(value,k))s[k]=copy(value[k]);s.storageVersion=storage.cacheRevision(value);}s.initialized=true;}
    await refresh();
  })();
  return {root,ready,setHostBusy(value){hostBusy=Boolean(value);controls();},dispose(){active=false;if(timer!==null)persist().catch(()=>{});if($('dialog')?.open)$('dialog').close();}};
}
