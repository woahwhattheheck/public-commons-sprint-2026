# Four-watershed Community production

This workflow adds editable Community plans and original-source GIS to an existing scientific Workspace. It consumes the retained `community-complete-receiving-20261013.zip` package rather than fetching a replacement table or running another ecological simulation.

## Produce in the actual application

Run these commands from the complete application, using its GIS Python environment. Select the existing scientific workspace and exact original input package.

```sh
python -B source_tools/community_report_layout.py --application .
python -B source_tools/community_production.py --package ORIGINAL_COMMUNITY_ZIP --workspace WORKSPACE --output PRODUCTION_DIRECTORY
python -B source_tools/community_gis.py --workspace WORKSPACE --production PRODUCTION_DIRECTORY/community-production.json --output GIS_DIRECTORY
```

The first command composes readable scrolling tables into the current report renderer. It preserves concurrent scientific/revision code, saves the original source and adds a namespaced layout revision to new report identities. An unfamiliar renderer is left unchanged for a direct source join.

The production command retains all original package members, the original RFP table and original four-HUC geometry source. It saves four watershed plans, two utility programmes, a combined programme and a source-derived receiving copy of the original revised Lower Six and Twenty Creek plan. The original donor records remain unchanged as source; receiving plans have their own native identities. Each production plan has original-source reports in HTML, CSV, JSON and ZIP. Sixteen proposed work items cover source reconciliation, spatial screening, reconnaissance/access preparation and editable GIS handback. Individual assignments and costs remain editable inputs.

The GIS command uses the application's original Esri polygon parser. It preserves the native EPSG:3857 coordinates in a GeoPackage, exports a separately transformed EPSG:4326 GeoJSON and computes WGS84 geodesic area/perimeter. Published WBD area and computed area remain separate. Complete source attributes, original object IDs, HUC12 routing and source identities accompany the output. It saves the working GIS as a retained source collection in the same Workspace.

## Open, revise and deliver

Run `python -B source_tools/open_received_study.py --workspace WORKSPACE` on the machine whose browser will open the application. Use **Communities** for the saved plans and reports, **Sources** for the original input and Community GIS, and the original task/export workflow for continued production. The local session address is printed by the maintained operator.

A plan can also receive an edited native interventions CSV through the existing command:

```sh
python -B -m model.community_cli --workspace WORKSPACE plan-revise-csv ACTUAL_PLAN_ID edited-interventions.csv
```

Use the returned plan ID to build its report. This preserves the immutable earlier plan and the complete received CSV. Obtain actual IDs from `community-production.json` or the existing Community overview; never substitute labels for identifiers.

For an editable QGIS project, pass the returned GIS source collection and `COMMUNITY_WATERSHED_GIS` to the existing `model.gis_project_cli workspace-export` selection. Select layer `community_watersheds`, `visible: true`, `purpose: context` and the intended project CRS. The native export supplies its complete ZIP, `OPEN_GIS.html`, `project.qgz`, data, sources and portable tools. Keep the entire directory together.

## Data interpretation

The original table contains 17 whole census block groups, 27,448 people and 11,001 households. Per-watershed and per-utility counts follow the RFP's memberships. These are not clipped watershed populations, utility service populations or estimates of pollutant exposure. Whole-block-group counts are never prorated by polygon area. Proposed task priority is an editable work-planning choice, not a scientific risk ranking. The source-derived counterpart preserves the original revised intervention content and records its donor identity in retained source provenance.

## Operator delivery record

The producing cloud operation used the original 7E42 application/Workspace and completed the native source, planning, report and GIS exports. Eight outgoing report editions were rendered at desktop and narrow width; unreadable letter-stacked tables were repaired through the scoped layout composer. Native service startup succeeded. This container's Chromium policy rejected HTTP navigation to localhost, so a browser-connected operator opening belongs to the equipped receiving host. Offline report and GIS controls are separate from that operator opening.

Current development directions are the original case's owner instructions and `CURRENT_OWNER_DIRECTION.md` version 2026-10-13.4 with Bryce's later post-call expansion. Inspect and operate actual outgoing files; preserve completed native runs and active operations; use focused checks only. Internal delivery belongs in the original Slack case. Every individual warm-lead message requires Bryce's explicit approval.
