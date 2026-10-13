# F7 annual-reference preparation on the retained tributary basins

This preparation creates a distinct **10.5066/F7DN436B** source edition for the same seven station/constituent/reach selections retained in the P9 tributary reference. It keeps every original national table row in the published ZIPs, all eleven Upper Savannah target records, the original source dictionary, and all six original NLDI feature/basin responses. The existing P9 preparation, saved evaluations and holdout assignments remain unchanged.

The three basin selections retain COMIDs **6269342**, **11730084** and **6280111**, the original unsimplified full-reach geometry, `splitCatchment=false`, and component index 0. The adapter verifies the resulting native catchment IDs against the P9 selection. In particular, Stevens Creek keeps COMID11730084. Its linked flow-gauge basin is not substituted.

## Inputs and source identity

The complete source bundle in this directory contains:

- `preparation-selection.json`: seven exact F7 inventory record IDs, with their original P9 record and basin identities.
- `retained-catchments.json`: the original six response URLs, source paths, byte lengths, SHA-256 values, Git identities and selection provenance.
- `retained-catchments/`: those six complete original GeoJSON responses, byte-identical to P9's retained sources.
- `original-target-records.json`: all eleven original F7 target records, including complete publisher rows, final estimator selection, standard errors and temporal fields.
- `F7DN436B-original-metadata.xml`: the complete original published dictionary.
- `PREPARE_F7.md`: this operating guide.

The maintained orchestration is `source_tools/prepare_f7_tributaries.py`. It invokes the existing `source_tools.usgs_annual.prepare` and `bind`; it does not replace the importer or call a network NLDI service.

Original national source ID: `af89b23daa91db89d2abd558312ae50cf444e82c778d9832779a2ed27208f845`.

The accepted native acquisition archive is **5,287,188 bytes**, SHA-256 `43868c684f747a92395ef570626a25253b517d702eb74ec2aa0eb3a68606112d`. It contains the original 31-member delivery. Its stable Drive file is `16LDSlej6CJ0FoeO_nVbDL9JR069Njc6t`. Preserve that complete archive. The adapter verifies its whole identity and reads only the exact three named `original/` members; it never extracts arbitrary archive paths.

| Original member | Bytes | SHA-256 |
|---|---:|---|
| load_est.zip | 781822 | fb4c360bb87076df83def6af5db57137876214c3b954b8a20cef1c983b91c18d |
| sitegage.zip | 519872 | 0ab5e0e50c61ddcef5d504dc2ba549cfd52df66e6742ca52b9c87644022dd616 |
| F7DN436B-original-metadata.xml | 40293 | ca82b16ed8d383f866919e1743d91e617b2cfe4de24cc715d8919b1f564d9572 |

The actual acquisition used the current retained importer `104e82a7dc990c968940e72cbae815abfcc81f52`, **39,341 bytes**, SHA-256 `e95e60a2d1463ee9d1788928c9c78c8aea17d2a403d2d0fa58c04d8cdba72149`. The adapter verifies that implementation and retains its complete source in the prepared companions. Use the qualified native Python with Shapely and pyproj, and the complete scientific application.

## Prepare and optionally bind a new source

Set the variables to the actual application, original archive, new output and existing native Workspace. The preparation and its default sibling staging directory must be separate from the original bundle and Workspace.

```bash
export ECO_APP=/path/to/the/current/complete/application
export ECO_PYTHON=/path/to/the/qualified/python
export ECO_F7_SOURCE=/path/to/the/materialized/f7-preparation-source
export ECO_F7_ARCHIVE=/path/to/the/original/9072-complete.zip
export ECO_F7_OUTPUT=/path/to/a/new/f7-tributary-preparation
export ECO_WORKSPACE=/path/to/the/existing/native/workspace

PYTHONPATH="$ECO_APP" "$ECO_PYTHON" "$ECO_F7_SOURCE/source_tools/prepare_f7_tributaries.py" \
  --archive "$ECO_F7_ARCHIVE" \
  --bundle "$ECO_F7_SOURCE/source/usgs-annual-2012/upper-savannah" \
  --output "$ECO_F7_OUTPUT" \
  --workspace "$ECO_WORKSPACE"
```

The source cohort can remain in its own materialized directory; this direct invocation imports the existing application's native reader and does not overwrite a running application's files. If all these sources are already installed in the complete application, `PYTHONPATH="$ECO_APP" "$ECO_PYTHON" -m source_tools.prepare_f7_tributaries` with the same flags is equivalent.

If the original delivery is already extracted, replace `--archive "$ECO_F7_ARCHIVE"` with `--original-root "$ECO_F7_ORIGINAL_ROOT"`. This explicitly accepts either the actual archive root with its `original/` child or that child itself. All three original file identities are checked. An ambiguous directory is rejected.

Omit `--workspace` to prepare without importing. The default staging directory is `OUTPUT-original-inputs`; `--staging-root` selects another separate path. Repeating the same command verifies the original admission and reuses the native prepared edition. A different source, implementation or selection requires a new output directory. Earlier files are never relabeled or overwritten.

The adapter verifies all eleven target rows against the current original national inventory before preparing. It inserts the complete eleven-row context, exact selection, basin provenance and original importer into the prepared source before the native importer captures companions. The prepared source contains the full national ZIPs and dictionary, original NLDI responses, seven annual records, native observation CSV and metadata, three basin features, complete source manifest and native result.

When binding succeeds, the returned `binding` contains the actual new `workspace_id`, `source_collection_id`, `observation_id`, catchment selector and preparation ID. Retain those returned IDs. Do not substitute an old P9 source ID or infer a new collection ID from its title.

The importer can also bind the already prepared source separately:

```bash
PYTHONPATH="$ECO_APP" "$ECO_PYTHON" -m source_tools.usgs_annual bind \
  --workspace "$ECO_WORKSPACE" --prepared "$ECO_F7_OUTPUT"
```

## Scientific interpretation and receiving

F7 values and paired standard errors retain the published **kg/year** representation for all selected constituents, including original total suspended solids code00530. Existing observation parsing performs native comparison-unit conversion. This adapter does not multiply rates by the sampling period, apply the P9 TSS coefficient, or manually convert sediment fields.

The original final-method field determines the published Beale or Fluxmaster estimator. The importer retains its original flow-support annual period, while the full source rows and `temporal_basis` retain the station-specific water-quality sampling windows. These are long-term estimates with published uncertainty, not independent annual measurements.

The same original NLDI basin identity permits an explicit source comparison. It does not establish that an existing generated DEM reproduces a real gauge drainage area. Keep native grid provenance, derived catchment selections, spatial support and source vintages explicit. Original P9 fit/validation assignments and saved predictions remain historical. A published-source-error sensitivity analysis is a separate supplement and must bind its actual source edition and matched record IDs; this preparation does not refit or reselect a profile.

For an independent recipient, carry the complete prepared source manifest and all its companions through the existing Workspace source transfer. The eleven-row context, national tables, NLDI bytes, original selection and source dictionary travel with that source. Confirm the seven admitted rows, all three original basin identities, original units and source downloads in the actual operator before using the returned selector. Actual native execution and visual receiving checks are reported by the producing/receiving owner; static source validation alone is not an execution claim.

Original source coordination remains in the existing Eco thread (deconfliction `1791918349.495279`), with ES9960's original reference selection and the current100698 production application. No additional native model operation is introduced.
