# River Spree: explicit original component analysis

This package retains a complete public IoTLab SensorThings source window and its source-linked component report. It accompanies the maintained SensorThings workspace, analyst view, original Helgoland deployment, publication and portable receiving programme.

## Actual received source

- Service: https://frost.iotlab.com/sensorthings/v1.1/
- Original MultiDatastream: 23, “Surface water conductivity in river Spree”.
- Original window: **2016-06-20 00:00:00 UTC inclusive through 2016-06-27 00:00:00 UTC exclusive**.
- Seven original observation pages retain **672 distinct observation IDs and 2,688 component positions**.
- The source is historical 2016 data. It is not a current telemetry feed.
- Complete original closure: **51 files / 1,914,433 bytes**, including both complete connector returns and failed-query receipts.
- Source manifest: `source-manifest.json`, **37,256 bytes**, SHA256 `5d5d7b25ba8ec913848ee0b49af58b4842013117a9934b5cb5ef6aff3dbabfba`.
- Exact 15-response native recording: `native-recording.json`, **1,946,549 bytes**, SHA256 `e1343f86d88e28648a3cd8648923b5471ae0fd31e3bbcb76a15a61916c2d0a04`.

The acquisition connector exposed complete file bytes and its own receipt metadata. It did not expose the original provider HTTP status, method or headers; those fields remain null. The source licence is not established. A licence on a related project document is not asserted as the data licence.

## Useful operational result

The report explicitly selects **position 1, temperature**, and **position 2, conductivity at 25°C**. Original units and declarations remain unchanged. The supplied component type strings are outside the OGC Table 12 observation-type vocabulary; the plan records a separate explicit numeric-JSON interpretation and acknowledgements.

| Selected original position | Original unit | Samples | Exact sum | Sample mean, half-even to 12 decimal places | Minimum | Maximum |
|---|---|---:|---:|---:|---:|---:|
| 1 · temperature | C | 672 | 15345.19 | 22.835104166667 | 20.452 | 25.346 |
| 2 · conductivity at 25°C | uS/cm | 672 | 552163.765 | 821.672269345238 | 774.641 | 848.606 |

These are arithmetic summaries of the retained eligible occurrences. They are not time-weighted means. The exact numerator/denominator, extrema citations and original values are in the complete JSON and CSV.

The 672 observation IDs occupy **644 distinct timestamps**. **28 timestamps have two different original IDs**, and there are **seven 75-minute separations** among distinct observed instants. Both source observations at each repeated timestamp remain present. The original elapsed-seconds component is retained without a timestamp repair. Counts of 96 rows per day do not establish 96 different quarter-hour timestamps or complete interval coverage.

The separate position 3 has conflicting property name/definition versus description. It remains in the complete originals and source findings; it is not silently relabeled or selected for this numeric report. Missing quality and null result-time fields remain explicit.

## Files to open

- [Complete source-bound report](report/component-report.html)
- [Complete calculated report JSON](report/component-report.json)
- [All 1,344 selected occurrences and original result vectors](report/selected-components.csv)
- [Daily sample summaries](report/daily-sample-summary.csv)
- [All repeated instants and original citations](report/duplicate-instants.csv)
- [Every adjacent observed gap](report/observed-gaps.csv)
- [Temperature points](report/component-1.svg)
- [Conductivity points](report/component-2.svg)
- [Explicit component analysis plan](component-analysis-plan.json)
- [Actual calculation receipt](execution/source-report-execution.json)
- [Exact source modules used for that calculation](execution/source-map.json)
- [Recording assembly receipt](execution/recording-assembly.json)

The report was calculated from the original files in **Functions V8 at 2026-10-12T13:55:35.242Z**. The complete executed modules, environmental adapter and helper bytes are retained under `execution/`; the receipt binds every original input and output. It records no native workspace, edition, publication or browser run. The report output SHA256 is `e59bdd00af888c36f931856537f6d6c13dab20baa880a870716f64eb2199e048`.

## Continue through the same original product

Use the maintained `sensorthings-receive-multicomponent` command with this recording and an existing original workspace. Its stable operation continues through source catalogue, plan, exact original capture receipt, attributed source review, full components dataset, actual component selection, publication and project export. Review files must use the real returned edition/binding/project/version IDs.

The analyst interface now offers explicit original component positions, source declarations and attributed interpretation alongside the existing scalar and Python paths. The original Helgoland client receives derived component identities with the full original context in `analysis@component`. Publication produces complete cited tables and original vectors, and the existing portable receiver verifies the source bindings before adopting the project.

Full invocation, review-file shapes, normal installation and recovery steps are in [the component operating guide](../../sf30-seller-sdk/sensorthings/analysis/COMPONENTS.md). Receiving remains the existing owner’s actual workflow. This packet does not create another capture or claim that receiving has completed.
