# Audit recipient review and native acceptance

This addition turns an original complete Audit workspace/application export into a recipient review desk. The recipient inspects the original source revisions, writes source-bound review proposals, saves complete authored editions and unfinished work, and returns the unchanged original ZIP plus the whole manuscript. The author previews every proposal against the existing native workspace, then accepts it through the original Workspace.perform review.save API.

It composes the maintained Audit Exchange application, source validation, native review history, original UUID request replay and version CAS. It does not change XML, schema/profile validation, native R analyses or existing sidecar ownership. A recipient status remains an authored proposal until the author explicitly applies the full preview.

## Original source

The selected original native source is the complete56-file Audit Exchange packet, public-commons-sprint-2026 blob04c323df2500ff1d9b715fdc695b56a86d69693c,2630992 UTF-8bytes/SHA256a740a891df9620248eb41174c5a6a8085ea281ab373035908464c057bf300129.

The complete incremental browser hash helper is unchanged from LocalDeviceAgent tools/phone_driver/local-file-hash.js, Gitb8ea94e0c4063ef9d85e27498fa7f07f2d3e6004,17041bytes/SHA2561f2cba58f7bd776025f5eb831a50b0fbf50647d24854e53cb932e8ecf74373f8. It retains its original upstream source and MIT notice.

Add the complete recipient files to the existing SOURCE_FILES.json. Exporting the editable Audit application then carries these complete sources through the original application_members function. Preserve other current manifest members.

## Prepare the complete recipient delivery

Export the existing author workspace through the normal native export.create action with kind workspace or application. Keep the complete downloaded ZIP. Preparation validates the original full manifest and all retained source-revision object bytes.

From the complete installed Audit application directory:

    python3 audit_recipient_review.py prepare \
      --archive /absolute/Audit_Exchange_Application.zip \
      --out /absolute/recipient-delivery

The output contains original-review.zip, Audit_Recipient_Review.html, both UI assets, the unchanged incremental hash helper, RECIPIENT_INPUT.json, RECIPIENT_DELIVERY.json, and Audit_Recipient_Complete.zip. The ZIP is the complete recipient delivery. An existing destination is reused only when every same-named generated file is byte-identical. A different original export needs a separate named delivery directory.

Open Audit_Recipient_Review.html from the extracted complete delivery. The source identity at the top names the original workspace, version and complete archive hash. Original revisions and the delivered native edition are retained. The source inspector exposes actual field literals, exact structural paths, decoded XML text and recorded validation. The unchanged source bytes remain inside original-review.zip.

## Work offline

Create a new review or copy an existing native review. Choose an exact retained source revision and optionally its native entity key. Enter the complete title, original review status, reviewer, assignee, due-date wording, note and evidence links. Existing reviews retain their original complete-head hash and cannot move to another source.

Typing and evidence edits save unfinished work in the existing browser's IndexedDB. Every save uses a revision comparison in the same transaction. A second tab's newer copy is preserved: the conflicting tab retains its own fields, displays the conflict and lets the recipient download that whole working copy before reopening the saved one.

Save complete authored editions deliberately. Every edition contains all review rows and links its predecessor hash. Copying an older edition restores its fields into current work without altering old editions. Removing a row only removes it from the next proposed edition; it does not delete a native review.

Download complete working copies to keep unfinished fields outside the browser. Reopening validates their selected original input hash, source identity, full history and review bindings. Before replacing different work, the application downloads the previous complete copy. The manuscript download contains all saved editions; native acceptance selects its final complete edition.

## Return every original byte

Choose the unchanged original-review.zip and download the complete return. The browser reads the full file in4MiB chunks, checks its original size/SHA256 and creates a stored ZIP with exactly:

- original-review.zip: the entire unchanged native package.
- AUDIT_RECIPIENT_MANUSCRIPT.json: every authored edition.
- manifest.json: exact bytes/hashes and selected source/edition.

A browser with Save File support streams the complete return to the selected destination. The ordinary download fallback is limited to128MiB. Larger complete returns use the same original source and saved manuscript with the native pack command:

    python3 audit_recipient_review.py pack \
      --archive /absolute/original-review.zip \
      --draft /absolute/AUDIT_RECIPIENT_MANUSCRIPT.json \
      --out /absolute/Audit_Recipient_Return.zip

The native source package limit remains the original1GiB. The offline source projection has a128MiB ceiling, manuscript32MiB and complete working copy64MiB. The UI and native receiver validate actual complete encoded lengths. They do not silently truncate source, reviews or history.

## Preview the returned manuscript in the author workspace

Use the actual existing author workspace that produced the archive. The receiver requires its original workspace identity and the original retained source-revision hashes.

    python3 audit_recipient_review.py preview \
      --return /absolute/Audit_Recipient_Return.zip \
      --workspace /absolute/original-author-workspace \
      --operator "Actual accepting operator" \
      --journal /absolute/recipient-acceptance \
      --out /absolute/recipient-preview.json

Read the whole preview. It names the original return and manuscript hashes, source, workspace/version, every complete native review.save request and any already accepted requests. Existing native reviews must still match their complete original head. A changed head is a conflict for explicit human resolution; the receiver cannot silently overwrite it.

Acceptance is the explicit following action:

    python3 audit_recipient_review.py apply \
      --return /absolute/Audit_Recipient_Return.zip \
      --workspace /absolute/original-author-workspace \
      --preview /absolute/recipient-preview.json \
      --journal /absolute/recipient-acceptance

The journal retains the entire return, immutable source selection, complete previews, every full original request and every native result. Requests are saved before the first new review write. The unchanged native API checks an existing UUID's complete body before its version CAS. Repeating the same command therefore recovers the same review IDs without another native review.

A concurrent native edit may stop a partly accepted plan. Preserve the whole journal and run preview again with that same journal and a new output filename. The receiver looks up retained original UUIDs, verifies accepted bodies through exact native replay, and preserves those original requests. A deliberate fresh preview selects new expected versions only for requests confirmed absent from the native store. It never demotes an accepted result or clears uncertain requests. If a locally retained success is absent natively, it stops for original-store reconciliation.

Keep the same journal throughout the return. Losing it also loses custody of original attempted requests; do not substitute another directory and infer a fresh action. The source and native workspace remain the authority.

Once accepted, use the original native workspace/application export. That export contains the actual reviews, complete preceding native review history, sources, original request records and full application source. Include the recipient journal alongside the operating handover so the recipient's complete manuscript and acceptance identity remain reusable.

## Original equipped receiving

The existing6804 Audit commissioning and Audit→LDA receiving operations retain their original workspaces, input/source selection, leases and native owner. This source addition is a following recipient course, not a replacement commissioning. Run the additive recipient receiving driver against the existing completed author workspace and its exact full export, then save the complete resulting operation and customer assets in the same producing lifetime.

No rendered-product or native acceptance result is claimed by source publication. Current ready-state reports must distinguish source publication, actual native acceptance, rendered inspection and completed receiving.


## Complete original-case receiving command

The existing author supplies the current original workspace path, an exact native
workspace/application ZIP and a JSON review plan. The plan is an intentional set
of recipient proposals, not a synthetic source fixture:

    {
      "schema": "commons.audit-recipient-receiving-plan.v1",
      "reviews": [{
        "id": "",
        "sourceId": "the-actual-retained-source-id",
        "revisionId": "the-actual-retained-revision-id",
        "entityKey": "",
        "title": "The recipient's complete proposed review title",
        "status": "investigating",
        "actor": "The actual reviewer",
        "assignee": "",
        "dueDate": "",
        "note": "The complete proposed note.",
        "evidence": []
      }]
    }

Use an existing native review ID for a proposed update. Leave id blank for a new
review. Every other field is present, even when blank. The receiver validates
every exact source/revision and existing native head before opening the product.

    python3 AUDIT_RECIPIENT_RECEIVING.py \
      --workspace /absolute/existing-author-workspace \
      --archive /absolute/Original_Audit_Application.zip \
      --archive-sha256 THE_COMPLETE_ORIGINAL_SHA256 \
      --review-plan /absolute/REVIEW_PLAN.json \
      --directory /absolute/original-recipient-course \
      --operator "The accepting operator" \
      --node /absolute/node \
      --chromium /absolute/retained/chrome-headless-shell \
      --playwright-module /absolute/retained/playwright/index.js

Select actual installed runtime paths; this driver does not install or download
a browser. The current original commissioning owner must finish its analytical
work before selecting this following course. The receiver keeps its own journal
outside the original store and takes an inherited operating lease. It does not
start the analysis worker, change source XML, rerun analytical calculations or
claim a new customer project.

The browser opens the complete actual recipient HTML, operates new/existing
review controls with the supplied proposals, saves all working fields, reloads,
saves an authored edition, opens original XML and source fields, exercises the
empty source search and wrong-original-file rejection, downloads the manuscript
and complete return, and reopens its actual working download. Desktop and
390-pixel views are captured. Full XML and large history details are populated
on opening and released on close. The neutral grayscale interface retains the
complete original bytes and their hashes.

The native part reads the actual downloaded ZIP. It retains the full original
requests before accepting the first review, retains that returned reply
separately, then uses the ordinary recipient apply operation to recover the
same accepted request when its per-request result file is absent. It repeats
the exact acceptance and requires the native workspace version not to change.
It then uses original export.create for the full application, original
workspace.receive into the independent receiving directory, compares every
complete received record under the original native identity mapping, verifies
all source/output objects and original request records, reopens that workspace,
and re-exports its complete application.

The selected operation binds every complete application member by path, bytes and SHA256. Completed browser results verify all retained download/image members before reuse. Parent signals latch; the browser closes its actual context, while the parent tracks and drains its original descendant PID/start identities (including separately grouped Chromium) before releasing the inherited lease. After RUN_RESULT.json is durable, an interrupted packaging phase resumes only the original closed files and archive; it does not reopen the native store or append browser logs.

The completed archive includes original ZIP, exact proposal plan, complete
application source, browser working files/manuscript/return/screens, acceptance
journal, full author/received application exports and the received native
workspace. Live lock files and reproducible browser profile are omitted;
complete editable work and its identity are retained. A failed run leaves the
same inputs, complete requests and browser working files for continuation.

A retained COMPLETE.json is reusable only after its original input and whole
archive identity match. The native result deliberately leaves
renderedRecipientReady false until the producing operator personally opens and
looks at the captured images and operates/opens every outgoing attachment.
The full standing rule below applies; capturing an image is not viewing it.

## Required outgoing product and attachment inspection

Bryce's original rule is C0BU51F1PL3/1791881496.221999, with attachment addition1791884278.483419.

Before describing a client/prospect-facing app, website, dashboard, demo, report, presentation or export as ready, its producing peer must actually open, run or render the exact outgoing version, LOOK at the screen or real screenshots, and operate the important controls. Inspect the actual screenshare/desktop and narrow/mobile layout where relevant; populated, empty, loading and error states; real downloads/exports and reopening. Capturing screenshots without viewing them is insufficient.

Open, see, play or use ALL outgoing attachments as their recipient would. A review or checklist cannot replace that experience. When the deliverable is video, use available generative media and natural-quality TTS where appropriate, then watch and listen to the complete final exports.

Repair broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work. Use readable tables, clear hierarchy, consistent type and spacing, restrained controls, useful labels and responsive layouts. Code review, DOM counts, HTTP200, unit checks and peer approval do not replace seeing the actual product.

Keep real workflows, source data and computation intact. Do not turn this into endless rechecking or a separate verification product. Preserve existing owner controls and vendor policies; do not force restarts, add watchers or revive work the owner stopped.
