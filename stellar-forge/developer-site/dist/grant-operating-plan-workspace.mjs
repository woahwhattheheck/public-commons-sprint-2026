// MIT. Customer procedure controls inside the original saved SF47 planning review.
import { grantOperatingSelectionOf, prepareGrantOperatingPlan, grantOperatingContinuationPlan,
  compareGrantOperatingReturn, receiveGrantOperatingReturn, stageGrantOperatingReturn,
  refreshGrantOperatingReturn, closeGrantOperatingReturn } from './grant-operating-plan-core.mjs';
import { retainVersion, validateDraft, MAX_BYTES } from './grant-submission-core.mjs';
import { planSummary } from './grant-plan-core.mjs';
import { CATALOG_SCHEMA, searchCommandCatalog } from
  '../../../stellar/scf-starforge-20261009/distribution/discovery/catalog.mjs';
import { snapshotRegistration, renderOperatingPlanHTML, renderOperatingPlanMarkdown, operatingFileBytes, operatingFileSummary } from
  '../../../stellar/scf-starforge-20261009/distribution/discovery/operating-plan.mjs';

import { renderOperatingPlanReturnHTML } from
  '../../../stellar/scf-starforge-20261009/distribution/discovery/operating-plan-return.mjs';

const catalogs = new Map();
const cleanName = value => String(value).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120) || 'grant-operating-plan';
const clone = value => JSON.parse(JSON.stringify(value));
export function renderGrantOperatingPlan(root, context, { source, plan, review }) {
  const { node, input, select, button, touch, render, work, download } = context;
  const draft = context.getDraft();
  const key = draft.id + ':' + source.sha256 + ':' + plan.revision;
  let selection;
  try { selection = grantOperatingSelectionOf(review, source); }
  catch (error) {
    root.append(node('p', error.message, 'issues'));
    return;
  }
  const cache = catalogs.get(key) ?? { catalog: null, query: '' };
  const update = change => {
    const current = context.getDraft();
    const selected = current.planningReview;
    if (!selected || selected.sourceSha !== source.sha256 || selected.revision !== plan.revision)
      throw new Error('Reopen the intended native planning revision before changing its customer procedure.');
    selected.operatingSelection = grantOperatingSelectionOf(selected, source);
    change(selected.operatingSelection); selection = clone(selected.operatingSelection);
    touch();
  };
  const section = node('section', undefined, 'card grant-operating-procedure');
  section.dataset.grantOperatingSource = source.sha256;
  section.dataset.grantOperatingRevision = String(plan.revision);
  section.append(node('h3', 'Customer operating procedure'),
    node('p', 'Turn the selected native work packages into ordered work for the receiving operator. Each step retains its original scope, completion result, price and relative work window. Continue editing it in Operating plans.'));

  const fields = node('div', undefined, 'grid');
  for (const [name, label, area] of [
    ['title', 'Procedure title', false], ['customer', 'Customer or installation', false],
    ['owner', 'Operating owner', false], ['purpose', 'Useful result', true],
    ['receiving', 'Receiving operator, location and continuation', true], ['notes', 'Procedure notes', true],
  ]) {
    const control = input(label, selection[name], value => update(saved => { saved[name] = value; }), { area });
    control.field.maxLength = ['title', 'owner'].includes(name) ? 300 : name === 'customer' ? 1000 : 32000;
    fields.append(control.wrap);
  }
  section.append(fields);

  const catalogBox = node('details');
  catalogBox.append(node('summary', 'Attach original toolkit registrations'),
    node('p', 'Use the complete toolkit catalog exported by Command finder. Select a registration for a work package to retain its original source and runtime details; a command opens with its native help arguments.'),
    node('pre', 'starforge discover plan catalog --out /absolute/customer/toolkit-catalog.json', 'source-text'));
  const file = node('input'); file.type = 'file'; file.accept = '.json,application/json';
  file.setAttribute('aria-label', 'Complete Command finder catalog');
  file.addEventListener('change', () => work(async () => {
    const chosen = file.files?.[0]; if (!chosen) return;
    if (chosen.size > 32 * 1024 * 1024) throw new TypeError('Choose the complete catalog within 32 MiB.');
    const received = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await chosen.arrayBuffer()));
    if (received?.schema !== CATALOG_SCHEMA || !received.package || !Array.isArray(received.sources) ||
      !Array.isArray(received.items) || !Array.isArray(received.featureNames))
      throw new TypeError('Choose the complete toolkit catalog from discover plan catalog or the Operating plans catalog download.');
    searchCommandCatalog(received, { pageSize: 1 });
    catalogs.set(key, { catalog: received, query: '' }); render();
    context.status('Opened the original toolkit catalog. Choose the registration for each selected work package.');
  }));
  catalogBox.append(file);
  const picker = node('div');
  let queryField;
  const paintBindings = () => {
    picker.replaceChildren();
    const currentSelection = grantOperatingSelectionOf(context.getDraft().planningReview, source);
    const latest = catalogs.get(key) ?? cache;
    let matches = [], total = 0;
    if (latest.catalog) {
      try {
        const found = searchCommandCatalog(latest.catalog, { query: latest.query, pageSize: 50 });
        matches = found.items; total = found.total;
        picker.append(node('p', latest.catalog.package.name + ' · ' + latest.catalog.package.version +
          ' · ' + total + ' matches' + (total > matches.length ? ' · first 50 shown; narrow the search to select another registration' : ''), 'muted'));
      } catch (error) { picker.append(node('p', error.message, 'issues')); }
    } else picker.append(node('p', 'Saved registration selections remain with their packages. Load a catalog to choose or replace them.', 'muted'));
    const summary = planSummary(source, plan.revision, context.getDraft().planningReview.costIds);
    for (const cost of summary.costs) {
      const selected = Object.hasOwn(currentSelection.bindings, cost.id) ? currentSelection.bindings[cost.id] : null;
      const choices = [['', 'Manual procedure — no registration selected']];
      if (selected && !matches.some(item => item.id === selected.item.id))
        choices.push([selected.item.id, selected.item.kind + ' · ' + selected.item.name + ' (retained selection)']);
      for (const item of matches) choices.push([item.id, item.kind + ' · ' + item.name]);
      const row = node('div', undefined, 'card');
      row.append(node('p', cost.remaining_work),
        select(cost.id + ' · original registration', selected?.item.id ?? '', choices, id => work(() => {
          if (!id) update(saved => { saved.bindings[cost.id] = null; });
          else if (selected?.item.id !== id || latest.catalog?.items.some(item => item.id === id)) {
            if (!latest.catalog) throw new Error('Load the complete toolkit catalog to choose this registration.');
            const registration = snapshotRegistration(latest.catalog, id);
            update(saved => { saved.bindings[cost.id] = registration; });
          }
          paintBindings();
        })).wrap);
      if (selected) {
        row.append(node('p', selected.item.description, 'muted'));
        const details = node('details');
        details.append(node('summary', 'Retained source and runtime'), node('pre', JSON.stringify(selected, null, 2), 'source-text'));
        row.append(details);
      }
      picker.append(row);
    }
  };
  queryField = input('Find a toolkit registration', cache.query, value => {
    const current = catalogs.get(key) ?? cache; current.query = value; catalogs.set(key, current); paintBindings();
  });
  queryField.field.maxLength = 512;
  catalogBox.append(queryField.wrap, picker); paintBindings(); section.append(catalogBox);

  const summary = planSummary(source, plan.revision, review.costIds);
  const create = button('Create operating plan from selected work packages', () => {
    const current = context.getDraft(), selected = current.planningReview;
    if (selected?.sourceSha !== source.sha256 || selected.revision !== plan.revision)
      throw new Error('Reopen the selected native planning edition first.');
    const chosen = grantOperatingSelectionOf(selected, source);
    const prepared = prepareGrantOperatingPlan(source, selected, { id: context.uid(), selection: chosen });
    const next = retainVersion(current, 'Before creating customer operating procedure');
    next.planningReview.operatingSelection = chosen;
    next.planningReview.operatingSelection.prepared.push(prepared);
    context.setDraft(validateDraft(next)); touch(); render();
    download(JSON.stringify(prepared.plan, null, 2) + '\n',
      cleanName(prepared.plan.id) + '-operating-plan.json', 'application/json');
    context.status('Created the customer operating plan from ' + prepared.packageIds.length +
      ' original work packages. Its complete prepared copy remains in this saved planning review.');
  });
  create.disabled = summary.costs.length === 0;
  section.append(node('p', summary.costs.length + ' selected work packages · original native revision ' + plan.revision, 'muted'),
    create,
    node('p', 'Import the downloaded JSON in Command finder → Operating plans. The new procedure starts with planned work; use its editor for detailed instructions, actual due dates and recorded results.', 'muted'));

  if (selection.prepared.length) {
    const history = node('details');
    history.append(node('summary', 'Prepared customer procedures (' + selection.prepared.length + ')'));
    for (const item of [...selection.prepared].reverse()) {
      const currentPlan = grantOperatingContinuationPlan(item);
      const entry = node('article', undefined, 'card'), last = currentPlan.revisions.at(-1), stem = cleanName(item.plan.id);
      entry.append(node('h4', last.title),
        node('p', item.packageIds.length + ' work packages · operating revision ' + last.revision + ' · prepared ' + item.plan.createdAt, 'muted'));
      const actions = node('div', undefined, 'row');
      actions.append(
        button('Download operating plan JSON', () => download(JSON.stringify(currentPlan, null, 2) + '\n', stem + '.json', 'application/json')),
        button('Download procedure HTML', () => download(renderOperatingPlanHTML(currentPlan), stem + '.html', 'text/html')),
        button('Download procedure Markdown', () => download(renderOperatingPlanMarkdown(currentPlan), stem + '.md', 'text/markdown')),
      );
      entry.append(actions);
      if (item.continuation) {
        entry.append(button('Download original prepared plan', () =>
          download(JSON.stringify(item.plan, null, 2) + '\n', stem + '-prepared.json', 'application/json')));
        const progress = compareGrantOperatingReturn(source, context.getDraft().planningReview, currentPlan);
        const details = node('details'); details.append(node('summary', 'Received customer work and package results'));
        renderReturnDetails(details, context, progress);
        const receiving = node('details'); receiving.append(node('summary', 'Procedure receiving history'));
        for (const record of item.continuation.receipts) receiving.append(node('p',
          record.at + ' · revisions ' + record.fromRevision + ' → ' + record.toRevision +
          (record.filename ? ' · ' + record.filename : '') + (record.note ? '\n' + record.note : '')));
        details.append(receiving); entry.append(details);
      }
      if (item.reviewedReturns?.length) {
        const reviews = node('details');
        reviews.append(node('summary', 'Completed return reviews (' + item.reviewedReturns.length + ')'));
        for (const received of item.reviewedReturns) {
          const card = node('article', undefined, 'card');
          card.append(node('p', received.at + ' · reviewed result revision ' + received.resultRevision +
            (received.filename ? ' · ' + received.filename : ''), 'muted'));
          if (received.note) card.append(node('pre', received.note, 'source-text'));
          renderReviewedReturn(card, context, received.review); reviews.append(card);
        }
        entry.append(reviews);
      }
      history.append(entry);
    }
    section.append(history);
    renderReturnReceiving(section, context, source, plan.revision);
  }
  root.append(section);
}


function renderReviewedReturn(root, context, review) {
  const { node, button, download } = context;
  root.append(node('h4', 'Completed reconciliation · ' + review.id),
    node('p', 'Reviewing operator: ' + review.reviewer + ' · completed ' + review.completion.savedAt),
    node('p', 'Current branch revision ' + review.current.revisions.length +
      ' · returned branch revision ' + review.incoming.revisions.length +
      ' · reviewed result revision ' + review.completion.plan.revisions.length +
      ' · ' + review.decisions.length + ' explicit decisions', 'muted'));
  if (review.notes) root.append(node('pre', review.notes, 'source-text'));
  const choices = node('details'); choices.append(node('summary', 'Review decisions and both complete branches'));
  for (const decision of review.decisions) choices.append(node('h5', decision.key + ' · ' + decision.take),
    node('pre', JSON.stringify(decision, null, 2), 'source-text'));
  for (const [label, plan] of [['Original current branch', review.current], ['Original returned branch', review.incoming],
    ['Exact completed result', review.completion.plan]]) {
    const branch = node('details'); branch.append(node('summary', label),
      node('pre', JSON.stringify(plan, null, 2), 'source-text')); choices.append(branch);
  }
  root.append(choices, button('Download complete reconciliation review', () =>
    download(JSON.stringify(review, null, 2) + '\n', cleanName(review.id) + '-review.json', 'application/json')),
    button('Download readable reconciliation review', () =>
      download(renderOperatingPlanReturnHTML(review), cleanName(review.id) + '-review.html', 'text/html')));
}


function appendOperatingFileDownloads(root, context, label, files = []) {
  const { node, button } = context;
  if (!files.length) return;
  root.append(node('h5', label));
  for (const file of files) {
    const row = node('div', undefined, 'card');
    row.append(node('p', file.name + ' · ' + file.bytes.toLocaleString() + ' bytes · ' + file.mediaType),
      ...(file.note ? [node('p', file.note)] : []),
      button('Download ' + file.name, () => {
        const url = URL.createObjectURL(new Blob([operatingFileBytes(file)], { type: 'application/octet-stream' }));
        const link = node('a'); link.href = url; link.download = file.name;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }));
    root.append(row);
  }
}

function renderReturnDetails(root, context, comparison) {
  const { node } = context;
  root.append(node('p', comparison.packageIds.length + ' original work packages · ' +
    comparison.counts.completed + ' recorded completed · ' + comparison.counts['in-progress'] +
    ' in progress · ' + comparison.counts.planned + ' planned · ' + comparison.counts.skipped +
    ' skipped · ' + comparison.counts.missing + ' absent from returned revision', 'muted'));
  const order = node('details');
  order.open = comparison.stepOrder.changedFromPrevious;
  order.append(node('summary', comparison.stepOrder.changedFromPrevious
    ? 'Operating step sequence changed' : 'Complete operating step sequence'),
    node('p', comparison.stepOrder.addedIds.length + ' added steps · ' +
      comparison.stepOrder.removedIds.length + ' removed steps · ' +
      (comparison.stepOrder.changedFromPrepared ? 'sequence differs from the original preparation' : 'original prepared sequence retained'), 'muted'));
  for (const [label, rows] of [['Originally prepared', comparison.stepOrder.prepared],
    ['Previously selected', comparison.stepOrder.previous], ['Returned sequence', comparison.stepOrder.returned]]) {
    order.append(node('h5', label));
    const list = node('ol');
    for (const row of rows) {
      const entry = node('li');
      entry.append(node('span', row.title), node('span', ' · ' + row.id, 'muted')); list.append(entry);
    }
    order.append(rows.length ? list : node('p', 'No steps in this revision.', 'muted'));
  }
  root.append(order);
  for (const change of comparison.planChanges) {
    const detail = node('details'); detail.append(node('summary', 'Procedure ' + change.field + ' changed'),
      node('h5', 'Previously selected'), node('pre', change.previous, 'source-text'),
      node('h5', 'Returned value'), node('pre', change.returned, 'source-text'));
    root.append(detail);
  }
  for (const item of comparison.packages) {
    const card = node('article', undefined, 'card'), current = item.returned;
    card.append(node('h4', item.packageId), node('p', item.native.remaining_work),
      node('p', 'Original completion result: ' + item.native.measurable_proof));
    if (!current) {
      card.append(node('p', 'This package step is absent from the returned operating revision. Its original work and completion result remain here.', 'issues'));
    } else {
      card.append(node('p', 'Recorded status: ' + current.status +
        (current.owner ? ' · owner: ' + current.owner : '') + (current.due ? ' · due: ' + current.due : '')),
        node('h5', 'Returned result'), node('pre', current.recordedResult || 'No result entered.', 'source-text'));
      if (item.changedFromPrepared.length) {
        const changes = node('details'); changes.append(node('summary', 'Compare with the original package procedure'));
        for (const field of item.changedFromPrepared.filter(field => field !== 'files')) {
          const format = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
          changes.append(node('h5', field), node('p', 'Originally prepared', 'muted'),
            node('pre', format(item.original[field]), 'source-text'), node('p', 'Returned', 'muted'),
            node('pre', format(current[field]), 'source-text'));
        }
        card.append(changes);
      }
    }
    const fileChanges = item.filesFromPrevious;
    if (item.original.files?.length || item.previous?.files?.length || current?.files?.length) {
      const files = node('details');
      files.open = Boolean(fileChanges.added.length || fileChanges.removed.length || fileChanges.changed.length);
      files.append(node('summary', 'Complete customer result files'),
        node('p', fileChanges.added.length + ' added · ' + fileChanges.removed.length + ' removed · ' +
          fileChanges.changed.length + ' changed' + (fileChanges.orderChanged ? ' · file order changed' : ''), 'muted'));
      appendOperatingFileDownloads(files, context, 'Originally prepared files', item.original.files);
      appendOperatingFileDownloads(files, context, 'Previously selected files', item.previous?.files);
      appendOperatingFileDownloads(files, context, 'Returned files', current?.files);
      card.append(files);
    }
    root.append(card);
  }
  if (comparison.additionalSteps.length) {
    const additional = node('details');
    additional.append(node('summary', 'Additional customer operating steps (' + comparison.additionalSteps.length + ')'),
      node('p', 'These are retained customer procedure steps alongside the original funded package mapping.'));
    for (const step of comparison.additionalSteps) {
      additional.append(node('h4', step.title),
        node('pre', JSON.stringify({ ...step, ...(step.files ? { files: step.files.map(operatingFileSummary) } : {}) }, null, 2), 'source-text'));
      appendOperatingFileDownloads(additional, context, 'Complete customer result files', step.files);
    }
    root.append(additional);
  }
}

function renderReturnReceiving(root, context, source, nativeRevision) {
  const { node, button, input, work, render, touch, download } = context;
  const selectedReview = () => {
    const review = context.getDraft().planningReview;
    if (!review || review.sourceSha !== source.sha256 || review.revision !== nativeRevision)
      throw new Error('Reopen the intended native planning revision before changing its returned procedure.');
    return review;
  };
  const pendingOf = () => grantOperatingSelectionOf(selectedReview(), source).returnDraft ?? null;
  const replaceReview = (review, label, message) => {
    const next = retainVersion(context.getDraft(), label);
    next.planningReview = review;
    context.setDraft(validateDraft(next)); touch(); render(); context.status(message);
  };
  const close = () => replaceReview(closeGrantOperatingReturn(source, selectedReview()),
    'Before closing unfinished customer return',
    'Closed this unfinished return. Its full source and note remain in the preceding saved version.');
  const section = node('section', undefined, 'card');
  section.append(node('h3', 'Receive customer procedure'),
    node('p', 'Open a complete later Operating plan or a completed Returned procedures review JSON. Review the original package mapping and recorded work. A reconciliation keeps both complete branches, every decision and the reviewing operator with its result in this same saved submission. Save to retain the unfinished return and receiving note.'));
  const file = node('input'); file.type = 'file'; file.accept = '.json,application/json';
  file.setAttribute('aria-label', 'Complete returned customer operating plan or completed reconciliation review');
  file.addEventListener('change', () => work(async () => {
    const chosen = file.files?.[0]; if (!chosen) return;
    if (!chosen.size || chosen.size > MAX_BYTES) throw new TypeError('Choose a complete operating plan or completed review within the existing 16 MiB draft limit.');
    const originalDraft = context.getDraft(), originalReview = selectedReview();
    const incoming = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await chosen.arrayBuffer()));
    if (context.getDraft() !== originalDraft || context.getDraft().planningReview !== originalReview)
      throw new Error('The selected submission changed while the returned file was being read. Open it again in the intended draft.');
    const staged = stageGrantOperatingReturn(source, selectedReview(), incoming, { filename: chosen.name });
    replaceReview(staged.review, 'Before opening customer operating return',
      'Opened customer operating revision ' + staged.comparison.incomingRevision +
      '. Its complete source and working review are in this draft. Save to retain them in the original browser record.');
  }));
  section.append(file);
  const pending = pendingOf();
  if (pending) {
    section.append(node('p', pending.filename + ' · compared with operating revision ' + pending.comparedRevision, 'muted'),
      button('Download original returned plan', () => {
        const current = pendingOf();
        if (!current) throw new Error('Reopen the retained customer return.');
        download(JSON.stringify(current.incoming, null, 2) + '\n',
          cleanName(current.planId) + '-returned.json', 'application/json');
      }));
    if (pending.reviewedReturn) renderReviewedReturn(section, context, pending.reviewedReturn);
    const note = input('Receiving review note', pending.note, value => {
      const review = selectedReview();
      if (!review.operatingSelection?.returnDraft) throw new Error('Reopen the retained customer return.');
      review.operatingSelection.returnDraft.note = value; touch();
    }, { area: true });
    note.field.maxLength = 32000; section.append(note.wrap);
    try {
      const comparison = compareGrantOperatingReturn(source, selectedReview(), pending.reviewedReturn ?? pending.incoming);
      section.append(node('h4', comparison.incomingTitle),
        node('p', 'Current operating revision ' + comparison.previousRevision +
          ' · returned revision ' + comparison.incomingRevision + ' · ' + comparison.addedRevisions + ' later revisions', 'muted'));
      renderReturnDetails(section, context, comparison);
      const stale = pending.comparedRevision !== comparison.previousRevision;
      const receive = button('Receive complete customer work and review', () => {
        const current = pendingOf();
        if (!current) throw new Error('Reopen the retained customer return.');
        const received = receiveGrantOperatingReturn(source, selectedReview(), current.reviewedReturn ?? current.incoming, {
          filename: current.filename, note: current.note, expectedRevision: current.comparedRevision,
        });
        const nextReview = closeGrantOperatingReturn(source, received.review);
        replaceReview(nextReview, 'Before receiving customer operating revision ' + comparison.incomingRevision,
          received.reused ? 'This complete procedure is already retained. Closed the unfinished return while preserving its prior saved version.' :
          'Received ' + received.addedRevisions + ' original customer operating revisions' +
          (received.reviewAdded ? ' and the complete reconciliation review' : '') +
          '. Save the submission to retain the complete work, note and receiving history.');
      });
      const alreadyRetained = comparison.reused && (!comparison.reviewedReturn || comparison.reviewedReturn.retained);
      receive.disabled = alreadyRetained || stale;
      if (stale) section.append(node('p',
        'The selected procedure advanced after this return was compared. Review the complete current comparison, then confirm that current revision. Your returned file and note remain saved in this draft.', 'issues'),
        button('Use this current comparison for receiving', () => {
          const refreshed = refreshGrantOperatingReturn(source, selectedReview());
          replaceReview(refreshed.review, 'Before refreshing customer return comparison',
            'Retained the current operating revision as the comparison basis. The original returned file and review note are unchanged.');
        }));
      else if (alreadyRetained) section.append(node('p', 'The current saved procedure and complete review are already retained.', 'muted'));
      else if (comparison.reused) section.append(node('p',
        'The reviewed result is already in this procedure. Receive to retain both branches and the complete review alongside that existing history.', 'muted'));
      section.append(receive,
        button('Download full return comparison', () => {
          const current = pendingOf();
          if (!current) throw new Error('Reopen the retained customer return.');
          const latest = compareGrantOperatingReturn(source, selectedReview(), current.reviewedReturn ?? current.incoming);
          download(JSON.stringify(latest, null, 2) + '\n',
            cleanName(latest.planId) + '-return-comparison.json', 'application/json');
        }));
    } catch (error) {
      section.append(node('p', error.message, 'issues'),
        node('p', 'The complete unfinished return and its note remain available above. Reconcile its original history or explicitly close it.', 'muted'));
    }
    section.append(button('Close returned file', close));
  }
  root.append(section);
}
