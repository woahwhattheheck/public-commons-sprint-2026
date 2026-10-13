# Ordered scenario masks from retained source editions

TokenJunkieLabs

A land-cover scenario can combine polygon or aligned binary-raster masks from several original source editions. Each change keeps its position in the ordered scenario, its original mask, source edition, layer and attribute selection, land-cover codes, and scientific reason.

## Author and revise a scenario

Open **Land-cover scenarios**, choose **New scenario** or **Revise**, and choose the scenario's default original source edition. Each land-cover change has its own **Mask source edition** control. **Use scenario source edition** keeps the original fallback. An explicit choice binds that row to its retained edition even if the scenario default changes.

The mask list comes from the row's selected edition. Vector masks retain their original layer and attribute selection. Binary raster masks retain the existing native grid, band-one, numeric zero/one, and NoData checks. **Earlier** and **Later** keep the whole row together. Saving retains the original scenario and patch metadata while replacing the editable fields; it creates an immutable scenario through the existing operator action.

A saved explicit edition that is no longer available stays visible as unavailable. It must be received or explicitly changed before another native save. It is never silently replaced by the scenario default. Saved scenario details show each original mask and its edition.

## Native source contract

The optional field is patch.source_collection_id:

~~~json
{
  "source_collection_id": "the retained scenario default collection",
  "patches": [
    {
      "source_collection_id": "the retained edition for this patch",
      "mask_source_id": "the original mask ID in that edition",
      "from_codes": [41],
      "to_code": 42,
      "reason": "The scientist's original reason for this ordered change"
    }
  ]
}
~~~

The strings above identify fields to fill from the existing scientific workspace; they are not source IDs or a prepared scientific scenario. Use the complete authored scenario from the retained case.

Omitting the per-patch field preserves the existing scenario-level fallback and the original saved request body. An explicit empty, null, or invalid collection is rejected. The same mask ID in two collections identifies two different sources. The resolver cache, polygon cache, preview request, and native loader bind the complete collection/source pair. The preview retains each exact body and companion descriptor and the source resolver's code hash.

The existing ordered editing kernel remains authoritative. Each patch reads the land-cover values left by previous patches. Original code eligibility, vector geometry, aligned binary rasters, valid-cell coverage, area accounting, coefficient rows, and selected NDR/SDR models retain their existing behavior.

## Complete selected Study

The existing Study dependency walk already follows the per-patch source_collection_id fields. It retains every referenced source collection, its original manifest, and all original bodies and companions.

The run closure now also includes each retained native scenario footprint for that selected run: the complete immutable record, original request, complete output manifest, native scenario raster, net-change raster, image, full JSON, and all CSV files. The selection, record, report, and descriptors are checked against one another. The ordinary selected-Study writer and portable receiving route retain those exact files. A restored Study can open its original footprint without rebuilding it under a newer compiler.

## Operate in the existing native case

Keep the current native workspace, owner, baseline and receiving directory. The supplied input uses schema upstate.scenario-mask-collections-receiving-input/v1 and contains operation_id, project_id, baseline_run_id, and the complete authored scenario. Optional reuse_source_run_ids names only existing completed native runs. The original completed baseline supplies the grid, profile and selected models.

The installed callable entrypoint is:

~~~python
from source_tools.receive_scenario_mask_collections import receive_scenario_mask_collections

result = receive_scenario_mask_collections(
    workspace,            # the original model.workspace.Workspace
    supplied_input,       # complete retained scientific input
    output_directory,    # this original operation's durable receiving directory
)
~~~

The same function has an ordinary CLI:

~~~sh
python -m source_tools.receive_scenario_mask_collections \
  --workspace ORIGINAL_WORKSPACE \
  --input COMPLETE_AUTHORED_INPUT_JSON \
  --output ORIGINAL_RECEIVING_DIRECTORY
~~~

The course retains the full input before native writes, calls the original immutable scenario writer and run preparer, opens the actual native preview, executes or reuses the original selected native models, compares against the completed baseline, exports the complete selected Study, restores its literal ZIP, and independently opens the restored application's own modules. It compares the full scenario, baseline, run, footprint, comparison, and source collections. Complete original outputs remain in the receiving directory for continuation.

## Use the existing operator Page

After native receiving, borrow the original operator's existing authenticated Page, original API function and owner check:

~~~js
import {receiveScenarioMaskCollections} from './operator/scenario_mask_collections_receiving.mjs';

await receiveScenarioMaskCollections(page, {
  api,                    // original authenticated operator API
  workspaceKey,           // the original selected operator workspace
  control: result,        // complete native receiving result
  outputDirectory,       // a private child for this browser continuation
  ownerCheck              // existing owning process/caller check
});
~~~

The API function keeps the original Bearer authorization, workspace and same-origin session conventions. Do not write credentials to source, control, screenshots or result files.

The browser course opens the actual saved scenario, verifies every explicit and default source choice, changes and restores the default, reorders and restores the complete rows, and saves the complete authored scenario through the ordinary form, retaining the actual returned immutable edition. It retains the exact request before dispatch and reconciles that same operation/task after response loss. It then opens the saved scenario, actual completed run and original footprint at 1440 and 390 pixels, including the native image and all source/accounting details, and receives every original footprint download with its exact bytes and hash. It preserves unrelated open author forms and restores its original view.

Use a separate empty browser output directory on first invocation and the same directory for continuation. Existing images and downloads are retained after interruption. The native and browser result files state what was actually operated; source publication alone is not a completed native or rendered run.

## Installed source composition

The scenario-mask-collections component fragment extends the current original scenario input family using the maintained extend_components.paths contract. It includes the pair resolver, original save/preview/native joins, selected-Study closure helper, editor, native and borrowed-Page receiving modules, and this guide. The original application composition remains authoritative.

The receiving producer must follow the complete current AGENTS.md and CURRENT_OWNER_DIRECTION.md (version 2026-10-13.4 retained with this source). Open, use and visually inspect the exact populated desktop and phone screens and every outgoing attachment. Extract and open all contained deliverables; inspect the actual images, documents, tables and native outputs. Preserve current scientific processes, original source ownership and the existing native case throughout.

The borrowed-Page course retains the complete raw form controls, unfinished text and patch order before each owned change. An unexpected author change is saved as a separate immutable form-custody JSON and left open; resuming cannot dismiss that edited form. The native receiving invocation and recovery contract are detailed in `source_tools/SCENARIO_MASK_COLLECTIONS_RECEIVING.md`.
