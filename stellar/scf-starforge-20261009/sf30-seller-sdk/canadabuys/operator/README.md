# CanadaBuys desk — operator guide

Use **Bidder desk** in the navigation for saved company capabilities, original evidence documents, clause assessments, reviewed decisions and revision-specific reports. Its [complete operating guide](../BIDDER_DESK.md) describes how this page shares the original source and workspace below.

The desk joins an original CanadaBuys source edition to a usable procurement review and partner workshare. It opens the full bilingual notice, retains its original CSV fields and attachments, records the requirements and delivery fit, and carries the scope, production capacity, partner responsibilities and milestone cash into a saved handover.

The browser uses the same local application and native workspace as the command-line client and provider. Its procurement page and bidder desk are complete, dependency-free HTML files. The application server serves it at the workspace address; open the URL printed by that server. Source acquisition, storage, revisions, reports and package receiving remain with the original CanadaBuys domain.

## 1. Bring in the original source

Open **Import source**, select the actual stream, and choose the original CSV. Supported streams are:

| Stream | Use |
| --- | --- |
| Open tenders | A complete edition of currently open federal notices |
| New tenders | The published new-notice stream, including a valid header-only edition |
| Complete tender history | Original historical tender rows |
| Contract awards | Award and amendment source rows |
| Standing offers and supply arrangements | Original instrument and supplier information |

Keep the original publication URL, retrieval time and supplied SHA-256 when available. The file reader preserves UTF-8, the original byte-order mark, CRLF and quoted multiline content. The server parses the CSV and retains its original complete text. The text area can also accept an intentionally prepared CSV edition.

Under **Sources & handoffs**, choose a stream and use **Fetch and retain official stream** to have the existing server acquire the original publication directly. Each capture has its own original operation record and HTTP/source metadata. A continuation button appears only when the returned original capture explicitly supports continuation.

A zero-row new-tender file is a legitimate source edition. Its presence does not imply that the last complete open-tender edition is empty. The **In latest open feed** field belongs to the original complete-open membership snapshot. The last source status stays separate, so a retained notice can have original status Open while absent from a newer complete-open feed.

## 2. Find and read a notice

The notice list searches identifiers, titles, buyers, both descriptions, commodity codes, review ownership and working notes. Every search word must appear in that searchable text. The filters select the original notice type, review disposition, closing window, delivery region, shortlist and latest-open membership.

The list shows 40 notices per page. Select individual notices or **Select page** to build a report selection. Changing a filter preserves the selected identifiers. The selected report option requires at least one selected notice.

Open a notice to choose its retained source row and read the full description in English, French or both languages. HTML character references are decoded for the readable description, and text remains inert. **Original source** retains the exact original field values, including their original markup and punctuation.

The original title and notice-type field stay distinct. An advance procurement notice can have a blank source type. A source type can say Request for Proposal while its description describes an RFQ. Read the complete source and original attachments for the actual buying phase and requirements.

The source contract includes real examples of these distinctions:

- APM2 describes an information-gathering phase for enterprise infrastructure, application and datacentre observability.
- Managed Backup and Recovery Software describes an Invitation to Qualify whose successful respondents can enter later procurement phases.
- HPE renewal describes an RFQ and its responsive, lowest-evaluated-subtotal selection alongside the original source type.

The application retains all original document links. A blank notice-page URL does not remove separately supplied document URLs.

### Closing times

CanadaBuys defines its tender closing field using a fixed UTC−05:00 offset. The desk presents the original wall time and offset, its parsed UTC instant, and the local time for the browser.

For example, the original value 2026-10-19T14:00:00 corresponds to 2026-10-19 19:00:00 UTC. The browser's local display follows its own configured zone. The application does not reinterpret that original field using the daylight-saving rules of America/Toronto.

Date-only publication fields remain date-only. A source closing value that cannot be parsed remains visible as supplied.

## 3. Compare complete original editions

Choose **Changes** and select the before and after rows. The original domain compares their complete field values and returns each changed heading with the before and after contents. The desk keeps full descriptions and multiline values in the comparison.

The source-row selector and the comparison selectors identify the retained edition. An updated closing date is a source change; the earlier row remains available. The complete comparison can be opened for its original metadata.

Under **Original source**, download the complete original CSV or the selected full row as JSON. The CSV download checks the returned original byte count and SHA-256 before offering the file. Each source displays the original URL, retrieval time, row count, bytes and digest.

## 4. Record the qualification and delivery fit

**Qualification** is the working review of the specific notice. It has a disposition, owner, next action, note and shortlist selection, plus four substantive planning fields:

| Field | Practical content |
| --- | --- |
| Capability and production scope | The actual engineering, implementation or operational work the team can deliver |
| Eligibility and prime requirements | Source-specific supplier, security, location, language and contracting requirements |
| Commercial route | The potential contracting party, current buying stage and useful partner workshare |
| Calendar and capacity | Published timing beside the required production and partner time |

Add original requirements as individual rows. Each row has its requirement, review state, source or section, and working note. The available states are Unreviewed, Met, Gap to resolve, and Not applicable. These are editable operator decisions.

A new requirement starts with the selected source-row reference when available. Replace or extend it with the relevant original document and section. Keep actual source conditions with the review so the partner can understand what the proposed work depends on.

Press **Save review** to persist the current record. The review uses its own revision. A concurrent change preserves the local draft and shows the newly saved record; the operator can compare the values, apply the draft over that current revision, use the saved version, or download the draft. A read refresh does not silently replace a newer saved workspace with an older response.

## 5. Prepare the whole partner workshare

Open **Workshare** from the selected notice, or **Partner workshares** from the main navigation. Choose **Prepare a workshare**.

The record brings together:

- Named partner or prime, delivery owner and working status.
- Production scope and complete deliverables.
- Partner responsibilities and principal time.
- Original inputs and start conditions.
- Acceptance and operator handover.
- Currency and proposed fee.
- Production hours, partner hours, availability and delivery working days.
- Milestone payment events, amounts, dates or triggers, and acceptance.
- Delivery costs with their planning basis.
- Working notes.

The native server assigns the workshare's stable identifier on its first successful save. The browser then follows that saved identity. The create operation uses the current workspace revision; later edits use that workshare's own saved revision.

Amounts use integer cents. Enter whole amounts or at most two decimal places; the application rejects malformed or out-of-range inputs. Each milestone and cost line remains in the record. The totals show the proposed fee, milestone sum, payment amount still to allocate, entered costs, and fee less those costs.

These totals are calculated from the workshare's entered assumptions. Record labor costing, partner compensation, taxes, timing and expenses explicitly. Different currencies stay separate in the global overview.

The working statuses are Draft, Ready for review, Partner review, Agreed, Delivering, Completed and Passed. Update them to reflect the actual state of the work. The desk preserves the saved record and its history.

### Saved handover

**Download saved handover** fetches the current saved workshare from the native server, then creates a complete standalone HTML handover. It includes all of the commercial and delivery fields, the milestone and cost tables, the original source basis saved with the workshare, current retained notice context and the complete saved workshare JSON. The original basis includes its source edition, row identity and row hash; the current notice remains a separate view of later source changes. It opens without a running server or browser script.

The JSON handover contains the exact returned record. The full original source and the writable application state travel through **Save workspace**.

## 6. Use award and supplier context carefully

The notice detail presents related award and supply-arrangement candidates with their original records and matching evidence. An exact solicitation-number relationship and a suggested commodity crosswalk retain their different evidence.

The original award amount, currency and cumulative value are separate fields. The award source defines contract amount as including taxes. A blank original currency may use the official CAD default; the desk labels the original blank and effective default together.

Cumulative contract value already includes the original contract and amendments. Overlapping complete/fiscal source files and repeated cumulative totals remain original source editions, with the domain's award groups available separately. The desk does not add those cumulative values together.

Instrument type and amendment type are shown when supplied. Original amendment identifiers can contain letters. Supplier names retain their original language. Award date and source retrieval date remain separate because published award data can arrive after the underlying award.

The government GSIN-to-UNSPSC crosswalk is a suggested relationship. Review the instrument scope and the retained match evidence before treating a supplier as a relevant delivery partner.

### Original instrument fields

Award cards show the source supplier legal name, contract number, award date, contract period, instrument and amendment type, and original amendment number alongside the source amount, currency and cumulative contract value. The original strings and full record remain available under **Complete original related record**.

Standing-offer and supply-arrangement cards read the actual 19-column source. Their visible field labels follow the official instrument dictionary:

| Original field | Operator meaning |
| --- | --- |
| agreement-number | Original standing-offer or supply-arrangement identity |
| agreement-type_en / agreement-type_fr | Original agreement type in the selected language |
| supplier-legal-name | Registered supplier name |
| supplier-operating-name | Supplier's business or trading name |
| supplier-standardized-name | Related-name search grouping |
| award-date | Instrument start date |
| expiry-date | Instrument end date |
| date-file-published | Publication date and time of the source file |
| end-user-entity_en / end-user-entity_fr | Entity for whose use the instrument was established |
| delivery-point_en / delivery-point_fr | Original geographic delivery coverage |
| delivery-point-code | Original delivery code |
| commodity | Original commodity code, with its scheme retained as supplied |
| commodity-description_en / commodity-description_fr | Original commodity description |
| sosa-description_en / sosa-description_fr | Original instrument scope |

The standardized name remains a search grouping alongside the legal and operating names. The delivery field preserves its original value; the dictionary also defines FD as Foreign, NA as National–Canada and NC as National Capital. Instrument scope and delivery conditions remain part of the review of a potential supplier relationship.

## 7. Produce reports and receive the saved work

**Reports** downloads HTML, CSV or JSON for all notices, the shortlist, or the selected notice identifiers. It also offers the full portable workspace and saved individual partner handovers.

**Save workspace** preserves the complete current application state and original sources. **Receive workspace** imports that package through the original native receiving operation. Open its returned handoff under **Sources & handoffs** to inspect the preserved source identities and any local review differences.

The operating view reports saved records. Unsaved drafts remain in this browser and have a separate complete draft download. Drafts use browser storage keyed by the actual workspace identity; original source files remain in the native workspace. If browser storage cannot retain a draft, the status asks the operator to download it.

The source and receiving pages retain the complete operation record. Their details can be downloaded as JSON. Received review differences link back to the current notice review when the original notice identifier is available.

## Native browser receiving

OPERATING_JOURNEY.mjs is a reusable operating helper for the real local server and original saved case. The caller supplies a Playwright Page from the existing equipped session, the actual workspace URL, an original notice ID and a private output directory.

The helper can open existing saved review/workshare records, or operate supplied review and workshare edits through the actual browser forms. It downloads the original CSV, complete notice reports, saved workshare handover and portable package. When the original case supplies a receiving URL, the helper receives that same saved package through the receiving application's browser and reopens the same notice/workshare there.

It records actual browser text, download bytes and hashes, screenshots and returned saved identities. It creates no replacement source feed and starts no separate server. Use it in the existing original case, retaining the same application and source edition.

## APM2 original customer case

APM2_OPERATING_CONTENT.mjs provides a complete internal delivery proposal for the retained Shared Services Canada Application Performance Management 2 RFI, solicitation BPM026762/35133. It accepts the original full notice returned by this application's native model and binds each requirement to the actual source edition, row identity, row number and row hash.

The case includes twelve source-linked requirements and full capability, eligibility, commercial and timing notes. Its proposed supplier workshare covers the response master, observability architecture, telemetry and diagnosis, editable capacity and cost model, security information, migration and service operations, supplier evidence register and final handover.

The entered internal proposal is CAD 7,200 across four milestones, with sixty production hours, six partner hours and ten working days from 13–26 October 2026. Entered delivery planning costs total CAD 4,000. These are editable service-planning inputs. The official source facts, its RFI buying stage and its published closing time remain in the same record.

Use the content in the existing original browser case:

~~~js
import { APM2_NOTICE_ID, createApm2OperatingContent }
  from './operator/APM2_OPERATING_CONTENT.mjs';
import { operateCanadaBuysDesk } from './operator/OPERATING_JOURNEY.mjs';

const content = createApm2OperatingContent(
  originalServer.workspace.getNotice(APM2_NOTICE_ID),
  { owner: deliveryOwner, partner: participatingSupplier }
);
const result = await operateCanadaBuysDesk({
  page,
  url: originalServer.url,
  noticeId: content.noticeId,
  review: content.review,
  workshare: content.workshare,
  outputDirectory: originalCaseDirectory,
  receivingUrl: originalReceivingServer.url
});
~~~

The original application must already contain that actual notice. Its existing browser, native model, retained source and receiving installation remain the operating context. An existing saved workshare can instead be supplied as workshareId to continue that same record.

As the original RFI attachment and amendments arrive, extend the requirement register with their actual sections and response fields, then retain the resulting saved workshare edition and partner review.

## Application integration

Serve operator/index.html from the original loopback HTTP service with the same host and origin protections as the native API. The document contains all styles and browser code; it needs no package installation, frontend build or external asset host.

The server's content policy must allow this document's inline script and stylesheet and same-origin API connections. Its source links open ordinary HTTP/HTTPS pages in a separate tab, with no referrer or opener access. Original notice text and raw fields are inserted as text.

The browser calls these original domain routes:

| Operation | Route |
| --- | --- |
| Current saved workspace | GET /api/workspace |
| Full notice and history | GET /api/notices/:id |
| Complete original source | GET /api/sources/:id |
| Original row comparison | GET /api/compare?before=:id&after=:id |
| Original CSV import | POST /api/import |
| Saved review | PATCH /api/notices/:id/review |
| Workshare creation/editing | POST /api/workshares; PATCH /api/workshares/:id |
| Complete saved workshare/history | GET /api/workshares/:id |
| Reports and portable package | GET /api/export; GET /api/package |
| Package receiving | POST /api/receive |
| Original source capture | POST /api/capture |
| Capture and receiving records | GET /api/captures/:id; GET /api/receiving/:packageId |

Report/package scope is all or shortlist; a selected subset sends scope=all with repeated noticeId query parameters. Successful mutations return the complete current workspace. Error responses use error.code, error.message and optional error.details.

The browser never retries a mutation automatically. A failed or uncertain save keeps the working draft available while the original domain's saved state can be refreshed.

## Original source references

- Federal tender open data: https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv
- Current source contract and original government dictionary are retained with this application.
- Government award-source support and 2026 changes: https://donnees-data.tpsgc-pwgsc.gc.ca/ba2/ac-cb/COsoutien-CHsupport-eng.html
- Standing offers and supply arrangements: https://sosa.canadabuys.canada.ca/cds/opendata/tpsgc-pwgsc_ocama-sosa.csv
- Supplier instrument dictionary: https://donnees-data.tpsgc-pwgsc.gc.ca/ba2/ac-cb/ocama-sosa-dd.xml
- GSIN/UNSPSC mapping catalog: https://open.canada.ca/data/en/dataset/588eab5b-7b16-4a26-b996-23b955965ffa

## Continue the saved case through Applications and merchant tools

`OPERATING_TOOLS.mjs` continues the completed original browser case using its `case-result.json`, original operator and receiving SQLite files, source identity, saved workshare, and prepared merchant publication. It opens the existing operator workspace through the source-owned Applications provider and the registered CanadaBuys MCP provider.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/canadabuys/operator/OPERATING_TOOLS.mjs \
  --source-root /absolute/path/to/merchant-workspace \
  --case-root /absolute/path/to/original-case
```

The source root is the complete maintained checkout. The case root contains the full operating driver's saved `case-result.json`, `operator-workspace/`, and `receiving-workspace/`. Run this continuation after that original case reaches `status: complete`.

The continuation runs the actual registered application command against the existing database, reads its original startup announcement and health response, then closes that command. It loads the declared merchant provider, follows every notice page, reads the saved source and workshare, exports the complete original CSV, and receives every hash-pinned Base64 file chunk. It then follows the original prepared SF30 dataset's cursor through every transport part and reconstructs the whole source/workshare package. Its package digest, complete original CSV and saved workshare are checked against the same customer case.

The output directory contains the actual application startup record and logs, the full CSV delivered through merchant tools, the complete package reconstructed from dataset pages, and `result.json` with source identity, page/chunk counts, preserved workshare, and owned-service closure. The complete source download uses one immutable descriptor. Publication lookup reads its indexed native row directly, keeping file transfers independent of notice-view reconstruction.

For programmatic use, import `operateCanadaBuysTools({sourceDirectory, caseDirectory, outputDirectory})`. The function keeps its output directory on an error and includes that path in `error.operatorToolsDirectory`, so a correction can continue the same saved case.


### Operate the saved desk through the HTTP client

`operator/OPERATING_API.mjs` performs the complete operator workflow through existing CanadaBuysClient instances: it retains the full source CSV and original notice history, saves qualification and partner workshare content with current revisions, downloads all report formats, exports the complete workspace, and receives that exact package into the selected receiving application. Supply the same output directory when explicitly continuing an interrupted operation; the original package and write receipts are retained, and saved workshare identities are reused.

```js
import { CanadaBuysClient } from '../client.mjs';
import { operateCanadaBuysApi } from './OPERATING_API.mjs';

const result = await operateCanadaBuysApi({
  client: new CanadaBuysClient(originalOperatorUrl),
  receivingClient: new CanadaBuysClient(originalReceivingUrl),
  noticeId: retainedNoticeId,
  review: actualQualification,
  workshare: actualPartnerWorkshare,
  outputDirectory: originalOperationDirectory
});

```

Both applications are caller-owned existing workspaces. The result identifies `interface: 'http-api'` and retains the source, review, workshare, reports, complete package and receiving records. A supplied `workshareId` selects a particular saved workshare; otherwise an unambiguous workshare with the same notice, title and partner is reused before creation. Mutation failures are returned with the retained operation directory. The caller can read the existing workspace and deliberately continue the same operation.

`OPERATING_TOOLS.mjs` accepts a completed original customer result with either a browser `browser` journey or an HTTP `operator` journey. It carries the actual interface name into its result, then opens the same SQLite databases through Applications and the registered 37-tool merchant provider.


## Continue the exact outgoing rendered delivery

The original browser course now continues through `operator/RENDERED_DELIVERY.mjs` after receiving the saved package. It uses the same browser context, original operator URL, notice/workshare identity and receiving URL. It opens populated bilingual notice, complete source, qualification and workshare screens at 1440 and 390 pixels; operates an empty search and restores the saved notice; opens the original bidder profile, captured evidence, requirements and frozen decision; and compares the saved decision with its current context using the original read operation.

Every captured response document is downloaded through its saved browser control and matched to its exact saved byte count and hash. The original HTML handover, full HTML notice report and saved decision report open from their exact downloaded bytes. An intercepted local browser navigation supplies those bytes where file navigation is unavailable; Markdown/JSON evidence uses an explicitly identified readable text view. The same receiver reopens its saved workshare at narrow width.

The producer must open the returned PNGs and look at the actual desktop/narrow views and outgoing files. The course saves original screenshots, viewport/layout observations, document identities and any browser errors in `rendered-delivery/result.json`. It reports capture separately from the producer's inspection. Horizontal overflow is recorded with the actual viewport and document dimensions for repair. The course creates no new customer and saves no edited qualification, profile or decision.

The saved browser receiving is checkpointed before this rendering phase. A later render interruption reuses that complete original journey and its downloads; it does not receive the package again. Only the browser pages and services started by the caller are closed. Retain the images with the same original customer archive and return them to the producing peer for direct viewing and concrete corrections.

## Rendered product inspection — owner instruction, 2026-10-13

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Before calling any customer/prospect-facing application, website, dashboard, demo, report, presentation or export ready, open/run/render the exact outgoing version, look at the rendered screen or its actual screenshots, and operate the important user controls. Inspect the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Code review, DOM counts, HTTP 200, unit checks and another worker's approval do not replace seeing the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk; do not run broad suites or build a verification product.

Include this complete instruction in delegated assignments and the active owner-controlled policy, boot, build and receiving guidance those workers actually read. Preserve all other owner controls and original operation identities. Leave historical records and third-party/vendor policies intact. Do not force restarts, create watchers or revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
