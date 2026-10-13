# Upper Savannah guided operating journey

The registered guided journey connects the complete application's existing scientific
controls into one operating sequence. It is designed for a live, hands-on
explanation of a saved study: choose the starting point, explain its inputs,
change a case, run the original models, compare the results, open the maps, and
transfer a working project that can be reopened.

Open the current authenticated operator and choose **Guided journey** beside
Overview. Start by explicitly choosing a retained baseline. The guide then keeps
that selection visible when opening the original forms, maps and downloads.

## Install into the assembled application

Use the current complete Upper Savannah source directory, including its joined
spatial, community, customer review, conservation, programme and decision
components. The installable component is in the public source repository under
`opportunities/upstate_forever_2026/operator`. Install the current complete
extension component first, then the guided component:

```bash
python3 -B install_extensions.py \
  --application /absolute/path/to/current/upstate_application \
  --source-root /absolute/path/to/current/complete_source
python3 -B operator/install_guided_journey.py \
  --application /absolute/path/to/current/upstate_application
```

When the component is held in a separate source checkout, run its installer and
pass the actual application directory with `--application`. Its source root
defaults to the directory above this installer's `operator` directory.
`--source-root` can select that complete component explicitly. `--node` uses
the already installed Node executable to parse the browser source.

The descriptor in `operator/extensions/guided-journey.json` registers the view,
stylesheet, actions and lifecycle with the original authenticated extension
catalogue. The existing host supplies the original forms, selection controls,
queue, maps and downloads through explicitly declared capabilities.

The installer prepares every complete source change before writing. It parses
the component, joined browser source and Python server, verifies each complete
integration fragment, and preserves other current desks. Its small server
projection retains native stage reuse origins. The form joins also correct the
original model-control iteration and let the complete-delivery selector consume
the server's actual stage summary.

The first installation intent and its complete before/after source remain
unchanged on retries. Each attempt reconciles the existing files against that
intent. A replacement that succeeds before a later filesystem error is included
in recovery; every affected path is read again, and an unfinished disposition
remains available to the next continuation. Existing concurrent source is
preserved. Where the original extension installer is present, its registration
join is composed to preserve additional host capabilities on subsequent runs.

Use `--check` to prepare and parse the join before changing application files.
The source-only installation leaves the original model workspace and queue
with their existing operator.

Start or normally reopen the same operator after the source join. The native
entry point uses the original workspace and existing operator state:

```bash
python3 -B operator/server.py \
  --workspace /absolute/path/to/original_workspace \
  --operator-state /absolute/path/to/original_operator_state \
  --port 8765
```

Keep any existing source manifests and restore-directory settings in that
operator's established command. Its printed URL opens the current authenticated
session. The guide uses that session and the application's existing queue,
workspace selector, source files, model runtime and download tickets.

The original portable workspace builder includes the complete `operator`
directory. The guide source, integration declaration, stylesheet and this
walkthrough therefore accompany the scientific application's portable source.

## Run a hands-on explanation

Each step presents **Do**, **See**, **Meaning**, and a sentence suitable for
saying aloud. The step bar allows direct navigation. When you open a full
workspace view, the guide remains available in a compact rail above the view.

### 1. Choose a prepared study

Select the baseline or prepared study deliberately. Open its original result.
Read the selected scenario, grid, parameter profile, native model selection
and model version.
A completed run displays its saved physical outputs and the time recorded for
its native stages.

Use a study whose source geography and assumptions you can explain. The
starting selection stays available throughout the journey.

Say: “This is our saved starting point, and every result stays linked to the
inputs that produced it.”

### 2. Explain the inputs and geography

Open the original source edition, grid and profile. Check the source references,
coordinate system, cell resolution, upstream context and model period. Open the
grid in Spatial review and show the reporting boundary in relation to the wider
hydrologic domain.

The reporting area is where reported quantities are summarized. The model
domain supplies the upstream context needed by the hydrologic calculation.
Keep the actual boundary and source layer visible while explaining that
relationship.

Say: “We retain the original data and show exactly which geography and
assumptions the model uses.”

### 3. Make a specific case change

Choose or revise a retained scenario through the original form. Specify the
actual land-cover change, retained polygon mask, replacement codes and reason.
The form saves a separate scientific record and leaves the baseline available.

A parameter profile is a distinct set of scientific assumptions. When changing
it, make that change explicit in the comparison. The guide keeps scenario,
profile and grid controls separate and clears dependent selections when their
inputs change.

Say: “I can change a defined part of the landscape while keeping the baseline
available for comparison.”

### 4. Calculate and recover the same work

Prepare the selected run using the original form. The form opens with the
selected grid, profile, scenario and native model choice. The original form
limits the model choices to those available in the grid and profile. Starting
the run sends its saved run ID to the original native model queue.

Inspect the task while the selected original InVEST NDR, SDR or both engines
execute. The
guide shows the actual task state, queue time, task duration, native stage
timestamps and output counts. Completed runs show their physical reporting
totals, recorded total units and valid-cell counts.

When a response is lost, use **Recover original request** in Operations from
this journey. The exact submitted arguments and operation ID were retained
before submission. A new request is dispatched only after its complete identity
and body are read back from browser storage. If that storage is unavailable,
the original form remains open so storage can be made available and the same
request retried. Recovery first refreshes the actual task list; if the task
is present it opens that task, otherwise it resubmits the same original request.
A changed form is given a clear instruction to recover its original request or
open a new form.

**Resume original task** first reads the actual task again. If its current state
requires continuation, the original server resumes that task and its saved
native stages. A complete result opens directly.

The timing view distinguishes stages executed in the current task, continued
stages and reused native stages. Reused stages retain the source run identity,
original stage timestamps and recorded reuse time. Their original computation
duration is shown beside that origin; the current task duration comes from the
current task. A historical duration range uses completed runs on the same grid
and profile whose stage timeline contains no reused stages.

Say: “This control runs the original models, and I can see their progress and
continue the same work after an interruption.”

### 5. Compare physical results

Select distinct completed baseline and alternative runs on the same model grid
with at least one common native model. The guide displays their actual common
scope. The original comparison form opens with those runs. The native comparison
retains the physical changes, valid-cell coverage and whether the parameter
profile changed.

The direction is alternative minus baseline. A negative export change means the
alternative has a lower modeled export on the compared cells. Explain the
quantity, units and selected geography beside the number, then open its
difference map.

Say: “This shows the modeled change from the same baseline, with the units and
assumptions visible.”

### 6. Inspect and explain the maps

Open the selected result or comparison in Spatial review. Inspect the layer
selection, extent, legend and physical units. Save the geographic view and
annotations using the original spatial controls, then select the saved review
and completed printable map pack in the guide.

The guide opens the original map files and saved geographic records. The
selected review and map pack remain linked when saved selections are imported
into the restored project.

Say: “I can move from a numerical result to the actual map and retain the view
we discussed.”

### 7. Build and open the delivery

The complete seven-map delivery requires NDR and SDR for the baseline and
alternative. A single-family run remains available for its own quantities and
comparisons; use the original run form to prepare the combined model selection
when building the complete delivery.

Open **Build or revise complete delivery**. The original delivery form receives
the selected baseline, alternative and saved spatial selections. Complete its
supporting source, observation, water-designation, map-setting and contact
fields.

Open the actual delivery record and download its map PDFs, report, metadata and
working package through the original authenticated downloads. Read the actual
delivery state and package audit returned by the native application.

Say: “The handover includes both the readable report and the working analysis
behind it.”

### 8. Save, reopen and transfer

Choose **Save view and notes** in the header or in this step. The original
workspace retains the selected baseline, grid, profile, scenario, run,
comparison, saved map view, map pack, delivery and operating notes in
`operator-session.json`. The saved time appears beside the project identity.

Choose **Save view and transfer project**. This saves the current selection and
notes, then opens **Project continuity**. Choose **Create complete project**,
review the selected completed and unfinished operations, and choose a complete
ZIP or incremental handover. Keep native intermediate files when model stages
need to continue. The form identifies the saved view that accompanies the
project. Its original request freezes that view revision with the selected work.

For a ZIP, open the completed operation and download the scientific-workspace
archive. In the receiving operator, choose **Receive a project**, upload that
archive and choose **Open received project** in the completed operation row.
For incremental delivery, receive its original manifest and missing parts, then
choose **Receive independent project**. Both routes register a separate working
copy and recover the selected original tasks and their required inputs.

Choose **Save or continue the selected analysis** in the received project to return
to this guide. Review its completed results, then use **Project continuity →
Resume unfinished work** for the retained operations you want to continue. The saved analysis and notes open automatically in a new browser or
receiving workspace. The guide resolves each saved ID against the actual
project and checks the selected run's grid, profile and scenario and native model scope, the
comparison's runs, the delivery's runs and the map pack's saved review.

The separate **Journey selections** JSON and **Operating notes** Markdown
downloads remain available. The JSON importer can resume another saved view in
the same project; the notes include the selected record IDs, actual retained
results and timing, step instructions and project notes.

A second browser saving the same project receives a revision conflict before
replacing an intervening save. Refresh, then save the intended local view.
Distinct previous text is retained in the note versions that accompany the
next save. Retrying an unchanged backup request uses its original snapshot.

Say: “We can reopen the same project and continue the discussion from the saved
analysis.”

## Notes and ongoing work

Draft notes are retained in the browser as they are typed. **Save view and notes** commits them to the original project, and a native backup captures the same selection and text. If another tab changes the notes, distinct
text is preserved and can be opened in the guide or read in the exported
operating notes. Each submitted operation also has its own browser storage
record. An operation completing after the selected case changes remains in the
operation list under its original selection. A later operation protects
the selected records it writes, invalidates or needs for its calculation and
delivery. Older input or run completions remain available through their original
tasks without replacing that newer working selection. Independent input edits
can still adopt their separate results. Every earlier result remains available through its
original task, including tasks shared by the original deduplication mechanism.

Journey preferences are scoped to the actual workspace key and project identity.
Preference and notes storage failures keep the download controls available.
New operation requests require a successful independent retained-request record
before their original POST. Recovery uses the same saved UUID and body. The selected scientific records, original inputs and native outputs
remain in the existing application workspace.

## Questions to be ready to answer

- Which source editions and model period are selected?
- What is the reporting boundary, and which upstream context is included?
- What changed between the baseline and the alternative?
- Did the biophysical profile also change?
- What are the physical units and valid-cell coverage?
- Is this a saved result, a current calculation, or a continuation?
- Which observed annual loads can be compared with the modeled quantities?
- Can the recipient reopen the complete scientific project and original maps?

## Source integration

`Guided_Journey_Source.json` records the exact complete component bodies.
`Guided_Journey_Integration.json` declares the complete original host joins,
server projection and current extension installer composition. The installer composes those joins into
the selected current application; the module delegates scientific operations
to the original application's forms and API.

The registered journey exposes `observe`, `mount`, `update`, `detach`, `dispatch`,
`beforeSubmission`, `acceptTask`, `updateRail` and `capture` for the shared
operator host. `nativeTiming` and `validateJourneyImport` are exported for
direct use with original retained records. The UI is self-contained and uses a
neutral industrial layout, responsive controls, keyboard focus styling and
print styling.

## Complete transfer of operator task history

Use **Save view and transfer project** and the installed **Project continuity**
panel to carry task history and unfinished original inputs. Its command-line
entry point is `operator/project_continuity_cli.py` (the historical
`operator/project_transfer_cli.py` delegates to that same command); the maintained
`python -m model.project_transfer_cli` supplies the underlying incremental block
transport. The continuity command uses the existing queue and native archive;
the lower-level protocol command works with the retained block inventory.

On the receiving computer, **Open received project** selects the new workspace.
**Save or continue the selected analysis** opens its saved guide, and **Resume
unfinished work** explicitly selects the retained tasks to continue. Completed
native outputs remain available immediately. Cancelled operations remain
unchecked until you choose them.

**Create scientific workspace backup** and **Restore workspace archive** remain
available for the scientific workspace and saved guide alone. Use Project
continuity when the handoff also needs original operator requests, attempt
history, unimported uploads or source previews. The separate journey importer
checks the scientific project and selected records and retains the selected tour
and notes; the transfer service restores the operating history.

## Save the operating view with the project

The Reopen step includes **Save view and notes**. This saves the selected scientific records, current journey step, native model selection and operating notes in the original workspace. The saved view is available after reopening the operator in a new browser and after restoring a complete workspace archive. The project identity remains the same; the restored workspace has its own receiver key.

Use **Save view and notes** after choosing the analysis and recording decisions. The view displays when it was saved and the original project identity. A save retains the server revision observed by that browser. If another browser has saved a newer view, refresh before saving again; notes from the other saved revision remain available in the notes history.

**Create scientific workspace backup** captures the current journey selection and notes as part of the existing backup request. The server saves that view and creates the workspace archive while holding the same session lock, so another view save cannot intervene between those operations. The archive carries the original scientific workspace, source, records, outputs, application and saved operator view. Restore the archive through the existing operator controls, open the restored workspace, and return to the guided journey to continue the retained analysis.

The separate **Download journey selections** file remains useful for moving a view between browsers that already have the same original project. Its import checks every selected record and the native model selection against that project. Existing browsers retain their own unfinished local request recovery; a received saved view supplies the starting selection for a browser without a matching local view.

A complete Project continuity capture freezes the saved guide revision in its
original transfer record. Ordinary and incremental capture save that selected
view under the existing session lock while making the original archive. An
interrupted transfer reuses its already frozen archive; replay never replaces a
newer local view with an older captured one. If another browser changes the view
before the archive is first created, refresh and create a new project selection.

### Source integration

The registered host uses its existing journey controller for backup capture. The joined browser also supports the original direct host, including its delivery form, navigation and stylesheet attachment. Native saved views use the existing authenticated operator API and source-preserving workspace backup. The component manifest records the current browser and this guide; all unrelated host modules and extension owners remain part of the installed application.

## Original source labels and production geography

The map legend and point inspection read land-cover descriptions from the selected original biophysical tables. Discrete grey shades identify categories. The profile detail opens the exact retained table while native work continues. Step 7 opens **Scenario reports** for retained scenario analyses; a completed run also opens comparison selection directly, and a saved comparison carries its baseline and alternatives into the delivery form.

The issuer requires every final Upper Savannah map dataset on a **30 × 30 m raster grid**, including an external modeling buffer whose distance the consultant selects. Each original Gura source edition retains its actual native land-cover grid and a separately recorded upstream buffer. The grid form reads the selected source header; choose that archive's recorded cell size. Select the appropriate original source edition and reporting boundary in the grid form; the saved grid retains both cell size and buffer as distinct values. The regional production maps use Upper Savannah sources and the South Carolina reporting extent with upstream context. See the issuer's combined RFP, PDF page 2, and `../RFP_RESPONSE_MAP.md` for the exact seven map requirements and delivery scope.

Gura has two retained source editions. Select the edition that belongs to the analysis:

| Analysis | Retained grid and source | Receiving command |
| --- | --- | --- |
| Original Gura data from the official InVEST 3.20.0 release | **15 m** cells, EPSG:32737; the original rasters have 1939 columns and 603 rows. The original watershed comparison uses an explicit zero upstream buffer. | `source_tools/receive_gura_native.py` |
| Earlier Gura working demonstration | Its separately retained **300 m** grid and recorded upstream buffer. | `source_tools/receive_gura.py` |
| Upper Savannah production | **30 m** regional inputs and the selected external modeling buffer. | The retained regional workflow and project inputs. |

The official Gura README describes 30 m elevation resampled to the supplied 15 m land-use grid. A run may cover a smaller watershed window on that same 15 m lattice. Its cell area is **0.0225 hectares**. The legacy 300 m grid has **9 hectares** per cell. Retain the selected grid's cell area when reading annual mass and per-hectare export values; do not exchange conversion factors between editions. Source edition, engine version, grid resolution and upstream buffer remain separate saved values.

For the original 15 m comparison, use the complete application containing the native receiver and original-grid support from PR 2886 and PR 2898, together with its installed InVEST 3.20.0 environment. Point the command at the existing application, scientific workspace and directory containing the unchanged release `NDR.zip` and `SDR.zip`:

```bash
python "${application_root:?}/source_tools/receive_gura_native.py" \
  --application "${application_root:?}" \
  --workspace "${workspace_root:?}" \
  --inputs "${gura_archive_directory:?}" \
  --models ndr sdr --mode both
```

The official source archives are [NDR.zip](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/data/NDR.zip) and [SDR.zip](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/data/SDR.zip). The receiving driver checks the pinned archive identities and original cells before preparing the workspace run. The saved grid retains the chosen resolution and buffer when the project is reopened.

### Current host continuation

The journey installer preserves the current completed-stage predicate when the host already uses `completedModelStage`. A delivery candidate must retain completion times and original files for both NDR and SDR, together with all three export rasters. It also repairs the Rehearsal navigation collection in the shared host so opening the walkthrough marks each navigation button correctly. These joins preserve the current portfolio, delivery inspection, saved journey, source preview and registered desk integrations.


## Optional calibration evidence review

The original eight operating steps remain available in their original order.
**Review calibration evidence (optional)** adds a separate ninth step for a
completed observation-based calibration dossier. Its scientific selection stays
independent of the scenario comparison and seven-map delivery selected elsewhere
in the journey.

1. Complete the original calibration analysis in **Calibration and validation**.
   Choose any source-error sensitivity and original-catchment map editions, then
   prepare the complete review package.
2. In **Guided journey → Review calibration evidence (optional)**, choose that
   completed review. The view shows the original calibration and plan, selected
   native run and profile, error edition, map edition and retained file count.
3. Use **Open complete review** for its complete package and supporting files, or
   **Read report** for the authenticated readable report. The adjacent controls
   open its actual nominal analysis, chosen source-error sensitivity and maps.
4. Use **Save review selection and notes**. **Save view and transfer project**
   saves the same original view before opening Project continuity. Its full ZIP
   or incremental handover carries the dossier, maps, copied original sources,
   source identities, and selected operating view.
5. Open the received workspace and return to the optional review step. It resolves
   the same dossier in that workspace and opens the existing calibration
   controller. The original source and file validators run again on report read.

The editable choice is one `selection.calibration_review_id`. Related identities
come from the saved dossier; the separate journey JSON's
`recorded_context.calibration_review` captures those exact identities.
Import rejects a mismatched dossier or context. Saving uses the original
revision check and session lock, then the original dossier validator checks the
report, selected supplements and supporting source files. Old journey files
without a calibration review continue to open normally.

Changing a scenario, run or model in the original journey does not silently
change the selected calibration dossier. The optional review step explains
this separation and shows the dossier's own native selection. Choose another
completed dossier explicitly when the scientific review changes.

### Current source installation

Receive the complete current Guided journey component and the complete current
calibration component. Run the maintained guided installer and native saved-view
composition first, then `operator/install_calibration.py`. The latter joins the
review validator into the actual current `_save_operator_session` method while
preserving its original record resolution, revision checks, notes history and
capture locks. The cumulative installer follows this ordering.

The calibration component also carries the original source-design module,
support data, guide and installer introduced with the observation-support
workflow. Its existing design diagnostics remain part of the same calibration
form. Current source manifests record the full updated browser, guide and
installer bodies.

## Reopen the Community view with the project

In **Communities**, choose the retained table, utility and watershed, search and sort order, and the block groups to compare. Opening a plan or report retains its original table and selection.

Use **Guided journey → Save project view** to keep that Community context with the operating notes. **Open saved project view** restores it and keeps the previous browser view available to reopen. **Open Community view** returns to the selected Community tab.

A complete workspace backup carries the saved view into its restored copy and delivered application. The original Community receiving workflow saves the selected table, filters, compared GEOIDs, plan, report and notes, then reopens them through that same backup and restore path.
