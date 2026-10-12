# Timescale commissioning intake

This workspace takes a complete original Timescale commissioning report into the
existing DuckDB customer workspace. You can inspect its native source tables, review
the meaning and SQL representation of every field, import immutable editions, and
save a pair for the existing reconciliation workflow.

Open **Timescale intake** from Dataset workspace or Dataset reconciliation. The page
uses the same private launch link, customer workspace identity, database and request
journals. It starts no additional listener.

## Complete workflow

1. Download the complete JSON report from the original Timescale commissioning
   workspace. Keep the original file unchanged.
2. In **Commissioning reports**, select that file and choose **Retain report**.
3. Open the retained report and select one of its native source tables.
4. In **Source and field review**, inspect the original rows and review all fields,
   their SQL types, roles, meanings, units and time interpretation.
5. Choose **Review complete source**, inspect the returned review, and choose
   **Import reviewed edition**.
6. Repeat for the other original source table or report edition.
7. In **Reviewed editions**, choose which immutable edition is the baseline and
   which is the observed source.
8. In **Pair and compare**, choose matching keys and compared fields, review the
   complete definition, and save it.
9. Open the saved pair in **Dataset reconciliation**. Run the original paired
   accounting, review row and group differences, record decisions, save a report,
   and export the full portable customer handover.

A field or row filter changes the displayed preview. It does not change the
complete source, reviewed mapping or imported row set.

## Original report and source scope

The input is the original exported commissioning JSON report. It contains the
complete immutable revision chain and the native source files as exact UTF-8
content. Report SHA-256, source SHA-256, table digest, commissioning identifiers,
source identifiers, source role and contract revision travel with the imported
edition.

The intake validates and retains its own report format. It does not create a
purchase or delivery receipt for the report. Acquired SF88 and SF100 datasets keep
their existing delivery validation and import paths.

A source can have the role **BASELINE** or **OBSERVED**. That role identifies its
place in the original commissioning report. The operator still chooses the two
specific imported editions used by a saved pair.

The source panel distinguishes a provider completeness declaration from a source
that has no such declaration. Importing every row of a retained native table does
not establish coverage of an entire external historian or provider account. The
original scope note and completeness declaration remain available with the
edition and exported handover.

**Download original report** returns the retained original file. Its complete byte
count and SHA-256 are shown beside the report, so the original report can be
reopened independently.

## Native values and reviewed types

Commissioning source cells are PostgreSQL text or SQL NULL. The original column
OID is retained. The default DuckDB mapping stores every native field as
`VARCHAR`, preserving the native textual value.

The preview marks SQL NULL and an empty string separately. A blank-looking
string is not silently converted to NULL or a numeric zero. Every original field
remains in the mapping, including fields outside the current mapping page.

| Choice | Reviewed behavior |
| --- | --- |
| `VARCHAR` | Retains the original textual value and SQL NULL. |
| `BIGINT`, `HUGEINT` | Require an exact representable integer. |
| `DECIMAL(p,s)` | Requires an exact decimal that fits the declared precision and scale, with precision at most 38. |
| `BOOLEAN` | Uses the accepted native boolean literals; other source strings require correction or a textual representation. |
| `DATE` | Requires an explicitly selected and valid date representation. |
| `TIMESTAMP`, `TIMESTAMPTZ` | Require a valid native timestamp without loss below microsecond precision. Record the time interpretation and any time-zone meaning explicitly. |
| `JSON` | Parses the original field as JSON only when this type is selected. |
| `DOUBLE` | Requires the separate explicit permission for approximate conversion. |

The native source review is authoritative. If an original value does not fit its
selected representation, the review returns the concrete source problem. Adjust
the explicit mapping or preserve that field as text and review it again.

A type change creates a different reviewed interpretation. It does not replace
the retained commissioning file, source table or an existing imported edition.

## Field roles and meaning

Every original source field has a reviewed role and meaning:

- **Tag / identifier** identifies a native tag, record or source entity.
- **Time** identifies a field whose original time interpretation is relevant.
- **Measured value** identifies a value to analyze or compare.
- **Quality** identifies a native quality or status field.
- **Attribute** retains additional original source information.

A review requires at least one tag or identifier field and one measured value.
Time and quality fields are optional; the complete source scope, null note and
time note remain explicit.

The form initially describes each field as its original PostgreSQL field. Replace
or extend that description with the operational meaning needed by the customer.
Record units, time zone and precision where they are known from the source. An
empty units or time-zone entry remains undeclared.

Source imports preserve every original row, including duplicate identifiers, and
use `keys: []`. Choose matching keys in **Pair and compare** after both immutable
editions are imported. The comparison engine retains and accounts for complete
duplicate groups.

If an earlier browser draft contains an import-key selection, the source editor
shows that saved selection and provides **Clear import-key selection**. Clear it
explicitly before reviewing the source; the form preserves the old draft until
that action is taken.

The source review covers every field. Mapping pagination and the field-name
filter affect the editor view only.

## Immutable editions

A successful import records the complete reviewed conversion and attaches the
original Timescale report and source binding to the immutable DuckDB edition.
The retained receiving guide is part of the original source-file selection, so a
later installed guide update does not replace the guide belonging to an existing
review.

**Reviewed editions** pages through the saved native reviews. An imported review
opens its original edition, including the complete source meanings and conversion
details. Earlier editions can also be opened by their full edition identifier.

An interrupted import continues its original request. Reopening a review or
refreshing a catalog does not import an edition.

## Pair creation and comparison

Select two different immutable Timescale editions. Give the pair a stable name
and a useful display label. The name remains fixed when editing a saved pair;
saving an updated definition creates a new pair revision.

**Match identical names and native types** adds fields that match exactly on
both sides. It does not decide which fields are keys. Select at least one
matching key and review the meaning of every compared field.

The field rows display the retained role, units and time-zone meaning from each
source. Equal SQL types alone do not establish equal operational meaning. Use
the explicit field mapping and operator notes to document the intended
comparison.

The intake form retains original values with empty source and target value maps.
The existing full reconciliation editor provides explicit value maps when they
are required. Original fields omitted from the pair are listed by the native
review and remain in their source editions.

With no comparison windows, the pair includes all original rows. Each optional
window includes its start and excludes its end. A native comparison uses the
selected field's native type. A lexical window on `VARCHAR` compares exact
strings; it does not convert differently formatted timestamps into an elapsed
time axis.

**Review pair definition** uses the existing native paired review. **Save
reviewed pair** delegates to its original request journal. The saved-pair link
opens that exact pair in Dataset reconciliation without replacing a separate
unsaved definition already held in the reconciliation editor.

The original paired engine then provides complete row accounting, duplicate-key
groups, engineering decisions, report snapshots and portable export. Timescale
intake does not introduce a second comparison implementation.

## Recover a request

The browser retains the complete request identity and body before its first
write. For a report upload it also retains the exact file bytes, original
filename, SHA-256 and request headers in one browser-storage transaction.

Tabs in the same original workspace reuse the first retained request for the
same complete action. A lost response does not require a fresh upload identifier,
review or import.

In **Saved requests**:

1. Choose **Inspect original request** to reopen its actual native state.
2. If complete, **Continue original request** reopens the existing result.
3. If incomplete, continue that same retained operation explicitly.
4. For an incomplete upload, continuation sends the same original file and
   headers under the same request identifier.
5. If the original browser file is unavailable, select the same original report
   in that request's file control. The complete byte count and SHA-256 must match
   before it can continue.

If the original host reopens on another browser origin, find the incomplete
upload in the **Native intake journal**, choose **Reopen native request**, then
select its exact report using **Restore original report for this upload**. The
browser checks the complete report SHA and retains that original request ID,
filename and headers before offering continuation. Restoring the file does not
send the upload. Continue the original request explicitly after restoration.

The original host can also reconcile an interrupted upload without a browser
file if all original bytes are already retained. Its resume result identifies
`DUCKDB_TIMESCALE_SOURCE_REQUIRED` when those bytes are still needed.

A catalog refresh and a GET of a request never replay a write. A previously
completed local request that is absent from the currently opened native
workspace requires reopening its original workspace and result.

If browser storage is unavailable, the existing CLI and MCP routes remain
available. The browser reports the actual storage failure before sending a new
request whose complete input could not be retained.

## CLI

The existing DuckDB command owns this workflow:

```bash
stellar-forge-duckdb --workspace ORIGINAL_DIR timescale-intake status
stellar-forge-duckdb --workspace ORIGINAL_DIR timescale-intake reports
stellar-forge-duckdb --workspace ORIGINAL_DIR timescale-intake report REPORT_SHA
stellar-forge-duckdb --workspace ORIGINAL_DIR timescale-intake source REPORT_SHA SOURCE_UUID
stellar-forge-duckdb --workspace ORIGINAL_DIR timescale-intake reviews
stellar-forge-duckdb --workspace ORIGINAL_DIR timescale-intake operations
stellar-forge-duckdb --workspace ORIGINAL_DIR timescale-intake request REQUEST_ID
```

Inspect a complete original local report before retaining it:

```bash
stellar-forge-duckdb --workspace ORIGINAL_DIR timescale-intake inspect --file PRIVATE_REPORT --sha256 ORIGINAL_SHA256
```

Retain, review, import and save a pair using the complete original JSON body:

```bash
stellar-forge-duckdb --workspace ORIGINAL_DIR timescale-intake retain --input PRIVATE_RETAIN_JSON
stellar-forge-duckdb --workspace ORIGINAL_DIR timescale-intake review --input PRIVATE_REVIEW_JSON
stellar-forge-duckdb --workspace ORIGINAL_DIR timescale-intake import --input PRIVATE_IMPORT_JSON
stellar-forge-duckdb --workspace ORIGINAL_DIR timescale-intake pair-review --input PRIVATE_DEFINITION_JSON
stellar-forge-duckdb --workspace ORIGINAL_DIR timescale-intake pair --input PRIVATE_PAIR_JSON
stellar-forge-duckdb --workspace ORIGINAL_DIR timescale-intake resume REQUEST_ID --workspace-id CUSTOMER_WORKSPACE_ID
stellar-forge-duckdb --workspace ORIGINAL_DIR timescale-intake report-file REPORT_SHA --destination PRIVATE_REPORT_COPY
```

Mutation JSON uses the browser contract. A host-local retain body also contains
the original `report_path`. Preserve `request_id`, `workspace_id`, the original
report SHA and complete reviewed body on continuation.

The existing `serve` command opens the same local browser workspace. The
existing `reconcile` commands own runs, decisions, reports, full exports and
portable receiving. Use their current `--help` output for those original
operations.

## Registered agents and typed client

The existing DuckDB registration can include:

```json
{
  "timescaleReports": [
    {
      "name": "customer-commissioning",
      "reportPath": "/absolute/private/path/original-commissioning-report.json",
      "sha256": "COMPLETE_ORIGINAL_REPORT_SHA256"
    }
  ]
}
```

The registration is host-owned and bound to the existing description. An agent
selects the registered alias and exact report SHA. It does not select an
arbitrary host path or create another workspace.

The existing `action: "duckdb"` supports these operation names:

| Area | Operations |
| --- | --- |
| Sources | `timescale-intake-status`, `timescale-intake-registered-reports`, `timescale-intake-reports`, `timescale-intake-report`, `timescale-intake-source` |
| Review and import | `timescale-intake-retain`, `timescale-intake-review`, `timescale-intake-import`, `timescale-intake-reviews` |
| Original requests | `timescale-intake-request`, `timescale-intake-operations`, `timescale-intake-resume` |
| Pair and source handover | `timescale-intake-pair-review`, `timescale-intake-save-pair`, `timescale-intake-manifest`, `timescale-intake-file` |

Agent retain uses the original `request_id`, `source` alias and `sha256`.
The native registration supplies the actual customer workspace identity.

The typed client exports `openDuckDBTimescaleClient` and
`parseTimescaleIntakeManifest`. Its source declarations and receiving client
travel in the merchant distribution together with the Python package, browser
assets and this guide. Original source manifests and file chunks provide the
complete report and source files for portable receiving.

## Complete browser and customer receiving

The installed `timescale_intake/browser-receiving.mjs` exports
`runTimescaleIntakeBrowserReceiving`. Its caller supplies the original running
DuckDB launch URL, exact receiving input, a private output directory and the
installed Playwright engine. The function opens the existing operator interface
and closes its own browser context when finished.

The complete input contains:

| Input | Original value |
| --- | --- |
| `operation_id`, `source_commit`, `workspace_id` | The existing receiving operation, installed source and customer workspace |
| `report.path`, `report.sha256`, `report.filename` | The exact complete local commissioning report and its original upload filename |
| `baseline`, `observed` | The selected original source UUID, every field in native order, complete interpretation and empty import keys (`keys: []`) |
| `pair` | Name, label, all comparison fields, explicit empty value maps, windows and notes |
| `actor`, `reason` | The operator and original observation carried into the subsequent reconciliation review |

The browser receiver performs the customer workflow through visible controls:

1. Retain the complete original report file, then download it through the
   original browser action and compare all returned bytes.
2. Open both native source tables, check the displayed text, NULL and empty
   strings, and edit every field page and interpretation note.
3. Review each complete mapping and import its original immutable edition.
4. Select both exact editions, enter the comparison definition and save the
   reviewed pair through the existing reconciliation journal.
5. Open that saved pair in the original reconciliation editor with the exact
   source and target editions.

The receiver retains `intake-browser-input.json`, the persistent browser
profile and `intake-browser-receiving.json` in its original output directory.
It records the existing native request identities before continuing an operation.
Restarting with the same input reopens those requests and complete results. The
native journals allow recovery when the original server has reopened on another
port. If the former local upload path is absent, a completed original upload can
reopen its exact retained report bytes from the customer workspace. Its full
SHA-256, filename and byte count must match; this recovery does not create a
report or recapture a provider source. An incomplete upload can restore the exact report under its original
request; a saved pair continues through the original reconciliation controls.

Its completed result includes `report_id`, `baseline_edition`,
`observed_edition`, `pair_id`, the actual normalized saved `definition`, and
these original `request_ids`: `retain`, `baseline_review`,
`baseline_import`, `observed_review`, `observed_import`, and `pair`.
The first five belong to the intake journal. The pair belongs to the original
reconciliation journal.

The complete customer receiver then passes that actual saved definition into
`runReconciliationBrowserReceiving`. Its original request matching reopens the
same pair before the native run, row review, report and full handover. The
existing typed client receives every original export file and reopens the
portable warehouse. The intake source manifest carries the complete original
commissioning report and this retained guide alongside the reviewed sources.

A completed browser step alone does not mark the complete customer receiving as
finished. The surrounding receiver records completion after the original agent
requests, source files, comparison report and portable warehouse have all
returned and reopened.

## Installation and handover

The `stellar_forge_buyer.timescale_intake` package is included in the original
buyer Python distribution. Its browser assets and operating guide are package
data. The DuckDB merchant contribution includes all intake modules, original
shared hooks, agent contracts, typed client and receiving entry points.

Use the complete current merchant distribution when installing this capability.
An older browser alone does not add the native source format or agent actions.

A customer handover should include the complete original commissioning report,
reviewed native editions, saved pair definition, reconciliation report and
portable warehouse export. The original report and source identities can then
be reopened alongside the actual comparison results.
