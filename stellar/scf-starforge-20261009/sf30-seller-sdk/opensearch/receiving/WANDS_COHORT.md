# Full WANDS catalog and native relevance comparison

This workflow measures the original published Wayfair WANDS catalog on a native OpenSearch cluster and produces a complete, portable comparison for the catalog operating workspace. It uses all 42,994 original products, all 480 original queries and all 233,448 judgment rows. Query IDs are retained verbatim; the source's IDs are noncontiguous.

The maintained runner is opensearch/receiving/wands-cohort.mjs. It uses Node 24+ builtins and Linux flock. The cluster must be native OpenSearch 3.3 or newer. A private single-node development cluster with one benchmark shard, zero replicas and a 512 MiB JVM heap is suitable for this catalog. Keep the cluster's original data directory and the runner's output directory for continuation.

## Source files and attribution

WANDS is published by Wayfair under the MIT license. The exact source release used here is:

https://github.com/wayfair/WANDS/tree/3b74dcf4ba29ab8ff3e6a50b5b09fc627cb882b5

Although the upstream filenames end in .csv, all three original tables use tabs. The runner parses quoted tabs, quoted newlines and doubled quotes as well as ordinary UTF-8 fields.

| Original file | Exact bytes | Git blob | Original rows |
|---|---:|---|---:|
| dataset/product.csv | 90,621,131 | a415f7295dc0d90b3163ef606da611a4e9ddeca8 | 42,994 |
| dataset/query.csv | 19,942 | acb3c1f4cf1b775f494225afec79ec2163fc3e03 | 480 |
| dataset/label.csv | 5,736,234 | 2c09a0d7b1f77f6040deb5873b5a90b8ef1e3ae9 | 233,448 |

The full original product has SHA-256 d993926254572e6eba96c8fd87cc549a17fb91ad3748308036eee4cf92b10ac6. The other SHA-256 digests are computed from the complete original files and retained in source-index.json. Git blob verification includes the native Git prefix: SHA1("blob " + decimal_byte_length + NUL + original_bytes).

The original query table and both source licenses are included under opensearch/examples/material-catalog/. SOURCE-INDEX.json and SOURCES.md also describe the separate SAP SHINE examples. WANDS provides retrieval judgments for its own product IDs. The SAP editions provide actual release changes and material mappings; they have their own product identities.

The product columns are product_id, product_name, product_class, category_hierarchy, product_description, product_features, rating_count, average_rating and review_count. The original catalog contains no unit or manufacturer field. The WANDS mapping retains that actual schema.

## Retain the original inputs

Use the full product file already received by the source operation. For the original DataXstream case, that artifact is Slack file F0C8DPVAWUE, wands_product_3b74dcf4.csv:

https://tokenjunkielabs.slack.com/files/U0BR9670G2H/F0C8DPVAWUE/wands_product_3b74dcf4.csv

The receiving worker downloads that retained artifact through its authenticated Slack file access and passes its local path with --products. The runner verifies every original byte and record before indexing. It has no product download path, so later continuation keeps the same source intake.

The original label URL is:

https://raw.githubusercontent.com/wayfair/WANDS/3b74dcf4ba29ab8ff3e6a50b5b09fc627cb882b5/dataset/label.csv

If the preparing worker already retained the labels, pass that exact path with --labels. If it is the sole original label-intake owner, omit --labels to stream the pinned file into output/sources/label.tsv. An interrupted download remains under that same output directory and resumes its own partial file. A supplied --labels path is always consumed as an existing input.

The default --queries path is the bundled unchanged wands-query.tsv. The runner checks source lengths, native Git blob identities, SHA-256, exact original headers, full row counts, unique source IDs and every query/product judgment reference. Equal duplicate judgment pairs, if present in a source, are retained in source counts and consolidated for native evaluation; conflicting labels fail with the precise source pair.

## Prepare and run

Use one stable output directory, operation ID, index name and exact code commit. The commands below start from the repository root. Replace the uppercase paths and SOURCE_COMMIT with the receiving worker's actual paths and the full committed feature SHA.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/receiving/wands-cohort.mjs prepare \
  --products /retained/wands_product_3b74dcf4.csv \
  --labels /retained/wands-label.tsv \
  --output /retained/datax-wands-2769 \
  --index sf-datax-wands-2769 \
  --operation-id SCF-DATAX-MATERIAL-CATALOG-NATIVE-2769-20261012 \
  --source-ref SOURCE_COMMIT

node stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/receiving/wands-cohort.mjs run \
  --products /retained/wands_product_3b74dcf4.csv \
  --labels /retained/wands-label.tsv \
  --output /retained/datax-wands-2769 \
  --url http://127.0.0.1:9200 \
  --index sf-datax-wands-2769 \
  --operation-id SCF-DATAX-MATERIAL-CATALOG-NATIVE-2769-20261012 \
  --source-ref SOURCE_COMMIT \
  --cohort-size 100 \
  --k 10
~~~

The prepare command validates and retains the full source selection. The run command can also perform that step directly. Retain identical evaluation settings when continuing the operation.

For a secured cluster, place its request headers in a JSON-valued environment variable and name it with --headers-env. Values remain in the current process environment. Use an HTTPS cluster URL for remote hosts; plain HTTP is supported for the loopback development cluster. Keep URL credentials out of the endpoint.

The output directory has a Linux filesystem lease for the complete operation. The runner verifies native cluster health, OpenSearch distribution/version and exact source-bound index metadata before carrying the operation. It reports progress as compact JSON lines.

## Native indexing and continuation

The benchmark index uses each original product_id as its native document ID. Text fields use the standard analyzer, product_id is a keyword, and all original source values remain in the retained native document. Each document also carries the digest of its complete canonical original row.

New ingestion uses native create operations in batches of at most 1,000 products and approximately 2 MiB. If a previous batch reached OpenSearch before its response was lost, continuation encounters an existing document and verifies its original row identity through native lookup. This avoids repeated upserts and the deleted-document history they introduce.

The runner accounts for every product, verifies the native count and seals the dedicated index against later writes. Reopening a completed index checks every retained product ID and row digest. An unrelated index, alias, incompatible mapping, different source or changed native generation has a precise error; select a fresh dedicated index/output when intentionally starting a different comparison.

Native cluster UUID, version/build hash, index UUID, projection/source digests and the executed runner's own Git blob/SHA-256 are retained. A restart of the same persisted cluster can continue the same operation. A replacement cluster generation is a distinct native comparison.

## Query variants and all original judgments

Each original query runs through both variants:

| Variant | Native multi_match fields |
|---|---|
| baseline | product_name, product_class, category_hierarchy, product_description, product_features |
| identifier_title | product_id^8, product_name^4, product_class^2, category_hierarchy, product_description, product_features |

Both use best_fields with the OR operator. The order is descending native score, then exact product_id for deterministic ties. The candidate adds identifier matching and gives more weight to titles and product classes. All other indexing and query settings remain shared.

The runner sends every original judgment for each query to the native index's _rank_eval API. Exact maps to rating 2, Partial to 1, and Irrelevant to 0. It partitions the original query order into groups of no more than 100, with two concurrent native searches inside each rank-eval call. At the default size, each variant has five cohorts containing 100/100/100/100/80 queries.

A completed cohort retains the exact native response, its response digest, request digest, original query IDs and full source/runtime identity. Repeating the same command reuses matching completed cohorts and continues the next missing one. A native failure remains actionable through its original error; a cohort is only accepted when every requested query has its complete native result.

## Interpreting NDCG and coverage

The primary comparison is the mean fixed-k NDCG across all 480 original queries. It uses gain 2^rating - 1 and the log2(rank + 1) discount. The ideal ranking uses every original judgment for that query, sorted by rating and truncated at the requested k. An unjudged returned product contributes zero gain. A query with no positive original judgments receives zero.

Native normalized DCG is also retained exactly as OpenSearch reports it. OpenSearch 3.3's implementation computes its ideal denominator using the number of actual returned hits. For short result lists this can differ from a fixed-k denominator. The runner recomputes fixed-k NDCG from the same actual native hits and original judgments and reports both values. When a query returns k hits, their agreement is checked.

Global means weight each query equally; they do not weight the shorter final cohort like a 100-query cohort. Per-cohort and full comparison include:

- All original query IDs and rating-pair counts.
- Requested slots and actual returned hits.
- Returned-slot coverage: returned hits divided by queries multiplied by k.
- Judgment coverage of returned hits: judged returned hits divided by returned hits.
- Positive hits, known-positive recall, no-hit queries and short result lists.
- Fixed-k and native NDCG, per-query changes and improved/worse/tied counts.

WANDS has pooled judgments. Its coverage measurements show which actual returned products have a published judgment. Review that coverage alongside score changes when selecting a query for a customer catalog.

The exported recommendation chooses the higher full-query mean fixed-k score and retains the baseline on an exact tie. The catalog operator can then compare that measured query with its own approved material mapping and customer requirements.

Primary API and evaluator sources:

https://docs.opensearch.org/docs/latest/api-reference/rank-eval/

https://github.com/opensearch-project/OpenSearch/blob/3.3.0/modules/rank-eval/src/main/java/org/opensearch/index/rankeval/DiscountedCumulativeGain.java

## Complete handover

| File | Use |
|---|---|
| report.json and REPORT.md | Complete global/per-cohort comparison, source/runtime identity and recommendation |
| per-query.json | Every original query, actual ranked product IDs, source judgments and both metrics |
| per-query.tsv | Spreadsheet-ready query comparison |
| query-selection.json | Recommended native query template, exact field weights and source/index identity |
| query-selection.ts | TypeScript query builder for the selected variant |
| native-products.ndjson | Every raw product_id and its actual native _index/_id, plus original row digest |
| source-index.json | Original URLs, commit, source digests/counts, native projection and executed source |
| cohorts/*.json | Exact retained native response for each completed cohort |
| native-index.json | Source-bound mapping, cluster/index generation and sealed native state |
| inputs.json and run.json | Private retained source paths and operation continuation |

The catalog workspace's own exports bind catalog_id and tenant_id and derive their own native IDs. Use that workspace's actual raw-material-to-native-ID map when carrying judgments into its relevance service. The benchmark's native-products.ndjson explicitly preserves raw WANDS IDs so the two ID systems can be joined correctly.

For the ordinary maintained relevance API, seed cases from the actual captured [_index, _id] selections, run its original evaluation, then promote the chosen original edition/variant/case into the workspace's prepared package. Keep the original workspace journal and receiving package as the customer operating history. The benchmark exports provide the measured query, complete source context and exact native targets for that existing flow.

After interruption, rerun the same run command. Keep the retained original files, output directory and cluster data together. Source inspection, native document reconciliation and cohort identity checks connect the continuation to the original full operation.
