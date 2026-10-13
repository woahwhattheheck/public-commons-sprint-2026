# Retained 5156 native demonstration: scientific interpretation

## Finding and scope

Scientific interpretation — Needs expert review for use in a real planning decision.

The completed demonstration covers a simulated 1,296 ha headwaters square, represented by 120 × 120 cells at 30 m. Within that geography, both forest-restoration alternatives reduce modeled annual nitrogen, phosphorus and sediment export relative to the retained baseline. Riparian placement yields lower export than the matched-area off-riparian alternative for every metric in every tested profile. The size of the sediment advantage depends strongly on routing: the riparian/control reduction ratio is 1.123 under MFD and 1.974 under D8. Nutrient reduction ratios are more consistent, approximately 2.38–2.68.

These actual retained InVEST outputs demonstrate an editable native scenario/profile comparison with a controlled alternative location. Interpret the annual quantities as modeled delivery to streams under the recorded synthetic terrain, land cover, forcing and coefficients. The actual Upper Savannah regional source assembly and utility-specific work retain their separate geographies and source identities.

The source is the original completed ensemble `8cb02b0fe3b6a96782525e8aa5607621dd0a456719c6651ce07a675d9cae1ff4`, report `9c0d1a2a6cf4bfa06a5811885d4bc8955ef9ccf5e020284a9b6169e86aa50cac`, in project `1b6a344c-df5a-4986-a5e4-47a2d158324b`. All twelve original file bodies were checked against their original byte counts and SHA256 values before interpretation. The exact packet is public Git blob `3eae73d8b83b3541435aa2c201200a6439d97be6`, 1,066,937 bytes, SHA256 `75d157b8540900cd97d42f35a1ca48de2f7dd33dc6153eecf7b27fb7eeaea572`. Its twelve source members total 969,887 bytes. The numeric report itself is 220,725 bytes, SHA256 `066b3267c63cd1812f789d4781627c399d0c94ec7f19d5640a09f28fc4fbbc70`.

Derived contrasts use the original saved numeric rows and their exact support identities. Full precision, original IDs and hashes accompany the prose in the machine-readable files.

## Experimental design and geographic meaning

The retained grid is 120 by 120 cells at 30 metres in EPSG:26917, with bounds [330000, 3857400, 333600, 3861000]. Its 3.6 km by 3.6 km rectangular footprint is 12.96 km², or 1,296 planar hectares. Each cell represents 0.09 planar hectares. The grid specification identifies an explicit virtual catchment and asserts no external upstream cells. This footprint must remain distinct from the separate actual Upper Savannah regional input and watershed work.

There are four parameter profiles: MFD routing with SDR maximum-L cap 122; MFD/333; D8/122; and D8/333. The routing choice is linked across NDR and SDR. The cap is the dimensionless SDR `l_max` setting, not a length in metres. All four use the same retained biophysical table and unvaried parameters. NDR has `k_param=2`, subsurface critical length 150, subsurface efficiency 0.5 and flow-accumulation threshold 100. SDR has `ic_0_param=0.5`, `k_param=2`, `sdr_max=0.8` and threshold 100. These are recorded demonstration assumptions, not locally calibrated estimates.

Each profile has three scenarios:

1. The baseline retains simulated present land cover.
2. Riparian restoration changes pasture and cultivated-crop cells to forest inside a true 90 m Euclidean buffer of the **generated** stream-axis line segments. Developed and pre-existing forest cells remain unchanged.
3. The matched-area alternative changes the same original class counts to forest outside the complete restoration corridor. Its saved selection states that paired annual-precipitation differences are minimized within each original land-cover class.

The executed edit records confirm exactly **635 converted cells, or 57.15 ha**, in each alternative: 236 pasture cells (21.24 ha) and 399 crop cells (35.91 ha), all converted to class 41 forest. The riparian mask contains 1,214 cells, but only 635 meet the original class filter. The matched-control mask contains 635 cells and all are eligible. Thus 1,214 mask cells must not be reported as restored area.

Matching area and original class composition isolates those aspects of the comparison. The saved design does not establish that slope, flow connectivity, every forcing value, implementation cost or feasibility are identical. The location difference is the modeled question. This deterministic simulated comparison is not a randomized field experiment.

## Complete annual output matrix

| Routing (both cap settings) | Metric; annual unit | Baseline | Riparian | Matched control | Riparian reduction | Control reduction |
|---|---|---:|---:|---:|---:|---:|
| MFD | Nitrogen; kg/year | 3786.088871 | 1139.226214 | 2686.229098 | 2646.862656 (69.9102%) | 1099.859773 (29.05%) |
| MFD | Phosphorus; kg/year | 300.995438 | 88.830089 | 211.969424 | 212.165349 (70.4879%) | 89.026014 (29.5772%) |
| MFD | Sediment; metric tonnes/year | 700.434802 | 572.523953 | 586.528272 | 127.910849 (18.2616%) | 113.90653 (16.2623%) |
| D8 | Nitrogen; kg/year | 3815.335329 | 1130.297998 | 2812.968725 | 2685.037331 (70.3749%) | 1002.366604 (26.272%) |
| D8 | Phosphorus; kg/year | 302.920908 | 87.727066 | 221.650132 | 215.193842 (71.0396%) | 81.270776 (26.829%) |
| D8 | Sediment; metric tonnes/year | 1011.97893 | 615.118641 | 810.973997 | 396.860289 (39.2163%) | 201.004932 (19.8626%) |

The two cap settings within each routing method produce identical retained output bytes for all three scenarios and all three reported artifacts. The table therefore displays the two distinct routing-specific result sets once. `native-run-matrix.csv` retains all twelve separate run identities and 36 pollutant rows; `paired-effects.csv` retains all 24 original scenario-versus-baseline rows.

Nitrogen and phosphorus are kilograms per year. Sediment is metric tonnes per year; the original report spells this `t/year`, while retained artifact summaries spell it `metric_tonnes/year`. The saved native rasters are described in per-hectare annual units and the reported artifacts in per-pixel annual units, with 0.09 ha per pixel. The table uses the already calculated annual mass sums and does not apply another area multiplier. The official [NDR User Guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/ndr.html#interpreting-results) and [SDR User Guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html#interpreting-results), read on 13 October 2026, confirm per-hectare raster units from InVEST 3.15 onward. Both describe modeled delivery to streams; these outputs do not provide a downstream intake concentration.

Reductions are baseline minus alternative. Original numeric `delta_common` uses the opposite sign, alternative minus baseline. Original percentages are 100 × that signed change / baseline on the identical common-valid mask. Every baseline here is positive. The attached CSVs retain the original signed convention.

## Direct riparian versus matched-control contrast

| Routing | Metric | Extra annual reduction from riparian placement | Riparian output lower than control | Riparian/control reduction ratio |
|---|---|---:|---:|---:|
| MFD | Nitrogen | 1547.002884 kg/year | 57.5901% | 2.4065 |
| MFD | Phosphorus | 123.139335 kg/year | 58.093% | 2.3832 |
| MFD | Sediment | 14.004319 metric tonnes/year | 2.3877% | 1.1229 |
| D8 | Nitrogen | 1682.670727 kg/year | 59.8183% | 2.6787 |
| D8 | Phosphorus | 133.923066 kg/year | 60.4209% | 2.6479 |
| D8 | Sediment | 195.855356 metric tonnes/year | 24.1506% | 1.9744 |

These direct differences are defensible from the retained totals: within each profile and pollutant, the two baseline comparisons have the same baseline run ID, exactly equal baseline total, identical common-cell count and **identical common-support SHA256**. Both scenario pairs also have zero baseline-only and alternative-only cells. Thus the three scenarios share the same valid support for that profile and metric. This is stronger evidence than merely finding equal cell counts.

For example, MFD nitrogen output falls from 2,686.229098 kg/year in the matched control to 1,139.226214 kg/year in the riparian scenario, an additional reduction of 1,547.002884 kg/year, or 57.5901% of the control output. That is distinct from the baseline-relative reduction improvement of 40.8602 percentage points. The benefit ratio 2.4065 divides the two reductions from the common baseline; it does not mean that riparian output is 2.4065 times lower.

MFD sediment is the cautionary result: riparian placement improves the reduction by only 14.004319 metric tonnes/year relative to control, or 2.3877% of control output. Under D8, the corresponding improvement is 195.855356 metric tonnes/year, or 24.1506%. The favorable direction persists, but the sediment effect magnitude is sensitive to routing.

Across the tested assumptions, riparian placement is preferable if the sole decision criteria are these three modeled annual exports and converted area. This says nothing about unmodeled costs, land availability, ecological effects, maintenance or real-world calibration. No weighted score or monetary benefit was calculated.

## Routing sensitivity on exact common cells

Changing routing changes valid support, so subtracting each routing method's full own-valid total does not isolate its common-cell effect. The original nine parameter rows compare each non-reference profile's **baseline scenario** with the MFD/122 reference baseline. The exact D8-versus-MFD common-support results, repeated identically for D8/122 and D8/333, are:

| Metric | MFD baseline on common cells | D8 baseline on those same cells | D8 minus MFD | Change from MFD | Common cells |
|---|---:|---:|---:|---:|---:|
| Nitrogen (kg/year) | 3786.088871 | 3800.742016 | +14.653145 | +0.387026% | 14034 |
| Phosphorus (kg/year) | 300.995438 | 301.841024 | +0.845586 | +0.28093% | 14034 |
| Sediment (metric tonnes/year) | 700.434802 | 1006.436345 | +306.001543 | +43.68737% | 13976 |

For N/P, D8 also has 130 valid cells outside the MFD mask. Those cells add 14.593313 kg/year nitrogen and 1.079885 kg/year phosphorus to the D8 own-valid totals. Consequently, its own-valid nitrogen difference is larger than the matched-support increase of 14.653145 kg/year. These quantities must remain separate.

For sediment, D8 has 188 additional valid cells, carrying 5.542585 metric tonnes/year. Its total own-valid increase is 311.544128 metric tonnes/year, whereas the original common-mask sensitivity is 306.001543 metric tonnes/year, or 43.68737%. The latter is the appropriate retained comparison of the two routing choices on the same land support.

The report's parameter-sensitivity table evaluates the baseline scenario only. It must not be described as a native common-mask parameter comparison for every alternative. The scenario-effect matrix separately shows how the modeled restoration results vary by routing.

## Support, missing cells and robustness

MFD nutrient scenario comparisons use 14,034 valid cells, with support SHA256 `dfb0a4fbe6464705f6816db690f9201fffca1cea5063f8e1c45cb121a2d77468`. MFD sediment uses 13,976, hash `86a43a214a629197b477f0a8e62ac9b4d0b96c2cf157ca5d454a3172586b8f9c`. D8 scenario comparisons use 14,164 for all three metrics, hash `c4b43990b8734dd915af20bf2e537a4689bfbb03c3986189641cc3666fcc683e`.

The full input rectangle has 14,400 cells, and each original prepared input raster records 14,400 valid cells. The output masks differ. Missing output cells must not be treated as zero export. A valid-cell count alone also cannot establish why cells are absent or whether all intended reporting-area cells are covered. The official [SDR output-area guidance](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html#defined-area-of-outputs) identifies stream cells and cells that do not drain to modeled streams as possible sources of output NoData. Attribution of these particular missing cells requires the original stream and drainage rasters, not the summary counts alone.

The retained `coverage_complete: true` field in each support group is not evidence that all 14,400 cells have valid modeled output. Here it accompanies matched support within a scenario pair. It must not be translated into “100% geographic coverage.”

The report has twelve support groups: two alternatives × three metrics × two routing-specific support masks. Each group contains two cap settings with identical results. A zero-width range inside a group therefore reflects two identical outcomes, not an absence of scientific uncertainty. These are four deterministic assumption profiles and two distinct output sets, not independent random replicates or a probability sample. No confidence interval, statistical significance or probability of superiority is established.

It is accurate to say that both alternatives reduce all three exports, and the riparian alternative has lower outputs than the control, in every tested profile. The cross-routing range of reductions is a descriptive scenario sensitivity across distinct supports, not a pooled common-support uncertainty interval.

## What the unchanged maximum-L result does and does not show

All six same-routing, same-scenario cap pairs have identical SHA256 values for nitrogen, phosphorus and sediment output rasters. Their SDR `ls.tif` hashes also agree within routing. At the same time, each pair has distinct SDR input signatures that explicitly retain 122 and 333. None of the twelve completed SDR stages is recorded as reused. Thus the zero cap sensitivity is present in the original completed SDR results, not an artifact of treating a repeated NDR stage as a new SDR solve.

The NDR behavior is expected from this experiment's input records: `l_max` is absent from its arguments, and its inputs remain identical when only the SDR cap changes. Six NDR stages correctly reuse their matching native donors. The data are consistent with the cap change not altering the retained terrain's LS calculation. Without inspecting the underlying LS values, this memo does not assign a mechanistic threshold or generalize the result to another terrain.

## Native completion and retained provenance

The twelve profile–scenario records are complete. Their 24 completed model-stage records comprise **six non-reused NDR stages, twelve non-reused SDR stages, and six reused NDR stages**. That is eighteen non-reused completed stages plus six reused stages. Every retained NDR and SDR stage records observed InVEST version 3.20.0, and the recorded requested version also agrees.

This count concerns completed stage provenance; it does not infer how many failed or repeated attempts may have occurred. The original Study preview preserves the selected reused runs and their six native donors. The current interpretation does not rebuild or replace their source operation.

For every one of the 33 original paired and parameter rows, recomputing alternative_common − baseline_common gives the stored delta exactly in the read JSON's binary64 representation; recomputing 100 × delta / baseline gives the stored percentage exactly. All twelve source bodies matched their independently retained hashes. The companion tables preserve these original quantities and the derivation formulas.

## Recorded demonstration timing

The twelve retained run execution intervals span **10:25:07.958739 to 10:25:37.406491 UTC on 13 October 2026: 29.447752 seconds**. The original numeric report release was recorded at 10:25:38.179335, or **30.220596 seconds after the first run execution began**. Individual run intervals range from 0.957102 to 6.481948 seconds. These timestamps come directly from the twelve retained `execution` objects.

The eighteen non-reused stage intervals sum to 20.050560 seconds: 8.575988 seconds for six NDR stages and 11.474572 seconds for twelve SDR stages. The six recorded NDR reuse-transfer intervals sum to 0.573177 seconds. Reused stages retain their donor's original start/end timestamps; counting those again as fresh work would double-count the same executions. Sums of stage durations are bookkeeping totals, not substitutes for the observed whole-batch wall-clock span.

The saved runtime is Linux x86_64, CPython 3.12.15, InVEST 3.20.0, GDAL 3.12.4 and pygeoprocessing 2.4.11. All twelve current run execution records show attempt 1 and empty execution histories. These records support the successful batch chronology; they do not characterize every earlier environment setup or host event.

The earliest run was prepared at 10:19:55.771784, well before execution began. Accordingly, “about 30 seconds” describes this small, already prepared, 14,400-cell demonstration batch through its numeric report release. It excludes source acquisition, environment installation, grid preparation, queue waiting, complete Workspace/Study export, report rendering beyond the recorded release, and browser operation. It is not a cold-install benchmark or a performance promise for the actual regional watershed. Full per-run and per-stage timestamps remain in `interpretation.json`.

## Companion files and adoption

- `native-run-matrix.csv`: all 36 pollutant rows across twelve original runs, including native units, annual-total units, artifact hashes, observed stage versions and reuse donors.
- `paired-effects.csv`: all 24 original baseline-paired scenario rows, with original IDs, counts, exact support hashes and signed deltas.
- `parameter-effects.csv`: all nine original baseline parameter comparisons.
- `direct-contrasts.csv`: twelve derived riparian-versus-control rows, one per profile and pollutant, with support proof fields, both alternative IDs and explicit denominators.
- `interpretation.json`: complete source bindings, profile/scenario assumptions, full-precision summary, cap identity checks, derivation formulas and limitations.

## Use in the original demonstration

Open the retained ensemble and its three scenarios, display the original baseline and alternative totals, then select the matched-control scenario as the reference for the riparian alternative across all four profiles. Keep each exact support group visible. Show the 635-cell edits and the two routing-specific result sets alongside the original profiles, maps and native logs.

264B and ECHO can use the tables above for the demonstration narrative; COMPARE13 remains the publisher of the existing complete scientific working package. Its source is the completed ensemble `8cb02b0fe3b6a96782525e8aa5607621dd0a456719c6651ce07a675d9cae1ff4`, source operation `537f895db502ab3a00e1cf9b636a67f82a02a29b7395df837bbc1f18855739c2`, and original report `9c0d1a2a6cf4bfa06a5811885d4bc8955ef9ccf5e020284a9b6169e86aa50cac`.

Use the complete owner direction in [CURRENT_OWNER_DIRECTION.md](../../CURRENT_OWNER_DIRECTION.md), version **2026-10-13.3**, and [AGENTS.md](../../AGENTS.md) with the outgoing files. The source bank includes both original instruction bodies. Preserve the existing editable Study, donor closure and 14:00 UTC handoff.
