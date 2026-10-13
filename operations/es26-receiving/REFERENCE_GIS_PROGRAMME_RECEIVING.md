# Complete regional reference receiving: GIS and Programme continuity

This is the cumulative source handoff for the existing ES26 / ASTRA13 regional receiver. It retains all original188 source bodies and composes the original selected-Study reader (PR4481), completed-reference GIS handoff (PR4482), Programme-operation capture and locks (PR4536 with its original4486 helper), and the full original GIS/native-history component modules, browser controls, receiving courses and guides.

The bank contains 216 complete source files and 11 complete predecessor bodies. It belongs to the existing full restored application. Its source files are an overlay; all original scientific source objects, model outputs, project identity, recipient scope and unrelated application files remain in that application.

## Same owner, same operation

Continue the existing regional FINISH-ASTRA13 / FINISH3257 recipient and its bound lineage companion. Its actual receiving return [1791904855.784229](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791904855784229) confirms all 114 original parts verified and the 3,813,200,258-byte regional archive restored by its own archived CLI. 1B40 owns the complementary full-application source-intake join assigned at [1791904977.625469](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791904977625469). Reconcile that recipient's actual application, Workspace and current process before composing; no regional recipient host is inferred here. Host `2b450f19514b` and its original PID520 belong to the separate twelve-run teaching-project operation [1791904723.286919](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791904723286919). The original regional sender remains host `0c1e4cd4114e`, project `6cd0d35d-331e-491d-9bcb-3462c54ebff3`. Keep the published 216-body bank's exact 5,710,198 decoded bytes and historical provenance unchanged; this current operating guide governs recipient routing. Preserve active receiving and source composition. This source handoff creates no model run or new controller.

At the historical 14:00 UTC checkpoint, the regional sender retained ten complete runs, one interrupted restoration SDR with its NDR retained, and one prepared control. Following Bryce's renewed direction, the same original continuation completed all twelve regional runs and its ensemble course at **15:25:13.278067 UTC**, retaining the earlier ten complete run records byte-for-byte. The [actual completion return 1791905177.813719](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791905177813719) identifies the new full-course report and records that its final report/export/390 px inspection was still under way. The original sealed selected reference Study still contains its three completed baseline/restoration/control cases; later sender completion does not update that recipient's scientific scope. Preserve its existing archive and receive any subsequently issued complete-course output as a separate original edition. Do not rerun completed models to update the handover.

## Source identity and receiving

The JSON wrapper uses schema commons.artifact-base64/v1, encoding gzip+base64. Check wrapper gzip length/SHA256, inflate it, check decoded length/SHA256, then parse the complete commons.source-bank/v1 object. Each files entry contains its complete UTF8 content, bytes, SHA256, Git blob and source revision. The bank preserves every predecessor source revision and full preimages for changed prior included leaves.

Example decoding into an unused source staging directory:

```python
import base64, gzip, hashlib, json
from pathlib import Path, PurePosixPath
wrapper = json.loads(Path("reference-gis-programme-20261013.source.json").read_text())
compressed = base64.b64decode(wrapper["content_base64"], validate=True)
assert len(compressed) == wrapper["gzip_bytes"]
assert hashlib.sha256(compressed).hexdigest() == wrapper["gzip_sha256"]
raw = gzip.decompress(compressed)
assert len(raw) == wrapper["decoded_bytes"]
assert hashlib.sha256(raw).hexdigest() == wrapper["decoded_sha256"]
bank = json.loads(raw)
stage = Path("es26-reference-source")
stage.mkdir(exist_ok=False)
for item in bank["files"]:
    path = PurePosixPath(item["path"])
    assert not path.is_absolute() and ".." not in path.parts
    data = item["content"].encode("utf-8")
    assert len(data) == item["bytes"]
    assert hashlib.sha256(data).hexdigest() == item["sha256"]
    assert hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest() == item["git_blob"]
    destination = stage.joinpath(*path.parts)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
Path("es26-reference-bank.json").write_bytes(raw)
```

Use the original receiver's source-intake/component assembler at its existing writer boundary. Reuse matching installed bodies. For an existing different body, compare the retained before_sha256 / before_git_blobs and the full preimages; preserve any unrelated newer source and compose the exact change there. Source contents are complete, so no patch-only reconstruction or new installer is necessary. The separate original317-file regional bank remains a source authority and is not replaced.

Retained dependency_inventory contains the original inventory with included successor entries updated. Historical graph counts describe the predecessor. Resolve the original application's full current fragments; this bank includes geographic-reference-gis, gis-native-study and native-run-history fragments and every directly listed source path. GIS dependencies use the existing core, GIS projects, ensembles, scientific review, native run desk and guided journey.

## Complete the current outgoing product

Use the existing source_tools/receive_geographic_headwaters.py caller. The reference GIS operation follows the exact reference_report_basis and exports only its completed three original runs; the original scientific source may still preserve a partly completed larger plan. Keep the full scientific context and native history.

The existing handover stage includes geographic-gis.json, the editable QGIS project, GIS ZIP, offline source/map/table desk, native run history and original source/selection context. Keep those records inside the same ordinary Workspace backup and copied application. The existing cold child invokes model.geographic_gis_handover.verify against the restored Workspace.

Finish the same operation with actual geographic_gis.export.id and gis_verification.received.id, plus its original receiving-complete and handover-complete records. Verify the original saved Programme's retained adoption/opening operations through model/geographic_operator_transfer.py; the composed selected-Study visitor and original locks are included. A selected view must remain the recipient's selected view.

Open the real outgoing application at desktop and390px, use the controls, open every report/map/PDF/table, follow source links, open the QGIS/ZIP and native history, and cold-reopen the delivered application/project. Correct defects in the actual outgoing version. Return its complete durable files and concrete source/native/visual outcome to the original receiving thread.

Source-body, hash and component checks here confirm the transmitted source. Native execution, browser operation, visual inspection and cold receiving belong to that same actual recipient operation.

## Continue original GIS edition receiving

After the same restored Workspace contains the real geographic_gis.export.id and gis_verification.received.id, use the included original PR4141 receiving command with both exact IDs. It retains the original native comparator, desktop/390px operator course and complete ZIP reopen:

```sh
"$NATIVE_PYTHON" -B source_tools/receive_gis_edition_review.py \
  --application "$APPLICATION" \
  --workspace "$ACTUAL_RESTORED_WORKSPACE" \
  --output "$SAME_EXISTING_RECEIVING_OUTPUT" \
  --export-id "$ACTUAL_EXPORT_ID" \
  --receipt-id "$ACTUAL_RECEIPT_ID" \
  --require-raster \
  --node "$BROWSER_NODE" \
  --playwright-module "$INSTALLED_PLAYWRIGHT_MODULE"
```

Use the owned output/argv/PID if already issued. There is no second export or model in this continuation. The three exact PR4141 source files accompany this bank; preserve current GIS4337/4322 dependencies in the original application. The current owner brief below supersedes the preserved14UTC paragraph in its historical receiving guide.

## Current instruction authority

CURRENT_OWNER_DIRECTION.md below is version2026-10-13.4 from exact merged revisionf288038ad0a4763f70f71ee9cbef644e8215201b. It supersedes earlier14:00UTC cutoff paragraphs preserved in historical source/docs. Retain historical records; apply this current direction to the present handoff. Do not revive an expired cutoff from an older guide.

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


<!-- bryce-rendered-product-inspection:begin -->

## Standing lab rule: inspect the rendered product before presenting it

Bryce's direct owner instruction, October 13, 2026. This applies to every current and future lab peer, provider, model, harness, local session, cloud session, and delegated or child worker.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation, or export ready, or putting it before a client/prospect, the responsible producing peer MUST open/run/render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare/presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading, and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes ALL attachments. Literally observe the actual thing the way a user or recipient would see and use it: open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, video/audio, archives and project attachments in their normal recipient-facing viewer or application; play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text, and a browser link do not substitute for opening the attachment and using the delivered result normally.

Fix ugly, cramped, broken, unstyled, clipped, overflowing, or unreadable results within the authorized task before presenting them. Favor simple industrial/plain presentation, consistent spacing and typography, readable tables, and working controls. Do not add decorative template slop. Source review, unit tests, HTTP 200, DOM counts, a reviewer/model approval, or an evidence form do not substitute for looking at and operating the real outgoing product.

This is focused internal product validation, never permission to build or submit a proof, test, or verification product, run broad suites, or repeatedly recheck an unchanged accepted version. Building and integrating the actual deliverable remains the main work; do not substitute endless reviews for delivery. Retain an exact-version visual receipt in the handoff: source/head or artifact hash, URL/file, viewport sizes, screenshots actually viewed, controls/states/export files exercised, fixes, and any precise unresolved gap. A changed outgoing version needs inspection of the affected result.

Bryce explicitly clarified: "that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it". A checklist, screenshot folder, receipt, passing test, or parallel review bureaucracy is not the requirement or a substitute for actual observation and normal use. Perform focused fixes and keep shipping the main work; create no review or approval gate.

Bryce also instructed: "also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them". For video/media narration, use available high-quality generative voice/TTS and applicable generative visual/media capabilities when helpful, with natural professional delivery instead of robotic default voices. Actually play/listen/watch the final exported attachment and inspect clarity, pronunciation, pacing, timing, and audio alignment. Reviewing a text script does not substitute for experiencing the final video/audio. This adds no paid-service purchase or real-person voice-cloning authorization; preserve lab attribution and third-party copyright/license controls.

Pass this rule to child/delegated workers and persist it in owner-controlled provider/project/cloud instruction copies. Record delivery and readback coverage; never claim every running session loaded it without evidence. This rule creates no hooks, watchers, restarts, approval queue, credential restrictions, or new publication authority. Preserve all existing owner rules, including no llama.cpp, no private GitHub repositories or Actions, focused validation, attribution, incident communication, personal meeting approval, contact holds, demo pauses, bounty restrictions, and owner cutoffs.

Canonical local policy: `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` and `.json`. Portable repository copy: `docs/policies/rendered-product-inspection-policy.md` and `.json` when present. Only Bryce can change this standing rule.

<!-- bryce-rendered-product-inspection:end -->
