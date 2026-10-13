# Address source review

This operator adds **Address QA** to the existing QGIS analyst Evidence workspace. It reads retained source bytes, records an explicit screening policy, and prepares candidate groups for named review. Every accepted analysis becomes a normal evidence source and case edition. The original project, request journal, findings, frozen reports and full project receiving remain in use.

## What the screening means

A candidate is a request for interpretation. Matching address strings or point coordinates can be legitimate: units can share a point, one building can have multiple addresses, and different records can represent different source versions. The operator does not correct publisher data, validate mail delivery, geocode an address, certify an emergency-dispatch dataset or declare two records to be duplicates.

The ASDI profile keeps these distinctions:

| Source meaning | Original field | Treatment |
|---|---|---|
| Response object identity | objectid | Used for query inventory reconciliation, separate from the selected business identity |
| Selected business identity | globalid | Preserved exactly; comparison uses the explicitly displayed normalization |
| Address number | adr_num_comp | Original text preserved, including suffixes represented in this source field |
| Full street | pstr_fulnam | No street abbreviation or punctuation substitutions |
| Building and unit | adr_bldg, adr_unit_typ, adr_unit_id | Included in the complete address signature |
| Postal city | adr_city | Kept separate from municipality |
| Municipality | adr_muni | Administrative attribution; a different postal city is not a defect |
| Postal code | adr_zip5 | Source value, without a deliverability claim |
| Source edit value | date_ed | Original string; not an inferred publisher timestamp |
| Geometry | Original feature geometry and response CRS | No invented coordinates, rounding, distance or reprojection |
| ZIP+4 | adr_zip4 | Retained in original source; the value 0000 does not become an automatic invalid-address finding |

The signature normalization is Unicode NFC, trimming, Unicode-whitespace collapse and case folding. It does not expand abbreviations or remove punctuation. It includes number, street, building, unit type, unit identifier, postal city, region and postal code. All eight components must be explicitly mapped when this rule is selected.

## Receive original sources

Open **Evidence → Sources**. Upload each complete original JSON file using the existing source upload workflow, inspect its actual byte count and SHA-256, and save its source record. Keep the publisher URL, issuer, retrieval observation, edition, query scope and coverage limitations.

Supported feature originals are GeoJSON FeatureCollections and Esri FeatureSet JSON responses. Retain their complete original attributes and geometries. For a paged service, retain every original response and the layer metadata separately. Do not paste a screenshot or manually reconstruct rows as an original response.

The Address QA analysis accepts up to 100 feature files, 50,000 original records and 256 MiB of selected source JSON. Each original file remains subject to the existing 128 MiB source limit. Larger cohorts require an explicitly bounded review case; they must not be silently truncated.

## Prepare the review

1. Open **Address QA**. For a new case, choose **Prepare new case** in the Evidence header. To add another analysis to an existing case, select that exact case first.
2. Enter the title, jurisdiction, review as-of date and exact source/query scope.
3. Select only original feature pages in **Original feature files**. Select the layer metadata in its separate field.
4. For inventory reconciliation, choose all four original observations: opening count, opening complete object IDs, closing count and closing complete object IDs. Leave all four empty for an explicitly limited retained-file analysis.
5. Apply the ASDI field mapping or enter the actual field names from your source. The backend checks mapped fields against metadata, declared response fields and every original record.
6. Select required fields and screening rules. Required fields are the analyst's policy; they do not automatically represent an issuer requirement.
7. Inspect the original and current draft basis. If another operation advanced the workspace or case, use **Keep draft and adopt reviewed current basis** only after reconciling that change.
8. Save the analysis. The exact original request body and UUID are retained before the POST. Receive its original outcome after an interrupted response.

The command atomically saves the analysis JSON, complete record CSV, complete candidate CSV and case edition through the original workspace mutation. Original feature and metadata files remain unchanged.

## Read coverage correctly

A matching opening count, closing count, complete ID sets and received ID set establishes membership reconciliation for the declared query. It does not prove that every attribute was read at the same instant. It does not establish coverage of the whole statewide dataset.

If counts or IDs differ, the analysis keeps the complete observations and displays a coverage discrepancy. Resolve that discrepancy with the publisher or select an explicitly bounded source cohort before relying on completeness.

A response's exceededTransferLimit flag and original metadata remain in the analysis. A service can report a limit on an individual response even when an explicitly selected complete ID inventory is collected through multiple pages. Read the complete inventory result and source pages together.

## Inspect every candidate

Choose a saved analysis. The summary reports record count, candidate count, affected-record count and counts by rule.

Use **Candidates** or **All original records**, a search term, rule filter and page size. Press **Read selected source page** to apply the selection. Tables are paged; the complete analysis and matrices remain downloadable.

**Inspect all candidate records** opens every member through pages, preserving original source ID, source position, feature SHA, object ID and raw mapped values. The short sample in the candidate table is explicitly labeled and is not the complete group.

Available rules:

- **Address signature:** repeated complete normalized address signatures.
- **Exact point:** matching original finite coordinates in the same declared CRS, without distance tolerance.
- **Repeated identity:** repeated selected business identity after the displayed normalization.
- **Missing required:** blank or null values in analyst-selected required fields.
- **Point geometry:** missing, unsupported or nonfinite point geometry.

No rule compares municipality with postal city as an error. No rule treats the source edit string as a date or turns ZIP+4 placeholders into a deliverability verdict.

## Record a named decision

Use **Prepare named finding** for a candidate. This opens the existing Findings editor with a complete reference to the saved candidate and original feature sources. Its initial status is an open professional question. Enter the actual reviewer, review time, applicability, assumptions, next action and responsible role.

Inspect the whole candidate before recording an interpretation. If source-owner correspondence resolves it, retain that original source and use the existing answer or successor-finding workflow. A local candidate status is not a substitute for a named finding.

Repeatedly opening the same candidate reopens its saved draft. Existing drafts remain reachable through **Recovery → Every saved draft**. After a finding is accepted, use the saved finding's normal editor for later corrections and record the correction reason.

## Later source and policy editions

An analysis on an existing case creates a new case edition and new derived source editions. Earlier files, findings and reports remain unchanged. The original source-review logic marks findings that require review after the case/source basis advances.

Do not call a later analysis a correction of an earlier report. Freeze a new report after the actual named decisions have been recorded. The old report retains its exact source selection, findings and files.

## Complete outputs

The accepted case references all original source files and all three derived files:

- analysis.json — complete policy, coverage observations, original source descriptors, every retained row identity and every candidate;
- records.csv — complete record matrix with source positions, mapped raw values and candidate IDs;
- candidates.csv — complete candidate membership and interpretation.

CSV cells that could execute as spreadsheet formulas are prefixed with an apostrophe. The complete JSON and original files retain their exact values. This is a presentation safeguard, not a source correction.

Use **Reports** to freeze the case report, source archive and review matrices. Use the original complete project export to carry the editable workspace, all source/history/operation data and maintained application files. Receive that project through the original project receiver, preserving its workspace identity. A browser recovery file contains browser drafts and pending identities; it does not replace the complete project archive.

## Source selection for commissioning

Supply an explicit original-source manifest for the cohort being commissioned. It records each file's SHA-256, byte count, source definition and role in the opening/closing inventory. The original source page selection and any expected candidate membership belong to that specific private handover, not to the reusable application.

The maintained ASDI profile is sourced from the official layer metadata:
https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Location/FeatureServer/14?f=pjson

## Original operating course

Run the supplied foreground source course with the complete maintained application and the exact source manifest. Prefer the immutable private application tree selected by the existing foreground/bootstrap controller. Keep that selected source tree unchanged for every continuation; a live checkout is not a substitute for the accepted source generation:

    python3 address-review-receiving.py \
      --application /absolute/path/to/qgis \
      --inputs /absolute/path/to/source/address-review-inputs.json \
      --directory /private/original-address-course \
      --reviewer "Actual reviewing analyst"

The course retains its original operation, input/source/controller identities and complete request bodies before mutations. It imports every selected original file, records the analysis, adds the named open question, freezes a report, creates a later same-source analysis edition, checks that the earlier finding requires review, receives the original request result again, and cold-opens a consistent SQLite backup with all evidence files. It never changes the source records or invents an agency answer.

With the full application source closure installed, add --complete-export to produce the original complete editable project package. Select that option at the first invocation; it belongs to the original course identity.

A completed domain course does not claim browser or native-map inspection. The result explicitly records NOT_RUN for browser status and REQUIRED_BEFORE_DELIVERY for literal inspection.

## Rendered receiving and all attachments

Before calling a delivery ready, actually open and use the final desktop view and 390px phone view. Exercise Sources, Address QA, candidate-member paging, Findings, Recovery, Reports, every download and the received editable project. Check text contrast, focus visibility, overflow and each form's retained state after a reload.

Follow the owner's full attachment rule: **view, play or use every final HTML, PDF, report, map, archive and extracted project as applicable. A screenshot or successful capture alone is insufficient.** Extract the final archive, open the report and matrices, reopen the actual project, and verify that each required original file is present. Record any remaining unperformed inspection accurately.

## Integration contract

The additive command is evidence.command with action address.analyze. It uses the existing original AnalystJournal and QgisWorkspace revision/replay boundary. No additional database, account, permission model or hosted service is introduced.

Read routes under /api/evidence/address are catalog, summary, rows, candidates and members. All row/member reads use offset/limit with a maximum page of 100. The complete analysis remains an ordinary retained source download.

The maintained analyst source inventory must include starforge_stac/address_review.py, this guide, the source course and the original manifest supplied with the selected handover. The complete evidence.js and parcel_evidence_operator.py postimages replace their reviewed originals; evidence-store.js is unchanged.
