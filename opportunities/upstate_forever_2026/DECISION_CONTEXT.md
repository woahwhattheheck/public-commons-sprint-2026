# Regional decision context

The **Decision context** desk brings a saved receiving-water analysis together with its retained NRCS and classified-water sources. It produces a persistent report, readable HTML, complete CSV tables and a portable ZIP. The desk can also begin from an original receiving-water plan while the native model calculations continue.

The original receiving-water implementation supplies receptor relationships, contributing masks, paired physical quantities and deduplicated family unions. The report carries these original results into the review workflow and connects them to a compatible map delivery.

## Operator workflow

1. Open the original workspace and its **Decision context** desk.
2. Choose **Create report**. Select a completed receiving-water analysis, or choose a saved source plan. The analysis option shows its original quantity scope and number of alternatives.
3. Select a retained NRCS source-water context, a classified-water crosswalk, or both. Each option identifies the source title, edition and source collection.
4. Choose current classified-source editions, proposed editions, or both. Current and proposed rows remain separate in the report.
5. Save the report. The existing operator task queue handles the operation. Reopen it from **Saved reports**.
6. Select a receptor or a family union. Filter the physical table by pollutant and alternative. Review HUC membership, state-specific NRCS rows, classified-water coverage and the exact native feature associations.
7. Download the **Report package**, or use **All report files** to take a particular table. The package includes the readable report, complete tables, machine-readable context and the exact selected source documents.
8. After the original seven-map delivery completes, choose **Link to map delivery**. Compatible deliveries share this report’s baseline and include its selected alternatives. The saved link presents the original map package and decision report together.

The family-union selector uses the union already calculated by the original receiving-water engine. Source classifications and programme priorities accompany the physical quantities as categorical context.

## Registering the existing source outputs

The desk discovers the source records already supported by the original Workspace importer:

| Input | Original source identifier | Body schema | Desk role |
| --- | --- | --- | --- |
| NRCS context | Entry with role `SOURCE_WATER_CONTEXT` | `upstate.water-context/v1` | State/HUC programme context |
| Classified-water crosswalk | Entry ID `classified-water-crosswalk` | `upstate.classified-water-crosswalk/v1` | Geographic and original-feature associations |
| Receiving-water plan | Saved original plan | `upstate.receiving-water-plan/v1` | Declared source polygon or HUC-network relationship |
| Receiving-water analysis | Complete saved analysis | `upstate.receiving-water-analysis/v1` | Original physical quantities and family unions |

The checkout includes the complete retained 217-HUC edition described in [the source guide](source/water_context/20261013/README.md). Import it directly into the existing scientific workspace from the application directory:

```bash
python -B -m model.cli --workspace /path/to/original-workspace \
  source-import source/water_context/sources-20261013.json
```

This edition supplies the original context body and its 240 selected NRCS state/HUC rows. Its classified-water attributes and original coverage record remain source context; the separate geographic crosswalk supplies the receptor feature associations used by the desk.

The existing source-water module creates its importable `sources.json` from the retained domain, NRCS response and full SCDES geometry response:

```bash
node source_tools/water_context_cli.mjs \
  --domain /path/to/retained-domain.json \
  --nrcs /path/to/retained-nrcs-response.json \
  --classified /path/to/retained-scdes-response.json \
  --out /path/to/water-context-edition
```

Import that generated manifest through the original Sources workflow or `Workspace.import_sources`.

The existing classified-water source module accepts the original capture, exact publisher field mapping, reporting geography, additional HUC geometry and optional current/proposed legal registries:

```bash
python source_tools/high_quality_water_crosswalk.py \
  --capture /path/to/retained-capture \
  --mapping /path/to/native-field-mapping.json \
  --project-source /path/to/project-source \
  --huc /path/to/retained-upstream-selection.json \
  --registry /path/to/current-classified-water-registry.json \
  --bindings /path/to/explicit-reach-bindings.json \
  --output /path/to/crosswalk-editions \
  --workspace /path/to/original-workspace
```

Its `--workspace` option imports the completed source edition. The decision desk consumes its existing crosswalk entry and preserves the `legal_associations.json` and `provenance.json` companions when present.

Both selectors refer to the original `source_collection_id` and `source_id`. Sources retain their original body hash and edition. The report package preserves selected source bytes, including compressed JSON bodies. Each source keeps its native body and companion paths beneath `report/inputs/water_context/` or `report/inputs/crosswalk/`, so sibling provenance references continue to resolve.

## How to read the quantities and geography

**Physical comparisons.** Each row carries the original baseline and alternative sums on their own valid support, and the paired sums on common valid cells. The displayed comparison uses the common cells. `signed_change` is the original stored alternative-minus-baseline difference; `net_reduction` changes its sign for decision review. A reduction percentage divides that net reduction by the baseline sum on the same common cells. A zero or negative baseline retains a null percentage with its reason.

Nitrogen and phosphorus annual totals remain `kg/year`; sediment remains `metric_tonnes/year`. The selected pixel counts, coverage fractions, original direction and Float32 difference-sum basis travel with the CSV rows. The reporting scope remains `reporting` or `model_domain`, as selected in the original analysis.

**Contributing land.** HUC context comes from the plan’s declared `upstream_huc` relationship, using its exact seed and upstream HUC IDs. Source polygons and explicitly buffered geometric contexts retain their original relationship descriptions. Receptor rows may overlap. Each original family union counts its selected land once.

**NRCS programme context.** Rows keep the HUC and state together with fiscal edition, priority status, source-water system and resource concern. Ground, Surface and Both retain their publisher meanings. Missing source rows, a HUC outside the selected context domain, and an explicit “Not Selected” status remain distinct. State acreage is `st_ac`; whole-HUC acreage `huc12_ac` repeats on cross-state rows.

**Classified waters.** The report preserves current/proposed status separately from the publisher’s provisional/final data status. HUC intersection is geographic membership. Exact native feature identifiers provide a separate receptor association. A layer/OBJECTID match retains both source editions; the receiving-water plan supplies the quantity geometry. Family unions collect these associations from all member receptors, deduplicate shared feature/region/edition rows and retain every member receptor’s source reference. Coextensive legal links, partial links and candidate legal links retain the original crosswalk’s precision and reach descriptions. Publisher HUC attributes supply source context; the geographic crosswalk supplies the retained spatial membership.

**Regional measures.** Coverage tables preserve each original region, class scope and geometry type. Their unique geometry measures are already dissolved within that selected scope. Reporting regions, the loaded HUC union, individual HUCs and individual classes can overlap; each remains a separate measure. Touch-only intersections remain zero-measure source rows.

## Outputs

Each saved report lives under `decision-contexts/<report-id>/` in the original workspace:

| File | Content |
| --- | --- |
| `decision.json` | Saved identity, source bindings, report tables and file registry |
| `report/index.html` | Readable report with physical quantities, programme context and regional classification measures |
| `report/context.json` | Complete composed context, source references and original run/scenario/profile selections |
| `report/physical-quantities.csv` | Own-support and paired-support sums, changes, units and coverage |
| `report/huc-context.csv` | Declared contributing HUCs and source coverage states |
| `report/nrcs-state-huc-context.csv` | Original NRCS rows with receiving-water associations |
| `report/classified-water-associations.csv` | Complete retained geographic and native-feature association rows |
| `report/classified-water-coverage.csv` | Original HUC/class/edition coverage measures for each receiving-water context |
| `report/regional-classified-water-coverage.csv` | Original reporting-region and loaded-domain measures |
| `report/inputs/` | Original plan, analysis and selected context source documents |
| `decision-context.zip` | Portable report and source-context package |

The HTML displays the first 200 detailed classified associations. The browser paginates the complete association table, and the CSV contains all rows.

Saving the same original selection reuses the completed report. Interrupted report construction retains its original preparation time and immutable files so it can continue with the same identity. Workspace backup and restore carry the report directory and saved delivery links; the extension participates in the original restore verification.

## Python and operator API

```python
from model.workspace import Workspace
from model.decision_context import DecisionContexts

ws = Workspace("/path/to/original-workspace")
manager = DecisionContexts(ws)
report = manager.build({
    "title": "Reviewed regional receiving-water alternatives",
    "analysis_id": existing_analysis_id,
    "water_context": {
        "source_collection_id": imported_water_collection_id,
        "source_id": imported_water_context_source_id,
    },
    "crosswalk": {
        "source_collection_id": imported_crosswalk_collection_id,
        "source_id": "classified-water-crosswalk",
    },
    "statuses": ["current"],
})
reopened = manager.inspect(report["id"])
compatible = manager.compatible_deliveries(report["id"])
if compatible:
    link = manager.link_delivery(report["id"], compatible[0]["id"])
```

Use `plan_id` in place of `analysis_id` to make a source-plan report. At least one context source is required.

The installed extension descriptor binds these operations to the original operator:

| Interface | Purpose |
| --- | --- |
| `GET /api/decision-context/catalog?workspace=…` | Available saved plans, analyses, exact context sources and reports |
| `GET /api/decision-context/detail?workspace=…&decision_id=…` | Saved report, original file tickets and compatible map deliveries |
| Item kind `decision_contexts` | Original item endpoint integration |
| Action `decision.context.build` with `{selection: …}` | Save the composed report through the existing task queue |
| Action `decision.context.delivery` with `{decision_id, delivery_id}` | Save the original report/map package association |

The existing operator provides workspace authorization, operation identities, its task queue and authenticated file tickets. Install the delivered files under the original application root and restart the operator to load the new descriptor.

## Focused integration journey

Use an original workspace that already retains a complete receiving-water analysis and an imported context source. Open the catalog, save a report from those exact records, reopen it, download the report package and link a compatible original map delivery. Repeating the same report selection returns the same report identity. The source and file references remain resolvable after the workspace’s normal backup/restore flow.


Run the retained-source journey directly from the installed application:

```bash
python operator/check_decision_context_receiving.py \
  --workspace /path/to/original-workspace \
  --analysis EXISTING_RECEIVING_WATER_ANALYSIS_ID
```

The command saves and reopens the report, checks reuse, compares exported quantities to the selected original analysis, and verifies the source bytes inside the portable ZIP. It uses the newest imported context editions by default; `--water-context COLLECTION_ID/SOURCE_ID` and `--crosswalk COLLECTION_ID/SOURCE_ID` select exact editions. `--delivery EXISTING_DELIVERY_ID --require-delivery` includes a specific completed map release in the same journey. `--plan EXISTING_PLAN_ID` runs the source-plan path. Its JSON output records the exact selections and generated report path.

Relevant producer contracts are `model/receiving_waters.py`, `model/workspace.py`, `model/delivery.py`, `operator/extension_registry.py`, `source_tools/water_context_cli.mjs`, and `source_tools/high_quality_water_crosswalk.py`.

Scientific source references:

- [Upper Savannah mapping RFP](https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf)
- [SCDES classified-water GIS](https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2)
- [South Carolina classified-water regulation R.61-69](https://des.sc.gov/sites/des/files/Library/Regulations/R.61-69.pdf)
