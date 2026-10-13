# Whole watershed migration in Water operations

The Watershed migration tab extends the existing USGS Water application with a retained legacy-model workflow. It keeps the complete source directory, inspects every native DSS file, saves the analyst's file and record-reference choices, converts DSS6 through HEC's installed native library, reopens every converted dataset, and delivers the migrated directory together with the originals and full review history.

The existing USGS capture, review, edition, DSS7 export, merchant and customer commands continue to use their original source. This migration starts from an existing watershed directory.

## Install the compatible conversion runtime

Use the official HEC-DSSVue 3.4-or-older / HEC-RTS 3.5-or-older conversion environment. The official converter rejects a Heclib library version above 70924. The bridge checks that actual native version before inspection or conversion.

HEC's current documented downloads include:

- Linux DSSVue 3.3.26: https://www.hec.usace.army.mil/software/hec-dssvue/downloads/HEC-DSSVue-linux-3.3.26.tar.gz
- Windows DSSVue 3.4.15 portable: https://www.hec.usace.army.mil/software/hec-dssvue/downloads/HEC-DSSVue-3.4.15_Portable.zip

Install an official distribution into the chosen local environment and retain its version with the project. The launcher must execute a supplied Jython script and its arguments, then exit. HEC documents an application executable followed by script and arguments, a configured Jython launcher, and the CWMS runhere/jython route:

https://www.hec.usace.army.mil/confluence/dssdocs/dssvueum/scripting/executing-scripts

Configure the existing Water process environment:

- USGS_WATERSHED_PYTHON: the Python 3 executable for the retained project controller.
- USGS_DSS_LEGACY_COMMAND: a JSON array containing the exact installed native launcher and its fixed arguments.

For example, the array can name the installed HEC application launcher or the configured Java/Jython command. The application passes watershed_native.py, the retained request filename, the result filename and the original request identity as separate arguments. Shell interpolation is never used. Use the actual installation's paths; a Python 3 interpreter cannot run this Jython bridge.

The established USGS_HECDSS_PYTHON binding remains the separate official Python runtime for the existing USGS-to-DSS7 export.

## Open the maintained application

Run the mounted Water browser workspace on Linux, where its existing owner-only file and directory permission checks apply. Its file-download boundary deliberately retains those checks. Windows supports the standalone Python controller with the installed HEC executable and an owner-controlled project directory; move its complete handover ZIP to the Linux Water workspace for browser receiving. Windows native process ownership is implemented with the original Job contract. Node documents that Windows file modes do not express Unix owner/group/other permissions: https://nodejs.org/download/release/v26.5.1/docs/api/fs.html#file-modes .

    node usgs-water/cli.mjs serve --project /private/water-project --port 0

Open its printed local address and choose Watershed migration. The normal workspace token, local-origin rules, saved jobs and private Water project own the new operations.

### Capture the complete source

Choose a stable migration name and the source watershed folder on the machine running Water. Capture copies every ordinary file, checks the complete copied inventory against the source, and retains the originals in the named private project operation. The source folder and operation must be separate.

Keep all required input databases and model-relative dependencies in the selected tree. References to another directory are shown for explicit reconciliation. When the source contains links or special files, provide an ordinary materialized watershed directory.

Model text is read as exact UTF-8 or BOM-marked UTF-16. For an older installation, select Windows-1252 or ISO-8859-1 fallback during capture (CLI: --text-encoding cp1252 or iso-8859-1). The selected decoding must round-trip every edited byte. The file table displays which members were scanned as model text, read as native DSS, or retained in another format.

The source inventory includes the exact path, byte count and SHA256 for every member. Every original file is individually downloadable. The native library reads its own working copies of DSS inputs.

### Inspect all DSS inputs

Inspect native DSS files runs the compatible HEC reader against every .dss member. It retains the full raw catalogue and the native record type, complete time-series datasets, paired data, text and grid containers. The complete data and metadata are saved as NDJSON alongside each native operation.

Time-series catalogue blocks are retained individually; semantic comparison also reads the entire series through the original HEC get(path, True) operation. The receiving comparison handles a native change in time-series storage blocks while still comparing the complete original dataset.

Grid values and grid metadata use the GridContainer/GridData/GridInfo APIs. Grid D and E parts retain their native time semantics. File and dataset write timestamps remain in the retained operating metadata; the value comparison excludes those changed operating timestamps and the physical filename. Unknown native metadata requires its actual reader before the migration can complete.

### Review files and model references

Enter the receiving HEC application/version and the analyst's handover note.

The file table and reference queue search across the complete saved inventory, with 40 rows per page. A reference retains its original model file, exact source-file identity, line, context, text span and original value.

For each file reference choose:

1. Retain the exact original relative reference when it resolves to the selected input.
2. Replace it with a complete relative reference to one retained DSS file.
3. Declare a future model output where the application is expected to create that file.

For each DSS record pathname, also select its precise DSS file relative to the watershed root. The plan checks the selected record or wildcard against that file's typed original catalogue and the expected DSS7 pathname correspondence. Future model record outputs must belong to an explicitly declared output file.

The proposed Minute/Month spelling is a review aid. Native time-series type and selected catalogue determine the actual correspondence. The official converter's extract-list source uses shared/extract/*.xml; file and record references can also occur in model files and scripts. The controller scans the supported reference-bearing formats listed in watershed.py and retains all remaining source files.

A path resolves against its model directory or the watershed root only when it selects one retained file. An ambiguous reference needs an explicit replacement. Environment-variable and external paths should be reconciled into the delivered model directory.

### Save unfinished work

Save receiving choices retains a new review revision with the complete choices and notes. Download unfinished working file preserves the complete current entered review and its original source binding even if the server is unavailable. A retained browser draft and unload prompt protect work in the current browser. Reconcile with saved review opens the actual saved head while keeping that draft; Restore retained browser draft explicitly applies the draft to the opened revision. A lost save response retries the original submitted body and adopts its accepted revision. Reopen checks the same original watershed and saves the restored choices as another revision, using the current revision supplied by the open workspace.

Changing a choice makes the earlier plan stale. Review complete migration plan recomputes the complete selection. Its findings name each outstanding file or record reference. The conversion button becomes available when the saved plan is ready.

### Convert and reopen the original datasets

The original plan selects conversion for DSS6 and retains DSS7 inputs. Each native operation records its input, native launcher, driver source, logs and result. Conversion uses HEC's own HecDSSUtilities.convertVersion, followed by a native close/reopen and complete dataset comparison.

The migrated file retains its original relative pathname. Model text edits replace only the reviewed spans; encoding and unrelated text remain unchanged. The original file remains intact.

The controller holds the original operation lease until the complete native process tree closes, including a Java descendant whose launcher has already exited. Linux uses the maintained child-owner implementation; Windows assigns the native process to its Job at creation. On Windows, a cancelled browser/server request still awaits the running native owner so its Job and operation lease finish together. The saved result remains available when the watershed is reopened. The full platform contract is in WATERSHED_PROCESS.md.

Interruption retains the same operation and plan. Completed native outputs are adopted only with their complete file and record-artifact checks. A changed accepted plan needs a new migration edition rather than rewriting the completed operation.

The complete result includes every output member, original-to-converted native record correspondence, the reviewed model references, explicit future outputs and the receiving application. The same operation can be reopened after restart.

## Handover and receiving

The complete ZIP contains:

- the entire original watershed;
- the entire migrated watershed;
- every saved receiving review, source inventory and accepted plan;
- native request/result records, complete data payloads and process logs;
- a full member manifest for receiving into another Water project.

Choose Receive an existing handover and give the ZIP's path on the receiving machine. Receiving checks every complete member and the original source/result/plan/native bindings before publishing the operation. An identical existing completed watershed reopens under its original operation; a different watershed with the same name remains distinct.

Open the migrated directory in the selected HEC application. Carry out its actual extract/model operation and review the produced outputs with the responsible analyst. Data-file conversion and the selected application's scientific/model result remain separate steps in commissioning.

## Complete CLI

All commands use the original Water CLI and private project:

    node usgs-water/cli.mjs watershed-capture --project /private/water --id river-upgrade --source /projects/River
    node usgs-water/cli.mjs watershed-inspect --project /private/water --id river-upgrade --out inspection.json
    node usgs-water/cli.mjs watershed-read --project /private/water --id river-upgrade --out original-review.json
    node usgs-water/cli.mjs watershed-review --project /private/water --id river-upgrade --file receiving-review.json
    node usgs-water/cli.mjs watershed-preview --project /private/water --id river-upgrade --out migration-plan.json
    node usgs-water/cli.mjs watershed-execute --project /private/water --id river-upgrade --plan-sha EXACT_REVIEWED_PLAN_SHA
    node usgs-water/cli.mjs watershed-working --project /private/water --id river-upgrade --out unfinished.json
    node usgs-water/cli.mjs watershed-reopen-working --project /private/water --id river-upgrade --file unfinished.json --expected-revision CURRENT_REVISION
    node usgs-water/cli.mjs watershed-handover --project /private/water --id river-upgrade --out river-handover.zip
    node usgs-water/cli.mjs watershed-receive --project /private/receiving-water --file river-handover.zip

The review JSON contains sourceSha256, expectedRevision, title, receivingApplication, note and choices. Use the complete retained reference IDs in choices. Each choice specifies action retain/replace/output; replacements include value, and record-path choices include file. The browser supplies this same structure.

Existing output paths are preserved. Read the printed error and retained native log when the selected runtime cannot read a dataset; continue from the same original operation after correcting its actual runtime or source reader.

## Standalone Windows controller

The same Python controller accepts a command and project directory, with one complete request JSON object on standard input. Save the complete request as UTF-8 JSON and pass its exact bytes with command-prompt input redirection:

    python .\\watershed.py capture C:\\WaterProjects\\river < .\\capture-request.json

A capture request contains id, source and optional textEncoding. The remaining commands use the identical request structures described above; save each complete JSON response to the original operation's analyst material. For a batch native launcher, configure USGS_DSS_LEGACY_COMMAND with the installation's explicit command-interpreter argv; an .exe or actual Java command can be named directly. The whole operation folder, complete results and handover ZIP remain in the selected project.

## Primary source and commissioning basis

- Official DSS6 conversion tutorial and version boundary:
  https://www.hec.usace.army.mil/confluence/cwmsdocs/ctg/miscellaneous-topics/converting-files-from-dss-6-to-dss-7
- Complete official converter:
  https://github.com/HydrologicEngineeringCenter/DSSVue-Example-Scripts/blob/master/src/DssConverter.py
  Retained Git blob 065e8b4dcfc49c2db6a64ad535367b3542e7b7ce.
- HEC-DSS catalogue and typed data APIs:
  https://www.hec.usace.army.mil/confluence/dssdocs/dssvueum/scripting/using-hecdsscatalog-to-see-dss-pathnames
  https://www.hec.usace.army.mil/confluence/dssdocs/dssvueum/scripting/reading-and-writing-to-hec-dss-files
- Grid container and grid data:
  https://www.hec.usace.army.mil/confluence/dssdocs/dssjavaprogrammer/appendix-c-grid-classes-in-hec-java-programs/the-gridcontainer-class
  https://www.hec.usace.army.mil/confluence/dssdocs/dssjavaprogrammer/appendix-c-grid-classes-in-hec-java-programs/the-griddata-and-gridinfo-classes
- Native DataContainer and HecTime metadata:
  https://www.hec.usace.army.mil/software/javadocs/hec-monolith/hec/io/DataContainer.html
  https://www.hec.usace.army.mil/software/javadocs/hec-monolith/hec/heclib/util/HecTime.html
- Original RussianRiver CWMS 3.4.1 commissioning model:
  https://www.hec.usace.army.mil/confluence/cwmsdocs/ctg/hec-hms/configuring-hec-hms-time-series-output-in-hec-rts

Use the original example's actual input files, model references and selected HEC environment for software commissioning. Retain its source and attribution with the actual resulting run. Customer installation uses that customer's agreed watershed and receiving application.

## Run and inspect the outgoing product

The application-level AGENTS.md carries the owner's current rendered-product instruction. On the selected original commissioning operation, open the exact outgoing Water version at the screenshare width and at 390px. View the actual populated source inventory, native inspection, reference queue, saved review, unfinished-file reopening, accepted migration, original/migrated downloads and complete handover receiving. Operate those controls and inspect their loading, empty and error states. Open the downloaded JSON/ZIP and actual migrated model in their normal receiving applications, then view the selected HEC model's real result. Record the exact source, viewed screenshots and exercised files with the same original operation. Fix any clipped, cramped, broken or unreadable output directly in this application before client-facing delivery.
