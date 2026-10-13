# Scientific report to fieldwork receiving

This course turns an existing saved Implementation plan into an ordered scientific report, a complete briefing, a printable and offline field packet, a selected Study archive, and a complete Workspace archive. It restores both archives and launches a fresh Python process from each received application's own source. The last step writes a local START_HERE.html over the actual received files.

## Run on the existing project

Use the cumulative application's native Python environment and the original Workspace. The operator and GIS/scientific dependencies are the same ones used by the existing native project.

```sh
python -B /path/to/application/source_tools/receive_scientific_fieldwork.py \
  --workspace /path/to/original/workspace \
  --operation /path/to/scientific-fieldwork-operation \
  --plan-id eighteenmile-2023-original-lake-samples \
  --revision 2 \
  --as-of 2026-10-13
```

For the original dc92 Eighteenmile project this selects its existing native plan and revision. Confirm that the supplied Workspace is that actual project; the command retains its original project identity.

The operation directory must be outside the application and Workspace. Rerun the same command with that same directory to continue. It retains the first selected revision even when --revision was omitted, the original ordered source choices, each completed report and packet, both transfer snapshots, fresh-process logs and receiving results. Subsequent recipient edits remain in their received Workspace through the original native restore behavior.

Add the original ordered scientific sources with --sources. The input can be an ordered list of {source_collection_id, source_id} choices, the native delivery-selection object, or an existing scientific edition's selection.json. The course keeps that order and appends the complete native plan report if it is not already included. Thus the existing WQP 88-row context and sampling-decision brief can precede the complete plan report. Source collections must already be retained in the original Workspace.

Repeat --visit-id for an ordered subset of actual visits. Without it, the packet includes all visits in the selected native plan in their saved order. The packet includes their saved dates, assignments, sites, protocols, activities and observations. Empty dates, assignments and coordinates appear in the maintained packet's review issues.

--report-id selects an existing native whole-plan report for this revision. Otherwise the command reuses a saved report for the selected revision and --as-of date, or creates and retains one through ImplementationStore. --title names the ordered scientific report and Study.

## What completes

1. The original native plan report is retained and registered as an observed scientific source through implementation_report_source.
2. The maintained scientific_report_editions lifecycle renders the ordered original report sources; the real Operator prepares its complete companion ZIP. The original full preview is saved before rendering, so a lost completion reply reconnects to that exact edition.
3. scientific_briefing prepares the original report model, linked figures, slide/meeting-note index and complete briefing ZIP.
4. field_deployment prepares the selected revision's printable crew packet, offline field workbench, native editable plan, original selected records, calendar, sites and attachments.
5. The selected scientific report Study includes the native report's complete editable Implementation lineage and crew packets through the existing dependency resolver.
6. NativeProjectTransfer indexes and restores that exact Study archive. It also captures and restores the complete original Workspace, including its saved scientific briefing.
7. Each received application starts a fresh Python process. The child reopens the original plan/revision, report source, saved scientific edition and crew packet. The Study child additionally exercises study_receiving.detail and requires the captured crew packet to be available from its original Study. The Workspace child reopens the complete saved briefing.
8. START_HERE.html links to the actual received scientific report, complete offline briefing, crew packet and ZIP, offline workbench, original editable plan and both complete archives. The complete original briefing ZIP is streamed into briefing-view/ with every retained member checked, so its relative report and figure links resolve. For a packet with the saved plan embedded, the page opens directly into the original plan and selected-visit workflow. Older completed packets retain their original plan-import guidance. The completed plan-and-files ZIP returns through the maintained native field workflow.

The selected Study and whole Workspace have different scopes: the Study contains the selected scientific report and its native editable fieldwork; the whole Workspace also retains the full scientific briefing bank. The output names those scopes explicitly.

## Interruption recovery

The operation owns one nonblocking process lock. Original revisions and source inputs are pinned before rendering. Completed native objects are reopened by their original IDs. Native output writers and transfer stores retain their existing locks and atomic publication.

Every phase updates state.json. Original report attempts, incomplete whole-Workspace archives and fresh-process logs remain in the operation. An interrupted whole-Workspace archive is retained and a new capture attempt is recorded. The existing transfer receiver reconnects to its original destination after a lost reply and verifies its original members before doing so.

If the installed offline builder changes after a crew packet started, a completed original packet is reopened by ID. An unfinished old packet remains retained while a new packet edition is prepared from the same pinned plan and visit selection. This does not replace the native plan or earlier packet files.

Both fresh receivers execute source_tools/receive_scientific_fieldwork.py inside their received application, with the invoking native Python runtime. They retain separate stdout files and returned JSON. A child destination lock prevents two fresh readers from racing after a parent process disappears. A successful result.json and START_HERE.html are written only after both original copies reopen.

## Result files

| Path | Contents |
| --- | --- |
| intent.json | Exact command selections and optional original source-file digest |
| original.json | Pinned native plan revision, document digest, ordered sources and visits |
| scientific-preview.json | Complete original ordered report preview used by the native rendering lifecycle |
| state.json | Current phase and retained native object identities |
| scientific-fieldwork-study.zip | Complete selected Study and maintained application |
| transfer/native-archives/ | Complete Workspace archive and original transfer reconstructions |
| received-study/ | Study's application and editable Workspace |
| received-workspace/ | Whole project's application and editable Workspace |
| fresh-study/ and fresh-workspace/ | Each native child process's command, output and result |
| briefing-view/ | Complete original briefing ZIP layout with working report and figure links |
| receiving-selection.json | Original identities checked by both fresh processes |
| result.json | Completed native operation with archive and receiving identities |
| START_HERE.html | Local entrypoint over the actual received products |

These are working product outputs from the supplied project. Their scientific quantities, source identities and original plan history come from the maintained native producers. The course invokes those producers; it supplies no alternate calculations or generated measurements.
