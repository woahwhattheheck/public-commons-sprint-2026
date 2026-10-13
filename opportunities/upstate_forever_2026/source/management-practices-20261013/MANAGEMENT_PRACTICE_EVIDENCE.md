# Land-management evidence for the existing regional profile workflow

This source packet supports explicit management cases in the existing profile materializer and ensemble workflow. It supplies primary citations, observed treatment results and conditional published support-practice targets. It does not select a regional Workspace profile, create a new coefficient library, calibrate the models or start a model run.

## What can be used directly

The seven rows in `contouring-p-targets.csv` are absolute USLE P choices from USDA Agriculture Handbook 537, Table 13. Each choice is conditional on its printed slope band and maximum field slope length. Select a choice only after recording the actual practice and field conditions, or label those conditions as explicit scenario assumptions. The table is historical USLE guidance; it is not a field-specific RUSLE2 design.

The other numeric observations in `practice-observations.csv` remain measurements or accounting outputs on their original scales. Their `native_coefficient=false` flag is deliberate. The references explain why those observations may motivate a management question without supplying a transferable native coefficient.

No numeric lower/upper uncertainty interval is claimed in this packet. Different treatments, locations, rainfall experiments, analytes and contouring slope bands are not interchangeable uncertainty endpoints.

## Reuse the original coefficient sources

The existing regional libraries remain authoritative for their original cells:

| Original source | SHA-256 | Relevant supplied values |
|---|---|---|
| `source/regional-studies-20261013/albright-2023-biophysical.csv` | `64c5c803e09d50d9f51c029ece199a06c01d19951ae3fdce52b7fca7bb13bf8c` | NLCD 81: C = 0.05, P = 1; NLCD 82: C = 0.24, P = 0.5 |
| `source/upper-flint-2024/nlcd-nonurban-coefficients.csv` | `ba2e1b14ab77f7b327f1124d9b489a81b783c84b71176eb665365d899e27665d` | NLCD 81: C = 0.07, P = 1; NLCD 82: C = 0.17, P = 1 |

These exact public CSV bodies were independently read and hashed on 2026-10-13. They identify source tables, not the profile selected in a running project. The raw Albright CSV lacks native 3.20 load-type columns; retain the existing source-aware 3.9-to-3.20 mapping and its provenance. Upper Flint explicitly records measured-runoff. Do not substitute either table or the separate teaching profile for an unknown selected regional profile.

For example, setting P to 0.5 is a no-op on the Albright crop row. A target above the original value can increase modeled erosion. Preserve that signed result; do not relabel every conservation-named case as a benefit.

## Keep four case families explicit

1. **Nutrient-source case.** Change only explicitly selected `load_n`/`load_p` cells and retain their load basis. Record the original value, operation, factor or absolute target, actual derived value, source and assumption. The available field papers do not establish a universal annual N/P multiplier. Operator-selected sensitivities must say they are assumptions, with no fabricated published range.
2. **Cover-management case.** Change selected `usle_c` cells using an actual crop/management source or an explicit scenario choice. Keep tillage, crop rotation, residue and cover-crop assumptions visible. Use the Piedmont field study as a benchmark, not as an automatic C replacement.
3. **Support-practice case.** Change selected `usle_p` cells independently. Use the conditional contouring targets as `set` operations. If an interface requires a factor, derive target/original only when the original is positive; retain both numbers and reject division by zero. Do not apply one observed practice benefit twice.
4. **Retention case.** Keep selected efficiencies, surface critical lengths and subsurface-N parameters separate. The riparian field source documents a whole-system response; it does not identify the two native surface-retention parameters independently. Any selected retention sensitivity therefore needs its own explicit assumption or calibration source.

A combined case uses the union of intentionally selected cell changes and an actual native evaluation. Do not obtain its result by adding separate benefits or multiplying separate watershed-export ratios.

## Spatial and comparison meaning

A profile-cell edit applies wherever that selected land-cover code occurs in the native input. A statement about one field, buffer or parcel therefore needs a matching spatial intervention in the existing scenario workflow. If the scenario intentionally assumes adoption over an entire class, state that scope and report its actual eligible area. Preserve the original grid and reporting mask.

Keep treated area separate from downstream area affected by routing. Compare baseline and alternative on their actual common valid support, retain native units and the existing one-time area conversion, and report unchanged/unsupported cells. Management changes do not independently justify changing climate inputs, routing parameters, stream thresholds or calibration settings.

The same actual selected profile/table must travel with the case, scientific report and editable Study. Preserve original evidence IDs and parent/derivation links; references to a baseline table do not automatically document every changed descendant cell.

## Use the maintained evidence API

`model.biophysical_evidence` expects these exact CSV columns:

```text
lucode,parameter,value,units,load_type,source_title,source_uri,source_locator,source_period,lower,upper,range_basis,notes
```

Generate the existing template from the actual selected profile. Its original cell value, unit and load_type must match before evidence is attached. Exact units are `kg/ha/year` for loads, `ratio` for efficiencies/subsurface fraction, `m` for critical lengths, and `dimensionless` for C/P.

This packet's two numeric CSVs are research/reference tables, not imports in that cell-evidence schema. Bind a conditional P citation to an actual derived P cell only after selecting the target and recording its applicability. Keep published coefficients separate from explicit assumption transforms; copying a citation into an assumed value's source field does not make the value empirical.

Use source title/URI/locator/period from `management-practice-references.json`. The existing materializer retains the selected values and references. Leave `lower`, `upper` and `range_basis` blank unless the cited source actually supports endpoints for that same quantity and context. Do not create a range record from the observed effects in this packet.

## Report and receiving outcome

The human report should identify the selected original table, management scope, changed cells, assumed versus published inputs, actual changed area and signed native results. Put detailed cell tables and original evidence in editable exports; keep the primary report readable. Open the exact populated report and application, inspect the actual rendered pages at desktop and narrow widths, exercise relevant controls, open every outgoing attachment and cold-reopen the working export. Source checks and captured screenshots without looking at their contents do not establish that receiving work.

No deadline or model-recompute instruction is introduced here. Reuse completed model records under the existing execution and writer ownership rules.

## Files and provenance

- `management-practice-references.json`: ten authoritative citations and parameter applicability.
- `practice-observations.csv`: original-scale observations, explicitly not native coefficients.
- `contouring-p-targets.csv`: seven conditional absolute P targets.
- `source-provenance.json`: original URLs, read scope, exact existing table pins and hashes of our source notes.
- This guide: the binding and reporting procedure.

Only public source material and derived research notes are included. Original research PDFs are linked rather than redistributed. Hashes in the manifest identify these authored notes or the two fetched CSV bodies; they are not claims to have hashed unretained journal PDFs.
