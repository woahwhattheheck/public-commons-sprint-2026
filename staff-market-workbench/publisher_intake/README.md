# Publisher data and peer cohorts

This module is the publisher intake arm of the existing FSU compensation workbench. The parent application retains survey files, import previews, reviewed editions, job matches and pricing decisions in its own project store. The module uses Node 24 and the standard library; it has no package install or separate database.

## Operator journey

1. Retain the licensed publisher CSV in the original project and register its publisher, survey, edition, source reference and license reference.
2. Map the exact source columns. Set currency, pay period, source unit multiplier and source effective date explicitly, using defaults only where that declaration applies to the entire file. Choose the source numeric convention and delimiter.
3. Generate and retain a preview. It preserves original row values, normalized pay, row/source fingerprints, missing fields, duplicates and conflicting publisher job/cut identities.
4. Review the source. Select the exact rows to include; correct invalid data through a new preview. Choose one row when multiple records carry the same publisher/survey/job/cut/peer/currency identity. Enter the source-selection reason. Enter the responsible operator's identity; the original workbench retains it with the review.
5. Select a peer cohort from the publisher's existing cuts and participant identifiers. Every exclusion carries the failed criterion; an optional minimum organization count also identifies unknown counts. The selected records retain the publisher's reported percentiles and sample counts.
6. Send the reviewed normalized rows and source identifiers to the existing job-matching and pricing engine. The annualized values include an explicit conversion factor. Effective-date aging, scope adjustments and source weights remain explicit decisions in that engine.
7. Import the next edition into the same publisher/survey lineage. Compare editions to review added, unchanged, changed and retired job/cut records. Earlier editions remain available for historical analysis and recovery.

## Source context

The current issuer event is FSU ITN 6857-6, event 1453182, Salary Market Data for Staff & Peer Data and Survey Management. The two-page event document dated October 9, 2026 states the staff/peer-data objective and October 28, 2026, 15:00 EDT close. Original source: https://solutions-selectsite-documents.s3.amazonaws.com/Sourcingevent/1453182-event.pdf .

FSU's March 2026 Staff Pay Administration Guidelines, printed pages 19–22, describes selecting credible surveys, examining job content, choosing industry/size/geography cuts, reviewing sample sizes/percentiles, and using reasoned adjustments with a common effective date. Its survey list and worked example describe earlier years. Source: https://hr.fsu.edu/sites/default/files/PDF/Staff%20Pay%20Administration%20Guidelines.pdf .

Those documents motivate the retained intake fields. The licensed survey and original job descriptions supply the actual operating data.

## JavaScript boundary

```js
import {
  previewPublisherImport, reviewPublisherImport, selectPeerCohort,
  compareEditions, publisherIntakeCsv
} from './publisher_intake/intake.mjs';

const preview = previewPublisherImport({
  csv: originalCsv,
  source: {
    publisher_id: 'publisher-key', publisher_name: 'Publisher name',
    survey_id: 'staff-survey', survey_name: 'Staff survey',
    edition_id: '2026', effective_date: '2026-04-01',
    license_reference: 'Project license record',
    source_reference: 'Retained source file identity', filename: 'staff-survey.csv'
  },
  mapping: {
    survey_job_code: 'Job Code', survey_job_title: 'Title',
    job_description: 'Job Description', scope_cut: 'Data Cut',
    industry: 'Industry', geography: 'Geography', size_band: 'Size Band',
    peer_id: 'Participant ID', p25: '25th', p50: 'Median', p75: '75th',
    organization_count: 'Organizations', incumbent_count: 'Incumbents'
  },
  defaults: { currency: 'USD', pay_period: 'annual', unit_multiplier: 1 },
  delimiter: ',', numberStyle: 'us'
});

const edition = reviewPublisherImport(preview, {
  expectedHash: preview.previewHash,
  reviewer: operatorIdentity,
  reason: reviewReason,
  includeRows: selectedPreviewRowIds
});

const cohort = selectPeerCohort(edition, {
  id: 'regional-higher-education', label: 'Regional higher education',
  reviewer: operatorIdentity, reason: cohortReason,
  filters: { industry: ['Higher education'], geography: ['Regional'] },
  minOrganizations: 5
});

const csv = publisherIntakeCsv(cohort);
const refresh = compareEditions(previousEdition, nextEdition);
```

The example mapping names and cohort minimum are operator selections. Each actual publisher uses its own column labels and appropriate peer definitions. The application should offer defaults for review, preserve the source declarations, and reuse saved mappings only after checking incoming headers.

### Accepted normalized fields

| Field | Meaning |
|---|---|
| survey_job_code, survey_job_title, job_description | Original publisher job identity and content |
| scope_cut, industry, geography, size_band, peer_id | Original reported cut and optional participant identity |
| currency | Explicit three-letter currency |
| pay_period | annual, hourly, monthly, weekly or periodic |
| unit_multiplier | Source scale, e.g. 1000 for amounts expressed in thousands |
| annual_hours | Required source hours basis for hourly data |
| annual_periods | Required source periods-per-year basis for weekly/periodic data |
| effective_date | Source effective date in YYYY-MM-DD |
| p25, p50, p75 | Reported percentiles; p50 required |
| organization_count, incumbent_count | Reported sample counts; absent values remain null |

Annualization multiplies by the declared scale and period basis. Monthly data uses twelve months; weekly/other periodic and hourly data require their explicit annual basis. Annualized outputs round once to cents. Raw numeric strings and the source scale remain in the retained edition. Currency conversion and date aging belong to the parent pricing decisions.

The stable refresh key uses publisher ID, survey ID, survey job code, scope cut, industry, geography, size band, peer ID and currency. Edition ID is separate so annual records can be compared. Renamed codes or cuts appear as added/retired and require a reviewed crosswalk in the parent workbench.

## JSON CLI

The CLI reads one JSON request on stdin and writes JSON, or CSV for the csv command, to stdout. Errors are JSON on stderr with a nonzero exit status.

```sh
node publisher_intake/cli.mjs preview < preview-request.json > preview.json
node publisher_intake/cli.mjs review < review-request.json > reviewed-edition.json
node publisher_intake/cli.mjs cohort < cohort-request.json > peer-cohort.json
node publisher_intake/cli.mjs compare < refresh-request.json > refresh.json
node publisher_intake/cli.mjs csv < export-request.json > reviewed-source.csv
```

Envelopes: columns takes {csv,delimiter} and returns {headers,rows}; preview takes the JavaScript preview input directly; review takes {preview,review}; cohort takes {edition,selection}; compare takes {previous,current}; csv takes {edition}. Quote literal JSON property names normally when preparing request files.

## Retention and integration

Persist the complete original CSV bytes in the parent source store and the complete preview, reviewed edition and cohort JSON as immutable project editions. Annual comparison is reproduced from the two saved edition identities. Store the exact preview alongside its review so excluded original rows remain recoverable. The preview hash binds source metadata, mapping, numeric convention and all row contents. Review checks that hash and the caller's expected hash. Reviewed editions and cohorts validate their own content hash before export/comparison. These hashes detect changed content. The original workbench records the responsible operator's identity and controls access to its private workspace.

Use the parent application's revision/concurrency check when committing a preview, review or selected cohort. A lost response should return the original committed edition ID for that request. Annual refresh creates new editions; the parent keeps historical job matches and pricing decisions linked to the edition originally reviewed. Recovery must carry original files and the complete intake JSON history.

The preview keeps every logical CSV record with its input record number, including errors. Exact duplicate rows are identified and conflicting records retain the other row IDs. Review can include one selected record per identity. A cohort selects existing publisher records; source counts remain attached to each record and are never added across overlapping survey cuts.

For receiving, exercise one mapped import, a conflicting row selection, a reviewed cohort, an annual refresh and JSON save/reopen through the original project store. The pricing/receiving owner consumes these same reviewed records.


## Original Python workspace integration

The `host.py` adapter implements the original F11 extension contract. Keep this complete directory beside `core.py`, including `__init__.py`, `cli.mjs`, `intake.mjs`, `browser.mjs` and `style.css`. It requires Node 24 on PATH, or the `FSU_INTAKE_NODE` executable setting. It uses Python's standard library and makes no remote requests.

The extension name is `publisher`; the original dispatcher calls `publisher_intake.host`. The host owns the existing operation ID, revision comparison, BEGIN IMMEDIATE, commit, rollback and replay response. Publisher processing stays inside that transaction. Its `publisher_docs` table and original uploaded CSV blobs live in the original SQLite database, so the existing workspace backup and restore include them.

| Entry point | Result |
| --- | --- |
| `dispatch(workspace, db, action, payload, revision)` | Executes columns, preview, review, cohort, compare or csv |
| `state(workspace, db)` | Metadata for saved previews, editions and cohorts |
| `document(workspace, db, kind, identity)` | Full preview, edition or cohort by its hash |
| `document(..., "edition-records" or "cohort-records", hash)` | Corresponding original survey source and record IDs |
| `download(..., "original-preview/edition/cohort", hash)` | The exact original uploaded CSV bytes |
| `download(..., "csv-edition/cohort" or "json-preview/edition/cohort", hash)` | Export from the saved document |

Routes use the original host: POST `/api/extensions/publisher/{action}`; GET `/api/extensions/publisher/state`, `/document/{kind}/{identity}`, and `/download/{kind}/{identity}`. The browser assets are `/extensions/publisher/browser.mjs` and `/extensions/publisher/style.css`.

The operator entry point is:

```js
const controller = mountPublisherIntake(target, {
  request: async (action, payload) => {
    // Use the existing API helper: operation ID, current workspace revision,
    // original origin controls, error presentation and retained draft.
    const response = await originalMutation('publisher.' + action, payload);
    return response.result;
  },
  listEditions: async () => {
    const summaries = await publisherState();
    return Promise.all(summaries.editions.map(
      item => publisherDocument('edition', item.id)
    ));
  },
  onEdition: async saved => {
    // Refresh the original Sources/pricing selection.
    // Resolve edition-records or cohort-records to retain original row IDs.
    await refreshOriginalSources(saved);
  },
});
```

The controller supplies `refresh`, `openEdition`, `openPreview`, `openCohort`, and `destroy`. It renders source metadata, column mapping and explicit declarations, row review, peer cohorts and annual comparisons. A review or cohort callback runs after persistence completes. Use `openPreview(preview, {csv})` when reopening its original file. State responses contain metadata; load the full selected edition through the document route.

The native bridge resolves review, cohort, comparison and CSV references against saved server documents. It uses only the supplied hashes from browser documents, so the original server's decimal-preserving JSON parser cannot change previously reviewed numeric content. Numeric defaults have plain decimal meaning; the selected locale applies to textual cells in the uploaded CSV.

Review also creates the original workbench's survey records through its existing preview/import methods, within the same transaction. Those records contain the already annualized percentile amounts with period `annual` and scale `1`. The original reported percentiles, unit multiplier, pay period, annualization factors, source bytes, license reference and row decisions remain in the saved publisher edition. This prevents applying a scale or annualization twice. A cohort retains the selected original native record IDs while the full edition remains available for other job matches.

The kernel accepts CSV files up to 25 MiB, 100,000 rows and 128 columns. The original host also applies its request limits and its 16 MiB normalized import limit; select a suitable survey subset when the derived native record document exceeds that boundary. Full source hashes and original files remain available across review, import, selection and backup.

## Exact decimal calculation

Uploaded numeric lexemes and plain-decimal configuration values are retained in `normalized.exact`. The parser supports up to18 fractional decimal places and checks bounds before rounding. Multipliers and annual periods/hours use integer coefficient/scale arithmetic. Positive annual amounts round HALF_UP once to two decimal places; `normalized.annualized_exact` supplies the original Decimal pricing import and CSV export. `10.075` therefore becomes `10.08`. Numeric convenience fields support the operator display, while exact strings drive calculations, comparison and import. Job and peer identifiers remain text, preserving leading zeros and identifiers above the JavaScript safe-integer range. Organization/incumbent counts must be whole numbers and keep their explicit upper bounds.

At the HTTP boundary, send only saved hashes for review/cohort/compare/export: `preview: {previewHash}`, `edition: {editionHash}`, comparison `previous/current: {editionHash}`, and CSV `edition: {kind, editionHash or cohortHash}`. The host resolves the complete saved source documents. This keeps review requests compact and prevents browser serialization from changing source precision.


## Original application browser composition

Serve this subtree through the original application's existing extension route. Load
the maintained operator with a dynamic ES module import:

```javascript
const {mountPublisherBridge} = await import('/extensions/publisher/bridge.mjs');
const publisher = mountPublisherBridge(container, {
  request, mutate, refresh, note,
  async onSource({document: source, native, recordIds, firstRecordId, navigate}) {
    selectedSurvey = firstRecordId
      ? await request('/api/document/record/' + encodeURIComponent(firstRecordId))
      : null;
    // Retain recordIds/native with the parent's source-selection context.
    // Automatic retention keeps this editor open for peer selection.
    // The existing Use buttons explicitly request the pricing transition.
    if (navigate) { currentView = 'matches'; await render(); }
  }
});
await publisher.ready;
```

The bridge owns its editor container and stylesheet. Keep the mount alive while
the operator works with an edition; call destroy() when that view is replaced.
Its refresh() updates the parent's current workspace state with refresh(false)
and reloads the original retained publisher index. The original parent mutation
function remains responsible for request identity, expected revision, uncertain
request recovery, and commit outcome. The bridge returns the inner result only
after that original mutation succeeds.

onSource is invoked after a reviewed edition or peer cohort is retained. It
supplies the original source document, native import metadata, all selected native
record IDs, and the first record ID. Automatic review/cohort retention passes navigate=false; the two explicit Use
buttons pass navigate=true. Save the selection context on every callback and
open pricing only when navigate is true, so peer selection remains available
after reviewing a source.

The saved-work controls reopen a source preview with its exact downloaded UTF-8
file, including an original BOM, or reopen a selected peer cohort together with its
parent reviewed edition. Complete retained editions are loaded with two concurrent
document reads. Compact hash references drive review, cohort, comparison and CSV
requests; the server reopens original documents from its existing transaction.

The returned API is ready, refresh(), openEdition(documentOrHash),
openPreview(previewHash), openCohort(documentOrHash), and destroy(). ready resolves
when the initial retained index is available. The built-in source editor reports
its own document-loading and processing state.
