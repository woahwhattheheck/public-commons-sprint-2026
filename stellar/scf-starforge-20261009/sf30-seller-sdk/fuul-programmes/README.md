# Fuul programme operator

A complete operating workspace for commissioning and running a Fuul programme on Stellar: retain the actual programme configuration, map customer activity to native events, deliver whole selections, observe each event pipeline, prepare provider actions, reconcile payouts and claims, and hand over a working independent installation.

The operator is designed for an implementation team running programmes for customers. Its browser, terminal and JavaScript interfaces share the same original programme versions, work queues, captures, decisions, reports and receiving operations. The browser uses a monochrome industrial layout and paged working tables. Complete source files, operation bodies, reports and workspace archives are available for download.

## Open the operator

Use Node 22.16.0 or newer. From a full source checkout:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/fuul-programmes/cli.mjs serve \
  --workspace /absolute/private/fuul-workspace \
  --connections-file /absolute/private/connections.json \
  --port 8776
~~~

Open the local URL printed by the server. After installing the selected product, the equivalent command is:

~~~sh
stellar-fuul-programmes serve \
  --workspace /absolute/private/fuul-workspace \
  --connections-file /absolute/private/connections.json \
  --port 8776
~~~

The same installation appears as **Fuul programmes** in Applications. [APPLICATIONS.md](APPLICATIONS.md) explains product selection, source building, Applications lifecycle, runtime installation and independent receiving.

The server binds to 127.0.0.1 or ::1. Each opening prints its original workspace identity and a local access URL. Keep the same port when reopening a workspace so the browser can recover its saved requests and original uploaded files.

## Connect the original services

Copy [examples/connections.example.json](examples/connections.example.json) to private operator configuration and fill its values from the actual project and installed SDK. Remove aliases you do not need. This is a keyed map of connection aliases; each alias represents a specific provider, project, network and account scope.

| Alias in the template | Original service | Configuration |
| --- | --- | --- |
| fuul_events | Fuul project API | Actual project UUID, project API key, API origin and Stellar network. |
| fuul_dashboard | Fuul dashboard and draft API | Same actual project UUID, original dashboard OAuth token file and account scope. |
| stellar_project | Stellar RPC | Actual RPC URL, project/factory/manager contract roles and the retained original SDK runtime. |

Use **stellar:pubnet / 148** or **stellar:testnet / 1481** consistently. Currency identifiers are original Stellar contract addresses. Event users are original Stellar account addresses. Account scope identifies the actual original Fuul account rather than a changing credential.

The dashboard adapter reads the original Fuul OAuth token format, including its refresh token, from the selected private token file. It follows the original single-refresh flow after an authentication response. API keys and OAuth tokens stay in private configuration outside the operating workspace; the export carries public connection identities and operational source data.

A workspace can open with no connections for reviewing existing reports and sources. Network work uses the corresponding configured original connection. A received workspace is reopened with that receiving operator's private connection configuration.

## Commission a complete programme

Create a programme in **Programmes**, or fill [examples/programme.template.json](examples/programme.template.json) and load it into the editor. The file contains empty original identity fields and one mapping outline.

Set the programme name, actual Fuul project UUID and original network. Add the original contract roles and currencies used by the programme. Retain the original configuration documents and provider responses in **Sources**, then attach their source IDs to the programme.

Each save creates an immutable programme version. Existing events, captures, action requests and editions retain the version they originally selected. The editor opens an existing version with its original version number; a changed current version must be reloaded before another save.

The programme contains:

| Field | Meaning |
| --- | --- |
| contracts | Original contract address and role: factory, manager or project. |
| currencies | Original currency ID, Stellar contract address, chain identifier, decimals and label. |
| mappings | Original activity selection, event name, source identity, user, timestamp, argument fields and optional monetary mappings. |
| providerSourceIds | Retained original configuration sources for the programme. |
| rules | Original accepted programme terms and other structured configuration. |
| period | Optional UTC interval, with an inclusive start and exclusive end. |
| selection | Optional original incentive IDs or slugs, trigger references, audience IDs and tier IDs. |

The reporting period and selected identities limit relevant flow views. Original cumulative claim totals keep their native cumulative scope. Every report retains the edition and source selection that produced it.

## Retain activity and native sources

**Sources** provides original file intake, provider captures and re-projection.

Import complete JSON or CSV customer activity. CSV uses its original header names; all cell values remain strings until a mapping explicitly converts a field. Quoted delimiters, embedded line breaks and escaped quotes preserve the actual cell values. Duplicate or empty headers and malformed records produce an explicit import error alongside the retained original file.

[examples/activity.headers.csv](examples/activity.headers.csv) supplies a header-only intake outline. Fill it with actual source-system activity, or import the customer's existing headers and point mappings at those fields. Give each activity feed a stable source scope identifying its originating customer system.

Fuul and Stellar sources use their original JSON responses. A JSON pointer selects a records array or object, such as /results, /claim_checks or /result/events. An empty pointer selects the root. Re-projecting a retained source appends a new projection over the same original body; the previous source remains available.

Native captures select a connection and an operation from its original catalogue. The browser shows the operation's actual input fields and also accepts a complete read selection. A capture saves its original filters, page size, continuation and pending request before fetching a page. **Continue all selected pages** processes the entire selected source.

The Fuul catalogue includes project drafts, customizations, incentives, triggers, audiences, tiers, pending and historical payouts, programme statistics, chain and currency metadata, exact event pipelines, broad event status, payout allocations and movements, claim checks, claim totals and claim history. Dashboard routes and project API routes use their respective authentication types.

Stellar captures retain original JSON-RPC responses and decode events with the original Fuul SDK and Stellar SDK. Select the original contract set and ledger window. The saved read selection retains its inclusive start, exclusive end, contract roles and original continuation independently of the current RPC response.

Useful terminal equivalents:

~~~sh
stellar-fuul-programmes source-import \
  --workspace /absolute/private/fuul-workspace \
  --programme-id PROGRAMME_UUID \
  --provider activity --kind activity \
  --source-scope customer-system \
  --file /absolute/original/activity.csv \
  --network stellar:pubnet

stellar-fuul-programmes capture-start \
  --workspace /absolute/private/fuul-workspace \
  --connections-file /absolute/private/connections.json \
  --input /absolute/original/capture-selection.json

stellar-fuul-programmes capture-run \
  --workspace /absolute/private/fuul-workspace \
  --connections-file /absolute/private/connections.json \
  --capture-id CAPTURE_UUID --resume-original
~~~

A capture input is the complete method argument object: programmeId, optional programmeVersion, connectionAlias, optional name, and read containing kind, filters and optional pageSize.

## Map and deliver the whole activity selection

A mapping chooses its original provider and kind, the exact Fuul event name, and the source view: original JSON or the decoded native projection.

Set a stable **source namespace** for the originating activity stream and a pointer to the original activity ID. That identity produces the same deduplication identity after reopening or receiving the workspace. For original Stellar events, the decoded native event identity can provide this source identity directly.

Set the user pointer to the actual Stellar account and, when the source supplies it, a pointer to its original timestamp. Constant args and explicit field mappings complete the event arguments. Every mapped field has a source pointer, target argument pointer, required flag and explicit conversion. Supported conversions are json, string, integer, decimal, boolean and timestamp.

Optional **value** and **revenue** mappings select the amount pointer, original programme currency and amount units:

- **base** means the original integer smallest-unit amount.
- **decimal** means an original decimal amount to be converted using that currency's configured precision.

Amounts are converted with integer arithmetic and serialized as native integer strings. Each native value/revenue currency carries the original contract address, stellar_contract identifier type and numeric chain identifier. Keep native amount strings intact in JSON and spreadsheet exports.

In **Events**, select the original activity sources and mapping, then prepare the complete selection. Preparation produces complete native event bodies and a result for every eligible original record. Preparing the same identity and body reuses the original event. A changed body for an existing identity retains the competing body for review and pauses that original event.

In **Runs**, choose **Deliver prepared events**. Leaving the operation selection empty freezes all eligible events in the active programme. The operator groups them by the exact original project connection and creates native batches of up to 100 events. The run retains each task and its request before processing the full selection.

The batch route is the publisher's original POST /api/v1/events/batch. Its accepted count is retained as a batch result. The follow-up **Observe exact event pipelines** run looks up each original event using event_id or the exact dedup_id plus event_name pair.

Native rate-limit responses retain their status, original response and retry interval in the operation result. Resume the retained request when its original provider permits continuation; the same selected body and operation identity are used.

## Work event outcomes and provider actions

Each event, batch and action opens its complete intent, original request, attempts, response files and pending state. The browser supports dispatch, pause, resume, exact event observation and explained outcome resolution.

An interrupted external write becomes **UNCERTAIN** when its original result cannot be recovered. Read the original pipeline or corresponding provider state and attach the retained observations to the operation. An event's exact pipeline must match its original project and identity. A returned conflicting body stays visible for review.

The **Actions** workspace prepares the publisher's original operations:

| Group | Operations |
| --- | --- |
| Events | Submit one complete event or a complete native batch. |
| Claims | Close selected original claim checks or prepare current claimable checks. |
| Payouts | Approve or reject the originally selected payout scope. |
| Triggers | Create, update or delete original project draft triggers. |
| Incentives | Create or delete an incentive draft; replace original draft triggers. |
| Payout terms | Update a selected original incentive payout term. |
| Tiers and audiences | Create or update original tier and audience configuration. |
| Project | Initialize the selected original project chain. |
| Stellar claims | Prepare the original authorization flow and retain the selected signed transaction for native submission. |

Action preparation uses the original MCP normalization and draft-resolution helpers retained in the source capsule. Fresh original project/customization reads are preserved with the preparation. When a selected draft requires project initialization, the initialization is stored as a normal prerequisite action and dispatched in order before the pinned main request. Dispatch retains the prepared original path and body.

A complete **Dispatch prepared provider actions** run freezes and processes the active programme's selected original actions, preserving original prerequisites and task positions across interruptions.

Claim closure, claim preparation, payout allocation, claimable balance and on-chain settlement have distinct stages. The current Stellar claim guide and original generated contract bindings define the authorization entries and native transaction flow. Select **stellar.claim** on the original Stellar connection with the original signed voucher, actual wallet address and maximum fee in stroops. Preparation retains its actual original proof reads, simulated authorization entries and transaction. A signature request returns the prepared transaction for the selected wallet; preparing with that original accepted signed XDR pins the final transaction and request bytes. The original transaction hash is read before submission and used when observing its successful outcome. The source-linked claim view retains the actual transaction, signature, currency and claim-check references available from its original sources.

## Reconcile, compare and report

Create an operating edition in **Editions**. The default selection includes the programme's attached configuration sources and all retained programme sources. Choose a specific source or decision selection when producing a defined comparison.

The edition includes complete original event, pipeline, allocation, movement, claim and exception sections, plus summary and source coverage. It retains the selected programme version, source IDs, decision IDs and as-of time. Provider amounts stay associated with their original currency, chain, native stage and available identity.

When a record needs an operational decision, select its source and original record and save **include**, **exclude** or an explicit reference **link**, with actor and reason. A link can associate an original event ID, deduplication ID and name, payout ID or transaction hash. Superseding a decision creates a new decision against the same original record.

Compare a baseline and subsequent edition from the same programme to inspect original stage, amount, identity and exception changes.

Build an HTML, JSON or CSV report for the whole programme, the original project or one original user. HTML previews use the same retained report artifact as the download. Each format belongs to the same selected report scope. Full CSV and JSON downloads include the complete selected records.

~~~sh
stellar-fuul-programmes reconcile \
  --workspace /absolute/private/fuul-workspace \
  --programme-id PROGRAMME_UUID

stellar-fuul-programmes report-create \
  --workspace /absolute/private/fuul-workspace \
  --reconciliation-id EDITION_UUID

stellar-fuul-programmes report-file \
  --workspace /absolute/private/fuul-workspace \
  --report-id REPORT_UUID --format csv \
  --output /absolute/customer/programme.csv
~~~

## Reopen, recover and receive

Before a browser mutation is sent, the browser stores the complete original method arguments, request UUID, original workspace identity and selected file body in IndexedDB. **Requests and methods** shows requests whose results are still pending. Reopen the same local address and choose **Recover original request** to reuse the exact original body and request identity.

The terminal prints the original request UUID and expected revision for every mutation. Supply the original UUID and input to continue the same intent. **--resume-original** reads the saved arguments of an interrupted capture, operation dispatch or complete run.

The workspace export includes:

- All immutable programme versions and original attached configuration sources.
- Complete original response bodies and projections, native page cursors and pending captures.
- Prepared event and batch bodies, changed-body conflicts, provider actions and ordered prerequisites.
- Complete run selections, task progress, decisions and reconciliation editions.
- All report formats and export records.
- The complete application source cohort and each retained original SDK runtime needed by its original records.

Export from **Export and receive**, download the complete archive, then upload and unpack it at the receiving operator. The manifest hash binds the complete selected package. Inspect the package and receive it into an independent destination. Receiving preserves the full original history and request identities, and pauses unfinished network work for the receiving operator to resume with its configured original connections.

A report package contains its selected complete report artifacts. A workspace package restores an independent operating installation. Both may be inspected and received using the same terminal and browser interfaces.

~~~sh
stellar-fuul-programmes workspace-export \
  --workspace /absolute/private/fuul-workspace \
  --connections-file /absolute/private/connections.json \
  --destination /absolute/deliveries/fuul-workspace

stellar-fuul-programmes package-inspect \
  --source-directory /absolute/deliveries/fuul-workspace

stellar-fuul-programmes package-receive \
  --source-directory /absolute/deliveries/fuul-workspace \
  --destination /absolute/customer/fuul-installation \
  --request-id ORIGINAL_RECEIVING_UUID
~~~

The receiving result contains the received workspace, application and runtime paths. It can be reopened with its own private configuration and exported again with its original source and runtime closure intact.

## Original runtime and source

The original Stellar SDK is built from its retained publisher source using Bun 1.3.12 and TypeScript 5.9.3, then packed and installed into a private Node consumer. Its package graph includes the original SDK 0.3.0 and Stellar SDK 17.2.1.

~~~sh
stellar-fuul-programmes runtime-build \
  --installation-directory /absolute/private/fuul-sdk-install \
  --destination /absolute/private/fuul-sdk-runtime \
  --bun-executable /absolute/bin/bun \
  --npm-executable /absolute/bin/npm
~~~

Omitting --source-directory materializes the unchanged retained publisher source. An explicitly supplied source directory must match the selected original source. Build, retain, verify, restore and bind commands preserve the complete installed package graph and original build inputs. See [APPLICATIONS.md](APPLICATIONS.md) for the full sequence and receiving layout.

The retained source capsules include:

| Capsule | Original source |
| --- | --- |
| source/sdk-stellar.json | fuul-protocol/protocol-sdk-stellar at ea3dc792506a206991d053ef98f888da71c2248f; SDK 0.3.0 under ISC. |
| source/web-sdk.json | kuyen-labs/fuul-sdk at 0f5f61f012258bc336cb8a0cd7849e5bc0c3aba8; Web SDK 7.47.0 under MIT. |
| source/mcp.json | kuyen-labs/mcp_server at 8850cafda1f951bb46e8764e98a4f5bde1ffab0d; MCP 1.17.2 under MIT. |
| source/contracts.json | Original contract and protocol source metadata, source rights and current native guide references. |

Original upstream repositories and guides:

- https://github.com/fuul-protocol/protocol-sdk-stellar
- https://github.com/kuyen-labs/fuul-sdk
- https://github.com/kuyen-labs/mcp_server
- https://docs.fuul.xyz/developer-guide/sending-custom-events-through-the-api
- https://fuul.readme.io/reference/sendbatchevents

The source-files.json manifest describes the complete application and maintained dependency cohort. Original publisher licenses remain with their retained source files. The application is MIT licensed.
