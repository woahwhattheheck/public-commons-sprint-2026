# Actual browser operation and complete attachment receiving

This guide accompanies the exact Application Packet Workspace product. Reuse the existing application-packet receiving operation, its retained directory, browser profile, copy identity and outputs. The callback operates ordinary UI controls and saves the whole workspace. It does not create a controller or a second writer.

## Standing owner requirement

Before calling the exact outgoing product ready, the producing worker must open/run/render it and personally LOOK at the real screen or actual screenshots. Operate important controls at 1440 px desktop and 390 px narrow width. Inspect loaded, empty, loading and error states; download complete products and reopen them.

This applies to ALL attachments: use the actual HTML application, every applicable PDF/report page, readable source files, original binary files in their normal viewers and the usable complete ZIP contents. View the captures; collecting their paths is insufficient. Keep the complete original files and application context.

Repair concrete unreadable, clipped, overflowing, broken, unstyled or cramped output in the implementation. Keep industrial plain typography, usable controls and full content. Source checks, unit assertions, HTTP success or a peer approval do not replace looking and operating. Do not turn this into a separate verification product or expand to a broad test suite.

If media is added, use available high-quality generative voice/TTS and appropriate generative media, then play/listen/watch the exact final export. Do not substitute a script read for experiencing the exported media. Preserve authorization and attribution.

## Inputs and executable build

Use the complete same-version source directory, including engine.mjs, the exact retained sha256.mjs and these eight application leaves:

- portable.mjs
- app.mjs
- style.css
- template.html
- build.mjs
- cli.mjs
- README.md
- BROWSER_OPERATING.md

The root-owned demonstration-workspace.json is authored software data, not a government filing or a native target result. It exercises two same-name subjects, complete source/requirement selection, a partial then complete correction cycle, actual engine acceptance, two typed native rows, return coverage and seven original files including the full 0..255 binary sequence. Preserve its original identity and operation history. It is suitable as the source-native software receiving input; actual operator files are imported through the same original-file controls.

Build an empty and a complete selected working application with Node 22+:

    node build.mjs --out RECEIVING/empty
    node build.mjs --workspace demonstration-workspace.json \
      --copy-id ORIGINAL_RECEIVING_COPY_ID --out RECEIVING/working

Use the actual retained browser executable/Playwright installation from the equipped owner. No browser download, global install or account change is required by this product. The exact generated HTML is standalone; use a stable file URL in the receiving profile. If the operator serves files locally instead, retain that original origin.

## Bootstrap and native state

The HTML has a JSON element #application-boot:

    {
      "source": {"engine.mjs": "complete source", "...": "..."},
      "record": {
        "schema": "commons.application-packet-recovery.v1",
        "workspace": {"schema": "commons.application-packet-workspace.v1", "journal": []},
        "drafts": {},
        "selection": {"section": "workspace", "caseId": null, "instanceId": null},
        "copyId": "original-browser-copy"
      },
      "copyId": "original-browser-copy"
    }

record is null in the blank application. The complete embedded source is required for working-HTML and source exports. Seed the exact recovery envelope; do not invent a projected operations array.

The logical workspace ID belongs to the original engine history. copyId selects a local saved copy. The application uses IndexedDB application-packet-workspace-v1 stores copies, drafts and branches. A stable boot.copyId reopens its saved original copy and retains newer descendant operations after a callback interruption. Existing divergent local copies remain independent.

The workspace engine journal uses sequence for revision and action for the saved mutation. Header #workspace-revision says "Revision N". #identity has data-copy-id. Actual operation history is under record.workspace.journal. A callback checkpoint must save the complete recovery record, including drafts and selection.

## Stable ordinary control surface

Navigation buttons use data-section:

| Section | Value |
|---|---|
| Workspace & delivery | workspace |
| Files & sources | sources |
| Requirement editions | requirements |
| Cases & subjects | cases |
| Scope & form instances | scope |
| Forms & evidence | forms |
| Corrections | corrections |
| Review & handover | handover |
| Native import & returns | native |
| History & recovery | history |

The actual operator input is #operator-name. The current case select is select[name="caseSelection"]. It appears on case-specific sections.

Top downloads are on the workspace section:

| Control | Stable selector | Complete product |
|---|---|---|
| Download working HTML | #top-working-html | Application_Packet_Workspace.html |
| Download recovery JSON | #top-json | Working_Recovery.json |
| Download complete ZIP | #top-zip | Application_Packet_Complete.zip |

A checkpoint may navigate to workspace, download #top-json and restore the previously selected section. The form being edited retains its own raw values before navigation. Wait until its IndexedDB draft write settles through the same UI download; do not replace this with reading a partial rendered projection.

Mutation forms use form[data-action="NAME"] with a normal button[type="submit"]. Names are:

| Mutation | data-action | Key form controls |
|---|---|---|
| Retain files | addFile | textarea[name=purpose], input[name=files] |
| Source edition | addSource | title, publisher, url, issued, retrieved, note, supersedes; sourceFiles:FILE_ID checkboxes |
| Requirement edition | addEdition | title, facilityType, applicationType, note, requirements JSON; source:SOURCE_ID |
| Case | createCase | title, reference, details, editionId |
| Case facts | updateCase:CASE_ID | title, reference, details, reason |
| Adopt edition | adoptEdition:CASE_ID | editionId, reason |
| Subject | addSubject:CASE_ID | label, role, reference |
| Full scope | setScope:CASE_ID | note, reason:REQUIREMENT_ID, subject:REQUIREMENT_ID:SUBJECT_ID |
| All missing instances | addInstances:CASE_ID | submit after reviewing the selected combinations |
| Form values | setInstance:INSTANCE_ID | applicability, reason, present:FIELD_ID, value:FIELD_ID, evidence:FILE_ID |
| Form review | reviewInstance:INSTANCE_ID | outcome, note |
| Correction round | openRound:CASE_ID | reference, deadline, note, requestFiles:FILE_ID, include:INSTANCE_ID, request:INSTANCE_ID, field:INSTANCE_ID |
| Response | respond:ROUND_ID:ITEM_ID | message, responseFiles:FILE_ID |
| Response decision | decideResponse:RESPONSE_ID | outcome, note |
| Handoff | acceptCase:CASE_ID | note |
| Native contract | addNativeContract:CASE_ID | title, contractFiles:FILE_ID, tables JSON, lookups JSON, note |
| Native mapping | mapNative:CONTRACT_ID | scope:INSTANCE_ID, reason:INSTANCE_ID, tables JSON, note |
| Native result | recordNativeReturn:MAPPING_ID | reference, outcome, note, returnFiles:FILE_ID, records JSON |

Names containing colon are literal HTML name values. Use an attribute selector with quotes. Do not substitute partial text matches where two same-name subjects are present. Instance buttons have data-instance-id; case-opening buttons have data-case-id. The original saved IDs determine which record is edited.

Important rendering details:

- Text/decimal/integer/date fields preserve raw string writing.
- present:FIELD_ID distinguishes missing from explicitly empty.
- Booleans use exact "true"/"false" choices, including explicit false.
- A choice value retained from an earlier source is shown as a retained value rather than silently cleared.
- Native row bindings and export identity appear in the full export assessment. Downloaded CSV names use table-<actual_table>-<SHA256-prefix>.csv; portable assessment maps safe aliases to the original native paths.
- Scope creation is explicit; missing form instances are created only by its ordinary save action.
- Reviews bind the saved form, not the adjacent unsaved draft.

## Complete original operation course

Use the prepared fixture and original retained inputs to operate the whole useful path, rather than adding hundreds of implementation-mirroring checks.

1. Open the blank HTML at desktop width, inspect hierarchy/empty controls, and create a named workspace. Retain an original file through the normal chooser, then download and open that exact file.
2. Open the complete source-native working HTML. Inspect its actual source editions, both same-name subjects, full scope, form values and evidence. Check explicit false/zero, an absent field and an empty field where selected.
3. Type an unfinished correction note and an incomplete typed value; navigate away/back, download working HTML and recovery JSON, then reopen. Confirm original writing remains available before deciding whether to save it.
4. Save a complete current form amendment, use its exact saved basis for response and review, finish the correction round, and record handoff acceptance. View the prior original response and review history as well as the current state.
5. Open the actual native contract and mapping. Download its exact CSV and assessment with rowBindings. Observe the saved original native result file and exact mapped return identity/coverage.
6. Make a later complete case edit. Inspect stale review/mapping status and confirm the originally exported CSV remains downloadable unchanged. Preserve the original return history.
7. Open the same local copy in another tab. Keep distinct unfinished values in each. Save one tab first, then submit the other from its original revision. Observe the explicit branch recovery screen, download both complete versions and continue one as a separate copy. The original saved branch and draft values remain.
8. Reopen an older working HTML at the original copyId after a newer local save. Confirm the newer saved descendant remains the active history. Open a different incoming JSON and confirm its separate local-copy behavior.
9. Download the complete ZIP, working HTML, recovery JSON and full source. Unzip and open Packet_Review.html with its original-file links intact. Expand/use relevant controls, print/render the full report, open applicable original PDF pages and binary/media originals in appropriate viewers. Reopen the working files from the downloaded output, not only the live browser.
10. Repeat the affected key screens at 390 px: form editor, correction response, native result, saved-copy/conflict choices and readable review. View the resulting desktop/mobile screenshots personally.

Keep original callback actions and browser copy identity across an interruption. An action already saved in the journal is continued from the saved native state. Do not replay a different mutation merely to recreate an earlier screen; use the originally saved/downloaded edition for historical views.

## Output to preserve in the original programme

Preserve the actual opened HTML identity and final source/head, complete recovery JSON, working HTML, complete ZIP and full source, native CSV/assessment, original-file downloads, complete readable report and report page output, actual desktop/mobile screenshots, and the original operation journal. Retain every byte; do not replace whole artifacts with hashes or screenshots.

The visual note is concise: exact outgoing version, actual browser and file URL, viewport sizes, screenshots personally viewed, controls/states and attachments actually used, concrete repairs made, and any precise remaining runtime issue. It accompanies the product and does not substitute for it.

If this chat seat lacks a native browser, the existing equipped receiver performs the original course and returns actual images. The producing peer then opens/views those images and gives source corrections tied to the exact artifact. Keep that one native receiving path active; there is no extra approval ritual, new daemon or parallel owner.
