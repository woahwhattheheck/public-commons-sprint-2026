// MIT. No browser persistence, outside requests or duplicated financial calculations.
const $ = id => document.getElementById(id);
let current, draft, selected = 0, editRevision = null, dirty = false, busy = false, pendingSave = null;
const text = (tag,value,className) => { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node; };
const money = value => value === null ? 'Unknown' : '$' + value;
function notice(message,error = false) { $('notice').textContent = message; $('notice').dataset.error = String(error); }
async function api(path,input) {
  const response = await fetch(path,{method:input === undefined ? 'GET' : 'POST',
    headers:input === undefined ? {} : {'content-type':'application/json','x-sf97-workspace':current.token},
    ...(input === undefined ? {} : {body:JSON.stringify(input)})});
  let value;
  try { value = await response.json(); } catch { throw new Error('Workspace response was interrupted. Retry the same save to recover it.'); }
  if (!response.ok) throw new Error(value.message || 'Workspace operation failed.');
  return value;
}
function markDirty() {
  dirty = true; pendingSave = null; $('save-state').textContent = 'Unsaved changes'; $('preview-panel').hidden = true;
}
async function run(task) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button,input,textarea').forEach(node => { node.disabled = true; });
  try { await task(); } catch (error) { notice(error.message,true); }
  finally { busy = false; document.querySelectorAll('button,input,textarea').forEach(node => { node.disabled = false; }); }
}
function field(title,value,{optional = false,multiline = false,onchange,hint} = {}) {
  const label = text('label',title), input = document.createElement(multiline ? 'textarea' : 'input');
  input.value = value ?? ''; input.setAttribute('aria-label',title);
  if (!multiline) input.inputMode = 'decimal';
  if (optional) input.placeholder = 'Unknown';
  if (multiline) { input.maxLength = 300; label.className = 'full'; }
  input.addEventListener('input',() => { onchange(optional && input.value.trim() === '' ? null : input.value.trim()); markDirty(); });
  label.append(input);
  if (hint) label.append(text('small',hint));
  return label;
}
function renderEditor() {
  const route = current.seller.routes[selected], input = draft.routes[route.routeId], editor = $('editor');
  editor.replaceChildren(text('h2',route.routeId,'route-title'),text('p',`${route.method} ${route.path}`,'route-path'));
  const fields = document.createElement('div'); fields.className = 'fields';
  fields.append(field('Quoted unit value · USD',input.unitPriceUsd,{onchange:value => { input.unitPriceUsd = value; },hint:'Your agreed quote or valuation per fulfilled request.'}),
    field('Monthly paid-volume target',String(input.monthlyPaidTarget),{onchange:value => {
      input.monthlyPaidTarget = /^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : value;
    },hint:'A merchant target, separate from observed HTTP attempts.'}),
    field('Cost per fulfilled request · USD',input.perFulfilledUsd,{optional:true,onchange:value => { input.perFulfilledUsd = value; }}),
    field('Cost per 402 challenge · USD',input.perChallengeUsd,{optional:true,onchange:value => { input.perChallengeUsd = value; }}),
    field('Quote basis',input.priceBasis,{multiline:true,onchange:value => { input.priceBasis = value; },hint:'Describe the approved quote or valuation and its scope.'}));
  editor.append(fields,text('h3',`Payment choices · ${route.paymentOptions.length}`),
    text('p','The commercial assumptions above apply to every configured choice on this service.','muted small'));
  route.paymentOptions.forEach((option,index) => {
    const details = document.createElement('details'); details.className = 'payment'; details.open = index === 0;
    const heading = text('summary',`${index+1}. ${option.network} · ${option.atomicAmount} atomic units`);
    heading.append(text('span',`${option.scheme} · timeout ${option.maxTimeoutSeconds}s`,'payment-label'));
    const terms = document.createElement('dl');
    for (const [key,value] of [['Asset',option.asset],['Recipient',option.payTo]]) terms.append(text('dt',key),text('dd',value));
    details.append(heading,terms);
    if (Object.hasOwn(option,'extra')) details.append(text('pre',JSON.stringify(option.extra,null,2)));
    editor.append(details);
  });
}
function renderRoutes() {
  $('routes').replaceChildren();
  current.seller.routes.forEach((route,index) => {
    const button = text('button',route.routeId); button.type = 'button';
    button.setAttribute('aria-current',String(index === selected));
    button.append(text('small',`${route.method} ${route.path}`));
    button.addEventListener('click',() => { selected = index; renderRoutes(); renderEditor(); }); $('routes').append(button);
  });
  $('route-count').textContent = `${current.seller.routes.length} services · ${current.seller.routes.reduce((sum,route) => sum+route.paymentOptions.length,0)} payment choices`;
}
function renderSource() {
  $('source-name').textContent = current.seller.name;
  $('session-name').textContent = current.snapshot ? `${current.snapshot.mode} · ${current.snapshot.sessionId}` : 'Unavailable';
  $('captured').textContent = current.snapshot?.capturedAt ?? '—'; $('config-hash').textContent = current.seller.sha256;
  $('native-status').textContent = current.nativeAttached
    ? 'Native settlement companion attached. Each saved review also includes the original option and delivery reconciliation.'
    : 'Original SF97 report. A merchant can attach its existing native outbox when starting this workspace.';
}
function reportLink(version,name,label) {
  const anchor = text('a',label); anchor.href = '/files/'+version+'/'+name; anchor.target = '_blank'; anchor.rel = 'noopener'; return anchor;
}
function renderHistory() {
  $('history').replaceChildren(); $('history-count').textContent = `${current.history.length} recent versions`;
  if (!current.history.length) { $('history').append(text('p','No saved reviews yet.','muted')); return; }
  current.history.forEach(item => {
    const row = document.createElement('article'); row.className = 'history-item';
    const description = document.createElement('div'); description.append(text('div',item.label,'history-title'),
      text('div',`${item.savedAt} · Target gross ${money(item.overview.plannedMonthlyTargetGrossUsd)} · After fixed ${money(item.overview.plannedMonthlyTargetContributionAfterFixedUsd)}`,'history-meta'));
    const links = document.createElement('div'); links.className = 'history-files';
    links.append(reportLink(item.version,'terms.json','Merchant terms'),reportLink(item.version,'report/report.json','Report JSON'),
      reportLink(item.version,'snapshot.json','Original operations capture'),reportLink(item.version,'manifest.json','Version manifest'));
    description.append(links);
    const nativeFiles = item.files.filter(name => name.startsWith('report/native-settlement/'));
    if (nativeFiles.length) {
      const details = document.createElement('details'), content = document.createElement('div'); content.className = 'history-files';
      details.append(text('summary','Native settlement companion'));
      nativeFiles.forEach(name => content.append(reportLink(item.version,name,name.split('/').at(-1)))); details.append(content); description.append(details);
    }
    const actions = document.createElement('div'); actions.className = 'button-row';
    const report = reportLink(item.version,'report/review.html','Open report'); report.className = 'button';
    const reuse = text('button','Use assumptions'); reuse.type = 'button';
    reuse.addEventListener('click',() => run(async () => {
      if (dirty && !window.confirm('Replace the unsaved form with this saved review’s commercial assumptions?')) return;
      const latest = await api('/api/state');
      const loaded = await api('/api/load-version',{version:item.version});
      if (loaded.sellerSha256 !== latest.seller.sha256) throw new Error('Seller configuration changed while loading. Refresh operations and try again.');
      current = latest; draft = loaded.commercial; editRevision = current.revision; selected = 0;
      $('review-name').value = item.label + ' revision';
      renderInputs(); markDirty(); notice('Saved assumptions loaded. Review all current payment choices, then save a new version.');
    }));
    actions.append(report,reuse); row.append(description,actions); $('history').append(row);
  });
}
function renderInputs() {
  $('merchant-name').value = draft.merchantName; $('fixed-cost').value = draft.sharedMonthlyFixedUsd ?? '';
  renderSource(); renderRoutes(); renderEditor(); renderHistory();
}
function renderReport(report,caption = 'Calculated from this capture') {
  const overview = report.overview;
  $('preview-panel').hidden = false; $('preview-caption').textContent = caption + ' · ' + report.observedUntil;
  $('totals').replaceChildren();
  for (const [label,value] of [['Monthly target gross',overview.plannedMonthlyTargetGrossUsd],
    ['Monthly target variable cost',overview.plannedMonthlyTargetVariableCostsUsd],
    ['Contribution after fixed cost',overview.plannedMonthlyTargetContributionAfterFixedUsd]]) {
    const card = document.createElement('div'); card.className = 'total'; card.append(text('span',label),text('strong',money(value))); $('totals').append(card);
  }
  $('preview-rows').replaceChildren();
  report.routes.forEach(route => {
    const tr = document.createElement('tr');
    [route.routeId,route.actualAttempts,route.actual402,route.actual2xx,route.plannedMonthlyTargetGrossUsd,
      route.plannedMonthlyTargetContributionBeforeFixedUsd ?? 'Unknown'].forEach(value => tr.append(text('td',value)));
    $('preview-rows').append(tr);
  });
  $('issues').replaceChildren();
  report.issues.forEach(issue => $('issues').append(text('li',`${issue.routeId}: ${issue.flag}`)));
  if (overview.unknownCostRoutes.length) $('issues').append(text('li','Some costs remain unknown on: '+overview.unknownCostRoutes.join(', ')+'.'));
}
function payload() {
  if (!current.snapshot) throw new Error('Restore the operations snapshot and refresh before calculating this review.');
  return {sellerSha256:current.seller.sha256,snapshotSha256:current.snapshot.sha256,commercial:structuredClone(draft)};
}
$('merchant-name').addEventListener('input',() => { draft.merchantName = $('merchant-name').value; markDirty(); });
$('fixed-cost').addEventListener('input',() => { draft.sharedMonthlyFixedUsd = $('fixed-cost').value.trim() || null; markDirty(); });
$('review-name').addEventListener('input',markDirty);
$('refresh').addEventListener('click',() => run(async () => {
  const latest = await api('/api/state'), changed = latest.seller.sha256 !== current.seller.sha256;
  const moved = latest.revision !== editRevision;
  if (changed) {
    const previous = draft;
    draft = latest.commercial; draft.merchantName = previous.merchantName; draft.sharedMonthlyFixedUsd = previous.sharedMonthlyFixedUsd;
    for (const route of latest.seller.routes) if (Object.hasOwn(previous.routes,route.routeId)) draft.routes[route.routeId] = previous.routes[route.routeId];
    selected = Math.min(selected,latest.seller.routes.length-1);
  }
  current = latest; pendingSave = null; $('preview-panel').hidden = true; renderInputs();
  notice(current.sourceError || (moved ? 'Another tab saved a newer review. Use its assumptions from Saved reviews before saving this form.'
    : changed ? 'Seller configuration changed. Your entered assumptions are retained for matching services; review the new payment choices.'
    : 'Original operations capture refreshed. Your commercial inputs are retained.'),Boolean(current.sourceError || moved));
}));
$('preview').addEventListener('click',() => run(async () => {
  const report = await api('/api/preview',payload()); renderReport(report); notice('Commercial review calculated with the original merchant analyzer.');
}));
$('save').addEventListener('click',() => run(async () => {
  pendingSave ??= {...payload(),expectedRevision:editRevision,requestId:crypto.randomUUID(),label:$('review-name').value.trim()};
  const result = await api('/api/save',pendingSave);
  editRevision = result.revision; dirty = false;
  $('save-state').textContent = 'Saved · '+result.label;
  // A confirmed save stays confirmed even when the following refresh fails.
  // Retain its request until refresh succeeds so a retry recovers the same save.
  try {
    current = await api('/api/state'); draft = current.commercial;
    editRevision = current.revision; pendingSave = null; renderInputs();
  } catch {
    notice('Review saved. The latest workspace state could not be loaded; refresh operations or retry to recover this same version.');
    return;
  }
  notice(result.recovered ? 'The previous save completed. Its original version has been recovered.' : 'Review saved. Open the original report or download its merchant terms below.');
}));
window.addEventListener('beforeunload',event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
run(async () => {
  current = await api('/api/state'); draft = current.commercial; editRevision = current.revision; renderInputs();
  $('save-state').textContent = current.revision ? 'Loaded latest saved assumptions' : 'Unsaved review';
  notice(current.sourceError || (current.sellerChanged ? 'Seller configuration has changed since the latest review. Review its current payment choices before saving.'
    : 'Enter merchant pricing assumptions, then calculate or save a review.'),Boolean(current.sourceError));
});
