# Open an ordinary source ZIP as one complete application source edition

This maintained host workflow joins the existing ordinary ZIP receiver to the
existing mixed Python/JavaScript source collector. A Python zipfile, JSZip or ordinary
vendor ZIP may contain a top-level project directory, empty package directories,
binary resources, source comments and ordinary ZIP extra fields/data descriptors.
The original archive remains byte-identical. Select its actual application root
and the original complete source recipe; no top-level folder is guessed or stripped.

The product supplies collect, inspect and independent receive/reopen. It never
imports the application, starts its servers, installs dependencies or sends a provider
request. Only the trusted installed Python and Node source collectors execute.

## Before opening

Use an existing Linux host with Python 3.10+ and Node 20+; select their actual
absolute executable paths. No runtime is downloaded. Keep the complete toolkit
under its original host/ paths, including the original Acorn license/source record.
The source packet retains every complete tool body. Independent inspection uses
that same edition; a newer tool cannot silently reinterpret the old source.

Obtain the exact original ZIP and its independently retained SHA-256. Supply an
ordinary private working parent with mode 0700. Existing receiving operations are
reused only for their original exact archive, root, selection and tools. Never point
at a working customer project. A symlink, unrecognised nonempty destination or changed
file is refused without replacing it.

The source recipe is the unchanged commons.application-source-selection/v1:
actual Python module roots/entrypoints/dynamic selections, actual JavaScript/browser
entries and serving routes, and complete explicit resources/empty directories.
All recipe paths are relative to the selected archive directory. A route is not
inferred from a ZIP path. Preserve the original application's launch directory and
configuration separately for its existing operator.

For an archive containing project/host/... use --member-root project. For a ZIP whose
members already begin host/... use --member-root . . This selection creates a bound
view; all unselected original ZIP members still remain in the delivered archive.

## Collect

Create PRIVATE_PARENT yourself with the usual owner permissions. The archive SHA
below must be the real retained SHA, not the literal placeholder.

    node host/application_archive_source.cjs collect \
      --archive /absolute/original.zip \
      --sha256 ORIGINAL_SHA256 \
      --member-root project \
      --selection /absolute/application-selection.json \
      --directory /absolute/PRIVATE_PARENT/original-intake \
      --output /absolute/PRIVATE_PARENT/application-source.json.gz \
      --python /absolute/python3 \
      --node /absolute/node \
      --gzip

This freezes the original intent, archives the exact original bytes using the
maintained ZIP receiver, collects both languages from the selected original root,
replays the original mixed inspection, binds every selected member and filesystem
observation back to the whole original ZIP and publishes the complete packet.
Neither extraction nor source selection renames or regenerates the original ZIP.

The source packet preserves:
- The complete original ZIP bytes, hash and original member metadata.
- Literal selection bytes, the explicit selected root and original source packet bytes.
- Full original Python and JavaScript analyses, source bodies, directories and runtime
  classifications without projection or truncation.
- Every selected source path's original archive path, byte/Git identity and executable mode.
- All unselected archive file names, while retaining their complete bodies in the ZIP.
- The entire trusted tool edition, including both collectors, parser and guides.

Source bindings reject a selected body/mode mismatch, missing selected directory or
a contradiction with the original Python's positive AND negative search observations.
This prevents an unselected archive module from being silently treated as missing
after a selected packet is detached from the archive.

COMPLETE means the original collectors completed their documented explicit source
scope. Computed JavaScript expressions, external dependencies and Python resources
without an executable context remain visible in the original reports. This workflow
does not infer hidden runtime configuration or claim the application has run.

## Inspect, independently receive and reopen

Keep the complete original source packet and the same toolkit. An inspection creates
a private retained parser workspace; use the SAME directory for following receive.

    node host/application_archive_source.cjs inspect \
      --input /absolute/PRIVATE_PARENT/application-source.json.gz \
      --directory /absolute/PRIVATE_PARENT/recipient \
      --python /absolute/python3 --node /absolute/node

    node host/application_archive_source.cjs receive \
      --input /absolute/PRIVATE_PARENT/application-source.json.gz \
      --directory /absolute/PRIVATE_PARENT/recipient \
      --python /absolute/python3 --node /absolute/node

The receiving result contains:

| Path | Complete retained object |
|---|---|
| archive-source.json | Exact decompressed source packet |
| original.zip and archive/archive.zip | Byte-identical original ZIP |
| archive/RECEIVING.json | Original ZIP receiver's complete member receipt |
| archive/members/ | Every original archive member, including unselected members |
| selection.json | Exact operator-supplied recipe bytes |
| application-source.json | Exact original mixed source packet |
| application/source/ | Selected source under its original root-relative paths |
| application/complete.json | Original mixed collector's complete receiving receipt |
| tools/host/ | Complete same-edition receiving toolkit and guides |
| attempts/ | Retained actual parser invocation, full stdout/stderr and intermediate files |
| complete.json | Final complete archive-to-application receiving relationship |

Invoke the received tool from tools/host/application_archive_source.cjs to inspect
the same archive-source.json in a new private inspection directory. Then repeat the
original receive against the original recipient directory; the full archive,
selected members, analyses and identities must still agree. The toolkit never
executes code from the selected application's source/ directory.

Only after this source receiving, use the application's existing installed launcher
and original owner to open the actual product. Native request IDs, workspaces,
credentials and writer leases remain with that owner.

## Interruption and errors

Repeat the SAME command and private directory. The intent includes actual original
archive/selection/tool identities, root and interpreter paths. An existing original
application-source.json is inspected and reused, not recollected from a changed source.
An interrupted parser attempt remains in attempts/. A new source-only attempt resumes
collection only after every earlier attempt has its original CLOSED parser receipt.
No application work is replayed.

The maintained ZIP receiver resumes exact missing members. The maintained mixed
receiver reopens the original packet and selected source. Publication is create-only
with the existing ZIP receiver's fsynced temporary/link operation. Full child output
is retained; errors name the attempt directory. On interruption or timeout the trusted
wrapper drains its registered original parser children. If that drain cannot be confirmed,
the result is DRAIN_UNCONFIRMED and further parser launches stop for owner reconciliation.
No unrelated process is stopped. A completed marker is written only after both original receivers
and final archive verification complete.

An initial crash before intent publication may leave only an exact prefix of that
same intent in an owned temporary. The wrapper accepts only those matching residues.
Other unidentified contents require the original owner to reconcile them; no cleanup
or guessed adoption is performed.

Ordinary archive limits are 128 MiB compressed, 128 MiB uncompressed and 8,192 entries.
Mixed-source limits remain 64 MiB selected source and 8 MiB per source member. The
combined complete packet has a 256 MiB limit; Base64 and both retained representations
count against it. If the full packet exceeds the limit, choose a smaller COMPLETE
archive edition; it is never silently truncated. Compressed packet input is capped
at 128 MiB and decompression at 256 MiB.

Return codes: 0 complete; 2 an original incomplete source analysis; 1 operation error.
An incomplete collection can be delivered for source correction, but receive refuses
to call it a complete independently received application.

## API

    const source = require('./host/application_archive_source.cjs');
    const collected = await source.collect({
      archive: originalZip, expectedSha256: retainedHash, memberRoot: 'project',
      selection: recipeFile, directory: originalOperation, output: packetFile,
      gzip: true, python: installedPython, node: installedNode, signal
    });
    const inspected = await source.inspect({
      input: packetFile, directory: receivingOperation,
      python: installedPython, node: installedNode, signal
    });
    const received = await source.receive({
      input: packetFile, directory: receivingOperation,
      python: installedPython, node: installedNode, signal
    });

The original ZIP module adds a receivingIO export of its existing read/publication/
directory functions solely for this composition. Their implementation and the
original strict ZIP reader/receiver behavior are unchanged.

## Exact outgoing product and attachments

Source inspection is distinct from native/rendered acceptance. The maintained
application owner continues its original operating course, uses every outgoing
attachment and returns the actual viewed result. No customer-facing readiness is
established by a source checksum, parser pass or peer review.

# Owner-directed rendered-product inspection

Source: direct owner instruction of October 13, 2026. Repository copy version: `2026-10-13.1`.
Scope: owner-controlled work across providers, local and cloud runtimes, and current and future workers. Existing owner controls remain in force.

Before calling a client/prospect-facing app, website, dashboard, demo, report, presentation or export ready, the producing worker must open/run/render the exact outgoing version, LOOK at the rendered screen or its real screenshots, and operate the important user controls. Check the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Fix ugly, broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Code review, DOM counts, HTTP200, unit checks or another worker's approval do not replace seeing the actual product.

The Ecosystem product requires plain industrial design: readable tables, clear hierarchy, consistent typography/spacing, restrained controls, useful labels and responsive layouts. Keep the real workflows/data/computation. Reviews must lead directly to repairs and must not replace implementation/integration or become endless rechecking. The existing focused-validation policy remains; do not run broad suites or build a verification product.

Persist this instruction in the active owner-controlled instruction surfaces actually read by the relevant workers: global/project AGENTS/CLAUDE/GEMINI/rules, provider-specific boot instructions, source mirrors, cloud repository copies and current build/receiving guides. Include this instruction in every delegated child assignment, including assignments to another provider or runtime. Maintainers update their own consumed files and return exact paths, source/version and readback. A coordination acknowledgment alone is not propagation. Do not alter historical evidence or third-party/vendor policies. No forced restarts, new watchers or revival of owner-stopped work.

Inspect the actual completed scientific screens, reports, source pages and downloadable HTML in the real operator. Prior empty-Workspace screenshots are not completed-workspace acceptance. Preserve current engineering owners; other coordinators receive propagation rather than duplicate implementation. Continue native source/runtime/archive joins rather than diverting everyone to cosmetic review. For Ecosystem Sciences, read `opportunities/upstate_forever_2026/CURRENT_OWNER_DIRECTION.md` version `2026-10-13.4`. Bryce's direct instruction at October 13, 2026, 10:46 a.m. Eastern renewed the existing work toward his call and superseded the earlier 10 a.m. cutoff. Preserve active workers, completed scientific outputs and all other standing controls while finishing and integrating the actual application.

Source assembly and standalone application handoffs retain the application-level instruction copies with their current guides. This file records an owner-requested product delivery requirement; it does not change provider safeguards, repository access controls, or existing authorization boundaries.


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

## Original parser ownership

The trusted application_archive_parser.py launcher imports only the unchanged installed collector, records its original Node parser processes and cooperatively unwinds cancellation. It independently drains those original children, including a signal arriving during the collector's cleanup, before writing parser-close.json with state CLOSED. The outer Node owner allows twenty seconds for cooperative cleanup. A forced termination or missing close receipt is DRAIN_UNCONFIRMED and preserves the exact attempt for owner reconciliation; it is never reported as a successful drain. All stdout/stderr handles close through the same finally path. Archive receiving verifies original executable identity as well as complete member bytes and establishes the intended private file mode independently of umask.

Before a following parser call, every earlier parser attempt must have its original CLOSED receipt. An incomplete or forcibly terminated attempt blocks that same operation from launching another parser. The existing host owner must reconcile its recorded PIDs and retained logs first; do not fabricate a close receipt, delete a live attempt or bypass it with another operation directory. This conservative state may also occur before process creation; retain that distinction in the owner’s actual recovery result.
