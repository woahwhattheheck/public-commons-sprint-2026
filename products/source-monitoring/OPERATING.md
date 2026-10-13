# Source monitoring — installation, operation and receiving

This product receives original OpenSanctions editions and complete delta chains, preserves customer counterparties and review history, and operates the customer's native screening requests. The existing SF30 NDJSON workspace owns the data, source projections, requests and decisions. The monitoring console, Applications and the typed operator client all use that same workspace.

The selected product is `source-monitoring`. It includes the original monitoring and JSON Lines commands, the original customer/file-job receiving tools, the existing installer and Applications lifecycle, and `source-monitoring-client`. Install a source release; import a complete operating workspace to continue its editions and cases.

For a customer agent, use [AGENT.md](AGENT.md) for the complete scoped tool workflow and [CUSTOMER_SETUP.md](CUSTOMER_SETUP.md) to bind an existing running Application through its original managed configuration history. The agent retains exact requests, full HTTP responses and complete downloads; the original workspace remains the writer. The same reviewer receiving course can continue through that transport.

## 1. Select the complete installed source

The host needs Node 22.16 or later and Python 3.11 or later. Managed installation uses Linux, `flock`, and a private local filesystem supporting locks, atomic file creation and fsync. The source-monitoring server, query engine and client use the Python and Node standard libraries. The customer's existing yente service supplies native screening.

From this repository's complete checkout, build one actual committed revision:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/tjlabs-stellar-merchant-workspace \
  --ref COMMIT_SHA \
  --selection source-monitoring \
  --out /absolute/private/releases/source-monitoring
~~~

Retain the returned archive path, SHA-256 and manifest. The selected package carries the complete relative source closure, command/export registrations, browser assets, native Python modules and this operating guide. Its only executable bin is the original `starforge` entry. The builder's saved output can resume the same commit and selection; another source revision or selection uses its own output.

A source-only installation can receive the archive without running package scripts:

~~~sh
npm install --ignore-scripts --offline --omit=optional /absolute/source-monitoring.tgz
npx --no-install starforge source
npx --no-install starforge registrations --source ndjson
npx --no-install starforge registrations --source source-monitoring-product
~~~

For an installation managed by the existing runtime workspace, prepare the selected original archive, install its chosen profile and inspect the result:

~~~sh
starforge runtime-install prepare \
  --dir /absolute/private/runtimes/source-monitoring \
  --archive /absolute/source-monitoring.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --operator

starforge runtime-install install \
  --dir /absolute/private/runtimes/source-monitoring

starforge runtime-install inspect \
  --dir /absolute/private/runtimes/source-monitoring --load --source
~~~

That profile selects the dependency-free monitoring workflow and the actual Node/Python/Linux host requirements. The package also retains the original NDJSON merchant workflow. A separately selected merchant installation can add its declared `--native --feature schema` profile when operating the native payment/schema adapters. The original installer determines those dependencies from this package; yente and its search backend remain the customer's selected native service installation.

The installer preserves the source archive, profile, dependency lock, operation history and original READY directory. It can adopt an already retained complete dependency graph through its existing `--adopt-existing` workflow. Follow [runtime installation](../../stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md) and [complete runtime transfer](../../stellar/scf-starforge-20261009/distribution/RUNTIME_TRANSFER.md) for the actual selected profile.

In a checkout, replace the `starforge` executable below with `node stellar/scf-starforge-20261009/distribution/cli.mjs`. In a prepared runtime, use its original command forwarder:

~~~sh
starforge runtime-install run \
  --dir /absolute/private/runtimes/source-monitoring -- source
~~~

## 2. Create or receive the customer's original workspace

Choose an existing private parent and a new workspace directory. Select the actual Python executable:

~~~sh
starforge source-monitoring --python /absolute/python3 \
  --workspace /absolute/private/customer-monitoring --create state
~~~

For a complete existing customer handover, import the supplied original ZIP into that newly created workspace:

~~~sh
starforge source-monitoring --python /absolute/python3 \
  --workspace /absolute/private/customer-monitoring import \
  --input /absolute/Customer_Monitoring_Workspace.zip
~~~

Import verifies the full source/build packets, original objects and manifest identities, reconstructs the original query snapshots and retains the case/review and native request histories. A newly received directory has the receiving host's own storage identity; Applications reviews that real identity.

For a new customer, start the console after creating the workspace:

~~~sh
starforge source-monitoring --python /absolute/python3 \
  --workspace /absolute/private/customer-monitoring serve \
  --startup-format json \
  --connection-file /absolute/private/customer-monitoring.connection \
  --port 0
~~~

The original process prints its JSON startup identity and writes a private one-line capability URL. Open that full URL on the same host. The connection is removed by the original close lifecycle. Select a new connection file path, and keep its private permissions.

`--startup-format json` supplies the authenticated `/api/launch` identity used by the client. Create/import before this managed startup. A legacy console can still open in the browser; the client uses the original JSON startup contract.

The console provides Overview, Source editions, Data updates, Change review, Counterparties, Native screening, Review cycles and Receiving. Its Dataset workspace link opens the existing native query interface. The original workspace lease controls the server's lifetime, and its mutex and revision checks control writes.

## 3. Open and reopen through Applications

Open the existing runtime workspace or create one in a private parent:

~~~sh
starforge runtime-workspace init \
  --workspace /absolute/private/runtime-workspace \
  --runtime-home /absolute/private/runtimes

starforge runtime-workspace attach \
  --workspace /absolute/private/runtime-workspace \
  --runtime /absolute/private/runtimes/source-monitoring \
  --label "Source monitoring"

starforge runtime-workspace serve \
  --workspace /absolute/private/runtime-workspace --port 0
~~~

Select the attached READY runtime and **Applications → New application → OpenSanctions source monitoring**. Select the existing customer workspace, actual Python executable, optional new private connection path, local port and the existing private environment JSON when a saved native service profile needs it.

**Review → Save → Connect → Review Start → Start → Open** retains the original application, release, source binding and operation IDs. Review reads the original NDJSON workspace identity and the complete monitoring source. Start verifies the original authenticated startup before presenting its URL.

The general JSON Lines and monitoring applications share the same native workspace resource. Use the existing application's **Stop** action before selecting another long-lived console for that same directory. After its actual stopped result, **Review Start → Start** opens the saved application again. Source editions and case edits do not change the immutable source binding; changing Python, the data directory identity, installed source or selected private environment goes through the original review.

The headless equivalents remain `runtime-workspace application-review`, `application-save`, `application-connect`, `application-start-review`, `application-start`, `application-stop` and `application-recover`. They consume their current original request files and revisions, as documented in [Applications](../../stellar/scf-starforge-20261009/distribution/runtime-workspace/APPLICATIONS.md) and [the monitoring provider](../../stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/opensanctions/MANAGED_APPLICATIONS.md).

## 4. Connect an operator or agent to that console

The client accepts either the original private one-line connection file or the saved Applications `application-url.json` for the current `source-monitoring` operation. It rereads the selected file and authenticates the current native launch on each operation. It reports the actual workspace, source and Python binding without printing the capability.

~~~sh
starforge source-monitoring-client \
  --connection /absolute/private/customer-monitoring.connection inspect

starforge source-monitoring-client \
  --connection /absolute/private/customer-monitoring.connection \
  get state --response-out /absolute/private/monitoring-state.json
~~~

Use the same connection path across ordinary native stop/reopen. An Applications URL file belongs to its particular operation; select the current operation's file after a later start. A client instance keeps its reviewed workspace and binding. An intentional source or workspace change requires a new client selected for that change.

`--expected-workspace` and `--expected-binding` can require the values from the reviewed native launch. HTTP calls remain on the original loopback origin, with the selected private capability. The client follows no redirects and automatically retries no write.

All native JSON replies retain their exact bytes and HTTP metadata in the SDK. CLI output carries the full original JSON; `--response-out` saves those response bytes. File destinations are created privately and atomically. A matching existing output is reused; a different output produces a conflict. Select a new name for a new edition or response.

### Typed Node interface

~~~js
import { MonitoringClient, writeReply } from
  '@tokenjunkielabs/starforge-merchant/source-monitoring/client';

const monitor = new MonitoringClient({
  connectionFile: '/absolute/private/customer-monitoring.connection',
  timeoutMs: 120000
});

try {
  const identity = await monitor.inspect();
  const state = await monitor.get('state');
  await writeReply('/absolute/private/monitoring-state.json', state);

  // Use an actual retained edition ID selected from that state.
  const editionId = process.env.SELECTED_EDITION_ID;
  const page = await monitor.get('entities', {
    scope: editionId, offset: 0, limit: 100
  });
  await writeReply('/absolute/private/selected-entities.json', page);

  const received = await monitor.download('workspace', {
    output: '/absolute/private/Customer_Monitoring_Workspace.zip'
  });
  console.log({ identity, receiving: received });
} finally {
  await monitor.close();
}
~~~

`NativeReply` contains `json`, `raw`, `status`, `headers` and `sha256`. The TypeScript declaration is packaged beside the client. Supply raw UTF-8 JSON text or bytes when an input contains integer lexemes beyond JavaScript's safe integer range; that form is validated and forwarded unchanged. Original FtM, statement and provider files are streamed as bytes.

## 5. Receive original sources and the complete change chain

Supply either an original published metadata URL through the console or exact retained metadata and flat FtM files. The original metadata governs the declared entities resource, published SHA-1 and byte count. Record evaluation/customer entitlement on the edition.

A client edition selection file contains:

~~~json
{
  "metadataFile": "index.json",
  "entitiesFile": "entities.ftm.json",
  "metadataUrl": "ORIGINAL_PUBLISHED_METADATA_URL",
  "label": "Selected source edition",
  "entitlement": {
    "kind": "evaluation",
    "note": "Actual selected source and use"
  }
}
~~~

~~~sh
starforge source-monitoring-client --connection /absolute/private/customer-monitoring.connection \
  edition --input /absolute/originals/edition-selection.json \
  --response-out /absolute/private/received-edition.json
~~~

File paths in composite selections resolve relative to that JSON file. Keep the original URLs and data-use choice. Flat FtM preserves original IDs, schema, property string arrays, referents and any source observation fields. The client accepts the uncompressed originals; the complete customer ZIP is imported with the archive command.

For customer counterparties, use `portfolio --input` with `{file,key,label}`. The file contains the customer's original flat FtM records and the stable portfolio key preserves that namespace across editions.

For statements, use `statements --input` with `{file,edition,sourceUrl,name,complete,scope}`. Only declare `complete:true` for an actual complete export of that explicit population. The native parser preserves ordered CSV headers, original cells, entity and canonical IDs, source datasets, observations and physical line ranges.

For an update, select the complete original index and every required nonempty delta:

~~~json
{
  "before": "RETAINED_BEFORE_EDITION_ID",
  "after": "RETAINED_AFTER_EDITION_ID",
  "indexFile": "deltas/index.json",
  "indexUrl": "ORIGINAL_DELTA_INDEX_URL",
  "deltas": [
    {
      "version": "EXACT_PUBLISHED_VERSION",
      "file": "deltas/EXACT_PUBLISHED_VERSION.json",
      "sourceUrl": "ORIGINAL_VERSION_URL"
    }
  ]
}
~~~

The native `update-plan` operation identifies the actual required versions. Add every required entry to the selection; the single array entry above illustrates its field shape. `update --input` uploads those exact files and passes the ordered native `[{version,object}]` list. The application validates the complete chain, preserves each original ADD/MOD/DEL and compares the result with the independently retained complete target.

The provider publishes the last 100 nonempty changing editions. A full edition can have newer observation metadata without another delta. The original application separately retains the publisher's exact content projection and full-record differences. Its identifier interpretation uses current IDs and all referents after processing the complete chain.

Use `post compare` with the actual `{before,after}` IDs, then read `changes` and `impacts` with the returned comparison ID. Selection and case decisions use the original current revision and reviewer/reason fields.

## 6. Keep source review and customer decisions together

The original application distinguishes identity replacement, ambiguous referents, source absence, added/changed entities, removed statements and observation metadata. Provider event names and their original rows remain alongside those classifications.

A customer case holds independent `resolution` and `relevance` decisions:

| Field | Native values |
| --- | --- |
| resolution | same_entity, different_entity, undecided |
| relevance | in_scope, out_of_scope, undecided |
| case identity | Original case_id; reuse it for the same customer counterparty history |
| update guard | expected = current case revision |
| provenance | portfolio_id, counterparty_id, candidate_id, edition_id |
| decision | reviewer, reason, optional original match_request and monitoring policy |

Read the current case first. Save through `post case --input` with those exact fields. The original service verifies portfolio/counterparty identity and any referenced candidate in the actual received match response. It retains the entire prior decision history.

Review actual linked Sanction entities and authority URLs for designation changes. Source absence is scoped to its selected data edition. A counterparty can retain another relevant designation. The native monitoring policy routes identity and relevance work separately and preserves decisions already reviewed against the same current edition.

The original dataset query remains:

~~~json
{
  "build": "ACTUAL_NATIVE_BUILD_ID",
  "query": {"where_id":"ACTUAL_SOURCE_ID","fields":"id,schema","limit":"5"}
}
~~~

Pass that file to `post query --input`. The client forwards to the original `/api/query`; all other named operations use the existing monitoring extension.

### Saved review cycles

Use **Review cycles** to freeze a complete source-change population, assign case reviews, retain original evidence, record reviewer completion and obtain a versioned supervisor report. The cycle uses the same case decisions, immutable objects and complete receiving archive. Follow [Saved source review cycles](REVIEW_CYCLES.md) for the full operator, retry, reporting and independent receiving workflow.

## 7. Prepare native screening and receive its actual outcome

Save the customer's actual endpoint, dataset, authentication environment reference and chosen native algorithm in **Native screening** or through `post profile`. The original supported profile fields are `label,endpoint,dataset,auth,parameters,config,weights,sourceNote`. Authentication is explicit `none`, `Bearer` or `ApiKey`; the hosted OpenSanctions endpoint requires its actual ApiKey reference.

Prepare the original match request with:

~~~json
{
  "profile": "RETAINED_NATIVE_PROFILE_ID",
  "kind": "match",
  "portfolio": "RETAINED_PORTFOLIO_ID",
  "entity_ids": ["ORIGINAL_COUNTERPARTY_ID"],
  "edition": "SELECTED_EDITION_ID"
}
~~~

Use `post prepare --input` and retain the returned request ID, revision and exact request object. Read it with `get request --params` using `{"id":"ACTUAL_REQUEST_ID"}`. Repeated preparation of the same source/profile selection reuses its request. The native `refresh_key` is an explicit later screening/refresh reason.

If dispatching from this configured server, use `post dispatch` with its actual `{id,expected}`. The original server resolves its environment reference before reserving DISPATCHING, disables provider redirects, retains request/response bytes and records the actual native HTTP or uncertain transport state.

When an existing worker already owns that request, receive its complete response file, original HTTP status, allowed headers and source note with `response --input`:

~~~json
{
  "id": "EXISTING_NATIVE_REQUEST_ID",
  "file": "original-yente-response.json",
  "status": 200,
  "headers": {"Content-Type":"application/json"},
  "sourceNote": "Actual original worker and response provenance",
  "expected": "CURRENT_NATIVE_REQUEST_REVISION"
}
~~~

Use the worker's actual status and original file. The server validates match correlation keys, candidates, scores and explanations against the prepared request. An identical response reuses the original outcome. Different already-received bytes conflict. Native errors and invalid responses stay attached to the same operation.

A client timeout or lost connection does not authorize another native provider dispatch. Read the original request and its retained state first. An uncertain request can receive the existing worker's actual result through the same intake.

## 8. Deliver, reopen and continue

Download the complete customer workspace from **Receiving** or:

~~~sh
starforge source-monitoring-client --connection /absolute/private/customer-monitoring.connection \
  export --out /absolute/private/Customer_Monitoring_Workspace.zip
~~~

The full ZIP includes original NDJSON build packets, metadata and delta files, immutable objects, native service profiles and requests/responses, selected editions, comparisons, portfolios, case revisions, review history and immutable saved review-cycle events. The client streams it to a private file and returns the complete byte count and SHA-256.

Deliver the selected source release and its manifest/installation guide with the full customer workspace ZIP and its actual identity. Include the actual selected Python/runtime, application/workspace paths, service profile/environment-reference names, current request/case identities, original data entitlement and the customer operator's receiving instructions. Keep any live credential values in their existing credential route.

On the receiving host, install the same source or an explicitly reviewed compatible release, create a fresh private workspace, import the complete ZIP, and open it through the original JSON startup or Applications. Read the retained state, source edition and case history; open the original response and native source query. Export the received workspace and stop/reopen that same saved application to complete the handover.

An ordinary source/client close does not delete the server's operating state. `MonitoringClient.close()` closes its own in-flight connections and waits for its own operations. Applications **Stop** owns the native server process. The complete original native receiving continues through that application's existing request, lease and revision semantics.

### Operational limits and exact files

| Boundary | Implemented receiving contract |
| --- | --- |
| Original object upload | Complete regular file up to 256 MiB; original byte hash and native object ID agree |
| Customer archive import/export | Complete original ZIP up to 1 GiB through this client |
| Native JSON request | Original JSON object up to 24 MiB |
| Native provider response intake | Original service limit of 16 MiB |
| Client JSON response | Complete response up to 128 MiB; raw bytes preserved |
| Selected input | Stable regular file; changed source bytes interrupt receiving |
| Output | New private file or exact existing byte-identical file |
| Connection | Original private loopback capability and authenticated native launch |
| Repeated operation | Original object/request/revision semantics; no automatic client retry |

## Source contracts

- [Original monitoring engine and workflow](../../stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/opensanctions/README.md)
- [Native source contracts and selected publisher revisions](../../stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/opensanctions/SOURCE_CONTRACT.json)
- [Original Applications provider and lifecycle](../../stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/opensanctions/MANAGED_APPLICATIONS.md)
- [Full NDJSON customer receiving](../../stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/README.md)
- [Provider monitoring semantics](https://www.opensanctions.org/docs/monitoring/)
- [Canonical IDs and referents](https://www.opensanctions.org/docs/identifiers/)
- [Original statement lineage](https://www.opensanctions.org/docs/statements/)
- [Customer data licensing and evaluation](https://www.opensanctions.org/licensing/)

The product retains original source observations, provider outcomes and customer review choices with their respective identities. The operating workspace is the complete record the next customer operator receives.

## Independent assigned reviewers

Use **Reviewer exchange** after saving a review cycle and assigning its selected cases. Issue the full editable reviewer HTML and exact issue JSON to the named colleague. They can inspect the original sources, keep unfinished work, save attributed named editions and return the complete file. Receive that exact JSON or HTML in the original workspace, compare the issued/current/returned values, and explicitly choose apply or keep for every case. Identity and relevance remain separate original case decisions.

The complete operating, command and independent receiving instructions are in [REVIEWER_EXCHANGE.md](REVIEWER_EXCHANGE.md). Original issued JSON, issued HTML and received files remain downloadable after full workspace receiving; saved adoption comparisons keep their original reviewed basis after later legitimate case work. The native archive includes the additive exchange events and every original file in its existing object collection. Older complete archives remain readable.

The typed client exposes `review-exchanges`, `review-exchange`, `review-exchange-request` and `review-exchange-compare`; mutations are `review-exchange-issue`, `review-exchange-return-preview` and `review-exchange-command`. `download review-exchange --id ID --role issued_json|issued_html|returned_file --out FILE [--sha256 SHA]` saves the exact selected original. All reviewer operations use the existing physical workspace binding. Full reviewer files are limited to 256 MiB including embedded bytes; JSON commands remain compact and retain the original 24 MiB request limit. Detail responses include complete review metadata and file descriptors, with an explicit 128 MiB limit; full original documents use the file download route.

The complementary [native Workspace archive guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/opensanctions/REVIEW_WORKSPACE_ARCHIVES.md) documents complete native ZIP export, scoped snapshot and independent scratch inspection. Those ZIPs remain original evidence; assigned-reviewer adoption uses the attributed reviewer JSON or HTML and its explicit current-case comparison.
