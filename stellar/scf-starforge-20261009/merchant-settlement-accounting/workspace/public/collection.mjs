// MIT. Operator controls over the original SF86 collection and accounting APIs.
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const endpoint = value => encodeURIComponent(value);
const shown = value => value === null || value === undefined ? 'Not recorded' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
const friendly = value => String(value ?? '').toLowerCase().replace(/_/g, ' ').replace(/^./, char => char.toUpperCase());
const short = value => typeof value === 'string' && value.length > 25 ? value.slice(0, 13) + '…' + value.slice(-7) : shown(value);
const date = value => value ? new Date(value).toLocaleString(undefined, {dateStyle:'medium', timeStyle:'short'}) : 'Not recorded';
const network = value => ({'stellar:testnet':'Stellar testnet','stellar:pubnet':'Stellar public network'}[value] || shown(value));
const kind = value => ({'sf81-record':'Payment record · SF81','sf82-evidence':'Fulfilment evidence · SF82'}[value] || shown(value));
const verdict = value => ({UNATTEMPTED:'Unattempted',NOT_RECONCILED:'Needs reconciliation',CHAIN_TRANSFER_MATCHED_RPC_TESTNET:'Testnet transfer matched',CHAIN_TRANSFER_MATCHED_RPC_PUBNET:'Public network transfer matched',LOCAL_RPC_REPLAY_MATCHED:'Local RPC replay matched'}[value] || friendly(value));
const badge = (value, text = friendly(value)) => '<span class="badge" title="' + esc(value) + '">' + esc(text) + '</span>';
const active = job => ['queued','running','cancelling'].includes(job.status);
const PAGE = 25, FILE_LIMIT = 4_000_000;
const labels = {id:'Retained source ID',name:'Display name',kind:'Original source',payer:'Payer account',network:'Network',transaction:'Transaction',rpcEndpoint:'RPC endpoint',maxEventPages:'Maximum event pages',sha256:'Source SHA-256',bytes:'Retained bytes',createdAt:'Created',actor:'Operator',intentId:'Payment intent',sourceSha256:'Original source SHA-256',attempts:'Saved attempts',verdict:'Original verdict',reason:'Original reason',resultSha256:'Result SHA-256',batchId:'Original batch ID',planSha256:'Plan SHA-256',directory:'Retained collection directory',sourceIds:'Reviewed source IDs',completedAt:'Completed',lastJobId:'Last processed source',collectionId:'Collection ID',proofId:'Accounting verification file',sourceId:'Reviewed source ID',jobId:'Original source ID',included:'Included in accounting'};
const values = object => '<dl class="record-values">' + Object.entries(object).map(([key, value]) => '<dt>' + esc(labels[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2')) + '</dt><dd' + (/(?:Id|Sha256|sha256|payer|transaction|rpcEndpoint)/.test(key) ? ' class="mono"' : '') + '>' + esc(key === 'network' ? network(value) : key === 'kind' ? kind(value) : key === 'createdAt' || key === 'completedAt' ? date(value) : shown(value)) + '</dd>').join('') + '</dl>';

export function mountCollection({root, api, perform, operator, adopt, getState, openRun, notify}) {
  const $ = id => root.querySelector('#collection-' + id);
  if (!$('source-form')) throw new Error('The collection workspace fragment has not been mounted.');
  const listeners = new AbortController();
  let saved = {sources:[], collections:[], jobs:[]}, detail = null, selected = '', inspectedSource = '', inspectedResult = '';
  let sourceSearch = '', resultSearch = '', resultStatus = '', sourceOffset = 0, resultOffset = 0, jobLimit = 15;
  let requestSequence = 0, timer = null, destroyed = false, acting = 0, uploading = false, readError = '';
  let uploadQueue = [], uploadHistory = [];
  const sourceSelection = new Set(), retrySelection = new Set();
  const html = (id, content) => { if ($(id).innerHTML !== content) $(id).innerHTML = content; };
  const busy = () => acting > 0 || document.body.classList.contains('working');
  const sourceById = id => saved.sources.find(source => source.id === id);
  const sourceForResult = row => sourceById(row.id) || saved.sources.find(source => source.sha256 === row.sourceSha256);
  const results = () => detail?.summary?.jobs || [];
  const collectionJobs = () => saved.jobs.filter(job => job.collectionId === selected);
  const working = () => collectionJobs().some(active);
  const proofRows = () => Array.isArray(detail?.publishedProofs) ? detail.publishedProofs : [];
  const sourceMatches = () => saved.sources.filter(source => !sourceSearch || [source.name,source.id,source.payer,source.network,source.transaction,source.sha256].some(value => String(value ?? '').toLowerCase().includes(sourceSearch)));
  const resultMatches = () => results().filter(row => (!resultStatus || row.verdict === resultStatus) && (!resultSearch || [row.id,row.intentId,row.reason,sourceForResult(row)?.name].some(value => String(value ?? '').toLowerCase().includes(resultSearch))));
  const revision = () => {
    const value = getState()?.revision;
    if (!Number.isSafeInteger(value)) throw new Error('Load the saved workspace before making this change.');
    return value;
  };
  function safe(work) { return Promise.resolve().then(work).catch(error => { if (!destroyed) notify(error.message || String(error), true); }); }
  function focusDetail(id) {
    $(id).focus({preventScroll:true});
    if (matchMedia('(max-width:1150px)').matches) $(id).scrollIntoView({block:'nearest', behavior:'smooth'});
  }
  function pageLabel(total, offset) { return total ? (offset + 1) + '–' + Math.min(offset + PAGE, total) + ' of ' + total : '0 records'; }
  function checkboxPage(control, rows, selection) {
    control.checked = rows.length > 0 && rows.every(row => selection.has(row.id));
    control.indeterminate = !control.checked && rows.some(row => selection.has(row.id));
    control.disabled = rows.length === 0;
  }
  function accept(data) {
    if (data.state) adopt(data.state);
    for (const key of ['sources','collections','jobs']) if (Array.isArray(data[key])) saved[key] = data[key];
    if (selected && !saved.collections.some(collection => collection.id === selected)) { selected = ''; detail = null; }
    if (!selected) selected = saved.collections[0]?.id || '';
    if (data.collection?.id === selected) detail = {collection:data.collection, summary:data.summary, publishedProofs:data.publishedProofs || []};
    for (const id of sourceSelection) if (!sourceById(id)) sourceSelection.delete(id);
    for (const id of retrySelection) if (!results().some(row => row.id === id && row.verdict === 'NOT_RECONCILED')) retrySelection.delete(id);
  }
  function renderControls() {
    if (destroyed) return;
    const unavailable = busy() || !getState(), ongoing = working(), total = detail?.summary?.totals;
    $('upload').disabled = unavailable || uploading || uploadQueue.length > 0;
    $('upload-continue').disabled = unavailable || uploading || uploadQueue.length === 0;
    $('prepare').disabled = unavailable || sourceSelection.size === 0;
    $('collect').disabled = unavailable || ongoing || !selected || !(total?.unattempted > 0);
    $('collect').textContent = total?.unattempted ? 'Collect ' + total.unattempted + ' remaining' : 'Collect remaining';
    $('retry').disabled = unavailable || ongoing || retrySelection.size === 0;
    $('retry').textContent = retrySelection.size ? 'Retry ' + retrySelection.size + ' selected unresolved' : 'Retry selected unresolved results';
    $('refresh').disabled = unavailable || !selected;
    $('publish').disabled = unavailable || ongoing || !results().some(row => row.resultSha256);
    $('run').disabled = unavailable || !proofRows().some(proof => proof.proofId) || saved.jobs.some(job => job.kind === 'publish' && active(job)) || (getState()?.runs || []).some(job => active(job));
    for (const button of root.querySelectorAll('[data-collection-remove-upload]')) button.disabled = unavailable || uploading;
    for (const button of root.querySelectorAll('[data-collection-cancel]')) {
      const job = saved.jobs.find(item => item.id === button.dataset.collectionCancel);
      button.disabled = unavailable || !job || job.status === 'cancelling';
    }
  }
  function renderSources() {
    const found = sourceMatches();
    sourceOffset = Math.min(sourceOffset, Math.max(0, Math.floor((found.length - 1) / PAGE) * PAGE));
    const page = found.slice(sourceOffset, sourceOffset + PAGE);
    html('source-rows', page.map(source => '<tr' + (source.id === inspectedSource ? ' class="selected"' : '') + '><td><input type="checkbox" data-collection-source="' + esc(source.id) + '" aria-label="Include ' + esc(source.name) + ' in prepared collection"' + (sourceSelection.has(source.id) ? ' checked' : '') + '></td><td><button type="button" class="inspect" data-collection-inspect-source="' + esc(source.id) + '">' + esc(source.name) + '</button><span class="subtle">' + esc(kind(source.kind)) + '</span><span class="subtle">' + esc(date(source.createdAt)) + '</span></td><td>' + esc(network(source.network)) + '<span class="subtle mono" title="' + esc(shown(source.transaction)) + '">' + esc(short(source.transaction)) + '</span></td><td class="mono" title="' + esc(source.payer) + '">' + esc(short(source.payer)) + '</td></tr>').join('') || '<tr><td colspan="4" class="empty">' + (saved.sources.length ? 'No sources match this filter.' : 'Upload original payment records to review and retain them here.') + '</td></tr>');
    $('source-total').textContent = saved.sources.length + ' retained sources';
    $('source-page').textContent = pageLabel(found.length, sourceOffset);
    $('selection-count').textContent = sourceSelection.size + ' selected across all pages';
    $('source-previous').disabled = sourceOffset === 0;
    $('source-next').disabled = sourceOffset + PAGE >= found.length;
    checkboxPage($('source-all'), page, sourceSelection);
    const source = sourceById(inspectedSource);
    html('source-detail', source ? '<h3>' + esc(source.name) + '</h3>' + values(source) : '<p class="empty">Select a source name to inspect its retained values.</p>');
  }
  function renderResults() {
    const found = resultMatches();
    resultOffset = Math.min(resultOffset, Math.max(0, Math.floor((found.length - 1) / PAGE) * PAGE));
    const page = found.slice(resultOffset, resultOffset + PAGE);
    html('result-rows', page.map(row => {
      const source = sourceForResult(row);
      return '<tr' + (row.id === inspectedResult ? ' class="selected"' : '') + '><td>' + (row.verdict === 'NOT_RECONCILED' ? '<input type="checkbox" data-collection-retry="' + esc(row.id) + '" aria-label="Retry unresolved result for ' + esc(source?.name || row.id) + '"' + (retrySelection.has(row.id) ? ' checked' : '') + '>' : '') + '</td><td><button type="button" class="inspect" data-collection-inspect-result="' + esc(row.id) + '">' + esc(source?.name || row.id) + '</button><span class="subtle">' + esc(network(row.network)) + '</span><span class="subtle mono" title="' + esc(row.intentId) + '">' + esc(short(row.intentId)) + '</span></td><td>' + badge(row.verdict, verdict(row.verdict)) + (row.reason ? '<div class="native-reason">' + esc(row.reason) + '</div>' : '') + '</td><td>' + esc(row.attempts) + '</td></tr>';
    }).join('') || '<tr><td colspan="4" class="empty">No original results match this filter.</td></tr>');
    $('result-page').textContent = pageLabel(found.length, resultOffset);
    $('result-previous').disabled = resultOffset === 0;
    $('result-next').disabled = resultOffset + PAGE >= found.length;
    checkboxPage($('retry-all'), page.filter(row => row.verdict === 'NOT_RECONCILED'), retrySelection);
    const row = results().find(item => item.id === inspectedResult), source = row && sourceForResult(row);
    html('result-detail', row ? '<h3>' + esc(source?.name || row.id) + '</h3>' + (row.resultSha256 ? '<div class="actions"><a class="button" download href="/api/collection/' + endpoint(selected) + '/results/' + endpoint(row.id) + '">Download original result</a></div>' : '') + values(row) + (source ? '<details><summary>Reviewed original source</summary>' + values(source) + '</details>' : '') : '<p class="empty">Select a result to inspect its exact verdict and retained source.</p>');
  }
  function renderPublished() {
    const proofs = proofRows();
    const published = proofs.filter(proof => proof.proofId).length;
    $('published-count').textContent = proofs.length ? published + ' published · ' + (proofs.length - published) + ' awaiting publication' : 'Publish collected results to include them in accounting.';
    html('published', proofs.length ? '<table><caption class="sr-only">Original collection results retained in accounting</caption><thead><tr><th>Source</th><th>Original verdict</th><th>Accounting selection</th></tr></thead><tbody>' + proofs.map(proof => {
      const source = sourceById(proof.sourceId || proof.jobId);
      const original = (getState()?.proofs || []).find(item => item.id === proof.proofId);
      const included = original ? original.included : proof.included;
      return '<tr><td>' + esc(source?.name || proof.sourceId || proof.jobId) + '<span class="subtle mono" title="' + esc(proof.sha256) + '">' + esc(short(proof.sha256)) + '</span></td><td>' + badge(proof.verdict, verdict(proof.verdict)) + '</td><td>' + (!proof.proofId ? 'Awaiting publication' : included === true ? 'Included' : included === false ? 'Excluded' : 'See Sources & imports') + (proof.proofId ? '<span class="subtle mono" title="' + esc(proof.proofId) + '">' + esc(short(proof.proofId)) + '</span>' : '') + '</td></tr>';
    }).join('') + '</tbody></table>' : '');
  }
  function renderCollection() {
    const options = saved.collections.length ? saved.collections.map(collection => '<option value="' + esc(collection.id) + '">' + esc(collection.name + ' · ' + date(collection.createdAt)) + '</option>').join('') : '<option value="">Prepare a collection first</option>';
    html('select', options); $('select').value = selected;
    const collection = detail?.collection, ready = collection?.id === selected;
    $('detail').hidden = !ready; $('empty').hidden = ready;
    $('empty').textContent = selected ? 'Loading the original collection…' : 'Prepare selected payment sources to begin collecting transfer verification.';
    if (!ready) return;
    $('title').textContent = collection.name;
    $('description').textContent = 'Prepared ' + date(collection.createdAt) + ' · ' + shown(collection.actor);
    const identity = {id:collection.id,sourceIds:collection.sourceIds,batchId:detail.summary?.batchId,planSha256:detail.summary?.planSha256,directory:detail.summary?.directory};
    html('identity', values(identity));
    const total = detail.summary?.totals || {};
    html('metrics', [['Sources',total.jobs],['Unattempted',total.unattempted],['Network transfer matches',total.reconciled],['Local RPC replays',total.localReplays],['Need reconciliation',total.unresolved]].map(([name,value]) => '<div class="metric"><span>' + esc(name) + '</span><strong>' + esc(shown(value)) + '</strong></div>').join(''));
    const job = collectionJobs().find(active);
    $('progress').hidden = !job;
    if (job) {
      if (Number.isFinite(job.total) && job.total > 0) { $('progress-bar').max = job.total; $('progress-bar').value = Math.min(job.processed || 0,job.total); }
      else $('progress-bar').removeAttribute('value');
      $('progress-text').textContent = (job.kind === 'publish' ? 'Publishing original results' : 'Collecting original RPC evidence') + ' · ' + friendly(job.status) + ' · ' + shown(job.processed) + ' of ' + shown(job.total) + (job.lastJobId ? ' · last source ' + (sourceById(job.lastJobId)?.name || job.lastJobId) : '');
    }
    $('action-note').textContent = working() ? 'The active operation retains each completed result. Stop it from operation history below.' : retrySelection.size ? retrySelection.size + ' unresolved results are selected for an explicit retry. Collect remaining processes unattempted sources.' : total.unattempted ? 'Collect remaining processes the unattempted sources. Select unresolved rows separately when you want to retry them.' : 'All sources have a saved attempt. Select any unresolved results you want to retry.';
    if (!$('run-name').dataset.dirty) $('run-name').value = (collection.name + ' · transfer review').slice(0,160);
    renderResults(); renderPublished();
  }
  function renderJobs() {
    html('job-rows', saved.jobs.slice(0,jobLimit).map(job => {
      const collection = saved.collections.find(item => item.id === job.collectionId);
      const progress = shown(job.processed) + ' of ' + shown(job.total) + ' processed';
      return '<tr><td><strong>' + esc(collection?.name || job.collectionId) + '</strong><span class="subtle">' + esc(job.actor) + ' · ' + esc(date(job.createdAt)) + '</span></td><td>' + esc(job.kind === 'publish' ? 'Publish original results' : 'Collect transfer evidence') + '<span class="subtle">' + badge(job.status) + '</span></td><td><div class="job-result">' + esc(job.error || progress) + '</div><details class="history-detail"><summary>Saved operation</summary>' + values({id:job.id,collectionId:job.collectionId,lastJobId:job.lastJobId,createdAt:job.createdAt,completedAt:job.completedAt}) + '</details></td><td><div class="actions"><button type="button" data-collection-open="' + esc(job.collectionId) + '">Open collection</button>' + (active(job) ? '<button type="button" data-collection-cancel="' + esc(job.id) + '">' + (job.status === 'cancelling' ? 'Stop requested' : 'Stop operation') + '</button>' : '') + '</div></td></tr>';
    }).join('') || '<tr><td colspan="4" class="empty">Collection and publication operations will remain here.</td></tr>');
    $('job-count').textContent = Math.min(jobLimit,saved.jobs.length) + ' of ' + saved.jobs.length + ' operations';
    $('job-more').hidden = jobLimit >= saved.jobs.length;
  }
  function renderUploads() {
    $('upload-queue').hidden = uploadHistory.length + uploadQueue.length === 0;
    html('upload-items', uploadHistory.map(entry => '<li><strong>' + esc(entry.name) + '</strong><span>' + esc(entry.status) + '</span></li>').join('') + uploadQueue.map((entry,index) => '<li><strong>' + esc(entry.name) + '</strong><span>' + esc(entry.status) + '<button type="button" data-collection-remove-upload="' + index + '" aria-label="Remove pending upload ' + esc(entry.name) + '">Remove</button></span></li>').join(''));
    $('upload-status').textContent = uploading ? 'Retaining files sequentially…' : uploadQueue.length ? uploadQueue.length + ' uploads remain in this tab.' : uploadHistory.length ? uploadHistory.length + ' files retained.' : '';
    $('upload-continue').hidden = uploadQueue.length === 0;
  }
  function render() { if (!destroyed) { renderSources(); renderCollection(); renderJobs(); renderUploads(); renderControls(); } }
  function schedule() {
    clearTimeout(timer); timer = null;
    if (destroyed || document.hidden || !saved.jobs.some(active)) return;
    timer = setTimeout(() => refresh().catch(error => {
      if (destroyed) return;
      const message = error.message || String(error);
      if (message !== readError) { readError = message; notify(message, true); }
      schedule();
    }), 1000);
  }
  async function refresh() {
    if (destroyed) return;
    const request = ++requestSequence;
    // A collection detail already includes the current source, collection and
    // operation lists. Active progress needs one local read per interval.
    const current = selected;
    if (current) {
      const response = await api('/api/collection/' + endpoint(current));
      if (destroyed || request !== requestSequence || selected !== current) return;
      accept(response); render(); readError = ''; schedule(); return;
    }
    const base = await api('/api/collection');
    if (destroyed || request !== requestSequence) return;
    accept(base); render();
    const id = selected;
    if (id) {
      const response = await api('/api/collection/' + endpoint(id));
      if (destroyed || request !== requestSequence || selected !== id) return;
      accept(response); render();
    }
    readError = ''; schedule();
  }
  async function choose(id) {
    if (id !== selected) { selected = id; detail = null; inspectedResult = ''; retrySelection.clear(); resultOffset = 0; delete $('run-name').dataset.dirty; }
    render(); await refresh();
  }
  async function write(path, body, options = {}) {
    let completed = false;
    acting++; renderControls();
    try {
      await perform({path,body:{...(options.revision === false ? {} : {revision:revision()}),actor:operator(),...body},description:options.description || 'collection change',message:options.message,currentBody:options.currentBody,success:async response => {
        completed = true; ++requestSequence;
        accept(response);
        if (options.success) await options.success(response);
        render(); schedule();
      }});
    } finally { acting--; renderControls(); }
    return completed;
  }
  function prepareBody() {
    const name = $('name').value.trim();
    if (!name) throw new Error('Name the collection before preparing it.');
    if (!sourceSelection.size) throw new Error('Select reviewed payment sources for the collection.');
    return {name,sourceIds:[...sourceSelection]};
  }
  async function pumpUploads() {
    if (destroyed || uploading || !uploadQueue.length) return;
    uploading = true; renderUploads(); renderControls();
    try {
      while (uploadQueue.length && !destroyed) {
        const entry = uploadQueue[0];
        entry.status = 'Reading original file'; renderUploads();
        if (entry.file.size > FILE_LIMIT) throw new Error(entry.file.name + ' exceeds the 4 MB source limit.');
        let content;
        try { content = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await entry.file.arrayBuffer()); }
        catch { throw new Error(entry.file.name + ' must contain valid UTF-8 JSON.'); }
        try { JSON.parse(content); } catch { throw new Error(entry.file.name + ' must contain valid JSON.'); }
        entry.status = 'Reviewing and retaining'; renderUploads();
        const completed = await write('/api/collection/sources',{name:entry.name,...entry.options,content},{description:'source upload ' + entry.name,message:'Original payment source reviewed and retained.',success:response => {
          const source = response.source;
          if (source?.id) { sourceSelection.add(source.id); inspectedSource = source.id; }
          entry.status = 'Retained';
          const index = uploadQueue.indexOf(entry);
          if (index >= 0) uploadQueue.splice(index,1);
          uploadHistory.push(entry);
          if (!uploading && uploadQueue.length && !destroyed) setTimeout(() => safe(pumpUploads),0);
        }});
        if (!completed) { entry.status = 'Awaiting retry or saved-state reapply'; break; }
      }
    } catch (error) {
      if (uploadQueue.length) uploadQueue[0].status = error.message || String(error);
      throw error;
    } finally { uploading = false; render(); }
  }
  function enqueueUploads() {
    if (uploading || uploadQueue.length) throw new Error('Continue the retained upload queue before selecting another batch.');
    if (!$('source-form').reportValidity()) return;
    const files = [...$('files').files];
    if (!files.length) throw new Error('Choose original payment JSON files.');
    operator();
    const sourceKind = $('kind').value, payer = $('payer').value.trim(), rpcEndpoint = $('rpc').value.trim();
    if (!payer) throw new Error('Enter the original payer account.');
    const options = {kind:sourceKind,payer};
    if (rpcEndpoint) options.rpcEndpoint = rpcEndpoint;
    if ($('event-pages').value) {
      const count = Number($('event-pages').value);
      if (!Number.isSafeInteger(count) || count < 1 || count > 100) throw new Error('Maximum event pages must be a whole number from 1 to 100.');
      options.maxEventPages = count;
    }
    const name = $('source-name').value.trim();
    uploadHistory = [];
    uploadQueue = files.map(file => ({file,name:(name ? name + (files.length > 1 ? ' / ' + file.name : '') : file.name).slice(0,160),options:{...options},status:'Waiting'}));
    return pumpUploads();
  }
  async function collect(retry = false) {
    if (!selected || !detail) throw new Error('Open a prepared collection first.');
    if (working()) throw new Error('Wait for the active collection operation or stop it before continuing.');
    const retryIds = retry ? [...retrySelection] : [];
    if (retry && (!retryIds.length || retryIds.some(id => !results().some(row => row.id === id && row.verdict === 'NOT_RECONCILED')))) throw new Error('Select current unresolved results for the retry.');
    if (!retry && !detail.summary?.totals?.unattempted) throw new Error('This collection has no unattempted sources. Select unresolved results when you want to retry them.');
    await write('/api/collection/' + endpoint(selected) + '/collect',{retryIds},{description:retry ? 'explicit selected-source retry' : 'remaining transfer collection',message:'Collection started. Completed original attempts are retained as progress advances.'});
  }
  root.addEventListener('submit',event => {
    const form = event.target;
    if (!form.id?.startsWith('collection-')) return;
    event.preventDefault();
    safe(async () => {
      if (form.id === 'collection-source-form') return enqueueUploads();
      if (form.id === 'collection-source-filter') { sourceSearch = $('source-search').value.trim().toLowerCase(); sourceOffset = 0; renderSources(); return; }
      if (form.id === 'collection-result-filter') { resultSearch = $('result-search').value.trim().toLowerCase(); resultStatus = $('result-status').value; resultOffset = 0; renderResults(); return; }
      if (form.id === 'collection-prepare-form') return write('/api/collection/prepare',prepareBody(),{description:'prepared source selection',currentBody:prepareBody,message:'Collection prepared from the selected retained sources.',success:response => {
        selected = response.collection.id; detail = {collection:response.collection,summary:response.summary,publishedProofs:response.publishedProofs || []};
        retrySelection.clear(); inspectedResult = ''; resultOffset = 0; delete $('run-name').dataset.dirty;
      }});
      if (form.id === 'collection-run-form') {
        const name = $('run-name').value.trim();
        if (!name) throw new Error('Name the reconciliation.');
        if (!proofRows().some(proof => proof.proofId)) throw new Error('Publish the collection results into accounting first.');
        if (saved.jobs.some(job => job.kind === 'publish' && active(job))) throw new Error('Wait for the current verification-file publication to finish.');
        return write('/api/runs',{name},{description:'reconciliation request',message:'Reconciliation captured from the selected merchant sources.',success:response => openRun(response.run.id)});
      }
    });
  },{signal:listeners.signal});
  root.addEventListener('click',event => {
    const button = event.target.closest('button');
    if (!button || !root.contains(button)) return;
    safe(async () => {
      if (button.dataset.collectionRemoveUpload !== undefined) {
        if (uploading || busy()) return;
        const index = Number(button.dataset.collectionRemoveUpload), entry = uploadQueue[index];
        if (!entry) return;
        if (entry.status.includes('reapply') && document.getElementById('conflict')?.hidden === false) throw new Error('Dismiss or reapply the submitted saved-state conflict before removing that pending file.');
        uploadQueue.splice(index,1); renderUploads(); renderControls();
      }
      else if (button.dataset.collectionInspectSource) { inspectedSource = button.dataset.collectionInspectSource; renderSources(); focusDetail('source-detail'); }
      else if (button.dataset.collectionInspectResult) { inspectedResult = button.dataset.collectionInspectResult; renderResults(); focusDetail('result-detail'); }
      else if (button.dataset.collectionOpen) { await choose(button.dataset.collectionOpen); $('select').focus({preventScroll:true}); $('select').scrollIntoView({block:'nearest',behavior:'smooth'}); }
      else if (button.dataset.collectionCancel) await write('/api/collection/jobs/' + endpoint(button.dataset.collectionCancel) + '/cancel',{}, {revision:false,description:'collection stop request',message:'Stop requested. Completed original results remain retained.'});
      else if (button.id === 'collection-reload') await refresh();
      else if (button.id === 'collection-upload-continue') await pumpUploads();
      else if (button.id === 'collection-source-clear') { sourceSelection.clear(); renderSources(); renderControls(); }
      else if (button.id === 'collection-source-previous') { sourceOffset = Math.max(0,sourceOffset - PAGE); renderSources(); }
      else if (button.id === 'collection-source-next') { sourceOffset += PAGE; renderSources(); }
      else if (button.id === 'collection-result-previous') { resultOffset = Math.max(0,resultOffset - PAGE); renderResults(); }
      else if (button.id === 'collection-result-next') { resultOffset += PAGE; renderResults(); }
      else if (button.id === 'collection-job-more') { jobLimit += 15; renderJobs(); renderControls(); }
      else if (button.id === 'collection-collect') await collect();
      else if (button.id === 'collection-retry') await collect(true);
      else if (button.id === 'collection-refresh') await write('/api/collection/' + endpoint(selected) + '/refresh',{}, {description:'retained collection refresh',message:'Original retained collection results refreshed.'});
      else if (button.id === 'collection-publish') {
        if (!selected || !results().some(row => row.resultSha256)) throw new Error('Collect at least one original result before publishing.');
        if (working()) throw new Error('Finish or stop the current operation before publishing its retained results.');
        await write('/api/collection/' + endpoint(selected) + '/publish',{}, {description:'original verification-file publication',message:'Publishing original results into the existing accounting sources.'});
      }
    });
  },{signal:listeners.signal});
  root.addEventListener('change',event => {
    const input = event.target;
    if (input.dataset.collectionSource) { input.checked ? sourceSelection.add(input.dataset.collectionSource) : sourceSelection.delete(input.dataset.collectionSource); renderSources(); renderControls(); }
    else if (input.dataset.collectionRetry) { input.checked ? retrySelection.add(input.dataset.collectionRetry) : retrySelection.delete(input.dataset.collectionRetry); renderResults(); renderControls(); }
    else if (input.id === 'collection-source-all') { for (const row of sourceMatches().slice(sourceOffset,sourceOffset + PAGE)) input.checked ? sourceSelection.add(row.id) : sourceSelection.delete(row.id); renderSources(); renderControls(); }
    else if (input.id === 'collection-retry-all') { for (const row of resultMatches().slice(resultOffset,resultOffset + PAGE).filter(row => row.verdict === 'NOT_RECONCILED')) input.checked ? retrySelection.add(row.id) : retrySelection.delete(row.id); renderResults(); renderControls(); }
    else if (input.id === 'collection-select') safe(() => choose(input.value));
  },{signal:listeners.signal});
  $('run-name').addEventListener('input',() => { $('run-name').dataset.dirty = 'true'; },{signal:listeners.signal});
  document.addEventListener('visibilitychange',() => { if (!document.hidden && saved.jobs.some(active)) safe(refresh); else schedule(); },{signal:listeners.signal});
  // The host's original perform owns its busy state and saved-draft reapply.
  // Reconcile these controls after its global button update completes.
  const busyObserver = new MutationObserver(renderControls);
  busyObserver.observe(document.body,{attributes:true,attributeFilter:['class']});
  render();
  return {refresh,destroy() { destroyed = true; ++requestSequence; clearTimeout(timer); listeners.abort(); busyObserver.disconnect(); }};
}
