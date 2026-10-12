// MIT. Original reports only: no browser persistence or financial recalculation.
const $ = id => document.getElementById(id);
const SESSION = 'SESSION', PERIOD = 'DURABLE_HISTORY';
let current, draft, selected = 0, editRevision = null, dirty = false, busy = false, pendingSave = null, sourceDirty = false;
// Keep explicit atomic strings and their saved source separate from USD edits.
let repricingSource = null, repricingAmounts = new Map(), repricingPreview = null;
let repricingDirty = false, repricingEditRevision = null, pendingRepricingSave = null;
let repricingRoutePage = 0;
const REPRICING_ROUTES_PER_PAGE = 8;
const text = (tag,value,className) => { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node; };
const money = value => value === null || value === undefined ? 'Unknown' : '$' + value;
const shown = value => value === null || value === undefined ? '—' : String(value);
const sourceName = kind => kind === PERIOD ? 'Retained period' : 'Current session';
function notice(message,error = false) { $('notice').textContent = message; $('notice').dataset.error = String(error); }
function lock(node,disabled) { node.dataset.locked = String(disabled); node.disabled = busy || disabled; }
function controls() {
  document.querySelectorAll('button,input,textarea,select').forEach(node => { node.disabled = busy || node.dataset.locked === 'true'; });
  if (!current) {
    document.querySelectorAll('button,input,textarea,select').forEach(node => { node.disabled = true; });
    $('refresh').disabled = busy; return;
  }
  const capabilities = current.sourceCapabilities ?? {kinds:[SESSION],periodEditable:false};
  const period = $('source-kind').value === PERIOD;
  $('period-controls').hidden = !period;
  lock($('source-kind'),capabilities.kinds.length < 2);
  for (const id of ['source-from','source-to','source-route']) lock($(id),!period || !capabilities.periodEditable);
  lock($('apply-source'),!sourceDirty);
  lock($('reset-source'),!sourceDirty);
  lock($('preview'),!current.snapshot || sourceDirty);
  lock($('save'),!current.snapshot || sourceDirty);
  const comparable = current.history.length > 1;
  lock($('compare-left'),!comparable); lock($('compare-right'),!comparable);
  lock($('compare'),!comparable || !$('compare-left').value || !$('compare-right').value || $('compare-left').value === $('compare-right').value);
  repricingControls();
}
async function api(path,input) {
  const response = await fetch(path,{method:input === undefined ? 'GET' : 'POST',
    headers:input === undefined ? {} : {'content-type':'application/json','x-sf97-workspace':current.token},
    ...(input === undefined ? {} : {body:JSON.stringify(input)})});
  let value;
  try { value = await response.json(); } catch { throw new Error('Workspace response was interrupted. Retry the same action to recover its result.'); }
  if (!response.ok) throw Object.assign(new Error(value.message || 'Workspace operation failed.'),{code:value.code,status:response.status});
  return value;
}
const readState = (selection = current?.selection) => selection ? api('/api/source',{selection}) : api('/api/state');
function markDirty() {
  dirty = true; pendingSave = null; $('save-state').textContent = 'Unsaved changes'; $('preview-panel').hidden = true;
}
async function run(task) {
  if (busy) return;
  busy = true; controls();
  try { await task(); } catch (error) { notice(error.message,true); }
  finally { busy = false; controls(); }
}
function table(rows,columns,emptyMessage = 'No retained rows in this source.') {
  if (!rows.length) return text('p',emptyMessage,'muted small');
  const wrapper = document.createElement('div'), scroller = document.createElement('div'), grid = document.createElement('table');
  scroller.className = 'table-scroll';
  const header = document.createElement('thead'), heading = document.createElement('tr'), body = document.createElement('tbody');
  for (const [label] of columns) { const cell = text('th',label); cell.scope = 'col'; heading.append(cell); }
  header.append(heading); grid.append(header,body); scroller.append(grid); wrapper.append(scroller);
  let page = 0; const size = 50, paging = document.createElement('div'); paging.className = 'table-paging';
  const previous = text('button','Previous rows'), next = text('button','Next rows'), caption = text('span','');
  previous.type = next.type = 'button';
  function render() {
    body.replaceChildren();
    for (const row of rows.slice(page * size,(page + 1) * size)) {
      const tr = document.createElement('tr');
      for (const [,get] of columns) { const value = get(row), cell = document.createElement('td');
        if (value instanceof Node) cell.append(value); else cell.textContent = shown(value); tr.append(cell); }
      body.append(tr);
    }
    caption.textContent = `${page * size + 1}–${Math.min((page + 1) * size,rows.length)} of ${rows.length} rows`;
    lock(previous,page === 0); lock(next,(page + 1) * size >= rows.length);
  }
  previous.addEventListener('click',() => { page--; render(); }); next.addEventListener('click',() => { page++; render(); });
  if (rows.length > size) { paging.append(previous,caption,next); wrapper.append(paging); }
  render(); return wrapper;
}
function identity(row) {
  const node = text('div',row.routeId ?? row.id); node.append(text('small',`${row.method} ${row.path}`,'route-identity')); return node;
}
const dayColumns = [['UTC day',row=>row.day],['Sessions',row=>row.sessions],['Attempts',row=>row.totals?.started],
  ['Completions',row=>row.totals?.completed],['402',row=>row.totals?.challenge],['2xx',row=>row.totals?.success],
  ['5xx',row=>row.totals?.serverError],['Disconnected',row=>row.totals?.disconnected],['P95 upper bound · ms',row=>row.totals?.latencyP95UpperBoundMs]];
const sessionColumns = [['Original session',row=>row.sessionId],['Mode',row=>row.mode],['State',row=>row.state],
  ['Started',row=>row.startedAt],['Captured',row=>row.capturedAt],['Last saved',row=>row.savedAt],
  ['Selected days',row=>row.matchingDays],['Outstanding at checkpoint',row=>row.outstandingAtCheckpoint],['Observer errors',row=>row.observerErrors]];
function facts(pairs) {
  const container = document.createElement('div'); container.className = 'source-facts';
  for (const [label,value] of pairs) { const item = document.createElement('div'); item.className = 'source-fact'; item.append(text('span',label),text('strong',shown(value))); container.append(item); }
  return container;
}
function rangeLabel(range) { return range ? `${range.from} through ${range.to} UTC` : 'No recorded period range'; }
function sourceLabel(source) {
  if (!source) return 'Source unavailable';
  return source.kind === PERIOD ? `${rangeLabel(source.range)} · ${(source.sessionIds ?? source.sessions ?? []).length} sessions`
    : `${source.mode ?? 'Unknown mode'} · ${source.sessionId ?? 'Unrecorded session'}`;
}
function coverageFacts(source) {
  const range = source.range ?? {}, storage = source.storage ?? {};
  return facts([['Recorded period',rangeLabel(source.range)],['Service scope',range.routeId ?? 'All retained services'],
    ['Saved UTC days',(source.days ?? []).length],['Source modes',(source.modes ?? []).join(', ') || 'No retained modes'],
    ['Retention window',source.retentionDays === null || source.retentionDays === undefined ? 'Unspecified' : `${source.retentionDays} UTC days`],
    ['Last checkpoint',storage.lastCheckpointAt ?? 'Not reported']]);
}
function coverageText(source) {
  const range = source.range ?? {}, storage = source.storage ?? {}, notes = [];
  if (range.outsideRetention) notes.push('The requested period is outside the retained window.');
  else if (range.truncatedByRetention) notes.push(`Requested from ${range.requestedFrom}; retained observations begin ${range.effectiveFrom ?? range.retainedFrom}.`);
  if (storage.healthy === false) notes.push('The original history storage reports an incomplete or unhealthy checkpoint state.');
  if (storage.checkpointFailures) notes.push(`${storage.checkpointFailures} checkpoint failures reported by the source.`);
  if (storage.damagedSessions?.length) notes.push(`${storage.damagedSessions.length} damaged source sessions were excluded.`);
  if (source.semantics?.days) notes.push(source.semantics.days);
  if (source.semantics?.interruptions) notes.push(source.semantics.interruptions);
  return notes.join(' ');
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

function renderSourceControls() {
  const selection = current.selection ?? {kind:SESSION,from:null,to:null,routeId:null};
  const capabilities = current.sourceCapabilities ?? {kinds:[SESSION],periodEditable:false};
  $('source-kind').replaceChildren(...capabilities.kinds.map(kind => { const option = text('option',sourceName(kind)); option.value = kind; return option; }));
  $('source-kind').value = selection.kind;
  const range = selection.kind === PERIOD ? current.snapshot?.range : null;
  $('source-from').value = capabilities.periodEditable ? selection.from ?? '' : range?.from ?? '';
  $('source-to').value = capabilities.periodEditable ? selection.to ?? '' : range?.to ?? '';
  const ids = new Set(current.seller.routes.map(route=>route.routeId));
  for (const route of current.snapshot?.routes ?? []) ids.add(route.routeId ?? route.id);
  const routeId = capabilities.periodEditable ? selection.routeId : range?.routeId;
  if (routeId) ids.add(routeId);
  const all = text('option','All retained services'); all.value = '';
  $('source-route').replaceChildren(all,...[...ids].filter(Boolean).sort().map(id => { const option = text('option',id); option.value = id; return option; }));
  $('source-route').value = routeId ?? '';
  sourceDirty = false; renderSourceHelp(); controls();
}
function renderSourceHelp() {
  const kind = $('source-kind').value, capabilities = current.sourceCapabilities ?? {};
  $('source-kind-note').textContent = capabilities.live ? 'Original operations listener' : 'Original saved export';
  $('source-help').textContent = sourceDirty ? 'Source selection changed. Apply it to capture the selected observations before calculating or saving.'
    : kind === PERIOD ? capabilities.periodEditable
      ? 'UTC dates are inclusive. Blank dates use the original retained-history range. Apply the selection to load its original coverage.'
      : 'This saved export keeps its original dates and service scope. Its recorded range is shown below.'
    : 'The original current-session capture supplies this review. Refresh to capture its latest operations counters.';
}
function renderSource() {
  $('source-name').textContent = current.seller.name;
  $('session-name').textContent = sourceLabel(current.snapshot);
  $('captured').textContent = current.snapshot?.capturedAt ?? '—'; $('config-hash').textContent = current.seller.sha256;
  $('native-status').textContent = current.nativeAttached
    ? 'Native settlement companion attached. Saved reviews include the original option and delivery reconciliation.'
    : 'Original SF97 reports. An existing native outbox can be attached when starting this workspace.';
  renderSourceControls();
  const source = current.snapshot, period = source?.kind === PERIOD;
  $('source-coverage').hidden = !period;
  if (period) {
    $('coverage-facts').replaceChildren(...coverageFacts(source).children);
    $('coverage-semantics').textContent = coverageText(source);
    $('day-count').textContent = `(${source.days.length})`; $('session-count').textContent = `(${source.sessions.length})`;
    $('coverage-days').replaceChildren(table(source.days,dayColumns,'No saved day observations in this period.'));
    $('coverage-sessions').replaceChildren(table(source.sessions,sessionColumns,'No retained sessions in this period.'));
  }
}
function reportLink(version,name,label) {
  const anchor = text('a',label); anchor.href = '/files/'+encodeURIComponent(version)+'/'+name.split('/').map(encodeURIComponent).join('/'); anchor.target = '_blank'; anchor.rel = 'noopener'; return anchor;
}
function renderComparisonChoices() {
  const previousLeft = $('compare-left').value, previousRight = $('compare-right').value;
  for (const id of ['compare-left','compare-right']) $(id).replaceChildren(...current.history.map(item => {
    const kind = item.observationKind ?? SESSION;
    const scope = kind === PERIOD && item.observation?.range ? rangeLabel(item.observation.range) : item.sessionId ?? 'saved session';
    const option = text('option',`${item.label} · ${scope}`); option.value = item.version; return option;
  }));
  const periods = current.history.filter(item=>item.observationKind === PERIOD);
  const candidates = periods.length > 1 ? periods : current.history;
  $('compare-left').value = current.history.some(item=>item.version === previousLeft) ? previousLeft : candidates[1]?.version ?? candidates[0]?.version ?? '';
  $('compare-right').value = current.history.some(item=>item.version === previousRight) ? previousRight : candidates[0]?.version ?? '';
  controls();
}
function renderHistory() {
  $('history').replaceChildren(); $('history-count').textContent = `${current.history.length} recent versions`;
  if (!current.history.length) $('history').append(text('p','No saved reviews yet.','muted'));
  current.history.forEach(item => {
    const row = document.createElement('article'); row.className = 'history-item';
    const description = document.createElement('div'), title = text('div',item.label,'history-title');
    const kind = item.observationKind ?? SESSION; title.append(text('span',sourceName(kind),'history-kind'));
    description.append(title,text('div',`${item.savedAt} · Target gross ${money(item.overview.plannedMonthlyTargetGrossUsd)} · After fixed ${money(item.overview.plannedMonthlyTargetContributionAfterFixedUsd)}`,'history-meta'));
    description.append(text('div',item.observation ? sourceLabel(item.observation) : `Original session ${item.sessionId ?? 'unrecorded'}`,'history-source'));
    const links = document.createElement('div'); links.className = 'history-files';
    links.append(reportLink(item.version,'terms.json','Merchant terms'),reportLink(item.version,'report/report.json','Report JSON'),
      reportLink(item.version,item.sourceFile ?? 'snapshot.json',kind === PERIOD ? 'Original retained history' : 'Original operations capture'),reportLink(item.version,'manifest.json','Version manifest'));
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
      if ((dirty || sourceDirty) && !window.confirm('Replace the unsaved form with this saved review’s commercial assumptions and keep the currently captured operations selection?')) return;
      const latest = await readState();
      const loaded = await api('/api/load-version',{version:item.version});
      if (loaded.sellerSha256 !== latest.seller.sha256) throw new Error('Seller configuration changed while loading. Refresh operations and try again.');
      current = latest; draft = loaded.commercial; editRevision = current.revision; selected = 0;
      $('review-name').value = item.label + ' revision';
      renderInputs(); markDirty(); notice('Saved assumptions loaded for the current operations selection. Review the payment choices, then save a new version.');
    }));
    const reprice = text('button','Prepare price change'); reprice.type = 'button';
    reprice.addEventListener('click',() => run(async () => {
      if (await loadRepricing(item.version)) $('repricing-panel').scrollIntoView({behavior:'smooth',block:'start'});
    }));
    actions.append(report,reuse,reprice); row.append(description,actions); $('history').append(row);
  });
  renderComparisonChoices();
}
function renderInputs() {
  $('merchant-name').value = draft.merchantName; $('fixed-cost').value = draft.sharedMonthlyFixedUsd ?? '';
  renderSource(); renderRoutes(); renderEditor(); renderHistory(); renderRepricing();
}
const overviewMetrics = [['Monthly target gross','plannedMonthlyTargetGrossUsd'],['Monthly target variable cost','plannedMonthlyTargetVariableCostsUsd'],['Contribution after fixed cost','plannedMonthlyTargetContributionAfterFixedUsd']];
function totals(report) {
  const container = document.createElement('div'); container.className = 'totals';
  for (const [label,key] of overviewMetrics) { const card = document.createElement('div'); card.className = 'total'; card.append(text('span',label),text('strong',money(report.overview[key]))); container.append(card); }
  return container;
}
function reportRows(report,body) {
  body.replaceChildren();
  report.routes.forEach(route => {
    const tr = document.createElement('tr'), name = document.createElement('td'); name.append(identity(route)); tr.append(name);
    [route.actualAttempts,route.actual402,route.actual2xx,money(route.plannedMonthlyTargetGrossUsd),money(route.plannedMonthlyTargetContributionBeforeFixedUsd)].forEach(value=>tr.append(text('td',value)));
    body.append(tr);
  });
}
function issues(report) {
  const list = document.createElement('ul'); list.className = 'period-issues';
  report.issues.forEach(issue => list.append(text('li',`${issue.routeId}: ${issue.flag}`)));
  if (report.overview.unknownCostRoutes.length) list.append(text('li','Some costs remain unknown on: '+report.overview.unknownCostRoutes.join(', ')+'.'));
  return list;
}
const bindings = {CURRENT_ROUTE:'Current service',REMOVED_ROUTE:'Removed service',HISTORICAL_ROUTE_VARIANT:'Earlier method / path',AGGREGATE_BUCKET:'Request bucket'};
const variantColumns = [['Service / variant',identity],['Current configuration',row=>bindings[row.binding] ?? row.binding],['Attempts',row=>row.actualAttempts],['Completions',row=>row.actualCompleted],['402',row=>row.actual402],['2xx',row=>row.actual2xx],['5xx',row=>row.actual5xx],['Disconnected',row=>row.actualDisconnected],['P95 upper bound · ms',row=>row.latencyP95UpperBoundMs]];
function retainedDetails(title,rows,columns,emptyMessage) {
  const details = document.createElement('details'); details.className = 'coverage-detail';
  details.append(text('summary',`${title} (${rows.length})`)); let rendered = false;
  details.addEventListener('toggle',() => { if (details.open && !rendered) { rendered = true; details.append(table(rows,columns,emptyMessage)); } });
  return details;
}
function periodReport(report) {
  const review = report.periodReview, history = report.usageHistory;
  if (!review || !history) return null;
  const panel = document.createElement('div'); panel.className = 'period-overview';
  panel.append(text('h3','Retained UTC period'),text('p',`${rangeLabel(history.range)} · ${history.days.length} saved days · ${history.sessions.length} retained sessions`,'period-context'));
  const scope = [];
  if (review.quoteScope === 'CURRENT_MERCHANT_TERMS_APPLIED_TO_MATCHING_RETAINED_ROUTE_VARIANTS') scope.push('Current merchant quotes apply to matching retained service variants.');
  if (review.monthlyTargetsAppliedOnce) scope.push('Monthly targets are applied once.');
  if (review.startsAndCompletionsHaveIndependentUtcDates) scope.push('Request starts and completions retain their separate UTC event dates.');
  if (review.absentDaysHaveNoSavedObservations) scope.push('Absent days have no saved observations.');
  panel.append(text('p',scope.join(' '),'source-note'));
  if (report.overview.sharedFixedCostApplied === false) panel.append(text('p','The selected service scope does not allocate merchant-wide fixed costs. After-fixed contribution remains unknown for this selection.','source-note'));
  panel.append(table(review.days,[['UTC day',row=>row.day],['Sessions',row=>row.sessions],['Attempts',row=>row.actualAttempts],
    ['Completions',row=>row.actualCompleted],['402',row=>row.actual402],['2xx',row=>row.actual2xx],
    ['5xx',row=>row.actual5xx],['Disconnected',row=>row.actualDisconnected],['P95 upper bound · ms',row=>row.latencyP95UpperBoundMs],['Current-service nominal USD',row=>money(row.currentRouteNominal2xxValueUsd)],
    ['Current-service modeled cost USD',row=>money(row.currentRouteModeledVariableCostUsd)],['Unpriced 2xx',row=>row.unpricedHttp2xx]],'No saved observations in this selected period.'));
  panel.append(retainedDetails('Retained service variants',review.variants,variantColumns,'No retained service variants.'));
  const detail = document.createElement('details'); detail.className = 'coverage-detail'; detail.append(text('summary','Review each saved day’s original service values'));
  let loaded = false;
  detail.addEventListener('toggle',() => { if (!detail.open || loaded) return; loaded = true;
    for (const day of review.days) detail.append(retainedDetails(day.day,day.routes,[...variantColumns,
      ['Quote USD',row=>row.quoteUsd === null ? 'Unpriced' : money(row.quoteUsd)],
      ['Nominal USD',row=>row.modeledNominal2xxValueUsd === null ? 'Unpriced' : money(row.modeledNominal2xxValueUsd)],
      ['Modeled cost USD',row=>money(row.modeledObservedVariableCostUsd)],['Modeled contribution USD',row=>money(row.modeledObservedContributionUsd)]],'No saved service variants for this day.'));
  });
  panel.append(detail); return panel;
}
function renderReport(report,caption = 'Original commercial review') {
  $('preview-panel').hidden = false;
  $('preview-caption').textContent = `${caption} · ${report.observedFrom} through ${report.observedUntil}`;
  $('totals').replaceChildren(...totals(report).children);
  const period = periodReport(report); $('period-review').hidden = !period; $('period-review').replaceChildren(...(period ? [period] : []));
  reportRows(report,$('preview-rows')); $('issues').replaceChildren(...issues(report).children);
}
function savedObservation(side) {
  if (side.report.usageHistory) { const history = side.report.usageHistory;
    return {...side.observation,...history,kind:PERIOD,capturedAt:history.generatedAt,sessionIds:history.sessions.map(row=>row.sessionId)}; }
  return side.observation ?? {kind:SESSION,sessionId:side.sessionId,mode:side.report.originalSellerMode,capturedAt:side.report.observedUntil,startedAt:side.report.observedFrom};
}
function comparisonReport(side) {
  const panel = document.createElement('article'); panel.className = 'comparison-report';
  panel.append(text('h3',side.label),text('p',`${side.savedAt} · ${sourceName(side.observationKind ?? SESSION)}`,'history-meta'));
  const observation = savedObservation(side);
  panel.append(text('p',sourceLabel(observation),'history-source'),text('p',`${side.report.observedFrom} through ${side.report.observedUntil}`,'period-context'));
  const links = document.createElement('div'); links.className = 'history-files';
  links.append(reportLink(side.version,'report/review.html','Open original report'),reportLink(side.version,'report/report.json','Original report JSON'),reportLink(side.version,side.sourceFile ?? 'snapshot.json','Original source'));
  panel.append(links,totals(side.report));
  if (observation.kind === PERIOD) {
    panel.append(coverageFacts(observation),text('p',coverageText(observation),'source-note'));
    panel.append(retainedDetails('Saved session coverage',observation.sessions ?? [],sessionColumns,'No retained sessions.'));
  }
  const period = periodReport(side.report); if (period) panel.append(period);
  panel.append(text('h3','Current service economics'),table(side.report.routes,[['Service',identity],['Attempts',row=>row.actualAttempts],['402',row=>row.actual402],['2xx',row=>row.actual2xx],['Target gross USD',row=>money(row.plannedMonthlyTargetGrossUsd)],['Target contribution USD',row=>money(row.plannedMonthlyTargetContributionBeforeFixedUsd)]],'No current services in this selection.'),issues(side.report));
  return panel;
}
function renderComparison(result) {
  $('comparison-result').hidden = false; $('comparison-status').textContent = `${result.left.label} / ${result.right.label}`;
  $('comparison-compatibility').replaceChildren(...[
    ['Seller configuration','sameSellerConfiguration'],['Commercial terms','sameCommercialTerms'],['Observation kind','sameObservationKind'],['Recorded range','sameRange']
  ].map(([label,key])=> { const item = text('p',label); item.dataset.matches = String(result.compatibility[key]); item.append(text('strong',result.compatibility[key] ? 'Same' : 'Different')); return item; }));
  $('comparison-reports').replaceChildren(comparisonReport(result.left),comparisonReport(result.right));
}
const paymentAmount = option => option.atomicAmount ?? option.amount;
const paymentKey = (routeId,index) => routeId+':'+index;
function repricingEdits() {
  return (repricingSource?.routes ?? []).flatMap(route => route.paymentOptions.flatMap((option,paymentIndex) => {
    const expectedAmount = paymentAmount(option), amount = repricingAmounts.get(paymentKey(route.routeId,paymentIndex)) ?? expectedAmount;
    return amount === expectedAmount ? [] : [{routeId:route.routeId,paymentIndex,expectedAmount,amount}];
  }));
}
const repricingStale = () => Boolean(repricingSource?.sellerChanged);
const repricingSelectionChanged = () => Boolean(repricingSource && $('repricing-source').value !== repricingSource.version);
function repricingControls() {
  lock($('repricing-source'),!current.history.length);
  lock($('repricing-load'),!$('repricing-source').value);
  const unavailable = repricingStale() || repricingSelectionChanged(), changed = repricingEdits().length;
  lock($('repricing-reset'),!repricingSource || unavailable || !changed);
  lock($('repricing-preview'),!repricingSource || unavailable || !changed);
  lock($('repricing-save'),!repricingPreview || unavailable || !$('repricing-name').value.trim());
  lock($('repricing-name'),!repricingSource || unavailable);
  lock($('repricing-previous'),repricingRoutePage === 0);
  lock($('repricing-next'),(repricingRoutePage+1)*REPRICING_ROUTES_PER_PAGE >= (repricingSource?.routes.length ?? 0));
  document.querySelectorAll('.repricing-amount').forEach(input => lock(input,unavailable));
}
function repricingChoices() {
  const selectedVersion = $('repricing-source').value;
  $('repricing-source').replaceChildren(...current.history.map(item => {
    const option = text('option',item.label+' · '+item.savedAt); option.value = item.version; return option;
  }));
  if (!current.history.length) {
    const empty = text('option','Save a pricing review to prepare a price change'); empty.value = ''; $('repricing-source').append(empty);
  }
  if (repricingSource && !current.history.some(item=>item.version === repricingSource.version)) {
    const retained = text('option',repricingSource.label+' · loaded review'); retained.value = repricingSource.version;
    $('repricing-source').append(retained);
  }
  if ([...$('repricing-source').options].some(option=>option.value === selectedVersion)) $('repricing-source').value = selectedVersion;
}
function repricingSummary() {
  const count = repricingEdits().length;
  $('repricing-change-count').textContent = count ? count+' payment choice'+(count === 1 ? '' : 's')+' changed.' : 'No amounts changed.';
}
function invalidateRepricing() {
  repricingPreview = null; pendingRepricingSave = null; repricingDirty = true;
  $('repricing-review').hidden = true; $('repricing-state').textContent = 'Unsaved payment amounts';
  repricingSummary(); controls();
}
function paymentIdentity(option) {
  const details = document.createElement('details'); details.className = 'payment';
  details.append(text('summary','Asset, recipient and extra terms'));
  const values = document.createElement('dl');
  for (const [label,value] of [['Asset',option.asset],['Recipient',option.payTo]])
    values.append(text('dt',label),text('dd',value));
  details.append(values);
  if (Object.hasOwn(option,'extra')) details.append(text('pre',JSON.stringify(option.extra,null,2)));
  return details;
}
function renderRepricingOptions() {
  $('repricing-options').replaceChildren();
  const start = repricingRoutePage*REPRICING_ROUTES_PER_PAGE;
  const visible = repricingSource.routes.slice(start,start+REPRICING_ROUTES_PER_PAGE);
  $('repricing-paging').hidden = repricingSource.routes.length <= REPRICING_ROUTES_PER_PAGE;
  $('repricing-page-caption').textContent = (start+1)+'–'+(start+visible.length)+' of '+repricingSource.routes.length+' services';
  for (const route of visible) {
    const section = document.createElement('article'); section.className = 'repricing-route';
    const header = document.createElement('div'); header.className = 'repricing-route-heading';
    const name = document.createElement('div'); name.append(text('h3',route.routeId),text('p',route.method+' '+route.path));
    header.append(name);
    const commercial = repricingSource.commercial?.routes?.[route.routeId];
    if (commercial) {
      const quote = document.createElement('div'); quote.className = 'repricing-quote';
      quote.append(text('div','Saved merchant valuation · '+money(commercial.unitPriceUsd)),text('p',commercial.priceBasis));
      header.append(quote);
    }
    section.append(header);
    route.paymentOptions.forEach((option,paymentIndex) => {
      const currentAmount = paymentAmount(option), key = paymentKey(route.routeId,paymentIndex);
      const row = document.createElement('div'); row.className = 'repricing-option';
      const description = document.createElement('div');
      description.append(text('div','Choice '+(paymentIndex+1)+' · '+option.network,'repricing-option-title'),
        text('p',option.scheme+' · timeout '+option.maxTimeoutSeconds+'s','muted small'),paymentIdentity(option));
      const original = document.createElement('div'); original.className = 'repricing-current';
      original.append(text('span','Current atomic amount'),text('code',currentAmount));
      const label = text('label','Proposed atomic amount'), input = document.createElement('input'), hint = text('small','Current amount retained.');
      input.className = 'repricing-amount'; input.type = 'text'; input.inputMode = 'numeric';
      input.dataset.routeId = route.routeId; input.dataset.paymentIndex = String(paymentIndex);
      input.pattern = '[1-9][0-9]{0,38}'; input.maxLength = 39; input.required = true; input.autocomplete = 'off';
      input.setAttribute('aria-label',route.routeId+', payment choice '+(paymentIndex+1)+', proposed atomic amount');
      input.title = 'Use a positive whole-number atomic amount, up to 39 digits.';
      input.value = repricingAmounts.get(key) ?? currentAmount;
      function update() {
        const changed = input.value !== currentAmount; row.dataset.changed = String(changed);
        hint.textContent = changed ? 'Changed — review before saving.' : 'Current amount retained.';
      }
      input.addEventListener('input',() => { repricingAmounts.set(key,input.value); update(); invalidateRepricing(); });
      update(); label.append(input,hint); row.append(description,original,label); section.append(row);
    });
    $('repricing-options').append(section);
  }
  repricingSummary();
}
function renderRepricingSource() {
  if (!repricingSource) return;
  const count = repricingSource.routes.reduce((sum,route)=>sum+route.paymentOptions.length,0);
  $('repricing-source-facts').replaceChildren(...facts([['Saved pricing review',repricingSource.label],
    ['Services',repricingSource.routes.length],['Payment choices',count]]).children);
  $('repricing-source-hash').textContent = repricingSource.sellerSha256;
  $('repricing-source-links').replaceChildren(reportLink(repricingSource.version,'report/review.html','Open saved commercial review'),
    reportLink(repricingSource.version,'seller.json','Source seller configuration'),reportLink(repricingSource.version,'terms.json','Source merchant terms'));
  const stale = repricingStale(), selectionChanged = repricingSelectionChanged();
  $('repricing-source-status').dataset.error = String(stale);
  $('repricing-source-status').textContent = stale
    ? 'The seller configuration has changed since this review. Save a review of the current configuration, then load it here to prepare the new amounts.'
    : selectionChanged
      ? 'Choose Load payment choices to apply the selected review. The form currently contains '+repricingSource.label+'.'
      : repricingSource.sourcePackageAvailable
        ? 'Original authoring inputs are attached to this workspace. The price change can include updated source selections for the existing release workflow.'
        : 'These amounts are tied to this saved seller configuration. The saved merchant USD valuations, costs and volume targets carry forward into the exported terms.';
  if (stale && repricingPreview) { repricingPreview = null; $('repricing-review').hidden = true; }
}
function repricingFileLink(decision,name,label) {
  const anchor = text('a',label);
  anchor.href = '/repricing-files/'+encodeURIComponent(decision)+'/'+name.split('/').map(encodeURIComponent).join('/');
  anchor.target = '_blank'; anchor.rel = 'noopener'; return anchor;
}
function repricingFiles(item) {
  return Array.isArray(item.files) ? item.files.map(file => typeof file === 'string' ? file : file.file ?? file.name).filter(Boolean)
    : Object.keys(item.files ?? {});
}
function renderRepricingHistory() {
  const entries = current.repricing?.history ?? [];
  $('repricing-history-count').textContent = entries.length+' recent versions';
  $('repricing-history').replaceChildren();
  if (!entries.length) $('repricing-history').append(text('p','Saved configurations will appear here with their original inputs and price changes.','repricing-empty'));
  const labels = {'launch-seller.json':'Local launch configuration','seller.json':'Seller configuration','terms.json':'Merchant terms','source-seller.json':'Source seller configuration',
    'source-terms.json':'Source merchant terms','pricing-report.json':'Source pricing report','decision.json':'Price change review','manifest.json':'Version manifest'};
  for (const item of entries) {
    const article = document.createElement('article'); article.className = 'history-item';
    const description = document.createElement('div'), count = item.changedPaymentOptions ?? item.changes?.length ?? 0;
    description.append(text('div',item.label,'history-title'),
      text('div',item.savedAt+' · '+count+' payment choice'+(count === 1 ? '' : 's')+' changed','history-meta'),
      text('div','Based on '+(item.sourceLabel ?? item.sourceVersion),'history-source'));
    const available = new Set([...repricingFiles(item),'manifest.json']), primary = document.createElement('div');
    primary.className = 'history-files';
    for (const name of ['launch-seller.json','seller.json','terms.json','decision.json']) if (available.has(name)) {
      const link = repricingFileLink(item.decision,name,labels[name]);
      if (name === 'launch-seller.json' || (name === 'seller.json' && !available.has('launch-seller.json'))) link.className = 'button';
      primary.append(link);
    }
    description.append(primary);
    const retained = document.createElement('details'), files = document.createElement('div'); files.className = 'history-files';
    retained.append(text('summary','Original inputs and complete package'));
    for (const name of available) if (!['launch-seller.json','seller.json','terms.json','decision.json'].includes(name))
      files.append(repricingFileLink(item.decision,name,labels[name] ?? name));
    retained.append(files);
    const hash = text('p','Prepared configuration SHA-256','muted small'); hash.append(text('code',item.proposedSellerSha256,'repricing-hash'));
    retained.append(hash); description.append(retained); article.append(description);
    if (item.release) {
      const release = text('div','Release staged · '+item.release.id,'repricing-release-state');
      release.append(text('p',item.release.label,'muted small')); description.append(release);
    } else if (current.repricing?.releaseAvailable && item.reviewSha256 &&
        (item.sourcePackageAvailable || [...available].some(name=>name.startsWith('source-package/')))) {
      const actions = document.createElement('div'); actions.className = 'button-row';
      const stage = text('button','Stage retained release'); stage.type = 'button';
      stage.addEventListener('click',() => run(async () => {
        const result = await api('/api/repricing/stage',{decision:item.decision,reviewSha256:item.reviewSha256});
        item.release = result.release; renderRepricingHistory();
        notice((result.recovered ? 'Retained release recovered · ' : 'Retained release staged · ')+result.release.id+'. Review and select it in the existing seller release console.');
      }));
      actions.append(stage); article.append(actions);
    }
    $('repricing-history').append(article);
  }
}
function renderRepricing() {
  repricingChoices();
  if (pendingRepricingSave) {
    const recovered = (current.repricing?.history ?? []).find(item => item.requestId === pendingRepricingSave.requestId &&
      item.reviewSha256 === pendingRepricingSave.reviewSha256 && item.sourceVersion === pendingRepricingSave.version);
    if (recovered) {
      pendingRepricingSave = null; repricingPreview = null; repricingDirty = false;
      repricingEditRevision = current.repricing.revision;
      $('repricing-review').hidden = true; $('repricing-state').textContent = 'Recovered saved configuration · '+recovered.label;
    }
  }
  if (repricingSource) repricingSource.sellerChanged = repricingSource.sellerSha256 !== current.seller.sha256;
  renderRepricingSource(); renderRepricingHistory(); repricingControls();
}
async function loadRepricing(version) {
  if (repricingDirty && !window.confirm('Replace the unsaved price change with the selected review’s original payment amounts?')) return false;
  const source = await api('/api/repricing/source',{version});
  repricingSource = source; repricingAmounts = new Map(); repricingPreview = null; pendingRepricingSave = null;
  repricingDirty = false; repricingRoutePage = 0;
  repricingEditRevision = Object.hasOwn(source,'repricingRevision') ? source.repricingRevision : current.repricing?.revision ?? null;
  for (const route of source.routes) route.paymentOptions.forEach((option,index) => repricingAmounts.set(paymentKey(route.routeId,index),paymentAmount(option)));
  $('repricing-source').value = version; $('repricing-editor').hidden = false; $('repricing-review').hidden = true;
  $('repricing-name').value = (source.label+' price change').slice(0,100);
  $('repricing-state').textContent = 'Loaded · '+source.label;
  renderRepricingSource(); renderRepricingOptions(); controls();
  notice(repricingStale() ? $('repricing-source-status').textContent : 'Saved payment choices loaded. Enter exact atomic amounts, then review the complete change.',repricingStale());
  return true;
}
function repricingPayload() {
  if (!repricingSource) throw new Error('Load a saved pricing review first.');
  if (repricingStale()) throw new Error('Save and load a review of the current seller configuration before changing its amounts.');
  if (repricingSelectionChanged()) throw new Error('Load the selected pricing review before preparing its amounts.');
  const edits = repricingEdits();
  if (!edits.length) throw new Error('Change at least one payment amount before reviewing.');
  const invalid = edits.find(edit=>!/^[1-9][0-9]{0,38}$/.test(edit.amount));
  if (invalid) {
    repricingRoutePage = Math.floor(repricingSource.routes.findIndex(route=>route.routeId === invalid.routeId)/REPRICING_ROUTES_PER_PAGE);
    renderRepricingOptions();
    const input = [...document.querySelectorAll('.repricing-amount')].find(field=>field.dataset.routeId === invalid.routeId &&
      Number(field.dataset.paymentIndex) === invalid.paymentIndex);
    input.disabled = false; input.reportValidity();
    throw new Error('Enter a positive whole-number atomic amount for '+invalid.routeId+', payment choice '+(invalid.paymentIndex+1)+'.');
  }
  return {version:repricingSource.version,sellerSha256:repricingSource.sellerSha256,edits};
}
function paymentTerms(option,title) {
  const section = document.createElement('div'); section.append(text('h4',title));
  const values = document.createElement('dl');
  for (const [label,value] of [['Scheme',option.scheme],['Network',option.network],['Atomic amount',paymentAmount(option)],
    ['Asset',option.asset],['Recipient',option.payTo],['Timeout',option.maxTimeoutSeconds+' seconds']])
    values.append(text('dt',label),text('dd',value));
  if (Object.hasOwn(option,'extra')) values.append(text('dt','Extra'),text('dd',JSON.stringify(option.extra,null,2)));
  section.append(values); return section;
}
function renderRepricingTerms(change,expanded = false) {
  const detail = document.createElement('details'); detail.className = 'repricing-terms';
  detail.append(text('summary',change.routeId+' · choice '+(change.paymentIndex+1)+' · complete payment terms'));
  let rendered = false;
  const show = () => {
    if (rendered) return;
    rendered = true;
    const pair = document.createElement('div'); pair.className = 'repricing-term-pair';
    pair.append(paymentTerms(change.before,'Current payment terms'),paymentTerms(change.after,'Proposed payment terms'));
    detail.append(pair);
  };
  detail.addEventListener('toggle',()=> { if (detail.open) show(); });
  if (expanded) { show(); detail.open = true; }
  $('repricing-review-terms').replaceChildren(detail);
}
function renderRepricingReview(result) {
  repricingPreview = result; pendingRepricingSave = null; $('repricing-review').hidden = false;
  $('repricing-state').textContent = 'Price change reviewed · ready to save';
  $('repricing-review-count').textContent = result.changes.length+' payment choice'+(result.changes.length === 1 ? '' : 's');
  $('repricing-change-table').replaceChildren(table(result.changes,[['Service',identity],
    ['Choice',row=>row.paymentIndex+1],['Network',row=>row.before.network],
    ['Current atomic amount',row=>text('code',paymentAmount(row.before))],
    ['Proposed atomic amount',row=>text('code',paymentAmount(row.after))],
    ['Payment terms',row=> { const button = text('button','Inspect terms','repricing-term-action'); button.type = 'button';
      button.addEventListener('click',()=>renderRepricingTerms(row,true)); return button; }]]));
  renderRepricingTerms(result.changes[0]);
  $('repricing-proposed-hash').textContent = result.proposedSellerSha256;
}
function payload() {
  if (sourceDirty) throw new Error('Apply the source selection before calculating or saving.');
  if (!current.snapshot) throw new Error('Restore the selected operations source and refresh before calculating this review.');
  return {sellerSha256:current.seller.sha256,snapshotSha256:current.snapshot.sha256,commercial:structuredClone(draft)};
}
function sourceInput() {
  if (!$('source-form').reportValidity()) throw new Error('Check the selected UTC dates.');
  const kind = $('source-kind').value, editable = current.sourceCapabilities?.periodEditable && kind === PERIOD;
  return {kind,from:editable ? $('source-from').value || null : null,to:editable ? $('source-to').value || null : null,routeId:editable ? $('source-route').value || null : null};
}
function adoptSource(latest) {
  const changed = latest.seller.sha256 !== current.seller.sha256;
  const moved = latest.revision !== editRevision;
  if (changed) {
    const previous = draft;
    draft = latest.commercial; draft.merchantName = previous.merchantName; draft.sharedMonthlyFixedUsd = previous.sharedMonthlyFixedUsd;
    for (const route of latest.seller.routes) if (Object.hasOwn(previous.routes,route.routeId)) draft.routes[route.routeId] = previous.routes[route.routeId];
    selected = Math.min(selected,latest.seller.routes.length-1);
  }
  current = latest; pendingSave = null; $('preview-panel').hidden = true; renderInputs();
  return {changed,moved};
}
function sourceNotice({changed,moved},applied = false) {
  notice(current.sourceError || (moved ? 'Another tab saved a newer review. Use its assumptions from Saved reviews before saving this form.'
    : changed ? 'Seller configuration changed. Entered assumptions remain on matching services; review the new payment choices.'
    : applied ? 'Selected original source captured. Commercial assumptions are retained for this new review.'
    : 'Selected original operations source refreshed. Your commercial inputs are retained.'),Boolean(current.sourceError || moved));
}
$('merchant-name').addEventListener('input',() => { draft.merchantName = $('merchant-name').value; markDirty(); });
$('fixed-cost').addEventListener('input',() => { draft.sharedMonthlyFixedUsd = $('fixed-cost').value.trim() || null; markDirty(); });
$('review-name').addEventListener('input',markDirty);
for (const id of ['source-kind','source-from','source-to','source-route']) $(id).addEventListener('input',() => { sourceDirty = true; $('preview-panel').hidden = true; renderSourceHelp(); controls(); });
$('reset-source').addEventListener('click',() => { renderSourceControls(); notice('The form shows the currently captured operations selection.'); });
$('source-form').addEventListener('submit',event => { event.preventDefault(); run(async () => {
  const latest = await api('/api/source',{selection:sourceInput()}), outcome = adoptSource(latest); markDirty(); sourceNotice(outcome,true);
}); });
$('refresh').addEventListener('click',() => run(async () => {
  if (!current) { await initialize(); return; }
  sourceNotice(adoptSource(await readState()));
}));
$('preview').addEventListener('click',() => run(async () => {
  const report = await api('/api/preview',payload()); renderReport(report); notice('Commercial review calculated by the original merchant analyzer for the selected source.');
}));
$('save').addEventListener('click',() => run(async () => {
  pendingSave ??= {...payload(),expectedRevision:editRevision,requestId:crypto.randomUUID(),label:$('review-name').value.trim()};
  const result = await api('/api/save',pendingSave);
  editRevision = result.revision; dirty = false;
  $('save-state').textContent = 'Saved · '+result.label;
  // Keep a confirmed save and its exact request recoverable if state refresh fails.
  try {
    current = await readState(); draft = current.commercial;
    editRevision = current.revision; pendingSave = null; renderInputs();
  } catch {
    notice('Review saved. The latest workspace state could not be loaded; refresh operations or retry to recover this same version.'); return;
  }
  notice(result.recovered ? 'The previous save completed. Its original version has been recovered.' : 'Review saved with the selected original source. Open its report or use the saved-review comparison below.');
}));
for (const id of ['compare-left','compare-right']) $(id).addEventListener('change',() => { $('comparison-result').hidden = true; $('comparison-status').textContent = 'Choose Compare reviews to load these original saved reports.'; controls(); });
$('comparison-form').addEventListener('submit',event => { event.preventDefault(); run(async () => {
  const leftVersion = $('compare-left').value, rightVersion = $('compare-right').value;
  if (!leftVersion || !rightVersion || leftVersion === rightVersion) throw new Error('Choose two different saved reviews.');
  const result = await api('/api/compare',{leftVersion,rightVersion}); renderComparison(result); notice('Original saved reports loaded side by side. Their values have not been recalculated.');
}); });
$('repricing-source').addEventListener('change',() => { renderRepricingSource(); controls(); });
$('repricing-source-form').addEventListener('submit',event => { event.preventDefault(); run(async () => {
  if (!$('repricing-source').value) throw new Error('Save a pricing review before preparing a price change.');
  await loadRepricing($('repricing-source').value);
}); });
$('repricing-reset').addEventListener('click',() => {
  if (!repricingSource) return;
  for (const route of repricingSource.routes) route.paymentOptions.forEach((option,index) => repricingAmounts.set(paymentKey(route.routeId,index),paymentAmount(option)));
  repricingPreview = null; pendingRepricingSave = null; repricingDirty = false; repricingRoutePage = 0;
  $('repricing-review').hidden = true; $('repricing-state').textContent = 'Loaded · '+repricingSource.label;
  renderRepricingOptions(); controls(); notice('The selected saved review’s original payment amounts have been restored.');
});
for (const [id,direction] of [['repricing-previous',-1],['repricing-next',1]]) $(id).addEventListener('click',() => {
  repricingRoutePage += direction; renderRepricingOptions(); controls();
});
$('repricing-preview').addEventListener('click',() => run(async () => {
  const input = repricingPayload();
  repricingPreview = null; $('repricing-review').hidden = true; $('repricing-state').textContent = 'Reviewing payment amounts';
  let result;
  try { result = await api('/api/repricing/preview',input); }
  catch (error) { $('repricing-state').textContent = 'Review needs attention · amounts retained'; throw error; }
  renderRepricingReview(result); notice('Exact before and after payment terms prepared. Name the price change and save its complete configuration.');
}));
$('repricing-name').addEventListener('input',() => {
  pendingRepricingSave = null; repricingDirty = true; controls();
});
$('repricing-save').addEventListener('click',() => run(async () => {
  if (!repricingPreview) throw new Error('Review the exact payment changes before saving the configuration.');
  const label = $('repricing-name').value.trim();
  if (!label) throw new Error('Give this price change a name.');
  pendingRepricingSave ??= {...repricingPayload(),expectedRevision:repricingEditRevision,
    requestId:crypto.randomUUID(),label,reviewSha256:repricingPreview.reviewSha256};
  let result;
  try { result = await api('/api/repricing/save',pendingRepricingSave); }
  catch (error) {
    // Keep an interrupted request unchanged for an exact retry. A confirmed
    // conflict reloads the chain position while retaining the entered amounts.
    if (error.status === 409) {
      pendingRepricingSave = null; repricingPreview = null; $('repricing-review').hidden = true;
      try {
        const latest = await api('/api/repricing/source',{version:repricingSource.version});
        repricingSource.sellerChanged = latest.sellerChanged;
        repricingEditRevision = latest.repricingRevision;
        renderRepricingSource();
        $('repricing-state').textContent = 'Workspace changed · review amounts again';
      } catch { $('repricing-state').textContent = 'Refresh the workspace before reviewing again'; }
    }
    throw error;
  }
  repricingEditRevision = result.revision; repricingDirty = false; pendingRepricingSave = null; repricingPreview = null;
  const {changes,...savedSummary} = result;
  savedSummary.changedPaymentOptions = result.changedPaymentOptions ?? changes?.length ?? 0;
  savedSummary.changedRoutes = result.changedRoutes ?? new Set((changes ?? []).map(change=>change.routeId)).size;
  current.repricing = {...current.repricing,revision:result.revision,
    history:[savedSummary,...(current.repricing?.history ?? []).filter(item=>item.decision !== result.decision)].slice(0,100)};
  $('repricing-review').hidden = true; $('repricing-state').textContent = 'Saved · '+result.label;
  renderRepricingHistory();
  notice(result.recovered ? 'The prior configuration save completed. Its original package is available in Saved price changes.'
    : 'Seller configuration saved. Download the prepared configuration and merchant terms from Saved price changes.');
  $('repricing-history').scrollIntoView({behavior:'smooth',block:'nearest'});
}));
window.addEventListener('beforeunload',event => { if (dirty || sourceDirty || repricingDirty) { event.preventDefault(); event.returnValue = ''; } });

async function applyScenarioFromHash() {
  const match = /^#scenario-plan\/([a-f0-9-]{36})\/([a-zA-Z0-9._%-]+)$/.exec(location.hash);
  if (!match) return false;
  if ((dirty || sourceDirty || repricingDirty) && !window.confirm('Replace the current unsaved commercial assumptions with this saved scenario?')) return false;
  const latest = await readState();
  const result = await api('/api/planning/apply',{planId:match[1],scenarioId:decodeURIComponent(match[2])});
  if (result.sellerSha256 !== latest.seller.sha256)
    throw new Error('The seller configuration changed while this page was open. Refresh merchant pricing, then open the selected scenario again.');
  current = latest; draft = structuredClone(result.commercial); editRevision = latest.revision; selected = 0;
  pendingSave = null; renderInputs(); $('review-name').value = (result.label+' · '+result.scenarioLabel).slice(0,100);
  markDirty(); history.replaceState(null,'',location.pathname);
  notice('Applied '+result.scenarioLabel+' from '+result.label+'. Calculate and save this commercial review with the current operations source.');
  return true;
}
window.addEventListener('hashchange',() => run(applyScenarioFromHash));

async function initialize() {
  current = await api('/api/state'); draft = current.commercial; editRevision = current.revision; renderInputs();
  $('save-state').textContent = current.revision ? 'Loaded latest saved assumptions' : 'Unsaved review';
  if (await applyScenarioFromHash()) return;
  notice(current.sourceError || (current.sellerChanged ? 'Seller configuration has changed since the latest review. Review its current payment choices before saving.'
    : 'Select the original operations source, enter merchant assumptions, then calculate or save a review.'),Boolean(current.sourceError));
}
run(initialize);
