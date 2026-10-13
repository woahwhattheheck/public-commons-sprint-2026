# HCPS response production desk

This application carries the complete response-preparation work for HCPS 0562FAC-RFQ-2027, Category D Commissioning. It contains the full retained readable derivative of the 41-page RFQ, the reviewed response-production guide, all 56 source-linked requirements and the complete 12-slide, 225-second presentation course. Operators add the actual firm facts, signed forms, project evidence and issued visual sources.

The application is an editable production desk. The original requirement wording stays attached to every decision. A reviewed edition retains the entire current response, presentation, document selection, page assembly and attribution. The recipient can open a complete delivered HTML application, continue its original history and send the whole work back.

## Open the complete application

Open the supplied **application/HCPS_Response_Desk.html** directly in a current Chrome or Edge browser. This complete prebuilt file contains the exact application and all original seed sources.

To reproduce the same application from its complete editable source, use an existing Node.js 22 or newer runtime:

~~~sh
node BUILD.cjs /absolute/owned/application
~~~

Open `HCPS_Response_Desk.html` in a current Chrome or Edge browser. The build writes the exact application identity and source member identities to `application.json`. It uses native Node/browser APIs and no external JavaScript packages.

The browser retains named independent working copies in IndexedDB. Full original documents live once per complete SHA-256; reviewed editions reference their original byte objects. **Download current work** retains the full current response and every unfinished editor even when storage has a recoverable conflict. **Save independent copy** carries that complete page state into a separate local copy.

The application disables actions while opening the complete source and storage. Ordinary edits queue complete snapshots; closing while a snapshot is pending prompts the browser to keep the page open. A concurrent window cannot silently overwrite a saved copy: the IndexedDB transaction checks its actual stored revision. A conflict leaves the current page content available for whole download or an independent copy.

Use the complete download as the handover. Browser-local storage is tied to the browser profile and origin; opening the same ordinary application on another computer does not move local data automatically.

## Original source and current solicitation

The four immutable seed members are:

| File | Complete content |
| --- | --- |
| HCPS_0562FAC_Original_RFQ_Readable.txt | Full readable RFQ derivative, 123,496 UTF-8 bytes; original public URL https://aptg.co/sc9KJt. |
| HCPS_0562FAC_RESPONSE_PRODUCTION.md | Full reviewed response-production and commissioning task-order guidance. |
| HCPS_0562FAC_REQUIREMENTS.json | All 56 requirements with page, clause, applicability and completion basis. |
| HCPS_0562FAC_TIMED_PRESENTATION_SCRIPT.json | All 12 positions, full editable text, source notes and original 225-second timing. |

Every open, import and native package verification checks all four whole source hashes. The RFQ derivative retains its original representation. The actual physical page 13 selection matrix and the sample-summary hyperlink target require the original issuer files; the source-review panel records those actual document IDs, reviewer and complete observed basis. It never fills missing visual criteria from a text approximation.

The retained original source states a nonmandatory Q&A on October 14, 2026 at 09:00, questions on October 28 at 08:00, and responses on November 6 at 15:00. Use the issuer's actual local schedule and any subsequent addenda. The response matrix keeps the original timing requirements and current applicability decisions separately.

The complete response goes through VendorLink under the issued instructions. The application prepares files and review records; its interface has no external submission action.

## Complete response workflow

1. Open a new response and enter the approved legal firm name, response contact, current reviewer and purpose.
2. Read **Issued source**, then review all 56 original requirements. The original text, page, clause, applicability and completion basis remain visible beside the editable decision.
3. Attach complete source PDFs, signed forms, licences, three required outside references and supporting records in **Original documents**. Enter the literal source URL and note where useful. The page displays the full original filename, document ID, byte count and complete hash.
4. Select a requirement and record its state, full response or applicability decision, reviewer, date and exact evidence selections. Use retained document IDs plus source pages/locators. **Apply response decision** commits that working content; unfinished text survives reload until applied or deliberately discarded.
5. Complete the presentation with approved firm facts and actual experience. Keep the source notes and full section summaries visible while editing.
6. Bind the original physical selection matrix and sample-summary review to their actual attached files in **Source reviews**.
7. Enter the exact one-based PDF page order in **PDF assembly**. Retain the actual signed cover first and actual signed checklist second, followed by the issued checklist order.
8. Review the complete remaining-item list. Save an immutable edition with reviewer and full purpose. Download the whole editable application or reviewed workspace for another reviewer.

A requirement marked complete has a reviewer, date, full basis and retained source evidence. A not-applicable decision has an explicit reviewer/date/basis. These are operator decisions tied to original documents. The readiness list does not create a firm's signature, qualification, project history or engineering certification.

## Document and history limits

The desk accepts at most 200 selected documents, 32 MiB per complete file and 128 MiB of selected bytes in one edition. Complete retained byte objects across all editions are limited to 512 MiB. It retains at most 128 reviewed editions.

The intake checks both the selected edition and the complete historical object capacity before replacing the working content. Reusing an identical original object preserves its exact bytes without another stored object. Earlier editions continue to reference their own full files even after the operator continues a different historical selection.

These are this response desk's storage limits. They do not modify the issuer's upload requirements.

## Timed presentation

The issued requirements permit one separate PowerPoint, Flash, HTML or similar presentation, prohibit automatic start on opening, and require playback to run without viewer input within four minutes after execution (RFQ page 11, §4B(2); original R22–R24). The supplied complete HTML player opens at its first slide with a single **Start presentation** control. It advances the 12 slides automatically and completes after the selected durations, originally 225 seconds.

The editor retains complete visible text and production notes for every slide. Notes stay in the editable source; visible slide content is the material played for the viewer. Four explicit section summaries remain in the course. An unfinished field must be applied or deliberately discarded before exporting playback.

The exported player is visibly marked as a production draft while source reviews, approved facts or requirement decisions remain open. Its playback record binds the actual rendered configuration, slides and complete draft by SHA-256. It names a reviewed edition only when that edition's saved draft is the actual rendered content. A later edit or continued earlier edition cannot inherit an unrelated latest-edition label.

Open the exported player and watch the complete elapsed-time course. Review desktop and narrow-screen layout, every slide's text, summary order and actual final duration. The **Download playback record** control appears after completion, and retains the real transition/visibility trace. A browser tab that was hidden during playback records that fact.

## Exact original-page PDF assembly

Download the complete reviewed workspace JSON, then run:

~~~sh
python3 ASSEMBLE.py /absolute/Complete_Workspace.json \
  --out /absolute/new-response-assembly
~~~

This uses Python 3.11+, an existing `pypdf` installation, and the supplied Node verifier. Set `HCPS_NODE` or pass `--node` for the installed Node executable. To assemble a specific immutable edition, add `--edition 3`.

`VERIFY.cjs` verifies the complete package hash, all four original source members, every retained original document, all immutable edition hashes and the explicit selected page order using the same application model. Python then confirms the package bytes did not change and copies the actual PDF page objects into `Complete_Response_Original_Pages.pdf`.

The new output directory contains:

- The combined PDF in the selected page order.
- Every selected complete original PDF beneath `originals/<complete-SHA256>.pdf`.
- `Original_Complete_Workspace.json`, retaining the exact incoming package.
- `assembly.json`, with every full original filename, source hash, original page number, output page number, actual draft identity and readiness result.

Original file names stay in the metadata without being forced into a filesystem basename. Complete original PDF bytes remain unchanged in the object files. The combined PDF necessarily has its own container identity. It copies the selected original page content; it does not sign forms or replace the original certification.

Open and render every resulting page, inspect the complete checklist order, and verify the separate SF330 Part II page 6 file required by the original RFQ. Preserve the issuer's actual response file separation and filenames when preparing the final upload.

The assembler writes complete candidates, flushes them and atomically creates each destination. An identical existing complete output is adopted; a different output requires a new destination. Interrupted partial candidates never become the final source record.

## Editions, comparison and recipients

**Save reviewed edition** retains the complete current response with reviewer, note, time, full content hash and prior-edition hash. It does not require pretending the response is submission-ready: a reviewer may preserve an honestly incomplete production edition with its open requirements.

**Continue selected edition** copies that historical content into the current working selection while retaining the entire prior chain. **Compare complete content** includes every changed response, slide, source selection, page order and review field. Missing fields and explicit values remain distinguishable.

There are three full handover formats:

| Download | Recipient receives |
| --- | --- |
| Working copy + unfinished fields | Complete workspace, original bytes and all history, plus unfinished editor text and current UI selection. |
| Reviewed workspace | Complete model package after unfinished editors have been applied or discarded. |
| Complete editable application | One self-contained HTML file containing the entire application, all original source/documents, complete saved history and unfinished fields. |

Opening a received complete HTML application creates an independent local working copy. Reloading that same incoming HTML reopens its already-retained copy by the whole incoming package hash. It does not create a new copy on every reload. A recipient's new edition appends after the original chain. Incoming package identity and receiving time remain in the complete custody history.

The original application source remains separately available as ordinary editable files. The HTML download carries the full operative code needed to continue this exact product without a server or source repository.

## Complete original receiving course

The included course performs actual model, browser and recipient work using the complete retained public RFQ source. It retains the source exercise's deliberately incomplete firm facts as such. It does not mark an unsigned response or unseen original visual matrix as approved.

Use one existing equipped Linux host with:

- Python 3.11+, `pypdf` and Poppler `pdftoppm`.
- Node.js 22+.
- An existing Playwright installation and Chromium executable.

For a host using its existing browser executable and runtime module location:

~~~sh
export HCPS_NODE=/absolute/node
export HCPS_PLAYWRIGHT_REQUIRE=/absolute/node_modules/playwright
export HCPS_CHROMIUM=/absolute/chromium
python3 RECEIVING.py --case /absolute/owned/hcps-original-receiving
~~~

The original Python controller owns `operation.lock`; Node and the native PDF/verifier descendants inherit that same descriptor. Repeat the same command and directory to continue the original operation. It retains the same loopback origin, browser profiles, source/edition checkpoints, complete outputs and per-attempt visuals/logs. It verifies full completed output inventories before adoption.

The course performs:

1. Original complete source/document intake and two immutable native editions.
2. A PDF rendering of the entire readable RFQ derivative, explicitly labeled as that representation.
3. Real browser response editing, unfinished requirement/slide/source-review text across reload, original file intake, page selection and the third reviewed edition.
4. Actual whole elapsed-time 225-second playback, observing every one of the 12 slides, plus complete editable application download.
5. Opening that delivered application in an independent recipient profile, reloading the same copy, preserving all original bytes/history, editing a response and saving the fourth edition.
6. Native assembly of actual retained PDF pages, with full source-page mappings.
7. Rendering every page of both the complete derivative PDF and the assembled output, and retaining desktop/390-pixel application captures.

The course keeps `events.jsonl`, every completed stage record, complete original and recipient packages, all actual screenshots/rendered pages, source files and a full original-case archive. `COMPLETE.json` records the native/browser course; `VISUAL_COMPLETE.json` additionally records full PDF renderings. The final `archive.json` identifies the complete source/results archive by exact bytes and SHA-256.

Read the actual output before reporting execution completion. An unstarted or interrupted course retains its same source and operation for continuation. The supplied source programme is reusable; its existence alone is not a native result.



## Issue a saved edition for prime or colleague review

Open **Prime review and returns**, select one complete immutable edition, enter a clear review purpose, and choose **Issue complete reviewed edition**. The current named reviewer provides the issue attribution. The application retains the exact complete issued JSON file and its selected baseline identity before offering the download.

Give that whole file to the colleague. They open the same response desk, use **Editions and receiving → Receive and reopen complete work**, choose the issued file, and continue their independent local copy. Their original receiving history binds the exact issued-file hash. They can change requirements, presentation wording, source documents, evidence and page order, save their own reviewed editions, and return **Download working copy + unfinished fields**. That download also retains their unapplied text and any unfinished return-review work.

The author keeps the original issuing working copy. A file from another workspace, another seed edition, an unrelated baseline or a copy without the exact original receiving link cannot be silently joined.

## Review the complete returned work

1. Choose **New independent return review**. Select its exact original issue and the complete returned JSON file. The whole file is retained immediately in this existing working copy.
2. Name the reviewing author and state the decision purpose. Choose **Compare complete original sources**.
3. Expand changes to inspect the complete issued baseline, current author value and returned colleague value. Requirements, slides and documents match their original IDs. Independently added records with a colliding ID, deletions, changed fields, absent fields, explicit null values and exact JSON types remain visible.
4. Choose current, returned or a complete custom value for each listed change. **Keep all current author changes** and **Select all returned changes** are deliberate whole-side selections; they can be refined item by item. Document additions/removals and the complete chosen document order must agree. Requirement evidence, source reviews and PDF assembly must still reference actual selected documents.
5. If the incoming working copy contains unapplied editor text or unfinished return-review work, inspect the complete original and the downloadable unfinished-editor envelope. Acknowledge the retained material before deciding from its applied content.
6. Prepare the complete review plan. The ordinary response validator checks the assembled entire response, including all56 original requirements, all12 slide IDs/order, four summary flags, the240-second duration and complete source/evidence references.
7. Resolve changed-material decisions. A completed/applicability decision that mixes content and evidence beyond either complete attributed side must be explicitly reopened or reviewed again. The same rule applies to a reviewed matrix or sample-summary source whose document/review material changes. **Explicitly reopen all changed-material decisions** creates visible reopening choices; prepare the plan again to inspect their result. Individual review JSON records the named reviewer, date where relevant, reason and complete decision basis.
8. Choose **Apply exact plan as reviewed author edition**. One immutable edition appends to the author's existing history. It retains the full before/after draft, every explicit choice, material-review decisions, exact issue/return identities and the entire original returned file. The colleague's separate edition chain stays within that whole preserved return.

The comparison and plan each bind the actual complete author workspace and returned original. Changing the author content makes a prior plan stale. The application never silently applies an earlier comparison to newly changed source.

### Preserve incomplete decisions and recover the original action

The existing IndexedDB working-copy journal retains the full returned file, selected issue, all choices/custom JSON, material-review text, comparison and plan. Reloading reopens the same review copy. Choosing another review preserves its predecessors. Complete working-copy and editable-application downloads carry these unfinished decisions with the original documents.

Issue and Apply retain an exact original request before computing and committing the result. **Recover original issue** and **Recover original apply result** reuse that request. A saved result returns its original issue or edition identity.

If the author source changed before a pending Apply committed, **Recompare changed author content independently** first checks for the original saved result. When no saved result exists and the complete author workspace differs, it preserves the whole earlier request in the old review copy and opens a distinct review copy. The new comparison retains a prior choice only when the complete corresponding baseline/current/returned cell is still identical. It does not reinterpret the old request as a new mutation.

The recovery control stays visible independently of the comparison panel. Source selectors and choice editors are disabled while that review has an unresolved retained action. Independent working copies and complete downloads remain available through the original desk.

### Retained source and history limits

The original per-file32MiB and selected128MiB limits remain. An author copy may retain at most128 issued/returned original archives and128 saved return decisions, within the existing128-edition limit. Its complete decoded document objects plus literal UTF-8 issued/returned archive bodies share a512MiB retained-history budget. Incoming custody nesting is limited to16 generations.

The complete archive history is checked on open, export, native verification and receiving. It reconstructs every retained review from the exact archived issued/returned sources and explicit choices, then compares the complete result with its immutable author edition. Original document objects remain content-addressed and complete.

## Continue the same original receiving case through prime review

Run the original complete receiving course first using its existing directory and inputs. Then continue that **same original case** from this whole source generation:

~~~sh
python3 PRIME_RETURN_RECEIVING.py \
  --case /absolute/owned/hcps-original-receiving \
  --node /absolute/node
~~~

The following controller acquires the same original operation lock and verifies every completed preceding output. It uses the actual original author workspace and complete observed225-second presentation trace. It keeps source, browser profiles, loopback origin, checkpoints, logs and all following outputs beneath the original case's **prime-review/** directory.

The whole following journey:

1. Attaches the actual completed original playback trace and saves a reviewed baseline against R23.
2. Uses the real browser to issue that exact saved edition.
3. Receives it in an independent colleague profile, edits complete source-bound requirements/evidence, preserves unfinished slide text across reload, and exports the complete returned file.
4. Retains a genuinely separate author edition over the same baseline.
5. Compares the complete return in the real operator UI, preserves unfinished explicit choices across reload, selects a mixture of author/returned content, and explicitly reopens the resulting changed-material completion decision before saving the author edition.
6. Downloads the whole editable application, opens it in another actual recipient profile, preserves every original byte/history/return plan, and reloads the same received copy.
7. Captures actual desktop and390-pixel recipient/author views and preserves the entire original-plus-following case in **HCPS_Complete_Original_And_Prime_Review.tar.gz**.

The final archive includes complete application source, all original inputs, documents, immutable editions, issued/returned full files, browser working histories, actual outputs and original logs. Repeat the same command to continue or adopt only fully verified existing outputs. Earlier source and completed original results remain retained.

The producing operator must actually view the captured screens and open/use the exact outgoing application and attachments under the owner rule below. The source course does not substitute for that observation.

## Current browser ownership

Bryce explicitly released the October13 local in-app browser meeting hold in the original coordination message1791908979.290839: the meeting is over and the in-app browser is free again. Authorized local browser work may resume while preserving user tabs and saved state. The release applies to that browser hold only. A later direct owner reservation controls subsequent work.

Original release: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791908979290839 .


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
