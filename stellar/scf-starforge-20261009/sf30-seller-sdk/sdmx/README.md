# SDMX sources, retained editions and paid dataset delivery

This workspace takes a complete SDMX provider response and its structural metadata through source inspection, exact observations, saved project editions, native dataset queries, merchant publication and customer receiving. It uses the existing SF30 dataset engine, original versioned seller and original SF88 paginated buyer.

The browser and CLI operate the same private workspace. Each source retains its original bytes and acquisition metadata. A project identifies the selected data source, the exact dataflow/DSD/codelists, the selected series and a saved revision. Dataset exports bind that revision to the original engine's snapshot; complete project packets also retain the source material and ordered revision history.

## Installed entrypoints

~~~sh
starforge sdmx --help
starforge dataset sdmx --help
starforge sdmx merchant --help
starforge sdmx buyer --help
~~~

Both SDMX entrypoints dispatch the same implementation. In a source checkout, use:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sdmx/cli.mjs --help
~~~

Use Node 22.16 or later and Python 3.11 or later. The source workspace uses Python's standard library and the original XML NativeEngine. The Node entrypoint selects SF30_SDMX_PYTHON, then SF30_XML_PYTHON, then python3; it passes its actual Node executable to the original engine. The existing native seller and buyer dependency profiles supply Stellar/x402 support when those operations are configured.

The workspace directory is private to its operator and has one original writer lease. Close its browser server before invoking a separate workspace CLI process. The seller has its own original version-store lease and control endpoint; it can continue serving already published editions while the source workspace is closed.

## Official ECB input used by this product

The retained source case is the ECB exchange-rate dataflow ECB:EXR, version 1.0, using DSD ECB:ECB_EXR1, version 1.0. Its complete selected response is:

- Series key: A+D+M+Q.GBP+USD.EUR.SP00.A.
- Requested coverage: 2025-01-01 through 2025-12-31, detail=full.
- Eight actual series and 544 observations: for each of GBP and USD, one annual value, 255 daily values, 12 monthly values and four quarterly values.
- Generic SDMX-ML, structure-specific SDMX-ML and CSV are retained as separate original files. The exact request, media type, response headers, byte length and SHA-256 are in each adjacent acquisition receipt.
- The selected dataflow response includes its DSD and eleven referenced codelists. The separate complete dataflow catalog contains 105 dataflows.

The complete data request is:

<https://data-api.ecb.europa.eu/service/data/ECB,EXR,1.0/A+D+M+Q.GBP+USD.EUR.SP00.A?startPeriod=2025-01-01&endPeriod=2025-12-31&detail=full>

The dataflow and referenced structural definitions are:

<https://data-api.ecb.europa.eu/service/dataflow/ECB/EXR/latest?references=all>

The captured file and receipt retain the concrete returned structure edition; another request to latest may return a later source. Keep the returned source identity when comparing or transferring an edition.

The [ESCB reuse policy](https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html) permits commercial and noncommercial reuse of its publicly available statistics with source attribution and unchanged statistics, including metadata. It distinguishes third-party data and allows revisions to published statistics. Preserve the retained source's attribution and rights when offering a delivery service. For this ECB source the attribution is “Source: ECB statistics.”

The [ECB reference-rate description](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html) identifies these rates as informational and discourages their use for transactions. Merchant payment terms are an operator's separate explicit configuration.

### Exact values and statistical meaning

An observation value stays the provider's original decimal string. The annual GBP source contains 0.8567923137255 even though its DECIMALS attribute is 5; the exported observation preserves the full source value. The parser retains the original frequency, period, dimensions, observation status, statistical attributes and attached metadata. Querying a daily series, a monthly average and an annual average therefore keeps their different original identities.

Blank or absent observations and the provider's status or action remain distinguishable in source inspection and lineage. Edition comparison reports values present, absent or changed in the supplied editions, with their retained source coverage. Read that coverage before treating an absence as a provider deletion. A selected-response capture, an includeHistory response and an updatedAfter response each retain their actual request selection.

## Retain the original source and metadata

The captured originals and receipts ship in [examples/ecb-2025](examples/ecb-2025/SOURCE-NOTES.md), with sources.json identifying the exact packet members. The following commands use those original files and receipts. Set SDMX_SOURCE to their actual local directory and SDMX_WORK to a new private workspace path. The commands write their useful operation results to the current operator directory.

~~~sh
export SDMX_SOURCE=/private/received-ecb-sources
export SDMX_WORK=/private/ecb-sdmx-workspace

starforge sdmx --workspace "$SDMX_WORK" init > workspace-created.json

SDMX_DATA_URL=$(python3 -c 'import json,os; print(json.load(open(os.path.join(os.environ["SDMX_SOURCE"],"ecb-exr-2025-generic.xml.receipt.json")))["url"])')
SDMX_STRUCTURE_URL=$(python3 -c 'import json,os; print(json.load(open(os.path.join(os.environ["SDMX_SOURCE"],"ecb-exr-dataflow.xml.receipt.json")))["url"])')

starforge sdmx --workspace "$SDMX_WORK" source \
  --file "$SDMX_SOURCE/ecb-exr-dataflow.xml" \
  --name ecb-exr-dataflow.xml --label "ECB EXR structural metadata" \
  --kind structure --origin "$SDMX_STRUCTURE_URL" \
  --media-type 'application/vnd.sdmx.structure+xml;version=2.1' \
  --receipt "$SDMX_SOURCE/ecb-exr-dataflow.xml.receipt.json" \
  > structure-source.json

starforge sdmx --workspace "$SDMX_WORK" source \
  --file "$SDMX_SOURCE/ecb-exr-2025-generic.xml" \
  --name ecb-exr-2025-generic.xml --label "ECB exchange rates, 2025" \
  --kind data --origin "$SDMX_DATA_URL" \
  --media-type 'application/vnd.sdmx.genericdata+xml;version=2.1' \
  --receipt "$SDMX_SOURCE/ecb-exr-2025-generic.xml.receipt.json" \
  > data-source.json
~~~

The source command returns the actual content identity in id and sha256. Reading the same bytes again adds the corresponding acquisition metadata to that original source. An optional --coverage JSON file records an explicit source declaration; the ECB case above derives its period, key and selected-response coverage from the actual retained request URL.

Use source-show to inspect the dataflow, DSD, codelists and acquisition record. The series and observations commands return offset/limit pages, so an operator can inspect complete sources without dumping them into a browser response.

~~~sh
SDMX_DATA_ID=$(python3 -c 'import json; print(json.load(open("data-source.json"))["id"])')
SDMX_STRUCTURE_ID=$(python3 -c 'import json; print(json.load(open("structure-source.json"))["id"])')

starforge sdmx --workspace "$SDMX_WORK" source-show --source "$SDMX_STRUCTURE_ID"
starforge sdmx --workspace "$SDMX_WORK" series --source "$SDMX_DATA_ID" --offset 0 --limit 50
starforge sdmx --workspace "$SDMX_WORK" observations \
  --source "$SDMX_DATA_ID" --series-key A.GBP.EUR.SP00.A --offset 0 --limit 50
~~~

The private browser provides the same source, series, observation, project, comparison and receiving operations:

~~~sh
starforge sdmx --workspace "$SDMX_WORK" serve --port 0
~~~

Open the emitted private URL. The original server owns its bounded request threads; normal shutdown drains accepted requests before closing the workspace and native engine.

## Save an edition and query the original dataset

Create the project from the actual retained source IDs. Empty series_keys selects the complete source response. A nonempty array selects literal original series keys shown by the series command. If a source has multiple datasets, dataset_ids can also select their actual retained identities.

~~~sh
python3 - <<'PY'
import json, os
data = json.load(open("data-source.json"))
structure = json.load(open("structure-source.json"))
request = {
    "operation_id": "ecb-exr-2025-initial",
    "title": "ECB reference exchange rates - 2025",
    "data_source_id": data["id"],
    "metadata_source_ids": [structure["id"]],
    "flow_id": "EXR",
    "selection": {"series_keys": []},
    "notes": "Source: ECB statistics. Complete retained 2025 selected response."
}
fd = os.open("project-request.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as stream:
    json.dump(request, stream, indent=2)
    stream.write("\n")
PY

starforge sdmx --workspace "$SDMX_WORK" project \
  --file project-request.json > project-saved.json

SDMX_PROJECT=$(python3 -c 'import json; print(json.load(open("project-saved.json"))["project"]["id"])')

starforge sdmx --workspace "$SDMX_WORK" project-show --project "$SDMX_PROJECT"
starforge sdmx --workspace "$SDMX_WORK" query \
  --project "$SDMX_PROJECT" --revision 1 --params '{"limit":"20"}'
~~~

The project build exposes the native dataset description and query capabilities. Native query values are scalar strings. Use the original fields, limit, cursor, permitted equality/range filters and sort parameters advertised by that description. A returned nextCursor is passed unchanged with the same query selection. [DATASET_API.md](../DATASET_API.md) documents the original cursor and query contract.

A new project operation has a stable operation_id. A revision update includes the existing id and the exact expected_revision, while using a new operation_id for that new reviewed request. Repeating the same saved operation and body recovers its original result; changing a request under that operation identity is rejected. An intervening project revision is reported for review rather than replacing the operator's expected revision.

Native snapshots identify the typed dataset content and query contract. Generic XML, structure-specific XML and CSV editions with equivalent content can yield the same native snapshot while retaining different source hashes and lineage. Their original source files and acquisition receipts remain separately available.

## Compare retained editions

Retain the later actual provider response, then save the reviewed project update with its new source ID and expected revision. Compare the exact saved revisions:

~~~sh
starforge sdmx --workspace "$SDMX_WORK" compare \
  --before-project "$SDMX_PROJECT" --before-revision 1 \
  --after-project "$SDMX_PROJECT" --after-revision 2 \
  > comparison.json

SDMX_COMPARISON=$(python3 -c 'import json; print(json.load(open("comparison.json"))["id"])')

starforge sdmx --workspace "$SDMX_WORK" changes \
  --comparison "$SDMX_COMPARISON" --offset 0 --limit 50
~~~

The saved comparison includes before/after snapshots, exact source coverage, counts, metadata changes and field-level changes. Its detailed rows page through the retained result. The original observations remain available in both project revisions.

## Export a native dataset or transfer the whole project

These exports serve different operator operations:

| Export | Retained content | Consumer |
| --- | --- | --- |
| dataset | data.csv, dataset.json and sdmx-lineage.json for one selected revision | Original SF30 merchant or another dataset application |
| export | Exact source files, acquisition metadata, complete project history through the selected revision and retained same-project comparison declarations | Another SDMX workspace |

~~~sh
starforge sdmx --workspace "$SDMX_WORK" dataset \
  --project "$SDMX_PROJECT" --revision 1 \
  --out /private/ecb-edition-1 > dataset-export.json

starforge sdmx --workspace "$SDMX_WORK" export \
  --project "$SDMX_PROJECT" --revision 1 \
  --out /private/ecb-project-1.zip > packet-export.json

starforge sdmx --workspace /private/received-ecb-workspace init
starforge sdmx --workspace /private/received-ecb-workspace import \
  --file /private/ecb-project-1.zip > project-received.json
~~~

Matching export retries retain the original identity. Receiving checks the packet's declared paths, byte lengths, hashes, source references and ordered history, then reconstructs each edition through the same original native engine. Existing exact source and project identities are reused. Conflicting retained revisions remain explicit. Portable receiving binds the exact CSV, schema, native snapshot and semantic observations; the SQLite index is recreated on each host.

The receiver can run project-show, query, compare, dataset and export against those recovered project IDs. This is the source-aware handoff for an analyst or another merchant.

## Prepare and operate the original merchant

Select the explicit public payment terms used by the original seller. The JSON file accepts scheme, network, asset, amount, payTo and maxTimeoutSeconds. amount is an exact decimal atomic string. Use the configured original Stellar network and asset; observations and exchange-rate metadata do not determine those payment terms.

~~~sh
starforge sdmx merchant prepare \
  --dataset /private/ecb-edition-1 \
  --payment /private/merchant/public-terms.json \
  --origin https://data.example.org \
  --path /ecb/exchange-rates \
  --out /private/ecb-merchant-release-1

starforge sdmx merchant inspect --release /private/ecb-merchant-release-1

starforge sdmx merchant serve \
  --release /private/ecb-merchant-release-1 \
  --state /private/ecb-seller-versions \
  --port 8423
~~~

Use the merchant's actual HTTPS public origin in place of the example origin. The local URL and original health, offers and developer-documentation endpoints are printed by serve. The default original seller mode is CHALLENGE_ONLY. For the configured native Stellar seller, supply --facilitator with its original HTTPS facilitator URL and use the maintained native runtime dependencies.

The resulting release contains:

- The exact exported data.csv and dataset.json.
- The original sdmx-lineage.json, including project/revision, snapshot, metadata and source identities.
- seller.json compiled by the original SF30 dataset seller compiler from those public payment terms.
- release.json, binding the exact member hashes and public resource.

Preparation is create-only. A matching retry completes an interrupted preparation from the same manifest and exact file identities. The original versioned seller owns query admission, payment processing, request lifetime, current-version changes, retained snapshots, private control and shutdown.

The default new version store retains four versions for one hour, with a 256 MiB retained-data limit. The original cache defaults are two cached versions and one million resident rows. The merchant serve help exposes the original runtime limits. Retention options initialize a new state directory; reopening an existing store retains that store's original saved policy.

### Publish the next reviewed edition

Export the next selected revision into a new dataset directory, then prepare its release with the same public route and payment terms. Inspect the running seller's exact current snapshot and revision:

~~~sh
starforge sdmx merchant status --state /private/ecb-seller-versions \
  > seller-status.json

SDMX_CURRENT=$(python3 -c 'import json; print(json.load(open("seller-status.json"))["current"])')
SDMX_STORE_REVISION=$(python3 -c 'import json; print(json.load(open("seller-status.json"))["revision"])')

starforge sdmx merchant publish \
  --release /private/ecb-merchant-release-2 \
  --state /private/ecb-seller-versions \
  --expect "$SDMX_CURRENT" --expect-revision "$SDMX_STORE_REVISION"
~~~

Publication uses the original running seller's refresh operation with both compare-and-swap values. The saved binding preserves the original project, seller configuration and public resource. Its query contract and public price stay those reviewed for that seller. A different public contract uses a separately prepared and configured seller.

The original activate command selects a still-retained snapshot with the same current/revision review. collect uses the original retention policy. In-flight requests and retained cursors remain governed by the original version store.

## Review and receive the chosen edition through SF88

Read the actual original seller offer for the selected release:

~~~sh
starforge sdmx buyer offer \
  --release /private/ecb-merchant-release-1 \
  --seller http://127.0.0.1:8423 \
  --query '{"limit":"100"}' > buyer-offer.json
~~~

Review its actual payment alternatives and the displayed offerSha256. Prepare the chosen advertised alternative using that same digest and a unique original buyer intent:

~~~sh
SDMX_OFFER_SHA=$(python3 -c 'import json; print(json.load(open("buyer-offer.json"))["offerSha256"])')

starforge sdmx buyer prepare \
  --release /private/ecb-merchant-release-1 \
  --seller http://127.0.0.1:8423 \
  --query '{"limit":"100"}' \
  --intent ecb-exr-2025-edition-1 \
  --accept-index 0 --offer-sha "$SDMX_OFFER_SHA" \
  --out /private/buyer/ecb-edition-1.json
~~~

Choose the actual reviewed alternative's zero-based index. Preparation reloads the live original offer and rejects a changed digest. The prepared SF88 configuration pins the release's snapshot in the original resource URL. The public resource is the merchant's configured HTTPS origin; the loopback address above is used to inspect the existing local seller.

Review the prepared original configuration and attach the configured payer through the existing SF88 workspace initializer. STELLAR_PAYER is the public payer account, and STELLAR_SECRET is the existing secret environment variable consumed by the original signer. Use the real actor/service identifiers and reviewed limits for that operator:

~~~sh
starforge buyer --review --config /private/buyer/ecb-edition-1.json

starforge buyer --init-workspace \
  --config /private/buyer/ecb-edition-1.json \
  --dir /private/buyer/ecb-operator \
  --actor ecb-research-operator --service ecb-dataset \
  --payer "$STELLAR_PAYER" --secret-env STELLAR_SECRET \
  --python /usr/bin/python3 --total-atomic 100000 --daily-atomic 100000

starforge buyer --review-workspace --dir /private/buyer/ecb-operator
starforge buyer --diagnose-workspace --dir /private/buyer/ecb-operator
~~~

The existing [buyer guide](../../sf88-operator-buyer-cli/README.md) also describes its native signer-provider and RPC options. The [dataset acquisition guide](../../sf88-operator-buyer-cli/DATASETS.md) describes the original per-page review and durable reservations. A previously configured original operator workspace can be reused for its selected buyer intent.

The remaining SDMX buyer commands delegate directly to the original dataset CLI:

~~~sh
starforge sdmx buyer init \
  --session /private/buyer/ecb-acquisition \
  --workspace /private/buyer/ecb-operator \
  --max-pages 10 --max-total-atomic 100000

starforge sdmx buyer run \
  --session /private/buyer/ecb-acquisition \
  --workspace /private/buyer/ecb-operator
starforge sdmx buyer status --session /private/buyer/ecb-acquisition
starforge sdmx buyer recover --session /private/buyer/ecb-acquisition

starforge sdmx buyer export \
  --session /private/buyer/ecb-acquisition \
  --out /private/buyer/ecb-acquisition-manifest.json

starforge sdmx buyer deliver \
  --session /private/buyer/ecb-acquisition \
  --out /private/buyer/ecb-data-room
~~~

The page and atomic-total caps are operator choices; set them from the reviewed original offer. A complete original operator configuration file can alternatively be supplied to init with --config. The account, policy and signer remain those of the original SF88 operator.

The original buyer retains each page's quote review, authorization, attempted request and receipt. Completed pages are reused, and recovery reconciles the saved attempted page. Its data-room delivery retains the original dataset pages and their aggregate files. accounting reads the saved receipts; finalize applies the existing operator reservation reconciliation.

A customer receiving the complete SDMX project packet uses the import workflow above. A customer acquiring paid query pages uses this original buyer workflow. Both retain the selected native snapshot and their corresponding source or acquisition identity.

## Native JavaScript integration

The installed package exposes the same maintained adapters:

~~~js
import {
  prepareSdmxMerchant, readSdmxMerchant,
  startSdmxMerchant, publishSdmxMerchant,
} from '@tokenjunkielabs/starforge-merchant/seller/sdmx';
import {
  reviewSdmxBuyer, prepareSdmxBuyer,
} from '@tokenjunkielabs/starforge-merchant/buyer/sdmx';

const release = await prepareSdmxMerchant({
  datasetDirectory: '/private/ecb-edition-1',
  directory: '/private/ecb-merchant-release-1',
  payment: operatorPublicTerms,
  origin: operatorPublicOrigin,
  path: '/ecb/exchange-rates',
});
const service = await startSdmxMerchant({
  directory: release.directory,
  stateDirectory: '/private/ecb-seller-versions',
  port: 0,
  facilitator: configuredOriginalFacilitator,
});
try {
  const review = await reviewSdmxBuyer({
    directory: release.directory,
    seller: service.url,
    query: { limit: '100' },
  });
  // The host presents review.accepts and retains the selected index and digest.
  // After that review, prepareSdmxBuyer reloads the original live offer:
  const prepared = await prepareSdmxBuyer({
    directory: release.directory,
    seller: service.url,
    query: { limit: '100' },
    intentId: reviewedIntentId,
    acceptIndex: reviewedAcceptIndex,
    offerSha256: reviewedOfferSha256,
    destination: '/private/buyer/ecb-edition-1.json',
  });
  consumeOriginalBuyerDraft(prepared);
} finally {
  await service.close();
}
~~~

The application supplies its actual reviewed terms and original facilitator configuration. startSdmxMerchant also accepts the existing nativeFactory injection used by the original SF30 service. Lifecycle, buyer account, signer, operation reservation and settlement continue through the original maintained implementations.
