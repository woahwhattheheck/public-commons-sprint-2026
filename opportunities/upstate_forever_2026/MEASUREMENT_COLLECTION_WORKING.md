# Complete observation collections in the Measurements workspace

Prepared by TokenJunkieLabs. This operating course extends the existing Measurements collection panel, original authenticated transport, native collection store and saved study editions.

## Open and retain a complete working copy

Open **Measured observations** in the selected original workspace and account, then **Observation collections and complete study editions**. Give the collection a descriptive title, add all originals and select each file's interpretation. The member path identifies the original inside the collection; it must be a distinct relative path. A source label describes the original. A mapping is a JSON object interpreted by the existing measurement normalizer.

A collection working copy supports up to 1,000 original members. Adding a batch beyond that limit leaves the full current set unchanged. The working copy is isolated to this workspace and account. It retains unfinished text, the exact pending native request, source intake identifiers, original small-file bodies, complete inspections and operation history. **Download complete working file** saves that whole state. It is an editable operating file for this workspace; the complete native study ZIP is the transfer format for another workspace.

Browser persistence is checked against its observed saved revision. If another tab changes that copy, or browser storage is full, the full current state stays in memory and a persistent alert identifies the situation. Download both tabs before reloading, reopen the current saved copy, then explicitly open the complete file you intend to continue. New/Open first offers the previous complete copy as a download and retains the existing saved-revision protection. A generated working file can retain a long original request history; reopening uses that complete file without a smaller, separate Open-only size cap. A failed file read leaves the current working copy in place. If a pending request cannot be saved in the browser, download its complete working file and use **Resume exact saved request**.

## Receive the original source set

Choose **Chemistry / WQP** for a WQP-compatible chemistry CSV and **Monitoring stations** for a stations CSV. These complete originals travel in checked 256 KiB chunks. Uploads do not load the whole CSV into a JavaScript string. Each selected original gets a retained intake identity. A restart reselects the original file and checks every previously acknowledged chunk before appending anything. A same-size different file fails its original prefix check.

Choose **Daily discharge** for the existing USGS daily interpretation and **Retained companion** for supporting originals. These use the original inline collection contract and retain their complete bytes. The browser working copy supports a combined 24 MiB of these inline originals, allowing their saved original, complete inspection and pending receive body to remain available together. Larger companion sets use the original installed collection-manifest workflow; the streamed chemistry/stations course is independent of that inline budget. The scientific parser and daily-discharge interpretation remain the original engine.

**Upload and inspect complete collection** retains each complete source, prepares actual chemistry/station mappings, and previews every original before receiving. Review accepted and rejected row counts, the actual mapping, source hash, sample and normalizer identity. Samples are a view of the full preparation. They do not reduce the normalized population.

Changing a mapping or label on an uncommitted intake reuses its retained bytes through the original reconfiguration operation. After a native source has been committed, choose **New source interpretation** for a later change; the former original remains immutable. Reselect the original if the current browser tab no longer holds it. A changed interpretation receives its own native intake identity.

**Receive reviewed collection** saves the full original manifest, operation ID, collection ID, review hash and selected workspace revision before dispatch. The native course freezes every whole original before importing its first scientific member. It retains per-file progress and the original native import identities.

## Interrupted receiving and changed workspace state

Use **Resume exact saved request** after a missing reply or interrupted browser operation. Its original path, method and complete body are unchanged. A completed native operation returns its existing result. A partially completed collection retains its original completed imports and the pending member.

**Pause this browser operation** stops this panel from advancing. It does not cancel a native request already admitted by the existing server. The saved request remains available for exact reconciliation.

Open the saved collection to inspect its native operation history, partial completion and original error. If another real workspace edit has changed the remaining receiving baseline, retain the unresolved original request and open a fresh review. The old request remains in the working history and native collection. The new review uses the actual current source and revision, with a new receiving operation ID. Already imported original members preserve their existing identities.

An older browser response cannot replace a newly opened working copy. File opening checks the selected workspace and working revision after the complete read. Source selections, title and mapping controls remain fixed while an admitted operation is running.

## Save and deliver complete editable study editions

Open the saved collection and choose **Save complete current study edition**. Publication selects a new edition ID and the actual current workspace revision. Its immutable collection binding contains the original collection identity, document hash and source member paths.

The resulting project ZIP contains the complete selected Measurements workspace, including original collections, source originals, scientific imports, reviews, selections and saved population editions. The collection binding identifies this source set within that whole project. Native report filters select report populations; they do not remove the retained original workspace.

A stopped publication exposes **Resume publication** with its exact saved edition ID, original revision and filters. If its original snapshot can no longer be selected, preserve that binding and save a newly reviewed current edition. Historical editions remain available.

The edition view lists its actual complete members. Download a whole project ZIP, complete records CSV, calibration export or full accepted/excluded populations from that selected edition. The client checks the selected edition ID, complete member metadata, every returned member/range identity, every declared chunk hash and the complete member byte count. It uses a uniquely owned browser disk temporary file when available. Without browser disk storage, members up to 64 MiB can be assembled in memory; larger members remain available through the installed full-edition export.

Earlier collection editions retain their original editable-study ZIP control. A transferred saved edition can expose its retained population members without retaining the sender's original archive cache. Publish a new current edition in the receiving workspace to generate that workspace's complete project ZIP.

## Installed commands for the same original operation

Run from the actual installed Upper Savannah application directory. Select the same original Measurements workspace for every command.

~~~sh
node measurement_workspace/engine/cli.mjs large-collection-preview \
  --workspace /absolute/measurements-workspace \
  --manifest complete-collection-manifest.json \
  --result complete-collection-preview.json

node measurement_workspace/engine/cli.mjs large-collection-receive \
  --workspace /absolute/measurements-workspace \
  --manifest exact-reviewed-receive-request.json \
  --result complete-collection-receive.json

node measurement_workspace/engine/cli.mjs large-collection-status \
  --workspace /absolute/measurements-workspace \
  --collection ORIGINAL_COLLECTION_ID

node measurement_workspace/engine/cli.mjs large-collection-publish \
  --workspace /absolute/measurements-workspace \
  --collection ORIGINAL_COLLECTION_ID \
  --request exact-edition-selection.json \
  --output /absolute/complete-study-delivery
~~~

The receive request is the entire reviewed manifest plus operationId, expectedId, expectedReviewSha256 and expectedRevision. Preserve that complete request for retry. The edition-selection JSON is the exact object {id, expectedRevision, filters}; retry that same selection. Result files use the original create-only output behavior, so choose a new result pathname for another observation of the same operation.

The installed whole-project receiving course opens project.zip in the receiving Measurements workspace. Retain the sender's original source files, source/import identities, full population exports and saved edition bindings while checking the actual receiving workspace.


## Returning to an unfinished collection after changing workspace

The installed Measurements host retains each complete collection working copy under its original workspace and signed-in account when that view is detached. Returning to the same selection restores its unfinished mapping text, small original files, inspection, complete pending request and history. A large original remains in the native intake; reselect the same local file if more bytes are needed, and the existing prefix check verifies it.

This also preserves work after a browser quota failure or a competing-tab save. The restored view keeps its original saved-copy revision; it never adopts a newer tab's revision as permission to overwrite that tab. Download the retained working file and the other tab's copy, reload the selected saved copy, then explicitly open the complete file you choose. The host's close warning includes detached copies that still need saving. Downloading the complete working file remains the durable way to carry this unfinished browser state across a full browser close or another machine.

During receiving, operate the actual selection change: retain a full unfinished mapping and pending original request, select another workspace, return, and check the original body before resuming. Existing scientific inputs, native import identities and completed editions stay selected.


## Receive a complete saved edition into a chosen folder

The saved-edition panel now offers **Receive complete edition to folder**. Use it when a recipient needs every original member together or when a transfer needs to continue after the browser closes. The existing **Download complete file** action retains its OPFS-backed streaming and ordinary file download behavior.

Open the original saved collection and its exact current study edition. Choose **Receive complete edition to folder**, then grant the browser access to a parent folder. The product creates `measurement-edition-EDITION_ID` inside that parent, retains the complete immutable native edition in `EDITION.json`, and receives all members under `files/` using their exact original relative paths. A selected folder cannot alter the source workspace, scientific calculations, publication filters or saved edition.

The folder contains:

| Member | Purpose |
| --- | --- |
| `EDITION.json` | Full original native edition, source collection binding, workspace revision, member lengths and original whole-file/chunk hashes. |
| `files/` | Every complete original report, data file and native archive, with its original relative name. |
| `chunks/` | Checked partial receiving data that survives browser restart. Successfully assembled member chunks are removed. |
| `START_HERE.md` | Recipient opening and exact continuation instructions. |
| `RECEIVED.json` | Completion result written only after all recipient files are saved and independently read back against every original chunk and exact length. |

A file is assembled from bounded checked chunks into the original destination only after all of its source chunks are retained. Browser writable streams commit on close; an interrupted assembly leaves the retained chunks available for the same continuation. Existing nonempty originals are read and checked first. A changed file, changed metadata, conflicting source range or path collision is reported and retained; the receiver does not replace it with a guessed interpretation.

The receiver independently checks each actual 256 KiB native chunk and the precise complete byte count. The whole-file SHA-256 values in the folder remain the original native edition's declared values. This path does not claim an independently accumulated whole-file digest. Immutable exact chunk boundaries cover every original byte; full file contents are never collected into one browser buffer.

### Resume after a stopped browser or unavailable destination

Keep the complete receiving folder, including its metadata and `chunks/`. Reopen the same original saved edition in Measurements and choose **Receive complete edition to folder** again. Select the **same parent folder**. The original edition ID selects its prior child folder, and the complete source binding must match. The receiver checks each retained original chunk before using it, downloads missing chunks, and verifies any already complete recipient file without downloading it again.

The receiving state is the actual destination files and bound original metadata. There is no independent progress ledger whose advance can skip unwritten bytes. Failed chunk or final-file closes cannot create a completion result. An interrupted final completion write can be retried against the already checked original files.

Select **Pause** to stop browser work at the next guarded boundary. Closing the panel, changing the selected workspace/account or reopening the app also stops that view's later effects. Chunks already saved under the original edition remain available. No native request is repeated to regenerate a scientific result; the only remote operations here are original edition metadata and chunk reads.

A same-origin browser writer lease prevents two tabs from receiving the same edition simultaneously. File writers additionally request exclusive access. If another tab already owns the receiving operation, retain its existing folder and continue when that writer has finished. A source or destination changed by another application is reported; retain it for examination or choose a different parent folder.

### Independently reopen a complete recipient folder

Use **Verify received edition folder** in the saved collections section. Select the **edition folder itself**, rather than its parent. This is a read-only local operation: it loads the complete source selection and completion result, then reads every original member against the declared chunk hashes and exact length. It neither contacts the native server nor modifies local files. An absent, unfinished or mismatched completion result directs the recipient to continue the original receiving operation.

Open `START_HERE.md` and each actual report/data attachment in `files/`. Relative links between original report and supporting files remain intact. Keep `project.zip` unchanged and receive it through the existing installed native archive receiver when continuing the editable study. Receiving the folder alone does not perform native archive import or a new scientific run.

### Browser and destination support

The folder controls use the browser's explicit File System Access picker and Web Locks. These interfaces require a supported secure context and an actual user gesture. The picker opens directly from the button before network work; cancellation preserves the source and current work. The UI reports an unavailable or denied picker and keeps the existing ordinary downloads and installed export available. Do not use a privileged browser flag or weaken a source policy to force this control.

Keep enough disk capacity for the complete edition plus checked temporary chunks and the active file assembly. Only bounded source chunks are held in JavaScript memory. A quota or filesystem error retains completed original files and available chunks for the same continuation.

Paths are received exactly; the receiver rejects traversal, file/directory collisions, case/normalization collisions, reserved device filenames and other names that cannot be safely preserved across ordinary recipient filesystems. It reports the actual original path instead of silently renaming an artifact or changing links.

Primary platform references: [Chrome File System Access guide](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access), [writable file streams](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable), and [Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API). Native collection and archive contracts remain the installed source described above.

### Same original rendered receiving course

Use the existing equipped collection course and actual original edition. Receive the whole edition to an owned folder, pause once after some chunks have closed, reopen the browser and continue against that same folder. Open and personally inspect the complete original reports and all attachments. Run the read-only folder verification after browser restart, and receive the unchanged `project.zip` with the original native receiver. Retain desktop and 390-pixel product views and actual returned output identities in the same existing operation. Source execution against scoped file-handle envelopes is recorded separately from that actual browser/native use.


## Current owner direction and delivery operation

Continue the existing Eco/Upper Savannah application, original operators and current scientific/native owners. The original whole-application installer composes this source into the current cumulative application; the existing authenticated browser and native process remain selected. Existing inline collection routes, old study editions and the original large-file panel remain available.

For the actual rendered receiving, use the current original Eco source-transfer/native course. Open the exact installed collection panel at desktop and 390-pixel width, inspect main controls and full original diagnostics, operate a mixed source collection and exact-request recovery, download the displayed complete members, and reopen the actual study in the receiving workspace. Inspect the returned images as well as the original native result. Preserve existing source and operation handles.

The complete owner direction retained with this source follows verbatim.

---

# Current owner direction: Ecosystem Sciences demonstration

Version: `2026-10-13.4`. Owner: Bryce / TokenJunkieLabs. Direction for the Upper Savannah application, demonstration, presentation and work orders. Continue the broad build and finish as much of the existing Eco science application as possible before Bryce's call. Bryce renewed this work directly at **October 13, 2026, 10:46 a.m. Eastern / 14:46 UTC**, after the earlier 10 a.m. preservation checkpoint. Resume the existing unfinished work from its actual saved state and preserve completed outputs, active processes and original implementation ownership.

## Current project instructions

Complete as much of the existing Eco science application as possible before the scheduled call, using the existing fleet and complementary workers where useful.

This current instruction supersedes the earlier 10 a.m. Eco work cutoff. Prior cutoff records remain historical evidence. Coordinate at the existing Eco thread, reconcile actual issued handles, complete unfinished integration and native receiving, and publish usable durable handoffs in the existing application. Preserve the distinction between the sender's completed runs and the runs actually included in a received Study. Existing workers keep their current operations; additional workers clear complementary blockers. The recorded call remains unchanged; this direction schedules no meeting or automation and authorizes no client message.

Execute the prepared simulated model and deliver a relevant, usable application and presentation that demonstrate the actual work and elapsed delivery time. Continue active work while checking progress. Carry the current demonstration, presentation and Ecosystem instructions through the existing coordination surfaces and onward to participating workers.

## Build for an experienced scientific practice

Ecosystem Sciences lists GIS, hydrology/monitoring, ecological modeling, watershed assessment, statistics, visualization, optimization and publishing. Tim Maguire's practice includes GIS, modeling and water resources. Its South Platte work assembled data, mapped natural capital and produced watershed investment decision support. Do not assume it lacks these capabilities. Its unmet tooling, InVEST or production-capacity gap is unknown until the call. Sources: [Services](https://www.ecosystemsciences.com/read-me), [Firm](https://www.ecosystemsciences.com/firm), [South Platte](https://www.ecosystemsciences.com/).

Show concrete delivery and engineering offload on the actual Upper Savannah RFP workflow: source assembly, reproducible native calculations, editable scenarios, useful decisions and a complete working handoff. The prime retains scientific direction, method choices, interpretation/review and the client relationship. Relevance comes from useful work they can inspect, adapt and receive; do not promise Tim's reaction or claim an unconfirmed need.

## Execute the prepared simulated case now

Native execution is the immediate hard priority. Issue the prepared simulated case on the verified scientific runtime, retain its actual run identity and progress, and obtain the real native outputs. Continue the source/runtime/application integration needed to make that happen. Further plans, stock demonstrations, policy reviews and cosmetic inspection do not replace execution. Do not introduce a bid decision or a prime's yes as a gate.

Demonstrate the scientific operation in the actual application:

1. Use the RFP's 30 m GIS selection. Keep the upstream contributing model domain distinct from the South Carolina reporting mask and the four existing utility focus anchors; retain their actual source geometries and identities.
2. Run the baseline, a realistic riparian alternative and its matched control with explicit, editable source editions, assumptions, parameters and scenario changes.
3. Show active run/progress/logs and completed native annual NDR/SDR results: nitrogen and phosphorus in **kg/year**, sediment in **tonnes/year**, representing delivery to streams. Do not present these modeled stream loads as intake concentrations.
4. Compare the actual maps, tables and report, preserving matched scientific support and original units. Keep source/assumption edits and their consequences inspectable.
5. Export the editable GIS/project and complete scientific working package. Cold-reopen the delivered application/project and show the retained sources, selections, results and useful controls.

Identify the simulated case as modeled. Never invent measurements, completion or customer acceptance.

## Present the real work and real speed

Actually open, see and use the outgoing app and every attachment as its recipient would. Repair defects and ship a plain, readable product. Apply the standing inspection rule without review/test theatre or parallel bureaucracy.

If producing video, record the actual working application and use available natural generative voice/TTS. Watch and listen to the final export. Generated frames must never pretend to be a working app. Explain speed using actual elapsed start, commit, run and package history; do not invent delivery times or guaranteed reactions.

## Carry this direction with the work

Pass this complete brief into every current child, provider and cloud work order and handoff. Include its durable path and version `2026-10-13.4` with the next result. Relay it at the actual coordination surface and onward to participating workers; fast feeds can bury an update. Acknowledgment alone is not delivery.

Preserve active compute and existing implementation ownership. Do not force worker restarts, drop an active run or create a new controller. Keep lab attribution, source/copyright, incident and contact controls, personal-meeting approval, no private GitHub/Actions, no llama.cpp and focused internal validation. No new approval gate or broad test sweep is authorized.
