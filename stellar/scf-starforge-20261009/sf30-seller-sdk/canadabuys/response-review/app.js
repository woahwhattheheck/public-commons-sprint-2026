/* Complete hosted and offline response review. Native mutations remain in the existing bidder writer. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const model = window.CanadaBuysResponseReview;
  const offline = !!window.CANADABUYS_RESPONSE_TRANSFER;
  const state = { transfer:null, host:null, master:null, comparison:null, incoming:null, choices:{}, recordId:null, recordRevision:null, pending:null, receipt:null, dirty:false, busy:0, local:null, editGeneration:0 };
  const MAX_FILE = 64 * 1024 * 1024;
  const localKey = 'canadabuys.response-review.working.v1';
  const pendingKey = 'canadabuys.response-review.pending.v1';
  let localTimer;const lockedControls=new Map();
  function lockControls(){for(const element of document.querySelectorAll('button,input,select,textarea')){if(!lockedControls.has(element))lockedControls.set(element,element.disabled);element.disabled=true;}}
  function unlockControls(){for(const [element,disabled]of lockedControls)if(element.isConnected)element.disabled=disabled;lockedControls.clear();}
  function node(tag, text, className) { const n=document.createElement(tag); if(text!==undefined)n.textContent=String(text); if(className)n.className=className; return n; }
  function clear(el) { el.replaceChildren(); }
  function pretty(value) { return value===undefined ? '(absent)' : typeof value==='string' ? value : JSON.stringify(value,null,2); }
  function safeName(value) { return String(value||'response').replace(/[^a-zA-Z0-9._-]+/g,'-').slice(0,140)||'response'; }
  function commandId() { return 'response-review-'+crypto.randomUUID(); }
  function describe(error) { return [error.code,error.message||String(error),error.details?pretty(error.details):''].filter(Boolean).join('\n'); }
  function notice(message,error=false) { const el=$('notice');el.hidden=!message;el.textContent=message||'';el.className='notice'+(error?' error':''); }
  function displayError(error) { notice(describe(error),true); }
  function date(value) { if(!value)return '';const d=new Date(value);return Number.isNaN(d.getTime())?String(value):d.toLocaleString(); }
  function byteText(n) { return Number(n).toLocaleString()+' bytes'; }
  function download(name,content,mime='application/json') {
    const blob=content instanceof Blob?content:new Blob([content],{type:mime});
    const url=URL.createObjectURL(blob), a=node('a');a.href=url;a.download=String(name);document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  function decodeBase64(base64) { const raw=atob(base64), bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes; }
  function encodeBase64(bytes) { let raw='';for(let offset=0;offset<bytes.length;offset+=32768)raw+=String.fromCharCode(...bytes.subarray(offset,offset+32768));return btoa(raw); }
  async function readJSON(file) {
    if(!file)throw new Error('Choose a JSON file.');
    if(file.size>MAX_FILE)throw new Error('This working file exceeds the 64 MiB receiving limit.');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
    try{return JSON.parse(text);}catch(error){throw new Error('The selected file is not complete valid UTF-8 JSON: '+error.message);}
  }
  function author() { return {name:$('author-name').value,organization:$('author-organization').value,role:$('author-role').value}; }
  function syncAuthor() {
    if(!state.transfer)return;
    state.transfer.draft.author=author();state.transfer.draft.note=$('edition-note').value;
  }
  function showDetail(title,value) { $('detail-title').textContent=title;clear($('detail-body'));$('detail-body').append(tree(value));$('detail-dialog').showModal(); }
  function tree(value,name) {
    if(value===null||typeof value!=='object') {
      const out=node('div');
      if(typeof value==='string'&&/^https?:\/\/\S+$/i.test(value)) { const a=node('a',value);a.href=value;a.target='_blank';a.rel='noopener noreferrer';out.append(a); }
      else out.append(node('pre',pretty(value)));
      return out;
    }
    const details=node('details');details.append(node('summary',(name?name+' · ':'')+(Array.isArray(value)?value.length+' items':Object.keys(value).length+' fields')));
    let built=false;details.addEventListener('toggle',()=>{if(!details.open||built)return;built=true;const body=node('div');for(const [key,item] of Object.entries(value)){const section=node('div');section.append(node('h4',Array.isArray(value)?'Item '+(Number(key)+1):key));section.append(tree(item));body.append(section);}details.append(body);});
    return details;
  }
  async function request(path,options={}) {
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),90000);
    try {
      const response=await fetch('/api/response-review'+path,{...options,headers:{'content-type':'application/json',...(options.headers||{})},signal:controller.signal,cache:'no-store'});
      const text=await response.text();let data;
      try{data=text?JSON.parse(text):{};}catch{throw new Error('The native response was not complete JSON (HTTP '+response.status+').');}
      if(!response.ok){const detail=data.error||data;const error=new Error(detail.message||data.message||('Native request failed (HTTP '+response.status+').'));error.code=typeof detail==='string'?detail:detail.code||data.code;error.details=detail.details||data.details;error.native=data;error.httpStatus=response.status;throw error;}
      return data;
    } finally {clearTimeout(timer);}
  }
  async function run(button,fn) {
    if(button?.disabled||state.busy)return;
    state.busy++;document.body.classList.add('busy');lockControls();
    try{await fn();}catch(error){displayError(error);}finally{state.busy--;if(!state.busy){document.body.classList.remove('busy');unlockControls();}updateButtons();}
  }
  function bind(id,fn) { $(id).addEventListener('click',()=>run($(id),fn)); }
  function updateButtons() {
    $('prepare-response').disabled=offline||!state.master||!$('workshare-select').value||!!state.pending||!state.host;
    $('open-record').disabled=!$('record-select').value;
    $('checkpoint').disabled=!state.transfer||!$('author-name').value.trim();
    $('download-editor').disabled=offline||!state.recordId||!state.recordRevision;
    $('apply-return').disabled=!state.comparison||!!state.pending||state.comparison.comparison.returnReady===false;
    $('retry-request').disabled=!state.pending;
    if(state.busy)lockControls();
  }
  function setDirty() {
    if(!state.transfer)return;
    state.editGeneration++;state.dirty=true;$('draft-state').textContent='Unfinished changes';syncAuthor();clearTimeout(localTimer);
    localTimer=setTimeout(()=>saveLocal().catch(displayError),600);updateButtons();
  }
  async function saveLocal() {
    if(!state.transfer)return;syncAuthor();
    const selected=state.transfer,generation=state.editGeneration;const text=await model.serialize(selected);
    if(state.transfer!==selected||state.editGeneration!==generation)return;
    try{localStorage.setItem(localKey,JSON.stringify({savedAt:new Date().toISOString(),transfer:JSON.parse(text),dirty:state.dirty}));}
    catch(error){$('save-description').textContent='Local browser saving is unavailable or full. Use Download unfinished draft to retain the complete working file.';}
  }
  function storePending(value) {
    if(value&&(!['/prepare','/apply'].includes(value.path)||value.schema!=='starforge.canadabuys.response-review-request.v1'||!value.body||typeof value.body.commandId!=='string'||typeof value.body.workspaceId!=='string'||!Number.isInteger(value.body.expectedRevision)))throw new Error('The saved native request has an invalid original operation binding.');
    state.pending=value;$('pending').hidden=!value;
    if(value){$('pending-description').textContent=value.kind+' · '+value.body.commandId+'\nWorkspace '+value.body.workspaceId+' · reviewed revision '+value.body.expectedRevision;try{localStorage.setItem(pendingKey,JSON.stringify(value));}catch{notice('The complete request is retained in this page, but browser storage is unavailable. Download the retained request before leaving.',true);}}
    else{try{localStorage.removeItem(pendingKey);}catch{}}
    $('review-refusal').hidden=!value?.refusal;
    updateButtons();
  }
  function nativeWorkspace(workspace) {
    if(!workspace)throw new Error('The native response did not include its workspace identity.');
    const w=workspace.workspace||workspace;const id=w.id||workspace.id;const revision=workspace.revision??w.revision;
    if(typeof id!=='string'||!Number.isInteger(revision))throw new Error('The native workspace identity or revision is missing.');
    return {id,revision,title:w.title||workspace.title||''};
  }
  async function refreshHost() {
    const result=await request('/status');const identity=nativeWorkspace(result.workspace);
    if(state.host&&state.host.identity.id!==identity.id)throw new Error('The connected native workspace changed. The saved request and original response are retained.');
    state.host={...result,identity};$('connection').textContent=identity.title+' · '+identity.id;
    $('workspace-identity').textContent='Workspace '+identity.id+'\nRevision '+identity.revision;
    const previous=$('record-select').value;clear($('record-select'));$('record-select').append(new Option('Choose a saved response',''));
    for(const record of result.records||[]) {const option=new Option((record.title||record.id)+' · revision '+record.revision,record.id);option.dataset.revision=record.revision;$('record-select').append(option);}
    if([...$('record-select').options].some(o=>o.value===previous))$('record-select').value=previous;
    const workshare=$('workshare-select').value;clear($('workshare-select'));$('workshare-select').append(new Option('Choose a saved workshare',''));
    for(const item of (result.workshares||[]).filter(item=>!state.master?.binding?.noticeId||item.noticeId===state.master.binding.noticeId)) {const fee=Number.isSafeInteger(item.feeCents)?new Intl.NumberFormat(undefined,{style:'currency',currency:item.currency||'CAD'}).format(item.feeCents/100):'Fee not supplied';const option=new Option([item.title||item.id,item.partner||'',fee,'revision '+item.revision].filter(Boolean).join(' · '),item.id);option.dataset.noticeId=item.noticeId||'';$('workshare-select').append(option);}
    if([...$('workshare-select').options].some(o=>o.value===workshare))$('workshare-select').value=workshare;
    updateButtons();
  }
  async function loadTransfer(input,{native=false,dirty=false}={}) {
    const validated=await model.validateTransfer(input);
    if(!offline&&state.host&&validated.base.workspaceId!==state.host.identity.id)throw new Error('This working file belongs to another native workspace. Open it in its standalone editor to review it.');
    state.editGeneration++;state.transfer=validated;state.dirty=dirty;
    state.comparison=null;state.incoming=null;state.choices={};$('comparison').hidden=true;$('return-file').value='';$('return-summary').textContent='Choose a complete returned working file to compare with this selected original response.';
    const base=state.transfer.base,record=base.record;
    if(native||!offline){state.recordId=record.id;state.recordRevision=record.revision;}
    $('working').hidden=false;$('response-title').textContent=base.document.title||'Working response';
    $('response-identity').textContent='Original workspace '+base.workspaceId+'\nResponse '+record.id+' · baseline revision '+record.revision+'\nTransfer '+state.transfer.transferId;
    const a=state.transfer.draft.author||{};$('author-name').value=a.name||'';$('author-organization').value=a.organization||'';$('author-role').value=a.role||'';$('edition-note').value=state.transfer.draft.note||'';
    $('draft-state').textContent=dirty?'Unfinished changes':'Saved working file';renderSource();renderItems('answers');renderItems('annexes');renderAttachments();renderHistory();updateButtons();
  }
  function renderSource() {
    clear($('source-summary'));clear($('original-source'));
    const original=state.transfer.base.document;
    for(const key of ['name','organization','role','notes'])$('respondent-'+key).value=state.transfer.draft.content.respondent[key];
    $('source-summary').append(node('p','Original response '+original.id+' · '+(original.title||'')));
    $('original-source').append(tree(original.binding,'Original source binding'),tree(original.master,'Complete original response master'),tree(original.workshare,'Complete original saved workshare'),tree(original.content,'Original response content'),tree(original.merges||[],'Original receiving history'));
    const button=node('button','Download complete original response');button.addEventListener('click',()=>download(safeName(original.title)+'.original.json',JSON.stringify(original,null,2)));$('original-source').append(button);
  }
  function searchText(item) { return JSON.stringify(item).toLowerCase(); }
  function itemLabel(item,index) { return item.title||item.id||'Item '+(index+1); }
  function findOriginal(kind,id) {return state.transfer.base.document.content?.[kind]?.find(item=>item.id===id);}
  function renderItems(kind) {
    const container=$(kind);clear(container);const items=state.transfer.draft.content[kind]||[];
    $(kind==='answers'?'answer-count':'annex-count').textContent=String(items.length);
    const filter=$(kind==='answers'?'answer-filter':'annex-filter').value.toLowerCase();let shown=0;
    items.forEach((item,index)=>{
      if(filter&&!searchText(item).includes(filter))return;shown++;
      const card=node('article',undefined,'review-item');card.dataset.itemId=item.id;card.dataset.kind=kind;
      const originalAnswer=kind==='answers'?state.transfer.base.document.master.responses.find(answer=>answer.id===item.id):null;
      card.append(node('h3',originalAnswer?.title||itemLabel(item,index)),node('div',item.id,'item-id'));
      if(originalAnswer){const context=node('details');context.append(node('summary','Original source requirement and workshare scope'),tree(originalAnswer));card.append(context);}
      const original=findOriginal(kind,item.id);if(original){const details=node('details');details.append(node('summary','Original saved text'),node('div',original.text||'', 'original'));card.append(details);}
      const textLabel=node('label',kind==='answers'?'Response text':'Section text'),textArea=node('textarea');textArea.value=item.text||'';textArea.rows=10;textArea.dataset.field='text';textLabel.append(textArea);card.append(textLabel);
      textArea.addEventListener('input',()=>{item.text=textArea.value;if(item.status!=='UNREVIEWED'){item.status='UNREVIEWED';status.value='UNREVIEWED';item.reviewer='';item.reviewedAt=null;line.textContent='Edited text needs a current attributed review.';}setDirty();});
      const commentLabel=node('label','Review comment'),comment=node('textarea');comment.rows=3;comment.value=item.comment||'';comment.dataset.field='comment';commentLabel.append(comment);card.append(commentLabel);
      comment.addEventListener('input',()=>{item.comment=comment.value;setDirty();});
      const controls=node('div',undefined,'review-controls'),statusLabel=node('label','Supplier review status'),status=node('select');status.dataset.field='status';
      for(const value of ['UNREVIEWED','PROPOSED','CONFIRMED','NEEDS_WORK'])status.append(new Option(value.replaceAll('_',' '),value));status.value=item.status||'UNREVIEWED';statusLabel.append(status);controls.append(statusLabel);
      const line=node('p',[item.reviewer,date(item.reviewedAt)].filter(Boolean).join(' · ')||'No attributed review saved.', 'status-line');
      status.addEventListener('change',()=>{if(status.value!=='UNREVIEWED'&&!$('author-name').value.trim()){status.value=item.status;notice('Enter your author name before recording an attributed supplier review.',true);return;}item.status=status.value;item.reviewer=status.value==='UNREVIEWED'?'':$('author-name').value;item.reviewedAt=status.value==='UNREVIEWED'?null:new Date().toISOString();line.textContent=[item.reviewer||'No attributed review saved.',date(item.reviewedAt)].join(' · ');setDirty();});
      controls.append(line);card.append(controls);
      const evidence=node('details');evidence.append(node('summary','Selected evidence attachments'));
      const checks=node('div',undefined,'attachment-evidence');
      for(const attachment of state.transfer.attachments||[]){const label=node('label'),check=node('input');check.type='checkbox';check.value=attachment.id;check.checked=(item.evidenceIds||[]).includes(attachment.id);label.append(check,document.createTextNode(attachment.name));checks.append(label);check.addEventListener('change',()=>{const ids=new Set(item.evidenceIds||[]);if(check.checked)ids.add(attachment.id);else ids.delete(attachment.id);item.evidenceIds=[...ids];if(item.status!=='UNREVIEWED'){item.status='UNREVIEWED';status.value='UNREVIEWED';item.reviewer='';item.reviewedAt=null;line.textContent='Changed evidence needs a current attributed review.';}setDirty();});}
      if(!(state.transfer.attachments||[]).length)checks.append(node('p','Add complete files in Attachments to reference them here.','small'));evidence.append(checks);card.append(evidence);container.append(card);
    });
    if(!shown)container.append(node('p',items.length?'No items match this filter.':'This response has no '+kind+'.','empty'));
  }
  function renderAttachments() {
    const container=$('attachments');clear(container);const attachments=state.transfer.attachments||[];$('attachment-count').textContent=String(attachments.length);
    const total=attachments.reduce((sum,item)=>sum+item.bytes,0);container.append(node('p',attachments.length+' complete files · '+byteText(total),'small'));
    if(!attachments.length)container.append(node('p','No attachments selected.','empty'));
    for(const item of attachments){
      const card=node('article',undefined,'attachment-card');card.append(node('h3',item.name),node('p',item.mime+' · '+byteText(item.bytes)),node('div',item.sha256,'item-id'));
      if(item.description)card.append(node('p',item.description));if(item.addedBy)card.append(node('p','Added by '+(typeof item.addedBy==='string'?item.addedBy:pretty(item.addedBy)),'small'));
      const actions=node('div',undefined,'actions'),button=node('button','Download original file');button.dataset.downloadAttachment=item.id;button.addEventListener('click',()=>download(item.name,new Blob([decodeBase64(item.base64)],{type:item.mime||'application/octet-stream'})));actions.append(button);
      if(/^text\/|json|xml|csv|javascript/.test(item.mime||'')){const preview=node('button','View complete text');preview.addEventListener('click',()=>{try{showDetail(item.name,new TextDecoder('utf-8',{fatal:true}).decode(decodeBase64(item.base64)));}catch(error){displayError(error);}});actions.append(preview);}
      card.append(actions);container.append(card);
    }
  }
  function renderHistory() {
    const container=$('editions');clear(container);const editions=state.transfer.editions||[];$('edition-count').textContent=String(editions.length);
    if(!editions.length)container.append(node('p','This working file has no attributed edition yet.','empty'));
    for(const edition of [...editions].reverse()){const card=node('article',undefined,'edition-card');card.append(node('h3','Edition '+edition.revision),node('p',[date(edition.at),edition.author?.name,edition.author?.organization,edition.author?.role].filter(Boolean).join(' · ')),node('p',edition.note||'No edition note'),node('div',edition.sha256,'item-id'));const button=node('button','Open complete saved edition');button.addEventListener('click',()=>showDetail('Saved edition '+edition.revision,edition));card.append(button);container.append(card);}
  }
  function showTab(name) {for(const button of document.querySelectorAll('[data-tab]'))button.setAttribute('aria-selected',String(button.dataset.tab===name));for(const panel of document.querySelectorAll('.tab-panel'))panel.hidden=panel.id!=='tab-'+name;}
  function requiredRows() {return (state.comparison?.comparison?.rows||[]).filter(row=>row.status==='RETURN_ONLY'||row.status==='CONFLICT');}
  function renderComparison() {
    const result=state.comparison;clear($('comparison-rows'));clear($('context-changes'));$('comparison').hidden=false;
    $('comparison-context').textContent='Response '+result.current.record.id+' · current revision '+result.current.record.revision+'\nReview '+result.comparison.reviewSha256;
    if(result.comparison.returnReady===false)$('context-changes').append(node('p','This is an unfinished returned draft. Preserve it and ask its author to save a complete attributed edition in the standalone editor before native receiving.','notice'));
    for(const [field,title] of [['changedSource','Original source changed'],['changedWorkshare','Saved workshare changed']]) {const change=result.comparison[field];if(change){const box=node('div',undefined,'context-card');box.append(node('strong',title),tree(change));$('context-changes').append(box);}}
    $('source-ack-field').hidden=!result.comparison.changedSource;$('workshare-ack-field').hidden=!result.comparison.changedWorkshare;
    for(const row of result.comparison.rows||[]){
      if(row.status==='UNCHANGED')continue;
      const card=node('article',undefined,'compare-row');card.dataset.path=row.path;card.append(node('h3',row.label||row.path),node('div',row.section+' · '+row.status+' · '+row.path,'item-id'));
      const values=node('div',undefined,'compare-values');for(const [key,label] of [['baseline','Original baseline'],['current','Current native value'],['returned','Returned supplier value']]){const value=node('div',undefined,'compare-value');value.append(node('div',label,'field-label'),node('pre',pretty(row[key])));values.append(value);}card.append(values);
      if(row.status==='RETURN_ONLY'||row.status==='CONFLICT'){
        const label=node('label','Select the value to retain'),select=node('select');select.className='compare-select';select.dataset.choicePath=row.path;select.append(new Option('Choose explicitly',''),new Option('Retain current native value','current'),new Option('Adopt returned supplier value','returned'));select.value=state.choices[row.path]||'';label.append(select);card.append(label);select.addEventListener('change',()=>{if(select.value)state.choices[row.path]=select.value;else delete state.choices[row.path];updateChoices();});
      }else card.append(node('p',row.status==='SAME'?'Both sides contain the same value.':'The current native value is retained.','small'));
      $('comparison-rows').append(card);
    }
    if(!(result.comparison.rows||[]).some(row=>row.status!=='UNCHANGED'))$('comparison-rows').append(node('p','The returned content matches the saved baseline and current response. The complete original return can still be retained.','empty'));
    updateChoices();
  }
  function updateChoices() {const needed=requiredRows();$('choice-count').textContent=needed.filter(row=>state.choices[row.path]).length+' of '+needed.length+' required field choices selected.';}
  async function compareReturn(input) {
    if(!state.recordId)throw new Error('Open the original saved native response before receiving its supplier return.');
    await model.validateTransfer(input);
    if(input.base.workspaceId!==state.host.identity.id||input.base.record.id!==state.recordId)throw new Error('The returned file does not belong to the selected original workspace and response.');
    const result=await request('/compare',{method:'POST',body:JSON.stringify({transfer:input,recordId:state.recordId})});
    if(nativeWorkspace(result.workspace).id!==state.host.identity.id)throw new Error('The comparison belongs to a different workspace.');
    state.incoming=structuredClone(input);state.comparison=result;state.choices={};$('return-summary').textContent='Returned transfer '+input.transferId+' · '+(input.editions||[]).length+' attributed editions';renderComparison();updateButtons();
  }
  function presentReceipt(result) {
    state.receipt=result;$('receipt').hidden=false;clear($('receipt-content'));
    $('receipt-content').append(node('p','Response '+result.record.id+' · saved revision '+result.record.revision),tree(result,'Complete original native receiving result'));
  }
  async function performPending() {
    const pending=state.pending;if(!pending)throw new Error('There is no saved native request.');
    if(!state.host||state.host.identity.id!==pending.body.workspaceId)throw new Error('Reconnect the original workspace before continuing this exact request.');
    let result;try{result=await request(pending.path,{method:'POST',body:JSON.stringify(pending.body)});}catch(error){if([400,401,403,404,409,413,422].includes(error.httpStatus)){storePending({...pending,refusal:{httpStatus:error.httpStatus,result:error.native,at:new Date().toISOString()}});}throw error;}
    if(nativeWorkspace(result.workspace).id!==pending.body.workspaceId)throw new Error('Native result workspace does not match the retained original request.');
    presentReceipt(result);storePending(null);await refreshHost();
    if(result.record){state.recordId=result.record.id;state.recordRevision=result.record.revision;await openRecord(result.record.id,result.record.revision);}
    if(pending.kind==='Apply supplier return'){state.comparison=null;$('comparison').hidden=true;}
    notice('The complete native response is saved. Its original result is available below.');
  }
  async function openRecord(id,revision) {
    const result=await request('/records/'+encodeURIComponent(id)+'?revision='+encodeURIComponent(revision));
    const identity=nativeWorkspace(result.workspace);if(state.host&&identity.id!==state.host.identity.id)throw new Error('The response returned from a different workspace.');
    if(result.record.id!==id||result.record.revision!==Number(revision))throw new Error('The native response did not match the selected immutable edition.');
    const transfer=await request('/records/'+encodeURIComponent(id)+'/export?revision='+encodeURIComponent(revision));
    if(transfer.base.record.id!==id||transfer.base.record.revision!==Number(revision))throw new Error('The exported working file did not match the selected response edition.');
    await loadTransfer(transfer,{native:true});$('record-select').value=id;$('record-revision').value=revision;await saveLocal();
  }
  async function prepare() {
    if(state.pending)throw new Error('Continue the retained native request before preparing another response.');
    const identity=state.host.identity;const body={master:structuredClone(state.master),workshareId:$('workshare-select').value,title:$('prepare-title').value,commandId:commandId(),expectedRevision:identity.revision,workspaceId:identity.id};
    if(!body.workshareId||!body.title.trim())throw new Error('Select a saved workshare and enter a response title.');
    storePending({schema:'starforge.canadabuys.response-review-request.v1',kind:'Prepare response',path:'/prepare',body,createdAt:new Date().toISOString()});await performPending();
  }
  async function applyReturn() {
    if(state.pending)throw new Error('Continue the retained original native request.');
    for(const row of requiredRows())if(!state.choices[row.path])throw new Error('Choose current or returned for every required field.');
    const review=state.comparison,identity=nativeWorkspace(review.workspace),reviewer=$('host-reviewer').value;
    if(!reviewer.trim())throw new Error('Name the host reviewer.');
    const acknowledgement={source:$('source-ack').value,workshare:$('workshare-ack').value};
    if(review.comparison.changedSource&&!acknowledgement.source.trim())throw new Error('Describe your acknowledgement of the changed original source.');
    if(review.comparison.changedWorkshare&&!acknowledgement.workshare.trim())throw new Error('Describe your acknowledgement of the changed workshare.');
    const body={transfer:structuredClone(state.incoming),recordId:review.current.record.id,reviewSha256:review.comparison.reviewSha256,choices:{...state.choices},acknowledgement,reviewer,note:$('receiving-note').value,commandId:commandId(),expectedRevision:identity.revision,workspaceId:identity.id};
    storePending({schema:'starforge.canadabuys.response-review-request.v1',kind:'Apply supplier return',path:'/apply',body,createdAt:new Date().toISOString()});await performPending();
  }
  async function saveDraft(checkpoint) {
    if(!state.transfer)throw new Error('Open a complete working response.');syncAuthor();
    if(checkpoint){if(!author().name.trim())throw new Error('Name the author of this edition.');state.transfer=await model.checkpoint(state.transfer,{author:author(),note:$('edition-note').value,at:new Date().toISOString()});}
    const serialized=await model.serialize(state.transfer);download(safeName(state.transfer.base.document.title)+(checkpoint?'.edition-':'.unfinished-')+(state.transfer.editions?.length||0)+'.json',serialized);
    state.dirty=false;if(checkpoint){$('draft-state').textContent='Attributed edition saved';renderHistory();}else $('draft-state').textContent='Unfinished draft downloaded';await saveLocal();notice(checkpoint?'The complete attributed edition was downloaded.':'The complete unfinished draft was downloaded.');
  }
  async function addAttachments() {
    if(!state.transfer)throw new Error('Open a working response first.');
    const files=[...$('attachment-files').files];if(!files.length)throw new Error('Choose one or more original files.');
    const before=(state.transfer.attachments||[]).reduce((sum,item)=>sum+item.bytes,0);
    if(files.some(file=>file.size>8*1024*1024)||before+files.reduce((sum,file)=>sum+file.size,0)>16*1024*1024)throw new Error('Attachments exceed 8 MiB per file or 16 MiB total. The original working response is unchanged.');
    let next=state.transfer;
    for(const file of files){const bytes=new Uint8Array(await file.arrayBuffer());next=await model.attach(next,{name:file.name,mime:file.type||'application/octet-stream',base64:encodeBase64(bytes),description:$('attachment-description').value,addedBy:author().name});}
    state.transfer=next;$('attachment-files').value='';renderAttachments();renderItems('answers');renderItems('annexes');setDirty();notice('Complete original files are retained in the working response.');
  }
  function localRecovery() {
    try{
      const text=localStorage.getItem(localKey);if(text){const saved=JSON.parse(text);state.local=saved;$('recovery').hidden=false;$('recovery-description').textContent=(saved.transfer?.base?.document?.title||'Response')+' · '+date(saved.savedAt)+(saved.dirty?' · unfinished changes':'');}
      if(!offline){const pending=localStorage.getItem(pendingKey);if(pending)storePending(JSON.parse(pending));}
    }catch(error){notice('Browser saved work could not be read. Original downloaded working files can still be opened.',true);}
  }
  async function start() {
    if(!model)throw new Error('The complete response-review model is missing from this edition.');
    $('host-controls').hidden=offline;for(const item of document.querySelectorAll('.host-only'))item.hidden=offline;
    if(offline){$('host-link').removeAttribute('href');$('connection').textContent='Standalone supplier working copy';$('mode-note').textContent='Review the complete original response, save your attributed changes and return the working JSON to the sender.';await loadTransfer(window.CANADABUYS_RESPONSE_TRANSFER);}
    else {try{await refreshHost();}catch(error){displayError(error);}}
    localRecovery();
    if(state.pending&&!offline&&state.host&&state.pending.body.workspaceId!==state.host.identity.id)notice('A retained request belongs to another original workspace. Download it and reopen that workspace; it will not be sent here.',true);
    updateButtons();
  }
  bind('prepare-response',prepare);bind('refresh-host',refreshHost);
  bind('open-record',async()=>{const option=$('record-select').selectedOptions[0];const revision=Number($('record-revision').value||option.dataset.revision);if(!Number.isSafeInteger(revision)||revision<1)throw new Error('Select a positive saved response revision.');await openRecord(option.value,revision);notice('Opened the complete selected native response edition.');});
  bind('save-draft',()=>saveDraft(false));bind('checkpoint',()=>saveDraft(true));bind('add-attachments',addAttachments);bind('apply-return',applyReturn);bind('retry-request',performPending);
  bind('download-request',async()=>download('response-review-retained-request.json',JSON.stringify(state.pending,null,2)));
  bind('review-refusal',async()=>{if(!state.pending?.refusal)throw new Error('The retained request has no definitive native refusal.');download('response-review-refused-request.json',JSON.stringify(state.pending,null,2));storePending(null);if(state.incoming&&state.recordId)await compareReturn(state.incoming);else await refreshHost();notice('The exact refused request and native result were downloaded. Review the current native context before preparing another request.');});
  bind('download-receipt',async()=>download('response-review-native-result.json',JSON.stringify(state.receipt,null,2)));
  bind('download-comparison',async()=>download('response-review-comparison.json',JSON.stringify({comparison:state.comparison,choices:state.choices},null,2)));
  bind('reopen-result',async()=>openRecord(state.receipt.record.id,state.receipt.record.revision));
  bind('download-editor',async()=>{
    const response=await fetch('/api/response-review/records/'+encodeURIComponent(state.recordId)+'/editor?revision='+encodeURIComponent(state.recordRevision),{cache:'no-store'});
    if(!response.ok)throw new Error('Standalone editor download failed (HTTP '+response.status+').');
    download(safeName(state.transfer.base.document.title)+'.review.html',await response.blob(),'text/html');
  });
  bind('recover-local',async()=>{await loadTransfer(state.local.transfer,{dirty:state.local.dirty});$('recovery').hidden=true;notice('Opened the complete saved local draft.');});
  bind('download-local',async()=>download('response-review-local-draft.json',JSON.stringify(state.local.transfer,null,2)));
  bind('dismiss-local',async()=>{$('recovery').hidden=true;});
  for(const [id,field] of [['choose-current','current'],['choose-returned','returned']])bind(id,async()=>{for(const row of requiredRows())if(!state.choices[row.path])state.choices[row.path]=field;renderComparison();});
  $('close-detail').addEventListener('click',()=>$('detail-dialog').close());
  for(const button of document.querySelectorAll('[data-tab]'))button.addEventListener('click',()=>showTab(button.dataset.tab));
  for(const id of ['author-name','author-organization','author-role','edition-note'])$(id).addEventListener('input',setDirty);
  $('answer-filter').addEventListener('input',()=>{if(state.transfer)renderItems('answers');});$('annex-filter').addEventListener('input',()=>{if(state.transfer)renderItems('annexes');});
  for(const key of ['name','organization','role','notes'])$('respondent-'+key).addEventListener('input',()=>{if(state.transfer){state.transfer.draft.content.respondent[key]=$('respondent-'+key).value;setDirty();}});
  $('record-select').addEventListener('change',()=>{$('record-revision').value=$('record-select').selectedOptions[0]?.dataset.revision||'';updateButtons();});$('workshare-select').addEventListener('change',updateButtons);
  $('master-file').addEventListener('change',()=>run(null,async()=>{state.master=await readJSON($('master-file').files[0]);$('master-summary').textContent='Complete source loaded: '+$('master-file').files[0].name+' · '+byteText($('master-file').files[0].size);if(!$('prepare-title').value)$('prepare-title').value=state.master.title||'Supplier response review';await refreshHost();updateButtons();}));
  $('working-file').addEventListener('change',()=>run(null,async()=>{await loadTransfer(await readJSON($('working-file').files[0]));await saveLocal();notice('Opened the complete working file.');}));
  $('return-file').addEventListener('change',()=>run(null,async()=>compareReturn(await readJSON($('return-file').files[0]))));
  window.addEventListener('beforeunload',event=>{if(state.dirty||state.pending){event.preventDefault();event.returnValue='';}});
  window.addEventListener('storage',event=>{if(event.key===localKey&&event.newValue)notice('Another page saved working response data. Your current editor is still retained here. Download your full draft before switching copies.',true);});
  run(null,start);
})();
