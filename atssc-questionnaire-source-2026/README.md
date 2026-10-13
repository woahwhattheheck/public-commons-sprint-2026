# ATSSC questionnaire source collection

Complete original government questionnaire sources for solicitation **2026-ATSSC-RFI-008**, captured on 12 October 2026. The current RFI closes on **30 October 2026 at 14:00 Eastern Time**. The Annex C example workbooks retain their original NQ-2023-001 Wind Towers edition and historical questionnaire dates.

## Open the complete source

Download `originals/ATSSC_Original_Annexes_and_Workbook_Catalogue.zip`. Its exact size is **2,691,467 bytes** and SHA-256 is `f31ec3fef4ee808ada65afb66cfbf67114c7be8016ca6307bf664c56bffcab8e`.

The archive contains the actual notice HTML, complete English Annex A, all five original Annex C workbooks, the full workbook catalogue, original response metadata and the source reader. The catalogue is at `ATSSC_Original_Annexes/derived/ATSSC_Original_Workbook_Collection.json`. The original workbooks are under `ATSSC_Original_Annexes/originals/`.

The complete `SOURCE_MANIFEST.json` lists all nine original issuer document URLs, including both RFI languages and both Annex A languages. The original bilingual RFI and French Annex A can be read directly from those issuer links.

## What the original workbooks contain

| Attachment | Role | Worksheets | Formula cells |
| --- | --- | ---: | ---: |
| C1 | Foreign Producer | 12 | 803 |
| C2 | Importer/Purchaser | 36 | 3,158 |
| C3 | Producer | 15 | 2,033 |
| C4 | Union | 9 | 602 |
| C5 | Certification | 7 | 1,065 |
| Total | | 79 | 7,661 |

The complete catalogue retains all 71,717 defined cells, including 50,125 styled blanks, 21 hidden sheets, original formula text and attributes, raw cached values, validations, named ranges, cell and sheet protection, comments, column/row metadata, styles and OOXML relationships.

There are 1,568 shared-formula cells, 40 array-formula cells and 127 defined names. The original files also contain 934 formula expressions with `#REF!` and 1,108 stored error cells. These categories overlap. Preserve the original formula and cached value when classifying an inherited template condition or a calculation-engine difference.

Formula-cell counts describe the source structure. They do not count unique questions or distinct business rules. Source dates and text inside hidden sheets may belong to older templates; explicit mapping should determine their current use.

## Build the implementation tables

The reader and table analyzer use Python's standard library. To project the complete retained archive:

```bash
python3 analyze_atssc_source.py originals/ATSSC_Original_Annexes_and_Workbook_Catalogue.zip --output implementation-tables
```

This verifies the archive and each original workbook before writing the complete worksheet, formula, defined-name, stored-error and function tables. It also preserves original Annex A question labels with page and line identities. The source has two entries printed as 5.22, and a label printed as `4.5 16`; preserve their page and subject when preparing a response.

To read additional original OOXML workbooks into a complete structural catalogue:

```bash
python3 atssc_workbook_structure.py --output catalogue.json original-workbook.xlsx
```

The catalogue and CSV files support the maintained questionnaire implementation's own calculation and revision model. The readers preserve original expressions and stored values without changing the workbooks.

## Original issuer sources

[CanadaBuys notice](https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/cb-220-95575871)

[Original English RFI](https://canadabuys.canada.ca/sites/default/files/webform/tender_notice/108603/request-for-information-%28rfi---citt-online-questionnaire-management-platform.pdf)

[Original English Annex A](https://canadabuys.canada.ca/sites/default/files/webform/tender_notice/108603/annex-a---questions-to-industry---citt-online-questionnaire-management-platform.pdf)

All source document URLs and exact acquired archive identities are recorded in `SOURCE_MANIFEST.json`.

## Expand original shared formulas and map dependencies

Run the complete read-only formula projection with Python and `openpyxl` available:

```bash
python3 classify_atssc_formulas.py originals/ATSSC_Original_Annexes_and_Workbook_Catalogue.zip --output formula-dependencies
```

The programme verifies the exact source archive and every original workbook. It expands each shared-formula follower from its original master and retains both the original expression and effective cell expression. Structural grouping preserves absolute and relative reference axes, worksheet identity, functions, literals and expression tokens. Each member remains joined by the original workbook SHA, worksheet and cell address.

For each of the five questionnaire families, the output includes:

- Every original formula occurrence, shared-formula origin, effective expression and original cached value.
- Complete structural-group membership, with the contributing worksheets and functions.
- All reference tokens and direct formula dependencies, including ranges, full rows/columns, worksheet spans and resolvable defined names.
- Original reference errors, qualified broken references, unresolved or cyclic names, external references and other source conditions.
- Worksheet visibility and the complete static dependency closure of visible formulas.
- Original questionnaire text and cached error cells.
- For C1, the requested configuration-derived prompts, each original production/confidential/public-summary rule-group representative, and the complete hidden-formula closure.

`ATSSC_Formula_Dependency_Inventory.json` records the parser version, source identities, all family totals and the exact hash/size of every output file. The programme requires all 7,661 original formula occurrences to be retained. The completed collection expands 1,345 shared followers from 223 masters and contains 1,302 workbook-specific structural groups representing 904 structural expression shapes.

The C1 visible questionnaire contains 343 formula occurrences and reaches three formula cells in Variables. Its 337 inherited Prod FY, Fin FY and DataTab formulas remain outside that visible-formula dependency closure. Preserve the complete 12-sheet original and the entire Variables configuration, including literal settings. Review the inherited sheets' intended report and template uses when recording their disposition.

Structural groups are candidates for migration mapping. They do not establish that distinct questions have equivalent business meaning. Static reachability also does not establish that an inherited branch executes for every answer, or that a hidden sheet can be removed. The output preserves those distinctions so the application can join the original calculation, revision and reporting implementation.

The programme projects references and stored source values. Calculation of a respondent's answers stays with the selected application's workbook engine.

## Use the completed original projection

The complete revision 2 output is available as [ATSSC_Original_Formula_Groups_and_Dependencies.zip](https://chatgpt.com/api/library/files/libfile_24e125f7933481919868085ff377214b/download), the retained 2,350,227-byte version 1 artifact. `DERIVED_ASSETS.json` records its exact saved identity and the complete member-manifest identities. Its 39 members include all five families' full formula records, structural groups, source issues, reference tokens, dependency edges, worksheet dependencies and original questionnaire text. C1 also includes the complete prompt and representative-rule boundary. The exact original classifier and source manifest travel with the output.

The adjacent `ATSSC_Formula_Dependency_Inventory.json` and `ATSSC_Formula_Source_Manifest.json` preserve all member byte lengths and SHA-256 values. The completed native projection used openpyxl 3.1.5, retained all 7,661 formulas, expanded all 1,345 shared followers, and produced 2,269 direct dependency edges and 11,050 reference-token rows. Their source keys are the original workbook SHA, worksheet and exact cell.

Use `formula_records.json` for effective shared expressions and retained cached values; `structural_groups.json` for complete group membership; `formula_references.csv` for each original reference token and its classification; and `formula_dependency_edges.csv` for joins between original formula cells. Keep source issues with their affected cells when applying the selected calculation engine. The full C1 boundary provides the seven requested cached prompts, representative production and allocation rules, and the activity-only public-summary expressions.

The corrected projection classifies worksheet-qualified broken references as original reference errors. C1 has no visible-formula dependency on its inherited broken-reference branch. The original Producer family has two visible formula cells with original reference-error dependencies; their exact cell keys and expressions remain in that family's output for its migration disposition.
