// MIT — SF88 private, offline cross-intent history. Original buyer results remain authoritative.
// Pure renderer: no filesystem, network, signer, payment or ledger operation.

const STATES = [
  ['QUEUED', 'Queued'],
  ['RUNNING_OR_INTERRUPTED', 'Running or interrupted'],
  ['ATTEMPT_RECORDED', 'Attempt recorded'],
  ['RECOVERED', 'Evidence recovered'],
  ['CANCELLED', 'Cancelled'],
  ['REVIEW_REQUIRED', 'Local record needs review'],
];
const LABELS = new Map(STATES);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, fallback = 'Not recorded') => {
  if (value === null || value === undefined || value === '') return fallback;
  if (!['string', 'number', 'boolean', 'bigint'].includes(typeof value)) return fallback;
  return String(value);
};
const escape = value => text(value, '').replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
}[c]));
const code = value => `<code>${escape(text(value))}</code>`;
const field = (label, value) => `<div><dt>${escape(label)}</dt><dd>${code(value)}</dd></div>`;
const fields = values => `<dl>${values.map(([label, value]) => field(label, value)).join('')}</dl>`;
const section = (title, content) => `<section class="section"><h3>${escape(title)}</h3>${content}</section>`;
const shellQuote = value => "'" + String(value).replace(/'/g, "'\\''") + "'";
const command = (verb, root, intentId) =>
  `node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs ${verb} --root ${shellQuote(root)} --intent ${shellQuote(intentId)}`;
const nativeSummary = job => object(job.outcome) ? job.outcome : {};
const recoveryOf = job => object(job.recovery) ? job.recovery : {};
const intentOf = job => text(job.operation?.intentId ?? job.id);

function reportOutcome(job) {
  const recovered = recoveryOf(job);
  const summary = nativeSummary(job);
  const report = recovered.report ?? recovered.originalOutcomeReport ?? summary.originalOutcomeReport;
  if (!Array.isArray(report?.outcomes)) return null;
  return report.outcomes.find(value => object(value) && value.intentId === intentOf(job)) ?? null;
}

function errorFields(job) {
  const original = nativeSummary(job);
  const storedError = job.lastError ?? job.error;
  const error = object(storedError) ? storedError : typeof storedError === 'string' ? {code:storedError} : {};
  const rows = [
    ['Queue error', error.code],
    ['Queue failure payment-sent state', error.paymentSent === null ? 'Unknown' : error.paymentSent],
    ['Queue failure interruption state', error.interrupted],
    ['Original buyer error', original.error?.code],
    ['Payment sent, as reported by the original buyer', original.error?.paymentSent],
    ['Original evidence error', original.evidenceError?.code],
    ['Response cleanup error', original.responseCleanupError?.code],
    ['Interrupted', original.interrupted],
  ].filter(([, value]) => value !== undefined && value !== null);
  return rows.length ? section('Recorded errors and interruption', fields(rows)) : '';
}

function responseDetails(summary, title = 'Response file') {
  const output = summary.responseFile;
  if (!object(output)) return section(title, '<p>File saving was not recorded for this attempt.</p>');
  const rows = [
    ['Status', output.status], ['Destination', output.destination ?? output.path],
    ['Saved path', output.path], ['Bytes', output.bytes], ['SHA-256', output.sha256],
    ['Content type', output.contentType], ['Partial path', output.partialPath],
    ['Failure code', output.code], ['Reason', output.reason], ['Cleanup error', output.cleanupError],
  ].filter(([, value]) => value !== undefined && value !== null);
  const warnings = Array.isArray(output.cleanupWarnings) ? output.cleanupWarnings.filter(object) : [];
  const warningHtml = warnings.length ? '<h4>Cleanup warnings</h4><ul>' + warnings.map(w =>
    `<li>${code(w.code)}${w.path ? ' — ' + code(w.path) : ''}</li>`).join('') + '</ul>' : '';
  return section(title, fields(rows) + warningHtml +
    (output.status === 'REQUIRES_ORIGINAL_DOWNLOAD_SUMMARY' ?
      '<p class="note">Recovery did not inspect this file or establish its bytes, hash, or completeness. Use the original download summary.</p>' :
      '<p class="note">A saved file describes local delivery. A failed or partial file does not undo an attempted payment.</p>'));
}

function recoveryDetails(job) {
  const recovery = recoveryOf(job);
  if (!Object.keys(recovery).length) return '';
  const metadata = object(recovery.evidence) ? recovery.evidence : recovery;
  const rows = [
    ['Recovery status', recovery.status], ['Recovered at', recovery.recoveredAt],
    ['Evidence schema', metadata.evidenceSchema], ['Evidence path', metadata.evidencePath ?? metadata.path],
    ['Evidence SHA-256', metadata.evidenceSha256 ?? metadata.sha256],
    ['Original observation time', metadata.observedAt], ['Original observation status', metadata.observationStatus],
    ['Reconciliation record', recovery.reconciliation?.status ?? metadata.reconciliationStatus],
    ['Body capture', recovery.bodyCapture?.status ?? metadata.bodyCaptureStatus],
    ['Evidence binding', recovery.binding],
  ].filter(([, value]) => value !== undefined && value !== null);
  return section('Recovered original evidence', fields(rows) +
    '<p class="note">Recovery reads the original saved checkout evidence. The financial-finalization command separately matches its complete approved request to this inbox and the existing spending ledger. Inspect the recorded binding and file-save outcome; reading evidence does not repeat the purchase.</p>');
}

function finalizationDetails(job) {
  const saved=job.lostOutputFinalization??job.finalization;
  if(!object(saved))return section('Accounting',job.lostOutputFinalizationError?
    fields([['Recovered accounting read',job.lostOutputFinalizationError]]):
    '<p>No financial-finalization result has been saved in this inbox.</p>');
  const result=object(saved.result)?saved.result:{};
  const last=object(saved.lastFinalized)?saved.lastFinalized:null;
  const rows=[
    ['Latest accounting result',result.outcome],['Checked at',saved.completedAt],
    ['Actual atomic units',result.actual],['Canonical transaction receipt',result.receipt_ref],
    ['Approved request SHA-256',saved.approvedRequestSha256??saved.requestSha256],['Finality proof SHA-256',result.proof_sha256],
    ['Chain observation',result.chainObservation],['Failure reason',result.reason],
    ['Merchant notification',result.merchant?.status],['Merchant order',result.merchant?.orderReference],
    ['Callback state',result.merchant?.callbackState],
    ['Recovered original attempt',job.lostOutputFinalization?.attemptId],
    ['Original output state',job.lostOutputFinalization?.evidenceState?.condition],
    ['Original output SHA-256',job.lostOutputFinalization?.evidenceState?.sha256],
    ['Recovery record authority',job.lostOutputFinalization?.recordAuthority],
    ['Recovered accounting read',job.lostOutputFinalizationError],
    ['Earlier finalized result',last&&last.completedAt!==saved.completedAt?last.result?.outcome:undefined],
    ['Earlier finalization time',last&&last.completedAt!==saved.completedAt?last.completedAt:undefined],
  ].filter(([,value])=>value!==undefined&&value!==null);
  return section('Accounting',fields(rows)+
    '<p class="note">This is the saved result from the original spending ledger. Repeating finalization checks or reuses that same transaction; it does not make another purchase. Merchant notification and completed file delivery remain separate outcomes.</p>');
}

function dependencyDetails(job) {
  if (!object(job.dependencies) && !Array.isArray(job.dependencies)) return '';
  const records = Array.isArray(job.dependencies) ? job.dependencies.map((item,index) => [item?.role ?? `File ${index + 1}`,item]) :
    Object.entries(job.dependencies);
  const rows = records.flatMap(([label, value]) => object(value) ? [
    [`${label}: file`, value.path ?? value.originalPath],
    [`${label}: SHA-256`, value.sha256 ?? value.digest],
  ].filter(([, fieldValue]) => fieldValue !== undefined) : []);
  return rows.length ? section('Pinned operator files', fields(rows) +
    '<p class="note">The queue checks these file identities before the original buyer runs. The live original policy still controls spending.</p>') : '';
}

function detail(job, queueRoot, commandFor, accountingWorkspace) {
  const op = object(job.operation) ? job.operation : {};
  const terms = object(op.expect) ? op.expect : {};
  const original = nativeSummary(job);
  const observed = reportOutcome(job);
  const recovery = recoveryOf(job);
  const reservation = original.operatorReservation ?? recovery.operatorReservation ?? {};
  const reviewed = section('Saved request', fields([
    ['Stable intent', intentOf(job)], ['Method', op.method], ['Resource URL', op.url],
    ['Network', terms.network], ['Asset', terms.asset], ['Recipient', terms.payTo],
    ['Maximum atomic units', terms.maxAtomic], ['Maximum timeout, seconds', terms.maxTimeoutSeconds],
    ['Configuration SHA-256', job.configSha256], ['Request body SHA-256', job.bodySha256],
    ['Original configuration SHA-256', job.sourceConfigSha256],
    ['Request body bytes', job.bodyBytes], ['Configured response destination', job.responseDestination],
    ['Queued at', job.createdAt],
  ]));
  const attempt = section('Local attempt', fields([
    ['Queue state', job.state], ['Attempt identifier', job.attempt?.id],
    ['Attempt started', job.attempt?.startedAt],
    ['Original reservation identifier', reservation.request_id ?? reservation.requestId],
    ['Original reservation state', reservation.outcome],
    ['Reserved atomic units', reservation.reserved_atomic_units ?? reservation.reservedAtomicUnits],
    ['Original evidence path', original.evidencePath ?? recovery.evidencePath],
  ]));
  const result = section('Original buyer and chain outcome', fields([
    ['Original buyer status', original.status], ['Original HTTP status', original.httpStatus],
    ['Seller-reported settlement', typeof original.sellerReportedSettlement === 'string' ?
      original.sellerReportedSettlement : original.sellerReportedSettlement?.success],
    ['Original SF52 classification', observed?.status],
    ['Signed attempt', observed?.signedAttempt],
    ['Independently verified transfer', observed?.independentlyVerifiedTransfer],
    ['HTTP body observed by the evidence adapter', observed?.observedHttpBody],
    ['Original chain evidence', observed?.chainEvidence], ['Ledger', observed?.ledger],
    ['Original retry policy', original.retry],
  ]) + '<p class="note">Atomic units stay grouped by their original asset and network. Queue activity, HTTP delivery, and a seller receipt are not booked revenue.</p>');
  const action = job.state === 'QUEUED' ? 'execute' : 'recover';
  const actionCopy = job.state === 'REVIEW_REQUIRED' ?
    'This saved record could not be read consistently. Inspect its original private files and the recorded error before using the operation.' : job.state === 'CANCELLED' ?
    'This request was cancelled locally before a queue execution. Its original saved identity remains in history.' : job.state === 'QUEUED' ?
    'To run this exact queued request, use the trusted terminal. The original buyer still obtains fresh terms and operator approval.' :
    'Inspect this attempt and recover any original terminal evidence before deciding what happened. The permanent attempt marker prevents another queue execution.';
  const workspace=accountingWorkspace??job.lostOutputFinalization?.workspace??job.finalization?.workspace;
  const accountingVerb=job.lostOutputFinalization?'read-lost-output':'finalize';
  const finalizeCommand=job.attempt?.kind==='EXECUTE'&&typeof workspace==='string'&&workspace?
    command(accountingVerb,queueRoot,intentOf(job))+' --workspace '+shellQuote(workspace):null;
  const actions = section('Operator commands', `<p>${escape(actionCopy)}</p>` +
    `<h4>Inspect saved history</h4><pre>${escape(commandFor('show', queueRoot, intentOf(job)))}</pre>` +
    (!['CANCELLED','REVIEW_REQUIRED'].includes(job.state) ? `<h4>${action === 'execute' ? 'Execute this one intent' : 'Read original evidence'}</h4><pre>${escape(commandFor(action, queueRoot, intentOf(job)))}</pre>` : '') +
    (finalizeCommand?`<h4>${job.lostOutputFinalization?'Read recovered payment accounting':'Finalize original payment accounting'}</h4><pre>${escape(finalizeCommand)}</pre>`:'')+
    '<p class="note">These are copyable commands only. This report has no execution controls and contacts no service.</p>');
  const recoveredFile = object(recovery.deliveryFile) ?
    responseDetails({responseFile:recovery.deliveryFile}, 'Response-file recovery status') : '';
  return `<div class="detail-grid">${reviewed}${dependencyDetails(job)}${attempt}${result}${finalizationDetails(job)}${responseDetails(original)}${recoveryDetails(job)}${recoveredFile}${errorFields(job)}${actions}</div>`;
}

function row(job, index, queueRoot, commandFor, accountingWorkspace) {
  const intent = intentOf(job);
  const original = nativeSummary(job);
  const observed = reportOutcome(job);
  const recovery = recoveryOf(job);
  const output = original.responseFile ?? recovery.deliveryFile;
  const state = text(job.state);
  const id = `intent-${index + 1}`;
  const search = [intent, job.operation?.url, job.operation?.method, state,
    job.operation?.expect?.asset, job.operation?.expect?.network,
    original.status, observed?.status, original.error?.code].map(value => text(value, '')).join(' ').toLowerCase();
  const outcome = observed?.status ?? recovery.observationStatus ?? original.status;
  const accounting=(job.lostOutputFinalization??job.finalization)?.result?.outcome??job.lostOutputFinalizationError;
  return `<tbody class="job" data-state="${escape(state)}" data-search="${escape(search)}">
    <tr class="summary-row">
      <th scope="row"><a href="#${id}">${escape(intent)}</a><span class="resource">${escape(job.operation?.method ?? '')} ${escape(job.operation?.url ?? '')}</span></th>
      <td><span class="state">${escape(LABELS.get(state) ?? state)}</span></td>
      <td>${code(outcome)}${observed ? '<span class="source-label">Original SF52</span>' : recovery.observationStatus ? '<span class="source-label">Original evidence</span>' : original.status ? '<span class="source-label">Original buyer</span>' : ''}${accounting?'<span class="source-label">Accounting: '+escape(accounting)+'</span>':''}</td>
      <td>${code(output?.status)}${output?.bytes !== undefined ? `<span class="source-label">${escape(output.bytes)} bytes</span>` : ''}${!original.responseFile && recovery.deliveryFile ? '<span class="source-label">Recovery record</span>' : ''}</td>
      <td>${code(job.attempt?.startedAt ?? job.createdAt)}<span class="source-label">${job.attempt?.startedAt ? 'Attempt started' : 'Queued'}</span></td>
    </tr>
    <tr class="detail-row"><td colspan="5"><details id="${id}"><summary>Request, result and recovery details</summary>${detail(job, queueRoot, commandFor, accountingWorkspace)}</details></td></tr>
  </tbody>`;
}

/** Render original queue records. A trusted embedding can supply its own workspace-aware commands. */
export function renderQueueReport({jobs, queueRoot, accountingWorkspace, generatedAt = new Date().toISOString(), commandFor = command} = {}) {
  if (!Array.isArray(jobs) || jobs.length > 10000 || !jobs.every(object))
    throw new TypeError('QUEUE_REPORT_JOBS_INVALID');
  if (typeof queueRoot !== 'string' || !queueRoot || queueRoot.includes('\0'))
    throw new TypeError('QUEUE_REPORT_ROOT_REQUIRED');
  if(accountingWorkspace!==undefined&&(typeof accountingWorkspace!=='string'||
    !accountingWorkspace.startsWith('/')||accountingWorkspace.includes('\0')))
    throw new TypeError('QUEUE_REPORT_WORKSPACE_INVALID');
  if (typeof generatedAt !== 'string' || !Number.isFinite(Date.parse(generatedAt)))
    throw new TypeError('QUEUE_REPORT_TIME_INVALID');
  if (typeof commandFor !== 'function') throw new TypeError('QUEUE_REPORT_COMMAND_FACTORY_INVALID');
  const operatorCommand = (verb, root, intent) => {
    const value = commandFor(verb, root, intent);
    if (typeof value !== 'string' || !value || value.length > 32768 || value.includes('\0'))
      throw new TypeError('QUEUE_REPORT_COMMAND_INVALID');
    return value;
  };
  const counts = new Map(STATES.map(([state]) => [state, jobs.filter(job => job.state === state).length]));
  const controls = STATES.map(([state, label]) => `<button type="button" data-filter="${state}" aria-pressed="false">${escape(label)} <span>${counts.get(state)}</span></button>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; connect-src 'none'">
<meta name="referrer" content="no-referrer"><title>Buyer inbox — private operation history</title>
<style>
  :root{color-scheme:light;--ink:#171717;--muted:#626262;--line:#d5d5d5;--paper:#fff;--soft:#f4f4f4}
  *{box-sizing:border-box}body{margin:0;color:var(--ink);background:var(--paper);font:15px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  main{max-width:1440px;margin:auto;padding:36px 30px 60px}header{border-bottom:2px solid var(--ink);padding-bottom:24px}
  .eyebrow{font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--muted);margin:0 0 8px}h1{font-size:32px;line-height:1.15;letter-spacing:-.035em;margin:0 0 14px;font-weight:650}
  h2{font-size:18px;margin:0 0 14px}h3{font-size:14px;margin:0 0 12px}h4{font-size:12px;margin:14px 0 5px}p{margin:8px 0}.intro{max-width:850px;color:#444}
  .meta{display:flex;gap:10px 28px;flex-wrap:wrap;color:var(--muted);font-size:12px;margin-top:16px}.meta code{font-size:11px}
  .metrics{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);margin:24px 0}.metric{padding:16px 20px;border-right:1px solid var(--line)}.metric:last-child{border:0}.metric strong{display:block;font-size:28px;font-weight:600;font-variant-numeric:tabular-nums}.metric span{font-size:12px;color:var(--muted)}
  .toolbar{display:flex;justify-content:space-between;gap:16px;align-items:end;flex-wrap:wrap;margin:24px 0 14px}.filters{display:flex;gap:6px;flex-wrap:wrap}.filters button{font:inherit;font-size:12px;border:1px solid var(--line);background:var(--paper);color:var(--ink);padding:7px 10px;border-radius:2px;cursor:pointer}.filters button[aria-pressed=true]{background:var(--ink);color:var(--paper);border-color:var(--ink)}.filters button span{margin-left:5px;opacity:.7}button:focus-visible,input:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid var(--ink);outline-offset:3px}
  label{display:block;font-size:12px;font-weight:600;margin-bottom:5px}input{font:inherit;font-size:13px;width:min(320px,80vw);padding:8px 10px;border:1px solid #aaa;border-radius:2px;background:var(--paper);color:var(--ink)}
  .table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px;text-align:left;table-layout:fixed}thead th{background:var(--soft);font-size:11px;text-transform:uppercase;letter-spacing:.05em;padding:12px 14px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}thead th:first-child{width:31%}thead th:nth-child(2){width:17%}thead th:nth-child(3){width:22%}thead th:nth-child(4){width:12%}thead th:nth-child(5){width:18%}
  .summary-row>th,.summary-row>td{padding:15px 14px 9px;vertical-align:top;font-weight:400;overflow-wrap:anywhere}.summary-row>th a{font-weight:650;text-decoration:none;color:var(--ink)}.summary-row>th a:hover{text-decoration:underline}.resource{display:block;font-size:12px;color:var(--muted);margin-top:5px;overflow-wrap:anywhere}.state{display:inline-block;padding:2px 6px;border:1px solid #bcbcbc;border-radius:2px;font-size:11px}
  code,pre{font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:11px;overflow-wrap:anywhere}pre{white-space:pre-wrap;background:var(--soft);border:1px solid var(--line);padding:11px;line-height:1.6}.source-label{display:block;color:var(--muted);font-size:10px;margin-top:4px}.detail-row>td{padding:0 14px 13px;border-bottom:1px solid var(--line)}summary{cursor:pointer;color:var(--muted);font-size:12px;padding:4px 0;width:fit-content}details[open]>summary{color:var(--ink);font-weight:600}
  .detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;padding:18px 0 8px}.section{border-top:1px solid var(--line);padding-top:13px;min-width:0}.section>p{font-size:12px}dl{margin:0}dl>div{display:grid;grid-template-columns:minmax(115px,37%) minmax(0,1fr);gap:12px;padding:5px 0;border-bottom:1px solid #eee}dt{font-size:11px;color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}.note{color:var(--muted);font-size:11px!important}ul{padding-left:20px;font-size:12px}
  .empty{border:1px solid var(--line);padding:30px;text-align:center;color:var(--muted)}.visibility{font-size:12px;color:var(--muted);margin:10px 0}footer{border-top:1px solid var(--line);margin-top:28px;padding-top:16px;color:var(--muted);font-size:11px;max-width:1000px}[hidden]{display:none!important}
  @media(max-width:800px){main{padding:24px 16px 40px}.metrics{grid-template-columns:repeat(2,1fr)}.metric:nth-child(2){border-right:0}.metric:nth-child(-n+2){border-bottom:1px solid var(--line)}.detail-grid{grid-template-columns:1fr}table{min-width:820px}h1{font-size:28px}}
  @media print{main{max-width:none;padding:0}.toolbar{display:none}.metrics{margin:16px 0}.table-wrap{overflow:visible}table{min-width:0}thead{display:table-header-group}.job{break-inside:avoid}.section{break-inside:avoid}.detail-grid{display:block}.section{margin-top:14px}.resource{color:#333}a{text-decoration:none}.job[hidden]{display:table-row-group!important}}
</style></head><body><main>
<header><p class="eyebrow">Stellar buyer operations · private local report</p><h1>Buyer inbox</h1>
<p class="intro">Saved requests and original attempt history in one place. Review interrupted work, find returned files, and recover the existing evidence without repeating a purchase.</p>
<div class="meta"><span>Queue ${code(queueRoot)}</span><span>Exported ${code(generatedAt)}</span><span>Static snapshot · no background refresh</span></div></header>
<div class="metrics" aria-label="Local queue counts">
<div class="metric"><strong>${jobs.length}</strong><span>Saved intents</span></div>
<div class="metric"><strong>${counts.get('QUEUED')}</strong><span>Queued</span></div>
<div class="metric"><strong>${counts.get('RUNNING_OR_INTERRUPTED')}</strong><span>Running or interrupted</span></div>
<div class="metric"><strong>${counts.get('ATTEMPT_RECORDED') + counts.get('RECOVERED')}</strong><span>Attempts with recorded outcomes</span></div></div>
<h2>Operation history</h2><p class="note">Queue states describe local lifecycle. Buyer, chain, and response-file results retain their original meanings. A running marker alone cannot say whether a payment was sent.</p>
<div class="toolbar"><div class="filters" role="group" aria-label="Filter queue state"><button type="button" data-filter="ALL" aria-pressed="true">All <span>${jobs.length}</span></button>${controls}</div><div><label for="search">Find an intent or resource</label><input id="search" type="search" placeholder="Intent, URL, asset, outcome" autocomplete="off"></div></div>
<p class="visibility" id="visible-count" aria-live="polite">Showing ${jobs.length} of ${jobs.length} intents</p>
${jobs.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">Intent / resource</th><th scope="col">Queue state</th><th scope="col">Original outcome</th><th scope="col">Response file</th><th scope="col">Time</th></tr></thead>${jobs.map((job,index) => row(job,index,queueRoot,operatorCommand,accountingWorkspace)).join('')}</table></div><p class="empty" id="no-matches" hidden>No intents match the current filter.</p>` : '<p class="empty">No requests have been added. Enqueue an existing operator-reviewed SF88 configuration to begin.</p>'}
<footer>Keep this report private: it contains original resource identities, prices, operation IDs and local file paths. No signer, secret, request body, cookie, authorization header or whole raw evidence object is embedded by this renderer. The original SF81/SF36 approval and reservation, SF31 buyer and response writer, and SF82/SF52 evidence remain authoritative. This exported page makes no network requests, reserves no funds and releases no budget.</footer>
</main><script>
(()=>{'use strict';const rows=Array.from(document.querySelectorAll('tbody.job'));const buttons=Array.from(document.querySelectorAll('[data-filter]'));const search=document.getElementById('search');const count=document.getElementById('visible-count');const empty=document.getElementById('no-matches');let state='ALL';function update(){const query=search.value.trim().toLowerCase();let visible=0;for(const row of rows){row.hidden=!(state==='ALL'||row.dataset.state===state)||!row.dataset.search.includes(query);if(!row.hidden)visible++;}count.textContent='Showing '+visible+' of '+rows.length+' intents';if(empty)empty.hidden=visible!==0;}for(const button of buttons)button.addEventListener('click',()=>{state=button.dataset.filter;for(const other of buttons)other.setAttribute('aria-pressed',String(other===button));update();});search.addEventListener('input',update);for(const link of document.querySelectorAll('.summary-row a'))link.addEventListener('click',()=>{const target=document.getElementById(link.getAttribute('href').slice(1));if(target)target.open=true;});let opened=[];window.addEventListener('beforeprint',()=>{opened=Array.from(document.querySelectorAll('details')).filter(item=>!item.open);for(const item of opened)item.open=true;});window.addEventListener('afterprint',()=>{for(const item of opened)item.open=false;opened=[];});})();
</script></body></html>`;
}
