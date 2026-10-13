// MIT. Complete local operator desk over original registry, ledger and carbon editions.
import {GiveCreditClient} from './client.mjs';
const api=new GiveCreditClient(location.origin);
const main=document.querySelector('#main'),notice=document.querySelector('#notice');
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=value=>{const s=String(value||'');return s.length>22?s.slice(0,10)+'…'+s.slice(-7):s||'—';};
const date=(value,time=false)=>{if(!value)return 'Date unavailable';const d=new Date(value);return Number.isFinite(d.getTime())?
  new Intl.DateTimeFormat('en',{timeZone:'UTC',year:'numeric',month:'short',day:'numeric',...(time?{hour:'2-digit',minute:'2-digit',timeZoneName:'short'}:{})}).format(d):String(value);};
const kindLabel={registry:'Registry',ledger:'Ledger',carbon:'Stellarcarbon'};
const methodLabel={PROPORTIONAL_GROSS:'Proportional to original gross payments',FIFO_GROSS:'Oldest available provider contributions first',EXPLICIT:'Explicit payment amounts'};
const actionLabel={'import':'Source edition imported','payment-link':'Payment assignment saved',allocation:'Payout allocation saved',bridge:'Carbon association saved',statement:'Statement version saved',settings:'Workspace renamed','carry-payment-links':'Unchanged payment assignments carried forward'};
const statusLabel={SAVED:'Saved source checkpoint',IDLE:'Ready',RUNNING:'Acquiring original records',COMPLETE:'Complete',INTERRUPTED:'Paused at retained checkpoint',
  complete:'Complete','complete-with-source-notes':'Complete with source notes',capturing:'Acquiring original records',interrupted:'Paused at retained checkpoint',
  'provider-payout':'Provider payout','vendor-fee':'Vendor fee','requires-source-classification':'Source classification required'};
function token(atoms,decimals){if(atoms===null||atoms===undefined)return 'Unavailable';const n=BigInt(atoms),sign=n<0n?'-':'',s=(n<0n?-n:n).toString().padStart(Number(decimals)+1,'0'),d=Number(decimals);return sign+(d?s.slice(0,-d)+'.'+s.slice(-d):s);}
function toAtoms(value,decimals){const s=String(value).trim(),d=Number(decimals);if(!/^\d+(?:\.\d+)?$/.test(s))throw new Error('Enter a nonnegative exact decimal amount.');const [whole,fraction='']=s.split('.');if(fraction.length>d)throw new Error('This original asset supports '+d+' decimal places.');return BigInt(whole+(fraction+'0'.repeat(d)).slice(0,d)).toString();}
const paymentLabel=row=>token(row.amountAtoms,row.asset.decimals)+' '+(row.asset.code||'Token')+' · '+date(row.createdAt)+' · '+short(row.from)+' → '+short(row.to);
const json=value=>'<details><summary>Original record and source details</summary><pre>'+h(JSON.stringify(value,null,2))+'</pre></details>';
const empty=(text,go)=>'<div class="empty"><p>'+h(text)+'</p>'+(go?'<button data-page="'+h(go)+'">Open '+h(go==='intake'?'import and receiving':go)+'</button>':'')+'</div>';
const button=(label,action,data={},primary=false)=>'<button type="button"'+(primary?' class="primary"':'')+' data-action="'+h(action)+'"'+Object.entries(data).map(([k,v])=>' data-'+h(k)+'="'+h(v)+'"').join('')+'>'+h(label)+'</button>';
const field=(label,name,value='',type='text',required=false,help='')=>'<label>'+h(label)+'<input name="'+h(name)+'" type="'+type+'" value="'+h(value)+'"'+(required?' required':'')+'>'+ (help?'<small>'+h(help)+'</small>':'')+'</label>';
const area=(label,name,value='',required=false)=>'<label>'+h(label)+'<textarea name="'+h(name)+'"'+(required?' required':'')+'>'+h(value)+'</textarea></label>';
const options=(rows,value,key,label,blank='Choose a record')=>(blank!==null?'<option value="">'+h(blank)+'</option>':'')+rows.map(row=>'<option value="'+h(typeof key==='function'?key(row):row[key])+'"'+(String(typeof key==='function'?key(row):row[key])===String(value)?' selected':'')+'>'+h(typeof label==='function'?label(row):row[label])+'</option>').join('');
const select=(label,name,rows,value,key='id',title='name',blank='Choose a record',required=false)=>'<label>'+h(label)+'<select name="'+h(name)+'"'+(required?' required':'')+'>'+options(rows,value,key,title,blank)+'</select></label>';
const table=(heads,rows)=>rows.length?'<div class="table-wrap"><table><thead><tr>'+heads.map(x=>'<th>'+h(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':empty('No records match this selection.');
const stat=(label,value)=>'<div class="stat"><strong>'+h(value)+'</strong><span>'+h(label)+'</span></div>';
const tag=value=>'<span class="tag">'+h(value)+'</span>';
const editionName=id=>state.editions.find(row=>row.id===id)?.label||'Source edition';
const current=(kind)=>state.editions.find(row=>row.id===selected[kind]);
const latestDate=()=>{const d=new Date(),from=d.toISOString().slice(0,7)+'-01';d.setUTCMonth(d.getUTCMonth()+1,1);return {fromDate:from,beforeDate:d.toISOString().slice(0,10)};};
let state=null,choices={},selected={registry:null,ledger:null,carbon:null},page='overview',context={},filters={},preview=null,drafts={},renderToken=0,captureTimer=null,busy=false;
function message(text,error=false){notice.innerHTML=text?'<div class="notice'+(error?' error':'')+'">'+h(text)+'</div>':'';}
function sourceInputs(){
  return ['registry','ledger','carbon'].map(kind=>'<label>'+kindLabel[kind]+' source edition<select data-source="'+kind+'">'+
    options(state.editions.filter(row=>row.kind===kind),selected[kind],'id','label','No source selected')+'</select></label>').join('');
}
async function refresh(){
  state=await api.state();document.querySelector('#workspace-name').textContent=state.name;
  for(const kind of Object.keys(selected))if(selected[kind]===null||selected[kind]&&!state.editions.some(row=>row.id===selected[kind]))
    selected[kind]=state.editions.filter(row=>row.kind===kind).at(-1)?.id||'';
  choices=await api.choices({registryEditionId:selected.registry,ledgerEditionId:selected.ledger,carbonEditionId:selected.carbon});
  document.querySelector('#sources').innerHTML=sourceInputs();
  await render();pollCapture();
}
function query(extra={}){return {registryEditionId:selected.registry||undefined,ledgerEditionId:selected.ledger||undefined,carbonEditionId:selected.carbon||undefined,...extra};}
function orgFields(value={},required=false){
  const org=value.organizationId||'';
  return select('Organization','organizationId',choices.organizations||[],org,'id','name','All organizations',required)+
    select('Initiative','initiativeId',(choices.initiatives||[]).filter(row=>!org||row.organizationId===org),value.initiativeId||'','id','title','All initiatives');
}
function pageFilter(kind,extra=''){
  const f=filters[kind]||{};
  return '<form class="filter grid three" data-form="filter" data-target="'+kind+'">'+
    (kind==='donations'?orgFields(f)+field('Search original records','search',f.search||''):extra)+
    field('From date · inclusive','fromDate',f.fromDate||'','date')+field('Before date · exclusive','beforeDate',f.beforeDate||'','date')+
    '<div class="actions"><button class="primary">Apply filters</button>'+button('Clear filters','clear-filters',{target:kind})+'</div></form>';
}
function pagination(result,target){
  return '<div class="pagination"><span>'+h(result.total)+' records · '+h(result.total?result.offset+1:0)+'–'+h(Math.min(result.offset+result.limit,result.total))+'</span>'+
    (result.offset?button('Previous page','page-offset',{target,offset:Math.max(0,result.offset-result.limit)}):'')+
    (result.nextOffset!==null?button('Next page','page-offset',{target,offset:result.nextOffset}):'')+'</div>';
}
function statementSummary(report){
  const t=report.totals;
  return '<div class="stats">'+stat('Registry donation records',t.registryRecords)+stat('Original ledger payments',t.paymentRecords)+stat('Attributed CARBON',t.carbon)+
    stat('Retirement allocations',t.allocated)+stat('Remaining CARBON',t.remaining)+'</div><p>'+h(report.dateBasis)+'</p>'+
    '<p>'+h(report.allocationBasis)+'</p>'+table(['Registry asset','Recorded amount'],t.registryAssets.map(row=>[h(row.asset.code),h(row.amount)]))+
    table(['Payment asset','Attributed payment amount'],t.paymentAssets.map(row=>[h(row.asset.code||'Token'),h(row.amount)]))+
    '<p>Registry-reported USD: <strong>'+h(t.registryUSD)+'</strong>. These original registry values and actual ledger amounts have distinct source bases.</p>'+
    '<h3>Provider payout funding revisions</h3><p>Rows retain each funding revision used by this statement. A repeated original payout describes the same cash transfer.</p>'+table(['Payout date','Revision','Method','Original whole payout','Selected funding'],report.relatedPayouts.map(row=>[
      h(date(row.payout.createdAt)),h('Version '+row.allocationVersion+' · '+(row.current?'current':'retained')+(row.usedForCarbon?' · used for carbon':'')),h(methodLabel[row.method]),
      h(token(row.payout.amountAtoms,row.payout.asset.decimals))+' '+h(row.payout.asset.code||'Token'),h(token(row.selectedFunding.reduce((n,part)=>n+BigInt(part.amountAtoms),0n).toString(),row.payout.asset.decimals))]))+
    '<h3>Linked retirement certificates</h3><p>'+h(report.retirementDateBasis)+'</p>'+
    table(['Certificate','Retirement date','Attributed CARBON','Whole certificate VCUs','Dated in selected period'],report.certificates.map(row=>[
      h(row.certificate_id),h(date(row.retirement_date)),h(row.attributedAmount),h(row.vcu_amount),row.withinRetirementPeriod?'Yes':'Later or earlier date']))+
    '<p>'+h(report.coverage.unassignedDonations)+' selected donations await a saved payment assignment.</p>'+json(report);
}
function overview(){
  const active=rows=>rows.filter(row=>row.active!==false).length;
  return '<h1>GiveCredit statements</h1><p>Work from complete original source editions. Assign donor payments, allocate actual provider payouts, associate original carbon contributions, and issue period statements with retained versions.</p>'+
    '<div class="stats">'+stat('Source editions',state.editions.length)+stat('Payment assignments',active(state.paymentLinks))+stat('Payout allocations',active(state.allocations))+stat('Saved statements',state.statements.length)+'</div>'+
    '<div class="panel"><h2>Operator workflow</h2><p>Import or capture registry records and Stellar ledger data. Inspect donations and their original receipt payment hashes. Save explicit payment assignments, choose a funding method for each provider payout, then link the payout to its original Stellarcarbon sink.</p>'+
    '<div class="actions"><button data-page="intake" class="primary">Import source editions</button><button data-page="capture">Capture original records</button><button data-page="statements">Prepare a statement</button></div></div>'+
    '<h2>Retained source editions</h2>'+table(['Source','Kind','Imported','Records',''],state.editions.map(row=>[
      h(row.label),h(kindLabel[row.kind]),h(date(row.importedAt,true)),h(Object.values(row.counts).reduce((a,b)=>a+b,0)),button('Open source','source',{id:row.id})]))+
    '<h2>Recent operator work</h2>'+table(['Saved','Action','Operator'],state.history.slice().reverse().map(row=>[h(date(row.at,true)),h(actionLabel[row.action]||row.action),h(row.actor)]))+
    '<form class="panel grid" data-form="settings">'+field('Workspace name','name',state.name,'text',true)+'<div class="actions"><button>Save name</button></div></form>';
}
async function donations(){
  if(!selected.registry)return '<h1>Donations</h1>'+empty('Select or import the original registry edition.','intake');
  const result=await api.donations({editionId:selected.registry,ledgerEditionId:selected.ledger,...filters.donations});
  return '<h1>Donation register</h1><p>Original registry creation dates and amounts remain visible alongside separately saved ledger payment assignments.</p>'+
    pageFilter('donations')+table(['Created','Organization / initiative','Registry amount','Donor','Assignments',''],result.items.map(row=>[
      h(date(row.created)),h(row.organizationName)+'<br><small>'+h(row.initiativeName)+'</small>',h(row.amount)+' '+h(row.asset||''),
      '<code>'+h(short(row.wallet))+'</code>',h(row.linkedPayments)+' payments · '+h(row.receiptCount)+' native receipts',
      button('Open donation','donation',{id:row.id})]))+pagination(result,'donations');
}
async function donation(){
  if(!selected.registry)return empty('Select the original registry edition.','intake');
  const data=await api.donation(context.id,{editionId:selected.registry,ledgerEditionId:selected.ledger});
  const row=data.donation,edit=context.linkId?state.paymentLinks.find(link=>link.id===context.linkId):null;
  const payment=(choices.transfers||[]).find(row=>row.key===(edit?.paymentKey||context.paymentKey))||data.candidatePayments[0];
  const receiptRows=[...data.receipts,...data.receiptCandidates];
  const form=selected.ledger?'<form class="panel grid" data-form="payment-link">'+
    '<h2 class="span-all">'+(edit?'Edit payment assignment':'Assign an original payment')+'</h2>'+
    select('Original successful payment','paymentKey',choices.transfers||[],payment?.key||'','key',paymentLabel,'Choose an original payment',true)+
    field('Assigned token amount','paymentAmount',edit?token(edit.amountAtoms,payment?.asset.decimals||0):payment?token(payment.amountAtoms,payment.asset.decimals):'','text',true,'Saved as exact atoms using the original asset precision.')+
    select('Original receipt anchor','receiptId',receiptRows,edit?.receiptId||'','id',r=>'Receipt '+short(r.tokenId)+' · '+short(r.transactionId),'No receipt selected')+
    '<p>Assignment status: '+tag(edit?.active===false?'Archived':'Active')+'</p>'+
    '<div class="span-all">'+area('Source assignment note','note',edit?.note||'',true)+'</div>'+
    '<div class="actions span-all"><button class="primary">Save payment assignment</button>'+button('Cancel edit','donation',{id:row.id})+'</div></form>':
    empty('Select a ledger edition to assign the original payment.','capture');
  return '<div class="section-head"><h1>'+h(data.organization?.name||'Donation')+'</h1><button data-page="donations">Back to donations</button></div>'+
    '<dl><dt>Initiative</dt><dd>'+h(data.initiative?.title||'Direct donation')+'</dd><dt>Registry date</dt><dd>'+h(date(row.created,true))+'</dd><dt>Registry amount</dt><dd>'+h(row.amount)+' '+h(row.asset||'')+'</dd><dt>Registry-reported USD</dt><dd>'+h(row.usdvalue)+'</dd><dt>Donor</dt><dd><code>'+h(row.wallet||'Unspecified in source')+'</code></dd></dl>'+
    '<p>'+h(data.matchingRule)+'</p>'+table(['Assigned payment','Amount','Saved',''],data.paymentLinks.map(link=>[
      h(paymentLabel(link.source.payment)),h(token(link.amountAtoms,link.ledgerPrecision)),h(date(link.updatedAt,true)),
      button('Edit','edit-link',{id:link.id})+' '+button('Archive','archive-link',{id:link.id})]))+
    form+'<h2>Native receipt records</h2>'+table(['Created','Minted token','Original payment','Relationship'],receiptRows.map(receipt=>[
      h(date(receipt.created)),h(short(receipt.tokenId)),'<code>'+h(receipt.transactionId||'Unavailable')+'</code>',
      receipt.donationId===row.id?'Original donation relation':'Candidate requiring assignment']))+json(data);
}
async function payments(){
  if(!selected.ledger)return '<h1>Payments</h1>'+empty('Select or capture an original ledger edition.','capture');
  const f=filters.payments||{},result=await api.transfers({editionId:selected.ledger,...f});
  return '<h1>Original ledger transfers</h1><p>Each record retains its original operation or token event. Path payments show the payer debit; the delivered destination amount remains in the record detail.</p>'+
    pageFilter('payments',select('Transfer role','kind',[{id:'payment',name:'Donor payments'},{id:'payout',name:'Confirmed provider payouts'}],f.kind||'','id','name','All token transfers')+
      field('Address','address',f.address||'')+field('Search source records','search',f.search||''))+
    table(['Ledger close','Role','Amount','From / to',''],result.items.map(row=>[h(date(row.createdAt,true)),h(row.role),h(row.amount)+' '+h(row.asset.code||'Token'),
      '<code>'+h(short(row.from))+'<br>'+h(short(row.to))+'</code>',button('Open transfer','transfer',{id:row.key})]))+pagination(result,'payments');
}
async function transfer(){
  const row=await api.transfer(context.id,{editionId:selected.ledger});
  return '<div class="section-head"><h1>Original payment record</h1><button data-page="payments">Back to payments</button></div>'+
    '<dl><dt>Ledger close</dt><dd>'+h(date(row.createdAt,true))+'</dd><dt>Payment amount</dt><dd>'+h(token(row.amountAtoms,row.asset.decimals))+' '+h(row.asset.code||'Token')+'</dd><dt>From</dt><dd><code>'+h(row.from)+'</code></dd><dt>To</dt><dd><code>'+h(row.to)+'</code></dd>'+
    (row.destinationAsset?'<dt>Delivered amount</dt><dd>'+h(token(row.destinationAmountAtoms,row.destinationAsset.decimals))+' '+h(row.destinationAsset.code||'Token')+'</dd>':'')+'</dl>'+json(row);
}
async function pools(){
  if(!selected.ledger)return '<h1>Contract pools</h1>'+empty('Select the original ledger edition.','capture');
  const data=await api.pools({editionId:selected.ledger,...filters.pools});
  return '<h1>Contract pools</h1><p>'+h(data.dateBasis)+'</p>'+pageFilter('pools')+
    data.pools.map(pool=>'<section class="panel"><h2>Credits pool · '+h(short(pool.contractId))+'</h2>'+
      table(['Asset','Incoming','Outgoing','Net movement','Native provider payouts','Operator-classified payouts','Other outgoing'],pool.flows.map(row=>[
        h(row.asset.code||'Token'),h(row.incoming),h(row.outgoing),h(row.net),h(token(row.providerPayoutAtoms,row.asset.decimals)),
        h(token(row.operatorClassifiedPayoutAtoms||'0',row.asset.decimals)),h(token(row.otherOutgoingAtoms,row.asset.decimals))]))+
      '<h3>Source-dated contract observations</h3><p>Accounted provider remainder and actual token balance are distinct observations. Each value retains its own ledger and source phase.</p>'+
      table(['Observed','Phase','Provider / vendor','Provider remainder · atoms','Actual token balance · atoms','Bucket · atoms'],pool.observations.map(row=>[
        h(date(row.createdAt))+'<br><small>Ledger '+h(row.ledger)+'</small>',h(row.phase||'Original observation'),
        '<code>'+h(short(row.provider))+'<br>'+h(short(row.vendor))+'</code>',h(row.accountedRemainderAtoms??'Unavailable'),
        h(row.tokenBalanceAtoms??'Unavailable'),h(row.bucketAtoms??'Unavailable')]))+
      '<h3>Provider-address transfer classification</h3>'+table(['Amount','Classification','Source basis'],pool.payoutCandidates.map(row=>[
        h(token(row.amountAtoms,row.asset.decimals))+' '+h(row.asset.code||'Token'),h(statusLabel[row.classification]||row.classification),h(row.classificationBasis)]))+json(pool)+'</section>').join('');
}
function allocationForm(){
  const edit=context.id?state.allocations.find(row=>row.id===context.id):null,draft=drafts.allocation||{};
  const payout=(choices.payouts||[]).find(row=>row.key===(draft.payoutKey||context.payoutKey||edit?.payoutKey))||(choices.payouts||[])[0];
  const eligible=(choices.donorPayments||[]).filter(row=>payout&&row.to===payout.from&&row.asset.key===payout.asset.key&&row.beforePayout?.precedes!==false);
  const method=draft.method||context.method||edit?.method||'PROPORTIONAL_GROSS';
  return '<form class="panel grid" data-form="allocation"><h2 class="span-all">'+(edit?'Edit saved allocation':'Allocate a provider payout')+'</h2>'+
    field('Allocation name','name',draft.name??edit?.name??'Provider payout allocation','text',true)+
    select('Original provider-address transfer','payoutKey',choices.payouts||[],payout?.key||'','key',row=>paymentLabel(row)+(row.classification==='provider-payout'?'':' · classify source'),'Choose a retained payout',true)+
    select('Funding method','method',Object.entries(methodLabel).map(([id,name])=>({id,name})),method,'id','name',null,true)+
    '<p>Allocate the actual payout across its original gross donor payments. The saved method and exact amounts remain part of every issued statement.</p>'+
    '<div class="span-all selection-list">'+eligible.map(row=>{
      const part=edit?.parts.find(part=>part.paymentKey===row.key),checked=draft.paymentKeys?draft.paymentKeys.includes(row.key):part||context.paymentKeys?.includes(row.key);
      const capacity=row.funding?.capacityAtoms,priorCapacity=edit?.capacities?.find(item=>item.paymentKey===row.key),priorOrder=edit?.ordering?.find(item=>item.paymentKey===row.key);
      const capacityValue=draft['cap:'+row.key]??(priorCapacity?token(priorCapacity.amountAtoms,row.asset.decimals):'');
      const sourceNote=draft['ordernote:'+row.key]??priorOrder?.note??'';
      return '<div class="selection-row"><label class="checkline"><input type="checkbox" name="paymentKeys" value="'+h(row.key)+'"'+(checked?' checked':'')+'><span>'+h(paymentLabel(row))+
        '<br><small>Provider funding capacity: '+h(capacity!==null&&capacity!==undefined?token(capacity,row.asset.decimals):'Source assignment required')+'</small></span></label>'+
        (method==='EXPLICIT'?field('Attributed payment amount','part:'+row.key,draft.partAmounts?.[row.key]??(part?token(part.amountAtoms,row.asset.decimals):''),'text',false):'')+
        (capacity===null||capacity===undefined?'<div class="span-all grid">'+field('Source-resolved provider capacity','cap:'+row.key,capacityValue,'text')+
          field('Original capacity source note','capnote:'+row.key,draft['capnote:'+row.key]??priorCapacity?.note??'')+
          '<small class="span-all">'+h((row.funding?.unresolvedReasons||[]).join(' '))+'</small></div>':'')+
        (row.beforePayout?.precedes===null?'<label class="checkline span-all"><input type="checkbox" name="before:'+h(row.key)+'"'+
          ((draft['before:'+row.key]||priorOrder?.precedesPayout)?' checked':'')+'>Original source confirms this payment precedes the payout</label>':'')+
        (method==='FIFO_GROSS'||row.beforePayout?.precedes===null?'<div class="span-all grid">'+
          (method==='FIFO_GROSS'?field('Execution rank if native order needs resolution','rank:'+row.key,draft['rank:'+row.key]??priorOrder?.rank??'','text'):'')+
          field('Original execution order source note','ordernote:'+row.key,sourceNote)+'</div>':'')+
        '</div>';
    }).join('')+(eligible.length?'':empty('No original donor payments in this edition enter the selected pool before this payout.'))+'</div>'+
    (payout&&payout.classification!=='provider-payout'?'<div class="span-all status-detail"><p>'+h(payout.classificationBasis)+'</p><label class="checkline"><input type="checkbox" name="confirmProviderPayout"'+((draft.confirmProviderPayout??edit?.confirmProviderPayout)?' checked':'')+'>I have resolved this original transfer as a provider bucket payout.</label>'+
      area('Original source used to resolve the transfer','classificationNote',draft.classificationNote??edit?.classificationNote??'',true)+'</div>':'')+
    '<div class="span-all">'+area('Allocation note','note',draft.note??edit?.note??'')+'</div><div class="actions span-all"><button name="intent" value="preview">Preview exact allocation</button><button class="primary" name="intent" value="save">Save allocation</button>'+button('New allocation','new-allocation')+'</div></form>';
}
async function allocations(){
  if(!selected.ledger)return '<h1>Payout allocations</h1>'+empty('Select an original ledger edition.','capture');
  choices=await api.choices(query({payoutKey:drafts.allocation?.payoutKey||context.payoutKey||state.allocations.find(row=>row.id===context.id)?.payoutKey}));
  return '<h1>Provider payout funding</h1><p>Each payout is funded once within this ledger edition. Choose a source-based method and retain the exact donor payment shares.</p>'+
    table(['Allocation','Method','Payout','Saved',''],state.allocations.filter(row=>row.ledgerEditionId===selected.ledger).map(row=>[
      h(row.name)+(row.active===false?' '+tag('Archived'):''),h(methodLabel[row.method]),h(token(row.source.payoutAtoms,row.source.asset.decimals))+' '+h(row.source.asset.code||'Token'),
      h(date(row.updatedAt,true)),button('Edit','edit-allocation',{id:row.id})+(row.active===false?'':' '+button('Archive','archive-allocation',{id:row.id}))]))+
    allocationForm()+(preview?.kind==='allocation'?'<div class="preview"><h2>Exact payout allocation</h2>'+table(['Original donor payment','Attributed amount','Original gross weight','Provider capacity'],preview.value.parts.map(part=>[
      h(paymentLabel(part.payment)),h(token(part.amountAtoms,part.payment.asset.decimals)),h(token(part.weightAtoms,part.payment.asset.decimals)),h(token(part.capacityAtoms,part.payment.asset.decimals))]))+json(preview.value)+'</div>':'');
}

function bridgeForm(){
  const edit=context.id?state.bridges.find(row=>row.id===context.id):null,draft=drafts.bridge||{};
  const groups=state.allocations.filter(row=>row.active!==false&&row.ledgerEditionId===selected.ledger);
  const group=groups.find(row=>row.id===(draft.allocationId||context.allocationId||edit?.allocationId))||groups[0];
  const payout=(choices.payouts||[]).find(row=>row.key===group?.payoutKey);
  const sink=(choices.sinks||[]).find(row=>row.hash===(draft.sinkHash||context.sinkHash||edit?.sinkHash));
  return '<form class="panel grid" data-form="bridge"><h2 class="span-all">'+(edit?'Edit carbon association':'Associate an original carbon contribution')+'</h2>'+
    select('Saved provider payout allocation','allocationId',groups,group?.id||'','id','name','Choose an allocation',true)+
    '<p class="span-all">'+(edit?'This association retains '+h(edit.allocationSnapshot?.name||'its saved allocation')+' · version '+h(edit.allocationVersion)+'. ':'')+
      (group?'Saving '+(edit?'this edit':'the association')+' uses '+h(group.name)+' · version '+h(group.version)+'.':'Choose a saved allocation to associate its funding revision.')+'</p>'+
    select('Original Stellarcarbon contribution','sinkHash',choices.sinks||[],sink?.hash||'','hash',row=>row.carbon+' CARBON · '+date(row.createdAt)+' · '+short(row.recipient),'Choose an original sink',true)+
    field('Provider payout amount used','paymentAmount',draft.paymentAmount??(edit&&payout?token(edit.paymentAtoms,payout.asset.decimals):payout?token(payout.amountAtoms,payout.asset.decimals):''),'text',true,payout?(payout.asset.code||'Token')+' · original token precision':'')+
    field('CARBON attributed to this payout','carbonAmount',draft.carbonAmount??edit?.carbonAmount??sink?.carbon??'','text',true,'Retained Stellarcarbon precision: 3 decimals.')+
    '<div class="span-all">'+area('Original source connecting this payout and sink','note',draft.note??edit?.note??'',true)+'</div>'+
    '<div class="actions span-all"><button name="intent" value="preview">Preview association</button><button class="primary" name="intent" value="save">Save association</button>'+button('New association','new-bridge')+'</div></form>';
}
function bridges(){
  if(!selected.ledger||!selected.carbon)return '<h1>Carbon associations</h1>'+empty('Select the original ledger and Stellarcarbon source editions.','intake');
  if(current('ledger').network!==current('carbon').network)return '<h1>Carbon associations</h1>'+empty('Choose source editions from the same Stellar network.');
  return '<h1>Provider payout and carbon associations</h1><p>Associate a source-observed payout with its original sinking transaction. The note records the actual source connecting them, while donor attribution uses the saved payout funding method.</p>'+
    table(['Payout allocation','Funding revision','CARBON','Payment used','Saved',''],state.bridges.filter(row=>row.ledgerEditionId===selected.ledger&&row.carbonEditionId===selected.carbon).map(row=>[
      h(row.allocationSnapshot?.name||state.allocations.find(item=>item.id===row.allocationId)?.name||'Saved payout allocation')+(row.active===false?' '+tag('Archived'):''),
      h('Version '+row.allocationVersion),h(row.carbonAmount),h(token(row.paymentAtoms,row.source.payout.asset.decimals))+' '+h(row.source.payout.asset.code||'Token'),
      h(date(row.updatedAt,true)),button('Edit','edit-bridge',{id:row.id})+(row.active===false?'':' '+button('Archive','archive-bridge',{id:row.id}))]))+
    bridgeForm()+(preview?.kind==='bridge'?'<div class="preview"><h2>Source association</h2><p>'+h(preview.value.carbonAmount)+' CARBON associated with the selected provider payout.</p>'+json(preview.value)+'</div>':'');
}
function statementForm(){
  const edit=context.id?state.statements.find(row=>row.id===context.id):null;
  const spec=drafts.statement||edit?.latest.spec||{...latestDate(),title:'GiveCredit period statement',basis:selected.registry?'REGISTRY_CREATED':'LEDGER_CLOSED'};
  return '<form class="panel grid" data-form="statement"><h2 class="span-all">'+(edit?'Issue a new statement version':'Prepare a period statement')+'</h2>'+
    field('Statement title','title',spec.title,'text',true)+
    select('Period basis','basis',[{id:'REGISTRY_CREATED',name:'Original registry donation creation'},{id:'LEDGER_CLOSED',name:'Original payment ledger close'}],spec.basis,'id','name',null,true)+
    field('From date · inclusive','fromDate',spec.fromDate,'date',true)+field('Before date · exclusive','beforeDate',spec.beforeDate,'date',true)+
    orgFields(spec)+field('Donor address','donorAddress',spec.donorAddress||'','text',false,'Leave empty for a consolidated organization or initiative statement.')+
    '<div class="span-all">'+area('Statement note','note',spec.note||'')+'</div>'+
    '<div class="actions span-all"><button name="intent" value="preview">Preview statement</button><button class="primary" name="intent" value="save">'+(edit?'Save new version':'Save statement')+'</button>'+button('New statement','new-statement')+'</div></form>';
}
function statements(){
  return '<h1>Period statements</h1><p>Choose a source date basis and a half-open period. Saved versions freeze the actual source editions, operator assignments, payout funding method and later known certificate allocations.</p>'+
    table(['Statement','Version','Period','Updated',''],state.statements.map(row=>[
      h(row.title),h(row.versions),h(date(row.latest.spec.fromDate))+' to before '+h(date(row.latest.spec.beforeDate)),
      h(date(row.updatedAt,true)),button('Open exports','statement',{id:row.id})+' '+button('Edit selection','edit-statement',{id:row.id})]))+
    statementForm()+(preview?.kind==='statement'?'<section class="preview"><h2>'+h(preview.value.spec.title)+'</h2>'+statementSummary(preview.value)+'</section>':'');
}
const exportsList=['statement.html','statement.json','donations.csv','payments.csv','payout-funding.csv','carbon-contributions.csv','carbon-allocations.csv','retirement-register.csv','receipt-records.csv'];
async function statement(){
  const saved=state.statements.find(row=>row.id===context.id),report=await api.statement(context.id,context.version);
  return '<div class="section-head"><h1>'+h(report.spec.title)+'</h1><button data-page="statements">Back to statements</button></div>'+
    '<p>Version '+h(report.version)+' · saved '+h(date(report.createdAt,true))+' by '+h(report.actor)+'</p>'+
    '<label>Retained version<select data-statement-version>'+Array.from({length:saved.versions},(_,i)=>i+1).map(v=>'<option value="'+v+'"'+(v===report.version?' selected':'')+'>Version '+v+'</option>').join('')+'</select></label>'+
    '<div class="actions">'+exportsList.map(name=>'<a class="button" href="'+h(api.statementFileURL(context.id,name,report.version))+'" download>'+h(name)+'</a>').join('')+
    button('Issue a new version','edit-statement',{id:context.id})+'</div>'+statementSummary(report);
}
function sources(){
  return '<h1>Original source editions</h1><p>Each edition retains original files, complete acquisition bodies, selection metadata and normalized records. Compare later editions while saved statements keep their prior sources.</p>'+
    table(['Edition','Kind','Source network','Imported','Records',''],state.editions.map(row=>[h(row.label),h(kindLabel[row.kind]),h(row.network||'Original registry'),
      h(date(row.importedAt,true)),h(Object.values(row.counts).reduce((a,b)=>a+b,0)),button('Open edition','source',{id:row.id})]))+
    '<div class="actions"><button data-page="intake" class="primary">Import source</button><button data-page="capture">Capture current edition</button></div>';
}
async function source(){
  const source=await api.edition(context.id),tables=Object.keys(source.counts),tableName=tables.includes(context.table)?context.table:tables[0];
  const rows=tableName?await api.table(source.id,tableName,{offset:context.offset||0,limit:50}):null;
  const columns=rows?[...new Set(rows.items.flatMap(row=>Object.keys(row)))].slice(0,8):[];
  return '<div class="section-head"><h1>'+h(source.label)+'</h1><button data-page="sources">Back to editions</button></div>'+
    '<p>'+h(kindLabel[source.kind])+' source · imported '+h(date(source.importedAt,true))+'</p>'+
    '<div class="actions"><a class="button" href="'+h(api.sourceURL(source.id))+'" download>Download complete edition</a></div>'+
    '<details><summary>Original files and acquisition bodies · '+h(source.files.length)+'</summary><ul class="file-list">'+source.files.map((row,i)=>'<li><a href="'+h(api.sourceFileURL(source.id,i))+'" download>'+h(row.name)+'</a></li>').join('')+'</ul></details>'+
    '<h2>Original source tables</h2><label>Table<select data-source-table>'+tables.map(name=>'<option value="'+h(name)+'"'+(name===tableName?' selected':'')+'>'+h(name)+' · '+h(source.counts[name])+' records</option>').join('')+'</select></label>'+
    (rows?table([...columns,'Full record'],rows.items.map(row=>[...columns.map(key=>typeof row[key]==='object'?'<span class="subtle">Nested source record</span>':h(String(row[key]??''))),json(row)]))+pagination(rows,'table'):'')+
    '<h2>Source edition metadata</h2>'+json(source.metadata);
}
function compareForm(){
  const beforeId=context.beforeId||'',before=state.editions.find(row=>row.id===beforeId);
  const targets=state.editions.filter(row=>row.id!==beforeId&&(!before||row.kind===before.kind&&row.network===before.network));
  return '<form class="panel grid" data-form="compare">'+select('Earlier retained edition','beforeId',state.editions,beforeId,'id','label','Choose an edition',true)+
    select('Later retained edition','afterId',targets,context.afterId||'','id','label','Choose a matching edition',true)+'<div class="actions span-all"><button class="primary">Compare original records</button></div></form>';
}
async function compare(){
  const result=context.beforeId&&context.afterId?await api.compare(context.beforeId,context.afterId):null;
  const regs=state.editions.filter(row=>row.kind==='registry'),ledgers=state.editions.filter(row=>row.kind==='ledger');
  return '<h1>Compare source editions</h1><p>Compare complete keyed original records, including additions, removals and changed fields. Carry unchanged payment assignments forward into selected fresh source editions.</p>'+compareForm()+
    (result?table(['Table','Earlier retained rows','Later retained rows','Comparison','Added','Removed','Changed values','Source detail differences'],Object.entries(result.tables).map(([name,row])=>[h(name),h(row.counts.before),h(row.counts.after),h(row.comparisonStatus==='unavailable'?row.note:'Available in both editions'),h(row.counts.added??'—'),h(row.counts.removed??'—'),h(row.counts.changed??'—'),h(row.counts.sourceDifferences===null?'—':row.counts.sourceDifferences||0)]))+
      '<a class="button" href="'+h(api.url('compare',{beforeId:context.beforeId,afterId:context.afterId,format:'csv'}))+'" download>Export full comparison CSV</a>'+json(result):'')+
    '<form class="panel grid" data-form="carry"><h2 class="span-all">Carry unchanged payment assignments</h2>'+
      select('Previous registry edition','fromRegistryEditionId',regs,'','id','label','Choose registry edition',true)+
      select('New registry edition','toRegistryEditionId',regs,selected.registry,'id','label','Choose registry edition',true)+
      select('Previous ledger edition','fromLedgerEditionId',ledgers,'','id','label','Choose ledger edition',true)+
      select('New ledger edition','toLedgerEditionId',ledgers,selected.ledger,'id','label','Choose ledger edition',true)+
      '<p class="span-all">The native donation identity, amount, source dates, original payment identity and asset must match. Changed records remain listed for operator review.</p>'+
      '<div class="actions span-all"><button>Carry unchanged assignments</button></div></form>';
}
function intake(){
  return '<h1>Import and independent receiving</h1><p>Import the original source files or receive the complete editable workspace into a new private directory.</p>'+
    '<form class="panel grid" data-form="source-import"><h2 class="span-all">Complete source edition</h2>'+
      field('Edition label','label','','text',true)+field('Original source JSON','sourceFile','','file',true)+
      select('Stellarcarbon source network','network',[{id:'mainnet',name:'Mainnet'},{id:'testnet',name:'Testnet'}],'mainnet','id','name',null)+
      '<p>Accepts a GiveCredit source edition or the original Stellarcarbon source edition exported by the companion desk.</p>'+
      '<div class="actions span-all"><button class="primary">Import complete edition</button></div></form>'+
    '<form class="panel grid" data-form="registry-import"><h2 class="span-all">Original registry export tables</h2>'+
      field('Edition label','label','','text',true)+'<label>Original JSON or NDJSON files<input name="registryFiles" type="file" multiple required><small>Use donations, nfts, organizations, initiatives, credits, providers, stories and impactlinks as original filenames.</small></label>'+
      '<div class="span-all">'+area('Original export source and coverage','sourceNote','',true)+'</div><div class="actions span-all"><button>Import original registry files</button></div></form>'+
    '<form class="panel grid" data-form="carbon-retained"><h2 class="span-all">Retained published Stellarcarbon edition</h2>'+
      field('Edition label','label','Stellarcarbon · published April 14, 2026','text',true)+
      '<p>The complete seven-table original backup contains 176 records. Its original edition and dates remain intact.</p><div class="actions span-all"><button>Import retained original edition</button></div></form>'+
    '<form class="panel grid" data-form="receive"><h2 class="span-all">Receive an independent editable workspace</h2>'+
      field('Complete workspace handover JSON','handoverFile','','file',true)+
      field('New absolute private directory','directory','','text',true,'Choose a new destination on this native receiver, for example /home/operator/givecredit-client.')+
      '<p class="span-all">Receiving preserves all source editions, saved payment assignments, funding methods, carbon links, statement versions and exports. The received copy opens with its own workspace identity.</p>'+
      '<div class="actions span-all"><button class="primary">Receive and open workspace</button><a class="button" href="'+h(api.handoverURL())+'" download>Export this complete workspace</a></div></form>';
}
function captureStatusMarkup(){
  return ['registry','ledger'].map(kind=>{
    const value=state.captures?.[kind]||{status:'IDLE'},checkpoint=value.checkpoint;
    const saved=checkpoint?'<p>Saved '+h(checkpoint.savedAt?date(checkpoint.savedAt,true):'original checkpoint')+
      (checkpoint.responses!==undefined?' · '+h(checkpoint.responses)+' original responses':'')+'</p>'+ 
      '<p><a class="button" href="'+h(api.checkpointURL(kind))+'" download>Export complete checkpoint</a></p>':'';
    return '<div class="panel"><h3>'+kindLabel[kind]+' acquisition</h3><p>'+h(statusLabel[value.status]||value.status)+
      (value.phase?' · '+h(value.phase.replace(/-/g,' ')):'')+(value.table?' · '+h(value.table):'')+'</p>'+
      (value.error?'<p>'+h(value.error.message)+'</p>':'')+saved+
      (value.checkpointError?'<p>'+h(value.checkpointError.message)+' The previous committed checkpoint remains available.</p>':'')+
      (value.status==='RUNNING'?button('Pause at retained checkpoint','stop-capture',{kind}):'')+
      (value.editionId?button('Open captured edition','source',{id:value.editionId}):'')+'</div>';
  }).join('');
}
function capture(){
  return '<h1>Capture original records</h1><p>Acquire complete original responses through the native receiver. Registry access uses the operator’s existing API key; ledger acquisition uses public original sources and the installed Stellar SDK.</p>'+
    '<div id="capture-status" class="grid">'+captureStatusMarkup()+'</div>'+
    '<form class="panel grid" data-form="checkpoint-import"><h2 class="span-all">Continue a saved acquisition</h2>'+
      select('Original source kind','kind',[{id:'ledger',name:'Ledger'},{id:'registry',name:'Registry'}],'ledger','id','name',null,true)+
      field('Complete original checkpoint JSON','checkpointFile','','file',true)+
      '<p class="span-all">Receive the complete saved file, then use the same source options and Resume below. Source selection, original responses and progress remain intact.</p>'+
      '<div class="actions span-all"><button>Receive checkpoint</button></div></form>'+
    '<form class="panel grid" data-form="capture-registry"><h2 class="span-all">Registry edition</h2>'+
      field('Edition label','label','GiveCredit registry · '+date(new Date()),'text',true)+
      field('Existing authorized registry API key','apiKey','','password',true)+
      field('Original organization ID','organizationId','04340418-765d-48ab-af36-512a66c960b4','text',false,'Leave empty for all accessible original records.')+
      field('Registry API base','baseUrl','https://registry.cfce.io/api','url',true)+
      field('Original complete capture options JSON · optional','captureOptionsFile','','file',false,'When selected, this file supplies the original query instead of the fields above. The entered API key is used for access.')+
      '<label class="checkline span-all"><input type="checkbox" name="resume">Resume this source acquisition from its retained checkpoint</label>'+
      '<p class="span-all">All native table pages are retained through the terminal page, including nested donation impact links and later relations.</p><div class="actions span-all"><button class="primary">Capture original registry</button></div></form>'+
    '<form class="panel grid" data-form="capture-ledger"><h2 class="span-all">Stellar ledger edition</h2>'+
      field('Edition label','label','GiveCredit mainnet · '+date(new Date()),'text',true)+
      select('Original network','network',[{id:'mainnet',name:'Mainnet'},{id:'testnet',name:'Testnet'}],'mainnet','id','name',null,true)+
      select('Original receipt/payment hash source','registryEditionId',state.editions.filter(row=>row.kind==='registry'),selected.registry,'id','label','No registry source selected')+
      field('Original Credits contract','contractId','CAIRWEYKTLVRQBXQGYNLDUAKWIUV4NO6WPTCMVHH2BOMUUUBTXRJF43R','text',true)+
      '<div class="span-all">'+area('Additional original transaction hashes · one per line','transactionHashes','')+'</div>'+
      field('Account history from · inclusive','fromDate','','date')+field('Account history before · exclusive','beforeDate','','date')+
      '<details class="span-all"><summary>Original source endpoints and ledger selection</summary><div class="grid">'+
      field('RPC endpoint','rpcUrl','https://mainnet.sorobanrpc.com','url')+
      field('Horizon endpoint','horizonUrl','https://horizon.stellar.org','url')+
      field('Original ledger archive RPC','archiveRpcUrl','https://archive-rpc.lightsail.network/','url')+
      field('Additional original accounts · comma separated','accounts','','text')+
      field('First event ledger · inclusive','startLedger','','text')+field('Last event ledger · exclusive','endLedger','','text')+
      '</div></details><label class="checkline span-all"><input type="checkbox" name="resume">Resume this source acquisition from its retained checkpoint</label>'+
      '<p class="span-all">The acquisition retains original receipt hashes, native donation calls, observed provider transfers and their full transaction metadata. Historical states remain separate from current getter observations.</p>'+
      field('Original complete capture options JSON · optional','captureOptionsFile','','file',false,'Use the same original options for a historical checkpoint, including retained ledger sources and exact source boundaries.')+
      '<div class="actions span-all"><button class="primary">Capture original ledger</button></div></form>';
}
async function render(){
  const token=++renderToken;
  document.querySelectorAll('nav button').forEach(button=>{if(button.dataset.page===page)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  const pages={overview,donations,donation,payments,transfer,pools,allocations,bridges,statements,statement,sources,source,compare,intake,capture};
  const markup=await (pages[page]||overview)();if(token===renderToken)main.innerHTML=markup;
}
async function run(work){
  if(busy)return;busy=true;
  try{await work();}catch(error){message(error.message,true);}finally{busy=false;}
}
function pollCapture(){
  if(captureTimer)clearTimeout(captureTimer);
  if(!Object.values(state.captures||{}).some(row=>row.status==='RUNNING'))return;
  captureTimer=setTimeout(async()=>{
    try{const values=await api.request('capture');state.captures=values;const box=document.querySelector('#capture-status');if(box)box.innerHTML=captureStatusMarkup();
      if(Object.values(values).some(row=>row.status==='RUNNING'))pollCapture();
      else{await refresh();message('Source acquisition finished. Open the retained edition or resume its checkpoint.');}
    }catch(error){message(error.message,true);}
  },3000);
}
function go(next,value={}){page=next;context=value;preview=null;drafts={};return render();}
function remember(form){
  const data=new FormData(form),value=Object.fromEntries(data),kind=form.dataset.form;
  if(kind==='allocation'){value.paymentKeys=data.getAll('paymentKeys');value.partAmounts=Object.fromEntries([...data].filter(([key])=>key.startsWith('part:')).map(([key,value])=>[key.slice(5),value]));value.confirmProviderPayout=data.has('confirmProviderPayout');}
  if(['allocation','bridge','statement'].includes(kind))drafts[kind]=value;
  return value;
}
function bindVersion(record,value){return record?{...value,id:record.id,expectedVersion:record.version,active:record.active!==false}:value;}
async function save(action,value){
  const result=await api.apply(action,value,{revision:state.revision});await refresh();message(actionLabel[action]||'Operator work saved.');return result;
}
async function archive(kind,id){
  const list=kind==='payment-link'?state.paymentLinks:kind==='allocation'?state.allocations:state.bridges;
  const row=list.find(row=>row.id===id);if(!row)throw new Error('Reopen the original saved record.');
  const value={...row,expectedVersion:row.version,active:false};
  if(kind==='allocation')value.paymentKeys=row.parts.map(part=>part.paymentKey);
  await save(kind,value);context={};await render();
}
function allocationInput(form){
  const data=new FormData(form),edit=context.id?state.allocations.find(row=>row.id===context.id):null;
  const keys=data.getAll('paymentKeys'),payout=(choices.payouts||[]).find(row=>row.key===data.get('payoutKey'));
  const value={ledgerEditionId:selected.ledger,name:data.get('name'),payoutKey:data.get('payoutKey'),method:data.get('method'),
    paymentKeys:keys,capacities:keys.filter(key=>(choices.donorPayments||[]).find(row=>row.key===key)?.funding?.capacityAtoms===null).map(key=>({paymentKey:key,amountAtoms:toAtoms(data.get('cap:'+key),payout.asset.decimals),note:data.get('capnote:'+key)||''})),
    ordering:keys.map(key=>({paymentKey:key,precedesPayout:data.has('before:'+key),rank:data.get('rank:'+key)||undefined,note:data.get('ordernote:'+key)||''})),note:data.get('note'),confirmProviderPayout:data.has('confirmProviderPayout'),classificationNote:data.get('classificationNote')||''};
  if(value.method==='EXPLICIT')value.parts=keys.map(key=>({paymentKey:key,amountAtoms:toAtoms(data.get('part:'+key),payout.asset.decimals)}));
  return bindVersion(edit,value);
}
document.addEventListener('click',event=>{
  const nav=event.target.closest('[data-page]');if(nav){event.preventDefault();run(()=>go(nav.dataset.page));return;}
  const control=event.target.closest('[data-action]');if(!control)return;event.preventDefault();
  run(async()=>{
    const {action,id,target,offset,kind}=control.dataset;
    if(action==='source')return go('source',{id});
    if(action==='donation')return go('donation',{id});
    if(action==='transfer')return go('transfer',{id});
    if(action==='statement')return go('statement',{id});
    if(action==='edit-link'){const row=state.paymentLinks.find(row=>row.id===id);selected.registry=row.registryEditionId;selected.ledger=row.ledgerEditionId;context={id:row.donationId,linkId:id};page='donation';await refresh();return;}
    if(action==='edit-allocation'){drafts={};const row=state.allocations.find(row=>row.id===id);selected.ledger=row.ledgerEditionId;page='allocations';context={id};await refresh();return;}
    if(action==='edit-bridge'){drafts={};const row=state.bridges.find(row=>row.id===id);selected.ledger=row.ledgerEditionId;selected.carbon=row.carbonEditionId;page='bridges';context={id};await refresh();return;}
    if(action==='edit-statement'){drafts={};const row=state.statements.find(row=>row.id===id);selected={registry:row.latest.spec.registryEditionId||'',ledger:row.latest.spec.ledgerEditionId||'',carbon:row.latest.spec.carbonEditionId||''};page='statements';context={id};await refresh();return;}
    if(action==='new-allocation')return go('allocations');
    if(action==='new-bridge')return go('bridges');
    if(action==='new-statement')return go('statements');
    if(action==='archive-link')return archive('payment-link',id);
    if(action==='archive-allocation')return archive('allocation',id);
    if(action==='archive-bridge')return archive('bridge',id);
    if(action==='clear-filters'){filters[target]={};return render();}
    if(action==='page-offset'){if(target==='table')context.offset=Number(offset);else filters[target]={...filters[target],offset:Number(offset)};return render();}
    if(action==='stop-capture'){await api.stopCapture(kind);message('The native receiver is saving the acquisition checkpoint.');return;}
  });
});
document.addEventListener('change',event=>{
  const input=event.target;
  if(input.dataset.source){run(async()=>{selected[input.dataset.source]=input.value;page=({donation:'donations',transfer:'payments',source:'sources',statement:'statements'})[page]||page;context={};filters={};preview=null;drafts={};await refresh();});return;}
  if(input.hasAttribute('data-source-table')){context.table=input.value;context.offset=0;run(render);return;}
  if(input.hasAttribute('data-statement-version')){context.version=Number(input.value);run(render);return;}
  const form=input.closest('form');if(!form)return;
  if(input.name==='organizationId'){
    const next=form.querySelector('[name=initiativeId]');if(next)next.innerHTML=options((choices.initiatives||[]).filter(row=>!input.value||row.organizationId===input.value),'','id','title','All initiatives');
  }
  if(form.dataset.form==='payment-link'&&input.name==='paymentKey'){
    const payment=(choices.transfers||[]).find(row=>row.key===input.value);if(payment)form.elements.paymentAmount.value=token(payment.amountAtoms,payment.asset.decimals);
  }
  if(form.dataset.form==='allocation'&&['payoutKey','method'].includes(input.name)){
    remember(form);const data=new FormData(form);context={...context,payoutKey:data.get('payoutKey'),method:data.get('method'),paymentKeys:data.getAll('paymentKeys')};preview=null;run(render);
  }
  if(form.dataset.form==='bridge'&&['allocationId','sinkHash'].includes(input.name)){
    remember(form);if(input.name==='allocationId')delete drafts.bridge.paymentAmount;if(input.name==='sinkHash')delete drafts.bridge.carbonAmount;const data=new FormData(form);context={...context,allocationId:data.get('allocationId'),sinkHash:data.get('sinkHash')};preview=null;run(render);
  }
  if(form.dataset.form==='compare'&&input.name==='beforeId'){context.beforeId=input.value;context.afterId='';run(render);}
  if(form.dataset.form==='capture-ledger'&&input.name==='network'){
    const test=input.value==='testnet';form.elements.rpcUrl.value=test?'https://soroban-testnet.stellar.org':'https://mainnet.sorobanrpc.com';
    form.elements.horizonUrl.value=test?'https://horizon-testnet.stellar.org':'https://horizon.stellar.org';
    form.elements.archiveRpcUrl.value=test?'https://soroban-testnet.stellar.org':'https://archive-rpc.lightsail.network/';
    form.elements.contractId.value=test?'':'CAIRWEYKTLVRQBXQGYNLDUAKWIUV4NO6WPTCMVHH2BOMUUUBTXRJF43R';
  }
});
document.addEventListener('submit',event=>{
  const form=event.target;if(!form.dataset.form)return;event.preventDefault();
  const submitter=event.submitter;run(async()=>{
    const data=new FormData(form),value=Object.fromEntries(data),type=form.dataset.form;
    if(type==='filter'){filters[form.dataset.target]={...value,offset:0};return render();}
    if(type==='settings'){await save('settings',{name:value.name});return;}
    if(type==='payment-link'){
      const payment=(choices.transfers||[]).find(row=>row.key===value.paymentKey),edit=context.linkId?state.paymentLinks.find(row=>row.id===context.linkId):null;
      const input=bindVersion(edit,{registryEditionId:selected.registry,ledgerEditionId:selected.ledger,donationId:context.id,paymentKey:value.paymentKey,
        amountAtoms:toAtoms(value.paymentAmount,payment.asset.decimals),receiptId:value.receiptId||null,note:value.note});
      await save('payment-link',input);context={id:context.id};await render();return;
    }
    if(type==='allocation'){
      remember(form);const input=allocationInput(form);
      if(submitter?.value==='preview'){preview={kind:'allocation',value:await api.preview('allocation',input)};await render();}
      else{await save('allocation',input);context={};preview=null;drafts={};await render();}return;
    }
    if(type==='bridge'){
      remember(form);const group=state.allocations.find(row=>row.id===value.allocationId),payout=(choices.payouts||[]).find(row=>row.key===group.payoutKey);
      const edit=context.id?state.bridges.find(row=>row.id===context.id):null;
      const input=bindVersion(edit,{ledgerEditionId:selected.ledger,carbonEditionId:selected.carbon,allocationId:group.id,payoutKey:group.payoutKey,
        sinkHash:value.sinkHash,paymentAtoms:toAtoms(value.paymentAmount,payout.asset.decimals),carbonAmount:value.carbonAmount,note:value.note});
      if(submitter?.value==='preview'){preview={kind:'bridge',value:await api.preview('bridge',input)};await render();}
      else{await save('bridge',input);context={};preview=null;drafts={};await render();}return;
    }
    if(type==='statement'){
      remember(form);const edit=context.id?state.statements.find(row=>row.id===context.id):null,input={...query(),...value,...(edit?{id:edit.id,expectedVersion:edit.versions}:{})};
      if(submitter?.value==='preview'){preview={kind:'statement',value:await api.preview('statement',input)};await render();}
      else{const result=await save('statement',input);await go('statement',{id:result.statementId});}return;
    }
    if(type==='compare'){context={beforeId:value.beforeId,afterId:value.afterId};await render();return;}
    if(type==='carry'){const result=await save('carry-payment-links',value);message(result.created.length+' unchanged payment assignments carried forward; '+result.changed.length+' changed records remain in the comparison.');return;}
    if(type==='source-import'){
      const original=JSON.parse(await data.get('sourceFile').text());
      const request=original.schema==='stellar-forge.stellarcarbon-source-edition.v1'?{carbonSource:original,network:value.network}:{source:original};
      const result=await api.import({...request,label:value.label},{revision:state.revision});await refresh();await go('source',{id:result.edition.id});message('Complete original source edition imported.');return;
    }
    if(type==='registry-import'){
      const files={};for(const file of data.getAll('registryFiles')){if(files[file.name]!==undefined)throw new Error('Choose one original file for each table name.');files[file.name]=await file.text();}
      const result=await api.import({registryFiles:files,label:value.label,metadata:{sourceNote:value.sourceNote,receivedAt:new Date().toISOString()}},{revision:state.revision});
      await refresh();await go('source',{id:result.edition.id});message('Original registry tables imported.');return;
    }
    if(type==='carbon-retained'){
      const result=await api.import({carbonRetained:true,network:'mainnet',label:value.label},{revision:state.revision});await refresh();await go('source',{id:result.edition.id});message('The complete retained Stellarcarbon edition is available.');return;
    }
    if(type==='receive'){
      const original=JSON.parse(await data.get('handoverFile').text()),ready=await api.receive(value.directory,original);
      message('Independent editable workspace received.');
      main.insertAdjacentHTML('afterbegin','<section class="panel"><h2>Received workspace is ready</h2><a class="button" href="'+h(ready.url)+'" target="_blank" rel="noopener">Open the received workspace</a><p>'+h(ready.directory)+'</p></section>');return;
    }
    if(type==='checkpoint-import'){
      const source=JSON.parse(await data.get('checkpointFile').text());
      await api.importCheckpoint(value.kind,source,{revision:state.revision});
      await refresh();message('Original checkpoint received. Continue with the same capture options and Resume.');return;
    }
    if(type==='capture-registry'||type==='capture-ledger'){
      const kind=type==='capture-registry'?'registry':'ledger',input={resume:data.has('resume')};
      if(kind==='registry')Object.assign(input,{apiKey:value.apiKey,baseUrl:value.baseUrl,organizationId:value.organizationId||null});
      else{
        for(const key of ['network','contractId','registryEditionId','rpcUrl','horizonUrl','archiveRpcUrl','fromDate','beforeDate','startLedger','endLedger'])if(value[key])input[key]=value[key];
        input.transactionHashes=(value.transactionHashes||'').split(/[\s,]+/).filter(Boolean);
        if(value.accounts)input.accounts=value.accounts.split(/[\s,]+/).filter(Boolean);
      }
      const optionsFile=data.get('captureOptionsFile');
      if(optionsFile?.size){
        const original=JSON.parse(await optionsFile.text());
        if(!original||typeof original!=='object'||Array.isArray(original))throw new Error('Choose the complete original capture options JSON.');
        for(const key of Object.keys(input))delete input[key];
        Object.assign(input,original,{resume:data.has('resume')});
        if(kind==='registry'&&value.apiKey)input.apiKey=value.apiKey;
      }
      await api.capture(kind,input,value.label,{revision:state.revision});
      if(form.elements.apiKey)form.elements.apiKey.value='';
      await refresh();message('Native source acquisition started. Its original pages and checkpoints remain in this workspace.');return;
    }
  });
});
run(refresh);
