import {renderGrantOperatingPlan} from './grant-operating-plan-workspace.mjs';
import {renderPlanningUpdates} from './grant-plan-update-workspace.mjs';
import {selectPlanningRevision} from './grant-plan-update-core.mjs';
// MIT. Native planning review and application use the existing submission editor.
import {newPlanReview, planSummary, selectedPlan, preparedReview, planningReadiness,
  applyPlanReview, reviewBasis, usd} from './grant-plan-core.mjs';
import {decodeBase64} from './grant-plan-source.mjs';
import {retainVersion, validateDraft, newField, fieldStatus, outputText} from './grant-submission-core.mjs';
const planTime = value => {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-GB', {day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC'}).format(instant) + ' UTC';
};
export function renderPlanning(root, context) {
  const {node, button, input, select, link, touch, render, work, download, copy, uid} = context;
  const draft = context.getDraft(), sources = draft.planSources || [];
  const commit = (value, message) => { context.setDraft(validateDraft(value)); touch(); render(); if (message) context.status(message); };
  root.append(node('h2', 'Planning edition'), node('p',
    'Receive a saved SF47 plan, review its original costs and delivery schedule, then prepare the text for this submission.'));
  const actions = node('div', undefined, 'row');
  actions.append(button('Receive native plan or planning ZIP', () => context.chooseFile('plan')),
    link('Native planning and submission guide', 'https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar-forge/developer-site/GRANT_SUBMISSION.md'));
  root.append(actions);
  if (!sources.length) {
    root.append(node('p', 'Choose the complete planning ZIP from the original SF47 workspace, or its saved plan JSON exported with show --part all.', 'empty'));
    return;
  }
  const selected = draft.planningReview;
  if (!selected) {
    for (const source of sources) root.append(button('Select ' + source.filename, () => {
      const next = retainVersion(draft, 'Before selecting native planning edition');
      next.planningReview = newPlanReview(source); commit(next);
    }));
    return;
  }
  if (renderPlanningUpdates(root, context)) return;
  const {source, plan} = selectedPlan(sources, selected);
  const selectors = node('div', undefined, 'grid');
  selectors.append(select('Retained planning file', source.sha256,
    sources.map(x => [x.sha256, x.filename + ' · ' + x.document.name]), key => work(() => {
      const next = retainVersion(draft, 'Before selecting another native planning file');
      const chosen = sources.find(x => x.sha256 === key);
      selectPlanningRevision(next, key, chosen.document.currentRevision, {id: uid()}); commit(next);
    })).wrap);
  selectors.append(select('Native saved revision', String(plan.revision),
    source.document.revisions.map(x => [String(x.revision), 'Revision ' + x.revision + ' · ' + planTime(x.savedAt)]),
    revision => work(() => {
      const next = retainVersion(draft, 'Before selecting another native plan revision');
      selectPlanningRevision(next, source.sha256, Number(revision), {id: uid()}); commit(next);
    })).wrap);
  root.append(selectors, node('p', source.filename + ' · ' + source.document.name, 'muted plan-source-caption'));
  if (plan.note) root.append(node('p', plan.note, 'plan-revision-note'));
  const summary = planSummary(source, plan.revision, selected.costIds);
  root.append(node('p', 'Requested award ' + usd(summary.award) + ' USD · ' + summary.costs.length + ' selected work packages · ' +
    usd(summary.amount) + ' USD selected' + (summary.hours === null ? '' : ' · ' + summary.hours + ' estimated hours') +
    ' · completion by modeled day ' + summary.duration, 'counts'));
  root.append(node('p', 'The native plan supplies the package prices, work windows, conditional payments and cash calculations. To revise a cost or date, save the change in that plan and receive its next edition here.', 'muted'));
  const sourceDetail = node('details');
  sourceDetail.append(node('summary', 'Original planning source and calculation'),
    node('p', source.filename + ' · ' + source.bytes.toLocaleString() + ' bytes · received ' + planTime(source.receivedAt), 'muted'),
    node('p', 'File SHA-256 ' + source.sha256, 'code'),
    node('p', 'Native plan ' + plan.id + ' · revision ' + plan.revision, 'code'),
    node('p', 'Scenario source SHA-256 ' + plan.source.sha256, 'code'),
    node('p', 'Saved content SHA-256 ' + plan.contentSha256, 'code'));
  if (plan.source.url) sourceDetail.append(node('p', plan.source.url, 'code'));
  sourceDetail.append(button('Download complete received file', () => download(decodeBase64(source.base64), source.filename,
    source.kind === 'zip' ? 'application/zip' : 'application/json')),
    node('h3', 'Native calculation and planning inputs'), node('pre', JSON.stringify({planning: plan.planning, report: plan.report}, null, 2), 'source-text'));
  root.append(sourceDetail);
  const selection = node('div', undefined, 'row');
  selection.append(button('Select all original work packages', () => {
    selected.costIds = plan.scenario.future_costs.map(x => x.id); selected.summaryReviewed = false; touch(); render();
  }));
  root.append(node('h3', 'Three delivery tranches'), selection);
  for (const tranche of plan.scenario.milestones) {
    const costs = plan.scenario.future_costs.filter(x => x.tranche === tranche.tranche);
    const card = node('section', undefined, 'card plan-tranche');
    card.append(node('h3', 'Tranche ' + tranche.tranche + ' · day ' + tranche.submit_day),
      node('p', tranche.deliverable), node('p', 'Completion assessment: ' + tranche.measurable_proof));
    const nativeNote = plan.planning.deliveryNotes?.[String(tranche.tranche)];
    if (nativeNote) card.append(node('p', nativeNote));
    for (const cost of costs) {
      const row = node('div', undefined, 'plan-package'), label = node('label', undefined, 'check-row'), checkbox = node('input');
      checkbox.type = 'checkbox'; checkbox.checked = selected.costIds.includes(cost.id);
      checkbox.addEventListener('change', () => work(() => {
        selected.costIds = plan.scenario.future_costs.map(x => x.id).filter(id => id === cost.id ? checkbox.checked : selected.costIds.includes(id));
        selected.summaryReviewed = false; touch(); render();
      }));
      label.append(checkbox, node('strong', cost.remaining_work));
      row.append(label, node('p', usd(cost.amount_usd) + ' USD · days ' + cost.start_day + '–' + cost.end_day +
        (cost.estimated_hours === null || cost.estimated_hours === undefined ? '' : ' · ' + cost.estimated_hours + ' estimated hours') +
        (cost.assumed_hourly_rate_usd === null || cost.assumed_hourly_rate_usd === undefined ? '' : ' · assumed $' + cost.assumed_hourly_rate_usd + ' USD/hour'), 'muted'),
        node('p', 'Completion assessment: ' + cost.measurable_proof));
      card.append(row);
    }
    root.append(card);
  }
  renderGrantOperatingPlan(root, context, {source, plan, review: selected});
  const finance = node('details');
  finance.append(node('summary', 'Conditional payment schedule and native cash requirement'));
  const paymentTable = node('table', undefined, 'plan-table'), paymentHead = node('thead'), header = node('tr');
  for (const title of ['Payment', 'USD', 'Original release condition', 'Modeled day']) header.append(node('th', title));
  paymentHead.append(header); paymentTable.append(paymentHead); const body = node('tbody');
  for (const payout of summary.payouts) {
    const row = node('tr');
    for (const value of [payout.tranche === 0 ? 'Initial allocation' : 'After tranche ' + payout.tranche,
      usd(payout.usd), payout.release_condition, payout.hypothetical_paid_day ?? 'Not dated']) row.append(node('td', value));
    body.append(row);
  }
  paymentTable.append(body); const scroll = node('div', undefined, 'plan-scroll'); scroll.append(paymentTable); finance.append(scroll);
  if (summary.cash) finance.append(node('p', 'Native modeled peak cash requirement: ' + usd(summary.cash.peakCashGapUsd) +
    ' USD on day ' + summary.cash.peakCashGapDay + '. Opening capital input: ' +
    (summary.cash.capitalInputUsd === null || summary.cash.capitalInputUsd === undefined ? 'not entered' : usd(summary.cash.capitalInputUsd) + ' USD') + '.'));
  finance.append(node('p', 'These dates and amounts come from this retained planning revision. Keep actual grant payments and delivery completion in the original Grant Operations case.', 'muted'));
  root.append(finance, input('Private planning review note', selected.note, value => { selected.note = value; touch(); }, {area: true}).wrap);
  root.append(node('h3', 'Prepare the budget and roadmap answer'),
    node('p', 'The preview contains the selected scope, prices, work windows and completion measures in full. Edit it for the application, then choose where to apply it.'));
  root.append(button(selected.previewText ? 'Rebuild preview from selected native plan' : 'Prepare preview from selected native plan', () => {
    const next = retainVersion(draft, 'Before rebuilding native budget and roadmap preview');
    next.planningReview = preparedReview(source, next.planningReview); commit(next);
  }));
  if (!selected.previewText) return;
  if (selected.previewBasis !== reviewBasis(selected)) root.append(node('p',
    'The package selection has changed. Rebuild the preview to use this selection; the existing preview remains retained in the draft.', 'issues'));
  let targetKey = 'answer:delivery', mode = 'replace';
  const preview = input('Exact budget and roadmap text to apply', selected.previewText, value => {
    selected.previewText = value; selected.summaryReviewed = false; reviewed.checked = false; touch(); refreshTarget();
  }, {area: true, className: 'answer-input'});
  root.append(preview.wrap, context.editorTools(() => selected.previewText));
  const targetChoices = [['answer:delivery', 'Canonical Delivery answer'], ...draft.fields.map(x => ['field:' + x.id, x.label || 'Unlabeled issuer field']),
    ['new', 'New issuer field']];
  const choices = node('div', undefined, 'grid');
  choices.append(select('Apply to', targetKey, targetChoices, value => { targetKey = value; refreshTarget(); }).wrap,
    select('Application mode', mode, [['replace', 'Replace target text'], ['append', 'Append after target text']], value => { mode = value; refreshTarget(); }).wrap);
  root.append(choices);
  const targetPreview = node('details'), targetSummary = node('summary', 'Complete target answer after applying this preview'),
    targetText = node('pre', '', 'source-text'), targetIssues = node('div', undefined, 'issues');
  targetPreview.append(targetSummary, targetText); root.append(targetPreview, targetIssues);
  const confirmation = node('label', undefined, 'check-row'), reviewed = node('input');
  reviewed.type = 'checkbox'; reviewed.checked = selected.summaryReviewed;
  reviewed.addEventListener('change', () => { selected.summaryReviewed = reviewed.checked; touch(); refreshTarget(); });
  confirmation.append(reviewed, node('span', 'I have reviewed this exact preview for the selected planning edition.'));
  root.append(confirmation);
  const apply = button('Apply reviewed plan to draft', () => {
    let next = retainVersion(draft, 'Before applying native plan revision ' + plan.revision);
    let kind, id;
    if (targetKey === 'new') {
      const field = newField(uid()); next.fields.push(field); kind = 'field'; id = field.id;
    } else {
      const colon = targetKey.indexOf(':'); kind = targetKey.slice(0, colon); id = targetKey.slice(colon + 1);
    }
    next = applyPlanReview(next, {kind, id, mode});
    context.setDraft(validateDraft(next)); touch();
    if (kind === 'answer') context.showAnswer(id); else context.showField(id);
    context.status('Applied the reviewed native budget and roadmap. The complete preceding submission version and original planning file are retained.');
  }, 'primary');
  const copyPreview = button('Copy preview text', () => copy(outputText(selected.previewText, context.format())));
  const actionRow = node('div', undefined, 'row'); actionRow.append(apply, copyPreview); root.append(actionRow);
  function refreshTarget() {
    const kind = targetKey.startsWith('answer:') ? 'answer' : 'field';
    const id = targetKey.includes(':') ? targetKey.slice(targetKey.indexOf(':') + 1) : null;
    const target = (kind === 'answer' ? draft.answers : draft.fields).find(x => x.id === id);
    const after = mode === 'append' && target?.text.trim() ? target.text.trimEnd() + '\n\n' + selected.previewText : selected.previewText;
    targetText.textContent = after;
    const ready = planningReadiness(source, selected, {kind}), issues = [...ready.issues];
    if (kind === 'field' && target) issues.push(...fieldStatus({...target, text: after}, draft.form, context.format()).issues);
    if (targetKey === 'new') issues.push('Complete the actual issuer label, prompt and recorded limits in the new field after applying.');
    targetIssues.replaceChildren(...issues.map(x => node('p', x))); targetIssues.hidden = !issues.length;
    apply.disabled = ready.issues.length > 0;
  }
  refreshTarget();
  if (selected.applications.length) {
    const history = node('details'); history.append(node('summary', 'Applications from this planning review'));
    for (const item of [...selected.applications].reverse()) history.append(node('p', planTime(item.at) + ' · ' + item.kind + ' ' + item.id + ' · ' + item.mode, 'muted'));
    root.append(history);
  }
}
