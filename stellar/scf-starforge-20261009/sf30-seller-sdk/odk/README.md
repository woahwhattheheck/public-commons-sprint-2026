# ODK Central Field Data

A complete source and reporting workspace for existing ODK Central field operations. Choose authorized projects and forms, receive the full reporting cohort, inspect original versions and media, review the edition, and deliver readable reports or approved datasets. The same workspace opens in the browser, one command line, SDK, Applications and MCP.

## Operator workflow

1. **Connect the existing Central user.** Select the Central server and the name of the host environment variable that contains its complete Authorization header. The workspace verifies the original user and accessible projects.
2. **Select projects, forms and a period.** A capture plan retains the actual XML form IDs and UTC submission window. Plans can include several projects on one Central server. A following period uses a new plan.
3. **Receive the original cohort.** Every native root and repeat table follows its complete OData continuation chain. The workspace also retains published and observed form generations, original XML and advertised XLS/XLSX, form attachments, original submission version lists, version XML and available media.
4. **Review the source.** Inspect native rows and repeat parent keys, original submission history, field dictionaries, source counts, missing media, encrypted-content states and changes made during the capture. Record the receiving decision and interpretation.
5. **Deliver the work.** Define exact numeric or categorical indicators, compare an earlier period, create HTML/Markdown/JSON reports, and select approved fields for an original SF30 dataset. A complete archive carries the database and retained source files to the next host.

The browser uses a neutral, compact operator layout. Every original source download streams through the private host. Large media and archives use browser downloads without assembling the entire file in browser memory.

## Start

Use Linux, Node 24 or newer, Python 3 with its standard library, and util-linux `flock`. The installed distribution has one command:

```sh
starforge odk-central-workspace serve \
  --workspace /absolute/private/field-workspace \
  --operator "Field operations"
```

Applications owns the existing private listener and connection file. Its printed operator URL opens the same workspace in the browser. The host Authorization environment variable remains the credential source for Central requests; connection records retain the variable name.

See [APPLICATIONS_MCP.md](./APPLICATIONS_MCP.md) for Applications, managed-host and MCP configuration. See [native/RECEIVING.md](./native/RECEIVING.md) for the original actual-provider receiving operation.

## Customer commissioning and portable publishing

**Customer commissioning** in the main navigation opens the complete source-agreement editor on the same authenticated listener. It records the actual host handover and account/project/form observations, saves the complete agreement with revision checks, creates two immutable reporting-period plans, and delivers the accepted native pair as reports, datasets and a complete portable workspace.

Applications can bind the commissioner to the original host's private connection or bootstrap JSON. Its optional authorization file supplies only the selected original environment alias. The equivalent installed command is:

```sh
starforge odk-central-workspace serve --workspace /absolute/private/field-workspace --operator "Field operations" --commissioning-connection /absolute/private/central-host/connection.json --commissioning-environment /absolute/private/central-host/connection-secret.json
```

For a local Central CA, set the host's returned `NODE_EXTRA_CA_CERTS` path before Node starts. The original host controller remains responsible for the upstream service and its native backup/restore.

Use `starforge odk-central-workspace commissioning --help` for the original full commissioning CLI. Existing Applications descriptors can be supplied to its `--operator-file` option to borrow that listener. See [COMMISSIONING.md](./COMMISSIONING.md) for the complete agreement, period, review, calendar and customer handover.

The **Portable workspace** pane also receives the original publisher. New archives retain its dataset generations, prepared packages, release history and unfinished source. Receiving uses the maintained dataset/release APIs to stage complete native packages on the destination and retains the original-to-local mapping. The same pane lets the operator select the received release against the native store's current generation.

```sh
starforge odk-central-workspace publisher-capture --workspace /private/field-workspace --id original-publisher-snapshot
starforge odk-central-workspace publisher-transfers --workspace /private/field-workspace
starforge odk-central-workspace publisher-receive --workspace /private/received-workspace --id publisher-receiving --snapshot-id original-publisher-snapshot
```

Read [PUBLISHER_TRANSFER.md](./PUBLISHER_TRANSFER.md) for full source custody, partial preparation, exact replay and destination activation.

## Complete command workflow

A connection input identifies an existing server and a credential reference:

```json
{
  "id": "field-central",
  "name": "Field operations",
  "url": "https://central.example.org",
  "authEnv": "CENTRAL_AUTHORIZATION"
}
```

```sh
starforge odk-central-workspace connect --workspace /absolute/private/field-workspace --input connection.json
starforge odk-central-workspace projects --workspace /absolute/private/field-workspace --connection-id field-central
starforge odk-central-workspace forms --workspace /absolute/private/field-workspace --connection-id field-central --project-id 1
```

Use actual IDs returned by discovery in a plan:

```json
{
  "id": "reporting-period-a",
  "name": "Reporting period A",
  "connectionId": "field-central",
  "forms": [
    {"projectId": "1", "formId": "actual-published-form-id"}
  ],
  "scope": {
    "submittedFrom": "2026-09-01T00:00:00Z",
    "submittedBefore": "2026-10-01T00:00:00Z",
    "pageSize": 1000
  }
}
```

```sh
starforge odk-central-workspace plan --workspace /absolute/private/field-workspace --input plan.json
starforge odk-central-workspace capture --workspace /absolute/private/field-workspace --plan-id reporting-period-a --id edition-a
starforge odk-central-workspace status --workspace /absolute/private/field-workspace --id edition-a
starforge odk-central-workspace quality --workspace /absolute/private/field-workspace --id edition-a
```

A direct capture waits and releases its original workspace lease on completion. When Applications already owns the workspace, commands use that listener; `--no-wait` leaves its capture running there. After an interruption, retain the original ID and use `resume --id edition-a`.

An edition exposes its actual table IDs, original field paths and current revision. Review inputs carry that current revision:

```json
{
  "id": "edition-a",
  "expectedRevision": 42,
  "decision": "accept",
  "reviewer": "Field analysis team",
  "note": "Record the actual source coverage and reporting interpretation here.",
  "findings": [{"title": "Reporting interpretation", "text": "The analyst's source-backed finding."}]
}
```

Use the returned revision in place of the illustrative value above. Run `review --input review.json` against the same workspace.

Report definitions use actual table IDs and native scalar field paths:

```json
{
  "id": "edition-a",
  "reportId": "period-a-report",
  "title": "Field reporting period A",
  "narrative": "Purpose and interpretation of this reporting period.",
  "indicators": [
    {"name": "Captured interviews", "tableId": "actual-table-id", "operation": "rows"},
    {"name": "Recorded amount", "tableId": "actual-table-id", "field": "actual_amount_field", "operation": "sum"}
  ]
}
```

Available operations are `rows`, `nonempty`, `sum`, `mean`, `minimum`, `maximum`, `distinct`, and `frequency`. An optional `equals` matches the original scalar value and preserves the distinction between missing, null, empty string, text, Boolean and numeric values. Decimal and Int64 results retain exact decimal arithmetic. Mean reports retain exact sum/count and display a value rounded to twelve decimal places.

Add `baselineId` to compare another complete edition from the same Central server. Reports include all changes in JSONL and complete categorical frequencies in CSV, alongside the readable report. The HTML display shows the leading 25 frequency values; the accompanying CSV contains the full distribution.

## Dataset and seller delivery

`export --input dataset.json` selects an accepted edition, an actual table and up to 32 original fields, including native row and repeat-parent keys. Each value has a companion missing/null/value state column. The output includes CSV, original JSONL rows, the native CSDL and semantic dictionary, original source pages and capture manifest.

An export with both original public payment terms and public origin creates the existing SF30 seller configuration. `release-prepare`, `release-status`, `release-activate` and `release-rollback` use the existing SF82 lifecycle. Dataset release runtime options are `port`, `facilitator` and `allowLocalFacilitator`. The original release manager owns the seller process.

## Portable workspace

```sh
starforge odk-central-workspace backup --workspace /absolute/private/field-workspace --id field-transfer-a
starforge odk-central-workspace restore \
  --archive /absolute/path/central-workspace.tar.gz \
  --expected-sha256 ORIGINAL_ARCHIVE_SHA256 \
  --workspace /absolute/private/restored-field-workspace
```

The archive is streamed, indexed and bound to the original workspace UUID and revision. Receiving verifies every member and its hash before publishing the restored directory. The same archive receive reopens the already received workspace and preserves its later work. Prior archive receipts remain in the database without recursively embedding earlier complete archives.

The private connection file belongs to the receiving host. Set its existing Authorization environment reference there when the restored workspace should capture more data.

## Capture and reporting semantics

The implementation follows [ODK Central's API](https://docs.getodk.org/central-api/) and the original released [Central backend](https://github.com/getodk/central-backend/tree/de0d2a07fd7c9ff698cbc312e550dd40ff058340).

- Central's `$top` is a page size. Every original `@odata.nextLink` is followed. Source date filtering applies to root submissions and the corresponding root relationship for repeat tables.
- Native root identity is the initial submission instance ID. Native repeat IDs describe the original structure and may change after repeat reordering.
- Current CSDL describes the captured tabular view. Original published and observed form generations preserve definitions for older submissions.
- A blank form version uses the provider's explicit `___` route token. A null version is a source error.
- Original form spreadsheet retrieval follows the provider's advertised XLS/XLSX content type. Linked dataset attachments remain identified as linked datasets and are retrieved through the original attachment route.
- Version attachment endpoints expose the bytes uploaded when read. Source receipts retain the actual capture time and available version data.
- Paging position, source counts, original version metadata and the capture window support review of concurrent source edits.
- Encryption states and missing expected media are retained as explicit coverage outcomes.

The original API schema, CSDL producer and upstream fixtures are pinned in [PROVIDER_SOURCES.md](./PROVIDER_SOURCES.md).

## SDK and trusted composition

```js
import {openCentralWorkspace} from './workspace.mjs';

const workspace = await openCentralWorkspace({
  directory: '/absolute/private/field-workspace',
});
try {
  const state = await workspace.state();
  const edition = workspace.edition({id: 'edition-a'});
  const coverage = workspace.quality({id: edition.id});
} finally {
  await workspace.close();
}
```

A trusted source extension may pass `extend: async ({workspace, store}) => { ... }` during construction. It receives the same original database and source retention API after the workspace methods are assembled. Setup failure closes that original owner. Source extensions can compose customer commissioning records and observations into the complete portable workspace.

Report and dataset operations bind the original request and receiving interpretation before output publication. Repeating an explicit operation ID resumes those exact outputs, including an interruption after some files were written. Browser recovery and CLI operation identities use the same original methods.

The portable workspace editor resumes an unfinished publisher receiving under its original operation ID. Its row budget can be increased for a larger dataset on a suitably provisioned host. Received unfinished preparations remain visible with their original export and release request; the same native preparation continues from that request. The current host’s preparation records are available in `state.publisherPreparations`, while `publisherTransfers` retains the complete original source and receiving records.
