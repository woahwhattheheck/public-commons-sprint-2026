# CanadaBuys procurement workspace

The **Bidder desk** adds saved company profiles, original evidence documents, clause assessments and versioned Bid / No bid / Investigate / Park decisions to this same workspace. Open it from the procurement navigation. See [the complete bidder desk operating and integration guide](BIDDER_DESK.md) for its browser, CLI, client, merchant and package-receiving workflow.

Operate federal tender, award and standing-offer/supply-arrangement sources in one saved workspace. The browser, CLI, JavaScript client, Applications entry and merchant MCP provider use the same SQLite model. The working product covers source intake, bilingual notice review, exact edition comparison, qualification, supplier research, partner workshare planning, complete handover and merchant delivery.

## Open the application

Use the **CanadaBuys procurement** entry in Applications and select a workspace directory and operator name. Its existing Review/Save/Start/Open/Stop lifecycle owns the local service. In a source checkout:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/canadabuys/cli.mjs serve \
  --workspace /absolute/private/procurement --operator "Delivery team"
~~~

The command prints its actual loopback address and workspace identity. Open that address. The [operator guide](operator/README.md) covers source intake, review, workshare economics, exports and receiving. The interface uses a restrained monochrome layout and shows the original source next to saved decisions.

Use the maintained Node runtime with built-in node:sqlite. The source-owned distribution contribution adds the canadabuys command, typed package exports, Applications provider and independent MCP provider; the existing SF30 and merchant components carry the complete files. Native seller dependencies are prepared by the existing distribution runtime profile when using seller service commands.

## Work an opportunity from its original source

1. Import or capture an entire official CSV. The workspace retains every column, every record, original UTF-8 bytes, byte length and SHA256. A separate observation records each import/capture even when the bytes repeat.
2. Search the notice rail and open an original record. Read both languages, closing time, original attachment URLs and complete CSV fields. Exact prior editions remain available for comparison.
3. Save the operator review and source-linked qualification requirements. Each requirement has its source, review state and note. An explicit profile can match keywords, categories, exact GSIN or UNSPSC codes and preparation time.
4. Inspect award candidates linked through the original solicitation numbers, including historical editions. Contract groups show their current edition and all retained originals. Supplier and commodity matches carry explicit evidence.
5. Create a partner workshare. Save scope, deliverables, responsibilities, inputs, acceptance, owner, available date, production/partner hours, delivery days, fee, costs and milestones. Each saved edition retains the original notice context.
6. Export a selected handover or complete workspace. Receive the same package in another workspace. Original source bytes, selected reviews and every workshare edition travel together; existing receiving decisions remain available with any incoming conflicts.

[APM2 operating content](operator/APM2_OPERATING_CONTENT.mjs) applies this complete workflow to the retained Shared Services Canada observability RFI BPM026762/35133. It supplies editable source-linked requirements and an explicit internal delivery proposal. [The original browser journey](operator/OPERATING_JOURNEY.mjs) operates a caller-provided real Page, original server and receiving server.

## CLI and client

Run canadabuys help for complete commands. The installed distribution exposes the same command through starforge canadabuys. Use the current revision returned by status before a workspace mutation:

~~~sh
starforge canadabuys status --workspace /absolute/private/procurement
starforge canadabuys import --workspace /absolute/private/procurement \
  --file /absolute/sources/openTenderNotice.csv --stream open-tenders \
  --retrieved-at 2026-10-12T16:34:03Z --expected-revision 0
starforge canadabuys notice --workspace /absolute/private/procurement \
  --notice-id notice-e7a769311f5a3c763d253568
~~~

Review and workshare update commands use the selected record's own revision. Create/import/capture/receive use the global workspace revision. JSON input files carry complete review, qualification or workshare fields; output files are created with exclusive creation and private permissions.

~~~js
import { CanadaBuysClient } from './client.mjs';
const client = new CanadaBuysClient('http://127.0.0.1:ACTUAL_PORT');
const view = await client.workspace();
const result = await client.capture({
  stream: 'open-tenders',
  expectedRevision: view.revision
});
const notice = await client.notice('notice-e7a769311f5a3c763d253568');
await client.updateReview(notice.id, {
  expectedRevision: notice.review.revision,
  disposition: 'reviewing',
  shortlisted: true,
  owner: 'Delivery team',
  nextAction: 'Complete the source-linked technical response and partner workshare.'
});
~~~

The client supports source/entry/history reads, comparisons, all saved workshare operations, profile matching, capture resumption, reports, packages and receiving. It retains the server error code/status/details. Source captures allow 195 seconds by default; each request accepts timeoutMs and the client accepts a maximum response size. Complete-feed source and JSON envelopes use a 256 MiB default capacity.

## Source semantics

The [official dataset guide](https://donnees-data.tpsgc-pwgsc.gc.ca/ba2/ac-cb/soutien-support-eng.html), [tender/award dictionary](https://donnees-data.tpsgc-pwgsc.gc.ca/ba2/ac-cb/achatscanada-canadabuys-dd.xml) and [CanadaBuys data page](https://canadabuys.canada.ca/en/procurement-and-contracting-data) define the original fields.

- The datasets cover federal procurement. English and French columns belong to the same original record.
- A source closing time without an explicit offset is interpreted at fixed UTC−05:00. Current time is evaluated in live views; immutable entry summaries retain clock-independent raw/UTC values.
- CSV parsing retains multiline quoted descriptions, escaped quotes, BOM, CRLF, empty values and unknown columns. All rows must match the complete header. The original CSV download is byte-preserving.
- The most recent observed complete open feed determines presence. An empty new-tender feed leaves that observation unchanged. A notice absent from the latest open feed retains its last source-reported status separately.
- Tender/award joins use solicitation numbers. All matching historical notice entries are recorded. Reference identifiers remain original values.
- Award amount and cumulative total contract value are separate. Blank award currency uses the official CAD default with the blank original field retained. Contract amounts include taxes. Negative source amounts and alphanumeric amendments remain intact. Repeated cumulative totals are kept in their original contract editions.
- GSIN and UNSPSC are distinct code schemes. Matching uses exact same-scheme codes. Suggested crosswalks require their own source and interpretation.
- Money entered for a workshare uses exact nonnegative integer cents. Delivery days are whole days; production/partner hours can be fractional. The displayed margin is fee minus entered costs, before unentered labor and other costs.

Complete current source metadata and original samples are retained under examples/source/. Source data is subject to the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada).

## Original operation and receiving

Each source has a content identity plus separate observations. Repeated imports retain the same source bytes while recording the new retrieval. Reads use a consistent SQLite snapshot; writes acquire the original transaction and check the relevant revision. Indexed notice, solicitation, supplier and commodity lookups support full official feeds.

Each capture has one identity, original URL/stream, revision, lease, response metadata, attempt history and resumption state. Resume the saved captureId after inspecting its result. The same transaction retains its complete source and completion. Retry-After is preserved. The source transport accepts the official HTTPS CSV hosts and validates redirects.

A selected package contains the selected workshare history and necessary original sources, including the latest open-feed source even when selected membership is empty. Its receiving provenance is projected onto that source selection. A full package retains complete workspace history. Receiving verifies source bytes, selected entry identities, source observations, every original workshare edition and the final head. It preserves existing decisions and records incoming conflicts.

## Merchant and agent operation

The independent provider is canadabuys-workspaces, with configuration key canadabuysWorkspaces and connection input canadabuysWorkspaceConnection. The connection schema is starforge.canadabuys.workspace-connection.v1:

~~~json
{
  "schema": "starforge.canadabuys.workspace-connection.v1",
  "workspaces": {
    "procurement": {
      "directory": "./procurement",
      "operator": "Delivery team",
      "inputs": {
        "open": {
          "file": "./sources/openTenderNotice.csv",
          "stream": "open-tenders",
          "url": "https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv"
        }
      },
      "deliveries": {
        "partner": "./received-dataset"
      }
    }
  }
}
~~~

Use merchant_canadabuys_workspaces, open and status to select the owned service. Collection pages return nextOffset. Export reports, complete packages, original CSV or exact row JSON; receive listed files through the existing hash-pinned retained-file reader. Close the returned service instance ID.

The merchant commands use the maintained SF30 dataset compiler and native seller. One selected workspace packet includes each complete original source once. Its CSV transport divides that packet into complete 24 KiB Base64 parts with original part/payload hashes. Metadata lists all selected notice IDs. A single-notice packet supports where_notice_id; every packet supports where_package_id. Continue the native page cursor unchanged and retain every transport column.

merchant-prepare freezes the complete selected review/workshare package before asynchronous file work. Public payment terms plus an HTTPS origin configure the native seller; the existing host controls own its instance. The original finalized SF100 delivery is checked for its page chain, manifest, snapshot, output bytes and all packet parts before native receiving. This preserves the selected source and authored work through the maintained commerce protocol.

### Standing offers and supply arrangements

The SOSA importer reads the current 19-column federal schema and retains all original values. The agreement number identifies the instrument. The source field `award-date` is its start date; expiry and file publication remain separate. Legal, operating and standardized supplier names are retained individually. Standardized names group related suppliers for search and never establish a shared legal identity.

The SOSA dictionary calls `commodity` a generic procurement code without naming a classification scheme. Matching code values can produce a candidate with `sourceScheme: unspecified` and `requiresSchemeConfirmation: true`; GSIN and UNSPSC remain separate on tender and award records. Date fields and membership in the published feed never fabricate an explicit instrument status. The original dictionary is included under `examples/source/sosa-dictionary.xml`.

## Separately captured notice evidence

When a notice is absent from a retained CSV feed, [Separately captured notice sources](SOURCE_PROVENANCE.md) defines the explicit one-row import, complete original HTML and field mapping, atomic v3 adoption, and source-preserving export/receiving path. Existing CSV-only workspaces retain their v2 defaults.
