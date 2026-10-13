# Receiving waters in the scientific operator

This module connects agency water designations, utility receiving areas, native model results, and the existing seven-map delivery. Its browser controls use the original authenticated operator, task queue, workspace registry, and file downloads.

## Install into the cumulative application

Receive these additive components beneath opportunities/upstate_forever_2026:

- model/receiving_waters.py and model/RECEIVING_WATERS.md
- model/receiving_water_delivery.py and model/receiving_water_cli.py
- operator/receiving_water_actions.py
- source_tools/receiving_water_catalog.py and its source guide
- operator/web/receiving_waters.mjs and operator/web/receiving_waters.css
- operator/install_receiving_waters.py and this guide

The scientific component is published in public sprint PR2634:
https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2634

The original science commit is b34d0cf46d6c7d331f6b9ae32b73d243c64273b6. Its delivery bridge includes the current regional renderer's shared 0-1 scale contract. Use that edition or a later cumulative revision.

From the actual application directory:

    python -B operator/install_receiving_waters.py --root .

The installer joins five maintained files: operator/server.py, operator/web/app.mjs, operator/web/index.html, model/delivery.py and model/portable.py. It checks every selected seam before writing, parses Python changes, preserves file preimages, and applies only these joins. Repeating the same installation leaves completed joins in place. The optional --check flag reports proposed joins without writing.

The installer targets the maintained Python Workspace/operator and regional delivery interfaces. Apply it to the current cumulative edition so its source, scenario, experiment, and customer-review controls remain composed.

Reopen the existing operator using its original workspace and local URL. Choose **Receiving waters** in the analysis navigation.

## Prepare published agency waters

Choose **Choose published waters**. Set the as-of date and choose which plan to prepare: effective or proposed designations.

Each source row names an actual imported vector source and one source profile:

| Profile | Source |
| --- | --- |
| scdes_classified_waters | SCDES classified-water features |
| scdes_surface_intakes | SCDES surface-water intake features |
| scdes_source_water_areas | SCDES source-water protection areas |
| scdes_protection_zones | SCDES published protection zones |

Select the original ArcGIS layer metadata source when it is already imported. The advanced source controls also accept the complete original layer metadata JSON, exact native feature IDs, exact attribute equality filters, field mappings, source status filters, and object-ID keyed interpretations.

Record the source edition's designation status and authority evidence URLs. Effective dates remain attached to that source. Classified-water sources additionally require the selected designation codes and a rationale for that class selection.

Select the retained HUC/ToHUC catchment network for surface-water upstream associations. Catchment field names default to huc12 and tohuc and can be set to the original source names.

The completed task opens a saved catalog. Its record table shows original classifications, edition selection, retained source records, and selected waters. Search and page through the records, inspect their original provenance, or open the prepared effective/proposed plan. All original catalog and GeoJSON files remain downloadable.

A prepared source selection can also be loaded from JSON through the source form. This supports the source acquisition team's complete retained selection without re-entering its fields.

## Prepare utility or custom receiving areas

**Use utility profile** accepts the existing utility-focus JSON profile. Choose the prepared grid that binds its original catchment source. The source engine resolves the retained HUC anchors and saves an ordinary receiving-water plan.

**Define receiving areas** supports a plan containing several original water sources. For each area choose its name, stable ID, family, source, original feature selection, and relationship rationale:

- **Original HUC / ToHUC upstream land** follows the source network from the selected receiving units.
- **Published source-area polygon** uses the published boundary directly.
- **Explicit geometric context** uses the selected geometry and a declared buffer in metres.

The plan saves its original water features, contribution geometries, source identities, and relationship interpretations. The source inspector shows the actual native field names and sample records while editing a receiving area.

HUC/ToHUC relationships operate at the retained catchment scale. The plan records the receiving units, upstream memberships, boundary ambiguity, and relationship precision. The source guide describes those spatial methods.

## Analyze native model results

Choose **Analyze model results** or **Analyze** beside a source plan.

Select a completed baseline. The form offers completed land-cover alternatives on that same grid and scientific profile. A baseline-only analysis is also supported.

Choose the quantity domain:

| Domain | Numerical source |
| --- | --- |
| Reporting area | Existing reporting-masked mass-per-pixel native artifacts |
| Full modeled domain | Retained original native outputs over the modeled domain, converted by the recorded pixel area once |

Default priority weights are equal across the native quantities actually present. The engine records its fixed baseline caps. The advanced controls accept explicit weights and normalization selections when those are part of the study.

The browser lists available quantities from the analysis itself. Completed NDR-only results can report nitrogen and phosphorus; completed sediment outputs enter analyses that include that native quantity.

Operations run through the existing task admission, operation ID, queue, and saved attempts. The analysis view refreshes progress and completed areas. Failed or interrupted tasks can resume through the normal operation controls. Repeating an analysis uses its original immutable selection and completed geometry checkpoints.

## Read physical results

Open a saved analysis. The table can filter individual receiving waters or combined family areas and either water family. It shows physical totals, valid coverage, and area within the selected quantity domain.

Select an alternative run to switch among total export, signed change, increased export, and avoided export. **Details** shows each pollutant's paired baseline and alternative sums on the common valid pixels, signed difference, increased and avoided quantities, coverage, and units.

Nitrogen and phosphorus totals are kg/year. Sediment totals are metric tonnes/year. Priority statistics remain dimensionless. A valid zero displays as zero, and an absent value remains empty of a numerical estimate.

Combined family areas unite overlapping contribution masks so each land pixel enters its family total once. Individual receiving-water totals retain their own catchments and can overlap.

Saved files include physical quantity CSVs, source and contribution GeoPackages, priority rasters, signed change rasters, original selections, and complete analysis records. File downloads use the original operator's content identity and authenticated file route.

## Include results in the full delivery

In **Maps and delivery**, select a completed receiving-water analysis in **Receiving-water contribution maps**. It must use the selected delivery baseline and the same completed alternatives.

The joined delivery collects the full source plan and analysis, uses the actual family-specific priority layers for drinking-water and high-quality-water map families, appends their physical interpretation to the report, and includes the source boundaries and per-water quantities in its working assets. The current regional map scale contract remains in use.

Normal workspace backup recursively includes the new model, operator, source, plan, catalog, and analysis files. The installed portable join also acquires active receiving-water analysis locks during capture. The restored copy uses the same saved source and native run identities.

## Native receiving operation

Use the existing equipped application and retained regional workspace:

1. Install the complete additive components and join the current operator.
2. Prepare the existing utility-focus profile or the source team's compiled agency selection.
3. Open the saved plan and inspect an original utility anchor and its upstream memberships.
4. Analyze a completed baseline and compatible land-cover alternative using the intended quantity domain.
5. Compare one reported pollutant sum and paired coverage with the selected original raster pixels.
6. Open the browser on desktop and phone widths, inspect a receiving-water result, download its quantities, and reopen the saved analysis.
7. Select that analysis in the complete map delivery and reopen the transferred workspace.

Return the actual workspace, source plan, grid, baseline/alternative run, analysis and delivery IDs with any native exception. The component owners can then repair that precise integration in the same cumulative source.

## API joins

| Interface | Purpose |
| --- | --- |
| GET /api/receiving-waters/catalog | Current original source choices, plans, analyses and catalogs |
| GET /api/receiving-waters/plan?plan_id=... | Saved source plan and downloads |
| GET /api/receiving-waters/analysis?analysis_id=... | Saved physical results and downloads |
| GET /api/receiving-waters/designation-catalog?catalog_id=... | Original designation catalog and prepared plan links |
| receiving.water.catalog | Compile agency sources and prepare the selected designation edition |
| receiving.water.plan | Prepare explicit source-based receiving areas |
| receiving.water.profile | Prepare the existing utility-focus profile |
| receiving.water.analyze | Calculate receiving-water quantities and priorities |

All reads use the existing workspace query and authentication. All actions use the existing POST /api/actions payload and operation_id. The extension supplies normal task result links and file downloads through that same operator.
