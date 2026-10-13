# Dated 2023 Eighteenmile monitoring results

The nine requested annual, all-characteristic Water Quality Portal queries return 920 original result rows. SV-591 has a complete header-only response under both the current and legacy organization IDs. All ten response files are retained exactly.

The normalized intake contains 225 distinct organization/station/activity/project groups and 167 station/project/characteristic/fraction/unit coverage groups. No result row is dropped. Every normalized row carries the original source file, SHA256, one-based data-record index, agency activity/project ID, sampling date/time/timezone/depth, analytical method, result unit, fraction, detection condition and detection limit. The raw CSV contains all additional agency fields.

## Study cohort and source count reconciliation

The CHLA records at SV-838, SV-839 and SV-840 independently share fifteen original dates. Applying that calendar to the five lake sites yields77 candidate rows across the fifteen study dates, including two extra routine activities. Original SWS-2023 displayed local clocks identify SV-268 July11 13:08 and SV-374 August8 10:59 as routine overlaps. Those two rows stay in measurements.csv with their source identity; the explicit reconciled cohort uses75 rows, fifteen per site. Source EST and EDT labels remain unchanged. This is an explicit reconciliation inference, independently matching ASTRA13's existing source-bank method and all five published mean/SD/range sets.

The printed Table7 n=4 for SV-374 and SV-840 remains the original report field. Measured cohort n=15 is a separate field. The reconstructed statistics do not overwrite report data.

Microcystin records remain separate from CHLA. The three special sites have14/15/14 original microcystin rows. Their date differences are in the activity and coverage tables. No non-detect is assigned zero or a fraction of its threshold. A numeric reported value must be interpreted together with its original detection condition and qualifier. Routine SWS-2023 nutrients remain labeled as routine records, even when collected within the study period or on a study date.

## Native intake

Import the existing parent model-sources.json. It includes the original published study vectors/tables plus dated measurement tables and two measured chlorophyll vectors in their original EPSG:4326 and EPSG:4269 datums. The application can link source record IDs to the full original files.

## Reproduce from retained originals

Run `node observations/eighteenmile_2023/wqp/normalize.mjs` from the existing application. The CLI checks original file sizes and SHA256 values before producing the seven derived tables/summary. It uses no network and no package dependencies.

## Upper quantitation limits

Four original E. coli rows have blank reported concentrations, an original Upper Quantitation Limit, and the original condition Present Above Quantification Limit: SV-375 on 9 May, 5 July and 1 August, and SV-376 on 12 June. These are retained as censored_above with their original 2419.6 or 9678.4 MPN/100mL bounds, rather than quantified values. All original source fields remain unchanged. Current row classes are 525 reported_numeric, 240 censored_below, 151 quantified and 4 censored_above. Coverage includes an explicit censored_above_count. The selected chlorophyll cohort is unchanged.
