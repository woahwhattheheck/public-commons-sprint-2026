# Bitwave reconciliation in the merchant workspace

Open **Bitwave reconciliation** from the original accountant area, or open
`/bitwave.html` on the running merchant workspace. The page carries a selected
accountant handoff into Bitwave Data Fusion, retains the native responses,
compares their exact source fields, and saves the accepted bookkeeping changes
through the original accountant return engine.

The handoff, its saved returns, original accounting report, and period close
remain the source of each plan. A later return becomes an explicit new source
version when preparing another plan. Every plan and received set can be reopened.

## Open the retained workspace

Use the Node 22+ merchant host and existing private workspace described in the
[workspace guide](README.md). From the repository root:

```sh
node stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/server.mjs \
  --workspace /private/merchant/accounting-workspace
```

Open the printed local address and append `/bitwave.html`. To initialize the
merchant's sources and prepare its first accountant handoff, follow the
[accountant workflow](../accountant/README.md).

Native actions use the access token already configured as
`BITWAVE_ACCESS_TOKEN` in the server's environment. The connection panel shows
whether it is available and identifies the API host. Token issuance and renewal
follow the team's existing Bitwave credentials workflow and the
[official authentication reference](https://docs.bitwave.io/reference/gettoken).
The operator works with organization and data-source identities in the page;
the server adds its Bearer authorization header to native API requests.

Request downloads and received-page imports are also available to teams using
an existing Bitwave integration. They use the same frozen plan and comparison.

## Prepare the exact source

1. Enter the operator or reviewer name in the sidebar. It accompanies plans,
   table bindings, native operations, received sets, and saved accountant returns.
2. Select an **Original accountant handoff**. Choose **Original handoff** or an
   explicitly named **Retained accountant version**. When a handoff has saved
   returns, the latest one is initially selected and its name is displayed.
3. Enter the native Bitwave organization ID, a useful plan name and source
   description. Choose 1–250 rows per native request; the page starts at 100.
4. Select **Retain Bitwave plan**. The resulting plan freezes the selected source
   version, all its accountant rows, native schema, and ordered request batches.
5. Inspect **Frozen original rows**. Search by event, amount, network or reference,
   then select a row to see every field. The source identity section links the
   original report, handoff, selected return and period close where present.

All Data Fusion columns use `stringType`. Atomic amounts, quoted values, account
codes, timestamps, empty values and long identifiers retain their original
string representations. The native primary key, `accountantExportRowId`, derives
from the plan ID and original accountant row ID. Successive frozen exports can
therefore share a native table while keeping distinct row identities. The
original `rowId` remains available for the accountant comparison.

The official [loaded data-source reference](https://docs.bitwave.io/docs/api-loaded-data-sources)
defines the create schema, required primary-key field and row insertion API.
The plan includes those request files ready for inspection and download.

## Create or bind, deliver and read back

On **Native plan & requests**, use **Create native data source** to create the
plan's table in its selected organization. The saved native response supplies
the exact data-source ID. To use an existing compatible table, expand
**Use an existing data source**, enter its ID and a selection note, and retain
that binding. Review the plan's complete schema when choosing an existing table.

Select **Upload retained batches**, then **Capture native rows**. Progress shows
each requested operation. The server saves request files and response bytes as
it proceeds. A completed upload is followed by a separate capture so that the
received rows can be compared with the frozen export.

The native transport uses the following Data Fusion routes on
`https://api4.bitwave.io`:

| Action | Native route |
| --- | --- |
| Create the loaded table | `POST /v3/orgs/{orgId}/data-sources` |
| Add a retained batch | `POST /v3/orgs/{orgId}/data-sources/{dataSourceId}/add-rows` |
| Capture named row objects | `GET /v3/orgs/{orgId}/data-sources/{dataSourceId}/table-rows` |

The [official row retrieval reference](https://docs.bitwave.io/docs/get-datasource-rows)
describes the table-rows API. This transport requests pages of 250 rows and
follows the returned page token. Received JSON contains named objects in
`items`, with `totalRows` and `nextPageToken` when supplied by that endpoint.

**Stop after current request** finishes recording the in-flight response before
pausing. Earlier completed steps remain in **Operation history**.
The page periodically reads local progress while an operation is running.

### Continue an interrupted operation

| Saved state | Operator action |
| --- | --- |
| The browser lost the submission response | Use **Read or retry the same operation**. The retained request ID and exact payload identify the original submission. |
| Capture retained some native pages and a continuation cursor | Select that received set and use **Continue received native pages**. The next capture includes its original pages and continues at the retained cursor. |
| Capture is partial without a continuation cursor, or totals changed | Start a fresh native capture and inspect the new complete response. Earlier pages stay retained. |
| Delivery has an uncertain batch | Capture the current native table, then review its source comparison. |
| A complete current native capture has missing rows, with zero changed or duplicate source rows | Use **Send reviewed missing rows**. It sends only the selected comparison's missing source rows. Capture the table again afterward. |
| Table creation completed without a readable native identity | Inspect the retained request/response and the native data-source list; bind the exact created table to this plan. |

Missing-row repair is available only for a complete native capture made after
the latest delivery attempt. Its comparison identity travels with the action.
If the table changed during the work, a new capture supplies the current rows.

## Import and compare received pages

On **Received rows**, select the original downloaded JSON page files in their
response order, give the set a name, and choose **Retain received rows**. The
import accepts 1–500 nonempty UTF-8 JSON pages totaling up to 64 MiB. The file
summary lists their order before saving. A corrected or later download becomes
another retained received set.

Select a received set to see capture coverage and source comparison separately.
**COMPLETE** describes the received page sequence. The match counts describe
how those rows compare with this exact frozen export:

| Match result | Meaning and useful action |
| --- | --- |
| `MATCHED` | The native export identity and every protected source field match. Inspect its returned bookkeeping fields and preview them in the original accountant. |
| `CHANGED` | A source field changed, is missing, or has a different type. Open the row to compare original and received values, correct the native source representation, and capture again. |
| `MISSING` | This expected source row is absent. Complete the page capture, or use the reviewed missing-row delivery action when available. |
| `UNKNOWN` | The received identity belongs outside this frozen export, including another retained export in a shared table. Inspect it separately. |
| `DUPLICATE` | More than one received row carries the same selected export identity. Open all copies, resolve the native duplication, and capture again. |

The filters and row detail retain full values for investigation. Source amounts,
network, transfer classification, original quote and row identity stay attached
to their original event. Table receipt and bookkeeping status are displayed as
separate facts.

## Preview corrections and save the accountant return

The returned bookkeeping fields are `externalStatus`, `externalBookRef`,
`externalAccountCode` and `externalNote`. Keep them as strings. The original
accountant matcher validates the field values and inherited partial progress.

1. Select the received set, name its accountant return, and choose
   **Preview matched accountant return**.
2. Read the original matcher results and exact return CSV. The preview compares
   against the handoff's current saved return, even when the Bitwave plan was
   created from an earlier version.
3. Review any **Bookkeeping edits to reconcile**. Each conflicting field shows
   its exported, current local and received values. Changes made on only one
   side carry forward; conflicting rows retain their current assignments.
   Reconcile those fields in the native table or current accountant workflow,
   then capture or preview the relevant received set again.
4. Choose **Save matched changes to original handoff**. The saved revision joins
   the original handoff history with its received-set and plan identities.
5. Inspect **Current original accountant handoff** and its reviewed/booked
   counts. Download the current accountant CSV or any named prior return.

A preview with no usable returned rows displays its bookkeeping conflicts with
Save unavailable. If another return is saved after preview, refresh and preview
against that current parent. The form and previous received files remain
available throughout this review.

## Reopen and hand off the complete work

Select any plan from the sidebar or reopen its URL containing the plan and
received-set IDs. Search and pagination cover the retained source rows,
comparisons and plans. The same four operator areas are available on a narrow
screen; full row detail provides the source values behind each summary.

**Complete Bitwave handoff** downloads the selected plan's source, native
requests, received pages, comparisons, operation files and delivery state.
**Operation history** provides individual original files. Each named
received set and original accountant return remains selectable after later
captures or bookkeeping corrections.

Reopen the original workspace directory with the same server command to
continue. The retained plan, native operation state and accountant history are
read through their original workspace controllers. The implementation is in
[`bitwave-workspace.mjs`](bitwave-workspace.mjs), with the source comparison in
[`accountant/bitwave.mjs`](../accountant/bitwave.mjs) and native transport in
[`accountant/bitwave-http.mjs`](../accountant/bitwave-http.mjs).
