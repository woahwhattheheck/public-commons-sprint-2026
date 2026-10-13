// Complete returned-review work in the existing statement draft and immutable copy archive.
const clone=value=>structuredClone(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const need=(value,message)=>{if(!value)throw new Error(message);};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const time=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const schema='sf47.statement-review-worklist.v1';
function checkedEntry(entry,caseId){
  need(object(entry)&&typeof entry.id==='string'&&/^statement-return-[a-zA-Z0-9-]{1,120}$/.test(entry.id),'The retained return needs its original work identity.');
  need(entry.returned?.schema==='sf47.statement-recipient-return.v1'&&entry.returned.caseId===caseId&&typeof entry.returned.packetId==='string','Retain a complete returned review for this case.');
  need(time(entry.receivedAt)&&typeof entry.note==='string'&&entry.note.length<=4000,'The return needs its received date and operator note.');
  need(['RECEIVED','REVIEWING','APPLIED'].includes(entry.phase)&&object(entry.choices)&&Array.isArray(entry.applications),'The returned-review progress is incomplete.');
  need(entry.comparison===null||object(entry.comparison)&&object(entry.comparison.basis)&&Array.isArray(entry.comparison.fields)&&time(entry.comparison.comparedAt),'The retained comparison is incomplete.');
  need(Object.entries(entry.choices).every(([key,value])=>['CURRENT','RETURNED'].includes(value)&&entry.comparison?.fields.some(field=>field.key===key)),'Every saved field choice must belong to its retained comparison.');
  need(entry.applications.every(value=>object(value)&&time(value.appliedAt)&&typeof value.actor==='string'&&Number.isSafeInteger(value.selectedCount)&&value.selectedCount>=0),'Retain the original application history.');
  return entry;
}
export function statementReviewWorklist(saved,caseId){
  let result;
  if(saved?.recipientWorklist!==undefined&&saved.recipientWorklist!==null){
    result=clone(saved.recipientWorklist);
    need(result.schema===schema&&result.caseId===caseId&&Array.isArray(result.entries)&&result.entries.length<=2000,'Open the complete returned-review worklist for this original case.');
    need(typeof result.selectedId==='string'&&typeof result.query==='string'&&result.query.length<=1000&&['ALL','RECEIVED','REVIEWING','APPLIED'].includes(result.filter),'The worklist selection or filter is invalid.');
    const seen=new Set();for(const entry of result.entries){checkedEntry(entry,caseId);need(!seen.has(entry.id),'Returned-review identities must be unique.');seen.add(entry.id);}
    need(!result.selectedId||seen.has(result.selectedId),'The selected return is missing from its worklist.');
  }else{
    result={schema,caseId,entries:[],selectedId:'',query:'',filter:'ALL'};
    const originals=[...(saved?.recipientHistory||[]).map(value=>value.returned),saved?.recipientReturn].filter(Boolean);
    for(const returned of originals){
      if(result.entries.some(value=>same(value.returned,returned)))continue;
      const applications=(saved?.recipientHistory||[]).filter(value=>same(value.returned,returned)).map(value=>({appliedAt:value.appliedAt,actor:value.actor,selectedCount:value.selected.length}));
      result.entries.push({id:'statement-return-legacy-'+(result.entries.length+1),returned:clone(returned),receivedAt:returned.returnedAt,note:'',phase:applications.length?'APPLIED':'RECEIVED',comparison:null,choices:{},applications});
    }
    result.selectedId=result.entries.find(value=>same(value.returned,saved?.recipientReturn))?.id||result.entries.at(-1)?.id||'';
    for(const entry of result.entries)checkedEntry(entry,caseId);
  }
  return result;
}
export function selectedStatementReview(worklist){
  return worklist.entries.find(value=>value.id===worklist.selectedId)||null;
}
export function receiveStatementReviewWork(worklist,returned,{id,receivedAt}){
  need(returned?.caseId===worklist.caseId,'Choose a return for this original case.');
  const next=clone(worklist),existing=next.entries.find(value=>same(value.returned,returned));
  if(existing){next.selectedId=existing.id;return {worklist:next,duplicate:true};}
  need(next.entries.length<2000,'This worklist holds 2,000 complete returns. Preserve its complete archive before starting another working copy.');
  const entry={id,returned:clone(returned),receivedAt,note:'',phase:'RECEIVED',comparison:null,choices:{},applications:[]};
  checkedEntry(entry,next.caseId);need(!next.entries.some(value=>value.id===id),'Use a new returned-review work identity.');
  next.entries.push(entry);next.selectedId=id;return {worklist:next,duplicate:false};
}
// Source/account/interpretation is checked against the trusted immutable edition by
// compareStatementRecipientReturn on EVERY resume. Persist only the editable basis;
// original bytes already live in the saved source, issued packet and current draft.
export function statementReviewBasis(draft,caseVersion){
  need(Number.isSafeInteger(caseVersion)&&caseVersion>=0,'Use the current original case version.');
  return {caseId:draft.caseId,caseVersion,decisions:clone(draft.inputs?.decisions||[]),
    allocationWorks:clone(draft.allocationWorks||{}),dirty:draft.dirty!==false,
    preview:draft.preview?{caseId:draft.preview.caseId,expectedVersion:draft.preview.expectedVersion,previewSha256:draft.preview.previewSha256}:null,
    pending:!!draft.pending,accepted:!!draft.accepted,setupPending:!!draft.setupPending};
}
export function statementReviewComparisonCurrent(entry,comparison,basis){
  return !!entry?.comparison&&entry.returned.packetId===comparison?.packetId&&same(entry.returned,comparison.returned)&&
    same(entry.comparison.basis,basis)&&same(entry.comparison.fields,comparison.fields);
}
export function startStatementReviewComparison(entry,comparison,basis,comparedAt){
  need(comparison?.packetId===entry.returned.packetId&&same(comparison.returned,entry.returned)&&time(comparedAt),'Compare this exact original return before recording field choices.');
  const current=statementReviewComparisonCurrent(entry,comparison,basis),next=clone(entry);
  next.phase='REVIEWING';next.comparison={basis:clone(basis),fields:clone(comparison.fields),comparedAt};
  if(!current)next.choices={};return next;
}
export function chooseStatementReviewField(entry,key,value){
  need(entry.comparison?.fields.some(field=>field.key===key),'Compare the original, current and returned field first.');
  need(['','CURRENT','RETURNED'].includes(value),'Choose Keep current or Use returned.');
  const next=clone(entry);if(value)next.choices[key]=value;else delete next.choices[key];return next;
}
export function noteStatementReview(entry,note){
  need(typeof note==='string'&&note.length<=4000&&!note.includes('\0'),'Keep the operator note within 4,000 characters.');
  return {...clone(entry),note};
}
export function recordStatementReviewApplication(entry,receipt){
  need(receipt?.packetId===entry.returned.packetId&&same(receipt.returned,entry.returned)&&time(receipt.appliedAt),'Record the application of this exact returned review.');
  return {...clone(entry),phase:'APPLIED',applications:[...entry.applications,{appliedAt:receipt.appliedAt,actor:receipt.actor,selectedCount:receipt.selected.length}]};
}
export function replaceStatementReviewWork(worklist,entry){
  checkedEntry(entry,worklist.caseId);
  const next=clone(worklist),index=next.entries.findIndex(value=>value.id===entry.id);
  need(index>=0,'The returned-review work item is unavailable.');next.entries[index]=clone(entry);return next;
}
export function statementReviewWorklistPanel({worklist,packets=[],page=0,issuedPage=0,comparisonPage=0,stale='',comparisonReady=false}){
  const selected=selectedStatementReview(worklist),query=worklist.query.toLocaleLowerCase();
  const found=worklist.entries.filter(entry=>(worklist.filter==='ALL'||entry.phase===worklist.filter)&&
    [entry.returned.reviewer?.name,entry.returned.reviewer?.role,entry.returned.reviewer?.note,entry.note,entry.returned.packetId,
      packets.find(packet=>packet.id===entry.returned.packetId)?.edition.draft.inputs.source.filename].join(' ').toLocaleLowerCase().includes(query));
  const pages=Math.max(1,Math.ceil(found.length/10)),p=Math.max(0,Math.min(pages-1,Number(page)||0));
  const button=(title,action,attrs='',disabled=false)=>'<button type="button" data-statement-action="recipient-work-'+action+'" data-statement-recovery="true" '+attrs+(disabled?' disabled data-statement-fixed="true"':'')+'>'+esc(title)+'</button>';
  const rows=found.slice(p*10,p*10+10).map(entry=>{
    const packet=packets.find(packet=>packet.id===entry.returned.packetId),input=packet?.edition.draft.inputs;
    return '<tr><th scope="row">'+esc(entry.returned.reviewer.name)+'<small>'+esc(entry.returned.reviewer.role)+'</small></th><td>'+esc(input?.source.filename||'Original edition unavailable')+'<small>'+esc(input?.accountLabel||input?.accountId||'')+' · '+esc(input?.currency||'')+'</small><small>Issued '+esc(entry.returned.issuedAt)+' · edition '+esc(entry.returned.copyRevision)+'</small></td><td>'+esc(entry.returned.returnedAt)+'<small>Received '+esc(entry.receivedAt)+'</small></td><td>'+esc(entry.phase==='APPLIED'?'Applied to draft':entry.phase==='REVIEWING'?'Choices in progress':'Received')+'<small>'+Object.keys(entry.choices).length+' of '+(entry.comparison?.fields.length||0)+' field choices · '+entry.applications.length+' applications</small></td><td>'+button(entry.id===worklist.selectedId?'Selected':'Open return','select','data-review-work-id="'+esc(entry.id)+'"')+'</td></tr>';
  }).join('');
  const issued=packets.filter(packet=>[packet.recipient.name,packet.recipient.role,packet.edition.draft.inputs.source.filename,packet.id].join(' ').toLocaleLowerCase().includes(query));
  const issuedPages=Math.max(1,Math.ceil(issued.length/10)),ip=Math.max(0,Math.min(issuedPages-1,Number(issuedPage)||0));
  const priorPages=Math.max(1,Math.ceil((selected?.comparison?.fields.length||0)/12)),cp=Math.max(0,Math.min(priorPages-1,Number(comparisonPage)||0));
  const priorFields=selected?.comparison?.fields.slice(cp*12,cp*12+12)||[];
  return '<section class="statement-panel statement-review-worklist" aria-label="Returned review worklist" style="background:#fff;color:#18212b"><h4>Returned review worklist</h4><p>Keep every colleague’s original return, operator note and unfinished choices with this working copy. Reopening checks the original saved edition and current draft before choices can be applied.</p><div class="statement-fields"><label>Find issued or returned review<input name="recipientWorkQuery" data-statement-recovery="true" maxlength="1000" value="'+esc(worklist.query)+'"></label><label>Return progress<select name="recipientWorkFilter" data-statement-recovery="true">'+[['ALL','All returns'],['RECEIVED','Received'],['REVIEWING','Choices in progress'],['APPLIED','Applied to draft']].map(([value,label])=>'<option value="'+value+'"'+(worklist.filter===value?' selected':'')+'>'+label+'</option>').join('')+'</select></label></div><div class="statement-actions">'+button('Find reviews','filter')+button('Clear search','clear')+'</div><p>'+found.length+' of '+worklist.entries.length+' returns · page '+(p+1)+' of '+pages+'</p><div class="statement-table"><table><thead><tr><th>Reviewer</th><th>Original statement / account</th><th>Returned / received</th><th>Progress</th><th>Open</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+(!found.length?'<p>No returns match. Clear the search or receive a colleague’s complete returned file.</p>':'')+'<div class="statement-actions">'+button('Previous returns','previous','',p===0)+button('Next returns','next','',p+1>=pages)+'</div>'+
    (selected?'<h5>Selected return: '+esc(selected.returned.reviewer.name)+'</h5><p>'+esc(selected.returned.reviewer.note)+'</p><label>Operator note for this return<textarea name="recipientWorkNote" data-statement-recovery="true" rows="3" maxlength="4000">'+esc(selected.note)+'</textarea></label><p data-review-work-status>'+esc(stale||(comparisonReady?'Saved choices checked against the current original draft.':selected.phase==='APPLIED'?'The application remains in this draft’s review history. Compare again to review current differences.':'Compare the selected return with the original edition and current draft.'))+'</p>'+
      button('Save review progress','save')+button('Download selected original return','return')+
      (selected.comparison&&!comparisonReady?'<details><summary>Earlier comparison and saved choices</summary><pre>'+esc(JSON.stringify({comparedAt:selected.comparison.comparedAt,page:cp+1,pages:priorPages,fields:priorFields,choices:Object.fromEntries(priorFields.filter(field=>selected.choices[field.key]).map(field=>[field.key,selected.choices[field.key]]))},null,2))+'</pre>'+button('Previous earlier fields','choice-previous','',cp===0)+button('Next earlier fields','choice-next','',cp+1>=priorPages)+'</details>':'')+
      (selected.applications.length?'<details><summary>Applications to this working draft · '+selected.applications.length+'</summary><pre>'+esc(JSON.stringify(selected.applications,null,2))+'</pre></details>':''):'')+
    '<details><summary>Issued reviews · '+issued.length+' matching of '+packets.length+'</summary><p>Download the exact issued reviewer again. Receiving a return uses its locally retained immutable edition.</p>'+issued.slice(ip*10,ip*10+10).map(packet=>'<article><strong>'+esc(packet.recipient.name)+' · '+esc(packet.recipient.role)+'</strong><p>'+esc(packet.edition.draft.inputs.source.filename)+' · '+esc(packet.issuedAt)+' · edition '+packet.edition.revision+' · '+worklist.entries.filter(entry=>entry.returned.packetId===packet.id).length+' returns</p>'+button('Download issued reviewer','issued','data-review-packet-id="'+esc(packet.id)+'"')+'</article>').join('')+'<p>Issued page '+(ip+1)+' of '+issuedPages+'</p>'+button('Previous issued reviews','issued-previous','',ip===0)+button('Next issued reviews','issued-next','',ip+1>=issuedPages)+'</details></section>';
}
