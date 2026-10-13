# Original watershed areas in native scenarios

A saved source-water study can now supply actual intervention masks and analysis
areas. Preparation reads the original Esri feature body retained by the study,
selects its exact HUC12 memberships, and imports one polygon subset per area into
the existing Workspace source store. The saved study and original source remain
unchanged.

## Operator journey

1. Open a saved original watershed study in **Source-water areas**.
2. Choose **Prepare scenario areas**, select the receiving areas and name the
   preparation. The existing background-task queue retains the operation.
3. Open the resulting prepared areas. Each area shows its original HUC12 count
   and retained source ID. Download the complete source package or the
   `scenario-source-areas.json` handoff directly.
4. Choose **Create land-cover scenario**. Enter an actual scenario title and
   reason, then one or more changes. Each change selects a prepared area, explicit
   integer source land-cover codes, an integer replacement code and its reason.
   Add, remove or reorder changes in the existing application form.
5. The saved scenario appears on the prepared-area page. **Prepare native run**
   asks for a completed grid from the same original watershed source, a retained
   parameter profile and models present in both. The original run panel starts,
   resumes and displays the native calculation and its outputs.
6. Choose **Compare native results for these areas**. The maintained Scenario
   analysis form receives all selected polygon sources and the original source
   lineage through `createForSourceAreas`. Select the actual completed baseline
   and alternatives there. Native analysis clips the areas to the retained grid
   and reporting area and compares outputs on the same valid support.

The prepared-area page also lists native runs for its saved land-cover scenarios,
including their current state and direct links to the existing run panel.

## Original geometry and source identity

The preparation validates the saved study's content identity and all file
descriptors. It verifies both the original retained body and decoded body hashes,
matches the entire source HUC12 set to the saved network, and resolves selected
memberships against those original records. Each source subset retains:

- Original feature attributes, including the original typed feature ID.
- Original polygon rings, coordinates and the declared coordinate reference.
- Exact upstream HUC12 membership and original receiving-area anchors.
- The complete original body, network and receiving-area profile as source
  companions.
- The original source reference and both source-body hashes in its provenance.

The geographic display's simplified SVG paths are presentation assets. The model
input comes from the original Esri polygon features.

Every prepared area becomes its own source entry. The existing native reader uses
that complete polygon source directly; preparation does not invent list-valued
attribute selectors. The same area source is used for an analysis zone and a
land-cover intervention mask.

Polygon validation checks retained rings, finite coordinates and a declared
source reference. The existing native geometry reader performs geometry
interpretation, transformation and union when analysis or a model run consumes
the source. Preparation itself uses only the Python standard library.

## Native analysis handoff

The output uses the maintained form's contract:

```json
{
  "schema": "upstate.scenario-source-areas/v1",
  "selection": {
    "title": "Prepared receiving areas",
    "zones": [{
      "id": "upstream-...",
      "source_collection_id": "actual workspace collection ID",
      "source_id": "upstream-...",
      "map_family": "critical_drinking_water",
      "source_plan_id": "actual preparation ID",
      "receptor_ids": ["actual receiving-area ID"],
      "source_relation_method": "source_area",
      "source_geometry_scope": "upstream_huc12_units",
      "metadata": {}
    }]
  },
  "origin": {}
}
```

The actual origin contains the saved network ID, preparation and workspace
identities, original body hashes, source reference, selected HUC12 records and
native preparation selection. Drinking-water areas use
`critical_drinking_water`; high-quality-water areas use
`high_quality_waters`. These sources represent whole upstream HUC12 units.
Published utility protection polygons retain their separate source identity.

The desk waits for the exact immutable source collection to appear in current Workspace state before invoking the maintained bridge. Saved-scenario completion likewise waits for its actual scenario ID. This handles an in-flight host refresh without opening the form against an older source catalogue:

```js
openExtension("scenario-analysis", "createForSourceAreas", {
  ...prepared.scenario_source_areas,
  workspace_key: currentWorkspaceKey
})
```

The downloadable JSON can also be opened with that form's **Add prepared source
areas** control. The form verifies that each vector source actually exists in the
selected Workspace and retains the full origin in the saved analysis selection.

## Explicit land-cover changes

A scenario keeps its actual prepared source collection, ordered polygon masks,
integer `from_codes`, integer `to_code` and explanations. It also retains the
source-area origin, original network ID, preparation ID and full ordered choices.
No land-cover code is selected implicitly.

Native patches apply in declared order against the current scenario land cover.
If areas overlap, a later patch sees the result of earlier patches. The prepared
page and report disclose shared HUC12 units; the saved scenario retains the
selected overlap membership. The same area can appear in multiple changes.

The run form checks that requested models occur in both the actual grid and
parameter profile. It displays only grids whose model-domain source has the
original study body's SHA-256, and checks destination codes against the selected
profile's retained code list when available. The native engine remains
responsible for its full parameter, grid, source and land-cover validation.

## Command line

Run from the complete application's source root:

```sh
python -B -m model.receptor_scenario_cli /path/to/workspace prepare \
  --network ACTUAL_SAVED_NETWORK_ID \
  --area ACTUAL_RECEIVING_AREA_ID \
  --title "Upstream intervention areas"
```

Repeat `--area` to select more receiving areas; omit it to use every area in the
saved study. This operation requires a saved original-geometry study and the
Workspace source store, without GIS or InVEST imports.

To save a scenario, prepare an ordinary JSON file with explicit choices:

```json
{
  "title": "Actual intervention title",
  "reason": "Actual planning rationale",
  "changes": [{
    "receptor_id": "ACTUAL_RECEIVING_AREA_ID",
    "from_codes": [81, 82],
    "to_code": 41,
    "reason": "Actual reason for this selected change"
  }]
}
```

The integer values above illustrate the required structure; choose codes present
in the project's actual original land cover and matching parameter profile.

```sh
python -B -m model.receptor_scenario_cli /path/to/workspace scenario \
  --preparation ACTUAL_PREPARATION_ID \
  --selection /path/to/explicit-scenario.json
```

The source module also exposes `build(workspace, selection)`,
`inspect(workspace, preparation_id)`, and
`save_scenario(workspace, preparation_id, selection)`.

## Retained output and reopening

Each immutable preparation lives under
`receptor-scenario-areas/<content-id>/`. It contains the original full source body,
original profile and network, per-area Esri feature subsets, membership CSV,
Workspace source manifest, analysis handoff, printable HTML report and result
record. Source entries are imported through `Workspace.import_sources` and their
bytes are retained in its existing object store.

A repeated identical preparation validates and reuses the retained result.
Opening the result checks every file and the imported polygon entries. The
existing extension's package exporter includes the complete preparation, with
offline report links resolving inside the archive. Workspace receiving applies
the extension's existing additional-folder checks to this preparation collection.

The extension adds only its own actions and route registrations:
`receptor.source-areas.prepare`, `receptor.scenario.save`, and
`/api/receptors/source-areas`. It uses the maintained queue, source store, modal
form, Scenario analysis bridge, native run preparation and file tickets.
