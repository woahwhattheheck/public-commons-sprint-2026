# Python source syntax in an existing connected runtime

Use this capability when a complete Python source edition needs a syntax check and the original native executor has not admitted a process. It calls the unchanged official Skulpt parser on the exact retained source text. It neither imports nor executes the selected Python application.

The result is a concrete syntax tree under the included Python 3 grammar, whose upstream build dates to February 2021. This grammar is not the installed CPython version. Acceptance does not establish semantic compilation, import resolution, dependency closure, executable behavior, native operation success or rendered-product readiness. Rejection can mean syntax that this older grammar does not support. Continue the original native operation when its actual host becomes available; do not create another engine or queue merely to obtain a syntax receipt.

## Complete source, one selected edition

The input is the complete decoded UTF-8 JSON from an existing source carrier. The adapter accepts the existing files array or path-to-file map. Each selected member has a complete UTF-8 content string; original bytes and sha256 fields, when present, must match. Transport compression and Base64 decoding stay with the original receiver. The adapter does not guess at encoded strings.

For a repositories map, name the exact repository. Public and installed editions are never merged by filename or silently substituted. Without explicit paths, the selected edition's .py and .pyi members are inspected. Repeated paths, ambiguous repository selection, changed hashes, malformed Unicode and partial source bodies are rejected before parsing.

Limits are 64 MiB decoded packet, 32 MiB selected source, 8 MiB per source member and 8,192 inventory members. They bound this inspection, not the original application's receiving capacity. Keep the original larger complete source carrier and explicitly select a suitable existing edition or receive it natively; do not silently trim a source file.

## Original Node CLI

No dependency installation, server or network is needed. Use the existing Node runtime:

~~~sh
node host/python_syntax_cli.cjs \
  --input /absolute/complete-source.json \
  --repository woahwhattheheck/tjlabs-stellar-merchant-workspace \
  --expected-sha256 dc795a46f544d6e51ab2946698f4f1b6407be37cb15ccf0bfcdfb85ffc0823d2
~~~

The example hash identifies the actual two-repository SourceDesk source bank retained in the accompanying original-use receipt. For another packet use its actual complete decoded identity. Omit --repository for a packet that does not declare repositories. Repeat --path for a deliberate selection:

~~~sh
node host/python_syntax_cli.cjs \
  --input /absolute/complete-source.json \
  --path app/server.py \
  --path app/model.py
~~~

The CLI reads ordinary complete files without following a final symlink, checks read stability, verifies the included parser's full byte identity, and loads that unchanged parser in a Node VM context. The selected Python text goes only to Sk.parse. Each parse has a ten-second host budget. Source files, workspace state and credentials are never modified. The complete JSON report goes to stdout; adapter errors go to stderr.

Exit codes:

- 0: all selected source was accepted by this exact parser.
- 2: the parser reported a syntax-family rejection for at least one source.
- 1: input/identity/adapter error, timeout or another incomplete parser operation.

A timeout is INSPECTION_INCOMPLETE, not a claim that Python is invalid. Preserve the original source and error. The CLI's Node invocation has not been run on this publishing seat; the recorded complete inspection ran in the connected V8 runtime using the same upstream parser and portable adapter.

## Existing connected JavaScript runtime

Reuse the current complete source loader. Supply the existing host/connected_sha256.cjs and these complete files:

- host/connected_python_syntax.cjs
- host/vendor/skulpt-syntax/skulpt.min.js
- host/vendor/skulpt-syntax/SOURCE.json
- host/vendor/skulpt-syntax/LICENSE

Load the original hash helper and adapter with the caller's existing CommonJS loader. Before evaluating the vendor parser, verify its exact identity:

~~~js
const identity = hashes.sha256Utf8(originalParserSource);
if (identity.bytes !== 559460 ||
    identity.sha256 !== "52e007d8d557b97470131e04c8645dbe940b1ab208049905f1aeb058b218d92a") {
  throw new Error("Original Skulpt parser identity differs");
}
new Function(originalParserSource)();
const inspector = syntax.createPythonSyntaxInspector({
  Sk: globalThis.Sk,
  parserSource: originalParserSource
});
const result = inspector.inspect({
  packetSource: completeOriginalDecodedJSON,
  repository: "woahwhattheheck/tjlabs-stellar-merchant-workspace",
  expectedPacketSha256: originalDecodedSHA256
});
~~~

Only the retained trusted parser code is evaluated as JavaScript. Never evaluate a member from the selected application packet. This upstream distribution creates globalThis.Sk during its normal initialization, so load it in the original isolated connected cell or the dedicated Node VM. Do not replace an unrelated application's existing global parser.

An existing host can pass parse(filename, source) to createPythonSyntaxInspector to bound calls into that same verified Skulpt build. The binding is an explicit host capability, not a function received from the selected source packet. The adapter retains parser build identity, full packet hash, each selected path/byte count/hash, original parser flags and accepted/rejected/incomplete outcomes.

## Relation to the existing source collector

host/python_source_closure.py remains the original CPython AST collector. It resolves the explicitly selected filesystem modules and retains original dependency observations. This syntax capability never changes its body, substitutes for its parse results or claims a complete import closure.

Likewise, the original application archive receiver, Runtime Companion receiving and SourceDesk request journals remain their original operations. A syntax result may travel beside their full source packet; it does not authorize a replacement workspace, publish an application or start a native controller.

The actual SourceDesk repair is retained in host/examples/python-syntax-sourcedesk-receipt.json. Both full repository editions were parsed, covering ten selected file rows and eight distinct Python bodies. The report binds the original complete 2,267,260-byte source bank and all member identities. The previously missing lookup parenthesis is retained as one small rejected source example, showing the concrete issue this integration closed. No broad suite was run.

## Upstream and license

The full unmodified parser is skulpt/skulpt-dist/skulpt.min.js at distribution commit1473759236009587a04bd9875c7afd812d9f02d2, Git blob86e34f3d2d1e6a8a356f36d0c17aa3a71520e600. Its embedded source build is skulpt/skulpt commit6c99c2196851bb29f0e503afccb01804f089cb60. The complete LICENSE from that exact source revision is included, including its Python Software Foundation attribution. SOURCE.json binds both original repositories, the exact distribution and full byte hashes.

## Current owner instructions

The following is the complete public repository owner instruction read from AGENTS.md, Git blob96d3752dc5277b2015178a03d9c124fdf9568d5a. It remains applicable to any resulting customer-facing product or attachment. Parser success does not satisfy the required actual opening and rendered inspection. Existing disabled Actions, original owners, account routes and stopped-work boundaries remain in force.

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

