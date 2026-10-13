# Canonical WQP measurements in Flow load calculations

This adapter carries the original WQP characteristic and detection interpretations into the existing Flow study and load calculation. It retains chemical basis, source speciation, fraction, method, original limits and source-version decisions. The explicit mapping is `measurements-wqp-characteristics-loads/v1`, accepting the retained `wqp-characteristics/v1` and `wqp-detection-conditions/v2` editions.

## Complete actual Hartwell product

The original 2026 Hartwell source has **132 measurements**, **6 activities**, **26 characteristic groups** and **34 left-censored results**. The selected daily discharge response has **285 rows**. The complete product retains all eight source collection members, including the original station, activity, result and detection-limit responses, and the complete original USGS daily response with its own source URL.

All **26 series are context-only**. The source does not establish co-located, matched-catchment discharge for these lake stations. Consequently there are **zero quantified mass days and zero annual mass exports**. The 46 rows that meet conservative concentration metadata checks do not thereby acquire spatial support. The context export retains 66 concentration rows and 66 other original measurement rows.

Study: `1a960683943c480aa1fdaec87500653e482004a1e8d2f98a980f403bc2b4e52c`

Calculation: `aa06f97c251a717d8b41c604f0c7ed46c62f9b86643b825fa17a18058e86e968`

The exact complete thirteen-file output bank is 28,396,936 UTF-8 bytes, SHA256 `3e4ba3fe7b74cba07a49e47e2e870e40b84444f387a91f74e0e49eccb126963b`. Its four ordered parts and manifest are under `source/canonical-wqp-loads-20261013/`.

From that source directory, with Node 22.16 or later:

```sh
node materialize-output.mjs --output ACTUAL_SEPARATE_OUTPUT
```

The materializer verifies every encoded part, the compressed and decoded bank, every output body and the complete roster before publishing. Existing identical files are accepted; different files are rejected. The original bank and earlier calculations remain intact. It does not open a database.

Open `ACTUAL_SEPARATE_OUTPUT/report.html` with all sibling files. The report uses the shared Flow renderer at Git blob `ce21e8d72bc30c7c772d16cc986045b44f6b75b6`, including original chemical metadata. Full calculation, source study, selection, context CSV, annual/daily/period CSVs and metadata travel together.

## Existing Measurements receive, calculate and reopen

From the application root, using the existing Measurements workspace:

```sh
node measurement_workspace/engine/cli.mjs flow-receive --workspace EXISTING_MEASUREMENTS --file ACTUAL_SEPARATE_OUTPUT/flow-study.json
node measurement_workspace/engine/cli.mjs flow-load-preview --workspace EXISTING_MEASUREMENTS --file ACTUAL_SEPARATE_OUTPUT/load-selection.json
node measurement_workspace/engine/cli.mjs flow-load-save --workspace EXISTING_MEASUREMENTS --file ACTUAL_SEPARATE_OUTPUT/load-selection.json
```

Use the existing Flow interface to reopen the saved study and calculation, inspect original measurements and source support, and export the complete report family. These commands belong to the existing native receiving course. The retained execution evidence establishes the scientific transformation and output identities; filesystem materialization, SQLite receiving and browser operation require execution on that course's actual host.

## Scientific contract

A shared characteristic label does not erase chemical basis or source units. TKN and nitrate plus nitrite remain their original quantities, never inferred total nitrogen. As-P and as-PO4 series remain distinct; the adapter performs no stoichiometric conversion. Fractions and methods remain separate in the interpolation identity. Unknown basis, missing fraction or method, incompatible quantity units, source exclusions and unresolved version selections stay in context.

Left-censored results retain a null point value and their original finite bound. Right-censored or unsupported censor meanings do not become finite upper envelopes. Non-concentration quantities such as microbial counts, turbidity, pH, temperature and depth use the existing native `other_context` support and retain their complete canonical metadata. Mixed property exports declare `source_context`; the legacy concentration-only export remains unchanged.

The bridge revalidates source hashes, regenerated selected flow rows and original sample-day joins. Spatial admission still requires the selected source relation to establish co-location and matched-catchment discharge. Matching dates or contract text cannot upgrade a regional gauge into that relation.

For an admitted complete period, flow-weighted concentration is 1000 times quantified mass in kg divided by the flow volume in cubic metres over exactly the same quantified days. Censored bounds use the same denominator; zero volume produces null. No endpoint extrapolation, missing-flow filling or annual scaling is introduced.

## Retained source paths

- `observations/hartwell_2026/wqp_20261013/characteristics-v1/collection.json`
- `observations/hartwell_2026/wqp_20261013/characteristics-v1/results-with-original-limits.csv`
- All original members listed by that collection, reproduced in the saved study.
- `source/daily-flow-editions-20261013/original/usgs_02186702_2026_20261012.json`

The source version is explicit. New interpretation editions require their own reviewed mapping; they do not silently replace this calculation.
