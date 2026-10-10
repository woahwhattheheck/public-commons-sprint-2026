# ChipTrace real-source case: Supp Fig. S2b TEER

A descriptive source-cell case for ChipTrace built entirely from the published,
CC BY 4.0 supplementary workbook of Izadifar Z, et al., *Nature Communications*
(2024), doi:10.1038/s41467-024-48910-0. The driver runs the unmodified ChipTrace
core on the frozen normalized CSV and records per-cell provenance, core-configured
eligibility counts, two same-group software replays, and three tagged synthetic
fault controls. It assigns no biological-quality label: source series identity is
`SOURCE_IDENTITY_UNVERIFIED` and biological quality is `INSUFFICIENT_EVIDENCE`.

## Contents

- `s2b_source_case.py` — case driver (stdlib only; Python 3).
- `test_s2b_source_case.py` — focused unit checks for the driver.
- `DATASET_CARD.md` — source, sheet/cell mapping, license, and limitations.
- `data/cervix_chip_teer_supp_s2b.csv` — frozen normalized CSV, 72 measured
  values (SHA-256 `70732bd81fbf613179e43f998ab64953fe7d213f02576ebb443bc5d3285fd8f5`).
- `data/adapter_metadata.json` — public adapter metadata (source cells, time
  origin, per-series observation counts, source/workbook/CSV hashes).
- `examples/s2b_case/` — generated case record (`case.json`, `case.html`) plus
  the embedded core reports and byte-exact per-group CSV subsets it references.

## Reproduce

From the repository root:

```bash
python competitions/pazhou_ai4s_chiptrace_2026/real_source_case/s2b_source_case.py \
  --csv competitions/pazhou_ai4s_chiptrace_2026/real_source_case/data/cervix_chip_teer_supp_s2b.csv \
  --metadata competitions/pazhou_ai4s_chiptrace_2026/real_source_case/data/adapter_metadata.json \
  --core competitions/pazhou_ai4s_chiptrace_2026/chiptrace.py \
  --out-dir /tmp/chiptrace-s2b-case
```

Expected stdout includes
`"case_receipt_sha256": "35021bce46e1b86826c73789624944e6d406659ef622f9c83d335507eb60a3ae"`.
The driver rejects the run if the CSV bytes, the metadata's frozen fields, or the
core git blob (`4cdd8beaa7009e05fb93913f13b02ec42edfe6ba`) differ.

## License and attribution

- Source data: Izadifar Z, et al. (2024), licensed CC BY 4.0; attribution
  required. See `DATASET_CARD.md` for the exact workbook hash and cell mapping.
- Code: Apache License 2.0, following the enclosing ChipTrace subtree.
