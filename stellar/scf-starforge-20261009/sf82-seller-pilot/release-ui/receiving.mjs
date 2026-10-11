// MIT. Receiving review of the exact saved release through the original SF101 workspace.
const node = (tag, text, className) => {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (className) value.className = className;
  return value;
};
const date = value => value ? new Date(value).toLocaleString() : '—';
const literal = value => value === undefined || value === null ? '—' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const pending = value => ['QUEUED', 'RUNNING'].includes(value?.record?.state);
const requestId = () => Date.now().toString(36) + '-' +
  [...crypto.getRandomValues(new Uint8Array(8))].map(value => value.toString(16).padStart(2, '0')).join('');

export function bindReceivingControls({ request, notice, isBusy, setBusy }) {
  const section = node('section', undefined, 'change'); section.id = 'release-receiving'; section.hidden = true;
  const heading = node('h3', 'Receiving review'), explanation = node('p',
    'Review this release’s exact payment choices, receiving accounts and token balances. Include a completed review with the existing selection and start controls below.');
  const stateText = node('p'), controls = node('div', undefined, 'actions'), details = node('details');
  details.append(node('summary', 'Saved source and receiving workspace'));
  const identities = node('pre'); details.append(identities);
  const makeButton = (label, id, parent = controls) => { const button = node('button', label); button.id = id; parent.append(button); return button; };
  const open = makeButton('Open receiving', 'receiving-open'), close = makeButton('Close receiving', 'receiving-close');
  const prepare = makeButton('Prepare from this release', 'receiving-prepare'), reload = makeButton('Refresh receiving', 'receiving-refresh');
  const desk = node('a', 'Open receiving desk'); desk.id = 'receiving-desk'; desk.target = '_blank'; desk.rel = 'noopener noreferrer'; controls.append(desk);
  const selectors = node('div', undefined, 'fields');
  function selectControl(label, id) {
    const group = node('div'), caption = node('label', label), select = node('select'); caption.htmlFor = id; select.id = id;
    group.append(caption, select); selectors.append(group); return select;
  }
  const profiles = selectControl('Saved source binding', 'receiving-bindings'), reviews = selectControl('Receiving review', 'receiving-reviews');
  const pages = node('div', undefined, 'actions');
  const firstProfiles = makeButton('First bindings', 'receiving-bindings-first', pages), moreProfiles = makeButton('More bindings', 'receiving-bindings-more', pages);
  const firstReviews = makeButton('First reviews', 'receiving-reviews-first', pages), moreReviews = makeButton('More reviews', 'receiving-reviews-more', pages);
  const actions = node('div', undefined, 'actions');
  const live = makeButton('Read current receiving state', 'receiving-live', actions);
  const replay = makeButton('Replay selected capture', 'receiving-replay', actions);
  const cancel = makeButton('Cancel review', 'receiving-cancel', actions);
  const recover = makeButton('Recover pending start', 'receiving-recover', actions);
  const download = makeButton('Download original capture', 'receiving-download', actions);
  const summary = node('p'), reasons = node('p'), reference = node('p');
  const reportTable = node('table'), header = node('thead'), headerRow = node('tr');
  for (const title of ['Payment choice', 'Receiving account', 'Native balance and capacity', 'Findings']) headerRow.append(node('th', title));
  header.append(headerRow); const reportRows = node('tbody'); reportRows.id = 'receiving-options'; reportTable.append(header, reportRows);
  const table = node('div', undefined, 'table-scroll'); table.append(reportTable);
  const optionPages = node('div', undefined, 'actions');
  const previousOptions = makeButton('Previous choices', 'receiving-options-previous', optionPages);
  const nextOptions = makeButton('Next choices', 'receiving-options-next', optionPages);
  const optionCaption = node('span'); optionPages.append(optionCaption);
  const imports = node('details'), importSummary = node('summary', 'Attach an existing receiving capture');
  const importText = node('p', 'Import an original capture in the receiving desk, then list the saved reviews here. Only reviews of this release’s exact seller configuration can be attached.');
  const importControls = node('div', undefined, 'actions'), imported = node('select'); imported.id = 'receiving-available';
  const importedLabel = node('label', 'Saved review'); importedLabel.htmlFor = imported.id;
  const listAvailable = makeButton('List saved reviews', 'receiving-available-list', importControls);
  const moreAvailable = makeButton('More saved reviews', 'receiving-available-more', importControls);
  const attach = makeButton('Attach selected review', 'receiving-attach', importControls);
  const availableText = node('p');
  imports.append(importSummary, importText, importedLabel, imported, importControls, availableText);
  section.append(heading, explanation, stateText, controls, details, selectors, pages, actions,
    summary, reasons, reference, table, optionPages, imports);
  document.querySelector('#selection-actions').before(section);

  let selectedRelease = null, generation = null, snapshot = null, bindingId = null, reviewId = null;
  let bindingAfter, reviewAfter, offset = 0, available = null, sequence = 0;
  let timer, loading = false, availableLoading = false, operation = false, retired = false;
  // One exact start intent survives an uncertain response and a page reload.
  const startKey = () => 'seller-release-receiving-start:' + (snapshot?.directory ?? '') + ':' + selectedRelease?.id;
  function savedStart() {
    try {
      const value = JSON.parse(sessionStorage.getItem(startKey()) ?? 'null');
      return value?.releaseId === selectedRelease?.id &&
        /^[a-z0-9]{8,13}-[a-f0-9]{16}$/.test(value.requestId) ? value : null;
    } catch { return null; }
  }
  function params(values) {
    return new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined && value !== null)).toString();
  }
  function fill(select, rows, current, label) {
    select.replaceChildren();
    for (const row of rows) { const option = node('option', label(row)); option.value = row.id; select.append(option); }
    if (current && rows.some(row => row.id === current)) select.value = current;
    if (!rows.length) { const option = node('option', 'None saved'); option.value = ''; select.append(option); }
  }
  function buttons(blocked = isBusy()) {
    const locked = blocked || operation, opened = snapshot?.state === 'OPEN', hasRelease = Boolean(selectedRelease);
    for (const button of section.querySelectorAll('button')) button.disabled = locked;
    open.disabled = locked || opened || !hasRelease;
    close.disabled = locked || !opened;
    prepare.disabled = locked || !opened || !hasRelease;
    reload.disabled = locked || !hasRelease || loading;
    profiles.disabled = locked || loading || !opened;
    reviews.disabled = locked || loading || !snapshot?.binding;
    live.disabled = locked || !opened || !snapshot?.binding || pending(snapshot?.review) || Boolean(savedStart());
    replay.disabled = locked || !opened || !snapshot?.binding || snapshot?.review?.record.state !== 'COMPLETED' || Boolean(savedStart());
    recover.hidden = !savedStart(); recover.disabled = locked || !opened || !savedStart();
    cancel.disabled = locked || !opened || !pending(snapshot?.review);
    download.disabled = locked || snapshot?.review?.record.state !== 'COMPLETED';
    firstProfiles.disabled = locked || loading || bindingAfter === undefined;
    moreProfiles.disabled = locked || loading || !snapshot?.bindings?.nextCursor;
    firstReviews.disabled = locked || loading || reviewAfter === undefined;
    moreReviews.disabled = locked || loading || !snapshot?.reviews?.nextCursor;
    previousOptions.disabled = locked || loading || !(snapshot?.review?.report?.optionOffset > 0);
    nextOptions.disabled = locked || loading || snapshot?.review?.report?.nextOptionOffset === null || !snapshot?.review?.report;
    listAvailable.disabled = locked || !opened || availableLoading;
    moreAvailable.disabled = locked || !opened || availableLoading || !available?.nextCursor;
    imported.disabled = locked || availableLoading || !opened;
    attach.disabled = locked || !opened || !imported.value;
    desk.hidden = !opened;
    if (opened) desk.href = '/receiving/'; else desk.removeAttribute('href');
  }
  function render(value) {
    snapshot = value; bindingId = value.binding?.id ?? null; reviewId = value.review?.record.id ?? null;
    const binding = value.binding, review = value.review, report = review?.report;
    stateText.textContent = value.state === 'OPEN'
      ? 'Receiving workspace open · release ' + selectedRelease.id + ' · selection generation ' + value.generation +
        (value.workspace?.activeReview ? ' · native review active' : '') + '.'
      : 'Receiving workspace closed. Open it here to use its saved profiles, reviews and captures.';
    identities.textContent = JSON.stringify({ release: selectedRelease.id, releaseDigest: selectedRelease.digest,
      sellerConfigurationSha256: selectedRelease.source.serviceConfigSha256, workspace: value.directory,
      selectionGeneration: value.generation ?? generation,
      ...(binding ? { bindingId: binding.id, preparedGeneration: binding.preparedGeneration,
        profileId: binding.profileId, planDigest: binding.planDigest,
        configurationSha256: binding.configurationSha256 } : {}) }, null, 2);
    const bindingRows = [...value.bindings?.rows ?? []];
    if (binding && !bindingRows.some(row => row.id === binding.id)) bindingRows.unshift(binding);
    fill(profiles, bindingRows, bindingId, row => 'Selection ' + row.preparedGeneration + ' · ' + date(row.createdAt) + ' · ' + row.id);
    const reviewRows = [...value.reviews?.rows ?? []];
    if (review && !reviewRows.some(row => row.id === review.record.id)) reviewRows.unshift(review.record);
    fill(reviews, reviewRows, reviewId, row => row.state + ' · ' + date(row.completedAt ?? row.createdAt) + ' · ' + row.id);
    summary.textContent = report
      ? report.status.replaceAll('_', ' ') + ' · ' + report.mode + ' · completed ' + date(report.completedAt) + '. ' +
        Object.entries(report.summary ?? {}).map(([key, count]) => key.replace(/[A-Z]/g, letter => ' ' + letter.toLowerCase()) + ': ' + count).join(' · ')
      : review ? review.record.state.replaceAll('_', ' ') +
        (review.record.error ? ' · ' + literal(review.record.error) : '') +
        (review.record.cancellationRequested ? ' · cancellation requested' : '')
      : binding ? 'Source prepared. Read current receiving state or attach a retained capture.' : 'Prepare the exact saved configuration or attach an existing capture.';
    reasons.textContent = report?.sourceReasons?.length ? 'Capture findings: ' + report.sourceReasons.map(reason => typeof reason === 'string' ? reason : literal(reason)).join(' · ') : '';
    reference.textContent = report && review.record.state === 'COMPLETED'
      ? 'This completed review will accompany selection or start for ' + selectedRelease.id +
        '. Source prepared at generation ' + binding.preparedGeneration + '; current generation ' + value.generation + '.'
      : 'Selection, rollback and seller operation use the existing release controls.';
    reportRows.replaceChildren();
    for (const row of report?.options ?? []) {
      const item = node('tr'), choice = node('td'), receiving = node('td'), balances = node('td'), findings = node('td');
      choice.append(node('strong', row.method + ' ' + row.path), node('div', row.terms.amount + ' atomic'),
        node('div', row.terms.asset), node('div', row.terms.network));
      receiving.append(node('div', row.terms.payTo));
      const native = row.readiness?.native, classic = row.readiness?.classic?.recipient;
      balances.append(node('div', 'Native balance: ' + literal(native?.recipient?.balanceAtomic) + ' atomic'));
      if (native?.amountDecimal !== undefined) balances.append(node('div', 'Quoted amount: ' + native.amountDecimal + ' ' + (native.token?.symbol ?? '')));
      if (classic?.inboundCapacity !== undefined) balances.append(node('div', 'Inbound capacity: ' + literal(classic.inboundCapacity)));
      findings.append(node('strong', row.status.replaceAll('_', ' ')));
      const original = review.actions?.find(action => action.optionId === row.optionId)?.actions ?? [];
      for (const action of original) findings.append(node('p', action.text));
      if (!original.length) for (const reason of row.readiness?.reasons ?? []) findings.append(node('div', typeof reason === 'string' ? reason : literal(reason)));
      const retained = node('details'); retained.append(node('summary', 'Original native observations'), node('pre', JSON.stringify(row.readiness, null, 2))); findings.append(retained);
      item.append(choice, receiving, balances, findings); reportRows.append(item);
    }
    table.hidden = !report;
    optionCaption.textContent = report ? 'Choices ' + (report.options.length ? report.optionOffset + 1 : 0) + '–' +
      (report.optionOffset + report.options.length) + ' of ' + report.optionsTotal : '';
    optionPages.hidden = !report || report.optionsTotal <= 20;
    buttons();
  }
  async function refresh() {
    if (!selectedRelease || retired) return;
    const current = ++sequence, releaseId = selectedRelease.id;
    clearTimeout(timer); loading = true; buttons();
    try {
      const value = await request('/api/receiving/status?' + params({ releaseId, bindingId, reviewId, bindingAfter, reviewAfter, offset }));
      if (current !== sequence || retired || releaseId !== selectedRelease?.id) return;
      render(value);
      if (pending(value.review)) timer = setTimeout(() => { void refresh(); }, 1200);
    } catch (error) {
      if (current === sequence && !retired) { stateText.textContent = error.message; notice(error.message, true); }
    } finally {
      if (current === sequence) { loading = false; buttons(); }
    }
  }
  async function action(name, input = {}) {
    if (isBusy() || operation || !selectedRelease) return;
    operation = true; setBusy(true); clearTimeout(timer); buttons();
    try {
      const result = await request('/api/receiving/' + name, input);
      if (result.binding) { bindingId = result.binding.id; bindingAfter = undefined; reviewAfter = undefined; offset = 0; }
      if (result.reviewId || result.review?.id) reviewId = result.reviewId ?? result.review.id;
      if (name === 'prepare') reviewId = null;
      if (name === 'close') { bindingId = null; reviewId = null; available = null; imported.replaceChildren(); }
      if (name === 'start') sessionStorage.removeItem(startKey());
      await refresh();
      notice(name === 'start' ? 'Receiving review accepted. Its original saved job records progress and cancellation.'
        : name === 'attach' ? 'The exact retained capture is now linked to this release.'
        : name === 'prepare' ? 'Receiving source prepared from the retained seller configuration.'
        : name === 'close' ? 'Receiving workspace closed. It can be reopened by its existing browser, CLI or MCP operator.'
        : name === 'cancel' ? 'Cancellation requested for the original receiving job.' : 'Receiving workspace opened.');
      return result;
    } catch (error) {
      if (name === 'start' && error.code === 'RELEASE_CONFLICT') sessionStorage.removeItem(startKey());
      notice(error.message, true); await refresh();
    }
    finally { operation = false; setBusy(false); buttons(); }
  }
  const releaseInput = () => ({ releaseId: selectedRelease.id, expectedGeneration: generation });
  async function start(mode) {
    if (!snapshot?.binding) return;
    const input = { ...releaseInput(), bindingId, mode,
      ...(mode === 'replay' ? { captureReviewId: reviewId } : {}),
      ...(snapshot.review?.record.state === 'COMPLETED' ? { previousReviewId: reviewId } : {}) };
    const retained = savedStart();
    const intent = retained ?? { ...input, requestId: requestId() };
    sessionStorage.setItem(startKey(), JSON.stringify(intent));
    await action('start', intent);
  }
  async function loadAvailable(after) {
    if (!selectedRelease || availableLoading || isBusy()) return;
    const releaseId = selectedRelease.id;
    availableLoading = true; buttons();
    try {
      const value = await request('/api/receiving/available?' + params({ releaseId, after }));
      if (selectedRelease?.id !== releaseId || retired) return;
      available = value;
      const compatible = value.rows.filter(row => row.compatible && row.state === 'COMPLETED');
      fill(imported, compatible, null, row => date(row.completedAt ?? row.createdAt) + ' · ' + row.id);
      availableText.textContent = compatible.length + ' compatible completed reviews on this page. ' +
        (value.nextCursor ? 'More saved reviews are available.' : 'End of saved reviews.');
    } catch (error) { notice(error.message, true); }
    finally { availableLoading = false; buttons(); }
  }
  open.addEventListener('click', () => action('open'));
  close.addEventListener('click', () => action('close'));
  prepare.addEventListener('click', () => action('prepare', releaseInput()));
  reload.addEventListener('click', () => refresh());
  profiles.addEventListener('change', () => { bindingId = profiles.value || null; reviewId = null; reviewAfter = undefined; offset = 0; void refresh(); });
  reviews.addEventListener('change', () => { reviewId = reviews.value || null; offset = 0; void refresh(); });
  firstProfiles.addEventListener('click', () => { bindingAfter = undefined; bindingId = null; reviewId = null; reviewAfter = undefined; offset = 0; void refresh(); });
  moreProfiles.addEventListener('click', () => { bindingAfter = snapshot.bindings.nextCursor; bindingId = null; reviewId = null; reviewAfter = undefined; offset = 0; void refresh(); });
  firstReviews.addEventListener('click', () => { reviewAfter = undefined; reviewId = null; offset = 0; void refresh(); });
  moreReviews.addEventListener('click', () => { reviewAfter = snapshot.reviews.nextCursor; reviewId = null; offset = 0; void refresh(); });
  previousOptions.addEventListener('click', () => { offset = Math.max(0, snapshot.review.report.optionOffset - 20); void refresh(); });
  nextOptions.addEventListener('click', () => { offset = snapshot.review.report.nextOptionOffset; void refresh(); });
  live.addEventListener('click', () => start('live'));
  replay.addEventListener('click', () => start('replay'));
  cancel.addEventListener('click', () => action('cancel', { releaseId: selectedRelease.id, bindingId, reviewId }));
  recover.addEventListener('click', () => { const intent = savedStart(); if (intent) void action('start', intent); });
  listAvailable.addEventListener('click', () => loadAvailable(undefined));
  moreAvailable.addEventListener('click', () => loadAvailable(available.nextCursor));
  imported.addEventListener('change', () => buttons());
  attach.addEventListener('click', () => action('attach', { ...releaseInput(), reviewId: imported.value }));
  download.addEventListener('click', async () => {
    if (isBusy() || operation || !reviewId) return;
    operation = true; buttons();
    try {
      const blob = await request('/api/receiving/export?' + params({ releaseId: selectedRelease.id, bindingId, reviewId }), undefined, 'blob');
      const url = URL.createObjectURL(blob), link = node('a'); link.href = url; link.download = 'release-receiving-' + reviewId + '.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { notice(error.message, true); }
    finally { operation = false; buttons(); }
  });
  addEventListener('pagehide', () => { retired = true; clearTimeout(timer); });
  addEventListener('pageshow', event => { if (event.persisted) { retired = false; void refresh(); } });
  return {
    buttons,
    refresh,
    selectRelease(release, currentGeneration) {
      const changed = selectedRelease?.id !== release.id || selectedRelease?.digest !== release.digest;
      selectedRelease = release; generation = currentGeneration; section.hidden = false;
      if (changed) {
        ++sequence; snapshot = null; bindingId = null; reviewId = null; bindingAfter = undefined; reviewAfter = undefined; offset = 0;
        available = null; imported.replaceChildren(); availableText.textContent = '';
      }
      void refresh();
    },
    selectionReference(releaseId) {
      return snapshot?.state === 'OPEN' && snapshot.binding?.sourceCurrent &&
        snapshot.binding.releaseId === releaseId && snapshot.review?.record.state === 'COMPLETED'
        ? { bindingId: snapshot.binding.id, reviewId: snapshot.review.record.id } : null;
    },
  };
}
