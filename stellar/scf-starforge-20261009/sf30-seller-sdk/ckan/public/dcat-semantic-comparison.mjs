// MIT. Saved native snapshot comparison and source-linked relationship impact.
import { node, note, row, card, field, input, details, time, select, bind, table, action, api, mutate } from './dcat-semantic-view.mjs';

const memories = new Map(), PAGE = 50;
const TERMINAL = new Set(['COMPLETE', 'FAILED', 'CANCELLED', 'INTERRUPTED']);
const term = value => value && typeof value === 'object' ? value.value ?? JSON.stringify(value) : value == null ? '—' : String(value);
function memory(ctx) {
  const key = JSON.stringify([ctx.state.createdAt, ctx.state.catalogOrigin]);
  if (!memories.has(key)) memories.set(key, {
    mode: 'new', pending: false, comparisonId: '', beforeId: '', afterId: '', preview: null,
    predicates: '', depth: '2', nodeLimit: '100000', timeout: '120', memory: '1024',
    section: 'changes', offset: 0, previous: [], search: '', change: '', snapshot: '',
    record: null, decisions: new Map(),
  });
  return memories.get(key);
}
function resetPage(saved) { saved.offset = 0; saved.previous = []; }
function runLabel(run) {
  return (run.selection?.title || run.selection?.id || run.id) + ' · ' + run.status + ' · ' + run.id;
}
function sideCard(label, run, profile) {
  const selection = run.selection ?? {};
  return card(node('h4', {}, label),
    table(['Selection', 'Retained value'], [
      ['Catalogue', selection.title || selection.id], ['Source kind', selection.kind],
      ['Original / candidate SHA-256', selection.sha256], ['Saved run', run.id],
      ['Run SHA-256', run.runSha256], ['Profile', profile.label], ['Profile SHA-256', profile.profileSha256],
      ['Base IRI', profile.baseIRI], ['Context treatment', profile.contextMode],
      ['Context file', profile.context?.name], ['Context SHA-256', profile.context?.sha256],
    ]),
    details('Complete source and profile selection', { selection, profile, snapshot: run.result?.snapshot ?? run.summary?.snapshot }));
}
async function selectedPair(ctx, saved, before, after) {
  const key = before.runSha256 + ':' + after.runSha256;
  if (saved.preview?.key === key) return saved.preview;
  const [beforeRun, afterRun] = await Promise.all([
    api(ctx, 'runs/' + encodeURIComponent(before.id)),
    before.id === after.id ? null : api(ctx, 'runs/' + encodeURIComponent(after.id)),
  ]);
  const resolvedAfter = afterRun ?? beforeRun;
  const [beforeProfile, afterProfile] = await Promise.all([
    api(ctx, 'profiles/' + encodeURIComponent(beforeRun.profileId)),
    beforeRun.profileId === resolvedAfter.profileId ? null : api(ctx, 'profiles/' + encodeURIComponent(resolvedAfter.profileId)),
  ]);
  const result = { key, beforeRun, afterRun: resolvedAfter, beforeProfile, afterProfile: afterProfile ?? beforeProfile };
  if (ctx.current()) saved.preview = result;
  return result;
}
function bounded(control, low, high, label) {
  if (!control.reportValidity() || !/^(0|[1-9][0-9]*)$/.test(control.value))
    throw new Error('Choose a whole number for ' + label + '.');
  const value = Number(control.value);
  if (!Number.isSafeInteger(value) || value < low || value > high)
    throw new Error(label + ' must be between ' + low + ' and ' + high + '.');
  return value;
}
async function newView(ctx, saved, semantic) {
  const eligible = semantic.runs.filter(run => TERMINAL.has(run.status) && run.runSha256 && run.summary?.snapshot);
  if (!eligible.length) {
    ctx.view.append(card(node('h3', {}, 'Select saved snapshots'),
      note('Run catalogue semantic validation to retain a native snapshot. A saved snapshot can remain available when a later validation phase fails.')));
    return;
  }
  const before = select('semantic-before-run', eligible.map(run => [run.id, runLabel(run)]), saved.beforeId || eligible[0].id);
  const after = select('semantic-after-run', eligible.map(run => [run.id, runLabel(run)]), saved.afterId || eligible.at(-1).id);
  saved.beforeId = before.value; saved.afterId = after.value;
  for (const [control, key] of [[before, 'beforeId'], [after, 'afterId']])
    control.addEventListener('change', () => ctx.protect(async () => {
      saved[key] = control.value; saved.preview = null; await ctx.render();
    }));
  ctx.view.append(card(node('h3', {}, 'Compare retained catalogue snapshots'),
    note('Choose the order explicitly. The original engine computes complete RDF additions and removals, then follows the selected resource relationships.'),
    row(field('Before snapshot', before), field('After snapshot', after))));
  const first = eligible.find(run => run.id === saved.beforeId), second = eligible.find(run => run.id === saved.afterId);
  const pair = await selectedPair(ctx, saved, first, second);
  if (!ctx.current()) return;
  ctx.view.append(sideCard('Before', pair.beforeRun, pair.beforeProfile), sideCard('After', pair.afterRun, pair.afterProfile));
  const changedProfile = pair.beforeProfile.profileSha256 !== pair.afterProfile.profileSha256;
  const changedBase = pair.beforeProfile.baseIRI !== pair.afterProfile.baseIRI;
  if (changedProfile || changedBase) ctx.view.append(note(
    'These selections use different ' + [changedProfile ? 'profiles' : '', changedBase ? 'base IRIs' : ''].filter(Boolean).join(' and ') +
    '. The resulting graph difference includes the effect of those explicit choices.'));
  if (first.id === second.id) ctx.view.append(note('Both sides select the same saved snapshot. This is an explicit unchanged-source comparison.'));
  const predicates = bind(node('textarea', { name: 'semantic-impact-predicates', rows: 4,
    placeholder: 'One absolute predicate IRI per line. Leave empty to follow all resource edges.' }, saved.predicates),
    () => { saved.predicates = predicates.value; });
  const number = (name, key, min, max) => {
    const control = input(name, saved[key], { type: 'number', min, max, step: 1, required: '' });
    return bind(control, () => { saved[key] = control.value; });
  };
  const depth = number('semantic-impact-depth', 'depth', 0, 20);
  const cap = number('semantic-impact-node-limit', 'nodeLimit', 1, 100000);
  const timeout = number('semantic-compare-timeout', 'timeout', 5, 600);
  const memoryLimit = number('semantic-compare-memory', 'memory', 256, 4096);
  ctx.view.append(card(node('h3', {}, 'Relationship impact scope'),
    field('Predicate IRIs · optional', predicates),
    note('An empty selection follows all resource edges. The engine examines incoming and outgoing selected relationships and uses of a visited predicate.'),
    row(field('Traversal depth', depth), field('Visited-node limit', cap)),
    note('Depth zero keeps changed seed nodes. The node limit may also limit the initial seeds. Complete graph additions and removals are retained independently.'),
    node('details', {}, node('summary', {}, 'Native worker limits'),
      row(field('Seconds', timeout), field('Memory · MiB', memoryLimit))),
    action(ctx, 'Compare snapshots', async () => {
      const edges = saved.predicates.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
      if (edges.length > 256 || new Set(edges).size !== edges.length)
        throw new Error('Choose at most 256 distinct predicate IRIs.');
      await mutate(ctx, saved, 'comparisons', {
        beforeRunId: first.id, expectedBeforeRunSha256: first.runSha256,
        afterRunId: second.id, expectedAfterRunSha256: second.runSha256,
        parameters: { edge_predicates: edges, depth: bounded(depth, 0, 20, 'Traversal depth'),
          node_limit: bounded(cap, 1, 100000, 'Visited-node limit') },
        limits: { timeout_seconds: bounded(timeout, 5, 600, 'Seconds'),
          memory_mib: bounded(memoryLimit, 256, 4096, 'Memory') },
      }, result => { saved.comparisonId = result.comparisonId ?? ''; saved.mode = 'saved'; saved.record = null; resetPage(saved); });
    }, Boolean(ctx.state.active))));
}
function outcomeCard(value) {
  const summary = value.result?.comparison?.summary ?? value.summary?.comparison;
  if (!summary) return note('The saved attempt retains its current phase and available native output.');
  return card(node('h3', {}, 'Graph difference'),
    table(['Measure', 'Result'], [
      ['Before triples', summary.before_triples], ['After triples', summary.after_triples],
      ['Common triples', summary.common_triples], ['Added triples', summary.added_triples],
      ['Removed triples', summary.removed_triples], ['Equivalent graphs', summary.equivalent ? 'Yes' : 'No'],
      ['Complete graph difference', summary.graph_difference_complete ? 'Yes' : 'See native outcome'],
      ['Original provenance complete', summary.provenance_complete ? 'Yes' : 'See native outcome'],
    ]),
    node('h3', {}, 'Relationship impact'),
    table(['Measure', 'Result'], [
      ['Visited nodes', summary.impact_nodes], ['Traversal depth', summary.impact_depth],
      ['Visited-node limit', summary.impact_node_limit],
      ['Traversed relationships', summary.traversed_relationships],
      ['Impact limited by node cap', summary.impact_truncated ? 'Yes' : 'No'],
      ['Nodes within selected depth', summary.impact_truncated ? 'Total unknown' : summary.impact_total_within_depth],
      ['Observed candidate nodes · lower bound', summary.observed_candidate_nodes_at_least],
    ]),
    summary.impact_truncated ? note('The complete graph difference is retained. Relationship impact reached its selected node limit; the observed candidate count is a lower bound.') : null,
    note(summary.blank_node_scope ?? 'Blank nodes retain separate before and after scope; IRIs are shared identifiers.'),
    details('Complete native comparison summary', summary));
}
function rowsTable(section, rows) {
  if (section === 'nodes') return table(['Node', 'Snapshot scope', 'Distance / reason', 'Original source'],
    rows.map(value => [term(value.term ?? value.node), value.snapshot_scope ?? value.snapshot,
      node('div', {}, String(value.distance ?? '—'), details('Traversal and change details', value)),
      details('Original origins', value.origins ?? value.sources ?? [])]));
  return table([section === 'changes' ? 'Change' : 'Relationship', 'Snapshot', 'Typed statement', 'Original source'],
    rows.map(value => [value.change ?? value.kind ?? value.id ?? '—', value.snapshot ?? '—',
      node('div', {}, node('code', {}, value.ntriples ?? [term(value.subject), term(value.predicate), term(value.object)].join(' ')),
        details('Complete typed row', value)), details('Original origins', value.origins ?? [])]));
}
async function resultsView(ctx, saved, semantic) {
  const entries = semantic.comparisons ?? [];
  if (saved.comparisonId && !entries.some(value => value.id === saved.comparisonId) && ctx.state.active) {
    ctx.view.append(note('Preparing the selected comparison under the current project operation.')); return;
  }
  if (!entries.length) { ctx.view.append(note('No saved comparisons yet.')); return; }
  const choose = select('saved-semantic-comparison', [...entries].reverse().map(value => [value.id,
    value.id + ' · ' + value.status]), saved.comparisonId || entries.at(-1).id);
  saved.comparisonId = choose.value;
  choose.addEventListener('change', () => ctx.protect(async () => {
    saved.comparisonId = choose.value; saved.record = null; resetPage(saved); await ctx.render();
  }));
  const selected = entries.find(value => value.id === saved.comparisonId);
  const latestStateReview = (semantic.comparisonReviews ?? []).filter(value => value.comparisonId === saved.comparisonId).at(-1);
  const cacheKey = selected?.comparisonSha256 ? selected.comparisonSha256 + ':' + (latestStateReview?.reviewSha256 ?? '') : null;
  if (!cacheKey || saved.record?.key !== cacheKey)
    saved.record = { key: cacheKey, value: await api(ctx, 'comparisons/' + encodeURIComponent(saved.comparisonId)) };
  if (!ctx.current()) return;
  const value = saved.record.value, summary = value.result?.comparison?.summary ?? value.summary?.comparison;
  ctx.view.append(card(node('h3', {}, 'Retained snapshot comparison'), field('Comparison', choose),
    row(node('span', { class: 'pill' }, value.status), note('Started ' + time(value.startedAt) +
      (value.completedAt ? ' · completed ' + time(value.completedAt) : ''))),
    details('Ordered source and profile selections', { before: value.before, after: value.after,
      parameters: value.parameters, limits: value.limits }),
    details('Complete saved comparison and review history', value),
    row(action(ctx, 'Download comparison', () => ctx.download('dcat/semantic/comparisons/files/comparison/' + value.id,
      'dcat-semantic-comparison.json'), !value.comparisonSha256),
      action(ctx, 'Complete workspace transfer', () => ctx.openWorkspace()))),
    outcomeCard(value));
  if (value.artifacts?.length) ctx.view.append(card(node('h3', {}, 'Complete native files'),
    table(['File', 'Size', 'SHA-256', 'Download'], value.artifacts.map(file => [
      file.path ?? file.key, file.bytes, file.sha256,
      action(ctx, 'Download', () => ctx.download('dcat/semantic/comparisons/files/artifact/' + value.id + '?' +
        new URLSearchParams({ key: file.key }), file.downloadName ?? file.path?.split('/').at(-1) ?? 'comparison-artifact')),
    ]))));
  if (!value.comparisonSha256) {
    ctx.view.append(note('The original operation retains comparison progress. Its complete files and decisions appear when the attempt ends.'));
    return;
  }
  const section = select('semantic-comparison-section', [['changes', 'Added and removed statements'],
    ['nodes', 'Impact nodes'], ['relationships', 'Traversed relationships']], saved.section);
  section.addEventListener('change', () => ctx.protect(async () => {
    saved.section = section.value; saved.change = ''; saved.snapshot = ''; resetPage(saved); await ctx.render();
  }));
  const search = input('semantic-comparison-search', saved.search, { type: 'search', maxlength: 4096, placeholder: 'Term, source or reason' });
  const change = select('semantic-comparison-change', [['', 'All changes'], ['added', 'Added'], ['removed', 'Removed']], saved.change);
  const snapshot = select('semantic-comparison-snapshot', [['', 'Both snapshots'], ['before', 'Before'], ['after', 'After']], saved.snapshot);
  const form = node('form', { onsubmit: event => { event.preventDefault(); ctx.protect(async () => {
    saved.search = search.value; saved.change = saved.section === 'changes' ? change.value : '';
    saved.snapshot = saved.section === 'nodes' ? '' : snapshot.value; resetPage(saved); await ctx.render();
  }); } }, row(field('Original file section', section), field('Search', search),
    saved.section === 'changes' ? field('Change', change) : null,
    saved.section !== 'nodes' ? field('Snapshot', snapshot) : null, node('button', { type: 'submit' }, 'Apply filters')));
  const page = await api(ctx, 'comparisons/' + encodeURIComponent(value.id) + '/rows?' + new URLSearchParams({
    section: saved.section, offset: saved.offset, limit: PAGE,
    ...(saved.search ? { search: saved.search } : {}),
    ...(saved.section === 'changes' && saved.change ? { change: saved.change } : {}),
    ...(saved.section !== 'nodes' && saved.snapshot ? { snapshot: saved.snapshot } : {}),
  }));
  if (!ctx.current()) return;
  const paging = page.page, available = page.availability === 'AVAILABLE';
  ctx.view.append(card(node('h3', {}, 'Source-linked result rows'), form,
    available ? note('Showing ' + page.rows.length + ' of ' + paging.total + ' matching rows') :
      note(page.availability === 'DOWNLOAD_REQUIRED' ? 'This complete result exceeds the interactive page reader. Download the original file to inspect every row.' :
        'This attempt has no available native rows for the selected section. Inspect the saved outcome and files.'),
    available && page.rows.length ? rowsTable(saved.section, page.rows) :
      available ? note('No rows match this selection.') : null,
    page.artifact ? action(ctx, 'Download complete section', () => ctx.download(
      'dcat/semantic/comparisons/files/artifact/' + value.id + '?' + new URLSearchParams({ key: page.artifact.key }),
      page.artifact.downloadName ?? page.artifact.path?.split('/').at(-1) ?? 'comparison-section')) : null,
    row(action(ctx, 'Previous rows', async () => { saved.offset = saved.previous.pop() ?? 0; await ctx.render(); }, !saved.previous.length),
      action(ctx, 'More rows', async () => { saved.previous.push(saved.offset); saved.offset = paging.nextOffset; await ctx.render(); },
        !available || paging.nextOffset === null || paging.nextOffset === undefined))));
  const reviews = value.reviews ?? [], latest = reviews.at(-1);
  const reviewKey = value.id + ':' + (latest?.reviewSha256 ?? '');
  if (!saved.decisions.has(reviewKey)) saved.decisions.set(reviewKey, { decision: 'ACKNOWLEDGE', note: '' });
  const draft = saved.decisions.get(reviewKey);
  const decisions = [['ACKNOWLEDGE', 'Acknowledge comparison'], ...(value.status === 'COMPLETE' ?
    [['CHANGES_REQUIRED', 'Request changes'], ['ACCEPT', 'Accept for the stated purpose']] : [])];
  if (!decisions.some(([key]) => key === draft.decision)) draft.decision = 'ACKNOWLEDGE';
  const decision = bind(select('semantic-comparison-decision', decisions, draft.decision), () => { draft.decision = decision.value; });
  const text = bind(node('textarea', { name: 'semantic-comparison-note', rows: 4, maxlength: 4096,
    placeholder: 'Record the intended use, actual graph changes and selected impact scope.' }, draft.note),
    () => { draft.note = text.value; });
  ctx.view.append(card(node('h3', {}, 'Operator decision'),
    note('Record a decision against this exact saved comparison and scope. Catalogue release remains an explicit migration action.'),
    summary?.impact_truncated ? note('This decision includes the selected impact limit. The total relationship impact remains unknown.') : null,
    field('Decision', decision), field('Reason and intended use', text),
    action(ctx, 'Save decision', async () => {
      if (!draft.note.trim()) throw new Error('Record the reason and intended use.');
      await mutate(ctx, saved, 'comparisons/reviews', { comparisonId: value.id,
        expectedComparisonSha256: value.comparisonSha256, expectedReviewSha256: latest?.reviewSha256 ?? null,
        decision: draft.decision, note: draft.note }, () => { saved.record = null; });
    }, Boolean(ctx.state.active)),
    ...reviews.map(review => node('div', { class: 'resource' },
      node('strong', {}, review.decision + ' · ' + time(review.createdAt)), note(review.note),
      action(ctx, 'Download decision', () => ctx.download('dcat/semantic/comparisons/files/review/' + review.id,
        'dcat-semantic-comparison-decision.json'))))));
}
export async function renderDcatSemanticComparison(ctx) {
  const saved = memory(ctx), semantic = ctx.state.dcat?.semantic ?? { runs: [], comparisons: [], comparisonReviews: [] };
  ctx.view.append(row(action(ctx, 'New comparison', async () => { saved.mode = 'new'; await ctx.render(); }),
    action(ctx, 'Saved comparisons · ' + (semantic.comparisons?.length ?? 0), async () => { saved.mode = 'saved'; await ctx.render(); }),
    action(ctx, 'Comparison guide', () => ctx.download('dcat/semantic/comparisons/guide', 'SEMANTIC_COMPARISONS.md'))));
  if (saved.mode === 'new') await newView(ctx, saved, semantic);
  else await resultsView(ctx, saved, semantic);
}
