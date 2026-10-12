# Request311 municipal service follow-through

This operating programme assembles a complete saved service desk from original municipal requests and work orders. It exercises the same browser, SQLite workspace, command line and merchant client that are shipped with the product.

The product is in:

`stellar/scf-starforge-20261009/sf30-seller-sdk/open311/follow-through/`

## The deliverable

The complete handover contains the original source packages, their field mappings, saved operating editions, assigned internal work, returned review files and review decisions, explicitly selected dispatches, and receiving workspaces. A receiving operator can open the complete workspace JSON in a fresh desk and continue the existing assignments.

The programme uses the source edition's real rows throughout. Source request status stays distinct from the team's saved work status. Every request and work order retains its complete original attributes, coordinates and source identity. Work assignments in this operation belong to the internal integration desk.

The default browser uses neutral industrial styling, keyboard-accessible controls, complete editable field profiles, paginated request and order views, source comparisons and an explicit approved-work selection.

## Original municipal inputs

| Source | Complete original selection | Operating use |
| --- | --- | --- |
| Manatee QAlert / Cityworks | 23 requests created October 8, 2026, 08:00–12:00 UTC; independent pages of 10, 10 and 3; 11 requests selected by their October 12 closing date; original public work-order error responses | Request-only operating editions, work-needed flags, original date-cohort comparison and retained request references |
| Omaha Cityworks hotline | 41 requests created October 8, 2026, 14:00–16:00 UTC; independent pages of 20, 20 and 1 | Original request editions, 39 located points and two retained empty source points |
| Omaha Cityworks stormwater | 26 original October work orders; independent pages of 10, 10 and 6 | Work-order search, literal date text, source cost precision and original order-edition comparisons |

The complete original source packets are selected separately from product source. Their exact identities are:

| Original source packet | Bytes | SHA-256 |
| --- | ---: | --- |
| Manatee original | 71,519 | acca04cc9fe74f71124fe872cb1e01ce6e585e627a0d61fca3504bc81fa9a90f |
| Manatee continuation | 92,345 | 5f293d17d4467399a0330337d7746d76d73a3df434375ee1962976d63cc67a77 |
| Omaha requests and work orders | 197,880 | 46de0f73a86db1664d5e6891de05adf4b3822c3ce90d6c2d2eebcf004cd1db16 |

Manatee's query response declares WGS84 while retaining mixed projected magnitudes. Its saved profile therefore keeps the original geometry and presents each request as unlocated until a reviewer supplies a justified interpretation. The two Omaha empty points retain their original source representation. Omaha order dates remain literal strings, and order costs retain their recorded precision with an undeclared unit.

Omaha's order metadata identifies a generated hash-derived ArcGIS object identifier. Sixteen original order features change only in that generated identifier across the independent page traversal. The order comparison reports those sixteen original changes and distinguishes them from business-field changes. Original objects and their exact content hashes remain separate.

## Run the complete native operation

Use an existing Node runtime that supports `node:sqlite`, an installed Playwright module and its Chromium executable. Original data and product files are provided as a complete source bundle with schema `commons.follow-through.native-operating-source.v1`.

```bash
python3 -u operations/request311-follow-through-8e5f-20261012/launch-follow-through.py \
  --input /absolute/path/original-operating-source.json \
  --parent /absolute/path/private-work-area \
  --node /absolute/path/node \
  --playwright-module /absolute/path/playwright/index.js \
  --chromium /absolute/path/chromium \
  --wait-for-delivery
```

The launcher writes a new private work directory. It retains complete original UTF-8 file bodies, checks each selected original identity, selects the installed browser runtime and starts the source programme. The runner uses the browser for original-file import, mapping, source editions, assignments, review choices, dispatch downloads and editable receiving. The native API, command line and merchant client operate those same original records.

The source bundle contains these fields:

| Field | Contents |
| --- | --- |
| `sourceFiles` | Complete repo-relative product, operating and original runtime dependency files; each includes path, content, bytes and SHA-256, plus Git blob when retained |
| `originalFiles` | Complete original municipal packets, with exact relative path and byte identity |
| `configuration` | Named city scenarios, exact capture choices, explicit field profiles and source dates |
| `productRoot` | Repo-relative follow-through product directory |
| `operationPath` | This directory's `operate-follow-through.mjs` |
| `sinkPath` | This directory's `deliver-archive.py` |
| `productEdition` | Original source-edition identifiers used for the complete operation |

An existing workspace owner can also invoke the native source programme directly:

```bash
node operations/request311-follow-through-8e5f-20261012/operate-follow-through.mjs \
  /absolute/path/run-config.json
```

That config uses complete absolute paths for the selected product, output, Playwright and original files. Its city scenarios keep source capture selection, field interpretation and expected original row counts together. The direct programme returns its saved `operation.json` and all editable operating outputs.

## Complete operating sequence

1. Receive every selected original municipal response, including the retained Manatee work-order error.
2. Save the explicit original field profile for each city.
3. Build the full original request edition and browse its complete pagination.
4. Assign and approve three real internal integration actions, retaining original request values.
5. Build independently paged editions, carry unchanged assignments forward and compare original requests and work orders.
6. Open the actual Manatee closure-date cohort as another explicit source selection.
7. Search the complete original Omaha work orders and inspect their original values.
8. Export an editable review, receive returned changes, apply separate acceptance and rejection decisions, and reopen a retained pending choice.
9. Select two current approved actions and export their exact JSON, CSV, GeoJSON and HTML dispatch.
10. Save a complete editable workspace after each finished city.
11. Export the complete combined workspace, receive it through the browser, recover an interrupted return of the same committed receiving operation and continue an assignment.
12. Reopen the saved receiving desk, use the command line for another complete receiving hop, and read every original city through the installed merchant client and retained-file download interface.

The operation records actual failures and keeps its original source and completed work available for continuation. A parser return, staged file or uploaded archive is separate from a completed operating sequence.

## Deliver the complete archive during its process lifetime

The launcher saves and fsyncs the complete ZIP before offering it for delivery. The archive includes product and operating source, original municipal input files, editable workspaces and selected dispatches. Browser inspection screenshots stay in the native work directory.

`deliver-archive.py` consumes an exact `commons.native.archive.v1` descriptor:

```json
{
  "schema": "commons.native.archive.v1",
  "path": "/absolute/path/complete-workspace.zip",
  "filename": "complete-workspace.zip",
  "bytes": 123456,
  "sha256": "<the complete original archive SHA-256>"
}
```

The operator receives `OPEN311_LOCAL_UPLOAD_READY`, prepares the exact Slack file, and supplies the returned upload URL unchanged through stdin. The sink streams the retained ZIP, saves the original prepared file identity and emits `OPEN311_LOCAL_UPLOAD_RESULT`. After the operator finalizes that same Slack file, it sends a `finalized` command with the actual file destination. The sink fsyncs the durable destination record before returning.

A lost upload response preserves the original prepared file ID and requests reconciliation of that file. A delivery-only continuation uses the same descriptor:

```bash
python3 -u operations/request311-follow-through-8e5f-20261012/deliver-archive.py \
  --descriptor /absolute/path/archive-descriptor.json
```

A finalized descriptor returns its original destination without another upload. The shared city carrier can use this same sink to deliver a completed city phase before starting a later phase.

## Continue the desk

Open the product's `WORKSPACE.md` for browser operation, `INSTALL.md` for an installed workspace, and `MCP.md` for the complete typed merchant workflow. The original `core-commissioning/` subdirectory retains the earlier executed source edition and its result alongside this broader operating programme.

## Acquire the complete installed source

The companion `prepare-installed-source.py` fetches the complete maintained merchant repository at accepted commit `f4a19e42f3313fefbd63e7a5bf5067d97c091c36` and requires original tree `c2f415d19b7be349ddeff05822c2f5d82a50981a`. Its selected package is `open311-follow-through`, which includes municipal collection, reporting, GIS and request/work-order follow-through.

Run it in an existing private directory with sufficient space for the complete original Git objects and compressed archive:

```bash
OPEN311_SOURCE_PARENT=/absolute/path/private-source-area \\
python3 -u operations/request311-follow-through-8e5f-20261012/prepare-installed-source.py </dev/null
```

The compact `SOURCE_READY` record identifies the whole archive path, byte count, SHA-256, source commit/tree and complete file count. The archive contains the shallow bare repository, original commit body, complete source inventory and exact offline builder command. Extract it into a new private directory, then use its included README to clone that original repository locally and build the selected package. The product's `INSTALL.md` continues through the maintained private-runtime preparation and all four Applications.

For a process that remains attached to stdin, the same producer accepts `upload` with the exact prepared `uploadUrl`, `fileId` and original `expectedSha256`. It streams the complete archive and returns its actual HTTP result. Finalize that original file through the selected destination, then send `finish`. The source commit, tree and archive identity stay attached to this single transfer.
