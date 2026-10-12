# Preview and review a map release

The preview opens the selected retained release through the original OpenLayers, MapLibre and Martin runtime. Source receiving, edition saves, reviews, publication and previous-release restoration remain in the same workspace.

## Select the edition and its comparison

Open a saved edition from the existing list, or enter its exact ID and version under **Saved editions**. Local edits for the edition stay in the existing browser draft. Opening a different saved version keeps the earlier draft available under its original version.

Save the current edition before inspecting or comparing it. **Compare exact editions** reads both immutable versions. **Compare published release** uses the current publication as the earlier selection. The comparison includes the original style, every archive binding, sprite and glyph inventories, layer choices, view and release notes. Changed fields open with both complete values. Downloading the comparison retains both original edition records and their source digests.

Inspection and **Record review** still use the original saved request, complete native inspection, reviewer, note and current-publication check. The review details show the actual inspection request and retained review hash. Preparing a release retains that review and its original files.

Selecting a prepared release displays its exact edition, runtime, file inventory, manifest hash and preceding release. The preceding-edition comparison reads the release chain already retained by the workspace. **Open exact edition** uses those same IDs and version.

## Open and inspect the native map

Choose **Open native preview** for the selected release. The status names that release and its current native session. It reaches **Style and tiles ready** after the actual MapLibre style and selected tiles have loaded and the map reports idle. Recorded map errors appear with their original message, source and time. **Reload selected map** creates a fresh browser map against the same live native preview.

The saved view is expressed in native MapLibre zoom. The installed bridge renders native zoom as OpenLayers zoom minus one; both initial placement and **Use this map view** preserve that conversion. **Restore released view** returns to the retained edition's center and zoom. **Fit archive bounds** uses the exact inspected archive bounds, including a combined extent crossing the antimeridian. The current map view supports native zoom 0–24, while each archive retains its own inspected zoom range.

Changing or stopping the original preview closes its browser map and clears the prior release's layers, sources, selected features and pending reads. The browser owns only that map and its listeners. **Stop preview** uses the original controller to close Martin and its native preview session.

### Layers and decision notes

The layer desk lists the actual selected style layers, source IDs, vector source layers, visibility, zoom bounds and feature filters. Its search filters those retained rows without changing the source.

A visibility checkbox changes the current browser preview. Decision notes and local preview choices are retained in the existing workspace browser state, bound to the release manifest. Reopening that same release restores those local preview choices; **Restore released choices** returns to the original released choices.

Use **Open this edition**, then **Apply choices to draft** to carry the visible layer choices into that edition's draft. The original layer notes already edited in the draft remain unless a preview note was explicitly changed. Save and inspect a new edition to record and release those choices. Applying choices requires the same edition ID, version and original style as the selected preview.

### Archives and features

The source desk shows each live source's loaded state and the original archive resource, byte count, SHA-256, bounds, zoom range, metadata and declared vector source layers. Rights and attribution remain visible beside the map.

Click the map to inspect its actual rendered vector features. The feature selector retains every returned feature at that point. It shows original feature and layer IDs, source, source layer, properties and geometry. Raster releases show their original source and archive details; vector-feature inspection applies to vector tiles.

**Download map inspection** saves the selected release, edition, review attribution, original sources, rights, glyph coverage, current map state, full feature selection, layer choices and recorded map errors. It is an operator observation of the selected preview. The complete portable handover remains the original workspace package.

## Resume and hand over

The original browser request keeps its UUID and complete input before a write. **Resume request** first reads its original saved result, then continues that same request when necessary. A returned save updates the saved version while keeping any later draft edits. Complete uploads, failed-request history and package selection continue through the existing recovery actions.

A save that finishes after another edition is opened also updates the saved edition’s retained draft. Its earlier version remains available, while matching later edits move to the acknowledged version. A different draft already kept at that version, or a newer version, retains its existing selection. The original operation’s **Download saved draft** includes the submitted text, acknowledged edition, recovered later edits and any distinct retained drafts, so those choices remain available through reply recovery.

Use **Export complete workspace** or **Build portable package** for the full source, database, native command records, selected runtime and release chain. **Download complete package** opens the original selected archive. The receiver can reopen the saved workspace, inspect its retained editions, preview the selected release and use the original previous-release restoration.

## Runtime source composition

The maintained browser entry is `preview-entry.mjs`, bundled with `preview.mjs` by the existing `buildPMTilesRuntime`. Both files participate in the saved build request and retained bundle source inventory. The product file list includes this guide and the preview component so the original portable package carries them.

The entry preserves `createNativeMap(target, {style, workerUrl, signal, ...callbacks})` and its original `view()` and `dispose()` methods. It adds `observation()`, `fit()`, `restoreView()`, `resize()` and `setLayerVisibility()`. The original bridge property is `MapLibreLayer.mapLibreMap`.

The original `#mapStatus` exposes `data-state="ready"` only for the current release's loaded, idle map with no recorded map errors; `data-release-id` names that exact release. The map remains under `#map`. Layer controls are `#layerControls input[data-layer-id]`, notes use `input[data-layer-note]`, source-layer details use `details[data-source-layer]`, and `#featureSelect` selects the complete rendered-feature result.
