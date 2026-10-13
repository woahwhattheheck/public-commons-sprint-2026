# Comparing independent sources with native watershed results

TokenJunkieLabs · Upper Savannah scientific workbench  
Operation: ECO-INDEPENDENT-COMPARISON-B3909-20261013

This guide accompanies the existing scientific Workspace and its independent-comparison component. It explains how to select a meaningful comparison, retain the original evidence, interpret a disagreement, and hand the selected result to another analyst. The reference catalog beside this guide supplies source descriptions and original links. Actual values always come from the selected retained files and completed native runs.

## Start with the question and both original quantities

Choose what the comparison is intended to establish: agreement with a monitoring-based load estimate, agreement between two models, correspondence between analytical periods, or source context for a particular catchment. Write that question in the saved selection before interpreting a difference.

Keep three independent descriptions for each side:

| Description | What it answers |
| --- | --- |
| Evidence kind | Was this a field measurement, an estimate derived from monitoring, another model's output, or an output of the selected native run? |
| Physical quantity and support | What constituent, fraction, mass/concentration/flow basis, location and contributing area does the value represent? |
| Method and period | How was the value obtained, over which period, and with which normalization or estimator? |

A numeric annual rate does not answer all three questions. The catalog's profiles are descriptions, not automatic mappings of a source file. The selected original member, row and column remain authoritative.

For each selected pair, keep both source values visible even when their definitions differ. Present the actual difference in definitions beside the values. Continue the remaining comparable work while the unmatched selection remains available for explanation or a later source edition.

## Match the original spatial support

Use the actual station/reach and its contributing geometry. Keep station IDs as strings, including leading zeros. A watershed label, nearby gauge or shared basin name is a useful search clue, not an exact spatial join.

The maintained annual-reference importer already receives original upstream geometry and records the role of the water-quality station, published flow station or published reach. Reuse that result. Preserve its full/split catchment choice and any explicit geometry-component selection. The source response, selected polygon and omitted components remain available together.

For a native raster comparison, aggregate over the selected contributing area on the actual output grid and retain valid-pixel support. Record what lies outside that grid and what is nodata. Use the original engine's quantity basis: a rate per hectare needs the actual pixel area once; a pixel mass must not receive that conversion again.

For reach-based external products, distinguish local incremental contribution, accumulated upstream quantity and delivery to a specified downstream endpoint. Their names and units must come from the original dictionary. Accumulated values on nested reaches must not be summed as if they were disjoint contributions. Keep the complete reach selection and its join evidence in the working export.

## Match the scientific boundary

The source profiles distinguish native landscape-to-stream output, station-catchment load, selected external reach quantities and original sample support. Inspect the associated source description and original documentation before comparing them.

A difference can reflect a process boundary rather than a defective parameter. Preserve original point-source and receiving-water context alongside the selected comparison. Any added discharge, downstream transformation or subtraction is a separate derived quantity with its own source rows, method, units and period. It must not replace the original native output.

Use the maintained observation-support helpers for original constituent evidence. In particular, retain the source's nitrogen/phosphorus identifiers and the distinction between suspended sediment and total suspended solids. The current helper records original parameter codes and source fields. Reuse it instead of guessing from a shortened display label.

A reviewed comparison can remain scientifically useful when some processes differ. Record the specific interpretation: which differences are expected, which can be investigated with an existing source, and which require a separately modeled process. The comparison should help an analyst decide what to change or measure.

## Preserve the period and estimator

Read both the source-input period and the reference quantity's statistical period. A model reference year, a monitoring interval, a flow-data interval and a single sample date are different fields.

The existing USGS annual importer preserves the publisher-selected estimator, annual rate, error and original source dates. Use its actual retained fields. Do not multiply an already annualized rate by the number of years merely because its supporting observations span several years. A sum of seasonal totals and a mean of seasonal rates also require different operations.

When a source uses long-term normalization, preserve that method explicitly. An external model's reference-year result cannot silently become a measurement made during that calendar year. Likewise, current land-cover inputs need their own source date even when compared with an older reference product.

For repeated annual records, retain each original year and the chosen aggregation rule. Do not count overlapping or duplicate alternative estimates as independent years. The existing calibration/observation logic retains that source lineage; the comparison component should carry it forward.

## Compute differences with a declared meaning

For a compatible pair, let P be the selected native prediction and R the selected reference in the same displayed unit. A signed difference is P minus R. It has the original physical unit and direction. A percentage relative to R is 100 times that difference divided by R; it is undefined when R is zero. Preserve the finite signed difference in that case and show the percentage as unavailable, with its reason.

If an analyst instead selects a symmetric percent difference or a logarithmic ratio, retain its exact formula and domain. These quantities answer different questions and must have distinct labels. A missing value, censored bound or non-finite input cannot become zero to make a chart complete.

Aggregate residual summaries over the explicitly selected matched set. Retain that set's complete IDs, count, constituent, unit, source edition and support. Separate constituents and incompatible quantity types. A cross-model RMSE describes disagreement between those models; its name must not imply independently measured predictive accuracy.

Keep the original value and any converted display value together. A conversion record identifies the source unit, target unit and factor or formula. Unit conversion changes representation; it cannot turn a concentration into an annual load without the required flow and integration evidence.

## Carry uncertainty and analytical intervals accurately

A published standard error, a confidence interval, a censoring interval and variation across modeled scenarios are different objects. Preserve the original type and method rather than placing all four under one generic error-bar label.

The existing paired-period comparison and figure modules retain exact arithmetic intervals, open/closed endpoints, analytical activities, common months and signed activity weights. Reuse their result and figure data when selecting that source. They already preserve agreeing duplicate result IDs with one activity contribution and keep excluded source rows available.

An unbounded endpoint remains unbounded. Do not substitute a midpoint to rank or plot a censored record. If a display cannot draw the full numerical extent, its rendering boundary is separate from the source quantity. The original downloadable interval remains complete.

Where source and prediction share inputs, stations or fitting references, record that relationship. Agreement still gives useful information, but it does not provide an independent holdout. Existing calibration and held-out evaluation stay in their original component; this comparison does not rerun fitting or select a new best profile.

## Turn a discrepancy into useful work

Save an interpretation alongside the selected evidence. Good explanations identify an inspectable cause and a concrete product change: a mismatched original unit, a different catchment, overlapping reach support, a source-period change, a constituent-method difference, an unrepresented discharge, or a separately modeled receiving-water process.

Distinguish an explanation supported by a retrieved source from an analyst hypothesis. A hypothesis can point to a new data acquisition or native scenario while the existing comparison remains intact. Preserve the original values and prior interpretation when saving the next edition.

Use the original run queue for any changed model input. Keep the old result visible while the new run executes, and retain the exact completed run selected in each comparison edition. An edited label or selected precomputed case must not appear as a newly executed simulation.

## Save, export and independently reopen

The working edition should retain the question, both original source selections, all selected record/reach/run IDs, source definitions, spatial and temporal support, unit conversions, arithmetic, interpretation and original revision parent. Preserve descriptive rows as well as rows used in aggregate summaries.

Export the complete comparison data and readable report through the existing Workspace route. Carry the reference catalog and the original source records needed to understand each value. The receiving operator should be able to reopen the same selection, inspect the original values, change a comparison choice and save a successor without losing earlier work.

Keep the normal source and portable-Study contracts. This component adds a scientific comparison to the current application; it does not introduce another scheduler, private repository, identity system or source store.

## Maintained source and primary references

The adjacent independent_comparison_reference_catalog.json holds four contextual profiles and exact primary/source links. The relevant existing contracts are:

- model/observation_support.py, original constituent and quantity support.
- model/observation_comparability_figures.py, exact retained analytical intervals and their figures.
- source_tools/USGS_ANNUAL.md and source_tools/usgs_annual.py, published annual-reference selection and native Workspace binding.
- Existing calibration and comparison storage, for their original selected run/observation histories.

Primary references include [InVEST 3.20 NDR](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html), [USGS annual estimates](https://doi.org/10.5066/F7DN436B), [USGS SPARROW Southeast source catalog](https://water.usgs.gov/catalog/datasets/684ccf40-27f3-4733-b6bb-58e8a54e52ea/), and [Hoos and Roland, SIR 2019–5135](https://pubs.usgs.gov/publication/sir20195135). Authored code and documentation follow the repository license; original scientific sources retain their publisher attribution.

## Product operation and owner direction

Apply the complete owner rendered-product instruction in the repository's active AGENTS and docs/policies/rendered-product-inspection-policy.md. Operate and visually inspect the outgoing populated, empty and error states, desktop and narrow screens, and every exported attachment and reopened project. Correct the actual product within this same implementation.

The post-call ECO-POSTCALL-20261013 work orders at https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8R2SQ0NP continue the broad engineering expansion and supersede the old project cutoff. Keep original native operators, active runs, public-source publication and current contact ownership.
