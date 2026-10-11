/* MIT. Optional revision/reconciliation panels for the original catalog workspace. */
(() => {
  'use strict';
  const element = (tag, text, className) => {
    const item = document.createElement(tag);
    if (text !== undefined && text !== null) item.textContent = String(text);
    if (className) item.className = className;
    return item;
  };
  const json = value => JSON.stringify(value, null, 2);
  const pair = (target, label, value) => {
    target.append(element('dt', label), element('dd', value ?? '—'));
  };
  function paymentTable(terms) {
    const outer = element('div', null, 'table-scroll'), table = element('table', null, 'revision-terms');
    const head = element('thead'), labels = element('tr');
    for (const label of ['Option', 'Atomic amount', 'Network / asset', 'Recipient', 'Timeout']) labels.append(element('th', label));
    head.append(labels); table.append(head); const body = element('tbody');
    for (const [index, term] of terms.entries()) {
      const row = element('tr');
      row.append(element('td', index + 1), element('td', term.amount ?? term.maxAmountRequired ?? '—', 'revision-atomic'),
        element('td', `${term.network}\n${term.asset}`), element('td', term.payTo), element('td', term.maxTimeoutSeconds ?? '—'));
      body.append(row);
    }
    table.append(body); outer.append(table); return outer;
  }
  function side(title, value) {
    const section = element('section'); section.append(element('h4', title));
    if (Array.isArray(value) && value.length && value.every(item => item && typeof item === 'object' && 'payTo' in item)) {
      section.append(paymentTable(value));
      const detail = element('details'); detail.append(element('summary', 'Complete ordered payment alternatives'), element('pre', json(value))); section.append(detail);
    } else section.append(element('pre', json(value)));
    return section;
  }
  function renderReview(target, review) {
    target.replaceChildren(); target.hidden = !review; if (!review) return;
    target.append(element('h3', 'Current → proposed revision'));
    target.append(element('p', 'Original discovery declarations are compared without changing option order, atomic strings, timeouts or interface metadata. Signature and policy verification remain in the native operator.', 'muted'));
    const summary = element('dl');
    pair(summary, 'Current state / sequence', `${review.before.state} / ${review.before.sequence ?? '—'}`);
    pair(summary, 'Proposed state / sequence', `${review.after.state} / ${review.after.sequence}`);
    pair(summary, 'Comparison captured', review.capturedAt);
    pair(summary, 'Target revision binding', review.resourceBinding);
    pair(summary, 'Original source SHA-256', review.after.sourceSha256);
    if (review.proofWindow) {
      const expiry = review.proofWindow.expiresAt;
      pair(summary, 'Received proof expiry', expiry ? `${expiry}${Date.parse(expiry) <= Date.now() ? ' · expired' : ''}` : 'Not available in received proof metadata');
    }
    target.append(summary);
    for (const warning of review.warnings ?? []) target.append(element('p', warning, 'revision-warning'));
    if (review.before.state === 'retired' && !review.before.declaration)
      target.append(element('p', 'The retired declaration is absent from live discovery. Its original lifecycle record remains below; no prior discovery metadata has been reconstructed.', 'muted'));
    if (!review.changes.length) target.append(element('p', 'No visible declaration fields changed. The exact source bytes, observation/provenance and seller sequence still identify this operation.'));
    for (const change of review.changes) {
      const section = element('section', null, 'revision-change');
      section.append(element('h4', change.label), element('code', change.path, 'small'));
      const comparison = element('div', null, 'revision-columns');
      comparison.append(side('Current', change.before), side('Proposed', change.after)); section.append(comparison); target.append(section);
    }
    const detail = element('details');
    detail.append(element('summary', 'Original lifecycle projection and complete comparison'), element('pre', json(review))); target.append(detail);
  }
  function renderReconciliation(target, observation) {
    target.replaceChildren(); target.hidden = !observation; if (!observation) return;
    const present = observation.verdict === 'MATCHING_ORIGINAL_REVISION_PRESENT';
    target.append(element('h3', present ? 'Matching original revision found' : 'No matching revision observed'));
    const summary = element('dl');
    pair(summary, 'Observed at', observation.checkedAt);
    pair(summary, 'Recorded command outcome', observation.recordedCommandPhase);
    pair(summary, 'Native command receipt', observation.recordedReceiptAvailable ? 'Retained on this operation' : 'Not available; not reconstructed');
    pair(summary, 'Current seller / sequence', observation.current ? `${observation.current.sellerId} / ${observation.current.sequence}` : 'Not present');
    pair(summary, 'Current catalog state', observation.current ? observation.current.retired ? 'retired' : 'active' : 'absent');
    pair(summary, 'Observed journal head', observation.journalHead); target.append(summary);
    for (const match of observation.matches ?? []) target.append(element('p',
      `Original history contains ${match.state} sequence ${match.sequence}${match.superseded ? ', now superseded by a later revision' : ', still the latest revision'}. Source SHA-256: ${match.sourceSha256}`, 'revision-match'));
    target.append(element('p', observation.interpretation, 'muted'));
    const detail = element('details'); detail.append(element('summary', 'Saved reconciliation observation'), element('pre', json(observation))); target.append(detail);
  }
  window.CatalogRevisionUI = Object.freeze({ renderReview, renderReconciliation });
})();
