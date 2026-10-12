# ClinicalTrials retained-cohort analysis

This module turns an already received ClinicalTrials edition into a useful descriptive cohort review. It uses the original research question, retained study metadata and source identities, and creates local filters, readable reports and complete exports.

The input is the existing `sf88-research-results-v1` envelope returned by the ClinicalTrials workspace. It never opens another registry capture, purchase or provider workspace.

## Use the maintained source receiver

Read the edition through `workspace.edition(operationId)` or `workspace.retainedEdition(dossierId, editionId)`. Those maintained methods verify the original edition bytes and source packet before returning them. Pass the returned `sha256` directly as `editionSha256`; do not hash a reserialized JSON object.

~~~js
import {
  analyzeClinicalTrialsCohort,
  filterClinicalTrialsCohort,
  clinicalTrialsAnalysisPage,
  renderClinicalTrialsCohortCsv,
  renderClinicalTrialsCohortJson,
  renderClinicalTrialsCohortReport
} from './clinical-trials-analysis.mjs';

const retained = await workspace.edition(operationId);
const complete = analyzeClinicalTrialsCohort(retained.value, {
  editionSha256: retained.sha256
});

const selected = filterClinicalTrialsCohort(complete, {
  statuses: ['COMPLETED'],
  resultsFlags: [true]
});

const page = clinicalTrialsAnalysisPage(selected, {offset: 0, limit: 50});
const csv = renderClinicalTrialsCohortCsv(selected);
const json = renderClinicalTrialsCohortJson(selected);
const html = renderClinicalTrialsCohortReport(selected);
const markdown = renderClinicalTrialsCohortReport(selected, {format: 'md'});
~~~

The complete view remains available while filters change. Apply each filter selection to that complete view. Use the page only for a paginated screen; exporters accept the full selected analysis. A page slice is rejected by both filters and exporters to prevent partial rows being mistaken for the complete cohort.

The existing `examples/clinical-trials-dossier.mjs` is the full receiving workflow: retained packet, research question, original evidence and finding, report, portable export, separate receiving workspace and reopened source. Analysis attaches to that same retained edition after receiving.

## API

| Export | Result |
| --- | --- |
| `analyzeClinicalTrialsCohort(edition, {editionSha256})` | Complete deterministic analysis of one validated retained edition |
| `filterClinicalTrialsCohort(analysis, criteria)` | Full selected rows, refreshed groups and observations, original capture identity |
| `clinicalTrialsAnalysisPage(analysis, {offset, limit})` | A screen page of rows, with whole-selection groups and counts |
| `renderClinicalTrialsCohortCsv(analysis)` | Complete 24-column original-record inventory using quoted CSV cells and CRLF |
| `renderClinicalTrialsCohortJson(analysis)` | Complete analysis, exact source references and structured study fields |
| `renderClinicalTrialsCohortReport(analysis, {format})` | Self-contained HTML by default, or Markdown with `format: 'md'` |

There are no module imports, runtime package dependencies, time-dependent calculations or remote requests. Identical retained input and filters produce identical analysis and export content.

## Returned shape

The top level contains `schema`, `question`, `label`, `source`, `filters`, `selectedStudies`, `selectedOccurrences`, `excludedStudies`, `excludedOccurrences`, `rows`, `repeatedStudies`, `groups`, `observations` and `methods`.

The source retains the actual edition SHA-256, original packet and manifest SHA-256, capture and source identities, coverage, completeness, provider total, distinct-study and occurrence populations, repeated-study variants, page references, source version, original query configuration and source timestamps. A local filter never changes `source.captureStudies`, source coverage or the original query configuration. `selectedStudies` is the distinct-NCT denominator used for the displayed groups; `selectedOccurrences` is the count of retained rows. The corresponding source totals are `captureStudies` and `captureOccurrences`.

Each original record row includes:

- Stable occurrence ID (capture/page/row), NCT ID, titles, public registry URL, original status and status verification date.
- Study type, original phase array and a deterministic phase combination.
- Exact condition labels, interventions, intervention types and lead sponsor.
- The distinct source values `hasResults: true`, `false` or `null`, plus retained result-section names.
- Enrollment as exact source text, its reported type and an explicit presence flag.
- Date structures with their original date and type, annotated with year, month, day or unrecognized precision.
- Registered primary outcome measures.
- Original capture ID, page index, study index within that page, page URL, page SHA-256, record SHA-256 and record byte count.

Rows sort by NCT ID, source page index and original position within that page. Group rows sort by count descending, then exact label and serialized key, so outputs remain stable when a reader opens them again.

## Counting rules

| Group | Counting rule |
| --- | --- |
| Status, study type, lead sponsor, enrollment type | Distinct NCT IDs within each exact label; missing values are shown explicitly |
| Phase combinations | Sorted sets of original phase labels; PHASE1 + PHASE2 is one combination; NCT IDs are distinct within each group |
| Conditions, intervention types, result sections | Overlapping memberships; each exact label is counted at most once per study |
| Results flags | True, false and missing remain three separate groups |
| Results coverage | Cross-tabulation of the source results flag and presence of retained result sections |

Every group entry has `key`, `value`, `label`, `count`, `occurrences`, `studyIds`, `denominator` and `percent`. The count and denominator are distinct study IDs; occurrences is the number of source records that supplied that membership. For example, a status group has value `"COMPLETED"`; a phase group has value `["PHASE1", "PHASE2"]`; a results group has value `true`. UI controls should retain these typed values rather than reconstructing them from display labels.

Additional summaries count distinct study IDs with reported enrollment, reported zero enrollment, absent enrollment, registered primary outcome measures and missing metadata. Conditions and sponsor names are not combined by synonym or corporate family. Percentage memberships can total more than 100% where a study belongs to multiple labels.

Enrollment values stay as text because the packet reader preserves source numeric precision. A value such as `"0"` is reported enrollment, not absence. No total of unique patients is calculated across studies. Registered protocol outcome measures and posted result sections remain separate.

## Repeated and changed source records

Every source occurrence is preserved, including byte-identical repeats of an NCT ID. `repeatedStudies` lists repeated IDs with occurrence counts, distinct record-version counts, a changed flag, original record hashes and the occurrence IDs for each version. The original full-capture inventory also stays in `source.repeatedStudies` when local filters select fewer records.

The module never chooses the first or last occurrence as a replacement for other versions. All selected original rows appear in the CSV, JSON and report. The report identifies the original page and row for each occurrence.

If two retained versions of one study have different statuses, both status memberships are visible and that NCT ID counts once in each group. Consequently, status, type, phase, results and missing-field groups can overlap when a source capture contains changed versions. Observations call out repeated and changed studies explicitly. Byte-identical repeats do not increase a group's distinct-study count.

Filters match complete individual records. A status from one version is never combined with a results flag from another version to manufacture a match. The selection then counts distinct NCT IDs and selected occurrences separately.

## Local filters

| Criterion | Values |
| --- | --- |
| `statuses` | Exact status strings, or `null` for an absent status |
| `studyTypes` | Exact study type strings, or `null` |
| `phaseKeys` | The group's serialized `key`, such as `'["PHASE1","PHASE2"]'`; `'[]'` selects no reported phases |
| `conditions` | Exact condition strings; `null` selects studies with no condition labels |
| `sponsors` | Exact lead sponsor names, or `null` |
| `resultsFlags` | Boolean `true`, boolean `false`, or `null` |
| `hasResultsSections` | Boolean for presence or absence of retained result sections; `null` removes this criterion |
| `query` | Case-insensitive substring over NCT ID, titles, sponsor and conditions |

Values within one category are OR alternatives. Different categories are combined with AND. Missing criteria and empty category arrays leave that category unrestricted. An empty selection is a normal analysis result with zero selected studies and zero-denominator groups.

The list filters accept at most 200 values per field; the results flag list contains at most three values. Query text accepts at most 2,000 characters. A page uses nonnegative integer offset and a limit between 1 and 200; its default size is 50. Its rows and `page.total` count source occurrences, while the groups continue to use distinct-study denominators.

## Reports and exports

HTML and Markdown reports contain observations calculated from the selected source, all ten grouped reviews, the full selected original-record inventory, methods and source/filter details. The HTML is a standalone, neutral industrial layout with accessible table headers, local CSS, horizontal table scrolling and print styles. It contains no script or external resource. Source text is escaped.

The CSV includes every selected original study occurrence and its stable occurrence ID, including exact enrollment and date structures in JSON cells. Array and nested fields are also JSON cells, so combinations and precision survive export. The three states of the results flag are `true`, `false` and an empty cell. Formula-like free text receives a leading apostrophe for spreadsheet display; the structured JSON and retained source remain the authoritative exact text.

The analysis omits the large embedded source ZIP and complete raw study bodies from ordinary screen responses. Every occurrence's record and page identities remain present, including repeated and changed versions. The original source download and whole-study reader still provide complete protocol and results content.

## Integration

The source-owned operation and retained-edition route families can read this module through the existing authenticated Research workspace. Return `clinicalTrialsAnalysisPage` for a screen and render an export from the full filtered analysis. Preserve the existing file-download writer and metadata projection for large receiving operations.

The `ResearchWorkspaceClient.clinicalTrials()` facade, CLI and original ClinicalTrials pane should use the same route family. Use `group.key` for phase controls, `group.value` for typed status/results controls, `selectedStudies` for the displayed denominator and `source.captureStudies` for the retained capture count. Downloads must keep the current local criteria, independently of screen pagination.

Descriptions and counts apply to the original selected capture. A complete capture means the original capture completed its configured pagination; it does not expand the source query to the whole registry. The module makes no clinical recommendation, patient eligibility decision or treatment-effect calculation.
