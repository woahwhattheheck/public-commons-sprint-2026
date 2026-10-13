# GWMA study data: source mapping and scientific decisions

Operation: `GWMA-STUDY-DATA-OPERATOR-103D-20261013`  
Source review: 13 October 2026  
Companion: `model/gwma_source_contracts.json` (`commons.gwma-study-source-contract/v1`)

## Purpose and delivery

This package supplies the published source contracts for the existing Eco study-data and workplan operator. It gives the implementation a field-by-field map, the exact origin of important interpretation rules, and the decisions that a study team must retain when moving from laboratory observations into an analytical model. The source contract adds no parser or alternative observation database. The application continues to use the maintained Workspace, source collections, observation intake, task queue, download tickets and complete receiving flow.

The first GWMA notice to proceed covers the Health Risk Assessment Work Plan, Risk Management Work Plan and associated technical participation. Implementation follows the issued review and approval process. The product therefore supports a usable data inventory, sample design, original-data review, named model interfaces, scenario register and workplan chapter immediately. Later measured data can enter the same saved project and source lineage.

The $9,600/120-hour/20-business-day technical workshare belongs to C8FF's internal commissioning proposal. It is separate from the issuer's overall programme, scientific monitoring durations and prime-contract payment provisions. Keep that distinction in scheduling and commercial displays.

## 1. The issuer's geographic and scientific contract

The revised RFQ and Addendum No.1 are the controlling source:

https://gatewaywater.org/wp-content/uploads/2026/10/RFQ-Tech-Services-for-Regional-Pathogen-Study-Addendum-No.-1_QA_Final.pdf

The retained original is 26,654,777 bytes with SHA256 `98bcfe2e020c0eaab81351ff31adc41cecbea315ac7cf8b6bb0de798aea5efe6`. The full separated text and original PDF are already in the original opportunity source inventory.

Q&A21 distinguishes geographic capability from demonstration scope: the tool serves all nine participating Watershed Areas, while one area's use can supply the documented demonstration. The current programme page supplies their names; the official framework appendix supplies the abbreviations:

| Code | Watershed Area |
| --- | --- |
| CSMB | Central Santa Monica Bay |
| LLAR | Lower Los Angeles River |
| LSGR | Lower San Gabriel River |
| NSMB | North Santa Monica Bay |
| RH | Rio Hondo |
| SCR | Santa Clara River |
| SSMB | South Santa Monica Bay |
| ULAR | Upper Los Angeles River |
| USGR | Upper San Gabriel River |

Sources: https://safecleanwaterla.org/la-county-watersheds/ and the Watershed Area Characteristics Summary, printed p4, in https://safecleanwaterla.org/content/uploads/2024/11/Deliverable-3.2.4-FINAL-Framework-Appendices.pdf.

Use these as stable programme choices. A site may carry its original waterbody, agency station code, local catchment and source geometry as well. The Safe-to-Swim `RegionNumber` identifies another geography; it does not assign one of these nine areas. A spatial assignment records the selected boundary edition, coordinate datum, calculation and any boundary ambiguity.

The RFQ Part2 and AttachmentC require attention to beaches and inland waterbodies, wet and dry conditions, bacterial indicators, viruses and human-source markers. AttachmentC anticipates at least two years of current-condition monitoring and at least one year each for source-strength and control-effectiveness work. Its final methods, constituents and site programme are developed through the study workplan. These are programme requirements, not evidence that a particular monitoring campaign has already occurred.

## 2. Three explicit intake profiles

### Current CEDEN2.0 Chemistry/Microbiology

The official chemistry transition went live on 17 August 2026. Current public resources are:

- Submission page: https://ceden.waterboards.ca.gov/submit-data-ceden-2.0.html
- Chemistry template: https://ceden.waterboards.ca.gov/docs/templates/chemistry-template.xlsx
- Project/agency/station activation template: https://ceden.waterboards.ca.gov/docs/templates/project-activation-template.xlsx
- Field and quality-control contract: https://ceden.waterboards.ca.gov/docs/templates/chemistry-guidance.pdf, July2026, version1.1.

The guide's chemistry table describes39 fields. The installed profile declares collection_formats=[\"%m/%d/%Y %H:%M\"] so the original local representation is recognized while the untouched cell is retained. A value ending00:00 remains explicitly ambiguous because the guide permits that value for an unknown collection time. The companion JSON records their types, lengths, required/conditional roles and proposed operator targets. The three workbook tabs have different jobs: `Chemistry_Results` reports observations, while `Constituent_Index` and `Advanced_Vocabulary_Request` support vocabulary requests. Vocabulary must already exist before an observation EDD uses it. The operator retains lookup provenance and unresolved codes; it does not imply that saving a local mapping submits or approves a vocabulary request.

Exact received template bytes and headers should remain in the source collection beside the guide. The public sample acquisition is being completed by ECO-CLOUD-7C92 in the existing opportunity thread. That receiving step adds the original workbook hashes and a small actual California example without changing this contract's interpretation rules.

### Safe-to-Swim public81-column export

The current resource is:

https://publish.data.ca.gov/dataset/surface-water-fecal-indicator-bacteria-results/resource/15a63495-8d9f-4a49-b43a-3092ef3106b9

It aggregates cleaned and standardized CEDEN, BeachWatch and Lower American River data. Its current public schema has81 columns. It remains a legacy-style public export even though current laboratory submission uses CEDEN2.0. The companion JSON includes every header, including columns without a selected analytical meaning.

Keep the original `Result`, `ResultQualCode`, `MDL`, `RL`, method, units, comments and QA fields together. The separately published `ResultSub`, `ResultSubComments`, rolling geomeans, counts and cutoff dates remain publisher-derived fields. They do not silently replace an original concentration or become the study's censoring policy.

The API's data types cannot reconstruct original lexical precision that the publisher already converted to numeric. Preserve the exact received JSON/CSV bytes and label the result as the public export's representation. A laboratory EDD preserves its own text representation separately.

The resource's count and update time are acquisition metadata. The October12 page showed650,086 rows, but a later dataset refresh may differ. A small demonstration cohort records its exact station/time filter, query, opening/closing result count, pages/offsets, all returned rows and source SHA. A complete small cohort is preferable to an arbitrary first page presented as a study population.

### Existing WQP63-column activity/result source

The maintained Eco application already carries real WQP source from the South Carolina utility study. One complete original file has142 results and63 columns:

`opportunities/upstate_forever_2026/source/ecoli_utility_context/20261013/raw/arjws-results-2021-2025-original.csv`

Git blob `a9fa2235acd598560805100067204dfe4dc3d3d4`; 68,038 bytes; SHA256 `5be1db109931d9e1ee8781b3beaab8db8ddbfc801a433d076de6de4eaa7372ef`.

This is a useful actual receiving fixture and an existing operator source family. Its South Carolina geography remains explicit. The complete maintained family has730 observations,36 stations and22 source members; it retains the original sampling geography and source comments. Its current metadata marks72 records with original information-only comments without altering their original numerical or detection status.

The retained file uses the legacy WQX profile. Current WQX3 profiles are separate, and the WQP warns that the legacy interface omits newer USGS data after its transition date. Preserve the selected profile and provider rather than treating similarly named exports as interchangeable.

Primary format and source-use references: https://www.waterqualitydata.us/portal_userguide/ and https://www.waterqualitydata.us/webservices_documentation/.

## 3. Preserve measurements and qualify interpretations

The intake saves the original file, its full hash and byte count, sheet/resource, physical row number, all original column names and values, and the selected mapping edition. No row is discarded because the selected analytical profile has no use for it. Review can classify rows and create a selected input set while keeping the complete observation inventory.

A source-row identity always exists. Cross-file sample identity is a separate decision. Preserve agency/project/station/sample/activity IDs, collection time, matrix, sample type and replicate identifiers. Result identity additionally considers analyte, method/context, fraction, result/test type, laboratory batch and result replicate. Repeated analytes, repeated laboratory tests and field duplicates must not collapse solely because they share a station/date.

| Situation | Saved interpretation |
| --- | --- |
| CEDEN2 non-detect | Preserve empty Result, `DetectedAboveMDL=N`, original MDL/MRL and QA fields. |
| CEDEN2 estimated value | Preserve the reported numeric text, `Y`, and `DNQ` among QA codes when the guide's between-limits condition applies. |
| Bacterial MDL `-88` | Retain a documented not-determinable sentinel, separate from a concentration or numerical censoring bound. |
| Legacy qualifier | Retain its original code and the selected source vocabulary; do not manufacture a CEDEN2 detection flag. |
| Blank versus zero | Keep them distinct in source, review, export and calculations. |
| MPN, CFU, molecular copies | Keep method and quantity distinct; a compatible unit scaling is an explicit transformation with approval and provenance. |
| Original time `00:00` | Preserve it and its unknown-time meaning when applicable; do not fabricate a timezone or precise sampling instant. |
| Wet/dry condition | Bind a named definition, rainfall/source inputs and temporal window. |
| Information-only comment | Retain the original observation and separately record how the selected analysis treats it. |
| Publisher geomean/substitution | Keep as a distinct derived result with its publisher cohort and assumptions. |

The CEDEN guide's pp3–8 establish field meanings; p23 specifies non-detect, estimated-result and final-test reporting. Its documentation sometimes describes a field as required while allowing a blank when no condition applies, notably QACode. The UI should display the actual conditional rule and source rather than turn every printed “Yes” into a universal nonempty-field rejection.

## 4. Culture, molecular methods and quality control

Culture-based fecal-indicator laboratory duplicates have a specific CEDEN sample type, `LabDuplicate_Micro`. Guidance pp18–19 distinguishes method families:

- Multiple-tube fermentation and tray/enzyme-substrate methods evaluate the duplicate against the parent's95%confidence interval.
- Plate-based methods use the documented Rlog procedure and method criterion.
- Culture laboratory duplicate precision does not use the generic laboratory relative-percent-difference field.

The guide's parent interval examples and censored limits are reporting syntax, not a new statistical method to implement from an incomplete table. Retain the laboratory's reported interval, result, QA code and method reference. A named laboratory reviewer determines how the approved study uses the result.

Field duplicate/triplicate samples are separate collections with their own RPD/RSD contract in pp20–22. Their collection identities remain linked to the parent through the specified source fields. Laboratory duplicates and matrix spikes must not be assigned a field-QC parent merely to make a join succeed.

For PCR, pp24–25 define reportable method blanks, PCR blanks, positive controls and matrix spikes/duplicates, including the PCR-specific matrix. The guide also identifies internal PCR QC that is not part of CEDEN's verification vocabulary. The study may need those additional laboratory records. Retain them as original companion source and technical decisions rather than discard them because the public EDD lacks a matching column.

Named reviewers can complete these decisions while intake, mapping, source inventory and workplan preparation continue. Only the affected analytical selection depends on its applicable unresolved interpretation.

## 5. Decision and model contracts

Each review decision identifies the affected original source rows, issue, selected action, reason, reviewer name and technical role, review time, and the exact method-contract ID/version. A later correction retains the previous decision body and its predecessor relation. A changed input, mapping or scientific contract creates a new selected edition; the earlier export remains reopenable.

The operator may offer retain-as-reported, exclude-from-this-analysis, assign-mapping, apply-approved-transform and request-technical-review dispositions. Exclusion changes the selected cohort, not the preserved original inventory. Show the resulting included/excluded/unresolved counts and reasons with every model input.

A scientific model contract records:

- Named technical owner and reviewer, approval date and cited method.
- Model name/version, exact runnable source or external output identity, and applicability.
- Input/output schemas, units, parameter definitions and source-bound transformations.
- Censoring, replicate, QC and missing-data policies.
- Exposure assumptions, population/receptor definitions, uncertainty and sensitivity methods.
- Selected observation/source IDs, output identity and validation basis.

FIB concentration, pathogen concentration, exposure dose and illness risk are different quantities. The programme explicitly seeks to connect indicators, source markers, pathogens and risk; a simple conversion among them is not supplied by the procurement. The software can retain those relationships and run an agreed implementation when its actual contract is supplied.

For risk-management scenarios, retain the named control, source-strength assumptions, model version, cost year/currency, capital and operating costs, lifetime/discount choices, and output quantities. Per-volume, per-length, per-area and per-risk-unit costs require their own denominators and compatible comparisons.

## 6. Workplan and receiving

The editable workplan export should carry the original source inventory, selected monitoring design, site/event/sample/result contract, method/QA decisions, model interfaces, dependencies, scenario register and open technical decisions. Name both Work Plans and retain the issuer's sponsor review and later implementation dependencies. Do not translate the internal20-business-day engineering workshare into a promise to complete the multi-year scientific study.

The maintained application already provides the receiving structure. Use application-owned `upstate.operator-extension/v1` manifests and the original task queue. Source and observation data stay in the original Workspace. Additional saved records have a receiving verifier; task downloads use the existing verified ticket mechanism. The full recursive application/workspace archive then carries the new source and retained records through save, transfer and cold reopen.

For this source-contract addition, verify a small complete receiving example through the actual existing operator:

1. Retain original California source and all columns; save its selected profile.
2. Review actual ambiguous/detection/QA fields without modifying source bytes.
3. Save a named scientific decision and a distinct selected analytical input.
4. Export the workplan, original data, mappings and complete decision history.
5. Reopen the same saved project and confirm original row/source identities and prior editions remain.
6. Reintake the same exact source using its original identity and preserve the saved work.

These are complete product steps, not a new parallel repository test suite.

## 7. Public access, attribution and source custody

Safe-to-Swim's dataset metadata states no restriction on public use, while the resource's generic license field says no license was supplied. Retain both observed statements. Its source programmes and collection methods remain attributed; public access does not establish suitability for every scientific analysis.

CEDEN publishes its templates and guidance openly. An authenticated, authorized CEDEN2 account is needed for actual vocabulary/project/submission operations. Downloading templates and using them as an intake contract does not require enrolling the study, uploading data or obtaining private laboratory credentials.

CEDEN recommends citing the database with the access date: https://ceden.waterboards.ca.gov/citation-format.html. WQP provides a dataset citation with the actual query, access date and DOI https://doi.org/10.5066/P9QRKUVJ. Preserve the original contributing agency/provider and result status. A public database can revise prior observations; each received source edition remains pinned locally.

Future partner EDDs may contain restricted project information. Their source record should state the actual authorized custody and distribution scope before inclusion in an external package. The current primary examples are public agency material, and the internal GWMA engineering programme remains in its existing opportunity lane.

## Source status and next receiving join

The full issuer/Q&A, current CEDEN guidance,81-column California export schema and142-row original WQP example are retained. ECO-CLOUD-7C92 owns the accepted acquisition of the current template bytes and coherent actual California cohort in the original thread:
https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791876728024339?thread_ts=1791724121.853269

The actual three-file public download is assigned to Muse's existing local reader because the accepting7C92 runtime reported a DNS failure. The source-contract's California example record will be completed with that original receipt, filenames, raw hashes, selected query and count. Root103D retains the full operator and Actions103D its interface; C8FF retains qualification and prospective-prime/outreach ownership.
