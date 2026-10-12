# Commission an actual Timescale source

The commissioning desk carries one project from its complete intake through the actual source contract, original native files, complete comparisons, operator acceptance and technical handover. It lives in the same Timescale workspace, operation journal and browser as native refresh, job management and dataset publication. Its installed client uses the existing merchant owner.

Use the original [Timescale workspace](README.md) and [merchant configuration](../../../../../stellar-forge/mcp-merchant-operator/TIMESCALE_WORKSPACE.md). Open **Commissioning** on that existing browser. Installed exports also expose `workspace.commissioning` from `@tokenjunkielabs/starforge-merchant/seller/timescale`; direct command-line work uses `starforge dataset-timescale`. Use the merchant client when that project is already open in its browser host, so the original exclusive owner remains the writer.

## 1. Retain the full intake

Choose the original UTF-8 JSON file, a project title, an operator and a technical owner. The original file must contain every agreed source-contract field and acceptance criterion. This minimal shape demonstrates the format; use the complete actual intake for the customer project:

```json
{
  "title": "Historian source commissioning",
  "source_contract": {
    "database_identity": {
      "description": "The selected database and native extension identity.",
      "value": null
    },
    "source_window": {
      "description": "The agreed complete source window and timezone.",
      "value": null
    },
    "comparison_columns": {
      "description": "Every native column included in the comparison.",
      "value": null
    }
  },
  "acceptance": [
    {
      "id": "AC-01",
      "check": "Complete native source comparison",
      "pass": "Every agreed row and column in the selected window matches, including duplicate multiplicity and NULL.",
      "evidence": "Original baseline and observed JSON exports with a retained complete comparison."
    },
    {
      "id": "AC-02",
      "check": "Original native refresh outcome",
      "pass": "The prepared native plan and observed original outcome establish the agreed refresh behavior.",
      "evidence": "The existing plan, original operation and full native verification."
    }
  ]
}
```

Each field has a description and an actual JSON value, initially null when it has not been supplied. Acceptance entries accept `check` or `title`, `pass` or `condition`, and `evidence` or `expectedSource`. Criterion IDs must be unique. The desk retains the original document, including additional fields, and begins every criterion at **Not run**.

The original intake is at most 1,048,576 bytes, with at most 256 source-contract fields and 1,000 acceptance criteria. Uploads use strict UTF-8 decoding. A UTF-8 BOM is retained in the original bytes while JSON parsing recognizes the document. Invalid UTF-8 is rejected before dispatch. Original-file download returns the retained bytes, original basename and SHA-256.

## 2. Complete the source contract and bind the native projection

Edit all the original contract fields together. Select **Provided**, **Pending** or **Not applicable** for each, preserving its declared JSON type. Provided fields need an actual value. Not applicable needs a reason. The original descriptions and field keys remain with the intake.

In the same desk, choose the retained native edition, continuous aggregate, actual time column/type, inclusive start, exclusive end, timezone and selected publication columns. The binding uses the existing native projection contract and exact edition digest. Use the native capture controls to obtain an edition when necessary. Preparing or applying a native refresh, changing a job and publishing a dataset continue through their original controls.

A changed contract or selected native projection advances the contract revision and resets current acceptance assessments to Not run. Earlier source files, comparisons, observations, assessments and handovers remain in the original revision history. A previous source is visible as belonging to its earlier contract; retain the applicable original export again under the current contract before using it for a new current-contract assessment.

Changing only the project title or owner preserves the existing source binding and assessments. The browser leaves unsaved form entries intact during passive refresh; the explicit reload control reads the current project.

## 3. Retain the complete native exports

Import the baseline and observed files separately. Give each its original basename, role and descriptive title. The supported file is complete UTF-8 JSON with native text cells and explicit null:

```json
{
  "columns": ["bucket", "device", "reading"],
  "rows": [
    ["2026-10-01 00:00:00+00", "meter-1", "9007199254740996.50"],
    ["2026-10-01 00:00:00+00", "meter-2", null],
    ["2026-10-01 00:00:00+00", "meter-2", null]
  ]
}
```

A column may also be its native metadata object with a `name` field. For an original document containing several native tables under `tables`, enter the exact table name. The entire original document is retained; the comparison selects that table without replacing the document.

Every cell must be a string or JSON null. Export numeric values as their original native text. The desk does not round decimal readings, parse dates or reinterpret null as an empty string. Text differences such as `"1.0"` and `"1.00"` remain differences. This is a JSON-table workflow; an existing CSV or database source must first use its maintained native exporter with the agreed complete window.

One original native file is at most 6,291,456 bytes. A table supports up to 512 distinct columns and one million rows within that complete file limit. A project retains up to 256 source files and 256 complete comparisons. Select the agreed full source window before exporting; an oversized upload fails without importing a sampled replacement. The request envelope is limited to 8 MiB, including JSON escaping and other request fields, so some original files below 6 MiB may still exceed that envelope.

## 4. Compare all mapped rows and columns

Choose one baseline and one observed source from the current contract. Map each agreed field to one distinct column on each side. Every original column must be mapped or explicitly omitted with its reason. The browser exposes all columns for this selection.

```json
{
  "columns": [
    {"name": "bucket", "expected": "bucket", "observed": "bucket", "key": true},
    {"name": "device", "expected": "device", "observed": "device", "key": true},
    {"name": "reading", "expected": "reading", "observed": "reading", "key": false}
  ],
  "ignoredExpected": [],
  "ignoredObserved": []
}
```

The comparison evaluates every row as a complete multiset of mapped values. It retains exact strings, nulls and duplicate counts in both directions. Its counts identify total baseline rows, observed rows, matched rows and unmatched multiplicities. Keys group the displayed differences; they do not collapse duplicates, enforce uniqueness or discard source rows.

Read every page of **Expected only** and **Observed only**, or download the complete comparison JSON. Each difference includes its exact mapped values and unmatched count. The displayed pages refer to the complete retained comparison; creating an acceptance decision does not rerun or modify it.

This comparison establishes equality for the explicitly mapped exports and selected contract. It does not on its own establish what happened in an unobserved database window. The original native complete-aggregate verification remains available for the retained native plan and actual database window.

## 5. Record original outcomes and assess acceptance

The native-outcomes section reads the existing editions, saved plans and operation journal. Inspect the original operation, then retain its exact ID and digest with an explanation of what it establishes for this project. The desk captures that actual operation state and its native record references. Observation does not dispatch another capture, refresh, job change or publication.

For each original criterion choose **Not run**, **Pass**, **Fail**, **Deferred** or **Not applicable**. Record the actual assessment, responsible owner and selected original references. A Pass needs at least one current-contract source, comparison or observed operation. The operator remains responsible for whether that result satisfies the criterion; a selected file is not automatically treated as a passed native test.

The original operation may have failed or have an unknown outcome. Its state remains visible in the observation and complete report. Resolve native uncertainty through the original native operation workflow before making an assessment that depends on its success.

## 6. Hand over, reopen and retain complete reports

**Accepted** technical handover requires every criterion to be Pass or Not applicable and every contract field to have a supplied value or an explicit not-applicable disposition. **Handover with open items** records the outstanding criterion IDs, pending source fields and a named follow-up owner. Both require a technical handover statement.

Reopen a handed-over project to continue changes. Its prior handover and assessments remain in the complete revision history. Technical handover records the engineering state; any commercial acceptance, invoice or payment belongs to the parties' separate commercial record.

Publish a report for the exact current project revision and digest. The existing journal freezes two complete files:

- JSON includes the original intake text, every original source-file body, every complete comparison, the observed original operations and native result bodies, current project, and every full original revision.
- Printable HTML includes the current source contract, acceptance assessments, complete comparison differences, observed operations, handover and revision index. It escapes source text and uses a neutral, script-free layout.

The report list retains every published revision. Reopening or editing the project does not change an already published report. Browser downloads use descriptive original filenames; the merchant receiver uses stable `report.json` and `report.html` plus `Timescale_Commissioning_Manifest.json`.

Each generated JSON/HTML file must fit the original reader's 256,000,000-byte capacity. Before loading source bodies, publication rejects a source-byte subtotal already over that limit. It also checks both complete generated files before retaining either. Nothing is truncated. For a larger project, use the existing complete workspace export and receiving path, which includes every original source, comparison, journal revision and retained report. The merchant complete-package receiver supports 8 GiB per original file and a 64 MiB manifest; these differ from the native package builder's larger construction limits.

## Original command and request contract

Every commissioning change supplies `requestId`, current `expectedVersion`, `action`, `actor` and `note`. Every action after create also supplies `commissioningId` and `expectedRevision`. Use the values returned by the original project; do not infer a revision from a page count.

| Action | Complete additional input |
| --- | --- |
| create | `intake:{filename,content}`, `owner` and optional `title`; content is the entire original JSON string |
| edit | `title`, `owner`, and every original contract key with `{value,disposition,reason}` |
| bind-source | `selection` using the original edition/aggregate/window/publication contract |
| import-table | `source:{filename,content,tableName?}`, `role:BASELINE\|OBSERVED` and `title` |
| compare | `expectedSourceId`, `observedSourceId`, complete `mapping` and `title` |
| observe | `operationId`, the inspected full `operationDigest`, and `relevance` |
| decide | `criterionId`, `decision`, `assessment`, `owner` and `references:[{kind,id}]` |
| complete | `disposition:ACCEPTED\|WITH_OPEN_ITEMS`, `statement` and `followUpOwner` |
| reopen | the common request, actor, note and original project/revision selection |

Reference kinds are `source`, `comparison` and `observation`. For source binding, `selection` contains the actual `editionId`, `editionDigest`, `aggregateKey`, `timeColumn`, `timeType`, `start`, `end`, `timezone`, `columns`, `title`, `owner` and `note`, as documented in [the native projection workflow](README.md).

Direct workspace commands are:

```sh
starforge dataset-timescale commissioning-list --directory "$TIMESCALE_HOME/project"
starforge dataset-timescale commissioning-item --directory "$TIMESCALE_HOME/project" --id "$PROJECT_ID"
starforge dataset-timescale commissioning-command --directory "$TIMESCALE_HOME/project" --input "$TIMESCALE_HOME/change.json"
starforge dataset-timescale commissioning-reports --directory "$TIMESCALE_HOME/project" --id "$PROJECT_ID"
```

The direct CLI also supplies `commissioning-context`, `commissioning-intake`, `commissioning-source`, `commissioning-comparison`, `commissioning-report` and `commissioning-report-file`. Read their exact arguments with `dataset-timescale help`. Source/intake commands accept `--format original`. The report command uses this distinct input:

```json
{
  "requestId": "ORIGINAL_REPORT_REQUEST_UUID",
  "expectedVersion": 42,
  "commissioningId": "ORIGINAL_COMMISSIONING_PROJECT_UUID",
  "expectedRevision": 7,
  "expectedDigest": "ACTUAL_COMPLETE_CURRENT_PROJECT_SHA256"
}
```

Replace all placeholders and shown version values with the actual selected project. Report publication does not take the actor/action fields of a commissioning change.

## Browser recovery and the installed client

Before dispatch, the browser saves the full original input, including file text, in its local IndexedDB. It also keeps the original request UUID. On reload it inspects that request, shows its actual outcome and continues that same retained input when continuation is supported. A failed pre-dispatch write does not send the request. The original UUID is bound to the complete file digest and byte count; the complete source body is retained once in original content-addressed records.

A lost response is not a new operation. Keep the retained request and inspect its original UUID. Release a failed or unstarted local request only after the original operation has been inspected. Native uncertain outcomes still follow the original native recovery procedure. Browser recovery belongs to that browser profile; keep important request files and the complete project in the customer's normal private custody.

Use the existing merchant endpoint and persistent workspace UUID for installed client calls:

```sh
starforge timescale-client commissioning-command \
  --url "$TIMESCALE_MCP_URL" --workspace usage \
  --workspace-id "$TIMESCALE_WORKSPACE_ID" --token-env TIMESCALE_MCP_TOKEN \
  --input "$TIMESCALE_HOME/change.json" --wait-ms 600000

starforge timescale-client commissioning-report-download \
  --url "$TIMESCALE_MCP_URL" --workspace usage \
  --workspace-id "$TIMESCALE_WORKSPACE_ID" --token-env TIMESCALE_MCP_TOKEN \
  --export "$REPORT_REQUEST_ID" --directory "$TIMESCALE_HOME/received-report" \
  --expected-manifest-sha256 "$REPORT_MANIFEST_SHA256"
```

The client also exposes commissioning list/item/context/source/comparison/reports/report/file and manifest/file-release methods. In JavaScript, use `client.commissioning.command`, `item`, `context`, `source`, `comparison`, `reports`, `report`, `inspectReport` and `downloadReport`. These share the existing typed Timescale client and endpoint binding.

Read the MCP item summary first. Pin its exact `revision` and `digest` when paging contract, sources, comparisons, observations, acceptance or history, and when reading context. Follow each returned `next` offset until null; source-comparison pages are also complete through their terminal offsets. The separate mutation names are `expectedRevision` and, for report publication, `expectedDigest`.

Thirteen commissioning MCP tools extend the same owner. `merchant_timescale_commissioning_context` returns the full original operation digest for observation; do not hash a shortened display. `merchant_timescale_commissioning_file` reads original intake/source/comparison bytes, and the report file tools read the immutable published JSON/HTML. All use the original descriptor reader, full file hash and exact offset, with at most 196,608 bytes in one chunk.

For a report download, keep the same receiving directory after an interruption. The existing receiver checks the original endpoint, workspace, complete manifest, file hashes and retained prefix before continuing. A host restart reopens the same completed report; no renderer or native operation is rerun.

## Complete portable project

After the engineering work and report publication, use the original workspace export, inspect-package and receive commands in [README.md](README.md), or `client.exports.download` for its merchant transfer. Receive into a new private directory with the original request UUID and expected manifest digest.

Reopening the received project retains the same persistent workspace identity, commissioning projects, all full revisions, exact source files and comparisons, observed outcomes and frozen reports. The package also retains the original Timescale editions, publisher state and dataset generations. Current runtime paths are relocated by the maintained receiver, while historical paths remain in the original records. Supply the original environment-referenced database access on the receiving host before further native work.

The existing native demonstration and its previous merchant/remediation continuations retain their original source commit and operation input. A commissioning continuation adopts the newer application source against that already completed native project with explicit source lineage. It does not change the original run's source pin or repeat its database setup, refresh, job change or publication.
