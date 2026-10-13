# GridKind measured interval-energy review

TJ Labs / TokenJunkieLabs. Preserve the original project attribution and MIT notices.

This is a complete source-to-review workflow in the existing GridKind household workspace. It stores the original CSV and its explicit interpretation, keeps all source rows, binds a review to one saved weekly plan, presents coverage and signed differences, and includes these records in the original complete-household export and cold restore.

The implementation does not change the optimizer, device approval or simulated dispatch, MCP grants, or existing tariff and weekly-review workflows. It does not identify causal savings.

## Actual source and plan

Open **Measured energy** from the household, weekly or tariff page. Use an actual interval-energy export or identify an authored example explicitly. Declare:

- Exact start, end and energy column names.
- Interval Wh or kWh. Cumulative readings, instantaneous kW and signed net exports are different quantities and are not accepted as interval energy.
- The IANA timezone used for the saved weekly plan's local dates.
- The physical meter boundary. Whole-household energy has no flexible-load attribution. A submeter may declare exact saved load IDs; this is an operator assertion, not a wiring or device-operation verification.
- Source title, source URL and note, including any acquisition or transformation provenance.

The source remains a complete UTF-8 CSV, at most 1 MiB and 10,000 data rows, with up to 64 columns. Quoted fields and original line references are preserved. A UTF-8 BOM remains in the original byte content. Every row remains available in the report and export, including invalid timestamps, values and overlapping intervals.

The saved plan may be an authored scenario. An authored plan and observed measurements remain explicitly different sources even when dates are chosen to align. Never change the historical measurement timestamps to make an example plan appear observed.

## Timestamp, overlap and coverage interpretation

Timestamp fields require RFC3339 dates and seconds with explicit Z or a numeric UTC offset, optionally one to three millisecond digits. No local timestamp is guessed. Start is inclusive and end exclusive. Durations must be positive and at most 31 days.

Energy is a nonnegative decimal without exponent notation, at most 12 fractional places. The raw string and exact decimal kWh conversion remain in the source. Arithmetic totals use JavaScript finite numbers; the displayed numeric precision does not make these billing-grade calculations. Negative net exports need another explicitly defined quantity.

All members of an overlapping interval group are excluded. A row with invalid energy but valid overlapping timestamps still prevents a valid neighbor from being counted. Adjacent intervals are allowed. A complete hour must be filled continuously from its resolved start to end by non-overlapping usable intervals. Missing periods are null, not zero. An interval crossing an hour boundary is retained but not prorated across hours.

The week uses its original 168 nominal local slots. IANA timezone rules determine possible UTC boundaries. Both boundaries must resolve uniquely, and their elapsed difference must be exactly one hour. Repeated fall-back times, spring-forward gaps, fractional transitions and other non-hour slots remain explicitly excluded. No duplicated hour is folded into another. The review retains the exact resolved boundaries plus the runtime ICU/tzdata versions. If a future runtime resolves those boundaries differently, the original record remains available but strict source reinspection requires its original rules.

## Quantities and report

For each complete supported hour, GridKind reports observed kWh and observed kWh multiplied by that saved day's price. This is variable energy cost in USD, excluding fixed charges, taxes, demand charges, credits and other bill components.

Whole-household readings leave all modeled-load and difference fields null. For a declared submeter, the selected load IDs determine baseline and optimized modeled energy on the same complete support. Signed observed-minus-modeled differences are retained, including negative values. Infeasible or unsupported plan hours remain unavailable. Totals use supported rows; they are not a complete bill or evidence of causal savings.

Inspect the coverage status, original source rows, exact weekly record and full source URL/note before interpreting a comparison. The readable HTML includes every selected hour and the original interval table. Download:

- Original CSV, byte-for-byte.
- Every source row and its diagnostic references.
- Complete saved record with exact source and week.
- Readable HTML.
- All 168 review hours as CSV.
- Complete household with its entire original record history and source bytes.

The household keeps its existing 8 MiB complete-recovery limit. A save that would exceed it rolls back atomically and explains that nothing was saved.

## Working copies, interrupted writes and explicit-file fallback

Each browser window maintains a separate complete copy in IndexedDB. A working file includes unfinished literal fields, selections, exact pending request and observed responses. Opening a different copy or replacing the CSV preserves earlier work. Concurrent saves to the same inherited copy detect its saved revision.

If browser storage is unavailable, download the complete current working file. The application checks that the explicitly downloaded bytes still match before a mutation. Merely reading fields does not change its timestamp. An already-prepared uncertain attempt is stable across resume, so the exact downloaded file can permit the same request to proceed.

Save prepares the original request ID, selected household/revision/generation, exact source intent and preview hash before dispatch. Reconcile first reads the original saved outcome. A timeout retains the same request. It never invents a replacement request ID. A corrected copy is available only after a current-page explicit native rejection plus a fresh absent outcome; imported rejection observations do not grant that authority.

## Complete command-line workflow

Use Node 24, the same installed application and the original selected loopback server. The CLI launches no server or scheduler.

A private local connection file describes the existing browser visitor:

~~~json
{"schema":"gridkind-energy-connection/v1","url":"http://127.0.0.1:PORT","sid":"EXISTING-gridkind_sid-UUID"}
~~~

Use the actual existing cookie; do not publish this connection file. Prepared requests bind its hash and the selected household, retaining the original request context on resume.

The full source-input JSON is:

~~~json
{
  "filename": "actual-intervals.csv",
  "title": "Name of the actual meter export",
  "sourceUrl": "https://actual-publisher.example/source",
  "note": "Actual acquisition and transformation provenance",
  "role": "user_supplied",
  "unit": "kWh",
  "timezone": "ACTUAL_IANA_ZONE",
  "meter": {"kind":"household","description":"Actual meter boundary","loadIds":[]},
  "mapping": {"start":"EXACT_START_HEADER","end":"EXACT_END_HEADER","energy":"EXACT_ENERGY_HEADER"},
  "csv": "COMPLETE ORIGINAL CSV TEXT"
}
~~~

The placeholders above describe required fields; they are not an example dataset. A separately authored example must use role authored_example.

~~~bash
node energy-cli.mjs inspect --source SOURCE.json --output INSPECTED.json
node energy-cli.mjs catalogue --connection CONNECTION.json --kind week
# Optional: explicit hypothetical weekly input, through the unchanged original week API.
node energy-cli.mjs prepare-week --connection CONNECTION.json \
  --input AUTHORED_WEEK.json --output AUTHORED_WEEK_RECEIPTS

node energy-cli.mjs prepare-source --connection CONNECTION.json \
  --source SOURCE.json --operation ORIGINAL_OPERATION/source \
  --request SOURCE_REQUEST.json
node energy-cli.mjs continue --connection CONNECTION.json \
  --request SOURCE_REQUEST.json --output SOURCE_RECEIPTS

node energy-cli.mjs prepare-review --connection CONNECTION.json \
  --source-id ACTUAL_SAVED_SOURCE_ID --week-id ACTUAL_SAVED_WEEK_ID \
  --title "Authored review title" --operation ORIGINAL_OPERATION/review \
  --request REVIEW_REQUEST.json
node energy-cli.mjs continue --connection CONNECTION.json \
  --request REVIEW_REQUEST.json --output REVIEW_RECEIPTS
node energy-cli.mjs export --connection CONNECTION.json \
  --household ACTUAL_HOUSEHOLD_ID --record ACTUAL_REVIEW_ID --output EXPORTS
~~~

prepare-source and prepare-review inspect the real native preview and write the complete immutable request before any save. continue checks the same native outcome, then records the full attempt before at most one mutation invocation. Returned bytes or errors are retained. An unknown result keeps the same request. Export preserves the first complete household and checks its immutable payload on replay. If the household advances, preserve that case and choose a separate continuation output.

## Original native/browser operating and receiving chapter

The original equipped owner remains responsible for its existing Node 24 runtime, browser, two original servers, pages and exclusive operation lease. There is no new worker or competing queue. The existing runtime imports receive-energy-review.mjs and calls:

~~~js
import { receiveEnergyReview } from './receive-energy-review.mjs';

const result = await receiveEnergyReview({
  page: originalAuthorPage,
  receivingPage: originalColdReceivingPage,
  source: '/absolute/actual-source-input.json',
  weekId: 'ACTUAL_SAVED_WEEK_ID',
  title: 'Actual measured-energy review',
  note: 'Authored interpretation and selected meter boundary',
  output: '/absolute/original-owned-output',
  operationId: 'GRIDKIND-MEASURED-ENERGY-REVIEW-B43A-20261013',
  applicationPacket: '/absolute/complete-current-application.json',
  sourceCompanions: [
    '/absolute/actual-license.txt',
    '/absolute/actual-source-metadata.json',
    '/absolute/actual-transformation-provenance.json'
  ]
});
~~~

The pages must already belong to the intended original author and independent receiving visitors. The author must already contain the selected saved weekly plan. Alternatively supply authoredWeek: '/absolute/explicit-authored-week.json' and omit weekId. This explicit original weekInputs file declares its name, startDate and seven enabled/scenario day inputs; it is never inferred from meter readings. The unchanged original weekly API saves it. Exact matching saved weeks are reconciled before dispatch, and the retained original revision context prevents duplicate writes after a lost response. Multiple matching weeks require choosing the intended original ID. Source companions are optional exact original evidence files; include the actual license, metadata and transformation/original-input records when applicable. The complete application packet includes all current application files and retained AGENTS.md, with each full source body. The course verifies every selected installed file before operating. Output and application directories must be disjoint.

The chapter performs the complete product journey:

1. Reads the original visitor, exact saved week and complete measured input. Freezes their hashes and the complete installed application.
2. Uploads the literal CSV through the actual UI, enters all source/meter fields, compares the native preview, and saves one immutable source.
3. Selects that source and the original week, previews and saves the actual review. It deliberately withholds one already-committed review response from the page, preserves the full pending working file and reopens that same request to reconcile its exact outcome.
4. Opens the saved review at 1440px and 390px. Downloads every actual report/source attachment and compares its bytes with the native export. Opens the literal downloaded HTML and all text/CSV/JSON attachments, retaining screenshots and text.
5. Downloads the full household through the actual link. On the independent receiver, restores through the original household import and verifies every original record, assistant-request receipt and exact energy source/plan/review. Import recovery scans immutable origin records before any retry; it preserves the original import context if the response was lost.
6. Opens and downloads the same saved review in the cold receiver. It preserves complete browser working files, native request/response records and source companions.
7. Saves a complete portable JSON case containing all actual operated artifacts as exact base64 members, plus a hash manifest and result.json. Completed chapters are verified and reused rather than re-running finished UI work.

The module borrows both original pages and creates only one temporary attachment-inspection page at a time; it closes that owned page in finally and restores the borrowed viewport sizes. It does not close the caller's pages, contexts, browser or servers. The original owner must retain its process lease for the full call and inspect the resulting screenshots and real pages. The module reports opened/rendered artifacts; human visual inspection should be recorded separately after actually viewing them.

If a server restarts before an uncommitted request, the original household generation may reject that old context. Preserve its full pending request and actual definitive response. Do not silently substitute a new request or select a different household. The ordinary UI correction mechanism remains the original route.

## Competition and evidence status

Official rules checked 13 October 2026: https://amazonappdev2026.devpost.com/rules . The published submission deadline is 23 October 2026 at 12:00 noon PDT. The rules describe Alexa+ through MCP 2025-11-25 and an optional simulated web experience. Verify the current official rules again before final submission; this source release does not submit an entry.

The existing optimizer, approval and device dispatch remain the project's simulated/planning behavior. Measured CSV provenance is separately retained. A real measured input does not convert a modeled schedule into an observed device execution.

Independent source review covered the original parser, energy model, service and exact household cold-import joins. Focused V8 execution of those unchanged functions confirmed contiguous 100Wh + 150Wh half-hours → 0.25kWh / USD0.03 at the selected price; a crossing 90-minute interval left both hours null; an invalid-energy overlapping row excluded its valid neighbor; whole-household modeled/difference fields remained null; exact saved-review reinspection passed; New York spring/fall and Lord Howe fractional transition slots followed the unique-boundary exclusion policy.

Those are implementation checks, not an actual Node/SQLite/browser operating result and not measured-source acquisition. The complete real-input course remains for the original equipped owner. Its result and original rendered artifacts determine actual execution status.
