# Stellar settlement audit workspace

A complete institutional operator for treasury receipts, classical Stellar revenue splits, SDP driver payouts, exceptions, corrections and partner reporting. The browser, terminal commands and Applications integration open the same continuing workspace.

The application retains original provider response bytes, the exact policy and contribution versions used for each plan, baseline and following reconciliation editions, and a complete editable source delivery. Its local interface uses a restrained industrial layout: explicit amounts, tabular records, source details and printable reports.

## Start the operator

Use Node.js **22.16 or later** and the complete source checkout. The settlement operator uses Node's built-in modules.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/settlement-audit/cli.mjs serve \
  --workspace /absolute/private/settlement-workspace \
  --connections-file /absolute/private/settlement-connections.json \
  --host 127.0.0.1 \
  --port 0 \
  --startup-format json
~~~

Open the complete local URL printed by this process. It contains the session token needed by that browser. The process stays in the foreground until stopped. Reopening the same workspace directory continues its original UUID and history.

The connections file is optional when reviewing retained work. For new native reads, copy [connections.example.json](examples/connections.example.json) to a private location outside the workspace, then enter the programme's actual SDP base URL, tenant and existing token. The Horizon connection in the template selects the public mainnet service. Select the network that belongs to the programme.

An optional `--profile-file /absolute/private/settlement-profile.json` loads a JSON object with programme fields such as `name`, `organization` and `contact`. The Overview screen can save the same profile.

For an installed package, use `stellar-settlement-audit serve` with the same options. [APPLICATIONS.md](APPLICATIONS.md) covers the complete source selection, installation aliases and managed Applications lifecycle.

## Operate a settlement end to end

| Screen | Operator work |
| --- | --- |
| **Overview** | Identify the continuing programme, current revision and retained work. Save institutional profile details. |
| **Settlement setup** | Save a named policy version, treasury revenue and asset, recipients, contribution inputs and an exact allocation plan. |
| **Native sources** | Capture original SDP and Horizon pages, pause or continue acquisition, import original files, inspect records and save a following source interpretation. |
| **Reconciliation** | Review every planned payment stage, original matching records, exceptions and explained corrections. Compare baseline and following editions. |
| **Partner reports** | Produce and read scoped HTML, JSON and CSV reports from a selected reconciliation edition. |
| **Delivery and receiving** | Export an editable programme or partner report, download its complete archive, inspect an incoming package and receive it on another host. |
| **History** | Read the retained transitions and recover the recorded result of an original request. |

### 1. Save the actual policy and programme inputs

Start from the reference policy or enter the approved programme terms. The reference selects PathPulse's **detailed Revenue Model and Deliverable 6**: authority **50%**, driver pool **30%**, platform **20%**. Its SCOUT1, SCOUT2 and SCOUT3 multipliers are **1**, **1.2** and **1.5**. The policy keeps its original source references and can be versioned for a following approved configuration.

The [current SCF submission](https://communityfund.stellar.org/submissions/recF5sl3yx3vT971T) and [original technical architecture](https://drive.google.com/file/d/19jmuAuX8keASZrlZ0I1DmZ2DUj29NrZD/view) are the retained reference sources. The detailed model's explicit role mapping governs the default. Review the actual programme terms before selecting a saved policy.

Enter the treasury revenue ID, exact amount, network, asset and treasury account. For issued assets, enter the original asset type, code and issuer. Amounts remain decimal strings with up to seven fractional places. The engine allocates integer native units and exact rational weights, including deterministic remainders.

Use the participant table for authority, driver pool, platform and driver accounts. Account fields accept checksum-valid Stellar G or M StrKeys; asset issuers use G accounts. Enter original transaction memos when the programme depends on them. A platform share can remain in the treasury when that participant explicitly selects retained settlement and its account is the treasury account.

Import the original participant and contribution CSVs, or complete the tables. The files are retained before their rows are loaded. Each imported row keeps the source file ID and record ID. [participants.csv](examples/participants.csv) and [contributions.csv](examples/contributions.csv) are editing templates: fill the actual account fields and replace the example contribution with the programme's original approved rows.

| Participant column | Meaning |
| --- | --- |
| `id`, `role`, `account` | Stable participant ID, one of authority / driver_pool / platform / driver, and the actual Stellar account. |
| `partnerId`, `label` | Report scope and human-readable name. |
| `memoType`, `memoValue` | Original none, text, id, hash or return memo. |
| `weight` | Exact positive weight for an allocation shared by participants in the same role. |
| `retain` | `true` only when the platform share is explicitly retained at the treasury. |

Contribution columns are `id,participantId,units,tier,approved`. The approved contribution's selected historical tier determines its weight. The complete batch and policy versions are frozen into each allocation plan. Loading an existing policy or batch records its current version; a competing edit requires reopening that version before saving a following one.

### 2. Capture original SDP and Horizon observations

Choose a configured connection and the original native read kind. The form exposes that route's actual filters and page-size limits.

The SDP adapter supports payments, disbursements, their receiver lists, receivers, assets, wallets, distribution wallets and audit history, and organisation detail. It retains complete response bodies and follows the provider's original continuation.

The Horizon adapter supports root, account, transaction, operation, ledger, payments, operations and transactions. It reads the original root to verify the network and record the available ledger horizon. An omitted final ledger freezes at the observed latest ledger. An explicit first ledger must be available from that original service.

Use a scope appropriate to the programme: its actual account, transaction, ledger range or native SDP filters. Start the capture, then continue through the original pages. A capture can be paused while other programme work proceeds. Resume its saved continuation to retain the remaining pages.

Each observation retains the original request identity, response status and headers, complete or interrupted body bytes, observed time, selected records and any original provider error. The connection's provider, endpoint and tenant/wallet scope determine its source identity across pages. The stored public connection description contains the origin; credentials stay in the private configuration file.

For original files already obtained from the programme, import the complete JSON or document. SDP pages normally use the record pointer `/data`; Horizon lists use `/_embedded/records`. Use an empty pointer for a root array, or `$` for one root object in the browser. The source detail panel can save a following interpretation of those same original bytes.

### 3. Reconcile treasury, split and driver payout stages

Create a baseline reconciliation from the exact saved plan and selected source observations. The engine joins the original network, asset and issuer, amount, accounts, memo, transaction hash, native status and source scope.

The treasury split and driver payouts are separate stages. In the default atomic split mode, outward split legs must belong to the same successful original Stellar transaction. A driver payout joins its SDP payment to the corresponding successful Horizon operation. The driver pool's incoming 30% and its outgoing driver allocations remain separate legs in the report.

The review exposes matched, missing, pending, failed, mismatched and ambiguous legs, with original record references. It accounts for current SDP status observations, conflicting assignments, repeated use of an operation, explicit installments and clawback exceptions. Inspect the original records from the source panel when resolving an exception.

Append an assignment, exclusion or note with its reason. An assignment names the selected provider record for a particular leg. A following assignment replaces that selected provider side while preserving prior corrections in history. Save a following reconciliation after applying the desired correction set or capturing later original observations.

Baseline and following comparisons use stable participant and stage keys. A new plan UUID does not make every unchanged participant look like a different payment. Select a partner ID when creating a report to retain that partner's relevant participants, legs, source references and corrections.

### 4. Deliver reports or the editable programme

A **report delivery** contains the selected report edition and its HTML, JSON and CSV files. It can include the complete source application when selected.

A **workspace delivery** contains the complete editable programme and the complete source application. It retains the original workspace identity, policy and batch versions, source observations, plans, reconciliation editions, reports and transition chain. Private connection credentials are supplied separately on the receiving host.

Export to a new absolute directory outside the active workspace. The export pins the original selected revision and complete source generation. An interrupted copy resumes that same selection even after other workspace operations advance the programme. Its final acknowledgement is added to the then-current programme without replacing intervening work.

Download the complete `tar.gz` archive through the browser. Supported browsers stream the archive directly to the selected file. The delivery manifest and all declared file identities travel with it.

On the receiving host:

1. Open the receiving screen and select the complete archive.
2. Unpack it into the application's private inbox and inspect the declared manifest.
3. Choose an independent destination and receive the complete package.
4. Open the returned workspace with the returned source application, or select it in Applications.
5. Configure private source aliases on that host before taking new remote observations.

Receiving retains the original UUID and appends a receiving transition. Active captures open paused with their saved continuation. Repeating the original receive request recovers its result, including after the received workspace has advanced.

The generated delivery guide contains the exact source and receiving commands for that package. A directory that has already been unpacked can also be inspected and received directly:

~~~sh
stellar-settlement-audit delivery-inspect \
  --source-directory /absolute/incoming/settlement-delivery

stellar-settlement-audit delivery-receive \
  --source-directory /absolute/incoming/settlement-delivery \
  --destination /absolute/private/received-programme \
  --request-id ORIGINAL_REQUEST_UUID
~~~

Use the actual generated UUID in place of `ORIGINAL_REQUEST_UUID`. The command generates and prints one when the option is omitted. Keep it for the original operation.

## Terminal and programming interface

~~~sh
stellar-settlement-audit methods
stellar-settlement-audit state --workspace /absolute/private/settlement-workspace
stellar-settlement-audit source-catalog \
  --workspace /absolute/private/settlement-workspace \
  --connections-file /absolute/private/settlement-connections.json

stellar-settlement-audit invoke \
  --workspace /absolute/private/settlement-workspace \
  --connections-file /absolute/private/settlement-connections.json \
  --method capture.start \
  --input /absolute/private/capture-request.json
~~~

For example, the request file for the existing programme's SDP payment feed is:

~~~json
{
  "connectionAlias": "programme-sdp",
  "name": "Programme SDP payments",
  "read": {
    "kind": "payments",
    "pageSize": 100,
    "filters": {
      "sort": "updated_at",
      "direction": "asc"
    }
  }
}
~~~

Continue the returned capture ID:

~~~sh
stellar-settlement-audit capture-run \
  --workspace /absolute/private/settlement-workspace \
  --connections-file /absolute/private/settlement-connections.json \
  --capture-id CAPTURE_UUID \
  --resume-original
~~~

The command prints the chosen request UUID and expected workspace revision to stderr before a mutation. Supply `--request-id` and `--expected-revision` to repeat an exact request. Its original arguments and recorded result determine replay. The browser tracks interrupted operations separately, so an ongoing capture and another saved operation retain independent recovery requests.

`invoke --method METHOD --input FILE` exposes every operator method, including fields that need structured JSON. Use `--input -` for complete JSON from stdin. Named aliases cover the normal policy, batch, source, capture, plan, correction, reconciliation, report and delivery operations. `--expected-version` guards an existing policy or batch edit.

For a complete original source or report file, use `source-file` or `report-file` with `--output /absolute/new-file`. File output creates a new private file. Request lookup uses `request-status --request-id UUID`. `history` reads the selected original transition chain.

Applications and other Node callers open the same native operator:

~~~js
import {openSettlementAuditOperator} from './operator.mjs';

const operator = await openSettlementAuditOperator({
  workspaceDirectory: '/absolute/private/settlement-workspace',
  connections: privateConnections
});
try {
  const state = await operator.describe();
  const methods = operator.methods();
  const result = await operator.invoke({
    method: 'request.status',
    args: {requestId: originalRequestId}
  });
} finally {
  await operator.close();
}
~~~

## Native rules and retained source

| Component | Source retained with the application |
| --- | --- |
| SDP backend | `stellar/stellar-disbursement-platform-backend` at `4330f131e8a2638a10767ec8db50a98f22672a61`. |
| SDP OpenAPI | Original version 7.0.0 from `stellar/stellar-docs` at `0886fb75182106bdd1b33c3aeae52bb5fe122b0a`. |
| Horizon API | Original `stellar/js-stellar-sdk` version 17.0.1 at `74ac883871396138e1882a3ca4bcec7e4ace76b5`. |
| Complete application | `source-files.json` names the exact retained source cohort and original bytes for source-owned workspace deliveries. |

The complete original SDP and Horizon source capsules include their licenses under `source/`. Adapters enforce their native page shapes, filters, network passphrases and original continuation scope.

The operator listens on the selected loopback address. API requests require its session token and matching origin. New remote observations use HTTPS, or a connection that explicitly selects private HTTP. Each capture has its own acquisition lock; workspace mutations hold the writer only for their retained transitions. Shutdown interrupts native reads and closes the local operator.

Source records and editions use immutable files. The current state points to its exact retained history chain; recovery follows that chain and the original pending transition. Delivery verifies every declared member, application source generation and receiving identity before continuing the programme.

## Programme handoff

Keep the selected policy and batch versions, baseline and following editions, partner report IDs, delivery manifest identity and receiving location with the programme's operating notes. These identify the complete work that the next operator opens and allow the institution to trace a reported settlement back to its original inputs and observations.
