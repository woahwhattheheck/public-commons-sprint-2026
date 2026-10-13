# Upper Savannah: actual geography and explicitly simulated native inputs

This component adds a geographic edition to the existing Upper Savannah application. It imports the original watershed, reporting-basin and utility sources; generates declared simulated physical inputs on a 30 m grid; prepares the native baseline, corridor restoration and matched control; and uses the existing NDR/SDR parameter course, reports, customer review and portable Workspace.

The original completed 120 × 120 square demonstration remains a separate scientific source edition. Its twelve selections and reports keep their original identities.

Current owner direction is [CURRENT_OWNER_DIRECTION.md](../../CURRENT_OWNER_DIRECTION.md), version 2026-10-13.3, published at e7325cdf95becf30d7507bbf6b4c230193bbb897. The useful presentation is the connected production workflow: choose actual geography and declared assumptions, calculate with the original model, inspect differences on explicit support, revise parameters, and hand over editable sources and results. Tim retains scientific direction, method choices, review and the client relationship.

## Original geographic sources

The first receiving case uses all four original RFP anchors: 030601010703, 030601010704, 030601020502 and 030601020507. The complete original reverse-ToHUC closure is retained. It keeps the ARJWS and Pioneer footprint features and intake points individually, alongside union masks used for reporting; no geometry is moved to manufacture containment.

The smaller ARJWS named selection uses the original Six and Twenty anchors, HUC12 030601010703 and 030601010704. Reverse traversal of the retained WBD ToHUC graph gives the complete four-HUC computational domain:

- 030601010701 — Upper Three and Twenty Creek;
- 030601010702 — Lower Three and Twenty Creek;
- 030601010703 — Upper Six and Twenty Creek;
- 030601010704 — Lower Six and Twenty Creek.

The reporting area is the union of the selected reporting HUCs intersected with the original South Carolina Upper Savannah planning basin. It differs from the larger computational domain. The published ARJWS protection polygons, OBJECTID 11 and 12 / INTAKE S04101, remain separate original source footprints; their union is intersected with the reporting area only for the selected utility map overlay. The original full polygons are also retained.

The Pioneer named selection uses anchors 030601020502 and 030601020507 and its complete original 32-HUC upstream closure. It retains the published Pioneer protection polygons, OBJECTID 131 and 132 / INTAKE S37109. These polygons and the original intake coordinates represent different objects. Original source inspection places the Pioneer intake outside both published polygons; no point is snapped, moved or buffered to manufacture containment.

Any explicit selection of actual reporting HUCs can use the same model. It always computes that selection's upstream closure in the retained original network and requires the corresponding original polygons. It does not silently truncate the domain or increase cell size.

| Source | Actual retained identity |
| --- | --- |
| Complete original 217 HUC12 polygons | Decoded 11,220,042 bytes; SHA256 2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af; native EPSG:3857 |
| Original 303-record WBD topology | source/receptor-topology/20261013/usgs-wbd-savannah-original-topology-20261013.json; SHA256 2e57f86d1725526f00f16870b1b03d9168b41ea94de6d0016b20dfe15e89bcac |
| SC reporting basin | PlanningBasins2023, Basin == "Upper Savannah", one-based original record 5; EPSG:26917; SHP SHA256 133bc5369bd0d68bfdb53c61e3df24f9445f799b0d68b301f321d2c49d71eab6 |
| Original reporting source commit | https://github.com/capellett/scsf/tree/45f7ea3ca968c96e2fc6188d7f55c3b0ce60da95/data-raw/planning_basins2023 |
| Published utility protection polygons | Four original features; 2,389,556 bytes; SHA256 ddac0feb1c704ca5e95336e21961e08beede1f83b6b820423dffa5a63bd8e285; EPSG:26917 |
| Actual utility publisher | https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer/2 |

Use the existing HW13 original-geography package, 30,969,130 bytes / SHA256 64b39d2ed7c58f071c512f1ce23966f0813ebab85c8b27519137607a246604c1. Its receiver imported and opened eight actual sources and recorded source collection b6fc9a4c834765ef706cc3d3a71f9e595269a7bc52942deb4f316ee405af80bb. The three supplied selection files bind this exact imported collection. The package is available through the existing receiving route as file_0000000021b0820ebe9936c70c8beb0e / libfile_989d8d8847c88191a639f59d1366aa2d. Its original receive_original_geography.py --application APP --workspace OWNED_WS reconstructs the normal source edition.

Original shapefile SHP, SHX, DBF, PRJ and metadata travel together through Workspace.source_file. Esri polygons use the maintained Receiving Waters original reader (OriginalEsriFeatures), retaining native IDs, original feature order, ring operations and reader hashes. No alternate polygon repair is introduced here. Both full original sources and selected/projection/union/intersection provenance remain in the ordinary imported source collection.

## What is simulated

The actual polygons determine the computational domain, reporting intersection and utility focus. Terrain, land-cover classes, rainfall proxy, rainfall erosivity, soil erodibility, source loading/retention coefficients and the planting corridor are explicitly simulated. They are not field observations or an extracted regional DEM/NLCD edition.

The deterministic seed defaults to 20261013. Input formulae are retained as complete source. The simulated terrain uses metre-scale periodic valleys, with a southward longitudinal grade of 0.002, nominal 80 m lateral relief varying by 20%, 1,800 m valley spacing and 600 m exponential lateral decay. The valley meander is 12 cells over a 24 km wavelength; relief varies over 12 km. These are declared physical assumptions, not measured elevation. They retain meaningful terrain variation when the domain is large. Each selected HUC’s actual SC intersection receives a hypothetical corridor on the corresponding periodic valley nearest its representative point; the corridor is clipped to that catchment intersection. Individual assumed corridors and their HUC IDs are retained. The preserved corridor_width_m option is the line-buffer distance on each side: 90 m produces a nominal 180 m full corridor before clipping. Native streams are calculated by InVEST from the assumed terrain and threshold. The corridor is a planting hypothesis, not a surveyed stream or proof that actual regional drainage follows the assumed terrain.

Simulated land cover uses deterministic kilometre-scale 3.6/2.7/6 km spatial waves with the retained seed, so increasing geographic extent does not stretch one small-grid pattern across the region. Physical fields are generated in 256 × 256 raster windows using global pixel coordinates. No domain-sized Python float lists or physical-input arrays are allocated. The grid is EPSG:26917, exact 30 m cells anchored on integer 30 m coordinates; model-domain NoData remains explicit. Geometry size remains proportional to the original source. Existing native model memory/disk requirements are separate from input generation.

The table retains the same explicit demonstration coefficients as the original square edition:

| Original class | N loading kg/ha/year | P loading kg/ha/year | N/P maximum retention | USLE C |
| --- | ---: | ---: | ---: | ---: |
| 21 | 8 | 0.90 | 0.05 | 0.050 |
| 41 | 2 | 0.12 | 0.80 | 0.003 |
| 81 | 10 | 0.70 | 0.35 | 0.025 |
| 82 | 22 | 1.80 | 0.15 | 0.180 |

All USLE support factors are one. Nutrient critical lengths are 100 m; assumed subsurface nitrogen proportion is zero. The native measured-runoff enum describes the coefficient interpretation, while the numerical values remain simulated. Native NDR applies its precipitation proxy/mean scaling once.

The base profile uses MFD, 100 contributing cells (9 ha at 30 m), NDR k=2, subsurface length 150 m and efficiency 0.5; SDR k=2, maximum SDR 0.8, IC0=0.5 and dimensionless Lmax=122. The existing routing-lmax-v1 course adds linked MFD/D8 routing and Lmax 122/333, producing four unique profiles across three landscapes. Lmax affects SDR; it does not change NDR. Original stage reuse remains owned by the native engine.

## Restoration and matched control

Restoration converts assumed pasture 81 and crop 82 to forest 41 within the full declared corridor and reporting mask. The maintained regional_matched_control.py producer constructs the off-corridor control on identical raster geometry.

The complete geographic_matched_control.py adapter receives six explicit paths: baseline NLCD, actual restored NLCD, full corridor mask, reporting mask, precipitation raster and an owned output directory. RESTORED_NLCD is categorical land cover, with only the actual agricultural restoration cells changed to 41; the binary RESTORATION_MASK remains the ordinary native scenario mask.

The adapter derives its MODEL_DOMAIN_MASK from every valid baseline NLCD cell, retaining the complete upstream computational support. It supplies actual RESTORED_NLCD and REPORTING_MASK separately. The original engine verifies the 81/82→41 changes inside reporting support, and excludes both the whole corridor and every restored cell from the control. No reporting-area mask is substituted for the computational domain.

Native NDR retains its original whole-input precipitation normalization. Local target/control rainfall means and residuals remain explicit by original class. Equal local matching does not imply equality of every physical factor.

Both alternatives have identical changed-cell counts and hectares within each original class, including zero targets for an individual class where applicable. The overall changed count must be positive. The original method uses increasing target rainfall followed by nearest available same-class rainfall; exact residuals and matched pairs remain available. The method is deterministic local matching, not a claimed global optimum. Slope, erosivity, erodibility, connectivity, geometry and travel distance remain different. Interpret the alternatives through the actual native output and finite-cell support.

The complete original matching package, sources, pairs, summary, method source and receipts are retained with the geographic input edition. Both complete implementation modules and the exact optional method/owner documents retained by the original matcher are hashed into the geographic identity. Changing any such source creates a distinct prepared edition; the executed closure is checked again before publication.

## Install and prepare

Use a cumulative current application with the existing Workspace, Receiving Waters/OriginalEsriFeatures, original 303-record topology, native model, headwaters_parameter_course, ensemble study source, review and portable modules. Install this component's complete source files plus both maintained geographic_matched_control.py and regional_matched_control.py dependencies before preparation. The source manifest records exact member hashes.

Keep the accepted geographic Workspace isolated from the completed square-demo Workspace. Use ordinary disk for the native case, source inputs and control sort files.

After running the existing HW13 geographic source receiver into that Workspace:

~~~bash
"$PYTHON" -B "$APP/source_tools/receive_geographic_headwaters.py" \
  --workspace "$GEOGRAPHIC_WORKSPACE" --catalog

"$PYTHON" -B "$APP/source_tools/receive_geographic_headwaters.py" \
  --workspace "$GEOGRAPHIC_WORKSPACE" \
  --selection "$APP/source/geographic_headwaters_20261013/four-anchor-selection.json" \
  --preview

"$PYTHON" -B "$APP/source_tools/receive_geographic_headwaters.py" \
  --workspace "$GEOGRAPHIC_WORKSPACE" \
  --selection "$APP/source/geographic_headwaters_20261013/four-anchor-selection.json" \
  --output "$OWNED_OUTPUT" --prepare-only
~~~

Preview reads actual geometry and returns source identities, selected and upstream HUCs, projected vector areas, exact proposed lattice, physical-input classification and windowed generation method. It executes no native model. Preparation writes the actual inputs and ordinary saved grid/profile/scenarios/runs and prepares the original parameter course.

The catalogue is authoritative for an independently imported source edition. If a deliberately different original manifest yields a different collection ID, edit the selection using that actual catalogue. The optional intakes list holds actual point selectors; utility_features.gpkg and intake_features.gpkg preserve individual native IDs and complete original property JSON. geographic-binding.json retains actual point-to-footprint distances and containment without snapping. Keep exact typed source fields: HUC12 remains a string, OBJECTID remains an integer, and where is equality on original fields. A missing original source fails with an actionable source-selection error.

## Native calculation and connected handover

At the existing receiving owner's safe boundary, continue the same prepared geographic case:

~~~bash
"$PYTHON" -B "$APP/source_tools/receive_geographic_headwaters.py" \
  --workspace "$GEOGRAPHIC_WORKSPACE" \
  --selection "$APP/source/geographic_headwaters_20261013/four-anchor-selection.json" \
  --output "$OWNED_OUTPUT" --run
~~~

The original course prepares and executes all twelve selections through the maintained ensemble operation. Completed matching native stages are reused by the original engine. --report-only regenerates reports from available retained runs without requesting native execution.

The receiver then creates the original native-study scientific source, mapped delivery and customer-review request; exports the selected review generation; backs up the actual editable Workspace; and independently restores/reopens the completed ensemble, baseline, alternatives, source collections and review. It invokes portable.resume_restore for an existing receiving directory, retaining original registration and recovery semantics.

The output contains original-selection.json, admission.json, receiving.json, prepared.json, parameter-course.json, scientific-source.json, delivery-selection.json, mapped-delivery.json, the original customer-review export, the portable Workspace ZIP and its independent reopened application/Workspace. Actual elapsed times and completion timestamps are recorded per stage. Interrupted runs use the same input selection and output directory; primary errors survive receipt-write failures.

Receiving output must be outside both application and Workspace. Review responses produce distinct export generations and archive editions. The review request carries no invented scientific approval.

## Read the actual result

Report annual nitrogen/phosphorus mass in kg/year and sediment in metric tonnes/year **reaching streams**, with the selected reporting support. Per-pixel annual mass, vector hectares, pixel-centre hectares and full rectangular grid size are different quantities.

Use the original joint comparison across both alternatives for each profile, retaining the common finite-cell masks and actual excluded support. The original parameter course keeps differing support patterns in separate decision editions. Full-area mass changes across different support are not the same calculation as common-support effects. Parameter ranges are descriptive working-choice ranges, not confidence intervals.

The selected utility protection footprint is an explicit spatial focus. It is not an intake-delivery conversion, measured concentration or forecast. Source loading, river export and a drinking-water intake remain separate scientific concepts.

The demonstration should be operated in the actual existing application: open the saved source, inspect the upstream/reporting distinction, select baseline and alternatives, inspect the real differences and matched-control residuals, edit/review a parameter successor and open the export in the independently restored project. Keep the prime's scientific question and review authority visible throughout the production workshare.

## Interrupted input preparation

The producer retains a stable `.input-staging` directory under the immutable geographic edition. After all nine original physical rasters close, `physical-input-receipt.json` binds their exact hashes and complete generation summary to the actual selection, source geometry, software and runtime. A retry verifies and reuses those raster bytes and paths before continuing the maintained matching operation. A completed input receipt also permits recovery between input publication and its final directory rename.

Matching checkpoints remain available while preparation is incomplete. Once the complete input handover has been verified and renamed, the producer may retire only its own completed matcher `work` directory. The published control mask, pairs, method, source files and receipts stay retained in the input edition. Cleanup records its outcome and can be retried; a restored project does not clean a different machine’s recorded paths.

An already admitted process continues with its original source. Installing a producer or matcher successor creates a distinct identity for subsequent preparation. Reuse of an interrupted stage requires that exact original identity and source closure; a software change is never silently substituted into the saved scientific edition.

## Explicit exact precipitation matching

The original `four-anchor-selection.json` keeps its declared greedy control. To choose the maintained exact dyadic Monge method for a new prepared edition, use `four-anchor-exact-selection.json`. It adds the explicit `matching_method: exact_monge` and `max_working_bytes: 2147483648` fields while retaining the same original geographic selectors and physical assumptions. The complete matching source family must be installed together. `EXACT_MATCHING.md` explains the objective, numerical admission estimate, actual source-grid sizing and existing-host invocation.

Selections with neither matching option retain their original normalized shape. An explicit method may be `greedy` or `exact_monge`; an explicit budget is a positive integer and requires the method. There is no silent fallback to another method. Inspect the actual saved method, matched pairs and residuals when comparing the resulting scientific editions.
