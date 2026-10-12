# Stellar asset review workspace

The workspace turns StellarExpert observations into an asset investigation that an operator can reopen, compare, annotate, export and prepare for a merchant or customer handover. It preserves the original provider responses beside the records used for review. Dataset preparation, merchant release and customer receiving use the existing Stellar Forge services.

## Open the workspace

Use the complete Stellar Forge source checkout or selected release containing this directory and its sibling dataset, release and buyer modules. From the repository root:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/stellar-expert/workspace.mjs \
  --workspace /absolute/private/stellar-asset-workspace
```

The command creates or reopens the named private workspace and prints its local session URL. Open that exact URL on the same machine, or through your agreed private connection to that machine. The default listening port is 8436; `--port` selects another port. The access token is carried in the URL fragment and retained for this browser tab. Keep the session URL with the staff members operating this workspace.

To connect an existing customer inbox at startup:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/stellar-expert/workspace.mjs \
  --workspace /absolute/private/stellar-asset-workspace \
  --inbox /absolute/private/original-buyer-inbox
```

The inbox remains the original SF88 inbox. The workspace reads its existing purchase intents and calls its existing dataset receiving/export operation.

To run a merchant release with the configured payment facilitator, supply a private runtime settings file when opening the workspace:

```json
{
  "port": 0,
  "facilitator": "https://YOUR-SELECTED-FACILITATOR",
  "allowLocalFacilitator": false
}
```

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/stellar-expert/workspace.mjs \
  --workspace /absolute/private/stellar-asset-workspace \
  --inbox /absolute/private/original-buyer-inbox \
  --release-runtime /absolute/private/release-runtime.json
```

Use the facilitator selected for this deployment. Its URL must use HTTPS and contain no credentials, query or fragment. Port 0 lets the original runtime choose an available listener; an explicitly assigned port is also accepted. Local development can use an explicit HTTP loopback facilitator only with "allowLocalFacilitator": true. Without this settings file, the merchant runtime serves the original payment challenge. The workspace reports the selected runtime mode. Release preparation retains that selection with the original operation so a recovered request uses the same configuration.


The command-line interface can also inspect saved state:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/stellar-expert/cli.mjs \
  --workspace /absolute/private/stellar-asset-workspace view
```

Use one running owner for a workspace directory. Stop the active process cleanly before opening that directory from another command-line or browser server process.

## 1. Build an asset investigation

**Watchlist** holds the assets the team follows. Select the network, enter the full asset identity, and add a useful staff label and note. The full issuer identity matters when several assets share a code.

The capture form offers the source operations declared by the connected adapter:

| Capture | Staff use |
| --- | --- |
| Asset search | Find assets by search text and the selected ranking/order. |
| Asset holders | Retain accounts and balances for one asset. |
| Asset activity rating | Review the provider's ledger activity indicators. |
| Issued supply | Retain the provider's decimal supply observation. |
| Account directory | Look up named accounts, addresses and directory tags. |
| Directory tag definitions | Keep the definitions alongside directory research. |
| Community-reported domains | Retain the current reported-domain listing. |
| Domain listing lookup | Check one domain against that listing. |
| Ledger at or before timestamp | Relate an observation time to a ledger. |
| Ledger closing time | Resolve a ledger sequence to its reported closing time. |

For an asset discovery pass, choose **Asset search**, the public network, a search such as `USDC`, the desired order and records per page. Give the capture a label that explains the investigation. The page allowance controls how much source work the pass performs; a retained continuation can continue the same investigation.

**Capture source observations** saves the selected query and starts the source acquisition. Refresh saved state to see the completed pages, record count and any provider continuation. The server continues an accepted capture if the browser tab disconnects. After a process restart, use **Continue capture** on the same saved capture.

The provider's next link is retained with each page. If that link omits a selected query filter, the adapter records the link and the effective continuation URL carrying that original filter. It rejects a continuation that changes the selected source route, origin or filter values.

A source response observed across several pages has an observation interval. Use that interval when interpreting a changing ledger or directory.

## 2. Review the retained source

Open **Source editions** and select an edition. Its source query, capture time, page count, record count and coverage travel together. Newer and older edition controls reach the full retained archive. Selecting a prior edition leaves later editions available.

The records panel pages through the selected edition in groups of 100. The original-response panel opens an exact retained provider page. Each response has its original URL, observed time, byte length and SHA-256 identity. Numeric JSON tokens remain text so that large balances and ledger values survive inspection and export without JavaScript number rounding.

Amount fields keep their documented meaning:

- Holder balances and documented traded/payment amounts are available as original stroops and exact decimal unit strings.
- The supply endpoint's decimal response is retained as asset units.
- An AssetInfo supply field keeps its original numeric text and carries no undocumented conversion.
- Activity ratings describe the provider's ledger activity/popularity measures.

Use **Create edition export** to save JSON, spreadsheet CSV or an offline HTML report. JSON retains source identity, records and review notes. Spreadsheet CSV neutralizes leading formula characters for spreadsheet review. The offline report includes coverage, notes, rows and original response identities. Each completed export has fixed bytes and can be downloaded again.

## 3. Compare and record the review

In **Analysis and notes**, select two editions of the same exact provider query. Load an older edition through Source editions when needed; visited and selected editions remain available in the comparison selector.

The comparison shows counts of added, removed, changed and unchanged records. It compares the retained observations and displays whether each capture covers its completed query. For a partial capture, a missing record describes the captured coverage.

The on-screen change table is a preview. **Download full comparison** downloads the complete retained comparison export, including all additions, removals and changes.

Add a subject, review note and status to the selected edition. The available statuses are **Open**, **Reviewed** and **Follow up**. Notes stay attached to their source edition, allowing a later operator to see which observation a decision used. A later source capture and the prior reviewed edition can both remain in the workspace.

## 4. Prepare and query a dataset

Open **Merchant publications**, confirm the selected source edition, enter the dataset name and choose **Prepare selected edition as a dataset**.

Preparation writes the original SF30 dataset configuration and CSV together with a source manifest and the original retained response files. It records the original dataset content snapshot. The prepared dataset description records its columns, their types and the enabled equality filters, ranges and sort fields. The original publisher initializes the version store when release preparation receives the merchant's explicit payment terms.

Choose **Use dataset** to select a prepared dataset. The query builder offers:

- Output-field selection.
- A record limit within the dataset's configured limit.
- Equality filters on enabled columns.
- Lower and upper bounds on enabled range columns.
- Ascending or descending order on enabled sort columns.
- Original cursor navigation through matching result pages.

Source values that require exact numeric text remain strings. The builder follows the dataset's declared capabilities for those columns. An empty equality value is sent only when its **Use filter** box is selected.

**Advanced query parameters** accepts the original query string directly. For example:

```text
fields=asset,domain,sourceObservedAt&limit=50
```

Only select fields present in that dataset. The result identifies the matching page and continuation; **Next query page** keeps the same selected query and follows its original cursor. The query result can be downloaded as JSON.

## 5. Prepare the merchant handover

The merchant release form uses the selected prepared dataset. Enter the merchant's HTTPS origin and dataset route, then set the payment contract explicitly:

| Setting | Meaning |
| --- | --- |
| Scheme | The original seller's `exact` payment scheme. |
| Network | `stellar:testnet` or `stellar:pubnet`. |
| Asset | The explicitly selected SEP-41 token contract. |
| Atomic amount | The selected positive base-unit integer amount. |
| Receiving account | The merchant's selected receiving address. |
| Timeout | The original contract timeout, from 1 to 86,400 seconds. |

The form starts with the testnet network and a 300-second timeout. The asset, amount and receiving address require staff input.

**Prepare merchant release** calls the original publisher and SF82 release preparation/staging workflow. It keeps the source package, dataset snapshot, seller configuration and version-store binding together. **Inspect original release** reads that same release, its current selection and the original merchant runtime.

Use **Activate release** to select the prepared release, then **Run merchant** to start its original seller. **Stop merchant** ends that managed seller. When a previous release is retained, **Restore previous release** asks the original publisher to restore it. Activation, start and rollback use the current original selection generation; a newer selection is loaded before another change is accepted.

The controls display the active release, selection generation and original merchant runtime. The detailed result keeps the release-store path, source-package path, dataset version directory and the original inspection/console commands for the operating handover. Merchant deployment settings and production payment details remain those selected for that release.

The StellarExpert public API remains available on its documented terms. A workshare engagement covers deployment, investigation workflow, dataset operation and staff handover.

## 6. Receive an existing customer purchase

Open **Customer receiving** on a workspace started with the customer's original inbox. Enter the distinct existing intent IDs in their original page order and choose **Inspect original buyer inbox**.

Review the original queue state and purchase outcomes. Then choose the receiving action for that same selection. It calls the original SF88 queue dataset export and SF100 receiving implementation, keeping the inbox identity, page order, manifest and delivered dataset together.

The saved receiving result shows the dataset name, delivered row and page counts, and the original ordered purchase intents. Use the receiving table’s download controls to get dataset.csv, dataset.jsonl, review.html, delivery.json and manifest.json from the original completed export. Each download is authenticated through this workspace and checked against that export’s retained files. Reopening the same completed receiving operation reads its original manifest and outputs. Staff can continue in the original buyer tools with those existing intents.

## Saved state, conflicts and recovery

The page header shows the workspace's saved revision. A new change uses that revision and a stable operation identity saved in the browser tab before the request is sent.

If another staff page changes the workspace first, the server returns the current revision. Your form values remain in the tab. Load current state, review the updated source and save the retained draft when ready.

If a request loses its response, use the pending-action panel. **Recover saved action** sends the same request with the same operation identity. A still-running response keeps that request pending. A completed response adopts its original result. This supports a browser refresh or reconnection without creating another release, capture request or receiving operation.

The source capture itself has saved progress and a provider continuation. A provider rate-limit response retains its retry time; continue the original capture after that time. Inspect the saved error and source response for other provider failures.

Recent operations are visible in the workspace. Captures, editions, notes, dataset snapshots, merchant releases, receiving results and immutable exports remain in the private workspace directory.

## Reopen, transfer and hand over

Choose a lasting absolute workspace path at first deployment. For backup, stop the active process and copy the complete private workspace and bound original buyer inbox with their permissions. To restore, put the workspace and its referenced dataset/release directories back at their recorded absolute paths, then reopen with the same source release. The original merchant release bindings retain absolute dataset paths, so restoration preserves those paths along with the source and snapshot identities.

A useful operator handover includes the selected source release, the complete private workspace, the relevant original inbox, the chosen merchant settings, and the review/export files the staff will use. Record the selected edition, source observation interval and prepared dataset snapshot with the business question being handed over.

For the first staff session, walk through one asset investigation from source selection to review note and offline report. In the second, prepare its dataset, navigate the exact query results, inspect the merchant release and reopen the saved workspace. Acceptance uses the agreed staff workflow and representative investigations.

## Source and implementation references

- [StellarExpert's published OpenAPI, version 1.4.0](https://github.com/stellar-expert/stellar-expert-explorer/blob/308ef220358192911525272d9ad251225dd1e00b/open-api/openapi.yml).
- [Exact YAML source](https://raw.githubusercontent.com/stellar-expert/stellar-expert-explorer/308ef220358192911525272d9ad251225dd1e00b/open-api/openapi.yml).
- `schema.mjs`: source operations, units and operator descriptors.
- `provider.mjs` and `exact-json.mjs`: provider requests, retained responses and exact numeric parsing.
- `core.mjs`, `store.mjs` and `domain.mjs`: workspace operations, editions, comparisons and exports.
- `dataset.mjs`: composition with the original SF30 dataset, SF82 release and SF88/SF100 receiving services.
