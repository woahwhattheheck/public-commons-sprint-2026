# Paired dataset reconciliation

This selected product compares two reviewed immutable editions in the existing
DuckDB customer workspace. It preserves every source row, exact native values,
duplicate multiplicities, explicit exclusions, engineering decisions and the
complete report history. Its complete handover includes original source files,
all native query exports and a full customer warehouse that can be reopened
independently.

Use **Dataset reconciliation** from the original Dataset workspace. The same
Python service, warehouse, capability and workspace identity own the browser
and the existing agent tools. The installed `duckdb-agent` entry and
`stellar_forge_buyer.duckdb_cli reconcile` command use those original methods.

The `paired-reconciliation` selection retains the original Frictionless intake,
local dataset customer workflow, Python runtime, merchant and buyer MCP
interfaces, managed Applications, semantic dataset receiving and Parquet
decoder. Existing customer editions can be reconciled directly. Importing a
new source continues through the original reviewed delivery workflow.

## Build and install this product

Use Linux, Node.js 22.16 or later, Python 3.11 or later, Git, npm and util-linux
`flock`. Operating directories must support file locks, atomic publication and
fsync. Keep customer data and private configuration outside the source checkout.

From a checkout of this repository, build the committed product selection:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo . --ref HEAD --selection paired-reconciliation \
  --out /absolute/private/packages/paired-reconciliation
~~~

Keep the returned original archive, SHA-256 and manifest together. The builder
records the resolved Git commit and packages the selected registrations,
complete source dependencies, browser assets, Python customer, Parquet decoder
and this guide. Its existing interrupted-build recovery uses that same source
selection and output directory.

Install the source package into a new application directory:

~~~sh
npm install --ignore-scripts --offline --omit=optional /absolute/path/to/package.tgz
npx --no-install starforge doctor
~~~

The installed command is `starforge`. Before installation, use the original
source dispatcher in its place:

~~~sh
node stellar/scf-starforge-20261009/distribution/cli.mjs
~~~

Prepare the declared merchant/MCP dependencies through the existing installer.
Replace the archive and hash with the actual builder result:

~~~sh
starforge runtime-install prepare \
  --dir /absolute/private/runtimes/paired-reconciliation \
  --archive /absolute/path/to/package.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

starforge runtime-install install \
  --dir /absolute/private/runtimes/paired-reconciliation

starforge runtime-install run \
  --dir /absolute/private/runtimes/paired-reconciliation -- source
~~~

The installer retains the selected archive, exact dependencies, original
operation and recovery state. Use the
[original runtime installation guide](../../stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md)
when transferring dependencies or continuing an interrupted installation.

### Open Applications and install the Python customer

Create a new runtime workspace, or use an existing one:

~~~sh
starforge runtime-workspace init \
  --workspace /absolute/private/runtime-workspace

starforge runtime-workspace attach \
  --workspace /absolute/private/runtime-workspace \
  --runtime /absolute/private/runtimes/paired-reconciliation \
  --label 'Paired dataset reconciliation'

starforge runtime-workspace serve \
  --workspace /absolute/private/runtime-workspace --port 0
~~~

Open the local URL returned by the server. Select the attached runtime and
**Python & workbooks**, review the installed Python interpreter, select the
**duckdb** extra, then resolve the exact wheels, install offline and select that
environment. This source declares `duckdb==1.5.6`.

In **Applications**, open the existing **DuckDB dataset workspace** that owns
the two reviewed customer editions. For a new project, create that application
with the selected Python environment and a private customer directory, then use
the original delivery review and import workflow before defining a pair. Start
the selected application and retain its actual customer workspace ID. The service writes its current
`duckdb-launch.json` inside the customer directory; `workspace_id` is the
saved 32-character hexadecimal identity used by the original browser and agent
connection.

A source installation can run the same original customer directly:

~~~sh
umask 077
python3 -m venv /absolute/private/duckdb-venv
/absolute/private/duckdb-venv/bin/python -m pip install \
  "/absolute/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python[duckdb]"

/absolute/private/duckdb-venv/bin/python -m stellar_forge_buyer.duckdb_cli \
  --workspace /absolute/private/customer-warehouse serve --open
~~~

Keep the original customer service running while using the reconciliation
browser or native agent connection. It retains its own database, request history and listener. The
[DuckDB customer guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/DUCKDB.md)
and [Python runtime guide](../../stellar/scf-starforge-20261009/distribution/python-runtime/WORKSPACE.md)
cover both installation routes and original customer recovery.

For Parquet source packages, select an existing trusted interpreter containing
the original decoder's `pyarrow==26.0.0` dependency through
`SF_FRICTIONLESS_PYTHON`. Keep the included Wherobots
[source requirements](../../stellar/scf-starforge-20261009/sf30-seller-sdk/wherobots/source/requirements.txt)
with the installation. The local Parquet reader uses PyArrow; Wherobots remote
SDK, account and job operations are separate parts of that component's declared
environment. CSV, TSV and JSON source capture uses Python's standard library.


## Operate the original customer

Dataset reconciliation compares two immutable editions already imported into the original Stellar Forge DuckDB workspace. It keeps the field meanings, exact native values, matching rules, every original row, review decisions and complete handover together.

Open **Dataset reconciliation** from the original Dataset workspace. The same local listener, workspace identity, warehouse and export journal own both interfaces. The **Operating guide** link in the header opens this document before an export exists; a frozen copy also travels in each complete handover.

## 1. Open the original project

Use the installed DuckDB application that owns the project. If opening it from the Python installation, the existing command is:

~~~sh
python -m stellar_forge_buyer.duckdb_cli --workspace /absolute/private/workspace serve --open
~~~

The command returns its local listening address and the path of its private launch record. The launch capability reaches the browser through the URL fragment and is removed from the visible address after the page opens. A Dataset workspace link in the reconciliation header returns to the same project.

When a host already owns this warehouse, use that existing browser or MCP connection. The Python CLI needs the warehouse lock; a separate CLI process cannot borrow a live browser owner's in-process connection. The installed MCP client calls the existing owner.

The reconciliation sidebar displays the native workspace ID. A browser that sees a different ID on the same address stops the dependent operation. Reopen the intended project's launch URL before continuing.

### Import source editions

In **Dataset workspace → Source delivery**, review the original acquired delivery, choose its SQL column types and meanings, and import the exact edition. Repeat for the other side. The comparison uses these original edition IDs, independent of later changes to active SQL view aliases.

Return to reconciliation and choose **New pair**. **Load earlier editions** follows the original edition catalog's continuation until earlier source versions are available. The selected edition panel shows all imported fields, native SQL types, original delivery scope and retained source meanings.

A complete comparison needs a deliberate source contract. For example, a numerical reading in one unit and a reading in another unit need an explicitly prepared source edition with the intended conversion. Reconciliation does not infer a conversion from a column label.

## 2. Define the complete pair

A pair has a stable name, a display label, two immutable edition IDs and a list of canonical comparison fields. Choose a meaningful name using letters, numbers and underscores, beginning with a letter. Saving an edited pair adds a revision under that name.

For every field, set:

| Field | Purpose |
| --- | --- |
| Canonical field | The name used in comparison tables and reports. |
| Source column | The exact original column in the source edition. |
| Target column | The exact original column in the target edition. |
| Role | Matching key, or compared value. |
| Meaning | The interpretation the reviewer intends for this comparison. |
| Source/target value maps | Optional explicit mappings of original VARCHAR strings. |

At least one field must be a matching key. A pair accepts up to 64 comparison fields; each original column can be selected once per side. Canonical names are unique without regard to case.

The two selected native SQL types must be identical. Values are compared using those retained types. There is no implicit tolerance, rounding, case folding, whitespace trimming, unit conversion or timezone conversion. Large integers and decimals remain native values; the browser displays typed text rather than converting them through JavaScript floating point.

Fields left out of the comparison are listed by the mapping review. They remain in their complete original rows and original source exports.

### Exact VARCHAR value maps

A value map explicitly associates an original string with a canonical string. Maps apply only to VARCHAR fields and are separate for source and target. This supports a reviewed relationship such as one source's `Good` and another source's `OK` both meaning `valid`.

With a nonempty map, every non-null original string needs an entry. An unlisted string makes that row quarantined. Native NULL remains NULL. Spaces, case, empty strings and embedded newlines are part of the literal value. The interface marks SQL NULL and an empty string separately; these markers are display annotations.

Each side of a field accepts at most 10,000 literal entries. The original HTTP owner also limits a complete JSON request to 1 MiB, so the total encoded definition must fit that original request limit. The editor pages long maps while retaining the entire definition. **Export definition JSON** exports every mapping entry, including entries beyond the visible page. Duplicate original strings in one map are rejected.

Use an empty map when the original values should be compared directly. Mapping a key changes its canonical matching value, so review the resulting duplicate groups as part of the comparison.

### Comparison windows

Leave the window column empty and add no windows to include the full source scope.

To select a window, choose one canonical mapped field and add explicit start and end values. Windows are half open: the start belongs to the window, and the end belongs to the next interval or lies outside the selected scope. Up to 32 nonoverlapping windows are supported.

| Native type | Window basis |
| --- | --- |
| BIGINT, HUGEINT, DECIMAL, DATE, TIMESTAMP, TIMESTAMPTZ | Native typed bounds, provided as exact strings. |
| VARCHAR | Explicit lexical string order. |

A VARCHAR window does not become a timestamp because its text resembles a date. Use the lexical basis only when string order is the intended source contract.

A missing or unresolvable window value is quarantined. A valid value outside all declared windows is retained as **Outside declared windows**. Overlapping, reversed or empty windows are rejected before a pair can be saved.

### Review and save

Choose **Review mapping** after editing. The native response includes the normalized complete definition, original source scope, SQL types, meanings, omitted fields and a digest binding that exact review.

Check the review, then choose **Save reviewed pair**. Editing any field invalidates the previous review. The browser retains the full draft and requires a review of its current contents before saving.

An edit carries the original pair revision. If another operator has saved a newer revision, the current save returns a revision conflict. Keep the draft, open the latest pair revision and deliberately reconcile the definitions. The browser does not replace another operator's work by automatically adopting a new revision number.

**Import definition JSON** loads a complete definition as a new pair draft. Change its name if it describes a new pair; an existing name is protected by the native revision check. An exported pair definition is a useful starting point for a new source delivery.

## 3. Run and interpret reconciliation

Open a saved pair and select **Run reconciliation**. The exact pair revision and reviewed definition digest travel with the request. Opening a historical pair revision and running it is supported. Running the same revision reopens its original deterministic run.

The native run materializes one comparison row per original source observation. The run summary accounts for both sides:

~~~text
original rows = included + quarantined + outside declared windows
included rows = matched + unmatched included rows
~~~

Matched multiplicity is counted across equal canonical values within each key and window. Duplicates do not disappear, and the engine does not choose an arbitrary one-to-one pairing between duplicate original rows.

### Key-group categories

| Category | Native meaning |
| --- | --- |
| MATCHED | Both sides have equal canonical value multiplicities for the known key and window. |
| SOURCE_ONLY | The known key and window appear only on the source side. |
| TARGET_ONLY | The known key and window appear only on the target side. |
| VALUE_DIFFERENCE | One original included row exists on each side and its compared values differ. |
| MULTISET_DIFFERENCE | A group with multiple observations has different canonical value multiplicities. |
| NOT_COMPARABLE | A known-key group contains quarantined observations. |

SOURCE_ONLY and TARGET_ONLY describe the known keys inside the selected windows. Unresolved keys remain separately quarantined; their correspondence is not inferred.

For example, two equal source observations and one equal target observation give one matched observation and one unmatched source observation. Equal NULL values in compared value fields participate in native comparison. A NULL matching key cannot establish correspondence and is quarantined.

The group table shows the canonical key fields, source and target counts, quarantined counts, matched multiplicity and unmatched counts. Use **Duplicate keys** to inspect multiplicity separately from the category filter.

### Inspect every original row

Open **Original rows** to page through both complete editions as accounted for by this run. Filter by side, row status or group ID. **All group rows** opens the observations belonging to a selected group.

**Open full row** displays every original field alongside the canonical comparison values. The retained native row index identifies the original observation; it is not an invented counterpart on the other side.

Quarantine reasons identify the actual problem, such as an unmapped literal, a NULL key or a missing window value. Correct source interpretation by importing a reviewed source edition or saving a deliberate mapping revision. Existing rows and runs remain available for comparison.

All catalogs and row tables provide their original continuation. A visible page limits the display, not the native comparison or the complete export.

## 4. Record engineering decisions

Select a complete key group or an original row, enter a reviewer and reason, then choose an outcome:

| Outcome | Use |
| --- | --- |
| OPEN | The observation remains open for review. |
| ACCEPTED_DIFFERENCE | The reviewer accepts this particular difference with a stated reason. |
| REQUIRES_CORRECTION | The observation requires corrective work. |
| DEFERRED | Review is intentionally deferred with a stated reason. |

Save the decision against the current decision revision. Each decision appends a sequence number, original subject, reviewer, reason and timestamp. The decision history remains readable after a later decision changes the current interpretation.

Decisions do not change original source values, native group categories or row accounting. A decision that says a correction is required is an engineering record; the next corrected source delivery must be imported and compared to establish the result.

If a peer records a decision first, reopen the current run and review the updated decision revision before saving. The full entered reason remains in the interface after a returned conflict.

## 5. Freeze reports and compare a follow-up run

Choose **Create complete report** from a run. The report freezes the exact source editions, pair revision, mapping review, decision revision, summary and saved native query recipes.

Optionally select a previous saved run. **Load all saved baselines** follows the complete native run catalog. A full run ID can also be supplied directly.

The resulting change table separates:

| Change | Interpretation |
| --- | --- |
| ADDED_TO_REPORT | A known canonical key/window is present in the later selected report. |
| ABSENT_FROM_REPORT | A known key/window from the earlier selected report is absent later. |
| CHANGED | The known group changed in classification/counts or exact canonical content. |
| UNCHANGED | The compared group retained its native classification, counts and comparable canonical content. |

The two compared runs must use the same ordered canonical key names and SQL types; a different key contract requires a separately reviewed comparison. The report also records whether mappings, canonical schemas, windows and source scopes are equal. Its change rows expose `canonical_schema_equal`, `canonical_content_changed` and `classification_or_counts_changed`. This identifies a changed value even when both runs still have the same group category and number of rows.

Read these scope fields before calling a change a correction. A key's absence from a later selected window does not by itself establish a corrected source. A changed source contract remains visible with the report.

Reports are immutable. Creating the same report at the same decision revision with the same baseline reopens the original report. A later decision produces a distinct report while preserving the earlier one.

## 6. Prepare and receive the whole handover

In **Reports and handover**, open the intended report and choose **Prepare complete handover**. This uses the original Dataset workspace export request journal. Export preparation runs the saved report recipes over their retained native tables and copies the original source handoffs and warehouse snapshot.

The completed native package contains:

| Path | Complete contents |
| --- | --- |
| manifest.json | Native file index, byte lengths, SHA-256 hashes, report binding and receiving information. |
| reconciliation-request.json | Original export request, frozen report, original view bindings and guide. |
| report.json | Complete immutable report and saved native recipes. |
| OPERATING.md | The operating guide frozen at export preparation. |
| queries/rows/ | Full original accounting query: CSV, Parquet, request, execution and manifest. |
| queries/groups/ | Full native key-group query and its original metadata. |
| queries/decisions/ | Full decision history through the frozen report revision. |
| queries/changes/ | Full change query and metadata when a previous run was selected. |
| sources/EDITION_ID/ | Each distinct original source edition's complete native source handoff. |
| warehouse/ | Original sparse warehouse snapshot and native handoff metadata. |

Query exports contain all query rows. The JSON report is useful for review, but it does not replace the complete native handover.

Use **Save all files to a folder** where the browser supports folder access. This preserves nested native filenames. The interface checks the declared and received byte lengths; the native receiving command verifies content hashes and the complete package relationships.

Individual downloads remain available, with long file lists paged in the interface. Every entry remains in the full manifest and folder download. When downloading individually, recreate each listed relative directory and retain its exact filename. Files called `manifest.json` or `result.parquet` in different query directories are distinct originals. For a large package, use the typed native client below so every file and continuation is handled together.

The receiving folder must be private to its operator. Browser downloads may inherit broader local file modes. On Linux, restrict the chosen complete package directory before native inspection:

~~~sh
chmod -R go-rwx /absolute/private/received-package
~~~

Inspect the entire package using the exact manifest hash from its native export record:

~~~sh
python -m stellar_forge_buyer.reconciliation.package inspect --directory /absolute/private/received-package --manifest-sha256 EXACT_MANIFEST_SHA256
~~~

Receive it into a separate, new working directory:

~~~sh
python -m stellar_forge_buyer.reconciliation.package receive --directory /absolute/private/received-package --destination /absolute/private/reopened-project --manifest-sha256 EXACT_MANIFEST_SHA256 --workspace-id ORIGINAL_WORKSPACE_ID
~~~

Use actual returned values for the uppercase placeholders. The receiving directory must be separate from the immutable package and must not be an existing unrelated workspace. The receiver checks every declared original file, query, source, report and manifest, then uses the original sparse-copy and DuckDB reopening path.

The completed receiving result returns the new directory, original native workspace identity and original report ID. Open that directory through the installed DuckDB application or the existing `serve --open` command. Reopen the original report in **Reports and handover**.

The working warehouse may subsequently change while the received package remains immutable. An interrupted receive continues the same retained binding and temporary copy. Re-running receive with the same destination and manifest verifies its saved receiving record; it does not rerun source acquisition or create another export.

Current package limits are 16 MiB of manifest metadata and 8 GiB per original file. A larger original is rejected explicitly, never silently shortened.

## 7. Recover the original request

The browser saves the complete JSON request body and its 32-character request ID in IndexedDB before the first POST. A successful native result is retained before the interface loads dependent catalogs.

If a connection ends before the response arrives:

1. Open **Saved requests**.
2. Find the original action and choose **Inspect original request**.
3. If it is complete, choose **Open saved result**.
4. If continuation is needed, choose **Continue original request**.

The continuation uses the same original body and identifier. When the native journal explicitly reports that the request does not exist, this action sends the retained body. A catalog refresh or GET never resumes a write.

Two native journals are visible. Pair saves, runs, decisions and reports use the reconciliation journal in the original warehouse. Complete exports use the original Dataset workspace request journal. Requests made from another client can be reopened from their native catalog; the complete original body is loaded before continuation.

Keep the original browser profile until its pending operations are resolved. When browser storage is unavailable, native catalogs remain readable, but a new browser mutation cannot proceed without retaining its request. Use the original CLI request file or typed client with its own retained request when needed.

A returned storage error may mean the native operation stopped partway through export. Preserve its existing directory and original request; free the actual required capacity and continue that request. An existing complete package is independently inspected before it is reused.

## 8. CLI and request bodies

The reconciliation commands extend the original installed CLI:

~~~sh
python -m stellar_forge_buyer.duckdb_cli --workspace /absolute/private/workspace reconcile status
python -m stellar_forge_buyer.duckdb_cli --workspace /absolute/private/workspace reconcile review --definition /absolute/private/definition.json
python -m stellar_forge_buyer.duckdb_cli --workspace /absolute/private/workspace reconcile save-pair --request-file /absolute/private/save-pair.json
python -m stellar_forge_buyer.duckdb_cli --workspace /absolute/private/workspace reconcile run --request-file /absolute/private/run.json
~~~

Store each complete request file before dispatch. Use a new lowercase 32-hex request ID for a new operation and retain it for any continuation. The native workspace ID is also lowercase 32-hex. Pair, edition, run, report and digest identifiers are lowercase 64-hex.

The native review returns the normalized definition and `review_sha256`. A new pair save body is:

~~~json
{
  "request_id": "ORIGINAL_REQUEST_ID",
  "workspace_id": "ORIGINAL_WORKSPACE_ID",
  "expected_revision": 0,
  "definition": "REPLACE_WITH_THE_COMPLETE_REVIEWED_DEFINITION_OBJECT",
  "review_sha256": "RETURNED_REVIEW_SHA256"
}
~~~

The string placeholder for `definition` must be replaced with the complete JSON object returned by review. For an edit, use the actual current pair revision instead of zero.

A run body uses the returned pair record:

~~~json
{
  "request_id": "ORIGINAL_REQUEST_ID",
  "workspace_id": "ORIGINAL_WORKSPACE_ID",
  "pair_id": "RETURNED_PAIR_ID",
  "expected_revision": 1,
  "definition_sha256": "RETURNED_PAIR_DEFINITION_SHA256"
}
~~~

A group decision body is:

~~~json
{
  "request_id": "ORIGINAL_REQUEST_ID",
  "workspace_id": "ORIGINAL_WORKSPACE_ID",
  "run_id": "RETURNED_RUN_ID",
  "expected_revision": 0,
  "subject": {"kind": "group", "group_id": 1},
  "outcome": "OPEN",
  "actor": "Actual reviewer",
  "reason": "Record the actual observation and the review needed."
}
~~~

Use the actual current decision revision and original group ID. A row subject is `{"kind":"row","side":"source","row":1}`, with its actual side and original row index.

A report body contains `request_id`, `workspace_id`, `run_id`, the actual decision `expected_revision`, and optionally `before_run_id`. An export body contains exactly `request_id` and `report_id`.

| Operation | CLI command after reconcile |
| --- | --- |
| Browse catalogs | pairs, runs, reports, operations; all support --offset and --limit. |
| Read a saved pair | pair ID [--revision N] |
| Read a saved run/report | run-read ID; report-read ID |
| Inspect all native groups/rows | groups RUN_ID; rows RUN_ID; each supports native filters and paging. |
| Open one original row | row RUN_ID --side source --row N |
| Read decision history | decisions RUN_ID --offset N --limit N |
| Read report changes | changes REPORT_ID --offset N --limit N |
| Record a decision/report | decision --request-file FILE; report --request-file FILE |
| Inspect/continue reconciliation request | request ID; resume ID --workspace-id WORKSPACE_ID |
| Prepare whole native export | export --request-file FILE [--export-root DIR] |
| Inspect/continue original export | export-request ID; resume-export ID |

Export CLI operations borrow the original DuckDBOperator journal and lock. Close the existing HTTP owner before starting that CLI owner. If the browser should remain open, use its export action or the installed MCP client.

## 9. Existing MCP tool and typed client

Reconciliation extends the original `sf43_discover_review_and_pay` tool with `action: "duckdb"`. Supply the existing registered `duckdbWorkspace` alias, a `duckdbOperation` and its complete `duckdbRequest`.

| Workflow | Existing-tool operations |
| --- | --- |
| Workspace and definition review | reconcile-status, reconcile-review |
| Saved pairs | reconcile-pairs, reconcile-pair, reconcile-save-pair |
| Native runs | reconcile-runs, reconcile-run, reconcile-execute |
| Original data review | reconcile-groups, reconcile-rows, reconcile-row |
| Decisions | reconcile-decisions, reconcile-decide |
| Reports and follow-up changes | reconcile-reports, reconcile-report, reconcile-save-report, reconcile-changes |
| Original reconciliation requests | reconcile-operations, reconcile-request, reconcile-resume |
| Full native handover | reconcile-export, reconcile-export-manifest |
| Original export continuation and bytes | operation, resume, file |

The installed distribution exports `./buyer/duckdb/reconciliation`. Its source module is `stellar-forge/mcp-paid-agent/duckdb-reconciliation-client.mjs`.

~~~js
import {openDuckDBReconciliationClient}
  from './stellar-forge/mcp-paid-agent/duckdb-reconciliation-client.mjs';

const reconciliation = await openDuckDBReconciliationClient({
  client: existingMcpClient,
  workspace: 'registered_workspace_alias',
  expectedWorkspaceId: originalWorkspaceId
});
try {
  const current = await reconciliation.status();
  const review = await reconciliation.review(completeDefinition);
  const pair = await reconciliation.savePair(retainedSavePairRequest);
  const run = await reconciliation.execute(retainedRunRequest);
  const report = await reconciliation.saveReport(retainedReportRequest);
  const exported = await reconciliation.exportReport(retainedExportRequest);
  const inspected = await reconciliation.inspectExport(exported.export_id);
  // Supply the original retained export manifest hash and destination.
  const received = await reconciliation.download({
    exportId: exported.export_id,
    directory: originalReceivingDirectory,
    expectedManifestSha256: originalManifestSha256
  });
} finally {
  await reconciliation.close();
}
~~~

Each request in this example is the full saved MCP request built from the preceding native results; the names denote retained caller inputs, not prepopulated sample data. MCP mutation requests omit the CLI/HTTP body's workspace_id field: the existing adapter binds the registered alias to the native workspace identity and supplies that field. Keep the original request_id, revision, definition and digest fields unchanged. The client exposes the same paging, row review, decisions and original request continuation methods as the native tool.

The client receives all manifest-declared files with the original byte-range receiver, up to 65,536 bytes per range, and preserves nested paths. It retains the same export, manifest, workspace, hashes and partial file offsets across an interruption. The small export-manifest descriptor allows receiving to proceed when a full file list would exceed a normal tool response.

Closing this adapter aborts and settles its own requests. It does not stop the external MCP client, original Python owner or warehouse.

## 10. Complete native receiving workflow

The shipped `reconciliation/receiving.py`, `reconciliation/browser-receiving.mjs` and `stellar-forge/mcp-paid-agent/duckdb-reconciliation-receiving.mjs` form one receiving workflow around the original installed host.

The browser arm opens the actual workspace and uses its visible controls for full definition review, pair save, native run, an observed review decision, immutable report and complete export. It retains the operation ID, source commit, full input, original browser request IDs and resulting native identities. A persistent browser profile keeps its original request journal available across interruption.

The same host's MCP and typed-client arm reads the original rows, makes an explicit reviewed successor mapping from actual retained source values, compares the resulting native runs, receives every original package file and reopens the original report from a separate sparse working warehouse.

The browser arm closes only the browser context it owns. The original native caller owns server start, server shutdown, source selection and final project reopening. A source or browser parse check alone is not the native receiving result; the completed receiving record identifies the actual executed project and its full exported files.

