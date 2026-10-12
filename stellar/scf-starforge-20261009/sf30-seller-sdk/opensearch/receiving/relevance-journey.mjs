// MIT. Native sample relevance and customer handoff over a retained real-flight cohort.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical } from '../workspace/store.mjs';
import { runRelevanceOperatorJourney } from '../relevance/operator-journey.mjs';

const root = resolve(process.env.OPENSEARCH_RECEIVING_DIRECTORY ?? process.argv[2] ?? 'opensearch-native-relevance');
const metadata = resolve(process.env.OPENSEARCH_NATIVE_METADATA ?? root);
const cohortPath = resolve(process.env.STARFORGE_OPENSEARCH_COHORT_FILE ??
  fileURLToPath(new URL('./flight-cohort.json', import.meta.url)));
const sourceFile = fileURLToPath(new URL('./playground-source.json', import.meta.url));
const reportPath = join(root, 'native-relevance-journey.json');
const hash = value => createHash('sha256').update(value).digest('hex');
const pretty = value => JSON.stringify(value, null, 2) + '\n';
const identity = hit => JSON.stringify([hit._index, hit._id]);
await mkdir(root, { recursive: true, mode: 0o700 });
const report = { schema: 'stellar-forge.opensearch-native-relevance-journey.v1',
  operation: 'ASTRA-EE290-OPENSEARCH-RELEVANCE-20261011',
  startedAt: new Date().toISOString(), runtime: process.version, metadata, cohortPath, stages: [] };
function stage(value) { report.stages.push(value); console.log(JSON.stringify(value)); }
async function save(name, value) {
  await writeFile(join(root, name), typeof value === 'string' ? value : pretty(value), { mode: 0o600 });
}
try {
  const cohortBytes = await readFile(cohortPath);
  const cohort = JSON.parse(cohortBytes.toString('utf8'));
  assert.equal(cohort.schema, 'stellar-forge.opensearch-native-cohort.v1');
  assert.equal(typeof cohort.resultJson, 'string');
  assert.equal(hash(cohort.resultJson), cohort.provenance.resultSha256);
  const captured = JSON.parse(cohort.resultJson);
  assert.equal(captured.schema, 'stellar-forge.opensearch-result.v1');
  assert.ok(captured.hits.length >= 3 && captured.hits.length <= 100);
  assert.equal(captured.hitCount, captured.hits.length);
  const source = JSON.parse(await readFile(sourceFile, 'utf8'));
  const originalQuery = source.queries.flights;
  assert.ok(originalQuery.fields.includes('AvgTicketPrice'));
  assert.ok(originalQuery.fields.includes('FlightNum'));
  const cohortMap = new Map(captured.hits.map(hit => [identity(hit), hit]));
  assert.equal(cohortMap.size, captured.hits.length);
  for (const hit of captured.hits) {
    assert.ok(originalQuery.indices.includes(hit._index));
    assert.equal(typeof hit._id, 'string');
    assert.equal(hit._source.OriginCountry, 'US');
    assert.ok(typeof hit._source.AvgTicketPrice === 'number' &&
      Number.isFinite(hit._source.AvgTicketPrice) && hit._source.AvgTicketPrice >= 0);
  }
  const prices = captured.hits.map(hit => hit._source.AvgTicketPrice).sort((a, b) => a - b);
  const threshold = prices[Math.floor((prices.length - 1) / 2)];
  const k = Math.min(3, Math.floor(prices.length / 2));
  const input = structuredClone(cohort.provenance.input ?? originalQuery.probe);
  const criterion = { schema: 'stellar-forge.opensearch-engineering-judgment-rule.v1',
    label: 'Budget suitability within the retained public flight cohort',
    judgmentOrigin: 'Deterministic engineering sample judgments derived from the original native records',
    field: 'AvgTicketPrice', relevantWhen: 'value <= lower median of retained cohort prices',
    threshold, relevantGrade: 1, otherGrade: 0, cohortDocuments: prices.length,
    sortedNativePrices: prices, originalResultSha256: cohort.provenance.resultSha256,
    originalCaptureRequestId: cohort.provenance.captureRequestId,
    originalCaptureTime: captured.capturedAt, source: captured.source,
    interpretation: 'Precision describes the retained flight cohort and this declared budget criterion.' };
  const payment = { scheme: 'exact', network: 'stellar:testnet', amount: '10000',
    asset: 'CABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAFNSZ',
    payTo: 'GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H',
    maxTimeoutSeconds: 60 };
  const plan = { schema: 'stellar-forge.opensearch-merchant-plan.v1',
    publicOrigin: 'https://search.example.com', payment,
    routes: [{ id: 'flight_search', path: '/search/flights', method: 'POST', query: 'flights',
      serviceName: 'Budget Flight Cohort',
      description: 'Search the retained public flight cohort used for the engineering relevance review.',
      parameterDescriptions: { country: 'Two-letter departure country.',
        minimum_price: 'Minimum average ticket price.' }, example: input }] };
  const planFile = join(root, 'flight-relevance-merchant-plan.json');
  await writeFile(planFile, pretty(plan), { mode: 0o600 });
  const variants = ['asc', 'desc'].map(direction => ({
    id: direction === 'asc' ? 'lowest-price' : 'highest-price',
    title: direction === 'asc' ? 'Lowest price first' : 'Highest price first',
    queryName: 'flights',
    query: { ...structuredClone(originalQuery),
      query: { bool: { filter: [structuredClone(originalQuery.query),
        { ids: { values: captured.hits.map(hit => hit._id) } }] } },
      sort: [{ AvgTicketPrice: direction }, { FlightNum: 'asc' }] },
    input, plan: structuredClone(plan)
  }));
  const judgments = captured.hits.map(hit => ({ _index: hit._index, _id: hit._id,
    rating: hit._source.AvgTicketPrice <= threshold ? 1 : 0,
    note: 'Engineering budget criterion: AvgTicketPrice ' + hit._source.AvgTicketPrice +
      (hit._source.AvgTicketPrice <= threshold ? ' <= ' : ' > ') + threshold + '.',
    hit: structuredClone(hit) }));
  const set = { schema: 'stellar-forge.opensearch-relevance-set.v1',
    title: 'Native flight budget relevance',
    description: 'Two native price-order variants evaluated against a frozen cohort of real OpenSearch public sample flights. ' +
      'Judgments follow the retained budget criterion and original record values.',
    metric: { precision: { k, relevant_rating_threshold: 1, ignore_unlabeled: false } },
    variants,
    cases: [{ id: 'budget-cohort', title: 'Budget flights in the retained cohort', input, documents: judgments,
      provenance: { kind: 'engineering-sample-judgments', criterion,
        publicSource: cohort.provenance.publicSource, originalEditionId: cohort.provenance.editionId,
        originalResultSha256: cohort.provenance.resultSha256, originalTotal: captured.total,
        originalTruncated: captured.truncated, selectedDocuments: captured.hits.length } }],
    importedFrom: { kind: 'native-source-cohort', resultSha256: cohort.provenance.resultSha256,
      captureRequestId: cohort.provenance.captureRequestId, editionId: cohort.provenance.editionId } };
  await save('flight-cohort.json', cohortBytes.toString('utf8'));
  await save('engineering-judgment-criterion.json', criterion);
  await save('native-relevance-evaluation-set.json', set);
  report.engine = JSON.parse(await readFile(join(metadata, 'native-engine.json'), 'utf8'));
  report.cohort = { fileSha256: hash(cohortBytes), nativeResultSha256: cohort.provenance.resultSha256,
    documents: captured.hits.length, source: captured.source, criterion, k };
  stage({ stage: 'retained-cohort-and-criterion', source: captured.source,
    cohortDocuments: captured.hits.length, nativeResultSha256: cohort.provenance.resultSha256,
    priceThreshold: threshold, k, variants: variants.map(item => item.id) });

  const received = await runRelevanceOperatorJourney({ sourceFile, planFile,
    directory: join(root, 'relevance-workspace'), artifactDirectory: join(root, 'relevance-exports'),
    evaluationSet: set, env: process.env, operationId: 'ee290-flight-relevance-v1', onStage: stage });
  report.operator = received.report;
  const result = received.edition.result;
  report.native = { source: result.source, complete: result.complete, coverage: result.coverage,
    snapshotReleased: result.snapshotReleased, resultSha256: received.edition.resultSha256,
    evaluationId: received.edition.id };
  assert.equal(result.source.clusterFingerprint, captured.source.clusterFingerprint);
  assert.equal(result.source.serverVersion, report.engine.version.number);
  assert.equal(result.complete, true, 'Native case status and strict-window correspondence are retained in the exports');
  assert.equal(result.snapshotReleased, true);
  const grades = new Map(judgments.map(row => [identity(row), row.rating]));
  const scopes = new Set();
  const scores = [];
  for (const variant of result.variants) {
    scopes.add(variant.snapshot.scopeId);
    assert.equal(variant.cases.length, 1);
    assert.equal(variant.cases[0].status, 'COMPLETE');
    assert.equal(variant.cases[0].orderedWindowMatches, true);
    const window = variant.strictWindows['budget-cohort'];
    assert.equal(window.state, 'COMPLETE');
    assert.ok(window.hits.length > 0);
    for (const hit of window.hits) {
      const original = cohortMap.get(identity(hit));
      assert.ok(original, 'Every evaluated result belongs to the retained native cohort');
      assert.equal(canonical(hit._source), canonical(original._source),
        'The evaluated native record retains the source fields used for its engineering judgment');
    }
    const relevant = window.hits.filter(hit => grades.get(identity(hit)) >= 1).length;
    const expected = relevant / window.hits.length;
    assert.ok(Math.abs(variant.metricScore - expected) <= 1e-12);
    scores.push({ id: variant.id, label: variant.label, metricScore: variant.metricScore,
      relevantReturned: relevant, returned: window.hits.length,
      judgedReturned: variant.cases[0].judgedHitCount, unjudgedReturned: variant.cases[0].unjudgedHitCount,
      concreteIndices: variant.concreteIndices, effectiveSort: variant.effectiveSort,
      snapshot: variant.snapshot, currentDocumentsMatchRetainedCriterion: true });
  }
  assert.equal(scopes.size, 1);
  const ascending = scores.find(row => row.id === 'lowest-price');
  const descending = scores.find(row => row.id === 'highest-price');
  assert.ok(ascending.metricScore >= descending.metricScore);
  report.comparison = { metric: result.metric, caseId: 'budget-cohort', source: result.source,
    sameNativeSnapshot: true, sameFrozenJudgments: true, variants: scores,
    scoreDifference: ascending.metricScore - descending.metricScore };
  await save('native-relevance-comparison.json', report.comparison);
  stage({ stage: 'native-budget-ranking-comparison', variants: scores.map(({ id, metricScore,
    relevantReturned, returned }) => ({ id, metricScore, relevantReturned, returned })),
    scoreDifference: report.comparison.scoreDifference, sameNativeSnapshot: true });
  report.state = 'PASS'; report.completedAt = new Date().toISOString();
} catch (error) {
  report.state = 'FAIL'; report.completedAt = new Date().toISOString();
  report.error = { name: error.name, code: error.code, message: error.message, operation: error.operation };
  process.exitCode = 1;
  console.error(JSON.stringify({ stage: 'native-relevance-error', error: report.error }));
} finally {
  await writeFile(reportPath, pretty(report), { mode: 0o600 });
  console.log(JSON.stringify({ state: report.state, reportPath }));
}
