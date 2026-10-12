# Retained search relevance

The OpenSearch merchant workspace evaluates frozen query variants against explicit document judgments and keeps each native result with the exact evaluation revision. The same workspace turns the selected variant into an ordinary merchant draft, ready for the original seller compiler and generated customer client.

## Open the operator workspace

Use the existing installed command:

```sh
npx --no-install starforge opensearch-workspace \
  --source ./opensearch-source.json \
  --plan ./merchant-plan.json \
  --workspace ./private-search-workspace \
  --port 8447
```

For a source checkout, use the same dispatcher:

```sh
node stellar/scf-starforge-20261009/distribution/cli.mjs \
  opensearch-workspace \
  --source ./opensearch-source.json \
  --plan ./merchant-plan.json \
  --workspace ./private-search-workspace \
  --port 8447
```

Open the returned loopback URL and choose **Search relevance**. Query editing, capture, relevance evaluation and merchant preparation use the same source configuration, private SQLite state and request recovery controls.

## Build a useful evaluation

1. Save the query variants you want to compare in **Draft**. Each needs its original query declaration and merchant plan. Query variants in a saved evaluation freeze that exact draft revision.
2. Create a named evaluation set. Give it a clear purpose and describe how the document grades should be assigned.
3. Add the saved query variants. Different query definitions can use the same typed input cases.
4. Add input cases directly or select a retained result edition. When seeding a case, choose how many captured document identities to judge. The saved case records the original capture checksum, query, native cluster identity, capture time, selected count and retained-result size.
5. Assign document judgments by their complete original _index and _id. An empty rating remains unrated. Grade zero is an explicit judgment. Add a short note when the reason for a grade will matter during review.
6. Select the native metric and evaluation depth. The exact metric JSON stays visible and editable.
7. Save the evaluation, validate its saved contract and run the native evaluation.

The current set format supports eight variants, 100 cases, 5,000 document identities per case and a total saved-definition size of 768 KiB. The native adapter applies the actual engine and metric limits when validating a run.

A source capture can be truncated or contain only the top results. Its provenance and selection count remain visible when it seeds judgments. For metrics that use all supplied relevant judgments, such as recall, choose the judgment collection to match the intended evaluation scope.

## Native metric controls

| Metric key | Main controls | Interpretation |
| --- | --- | --- |
| `precision` | `k`, `relevant_rating_threshold`, `ignore_unlabeled` | Relevant retrieved results under the native returned-result denominator. |
| `recall` | `k`, `relevant_rating_threshold` | Retrieved relevant results relative to all supplied relevant judgments. |
| `mean_reciprocal_rank` | `k`, `relevant_rating_threshold` | The reciprocal rank of the first relevant result. |
| `dcg` | `k`, `normalize`, optional `unknown_doc_rating` | Graded relevance with rank discounting; the preset enables normalization. |
| `expected_reciprocal_rank` | `k`, `maximum_relevance`, optional `unknown_doc_rating` | A graded rank measure using the declared maximum relevance. |

The metric object contains one native metric key. Its depth `k` must be between 1 and 1,000 and fit within every selected query's `maxHits`. The workspace shows that shared depth limit beside the metric controls. DCG grades are capped at 1,000 to keep finite gain arithmetic across the supported window. Expected reciprocal rank uses a maximum relevance from 0 through 1,023, and every supplied grade must fit that selected maximum. The native protocol and its pinned implementation references are documented in [NATIVE_PROTOCOL.md](./NATIVE_PROTOCOL.md).

The engine reports an aggregate score over its successful query details. A successful HTTP response can also contain individual query failures. The review screen therefore shows the native aggregate, confirmed complete cases, supplied judgments, returned judged and unrated counts, original failures and per-case capture correspondence together.

## Review and hand off a query

Open any retained evaluation from **Search relevance**. Its score table leads to the per-case result and the exact original native response. Document review preserves original identities and exact-integer metadata from the response.

Use **Open merchant draft** beside a case to create an ordinary query draft from the evaluated variant and its frozen input. The original request records the evaluation edition ID, result checksum, selected variant and selected case. Review the draft's merchant plan and prepare it through **Prepare merchant**. The resulting package uses the original OpenSearch seller launcher, payment protocol and generated customer client.

The evaluation set, query variants and native results remain unchanged when creating this new draft. It is an editable continuation of the selected evaluated query.

## Reopen, recover and compare

Evaluation definitions retain immutable revisions. Saving an existing set requires the revision that the browser opened; a conflicting save returns the current-revision error while retaining the editor contents. Unsaved evaluation buffers remain available while switching evaluation sets in the same browser tab. The browser asks before closing a tab with unsaved definitions.

Native evaluation requests use the workspace's original request journal. The browser retains the request ID and input before sending. If a reply is lost, **Requests → Read original result** or **Retry the same request** reconciles that original operation. A running evaluation shares the native-operation slot with source inspection and capture. Workspace shutdown waits for its retained active operations.

An evaluation edition stores the complete native result as one original JSON document with a SHA-256 checksum. Reopening the edition verifies the checksum and joins the immutable set revision used by that evaluation.

Comparison keeps each edition's capture time and native cluster fingerprint visible. Score deltas are shown only when the metric, typed case inputs, supplied judgments, source profile, native cluster and concrete index set match, the successful-case denominator agrees, and both evaluations are complete. Query definitions and effective ranking order may change deliberately; the comparison marks those changes beside the scores and retains the declared indices, concrete indices and original snapshot scope for each variant. Full per-case outcomes stay in the comparison export.

## Downloads

| Download | Contents |
| --- | --- |
| Saved evaluation set | Complete editable query definitions, merchant plans, cases and judgments. Imports create a new named set and retain the import identity. |
| Customer report | Self-contained HTML with scores, metric settings, scope, frozen query definitions, case coverage, input cases and supplied judgments. It opens offline and can be printed. |
| Full retained evaluation | The immutable evaluation record, original saved definition and complete native result. |
| Original native result | Exact stored result JSON, including all native response details and exact-integer path metadata. |
| Customer report JSON | Structured score, coverage, metric, source identity and per-case summary. |
| Case scores CSV | Per-case native score, completion status, returned judgment counts, native metric details, original case summary and failures. |
| Comparison JSON | Scope agreement, capture identities, query changes and per-variant/per-case scores. |

The customer HTML report contains the selected evaluation's query definitions, case inputs and judgments. The UI presents it as an explicit download. Source authentication values remain in the original source credential environment.

CSV strings use spreadsheet-safe quoting for formula-like values and long identifiers. Full native and evaluation JSON retain exact unsafe-integer decimal text and its accompanying JSON-pointer metadata.

## Service integration

```js
import { randomUUID } from 'node:crypto';
import { createOpenSearchWorkspace } from '@tokenjunkielabs/starforge-merchant/seller/opensearch/workspace/service';

const workspace = await createOpenSearchWorkspace({
  sourceFile: './opensearch-source.json',
  planFile: './merchant-plan.json',
  directory: './private-search-workspace'
});

const savedDraft = workspace.state().drafts.find(draft => draft.queryName === 'products');
if (!savedDraft) throw new Error('Save the products query draft in the workspace first.');

const operation = workspace.relevance.save({
  requestId: randomUUID(),
  set: {
    schema: 'stellar-forge.opensearch-relevance-set.v1',
    title: 'Product search review',
    description: 'Grade 0 is unrelated; grade 1 is useful; grade 2 is a direct match.',
    metric: { precision: { k: 10, relevant_rating_threshold: 1, ignore_unlabeled: false } },
    variants: [{
      id: 'current',
      title: 'Current product query',
      draftId: savedDraft.id,
      draftRevision: savedDraft.revision
    }],
    cases: [{
      id: 'pump',
      title: 'Pump search',
      input: { term: 'pump' },
      documents: [
        { _index: 'products', _id: 'sku-101', rating: 2, note: 'Direct match' },
        { _index: 'products', _id: 'sku-102', rating: null, note: 'Awaiting review' }
      ]
    }]
  }
});

const saved = operation.result.relevanceSet;
workspace.relevance.validate(saved.id, saved.revision);
const run = await workspace.relevance.run({
  requestId: randomUUID(),
  setId: saved.id,
  expectedRevision: saved.revision
});
const edition = workspace.relevance.edition(run.result.relevanceEditionId);
const customerReport = workspace.relevance.export(edition.id, 'report.html');
await workspace.close();
```

The HTTP workspace exposes these same methods under its existing loopback-origin and request-token checks. The relevance store uses the original workspace database and request journal; it adds no independent service or external persistence dependency.

## Run the complete native operator handoff

The existing public-playground receiver can run this full workflow in one process tree:

```sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/receiving/run-playground.py \
  --journey relevance --directory /absolute/private/relevance-receiving
```

It uses the retained seven-document native flight cohort and verifies the SHA-256 of its original result bytes before deriving judgments. The engineering example grades flights at or below the cohort's median `AvgTicketPrice` as relevant, then evaluates native ascending and descending price variants over exactly those document IDs. The saved criterion, original records, native response, case coverage and same-snapshot comparison accompany the customer exports. `STARFORGE_OPENSEARCH_COHORT_FILE` may select another retained cohort envelope with the same schema; its original result bytes and source identity remain required.

The receiver exercises the original HTTP workspace from set import and validation through one native evaluation, retained-request recovery, JSON/HTML/CSV exports, judgment-set import, evaluated-query promotion, merchant preparation, generated-client request construction and SQLite reopening. It preserves all output in the selected private directory. See `native-relevance-journey.json` in the chosen receiving directory for the completed workflow, and `relevance-exports/` for the customer handoff. The lower-level reusable entry point is `runRelevanceOperatorJourney()` in `relevance/operator-journey.mjs`.
