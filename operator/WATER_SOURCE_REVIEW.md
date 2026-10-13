# Complete legal-water source review in the existing operator

This extension opens every row in an imported classified-water legal register, shows the original reach description and edition, and connects supplied native geometry associations to exact source attributes and measured geographic intersections. The current R.61-69 selected register contains 105 rows, 86 literal waterbody names and 66 priority-class rows. All rows participate in search, filters and exports; pagination changes only the rendered page.

## Install

Copy these additive files under the existing opportunities/upstate_forever_2026 application:

- operator/water_source_review.py
- operator/extensions/water_source_review.json
- operator/web/extensions/water_source_review.mjs
- operator/web/extensions/water_source_review.css
- operator/WATER_SOURCE_REVIEW.md

Use the shared extension installer and restart the original operator:

    /opt/pyvenv/bin/python install_extensions.py --application CURRENT_APP --source-root RECEIVED_PROJECT_ROOT

The descriptor follows the actual upstate.operator-extension/v1 registry from public commit f293e68f7f490346280419ae447748ef95ec76a3. The browser joins the existing navigation after Sources. There is one Python provider, four read routes and two browser assets. It uses the existing crosswalk's feature_properties/source_labels functions for native class and county interpretation; its original-source reads use the Python standard library. The original operator supplies workspace selection, authentication and verified download tickets. Source review has no task action or repeated global state hook.

## Import the actual retained sources

The existing Workspace.import_sources accepts a local upstate.sources/v1 manifest and retains its original bodies and companions. Import the complete R.61-69 registry manifest supplied by intake and the completed native crosswalk's sources.json into the operator's actual workspace.

Install the current crosswalk companion source module alongside this extension; it provides the shared native class parser without performing a new geographic run during review.

The standalone current registry source ID is sc-r61-69-current-reach-registry, with body r61-69-current.selected-reaches.json. A native crosswalk also embeds the complete legal records it used in legal_associations.json. The desk supports either origin and displays its exact source collection and body hash. Legal bodies with source_schema upstate.classified-water-registry/v1 or names ending .selected-reaches.json are discoverable.

For geographic review, import the current source_tools/high_quality_water_crosswalk.py v1.1.0 output (earlier v1.0.2 output remains readable). Source ID classified-water-crosswalk has crosswalk.json plus native_features.csv, legal_associations.json and provenance.json companions. The same source collection retains <capture-layer-id>-native and classified-water-geographic-maps for downstream feature selection and maps. The native importer preserves actual field names and types; source_feature_refs use the actual typed native OID, not a publisher alias.

Source components in this project:

- Capture/adoption: source_tools/high_quality_waters.py.
- Exact active field binding: source/high_quality_waters/scdes-current.native-field-binding.json.
- Complete selected legal registry: source/high_quality_waters/r61-69-current.selected-reaches.json and its source manifest.
- Complete current regulation: https://des.sc.gov/sites/des/files/Library/Regulations/R.61-69.pdf .
- Geographic producer: source_tools/high_quality_water_crosswalk.py v1.1.0 and HIGH_QUALITY_WATER_CROSSWALK.md.
- Native metadata, geometry, attributes and original request records: the retained capture.json source edition produced or adopted by high_quality_waters.py.

The active source is https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2 with capture layer scdes-classified-75805b84d89a256d. Its true typed OID is OBJECTID. The alias OBJECTID_1 and the separate nullable OBJECTID_1 field are retained as different metadata. The captured 1,886-feature selection contains ORW, TN and TPGT across publisher HUC prefixes 03060101, 03060102 and 03060103. Its full query and publisher data status stay attached to the source edition.

## Operator workflow

Choose the legal registry edition and optionally a native crosswalk edition. The complete register remains usable while geographic processing or import is in progress. Search all names and legal reach descriptions, original record IDs, counties, native feature identities and positive associated HUC12s. Class, county, edition, priority, relationship and HUC filters compose; changing the page does not change the export cohort.

Selecting a legal row opens its entire original description, raw and previous class, no-discharge-zone and site-specific flags, exact PDF page and source line interval. Repeated names and reservoir aliases keep separate original record IDs. Class groups in the current selected source are ORW(FW) 27, ORW(TPGT) 4, TN 23, TPGT 12 and FW 39. Four NDZ rows include two legal aliases for the same reservoir; the interface calls these counts rows or literal names.

Native associations retain coextensive, partial and candidate relationships from the crosswalk. The viewer creates no new associations and performs no reach-law propagation. A candidate may share exact name, class and county while covering a different portion of the river. Source-native classification, publisher data status and current/proposed legal status are all visible. A selected registry revision differing from the crosswalk's embedded record retains a visible revision comparison.

Selecting a native feature reads every original attribute, actual typed OID and native field alias/type. It shows every retained reporting/HUC/domain intersection, including boundary-only touches. Length uses metres; polygon area uses hectares; measurements are in EPSG:26917. Positive HUC filters require counted=true plus a finite positive geometric measure.

The active publisher's HYDTYPE values include STREAM, separate left and right banks, shorelines, dams, closures and other linework. Length refers to classified source linework of the stated publisher type. The geographic summary presents both feature sums and dissolved unique measures by independent region/class/dimension. Its rows remain independent, including overlapping HUC and union regions.

Download original regulation and crosswalk sources through the operator's existing verified tickets. Export matching legal rows as JSON with complete original record context, source hashes, filters and selection identities, or CSV for a worksheet. JSON carries original nested values. CSV preserves nested arrays/objects as JSON text and prefixes spreadsheet formula-leading cells with an apostrophe. The feature-context export carries complete source_feature_refs, map source identities and actual intersection rows for the connected designation/applicability desks.

## Exact endpoints

All GET routes run through the original authenticated operator and require its current workspace parameter.

- /api/water-source-review/catalog returns registries and crosswalk source descriptors. It reads retained collection metadata rather than every source feature.
- /api/water-source-review/review takes registry_collection and registry_source; crosswalk_collection and crosswalk_source are optional together. It returns upstate.water-source-review/v1 with every legal row, complete editions, native association summaries, source coverage and original downloads.
- /api/water-source-review/feature takes crosswalk_collection, crosswalk_source and feature_id. It returns upstate.water-source-feature-review/v1 with original attributes, field schema, typed identifiers, full intersections and legal associations.

The provider calls Workspace.source_file before cached JSON/CSV reads, preserving existing source-content verification. The cache is bounded and keyed by the verified content hash. The browser refreshes source metadata only when the imported source identities change or the operator requests Refresh; task polling alone does not reload the register. Stale requests are aborted on source/workspace changes and detach.

## Shared designation and applicability desks

The source review controller is registered as water-source-review and exposes:

    openRecord({
        workspace_key,                  // optional current-workspace check
        registry_collection,
        registry_source,
        record_id,
        edition_id,                     // optional
        crosswalk_collection,           // optional paired source
        crosswalk_source
    })

A designation desk can open an exact legal record through the shared host's openExtension function. Navigation uses the existing host.navigate capability when supplied. If an inactive desk opens before navigation, the pending original record selection survives its mount.

Saved native feature selections belong to the shared designation desk. Source review exposes getSelectionContext() for its currently inspected native feature. The returned canonical context includes source_feature_refs, source_collection_id/collection_id, source_id, regulatory_record_ids, positive_huc12, the full parsed_class, exact per-feature legal_associations, map_sources and full legal_record_context. The original OID retains its JSON type.

The confirmed receiving controller is water-designations.openSelection. Source review connects to that target by default. The shared host loads the installed receiver when Open in designation desk is selected:

    await host.openExtension('water-designations', 'openSelection', {
        collection_id,
        source_id,
        layer,
        id_field,                       // exact metadata-declared original name
        native_oid_field,
        class_field,
        expected_source_sha256,
        source_feature_refs: [
            {feature_id: 218303, collection_id, source_id}
        ],
        native_source_feature_refs: [
            {source_id, layer_id: null, field: 'OBJECTID', value: 218303}
        ],
        legal_record_context,
        legal_associations,
        source_legal_reference,
        rule_reference,
        rule_edition
    });

The exported designationSelection(context) function translates canonical field/value references to the receiver's native scalar feature_id without coercing the value. It preserves canonical references under native_source_feature_refs and adds feature_ids/selection_mode for the receiving form. The target legal_record_context is a structured object with schema upstate.water-source-legal-context/v1, records, associations, the nested original rule_reference, rule_edition, source_legal_reference, source_binding, canonical source_feature_refs, positive_huc12, optional selection_scope and concise notes. The current receiver reads rule_reference from this nested object. The canonical getSelectionContext contract retains its full record array; the target adapter performs the wrapper conversion. getDesignationSelection() returns that exact target payload; getSelectionContext() retains the original canonical contract. The optional host.onWaterSourceSelection callback continues receiving the canonical contract. A differently named installed receiver can still be set through setSelectionTarget({extension_id,method}); other targets receive canonical context.

The original rule reference comes from the explicit source mapping's legal_reference.edition_id and the complete matching retained legal edition. Its title, uri, edition and optional section match the receiving backend's accepted fields. Complete source_legal_reference and rule_edition remain alongside it. Reach associations retain coextensive/partial/candidate as provided. A source-edition reference supplies the reference material for the saved selection; it does not assert that a named legal reach covers the entire selected geometry. If no single matching explicit edition is retained, rule_reference remains null and the receiver can select its actual reference.

For the active SCHydroClass/2 edition, the explicit id_field and native_oid_field are OBJECTID; OBJECTID_1 remains the separate nullable integer property. The original metadata declares esriFieldTypeOID for OBJECTID. The ESRIJSON/GDAL reader retains that property and the feature FID, and Fiona exposes native property names rather than publisher aliases. The current native source entries declare the metadata-derived field and role WATER_CLASSIFICATION so the receiving desk does not fall through to its name-based default. The distinct Water_Classifications/0 edition retains its own original OBJECTID_1 identity.

The source review owns legal/source context; the designation desk owns selection inspection, saving, reopening, exporting and applying to delivery. ECSA's designation_crosswalk adapter owns receiving-water applicability and the source-to-delivery build. The current typed native feature, complete source edition and original legal context move between those existing desks.

## Focused execution evidence and receiver run

The browser module's syntax and pure filtering/export helpers were executed against the exact decoded 105-row legal source (SHA256 a55388d8edfceb587d7d37b5e9a20f43a1f44d37f6ecd70001806528bbc767f1). All 105 original IDs and full reach descriptions survive JSON and CSV export. The actual source filters return priority66, ORW31 and FW39; a literal Hartwell search returns10 complete source rows.

On the equipped operator, load the descriptor, call catalog and review against the imported sources, open one actual native feature and exercise the browser's source switch, full105 export and designation handoff. Use the active native crosswalk's actual IDs. The adapter's original source errors remain visible if a companion is missing or a different edition was selected. Native receiver results and browser integration belong in the existing original Sales thread with the installed commit/source-bank and workspace collection IDs.

## Version 1.1.0: complete source attribute inventory

Import intake's upstate.sources/v1 inventory manifest from high_quality_water_inventory_cli.mjs. The source entry scdes-classified-streams-upper-savannah-20261012-attribute-inventory (role HIGH_QUALITY_WATER_SOURCE_INVENTORY) retains the original profile and the complete 1,886-row feature-index CSV. Source review discovers imported profiles by this role or a body name ending .attribute-profile.json; each profile keeps its own source edition and hashes.

The complete imported upstate.classified-water-inventory/v1 profile is displayed alongside the legal register. It includes all 13 native HYDTYPE groups, native class counts, blank-name/county counts, all six literal-name/class/county comparison categories, and the 12 named comparison groups with original OBJECTID lists. Original legal-row links open the retained legal descriptions. The feature index remains a downloadable original companion. The JSON review export carries the full profile and source identities.

For the actual capture, 528 features share literal name/class/county, 148 share name/class with blank county, 22 share name/class with a different county, 26 share name with different class, 290 nonblank names are absent from the selected105-row register, and 872 names are blank. These diagnostics describe attributes of the full source selection; native geometry remains available across every category. The selected crosswalk's geographic measures retain their separate scope.

The retained scdes-schydroclass-20261012.attribute-profile.json source profile was decoded and hash verified: 18,616 bytes SHA256 da0cd89bc1f8c7c7d89a1a43f91d328c09af723765142162277afbe089716197. The reusable builder and Node CLI reproduce the full inventory from the retained native CSV, legal registry, mapping and capture-selection inputs. A CLI-generated profile includes all four original input references and can therefore have a different body hash from the precomputed profile; original input identity remains explicit.

## Version 1.2.0: native designation handoff and compact provenance

Crosswalk 1.1.0 stores one complete source metadata dictionary per retained layer in provenance.json. Its feature and geographic rows carry source_metadata_ref with the exact document, layer, member and canonical SHA256. The review provider resolves that reference in the already verified provenance, checks its canonical member hash and supplies the complete metadata on an inspected feature. Earlier rows with embedded source_metadata remain readable. Whole-dataset geographic tables and maps avoid serializing the 9,886-byte active dictionary once per feature and intersection.

The new native entry metadata carries id_field, native_oid_field, class_field and publisher classification_status. The original field_schema is also retained. These fields support the actual saved-designation selector while source raw attributes, legal status and publisher status remain separate.

The acquired 1,886-feature geometry scope covers 19 publisher HUC12s; all 19 were found in the exact current 217-HUC native domain. A separate official selected-class inventory observed on 2026-10-13 queried all 217 original HUC identifiers and matched every retained OBJECTID/H2OCLASS/HUC_12 triple. The remaining 92 domain HUC12s contain zero additional selected-class features. The original three-prefix geometry capture and its date/query remain unchanged; the full-domain comparison is imported as a separate source document. NRCS programme priority is an independent source attribute: all 19 HUCs in the initial classification capture have NRCS Not Selected, while the full domain has 15 high-priority HUCs. The source viewer does not use water class to infer NRCS priority or vice versa.

Primary implementation references for the native identity path:

- GDAL ESRIJSON reader: https://api.github.com/repos/OSGeo/gdal/git/blobs/3da1745f9d0b8767d0cdef86adac5677cab1fcd4
- Fiona typed properties: https://api.github.com/repos/Toblerity/Fiona/git/blobs/8ae7f799ee30add3861794f15b7b1f55af4d06c0

The linked Git objects retain the exact retrieved source bytes for ogr/ogrsf_frmts/geojson/ogresrijsonreader.cpp and fiona/ogrext.pyx. The active layer metadata supplies the original source binding.

## Version 1.3.0: complete captured-feature browsing and cohort delivery

Captured native features is an independent section of the same source-review desk. Choose Browse captured features to read every feature in each imported original Esri source. The catalogue covers unnamed, unassociated and geographically outside features as well as those with measured intersections. Its count describes the original captured feature objects. The geographic table remains a separate measured subset.

The native filters compose across source edition, original class, publisher HYDTYPE, named/blank waterbody, county/blank county, positive/boundary/outside geography, qualified legal association, positive WBD HUC12 and free-text search over original names and identifiers. Each record exposes the publisher HUC_12 separately from WBD HUC12 assigned by positive measured intersection. Pagination supports 25, 50, 100 or every matching feature. A feature opens its complete original attributes, source metadata, legal context and measured intersections in a separate native inspector, so an unrelated selected legal row does not become implied context.

The existing feature endpoint now obtains the original typed attributes directly from the retained native Esri body. It reuses the crosswalk's shared feature_properties function and reports geographic_status=positive, touch or outside. Outside features have an empty measured-intersection list and remain available for native inspection and selection.

The new GET /api/water-source-review/features route accepts the same crosswalk_collection/crosswalk_source parameters. Its schema is upstate.water-source-feature-catalog/v1 with compact records, actual source descriptors, complete qualified legal context, counts and original-source download tickets. Original source reads are verified through Workspace.source_file, and native lookup maps are bounded caches keyed by original content hash. The browser requests the complete catalogue on demand and aborts pending requests on source/workspace changes.

Export matching feature inventory and Export matching features as CSV include every filtered feature, independent of the visible page. The JSON export retains original source descriptors, canonical typed refs, selection filters and context. CSV quotes fields and neutralizes spreadsheet formula-leading values while preserving native ID text. Original Esri bodies remain downloadable through existing verified tickets.

Open matching features in designation desk sends the entire filtered cohort from one original source edition to the existing water-designations.openSelection method. It passes all native scalar identities, explicit original id_field, source hash and the nested legal context. When several captured editions are visible, select one source before opening a saved cohort. The designation desk provides the preview, save/reopen, native export and delivery application. This source review supplies the complete source/qualifier context.

The native filter and export logic was exercised against the entire original 1,886-row feature index (160,139 bytes, SHA256 bd32114f094f7951f1706ed4f47190cd248cce4de971e2de8c8c23c2a14d2624). It preserved 872 blank-name features, 174 blank-county features, ORW 1,040 / TN 247 / TPGT 599, 258 left-bank features and the one blank native HYDTYPE. Exporting the blank-name cohort retained all 872 original index rows.

## Complete selected-class domain inventory

Import source/high_quality_waters/sources-classified-domain217-20261013.json from this project's retained native source directory. Its source entry scdes-schydroclass-domain217-inventory-20261013 has role WATER_CLASSIFICATION_DOMAIN_INVENTORY and body schema upstate.classified-water-domain-completeness/v1. The report's source_id, layer_id and layer_url select the matching captured layer; the report's original geometry hash is compared with its retained original capture pages.

The desk shows the observed 217-HUC inventory, unchanged 1,886 native IDs/classes/publisher HUCs, zero additional selected-class features in the remaining 92 HUC12s, every queried HUC12 including zero counts, original geometry date, class selection and original downloads. Source coverage and analytical polygon intersection retain separate meanings.

Current public report: source/high_quality_waters/scdes-schydroclass-20261013.domain-completeness.json, 44,275 bytes, SHA256 0f1fec60f437c021bc0cd75ad3f0e67a701c3100acbb77ef7a2089fb676b2e15. Its manifest is source/high_quality_waters/sources-classified-domain217-20261013.json, 11,987 bytes, SHA256 3c4e00ab3048955943916046f9290e98d1118fa32b75eacc345f33bd3749206d. The public report preserves all original official response identities and removes internal transport locators. Retain both with the original official service responses from https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2 .

## Current saved-designation receiving contract

The water-designations desk's r2.1 controller copies the complete source-review input into source_context. Its draft and selection functions retain that object; the model normalizer writes it into the saved selection, selected-identities.json and imported source scope. Reopening restores the same context. The related-source panel reads both a legacy legal-record array and the current legal_record_context.records wrapper, and keeps candidate, partial and coextensive association labels. Its Source review JSON export contains the complete original input.

The 1.3.0 caller supplies source_feature_refs with typed feature_id values, explicit id_field/native_oid_field/class_field, expected_source_sha256, the original rule_reference and the full legal context. The desk accepts both the top-level and nested rule reference. Positive measured HUC12s, the original native field/value references and the source coverage scope remain available in source_context throughout the saved workflow.

## Open a completed source-workbench result

Extension version 1.4.0 exposes a whole-source receiving method in addition to
`openRecord`. The maintained source workbench can open its completed import:

```javascript
await context.openExtension('water-source-review', 'openSource', {
  workspace_key: currentWorkspace,
  collection_id: result.source_collection_id,
  source_id: 'classified-water-crosswalk',
  load_native: true
});
```

The current source preparation method supplies the actual imported collection
ID. The original crosswalk source entry is `classified-water-crosswalk`.
The review uses that entry for its complete retained legal register and native
geometry context, refreshes the imported-source catalogue, and loads the complete
captured-feature browser when `load_native` is true. A newer source-opening
intent or a project change supersedes an older pending navigation. Existing
`openRecord` callers retain their record and edition selection behavior.

The controller also accepts `source_collection_id` as the collection-key alias.
When invoked before the view mounts, it retains the selected source for the next
mount. Hosts exposing only `navigate` can open the same existing view and use its
normal source selectors. The original designation handoff remains
`water-designations.openSelection`.

The source-workbench method builds the geographic crosswalk before import.
A standalone legal registry remains readable independently; the complete native
browser uses the crosswalk's original captures and geographic associations.
Crosswalk version 1.2.0 accepts `planning_path` and `focus_path` returned by
`Workspace.source_file`, with `project_source=None`. The original planning SHP
and sidecars, original four-focus response, full native network selection and
its referenced pages remain part of the retained source snapshot. The
[crosswalk guide](../source_tools/HIGH_QUALITY_WATER_CROSSWALK.md) documents the
same API and standalone CLI.


## Version 1.5.0: portable classified-water source briefing

The existing **Download printable source briefing** control produces one complete
HTML file from the review's current source editions and full matching cohorts.
Set its title, choose the legal filters, and optionally load/filter the native
feature browser before downloading. Changing the visible page does not change
either selected cohort. A source change or incomplete native load must finish
before a briefing can be prepared.

Open the downloaded HTML in a browser to read the full selected reach
descriptions, source-qualified original record IDs, current and previous
classes, site-specific/NDZ flags, legal edition dates, original PDF pages and
line references. Each existing native association retains its candidate,
partial or coextensive status, selected-register agreement, publisher status,
positive measured HUC12s and boundary touches. Original names, aliases and
split reaches remain separate rows.

The native cohort has independent selected/source counts, class and publisher
linework-type distributions, blank-name/county counts and measured geographic
relationship. The complete original feature list is included in an expandable
appendix and in both data downloads. Publisher HUC12 values remain separate
from positive WBD intersections. Crosswalk-associated legal records are retained
with their own editions, even when the independently selected register differs.

The original full-crosswalk coverage table is labeled as its complete retained
scope. Its independent region, edition, class scope, feature-measure sums,
dissolved unique measures and units are preserved. The briefing does not
recalculate this table for a filtered cohort or sum overlapping geographic rows.
Full inventory profiles and any retained domain-completeness comparisons remain
in the file. The native feature selection is checked against the same workspace
and crosswalk source identity before publication.

The HTML includes **Complete briefing JSON**, **Selected legal rows CSV** and,
when the native browser was loaded, **Selected native features CSV**. The two
CSV bodies come from the desk's existing complete-row exporters, including their
spreadsheet formula protection. The JSON schema is
`upstate.water-source-brief/v1`; it preserves selected identities,
filters, full legal/native rows, original associations, source descriptors,
hashes and scope. Operator download tickets are omitted from this portable
snapshot; the original source downloads remain in the live source desk.
Original public source URLs remain linked. The file uses no remote script,
font, service or source fetch.

**Print / save PDF** uses the browser's normal print flow. All selected legal
descriptions are part of the reading view. The potentially large native
inventory prints when its appendix is opened; its complete data remain in the
HTML/CSV/JSON regardless. Layout uses neutral type, plain tables and source
references.

This source-cohort briefing is available before a receiving-water plan is
created. The existing designation handoff, saved receiving-water plan/analysis,
and its separate scientific-report source producer remain the downstream
workflow for selected geometry and model results.

### Installation and native receiving

Add `operator/web/extensions/water_source_brief.mjs` alongside the
current review controller. The maintained descriptor now declares this asset
and version 1.5.0, so the original extension installer and complete-source
resolver retain it with the existing controller, stylesheet, backend and guide.
No backend route, second store, queue or model calculation is added.

In the existing receiving operator, open the imported legal register and its
current crosswalk, then exercise a real legal filter and captured-feature filter.
Download the briefing, reopen it outside the operator, inspect a complete source
reach, and download its selected JSON and CSV. Their original qualified IDs and
row counts must equal the original filter selections, including when the source
desk displays only the first page. Preserve the current saved designation and
original scientific-source handoff.

The additive module exposes
`prepareWaterSourceBrief({snapshot,records,filter,nativeCatalogue,nativeRecords,nativeFilter,legalCsv,nativeCsv,title,preparedAt})`
and `renderWaterSourceBrief(prepared)` for the maintained browser.
The preparation function rejects repeated/absent/changed source rows and
crosswalk/workspace mismatches. It freezes a portable copy without mutating the
live source records. Pure rendering returns the whole standalone document.
