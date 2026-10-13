import {currentStaffContext,staffDeskStorageKey,assertStaffRequestActor} from './staff-session.mjs';
import {mountEarlierStaffDesk} from './staff-desk-recovery.mjs';
import {createFundingRequests,fundingCanonical,fundingEqual,fundingHash} from './operations_funding_requests.mjs';
const SCHEMA='stellar-forge.sf47-cost-funding.editor.v1';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=v=>structuredClone(v), check=(v,m)=>{if(!v)throw Error(m);};
const uuid=()=>crypto.randomUUID().replaceAll('-','');
const keyOf=r=>fundingCanonical([r.kind,r.recordId,r.lineId??null]);
const title=v=>String(v??'').replaceAll('_',' ').toLowerCase();
function editableInput(value){
  const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
  const strings=v=>Array.isArray(v)&&v.length<=200&&v.every(x=>typeof x==='string');
  const nullable=v=>v===null||typeof v==='string';
  check(object(value)&&Number.isInteger(value.expectedRevision)&&value.expectedRevision>=0&&object(value.document),
    'Choose a complete editable funding input from the original seed or editor download.');
  const d=value.document;
  check(['title','status','asOfDate','periodEnd','note'].every(k=>typeof d[k]==='string')
    &&nullable(d.periodStart)&&Array.isArray(d.funds)&&d.funds.length<=50
    &&Array.isArray(d.assignments)&&d.assignments.length<=10000,
    'The complete funding document fields are required before opening an editable draft.');
  for(const fund of d.funds)check(object(fund)
    &&['id','name','kind','reference','decision','conditions','receiptTiming','note'].every(k=>typeof fund[k]==='string')
    &&strings(fund.sourceIds)&&['costWindowStart','costWindowEnd','limitUsd'].every(k=>nullable(fund[k])),
    'Each funding source must retain its complete editable terms and source selection.');
  for(const row of d.assignments){
    check(object(row)&&['WORK','INVOICE'].includes(row.kind)&&typeof row.recordId==='string'
      &&nullable(row.lineId)&&typeof row.note==='string'&&Array.isArray(row.allocations)&&row.allocations.length<=50,
      'Each assignment must retain its original row and complete allocation list.');
    for(const part of row.allocations)check(object(part)
      &&['fundId','quantity','eligibility','basis'].every(k=>typeof part[k]==='string')&&strings(part.sourceIds),
      'Each allocation must retain its editable quantity, assessment and original source selection.');
  }
  return value;
}
const path=p=>esc(JSON.stringify(p));
const show=v=>v===null||v===undefined||v===''?'Unstated':String(v);
function download(raw,name,type='application/json'){
  const url=URL.createObjectURL(raw instanceof Blob?raw:new Blob([raw],{type}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function setAt(value,parts,next){for(const p of parts.slice(0,-1))value=value[p];value[parts.at(-1)]=next;}
function field(label,p,value,{area=false,choices=null,nullable=false,fixed=false,help=''}={}){
  const attr=' data-funding-path="'+path(p)+'" data-editor="true"'+(nullable?' data-nullable="true"':'')+(fixed?' data-fixed="true"':'');
  const control=choices?'<select'+attr+'>'+choices.map(([v,t])=>'<option value="'+esc(v)+'"'+(String(value??'')===String(v)?' selected':'')+'>'+esc(t)+'</option>').join('')+'</select>':
    area?'<textarea rows="3"'+attr+'>'+esc(value??'')+'</textarea>':'<input type="text"'+attr+' value="'+esc(value??'')+'">';
  return '<label>'+esc(label)+control+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
}
const options=values=>values.map(v=>[v,title(v)]);
const button=(label,action,extra='')=>'<button type="button" data-funding-action="'+action+'" '+extra+'>'+esc(label)+'</button>';
const pretty=v=>'<pre>'+esc(JSON.stringify(v,null,2))+'</pre>';
const table=(headers,rows)=>'<div class="funding-scroll"><table><thead><tr>'+headers.map(v=>'<th>'+esc(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';

export function mountFunding({container,current,api,saveApi=api,session={},mutationId,recordingActor,onCase,onSources,staffContext=currentStaffContext()}){
  const pinnedContext=staffContext?{...staffContext}:null;
  const root=document.createElement('section');root.className='cost-funding-desk';root.setAttribute('aria-label','Cost funding');container.replaceChildren(root);
  const caseId=current.program.id,caseCreatedAt=current.program.createdAt;
  const earlierStorageKey=SCHEMA+':'+caseId+':'+encodeURIComponent(caseCreatedAt);
  const storageKey=staffDeskStorageKey(earlierStorageKey,pinnedContext);
  let active=true,busy=false,hostBusy=false,initialized=false,storageError='',selected=null,catalog=null,history=[],pending=[],currentCase=current,generation=0;
  const available=()=>active&&root.isConnected;
  const $=q=>root.querySelector(q);
  if(!session.initialized){
    try{
      const prior=JSON.parse(localStorage.getItem(storageKey)||'null');
      if(prior){
        check(prior.schema===SCHEMA&&prior.caseId===caseId&&prior.caseCreatedAt===caseCreatedAt,'The retained funding editor belongs to another case.');
        for(const k of ['drafts','draftId','mode','revision','notice','targetKey','query','page','reportPage'])
          if(!Object.hasOwn(session,k)&&Object.hasOwn(prior,k))session[k]=prior[k];
      }
    }catch(error){storageError=error.message;}
    session.initialized=true;
  }
  session.drafts ||= {};session.mode ||= 'empty';session.query ||= '';session.page ||=0;session.reportPage ||=0;
  session.requestMemory ||= {};
  const requests=createFundingRequests({caseId,caseCreatedAt,call:saveApi,memory:session.requestMemory,
    storageNamespace:pinnedContext?.installationId?staffDeskStorageKey('sf47.funding-requests',pinnedContext):'',
    validateActor:body=>assertStaffRequestActor(body,pinnedContext),
    available:()=>available()&&currentCase.program.id===caseId&&currentCase.program.createdAt===caseCreatedAt});
  const draft=()=>session.mode==='draft'?session.drafts[session.draftId]:null;
  const editable=()=>currentCase.program.state==='OPEN';
  function persist(){
    try{
      const value={schema:SCHEMA,caseId,caseCreatedAt};
      for(const k of ['drafts','draftId','mode','revision','notice','targetKey','query','page','reportPage'])value[k]=session[k]??null;
      const raw=JSON.stringify(value);localStorage.setItem(storageKey,raw);
      check(localStorage.getItem(storageKey)===raw,'The complete funding editor could not be retained.');
      storageError='';
    }catch(error){storageError=error.message||'Browser storage is unavailable. Download the complete editor recovery.';}
  }
  function notify(message){session.notice=message;persist();if(available()){const node=$('[data-funding-notice]');if(node)node.textContent=message;}}
  function controls(){
    if(!available())return;
    const locked=busy||hostBusy||!initialized;root.setAttribute('aria-busy',String(locked));
    root.querySelectorAll('button,input,select,textarea').forEach(n=>{
      if(n.matches('[data-funding-file]')){n.disabled=false;return;}
      const recovery=['recovery-export','recovery-import'].includes(n.dataset.fundingAction);
      n.disabled=(recovery?busy||hostBusy:locked)||n.dataset.fixed==='true'||(n.dataset.editor==='true'&&(!draft()||!editable()||pending.length>0));
    });
    const save=$('[data-funding-action="save"]');
    if(save)save.disabled=locked||!draft()?.preview||!editable()||pending.length>0||Boolean(storageError);
    const preview=$('[data-funding-action="preview"]');if(preview)preview.disabled=locked||!draft()||pending.length>0;
    const remove=$('[data-funding-action="remove-draft"]');if(remove)remove.disabled=locked||!draft()||pending.length>0;
  }
  async function work(action){
    if(busy||hostBusy||!available())return;busy=true;controls();
    try{await action();}
    catch(error){if(available())notify(error.message);}
    finally{busy=false;if(available())controls();}
  }
  function invalidate(){
    const d=draft();if(d){delete d.preview;delete d.previewSignature;}persist();controls();
    const n=$('[data-funding-review]');if(n)n.textContent='Draft changed. Calculate and review the complete allocation before saving.';
  }
  function sourcePicker(p,ids){
    return '<label>Original source attachments<select multiple size="3" data-editor="true" data-funding-path="'+path(p)+'" data-many="true">'+
      (catalog?.sources||[]).map(s=>'<option value="'+esc(s.id)+'"'+(ids.includes(s.id)?' selected':'')+'>'+esc(s.filename+' · '+s.sha256.slice(0,12))+'</option>').join('')+
      '</select><small>Choose existing case sources; the complete originals remain in the case handover.</small></label>';
  }
  function sourceForm(){
    const d=draft(),doc=d.inputs.document;
    return '<section class="funding-card"><div class="funding-section-title"><h3>Funding sources and conditions</h3>'+button('Add funding source','add-fund','data-editor="true"')+'</div>'+
      '<p>Record the selected agreement and its stated conditions. A GRANT label does not establish eligibility, award, available cash or a payment date.</p>'+
      (doc.funds.length?doc.funds.map((f,i)=>'<details class="funding-fund"'+(doc.funds.length<=2?' open':'')+'><summary>'+esc(f.name||'Funding source')+' <span>'+esc(f.kind)+' · '+esc(f.id)+'</span></summary><div class="funding-grid">'+
        field('Name',['funds',i,'name'],f.name)+field('Category',['funds',i,'kind'],f.kind,{choices:options(['PREAWARD','GRANT','CUSTOMER','INTERNAL','OTHER'])})+
        field('Decision basis',['funds',i,'decision'],f.decision,{choices:[['PROPOSED','Proposed'],['RECORDED','Recorded with original source']]})+
        field('Original agreement / decision reference',['funds',i,'reference'],f.reference)+
        sourcePicker(['funds',i,'sourceIds'],f.sourceIds)+field('Recorded funding basis',['funds',i,'note'],f.note,{area:true})+
        field('Actual source-stated conditions',['funds',i,'conditions'],f.conditions,{area:true,help:'Leave unstated terms empty. This field preserves the source wording or an attributed summary.'})+
        field('Source-stated receipt timing',['funds',i,'receiptTiming'],f.receiptTiming,{area:true})+
        field('Cost window start',['funds',i,'costWindowStart'],f.costWindowStart,{nullable:true,help:'YYYY-MM-DD if stated by the selected source.'})+
        field('Cost window end',['funds',i,'costWindowEnd'],f.costWindowEnd,{nullable:true})+
        field('Selected invoice-assignment limit USD',['funds',i,'limitUsd'],f.limitUsd,{nullable:true,help:'Optional exact decimal. Exceeding it appears in the report; this is not a cash balance.'})+
        '</div>'+button('Remove unused funding source','remove-fund','data-index="'+i+'" data-editor="true"')+'</details>').join(''):
       '<p>No funding source selected. Every original hour and invoice amount remains unassigned.</p>')+'</section>';
  }
  function allTargets(){
    const items=(catalog?.targets||[]).map(copy),seen=new Set(items.map(r=>r.key));
    for(const r of draft()?.inputs.document.assignments||[]){
      if(!seen.has(keyOf(r)))items.push({key:keyOf(r),...copy(r),orphan:true,description:'Original source is absent from the current case',
        state:'ABSENT',recordVersion:null,quantity:null,unit:r.kind==='WORK'?'HOURS':'USD',contributor:'',date:null,recordSha256:null});
    }
    return items;
  }
  function findAssignment(target,create=false){
    const rows=draft().inputs.document.assignments;
    let i=rows.findIndex(r=>keyOf(r)===target.key);
    if(i<0&&create){rows.push({kind:target.kind,recordId:target.recordId,lineId:target.lineId??null,note:'',allocations:[]});i=rows.length-1;}
    return {row:rows[i],index:i};
  }
  function population(){
    const all=allTargets(),query=session.query.toLowerCase();
    const filtered=all.filter(r=>!query||[r.kind,r.recordId,r.lineId,r.description,r.contributor,r.invoiceNumber,r.state,r.costId].some(v=>String(v??'').toLowerCase().includes(query)));
    const pages=Math.max(1,Math.ceil(filtered.length/50));session.page=Math.min(session.page,pages-1);
    const rows=filtered.slice(session.page*50,session.page*50+50);
    const target=all.find(r=>r.key===session.targetKey);
    return '<section class="funding-card"><h3>Original work and invoice lines</h3><p>'+all.length+' complete source rows · '+filtered.length+' match the search. Original states and revisions remain visible.</p>'+
      '<label>Find a row<input data-funding-search value="'+esc(session.query)+'" placeholder="Description, supplier, record or package"></label>'+
      table(['Original source','Revision / state','Quantity','Assignment'],rows.map(r=>'<tr><td><strong>'+esc(r.description)+'</strong><small>'+esc(r.kind+' · '+r.recordId+(r.lineId?' / '+r.lineId:''))+'</small><small>'+esc(r.contributor)+' · '+esc(r.date)+'</small></td><td>'+esc(show(r.recordVersion))+' · '+esc(r.state)+'</td><td class="funding-number">'+esc(show(r.quantity))+' '+esc(r.unit)+'</td><td>'+button('Edit split','select-target','data-key="'+esc(r.key)+'" data-editor="true"')+'</td></tr>'))+
      '<div class="funding-pagination">'+button('Previous rows','previous-targets')+'<span>Page '+(session.page+1)+' of '+pages+'</span>'+button('Next rows','next-targets')+'</div>'+
      (target?targetEditor(target):'<p>Select a row to assign exact amounts or hours.</p>')+'</section>';
  }
  function targetEditor(target){
    const d=draft(),found=findAssignment(target),r=found.row;
    const parts=r?.allocations||[],i=found.index;
    return '<div class="funding-target"><div class="funding-section-title"><h4>'+esc(target.description)+'</h4>'+button('Close split','close-target')+'</div>'+
      '<p>'+esc(target.kind+' · '+target.recordId+(target.lineId?' / '+target.lineId:''))+'<br>Original version '+esc(show(target.recordVersion))+
      ' · '+esc(target.state)+' · '+esc(show(target.quantity))+' '+esc(target.unit)+'</p>'+
      (target.orphan?'<p class="funding-warning">This retained assignment has no current original source. Keep the older edition and explicitly remove this local assignment before reviewing a successor.</p>':
       '<details><summary>Complete current original row</summary>'+pretty(target)+'</details>')+
      (r?field('Allocation note',['assignments',i,'note'],r.note,{area:true}):'')+
      parts.map((part,j)=>'<div class="funding-part"><div class="funding-grid">'+
        field('Funding source',['assignments',i,'allocations',j,'fundId'],part.fundId,{choices:[['','Select funding source'],...d.inputs.document.funds.map(f=>[f.id,f.name+' · '+f.kind])]})+
        field(target.unit==='USD'?'Assigned invoice USD':'Assigned hours',['assignments',i,'allocations',j,'quantity'],part.quantity,{help:target.unit==='USD'?'Exact decimal, at most 2 places.':'Exact decimal, at most 4 places.'})+
        field('Eligibility assessment',['assignments',i,'allocations',j,'eligibility'],part.eligibility,{choices:[['UNASSESSED','Unassessed'],['SUPPORTED','Supported by selected source'],['EXCLUDED','Excluded by selected source']]})+
        sourcePicker(['assignments',i,'allocations',j,'sourceIds'],part.sourceIds)+
        field('Source and assessment basis',['assignments',i,'allocations',j,'basis'],part.basis,{area:true})+
        '</div>'+button('Remove this allocation','remove-part','data-assignment="'+i+'" data-part="'+j+'" data-editor="true"')+'</div>').join('')+
      '<div class="funding-actions">'+button('Add allocation','add-part','data-key="'+esc(target.key)+'" data-editor="true"')+
      (!r?button('Keep unassigned with a note','row-note','data-key="'+esc(target.key)+'" data-editor="true"'):'')+
      (r?button('Clear this row’s assignments','clear-target','data-key="'+esc(target.key)+'" data-editor="true"'):'')+'</div>'+
      '<p>Only assigned quantities are saved in the split. The exact remaining balance stays unassigned. Work hours and invoice USD are not added together.</p></div>';
  }
  function report(value){
    if(!value)return '<p data-funding-review>Calculate the complete draft to review exact assignments and unassigned balances.</p>';
    const maxPages=Math.max(1,Math.ceil(Math.max(value.balances.length,value.findings.length,...Object.values(value.changes).filter(Array.isArray).map(a=>a.length))/100));session.reportPage=Math.min(session.reportPage,maxPages-1);
    const slice=value.balances.slice(session.reportPage*100,session.reportPage*100+100);
    const headings=['Source','Opening invoice USD','Period invoice USD','Closing invoice USD','After end USD','Closing hours'];
    const summary=value.funds.map(f=>'<tr><td><strong>'+esc(f.name)+'</strong><small>'+esc(f.kind+' · '+f.decision)+'</small></td>'+
      ['opening','period','closing','afterEnd'].map(k=>'<td class="funding-number">'+esc(f[k].invoiceUsd)+'</td>').join('')+
      '<td class="funding-number">'+esc(f.closing.workHours)+'</td></tr>');
    return '<section class="funding-card"><h3>Complete period allocation</h3><p>'+esc(value.basis)+'</p><p>'+esc(value.dateBasis)+'</p>'+
      '<p><strong>'+esc(value.period.startDate||'Beginning of retained records')+' through '+esc(value.period.endDate)+'</strong> · as of '+esc(value.period.asOfDate)+
      ' · '+value.sourceCounts.work+' work records · '+value.sourceCounts.invoices+' invoices · '+value.sourceCounts.targets+' source rows</p>'+
      table(headings,summary)+
      '<details><summary>Work acceptance, invoice review and eligibility totals</summary>'+table(['Funding source','Period hours','Closing accepted hours','Reviewed invoice USD','Supported invoice USD','Excluded invoice USD','Limit excess USD'],
        value.funds.map(f=>'<tr><td>'+esc(f.name)+'</td>'+[f.period.workHours,f.closing.acceptedHours,f.closing.reviewedInvoiceUsd,f.closing.supportedInvoiceUsd,f.closing.excludedInvoiceUsd,show(f.limitExcessUsd)].map(v=>'<td class="funding-number">'+esc(v)+'</td>').join('')+'</tr>'))+'</details>'+
      '<details><summary>Saved-plan package comparison</summary>'+table(['Package','Planned USD','Planned hours','Invoice USD','Unassigned invoice USD','Work hours','Unassigned hours'],
        value.packages.map(p=>'<tr>'+[p.costId??'Unassigned package',show(p.plannedUsd),show(p.plannedHours),p.invoiceUsd,p.unassignedInvoiceUsd,p.workHours,p.unassignedWorkHours].map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>'))+'</details>'+
      '<h4>All original-row balances</h4>'+table(['Original record / line','Date / state','Unit','Original','Assigned','Unassigned'],
        slice.map(r=>'<tr><td>'+esc(r.description)+'<small>'+esc(r.recordId+(r.lineId?' / '+r.lineId:''))+' · v'+r.recordVersion+'</small></td><td>'+esc(r.date)+'<small>'+esc(r.state)+'</small></td><td>'+esc(r.unit)+'</td>'+
        [r.quantity,r.assigned,r.unassigned].map(v=>'<td class="funding-number">'+esc(v)+'</td>').join('')+'</tr>'))+
      '<div class="funding-pagination">'+button('Previous balances','previous-report')+'<span>Page '+(session.reportPage+1)+' of '+maxPages+' · all '+value.balances.length+' rows included in exports</span>'+button('Next balances','next-report')+'</div>'+
      '<details><summary>Source and allocation observations ('+value.findings.length+')</summary>'+
        (value.findings.length?'<p>'+value.findings.length+' complete observations are retained in the report JSON and offline report.</p>'+pretty(value.findings.slice(session.reportPage*100,session.reportPage*100+100)):'<p>No additional observations.</p>')+'</details>'+
      '<details><summary>Changes from the preceding funding edition</summary>'+['originalRows','assignments','funds'].map(k=>'<h4>'+esc(k==='originalRows'?'Original source revisions':title(k))+' · '+value.changes[k].length+'</h4>'+pretty(value.changes[k].slice(session.reportPage*100,session.reportPage*100+100))).join('')+'</details></section>';
  }

  function render(){
    if(!available())return;
    const d=draft(),book=d?.inputs.document,edition=selected?.edition;
    const header='<div class="funding-heading"><div><p class="funding-eyebrow">Grant operations</p><h2>Cost funding</h2><p>One retained allocation book for original work and supplier invoice lines.</p></div>'+
      '<div class="funding-actions">'+button('Refresh original case','refresh')+button('New draft from current book','new')+button('Original sources','sources')+
      button('Download editor recovery','recovery-export')+button('Import editor recovery','recovery-import')+'<a href="/COST_FUNDING.md" download>Operating guide</a></div></div>'+
      '<p class="funding-binding">'+esc(currentCase.program.name)+' · case v'+currentCase.program.version+' · '+esc(caseId)+'</p>'+
      '<p data-funding-notice role="status" aria-live="polite">'+esc(session.notice||'')+'</p>'+
      (storageError?'<p class="funding-warning">Browser recovery: '+esc(storageError)+' Download the complete editor recovery before leaving.</p>':'')+
      (pending.length?'<section class="funding-card funding-warning"><h3>Original save retained</h3>'+pending.map(row=>'<p>'+esc(row.prepared.request.requestId)+' · original case v'+row.prepared.request.expectedVersion+
        (row.proof?' · accepted response retained':'')+(row.rejected?' · definite rejection retained':'')+'</p><div class="funding-actions">'+
        button('Reconcile / continue original save','recover','data-request="'+esc(row.prepared.request.requestId)+'"')+
        (row.rejected&&!row.proof?button('Retain rejection and return to draft','retire','data-request="'+esc(row.prepared.request.requestId)+'"'):'')+'</div>').join('')+'</section>':'')+
      '<section class="funding-card funding-chooser"><label>Saved funding edition<select data-funding-saved><option value="">Choose a saved edition</option>'+
      history.map(row=>'<option value="'+row.revision+'"'+(session.mode==='saved'&&session.revision===row.revision?' selected':'')+'>Edition '+row.revision+' · '+esc(row.status)+' · '+esc(row.period.endDate)+' · case v'+row.caseVersion+'</option>').join('')+'</select></label>'+
      '<label>Retained editable draft<select data-funding-draft><option value="">Choose a local draft</option>'+
      Object.entries(session.drafts).map(([id,row])=>'<option value="'+esc(id)+'"'+(session.mode==='draft'&&session.draftId===id?' selected':'')+'>'+esc(row.inputs?.document?.title||'Funding draft')+' · '+esc(row.createdAt)+'</option>').join('')+'</select></label></section>';
    let body='';
    if(d){
      body='<section class="funding-card"><div class="funding-section-title"><h3>Editable allocation</h3><div class="funding-actions">'+button('Download complete input','input-export')+button('Import complete input','input-import')+button('Remove this local draft','remove-draft')+'</div></div>'+
        '<p class="funding-binding">Download this input or the complete editor recovery before removing a local draft. Saved editions and original request history remain available.</p>'+
        '<p>Draft based on case v'+d.caseVersion+' and funding edition '+d.inputs.expectedRevision+'. Current case v'+currentCase.program.version+
        ', latest funding edition '+(history[0]?.revision||0)+'.</p>'+
        ((d.caseVersion!==currentCase.program.version||d.inputs.expectedRevision!==(history[0]?.revision||0))?'<p class="funding-warning">The case or funding book changed. Review the current source and keep all draft assignments while selecting its new save base.</p>'+button('Use current source and save base','rebind','data-editor="true"'):'')+
        '<div class="funding-grid">'+field('Book title',['title'],book.title)+
        field('Internal review status',['status'],book.status,{choices:[['DRAFT','Draft'],['REVIEWED','Internally reviewed']]})+
        field('As of date',['asOfDate'],book.asOfDate,{help:'YYYY-MM-DD'})+
        field('Reporting start',['periodStart'],book.periodStart,{nullable:true,help:'Empty includes all earlier retained records.'})+
        field('Reporting end',['periodEnd'],book.periodEnd,{help:'YYYY-MM-DD'})+
        field('Complete allocation / review note',['note'],book.note,{area:true})+'</div></section>'+
        sourceForm()+population()+
        '<section class="funding-card"><h3>Review and save</h3><label>Reason for this saved edition<textarea rows="3" data-funding-save-note data-editor="true">'+esc(d.saveNote||'')+'</textarea></label>'+
        '<div class="funding-actions">'+button('Calculate complete allocation','preview')+button('Save reviewed edition','save','class="primary"')+
        button('Download draft report JSON','report-json')+'</div><p data-funding-review>'+
        (d.preview?'Complete preview '+esc(d.preview.previewSha256)+' · source case v'+d.preview.source.case.version:'Calculate and review this complete draft before saving.')+'</p></section>'+
        report(d.preview?.report);
    }else if(session.mode==='saved'&&edition){
      body='<section class="funding-card"><div class="funding-section-title"><h3>'+esc(edition.document.title)+' · edition '+edition.revision+'</h3><div class="funding-actions">'+
        button('Prepare a successor from this edition','edit-selected')+button('Export full report and original case','export')+button('Download complete saved edition','edition-json')+'</div></div>'+
        '<p>'+esc(edition.document.status)+' · '+esc(edition.savedAt)+' · '+esc(edition.actor)+'<br>'+esc(edition.note)+'</p>'+
        '<p class="funding-hash">Original funding source '+esc(selected.source.id)+' · SHA-256 '+esc(selected.source.sha256)+'</p>'+
        '<details><summary>Selected funding terms and every assignment</summary>'+pretty(edition.document)+'</details>'+
        '<details><summary>Original case, plan, invoice, work and source revisions</summary>'+pretty(edition.source)+'</details>'+
        '<details><summary>Later changes in current original source ('+selected.currentSourceChanges.length+')</summary>'+pretty(selected.currentSourceChanges)+'</details></section>'+
        report(edition.report);
    }else body='<section class="funding-card"><h3>Keep the allocation with its original source</h3><p>Open an edition or prepare a draft. The complete current population includes every recorded work row and supplier invoice line, with their original states. New drafts start with any prior allocations; unassigned quantities remain visible.</p></section>';
    root.innerHTML=header+body+'<input type="file" hidden data-funding-file accept=".json,application/json">';
    controls();
  }
  async function reload(){
    const token=++generation,next=await api('/api/operations/'+caseId),value=await api('/api/operations/'+caseId+'/cost-funding');
    check(next.program.id===caseId&&next.program.createdAt===caseCreatedAt
      &&value.catalog.case.id===caseId&&value.catalog.case.createdAt===caseCreatedAt
      &&value.catalog.case.version===next.program.version,'The original case changed during its read. Refresh this same selection.');
    const retained=await requests.pending();
    if(!available()||token!==generation)return false;
    currentCase=next;catalog=value.catalog;history=value.history;pending=retained;
    for(const item of Object.values(session.drafts))if(item.preview?.source?.case?.version!==currentCase.program.version){
      delete item.preview;delete item.previewSignature;
    }
    return true;
  }
  async function openSaved(revision){
    const token=++generation,value=await api('/api/operations/'+caseId+'/cost-funding/edition?revision='+revision);
    if(!available()||token!==generation)return;
    check(value.catalog.case.id===caseId&&value.catalog.case.createdAt===caseCreatedAt
      &&value.edition.revision===revision,'The selected original funding edition changed.');
    selected=value;session.mode='saved';session.revision=revision;session.reportPage=0;persist();render();
  }
  async function newDraft(revision){
    check(editable(),'Reopen the original case before preparing another allocation.');
    check(pending.length===0,'Reconcile the original pending save first.');
    check(Object.keys(session.drafts).length<50,'Retain/export your existing drafts before preparing more than 50 in this browser.');
    const value=await api('/api/operations/'+caseId+'/funding-seed',{expectedVersion:currentCase.program.version,...(revision===undefined?{}:{revision})});
    if(!available())return;
    check(value.catalog.case.id===caseId&&value.catalog.case.createdAt===caseCreatedAt
      &&value.catalog.case.version===currentCase.program.version,'The case changed before the draft selection returned.');
    const id=uuid();session.drafts[id]={inputs:copy(value.inputs),caseVersion:currentCase.program.version,
      createdAt:new Date().toISOString(),saveNote:'',baseEdition:value.selectedEdition??null};
    session.draftId=id;session.mode='draft';session.targetKey=null;session.page=0;session.reportPage=0;
    catalog=value.catalog;history=value.history;persist();render();
  }
  async function preview(){
    const d=draft();check(d&&d.caseVersion===currentCase.program.version,'Select the current original source before calculating this retained draft.');
    check(d.inputs.expectedRevision===(history[0]?.revision||0),'Select the current funding book as the save base.');
    const before=fundingCanonical(d.inputs),value=await api('/api/operations/'+caseId+'/funding-preview',
      {expectedVersion:d.caseVersion,inputs:copy(d.inputs)});
    if(!available()||draft()!==d)return;
    check(before===fundingCanonical(d.inputs)&&value.source.case.id===caseId
      &&value.source.case.version===d.caseVersion&&value.source.case.createdAt===caseCreatedAt,
      'The draft or original source changed while the calculation was returning.');
    d.inputs=copy(value.inputs);d.preview=value;d.previewSignature=fundingCanonical(value.inputs);
    session.reportPage=0;persist();render();
  }
  async function receiveResult(p,result){
    session.mode='saved';session.revision=result.funding.revision;
    session.requestOpen={revision:result.funding.revision};
    session.notice='Saved funding edition '+result.funding.revision+' with its original cost and work revisions.';
    persist();
    if(!available())return;
    await reload();if(!available())return;
    await openSaved(result.funding.revision);
    if(available()&&onCase)await onCase(currentCase,result);
  }
  async function save(){
    const d=draft();check(d?.preview&&d.previewSignature===fundingCanonical(d.inputs),'Review the complete current allocation before saving.');
    check(d.caseVersion===currentCase.program.version&&d.preview.source.case.version===currentCase.program.version,
      'Refresh the same original case and review its current source before saving.');
    check(!pending.length,'Reconcile the original retained save first.');
    check(!storageError,'Download recovery and restore browser storage before dispatching a new request.');
    check(d.saveNote?.trim(),'Enter a reason for this saved funding edition.');
    const body={expectedVersion:currentCase.program.version,actor:recordingActor(),note:d.saveNote.trim(),
      action:'funding.save',data:{inputs:copy(d.preview.inputs),expectedPreviewSha256:d.preview.previewSha256}};
    body.requestId=await mutationId('cost-funding:'+caseId,body);
    const p=await requests.prepare(body,d.preview.reportSha256);
    pending=await requests.pending();persist();render();
    try{const result=await requests.dispatch(p);await receiveResult(p,result);}
    finally{pending=await requests.pending();if(available())render();}
  }
  async function recoveryExport(){
    const packet={schema:SCHEMA+'.recovery',caseId,caseCreatedAt,drafts:copy(session.drafts),
      selection:{mode:session.mode,draftId:session.draftId??null,revision:session.revision??null},
      requests:await requests.exportRecovery()};
    download(JSON.stringify(packet,null,2)+'\n',caseId+'-cost-funding-editor.json');
  }
  async function importFile(file,mode){
    check(file&&file.size>0&&file.size<=32*1024*1024,'Choose the complete JSON input or editor recovery up to 32 MiB.');
    const value=JSON.parse(await file.text());if(!available())return;
    if(mode==='input'){
      editableInput(value);
      check(pending.length===0,'Recover the original save before importing another editable draft.');
      check(Object.keys(session.drafts).length<50,'Retain/export your existing drafts before importing more than 50 in this browser.');
      const id=uuid();session.drafts[id]={inputs:copy(value),caseVersion:currentCase.program.version,
        createdAt:new Date().toISOString(),saveNote:'',baseEdition:null};
      session.draftId=id;session.mode='draft';session.targetKey=null;
    }else{
      check(value?.schema===SCHEMA+'.recovery'&&value.caseId===caseId&&value.caseCreatedAt===caseCreatedAt
        &&value.drafts&&typeof value.drafts==='object'&&!Array.isArray(value.drafts)&&Object.keys(value.drafts).length<=50,
        'Choose the complete original case editor recovery.');
      for(const [id,d]of Object.entries(value.drafts)){
        check(/^[a-f0-9]{32}$/.test(id)&&d&&Number.isInteger(d.caseVersion)&&d.caseVersion>=1
          &&typeof d.createdAt==='string'&&(d.saveNote===undefined||typeof d.saveNote==='string'),
          'The recovered editable input is incomplete.');
        editableInput(d.inputs);
        if(session.drafts[id])check(fundingEqual(session.drafts[id].inputs,d.inputs),'A retained draft with this identity has different edits. Keep both recovery files.');
      }
      check(new Set([...Object.keys(session.drafts),...Object.keys(value.drafts)]).size<=50,
        'This receiving selection would exceed 50 retained drafts. Keep the complete recovery files and select the intended original editor.');
      pending=await requests.importRecovery(value.requests);
      if(!available())return;
      for(const [id,d]of Object.entries(value.drafts)){
        const fresh=copy(d);delete fresh.preview;delete fresh.previewSignature;session.drafts[id]??=fresh;
      }
      if(value.selection?.mode==='draft'&&session.drafts[value.selection.draftId]){
        session.mode='draft';session.draftId=value.selection.draftId;
      }
      session.notice='Complete editable inputs and original request evidence received. Reconcile saved requests before preparing another.';
    }
    persist();render();
  }
  root.addEventListener('input',event=>{
    if(busy||hostBusy||pending.length||!draft()||!editable())return;
    const el=event.target;
    if(el.matches('[data-funding-save-note]')){draft().saveNote=el.value;persist();return;}
    if(!el.dataset.fundingPath||el.tagName==='SELECT')return;
    const parts=JSON.parse(el.dataset.fundingPath);
    setAt(draft().inputs.document,parts,el.dataset.nullable==='true'&&el.value===''?null:el.value);
    invalidate();
  });
  root.addEventListener('change',event=>{
    const el=event.target;
    if(el.matches('[data-funding-file]')){const mode=session.fileMode;work(()=>importFile(el.files[0],mode));return;}
    if(el.matches('[data-funding-saved]')&&el.value){work(()=>openSaved(Number(el.value)));return;}
    if(el.matches('[data-funding-draft]')&&el.value){
      work(async()=>{check(session.drafts[el.value],'That retained draft is absent.');session.draftId=el.value;session.mode='draft';session.targetKey=null;persist();render();});return;
    }
    if(el.matches('[data-funding-search]')){session.query=el.value;session.page=0;persist();render();return;}
    if(busy||hostBusy||pending.length||!draft()||!editable()||!el.dataset.fundingPath||el.tagName!=='SELECT')return;
    setAt(draft().inputs.document,JSON.parse(el.dataset.fundingPath),
      el.dataset.many==='true'?[...el.selectedOptions].map(v=>v.value):el.value);
    invalidate();render();
  });
  root.addEventListener('click',event=>{
    const target=event.target.closest('[data-funding-action]');if(!target||!root.contains(target))return;
    const action=target.dataset.fundingAction;
    work(async()=>{
      if(action==='refresh'){await reload();if(session.mode==='saved'&&session.revision)await openSaved(session.revision);else render();return;}
      if(action==='new'){await newDraft();return;}
      if(action==='sources'){onSources?.();return;}
      if(action==='edit-selected'){check(selected,'Open an original saved edition.');await newDraft(selected.edition.revision);return;}
      if(action==='preview'){await preview();return;}
      if(action==='save'){await save();return;}
      if(action==='recover'||action==='retire'){
        const row=(await requests.pending()).find(r=>r.prepared.request.requestId===target.dataset.request);check(row,'The retained original request is unavailable.');
        if(action==='recover'){const result=await requests.dispatch(row.prepared);await receiveResult(row.prepared,result);}
        else{const found=await requests.retireRejected(row.prepared);if(found)await receiveResult(row.prepared,found);else{
          pending=await requests.pending();await reload();session.notice='The rejected request remains retained. Review current source before saving a successor.';persist();render();
        }}return;
      }
      if(action==='recovery-export'){await recoveryExport();return;}
      if(action==='recovery-import'||action==='input-import'){session.fileMode=action==='input-import'?'input':'recovery';$('[data-funding-file]').click();return;}
      if(action==='input-export'){check(draft(),'Select an editable draft.');download(JSON.stringify(draft().inputs,null,2)+'\n',caseId+'-funding-inputs.json');return;}
      if(action==='remove-draft'){
        const id=session.draftId,original=draft();check(original,'Select the local draft to remove.');
        pending=await requests.pending();
        check(available()&&session.draftId===id&&draft()===original,'The selected local draft changed. Open it again before removing it.');
        check(!pending.length,'Reconcile the retained original save before removing a local draft.');
        const previous=Object.fromEntries(['drafts','draftId','mode','revision','targetKey','page','reportPage','notice'].map(key=>[key,session[key]]));
        session.drafts={...session.drafts};delete session.drafts[id];
        const next=Object.entries(session.drafts).sort((a,b)=>String(b[1].createdAt).localeCompare(String(a[1].createdAt))||a[0].localeCompare(b[0]))[0];
        session.draftId=next?.[0]||null;session.mode=next?'draft':'empty';session.revision=null;
        session.targetKey=null;session.page=0;session.reportPage=0;
        session.notice=next?'Local draft removed. Selected '+(next[1].inputs.document.title||'Funding draft')+' · '+next[1].createdAt+'.':
          'Local draft removed. No local draft is selected. Open a saved edition or prepare a new draft.';
        persist();
        if(storageError){Object.assign(session,previous);render();throw new Error('The local removal could not be retained. The original draft remains available here for download and recovery.');}
        selected=null;render();return;
      }
      if(action==='edition-json'){check(selected,'Select a saved edition.');download(JSON.stringify(selected.edition,null,2)+'\n',caseId+'-funding-r'+selected.edition.revision+'.json');return;}
      if(action==='report-json'){const value=draft()?.preview;check(value,'Calculate the complete draft first.');download(JSON.stringify(value,null,2)+'\n',caseId+'-funding-preview.json');return;}
      if(action==='export'){
        check(selected,'Select the exact saved funding edition.');
        const frozen={revision:selected.edition.revision,hash:selected.edition.reportSha256,version:currentCase.program.version};
        const response=await api('/api/operations/'+caseId+'/cost-funding/export.zip?revision='+frozen.revision+
          '&expectedVersion='+frozen.version+'&expectedReportSha256='+frozen.hash,undefined,{download:true});
        const blob=await response.blob();if(!available())return;
        download(blob,caseId+'-cost-funding-r'+frozen.revision+'.zip','application/zip');return;
      }
      if(action==='previous-report'||action==='next-report'){session.reportPage=Math.max(0,session.reportPage+(action==='next-report'?1:-1));persist();render();return;}
      if(action==='previous-targets'||action==='next-targets'){session.page=Math.max(0,session.page+(action==='next-targets'?1:-1));persist();render();return;}
      if(action==='close-target'){session.targetKey=null;persist();render();return;}
      const d=draft();check(d&&editable()&&!pending.length,'Open an editable draft and reconcile any retained save.');
      if(action==='rebind'){
        d.caseVersion=currentCase.program.version;d.inputs.expectedRevision=history[0]?.revision||0;invalidate();render();return;
      }
      if(action==='select-target'){check(allTargets().some(r=>r.key===target.dataset.key),'The selected original row changed.');session.targetKey=target.dataset.key;persist();render();return;}
      if(action==='add-fund'){
        check(d.inputs.document.funds.length<50,'The book supports 50 funding sources.');
        d.inputs.document.funds.push({id:'fund-'+uuid().slice(0,16),name:'Funding source',kind:'INTERNAL',reference:'',decision:'PROPOSED',sourceIds:[],
          conditions:'',costWindowStart:null,costWindowEnd:null,receiptTiming:'',limitUsd:null,note:''});
      }else if(action==='remove-fund'){
        const i=Number(target.dataset.index),fund=d.inputs.document.funds[i];check(fund,'The selected fund changed.');
        check(!d.inputs.document.assignments.some(r=>r.allocations.some(p=>p.fundId===fund.id)),'Reassign or remove this fund’s retained allocation parts before removing its definition.');
        d.inputs.document.funds.splice(i,1);
      }else if(action==='row-note'){
        const row=allTargets().find(r=>r.key===target.dataset.key);check(row&&!row.orphan,'Select a current original source row.');findAssignment(row,true);
      }else if(action==='add-part'){
        const row=allTargets().find(r=>r.key===target.dataset.key);check(row&&!row.orphan,'Select a current original source row.');
        const existing=findAssignment(row).row;
        const fund=d.inputs.document.funds.find(f=>!(existing?.allocations||[]).some(p=>p.fundId===f.id));
        check(fund,'Add an unused funding source before adding another split.');
        const {row:assignment}=findAssignment(row,true);
        assignment.allocations.push({fundId:fund.id,quantity:'0',eligibility:'UNASSESSED',sourceIds:[],basis:''});
      }else if(action==='remove-part'){
        const r=d.inputs.document.assignments[Number(target.dataset.assignment)];check(r,'The selected allocation changed.');
        r.allocations.splice(Number(target.dataset.part),1);
      }else if(action==='clear-target'){
        const i=d.inputs.document.assignments.findIndex(r=>keyOf(r)===target.dataset.key);check(i>=0,'That assignment is absent.');
        d.inputs.document.assignments.splice(i,1);
      }else return;
      invalidate();render();
    });
  });
  const earlier=mountEarlierStaffDesk({root,staffContext:pinnedContext,title:'Cost funding',
    isBusy:()=>busy||hostBusy||!initialized,setDeskBusy:value=>{busy=value;if(value)controls();else render();},
    readCopy:async()=>{
      const editor=JSON.parse(localStorage.getItem(earlierStorageKey)||'null');
      const original=createFundingRequests({caseId,caseCreatedAt,call:saveApi,available:()=>false});
      const retained=await original.exportRecovery();
      if(!editor&&!retained.records.length)return null;
      if(editor)check(editor.schema===SCHEMA&&editor.caseId===caseId&&editor.caseCreatedAt===caseCreatedAt,'Choose the complete earlier funding editor for this original case.');
      return {schema:SCHEMA+'.recovery',caseId,caseCreatedAt,drafts:copy(editor?.drafts||{}),
        selection:{mode:editor?.mode||'empty',draftId:editor?.draftId??null,revision:editor?.revision??null},requests:retained};
    },
    describeCopy:value=>Object.keys(value.drafts||{}).length+' editable funding drafts · '+value.requests.records.length+' original request records',
    filename:caseId+'-earlier-cost-funding-editor.json',
    openCopy:async value=>{await recoveryExport();await importFile(new File([JSON.stringify(value)],'earlier-cost-funding-editor.json',{type:'application/json'}),'recovery');}
  });
  const pagehide=()=>persist();window.addEventListener('pagehide',pagehide);
  render();
  const ready=(async()=>{
    await reload();if(!available())return;
    initialized=true;
    if(session.requestOpen){session.mode='saved';session.revision=session.requestOpen.revision;delete session.requestOpen;}
    if(session.mode==='saved'&&session.revision)await openSaved(session.revision);
    else render();
  })().catch(error=>{if(available()){session.notice=error.message;render();}throw error;});
  return {ready,setHostBusy(value){hostBusy=Boolean(value);controls();},
    dispose(){earlier.dispose();persist();active=false;generation++;window.removeEventListener('pagehide',pagehide);}};
}
