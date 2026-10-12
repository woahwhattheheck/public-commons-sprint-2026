# IATI aid-finance operator

This component operates complete IATI publisher XML through the existing retained source workspace and SF30 dataset engine. It adds saved portfolios, a responsive operator console, a typed client, a native CLI, and an Applications provider. The original source-workspace MCP service exposes the same operations.

The workspace retains each original XML edition, mapping, native CSV/dataset/review, keyed comparison and portfolio revision. A full portfolio handover carries those source and review identities to a receiving workspace. A report ZIP provides the readable report, every selected CSV row, all review records and the complete retained comparison changes.

## Begin with a real publisher edition

Use the installed distribution's `dataset-iati` command with an existing Python 3.11 or newer executable. Its Node forwarder uses the selected installation's original dataset engine. No database server, alternate XML parser or payment account is required for this source workflow.

Initialize one private workspace:

```bash
starforge dataset-iati --python /usr/bin/python3 \
  --workspace /srv/starforge/iati init
```

Retain the complete acquired publisher file and its meaningful label:

```bash
starforge dataset-iati --python /usr/bin/python3 \
  --workspace /srv/starforge/iati source \
  --file /private/incoming/publisher.xml --label "Publisher edition — observed date"
```

The returned source ID is the full SHA-256 of the original retained bytes. Use that actual ID in later selections. Keep the publisher URL, retrieval time and licence with the acquisition receipt. File names and labels are descriptive; they do not replace the source ID.

Open the source profile or list the original mappings:

```bash
starforge dataset-iati --python /usr/bin/python3 \
  --workspace /srv/starforge/iati profile --source SOURCE_SHA256

starforge dataset-iati --python /usr/bin/python3 \
  --workspace /srv/starforge/iati presets
```

The three presets are activities, transactions and budgets. Each returned collection includes its known field names and complete canonical native mapping. The profile retains associated provider/receiver, narrative, sector and location values together. It also exposes identity, financial and association findings for review.

The native intake limit is 256 MiB per original XML source. The hardened parser and original mapper retain their declared record, depth and projection limits. A portfolio selects 1–32 distinct retained sources; every selected activity identifier must occur in exactly one source edition within that revision.

## Use the console

Open the same private workspace:

```bash
starforge dataset-iati --python /usr/bin/python3 \
  --workspace /srv/starforge/iati serve --port 0
```

The process prints its private loopback console URL. Open that complete URL. The page removes its capability fragment from the address bar and retains it only in the current browser session. The server checks the exact loopback Host, same origin and private bearer capability for every API action.

The six views form one operator workflow:

| View | Complete work |
| --- | --- |
| Overview | Read retained source/portfolio/build/comparison counts and reopen saved work. |
| Publisher sources | Upload complete XML, inspect exact byte identity, associations and source findings. |
| Portfolio review | Select publisher editions, optional coverage and a named review; save and build all three native editions; read historical revisions and full reports. |
| Explore reported rows | Use the native equality/range/sort/field/cursor parameters; inspect every returned row; export original dataset and project packets. |
| Compare editions | Compare saved portfolio revisions, retain source coverage facts, inspect keyed native changes and download the complete changes. |
| Receive and export | Receive a complete portfolio or original dataset project; reconstruct its original identities and reopen the actual received work. |

The report tables group amounts by reporting organisation, activity hierarchy, currency, financial type and value date. Budget rows also retain budget status and complete period. Every financial amount is displayed as the exact string returned by the original report. The browser performs no money arithmetic. Long reports retain all rows and offer contained horizontal scrolling and paginated display; the complete download always contains every retained row.

Read the portfolio's source interpretation alongside its amounts. Transaction categories represent different financial events. A dated budget selection retains the whole amount for an overlapping period and does not prorate it. See the source-backed [domain interpretation](DOMAIN.md) for these rules and original IATI references.

The console owns the original workspace lease. While it is running, use its browser, HTTP client or MCP connection. Stop it before a standalone CLI command needs to open that same workspace. Normal Stop drains the existing HTTP requests and closes the original Node dataset engine and SQLite lease.

## Save, review and revise a portfolio

Author a JSON selection using actual retained IDs:

```json
{
  "requestId": "publisher-review-2026-01",
  "name": "Reviewed aid portfolio",
  "notes": "Purpose and source interpretation recorded by the operator.",
  "sources": ["SOURCE_SHA256_FROM_ACTUAL_INTAKE"],
  "selection": {
    "currencies": ["USD"],
    "transactionTypes": ["3"],
    "dateFrom": "2025-01-01",
    "dateTo": "2025-12-31"
  },
  "review": {
    "status": "reviewed",
    "reviewer": "ACTUAL_REVIEWER_NAME",
    "note": "ACTUAL_SOURCE_REVIEW_OBSERVATIONS"
  }
}
```

This example is an input template, not an observed publisher record. Replace its source and reviewer placeholders with actual values. Leave a selection array or date absent to retain its full source coverage. The preset catalogue supplies the actual transaction and budget code labels.

Save the file through the same native workspace:

```bash
starforge dataset-iati --python /usr/bin/python3 \
  --workspace /srv/starforge/iati portfolio-save \
  --file /private/selections/portfolio-review.json
```

The original engine validates all sources and selection fields, builds activities/transactions/budgets, calculates the report, and publishes one portfolio revision and its request identity in the existing SQLite transaction. The response includes the actual portfolio ID/revision, three builds per source, exact definition digest, coverage and review.

Review status is `draft`, `reviewed` or `needs-correction`. The latter two require a named reviewer. Review notes are retained as authored review content; they do not assert that the official IATI Validator has run.

An edit includes both the saved `id` and its current `expectedRevision`. Retain the complete new definition and use a new requestId. The original implementation rejects a stale revision. A matching retry of a previous request returns that request's original revision even when subsequent revisions now exist.

The browser saves its complete pending request before submitting. **Retry the saved portfolio request** repeats that original selection after an interrupted reply. Read the saved revision/history to understand what completed before changing a request.

```bash
starforge dataset-iati --python /usr/bin/python3 \
  --workspace /srv/starforge/iati portfolio --id PORTFOLIO_ID --revision 1

starforge dataset-iati --python /usr/bin/python3 \
  --workspace /srv/starforge/iati history --id PORTFOLIO_ID

starforge dataset-iati --python /usr/bin/python3 \
  --workspace /srv/starforge/iati report --id PORTFOLIO_ID --revision 1
```

## Native mappings and exact row queries

The portfolio workflow builds complete collection presets automatically. For a separately reviewed projection, save the actual preset returned by `presets`, select its known `fields`, and submit that original mapping with `plan --file`. The native mapper derives its fixed columns, row key, filters, range fields and sort fields.

A build binds the exact original source ID and saved plan ID:

```bash
starforge dataset-iati --python /usr/bin/python3 \
  --workspace /srv/starforge/iati build --source SOURCE_SHA256 --plan PLAN_SHA256
```

Use only the parameters exposed by that returned native dataset. Query values remain strings:

```bash
starforge dataset-iati --python /usr/bin/python3 \
  --workspace /srv/starforge/iati query --build BUILD_SHA256 \
  --params '{"limit":"25","where_currency":"USD"}'
```

The native reply contains `id`, `ok`, `engineBlob`, `dataset` and `response`. When `response.status` is 200, the complete row page is in `response.body.rows`; field order is `response.body.fields` and the next original cursor is `response.body.page.nextCursor`. Retain that cursor with the unchanged query to continue. The original engine rejects changed snapshot/query cursors.

Amounts, identifier strings, JSON association cells and reviewed missing values remain original row values. Equality filters use `where_FIELD`; range fields expose `gt_FIELD`, `gte_FIELD`, `lt_FIELD`, `lte_FIELD`. Only declared fields support those parameters. The console displays the selected build's original capabilities. For very wide or large cells, lower the page limit or select fewer native fields; the complete dataset export retains all rows.

## Compare coverage and financial editions

A portfolio comparison names two saved revisions of the same original portfolio:

```json
{
  "id": "PORTFOLIO_ID",
  "beforeRevision": 1,
  "afterRevision": 2,
  "pairs": [
    {
      "before": "ORIGINAL_PUBLISHER_EDITION_ID",
      "after": "REPLACEMENT_PUBLISHER_EDITION_ID"
    }
  ]
}
```

Use `portfolio-compare --file` for this definition. Omit explicit pairs when the original unchanged sources and unambiguous reporting-organisation signatures determine the correspondence. Ambiguous source replacements require an explicit original pair.

The result preserves `selectionChanged`, source additions/removals, selected pairs, before/after counts and each native keyed comparison. It does not collapse a changed source cohort into an unexplained monetary delta. Reporting organisation, hierarchy, transaction/budget types, currency and dates remain separate report dimensions.

For two compatible individual native builds, use `compare --before BUILD --after BUILD`, then `changes --comparison ID --offset 0 --limit 50`. Continue `nextOffset` until null or download the complete original JSONL through the console/MCP. Source [identity and comparison semantics](DOMAIN.md#identity-and-comparison) explain publisher refs and content-based identities for records lacking stable refs.

## Export and receive the complete work

There are distinct complete deliveries:

| Delivery | Native command or console action | Contents and receiving |
| --- | --- | --- |
| Native dataset | `dataset --build ID --out DIRECTORY` | Original data.csv, dataset configuration and source lineage. |
| Individual project | `export --build ID --out FILE.zip` | Complete original source, mapping, CSV/config/review and packet manifest; receive with `import`. |
| Readable portfolio report | `report-export --id ID --revision N --out FILE.zip` | report.html/json, all three CSVs, every review JSONL record, original comparison records and all changes. |
| Full portfolio | `portfolio-export --id ID --revision N --out FILE.zip` | Complete revision/request history, all referenced original dataset packets, report files and retained comparisons. Receive with `receive` or `import`. |

Output destinations are explicit private files/directories. Keep a completed delivery immutable; use a different output for a deliberately different selection.

```bash
starforge dataset-iati --python /usr/bin/python3 \
  --workspace /srv/starforge/iati portfolio-export \
  --id PORTFOLIO_ID --revision 2 --out /private/deliveries/iati-portfolio-r2.zip

starforge dataset-iati --python /usr/bin/python3 \
  --workspace /srv/starforge/iati-received init

starforge dataset-iati --python /usr/bin/python3 \
  --workspace /srv/starforge/iati-received receive \
  --file /private/deliveries/iati-portfolio-r2.zip
```

The native portfolio importer verifies the full manifest, paths, sizes and SHA-256 values, reconstructs every referenced original dataset, recomputes each report and comparison, and compares complete report file bytes. Only then does it publish all portfolio revisions and original request identities in one existing SQLite transaction. Previously prepared immutable source/build bytes can be reused during an interrupted receive. Conflicting existing revisions or requests are rejected.

The core permits complete portfolio/report packets up to 4 GiB of declared expanded content and 16,384 members. The IATI HTTP receiver streams the same package capacity. It detects a full portfolio schema on the normal `/api/import` route while preserving individual native project import. A readable report ZIP is a delivered report, not an importable portfolio.

## Typed HTTP client

The installed export is `./seller/iati/client`. A checked-out copy is `iati/client.mjs`, with adjacent `client.d.mts`. It borrows an already running original console and uses only native HTTP operations.

```javascript
import { connectIatiWorkspace } from './iati/client.mjs';

const client = await connectIatiWorkspace({
  consoleUrlFile: '/private/connections/iati-console.url',
  timeoutMs: 240000
});
try {
  const state = await client.state();
  const { portfolios } = await client.portfolios();
  const selected = portfolios[0]; // Choose the intended actual saved portfolio.
  if (!selected) throw new Error('Select an existing reviewed portfolio first.');
  const report = await client.report(selected.id, { revision: selected.revision });
  const archive = await client.export('portfolio', selected.id, { revision: selected.revision });
  // Consume archive.body with an existing streamed file receiver or cancel it.
  // The native report's monetary values remain strings.
  console.log({ workspaceSchema: state.schema, revision: report.revision,
    financialGroupCount: report.financialGroups.length });
  await archive.body.cancel();
} finally {
  await client.dispose();
}
```

Pass either the original private URL or one private connection-file path. The file reader checks its real path, private ownership/mode, single regular-file link, complete UTF-8 and unchanged bounded FileHandle identity. It never prints the capability.

The client exposes source/plan/build/query/change operations, original presets/profile, portfolio listing/history/get/save/report/compare, full exports, original XML intake and complete packet receiving. Historical portfolio/report calls and exports accept an explicit `revision`. The declared save type requires `id` and `expectedRevision` together for edits.

Raw source and packet methods take the actual complete byte count with the caller's stream. Export returns the original Response stream; consume it or cancel it. `dispose()` aborts/drains this client's requests. It does not stop the running console or close Applications' model.

## Managed Applications lifecycle

Choose **Applications → New application → IATI aid finance** in the existing runtime workspace. Select:

| Field | Meaning |
| --- | --- |
| Original IATI workspace | Existing private directory initialized or received by dataset-iati. |
| Existing Python executable | Actual absolute Python 3.11+ interpreter, preserving its current virtual environment. |
| Console connection file | Optional new file in an existing private directory for the original MCP/client connection. |
| Local port | 0 selects an available local port; an explicit port remains part of the reviewed original command. |
| Private environment JSON | Existing Applications environment file when the selected runtime requires one. |

The contribution `distribution/contributions/iati.json` supplies the command, typed client export and original Applications provider. The provider is discovered through the maintained contribution loader; there is no parallel application registry or process controller.

**Review application** reads the original workspace marker/SQLite identity, selected Python and fourteen source files. **Save application** uses the existing managed source adoption. **Review start** rechecks that selection. The executed command checks its source/workspace binding before and after acquiring the original workspace lease.

The managed startup line uses `stellar-forge.iati-workspace-launch.v1` and status `IATI_WORKSPACE_READY`. The original observer verifies its selected Python, adopted release source and private loopback URL, then reads authenticated `/api/launch`. **Open** appears only for the same live original startup record.

Normal source rows, portfolio edits and comparison records remain mutable inside the selected original database; they do not invalidate its binding. A replaced database, changed selected source or different Python requires a fresh application review. Stop clears launch readiness, closes the listener, drains accepted requests and releases the original dataset engine and workspace lease. Start then reopens that same retained work.

After an interrupted application save/start, use the operation already shown by Applications. Do not create a second application to recover an existing selected operation.

## Share that console with the original MCP host

Supply a new private connection file when starting:

```bash
starforge dataset-iati --python /usr/bin/python3 \
  --workspace /srv/starforge/iati serve --port 0 \
  --connection-file /private/connections/iati-console.url
```

The console creates that file with mode0600 and removes its own file on normal Stop. If one already exists, use its running original console or reconcile its ended owner before selecting a new file.

Declare the original source-workspace configuration:

```json
{
  "schema": "stellar-forge.source-workspace-connection.v1",
  "workspaces": {
    "aid-review": {
      "label": "IATI publisher review",
      "format": "iati",
      "consoleUrlFile": "/private/connections/iati-console.url",
      "files": {
        "publisher": {
          "kind": "source",
          "path": "/private/incoming/publisher.xml"
        },
        "portfolio-packet": {
          "kind": "packet",
          "path": "/private/deliveries/iati-portfolio-r2.zip"
        }
      }
    }
  }
}
```

The MCP client selects declared handles, not arbitrary host paths. The eight IATI tools provide original presets/profile and portfolio list/get/history/save/report/compare. Existing source intake, native mapping/build/query, keyed changes, retained exports and packet import remain the same tools.

Use `merchant_source_export` with `kind: "portfolio"` or `"report"`, `portfolio` and optional `revision`. The complete retained archive is streamed into the existing export store. `merchant_source_file_read` uses the original read-only FileHandle contract, verifies the complete retained file and returns bounded chunks with the same read identity. Release a read through the original file-release tool; the full export remains retained.

Another declared IATI console can import a retained portfolio using `merchant_source_import` with `fromWorkspace` and `exportId`. It receives the same bytes through the native importer. The MCP layer performs no financial aggregation, XML projection, duplicate receiving transaction or payment action.

## Source and implementation boundary

The operator-facing files are server.py, cli.py/cli.mjs, managed.py, client.mjs/client.d.mts and the three public assets. They import the maintained iati_source.py/iati_workspace.py and original XML workspace/server/native engine. The shared source-workspace adapter adds format and route registrations plus bounded complete archive reads.

The full source semantics, canonical mapping and portfolio construction are in [README](README.md) and [DOMAIN](DOMAIN.md). Original primary references include [IATI2.03 activity standard](https://iatistandard.org/en/iati-standard/203/activity-standard/), [transaction types](https://iatistandard.org/en/iati-standard/203/codelists/transactiontype/) and [budget definitions](https://iatistandard.org/en/iati-standard/203/activity-standard/iati-activities/iati-activity/budget/). The operator report retains those interpretation boundaries with its original source records.
