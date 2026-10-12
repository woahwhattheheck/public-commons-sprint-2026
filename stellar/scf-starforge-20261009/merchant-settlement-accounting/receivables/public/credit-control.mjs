// MIT. Customer credit decisions inside the original merchant receivables application.
import {cashDate as date, cashCurrency as currencyName, cashLabel as label} from './cash-planning-display.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(text,action,id='',extra='')=>'<button type="button" data-action="credit-control-'+escape(action)+'" data-id="'+escape(id)+'" '+extra+'>'+escape(text)+'</button>';
const textInput=(title,name,value,extra='')=>'<label>'+escape(title)+'<input name="'+name+'" value="'+escape(value)+'" '+extra+'></label>';
const check=(title,name,value)=>'<label class="row"><input type="checkbox" name="'+name+'"'+(value?' checked':'')+'> '+escape(title)+'</label>';
const table=(headers,rows)=>'<div class="table-wrap"><table><thead><tr>'+headers.map(h=>'<th>'+escape(h)+'</th>').join('')+
  '</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const section=(title,body)=>'<section class="section"><h3>'+escape(title)+'</h3>'+body+'</section>';
const details=(title,value)=>'<details class="section"><summary>'+escape(title)+'</summary><pre>'+escape(JSON.stringify(value,null,2))+'</pre></details>';
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const amount=(value,currency)=>escape(currency?.code||'')+' '+escape(value??'Amount unavailable');
const policyText=policy=>!policy?'No saved policy':policy.terms.enabled?'Enabled':'Disabled';
const draftName=invoice=>invoice?.number||invoice?.purchaseOrder||'Draft invoice';
const nonzero=value=>value===true || typeof value==='string' && /^-?\d+(?:\.\d+)?$/.test(value) && !/^-?0+(?:\.0+)?$/.test(value);
const methods=new Set(['saveCreditPolicy','saveCreditDecision','withdrawCreditDecision']);
const PAGE_SIZE=50;

export function createCreditControlUi(host) {
  const {api,openDialog,mutate,saveBlob}=host;
  let list={policies:[],drafts:[],decisions:[],customers:[]},error='',loadVersion=0,viewVersion=0,view=null;
  let parked=host.readSession('creditControlEdits');
  if(!plain(parked))parked={};
  if(!plain(parked.policies))parked.policies={};
  if(!plain(parked.decisions))parked.decisions={};
  const pages={};
  const persist=()=>host.saveSession('creditControlEdits',parked);
  function workspace() {
    if(!list.workspaceId)throw new Error(error||'Refresh the original accounting workspace before reviewing credit.');
    return list.workspaceId;
  }
  const customerName=id=>(list.customers||[]).find(row=>row.id===id)?.name||
    (host.getState()?.customers||[]).find(row=>row.id===id)?.name||'Customer';
  function currentEdits(group) {
    return Object.entries(parked[group]).filter(([,row])=>plain(row)&&row.workspaceId===list.workspaceId);
  }
  function page(key,rows,headers,renderRow) {
    const last=Math.max(0,Math.ceil(rows.length/PAGE_SIZE)-1);
    pages[key]=Math.min(last,Math.max(0,pages[key]||0));
    const start=pages[key]*PAGE_SIZE,selected=rows.slice(start,start+PAGE_SIZE);
    return (rows.length?table(headers,selected.map(renderRow)):'<p class="muted">No records in this view.</p>')+
      (rows.length>PAGE_SIZE?'<div class="row between"><p class="small-text">Records '+(start+1)+'–'+Math.min(start+PAGE_SIZE,rows.length)+' of '+rows.length+'</p><div class="row">'+
        button('Previous','page',key,'data-page="'+(pages[key]-1)+'"'+(pages[key]===0?' disabled':''))+
        button('Next','page',key,'data-page="'+(pages[key]+1)+'"'+(pages[key]===last?' disabled':''))+'</div></div>':'');
  }
  async function loadList() {
    const version=++loadVersion;
    try {
      const result=await api.creditControl({customerId:host.getCustomer()||undefined,search:host.getSearch()||undefined});
      if(version!==loadVersion)return;
      if(list.workspaceId&&result.workspaceId!==list.workspaceId){view=null;viewVersion++;}
      list=result;error='';
    } catch(cause) {
      if(version===loadVersion){error=cause.message;list={policies:[],drafts:[],decisions:[],customers:[]};}
    }
  }
  function policyTerms(policy) {
    const terms=policy.terms;
    return '<dl class="definition"><dt>Application</dt><dd>'+escape(policyText(policy))+'</dd>'+
      '<dt>Credit limit</dt><dd>'+(terms.creditLimit===null?'No limit selected':amount(terms.creditLimit,policy.currency))+'</dd>'+
      '<dt>Overdue threshold</dt><dd>'+(terms.overdueDays===null?'No threshold selected':escape(terms.overdueDays)+' days')+'</dd>'+
      '<dt>Open disputed balance</dt><dd>'+(terms.reviewDisputes?'Requires review':'No dispute rule selected')+'</dd>'+
      '<dt>Every order</dt><dd>'+(terms.reviewEveryOrder?'Requires review':'Apply the selected account rules')+'</dd></dl>';
  }
  function render() {
    const edits=currentEdits('policies').map(([key,row])=>'<p>'+button('Resume '+customerName(row.customerId)+' policy','edit-policy',key)+' '+
      button('Discard this edit','discard-policy',key,'data-write')+'</p>').join('')+
      currentEdits('decisions').map(([id,row])=>'<p>'+button('Resume '+(row.invoiceName||'draft invoice')+' decision','assess',id)+' '+
        button('Discard this edit','discard-decision',id,'data-write')+'</p>').join('');
    return '<section class="panel"><div class="panel-head"><div><h2>Customer credit and order release</h2>'+
      '<p class="small-text muted">Review the current account, retain an operator decision and issue the original invoice.</p></div>'+
      button('New customer policy','new-policy','','data-write')+'</div><div class="panel-body">'+
      (error?'<p class="notice error">'+escape(error)+'</p>':'')+
      '<p>Account date: '+escape(date(list.asOf))+'. A saved enabled policy applies its selected checks when an invoice is issued.</p>'+
      (edits?section('Retained edits',edits):'')+'</div></section>'+
      '<section class="panel"><div class="panel-head"><h2>Invoice drafts</h2></div><div class="panel-body">'+
      page('drafts',list.drafts||[],['Invoice / customer','Invoice date','Amount','Action'],row=>
        '<tr><td>'+escape(draftName(row))+'<span class="subline">'+escape(row.customerName||customerName(row.customerId))+'</span></td>'+
        '<td>'+escape(date(row.issueDate))+'</td><td class="num">'+amount(row.total,row.currency)+'</td><td>'+
        button('Assess customer credit','assess',row.id,'data-write')+'</td></tr>')+'</div></section>'+
      '<section class="panel"><div class="panel-head"><h2>Customer policies</h2></div><div class="panel-body">'+
      page('policies',list.policies||[],['Customer / owner','Currency','Application / limit','Action'],row=>
        '<tr><td>'+escape(row.customerName||customerName(row.customerId))+'<span class="subline">'+escape(row.owner)+'</span></td>'+
        '<td>'+escape(currencyName(row.currency))+'</td><td>'+escape(policyText(row))+'<span class="subline">'+
        (row.terms.creditLimit===null?'No credit limit selected':amount(row.terms.creditLimit,row.currency))+'</span></td><td>'+
        button('Open policy','policy',row.id)+'</td></tr>')+'</div></section>'+
      '<section class="panel"><div class="panel-head"><h2>Saved decisions</h2></div><div class="panel-body">'+
      page('decisions',list.decisions||[],['Customer / invoice','Decision / status','Saved by','Action'],row=>
        '<tr><td>'+escape(row.customerName||'Customer')+'<span class="subline">'+escape(row.issuedNumber||row.purchaseOrder||'Draft invoice')+
        ' · '+amount(row.total,row.currency)+'</span></td><td>'+escape(label(row.outcome))+'<span class="subline">'+escape(label(row.status))+
        '</span></td><td>'+escape(row.actor)+'<span class="subline">'+escape(date(row.createdAt))+'</span></td><td>'+
        button('Open decision','decision',row.id)+'</td></tr>')+'</div></section>';
  }
  function history(rows) {
    return (rows||[]).map(row=>'<p>'+escape(date(row.at||row.createdAt))+' · '+escape(label(row.kind||row.action||row.status||'Saved'))+
      (row.actor?' · '+escape(row.actor):'')+(row.reason?'<span class="subline preline">'+escape(row.reason)+'</span>':'')+'</p>').join('')||'<p>No additional history.</p>';
  }
  async function openPolicy(id) {
    const version=++viewVersion,result=await api.creditPolicy(id);
    if(version!==viewVersion)return;
    const row=result.policy;
    openDialog(customerName(row.customerId)+' credit policy','<p>'+escape(row.owner)+' · '+escape(currencyName(row.currency))+
      ' · Updated '+escape(date(row.updatedAt))+'</p>'+policyTerms(row)+'<div class="row">'+button('Edit policy','edit-policy',row.id,'data-write')+
      '</div>'+section('Saved policy changes',history(result.history))+
      details('Complete retained policy editions',{policy:row,editions:result.editions,history:result.history}));
    view={kind:'policy',data:result};
  }
  function policyKey(id) {return workspace()+':'+(id||'new:'+crypto.randomUUID());}
  function paintPolicy(key) {
    const draft=parked.policies[key];
    if(!draft||draft.workspaceId!==workspace())throw new Error('Open this policy in its original accounting workspace.');
    const locked=Boolean(draft.id),terms=draft.terms,customers=list.customers||host.getState()?.customers||[];
    openDialog(locked?'Edit customer credit policy':'New customer credit policy',
      '<form id="credit-control-policy-form" data-key="'+escape(key)+'">'+
      '<p>Enabling this policy applies only the checks selected below when issuing an invoice. An approval records who reviewed an exception and why.</p>'+
      '<div class="form-grid">'+(locked?'<p><strong>'+escape(customerName(draft.customerId))+'</strong><span class="subline">'+escape(currencyName(draft.currency))+
        '</span></p><input type="hidden" name="customerId" value="'+escape(draft.customerId)+'">'+
        '<input type="hidden" name="code" value="'+escape(draft.currency.code)+'"><input type="hidden" name="scale" value="'+draft.currency.scale+'">':
        '<label>Customer<select name="customerId" required><option value="">Choose a customer</option>'+customers.map(row=>'<option value="'+escape(row.id)+'"'+
          (row.id===draft.customerId?' selected':'')+'>'+escape(row.name||row.displayName||'Customer')+'</option>').join('')+'</select></label>'+
        textInput('Currency code','code',draft.currency.code,'required pattern="[A-Z]{3}" maxlength="3"')+
        textInput('Decimal places','scale',draft.currency.scale,'type="number" min="0" max="6" step="1" required'))+
      textInput('Policy owner','owner',draft.owner,'required maxlength="160"')+
      textInput('Credit limit (blank means no limit)','creditLimit',terms.creditLimit??'','inputmode="decimal"')+
      textInput('Review balances overdue by more than this many days (blank means no threshold)','overdueDays',terms.overdueDays??'','type="number" min="0" max="3660" step="1"')+
      '</div><div class="section">'+check('Enable these checks when issuing invoices','enabled',terms.enabled)+
      check('Review open disputed balances','reviewDisputes',terms.reviewDisputes)+check('Review every invoice draft','reviewEveryOrder',terms.reviewEveryOrder)+'</div>'+
      '<label>Reason for this policy edition<textarea name="reason" rows="3" maxlength="1500" required>'+escape(draft.reason||'')+'</textarea></label>'+
      '<div class="dialog-actions">'+(locked?button('Review current saved policy','compare-policy',key):'')+'<button type="button" data-action="close-dialog">Close and retain edit</button><button type="submit" data-write>Save customer policy</button></div></form>');
    view={kind:'policy-edit',key};
  }
  async function editPolicy(id='',prefill) {
    const version=++viewVersion;
    const retainedTarget=!id&&prefill?Object.entries(parked.policies).find(([,row])=>row.workspaceId===workspace()&&!row.id&&
      row.customerId===prefill.customerId&&row.currency?.code===prefill.currency.code&&row.currency?.scale===prefill.currency.scale):null;
    const key=parked.policies[id]?id:retainedTarget?.[0]||policyKey(id);
    if(!parked.policies[key]) {
      if(id) {
        const detail=await api.creditPolicy(id),row=detail.policy;
        if(version!==viewVersion)return;
        parked.policies[key]={workspaceId:detail.workspaceId,id:row.id,expectedVersion:row.version,customerId:row.customerId,
          currency:structuredClone(row.currency),owner:row.owner,terms:structuredClone(row.terms),reason:''};
      } else parked.policies[key]={workspaceId:workspace(),customerId:prefill?.customerId||host.getCustomer()||'',
        currency:structuredClone(prefill?.currency||{code:'USD',scale:2}),owner:'Accounts receivable',
        terms:{enabled:false,creditLimit:null,overdueDays:null,reviewDisputes:false,reviewEveryOrder:false},reason:''};
      persist();
    }
    paintPolicy(key);
  }
  async function comparePolicy(key) {
    remember(document.querySelector('#credit-control-policy-form'));
    const draft=parked.policies[key];
    if(!draft?.id||draft.workspaceId!==workspace())throw new Error('Open the retained policy edit in its original workspace.');
    const version=++viewVersion,current=await api.creditPolicy(draft.id);
    if(version!==viewVersion)return;
    if(current.workspaceId!==draft.workspaceId)throw new Error('The accounting workspace changed. Open its original policy.');
    view={kind:'policy-compare',key,data:current};
    openDialog('Review saved customer policy',
      '<p>'+escape(customerName(draft.customerId))+' · '+escape(currencyName(draft.currency))+'</p>'+
      section('Current saved policy','<p>'+escape(current.policy.owner)+' · Updated '+escape(date(current.policy.updatedAt))+'</p>'+policyTerms(current.policy))+
      section('Your retained edit','<p>'+escape(draft.owner)+'</p>'+policyTerms(draft)+'<p class="preline">'+escape(draft.reason)+'</p>')+
      '<p>Use the current saved version as the base for your retained terms after reviewing both. Saving the edit creates a new policy edition.</p>'+
      '<div class="dialog-actions">'+button('Keep reviewing edit','edit-policy',key)+button('Use current saved version','adopt-policy-version',key,'data-write')+'</div>');
  }
  function remember(form) {
    if(form?.id==='credit-control-policy-form') {
      const draft=parked.policies[form.dataset.key];if(!draft)return;
      const values=Object.fromEntries(new FormData(form));
      Object.assign(draft,{customerId:values.customerId,currency:{code:String(values.code||'').toUpperCase(),scale:Number(values.scale)},
        owner:values.owner,reason:values.reason,terms:{enabled:values.enabled==='on',creditLimit:values.creditLimit?.trim()||null,
          overdueDays:values.overdueDays===''?null:Number(values.overdueDays),reviewDisputes:values.reviewDisputes==='on',
          reviewEveryOrder:values.reviewEveryOrder==='on'}});
      persist();
    } else if(form?.id==='credit-control-decision-form') {
      const draft=parked.decisions[form.dataset.invoice];if(!draft)return;
      const values=Object.fromEntries(new FormData(form));draft.outcome=values.outcome;draft.reason=values.reason;persist();
    }
  }
  function assessmentBody(a,prefix='account') {
    if(!a)return '<p>The current account assessment is unavailable for this invoice state.</p>';
    const x=a.exposure,c=a.document?.currency||a.invoice.currency;
    const fields=[['Issued balance through account date','currentDue'],['Future-dated issued balance','futureIssued'],
      ['Total issued exposure','issuedExposure'],['Selected draft','draftTotal'],['Exposure after this draft','projectedExposure'],
      ['Overdue balance','overdue'],['Open disputed balance','disputed'],['Available customer receipts','availableReceipts'],
      ['Other invoice credits','invoiceCredits']];
    return '<p>'+escape(a.customer?.name||customerName(a.invoice.customerId))+' · '+escape(date(a.asOf))+' · '+escape(currencyName(c))+'</p>'+
      table(['Account amount','Value'],[...fields.map(([name,key])=>'<tr><td>'+name+'</td><td class="num">'+amount(x[key],c)+'</td></tr>'),
        ...['creditLimit','headroom'].filter(key=>x[key]!==null).map(key=>'<tr><td>'+(key==='creditLimit'?'Selected credit limit':'Remaining headroom')+
          '</td><td class="num">'+amount(x[key],c)+'</td></tr>')])+
      section('Selected policy',a.policy?'<p>'+escape(a.policy.owner)+' · '+escape(policyText(a.policy))+'</p>'+policyTerms(a.policy):'<p>No customer policy is enabled for this currency.</p>')+
      section('Review findings',a.triggers.length?'<ul>'+a.triggers.map(t=>'<li>'+escape(t.message)+'</li>').join(''):'<p>The current account meets the selected policy checks.</p>')+
      section('Selected invoice',table(['Description','Quantity','Amount'],(a.document.lines||[]).map(line=>'<tr><td>'+escape(line.description)+
        '</td><td>'+escape(line.quantity)+'</td><td class="num">'+amount(line.total,c)+'</td></tr>'))+
        '<p>Invoice date '+escape(date(a.document.issueDate))+' · Due '+escape(date(a.document.dueDate))+'</p>'+
        (a.document.note?'<p class="preline">'+escape(a.document.note)+'</p>':''))+
      section('Issued account balances',page(prefix+'-invoices',a.invoices,['Invoice / date','Status','Exposure','Overdue','Dispute'],row=>
        '<tr><td>'+escape(row.number||'Invoice')+'<span class="subline">'+escape(date(row.issueDate))+'</span></td><td>'+escape(label(row.paymentStatus||row.status))+
        '</td><td class="num">'+amount(row.exposureAmount,c)+(nonzero(row.futureExposure)?'<span class="subline">Future-dated obligation</span>':'')+
        '</td><td>'+escape(row.overdueDays||0)+' days</td><td>'+(row.openDispute?amount(row.openDispute.amount,c):'—')+'</td></tr>'))+
      section('Available receipts',page(prefix+'-receipts',a.receipts,['Receipt / date','Available'],row=>'<tr><td>'+escape(row.reference||'Customer receipt')+
        '<span class="subline">'+escape(date(row.receivedDate))+'</span></td><td class="num">'+amount(row.available,c)+'</td></tr>'))+
      section('Invoice credits',page(prefix+'-credits',a.creditInvoices,['Invoice','Credit balance'],row=>'<tr><td>'+escape(row.number||'Invoice')+
        '</td><td class="num">'+amount(row.creditBalance,c)+'</td></tr>'))+
      section('Other saved drafts',page(prefix+'-drafts',a.otherDrafts,['Draft / date','Amount'],row=>'<tr><td>'+escape(draftName(row))+
        '<span class="subline">'+escape(date(row.issueDate))+'</span></td><td class="num">'+amount(row.total,c)+'</td></tr>'))+
      '<p class="small-text muted">Exposure includes issued obligations and this selected draft. Apply available receipts or invoice credits through the original account to update its balances.</p>'+
      details('Complete source and account record',a);
  }
  function paintAssessment() {
    if(!view||!['preview','decision'].includes(view.kind))return;
    if(view.kind==='preview') {
      const result=view.data,a=result.assessment,draft=parked.decisions[a.invoiceId],enabled=a.policy?.terms?.enabled;
      openDialog('Review '+draftName(a.invoice)+' for '+(a.customer?.name||customerName(a.invoice.customerId)),
        (view.changed?'<p class="notice">The account or policy changed since the retained edit. Review this current assessment before saving the decision; your reason is retained below.</p>':'')+
        assessmentBody(a,'preview')+(enabled?'<form id="credit-control-decision-form" data-invoice="'+escape(a.invoiceId)+'">'+
          '<label>Decision<select name="outcome"><option value="APPROVE"'+(draft.outcome==='APPROVE'?' selected':'')+'>Approve this invoice for issue</option>'+
          '<option value="DECLINE"'+(draft.outcome==='DECLINE'?' selected':'')+'>Decline this invoice for now</option></select></label>'+
          '<label>Decision reason<textarea name="reason" rows="4" maxlength="1500" required>'+escape(draft.reason)+'</textarea></label>'+
          '<p class="small-text muted">The saved decision keeps this complete assessment. Issuing the invoice is a separate action through the original account.</p>'+
          '<div class="dialog-actions">'+button('Recalculate current account','assess',a.invoiceId,'data-write')+
          '<button type="submit" data-write>Save credit decision</button></div></form>':
          '<div class="dialog-actions">'+button('Set customer policy','new-policy-for-invoice',a.invoiceId,'data-write')+
          button('Open original invoice','invoice',a.invoiceId)+'</div>'));
    } else {
      const d=view.data,row=d.decision,a=d.assessment||row.assessment;
      openDialog('Credit decision for '+(row.issuedNumber||draftName(a.invoice)),
        '<p><strong>'+escape(label(row.status))+'</strong> · '+escape(row.actor)+' · '+escape(date(row.createdAt))+'</p>'+
        '<p class="preline">'+escape(row.reason)+'</p><div class="row wrap">'+
        (d.canRelease?button('Issue this approved invoice','issue',row.id,'data-write class="primary"'):'')+
        (['APPROVED','DECLINED'].includes(row.status)?button('Withdraw decision','withdraw',row.id,'data-write'):'')+
        (d.currentAssessment?button('Reassess this draft','assess',row.invoiceId,'data-write'):'')+
        button('Open original invoice','invoice',row.invoiceId)+
        [['decision.html','Printable decision'],['decision.json','Complete decision JSON'],['manifest.json','File manifest']].map(([name,title])=>
          button(title,'download',row.id,'data-name="'+name+'"')).join('')+'</div>'+
        (!d.canRelease&&d.releaseReason?'<p class="notice">'+escape(d.releaseReason)+'</p>':'')+
        section('Saved account assessment',assessmentBody(a,'saved'))+
        (d.currentAssessment&&row.assessmentSha256!==d.currentAssessmentSha256?
          '<details class="section"><summary>Current account assessment</summary>'+assessmentBody(d.currentAssessment,'current')+'</details>':'')+
        section('Decision history',history(row.history))+
        details('Complete retained decision',row));
    }
  }
  async function assess(invoiceId) {
    remember(document.querySelector('#credit-control-decision-form'));
    const version=++viewVersion,result=await api.previewCreditAssessment(invoiceId,{workspaceId:workspace()});
    if(version!==viewVersion)return;
    const previous=parked.decisions[invoiceId],a=result.assessment;
    parked.decisions[invoiceId]={workspaceId:result.workspaceId,assessmentSha256:result.assessmentSha256,
      invoiceName:draftName(a.invoice),outcome:previous?.workspaceId===result.workspaceId?previous.outcome:'APPROVE',
      reason:previous?.workspaceId===result.workspaceId?previous.reason:''};
    persist();view={kind:'preview',data:result,changed:Boolean(previous&&previous.assessmentSha256!==result.assessmentSha256)};
    paintAssessment();
  }
  async function openDecision(id) {
    const version=++viewVersion,result=await api.creditDecision(id);
    if(version!==viewVersion)return;
    view={kind:'decision',data:result};paintAssessment();
  }
  async function submit(form) {
    if(!form.id.startsWith('credit-control-'))return false;
    if(host.isLocked())throw new Error('Finish the retained account operation before saving another decision.');
    remember(form);
    if(form.id==='credit-control-policy-form') {
      const value=structuredClone(parked.policies[form.dataset.key]);
      if(value.workspaceId!==workspace())throw new Error('Open this policy in its original workspace.');
      await mutate('saveCreditPolicy',[value],'Save customer credit policy');
    } else if(form.id==='credit-control-decision-form') {
      if(view?.kind!=='preview'||view.data.assessment.invoiceId!==form.dataset.invoice)throw new Error('Review the current account before saving this decision.');
      const result=view.data,draft=parked.decisions[form.dataset.invoice];
      await mutate('saveCreditDecision',[form.dataset.invoice,{workspaceId:result.workspaceId,assessmentSha256:result.assessmentSha256,
        outcome:draft.outcome,reason:draft.reason}],'Save customer credit decision',{revision:result.revision});
    } else if(form.id==='credit-control-withdraw-form') {
      const values=Object.fromEntries(new FormData(form));
      await mutate('withdrawCreditDecision',[form.dataset.id,{workspaceId:form.dataset.workspace,
        expectedVersion:Number(form.dataset.version),reason:values.reason}],'Withdraw customer credit decision');
    } else return false;
    return true;
  }
  async function click(control) {
    const action=control.dataset.action,id=control.dataset.id;
    if(action==='close-dialog'){view=null;viewVersion++;return false;}
    if(!action?.startsWith('credit-control-'))return false;
    const reads=['credit-control-page','credit-control-policy','credit-control-decision','credit-control-download','credit-control-invoice','credit-control-compare-policy'];
    if(host.isLocked()&&!reads.includes(action))throw new Error('Finish the retained account operation before starting another change.');
    if(action==='credit-control-page') {
      remember(document.querySelector('#credit-control-decision-form'));
      const selected=Number(control.dataset.page);
      if(Number.isSafeInteger(selected)&&selected>=0)pages[id]=selected;
      if(view&&['preview','decision'].includes(view.kind))paintAssessment();else host.render();
    } else if(action==='credit-control-new-policy')await editPolicy();
    else if(action==='credit-control-new-policy-for-invoice') {
      const a=view?.data?.assessment;if(!a||a.invoiceId!==id)throw new Error('Open the original draft assessment.');
      await editPolicy(a.policy?.id||'',{customerId:a.customer?.id||a.invoice.customerId,currency:a.invoice.currency});
    } else if(action==='credit-control-policy')await openPolicy(id);
    else if(action==='credit-control-edit-policy')await editPolicy(id);
    else if(action==='credit-control-compare-policy')await comparePolicy(id);
    else if(action==='credit-control-adopt-policy-version'){
      if(view?.kind!=='policy-compare'||view.key!==id||view.data.workspaceId!==workspace())
        throw new Error('Review the current saved policy before using its version.');
      parked.policies[id].expectedVersion=view.data.policy.version;persist();paintPolicy(id);
    }
    else if(action==='credit-control-discard-policy'){delete parked.policies[id];persist();host.render();}
    else if(action==='credit-control-discard-decision'){delete parked.decisions[id];persist();host.render();}
    else if(action==='credit-control-assess')await assess(id);
    else if(action==='credit-control-decision')await openDecision(id);
    else if(action==='credit-control-invoice'){host.closeDialog();view=null;await host.openInvoice(id);}
    else if(action==='credit-control-withdraw') {
      const result=await api.creditDecision(id),row=result.decision;
      openDialog('Withdraw credit decision','<form id="credit-control-withdraw-form" data-id="'+escape(id)+'" data-workspace="'+escape(result.workspaceId)+
        '" data-version="'+row.version+'"><p>'+escape(row.reason)+'</p><label>Reason<textarea name="reason" rows="3" maxlength="1500" required></textarea></label>'+
        '<div class="dialog-actions"><button type="button" data-action="close-dialog">Close</button><button type="submit" data-write>Withdraw this decision</button></div></form>');
      view=null;viewVersion++;
    } else if(action==='credit-control-issue') {
      if(view?.kind!=='decision'||view.data.decision.id!==id||!view.data.canRelease)throw new Error('Open the current approved decision before issuing.');
      const d=view.data,p=d.invoicePreview;
      await mutate('issue',[d.decision.invoiceId,{expectedVersion:p.expectedVersion,previewSha256:p.previewSha256,
        creditDecisionId:id}],'Issue approved customer invoice',{revision:d.revision});
    } else if(action==='credit-control-download') {
      const response=await api.creditDecisionFile(id,control.dataset.name);saveBlob(await response.blob(),control.dataset.name);
    }
    return true;
  }
  return {methods,render,loadList,assess,submit,click,
    invoiceAction(row){return row.status==='DRAFT'?button('Assess customer credit','assess',row.id,'data-write'):'';},
    input(target){remember(target.closest('#credit-control-policy-form')||target.closest('#credit-control-decision-form'));},
    change(target){remember(target.closest('#credit-control-policy-form')||target.closest('#credit-control-decision-form'));},
    async afterMutation(result,operation) {
      if(operation.method==='saveCreditPolicy') {
        const value=operation.args.at(-1);for(const [key,row] of Object.entries(parked.policies))
          if(row.workspaceId===value.workspaceId&&(row.id?row.id===value.id:!value.id&&row.customerId===value.customerId&&
            row.currency?.code===value.currency?.code&&row.currency?.scale===value.currency?.scale&&row.owner===value.owner&&
            row.reason===value.reason&&JSON.stringify(row.terms)===JSON.stringify(value.terms)))delete parked.policies[key];
        persist();host.render();if(result.creditPolicy?.id)await openPolicy(result.creditPolicy.id);
      } else if(operation.method==='saveCreditDecision') {
        delete parked.decisions[operation.args[0]];persist();host.render();
        if(result.creditDecision?.id)await openDecision(result.creditDecision.id);
      } else if(operation.method==='withdrawCreditDecision'||operation.method==='issue'&&result.creditDecision) {
        if(result.creditDecision?.id)await openDecision(result.creditDecision.id);
      }
    }};
}
