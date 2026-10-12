# Staff market workbench

A complete local operating workspace for compensation data: retain source editions, review job and survey matches, calculate reproducible market comparisons, review receiving results, track survey cycles, and save or restore the entire workspace. The publisher-intake and receiving modules join the same database and operation history.

The application uses original source records and explicitly recorded decisions. Published survey percentiles stay labeled as their original measures. Combining several survey medians produces a weighted consensus of those published medians; it does not establish the median of a pooled employee population.

## Run the application

Use Python 3.11 or later. The core, local server and storage use the Python standard library. Publisher intake uses Node 24 and its standard library; no package installation is required. The browser uses local static files.

Choose a new private directory for the workspace. Keep that directory on a volume retained by the receiving operator.

```bash
python3 cli.py --workspace /path/to/staff-market-workspace init --title "Staff market workbench"
python3 cli.py --workspace /path/to/staff-market-workspace serve --port 0
```

The server prints its actual localhost URL. Open that URL in a browser on the same machine. Stop it with Ctrl-C and run the same serve command to reopen the original workspace. A deployment can put this loopback application behind the receiving organization's existing authenticated access route; that route and authorized data storage are commissioning inputs.

Every native mutation has a stable operation ID and the revision the operator reviewed. The server rejects a stale change before writing it. The browser retains uncertain requests locally so the same operation can be reconciled after an interrupted connection. A successful replay returns the original result without repeating the operation.


## Move through the operating views

| View | Main work | Continuation |
| --- | --- | --- |
| Sources | Retain original job, survey and peer files; reopen saved mappings and inspect every originating row | Use the reviewed current job and survey editions in matching |
| Publisher intake | Map a publisher file, review exact included rows, and select an original peer cohort | **Use full reviewed edition** or **Use this peer cohort** opens that exact group in matching |
| Jobs and matches | Review the job's benchmark disposition, compare its content with original survey rows, and save professional match and factor decisions | Select the retained decisions in Market analysis |
| Market analysis | Calculate the stated source/date basis and review the exact frozen result | Accepted results become available in receiving |
| Survey cycles | Track selected peers, actual participation, received source editions and close decisions | Retain each cycle with its original source references |
| Receiving and annual review | Configure a handback, reconcile a returned file, and compare saved editions | Open a pricing-action decision against its original analysis |
| Decisions and exports | Reopen the full historical analyses, receiving decisions and accepted reports | Open an original analysis for review or export |
| Workspace | Save the complete native workspace, restore it, or reconcile an interrupted browser request | Resume the same saved operation and result |

Reviewing a publisher edition or retaining a cohort keeps the Publisher view open so the operator can continue selecting peers. The explicit pricing buttons carry its immutable reviewed group into the complete, paginated matching view. Browsing all current survey rows is a separate explicit action. A decision made within a saved group retains that group's original identity; the native engine checks that the chosen survey row belongs to it.

Publisher and receiving editors remain mounted when the operator navigates to another view. Original base-view drafts and receiving correction context also reopen through the browser's local draft storage. Save a source review, receiving record or cycle before closing the browser to make it part of the portable native workspace.

## Turn a returned correction into a reviewed pricing result

In **Receiving and annual review**, choose **Prepare handback**. Select accepted analyses from a reviewed pricing edition, choose the recipient's required columns and source paths, and inspect the complete preview. Enter the receiving operator and recipient, then save the frozen handback before downloading its CSV, TSV or full JSON. Exported figures retain their original precision and the configured column contract.

In **Returned corrections**, select that original saved handback and upload the actual returned file. Review column mapping and the row-by-row changes, then save a reasoned disposition for each row. The full original return file stays with that review. A request for pricing review opens the exact original analysis and carries the saved decision and changes into the main pricing view.

Update the actual match decisions, source edition or calculation basis as appropriate. Calculating creates a new analysis. The engine checks the original receiving review, row, pricing-action decision, previous result hash and logical job; the new result freezes those references with its own calculation. Review that new result before preparing a new handback. The prior accepted analysis and handback remain readable.

Use **Annual editions** to compare two saved handbacks. Review exact additions, removals and changed fields; retain explicit pairing where the receiving identities have changed. An annual pricing-review decision uses the same linked pricing continuation. **Saved receiving history** reopens complete handbacks, return reviews and annual decisions with their original source and printable reports.

## Source files and editions

The Sources view imports UTF-8 CSV or JSON. CSV delimiter and numeric conventions are explicit. JSON accepts an array of records or an object with a records array. Uploads are limited to 16 MiB, 100,000 records and 256 columns per source.

A source has a kind, source name, edition, original file bytes, a mapping, defaults and metadata. Source kinds are jobs, surveys and peers. The source name groups editions; importing a different name creates a separate source family. The native preview retains row errors and the original values. Only a preview with resolved errors can be committed.

Each committed edition has stable normalized record IDs and original-source hashes. A repeated exact import reopens the existing source. A later imported edition becomes current for that source name. Changes are classified as new, changed, unchanged and removed against its prior imported edition. Historical records and accepted analyses remain readable.

### Canonical input fields

| Kind | Required identity fields | Operating fields |
| --- | --- | --- |
| Jobs | id, title | description, family, level, reference_amount, currency, period, amount_scale, annual_hours, periods_per_year, source_url |
| Surveys | id, job_title | description, publisher, survey_name, effective_date, currency, period, amount_scale, annual_hours, periods_per_year, p25, p50, p75, geography, industry, organization_size, cohort, organizations, respondents, source_url |
| Peers | id, name | cohort, geography, industry, organization_size, source_url |

Mapped values retain the original source cell. A blank field can use an explicitly recorded source-wide default. Numeric defaults use canonical plain decimal notation. Localized parsing applies to original textual cells; native JSON numbers preserve their numeric meaning. The original bytes remain available alongside the normalized records.

The metadata should record permitted use and any actual provider disclosure conditions. The optional minimum_organizations setting applies the supplied provider threshold; its value must come from the agreed source contract. The product does not choose a licensing or disclosure policy for the publisher.

## Review job and survey matches

Open the job description and candidate source record together. Examine actual responsibilities, level, supervisory scope and comparison cut. A match records the exact job and survey IDs, reviewer, rationale, inclusion or exclusion, weight, scope adjustment and aging choices.

Selections preserve the original source edition. A new edition marks its old selections as historical. A current analysis requires current job and survey editions; a deliberately historical analysis retains its declared basis.

A selected source row can appear only once in one analysis. Several saved decisions for the same row do not multiply its weight. The operator chooses the exact decisions that belong in each analysis.

## Calculation contract

All values are parsed and calculated with Python Decimal, using 36-digit working precision. The receiving source and saved report preserve decimal strings.

1. **Amount scale.** Multiply a published amount by its explicit scale. The included FSU illustration supplies figures in thousands, so its scale is 1000.
2. **Annualization.** Annual amounts use a period factor of 1. Hourly amounts require annual_hours. Monthly, weekly, biweekly, semimonthly and other periods require an explicit periods_per_year value. These factors are visible in the saved analysis.
3. **Date alignment.** A target date requires the selected survey's actual effective date. Different dates require an explicit aging method. Linear aging uses 1 + rate * years; compound aging uses (1 + rate) raised to years. Years uses the recorded elapsed days and day basis. The rate, method and rationale remain with the selection.
4. **Scope adjustment.** Apply 1 + scope_adjustment_pct / 100 separately from the aging factor. A nonzero adjustment requires its rationale.
5. **Weighted consensus.** For each published percentile figure, sum the adjusted amount times the selected source weight and divide by total weight. Weights must be positive.
6. **Reference comparison.** Where the job supplies a compatible reference amount, report its annualized amount divided by each available consensus figure, multiplied by 100.

Sources need one compatible currency; currency conversion is a separate agreed input. Missing measures are displayed as missing. If any selected source lacks p25 or p75, the consensus for that measure is withheld. Missing medians, invalid period/date inputs, superseded current-mode sources or unmet recorded provider thresholds require correction before acceptance.

An analysis without a common target date preserves its declared source-date or worked-example basis and displays that fact. Effective dates from a neighboring illustration must not be assigned to the selected rows.

Each saved analysis freezes the complete selected job, source rows, match decisions, conversion details, source revision, errors and warnings. Its result hash binds the receiving review to exactly that content.

## Receiving review and exports

A reviewer records acceptance or requested changes against the exact saved result hash. An analysis containing unresolved errors cannot be accepted. Corrections are saved as a new analysis; the original decision remains readable.

Accepted reports are available as CSV or complete JSON. CSV is suitable for the agreed receiving columns, and text cells that could be interpreted as spreadsheet formulas are escaped. JSON preserves the detailed source and calculation records.

The receiving extension adds configured recipient columns, frozen handoffs, return-file reconciliation and annual-edition review. Its records share the original SQLite database and backup. Use its guide for the exact receiving schema and action names supplied with this package.

## Survey-cycle operations

A cycle records its owner, due date, selected peer records and participant status. Received or reviewed items point to original imported source editions. Closing a cycle requires every participant to be reviewed or declined, with a saved close note.

The commissioning partner supplies the actual questionnaire, participation and contact process, disclosure requirements and source files. The operator records those real events and receiving decisions; importing a peer list alone does not establish participation.

## Complete save, restore and reopening

The Workspace view prepares a native backup operation. Downloading it creates a consistent SQLite snapshot and a ZIP containing the complete database plus a manifest. Original uploaded bytes, source editions, analyses, reviews, cycles, extension tables and operation outcomes travel together.

The backup ID identifies that one snapshot. Downloading the same completed ID returns the same archive. A new backup operation creates a new snapshot after later work. Preparation records the operation; the actual snapshot is captured when that backup is first generated, and the manifest records the captured workspace revision.

```bash
python3 cli.py --workspace /path/to/staff-market-workspace backup --operation-id staff-market-backup-20261011
python3 cli.py --workspace /path/to/restored-staff-market restore --package /path/to/backup.zip
python3 cli.py --workspace /path/to/restored-staff-market serve --port 0
```

Restore uses a fresh directory. It checks the archive membership, exact file size/hash, SQLite consistency and original workspace identity. An interrupted receiving operation can resume with the same archive and target. Reopening a completed restore preserves later work in that restored workspace.

The archive contains the complete private source data. Choose its receiving destination according to the commissioning organization's source-use and access arrangements. The application never automatically sends it to a third party.

## Native API and extension contract

GET /api/state exposes the workspace and current source/review summaries. GET /api/records/{kind} supports complete paginated access through q, offset, limit, current and source_id. GET /api/document/{source|record|analysis|cycle}/{id} opens the original document. GET /api/original/{source_id} returns its original uploaded bytes.

Mutations use JSON with operation_id and expected_revision:

| Route | Operation |
| --- | --- |
| POST /api/import/preview | Retain a source and inspect its mapping/errors |
| POST /api/import/commit | Commit an error-free original preview |
| POST /api/selection | Save a match decision |
| POST /api/analysis | Save a frozen market comparison |
| POST /api/review | Review that exact comparison |
| POST /api/cycle | Save the survey-cycle state |
| POST /api/backup | Prepare a native backup identity |

Extensions supply host.py with dispatch(workspace, db, action, payload, revision), state(workspace, db), document(workspace, db, kind, identity), and an optional download(workspace, db, kind, identity). The original transaction and operation ledger own all mutations. Read callbacks use a query-only connection. Namespace tables are part of the same database and restore.

POST /api/extensions/{publisher|receiving}/{action} invokes an extension action. Its state, document and download routes preserve that namespace. Browser modules are local static assets under /extensions/{name}/.


A reviewed publisher group can be selected with `publisher_kind=edition|cohort` and `publisher_id=<original hash>` on the survey-record route. Use `current=false` when opening that exact saved edition; the analysis still requires its explicit current or historical source mode. A match can include `publisher_origin: {kind, id}`, which the native transaction validates and retains.

A pricing correction can include `receiving_origin: {kind, id, entryKey, edition}`, using the original return-review or annual-review identity and its saved pricing-action row. The new analysis retains the verified origin and previous result identity.

The CLI provides the same native operations through call, records, show, report, backup and restore. A request passed to call is a JSON file containing the original operation identity and expected revision.

## Original published example

The included examples/jobs.csv and examples/surveys.csv reconstruct the two-survey illustration in FSU's [Staff Pay Administration Guidelines](https://hr.fsu.edu/sites/default/files/PDF/Staff%20Pay%20Administration%20Guidelines.pdf), printed page 22. The provenance file records its exact source, units, pairing and date limits.

The original equal-weight figures yield annual consensus amounts of 35,200, 37,950 and 43,950. The published client reference is 38,600. Rounding the consensus to one decimal place in thousands gives the source's 35.2, 38.0 and 44.0; the reference percentages round to 109.7%, 101.7% and 87.8%.

Run the actual source-to-receiving journey into a new directory:

```bash
python3 examples/open_worked_example.py --workspace /path/to/fsu-published-example
python3 cli.py --workspace /path/to/fsu-published-example serve --port 0
```

The helper imports original rows, saves the table's match decisions, calculates and reviews the exact comparison, exports receiving files, saves the complete workspace, restores it to the declared fresh target and reopens the accepted analysis. It retains native IDs and outputs. Running it again on its own unchanged workspace reconciles the same original operation IDs.

## Current opportunity source

The [FSU public sourcing portal](https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=FSU) lists ITN6857-6, event 1453182, for staff salary market data, peer data and potentially survey management. The retained October 9 notice closes October 28, 2026 at 3 p.m. EDT. sources/issuer.json records the original PDF identity and retrieval.

The published staff guideline supplies operating context and a worked example. The full current solicitation, pricing/forms, addenda and Q&A govern procurement. Publisher licenses, real job/survey files, approved factors, recipient schemas and the chosen deployment/access route are receiving inputs for commissioning this product.


## License and professional decisions

The application source is available under the included [MIT License](LICENSE). Linked FSU documents retain their original terms; the included source example records its public origin and selected numerical transcription.

**Needs expert review:** the commissioning compensation specialist owns job equivalence, cohort choice, licensed data use, adjustment factors and pay-policy decisions. The application preserves those explicit decisions and their source calculations for receiving review.
