# Foreground preparation tool bridge

This additive adapter connects the maintained connected-contact operator's existing **prepare** route to the actual connected Git read tools in one foreground orchestration. It exports the CommonJS tools object the operator already accepts. The original product remains the owner of source adoption, account state, coordinator identity, contact journals and subsequent receiving. This adapter does not initialize a coordinator, receive state, acquire a sender lease, create a draft, send mail or run a drain.

## Complete source and placement

The product composer adds these three files to the existing products/connected-contact source roster and updates its complete SOURCE_MANIFEST.json and source capsule:

- connected_contact_operator_bridge.cjs — Node-only lazy tools export and private framed journal.
- connected_contact_operator_relay.cjs — foreground orchestration pump, with no Node dependency at module load.
- FOREGROUND_PREPARATION_BRIDGE.md — this operating guide.

Use the complete maintained cumulative product, including its original-session checkpoint validator, local adoption and saved-draft joins. The historical 62-file source plus only an operator overlay is not that complete selection. The composer's current 68-member source edition is the integration basis; the final manifest after adding this adapter is authoritative. Do not overwrite a newer original leaf or describe this additive source packet as a complete installed product.

The actual equipped owner must select the already established Linux/WSL Linux host, its one original coordinator directory/UUID/account authority, the complete immutable source directory and the existing private preparation selection. No placement, empty coordinator or account state is inferred. Use the existing product initialization/adoption workflow only under its original owner; this bridge never does so.

Configuration, selection, provider returns, prepared requests and journals are private operator data. Keep them on the original operator-owned receiving/coordinator filesystem. Publish only generic source and this guide. Do not put mailbox values, recipient bodies, account state, original provider responses or signed values in a public source carrier.

## Freeze the original invocation

Create one mode-0600 JSON bridge configuration in the original private operation directory. Its schema is commons.connected-contact-tool-bridge/v1 and mode is prepare-read-only. The fields are:

| Field | Actual selection |
| --- | --- |
| operation_id | Exact operation_id already present in the original private preparation selection. |
| session_id | One newly selected 64-hex foreground-invocation identity, retained unchanged after entry. This is not a replacement contact intent or coordinator UUID. |
| source_directory | Real absolute directory containing the complete selected product and its final manifest. |
| journal_directory | Original operator-owned mode-0700 receiving journal directory, also passed to --journal. |
| node_executable | Real resolved absolute path of the actual installed Node executable. |
| argv | The exact existing prepare command arguments, shown below. |
| pins | Unique {path, bytes, sha256} records for the complete private product configuration, private selection, SOURCE_MANIFEST.json and actual Node executable; up to sixteen explicit pins. |
| policy.repositories | Exact original owner/name repositories needed to read the retained source histories. Read access is not permission to write a private repository. |
| policy.gmail_link_ids | Empty array for this preparation-only adapter. No Gmail binding is dispatched. |
| max_calls | Explicit complete preparation call bound, from 1 through 10000. |

Every pin is calculated from the actual complete selected file. Do not insert illustrative hashes. The source manifest must include the reviewed bridge; its existing product loader checks the complete edition. Private input files are regular, mode 0600, owned by the operator, with no symlink traversal or extra hard links. The runtime can be a system-owned executable; it is still pinned by complete bytes and SHA-256. The real source path, runtime, CLI argv and selection operation ID are checked again by the bridge. Original inputs and configuration are checked at completion.

The argv array is:

    ["prepare",
     "--config", ABSOLUTE_PRIVATE_PRODUCT_CONFIGURATION,
     "--operator", SOURCE_DIRECTORY + "/connected_contact_operator_bridge.cjs",
     "--selection", ABSOLUTE_ORIGINAL_PREPARATION_SELECTION,
     "--request", ABSOLUTE_NEW_PREPARED_REQUEST,
     "--journal", ORIGINAL_PRIVATE_JOURNAL_DIRECTORY,
     "--result", ABSOLUTE_NEW_RESULT]

The optional --result pair may be omitted. The prepared-request path must not already exist. If it does, inspect and receive that exact original prepared output through the maintained product; do not prepare it again. The session journal is created exclusively at journal_directory/session_id, so a second process cannot overwrite this original invocation.

The emitted native command is the existing route, shell-quoted without interpolation:

    env COMMONS_CONTACT_BRIDGE_CONFIG=PRIVATE_BRIDGE_CONFIGURATION \
      ACTUAL_NODE COMPLETE_SOURCE/connected_contact_operator.cjs \
      prepare --config PRIVATE_PRODUCT_CONFIGURATION \
      --operator COMPLETE_SOURCE/connected_contact_operator_bridge.cjs \
      --selection ORIGINAL_SELECTION --request PREPARED_REQUEST \
      --journal ORIGINAL_PRIVATE_JOURNAL --result PRIVATE_RESULT

Do not run this command separately and then invoke the relay: the relay owns its one launch and actual returned native session.

## Connected foreground entry

Load both complete reviewed CommonJS bodies in the existing connected orchestration. Loading the bridge body does not create a Node process or open its tools getter. Loading the relay does not call any provider. Use the maintained connected_sha256.cjs exports for **synchronous** sha256Utf8 and sha256Bytes; both return complete {bytes, sha256} objects. Awaitable digest callbacks are not supported.

The receiving owner supplies the actual connected tools object and private retained loadState/saveState functions. In a functions orchestration these can wrap the original load/store helpers. Those helpers retain orchestration state; they do not prove a filesystem checkpoint or durable cross-session transport. Keep the entire foreground pump in one functions lifetime, using its normal yield/wait facility to communicate progress. Never assume that a later unrelated orchestration can route an old process.

The callable entry is:

    await relay.runConnectedContactOperator({
      bridge,
      tools,
      configurationText,      // exact complete UTF-8 JSON text already saved privately
      configurationPath,      // same actual on-machine path
      sha256Utf8,
      sha256Bytes,
      loadState: key => load(key),
      saveState: (key, value) => store(key, value),
      stateKey: originalPrivateRelayStateKey,
      resume: false,
      onProgress: async summary => { /* periodic concise owner update */ }
    });

No values in this example are a customer input. All variables must come from the original owner's actual selection. The source-controlled default transport calls the actual exec_command/write_stdin tools with /bin/bash, login false, pipe mode, the selected source workdir and original native session ID. If the equipped owner uses another maintained foreground transport, it may supply transport:{launch,poll,write} functions with those same argument/result contracts. These are reviewed executable bindings supplied by the operator, not names read from customer input; no network listener or tool-emulation service is added.

The pump recognizes only the fixed prefix COMMONS_CONTACT_TOOL_BRIDGE_V1 followed by complete JSON. It validates the exact operation/session, tool binding, complete request shape, repository scope, request size and SHA before dispatch. Its fixed dispatch table admits repository metadata, one branch-ref GET, commit/file/blob reads, commit comparison and the current Git user-login read. Complete file reads require a retained commit SHA; partial line ranges, arbitrary URLs, account overrides, unknown fields and other tools are rejected.

The original factory's constructor also requires some Gmail/write/older actor symbols to be function-valued. The adapter supplies explicit **local throwing stubs** for these names, including github_get_profile. They never emit a relay request. This preserves the original selected journal actor binding without extending live capabilities. Original-session journal preparation remains pure validation under the maintained product's own blocking proxy.

Concurrent checkpoint chunk reads are queued in the Node adapter, then sent one at a time with a distinct sequence and request SHA. No original call is dropped or combined. The returned native CallToolResult is preserved in full, including content, structuredContent, isError and metadata. A returned error object remains a returned object. A thrown tool exception remains a thrown outcome with its retained available properties. These are exact JSON serializations of the actual tool API returns, not invented raw HTTP captures.

## Full response and completion

The relay retains the full actual outcome before sending it. It streams canonical base64 over byte-bounded UTF-8 chunks, keeping scalar boundaries intact. The Node side writes each original request and complete verified response under the same private session directory. Request/result envelopes retain the original operation, sequence, binding, call ID and full values.

The receiver acknowledges response-start, each ordered chunk and the fully hashed response separately. The final response is fsynced and published before its received acknowledgment resolves the original tools promise. A 256-MiB complete-response bound matches the current selected source receiving envelope; it is not a throughput claim. The relay does not truncate a response or substitute a short summary if the bound is exceeded.

The original CLI also writes an **unframed application COMPLETE JSON line**. It is preserved separately, with its exact text/bytes/hash, and is never treated as a provider request. After all original returns and that application result, the relay can close only its owned stdin bridge by sending the finish frame. The bridge verifies the original coordinator and prepared-request presence before closing. A normal already-exiting process does not require another write.

Successful relay completion requires the actual application preparation result, the bridge's complete journal summary, every original response acknowledgment and native exit code zero. The result is preparation complete only. Account-state receive, native sender admission, recipient/organization history, actual headroom and any authorized later contact remain separate original product operations.

## Interruption and same-session continuation

Retain the full private orchestration state and the original native session. Call the same entry with the exact same configuration text/path/state key and resume:true. Do not clear the state key, replace the session identity, launch the command again or invoke a provider method independently to fill a gap.

| Retained boundary | Supported next action |
| --- | --- |
| Provider request marked DISPATCHING, no full return retained | Stop and reconcile the original tool invocation. It is never automatically replayed. |
| Full outcome retained as PROVIDER_RETURNED | Validate and re-encode that same retained outcome; continue its original response without a provider call. |
| Exact response frame PREPARED, no dispatch marker | Send that original known-uninvoked frame once. |
| Frame DISPATCHING or transport return uncertain | Poll only the same native session for its original acknowledgment. Do not resend bytes. |
| Original acknowledgment retained | Continue from its exact next byte/index. |
| Native launch marked but no returned session identity | Reconcile the original admission. No second launch is automatic, including interruption between the launch selection and the actual dispatch. |
| Native process already ended | Preserve actual exit status and journals; use the already prepared request where complete. No automatic new process. |

Each response frame keeps its exact text, hash and transport stage before dispatch. Native transport returns keep the original arguments/write identity and complete output. Twelve consecutive empty foreground polls return an explicit unresolved summary instead of silently waiting forever. A later explicit same-session continuation gets another bounded observation window; it still cannot replay a dispatched frame or provider call. If the original stdout acknowledgment was consumed but its transport result was lost, absence of that acknowledgment remains unresolved. The original equipped owner must reconcile the retained native journal and transport result; this adapter does not infer success from silence.

A rejected state-load does not retain a permanent in-memory invocation lock. Concurrent use of the same configuration in one orchestration is rejected. Original node session directory exclusivity remains independent of the orchestration lock.

## Source validation and actual execution status

Both complete modules were parsed as CommonJS source. The streaming UTF-8/base64 path reproduced a complete already-retained native tool return of 1,844,670 bytes in 38 chunks with the same SHA-256. Focused scalar-boundary and forbidden-scope checks also passed. Those are source-function checks; they are not a native bridge run, coordinator installation, account-state import, successful contact, or rendered product inspection.

The original equipped owner must run the complete exact selected preparation through this entry, inspect its actual private prepared output and journals, then continue the maintained receiving path as authorized. No extra watcher, scheduled poll, parallel sender, per-seat coordinator or broad validation package is required.

## Standing owner instruction

# Owner-directed rendered-product inspection

Source: direct owner instruction of October 13, 2026. Repository copy version: `2026-10-13.1`.
Scope: owner-controlled work across providers, local and cloud runtimes, and current and future workers. Existing owner controls remain in force.

Before calling a client/prospect-facing app, website, dashboard, demo, report, presentation or export ready, the producing worker must open/run/render the exact outgoing version, LOOK at the rendered screen or its real screenshots, and operate the important user controls. Check the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Fix ugly, broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Code review, DOM counts, HTTP200, unit checks or another worker's approval do not replace seeing the actual product.

The Ecosystem product requires plain industrial design: readable tables, clear hierarchy, consistent typography/spacing, restrained controls, useful labels and responsive layouts. Keep the real workflows/data/computation. Reviews must lead directly to repairs and must not replace implementation/integration or become endless rechecking. The existing focused-validation policy remains; do not run broad suites or build a verification product.

Persist this instruction in the active owner-controlled instruction surfaces actually read by the relevant workers: global/project AGENTS/CLAUDE/GEMINI/rules, provider-specific boot instructions, source mirrors, cloud repository copies and current build/receiving guides. Include this instruction in every delegated child assignment, including assignments to another provider or runtime. Maintainers update their own consumed files and return exact paths, source/version and readback. A coordination acknowledgment alone is not propagation. Do not alter historical evidence or third-party/vendor policies. No forced restarts, new watchers or revival of owner-stopped work.

Inspect the actual completed scientific screens, reports, source pages and downloadable HTML in the real operator. Prior empty-Workspace screenshots are not completed-workspace acceptance. Preserve current engineering owners; other coordinators receive propagation rather than duplicate implementation. Continue native source/runtime/archive joins rather than diverting everyone to cosmetic review. This instruction does not extend or restart the Ecosystem sprint: the existing cutoff is October 13, 2026 at 10:00 a.m. America/Kentucky/Louisville, 14:00 UTC.

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
