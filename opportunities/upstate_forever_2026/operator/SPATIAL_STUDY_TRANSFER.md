# Transfer an editable saved map

The original Spatial review and Study transfer desks can retain a saved map as the selected study. A completed map pack can be selected with the same workflow. Both use the existing scientific Workspace, queue, archive format and receiving operation.

## Save, select and receive

1. Open the original geographic layers in **Spatial review**. For a Receiving plan comparison, open one exact receiving-water ID from the reference and candidate plans. Inspect the original feature and selected contribution overlays, common viewport, line styles and source notes.
2. Save the view through **Save review**. Use **Transfer saved view** beside the retained review to open Study transfer with that exact saved review selected. A disposable unsaved viewport is not a retained study.
3. To include the printable outputs, create the original map pack and wait for its existing export task. Use **Transfer map and sources** beside the completed pack, or select **Completed map packs** in Study transfer.
4. Use **Preview contents** and then **Export editable study**. The preview lists the original records and bytes. The original queue handles progress, retained request identity, downloads and continuation after interruption.
5. Receive the archive through the existing project transfer. Open its restored Workspace, then **Study transfer**. Choose **Saved map views** and **Open saved map**, or **Completed map packs** and **Open map pack**. The map-pack detail's **Open saved view** returns to the same editable Spatial review.
6. Change the title, notes, viewport, overlays or point annotations through the normal Spatial controls and save a new review. The original review and its earlier-history links remain available.

The **Saved map views** filter lists immutable review JSON records, including records restored from a selected archive. **Completed map packs** lists completed original exports. Pending and failed map exports retain their progress and repair controls in Spatial review. Corrupt or foreign-project records retain an unreadable error in the Study catalogue.

## What travels

A saved review retains its original coordinate system, extent, raster selections where present, exact vector selections and attribute filters, visible overlays, labels, line styles, notes, point annotations and previous-review history. Typed source bindings bring the original source collections and companions, model grids and runs when used, linked comparisons and delivery origins, and original Receiving source plans or analyses.

For Receiving boundaries this includes the original plan record, native geometry files and source relationships. Reference and candidate plans remain distinct immutable records. The saved view's notes can preserve their exact record hashes and selected receiving-water ID. The original geometry and CRS stay unchanged; the common projected viewport is a display choice. An overlaid boundary comparison does not calculate geographic gain, loss, pollutant change or monitoring benefit.

A completed map export additionally retains its whole original export directory: printable PDF, SVG and PNG, review JSON, provenance, native annotation tables/geometries, printed overlay-feature inventory, map-pack ZIP, local HTML index and the original rendering application source. The original typed visitor pins the saved review by its retained SHA256.

The preview and archive writer use the existing source and native-owner locks and verify original bytes. Selection, capture and restore do not run a model or regenerate a map. Full Workspace backup remains available when the whole project is desired.

A standalone printable map-pack ZIP includes the rendered map and its provenance. Use selected Study transfer to carry the editable Workspace sources and plans needed to continue the map.

## Original selection contract

```json
{
  "schema": "upstate.study-selection/v1",
  "title": "Receiving-water boundary comparison",
  "roots": [
    {"kind": "spatial-reviews", "id": "<full saved review ID>"},
    {"kind": "spatial-exports", "id": "<full completed map export ID>"}
  ],
  "include_related_results": true
}
```

Either root may be selected alone. A completed map export already brings its original saved review. Study transfer deduplicates identical original records and file paths. The existing `model.study_delivery_transfer` visitors perform dependency capture; this addition exposes their supported roots in the catalogue and client without adding a persistence schema.

The installed Study client uses the original host `openMap('spatial_reviews', id)` for saved reviews and `openItem('spatial_exports', id)` for map packs. Workspace, mounted-view and request-generation checks prevent a late passive read from opening a record after the operator changes context. The Spatial workspace uses the original host extension opening route to pass exact roots into Study transfer.

## Current owner direction and outgoing product inspection

Read and carry **../CURRENT_OWNER_DIRECTION.md**, version **2026-10-13.3**, with this active work. Preserve the October 13, 2026, **14:00 UTC** cutoff, the current native writer and the original scientific Workspace. Continue the actual simulated native Upper Savannah case and useful editable handover without a new model run for this map navigation.

The responsible producing worker must open, run, render and use the exact outgoing app, report, map and project as its recipient would. LOOK at actual screens or real screenshots at desktop/screenshare and narrow/mobile sizes where relevant. Operate critical controls, populated, empty, loading and error states, downloads, exports and reopening. Capturing screenshots without viewing them, code/DOM/HTTP checks and model approval do not replace actual use.

Open and inspect **all relevant attachments**: every PDF/report page, HTML, map, spreadsheet, image, presentation, extracted archive and received project through its normal application. Play/watch/listen to final audio/video where present. If using available voice or media generation, use a natural professional voice and check clarity, pronunciation, pacing, timing and alignment; this grants no new purchase or voice-cloning authority. Repair broken, unstyled, cramped, clipped, overflowing or unreadable output before presenting it. Keep plain industrial controls, readable tables and spacing, and the original scientific meanings.

Tie the exact viewed version, artifacts, operated controls and any repairs to the existing handoff. Do not create a separate verification product, broad test sweep, approval gate, watcher, restart or new receiver. Preserve prior completed native courses and owner-stopped work. Propagate the complete current direction in active owned guides and subsequent worker instructions; leave historical, vendor and other-owner controls intact.
