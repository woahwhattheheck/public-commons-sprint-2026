# Merchant service agreements and recurring billing

Turn an accepted service quotation into a maintained billing calendar, then prepare each invoice in the original merchant receivables workspace. The product keeps the accepted quotation, its customer response, later editions, billing history and invoice references together.

The browser, command line, typed HTTP client and native merchant tools use the same agreement controller. Original accounting customers remain the customer directory. Invoice preparation uses the existing quotation compiler and receivables importer, so the resulting draft continues through the established invoice, payment, credit and customer-statement workflow.

## Start in the original workspace

Choose an initialized private merchant accounting directory with its original customer records and source configuration. In Applications, select **Service agreements and billing** and review that directory. Applications retains its workspace identity and source configuration hash and checks them again when the server opens the directory.

From the packaged command line:

```sh
starforge service-agreements serve --directory /absolute/path/to/accounting
```

From the source checkout:

```sh
node stellar/scf-starforge-20261009/merchant-settlement-accounting/service-agreements/cli.mjs serve --directory /absolute/path/to/accounting
```

The default local address is `http://127.0.0.1:8449/service-agreements/`. The same server provides the original receivables and customer-statement workspaces. The startup JSON identifies the actual directory, workspace ID, source configuration hash and listening URL.

Only one writer owns an accounting directory at a time. Close that directory in the merchant tools before opening it through Applications, or close the browser server before opening it through merchant tools. All front ends retain the original workspace lease.

## Complete operating workflow

1. **Choose the customer and accepted source.** Supply the complete quotation JSON and its accepted response JSON. Keep the original document content; the agreement stores both sources with its review.
2. **Create the agreement.** Enter a reference, title, start date and number of monthly periods. Select a billing interval, invoice timing and payment term. The calendar uses actual source prices for the number of periods in each bill.
3. **Review the calendar.** Read issue dates, due dates, amounts, accepted quotation editions and existing invoice links at the selected date.
4. **Preview one period.** The preview contains the exact invoice draft, source review, agreement version and SHA256 needed to prepare that period.
5. **Prepare the invoice.** Submit the same period and preview hash with the original request identity. Continue in Receivables to review and issue its editable draft.
6. **Maintain the relationship.** Add a newly accepted quotation edition, extend the agreement by whole months, or cancel future periods at an original monthly boundary.
7. **Deliver the account record.** Export the agreement's reports and complete retained quotation files. Follow the invoice references into customer statements and the existing receivables history.

### Accepted service renewals

When an original service case has an accepted operational renewal, export its complete renewal handover from Service Renewals. Choose that one JSON file in the agreement creation or amendment form. The browser retains the handover and extracts the exact original quotation and acceptance bytes. Review the selected accounting customer, monthly calendar, accepted head and distinct original, proposed and active terms before saving.

The original Service Renewals validator checks the full retained histories, acceptance and document materials. The financial edition stores its sealed handover identity, original case and service agreement references, accepted renewal reference and exact UTC service interval. The financial agreement keeps its own UUID. You can download the complete `renewal.json` from the source review or the agreement export.

Every billed monthly period must fit inside the accepted service interval. Original times and an open-ended interval are retained exactly. To continue a calendar past a finite accepted interval, first amend at the current original end boundary using the next accepted renewal, then extend the calendar. The accepted continuation supplies the new price edition for the added months. Existing billed periods remain attached to their original editions.

The same accepted renewal cannot create another financial calendar through a new request or a differently sealed later export. A duplicate identifies its existing agreement so the operator can reopen it. Later amendments on that joined calendar require the complete accepted handover and retain the same original service case and agreement lineage. Reusing the same accepted handover on its original calendar remains available for a payment-term change.

CLI, typed HTTP and merchant-tool creation/amendment inputs accept optional `renewalJson` alongside the exact `quoteContent` and `responseContent` extracted from that handover. Keep all three original strings in the same retained request. Their combined source bytes and the complete transport request retain the existing two-megabyte limit.

### Calendar and pricing rules

| Setting | Behavior |
| --- | --- |
| Start and end | Monthly boundaries are anchored to the original start date. Each interval includes its start and excludes its end. |
| Shorter months | An anniversary on a shorter month clamps to that month's final day. Later boundaries still use the original start day. |
| Term | Creation accepts 1–120 monthly periods. A renewal explicitly adds 1–120 monthly periods. |
| Billing interval | 1–12 monthly periods per invoice; the final period uses the actual remaining count. |
| Invoice timing | `START` uses the period start; `END` uses the period end. |
| Payment term | The due date follows the invoice date by 0–365 calendar days. |
| Amounts | The original quotation compiler calculates full-period integer quantities. The agreement retains its accepted quotation edition and prices for the applicable period count. |
| Amendments | A new accepted quotation starts at an exact original monthly boundary. The retained edition identifies the changed commercial terms and reason. |
| Renewals and cancellation | Existing billing records, accepted sources and invoice references remain part of the agreement history. |

Creation defaults to monthly billing, `START` invoice timing, 30 due days and currency scale 2 when those optional fields are omitted. The allowed currency scale is 0–6. Dates use `YYYY-MM-DD`; amounts returned by the controller retain the original currency representation.

## Typed HTTP client

The product exports the client and its TypeScript declarations under `./merchant/service-agreements/client`. The browser also serves the same module at `/service-agreements/client.mjs`.

```js
import {createServiceAgreementClient} from
  "./source/stellar/scf-starforge-20261009/merchant-settlement-accounting/service-agreements/client.mjs";

const client = createServiceAgreementClient({
  baseUrl: "http://127.0.0.1:8449/api/service-agreements",
});

const state = await client.state({asOf: "2026-10-12"});
const selected = state.agreements[0];
if (selected) {
  const detail = await client.detail(selected.id, {asOf: state.asOf});
  const period = detail.periods.find(value => value.due && value.canPrepare);
  if (period) {
    const preview = await client.preview(selected.id, {
      periodId: period.id,
      asOf: state.asOf,
    });
    // Retain the entire approved request before sending it.
    const request = preview.recoveryRequest
      ? {...preview.recoveryRequest, revision: preview.revision, workspaceId: preview.workspaceId}
      : {
          revision: preview.revision,
          workspaceId: preview.workspaceId,
          expectedVersion: preview.agreementVersion,
          actor: "merchant-operator",
          requestId: crypto.randomUUID(),
          periodId: preview.period.id,
          previewSha256: preview.previewSha256,
        };
    const result = await client.bill(selected.id, request);
    console.log(result.agreementId, result.invoice);
  }
}
```

Use a current state or detail response for the workspace revision. Every mutation requires `revision`, `actor` and `requestId`; changes to an existing agreement also require `expectedVersion`. Store a pending request with its original workspace ID and complete body before dispatching it. Set its optional `workspaceId` to the selected state's identity; the controller checks that identity before replaying or writing, which binds a stale browser's request to its original accounting directory. The client sends the supplied body unchanged and does not generate request identities.

| Client method | Purpose |
| --- | --- |
| `state({asOf})` | Customers, agreement calendar and current workspace revision |
| `detail(id, {asOf})` | Complete agreement, editions, billing records and periods |
| `preview(id, {periodId, asOf})` | Exact draft, quotation review and preview hash |
| `create(body)` | Accepted-source agreement |
| `amend(id, body)` | Newly accepted quotation and effective monthly boundary |
| `renew(id, body)` | Explicit additional monthly periods |
| `cancel(id, body)` | Dated cancellation of future billing |
| `bill(id, body)` | Original receivables draft for the reviewed period |
| `sourceFile(id, sourceId, name)` | Complete retained source file |
| `exportAgreement(id, {format, asOf})` | Complete TAR, JSON, CSV or HTML export |

Read calls accept an optional `signal` in their options. Mutation methods accept `{signal}` as the final options argument. A custom `fetch` implementation can be passed to the factory. Source and export downloads return `{name, type, bytes}`, with complete bytes as a `Uint8Array`.

### Preserve pending operations

A `ServiceAgreementClientError` exposes `status`, `code`, `details`, `requestId` and `uncertain`. A transport failure, lost mutation response or server failure can leave a completed operation whose response was not received. Retain the original body, inspect the current agreement, and reconcile that same operation identity.

A period marked `PREPARING` has an original staged billing operation. Its preview includes `recoveryRequest`. Reuse the returned actor, request ID, agreement version, period and preview hash; add the current preview revision and workspace ID. This continues the staged importer operation and its original invoice relationship.

If an invoice importer reports an error after the agreement's billing operation was prepared, its error details include `agreementBillingPrepared`, `billingId` and the original `requestId`. The client marks that outcome uncertain even for an HTTP 4xx response, preserving the staged operation for continuation.

An original durable-save failure can return `WORKSPACE_COMMIT_UNKNOWN` with HTTP 409 after the file rename has already occurred. The client preserves `reopenRequired` and marks that mutation uncertain. Keep its complete pending request, close and reopen the original accounting workspace, and reconcile the same request identity against the retained state.

A revision conflict requires reviewing the current state. An obsolete preview requires a fresh preview of the selected period. Do not rewrite an uncertain request into a new operation before reconciling its retained identity.

The HTTP API accepts at most 2,000,000 UTF-8 bytes per complete request, including both quotation documents and JSON structure. Use the complete original quotation and accepted response within that limit.

## Native merchant tools

The product selects the original accounting, service-agreement and support providers with their declared dependencies. Use the existing merchant configuration's `accounting.workspaces` aliases and original accounting source paths. The service-agreement provider borrows the already owned accounting session. Configure the existing `supportConnection` for the same original case directory used by the support console; the operational renewal tools appear when that support connection is configured.

Start the existing merchant MCP transport through the packaged `merchant-mcp` or `merchant-mcp-stdio` command. The `merchant-mcp-client-config` command remains the client configuration entry point. Agreement tools all use the `merchant_service_agreements_` prefix:

| Tool suffix | Operation |
| --- | --- |
| `workspaces` | List configured original accounting aliases |
| `open` / `close` | Open the agreement controller in its accounting owner; release its files and close the owner |
| `state` / `agreement` | Dated workspace calendar or complete agreement |
| `preview` | Exact billing preview and any staged recovery identity |
| `create` / `amend` | Create an accepted agreement or retain a new accepted quotation edition |
| `renew` / `cancel` | Extend by whole months or end future billing at a boundary |
| `bill` | Prepare the original receivables draft |
| `source_file` | Read the original quotation, accepted response or review |
| `export` | Complete file inventory, exact byte counts, hashes and fixed export date |
| `export_file` | Download a listed file or the complete `agreement.tar` |
| `file_release` | Release an interrupted retained read |

Native MCP errors retain machine-readable `details.agreementBillingPrepared`, `billingId` and `requestId` for a staged billing operation. Original durable commit errors retain `outcomeUnknown`, `reopenRequired` and the available original commit metadata. The HTTP and stdio transports use the same existing error projection, so these fields remain available to receiving agents.

Tool mutations have the same original revision, actor, request ID and agreement version requirements as the HTTP API. Add the declared `workspace` alias, and use `agreementId` for an existing agreement. The complete native request has the same 2,000,000-byte UTF-8 limit.

For an export, retain the returned `asOf`, selected file name and SHA256. Pass them to `export_file`. If `nextOffset` is present, continue with the same workspace, agreement, date, file, SHA256 and `readId`, using that next offset. Decode each base64 chunk and concatenate it in order. The original retained reader snapshots the complete selected file once and serves subsequent chunks from that same snapshot. Verify the final byte count and SHA256 against the inventory.

For an original source, begin with `source_file` and its edition's `sourceId`. Subsequent chunks retain the returned read identity and exact file hash. Close or release an interrupted read when it is no longer needed.

### Operational renewals in the same merchant session

The `merchant_service_renewals_` tools operate the original saved service case before the financial calendar receives its accepted continuation. Use `queue` with an explicit UTC `asOf` and page through `nextOffset`, then `read` the selected case. Keep its case revision SHA distinct from the renewal and service-terms edition numbers. The `preview`, `propose` and `decide` operations retain the original case writer, reviewed continuation, matching quotation and actual customer response.

Receive the accepted handover with `handover` or the complete `handover_file` reader. Pin its original case revision and renewal UUID. When downloading chunks, keep the file digest, read identity and returned byte offset; verify the completed byte count and SHA256. `file_reads` inspects unfinished reads, and `file_release` releases one original read.

Decode the complete handover JSON as UTF-8 and retain that exact string as `renewalJson`. Decode `materials.quote.data` and `materials.acceptance.data` from base64 to the exact `quoteContent` and `responseContent` strings. Send all three with the financial `create` or `amend` request, the reviewed accounting customer and original monthly calendar. The accepted service interval and same-calendar lineage remain enforced by that financial controller.

The complete operational proposal, customer decision and recovery examples are in the installed `source/stellar-forge/mcp-merchant-operator/SERVICE_RENEWALS.md`. Keep each original operational request body for replay. Its case request UUID and revision guards belong to that case operation; each intended financial change has its own retained financial request and workspace guards.

## Product contents and integration

The source-owned selection is `stellar/scf-starforge-20261009/distribution/selections/merchant-service-agreements.json`. Its contribution declares the command, controller/core/server exports, typed client, Applications provider, browser asset manifest and merchant provider.

The selection retains the original receivables product's accounting, connection, support, commercial, implementation and service-operation contributions. Its merchant MCP registration includes service agreements and the original support provider's accounting and buyer-expense dependencies. The existing distribution builder resolves these selected sources and their imports.

Persistent agreement state lives in the original accounting workspace. Accepted quotation sources and billing operations retain their original identities. Exports contain the agreement's complete file set; the native transport adds a complete TAR archive through the existing retained-file reader.
