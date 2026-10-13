# Operate a complete watershed study

TokenJunkieLabs · Upper Savannah scientific workbench

This route connects original source preparation, native model runs and the existing maps-and-delivery workflow. Use the retained study, source editions, parameter profiles and land-cover scenarios already selected for the regional work. Screen labels below match the operator modules in this integration.

## Open the study

From the application directory, start the existing operator with the intended workspace and the host directories containing its original files:

```bash
python operator/server.py --workspace /absolute/path/to/study --source-root /absolute/path/to/source-files --source-manifest /absolute/path/to/sources.json
```

Repeat `--source-root` or `--source-manifest` for additional original locations. An existing workspace opens directly. Use the original `--create` and title options when establishing a new study. Open the complete local URL printed by that process; select the intended study in the top bar.

The host must carry the native GIS and InVEST environment used by the selected helpers and saved runs. **Runtime versions** in the run desk opens the operator's actual runtime report. The DEM source preparation controls use the current resumable terrain helper.

## Prepare and inspect the inputs

Choose **Prepare study inputs**. Select the method, then select its original files. Large national archives can remain in the registered host directory and be chosen with **Choose host file**. Retained source companions are available in the same original-file selector.

For regional land cover, choose the complete original national archive and the retained upstream domain. For elevation and soil, select the numeric land-cover reference and that upstream domain. PRISM precipitation and NOAA erosivity use their original complete archives and the corresponding original acquisition or transfer records. The selected native helper retains source resolution, units and preparation choices.

Choose **Prepare selected source**. Its row shows the existing task identity and queued, running, complete or recoverable state. Select **Progress** to see the native stage; elevation also reports the original helper's tile counts. **Details / files** opens the saved operation and prepared documents. Leave import selected to make the completed source edition immediately available in **Original sources**.

The **Combine prepared inputs and existing source editions** section combines completed inputs with the study geography and biophysical sources. A prepared input may also have an imported source edition; select one representation of that input. **Open model grids** continues to the existing grid-preparation form.

The reporting area, upstream model domain and utility reporting areas have different roles. Keep the selected native domain and reporting geography attached to the study. Source pixel spacing and the selected working-grid alignment are separate properties; inspect both through their retained records.

## Select and execute a run matrix

Choose **Native run desk**. In **1. Select the original inputs**, choose a complete retained model grid, the parameter profiles and land-cover scenarios to run. Choose the unchanged baseline from the selected scenarios. The grid, profile and scenario identify each matrix cell.

The table gives independent control over individual cells. **Select incomplete** selects cells that still need work. Search, filters and pagination change what is visible; queue actions apply to all checked cells, including other pages. Read the selected-cell count before starting a broad programme.

In **2. Prepare and queue native runs**, choose **Prepare missing**. This queues the existing native preparation operations for the checked selections. When those preparations finish, choose **Queue / continue prepared runs**. The server's existing queue starts NDR and SDR, and the saved run records retain the stages and outputs.

Use a row's **Run**, **Native log** and **Operation** controls to inspect its actual record, model output and queue state. The table displays retained nitrogen, phosphorus and sediment totals with their recorded units and valid-cell counts. **Download selected native totals** exports those same records with the original grid, profile, scenario, run and InVEST identities.

Closing a browser tab leaves queued work on the original host. A stopped or failed task retains its original selection. **Resume preparation**, **Continue run**, or the bulk continuation action resumes the corresponding original work. **Cancel queued** acts on selections that have not started.

## Save a compute programme

When the installed native programme controls are available, the run desk offers a programme for each selected parameter profile. It includes the selected unchanged baseline and checked alternatives on the same working grid. Open that programme to inspect its original run choices in the existing programme form, save it, then use the programme's normal execution and continuation controls.

A baseline by itself is a valid programme. Alternative rows keep their original scenario IDs, so a full-length retained scenario identifier remains valid for the native programme engine. The run desk and programme refer to the same saved scientific inputs.

## Compare completed alternatives and prepare maps

In **3. Compare and deliver completed pairs**, each group uses one original parameter profile and the selected common grid. The unchanged baseline and completed land-cover alternatives supply the paired results. Select **Compare completed alternatives** to retain or reopen that native comparison.

**Prepare delivery from completed pairs** opens the existing complete map-delivery form with the baseline and completed alternative runs already selected. Complete the remaining original geography and reporting choices in that form. The established delivery builder supplies the seven map families and its editable, portable outputs.

In the spatial and delivery views, use the selected saved run to explain the displayed result. Signed alternative-minus-baseline differences retain their sign; the original map legend and recorded physical units determine the interpretation.

## Save, reopen and continue

**Download run selection** saves the checked grid/profile/scenario matrix and its retained run references. **Open run selection** restores that selection into the corresponding complete study. The operator resolves every referenced grid, profile and scenario from the restored workspace.

The whole-workspace backup carries the study's source editions, native scientific records and completed prepared-source banks. For a handoff that also carries queued or interrupted work, use **Guided journey → Save view and transfer project → Create complete project**. Select the completed and unfinished scientific operations to retain and keep intermediate files when model stages need to continue. Choose the complete ZIP or the installed incremental handover.

Receive that original edition in the destination operator and choose **Open received project**. Completed source banks and scientific results are immediately available in the received workspace. **Save or continue the selected analysis** opens its saved guide and notes. Open the complete study before importing its separate run-selection file; the run desk resolves the retained grid/profile/scenario identities against that received study. In **Project continuity**, inspect the recovered task history and choose **Resume unfinished work** for the desired original operations. Closing and reopening the operator uses the same receiving workspace and operator-state directory.

## Walkthrough for the product review

| Screen | Action | What the operator should show | Explanation |
| --- | --- | --- | --- |
| Prepare study inputs | Choose the regional original files and prepare one required input. | The real source selection, queued task and native progress. | “We can inspect and repeat the preparation from the saved original inputs.” |
| Original sources | Open the completed imported edition. | Its prepared file, original companions, units and source metadata. | “This is the exact edition feeding the model.” |
| Native run desk | Select the baseline, alternatives and original profile, then prepare and queue. | The full checked matrix and actual native stages. | “Each row retains the scientific choices for that comparison.” |
| Native run desk | Open a completed row and its native log. | Recorded NDR/SDR output and physical totals. | “These values come from the completed native run.” |
| Completed pairs | Open the comparison and prepare its delivery. | The retained baseline/alternative pair and preselected map form. | “The comparison and map package use the same saved runs.” |
| Restored study | Reopen the study and saved selection. | The same scientific records and prepared inputs. | “The project can be reopened and extended on the receiving machine.” |

Capture the actual selected study and inputs, one preparation with native progress, the completed run matrix, a paired map and the reopened workspace in the operating walkthrough. Record the host-reported elapsed times alongside the actual task and run identities. These captures show both the result and the route used to operate it.
