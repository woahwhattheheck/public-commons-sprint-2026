// MIT. Same-origin controls; all merchant/source text is rendered as text.
const $ = id => document.getElementById(id);
const key = 'sf30-dataset-publisher-session';
let workbookUI = null;
let token = location.hash.slice(1);
if (/^[A-Za-z0-9_-]{43}$/.test(token)) { sessionStorage.setItem(key,token); history.replaceState(null,'',location.pathname); }
else token = sessionStorage.getItem(key) || '';
let state = { status:null, draft:null, workspace:null, selected:null, result:null, dataset:null,
  query:'', history:[''], page:0, busy:false, dirty:false, activation:null,
  buyerSource:null, buyerReview:null, buyerPrepared:null };
const fmt = n => typeof n === 'number' ? n.toLocaleString() : '—';
const bytes = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n/1024).toFixed(1)} KiB` : `${(n/1048576).toFixed(1)} MiB`;
const short = x => x ? x.slice(0,12) : '—';
const draftTarget = () => state.draft ? 'draft:'+state.draft.id : null;
const savedQuery = target => state.workspace?.selection?.target===target ? state.workspace.selection.query : '';
const fresh = () => state.draft && state.status && state.draft.expectedSnapshot === state.status.current && state.draft.expectedRevision === state.status.revision;
function notice(text,kind='info') { $('notice').textContent=text; $('notice').dataset.kind=kind; }
function el(tag,text,cls) { const node=document.createElement(tag); if(text!==undefined)node.textContent=text; if(cls)node.className=cls; return node; }
async function api(path,body,method='POST',extra={}) {
  const response=await fetch('/api/'+path,{method,headers:{authorization:'Bearer '+token,
    ...(body===undefined?{}:{'content-type':body instanceof File?'text/csv':'application/json'}),...extra},
    ...(body===undefined?{}:{body:body instanceof File?body:JSON.stringify(body)}),redirect:'error',credentials:'omit'});
  const value=await response.json();
  if(!response.ok)throw Object.assign(new Error(value.message||value.error||'Action failed'),{code:value.error,status:response.status,details:value.details});
  return value;
}
function controls() {
  const busy=state.busy;
  $('refresh').disabled=busy;
  for(const id of ['collect','upload','csv-file','preview-current'])$(id).disabled=busy||!state.status;
  $('query-fields').disabled=busy||!state.dataset;
  for(const id of ['preview-draft','review-current','discard','draft-name','draft-notes','save-draft-notes','download-draft','export-review','check-publication'])$(id).disabled=busy||!state.draft;
  $('publish').disabled=busy||!fresh()||state.draft?.publicationNeedsReview||state.selected!==draftTarget()||!state.result||state.dirty;
  $('discard').disabled=busy||!state.draft||state.draft.publicationNeedsReview;
  $('previous').disabled=busy||!state.result||state.dirty||state.page===0;
  $('next').disabled=busy||!state.result||state.dirty||!state.result.page.nextCursor;
  for(const id of ['copy-query','export-page'])$(id).disabled=busy||!state.result||state.dirty;
  for(const button of $('versions').querySelectorAll('button'))button.disabled=busy;
  for(const table of ['saved-candidates','saved-buyers'])for(const button of $(table).querySelectorAll('button'))button.disabled=busy;
  $('confirm-activation').disabled=busy||!state.activation;
  $('cancel-activation').disabled=busy;
  const published=state.status?.versions.find(v=>v.snapshot===state.selected&&v.status!=='EXPIRED');
  $('load-offer').disabled=busy||!state.buyerSource||!published||!state.result||state.dirty;
  for(const id of ['buyer-accept','buyer-intent'])$(id).disabled=busy||!state.buyerReview;
  $('prepare-buyer').disabled=busy||!state.buyerReview||state.dirty;
  $('download-buyer').disabled=busy||!state.buyerPrepared||state.dirty;
  workbookUI?.controls();
}
async function action(message,fn) {
  if(state.busy)return;
  state.busy=true; controls(); notice(message);
  try { await fn(); }
  catch(error) {
    workbookUI?.error(error);
    if(/^(SELLER_|SNAPSHOT_SELECTION_|VERSION_NOT_AVAILABLE)/.test(error.code||''))clearBuyer();
    // Show a concurrent operator's new revision without silently re-reviewing
    // this draft or changing the saved activation expectation.
    if(error.status===409)try{accept(await api('status',undefined,'GET'));}catch{}
    notice(error.message,'error');
  }
  finally { state.busy=false; controls(); }
}
function accept(data) {
  if(data.status&&state.status&&data.status.revision!==state.status.revision)clearBuyer();
  if(data.status)state.status=data.status;
  if(data.workspace)state.workspace=data.workspace;
  if(Object.hasOwn(data,'draft'))state.draft=data.draft;
  if(data.maxUploadBytes)$('upload-limit').textContent='Upload limit '+bytes(data.maxUploadBytes);
  if(data.resource){$('resource-link').href=data.resource;$('resource-link').hidden=false;}
  if(Object.hasOwn(data,'buyerSource'))state.buyerSource=data.buyerSource;
  $('buyer-setup').textContent=state.buyerSource?'Inspect a published version and run the query, then load its current seller offer.':'Connect the existing seller with the workspace’s --seller and --resource options.';
  renderStatus(); renderSaved(); workbookUI?.accept(data);
}
function renderSaved() {
  const workspace=state.workspace;if(!workspace)return;
  const cap=workspace.capacity;
  $('draft-capacity').textContent=`${fmt(cap.candidateCount)} / ${fmt(cap.maxCandidates)} candidates · ${bytes(cap.sourceBytes)} / ${bytes(cap.maxSourceBytes)} retained source capacity`;
  const candidates=$('saved-candidates').tBodies[0];candidates.replaceChildren();
  for(const item of [...workspace.candidates].reverse()){
    const row=el('tr',undefined,item.id===state.draft?.id?'candidate-selected':undefined);
    const name=el('td');name.append(el('strong',item.name),el('div',item.filename,'small muted'));
    const outcome=item.publications.at(-1)?.state;
    const outcomeLabel={CONFIRMED:'Published',CURRENT_OBSERVED:'Current version observed',PENDING:'Check result',NEEDS_REVIEW:'Review result',REVIEWED_AFTER_INTERRUPTION:'Reviewed after interruption'}[outcome]||'Unpublished';
    row.append(name,el('td',`${fmt(item.dataset.rowCount)} / ${bytes(item.sourceBytes)}`),el('td',outcomeLabel),
      el('td',`Revision ${item.expectedRevision}`),el('td',new Date(item.createdAt).toLocaleString()));
    const actionCell=el('td'),choose=el('button',item.id===state.draft?.id?'Inspect selected':'Open candidate','small-button');
    choose.type='button';choose.dataset.candidate=item.id;
    choose.addEventListener('click',()=>action('Opening the saved candidate…',async()=>{
      accept(await api('draft/select',{id:item.id}));await select(draftTarget(),savedQuery(draftTarget()));notice('Saved candidate opened with its original review.');
    }));actionCell.append(choose);row.append(actionCell);candidates.append(row);
  }
  $('no-saved-candidates').hidden=workspace.candidates.length>0;
  const buyers=$('saved-buyers').tBodies[0];buyers.replaceChildren();
  for(const item of [...workspace.buyers].reverse()){
    const row=el('tr'),version=state.status?.versions.find(value=>value.snapshot===item.snapshot);
    row.append(el('td',item.intentId),el('td',`${short(item.snapshot)} / ${version?.status||'No longer retained'}`),el('td',new Date(item.createdAt).toLocaleString()));
    const cell=el('td'),buttons=el('div',undefined,'saved-actions'),save=el('button','Download JSON','small-button'),remove=el('button','Remove','small-button');
    save.type=remove.type='button';save.dataset.buyer=item.id;
    save.addEventListener('click',()=>action('Opening the saved buyer file…',async()=>{const data=await api('buyer-saved',{id:item.id});download(data.configText,'dataset-'+short(item.snapshot)+'-buyer.json');notice('Saved buyer configuration downloaded.');}));
    remove.addEventListener('click',()=>action('Removing the saved buyer file…',async()=>{accept(await api('buyer-remove',{id:item.id}));notice('Saved buyer file removed.');}));
    buttons.append(save,remove);cell.append(buttons);row.append(cell);buyers.append(row);
  }
  $('no-saved-buyers').hidden=workspace.buyers.length>0;
  $('recovery-warnings').hidden=!workspace.recoveryWarnings?.length;
  $('recovery-warnings').textContent=(workspace.recoveryWarnings??[]).map(item=>`${item.kind} ${short(item.id)} needs source repair (${item.code}).`).join(' ');
  controls();
}
function renderStatus() {
  const s=state.status;if(!s)return;
  const current=s.versions.find(x=>x.snapshot===s.current);
  $('revision').textContent=fmt(s.revision);$('row-count').textContent=fmt(current?.rowCount);
  $('retained-bytes').textContent=bytes(s.retainedSourceBytes);
  $('version-capacity').textContent=`${s.versions.length} / ${s.settings.maxVersions}`;
  $('dataset-subtitle').textContent=`Current snapshot ${short(s.current)} · publishing preserves the existing route and price.`;
  $('retention-policy').textContent=`Earlier versions are retained for ${fmt(s.settings.retentionMs/1000)} seconds after retirement. CSV capacity ${bytes(s.settings.maxRetainedBytes)}.`;
  $('empty-draft').hidden=Boolean(state.draft);$('draft-details').hidden=!state.draft;
  $('draft-state').textContent=state.draft?(state.draft.publicationNeedsReview?'Check publication':fresh()?'Validated':'Review current version'):'None';
  if(state.draft){const d=state.draft;
    $('draft-file').textContent=d.filename;$('draft-size').textContent=`${fmt(d.dataset.rowCount)} rows / ${bytes(d.sourceBytes)}`;
    $('draft-base').textContent=`Revision ${d.expectedRevision} / ${short(d.expectedSnapshot)}`;
    $('draft-snapshot').textContent=d.dataset.snapshot;
    $('draft-name').value=d.name;$('draft-notes').value=d.notes;
    $('draft-warning').textContent=d.publicationNeedsReview?'A publication response was interrupted. Check the actual seller result, then review the current revision before another attempt.':fresh()?'Inspect the draft, then publish when the rows are ready.':'The current publication changed after this upload was prepared. Review the same draft against the latest revision before publishing.';
    $('review-current').hidden=fresh()&&!d.publicationNeedsReview;
    $('check-publication').hidden=!d.publicationNeedsReview;
  }
  const tbody=$('versions').tBodies[0];tbody.replaceChildren();
  for(const v of [...s.versions].sort((a,b)=>(b.snapshot===s.current)-(a.snapshot===s.current)||b.activatedAt-a.activatedAt)){
    const tr=el('tr');const identity=el('td',v.snapshot);identity.title=v.snapshot;tr.append(identity);
    tr.append(el('td',v.status),el('td',fmt(v.rowCount)),el('td',bytes(v.sourceBytes)),el('td',v.expiresAt===null?'Current':new Date(v.expiresAt).toLocaleString()),el('td',fmt(v.readers)));
    const cell=el('td'),buttons=el('div',undefined,'version-actions');
    const inspect=el('button','Inspect','small-button');inspect.type='button';inspect.dataset.snapshot=v.snapshot;
    inspect.addEventListener('click',()=>action('Loading the selected version…',()=>select(v.snapshot)));buttons.append(inspect);
    if(v.status==='RETAINED'){
      const activate=el('button','Select for rollback','small-button');activate.type='button';activate.dataset.activate=v.snapshot;
      activate.addEventListener('click',()=>{
        state.activation={snapshot:v.snapshot,expectedSnapshot:state.status.current,expectedRevision:state.status.revision};
        $('activation-summary').textContent=`${v.snapshot} will replace revision ${state.status.revision} / ${short(state.status.current)}.`;
        $('activation-review').hidden=false;controls();$('activation-review').scrollIntoView({block:'nearest'});
      });buttons.append(activate);
    }
    cell.append(buttons);tr.append(cell);tbody.append(tr);
  }
  controls();
}
function selectionLabel() {
  if(state.selected===draftTarget())return 'Unpublished draft';
  return state.selected===state.status?.current?'Current publication':'Retained publication';
}
function schema(description) {
  state.dataset=description;$('dataset-name').textContent=description.name||'Dataset';
  $('columns').replaceChildren();$('sort').replaceChildren(el('option','CSV order'));$('sort').options[0].value='';
  for(const column of description.columns){
    const option=el('option',`${column.name} · ${column.type}${column.nullable?' / nullable':''}`);option.value=column.name;option.selected=true;$('columns').append(option);
    if(column.sortable)for(const [prefix,label]of [['','ascending'],['-','descending']]){
      const sort=el('option',`${column.name} / ${label}`);sort.value=prefix+column.name;$('sort').append(sort);
    }
  }
  $('limit').max=description.maxLimit;$('limit').value=description.defaultLimit;
  $('filters').replaceChildren();$('no-filters').hidden=false;
  $('add-filter').disabled=!description.columns.some(c=>c.filterable||c.rangeFilterable);
}
function dirty() {state.dirty=true;clearBuyer();$('query-note').textContent='Query changed. Run preview to see these results.';controls();}
function addFilter() {
  const columns=state.dataset.columns.filter(c=>c.filterable||c.rangeFilterable);if(!columns.length)return;
  const row=el('div',undefined,'filter-row'),column=el('select'),operator=el('select'),value=el('input'),remove=el('button','×');
  column.setAttribute('aria-label','Filter column');operator.setAttribute('aria-label','Filter comparison');value.setAttribute('aria-label','Filter value');remove.setAttribute('aria-label','Remove filter');remove.type='button';
  column.dataset.role='column';operator.dataset.role='operator';value.dataset.role='value';
  for(const c of columns){const option=el('option',c.name);option.value=c.name;column.append(option);}
  const ops=()=>{operator.replaceChildren();const c=columns.find(x=>x.name===column.value);
    for(const [code,label]of [...(c.filterable?[['where','=']]:[]),...(c.rangeFilterable?[['gte','≥'],['gt','>'],['lte','≤'],['lt','<']]:[])]){const o=el('option',label);o.value=code;operator.append(o);}
  };ops();column.addEventListener('change',ops);
  remove.addEventListener('click',()=>{row.remove();$('no-filters').hidden=$('filters').children.length>0;dirty();});
  row.append(column,operator,value,remove);$('filters').append(row);$('no-filters').hidden=true;dirty();
}
function query() {
  const q=new URLSearchParams(),fields=[...$('columns').selectedOptions].map(o=>o.value);
  if(!fields.length)throw new Error('Select at least one column.');
  q.set('fields',fields.join(','));q.set('limit',$('limit').value);
  if($('sort').value)q.set('sort',$('sort').value);
  for(const row of $('filters').children){const name=row.querySelector('[data-role=operator]').value+'_'+row.querySelector('[data-role=column]').value;
    if(q.has(name))throw new Error('Each filter comparison can occur once per column.');q.set(name,row.querySelector('[data-role=value]').value);}
  return q.toString();
}
function restoreQuery(encoded) {
  const value=new URLSearchParams(encoded);
  if(value.has('fields')){const selected=new Set(value.get('fields').split(','));for(const option of $('columns').options)option.selected=selected.has(option.value);}
  if(value.has('sort'))$('sort').value=value.get('sort');if(value.has('limit'))$('limit').value=value.get('limit');
  for(const [name,text]of value){
    const match=/^(where|gte|gt|lte|lt)_(.+)$/.exec(name);if(!match)continue;
    addFilter();const row=$('filters').lastElementChild;if(!row)continue;
    const column=row.querySelector('[data-role=column]');column.value=match[2];column.dispatchEvent(new Event('change'));
    row.querySelector('[data-role=operator]').value=match[1];row.querySelector('[data-role=value]').value=text;
  }
  state.dirty=false;
}
async function select(target,encoded='') {
  const data=await api('preview',{target,query:encoded});
  if(state.workspace)state.workspace.selection={target,query:encoded,snapshot:data.dataset.snapshot};
  state.selected=target;state.history=[''];state.page=0;state.query=encoded;state.dirty=false;schema(data.dataset);restoreQuery(encoded);renderResult(data);
  notice(selectionLabel()+' loaded.');
}
function renderResult(data) {
  clearBuyer();
  state.result=data.result;state.dataset=data.dataset;state.dirty=false;state.executedQuery=data.query;
  $('preview-source').textContent=`${selectionLabel()} / ${data.dataset.snapshot}`;
  $('query-note').textContent='Preview reads the selected local snapshot.';
  $('executed-query').hidden=false;$('executed-query').textContent=data.query||'(default query)';
  $('result-count').textContent=`${fmt(data.result.page.returned)} rows on this page / ${fmt(data.result.page.total)} matching rows`;
  $('page-position').textContent=`Page ${state.page+1}`;
  const table=$('results'),head=el('tr');for(const field of data.result.fields)head.append(el('th',field));table.tHead.replaceChildren(head);table.tBodies[0].replaceChildren();
  for(const row of data.result.rows){const tr=el('tr');for(const field of data.result.fields){const value=row[field];tr.append(el('td',value===null?'null':String(value),value===null?'null':undefined));}table.tBodies[0].append(tr);}
  $('empty-result').hidden=data.result.rows.length>0;$('empty-result').textContent='No rows match this query.';controls();
}
async function runPage(cursor='',reset=false,page=state.page,history=state.history) {
  const proposedQuery=reset?query():state.query;
  const q=new URLSearchParams(proposedQuery);if(cursor)q.set('cursor',cursor);
  const data=await api('preview',{target:state.selected,query:q.toString()});
  if(state.workspace)state.workspace.selection={target:state.selected,query:proposedQuery,snapshot:data.dataset.snapshot};
  // A rejected query keeps the complete previous page identity intact.
  state.query=proposedQuery;state.history=reset?['']:history;state.page=reset?0:page;
  renderResult(data);notice('Preview updated.');
}
function clearBuyer() {
  state.buyerReview=null;state.buyerPrepared=null;
  $('buyer-review').hidden=true;$('buyer-prepared').hidden=true;
}
function buyerTerms() {
  const accepted=state.buyerReview?.accepts[Number($('buyer-accept').value)];if(!accepted)return;
  state.buyerPrepared=null;$('buyer-prepared').hidden=true;
  $('buyer-price').textContent=`${accepted.amount} atomic units / ${accepted.network}`;
  $('buyer-asset').textContent=accepted.asset;$('buyer-recipient').textContent=accepted.payTo;
  $('buyer-payment').textContent=`${accepted.scheme} / maximum timeout ${accepted.maxTimeoutSeconds} seconds${accepted.extra?.paymentFlow?' / '+accepted.extra.paymentFlow:''}`;
  controls();
}
function download(text,filename,type='application/json') {
  const url=URL.createObjectURL(new Blob([text],{type}));const a=el('a');
  a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('load-offer').addEventListener('click',()=>action('Loading the original seller’s current offer…',async()=>{
  clearBuyer();const data=await api('buyer-offer',{target:state.selected,query:state.query});state.buyerReview=data;
  $('buyer-mode').textContent=data.mode==='NATIVE_X402'?'Native x402 seller':'Challenge-only seller';
  $('buyer-url').textContent=data.url;
  $('buyer-selection').textContent=`${fmt(data.selection.matchingRows)} matching rows / ${fmt(data.selection.rowsPerPage)} per page / ${data.selection.fields.join(', ')}`;
  $('buyer-expiry').textContent=data.selection.expiresAt===null?'Current version; retention begins when it is replaced':new Date(data.selection.expiresAt).toLocaleString();
  $('buyer-accept').replaceChildren();data.accepts.forEach((accepted,index)=>{const option=el('option',`${index+1} / ${accepted.network} / ${accepted.amount} atomic units`);option.value=String(index);$('buyer-accept').append(option);});
  $('buyer-intent').value='dataset:'+crypto.randomUUID();$('buyer-review').hidden=false;buyerTerms();
  notice('Current offer loaded. Review the exact payment terms and prepare the buyer config.');
}));
$('buyer-accept').addEventListener('change',buyerTerms);
$('buyer-intent').addEventListener('input',()=>{state.buyerPrepared=null;$('buyer-prepared').hidden=true;controls();});
$('buyer-form').addEventListener('submit',event=>{event.preventDefault();action('Preparing the original buyer configuration…',async()=>{
  const data=await api('buyer-prepare',{target:state.selected,query:state.query,intentId:$('buyer-intent').value,
    acceptIndex:Number($('buyer-accept').value),offerSha256:state.buyerReview.offerSha256});
  if(data.workspace){state.workspace=data.workspace;renderSaved();}
  state.buyerPrepared=data;$('buyer-prepared').hidden=false;
  $('buyer-prepared-summary').textContent=`Snapshot ${short(data.snapshot)} / ${fmt(data.selection.matchingRows)} rows / ${data.config.operation.expect.maxAtomic} atomic units maximum per page.`;
  notice('Buyer config prepared and saved with the reviewed original offer. Ready to download.');
});});
$('download-buyer').addEventListener('click',()=>{if(!state.buyerPrepared)return;download(state.buyerPrepared.configText,'dataset-'+short(state.buyerPrepared.snapshot)+'-buyer.json');notice('Original buyer config downloaded. Continue in the private buyer workspace.');});
$('upload-form').addEventListener('submit',event=>{event.preventDefault();const file=$('csv-file').files[0];if(!file)return;
  action('Uploading and validating the CSV…',async()=>{accept(await api('draft',file,'PUT',{'x-upload-name':encodeURIComponent(file.name)}));await select(draftTarget());notice('CSV validated. Inspect the draft, then publish when ready.');$('csv-file').value='';});
});
$('refresh').addEventListener('click',()=>action('Refreshing seller status…',async()=>{accept(await api('status',undefined,'GET'));if(!state.dataset)await select(state.status.current);notice('Seller status refreshed.');}));
$('preview-current').addEventListener('click',()=>action('Loading the current publication…',()=>select(state.status.current)));
$('preview-draft').addEventListener('click',()=>action('Loading the working draft…',()=>select(draftTarget(),savedQuery(draftTarget()))));
$('draft-metadata').addEventListener('submit',event=>{event.preventDefault();action('Saving the candidate review…',async()=>{
  const selected=state.draft;accept(await api('draft/metadata',{id:selected.id,name:$('draft-name').value,
    notes:$('draft-notes').value,expectedDraftRevision:selected.revision}));notice('Candidate name and review notes saved.');
});});
$('download-draft').addEventListener('click',()=>action('Reading the original saved CSV…',async()=>{
  const selected=state.draft,response=await fetch('/api/draft/csv',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify({id:selected.id}),redirect:'error',credentials:'omit'});
  if(!response.ok){const data=await response.json();throw new Error(data.message||data.error);}
  download(await response.blob(),selected.filename,'text/csv');notice('Original saved CSV downloaded.');
}));
$('export-review').addEventListener('click',()=>action('Exporting the saved source and publication review…',async()=>{
  const data=await api('draft/export',{id:state.draft.id});download(JSON.stringify(data,null,2)+'\n','dataset-review-'+state.draft.id+'.json');notice('Candidate review and publication history exported.');
}));
$('check-publication').addEventListener('click',()=>action('Reading the original seller publication result…',async()=>{
  accept(await api('draft/check-publication',{id:state.draft.id}));
  if(!state.draft){await select(state.status.current,savedQuery(state.status.current));notice('The exact candidate source is the current publication. Its history is saved.');}
  else notice('Current seller status is displayed. Review this revision before deciding whether to publish again.');
}));
$('review-current').addEventListener('click',()=>action('Reviewing the draft against the latest publication…',async()=>{accept(await api('draft/review-current',{id:state.draft.id}));await select(draftTarget(),savedQuery(draftTarget()));notice('Draft retained. Review is now based on the displayed current revision.');}));
$('publish').addEventListener('click',()=>action('Publishing through the original seller…',async()=>{
  const d=state.draft;accept(await api('publish',{id:d.id,expectedSnapshot:d.expectedSnapshot,expectedRevision:d.expectedRevision}));await select(state.status.current,savedQuery(state.status.current));notice('Published. New queries now use the current version.');
}));
$('discard').addEventListener('click',()=>action('Removing this saved candidate…',async()=>{accept(await api('draft/discard',{id:state.draft.id}));await select(state.status.current);notice('Saved candidate removed.');}));
$('collect').addEventListener('click',()=>action('Collecting expired generations through the seller…',async()=>{accept(await api('collect',{}));notice('Expired generations without active readers have been collected.');}));
$('confirm-activation').addEventListener('click',()=>action('Activating the reviewed retained version…',async()=>{accept(await api('activate',state.activation));state.activation=null;$('activation-review').hidden=true;await select(state.status.current);notice('Retained version is now current.');}));
$('cancel-activation').addEventListener('click',()=>{state.activation=null;$('activation-review').hidden=true;controls();});
$('add-filter').addEventListener('click',addFilter);
$('query-form').addEventListener('input',dirty);$('query-form').addEventListener('change',dirty);
$('query-form').addEventListener('submit',event=>{event.preventDefault();action('Running the original dataset query…',()=>runPage('',true));});
$('next').addEventListener('click',()=>action('Loading the next page…',async()=>{const cursor=state.result.page.nextCursor;await runPage(cursor,false,state.page+1,[...state.history.slice(0,state.page+1),cursor]);}));
$('previous').addEventListener('click',()=>action('Loading the previous page…',()=>runPage(state.history[state.page-1],false,state.page-1)));
$('copy-query').addEventListener('click',()=>action('Copying the selected query…',async()=>{await navigator.clipboard.writeText(state.executedQuery||'limit='+state.dataset.defaultLimit);notice('Current page query copied. It applies to the selected dataset contract.');}));
$('export-page').addEventListener('click',()=>{
  if(!state.result)return;download(JSON.stringify(state.result,null,2)+'\n','dataset-'+short(state.dataset.snapshot)+'-page-'+(state.page+1)+'.json');notice('Current preview page exported.');
});
workbookUI = createWorkbookControls({getState:()=>state,api,action,accept,select,draftTarget,savedQuery,notice,download,token:()=>token});
action('Connecting to the running seller…',async()=>{
  const data=await api('status',undefined,'GET');accept(data);const saved=state.workspace?.selection;
  if(saved){try{await select(saved.target,saved.query);notice('Saved work reopened. The retained query starts at its first page.');return;}
    catch(error){if(!['DRAFT_CHANGED','VERSION_NOT_AVAILABLE','CURSOR_VERSION_EXPIRED','VERSION_CONTENT_CHANGED'].includes(error.code))throw error;}}
  await select(draftTarget()||state.status.current);
  notice(data.draftError?data.draftError.message:'Connected. Upload a CSV or open a saved candidate.');
});
