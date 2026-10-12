# Complete EQuIS 3 / EQuIS 4 receiving review

This application compares the complete original EQuIS 3 and EQuIS 4 file families, retains their source identities and native fields, and lets the receiving reviewer record explicit correspondence. The completed result contains both original deliveries, two independent field-decision editors, both resulting native file sets, the full comparison, editable correspondence tables and a portable offline review.

Use the Laboratory EDD application in Merchant Workspace, the existing Request application with the laboratoryReview function, or the installed lab-edd command. The original paid-job runtime retains file intake, saved requests, execution, result receiving and recovery.

## Source format contract

The mapping is equis-3-4-receiving / 1.0.0. Its two supported source profiles remain equis-lab-3 / 1.0.0 and equis-lab-4 / 1.0.0.

| Native data | Three-file family | Four-file family | Preserved receiving behavior |
| --- | --- | --- | --- |
| Samples | LabSample | LabSMP | Every physical sample row, source sample code, parent relationship and original field |
| Tests | Test fields embedded in TestResultsQC | LabTST | Exact native test identities, metadata and every original owner row |
| Results | TestResultsQC | LabRES | Every physical result, analyte identity, result type, qualifier, unit, blank result, limit and QC field |
| Batch assignments | TestBatch | LabBCH | Every original test-to-batch assignment, including ambiguous and unresolved parents |
| Dates and times | Commonly combined original tokens | Declared date and time columns | Original tokens plus an explicit civil date/time projection |

The installed native test-key contract retains sys_sample_code, lab_anl_method_name, analysis_date, analysis_time, total_or_dissolved, column_number, test_type and identifier. Results additionally retain cas_rn and result_type_code; batch assignments additionally retain test_batch_type and test_batch_id. Blank, absent and duplicated fields remain distinct.

A complete reported laboratory sample ID is available for candidate search only when the original native parent-test relationship resolves it uniquely. Otherwise candidate search uses the exact source sample code in its own namespace. Analysis time, column, identifier and the section-specific analyte or batch identity remain in the candidate key. Method, fraction and test type stay visible in the complete native identity and field comparison. Their difference therefore remains available when the two published formats label the same candidate differently.

Civil date/time projection validates the actual calendar and retains any explicit offset. It assigns no timezone to a timezone-free laboratory timestamp. Unparsed or incomplete keys remain independent source entities.

An embedded three-file test becomes one logical test entity only when its complete native test identity and every projected test field are equal. All original result-owner rows remain attached to that entity. Four-file test rows and all sample, result and batch rows remain separate entities, including exact duplicate rows.

Primary format references:

- [EarthSoft EQEDD sections, parent relationships and test keys](https://help.earthsoft.com/lib_eqedd_format.htm).
- [EarthSoft EFWEDD four-section contract and test keys](https://help.earthsoft.com/lib_efwedd-format.htm).
- [McCampbell Analytical published EDD formats](https://www.mccampbell.com/edds.php).

The selected receiving organization supplies its installed EDP format and current reference values. These sources describe the published structural contract; the result retains every original lab value alongside the review.

## Open and edit the complete review

Open reconciliation.html after extracting the full completed result. The section totals include both entity counts and physical row references. Search by source values, filter by section or candidate state, and open any group.

A group opens all native identities, original source-row links and complete field differences. The baseline and current source editors open the exact original row identified by its record ID and row SHA. Each editor records keep, set or clear with its own reason in that source's field-decision document.

Correspondence has three explicit group actions:

- **Pair:** select the exact baseline and current entities, then record a reason. Several selections retain each chosen pair and every unselected original.
- **Separate:** retain the candidate records as separate, with the receiving reason.
- **Defer:** retain the whole group for further review. A reason can explain the remaining distinction.

The explicit-entity section also records source-bound links when the reviewer needs to select two same-section entities directly. Each link carries both entity IDs, both entity hashes and its reason. A candidate group is a place to review possible correspondence. Its presence does not create a paired decision.

Correspondence controls the receiving review. Native field values are changed only by their separate source-bound field decisions. The completed output comparison describes the actual two prepared field reviews, with both review hashes retained.

Download JSON, CSV or TSV to save a draft. The complete table includes its source-binding row and every original candidate group, including groups with blank actions. Importing the table checks the exact source pair, mapping, group identities and selected entities. Keep immutable identity columns intact; edit only action, selected pairs and reason. Reloading the completed HTML reopens its immutable saved edition.

The offline editor calculates an opened group's field differences from the original entity graph. The complete field comparison remains available as reconciliation/fields.csv, and the full original graph remains in comparison.json.

## Existing sealed-file function

Use laboratoryReview with these named inputs:

| Slot | Required | Complete input |
| --- | --- | --- |
| source | Yes | Current original delivery ZIP |
| baseline | For cross-profile review | Complete earlier original delivery ZIP |
| decisions | Optional | Current-source field-decision JSON or full CSV/TSV |
| baseline_decisions | Optional | Baseline-source field-decision JSON or full CSV/TSV |
| reconciliation | Optional | Complete saved correspondence JSON or CSV/TSV |

Set profile and baselineProfile explicitly, for example equis-lab-4 and equis-lab-3. reviewName identifies the result edition. expectedSourceSha256 and expectedBaselineSha256 select the exact inspected source manifests. encoding and baselineEncoding select the original text encodings. decisionFormat, baselineDecisionFormat and reconciliationFormat can select an explicit representation; filenames otherwise identify JSON, CSV and TSV.

The supplied merchant configuration declares 16 MiB for each original delivery, 4 MiB for each field-decision document, 16 MiB for complete correspondence and 56 MiB for the complete selected input set. The original file policy enforces these constraints before execution. It retains the independent current and baseline source bytes and original input filenames.

Example request:

```json
{
  "profile": "equis-lab-4",
  "baselineProfile": "equis-lab-3",
  "reviewName": "client-delivery-reconciliation-01",
  "encoding": "utf-8",
  "baselineEncoding": "utf-8",
  "tableScope": "issues"
}
```

Use the original customer Request workflow to attach the full input files. A changed decision document creates a new request/result edition; reopening or replaying the same saved job preserves its original reference and result identity.

## Installed CLI and SDK

The source-pinned distribution is @tokenjunkielabs/starforge-merchant, with the starforge executable. The same command module is available directly from a source checkout.

```bash
starforge lab-edd reconcile \
  --source /private/Equis4_CSV.zip --profile equis-lab-4 \
  --baseline /private/Equis3.zip --baseline-profile equis-lab-3 \
  --out /private/full-comparison-review.json

starforge lab-edd reconciliation-table \
  --source /private/Equis4_CSV.zip --profile equis-lab-4 \
  --baseline /private/Equis3.zip --baseline-profile equis-lab-3 \
  --format csv --out /private/full-correspondence.csv

starforge lab-edd receive \
  --source /private/Equis4_CSV.zip --profile equis-lab-4 \
  --baseline /private/Equis3.zip --baseline-profile equis-lab-3 \
  --decisions /private/current-field-decisions.json \
  --baseline-decisions /private/baseline-field-decisions.json \
  --reconciliation /private/full-correspondence.csv \
  --review client-reconciliation-02 --out /private/client-reconciliation-02.zip

starforge lab-edd result --file /private/client-reconciliation-02.zip
```

Output paths are create-only. Retain the previous complete result when preparing a changed edition.

```js
import { reconcileDeliveries, normalizeReconciliation, previewReconciliation }
  from '@tokenjunkielabs/starforge-merchant/seller/lab-edd/reconciliation';
import { reconciliationTable, parseReconciliationTable }
  from '@tokenjunkielabs/starforge-merchant/seller/lab-edd/reconciliation/table';
import { readLabResult }
  from '@tokenjunkielabs/starforge-merchant/seller/lab-edd/result';

// current and baseline are complete inspectDelivery results using their actual profiles.
const comparison = reconcileDeliveries(current, baseline);
const document = normalizeReconciliation(comparison);
const review = previewReconciliation(comparison, document);
const table = reconciliationTable(comparison, review.document, {format: 'tsv'});
const reopened = parseReconciliationTable(comparison, table.text, {format: 'tsv'});
```

reconcileDeliveries accepts optional currentReview and baselineReview to compare the actual prepared field editions. normalizeReconciliation binds correspondence to the supplied comparison, so a new original source or mapping requires a new review.

readLabResult verifies every complete member, both retained original input descriptors, both field-decision and review identities, both native archives and all their members. It recomputes the original comparison from the retained source tables, the complete correspondence from its document, and the prepared comparison from the two recorded field reviews.

## Complete result contents

The existing current-source outputs retain their original paths: report.html, source/, decisions.json, decisions.csv, decisions.tsv, review.json, issues.csv, lineage.json and prepared/receiving-files.zip.

Cross-profile receiving adds:

| Path | Content |
| --- | --- |
| reconciliation.html | Complete portable correspondence editor |
| comparison.json | Original full source graph, candidate groups and field differences |
| baseline/report.html | Original baseline field editor |
| baseline/source/ | Complete baseline manifest, original rows and native fields |
| baseline/decisions.* | Independent baseline field decisions in all three representations |
| baseline/review.json | Computed baseline native field review |
| baseline/issues.csv and baseline/lineage.json | Complete baseline profile observations and parent relationships |
| prepared/baseline-receiving-files.zip | Every prepared native baseline member |
| reconciliation/decisions.* | Saved source-bound correspondence and full editable tables |
| reconciliation/review.json | Complete correspondence disposition, chosen pairs and retained unpaired entities |
| reconciliation/output-comparison.json | Full comparison of the actual two prepared field reviews |
| reconciliation/fields.csv | Every original field comparison and entity-variant reference |

Each side retains its native-preparation state. When an original native format needs further correction, its exact refusal remains alongside the complete source review, editable documents and source editor.

## Published 2508877 source receiving

The retained originals are the complete public [Equis3.zip](https://www.mccampbell.com/EDDs/Equis3.zip) and [Equis4_CSV.zip](https://www.mccampbell.com/EDDs/Equis4_CSV.zip), acquired with the original receipt in examples/mccampbell/source-receipt.json. Both contain 500 results. The complete comparison traverses all 571 three-file physical rows and 614 four-file physical rows.

| Section | EQuIS3 entities | EQuIS4 entities | Candidate groups | Ambiguous groups |
| --- | ---: | ---: | ---: | ---: |
| Results | 500 | 500 | 492 | 21 |
| Samples | 30 | 32 | 30 | 2 |
| Tests | 41 | 41 | 38 | 3 |
| Batch assignments | 41 | 41 | 39 | 3 |

The 599 groups contain 539 single-candidate changed groups, 29 ambiguous groups, 16 baseline-only groups and 15 current-only groups. The result section has 443 single-candidate groups, 21 ambiguous groups and 14 groups present only in each family. The full field export contains 25,229 field comparisons.

examples/mccampbell/cross-profile-decisions.json is a complete source-bound receiving example. It retains all 29 ambiguous groups as deferred, records one explicit COD correspondence and one exact-entity BOD link, and preserves every other candidate for review. Its reasons identify the actual source sample, method, analysis time and original result. Both independent field-decision documents retain original values during this exercise.

The actual unchanged application, mapping, table, native CSV writer and result-reader modules have run across both complete original source graphs in the connected V8 runtime with memory filesystem, SHA256 and standard DEFLATE adapters. The [complete 37-member receiving result](examples/mccampbell/CROSS_PROFILE.md) retains 125,237,384 logical bytes in an 8,829,090-byte ZIP. All seven prepared native CSV files match their complete original member bytes for the recorded Keep choices. The full archive reopens, and its CSV and TSV tables recover the exact saved correspondence document. The complete native worker/browser operation is supplied separately in receiving.cross-profile.example.json and uses these same originals, source profiles and example correspondence.

```bash
starforge lab-edd-receive \
  --configuration /private/receiving.cross-profile.json \
  --directory /private/cross-profile-receiving \
  --scratch /private/cross-profile-worker-temp
```

Select the installed browser module and executable in that configuration. The original receiver seals both complete files and all selected decision documents, executes the original job, replays the same reviewed job, checks both native file sets and full table round trips, then opens the full operator, downloads its visible outputs, follows an exact baseline source-row link, edits/reopens a correspondence and reloads the immutable edition. It retains the same operation and checkpoints across native and browser phases.
