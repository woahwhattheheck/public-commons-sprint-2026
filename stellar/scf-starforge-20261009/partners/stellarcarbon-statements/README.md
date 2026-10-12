# Stellarcarbon customer contributions and statements

A complete local operations desk over Stellarcarbon's original records. Staff retain whole source editions, assign contributions to customers and customer projects, inspect sinking transactions and retirement certificates, produce dated statements, compare editions, and hand the editable workspace to the next operator. A connected Merchant accounting workspace supplies its original customer identities, invoice controller and payment plans.

The application includes the source engine, complete browser desk, private workspace store, native API acquisition, exports, Node and browser interfaces, command, and source-owned Merchant Applications registration. [Operator guide](../../../../products/stellarcarbon-statements/README.md).

## Run the original source

Use Node 22 or newer on Linux with the existing Merchant runtime's flock executable. The desk adds no npm dependency. Run from this repository's root:

~~~sh
node stellar/scf-starforge-20261009/partners/stellarcarbon-statements/cli.mjs init \
  --directory "$HOME/stellarcarbon-workspace" --name "Stellarcarbon statements"

node stellar/scf-starforge-20261009/partners/stellarcarbon-statements/cli.mjs import \
  --directory "$HOME/stellarcarbon-workspace" --retained \
  --label "sc-data d7c10873 — original complete edition"

node stellar/scf-starforge-20261009/partners/stellarcarbon-statements/cli.mjs serve \
  --directory "$HOME/stellarcarbon-workspace" --port 0
~~~

Open the exact local URL printed by serve. Stop this process before using a separate CLI writer against the same workspace. In the installed Merchant product the same command is **starforge stellarcarbon-statements**; its entrypoint and browser files are contributed by [stellarcarbon-statements.json](../../distribution/contributions/stellarcarbon-statements.json).

The existing Applications catalog exposes **Stellarcarbon customer statements**. Select the initialized private directory and, optionally, the original Merchant accounting directory. The provider pins the statements workspace identity and both the accounting identity and its source configuration. It uses the original Review, Save, Start, Open, Stop and receiving lifecycle.

## Original retained edition

The complete [source-edition](source-edition/) contains the seven original unmodified NDJSON tables from [stellarcarbon/sc-data at d7c10873e98993616af561dd3d00a6e0ae81e3cc](https://github.com/stellarcarbon/sc-data/tree/d7c10873e98993616af561dd3d00a6e0ae81e3cc/sc-audit). The [manifest](source-edition/manifest.json) retains each original path, Git blob and source URL. The original [MIT license](source-edition/LICENSE) travels with the data.

| Native table | Whole rows | Original bytes | Primary identity |
| --- | ---: | ---: | --- |
| distribution_txs | 37 | 8,602 | toid |
| minted_blocks | 9 | 3,195 | serial_hash |
| retirement_from_block | 24 | 1,872 | retirement_id, block_hash |
| retirements | 24 | 9,458 | certificate_id |
| sink_status | 42 | 3,606 | sinking_tx_hash, certificate_id |
| sinking_txs | 39 | 16,064 | hash; distinct toid |
| vcs_projects | 1 | 225 | id |
| **Total** | **176** | **43,022** | |

Sinking records run from 2021-11-20 through 2026-03-03. Their original total is **49.158 CARBON**, of which **49.000** is allocated to retirement certificates and **0.158** remains. Thirty-eight contributions are complete and one is partially filled. The source edition is selected and dated explicitly in every report.

The importer follows the native schemas and loader in [stellarcarbon/sc-audit at 665ec959c7267f692b9def9ffd9252edcadffdd1](https://github.com/stellarcarbon/sc-audit/tree/665ec959c7267f692b9def9ffd9252edcadffdd1). Source.mjs lists the positional columns, keys, decimal scales and relationships.

## Precision and period semantics

Raw JSON number tokens become strings before JSON parsing. Source TOIDs such as **257032605592502272** remain exact. CARBON and allocation quantities use integer arithmetic at three decimal places; native asset quantities use seven. Original NDJSON and response bodies remain separate from normalized rows and download unchanged.

A statement selects contribution creation dates from its inclusive start through its exclusive end. It includes **every linked allocation known in that retained edition**, including certificates dated after the contribution period. A separately dated retirement register selects certificate retirement dates using the same inclusive/exclusive bounds. Its full certificate quantity appears once per certificate; attributed CARBON appears in its own column.

The native finalized flag marks the allocation that completed a sinking transaction. Earlier false rows remain part of its allocation total. The engine sums every related fill and computes remaining CARBON from the contribution amount. It retains the native any-finalized status separately. Beneficiary filtering follows the native prefix match, including values ending in "via stellarcarbon.io".

Source funders, recipients and VCS projects are preserved. A customer's name, project and source assignment are explicit operator records. Assignment precedence is transaction, then recipient, then funder. Conflicting assignments at the highest applicable precedence remain visible for operator correction. Optional start/end dates and deactivation preserve earlier work.

Saved statement versions freeze their selected source edition, contribution and certificate rows, customer/project metadata and relevant assignment snapshot. Later assignment edits or imported editions create a new statement version when the operator saves a revision. Previous versions remain available.

## Complete native API acquisition

The public contract is the original [OpenAPI 0.23.0](https://github.com/stellarcarbon/sc-sdk-typescript/blob/1f24e670d3c30414ccba0bd68b2268e7e5a130aa/openapi.json). Mainnet uses https://api.stellarcarbon.io; testnet is an explicit separate selection. Public GET requests require no API key.

~~~sh
node stellar/scf-starforge-20261009/partners/stellarcarbon-statements/cli.mjs capture \
  --directory "$HOME/stellarcarbon-workspace" \
  --from 2025-09-01 --before 2025-10-01 \
  --label "September 2025 — native API acquisition"
~~~

The browser's **Import and receive** page offers the same route. Acquisition reads /sink-txs/ and /retirements/ in ascending order until each returns an empty terminal page, preserving exact TOID/certificate cursors. It then loads linked certificate details and all connected sinking transactions until the relationship set is complete. This retains later retirement allocations and related records outside the selected contribution window.

Every response body, original URL, retrieval timestamp, source network and selection travels with the edition. Provider aggregate fields retain their own labels on the first and terminal pages; page totals are not added together. The acquisition interval describes the capture. An interrupted request leaves api-capture.json; resume uses the identical original network, period and page size and reuses its retained response bodies.

The public API exposes sinking records, allocations, certificate details, project details and retirement-to-block links. Full distribution and minted-block tables come from the native seven-table backup. An API edition declares its available tables; its normalized empty table arrays do not assert that the original database contains no such records. Use the raw backup when those complete original tables are needed.

The capture uses the two official public API hosts, request timeouts, explicit redirect handling and Retry-After-aware responses to HTTP 429. Failed or incomplete acquisition remains resumable. It does not become a completed edition.

## Original Merchant invoicing

Launch with --accounting-directory to mount the original receivables, payment-plan and customer-account handlers alongside this desk.

1. Link the operator customer to an existing Merchant customer.
2. Save the dated customer statement.
3. Enter the agreed service fee, currency, invoice date and due date.
4. The original invoice controller creates a draft and the statement stores its invoice link.
5. Continue through original receivables and calendar payment plans.

The service fee is an explicit operator amount. CARBON quantities and source token payments do not become an inferred invoice price. Each statement version maps to a stable original invoice request identity. If the invoice saves before its local statement link, a retry recovers that invoice from the original Merchant request journal.

Accounting.mjs calls the original receivables.saveDraft. Server.mjs composes the original prepared HTTP handler. Calendar payment plans retain their original fixed-day, monthly, quarterly and annual implementation.

## API and command surfaces

The browser client is StellarcarbonClient from client.mjs, with declarations in client.d.mts. The Node entrypoint is index.mjs/index.d.mts; core.mjs contains the environment-independent native intake, statement engine and exports. The installed exports are ./stellarcarbon, ./stellarcarbon/core, ./stellarcarbon/client, ./stellarcarbon/server and ./stellarcarbon/capture.

| HTTP route | Complete operation |
| --- | --- |
| GET /api/state | Source inventory, operator records, saved versions, invoice links and history |
| GET /api/contributions | Filtered paged contributions and complete selection totals |
| GET /api/contributions/:hash | Full transaction, assignment, allocations and linked certificate details |
| GET /api/retirements | Independently dated paged certificate register and totals |
| GET /api/retirements/:id | Full certificate, related allocations and original blocks when present |
| GET /api/editions/:id | Original selection metadata and all retained file/response links |
| GET /api/editions/:id/tables/:table | Paged complete normalized native table |
| GET /api/editions/:id/source/:file | Original whole NDJSON file or API response |
| POST /api/import | All seven whole native files, or retained edition selection |
| POST /api/capture; GET /api/capture | Start/resume acquisition and observe progress |
| POST /api/operations/:action | Customer, project, assignment, statement or workspace-name operation |
| POST /api/preview | Complete unsaved period statement |
| GET /api/statements/:id | Saved immutable version, selected with version query |
| GET /api/statements/:id/files/:name | Complete JSON, print HTML or one of three CSV exports |
| GET /api/compare | Complete keyed changes across all seven tables, JSON or CSV |
| POST /api/statements/:id/invoice | Create/recover an original Merchant draft invoice |
| GET /api/handover | Whole editable workspace and every retained source edition |
| POST /api/receive | Receive in a new private directory and open its local desk |

Mutations carry the current revision, stable requestId and actor, with the action's complete value. The HTTP client binds its workspace identity from its own /api/state response and sends X-Stellarcarbon-Workspace on writes. Receiving another workspace leaves the original client's binding intact.

Existing records carry id and expectedVersion. Date queries use fromDate and beforeDate; native cursors remain strings. --help lists every CLI command. Mutation commands take the complete JSON value via --file. Statement export writes all five files into a new private directory. Source prints one original file or response. Handover and receive transfer the complete saved workspace.

## Receiving and durability

The private store reuses Merchant's existing owner-controlled paths, no-follow reads, exclusive kernel lease, atomic replacement and directory fsync. A receive cannot overwrite an existing saved workspace.json. Source hashes cover original files, responses and derived rows. A read revalidates their relationships and native-file reconstruction.

A full handover includes all source editions, customer/project assignments, immutable statements, invoice references, operation replay data and history. Receive to a new private directory; it can open and edit independently with the same source identities. Statement exports are customer period documents; whole-workspace transfer is a staff handover containing all customers.

The browser binds to loopback, checks its selected host and request origin, requires the workspace header for writes, escapes displayed text, and serves its registered assets. CSV export protects spreadsheet formula prefixes. Unchanged raw files remain available alongside these presentation exports.

## Engineering validation

One focused journey executed the actual source parser, statement engine and export code over all seven retained original files. It checked whole-source totals, September/November/March periods, exact original TOID, assignment using the original recipient, two saved statement versions, original metadata snapshots, full receive followed by the next edit, native keyed comparison and all five complete exports.

An independent source review checked official native schema/API semantics, all-fill retirement quantities, date-window differences, complete paging and relation closure, private receiving and original invoice request recovery. The package supplies the maintained native launch and receiving commands for a Node/Linux and browser operator.
