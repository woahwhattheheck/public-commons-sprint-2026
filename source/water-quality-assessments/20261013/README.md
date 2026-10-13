# Complete original published water-quality assessment editions

This directory makes the original ES-9960 source bank directly importable by the maintained Water-quality context operator. It retains the complete statewide published 2024 impairment edition and the July 28, 2026 TMDL attainment edition. The selected station inventory remains at `source/station-assessment-context/`; its 192 records and 159 station identities keep their original selection.

## Import into an existing Workspace

From `opportunities/upstate_forever_2026`:

```sh
python -B -m model.cli --workspace /path/to/existing-workspace source-import source/water-quality-assessments/20261013/sources.json
```

The unchanged original manifest imports two table entries with role `WATER_QUALITY_ASSESSMENTS` and `format: normalized`. The 2024 entry retains its publisher table-text representation as a companion. Select these two normalized editions in Water-quality context with the existing retained 217-HUC domain and original SCHydroClass source. The existing model and source-import routes perform the native analysis.

| Original source | Complete records | Retained representation |
| --- | ---: | --- |
| Published 2024 impairment listing | 1,516 cause records from 1,258 assessment rows | Normalized JSON plus original PDF table-text JSON, with publisher page/line/cause-cell references |
| July 28, 2026 TMDL attainment | 813 records | Complete accepted native normalized JSON, retaining original source PDF hash, publisher pages, support labels and report references |

Both normalized bodies declare `upstate.water-quality-assessments/v1`, `complete: true` and zero unmatched rows. The source manifest and all three declared input bodies are unchanged bytes from the retained source bank [F0C8KECMA4V](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8KECMA4V).

The 2024 original publisher document is [303dList2024.pdf](https://www.des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/303dList2024.pdf). The July 2026 original document is [TMDLAttainmentStatus.pdf](https://des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/TMDLAttainmentStatus.pdf). Each normalized record preserves its original source identity.

## The selected domain and station cohort answer different questions

The original 217-HUC assessment-publisher selection contains 192 records at 159 station IDs: 108 records from 2024 and 84 from July 2026. Matching those same 159 exact station IDs against both complete statewide editions finds 193 records.

The additional original record is **SV-192**, July 2026, E. coli, recreation use, not supported, TMDL report `026-05†`, original page 38. Its assessment-publisher HUC12 is `030601030613`, outside the selected 217-HUC domain. The same station's native publisher HUC and its selected 2024 turbidity record use `030601030513`.

These two original assignments are retained separately. The published 192-record report keeps its assessment-domain denominator. A station-based review can follow the additional July 2026 record using the complete original source. Point/polygon membership continues to come from the native Station geography analysis.

`source-selection-boundary.json` includes the exact additional original record, its retained station identity, all selected domain IDs, all 159 station IDs, and both source-bound record inventories. It binds the normalized inputs and the original station/assessment CSVs by byte count and SHA-256. `inputs/domain-huc12s.json` is the original 3,257-byte domain identifier file from the same source bank.

## Original byte identities

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| inputs/303d-2024-publisher-pdf-table-text.json | 688155 | 9be7679b79ca2a8a4d4d21227ad57371b88fd6082e8b29c7efc6d9a18ab0edce |
| inputs/303d-2024-pdf-table-normalized.json | 2674649 | 69e6894001fdcfa0130d8be532a31655eda22486a4044079665e8ee614eb5b0c |
| inputs/tmdl-attainment-native-20260728.json | 1260570 | cceaf00eb0fc4cc85eabb67fbd2a9b5d843bb0cc0c7ab8da54d2108f025c2522 |
| inputs/domain-huc12s.json | 3257 | a8e83c835b97440f21077fd09d41dcd48d3b07711f371bb839f9c483ecca314f |
| sources.json | 2155 | 353b4fac9e1f2cecd694aef14a0e41ab468c75bbe6cd13fb7b7d2ed4ef0dc60f |

The original manifest imports the complete assessment editions. The domain file and source-selection companion document how the existing selected report relates to those complete editions.
