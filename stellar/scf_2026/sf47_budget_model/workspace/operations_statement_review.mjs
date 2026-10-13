// Original Accounts statement recipient review. Pure model and complete offline reviewer.
const copy=value=>structuredClone(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const need=(v,m)=>{if(!v)throw new Error(m);};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const categoryValues=['OTHER','GRANT','INVOICE','CUSTOMER','CAPITAL','REFUND'];
const reviewFields=['action','category','tranche','reason','allocations'];
function reviewText(v,max,name,required=false){need(typeof v==='string'&&v.length<=max&&!v.includes('\0')&&(!required||v.trim()),'Enter '+name+' within '+max+' characters.');return v.trim();}
function reviewTime(v){need(typeof v==='string'&&Number.isFinite(Date.parse(v)),'Use a complete review timestamp.');return v;}
function unlocked(draft){need(draft&&!draft.pending&&!draft.accepted&&!draft.setupPending,'Finish the retained original request before recipient review.');}
function interpretation(draft){const input=copy(draft.inputs);delete input.decisions;return input;}
function reviewEdition(edition){const result=copy(edition);for(const key of ['recipientPackets','recipientReturn','recipientHistory','recipientName','recipientRole','recipientWorklist'])delete result.draft[key];return result;}
function effectiveDecision(draft,row){const selected=(draft.inputs.decisions||[]).find(v=>v.rowNumber===row.rowNumber)||{};return {rowNumber:row.rowNumber,action:selected.action??row.action??'IMPORT',category:selected.category??row.category??draft.inputs.defaultCategory??'OTHER',tranche:selected.tranche===undefined?(row.tranche??null):selected.tranche,reason:selected.reason??row.reason??'',allocations:copy(selected.allocations??row.allocations??[])};}
function validateRecommendation(packet,row){
  need(row&&Number.isSafeInteger(row.rowNumber)&&packet.edition.draft.preview.rows.some(v=>v.rowNumber===row.rowNumber),'Recommendations must use an original preview row.');
  need(Object.keys(row).every(k=>k==='rowNumber'||reviewFields.includes(k)),'A recommendation contains an unknown field.');
  need(['IMPORT','EXCLUDE'].includes(row.action),'Choose Import or Exclude.');
  need(categoryValues.includes(row.category),'Choose an existing cash classification.');
  need(row.tranche===null||Number.isInteger(row.tranche)&&row.tranche>=0&&row.tranche<=3,'Choose no tranche or original tranche 0 through 3.');
  reviewText(row.reason,4000,'a row reason');
  need(Array.isArray(row.allocations)&&row.allocations.length<=200,'Use at most 200 retained invoice allocations.');
  const seen=new Set();
  for(const item of row.allocations){
    need(item&&Object.keys(item).every(k=>['invoiceId','amountUsd'].includes(k))&&packet.invoices.some(v=>v.id===item.invoiceId),'Choose an invoice retained in the review packet.');
    need(!seen.has(item.invoiceId),'Allocate to each invoice once.');seen.add(item.invoiceId);
    need(typeof item.amountUsd==='string'&&/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(item.amountUsd)&&Number(item.amountUsd)>0&&Number(item.amountUsd)<=1e12,'Enter a positive USD invoice amount with at most two decimal places.');
  }
  return copy(row);
}
export function prepareStatementRecipientPacket(edition,current,{id,recipient,issuedBy,issuedAt}){
  need(edition?.schema==='sf47.statement-working-copy.v1'&&edition.caseId===current?.program?.id,'Use a saved original statement edition for this case.');
  const draft=edition.draft;unlocked(draft);
  need(current.program.state==='OPEN'&&draft.dirty===false&&draft.preview?.schema==='stellar-forge.sf47-statements.v1'&&draft.preview.caseId===edition.caseId&&draft.preview.expectedVersion===current.program.version&&Array.isArray(draft.preview.rows),'Preview the current open case before preparing recipient review.');
  need(draft.inputs?.source?.contentBase64&&draft.inputs.source.filename,'Retain the complete original statement file.');
  need(typeof id==='string'&&/^statement-review-[a-zA-Z0-9-]{8,100}$/.test(id),'Use a unique statement review identity.');
  const who={name:reviewText(recipient?.name,160,'the recipient name',true),role:reviewText(recipient?.role,160,'the recipient role',true)};
  const actor={name:reviewText(issuedBy?.name,160,'the preparing operator',true),id:reviewText(issuedBy?.id||'',300,'the preparing operator identity')};
  const seen=new Set();for(const row of draft.preview.rows){need(Number.isSafeInteger(row.rowNumber)&&!seen.has(row.rowNumber),'The preview must retain unique original row numbers.');seen.add(row.rowNumber);}
  const positions=new Map((current.report?.invoices||[]).map(v=>[v.id,v]));
  return {schema:'sf47.statement-recipient-packet.v1',id,caseId:edition.caseId,issuedAt:reviewTime(issuedAt),issuedBy:actor,recipient:who,
    edition:reviewEdition(edition),invoices:(current.records?.invoices||[]).map(v=>({id:v.id,number:v.number,supplier:(current.records?.contributors||[]).find(c=>c.id===v.contributorId)?.name||'Retained supplier',state:v.state,totalUsd:positions.get(v.id)?.totalUsd??v.totalUsd,openUsd:positions.get(v.id)?.openUsd??null,sourceIds:copy(v.sourceIds||[])}))};
}
function validatePacket(packet,edition){
  need(packet?.schema==='sf47.statement-recipient-packet.v1'&&edition?.caseId===packet.caseId&&same(packet.edition,reviewEdition(edition)),'Receive against the exact locally saved original edition, not an edition supplied by a returned file.');
  need(edition.draft.dirty===false&&Array.isArray(edition.draft.preview?.rows),'This review needs its original current native preview.');
  return packet;
}
export {validatePacket as validateStatementRecipientPacket};
export function prepareStatementRecipientReturn(packet,{reviewer,recommendations,returnedAt}){
  validatePacket(packet,packet.edition);
  need(Array.isArray(recommendations)&&recommendations.length===packet.edition.draft.preview.rows.length,'Return every original source row once.');
  const seen=new Set(),rows=recommendations.map(row=>{need(!seen.has(row.rowNumber),'Each original row must appear once.');seen.add(row.rowNumber);return validateRecommendation(packet,row);});
  need(rows.every(v=>packet.edition.draft.preview.rows.some(r=>r.rowNumber===v.rowNumber)),'The return contains another source row.');
  return {schema:'sf47.statement-recipient-return.v1',packetId:packet.id,caseId:packet.caseId,copyId:packet.edition.id,copyRevision:packet.edition.revision,
    issuedAt:packet.issuedAt,recipient:copy(packet.recipient),returnedAt:reviewTime(returnedAt),
    reviewer:{name:reviewText(reviewer?.name,160,'the reviewer name',true),role:reviewText(reviewer?.role,160,'the reviewer role',true),note:reviewText(reviewer?.note||'',4000,'the review note')},recommendations:rows};
}
function checkedReturn(packet,returned){
  need(returned?.schema==='sf47.statement-recipient-return.v1'&&returned.packetId===packet.id&&returned.caseId===packet.caseId&&returned.copyId===packet.edition.id&&returned.copyRevision===packet.edition.revision&&returned.issuedAt===packet.issuedAt&&same(returned.recipient,packet.recipient),'Choose a return for this exact issued recipient review.');
  const expected=prepareStatementRecipientReturn(packet,returned);need(same(expected,returned),'The returned document contains altered or unrecognised fields.');return expected;
}
export function receiveStatementRecipientReturn(packet,edition,returned){validatePacket(packet,edition);return checkedReturn(packet,returned);}
export function compareStatementRecipientReturn(packet,edition,currentDraft,returned){
  validatePacket(packet,edition);checkedReturn(packet,returned);unlocked(currentDraft);
  need(currentDraft.caseId===packet.caseId&&same(interpretation(currentDraft),interpretation(edition.draft)),'The statement source, account, section or interpretation changed. Open and preview the original context before comparing this return.');
  const fields=[];
  for(const row of edition.draft.preview.rows){
    const before=effectiveDecision(edition.draft,row),current=effectiveDecision(currentDraft,row),after=returned.recommendations.find(v=>v.rowNumber===row.rowNumber);
    for(const field of reviewFields)if(!same(before[field],after[field]))fields.push({key:row.rowNumber+':'+field,rowNumber:row.rowNumber,field,reference:row.reference||'',description:row.description||'',before:copy(before[field]),current:copy(current[field]),returned:copy(after[field]),conflict:!same(current[field],before[field])&&!same(current[field],after[field]),alreadyApplied:same(current[field],after[field])});
  }
  return {schema:'sf47.statement-recipient-comparison.v1',packetId:packet.id,returned:copy(returned),current:copy(currentDraft),fields};
}
export function applyStatementRecipientReturn(packet,edition,currentDraft,comparison,choices,{actor,appliedAt}){
  const fresh=compareStatementRecipientReturn(packet,edition,currentDraft,comparison?.returned);
  need(same(fresh,comparison),'The original draft or return changed. Compare again before applying recommendations.');
  need(choices&&typeof choices==='object'&&!Array.isArray(choices),'Choose Keep current or Use returned for every changed field.');
  need(Object.keys(choices).length===fresh.fields.length&&fresh.fields.every(v=>['CURRENT','RETURNED'].includes(choices[v.key])),'Choose explicitly for every changed field, including conflicts.');
  const draft=copy(currentDraft),selected=[];
  if(!Array.isArray(draft.inputs.decisions))draft.inputs.decisions=[];
  for(const row of fresh.fields){
    if(choices[row.key]!=='RETURNED'||row.alreadyApplied)continue;
    let target=draft.inputs.decisions.find(v=>v.rowNumber===row.rowNumber);
    if(!target){target={rowNumber:row.rowNumber,action:effectiveDecision(currentDraft,edition.draft.preview.rows.find(v=>v.rowNumber===row.rowNumber)).action};draft.inputs.decisions.push(target);}
    target[row.field]=copy(row.returned);selected.push({key:row.key,before:copy(row.current),after:copy(row.returned)});
    if(draft.allocationWorks?.[String(row.rowNumber)])draft.allocationWorks[String(row.rowNumber)].proposal=null;
  }
  const receipt={schema:'sf47.statement-recipient-application.v1',packetId:packet.id,copyId:edition.id,copyRevision:edition.revision,reviewer:copy(comparison.returned.reviewer),returnedAt:comparison.returned.returnedAt,appliedAt:reviewTime(appliedAt),actor:reviewText(actor,160,'the applying operator',true),choices:copy(choices),selected,returned:copy(comparison.returned)};
  draft.recipientHistory=[...(draft.recipientHistory||[]),receipt];
  if(selected.length){draft.dirty=true;draft.confirmed=false;draft.batchUndo=null;draft.batchSelection=[];}
  return {draft,receipt};
}
export function statementRecipientPanel({recipient={},packets=[],returned=null,comparison=null,choices={},page=0,notice='',invoices=[]}={}){
  const button=(label,action,disabled=false)=>'<button type="button" data-statement-action="recipient-'+action+'"'+(disabled?' disabled data-statement-fixed="true"':'')+'>'+esc(label)+'</button>';
  const display=(v,field)=>field==='allocations'?(v?.length?v.map(a=>{const invoice=invoices.find(i=>i.id===a.invoiceId);return esc((invoice?invoice.supplier+' · '+invoice.number:a.invoiceId)+' — '+a.amountUsd+' USD');}).join('\n'):'None'):esc(typeof v==='object'?JSON.stringify(v,null,2):v??'None');
  const pages=Math.max(1,Math.ceil((comparison?.fields.length||0)/12)),p=Math.max(0,Math.min(pages-1,Number(page)||0));
  const rows=(comparison?.fields||[]).slice(p*12,p*12+12).map(row=>'<tr><th>Row '+row.rowNumber+' · '+esc(row.field)+'<small>'+esc(row.reference)+' '+esc(row.description)+'</small></th><td><pre>'+display(row.before,row.field)+'</pre></td><td><pre>'+display(row.current,row.field)+'</pre></td><td><pre>'+display(row.returned,row.field)+'</pre></td><td>'+(row.conflict?'<strong>Concurrent change</strong>':row.alreadyApplied?'Already current':'Recommendation')+'<label>Apply choice<select data-recipient-choice="'+esc(row.key)+'"><option value="">Choose…</option><option value="CURRENT"'+(choices[row.key]==='CURRENT'?' selected':'')+'>Keep current</option><option value="RETURNED"'+(choices[row.key]==='RETURNED'?' selected':'')+'>Use returned</option></select></label></td></tr>').join('');
  return '<section class="statement-panel statement-recipient" aria-label="Accountant recipient review"><h4>Accountant recipient review</h4><p>Prepare a complete offline review from the current native preview. The recipient can recommend classification, tranche, exclusions, reasons and invoice allocations. Returned recommendations are compared with the original saved edition and your current draft.</p><div class="statement-fields"><label>Recipient name<input name="review-recipient-name" maxlength="160" value="'+esc(recipient.name||'')+'"></label><label>Recipient role<input name="review-recipient-role" maxlength="160" value="'+esc(recipient.role||'')+'"></label></div><div class="statement-actions">'+button('Save edition and download offline reviewer','export')+button('Open returned recommendations','import',!packets.length)+'</div><p>'+packets.length+' issued reviews retained with this working copy. '+esc(notice)+'</p>'+
    (returned?'<p>Return from <strong>'+esc(returned.reviewer.name)+'</strong> · '+esc(returned.reviewer.role)+' · '+esc(returned.returnedAt)+'</p><p>'+esc(returned.reviewer.note)+'</p><div class="statement-actions">'+button('Compare original, current and returned','compare')+button('Download original return','download-return')+'</div>':'')+
    (comparison?'<h5>'+comparison.fields.length+' changed fields · '+comparison.fields.filter(v=>v.conflict).length+' concurrent conflicts</h5><div class="statement-table"><table><thead><tr><th>Original row / choice</th><th>Issued edition</th><th>Current draft</th><th>Returned recommendation</th><th>Choice</th></tr></thead><tbody>'+rows+'</tbody></table></div><div class="statement-actions">'+button('Previous changes','previous',p===0)+'<span>Page '+(p+1)+' of '+pages+'</span>'+button('Next changes','next',p+1>=pages)+button('Apply selected recommendations to original draft','apply',comparison.fields.some(v=>!choices[v.key]))+'</div><p>Applying marks changed work for native re-preview. The cash records are updated only by the existing reviewed import.</p>':'')+'</section>';
}

function offlineStatementRecipientApp(packet){
  const $=s=>document.querySelector(s),rows=packet.edition.draft.preview.rows;
  let recommendations=rows.map(row=>effectiveDecision(packet.edition.draft,row)),reviewer={name:packet.recipient.name,role:packet.recipient.role,note:''},page=0,query='';
  const download=(value,name,type='application/json')=>{const blob=value instanceof Blob?value:new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)+'\n'],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};
  const note=(message,error=false)=>{const node=$('#review-status');node.textContent=message;node.setAttribute('role',error?'alert':'status');};
  const options=(items,selected)=>items.map(([id,name])=>'<option value="'+esc(id)+'"'+(String(selected??'')===String(id)?' selected':'')+'>'+esc(name)+'</option>').join('');
  function allocationHtml(v,i){return '<div class="allocation-row" data-review-allocation="'+i+'"><label>Retained invoice<select data-review-invoice>'+options([['','Choose invoice'],...packet.invoices.map(i=>[i.id,i.supplier+' · '+i.number+' · '+i.state+' · open '+(i.openUsd??'unavailable')+' USD'])],v.invoiceId)+'</select></label><label>Allocation USD<input data-review-amount inputmode="decimal" value="'+esc(v.amountUsd)+'"></label><button type="button" data-review-remove="'+i+'">Remove</button></div>';}
  function draw(){
    const found=rows.filter(row=>[row.rowNumber,row.reference,row.description,row.date,row.amount,row.currency].join(' ').toLowerCase().includes(query.toLowerCase())),pages=Math.max(1,Math.ceil(found.length/12));page=Math.max(0,Math.min(page,pages-1));
    $('#review-count').textContent=found.length+' of '+rows.length+' source rows · page '+(page+1)+' of '+pages;
    $('#review-previous').disabled=!page;$('#review-next').disabled=page+1>=pages;
    $('#review-rows').innerHTML=found.slice(page*12,(page+1)*12).map(row=>{
      const v=recommendations.find(v=>v.rowNumber===row.rowNumber);
      return '<article class="review-row" data-review-row="'+row.rowNumber+'"><header><h2>Row '+row.rowNumber+' · '+esc(row.reference||'Statement movement')+'</h2><p>'+esc(row.date)+' · '+esc(row.direction)+' '+esc(row.amount)+' '+esc(row.currency)+(row.usdValue!==undefined?' · '+esc(row.usdValue)+' USD':'')+'</p></header><p>'+esc(row.description)+'</p><div class="review-fields"><label>Action<select data-review-field="action">'+options([['IMPORT','Import'],['EXCLUDE','Exclude']],v.action)+'</select></label><label>Classification<select data-review-field="category">'+options(categoryValues.map(v=>[v,v]),v.category)+'</select></label><label>Grant tranche<select data-review-field="tranche">'+options([['','None'],[0,'0'],[1,'1'],[2,'2'],[3,'3']],v.tranche)+'</select></label></div><label>Reason / recommendation<textarea data-review-field="reason" maxlength="4000" rows="3">'+esc(v.reason)+'</textarea></label><details'+(v.allocations.length?' open':'')+'><summary>Invoice allocations · '+v.allocations.length+'</summary><p>Use the retained invoice and original USD movement value. The owner will re-preview allocations against the current case before import.</p>'+v.allocations.map(allocationHtml).join('')+'<button type="button" data-review-add'+(v.allocations.length>=200?' disabled':'')+'>Add invoice allocation</button></details><details><summary>Original native source row</summary><pre>'+esc(JSON.stringify(row,null,2))+'</pre></details></article>';
    }).join('')||'<p class="empty">No source rows match. Clear the search to review the complete statement.</p>';
  }
  function capture(target){
    const article=target.closest('[data-review-row]');if(!article)return;
    const row=recommendations.find(v=>v.rowNumber===Number(article.dataset.reviewRow)),field=target.dataset.reviewField;
    if(field)row[field]=field==='tranche'?(target.value===''?null:Number(target.value)):target.value;
    const allocation=target.closest('[data-review-allocation]');
    if(allocation){const a=row.allocations[Number(allocation.dataset.reviewAllocation)];if(target.matches('[data-review-invoice]'))a.invoiceId=target.value;if(target.matches('[data-review-amount]'))a.amountUsd=target.value.trim();}
  }
  document.addEventListener('input',event=>{capture(event.target);if(event.target.id==='reviewer-name')reviewer.name=event.target.value;if(event.target.id==='reviewer-role')reviewer.role=event.target.value;if(event.target.id==='reviewer-note')reviewer.note=event.target.value;});
  document.addEventListener('change',event=>capture(event.target));
  document.addEventListener('click',event=>{
    const target=event.target.closest('button');if(!target)return;
    try{
      const article=target.closest('[data-review-row]'),row=article?recommendations.find(v=>v.rowNumber===Number(article.dataset.reviewRow)):null;
      if(target.hasAttribute('data-review-add')){row.allocations.push({invoiceId:'',amountUsd:''});draw();}
      else if(target.hasAttribute('data-review-remove')){row.allocations.splice(Number(target.dataset.reviewRemove),1);draw();}
      else if(target.id==='review-find'){query=$('#review-query').value;page=0;draw();}
      else if(target.id==='review-previous'){page--;draw();}
      else if(target.id==='review-next'){page++;draw();}
      else if(target.id==='export-return'){
        const returned=prepareStatementRecipientReturn(packet,{reviewer,recommendations,returnedAt:new Date().toISOString()});
        download(returned,packet.id+'-return.json');note('Downloaded the complete attributed return. Send this file to the original preparing operator; it can also reopen your review here.');
      }else if(target.id==='download-original'){
        const raw=atob(packet.edition.draft.inputs.source.contentBase64),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
        download(new Blob([bytes],{type:'application/octet-stream'}),packet.edition.draft.inputs.source.filename);note('Downloaded the unchanged original bank file.');
      }else if(target.id==='download-packet')download(packet,packet.id+'-complete-source.json');
      else if(target.id==='open-return')$('#return-file').click();
    }catch(error){note(error.message,true);}
  });
  $('#return-file').addEventListener('change',async event=>{try{
    const file=event.target.files[0];if(!file)return;need(file.size<=64*1024*1024,'Choose a return up to 64 MiB.');
    const returned=checkedReturn(packet,JSON.parse(await file.text()));recommendations=copy(returned.recommendations);reviewer=copy(returned.reviewer);
    $('#reviewer-name').value=reviewer.name;$('#reviewer-role').value=reviewer.role;$('#reviewer-note').value=reviewer.note;draw();note('Opened the complete returned review for this exact original edition.');
  }catch(error){note(error.message,true);}finally{event.target.value='';}});
  $('#reviewer-name').value=reviewer.name;$('#reviewer-role').value=reviewer.role;draw();
}
export function statementRecipientReviewHTML(packet){
  validatePacket(packet,packet.edition);
  const definitions=[copy,same,need,esc,reviewText,reviewTime,unlocked,interpretation,reviewEdition,effectiveDecision,validateRecommendation,validatePacket,prepareStatementRecipientReturn,checkedReturn,offlineStatementRecipientApp].map(fn=>'const '+fn.name+' = '+fn.toString()+';').join('\n');
  const safeJSON=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const input=packet.edition.draft.inputs,preview=packet.edition.draft.preview;
  const style=':root{color-scheme:light;font:15px/1.5 system-ui,sans-serif;color:#202124;background:#f4f4f4}*{box-sizing:border-box}body{margin:0}main{max-width:1120px;margin:auto;padding:28px}h1{font-size:28px;line-height:1.2;margin:0 0 12px}h2{font-size:18px;margin:0}h3{font-size:16px}p{margin:8px 0 14px;overflow-wrap:anywhere}.panel,.review-row{background:#fff;border:1px solid #ccc;padding:20px;margin:18px 0;border-radius:3px}label{display:block;font-weight:600;min-width:0}input,select,textarea,button{font:inherit;color:#202124;background:#fff;border:1px solid #777;border-radius:3px;padding:9px;max-width:100%}input,select,textarea{display:block;width:100%;margin:5px 0 10px;font-weight:400}button{cursor:pointer;font-weight:600}button:disabled{opacity:.5;cursor:default}.actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.review-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:15px}.allocation-row{display:grid;grid-template-columns:minmax(0,3fr) minmax(130px,1fr) auto;gap:12px;align-items:center;border-top:1px solid #ddd;padding-top:12px}.allocation-row button{align-self:center}summary{cursor:pointer;font-weight:600;margin:10px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 ui-monospace,monospace;background:#f5f5f5;padding:12px;max-height:460px;overflow:auto}.muted{color:#555}#review-status{white-space:pre-wrap;border-left:3px solid #555;padding-left:12px}table{border-collapse:collapse;width:100%;min-width:560px}th,td{padding:10px;text-align:left;border-bottom:1px solid #ddd;vertical-align:top}.scroll{overflow:auto}.empty{padding:20px;background:#fff}footer{margin-top:30px;font-size:13px;color:#555}@media(max-width:640px){main{padding:14px}.panel,.review-row{padding:14px}.review-fields,.allocation-row{grid-template-columns:1fr}h1{font-size:24px}.actions button{width:100%}}';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Statement review · '+esc(packet.edition.name)+'</title><style>'+style+'</style></head><body><main><header><p class="muted">Accounts · Recipient working review</p><h1>'+esc(packet.edition.name)+'</h1><p>'+esc(input.accountLabel||input.accountId)+' · '+esc(input.currency)+' · '+esc(input.source.filename)+'</p><p>Prepared for '+esc(packet.recipient.name)+' · '+esc(packet.recipient.role)+' by '+esc(packet.issuedBy.name)+' on '+esc(packet.issuedAt)+'. Saved edition '+packet.edition.revision+'.</p></header><section class="panel"><h2>Review the original statement</h2><p>This file contains the complete original source and its native preview. Review every row, enter recommendations, then download the attributed return. The preparing operator will compare your recommendations with their current work and explicitly select changes before the original cash preview and import.</p><p>These are private bank and invoice records. Keep this working file and its downloads with the intended recipient and original case.</p><div class="actions"><button id="download-original">Download original bank file</button><button id="download-packet">Download complete review source</button><button id="open-return">Reopen a returned review</button><input id="return-file" type="file" accept=".json,application/json" hidden></div><details><summary>Statement balances and interpretation</summary><pre>'+esc(JSON.stringify({sourceFormat:input.sourceFormat||'CSV',account:input.accountLabel||input.accountId,currency:input.currency,openingBalance:input.openingBalance??null,closingBalance:input.closingBalance??null,format:input.format??null,columns:input.columns??null,section:input.statementId??null,statementOptions:input.statementOptions??null,balanceReview:preview.balances??preview.balance??null},null,2))+'</pre></details><details><summary>Retained invoice positions · '+packet.invoices.length+'</summary><p>Positions are from the issued review. Current positions are checked by the owner’s native preview.</p><div class="scroll"><table><thead><tr><th>Supplier / invoice</th><th>State</th><th>Total USD</th><th>Open USD</th></tr></thead><tbody>'+packet.invoices.map(v=>'<tr><td>'+esc(v.supplier)+' · '+esc(v.number)+'</td><td>'+esc(v.state)+'</td><td>'+esc(v.totalUsd??'Unavailable')+'</td><td>'+esc(v.openUsd??'Unavailable')+'</td></tr>').join('')+'</tbody></table></div></details></section><section class="panel"><h2>Reviewer attribution</h2><div class="review-fields"><label>Your name<input id="reviewer-name" maxlength="160"></label><label>Your role<input id="reviewer-role" maxlength="160"></label></div><label>Whole-statement review note<textarea id="reviewer-note" maxlength="4000" rows="3"></textarea></label><div class="actions"><button id="export-return">Download attributed recommendations</button></div><p id="review-status" role="status">Review work remains in this open page. Download the complete return before closing; reopen it here to continue.</p></section><section class="panel"><label>Find original rows<input id="review-query" placeholder="Reference, description, date or amount"></label><div class="actions"><button id="review-find">Find rows</button><button id="review-previous">Previous rows</button><span id="review-count"></span><button id="review-next">Next rows</button></div></section><section id="review-rows" aria-label="Original rows and recommendations"></section><footer>Prepared edition and original bank bytes are retained unchanged. Reviewer names are self-attributed; the owner reviews the returned file before applying it to the selected case.</footer></main><script>'+definitions+'\nconst categoryValues='+safeJSON(categoryValues)+';const reviewFields='+safeJSON(reviewFields)+';const packet='+safeJSON(packet)+';offlineStatementRecipientApp(packet);<'+'/script></body></html>';
}
