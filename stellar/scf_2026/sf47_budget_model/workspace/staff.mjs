import {readStaffSession,staffRequest as requestStaff,signInStaff,signInOwner,signOutStaff,currentStaffContext,staffDeskStorageKey} from './staff-session.mjs';
import {mountStaffRecovery} from './staff-recovery.mjs';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const option = (value,label,selected=false) => '<option value="'+esc(value)+'"'+(selected?' selected':'')+'>'+esc(label)+'</option>';
const input = (name,label,value='',attributes='') => '<label>'+esc(label)+'<input name="'+esc(name)+'" value="'+esc(value)+'" '+attributes+'></label>';
const area = (name,label,value='') => '<label class="wide">'+esc(label)+'<textarea name="'+esc(name)+'">'+esc(value)+'</textarea></label>';
const button = (label,action,id='',disabled=false) => '<button type="button" data-action="'+action+'" data-id="'+esc(id)+'"'+(disabled?' disabled':'')+'>'+esc(label)+'</button>';
const table = (heads,rows) => '<div class="table-scroll"><table><thead><tr>'+heads.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(c=>'<tr>'+c.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const blank = text => '<p class="empty">'+esc(text)+'</p>';
const descriptions = {
  lead:'Operate the selected delivery cases, plans, source receiving, grant milestones and customer handovers.',
  finance:'Record work and invoices, review supplier charges, reconcile cash, manage billing and prepare financial forecasts in the selected cases.',
  reviewer:'Read the selected cases, accept or reopen recorded work, and freeze original case, implementation, cohort and completion reviews.',
  contributor:'Record your completed work and invoices, attach original source files and submit work for review.',
  owner:'Administer the installation and operate its complete planning and delivery workspace.'
};
let staffContext=null;
const staffRequest=(path,body,options={})=>requestStaff(path,body,{...options,staffContext:options.staffContext===undefined?staffContext:options.staffContext});
let identity=null, members=[], catalog=[], board=null, selectedCase=null, credential=null, eventsAfter=0, busy=false, draft=null;
const requests = new Map();
function inform(message,error=false) {$('#message').textContent=message;$('#message').dataset.error=String(error);}
async function run(action) {
  if(busy)return;
  busy=true;
  document.querySelectorAll('button').forEach(x=>{x.dataset.wasDisabled=String(x.disabled);x.disabled=true;});
  const forms=[...document.querySelectorAll('form,#work-case')].map(element=>({element,inert:element.inert}));
  forms.forEach(({element})=>{element.inert=true;});
  try {await action();}
  catch(error){inform(error.message,true);}
  finally {
    busy=false;
    document.querySelectorAll('button[data-was-disabled]').forEach(x=>{x.disabled=x.dataset.wasDisabled==='true';delete x.dataset.wasDisabled;});
    forms.forEach(({element,inert})=>{element.inert=inert;});
    renderDraftState();
  }
}
document.addEventListener('click',event=>{if(busy&&event.target.closest('button,a.button')){event.preventDefault();event.stopImmediatePropagation();}},true);
async function requestId(path,body,context=staffContext) {
  const staffId=staffDeskStorageKey('sf47.team.requests',context);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(body)));
  const key=staffId+'\0'+path+'\0'+Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(!requests.has(key))requests.set(key,crypto.randomUUID());
  return requests.get(key);
}
async function mutate(path,body) {
  const context=staffContext?{...staffContext}:null,original=structuredClone(body);
  return staffRequest(path,{...original,requestId:await requestId(path,original,context)},{staffContext:context});
}
function download(blob,name) {
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function downloadJson(value,name) {download(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}),name);}
async function openSession(session) {
  if(draft&&(session.principal.id!==draft.staffId||(draft.staffContext?.installationId&&session.installationId!==draft.staffContext.installationId))) {
    await signOutStaff();
    throw new Error('Sign in as the person who opened this draft to continue it.');
  }
  identity=session.principal;staffContext=currentStaffContext();
  $('#sign-in').hidden=true;$('#signed-in').hidden=false;$('#sign-out').hidden=false;
  $('#person-name').textContent=identity.displayName;
  $('#person-role').textContent=(identity.role==='owner'?'Installation owner':identity.role[0].toUpperCase()+identity.role.slice(1))+' · '+identity.actor;
  $('#expiry').textContent='Sessions close after 30 minutes idle or eight hours.';
  $('#staff-admin').hidden=!identity.administrator;
  $('#contributor').hidden=identity.role!=='contributor';
  $('#operator-link').hidden=identity.role==='contributor';
  $('#role-description').textContent=descriptions[identity.role];
  $('#login-form').reset();$('#owner-form').reset();
  if(identity.administrator)await refreshStaff();
  if(identity.role==='contributor')await refreshWork();
}
async function refreshStaff() {
  const [profiles,choices]=await Promise.all([staffRequest('/api/staff/members'),staffRequest('/api/staff/catalog')]);
  members=profiles.members;catalog=choices.cases;
  $('#profiles').innerHTML=members.length?table(['Staff','Role and cases','Access','Actions'],members.map(p=>[
    '<strong>'+esc(p.displayName)+'</strong><small>'+esc(p.id)+'</small>',
    esc(p.role)+(p.administrator?' · administrator':'')+'<small>'+(p.caseIds.includes('*')?'All operating cases':p.caseIds.map(id=>esc(catalog.find(c=>c.id===id)?.name||id)).join('<br>'))+'</small>',
    '<span class="tag">'+esc(p.state)+'</span><small>'+p.activeSessions+' session'+(p.activeSessions===1?'':'s')+(p.credentialReady?'':' · code required')+'</small>',
    '<div class="actions">'+button('Edit','profile-edit',p.id)+button('Reissue code','profile-rotate',p.id)+button('Sign out sessions','profile-sign-out',p.id)+button('Revoke','profile-revoke',p.id,p.state==='REVOKED')+'</div>'
  ])):blank('Add the first named staff profile. A contributor needs an existing operating case and contributor record.');
}
function profileEditor(row=null) {
  const value=row||{id:'',displayName:'',role:'lead',caseIds:['*'],contributorIds:{},administrator:false};
  $('#profile-editor').hidden=false;
  $('#profile-editor').innerHTML='<h3>'+(row?'Edit staff profile':'Add staff profile')+'</h3><form id="profile-form" class="form">'
    +input('id','Staff sign-in ID',value.id,'required minlength="3" maxlength="64" pattern="[a-z][a-z0-9._-]{2,63}" '+(row?'readonly':''))
    +input('displayName','Display name',value.displayName,'required maxlength="180"')
    +'<label>Role<select name="role">'+['lead','finance','contributor','reviewer'].map(role=>option(role,role[0].toUpperCase()+role.slice(1),role===value.role)).join('')+'</select></label>'
    +'<div class="checks"><label><input type="checkbox" name="administrator"'+(value.administrator?' checked':'')+'>Installation administrator</label></div>'
    +'<fieldset class="wide"><legend>Case access</legend><div class="checks"><label><input type="checkbox" name="allCases"'+(value.caseIds.includes('*')?' checked':'')+'>All operating cases</label></div>'
    +'<p class="muted">A contributor uses specific cases and their existing contributor record. Installation administrators are leads with access to all cases.</p>'
    +(catalog.length?table(['Case','Contributor identity'],catalog.map(c=>[
      '<label><input type="checkbox" name="caseId" value="'+esc(c.id)+'"'+(value.caseIds.includes(c.id)?' checked':'')+'> '+esc(c.name)+'</label><small>'+esc(c.id)+'</small>',
      '<select name="person:'+esc(c.id)+'" aria-label="Contributor in '+esc(c.name)+'">'+option('','Choose for a contributor profile')+c.contributors.map(p=>option(p.id,p.name,value.contributorIds[c.id]===p.id)).join('')+'</select>'
    ])):blank('Open a case in Planning & Operations to make specific case assignments.'))+'</fieldset>'
    +'<div class="actions wide"><button class="primary" type="submit">'+(row?'Save profile and sign out existing sessions':'Create profile and issue access code')+'</button>'+button('Cancel','profile-cancel')+'</div></form>';
  $('#profile-form').dataset.revision=String(row?.revision||0);
  $('#profile-form').addEventListener('change',event=>{
    if(event.target.name==='role'&&event.target.value==='contributor') {
      $('#profile-form').elements.allCases.checked=false;$('#profile-form').elements.administrator.checked=false;
    }
  });
  $('#profile-form').addEventListener('submit',event=>{
    event.preventDefault();
    run(async()=>{
      const form=event.currentTarget,values=new FormData(form),cases=values.has('allCases')?['*']:values.getAll('caseId');
      const bindings={};
      for(const id of cases)if(values.get('person:'+id))bindings[id]=values.get('person:'+id);
      const body={id:values.get('id'),displayName:values.get('displayName'),role:values.get('role'),
        caseIds:cases,contributorIds:bindings,administrator:values.has('administrator')};
      const revision=Number(form.dataset.revision);if(revision)body.expectedRevision=revision;
      const result=await mutate('/api/staff/members/'+(revision?'update':'create'),body);
      $('#profile-editor').hidden=true;showCredential(result);await refreshStaff();
      inform(revision?'Saved the profile. Existing sessions for this person are signed out.':'Created the staff profile.');
    });
  });
}
function showCredential(result) {
  if(!result.accessCode) {
    if(result.credentialIssued)inform('The original code was issued once. Use Reissue code to recover access.',true);
    return;
  }
  credential={schema:'stellar-forge.sf47-staff-access-card.v1',staffId:result.member.id,
    displayName:result.member.displayName,role:result.member.role,url:location.origin+'/team',
    accessCode:result.accessCode};
  $('#credential').hidden=false;
  $('#credential').innerHTML='<h3>Access code for '+esc(credential.displayName)+'</h3><p>Shown once. Save this private access file before clearing the code.</p>'
    +'<p>Staff ID: <code>'+esc(credential.staffId)+'</code></p><code class="credential-code">'+esc(credential.accessCode)+'</code>'
    +'<div class="actions">'+button('Download private access file','credential-download')+button('Clear displayed code','credential-clear')+'</div>';
}
function currentCase() {return board?.cases.find(c=>c.program.id===selectedCase);}
async function refreshWork() {
  board=await staffRequest('/api/staff/workboard');
  if(!board.cases.some(c=>c.program.id===selectedCase))selectedCase=board.cases[0]?.program.id||null;
  $('#work-case').innerHTML=board.cases.map(c=>option(c.program.id,c.program.name,c.program.id===selectedCase)).join('');
  renderWork();
  reconcileDraft();
}
function closeDraft() {
  draft=null;
  $('#work-editor').replaceChildren();$('#work-editor').hidden=true;
  $('#work-case').disabled=false;
}
function leaveDraft() {
  if(!draft)return true;
  if(draft.pending) {
    inform('Use Receive original save before leaving this draft. Its original request is still available on this page.',true);
    $('#work-editor').scrollIntoView({block:'nearest'});
    return false;
  }
  if(draft.dirty&&!confirm('Discard the unsaved changes in this draft?'))return false;
  closeDraft();return true;
}
function beginDraft(kind,c,id=null) {
  const row=id?(kind==='work'?c.work:c.invoices).find(value=>value.id===id):null;
  draft={kind,id,caseId:c.program.id,staffId:identity.id,staffContext:staffContext?{...staffContext}:null,contributorId:c.contributor.id,
    version:c.program.version,baseline:JSON.stringify(row||null),dirty:false,pending:null,
    conflict:null,blocked:'',notice:''};
}
function draftCase() {return board?.cases.find(c=>c.program.id===draft?.caseId);}
function reconcileDraft() {
  if(!draft)return;
  const c=draftCase();
  draft.blocked=!c?'This case is no longer assigned to this sign-in. Your draft is still on this page.'
    :c.contributor.id!==draft.contributorId?'The contributor assignment changed. Your draft keeps its original person.'
    :c.program.state==='CLOSED'?'This case is closed. Your draft is retained while the lead reviews it.':'';
  if(c&&!draft.pending&&!draft.blocked) {
    const row=draft.id?(draft.kind==='work'?c.work:c.invoices).find(value=>value.id===draft.id):null;
    if(draft.id&&JSON.stringify(row||null)!==draft.baseline) {
      draft.conflict={row,version:c.program.version,
        editable:!!row&&row.state===(draft.kind==='work'?'LOGGED':'RECEIVED')};
      draft.notice='This record changed while your draft was open. Review the current saved record below.';
    } else {
      if(draft.version!==c.program.version)draft.notice='Read the current case. Your entered values and selected file are retained.';
      draft.version=c.program.version;draft.conflict=null;
    }
  }
  renderDraftState();
}
function savedRecordSummary(row) {
  if(!row)return blank('The original record is no longer available in this case.');
  const states={LOGGED:'Logged',RECEIVED:'Received',SUBMITTED:'Submitted',ACCEPTED:'Accepted',VOID:'Void'};
  const values=draft.kind==='work'
    ?[['Completed work',esc(row.description)],['Hours',esc(row.hours)],
      ['Work dates',esc(row.startDate)+' – '+esc(row.endDate)],['Source reference',esc(row.sourceNote)]]
    :[['Invoice',esc(row.number)],['Issued / due',esc(row.issuedDate)+' / '+esc(row.dueDate||'Not entered')],
      ['Total', 'USD '+esc(row.totalUsd)],['Source reference',esc(row.sourceNote)]];
  values.push(['State',esc(states[row.state]||row.state)]);
  let result=table(['Current saved field','Value'],values.map(([name,value])=>[esc(name),value]));
  if(draft.kind==='invoice')result+=table(['Invoice line','Amount'],row.lines.map(line=>[esc(line.description),'USD '+esc(line.amountUsd)]));
  return result;
}
function renderDraftState() {
  if(!draft)return;
  const form=$('#record-form')||$('#source-form');if(!form)return;
  let status=$('#draft-status');
  if(!status){status=document.createElement('div');status.id='draft-status';status.setAttribute('aria-live','polite');form.before(status);}
  status.innerHTML=draft.pending
    ?'<p>'+(busy?(draft.pending.uncertain?'Receiving the original save.':'Saving the original request.')
      :'The save response is unavailable. Receive the original save to recover its result.')
      +' The original file and entered values are retained on this page.</p>'
    :draft.blocked?'<p>'+esc(draft.blocked)+'</p>'
    :draft.conflict?'<p>'+esc(draft.notice)+'</p>'+savedRecordSummary(draft.conflict.row)
      +(draft.conflict.editable?'<p>Your draft remains below. Keep it to apply your intended values to this current record, or cancel to leave the saved record as shown.</p><div class="actions">'
        +button('Keep my draft on the current record','draft-use-current')+'</div>':'<p>The current record is no longer editable in the contributor desk. Your draft remains below.</p>')
    :draft.notice?'<p>'+esc(draft.notice)+'</p>':'';
  form.querySelectorAll('input,select,textarea,button[type=button]').forEach(element=>{element.inert=!!draft.pending;});
  const submit=form.querySelector('button[type=submit]');
  if(!submit.dataset.originalLabel)submit.dataset.originalLabel=submit.textContent;
  submit.textContent=draft.pending?(busy?(draft.pending.uncertain?'Receiving original save':'Saving'):'Receive original save'):submit.dataset.originalLabel;
  submit.disabled=busy||(!draft.pending&&!!(draft.blocked||draft.conflict));
  form.noValidate=!!draft.pending;
  $('#work-case').disabled=!!draft.pending;
}
async function saveDraft(action,data,note) {
  const editing=draft;
  if(!editing)throw new Error('Open the intended work, invoice or source draft.');
  if(!editing.pending) {
    if(editing.blocked||editing.conflict)throw new Error('Review the current saved record before saving this draft.');
    const path='/api/operations/'+editing.caseId+'/command';
    const body={expectedVersion:editing.version,actor:identity.actor,action,data,note};
    editing.pending={path,body:{...body,requestId:await requestId(path,body,editing.staffContext)},uncertain:false};
  }
  renderDraftState();
  try {await staffRequest(editing.pending.path,editing.pending.body,{staffContext:editing.staffContext});}
  catch(error) {
    const definite=error.code==='OPERATIONS_CONFLICT'
      ||(!editing.pending.uncertain&&[400,409,413,415,422].includes(error.status));
    if(definite)editing.pending=null;
    else editing.pending.uncertain=true;
    if(error.status===401)$('#sign-in').hidden=false;
    if(error.code==='OPERATIONS_CONFLICT') {
      try {await refreshWork();}catch(refreshError) {
        editing.notice='Your draft is retained. Refresh work when the connection returns.';
      }
    }
    renderDraftState();throw error;
  }
  const kind=editing.kind;
  closeDraft();
  await refreshWork();
  inform(kind==='source'?'The original file is retained and available for attachment.':'Saved the original '+kind+' record.');
}
$('#work-editor').addEventListener('input',()=>{if(draft)draft.dirty=true;});
$('#work-editor').addEventListener('change',()=>{if(draft)draft.dirty=true;});
window.addEventListener('beforeunload',event=>{
  if(draft&&(draft.dirty||draft.pending)){event.preventDefault();event.returnValue='';}
});
const attachments = ids => {
  const c=currentCase();
  return '<fieldset class="wide source-checks"><legend>Original attachments</legend><div class="checks">'
    +(c.sources.length?c.sources.map(s=>'<label><input type="checkbox" name="sourceIds" value="'+s.id+'"'+(ids?.includes(s.id)?' checked':'')+'>'+esc(s.filename)+'</label>').join(''):'Upload a work or invoice source before attaching it to a record.')
    +'</div></fieldset>';
};
function renderWork() {
  const c=currentCase();
  if(!c){$('#work-board').innerHTML=blank('No contributor case is assigned to this profile.');return;}
  const closed=c.program.state==='CLOSED';
  const invoiceBalances=new Map((c.invoiceBalances||[]).map(row=>[row.id,row]));
  $('#work-board').innerHTML='<section class="panel"><div class="section-heading"><div><h3>'+esc(c.program.name)+'</h3><p>'+esc(c.contributor.name)+' · Case version '+c.program.version+' · '+esc(c.program.state)+'</p></div>'
    +'<div class="actions">'+button('Record completed work','work-new','',closed)+button('Record invoice','invoice-new','',closed)+button('Upload original source','source-new','',closed)+'</div></div>'
    +'<h3>Work records</h3>'+(c.work.length?table(['Completed work','Dates / hours','Review state','Actions'],c.work.map(w=>[
      esc(w.description)+'<small>'+esc(w.costId||'No work package')+'</small>',
      esc(w.startDate)+' – '+esc(w.endDate)+'<small>'+esc(w.hours)+' hours · '+esc(w.fundingBasis)+'</small>',
      '<span class="tag">'+esc(w.state)+'</span>'+((w.reviewedBy||w.reviewNote)?'<small>'+esc(w.reviewedBy||'')+' '+esc(w.reviewNote||'')+'</small>':''),
      '<div class="actions">'+button('Edit','work-edit',w.id,closed||w.state!=='LOGGED')
        +button('Submit','work-submit',w.id,closed||w.state!=='LOGGED')+button('Void','work-void',w.id,closed||w.state!=='LOGGED')+'</div>'
    ])):blank('Your completed work will appear here.'))+'</section>'
    +'<section class="panel"><h3>Invoices</h3>'+(c.invoices.length?table(['Invoice','Dates','Amount / state','Actions'],c.invoices.map(i=>[
      esc(i.number)+'<small>'+i.lines.length+' line'+(i.lines.length===1?'':'s')+'</small>',
      'Issued '+esc(i.issuedDate)+'<small>Due '+esc(i.dueDate||'Not entered')+'</small>',
      'USD '+esc(i.totalUsd)+'<small>'+esc(i.state)+'</small>'
        +(invoiceBalances.has(i.id)?'<small>Paid USD '+esc(invoiceBalances.get(i.id).paidUsd)
          +' · Open USD '+esc(invoiceBalances.get(i.id).openUsd)
          +(Number(invoiceBalances.get(i.id).overpaidUsd)>0?' · Credit USD '+esc(invoiceBalances.get(i.id).overpaidUsd):'')+'</small>':''),
      '<div class="actions">'+button('Edit','invoice-edit',i.id,closed||i.state!=='RECEIVED')+button('Void','invoice-void',i.id,closed||i.state!=='RECEIVED')+'</div>'
    ])):blank('Record the original invoice number, dates, line amounts and completed work.'))+'</section>'
    +'<section class="panel"><h3>Original sources</h3>'+(c.sources.length?table(['File','Source','Download'],c.sources.map(s=>[
      esc(s.filename)+'<small>'+s.bytes.toLocaleString()+' bytes · '+esc(s.kind)+'</small>',
      '<code>'+esc(s.sha256)+'</code>',
      '<a href="/api/operations/'+c.program.id+'/sources/'+s.id+'">Download original</a>'
    ])):blank('Upload original work or invoice files. Their original bytes are retained in the operating case.'))+'</section>';
}
function packageSelect(name,selected) {
  return '<label>Work package<select name="'+name+'">'+option('','No work package')+currentCase().packages.map(p=>option(p.id,p.id+' · '+p.description,selected===p.id)).join('')+'</select></label>';
}
function invoiceLine(line={},index=0) {
  const c=currentCase();
  return '<fieldset data-invoice-line data-line-id="'+esc(line.id||'line-'+(index+1))+'"><legend>Invoice line '+(index+1)+'</legend><div class="form">'
    +input('lineDescription','Description',line.description||'','required')
    +input('lineAmount','Amount in USD',line.amountUsd||'','required inputmode="decimal" pattern="[0-9]+([.][0-9]{1,2})?"')
    +packageSelect('lineCost',line.costId)
    +'<fieldset class="wide"><legend>Completed work covered by this line</legend><div class="checks">'
    +c.work.filter(w=>w.state!=='VOID').map(w=>'<label><input type="checkbox" name="lineWork" value="'+w.id+'"'+(line.workIds?.includes(w.id)?' checked':'')+'>'+esc(w.description)+' ('+esc(w.hours)+' hours)</label>').join('')
    +'</div></fieldset><div>'+button('Remove line','invoice-line-remove')+'</div></div></fieldset>';
}
function recordEditor(kind,id=null) {
  if(!leaveDraft())return;
  const c=currentCase();if(!c)return;
  beginDraft(kind,c,id);
  const row=(kind==='work'?c.work:c.invoices).find(r=>r.id===id)||{};
  const date=new Date().toISOString().slice(0,10);
  $('#work-editor').hidden=false;
  let fields;
  if(kind==='work')fields=area('description','Completed work',row.description)
    +packageSelect('costId',row.costId)+input('hours','Recorded hours',row.hours,'required inputmode="decimal"')
    +input('startDate','Work start',row.startDate||date,'required type="date"')+input('endDate','Work end',row.endDate||date,'required type="date"')
    +'<label>Funding basis<select name="fundingBasis">'+['PREAWARD','GRANT','CUSTOMER','INTERNAL'].map(x=>option(x,x,x===(row.fundingBasis||'PREAWARD'))).join('')+'</select></label>';
  else fields=input('number','Original invoice number',row.number,'required maxlength="200"')
    +input('issuedDate','Issued on',row.issuedDate||date,'required type="date"')+input('dueDate','Due on',row.dueDate||'','type="date"')
    +'<div class="wide" id="invoice-lines">'+(row.lines||[{}]).map(invoiceLine).join('')+'</div><div class="wide">'+button('Add invoice line','invoice-line-add')+'</div>';
  $('#work-editor').innerHTML='<h3>'+(id?'Edit ':'Record ')+(kind==='work'?'completed work':'invoice')+'</h3><form id="record-form" class="form">'
    +fields+attachments(row.sourceIds)+area('sourceNote','Source reference',row.sourceNote)+area('note','Reason / note',id?'Update original '+kind+' record':'Record original '+kind)
    +'<div class="actions wide"><button type="submit" class="primary">Save '+(kind==='work'?'work':'invoice')+'</button>'+button('Cancel','record-cancel')+'</div></form>';
  $('#record-form').addEventListener('submit',event=>{
    event.preventDefault();
    run(async()=>{
      if(draft.pending)return saveDraft();
      const form=event.currentTarget,values=new FormData(form);
      const data={contributorId:draft.contributorId,sourceIds:values.getAll('sourceIds'),sourceNote:values.get('sourceNote')};
      if(id)data.id=id;
      if(kind==='work')Object.assign(data,{description:values.get('description'),costId:values.get('costId')||null,hours:values.get('hours'),
        startDate:values.get('startDate'),endDate:values.get('endDate'),fundingBasis:values.get('fundingBasis')});
      else Object.assign(data,{number:values.get('number'),issuedDate:values.get('issuedDate'),dueDate:values.get('dueDate')||null,
        lines:[...form.querySelectorAll('[data-invoice-line]')].map(line=>({id:line.dataset.lineId,
          description:line.querySelector('[name=lineDescription]').value,amountUsd:line.querySelector('[name=lineAmount]').value,
          costId:line.querySelector('[name=lineCost]').value||null,workIds:[...line.querySelectorAll('[name=lineWork]:checked')].map(x=>x.value)}))});
      await saveDraft(kind+'.save',data,values.get('note'));
    });
  });
}
async function command(c,action,data,note) {
  return mutate('/api/operations/'+c.program.id+'/command',
    {expectedVersion:c.program.version,actor:identity.actor,action,data,note});
}
function sourceEditor() {
  if(!leaveDraft())return;
  const c=currentCase();if(!c)return;
  beginDraft('source',c);
  $('#work-editor').hidden=false;
  $('#work-editor').innerHTML='<h3>Upload an original source</h3><form id="source-form" class="form">'
    +'<label>Source file<input type="file" name="file" required></label><label>Source kind<select name="kind">'+option('work','Work')+option('invoice','Invoice')+'</select></label>'
    +input('sourceUrl','Original source URL, if available','','type="url"')
    +'<div class="actions wide"><button class="primary" type="submit">Retain original file</button>'+button('Cancel','record-cancel')+'</div></form>';
  $('#source-form').addEventListener('submit',event=>{
    event.preventDefault();
    run(async()=>{
      if(draft.pending)return saveDraft();
      const values=new FormData(event.currentTarget),file=values.get('file');
      if(!file.size||file.size>8*1024*1024)throw new Error('Select a nonempty original file up to 8 MiB.');
      const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
      for(let n=0;n<bytes.length;n+=8192)binary+=String.fromCharCode(...bytes.subarray(n,n+8192));
      await saveDraft('source.add',{filename:file.name,contentBase64:btoa(binary),mediaType:file.type||'application/octet-stream',
        kind:values.get('kind'),sourceUrl:values.get('sourceUrl')},'Retain original contributor source');

    });
  });
}
document.addEventListener('click',event=>{
  const control=event.target.closest('[data-action]');if(!control)return;
  const action=control.dataset.action,id=control.dataset.id;
  if(action==='profile-edit')return profileEditor(members.find(p=>p.id===id));
  if(action==='profile-cancel'){$('#profile-editor').hidden=true;return;}
  if(action==='credential-clear'){credential=null;$('#credential').replaceChildren();$('#credential').hidden=true;return;}
  if(action==='credential-download')return downloadJson(credential,'grant-access-'+credential.staffId+'.json');
  if(action==='work-new'||action==='invoice-new')return recordEditor(action.split('-')[0]);
  if(action==='work-edit'||action==='invoice-edit')return recordEditor(action.split('-')[0],id);
  if(action==='record-cancel'){leaveDraft();return;}
  if(action==='draft-use-current') {
    if(!draft?.conflict?.editable)return;
    draft.baseline=JSON.stringify(draft.conflict.row);
    draft.version=draft.conflict.version;draft.conflict=null;
    draft.notice='Your draft is retained against the reviewed current record. Save it when the intended values are ready.';
    renderDraftState();return;
  }
  if(action==='source-new')return sourceEditor();
  if(action==='invoice-line-add') {
    const lines=$('#invoice-lines');if(lines.children.length>=200)return inform('An invoice supports up to 200 lines.',true);
    lines.insertAdjacentHTML('beforeend',invoiceLine({id:'line-'+crypto.randomUUID().slice(0,12)},lines.children.length));draft.dirty=true;return;
  }
  if(action==='invoice-line-remove') {control.closest('[data-invoice-line]').remove();draft.dirty=true;return;}
  run(async()=>{
    if(['profile-rotate','profile-revoke','profile-sign-out'].includes(action)) {
      const p=members.find(x=>x.id===id),verb=action.slice('profile-'.length);
      if(!confirm((verb==='rotate'?'Replace the access code and enable':verb==='revoke'?'Revoke all access for':'Sign out every session for')+' '+p.displayName+'?'))return;
      const result=await mutate('/api/staff/members/'+verb,{id:p.id,expectedRevision:p.revision});
      showCredential(result);await refreshStaff();inform('Updated access for '+p.displayName+'.');
      return;
    }
    const matched=/^(work|invoice)-(submit|void)$/.exec(action);
    if(matched) {
      if(!leaveDraft())return;
      const note=prompt(matched[2]==='submit'?'Submission note':'Reason for voiding the original record',
        matched[2]==='submit'?'Submit completed work for review':'');
      if(note===null)return;if(!note.trim())throw new Error('Record a reason for this transition.');
      await command(currentCase(),matched[1]+'.'+matched[2],{id},note);await refreshWork();inform('Saved the original record transition.');
    }
  });
});
$('#login-form').addEventListener('submit',event=>{event.preventDefault();const values=new FormData(event.currentTarget);run(async()=>{await openSession(await signInStaff(values.get('staffId'),values.get('accessCode')));inform('Signed in.');});});
$('#owner-form').addEventListener('submit',event=>{event.preventDefault();const values=new FormData(event.currentTarget);run(async()=>{await openSession(await signInOwner(values.get('ownerKey').trim()));inform('Owner access opened.');});});
$('#sign-out').addEventListener('click',()=>run(async()=>{if(!leaveDraft())return;await signOutStaff();credential=null;requests.clear();location.assign('/team');}));
$('#new-profile').addEventListener('click',()=>profileEditor());
$('#refresh-staff').addEventListener('click',()=>run(refreshStaff));
$('#refresh-work').addEventListener('click',()=>run(async()=>{await refreshWork();inform('Read the current case.');}));
$('#download-work').addEventListener('click',()=>downloadJson(board,'grant-my-work-'+identity.id+'.json'));
$('#work-case').addEventListener('change',event=>{if(!leaveDraft()){event.target.value=selectedCase;return;}selectedCase=event.target.value;renderWork();});
$('#backup').addEventListener('click',()=>run(async()=>{
  const response=await staffRequest('/api/staff/installation/export.zip',undefined,{download:true});
  download(await response.blob(),'grant-team-installation.zip');inform('Downloaded the complete operating installation and recovery instructions.');
}));
$('#load-events').addEventListener('click',()=>run(async()=>{
  const result=await staffRequest('/api/staff/events?after='+eventsAfter+'&limit=100');
  const html=table(['When / operator','Action','Staff / record'],result.events.map(e=>[
    esc(e.at)+'<small>'+esc(e.actor)+'</small>',esc(e.action),
    esc(e.memberId)+'<small>'+esc(e.detail.path||e.detail.role||'')+(e.detail.version?' · version '+e.detail.version:'')+'</small>']));
  if(eventsAfter)$('#events').insertAdjacentHTML('beforeend',html);else $('#events').innerHTML=html;
  eventsAfter=result.nextAfter||0;$('#load-events').textContent=result.nextAfter?'Load next events':'Refresh events';
}));
mountStaffRecovery({getContext:()=>draft?.staffContext||staffContext,inform,onRestored:session=>{
  identity=session.principal;staffContext=currentStaffContext();
  $('#person-name').textContent=identity.displayName;
  $('#person-role').textContent=(identity.role==='owner'?'Installation owner':identity.role[0].toUpperCase()+identity.role.slice(1))+' · '+identity.actor;
  $('#sign-in').hidden=true;renderDraftState();
}});
const fragment=new URLSearchParams(location.hash.slice(1)),owner=fragment.get('access');
if(owner)history.replaceState(null,'',location.pathname+location.search);
run(async()=>{
  const session=owner?await signInOwner(owner):await readStaffSession();
  if(session.authenticated)await openSession(session);
});
