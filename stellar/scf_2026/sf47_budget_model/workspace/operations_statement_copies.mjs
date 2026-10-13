// Named complete working copies in the existing Staff-scoped Statements database.
const clone = value => structuredClone(value);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const need = (value, message) => { if (!value) throw new Error(message); };
const text = (value, title, maximum) => {
  need(typeof value === 'string' && value.trim() && value.length <= maximum, title+' is required (up to '+maximum+' characters).');
  return value.trim();
};
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const idPattern = /^statement-copy-[a-zA-Z0-9-]{8,100}$/;
const schema = 'sf47.statement-working-copies.v1';
const editionSchema = 'sf47.statement-working-copy.v1';
const maximumEditionBytes = 64*1024*1024;
const maximumArchiveBytes = 256*1024*1024;
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;

export function statementCopyIndex(caseId) {
  return {schema,caseId:text(caseId,'Original case',300),revision:0,copies:[]};
}
export function validateStatementCopyDraft(draft,caseId) {
  need(object(draft) && draft.schema === 'sf47.statement-draft.v1' && draft.caseId === caseId && object(draft.inputs),'Choose a complete statement draft for this original case.');
  need(draft.inputs.decisions === undefined || Array.isArray(draft.inputs.decisions),'Statement row decisions must be a complete list.');
  const source=draft.inputs.source;
  need(source === null || source === undefined || object(source) && typeof source.filename === 'string' && typeof source.contentBase64 === 'string','Retain the original statement filename and bytes.');
  need([draft.pending,draft.accepted,draft.setupPending].filter(Boolean).length <= 1,'The saved copy contains conflicting original request states.');
  need(bytes(draft) <= maximumEditionBytes,'A complete working copy can contain up to 64 MiB.');
  return clone(draft);
}
function indexValue(index,caseId) {
  need(object(index)&&index.schema===schema&&index.caseId===caseId&&Number.isSafeInteger(index.revision)&&index.revision>=0&&Array.isArray(index.copies),'The saved working-copy list belongs to another case or edition.');
  need(index.copies.length<=2000,'A saved list can contain up to 2,000 named copies.');
  need(index.copies.reduce((total,row)=>total+(Number.isSafeInteger(row?.revision)?row.revision:10001),0)<=10000,'A saved list can contain up to 10,000 complete editions.');
  const ids=new Set();
  for(const row of index.copies) {
    need(object(row)&&idPattern.test(row.id)&&!ids.has(row.id)&&Number.isSafeInteger(row.revision)&&row.revision>0,'The saved working-copy list has an invalid identity or revision.');
    text(row.name,'Working-copy name',160);ids.add(row.id);
  }
  return clone(index);
}
export function statementCopySummary(edition) {
  const draft=edition.draft, input=draft.inputs, pending=draft.pending?.payload||draft.accepted?.payload||draft.setupPending?.payload;
  return {id:edition.id,name:edition.name,revision:edition.revision,savedAt:edition.savedAt,note:edition.note,
    filename:input.source?.filename||'',accountId:input.accountId||'',accountLabel:input.accountLabel||'',
    currency:input.currency||'',sourceFormat:input.sourceFormat||'CSV',rows:draft.preview?.rows?.length??null,
    decisions:(input.decisions||[]).length,allocations:Object.keys(draft.allocationWorks||{}).length,
    status:draft.accepted?'READBACK':draft.pending||draft.setupPending?'PENDING':'EDITABLE',
    requestId:pending?.requestId||null};
}
export function prepareStatementCopySave(index,input) {
  const current=indexValue(index,index.caseId);
  need(input.expectedRevision===current.revision,'Another tab changed the saved copies. Refresh the list, then save your complete current work again.');
  need(idPattern.test(input.id||''),'A working copy needs its original identity.');
  const existing=current.copies.find(row=>row.id===input.id);
  const name=text(input.name,'Working-copy name',160), note=text(input.note,'Saved edition note',2000);
  const savedAt=text(input.savedAt,'Saved time',50);
  need(Number.isFinite(Date.parse(savedAt)),'Use a valid saved time.');
  const edition={schema:editionSchema,caseId:current.caseId,id:input.id,name,revision:(existing?.revision||0)+1,savedAt,note,draft:validateStatementCopyDraft(input.draft,current.caseId)};
  const row=statementCopySummary(edition);
  if(existing)current.copies[current.copies.findIndex(value=>value.id===row.id)]=row;
  else current.copies.push(row);
  current.revision++;
  indexValue(current,current.caseId);
  return {index:current,edition};
}
function editionValue(value,caseId) {
  need(object(value)&&value.schema===editionSchema&&value.caseId===caseId&&idPattern.test(value.id||'')&&Number.isSafeInteger(value.revision)&&value.revision>0,'The complete working-copy edition is invalid.');
  text(value.name,'Working-copy name',160);text(value.note,'Saved edition note',2000);
  need(typeof value.savedAt==='string'&&Number.isFinite(Date.parse(value.savedAt)),'The saved edition needs its original timestamp.');
  validateStatementCopyDraft(value.draft,caseId);return clone(value);
}
export function prepareStatementCopyArchive(archive,caseId) {
  need(object(archive)&&archive.schema==='sf47.statement-working-copy-archive.v1'&&archive.caseId===caseId&&Array.isArray(archive.editions),'Choose a complete working-copy archive for this original case.');
  need(bytes(archive)<=maximumArchiveBytes,'Choose a complete working-copy archive up to 256 MiB.');
  const index=indexValue(archive.index,caseId), editions=archive.editions.map(value=>editionValue(value,caseId)), keys=new Set();
  for(const edition of editions) {
    const row=index.copies.find(value=>value.id===edition.id),key=edition.id+':'+edition.revision;
    need(row&&edition.revision<=row.revision&&!keys.has(key),'The archive has an extra or repeated working-copy edition.');keys.add(key);
    if(edition.revision===row.revision)need(same(row,statementCopySummary(edition)),'The archive summary differs from its complete latest edition.');
  }
  for(const row of index.copies)for(let revision=1;revision<=row.revision;revision++)need(keys.has(row.id+':'+revision),'The archive is missing an earlier complete working-copy edition.');
  return {schema:archive.schema,caseId,index,editions};
}
export function mergeStatementCopyArchive(index,archive,expectedRevision,existingEditions=[]) {
  const current=indexValue(index,index.caseId), incoming=prepareStatementCopyArchive(archive,index.caseId);
  need(current.revision===expectedRevision,'Another tab changed the saved copies. Refresh the list before importing this archive.');
  const existing=new Map(existingEditions.map(value=>[value.id+':'+value.revision,editionValue(value,index.caseId)])), additions=[];
  for(const edition of incoming.editions) {
    const prior=existing.get(edition.id+':'+edition.revision);
    if(prior)need(same(prior,edition),'A working-copy identity has different complete content in this archive. Both originals are preserved; open it in a separate browser profile to inspect.');
    else {
      const row=current.copies.find(value=>value.id===edition.id);
      need(!row||edition.revision>row.revision,'The existing archive is missing an original edition; reopen its complete original copy.');
      additions.push(edition);
    }
  }
  for(const row of incoming.index.copies) {
    const position=current.copies.findIndex(value=>value.id===row.id);
    if(position<0)current.copies.push(row);
    else if(current.copies[position].revision<row.revision)current.copies[position]=row;
  }
  if(additions.length)current.revision++;
  indexValue(current,current.caseId);
  return {index:current,additions};
}
export function compareStatementCopy(current,edition) {
  const draft=validateStatementCopyDraft(current,current.caseId), other=editionValue(edition,current.caseId).draft;
  const selected=statementCopySummary(edition);
  const fields=[
    ['Original file',draft.inputs.source?.filename,other.inputs.source?.filename],
    ['Account key',draft.inputs.accountId,other.inputs.accountId],
    ['Account label',draft.inputs.accountLabel,other.inputs.accountLabel],
    ['Currency',draft.inputs.currency,other.inputs.currency],
    ['Source format',draft.inputs.sourceFormat||'CSV',other.inputs.sourceFormat||'CSV'],
    ['Original bank section',draft.inputs.statementId,other.inputs.statementId],
    ['Opening balance',draft.inputs.openingBalance,other.inputs.openingBalance],
    ['Closing balance',draft.inputs.closingBalance,other.inputs.closingBalance],
    ['Default classification',draft.inputs.defaultCategory,other.inputs.defaultCategory],
    ['Source review note',draft.inputs.sourceReviewNote,other.inputs.sourceReviewNote],
    ['Valuation note',draft.inputs.valuationNote,other.inputs.valuationNote],
    ['Interpretation',draft.inputs.statementOptions||draft.inputs.format,other.inputs.statementOptions||other.inputs.format],
    ['Columns',draft.inputs.columns,other.inputs.columns],
    ['Selected setup edition',draft.inputs.statementSetup,other.inputs.statementSetup],
    ['Row decisions',(draft.inputs.decisions||[]).length,(other.inputs.decisions||[]).length],
    ['Unfinished invoice rows',Object.keys(draft.allocationWorks||{}).length,Object.keys(other.allocationWorks||{}).length],
    ['Retained request',draft.pending?.payload?.requestId||draft.accepted?.payload?.requestId||draft.setupPending?.payload?.requestId,selected.requestId]
  ].map(([label,before,after])=>({label,before:before??null,after:after??null,changed:!same(before??null,after??null)}));
  fields.find(row=>row.label==='Row decisions').changed=!same(draft.inputs.decisions||[],other.inputs.decisions||[]);
  fields.find(row=>row.label==='Unfinished invoice rows').changed=!same(draft.allocationWorks||{},other.allocationWorks||{});
  const details=[];
  const decisionsBefore=draft.inputs.decisions||[],decisionsAfter=other.inputs.decisions||[];
  for(let i=0;i<Math.max(decisionsBefore.length,decisionsAfter.length);i++){
    const before=decisionsBefore[i]??null,after=decisionsAfter[i]??null;
    if(!same(before,after))details.push({label:'Decision position '+(i+1)+' · original row '+(after?.rowNumber??before?.rowNumber??'unassigned'),before,after});
  }
  const allocationKeys=new Set([...Object.keys(draft.allocationWorks||{}),...Object.keys(other.allocationWorks||{})]);
  for(const key of allocationKeys){
    const before=draft.allocationWorks?.[key]??null,after=other.allocationWorks?.[key]??null;
    if(!same(before,after))details.push({label:'Unfinished supplier allocation · original row '+key,before,after});
  }
  const settings=input=>{const value=clone(input);delete value.decisions;if(value.source)delete value.source.contentBase64;return value;};
  if(!same(settings(draft.inputs),settings(other.inputs)))details.unshift({label:'Complete original interpretation and source metadata',before:settings(draft.inputs),after:settings(other.inputs)});
  return {edition:clone(edition),current:clone(draft),fields,details,sourceBytesMatch:same(draft.inputs.source?.contentBase64,other.inputs.source?.contentBase64)};

}
export function statementCopySearch(index,query='',page=0,pageSize=10) {
  indexValue(index,index.caseId);
  const terms=String(query).trim().toLocaleLowerCase('en-US').split(/\s+/).filter(Boolean);
  const rows=index.copies.filter(row=>{const value=[row.name,row.filename,row.accountId,row.accountLabel,row.currency,row.sourceFormat,row.note,row.requestId].join(' ').toLocaleLowerCase('en-US');return terms.every(term=>value.includes(term));}).sort((a,b)=>b.savedAt.localeCompare(a.savedAt)||a.id.localeCompare(b.id));
  const pages=Math.max(1,Math.ceil(rows.length/pageSize)),selected=Math.min(pages-1,Math.max(0,Math.floor(page)||0));
  return {rows:rows.slice(selected*pageSize,(selected+1)*pageSize),total:rows.length,page:selected,pages};
}

// Receives the already-opened Statements database; no second store or native writer.
export function createStatementCopyStore(database,caseId) {
  const prefix='statement-working-copies:'+caseId+':', indexKey=prefix+'index';
  const editionKey=(id,revision)=>prefix+id+':'+revision;
  async function transaction(mode,work) {
    const db=await database();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('drafts',mode), store=tx.objectStore('drafts');let result, failure;
      const fail=error=>{failure=error;try{tx.abort();}catch{}};
      const read=(key,callback)=>{const request=store.get(key);request.onsuccess=()=>{try{callback(request.result);}catch(error){fail(error);}};};
      tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(failure||tx.error||new Error('Could not save the working copies.'));
      tx.onabort=()=>reject(failure||tx.error||new Error('The working-copy change was not saved.'));
      try{work({store,read,set:value=>{result=value;},fail});}catch(error){fail(error);}
    });
  }
  const readIndex=()=>transaction('readonly',({read,set})=>read(indexKey,value=>set(indexValue(value||statementCopyIndex(caseId),caseId))));
  const readEdition=(id,revision)=>transaction('readonly',({read,set})=>read(editionKey(id,revision),value=>set(editionValue(value,caseId))));
  const save=input=>transaction('readwrite',({store,read,set})=>read(indexKey,value=>{
    const prepared=prepareStatementCopySave(value||statementCopyIndex(caseId),input);
    store.add(prepared.edition,editionKey(prepared.edition.id,prepared.edition.revision));store.put(prepared.index,indexKey);set(prepared);
  }));
  const exportArchive=()=>transaction('readonly',({read,set})=>read(indexKey,value=>{
    const index=indexValue(value||statementCopyIndex(caseId),caseId),editions=[];
    let remaining=index.copies.reduce((total,row)=>total+row.revision,0);
    const finish=()=>set(prepareStatementCopyArchive({schema:'sf47.statement-working-copy-archive.v1',caseId,index,editions:editions.sort((a,b)=>a.id.localeCompare(b.id)||a.revision-b.revision)},caseId));
    if(!remaining){finish();return;}
    for(const row of index.copies)for(let revision=1;revision<=row.revision;revision++)read(editionKey(row.id,revision),value=>{editions.push(editionValue(value,caseId));if(!--remaining)finish();});
  }));
  const importArchive=(archive,expectedRevision)=>{
    const incoming=prepareStatementCopyArchive(archive,caseId);
    return transaction('readwrite',({store,read,set})=>read(indexKey,value=>{
      const index=indexValue(value||statementCopyIndex(caseId),caseId),existing=[];let remaining=incoming.editions.length;
      const finish=()=>{const merged=mergeStatementCopyArchive(index,incoming,expectedRevision,existing);for(const edition of merged.additions)store.add(edition,editionKey(edition.id,edition.revision));store.put(merged.index,indexKey);set(merged);};
      if(!remaining){finish();return;}
      for(const edition of incoming.editions)read(editionKey(edition.id,edition.revision),value=>{if(value)existing.push(value);if(!--remaining)finish();});
    }));
  };
  return {readIndex,readEdition,save,exportArchive,importArchive};
}
export function statementCopiesPanel({index,query='',appliedQuery=query,page=0,name='',note='',activeId=null,review=null,selectedId='',selectedRevision=1,detailPage=0}) {
  const result=statementCopySearch(index,appliedQuery,page);
  const button=(label,action,attrs='')=>'<button type="button" data-statement-action="copies-'+action+'" data-statement-recovery="true" '+attrs+'>'+esc(label)+'</button>';
  const show=value=>typeof value==='object'&&value!==null?JSON.stringify(value):String(value??'—');
  const table='<div class="statement-table"><table><thead><tr><th>Name and original file</th><th>Account</th><th>Saved editions</th><th>Work</th><th>Open or download</th></tr></thead><tbody>'+result.rows.map(row=>'<tr><td><strong>'+esc(row.name)+'</strong>'+(row.id===activeId?' <span class="statement-status">Open copy</span>':'')+'<small>'+esc(row.filename)+'</small><small>'+esc(row.note)+'</small></td><td>'+esc(row.accountLabel||row.accountId)+'<small>'+esc(row.accountId)+' · '+esc(row.currency)+' · '+esc(row.sourceFormat)+'</small></td><td>'+row.revision+'<small>'+esc(row.savedAt)+'</small></td><td>'+row.decisions+' decisions · '+row.allocations+' unfinished invoice rows<small>'+esc(row.status==='PENDING'?'Original request pending':row.status==='READBACK'?'Original response awaiting readback':'Editable')+'</small></td><td>'+button('Choose edition','select','data-copy-id="'+esc(row.id)+'"')+'</td></tr>').join('')+'</tbody></table></div>';
  const selected=index.copies.find(row=>row.id===selectedId);
  const selection=selected?'<div class="statement-copy-selection"><h5>'+esc(selected.name)+'</h5><label>Saved edition<input name="copyEdition" data-statement-recovery="true" type="number" min="1" max="'+selected.revision+'" step="1" value="'+esc(selectedRevision)+'"></label><p>Choose any complete edition from 1 through '+selected.revision+'.</p><div class="statement-actions">'+button('Review before opening','review')+button('Download selected recovery copy','download')+'</div></div>':'';
  const detailPages=Math.max(1,Math.ceil((review?.details?.length||0)/10)),selectedDetailPage=Math.min(detailPages-1,Math.max(0,Math.floor(detailPage)||0));
  const comparisonDetails=review?'<div class="statement-copy-details"><h5>Complete changed records</h5><p>'+review.details.length+' changed record or interpretation entries. Counts above are followed by each original before/after value here.</p>'+review.details.slice(selectedDetailPage*10,(selectedDetailPage+1)*10).map(row=>'<details><summary>'+esc(row.label)+'</summary><h5>Current</h5><pre>'+esc(JSON.stringify(row.before,null,2))+'</pre><h5>Selected edition</h5><pre>'+esc(JSON.stringify(row.after,null,2))+'</pre></details>').join('')+'<div class="statement-actions">'+button('Previous changed records','details-previous',selectedDetailPage?'':'disabled data-statement-fixed="true"')+'<span>Changed records page '+(selectedDetailPage+1)+' of '+detailPages+'</span>'+button('Next changed records','details-next',selectedDetailPage+1<detailPages?'':'disabled data-statement-fixed="true"')+'</div></div>':'';
  const comparison=review?'<section class="statement-copy-comparison"><h5>Open '+esc(review.edition.name)+' · edition '+review.edition.revision+'</h5><p>The complete current work will be saved before this copy opens. Its original file bytes '+(review.sourceBytesMatch?'match':'differ from')+' the current file. Opening requires a fresh native preview; a retained original request keeps its exact request ID and payload.</p><div class="statement-table"><table><thead><tr><th>Choice</th><th>Current</th><th>Selected edition</th></tr></thead><tbody>'+review.fields.map(row=>'<tr><th>'+esc(row.label)+(row.changed?' · changed':'')+'</th><td>'+esc(show(row.before))+'</td><td>'+esc(show(row.after))+'</td></tr>').join('')+'</tbody></table></div>'+comparisonDetails+'<div class="statement-actions">'+button('Preserve current work and open this edition','open')+button('Close opening review','cancel')+'</div></section>':'';
  return '<details class="statement-panel statement-copies" open><summary>Statement working copies</summary><p>Keep separate banks, accounts and periods here. Every saved edition contains its complete original file and unfinished work. Copies belong to this case and the current operator in this browser.</p><div class="statement-fields"><label>Copy name<input name="copyName" data-statement-recovery="true" maxlength="160" value="'+esc(name)+'" placeholder="Operating account · October"></label><label class="statement-wide">Edition note<input name="copyNote" data-statement-recovery="true" maxlength="2000" value="'+esc(note)+'" placeholder="What is ready and what remains to review"></label></div><div class="statement-actions">'+button('Save as a new copy','new')+button('Save next edition','save',activeId?'':'disabled data-statement-fixed="true"')+button('Refresh saved copies','refresh')+button('Download all complete copies','export')+button('Import complete copy archive','import')+'</div><div class="statement-review-controls"><label>Find copies<input name="copyQuery" data-statement-recovery="true" value="'+esc(query)+'" placeholder="Account, period, file or note"></label>'+button('Find copies','filter')+'<span>'+result.total+' matching copies</span></div>'+(result.total?table:'<p class="statement-empty">No saved copies match. Save the current complete statement or import its original copy archive.</p>')+'<div class="statement-actions">'+button('Previous copies','previous',result.page?'':'disabled data-statement-fixed="true"')+'<span>Page '+(result.page+1)+' of '+result.pages+'</span>'+button('Next copies','next',result.page+1<result.pages?'':'disabled data-statement-fixed="true"')+'</div>'+selection+comparison+'</details>';
}
