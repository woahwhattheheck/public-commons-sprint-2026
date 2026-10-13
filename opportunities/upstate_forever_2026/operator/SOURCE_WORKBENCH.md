# Prepare study inputs

The **Prepare study inputs** desk uses the installed source preparation helpers and the original operator task queue. It keeps original files, native resolution, units, selected preparation options and imported source editions together.

## Open and prepare

Open the usual complete local operator URL, select the intended study in the top bar, then choose **Prepare study inputs**. Select elevation, PRISM precipitation, original national NLCD land cover, NOAA rainfall erosivity or USDA soil erodibility from **Source to prepare**. The available methods and options come from the installed native preparation module.

Choose each original input from the study's retained sources, original companion files, uploaded originals or bundled source metadata. **Choose host file** browses the source directories already registered when the server started. For large national archives, select the retained host file. **Upload original** uses the operator's existing file intake.

Select the method's actual options and leave **Import the prepared source into this study** checked to make a completed preparation immediately available in **Original sources**. Choose **Prepare selected source**. The server queues that exact input selection. Closing the browser preserves the original task. The status table shows its actual state; **Progress** reads the native operation and **Details / files** opens the existing retained task.

A failed or interrupted operation keeps its original inputs and completed work. Correct the specific missing input or runtime issue and select **Resume** beside that task. A repeated submission of the unchanged form reuses its saved request. Use **Use a new operation for changed input** when the original file or intended source selection has changed. This does not remove prior work.

## Combine model inputs

Open **Combine prepared inputs and existing source editions**. Choose completed prepared inputs and the source editions containing the original reporting boundary, upstream domain, utility areas, biophysical parameters and other relevant geography. Enter a title and choose **Combine selected sources**. The native composer preserves original IDs and rejects conflicting duplicate IDs. Avoid selecting an input both as a prepared task and as its already imported source collection.

Open the resulting source edition to inspect its original files, units and metadata. Choose **Open model grids** to select the prepared DEM, land cover, precipitation, R-factor and K-factor through the existing grid workflow. Source preparation retains the original resolution. Grid preparation applies the selected working alignment and resampling method.

## What Bryce does, sees and says

| Step | What to do | What should appear | Meaning | Suggested explanation |
| --- | --- | --- | --- | --- |
| Select the study | Choose the study in the top bar. | Its original source editions and preparation tasks. | Every selection belongs to this saved project. | “This is the study we can reopen and update.” |
| Select original inputs | Choose the source method and original files. | Identified file choices and the method's actual options. | Preparation uses the original data and an inspectable method. | “We preserve the data and the decisions used to prepare it.” |
| Start preparation | Choose Prepare selected source. | A queued or running native task and actual progress. | The native host owns the operation after it is saved. | “This work continues on the model host while we inspect the project.” |
| Inspect the result | Open Details / files or the imported edition. | The original files, prepared source, units and metadata. | The prepared source can be traced back to its originals. | “These are the files that will drive the calculation.” |
| Combine and continue | Select the prepared inputs and geography, then open Model grids. | One combined source edition and the existing grid form. | Grid alignment is a separate explicit scientific choice. | “Now we choose the common model grid, keeping the sources' real resolution documented.” |
| Recover an interruption | Choose Resume on the existing failed or interrupted task. | The same original task returns to the queue. | Completed work and source identity are retained. | “We continue the saved operation from its retained work.” |

## Useful terms

**Source edition** is a saved collection of original files and their descriptions. **Native resolution** is the source data's actual spatial resolution. **Working grid** is the common alignment used by a selected model run. **R-factor** describes rainfall erosivity; **K-factor** describes soil erodibility. Their physical units and selected conversions belong to the native source record. **Prepared source** is the output of the selected original helper, ready for the existing Workspace import. **Operation** is the original server task with its retained inputs, attempts and result.

The desk reports preparation and import. Model calculations and resulting physical exports appear in **Native model runs** and the run execution desk. Use completed retained results for explanation while a fresh original operation progresses.

## Source and operating integration

This desk is the additive module `operator/web/source_workbench.mjs` and its grayscale stylesheet. Its native partner is `operator/source_preparation.py`. It calls the existing task actions `source.prepare` and `source.compose`, the existing upload/task APIs, and the source-preparation catalogue, file and progress reads. It owns no model engine or second execution queue.

The interface retains form selections and original request IDs in the browser session. Server tasks and imported source editions survive browser closure. Completed imported originals travel with the ordinary whole-workspace backup. For a preparation deliberately left unimported, import or compose its completed native manifest before handing over the full workspace.
