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
