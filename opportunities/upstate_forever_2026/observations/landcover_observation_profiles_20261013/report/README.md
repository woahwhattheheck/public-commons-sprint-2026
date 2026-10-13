# Whole-domain land-cover and dated observation report

This component presents the merged 217-watershed source edition through the existing Scientific Reports / Observed Context contract. The original source is PR3653, merge 933dd4d0a927d31883f3772ec9de6c760d85c767. It retains all 217 profiles, 1,736 group balances, 197 coordinate variants and six upstream source files.

## Receive and open

From the current application root, import `landcover_observation_profiles.report.sources.json` through the existing Sources intake. In Scientific Reports choose **217 watershed land-cover and dated observation context**. The existing ordered report selection accepts this document beside the paired land-cover, focal-watershed, lake-measurement and receptor-accounting reports. Preserve the existing source order when appending it.

The manifest is at application root so all companions keep their exact application-relative names. The selected document has role `OBSERVED_CONTEXT`, metadata `report_schema: upstate.observed-report/v1`, and a content-derived ID. Existing `model.observed_context.bind/collect` binds all companion bytes, carries the report sections into PDF/HTML/Markdown and retains the original source links. The same existing native scientific figure drawer renders the supplied numeric specification; the D3-generated SVG remains a retained report asset. No saved model output is required to read this dated source context.

## Source calculations and figures

The executed report core aggregates the retained 217 group rows per class group and verifies gross gain minus gross loss equals net change. Panel A shows all eight groups with gain, negative plotted loss and net area. Panel B uses all 217 HUC12s and the exact local evidence counts: 152 neither selected category, 44 assessment only, 16 observed-flow gauge only, 5 both. It is a classification/point-inventory plot, not a water-quality response model. Table selection and every plot coordinate are reproduced from the same source hashes.

The report retains dated 2026 draft assessment meanings, original and current HUC fields, source-coordinate alternatives, different gauge roles and the SV-840 study-scope distinction. Gross and net are both shown. Class 21 belongs to developed; developed area is not impervious area. Cell-centre support remains the original annual comparison support and differs from a fractional-polygon native ledger. Local point presence does not establish upstream monitoring coverage. The detailed parent README and all original tables are linked inside the report.

## Offline replay

Run from the complete application:

```sh
node observations/landcover_observation_profiles_20261013/report/rebuild.mjs --verify-only
```

Omit `--verify-only` to recreate missing derived outputs after source validation. The command validates all 14 original inputs, the three existing pinned D3 modules and their licenses, then rebuilds the five published report outputs and checks each exact size/hash before writing. It uses the already retained sampling-flow D3 vendor modules through an explicit CommonJS loader; it does not require node_modules or download dependencies. Source paths and resolved output parents stay inside the selected application root. An optional `--root APPLICATION` selects another complete retained application.

The source index separates original data from current report output identities. The pure `report_core.mjs` was executed with the exact original tables and pinned D3 modules to generate this edition. The upstream annual/routing calculation remains owned by the original source producers. Native report receiving uses the current application and source manifest rather than installing an older report formatter.
