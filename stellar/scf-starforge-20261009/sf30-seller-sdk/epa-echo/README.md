# EPA ECHO facility portfolios

A complete working application for teams reviewing environmental facility portfolios. Staff can select facilities, retain detailed EPA reports, compare dated source editions, assign reviews, prepare queryable datasets, operate the existing native merchant and deliver a complete receiving workspace.

The application has a local browser console, the same action CLI, 35 merchant MCP tools and a source-owned entry in the installed Applications catalog. They operate the same workspace and retained operation history.

## Open the application

Use the selected Starforge source and its installed dependency closure. From the repository root:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/epa-echo/workspace.mjs \
  --workspace /absolute/private/facility-portfolios \
  --startup-format json
```

Open the private URL in the returned `EPA_ECHO_READY` startup record. The console binds to `127.0.0.1` and chooses an available port. Keep the process open while using the application. Its directory retains the workspace UUID, portfolios, source journals, editions and working records.

For an existing merchant, add `--inbox /absolute/private/original-buyer-inbox` and `--release-runtime /absolute/private/merchant-runtime.json`. The runtime JSON uses the existing SF82 fields `port`, `facilitator` and `allowLocalFacilitator`. An identifying `--user-agent` is also available.

The installed commands are `epa-echo-workspace`, `epa-echo` and `epa-echo-mcp`. [MANAGED.md](MANAGED.md) explains the complete Applications selection, start, stop and reopen workflow. [MCP.md](MCP.md) documents the merchant connection and file receiver.

## Work a portfolio through to delivery

1. **Select the facilities.** Save a named portfolio with ordered, distinct 12-digit FRS identifiers, its customer, responsible team and working instructions. Search by facility name, state, city, ZIP, NAICS, county FIPS or EPA region when the identifiers are unknown. The saved search shows its original query, complete returned rows and progress.
2. **Retain the source.** Collect the selected reports or import a complete source package. Live collection retains the service specification, source-column metadata and each selected facility's detailed report. Capture progress remains attached to the same portfolio and original task.
3. **Review the edition.** Open all eight tables, the full detailed report for each facility and the exact source downloads. The edition identifies the requested facility set, successful reports and any source failures. Each row links back to its source response and original JSON location where applicable.
4. **Compare and assign.** Select two retained editions and a table. Review added, removed and changed source rows alongside their reporting periods. Save a source-linked review with a subject, note, responsible owner, due date and status. Updates retain the previous review and portfolio values in history.
5. **Prepare the customer dataset.** Choose an edition and table, name the dataset and query its original SF30 snapshot. The dataset package includes the complete CSV, query configuration, source manifest, source edition and original EPA response files.
6. **Operate the merchant.** Prepare, inspect, activate and start the existing publisher release. Inspect completed original buyer intents, receive their ordered pages and download the five original customer files.
7. **Hand over the work.** Export the edition as JSON, review CSV, printable HTML or its full source package. Export the whole workspace to preserve the portfolios, source captures, editions, reviews, dataset packages, release history and customer files. Receive that package and browse every retained file from the receiving workspace.

The grayscale console provides searchable selections, paged source tables, record details, saved drafts and compact progress summaries at desktop and mobile widths. A changed workspace revision preserves the entered form and brings the latest records into view for review.

## Included complete EPA source

[dc-wastewater-source-20261012.json](examples/dc-wastewater-source-20261012.json) contains eight complete original responses acquired on 12 October 2026. It is 826,432 UTF-8 bytes, SHA256 `c737c859126057359c3918e20e4553651b31ab14532060c64aa49f25a7fe24d9`.

The original query selects DC and NAICS 221320 with a 20-row response size. The package contains its query receipt and all four returned facility rows, four complete detailed reports, the 209-column metadata response and the full EPA-linked Swagger specification.

| Ordered FRS identifier | Facility name in the original source |
| --- | --- |
| 110072033839 | 23RD STREET NW & VIRGINIA AVE NW |
| 110072235550 | AYOBAMI PETERS |
| 110029030144 | BLUE PLAINS WASTEWATER TREATMENT PLANT |
| 110072237877 | PUMP STATION - 9TH & D ST SW, DC20024 |

Save those identifiers in that order before importing the example. The import also restores the original four-row search so staff can inspect its exact query result immediately.

The complete original response projection produces:

| Table | Rows | Contents |
| --- | ---: | --- |
| `facilities` | 4 | One selected FRS facility per detailed report |
| `permits` | 25 | All programme and permit records, including source-system identifiers |
| `compliance` | 10 | Current programme summaries and their own reporting dates |
| `quarters` | 4,836 | Source quarterly fields paired with the section's supplied date headers |
| `inspections` | 54 | Original inspection history |
| `enforcement` | 8 | Original formal actions and notices |
| `metadata` | 6,624 | System dates, programme/header metadata and source metadata |
| `source-fields` | 9,300 | Every detailed-report leaf and repeated identical source occurrence |

[dc-wastewater-projection-20261012.json](examples/dc-wastewater-projection-20261012.json) retains the complete source selection, table counts, facility summaries, representative original rows and same-source comparison result. The projection records the full original package's byte identity.

### Meaning of the fields

FRS `RegistryID`, programme `SourceID`, statute and EPA system remain separate identities. Neighbouring facilities in contextual map sections stay within their original report context.

Original numeric tokens remain exact strings. The full response, `recordJson` where provided, and the typed `source-fields` view preserve the distinctions among original numbers, strings, empty strings, nulls, empty arrays and empty objects. Convenience columns may display an absent or null field as blank.

Three included reports repeat an identical empty `SABACSDemographics` member. The shared exact JSON parser retains its strict default. EPA decoding supplies an explicit duplicate callback that accepts a repeated member only when both exact values and original JSON types agree. The full original body and every accepted repeated occurrence remain available, including their original UTF-16 offsets. Conflicting values or types fail parsing.

Source system extraction dates, current-as-of dates, reporting periods and acquisition observations have separate meanings. Each `QtrN` field uses only the date headers within its own source section. Separate `...Iso` columns normalize valid Gregorian date-only values to `YYYY-MM-DD`; original literals remain unchanged.

Source-field and metadata comparisons retain full original JSON pointers, including array position. Identified programme records use their original identities and periods; repeated records are compared as multisets. Quarter rows without an original record identifier retain positional association. Comparison output describes the selected source editions and their coverage.

For imported responses, the acquisition date and source transport receipt are retained as supplied. A later successful download from an intermediate file carrier remains within that carrier's materialization receipt. It does not replace an unobserved EPA origin HTTP status or imply an exact origin retrieval timestamp.

## Search and source acquisition

The source-owned provider calls these EPA query endpoints:

| Purpose | EPA route |
| --- | --- |
| Create a facility query | `echo_rest_services.get_facilities` |
| Read its facility pages | `echo_rest_services.get_qid` |
| Retrieve the detailed facility report | `dfr_rest_services.get_dfr` |
| Retrieve source-column metadata | `echo_rest_services.metadata` |
| Retain the service contract | `swaggerx.swagger_json?p_prefix=ECHO` |

All routes are under [echodata.epa.gov/echo](https://echodata.epa.gov/echo). The retained service contract is version `2019.10.15`, obtained from the current EPA-linked specification during this acquisition; its complete bytes and SHA256 accompany the source.

A search is complete when its retained unique FRS rows cover the original `QueryRows`. The provider's `Message` remains visible even when it says `Working` alongside a complete returned result. Follow the saved query's page state. EPA documents a query lifetime of approximately 30 minutes; resuming a saved operation retains its original QID and reports its actual source outcome.

Capture and search requests preserve completed responses, source errors, provider retry times and task progress. Resume the same capture or original search action after recovery. A restarted workspace reconciles completed capture pages with its selected edition, including a capture that finished between its last source write and edition sealing.

## Query the dataset

The original dataset engine exposes equality filters, declared date ranges, selected sorts, field projection and opaque cursor pagination. Read the selected dataset's description for its available columns.

For example, the facilities dataset accepts:

```json
{
  "fields": "facilityId,facilityName,state",
  "where_state": "DC",
  "sort": "facilityId",
  "limit": "2"
}
```

Continue with the exact returned `page.nextCursor` and the same selection. A compliance dataset can use `gte_currentAsOfIso`, `lte_currentAsOfIso` and `sort=currentAsOfIso`. The accepted range fields are the explicitly normalized date columns; source numeric strings retain exact text.

Each package's `dataset.json` declares all output columns as strings and at most eight filters, eight ranges and eight sorts. The original engine handles validation, snapshot identity, opaque cursors and delivery. The source package contains all required provenance files so the customer can reconnect a projected value to its original report.

## Use the action CLI

The console owns the running workspace writer. Save its JSON startup record in an owned private mode-0600 file and use `--session` to operate that same process:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/epa-echo/cli.mjs \
  --session /absolute/private/epa-startup.json view

node stellar/scf-starforge-20261009/sf30-seller-sdk/epa-echo/cli.mjs \
  --session /absolute/private/epa-startup.json action \
  --request /absolute/private/portfolio-save.json
```

An action file contains the exact request:

```json
{
  "action": "portfolio.save",
  "payload": {
    "label": "DC wastewater facilities",
    "facilityIds": ["110072033839", "110072235550", "110029030144", "110072237877"],
    "customer": "Portfolio review",
    "owner": "Operations",
    "note": "Review each programme against its own source reporting date."
  },
  "operationId": "dc-portfolio-save-20261012",
  "expectedRevision": 0
}
```

Set `expectedRevision` to the current view's revision before a new action. Reuse the same saved request after an uncertain reply. The operation journal checks its action and payload identity before admitting a new revision, so replay can recover a completed action.

After the save, use the returned portfolio ID:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/epa-echo/cli.mjs \
  --session /absolute/private/epa-startup.json import-source \
  --portfolio-id ORIGINAL_PORTFOLIO_ID \
  --operation-id dc-source-import-20261012 \
  --file stellar/scf-starforge-20261009/sf30-seller-sdk/epa-echo/examples/dc-wastewater-source-20261012.json
```

The CLI also opens a private workspace directly with `--workspace` when its console is closed. Start a lasting publisher through the running `--session` process.

| Command group | Commands |
| --- | --- |
| Workspace and saved actions | `schema`, `view`, `portfolios`, `action` |
| Source acquisition | `search`, `search-results`, `collect`, `import-source` |
| Retained source | `editions`, `edition`, `rows`, `facility`, `source` |
| Customer and export files | `download`, `receive-file` |
| Complete work handover | `export-workspace`, `import-workspace`, `received-workspace`, `received-workspace-file` |

Use `--help` for exact options. Source commands wait for the saved operation to complete, become partial or pause. File output uses an exclusive destination so an existing receiving file stays available.

## Customer and full workspace receiving

The native merchant uses the existing SF30 dataset, SF82 publisher/release lifecycle, SF88 buyer intents and SF100 customer delivery. A received purchase contains:

- `dataset.csv`
- `dataset.jsonl`
- `review.html`
- `delivery.json`
- `manifest.json`

The selected original intent order, source selection and each file's exact bytes remain attached to that receipt.

A complete workspace package includes all current editions; original source and wire bodies; completed, partial and failed source journals; saved reviews and their history; full dataset packages and provenance; original customer files; saved exports; and previously received worksets as their complete package objects. Receiving validates the complete file closure against the source state, package identities and recorded hashes before exposing the read-only received workspace.

The received file browser preserves each original relative path. The MCP receiver can retain partial downloads across listener changes and reopen the complete file set offline. The receiving package identifies its original workspace UUID and revision; working notes retain their original attribution.

## Capacity and operation history

The source contract exposes the same limits used by the importer and dataset engine:

| Item | Capacity |
| --- | ---: |
| Facilities in one portfolio | 1,000 |
| One EPA response | 32 MiB |
| Decoded responses in one capture | 256 MiB |
| One retained object | 256 MiB |
| Serialized source or workspace import | 256 MiB |
| Unique decoded objects in a workspace package | 256 MiB |
| Rows in one dataset, table export or comparison side | 250,000 |
| Rows in one HTTP display page | 500 |

A capacity error retains the existing original work for another selection or continuation. The complete-workspace receiver checks both decoded and serialized size because encoding and embedded prior worksets consume space.

Mutations use stable 8–100-character operation IDs and the current revision. Private owned storage, immutable source objects, the existing writer lock and atomic state writes maintain one workspace history. Original captures, customer intents and publisher generations remain selected through continuation.

## Complete operating programme

[The seven-file operating programme](../../../../operations/epa-echo-portfolio-native-20261012/README.md) drives the actual browser, full original EPA package, all eight source tables, reviews, datasets, two customer pages, five-file receiving, complete workspace handover, all 35 merchant tools and the installed Applications restart.

Its original operation is `epa-echo-portfolio-complete-b3909-20261012`. Select the exact published source commit and the matching READY installed runtime described in that guide. The original private journal preserves each completed stage and payment intent through continuation. Actual run outcomes are written by that programme in its operating directory.

## Primary source references

- [EPA ECHO web services](https://echo.epa.gov/tools/web-services)
- [ECHO data descriptions](https://echo.epa.gov/resources/echo-data/about-the-data)
- [ECHO data downloads](https://echo.epa.gov/tools/data-downloads)
- [EPA data licence](https://edg.epa.gov/EPA_Data_License.html)
- [Complete acquired source and carrier receipts](examples/dc-wastewater-source-20261012.json)
