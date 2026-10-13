# Complete native receiving repairs — 13 October 2026

This companion carries twelve complete application files for the existing native receiving operation. The immutable [976-file source](receiving-union-20261013.source.json), its original bytes and ordered parts remain unchanged. The original Source-water receiver completed all six queued actions and both independent restores; this source continuation preserves that result.

## Receive the complete source companion

The [repair bank](native-actual-repairs-20261013.source.json) is a standard `commons.source-bank/v1` object with application-relative paths and complete UTF-8 file bodies. This third edition is **572,077 bytes**, SHA256 `761db215d54bf93ecc8568740c3d3a1521ffdc7591ae70ca0a6fb6fabbe56c1c`; its twelve source files total **540,164 bytes**.

The original [metadata-only inventory](receiving-union-20261013.inventory.json) lists every frozen path, byte length and SHA256. Its exact 180,762-byte body has SHA256 `20d48551e4a7a840e7d5ad7a1b1048ab49086e0f00d2e088efde63fd656acf57`. An equipped receiver can compare an already retained application against this inventory before transferring the full source packet. The inventory describes the original frozen edition; it is not a command to replace later installed source.

Verify each full bank and each member's UTF-8 bytes and SHA256 before placement. Use the existing equipped publisher's ordinary public-Git → actual local file → authorized receiving-file route. Preserve current source publication and application/Workspace owners.

| Complete source | Original change | Receiving effect |
|---|---|---|
| `model/monitoring_comparison_report.py` | PR4200 | Corrects the actual native import failure and retains complete utility context. |
| `operator/web/spatial.mjs` | PR4152 | Applies map aspect and swipe geometry through trusted CSSOM under the original CSP. |
| `model/cartography.py` | PR4190 | Separates scale notes and legends and preserves geographic aspect. |
| `model/implementation_qc.py`, `model/implementation_qc_actions.py`, `model/review_handback.py` | PR4132 | Retains the matching complete recipient/QC source family. |
| `operator/receptor_operator.py`, `operator/web/receptors.mjs`, `operator/extensions/receptors.json`, `operator/RECEPTORS_OPERATOR.md` | PR4252 + PR4261 + PR4290 | Embeds verified original image companions in the authenticated printable view and prepares nested report links before wrappers. |
| `operator/delivery_preview.py` | Existing unchanged dependency | Provides the original bounded image parser and policy used by the preview repair. |
| `model/study_transfer.py` | Actual operated PR4230 lock block, composed into frozen source | Prevents reacquiring the same native lock while preserving the original frozen imports and family behavior. |

Each member records `frozen_976_sha256`, or null if the frozen bank did not contain the path. Reuse an installed identical body. A body matching its exact frozen predecessor can receive the complete successor at its owning worker's application boundary. Preserve a different newer installed body and compose with its current owner.

## Materialize the requested metadata comparison input

The equipped SOURCEPATH13 receiver requested one compact gzip/base64 form of the exact inventory after its connector returned the original JSON as text. [receiving-union-20261013.inventory.encoded.json](receiving-union-20261013.inventory.encoded.json) is that same inventory: envelope **99,541 bytes**, SHA256 `376f8590fbf273f104e25b26558b61b1bb5f35b95d59ed810d17e3673ae3fe04`; gzip **74,374 bytes**, SHA256 `fa5251718f41896e205b91b39d3dbb62cc0b7141e64cbb2359dd42ec88f3e84b`. The decoded metadata remains the original **180,762 bytes / 20d48551e4a7a840e7d5ad7a1b1048ab49086e0f00d2e088efde63fd656acf57**.

At that receiver's actual local-file boundary, save the complete returned envelope as one file and use the standard-library decoder below. The two arguments are the actual envelope file and an owned metadata destination. The decoder verifies gzip/CRC and the fixed original SHA before writing, reuses an identical output, and preserves a different existing file.

```sh
python -B - ACTUAL_ENVELOPE_FILE OWNED_INVENTORY_FILE <<'PY'
import base64
import gzip
import hashlib
import json
import pathlib
import sys

source = pathlib.Path(sys.argv[1])
target = pathlib.Path(sys.argv[2])
envelope = json.loads(source.read_text(encoding="utf-8"))
if envelope.get("encoding") != "gzip+base64":
    raise ValueError("Expected the original gzip/base64 metadata carrier")
raw = gzip.decompress(base64.b64decode(envelope["content_base64"], validate=True))
expected = "20d48551e4a7a840e7d5ad7a1b1048ab49086e0f00d2e088efde63fd656acf57"
if len(raw) != 180762 or hashlib.sha256(raw).hexdigest() != expected:
    raise ValueError("Original inventory byte identity differs")
inventory = json.loads(raw)
if inventory.get("schema") != "commons.source-inventory/v1" or len(inventory["files"]) != 976:
    raise ValueError("Original inventory schema or file count differs")
if target.exists():
    if target.read_bytes() != raw:
        raise FileExistsError("Preserve the different existing inventory: " + str(target))
else:
    with target.open("xb") as output:
        output.write(raw)
print(json.dumps({"path": str(target.resolve()), "bytes": len(raw),
                  "sha256": expected, "files": len(inventory["files"])}))
PY
```

Feed the resulting unchanged `commons.source-inventory/v1` JSON into the existing original-source comparison against the physically retained application. Return exact matched, missing and different-edition paths/hashes to the same SOURCEPATH3434/4036 operation. The original source owner supplies exact missing bodies; newer installed peer editions stay authoritative. The existing full-packet publisher retains its already-issued operation.

### Archive-lock source boundary

The included dispatcher is **62,501 bytes**, SHA256 `84d8d08f578da1deceebc74cf5f3f45cb3a38e11595d24560ca1a6d005963e77`, Git blob `4841c4691aea2c880fcec112f4213cd12a6cd762`. It changes only the actual native path-token lock block in the frozen **62,180-byte** predecessor, SHA256 `54d6f27b873b94fb0fe6be8120743134fa2621f87f0e4cbde237411e1ceb2ef6`. Reversing that one block reconstructs the exact frozen body.

Current public PR4230 also has a newer 64,931-byte dispatcher with Parameter and source-refresh additions. Keep that newer installed edition and its dependencies. This bank's frozen-compatible composition introduces no Parameter import and does not replace that current source. The actual completed receiver already has its working lock correction.

### Authenticated printable links

The final scoped preview successor, PR4290, permits same-origin identity only within the generated, script-free preview sandbox. This keeps the ordinary Strict session cookie available when the user follows a nested report or downloads an attachment. Default source access remains none; scripts and forms remain disabled, and original images remain verified data images. The generic file route and original downloadable files are unchanged.

During the existing visual handback, follow the complete actual sequence: saved report → Printable view → original child report → original attachment. Use the same authenticated application. This checks the specific browser transition found in the native product; original scientific/source editions and completed archives remain reusable.

## Completed original native receiving

[Actual receiver return 1791892773.135729](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791892773135729) completed all six original Source-water actions: scientific report, source ZIP, full Workspace backup, independent full restore, selected editable Study export and independent selected restore.

- Original project: `b9d5d257-c6bb-4f07-b975-8e8c63705db3`.
- Original network: `5a02c70737ff8b11c0a3ecf1faa83f76f5b96e3df53e3514caed27a04f944b81`.
- Prepared areas: `10e3fd4fb59c10dfcd4bb3e3b32aacaed003bac941144e9b6985ff9bf6143f26`.
- Saved source report: `fb27115004057e75dd1d20ded55f2eb8bf8c16c6af5eb773411637999ee44f3f`.
- Scientific report: `721a4ab550e4c3a199bbaf9bbea47d6471fb713fa836d970941030f05b3032a1`.

The same native owner is completing the final handback of those already-produced report/archive files and original receiving receipt. The separately returned protection-area Study contains four protection polygons; it remains distinct from the source-water product's 4 ARJWS and 32 PRWD upstream areas.

Keep all completed native products and task history. In the existing final operator handback, open the saved Source-water card's Printable view, follow original network/prepared/profile links, look at embedded maps and print output at desktop/screenshare and 390px, and open every delivered attachment. The preview source changes display transport; it preserves the original scientific/source files.

For a separate interrupted copy of the original receiving operation, retain its original selector, Workspace and output directory and continue with its maintained `--resume` option. Its immutable `source-water-selection.json` identifies that operation. Changing an existing `--prepared` selection into `--report-id` changes the request; a separate explicit report-ID request belongs to a new output opening the already saved source. Retain any concrete native exception and actual elapsed history.

## Source edition and owner direction

The base packet is a coherent historical receiving snapshot. Its explicit Published studies metadata and included files identify the 444-member edition; inherited earlier notes retain older counts and custody. Current public-main families advance independently. Use actual bank files/hashes for the frozen source and the native owner's receipt for current Workspace custody.

The consuming guides remain `source_tools/RECEIVE_RECEPTOR_REPORT.md`, `source_tools/ORIGINAL_SOURCE_WATER_RECEIVING.md` and `operator/RECEPTORS_OPERATOR.md`. Current owner direction is `CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.3`, original Git blob `8cd1c1f3d371a2fb75471813844e31f489aa8272`. The actual geographic model stays with its active calculation owner; this report/source continuation reuses the retained original products.

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

# Current owner direction: Ecosystem Sciences demonstration

Version: `2026-10-13.3`. Owner: Bryce / TokenJunkieLabs. Direction for the Upper Savannah application, demonstration, presentation and work orders. Continue the broad build without arbitrary feature/scenario caps. Preserve today's cutoff: **October 13, 2026, 10:00 a.m. Eastern / 14:00 UTC**. Do not pause work or extend the sprint.

## Direct owner instructions

> do the simulated model

> just make sure that what we put infront of him is something he would need and want and he will be blown away how relevant it is to him and how he wants it,a nd also the speed we produced it

> just checking dont pause anythi g

> and make sure wherever the fleet is coordinating in slack or github or wherever on this demo / presentation / ecosystem gets that update toand passes it along to other agents because the feed may be moving fast

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

Pass this complete brief into every current child, provider and cloud work order and handoff. Include its durable path and version `2026-10-13.3` with the next result. Relay it at the actual coordination surface and onward to participating workers; fast feeds can bury an update. Acknowledgment alone is not delivery.

Preserve active compute and existing implementation ownership. Do not force worker restarts, drop an active run or create a new controller. Keep lab attribution, source/copyright, incident and contact controls, personal-meeting approval, no private GitHub/Actions, no llama.cpp and focused internal validation. No new approval gate or broad test sweep is authorized.

