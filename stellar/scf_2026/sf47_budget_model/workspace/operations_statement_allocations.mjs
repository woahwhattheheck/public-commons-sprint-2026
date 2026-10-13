// Supplier-payment review for the existing statement decisions and native cash writer.
const copy=value=>structuredClone(value);
const need=(value,message)=>{if(!value)throw new Error(message);};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const exact=value=>JSON.stringify(value);
const cents=value=>{const m=/^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value??''));return m?BigInt(m[1])*100n+BigInt((m[2]||'').padEnd(2,'0')):null;};
const signedCents=value=>{const text=String(value??'');return text.startsWith('-')?cents(text.slice(1))===null?null:-cents(text.slice(1)):cents(text);};
const money=value=>{const negative=value<0n,digits=(negative?-value:value).toString().padStart(3,'0');return (negative?'-':'')+digits.slice(0,-2)+'.'+digits.slice(-2);};
const positive=value=>{const n=cents(value);need(n!==null&&n>0n&&n<=100000000000000n,'Enter a positive USD allocation with at most two decimal places, up to 1,000,000,000,000.');return n;};
const decision=(inputs,row)=>({rowNumber:row.rowNumber,action:row.action||'IMPORT',category:row.category,reason:row.reason||'',allocations:copy(row.allocations||[]),...(inputs.decisions||[]).find(item=>item.rowNumber===row.rowNumber)});
const amountSum=rows=>{let total=0n;for(const row of rows){const value=cents(row.amountUsd);if(value===null)return null;total+=value;}return total;};
function referenceMatch(number,row){
  const value=String(number||'').trim().toLocaleUpperCase('en-US');
  if(value.length<3)return false;
  const original=[row.reference,row.description].map(value=>String(value||'').toLocaleUpperCase('en-US'));
  const pattern=value.replace(/[.*+?^$\{\}()|[\]\\]/g,'\\$&');
  return original.some(text=>new RegExp('(^|[^A-Z0-9])'+pattern+'($|[^A-Z0-9])','u').test(text));
}
export function statementAllocationBasis(preview,rowNumber){
  const row=preview?.rows?.find(item=>item.rowNumber===rowNumber);
  need(row,'The original statement row is unavailable. Preview it again.');
  return {caseId:preview.caseId,sourceSha256:preview.source?.sha256,accountId:preview.source?.accountId,
    sourceFormat:preview.source?.sourceFormat||'CSV',statementId:preview.bank?.statementId||preview.bank?.id||null,
    row:copy(Object.fromEntries(['rowNumber','reference','date','description','direction','currency','amount','usdValue','sourceLine','nativeIdentity'].filter(key=>row[key]!==undefined).map(key=>[key,row[key]])))};
}
export function sameStatementAllocationBasis(left,right){return exact(left)===exact(right);}
export function statementAllocationContext(current,preview,inputs,rowNumber){
  need(preview?.schema==='stellar-forge.sf47-statements.v1'&&preview.caseId===current.program.id,'Use a native statement preview for this case.');
  const row=preview.rows.find(item=>item.rowNumber===rowNumber);need(row,'Choose an original source row.');
  const selected=decision(inputs,row),positions=new Map((current.report?.invoices||[]).map(item=>[item.id,item]));
  const other=new Map();
  for(const source of preview.rows){
    const use=decision(inputs,source);
    if(source.rowNumber===rowNumber||source.status==='EXISTING'||use.action==='EXCLUDE')continue;
    for(const allocation of use.allocations||[]){
      const amount=cents(allocation.amountUsd);
      const prior=other.get(allocation.invoiceId)||{amount:0n,rows:[],valid:true};
      prior.valid=prior.valid&&amount!==null&&['IN','OUT'].includes(source.direction);if(amount!==null)prior.amount+=amount*(source.direction==='IN'?-1n:1n);
      prior.rows.push(source.rowNumber);other.set(allocation.invoiceId,prior);
    }
  }
  const invoices=(current.records?.invoices||[]).map(invoice=>{
    const supplier=(current.records?.contributors||[]).find(item=>item.id===invoice.contributorId),position=positions.get(invoice.id),pending=other.get(invoice.id);
    return {id:invoice.id,number:invoice.number,supplierId:invoice.contributorId,supplier:supplier?.name||'Retained supplier',
      state:invoice.state,issuedDate:invoice.issuedDate,dueDate:invoice.dueDate,totalUsd:position?.totalUsd??invoice.totalUsd,
      paidUsd:position?.paidUsd??null,openUsd:position?.openUsd??null,overpaidUsd:position?.overpaidUsd??null,
      otherDraftUsd:pending?(pending.valid?money(pending.amount):null):'0.00',otherDraftRows:pending?.rows||[],
      sourceIds:copy(invoice.sourceIds||[]),lines:copy(invoice.lines||[]),sourceBasis:copy(invoice.sourceBasis??null),
      referenceMatch:referenceMatch(invoice.number,row)};
  });
  const value=cents(row.usdValue);
  return {caseId:current.program.id,caseVersion:current.program.version,previewVersion:preview.expectedVersion,
    previewSha256:preview.previewSha256,inputsSha256:preview.inputsSha256,basis:statementAllocationBasis(preview,rowNumber),
    row:copy(row),decision:selected,usdValue:value===null?null:money(value),invoices,
    referenceMatches:invoices.filter(invoice=>invoice.referenceMatch).map(invoice=>invoice.id)};
}
export function statementAllocationCandidates(context,query='',filter='OPEN'){
  const needle=String(query).trim().toLocaleLowerCase('en-US');
  return context.invoices.filter(invoice=>(filter==='ALL'||filter==='MATCHES'&&invoice.referenceMatch||filter==='OPEN'&&invoice.state!=='VOID'&&cents(invoice.openUsd)>0n)&&
    (!needle||[invoice.supplier,invoice.number,invoice.state,invoice.id,invoice.issuedDate,invoice.dueDate].join(' ').toLocaleLowerCase('en-US').includes(needle)))
    .sort((a,b)=>Number(b.referenceMatch)-Number(a.referenceMatch)||String(a.dueDate||'9999').localeCompare(String(b.dueDate||'9999'))||String(a.number).localeCompare(String(b.number))||a.id.localeCompare(b.id));
}
export function statementAllocationSuggestedAmount(context,allocations,invoiceId){
  const invoice=context.invoices.find(item=>item.id===invoiceId);need(invoice,'Choose a retained invoice.');
  const value=cents(context.usdValue),open=cents(invoice.openUsd),credit=cents(invoice.overpaidUsd),other=signedCents(invoice.otherDraftUsd);
  need(value!==null&&open!==null&&credit!==null&&other!==null,'The native USD value and current invoice position are needed to suggest an amount.');
  need(context.row.direction==='OUT'||context.decision.category==='REFUND','Review the cash category and preview before suggesting an invoice amount.');
  const retained=allocations.filter(item=>item.invoiceId!==invoiceId),allocated=amountSum(retained);
  need(allocated!==null,'Correct the other draft amounts first.');
  const capacity=value-allocated,remaining=context.row.direction==='IN'?credit-open+other:open-credit-other,suggested=capacity<remaining?capacity:remaining;
  need(suggested>0n,'There is no remaining statement capacity or invoice balance in this direction. Enter an explicit amount to review a supplier credit or a refund that increases the open balance.');
  return money(suggested);
}
export function prepareStatementAllocations(current,preview,inputs,rowNumber,allocations,reason){
  const context=statementAllocationContext(current,preview,inputs,rowNumber);
  need(current.program.state==='OPEN'&&context.caseVersion===context.previewVersion,'Refresh this open case and preview its current cash and invoice positions.');
  need(context.row.status!=='EXISTING','Already recorded cash keeps its original allocations. Use the original Cash correction workflow.');
  need(context.decision.action!=='EXCLUDE','Include this source row and preview it before allocating its payment.');
  need(Array.isArray(allocations)&&allocations.length<=200,'Use at most 200 invoice allocations.');
  const note=String(reason||'').trim();need(note&&note.length<=4000&&!note.includes('\0'),'Write a reason for these invoice allocations.');
  const after=copy(inputs.decisions.find(item=>item.rowNumber===rowNumber)||{rowNumber,action:context.decision.action});
  after.reason=context.decision.reason?context.decision.reason+'\n'+note:note;
  need(after.reason.length<=4000,'The existing note and allocation reason together must fit 4,000 characters.');
  const seen=new Set(),warnings=[],positions=[];
  after.allocations=allocations.map(item=>{
    const invoice=context.invoices.find(row=>row.id===item.invoiceId);need(invoice,'Every allocation needs an invoice retained in this case.');
    need(!seen.has(invoice.id),'Allocate to each invoice once; combine its partial amounts.');seen.add(invoice.id);
    const value=positive(item.amountUsd),open=cents(invoice.openUsd),credit=cents(invoice.overpaidUsd),other=signedCents(invoice.otherDraftUsd);
    need(open!==null&&credit!==null&&other!==null,'Read the current native invoice position and correct other draft amounts before allocating.');
    if(invoice.state==='VOID'||invoice.state==='DISPUTED')warnings.push(invoice.number+' is '+invoice.state.toLowerCase()+'.');
    const balance=open-credit-other-value*(context.row.direction==='IN'?-1n:1n);
    positions.push({invoiceId:invoice.id,openUsd:money(balance>0n?balance:0n),creditUsd:money(balance<0n?-balance:0n)});
    if(balance<0n)warnings.push(invoice.number+': the selected allocation and other included draft rows leave '+money(-balance)+' USD supplier credit.');
    if(context.row.direction==='IN'&&balance>0n)warnings.push(invoice.number+': this incoming refund increases the open liability; projected open balance '+money(balance)+' USD.');
    if(invoice.issuedDate&&context.row.date&&invoice.issuedDate>context.row.date)warnings.push(invoice.number+' was issued after this statement movement.');
    return {invoiceId:invoice.id,amountUsd:money(value)};
  });
  const total=amountSum(after.allocations),value=cents(context.usdValue);
  if(after.allocations.length){
    need(context.row.direction==='OUT'||context.decision.category==='REFUND','Invoice allocations require outgoing cash or the existing Refund category. Review the classification and preview again.');
    need(value!==null,'This movement needs its explicit native USD value before allocating. No exchange rate is assumed.');
    need(total<=value,'The total invoice allocations exceed this movement’s recorded USD value.');
  }
  return {schema:'sf47.statement-allocation-review.v1',rowNumber,caseId:context.caseId,caseVersion:context.caseVersion,
    previewSha256:context.previewSha256,inputsSha256:context.inputsSha256,basis:context.basis,
    decisions:copy(inputs.decisions),context,reason:note,before:copy(context.decision.allocations||[]),after,
    totalUsd:money(total),unallocatedUsd:value===null?null:money(value-total),positions,warnings};
}
export function applyStatementAllocations(current,preview,inputs,proposal){
  need(proposal?.schema==='sf47.statement-allocation-review.v1','Review the complete allocation changes first.');
  const fresh=prepareStatementAllocations(current,preview,inputs,proposal.rowNumber,proposal.after.allocations,proposal.reason);
  need(exact(fresh)===exact(proposal),'The source, case, invoice positions or row decisions changed. Review the allocations again.');
  const decisions=copy(inputs.decisions),index=decisions.findIndex(row=>row.rowNumber===proposal.rowNumber);
  if(index<0)decisions.push(copy(proposal.after));else decisions[index]=copy(proposal.after);
  return decisions;
}
const button=(title,action,disabled=false,attrs='')=>'<button type="button" data-statement-action="'+action+'" '+attrs+(disabled?' disabled data-statement-fixed="true"':'')+'>'+esc(title)+'</button>';
const amount=value=>value===null||value===undefined?'Unavailable':esc(value)+' USD';
function table(headers,rows){return '<div class="statement-table"><table><thead><tr>'+headers.map(v=>'<th scope="col">'+esc(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
function invoiceLabel(context,id){const invoice=context.invoices.find(row=>row.id===id);return invoice?invoice.supplier+' · '+invoice.number:id;}
export function statementAllocationSummary(context,allocations){
  const total=amountSum(allocations),capacity=cents(context.usdValue);
  return {total:total===null?'Correct draft amounts':money(total)+' USD',remaining:capacity===null||total===null?'Unavailable':money(capacity-total)+' USD'};
}
export function statementAllocationPanel(context,work,{editable=true,stale=false,canDownload=false}={}){
  const candidates=statementAllocationCandidates(context,work.appliedQuery||'',work.filter||'OPEN'),pages=Math.max(1,Math.ceil(candidates.length/25)),page=Math.max(0,Math.min(Number(work.page)||0,pages-1));
  const shown=candidates.slice(page*25,(page+1)*25),selected=new Set(work.allocations.map(row=>row.invoiceId)),locked=!editable||stale;
  const total=amountSum(work.allocations),capacity=cents(context.usdValue),review=work.proposal;
  const attrs=id=>'data-invoice="'+esc(id)+'"';
  const invoice=context.invoices.find(row=>row.id===work.inspectId);
  const warning=stale?'<p class="statement-notice">The original row or case changed. Preview updated decisions before reviewing this saved working copy.</p>':'';
  const before=review?table(['Invoice','Before allocation','After allocation','Current paid / open','Other draft net payments','Projected open / credit'],[...new Set([...review.before.map(row=>row.invoiceId),...review.after.allocations.map(row=>row.invoiceId)])].map(id=>{
    const item=context.invoices.find(row=>row.id===id),projected=review.positions.find(row=>row.invoiceId===id);
    return [esc(invoiceLabel(context,id)),amount(review.before.find(row=>row.invoiceId===id)?.amountUsd||'0.00'),amount(review.after.allocations.find(row=>row.invoiceId===id)?.amountUsd||'0.00'),
      amount(item?.paidUsd)+' / '+amount(item?.openUsd),amount(item?.otherDraftUsd)+'<small>'+esc(item?.otherDraftRows.join(', '))+'</small>',projected?amount(projected.openUsd)+' / '+amount(projected.creditUsd):'Allocation removed'];
  })):'';
  return '<section class="statement-panel statement-allocation-panel" aria-label="Supplier payment allocation review"><h4>Allocate payment — source row '+esc(context.row.rowNumber)+'</h4>'+
    '<p><strong>'+esc(context.row.reference)+'</strong> · '+esc(context.row.date)+' · '+esc(context.row.direction)+' '+esc(context.row.amount)+' '+esc(context.row.currency)+'</p><p>'+esc(context.row.description)+'</p>'+warning+
    '<div class="statement-summary"><div><span>Recorded USD value</span><strong>'+amount(context.usdValue)+'</strong></div><div><span>Working allocations</span><strong data-allocation-total>'+(total===null?'Correct draft amounts':amount(money(total)))+'</strong></div><div><span>Unallocated capacity</span><strong data-allocation-remaining>'+(capacity===null||total===null?'Unavailable':amount(money(capacity-total)))+'</strong></div></div>'+
    '<p>Invoice positions are from current case version '+esc(context.caseVersion)+', including retained cash. Other included draft rows are shown separately as net invoice payments: outgoing payments are positive and incoming refunds are negative. These are current positions, not a historical balance at the movement date.</p>'+
    '<p>'+context.referenceMatches.length+' invoice-number matches in the original reference or description. '+(context.referenceMatches.length>1?'Several invoices match; inspect the supplier and original source before selecting.':'Matches are suggestions for your selection.')+'</p>'+
    '<form data-statement-allocations><div class="statement-fields"><label>Find supplier or invoice<input name="allocationQuery" value="'+esc(work.query||'')+'"></label><label>Show invoices<select name="allocationFilter">'+[['OPEN','Current open invoices'],['MATCHES','Original reference matches'],['ALL','All retained invoices']].map(([value,text])=>'<option value="'+value+'"'+((work.filter||'OPEN')===value?' selected':'')+'>'+text+'</option>').join('')+'</select></label></div>'+
    '<div class="statement-actions">'+button('Find invoices','allocation-filter')+button('Previous invoices','allocation-previous',page===0)+'<span>Page '+(page+1)+' of '+pages+' · '+candidates.length+' invoices</span>'+button('Next invoices','allocation-next',page+1>=pages)+'</div>'+
    (shown.length?table(['Supplier / invoice','Dates / state','Current paid / open','Other draft net payments','Choose'],shown.map(item=>[
      '<strong>'+esc(item.supplier)+'</strong><small>'+esc(item.number)+'</small>'+(item.referenceMatch?'<small>Original invoice-number match</small>':''),
      esc(item.state)+'<small>Issued '+esc(item.issuedDate)+' · due '+esc(item.dueDate||'Unspecified')+'</small>',
      amount(item.paidUsd)+' / '+amount(item.openUsd)+(cents(item.overpaidUsd)>0n?'<small>Existing credit '+amount(item.overpaidUsd)+'</small>':''),
      amount(item.otherDraftUsd)+(item.otherDraftRows.length?'<small>Source rows '+esc(item.otherDraftRows.join(', '))+'</small>':''),
      button('Inspect invoice','allocation-inspect',false,attrs(item.id))+button(selected.has(item.id)?'Selected':'Add invoice','allocation-add',locked||selected.has(item.id)||work.allocations.length>=200,attrs(item.id))
    ])):'<p class="statement-empty">No invoices match. Change the search or show all retained invoices.</p>')+
    '<h5>Explicit payment allocations</h5>'+(!work.allocations.length?'<p>No allocations selected. Select retained invoices above, or review an empty selection to remove the row’s earlier draft allocations.</p>':'')+
    work.allocations.map((item,index)=>'<div class="statement-allocation-item"><strong>'+esc(invoiceLabel(context,item.invoiceId))+'</strong><input type="hidden" name="invoice.'+index+'" value="'+esc(item.invoiceId)+'"><label>Allocated USD<input name="amount.'+index+'" value="'+esc(item.amountUsd)+'" inputmode="decimal" required'+(locked?' disabled data-statement-fixed="true"':'')+'></label><div class="statement-actions">'+button(context.row.direction==='IN'?'Use available credit amount':'Use remaining open amount','allocation-remaining',locked,attrs(item.invoiceId))+button('Inspect invoice','allocation-inspect',false,attrs(item.invoiceId))+button('Remove','allocation-remove',locked,'data-index="'+index+'"')+'</div></div>').join('')+
    '<label>Allocation review reason<textarea name="allocationReason" rows="3" maxlength="4000"'+(locked?' disabled data-statement-fixed="true"':'')+'>'+esc(work.reason||'')+'</textarea></label><p>The reason is appended to the original row note. The category, tranche and other row decisions are preserved.</p>'+
    '<div class="statement-actions">'+button('Review allocation changes','allocation-review',locked)+button('Download allocation working copy','allocation-export',false,'data-statement-recovery="true"')+button('Close allocation editor','close-allocations')+'</div></form>'+
    (invoice?'<section class="statement-allocation-invoice"><h5>'+esc(invoice.supplier)+' · '+esc(invoice.number)+'</h5><p>'+esc(invoice.state)+' · issued '+esc(invoice.issuedDate)+' · due '+esc(invoice.dueDate||'Unspecified')+' · total '+amount(invoice.totalUsd)+'</p>'+
      table(['Original invoice line','Cost identity','USD'],invoice.lines.map(line=>[esc(line.description),esc(line.costId),amount(line.amountUsd)]))+
      '<div class="statement-actions">'+invoice.sourceIds.map(id=>button('Download original invoice source','allocation-source',!canDownload,'data-source="'+esc(id)+'" data-statement-recovery="true"')).join('')+'</div>'+
      '<details><summary>Original invoice and source identities</summary><pre>'+esc(JSON.stringify(invoice,null,2))+'</pre></details></section>':'')+
    (review?'<section class="statement-allocation-proposal"><h5>Review before applying to this statement draft</h5>'+before+
      '<p>Total '+amount(review.totalUsd)+' · unallocated '+amount(review.unallocatedUsd)+'. '+esc(review.reason)+'</p>'+
      (review.warnings.length?'<ul>'+review.warnings.map(value=>'<li>'+esc(value)+'</li>').join('')+'</ul>':'')+
      '<div class="statement-actions">'+button('Apply reviewed allocations','allocation-apply',locked)+button('Download allocation review','allocation-review-export',false,'data-statement-recovery="true"')+'</div>'+
      '<p>Applying updates this draft. Preview the complete statement again to obtain the native cash review before importing.</p></section>':'')+'</section>';
}
