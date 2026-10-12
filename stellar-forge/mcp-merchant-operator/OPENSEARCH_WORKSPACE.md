# OpenSearch authoring through the merchant MCP operator

The maintained merchant operator opens host-selected OpenSearch workspaces and exposes their existing query drafts, actual native captures, relevance judgments, comparisons and merchant packages to agents. The browser workspace and MCP tools share the same SQLite records, revision history and request journal.

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
      "planFile": "./sources/opensearch-merchant-plan.json"
    }
  }
}
~~~

Paths resolve relative to the connection file. Create each workspace directory with mode 0700 and the connection file with mode 0600 under the operator user. The source and optional plan must be existing regular JSON files. There are 1–32 configured aliases, and each original workspace directory has one alias.

The source file uses the original `stellar-forge.opensearch-source.v1` declaration. Its endpoint and authentication fields contain environment variable names. Credentials stay in the host environment. Arguments to these MCP tools select an alias and original record IDs; they do not select filesystem paths or executable modules.

Reading configuration only resolves and checks the declared host files. `merchant_opensearch_open` opens the original database and source declaration. Provider connection begins when an agent explicitly inspects, captures or evaluates a saved definition.

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

The merge key is the exact native index and document ID. Merge retains unmentioned judgments, original hit provenance and existing notes unless a new note is supplied. Replace selects exactly the supplied document identities for that case while retaining matching original hit provenance. An explicit null removes a grade while keeping the document unjudged; grade zero remains a real judgment. The original native metric validator enforces metric-specific grade limits.

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

## Completed native example

The repository includes the completed original native run and an exportable customer report:

- [Native relevance run and reusable saved evaluation set](../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/receiving/relevance-native-run.json)
- [Customer relevance report](../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/receiving/relevance-customer-report.html)
- [Original receiving workflow](../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/receiving/README.md)
- [Native protocol and metric behavior](../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/relevance/NATIVE_PROTOCOL.md)

The example uses seven real public flight records retained from OpenSearch 3.9.0. Its saved engineering criterion grades flights priced at or below the retained cohort’s lower median, 253.21006490337038. Native precision at three returned results was 1.0 for lowest-price-first and 0.0 for highest-price-first. Both variant/case pairs completed on the same snapshot, with all six returned hits judged.

The receiving workflow retained the original native result hash, saved set, criterion and original documents; replayed the same request; exported customer artifacts; promoted the selected variant; prepared the original merchant and generated client; and reopened the same records after closing the workspace. The sample’s source and judgment criterion remain in the saved run so operators can replace it with their own actual customer judgments.
