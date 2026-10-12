# Native OpenSearch relevance protocol

This note records the native API contract used by the retained search evaluation and customer handover arm. It is based on the OpenSearch source at build `4ee42a94e87f66fbf1e62a9871b1b87f91e02472`, the build returned by the public OpenSearch 3.9.0 service on 2026-10-11. The original merchant supports OpenSearch 3.3 or newer because its stable PIT order uses `_shard_doc`; rank evaluation itself predates that requirement.

The engine owns metric calculation. The operator workspace retains declared queries, real document judgments, immutable evaluation editions, original native responses, failure coverage, and customer handover. A judgment records the reviewer's actual assessment and its source edition. A default grade never silently substitutes for an unjudged document.

## Native request

Native routes are GET or POST `/_rank_eval` and `/{index}/_rank_eval`. The product uses POST and its existing source connection. The REST handler accepts index options and `search_type`; `allow_partial_search_results` is not a rank-evaluation REST parameter. Do not append it to this endpoint. See [RestRankEvalAction.java](https://github.com/opensearch-project/OpenSearch/blob/4ee42a94e87f66fbf1e62a9871b1b87f91e02472/modules/rank-eval/src/main/java/org/opensearch/index/rankeval/RestRankEvalAction.java).

The body requires a nonempty `requests` array and exactly one named `metric` object. `max_concurrent_searches` defaults to 10 in the engine; the product supplies the original source's admission limit, initially 1. Each selected additional metric requires its own native call. Native templates are optional; the existing declaration compiler can provide the bound query directly. See [RankEvalSpec.java](https://github.com/opensearch-project/OpenSearch/blob/4ee42a94e87f66fbf1e62a9871b1b87f91e02472/modules/rank-eval/src/main/java/org/opensearch/index/rankeval/RankEvalSpec.java).

The following is a request-shape example. The PIT ID, concrete index, document IDs, query text and judgments must come from the retained source and operator case before it is sent.

```json
{
  "requests": [
    {
      "id": "customer_case_a__baseline",
      "request": {
        "query": {
          "match": {
            "title": {
              "query": "operator supplied query"
            }
          }
        },
        "pit": {
          "id": "internally owned live PIT ID",
          "keep_alive": "60s"
        },
        "sort": [
          { "_score": "desc" },
          { "_index": "asc" },
          { "_shard_doc": "asc" }
        ],
        "timeout": "30s"
      },
      "ratings": [
        {
          "_index": "concrete_source_index",
          "_id": "reviewed_document_id",
          "rating": 3
        }
      ],
      "summary_fields": ["title", "description"]
    }
  ],
  "metric": {
    "dcg": {
      "k": 10,
      "normalize": true
    }
  },
  "max_concurrent_searches": 1
}
```

Native request constraints have direct consequences for the product:

- Enforce globally unique evaluation request IDs. The native result map is keyed by that ID and would overwrite duplicate keys.
- A rating joins to a returned document by the pair `(_index, _id)`. Preserve the actual concrete index; an alias name is not an equivalent rating key.
- Native rejects duplicate rating keys within one request. Validate them when saving a judgment set, before evaluation.
- Native parses ratings as integers, but does not enforce a useful nonnegative grading scale. The product records and validates a finite scale `0..M`, including optional unknown-document grades, and requires ERR grades to be no greater than `maximum_relevance`.
- Native accepts either an explicit search request or the corresponding template form. Suggest, aggregations, highlighter, `explain:true`, and `profile:true` are disallowed in rated requests.
- The transport replaces request `size` with the metric's `k`. An independently supplied size does not define the scored window.
- The transport replaces source selection with `summary_fields`. An empty list disables `_source`; a nonempty list becomes source includes. Reuse the merchant's native mapping/projection validation for those fields.

Sources: [RatedRequest.java](https://github.com/opensearch-project/OpenSearch/blob/4ee42a94e87f66fbf1e62a9871b1b87f91e02472/modules/rank-eval/src/main/java/org/opensearch/index/rankeval/RatedRequest.java), [RatedDocument.java](https://github.com/opensearch-project/OpenSearch/blob/4ee42a94e87f66fbf1e62a9871b1b87f91e02472/modules/rank-eval/src/main/java/org/opensearch/index/rankeval/RatedDocument.java), [TransportRankEvalAction.java](https://github.com/opensearch-project/OpenSearch/blob/4ee42a94e87f66fbf1e62a9871b1b87f91e02472/modules/rank-eval/src/main/java/org/opensearch/index/rankeval/TransportRankEvalAction.java).

## PIT scope and completeness

A rated request uses the normal native `SearchSourceBuilder`. Its validation does not prohibit `pit`, and the rank-evaluation transport passes that builder to `SearchRequest`. The search transport decodes a provided PIT and derives the concrete requested indices from its saved search contexts. This supports root `/_rank_eval` with an internally owned PIT in each request. The customer does not supply a replacement PIT or an arbitrary source index expression.

Sources: [RatedRequest.java](https://github.com/opensearch-project/OpenSearch/blob/4ee42a94e87f66fbf1e62a9871b1b87f91e02472/modules/rank-eval/src/main/java/org/opensearch/index/rankeval/RatedRequest.java), [TransportRankEvalAction.java](https://github.com/opensearch-project/OpenSearch/blob/4ee42a94e87f66fbf1e62a9871b1b87f91e02472/modules/rank-eval/src/main/java/org/opensearch/index/rankeval/TransportRankEvalAction.java), [SearchRequest.java](https://github.com/opensearch-project/OpenSearch/blob/4ee42a94e87f66fbf1e62a9871b1b87f91e02472/server/src/main/java/org/opensearch/action/search/SearchRequest.java), [TransportSearchAction.java](https://github.com/opensearch-project/OpenSearch/blob/4ee42a94e87f66fbf1e62a9871b1b87f91e02472/server/src/main/java/org/opensearch/action/search/TransportSearchAction.java), especially `extractRequestedIndices`.

The original stable total order remains the declared business order followed by `_index` and `_shard_doc`. `_shard_doc` requires a PIT. A relevance variant may deliberately sort by `_score`; it is a native virtual sort field, so the field-capabilities check should cover the actual mapped sort fields while handling `_score` explicitly.

There is an important native response limitation. For each nonfailed msearch item, `TransportRankEvalAction` extracts only its returned hits and calls the chosen metric. It does not carry forward `timed_out`, `terminated_early`, `_shards`, or total-hit metadata. The new search request uses the cluster's default partial-search behavior; the rank-evaluation REST handler provides no override for that behavior.

The existing strict search path can supply the missing completeness information as part of evaluation:

1. Create and retain one owned PIT for the declared concrete source scope.
2. Capture each bound case/variant's first `k` hits on that PIT through native `_search?allow_partial_search_results=false`, using the same query and sort. Inspect actual shard completion and timeout metadata.
3. Run the actual native metric request against the same PIT, bound query and order.
4. Reconcile each returned native evaluation hit window, in order, with the strict capture before accepting it as a metric for that complete retained window.
5. Retain metric originals and per-query failures, and release only the owned PIT through the original source lifecycle.

One strict window per case/variant can serve multiple selected metrics with the same `k`. Different windows require their own retained scope. This keeps scoring in the native engine while allowing the operator to assess what that score covers. The first complete native relevance journey must establish this integration against the actual supported service; the source analysis establishes its API feasibility.

PIT IDs and service credentials are transient connection state. Customer exports retain source identity, concrete document identity and captured content, rather than credentials or a promise that an expired PIT can be reopened. Reopening an evaluation loads the retained edition; a fresh native evaluation creates a new edition.

## Exact metric schemas and native semantics

Each row is the contents of the single named `metric` object. All native implementations default `k` to 10. The product supplies an explicit positive integer within the declared operation limit.

| Metric key | Fields and defaults | Scoring behavior | Native metric details |
| --- | --- | --- | --- |
| `precision` | `k:10`, `relevant_rating_threshold:1`, `ignore_unlabeled:false` | Relevant returned documents divided by actual returned document count. With `ignore_unlabeled:true`, the denominator contains only labeled returned documents. The denominator is not automatically `k`. Zero denominator gives 0. | `relevant_docs_retrieved`, `docs_retrieved` |
| `recall` | `k:10`, `relevant_rating_threshold:1` | Relevant returned documents divided by all supplied relevant judgments, including judgments outside the returned window. No supplied relevant judgments gives 0. This is recall against the judgment set. | `relevant_docs_retrieved`, `relevant_docs` |
| `mean_reciprocal_rank` | `k:10`, `relevant_rating_threshold:1` | Reciprocal rank of the first relevant returned document; absent gives 0. Unjudged hits still occupy their ranks. | `first_relevant`, equal to -1 when absent |
| `dcg` | `k:10`, `normalize:false`, optional integer `unknown_doc_rating` | Sum of `(2^grade - 1) / log2(rank + 1)`. An unknown grade contributes zero by default and retains its rank. With normalization, the ideal list is all supplied judgments sorted descending and truncated to the smaller of actual returned hit count and judgment count. Zero ideal gain gives 0. | `dcg`, `unrated_docs`; `ideal_dcg` and `normalized_dcg` appear only when ideal gain is nonzero |
| `expected_reciprocal_rank` | `k:10`, required integer `maximum_relevance`, optional integer `unknown_doc_rating` | At each rank, native relevance probability is `(2^grade - 1) / 2^maximum_relevance`. It accumulates continuation probability times relevance probability divided by rank. Unknown grades contribute zero by default while retaining rank. | `unrated_docs` |

Primary implementations: [PrecisionAtK.java](https://github.com/opensearch-project/OpenSearch/blob/4ee42a94e87f66fbf1e62a9871b1b87f91e02472/modules/rank-eval/src/main/java/org/opensearch/index/rankeval/PrecisionAtK.java), [RecallAtK.java](https://github.com/opensearch-project/OpenSearch/blob/4ee42a94e87f66fbf1e62a9871b1b87f91e02472/modules/rank-eval/src/main/java/org/opensearch/index/rankeval/RecallAtK.java), [MeanReciprocalRank.java](https://github.com/opensearch-project/OpenSearch/blob/4ee42a94e87f66fbf1e62a9871b1b87f91e02472/modules/rank-eval/src/main/java/org/opensearch/index/rankeval/MeanReciprocalRank.java), [DiscountedCumulativeGain.java](https://github.com/opensearch-project/OpenSearch/blob/4ee42a94e87f66fbf1e62a9871b1b87f91e02472/modules/rank-eval/src/main/java/org/opensearch/index/rankeval/DiscountedCumulativeGain.java), [ExpectedReciprocalRank.java](https://github.com/opensearch-project/OpenSearch/blob/4ee42a94e87f66fbf1e62a9871b1b87f91e02472/modules/rank-eval/src/main/java/org/opensearch/index/rankeval/ExpectedReciprocalRank.java).

Precision, recall and reciprocal-rank constructors reject `k <= 0` and negative relevance thresholds; threshold zero is accepted. DCG and ERR constructors do not provide equivalent useful range validation. A declared grading scale prevents invalid probabilities and nonfinite exponent results from entering a customer evaluation.

## Native response and retained result

The actual response is flat. The three top-level fields are `metric_score`, `details`, and `failures`; there is no outer `rank_eval` wrapper in native serialization.

```ts
{
  metric_score: number,
  details: {
    [requestId: string]: {
      metric_score: number,
      unrated_docs: Array<{ _index: string, _id: string }>,
      hits: Array<{
        hit: NativeSearchHit,
        rating: number | null
      }>,
      metric_details: {
        [selectedMetricName: string]: NativeMetricDetails
      }
    }
  },
  failures: {
    [requestId: string]: NativeError
  }
}
```

Sources: [RankEvalResponse.java](https://github.com/opensearch-project/OpenSearch/blob/4ee42a94e87f66fbf1e62a9871b1b87f91e02472/modules/rank-eval/src/main/java/org/opensearch/index/rankeval/RankEvalResponse.java), [EvalQueryQuality.java](https://github.com/opensearch-project/OpenSearch/blob/4ee42a94e87f66fbf1e62a9871b1b87f91e02472/modules/rank-eval/src/main/java/org/opensearch/index/rankeval/EvalQueryQuality.java), [RatedSearchHit.java](https://github.com/opensearch-project/OpenSearch/blob/4ee42a94e87f66fbf1e62a9871b1b87f91e02472/modules/rank-eval/src/main/java/org/opensearch/index/rankeval/RatedSearchHit.java).

A null hit rating means unjudged. Grade zero is an explicit judgment and remains distinguishable throughout the UI and export. Preserve native hit IDs as strings and pass source numeric values through the original exact-integer encoding; JSON parsing must not round source document identifiers or long integer fields.

The native aggregate is the arithmetic mean of successful detail scores. Failed requests are excluded from its denominator. An HTTP 200 can therefore contain both successful details and failures. The implementation divides by the successful-detail count without a zero-count guard. Preserve the original response, and treat a nonnumeric or nonfinite aggregate as unavailable rather than converting it to zero. See [EvaluationMetric.java](https://github.com/opensearch-project/OpenSearch/blob/4ee42a94e87f66fbf1e62a9871b1b87f91e02472/modules/rank-eval/src/main/java/org/opensearch/index/rankeval/EvaluationMetric.java) and [TransportRankEvalAction.java](https://github.com/opensearch-project/OpenSearch/blob/4ee42a94e87f66fbf1e62a9871b1b87f91e02472/modules/rank-eval/src/main/java/org/opensearch/index/rankeval/TransportRankEvalAction.java).

Coverage is operator presentation derived from the retained response:

- Returned-window judgment coverage: labeled returned hits divided by returned hits, with an explicit empty-window state.
- Query coverage: successful, failed and missing request IDs against the exact submitted set.
- Complete-window correspondence: whether the ordered evaluation hits match the strict same-PIT capture.
- Corpus totals and lower-bound relations: taken from the original strict search response, since rank evaluation does not return those fields.

These values answer different questions and must remain separately visible. Keep the original native aggregate and per-query scores alongside coverage.

## Comparison and customer handover

Freeze the cluster fingerprint, concrete source scope, query-set revision, per-case inputs, variant configuration, judgment-set revision and scale, selected metric options, `k`, projection, and captured edition with each run. Compare the same query IDs, judgments and metric settings. If the successful query sets differ, make that scope change visible and avoid treating the two native aggregates as if they shared a denominator.

Retain per-case ranking changes and the original reviewed document content. A judgment attached to an earlier document edition requires an explicit applicability decision when that content changes. Reopening or exporting must not silently rescore against today's source or migrate grades to changed content.

The existing workspace is the single operator surface for case creation, review, evaluation, comparison, reopen and export. Its source edition and request IDs allow another operator to continue the same work. The original merchant remains the customer search and payment surface.

## Documentation cross-check

The public [Rank Evaluation API documentation](https://docs.opensearch.org/latest/api-reference/search-apis/rank-eval/) is useful for endpoint discovery. At retrieval on 2026-10-11, its illustrated response included a `rank_eval` wrapper and some request examples omitted the required `metric`. The pinned native parser and serializer above determine the implementation contract.
