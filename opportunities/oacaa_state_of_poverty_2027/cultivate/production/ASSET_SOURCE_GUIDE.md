# Household financial-cushion source and operating guide

This cohort adds two editable datasets, four source-backed report sections and six native mappings to the existing Ohio working report. All earlier source-plan identities remain intact.

## Original sources and periods

The Prosperity Now Scorecard application identifies build 2025.04.21. Its metadata labels current state observations 2021 and names the Survey of Income and Program Participation. Those source labels remain explicit; these are not current 2026 estimates. The API requests are recorded in sources/Scorecard-assets-source-metadata.json. The unchanged current and trend responses independently agree on every selected 2021 value.

The public metadata contains factual source labels and our paraphrases. The complete original definition response is retained on the existing internal source page, identified by bytes and SHA-256. Its original SIPP-labelled links point to an ACS URL; we preserve that source inconsistency instead of claiming a different underlying calculation.

Asset poverty measures household net worth against three months at the poverty threshold without income. Liquid asset poverty uses the provider's defined financial and retirement assets while excluding home, vehicle, other property and business equity. Household percentages cannot be added to the person/family income-poverty percentages elsewhere in the report.

Ohio's source-labelled 2021 estimates are 20% asset poor and 29% liquid asset poor; US estimates are 19% and 27%. They are descriptive point estimates. The provider's four-person threshold example is explicitly dated 2020 (USD 6,550); it is not relabelled as 2021 or 2026.

## Original values, gaps and precision

The trend contains 24 published observations: Ohio/US × two measures × 2013, 2014, 2015, 2016, 2019, 2021. Twelve additional rows preserve original -1 markers in 2017, 2018, 2020. Their percent cells are empty, not zero or interpolated.

Some JSON numbers contain binary floating-point residue. The executable normalizer accepts only a difference no larger than 1e-10 from a one-decimal display. A changed precision fails for review; exact original JSON remains available. Fields ending _moe are retained literally as provider_moe. The received 2019/2021 value is 10 for each selected measure/geography. No confidence level or unit is assigned, and no interval is manufactured.

ASSET_SOURCE_CONCORDANCE.json retains 28 comparisons with the original Tables 6–7 OCR. Its four 2011 cells have no corresponding field in this received provider trend. Ohio 2015 asset poverty is 28.9% in the provider response, while the retained transcription reads 28.2%. Several other OCR cells are corrupted. Original PDF pixels must be viewed before editorial changes to the issuer's own text; this working edition uses the retained provider values.

## Rebuild and use

Run `node asset_reporting.cjs . --check` from this directory to compare all three generated outputs with the unchanged originals. Omit --check to rebuild the two datasets and concordance. The command has no network or package dependency.

The original commissioner passes asset-working-plan.json and asset-source-lock.json to acs_working.extend. It retains the plan's own immutable identity, imports exact originals into the existing Store, adds sections to the same report and applies the existing reviewed mappings.

In /report-data, open the asset-history dataset and inspect geography, measure, source year and availability. Download the unchanged responses. Review a proposed correction against the original row, then inspect the exact report-block comparison before applying it. Recover an interrupted request through its original pending command; do not replace it with a new request.

## Edition and handover

The original responses, datasets, definitions, plan, lock, normalizer and concordance travel in the immutable editable-source ZIP. Existing workspace export/reopen retains source revisions, mappings, report identity and command history.

The original receiving operation must run and open the exact outgoing edition, VIEW actual PDF pages and charts, and operate important controls at desktop and narrow widths. In the receiving copy, inspect an observed row, missing-year row, original download and mapping preview. Empty percentages must remain unavailable, and household estimates must remain labelled as households. Preserve actual results in the same receiving record.
