# OpenSearch authoring through the merchant MCP operator

The maintained merchant operator opens host-selected OpenSearch workspaces and exposes their existing query drafts, actual native captures, relevance judgments, comparisons, merchant packages, managed releases and customer exports to agents. The browser workspace and MCP tools share the same SQLite records, revision history and request journal.

An agent can reopen a captured result, review its native scope, edit a complete evaluation set, evaluate competing query definitions, select an evaluated variant and prepare its original paid merchant package. Generated client, OpenAPI, native result and customer report bytes are available as pinned file reads.

## Host configuration

Set the optional connection reference in the existing merchant operator configuration:

~~~json
{
  "opensearchWorkspaceConnection": "./opensearch-workspaces.json"
}
~~~

The referenced connection file declares existing host-owned directories and source declarations:

~~~json
{
  "schema": "stellar-forge.opensearch-workspace-connection.v1",
  "workspaces": {
    "catalog": {
      "label": "Product search",
      "directory": "./workspaces/product-search",
      "sourceFile": "./sources/opensearch-source.json",
      "planFile": "./sources/opensearch-merchant-plan.json",
      "runtime": {"port": 0}
    }
  }
}
~~~

Paths resolve relative to the connection file. Create each workspace directory with mode 0700 and the connection file with mode 0600 under the operator user. The source and optional plan must be existing regular JSON files. There are 1–32 configured aliases, and each original workspace directory has one alias.

The source file uses the original `stellar-forge.opensearch-source.v1` declaration. Its endpoint and authentication fields contain environment variable names. Credentials stay in the host environment. The maintained host may pass its own environment object through `new MerchantOpenSearchWorkspaces(config, {environment})`; the module passes it to the original source without changing the process environment. Arguments to these MCP tools select an alias and original record IDs; they do not select filesystem paths or executable modules.

The optional per-alias `runtime` selects the original managed seller port and facilitator configuration. It accepts `port` (0–65535, default 0), `facilitator` (HTTP(S) URL without credentials, query or fragment), and `allowLocalFacilitator` (boolean). The host supplies these settings when an agent stages a package.

Reading configuration only resolves and checks the declared host files. `merchant_opensearch_open` opens the original database and source declaration. Provider connection begins when an agent explicitly inspects, captures or evaluates a saved definition, or starts or restarts its managed merchant.

The native workspace limits an evaluation set to 768 KiB and each draft query, input or merchant plan to 256 KiB. Configure the maintained MCP transport to accept the full definition envelope when using large sets; a two MiB host request limit accommodates these original limits and protocol overhead. Native relevance expands stored definitions into its separately bounded native request.

## Tool map

Every tool below uses the prefix `merchant_opensearch_`. The table groups the complete workflow by the records it advances.

| Tools | Work performed |
| --- | --- |
| `status`, `open`, `close` | Discover aliases, inspect record counts and retain one original workspace handle. |
| `catalog`, `list`, `history` | Read named query templates, native metric controls and complete saved-record histories. |
| `draft`, `save`, `validate` | Reopen an exact draft revision, save a complete query/input/plan and validate it offline. |
| `inspect`, `capture` | Run the original native projection reader or PIT query and retain the request outcome. |
| `operation`, `edition`, `hits`, `compare` | Recover original requests and examine immutable native results and their differences. |
| `relevance_set`, `relevance_save`, `relevance_seed`, `relevance_judge` | Import, version and judge actual document identities with source provenance. |
| `relevance_evaluate`, `relevance_case` | Run the original native ranking evaluation and review its returned documents, failures and strict windows. |
| `relevance_promote`, `prepare`, `package` | Select an evaluated query and prepare the original merchant, generated client and file manifest. |
| `read`, `read_release` | Transfer exact JSON, HTML, CSV or prepared package bytes using shared retained file reads. |
| `deployment_status`, `deployment_compare`, `deployment_open` | Inspect original release selection, compare retained releases and open the maintained deployment controller. |
| `deployment_stage`, `deployment_activate`, `deployment_rollback` | Stage verified prepared packages and select releases using the original generation checks. |
| `deployment_start`, `deployment_stop`, `deployment_restart` | Run and drain the actual seller through its original controller and instance identity. |
| `deployment_generate_client`, `deployment_clients`, `deployment_client`, `deployment_manifest` | Generate from the actual owned seller and inspect retained customer exports, provenance and file manifests. |
| `deployment_file`, `deployment_file_release`, `deployment_archive`, `deployment_handover` | Transfer original client files or complete archives and generate the current deployment handover. |

## Query and merchant workflow

1. Call `status` and `open` with the desired alias. Use `catalog` for its complete original query declarations, payment-plan template and native metric catalog.
2. Save a complete draft with `requestId`, `title`, `queryName`, `query`, `input` and `plan`. The returned original operation identifies the saved `draftId` and `revision`. Updates also supply `draftId` and its current `expectedRevision`.
3. Call `validate` with `kind:"draft"`, the saved `id` and `revision`. This uses the original parameter and merchant-plan validators. The validated draft must be the current head for execution.
4. Call `inspect` or `capture` with a new original `requestId`, `draftId` and `expectedRevision`. Capture uses the same native PIT reader, declared projection, source checks, limits and integer representation as the browser.
5. Reopen the returned query edition. `hits` pages its actual retained documents. `read` with `kind:"query-result"` transfers the original result JSON whose SHA-256 is stored in that edition.
6. Call `prepare` with the exact chosen draft revision and an original request ID. `package` lists the original file names and SHA-256 values. Read individual generated client, OpenAPI or source files with `kind:"package-file"`.

Prepared packages retain their original IDs and source digests. Continue deployment, status, drain, restart, upgrade and rollback through the maintained deployment authority and its original SF82 release store. The OpenSearch authoring module returns the prepared package and customer files needed for that handoff.

## Relevance workflow

A complete evaluation set contains a native metric object, frozen query variants and input cases with document judgments. The original browser and MCP use the same schema and validators. A set import is a `relevance_save` call with the parsed exported set as `set`; subsequent changes include `setId` and the current `expectedRevision`.

Use `relevance_seed` to obtain a case from an actual retained query edition. Its provenance contains the original query edition, input and result hash. Each selected native `[_index,_id]` initially has `rating:null`. An agent can add those documents to a full evaluation set, define competing original query declarations and save it.

`relevance_set` returns the selected saved revision and its frozen variants. Supply `caseId` to page one case’s judgment documents. `relevance_judge` applies an explicit judgment update:

~~~json
{
  "workspace": "catalog",
  "requestId": "grade-products-20261012",
  "setId": "ORIGINAL_SET_ID",
  "expectedRevision": 3,
  "caseId": "pump-search",
  "mode": "merge",
  "judgments": [
    {
      "_index": "products",
      "_id": "pump-104",
      "rating": 2,
      "note": "Matches the requested flow and fitting."
    }
  ]
}
~~~

The merge key is the exact native index and document ID. Merge retains unmentioned judgments, original hit provenance and existing notes unless a new note is supplied. Replace selects exactly the supplied document identities for that case while retaining matching original hit provenance. An empty replacement clears that case’s judgment list. An explicit null removes a grade while keeping the document unjudged; grade zero remains a real judgment. The original native metric validator enforces metric-specific grade limits.

The judgment update is saved as one normal full-set revision in the original journal. Its exact patch is retained beside that complete save request, so reusing the same `requestId` returns the same original operation even if the set has since advanced. A reused ID with different input is rejected.

Validate the saved set with `kind:"relevance-set"`. Evaluate with `relevance_evaluate`, its exact `setId`, `expectedRevision` and a new `requestId`. The actual native engine runs the original metric across the declared variants and cases. Its shared PIT and strict capture windows retain concrete indices, effective ranking sort, cluster identity, original hit order and native failures.

`relevance_case` presents a retained variant/case in either `native` or `strict` view. Native rows preserve each original `{hit,rating}` entry, including null ratings. Exact integer path metadata refers to its original native response pointer. Strict rows preserve the independently captured original window and its path metadata. Coverage reports the original completion state and ordered-window correspondence.

A native aggregate can cover successful native cases even when another case failed. The edition retains native success IDs, native failure IDs, strict completion counts and the original aggregate. Customer reports and comparisons carry these scopes explicitly.

Promote with `relevance_promote`, choosing the exact `editionId`, `variantId` and `caseId`. The original workspace creates a merchant draft from that evaluated query, input and plan, retaining the evaluation edition and result hash in the request. Continue with `prepare` on the returned draft.

## Comparisons and pagination

Query comparison uses exact `[_index,_id]` identity. Source-content changes are separate from business ranking changes; the transient PIT tie breaker is excluded from the content comparison. Added and removed rows mean entry into or exit from the retained result sets. Query changes, different clusters or truncated captures remain visible in the original comparison scope.

For `compare` with `kind:"query"`, choose one of `added`, `removed`, `changed` or `rankingChanged`. For `kind:"relevance"`, the first page lists variant comparisons and their scope. Supply `variantId` to page case-level score and coverage changes. Metric, inputs, supplied judgments, native cluster, concrete indices and successful-case denominators are retained when assessing a score difference.

`list` uses a workspace-bound opaque keyset cursor over the full original tables. Continue `nextCursor` until null. Operations use their stable original creation order and include records older than the browser’s recent feed. Drafts and relevance sets list current heads by update time; an edit can move a head ahead of an existing cursor. `history` pages immutable revisions with `nextBeforeRevision`. Query hits and immutable edition cases use offsets and `nextOffset`.

## Original byte transfer and recovery

`read` supports these selectors:

| Kind | Original bytes |
| --- | --- |
| `draft`, `relevance-set` | Exact selected saved revision; `revision` is required. |
| `operation` | Current original request/outcome JSON, including its saved definition. |
| `query-edition`, `query-result`, `query-csv` | Original query edition, checksum-pinned native result or original CSV export. |
| `relevance-edition`, `relevance-native` | Original saved evaluation edition or exact native result JSON. |
| `relevance-report-json`, `relevance-report-html`, `relevance-csv` | Original customer report and case comparison exports. |
| `package-file` | A name from the original prepared package manifest; `file` is required. |

The first read returns `readId`, `file.name`, byte count, `file.sha256`, base64 `data` and `nextOffset`. Subsequent chunks include the same `readId` and `expectedSha256`. Maximum chunk size is 196,608 bytes. Decode chunks as bytes and concatenate them before decoding UTF-8, then verify SHA-256 against the returned file identity.

The shared retained reader pins original loaded bytes for the whole transfer. It releases completed reads, expires idle reads after two minutes and allows an agent to release an unfinished transfer explicitly. After operator restart or expiry, reopen an immutable export with its original selector, expected hash and offset. A changed mutable operation snapshot produces a hash conflict, letting the client reopen its current state deliberately.

Original unsafe native integer tokens are retained as decimal text with `numberEncoding:"unsafe-integer-decimal-text"` and `exactIntegerPaths`. Preserve these together. Native exports are transferred from the original stored JSON bytes.

For uncertain execution outcomes, call `operation` with the original request ID or resubmit the same mutation with identical input. The original journal returns completed work without another provider call. A process that ended before retaining its result is marked interrupted by the original workspace; its exact saved request remains available for an explicit new operation.

Closing one alias waits for accepted work and releases its retained file handles. Closing the maintained operator waits for all its accepted OpenSearch work before closing the original databases.

## Managed deployment and customer delivery

The 17 deployment tools compose the original [OpenSearch deployment workspace](../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/workspace/deployment.mjs), [SF82 release manager](../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs), and [retained customer exporter](./client-exports.mjs). The same merchant operator now exposes 43 OpenSearch tools across authoring, native evaluation, deployment and customer delivery.

Each alias uses the release store at its original workspace's `deployment` directory. Its customer exports live beside that store in `deployment.clients`. The source workspace, deployment store and customer directory travel together when transferring an installation. Typed deployment tools always resolve the selected alias's original store. The maintained host's optional `--release-store` configures its general release tools separately; a multi-alias host can keep that parent store distinct. Configure it to an alias's exact store only when intentionally composing the general tools with that installation.

### Prepare, stage and select

Start with the original `prepare` operation and read `package` to obtain its completed package ID and exact file manifest. Staging performs the original file, source, plan and binding checks before retaining a release:

~~~json
{
  "workspace": "catalog",
  "requestId": "catalog-stage-v1",
  "packageId": "ORIGINAL_PREPARED_PACKAGE_ID",
  "releaseId": "catalog-v1",
  "label": "Customer catalog search"
}
~~~

Send this to `merchant_opensearch_deployment_stage`. The native action uses the alias's host runtime settings and records `deployment-stage` in the original workspace journal. A completed outcome includes the original release digest, prepared package identity and selection status.

Use `deployment_compare` with `to` and optional `from` to inspect the retained query, payment, customer contract and runtime differences. Read fresh `deployment_status` and pass its `state.generation` to `deployment_activate`:

~~~json
{
  "workspace": "catalog",
  "requestId": "catalog-select-v1",
  "releaseId": "catalog-v1",
  "expectedGeneration": 0,
  "reason": "Select the reviewed customer catalog release"
}
~~~

The example generation is a placeholder for the freshly observed value. Selection and runtime ownership are separate parts of the original release manager. Activation updates selection; `deployment_start` starts that selected release using its current generation.

### Run, upgrade, drain and roll back

Use `deployment_start` with `requestId` and `expectedGeneration`. Retain the resulting `console.instanceId` and current selection. `deployment_status` reports the original release state, runtime observation, current generation, owned instance and readiness information.

For an upgrade, stage a new prepared package, compare it with the active release, activate it at the current generation, then call `deployment_restart` with the current owned `instanceId` and newly observed generation. The original controller drains the owned seller and runs the selected retained source.

`deployment_rollback` selects the original previous release, or the explicit retained release in `to`. It also requires the current `expectedGeneration`. Use `deployment_restart` with the current owned instance to run the rolled-back selection. `deployment_stop` gracefully stops only the exact instance identified in its request.

Every mutation includes a unique original workspace `requestId`. After a lost response, repeat the identical call or recover it through `merchant_opensearch_operation`. The adapter waits for the original accepted deployment task to finish before returning its retained outcome. A completed operation's embedded status describes that operation; use `deployment_status` for the current selection and runtime. Reusing an ID for changed inputs is rejected by the original journal. A browser stage request that omitted default runtime fields can be recovered when its effective runtime matches the current host selection.

Closing the OpenSearch alias drains its accepted MCP work, closes retained readers and closes the original deployment controller. That controller gracefully stops the seller it owns. Retained releases, generations, original journal entries and customer exports reopen from their saved directories.

### Generate from the actual owned seller

`deployment_generate_client` reads the owned seller's real health, offers and OpenAPI through the original customer exporter:

~~~json
{
  "workspace": "catalog",
  "requestId": "catalog-client-customer-a",
  "exportId": "customer-a-catalog-v1",
  "instanceId": "ORIGINAL_RUNNING_SELLER_INSTANCE_ID"
}
~~~

`exportId` names the new customer export. Its completion manifest binds the original release ID, release digest, seller instance and file bytes. Use the original request ID to recover generation after a disconnected call.

The list and file tools read `deployment.clients` directly through the maintained `MerchantClientExports` authority, so retained customer delivery continues after the seller stops. `deployment_clients` pages by the original `nextAfter` export cursor. `deployment_client` returns inspected completion and offer information. `deployment_manifest` returns the original manifest and `manifestFile.sha256`.

### Transfer original customer files and archives

For an individual file, select its exact name and digest from the original manifest:

~~~json
{
  "workspace": "catalog",
  "exportId": "customer-a-catalog-v1",
  "file": "seller-client.mjs",
  "expectedManifestSha256": "ORIGINAL_COMPLETION_MANIFEST_SHA256",
  "expectedSha256": "ORIGINAL_FILE_SHA256",
  "offset": 0,
  "limit": 65536
}
~~~

Send this to `merchant_opensearch_deployment_file`. Continue using its original `readId`, `nextOffset`, manifest digest and file digest. Chunks are base64; concatenate their decoded bytes, then verify the complete SHA-256. `deployment_file_release` explicitly releases an unfinished customer-file read using the same export ID and original read ID. After expiry or an operator restart, resume at the saved offset with the original expected hashes and a new read handle.

`deployment_archive` accepts `exportId` and `expectedManifestSha256`. It calls the original release-client tar.gz encoder, which verifies every file against that reviewed completion manifest. The archive transfer uses the existing shared snapshot reader; its first chunk reports the archive's own SHA-256. Continue with that `expectedSha256`, original `readId` and `nextOffset`. Use the ordinary `merchant_opensearch_read_release` to release an unfinished archive read.

The archive encoder reads original customer files without opening a seller controller. Its generated byte stream is pinned for the transfer, and a reopened transfer must match the expected archive digest. Individual files retain their original independent file identities. All customer read methods preserve the original manifest and completion provenance.

### Current deployment handover

`deployment_handover` returns the original Markdown handover for a retained `releaseId`, together with its filename, byte count and SHA-256. It contains the release digest, source/plan/execution digests, required environment names, current selection/runtime, customer commands and retained query contracts. Its `snapshot` value is `CURRENT_DEPLOYMENT`: the original document includes the current status and a generation timestamp.

Controller authentication remains in the owning host. MCP exposes release, instance and generation metadata for operating the original deployment and transferring its customer files.

### Receiving the completed native deployment through MCP

The [managed MCP receiving workflow](../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/receiving/mcp-managed-journey.mjs) uses the same original connection and completed native deployment journal:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/receiving/mcp-managed-journey.mjs \
  --connection /private/operator/opensearch-workspaces.json \
  --workspace catalog \
  --directory /private/receiving/catalog-managed-mcp
~~~

Run it after the original native deployment owner has completed staging, activation, start, upgrade/restart, rollback and actual-seller client generation. It discovers those original completed request IDs, recovers their typed MCP outcomes, compares retained releases, transfers all original customer files and the original archive, checks archive members against those files, and resumes pinned transfers after closing and reopening the workspace. The private output directory receives the original customer artifacts and a complete receiving record.

## Completed native example

The repository includes the completed original native run and an exportable customer report:

- [Native relevance run and reusable saved evaluation set](../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/receiving/relevance-native-run.json)
- [Customer relevance report](../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/receiving/relevance-customer-report.html)
- [Original receiving workflow](../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/receiving/README.md)
- [Native protocol and metric behavior](../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/relevance/NATIVE_PROTOCOL.md)

The example uses seven real public flight records retained from OpenSearch 3.9.0. Its saved engineering criterion grades flights priced at or below the retained cohort’s lower median, 253.21006490337038. Native precision at three returned results was 1.0 for lowest-price-first and 0.0 for highest-price-first. Both variant/case pairs completed on the same snapshot, with all six returned hits judged.

The receiving workflow retained the original native result hash, saved set, criterion and original documents; replayed the same request; exported customer artifacts; promoted the selected variant; prepared the original merchant and generated client; and reopened the same records after closing the workspace. The sample’s source and judgment criterion remain in the saved run so operators can replace it with their own actual customer judgments.

## Maintained MCP receiving

The [complete MCP receiving record](../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/receiving/mcp-native-run.json) joins the original retained-workspace flow with the maintained host and transport checks. It covers exact native request recovery, full journal and immutable-history pagination, judgment revision updates and replay, original package/client recovery, pinned byte exports and workspace reopen. The completed initial merchant subprocess run advertised 389 tools including the original 26 OpenSearch authoring tools. Both default and configured HTTP/stdio limits were exercised, including oversized input recovery.
