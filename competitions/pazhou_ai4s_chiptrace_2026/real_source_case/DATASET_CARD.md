# Dataset card: cervix epithelium TEER, Supplementary Fig. S2b

## Source

- Article: Izadifar Z, et al. Nature Communications (2024). doi:10.1038/s41467-024-48910-0, https://www.nature.com/articles/s41467-024-48910-0
- Source data workbook: https://media.springernature.com/original/springer-static/esm/art%3A10.1038%2Fs41467-024-48910-0/MediaObjects/41467_2024_48910_MOESM4_ESM.xlsx
- Workbook bytes / SHA-256: 60701 / `0667dee0329276f70c50e65aaac0efa44518fffd447aef9fcc21ff706ad4ed1e`
- License: CC BY 4.0, as stated on the article rights page. Reuse requires attribution to the authors and article above.
- The workbook is not modified and is not read by the case driver.

## Measured content used

- Sheet `Supp Fig. S2b`. Unit cell A1: Ohm.cm2. Day cells A3:A11 hold source days -3 to 5.
- Cervix Chip: header B2, values B3:I11. 36 observed cells and 36 blank cells.
- Transwell: header J2, values J3:Q11. 36 observed cells and 36 blank cells.
- Blank cells are recorded as ABSENT. They are not zero-filled, interpolated, averaged or replaced.

## Normalized CSV (existing adapter output, consumed unchanged)

- `cervix_chip_teer_supp_s2b.csv`: 14801 bytes, SHA-256 `70732bd81fbf613179e43f998ab64953fe7d213f02576ebb443bc5d3285fd8f5`. It has 72 rows and CRLF line endings.
- Columns: `run_id,replicate_id,time_s,channel,value,unit,source,modality`.
- `time_s = (source_day + 3) * 86400`. Source day -3 maps to 0 s, and differentiation day 0 maps to 259200 s.
- `source` holds the article URL and the workbook cell, for example `Supp Fig. S2b, B5`.
- `replicate_id = unverified_source_series_<column>` identifies a workbook column only.

## What is not established

- The source does not establish that a column is one physical chip measured over time.
- The source does not establish that columns are independent biological replicates.
- The source contains no measurement-fault, bad-run or QC labels.
- Cervix Chip vs Transwell and differentiation day are experimental conditions, not QC labels.

## Excluded

- Fig. 3h is excluded because its unit and normalization are not stated. Its values are baseline-zeroed and predominantly negative, so they are not treated as absolute TEER.
- The workbook has no Fig. 3i sheet.

## Case outputs

- `case.json` (schema `chiptrace.real_source_case.v1`) contains:
  - per-group source-cell grids and per-series observations with cell coordinates;
  - core-configured eligibility counts;
  - same-group software replay records;
  - three tagged synthetic fault controls;
  - dispositions and a next measurement request.
- `case.html` is an accessible HTML/SVG view of the same record.
- `work/` holds the byte-exact per-group subsets of the parent CSV and the generated fault-control copies, each tagged `synthetic_fault_injection`.
- `core_reports/` holds the unmodified ChipTrace core reports.

## Run

```bash
python competitions/pazhou_ai4s_chiptrace_2026/real_source_case/s2b_source_case.py \
  --csv competitions/pazhou_ai4s_chiptrace_2026/real_source_case/data/cervix_chip_teer_supp_s2b.csv \
  --metadata competitions/pazhou_ai4s_chiptrace_2026/real_source_case/data/adapter_metadata.json \
  --out-dir /tmp/chiptrace-s2b-case

python -m unittest discover -s competitions/pazhou_ai4s_chiptrace_2026/real_source_case -p 'test_s2b_source_case.py' -v
```

The driver rejects the run if:

- the CSV bytes differ from the frozen SHA-256;
- the metadata hashes, sheet or time origin differ from the frozen values;
- the core git blob differs from `4cdd8beaa7009e05fb93913f13b02ec42edfe6ba` (unless `--allow-core-mismatch` is passed, in which case the mismatch is recorded).
