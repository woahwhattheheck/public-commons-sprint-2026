# Native assessment coverage in client delivery

Open the completed station and watershed comparison, retain its original sources in the Workspace, and include its scientific interpretation in the existing ordered client delivery.

The package combines the completed original point/polygon calculation with the maintained assessment explorer. It preserves 159 station identities, 192 assessment records, the original 217-HUC calculation reference, five annual-reference catchments and eleven original annual targets. The existing native result supplies every geographic membership and boundary distance.

## Open and import

The complete generated edition is under:

```text
results/native-assessment-delivery-20261013/
```

Open `association/OPEN_ASSESSMENT_ASSOCIATIONS.html` for the interactive report. Use **Physical station coverage** to select the actual ARJWS/PRWD catchment or any of the five annual-reference basins. Inspect original coordinates, containing watersheds and boundary distances, select native stations across filters, and export source-bound native JSON/CSV. Each station opens its original assessment records in the existing explorer below.

The assessment explorer compares assessment and station publisher HUCs, source editions and programme associations and exports selected original records. The saved HTML retains both native-station and assessment-record review states. The printable report contains the full 159-station physical inventory, the 192-record assessment inventory and comparison tables.

Use the existing **Sources → Source reports** controls to preview and import the bundled `sources.json`. The manifest registers thirteen typed sources:

| Source group | Entries | Existing application use |
| --- | ---: | --- |
| Completed native geography and assessment joins | 4 | Spatial Review and original station/assessment lookup |
| Original station, coordinate-context and assessment editions | 7 | Native Station geography and original assessment context |
| Interactive native assessment report | 1 | Source reports preview, original details and selected-record export |
| Scientific interpretation recipe | 1 | Ordered Maps and delivery report selection |

The original seven-source station edition preserves the three primary native location sources, the separate optional 73-location coordinate context, its original assessment table and the two complete normalized assessment editions. Primary native locations still comprise 152 Atlas stations, five selected stations from the WQP eight-location source, and two from the additional WQP source.

For a portable transfer, import `native-assessment-delivery.zip` through the existing source-upload operation. It contains the root source manifest, all thirteen entries and their retained companion closure. The original application-relative source directories survive extraction, including native record pointers and the annual source README's relative links.

To import an extracted edition from the application root:

```bash
python -B -m model.cli --workspace /absolute/workspace source-import /absolute/native-assessment-delivery/sources.json
```

## Add the interpretation to a client deliverable

Open the imported interactive document in **Source reports**. Its linked scientific report is:

**Physical assessment coverage, utility selection and annual references**

Source ID:

```text
native-assessment-observed-bef411c2954fc3e7deb6
```

Select **Prepare scientific report** in the document’s scientific-sources section. The existing **Prepare a scientific report** composer opens with this source selected. Set **Report title (optional)**, use **Add a saved scientific study** and **Add study** for other relevant sources, and arrange them with **Earlier**, **Later** and **Remove**. Choose **Preview selected sources**, then **Prepare PDF, HTML and data**. An unchanged saved edition offers **Reopen existing report**.

Under **Saved scientific reports**, use **Open saved report** to inspect the result. Its existing actions include **Prepare complete report ZIP**, **Back up Workspace with this report** and **Use these studies in another report**. This provides the source-only client report directly from the original source collection.

For a combined scenario deliverable, choose the adjacent **Open Maps and delivery**, select this scientific source in the ordered list and use the actual saved baseline/scenario plus relevant study sources. The maintained consumer renders the same recipe’s narrative, tables and retained links into the existing HTML, Markdown, PDF and portable delivery outputs.

The earlier publisher-association report and whole-source coverage report remain separately available. Their denominators answer different source-selection questions. This native edition adds the completed geographic result to the same fixed published cohort of 192 records at 159 sites.

## Results to explain during review

All 159 original points fall within exactly one of the 217 original watershed polygons. All 152 reported station-publisher HUC12 assignments agree with the containing polygon; seven station sources report HUC8 without HUC12. The completed geometry supplies their physical HUC12 while the original reported attributes remain intact.

The 192 assessment-edition records comprise 186 matching and six differing publisher HUC12 assignments. The six differences belong to July 2026 records. RS-06190 also has a separate 2024 record that agrees with geometry.

| Utility selection basis | ARJWS stations / records | PRWD stations / records |
| --- | ---: | ---: |
| Original point/polygon membership | 6 / 10 | 18 / 22 |
| Station publisher HUC12 | 6 / 10 | 17 / 19 |
| Assessment publisher HUC12 | 6 / 10 | 17 / 21 |

The physical utility union contains 24 distinct stations and 32 records.

RS-21014 is physically within Little Beaverdam Creek, HUC12 030601020506, and PRWD's upstream selection. Its station source supplies HUC8 03060102; all three original 2024 assessment records publish the matching HUC12. The native point is 351.42 m from the containing watershed and utility outer boundary.

SV-809 is physically within Lower Tugaloo River, HUC12 030601020507, matching its station publisher. Its July 2026 E. coli record publishes 030601010305. Physical PRWD selection includes this retained record, with the original assessment attribution still displayed.

### Annual-reference coverage

| Original catchment | COMID | Selected stations | Assessment records | Annual targets |
| --- | --- | ---: | ---: | --- |
| Chattooga near Clayton | 6269342 | 1 | 1 | TN, TP, TSS |
| Broad near Bell | 6280111 | 0 | 0 | TP, TSS |
| Stevens Creek | 11730084 | 18 | 20 | TN, TP |
| Savannah at Jackson | 22724211 | 159 | 192 | TN, TP |
| Savannah at Cohens | 22726623 | 159 | 192 | TN, TP |

The three tributary catchments are mutually disjoint and wholly contained within both downstream basins. Jackson is itself contained in Cohens. Keep these relationships in the existing calibration and validation grouping; their overlapping assessment coverage must retain its selection basis.

Broad's zero concerns this selected South Carolina assessment cohort. Stevens Creek's selected assessments include bacterial and biological concerns, while its annual targets concern nutrients. Chattooga and Broad provide sediment targets, but those targets are not measurements of the Upper Three And Twenty Creek priority area.

Annual targets retain reference year 2012 and the source-global 1 October 1999–30 September 2014 horizon. The 2024 assessment edition covers 2018–2022; July 2026 TMDL status remains a separate edition. Annual TN/TP use original `ACTUAL` values in kg/year. Sediment uses `ACTUAL_MT` in metric tonnes/year. Original prediction fields remain distinct.

Use the existing **Annual load observations** desk and its maintained calibration actions for the target/catchment workflow. The report package preserves all five original basin bodies, original national target tables, component-selection metadata and source dictionaries beside the completed comparisons.

## Reproduce the complete report package

From a complete current application source:

```bash
node source_tools/native_assessment_delivery_cli.mjs \
  --application /absolute/current/application \
  --output /absolute/new/native-assessment-delivery
```

To import that completed package immediately into an existing Workspace:

```bash
node source_tools/native_assessment_delivery_cli.mjs \
  --application /absolute/current/application \
  --output /absolute/new/native-assessment-delivery \
  --workspace /absolute/workspace \
  --python python3
```

The output directory must be new. The CLI reads the completed native source manifest, the original seven-entry station manifest, the exact original assessment sources and the original annual source cohort. It reads the original three assessment inputs from `results/assessment-association-review-20261013/inputs/`, already retained by that report’s source manifest. It verifies all declared identities and native record pointers before writing the complete output. Optional Workspace import uses the original `model.cli source-import` operation.

Required maintained source files:

- `native_assessment_reviewer.mjs`: native station coverage filters, original source detail, selection exports and assessment-explorer handoff.
- `native_assessment_geography.mjs`: binds the completed native schema to original station/assessment identities.
- `native_assessment_delivery.mjs`: composes the scientific recipe, original source closure and thirteen-entry import.
- `assessment_association_report.mjs`, `assessment_association_reviewer.mjs` and `assessment_association_package.mjs`: existing report, interactive review and ZIP composition.
- `station_assessment_identity.mjs` and `archive_codec.mjs`: existing original-identity join and byte codec.

The ordinary association-report CLI also accepts the completed native context with its existing `--geography` argument. Its original no-geography workflow remains reproducible from the same source inputs.

## Source identities and geographic interpretation

The native context is `upstate.assessment-native-huc-context/v1`, retained at `source/annual-reference-assessment-20261013/assessment-native-huc-context.json`. Its exact completed output SHA256 is:

```text
bef411c2954fc3e7deb6419b1222b55c36733957700f23ff4d460b35b2b9e360
```

The binder checks original station source ID/body hash/native feature ID/CRS/coordinates and all 192 source-bound assessment tuples. The final composer resolves every original normalized-record pointer, preserves the original publisher table text and retains the original coordinate capture source entries. All five original annual basin identities and eleven copied target records remain attached to the completed result.

The native operation's `input_sha256` is retained under its original name and meaning. It is separate from the association report identity. The polygon archive, decoded polygon member, coordinate operations, native runtime and original source locators retain their source-specific identities in the completed native result.

The original native calculation used explicit always-XY coordinate transforms and exact covers predicates in EPSG:5070. PROJ operation accuracy describes the transformation; it is not a measured station-position or watershed-boundary error bound. The native result reports no geometry corrections, no snapping and no tested membership within the summed reported transformation accuracy of a boundary.

Displayed annual values use two decimal places and areas three. Original JSON and CSV members preserve full precision. The package contains the completed scientific result and all retained record/coordinate/annual sources used for review; the original equipped operation retains the 217-HUC polygon archive identified in that result.

## Original annual mass per whole-catchment hectare

The existing interactive report and ordinary scientific recipe now show all eleven source targets as both annual mass and whole-catchment annual yield. This view is available from the already completed source context before a native model finishes. It uses the same complete original basin polygons, not the selected South Carolina assessment area, a clipped regional grid or finite model-cell support.

For every source row:

~~~text
whole_catchment_area_ha = original selected_basin_area_km2 × 100
annual_reference_yield = original annual target / whole_catchment_area_ha
~~~

The source's original EPSG:5070 areas retain all reviewed selected components. A separately published gage drainage area is not substituted. Nitrogen/phosphorus use kg/year and kg/ha/year. Raw TSS uses metric_tonnes/year and metric_tonnes/ha/year. The original coefficient TSS_CONV remains in JSON/CSV as source context and is not applied. The separately prepared sediment-method conversion context remains a separately selected interpretation.

| Original reference | Nitrogen (kg/ha/year) | Phosphorus (kg/ha/year) | Raw TSS (metric tonnes/ha/year) |
|---|---:|---:|---:|
| Chattooga near Clayton, COMID 6269342 | 5.133816 | 1.824505 | 0.136715 |
| Broad near Bell, COMID 6280111 | — | 0.606269 | 0.384956 |
| Stevens Creek, COMID 11730084 | 0.950798 | 0.129823 | — |
| Savannah at Jackson, COMID 22724211 | 2.005501 | 0.313717 | — |
| Savannah at Cohens, COMID 22726623 | 1.791740 | 0.282939 | — |

A dash means that this retained source selection has no target for that constituent. The complete downloadable values are unrounded calculations from the exact published source rows. The producer verifies each original OBJECTID, COMID, full original attribute record and table SHA before composing the native delivery.

Reference year 2012 and the source-global 1999-10-01 through 2014-10-01 exclusive horizon remain attached to each CSV row. The release does not expose each station's sampling period or target standard error. Dividing by area does not make source periods contemporaneous, transform TSS into SSC, or make nested basin totals independent. The retained ten original overlaps/containment relations remain the authoritative geographic relationships. These values are whole-basin reference yields; they are not incremental yields, downstream-delivered yields or native predictions. See the [USGS explanation of SPARROW load and yield](https://water.usgs.gov/nawqa/sparrow/FAQs/faq.html).

The new files belong to the existing association document and source closure:

- association/annual-reference-yields.csv — eleven original-target rows, raw masses, whole areas, yields, units, period support and source/basin identities.
- association/annual-reference-yields.json — complete source attributes, original coefficient, denominator definition, original geographic operation and all ten relationships.
- association/annual-reference-relations.csv — the original ten pairwise overlap/containment records.

Open **Annual reference yields** in the existing interactive report, or select the same native scientific source in the ordinary report composer. The same grouped tables flow to HTML/PDF/Markdown, and the full original source archive retains every companion. The derived scientific presentation uses the annual-yields-v1 source suffix and v2-annual-yields recipe edition; original observations, catchment selections, completed comparisons and source bodies retain their original identities.

Once native calibration completes, the maintained catchment interpretation adds actual model yields, support status and calibration/held-out context through that existing workflow. This reference-only view does not change model selection, fit metrics, nominal ranks, validation groups or source admission.

## Reproduce the frozen microbial source edition from a current checkout

The optional seventeen-source delivery binds the original microbial presentation edition, including its original source manifest, compiler and observation explorer. Those three files have newer maintained editions at their ordinary source paths. The existing CLI therefore reads the exact retained bodies under `source/ecoli_utility_context/20261013/original-b91a8dd8/` using each descriptor's explicit `application_path`. The resulting archive still uses the original logical paths, original hashes and source IDs. Current microbial source files and their newer standalone reports remain intact.

This separation is required for reproducibility: the original b91a8dd8 manifest is 23,194 bytes/SHA256 ee6d5cc19e2a98b799db33df08026c6020a9a122f5cfb4ab83f1e415476dee23; compiler45,810 bytes/5b429341f794ee155cadda87b6262da3da2649ba31cf0e69c92b160b362dcfb5; explorer568,315 bytes/1fb6f51d95109b2a146f344175c27364573eb9529c748645d9df9505e78cca26. The source importer continues to validate those exact bytes. The retained companion subdirectory is producer input; open the assembled report's ordinary paths after extraction to use its working local links.

## Inspect the outgoing populated delivery

Owner instruction 2026-10-13.1 applies to this current producing/receiving course. Before readiness, the producing worker must open/run/render the exact outgoing version, LOOK at actual populated pixels or its real screenshots, and operate important controls. Check the actual screenshare and narrow widths where relevant; populated/empty/loading/error states; source and basin filters; the original station-detail handoff; all three new yield downloads; saved HTML and complete ZIP; PDF export; and reopening through the existing source/archive continuation. Capturing screenshots without viewing them, code or DOM checks, HTTP 200, unit checks or another worker's approval do not replace this inspection.

Inspect all eleven rows, source-period labels, long original station names, TSS unit labels, native station filters and measured-context views. Use the existing plain industrial style: readable tables, clear hierarchy, consistent typography/spacing, restrained controls and useful labels. Fix broken, cramped, clipped, overflowing or unreadable output in the maintained source, then view the exact corrected outgoing edition. Preserve original workflows, data and computations. Retain accessible rendered report pages/screenshots with the existing receiving output for source-owner review.

This is the same scientific-context operation, not a new model solve or inventory. Use focused checks, retain existing native task identities, and do not introduce broad suites, new watchers or forced restarts. The original sprint cutoff remains October 13, 2026 at 14:00 UTC.


## Complete standing owner instruction retained for this receiving course

# Owner-directed rendered-product inspection

Source: direct owner instruction of October 13, 2026. Repository copy version: `2026-10-13.1`.
Scope: owner-controlled work across providers, local and cloud runtimes, and current and future workers. Existing owner controls remain in force.

Before calling a client/prospect-facing app, website, dashboard, demo, report, presentation or export ready, the producing worker must open/run/render the exact outgoing version, LOOK at the rendered screen or its real screenshots, and operate the important user controls. Check the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Fix ugly, broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Code review, DOM counts, HTTP200, unit checks or another worker's approval do not replace seeing the actual product.

The Ecosystem product requires plain industrial design: readable tables, clear hierarchy, consistent typography/spacing, restrained controls, useful labels and responsive layouts. Keep the real workflows/data/computation. Reviews must lead directly to repairs and must not replace implementation/integration or become endless rechecking. The existing focused-validation policy remains; do not run broad suites or build a verification product.

Persist this instruction in the active owner-controlled instruction surfaces actually read by the relevant workers: global/project AGENTS/CLAUDE/GEMINI/rules, provider-specific boot instructions, source mirrors, cloud repository copies and current build/receiving guides. Include this instruction in every delegated child assignment, including assignments to another provider or runtime. Maintainers update their own consumed files and return exact paths, source/version and readback. A coordination acknowledgment alone is not propagation. Do not alter historical evidence or third-party/vendor policies. No forced restarts, new watchers or revival of owner-stopped work.

Inspect the actual completed scientific screens, reports, source pages and downloadable HTML in the real operator. Prior empty-Workspace screenshots are not completed-workspace acceptance. Preserve current engineering owners; other coordinators receive propagation rather than duplicate implementation. Continue native source/runtime/archive joins rather than diverting everyone to cosmetic review. This instruction does not extend or restart the Ecosystem sprint: the existing cutoff is October 13, 2026 at 10:00 a.m. America/Kentucky/Louisville, 14:00 UTC.

Source assembly and standalone application handoffs retain the application-level instruction copies with their current guides. This file records an owner-requested product delivery requirement; it does not change provider safeguards, repository access controls, or existing authorization boundaries.


<!-- bryce-rendered-product-inspection:begin -->
## Standing lab rule: inspect the rendered product before presenting it

Bryce's direct owner instruction, October 13, 2026. This applies to every current and future lab peer, provider, model, harness, local session, cloud session, and delegated or child worker.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation, or export ready, or putting it before a client/prospect, the responsible producing peer MUST open/run/render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare/presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading, and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes ALL attachments. Literally observe the actual thing the way a user or recipient would see and use it: open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, video/audio, archives and project attachments in their normal recipient-facing viewer or application; play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text, and a browser link do not substitute for opening the attachment and using the delivered result normally.

Fix ugly, cramped, broken, unstyled, clipped, overflowing, or unreadable results within the authorized task before presenting them. Favor simple industrial/plain presentation, consistent spacing and typography, readable tables, and working controls. Do not add decorative template slop. Source review, unit tests, HTTP 200, DOM counts, a reviewer/model approval, or an evidence form do not substitute for looking at and operating the real outgoing product.

This is focused internal product validation, never permission to build or submit a proof, test, or verification product, run broad suites, or repeatedly recheck an unchanged accepted version. Building and integrating the actual deliverable remains the main work; do not substitute endless reviews for delivery. Retain an exact-version visual receipt in the handoff: source/head or artifact hash, URL/file, viewport sizes, screenshots actually viewed, controls/states/export files exercised, fixes, and any precise unresolved gap. A changed outgoing version needs inspection of the affected result.

Bryce explicitly clarified: "that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it". A checklist, screenshot folder, receipt, passing test, or parallel review bureaucracy is not the requirement or a substitute for actual observation and normal use. Perform focused fixes and keep shipping the main work; create no review or approval gate.

Bryce also instructed: "also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them". For video/media narration, use available high-quality generative voice/TTS and applicable generative visual/media capabilities when helpful, with natural professional delivery instead of robotic default voices. Actually play/listen/watch the final exported attachment and inspect clarity, pronunciation, pacing, timing, and audio alignment. Reviewing a text script does not substitute for experiencing the final video/audio. This adds no paid-service purchase or real-person voice-cloning authorization; preserve lab attribution and third-party copyright/license controls.

Pass this rule to child/delegated workers and persist it in owner-controlled provider/project/cloud instruction copies. Record delivery and readback coverage; never claim every running session loaded it without evidence. This rule creates no hooks, watchers, restarts, approval queue, credential restrictions, or new publication authority. Preserve all existing owner rules, including no llama.cpp, no private GitHub repositories or Actions, focused validation, attribution, incident communication, personal meeting approval, contact holds, demo pauses, bounty restrictions, and owner cutoffs.

Canonical local policy: `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` and `.json`. Portable repository copy: `docs/policies/rendered-product-inspection-policy.md` and `.json` when present. Only Bryce can change this standing rule.
<!-- bryce-rendered-product-inspection:end -->



## Original five-basin annual-reference maps

The ordinary native-assessment delivery now includes the five exact original
NLDI reference-basin footprints beside the eleven published annual targets.
The complete report uses the original component review and preserves all 17,138
source polygon vertices. Its selected footprints contain 17,130 vertices:
Jackson uses component 0; Cohens uses components 0 and 1, including the small
local part. The two separately retained four-vertex Virginia triangles remain
original source components and are shown only in the explicit component-review
view. The original response bodies remain unchanged.

The existing command is unchanged. Rebuild the same delivery through
`native_assessment_delivery_cli.mjs --microbial` with its already-retained
source directories. The existing ten-file source successor now also requires
`annual_reference_maps.mjs`, maintained
`observed_flow_map.mjs`, and its original
`source/hydrology-huc05-07-20261013/nldi/geographic_support.mjs` dependency;
the existing assessment-source-delivery component declares the whole closure.

The map uses the maintained full-geometry renderer. Its display-only projection
is spherical Web Mercator, EPSG:3857:
x = R × longitude in radians,
y = R × ln(tan(π/4 + latitude/2)),
R = 6,378,137 metres.
The original geographic source is WGS84 longitude/latitude. Every coordinate
is transformed for display without simplification, snapping, clipping, union
or geometry repair. The formula follows the
[PROJ primary definition](https://proj.org/en/stable/operations/projections/webmerc.html).
These display grid coordinates and distances do not replace original basin
areas or assert corrected ground distances. The original EPSG:5070 whole-basin
areas remain the annual-yield denominators.

### Human use and source meaning

Open `association/OPEN_ASSESSMENT_ASSOCIATIONS.html` and select Annual
basin map. The map, basin dropdown and physical-coverage basin filter share the
same selected COMID. Fit selected basin changes only the view. Show retained
excluded original components adds outline-only source components; it does not
add their areas, stations or loads to the selected annual references. A source
reach's first original vertex anchors its map label; it is not an estimated
station coordinate or inferred outlet.

The three tributaries are mutually disjoint within both downstream Savannah
basins; Jackson is nested in Cohens. The ten original spatial relations are
retained. Do not add the whole-basin annual masses or source-normalized yields
as independent regional pieces, assign one station load to individual HUCs, or
call these incremental or downstream-delivered yields. TN, TP and raw TSS keep
their original source basis and periods. The separate regional sediment-method
sensitivity context remains separately selected.

The report writes these ordinary `association/` companions:

- `annual-reference-basin-map.json`: selected source geometries, areas,
  original source hashes, original component review and all ten relations.
- `annual-reference-original-components.geojson`: every original
  polygon component, including the reviewed exclusions.
- `annual-reference-selected-basins.geojson`: exactly the selected
  original components, with source identities and whole-basin area labels.
- `annual-reference-display-geometry.geojson`: explicitly derived
  EPSG:3857 display geometries; original source references remain attached.
- `annual-reference-basins.svg` and five
  `annual-reference-basin-COMID.svg` views.
- `annual-reference-original-components.svg` and two complete
  `annual-reference-*-figure.json` specifications.

The existing scientific recipe uses the maintained projected-map SVG/PDF
renderer with those exact derived display geometries. It adds the selected
five-basin overview and the separately labeled source-component appendix.
Every new file is retained by the same source-entry companions and complete
ZIP. The derived report edition advances; original source IDs, targets,
yield values, area denominators and native model results remain intact.

### Complete the same receiving operation

Continue the existing ES9960 annual5154 operation on its currently accepted
C5AE course (former unstarted0730 annual7303/9808). Reuse its original project,
source collection and retained files. Open the exact populated outgoing HTML,
each SVG/GeoJSON/JSON/CSV download, the complete archive's extracted files and
the ordinary scientific PDF. View all relevant basin-map and component-review
pages. Exercise dropdown, polygon and table selection; native basin filter;
fit/reset and excluded components; keyboard activation; normal/narrow layout;
SVG download; saved-HTML reopening; PDF export; and independent archive reopen.
Use the full current owner rule above: capturing screenshots or reading source
does not replace viewing and using the exact outgoing product. Return the
actual viewed pixels and the first concrete product defect to the original
source course for repair.
