# Complete Git source selection from retained directory responses

This is the original Git source-reuse workflow with a complete captured-directory intake. Large recursive metadata responses can fail in transport; a successful response may also declare truncation. Retain the original immutable commit and complete direct tree objects instead. The collector requests only missing directories needed by the explicit file/subtree selection, retains every successful response, and produces the existing source-selection input for the maintained native planner, materializer and exporter.

The existing `createGitHubTreeSourceVerifier` and its retained-file publisher API remain unchanged. The new `createGitHubTreeSourceCollector` is in the same `host/connected_github_source_tree.cjs`. It uses the caller's existing authenticated `readJson({url})` route; it creates no credential, account, queue, source executor or application runtime.

## Select and receive complete metadata

Bind these original values before reading:

```js
const request = {
  repository: 'owner/repository',
  commit: 'FULL_ORIGINAL_40_CHARACTER_COMMIT_SHA',
  paths: ['path/to/entry.mjs', 'path/to/complete-directory']
};
```

Every path is explicit and repository-relative. A selected directory includes its whole ordinary-file subtree. Select `.` only when the whole repository is intended. Symlinks and submodules require their original separate source workflow; this operation does not dereference them. Complete sibling metadata can contain an unrelated symlink/submodule without selecting its bytes.

Construct the original module in Node or connected V8. Supply a trusted codec with `utf8(string) -> Uint8Array` and `sha1(Uint8Array) -> lowercase Git SHA1`. Existing Commons source-byte codecs can be reused; in ordinary Node the standard UTF-8 encoder and `node:crypto` provide these functions. No archive or repository member is evaluated.

```js
const {createGitHubTreeSourceCollector} = require('./connected_github_source_tree.cjs');
const collector = createGitHubTreeSourceCollector({
  sourceCodec: originalTrustedSourceCodec,
  readJson: originalAuthenticatedGitJsonReader
});
const result = await collector.collect(request, {
  state: originalSavedState, // omit on the original first call
  maxReads: 32,
  signal: originalSignal,
  onState: async (state, event) => {
    await originalOperation.saveCompleteTreeCapture(state, event);
  }
});
```

`originalOperation.saveCompleteTreeCapture` denotes the current operation's existing durable capture callback, not a new provided store or controller. It must save the complete state before acknowledging. Complete tree bodies are in `state.tree_responses`; the original commit response, request, attempts and any provider failure remain alongside them. The caller also keeps its full native connector envelopes where it already records provider reads.

A bounded call returns `complete:false`, phase `PAUSED`, and the precise outstanding `plan.fetches`. Continue with the same request and saved state. There is no timer, background fetcher or automatic retry. One object shared by multiple paths is fetched once. A fully retained call performs zero new provider reads.

On provider failure, the function throws with `error.state` and the original `error.cause`. Preserve both. A repeat requires the caller's explicit `retryFailed:true` after the existing provider reset/retry policy permits it. That flag does not override a quota, permission refusal or account restriction. Never rotate actors or routes after a denial. The collector does not interpret missing headers as permission to retry.

To reuse already captured objects in a new explicit source selection, pass `captures:{commit_response,tree_responses}`. Omit `commit_response` when adopting same-repository tree objects from another commit. Every complete tree is independently reconstructed as a native Git tree object and matched to its SHA; names, modes and child identities are preserved. The selected commit/tree relationship is checked against the original repository response. Unselected subtrees need no child acquisition. An omitted selected directory, malformed response, wrong object, truncated tree or changed source never produces a complete selection.

The collector accepts decoded complete Git metadata JSON from the caller's current reader. Preserve and classify connector envelopes using that existing reader before returning JSON; an `Action completed` display string is not a Git object. No private source is placed into a public carrier by this helper.

## Existing native source planning and receiving

Once `result.complete === true`, save its full `result.selection` using the existing source artifact mechanism. It has the original schema `commons.github-source-selection.v1` and an additive `tree_responses` array of complete direct metadata responses. No synthetic provider response is published. The original single `tree_response` mode remains supported; choose one representation.

For an offline captured file or saved collector state, the supplied Node command has no provider/network operation:

```sh
node host/connected_github_tree_source_cli.cjs plan /absolute/private/capture.json
node host/connected_github_tree_source_cli.cjs select /absolute/private/capture.json > /absolute/private/selection.json
```

The `select` command exits 3 with the incomplete plan when metadata is missing. Use the selection output only after exit 0. It does not overwrite inputs; shell redirection is the operator's selected new output. The command reads a bounded, stable regular UTF-8 JSON file, rejects symlinks/special files, and preserves the full selected metadata without truncation. `plan` always reports its explicit completeness state.

The updated maintained Python entry is under `receiving/native-runtime-retained-20261013/host/`. The rest of its source reuse/materialization protocol stays unchanged:

```sh
python3 -B receiving/native-runtime-retained-20261013/host/connected_github_source_reuse.py select /absolute/private/selection.json
python3 -B receiving/native-runtime-retained-20261013/host/connected_github_source_reuse.py plan /absolute/private/selection.json --source-root /absolute/existing/source --git-root /absolute/existing/repository
```

The plan reuses matching existing worktree files and original Git objects, then emits exact ordinary native fetch arguments for missing blobs. It does not call the provider. Retain original `request/response` pairs from the existing account route as captures, and pass them back through the existing `--capture` option. Then use the original commands:

```sh
python3 -B receiving/native-runtime-retained-20261013/host/connected_github_source_reuse.py copy /absolute/private/selection.json /absolute/private/selected-source --source-root /absolute/existing/source --git-root /absolute/existing/repository --capture /absolute/private/blob-captures.json
python3 -B receiving/native-runtime-retained-20261013/host/connected_github_source_reuse.py inspect /absolute/private/selection.json --source-root /absolute/private/selected-source
python3 -B receiving/native-runtime-retained-20261013/host/connected_github_source_reuse.py export /absolute/private/selection.json /absolute/private/reusable-source-export --source-root /absolute/private/selected-source
```

Read the original help for immutable linking and original receiving options. Their copy, executable-mode, original-file reuse and independent inspection semantics are preserved. A source metadata result does not establish that blob bytes were acquired or materialized, and a materialized source directory does not establish that the product ran.

## Current exercised result and limits

The actual connected course selected five source files at public commit `fc47a578a02a50abfd9543f66c006983d8dd6376`. It stopped after exactly two native reads, restored the same state, and completed with eight total native requests and seven complete direct trees. All selected blob identities, byte sizes and ordinary modes were retained. No initial read was repeated. Focused source execution rejected changed tree bytes and a truncated tree, requested only an omitted directory, retained a provider-error fixture unchanged, and required explicit retry before completing its saved request. The fixture is distinct from the real provider reads.

The complete new JavaScript parses with the original Acorn parser. The updated Python source parses with the retained official Skulpt Python3 parser. Node CLI filesystem execution and CPython materialization of this edition remain unrun; they continue with the existing accepting runtime owner. No new native process, hosted Actions, browser or budget controller was started.

Limits are explicit: up to one million captured/expanded entries, 100,000 tree objects and 512 levels of selected ancestry; per-call read budget is 0–10,000 and defaults to 64. The offline CLI input bound is 256 MiB. Complete original source and the current source-reuse row limits remain required; there is no partial success by clipping.

## Source and owner continuity

The original retained-file verifier is the complete maintained `9b75060f532a4d254b0d44aff9a9bc16e135eed0` body. The native source-reuse preimage is the complete maintained `7f0bd6b07f44b2923470249b0fa017df3e9f33ff` body, identical in the original source and the existing public runtime edition. Public generic tooling is published here; credentials, private repositories' data, customer inputs and original operation journals stay in their existing authorized custody.

Keep repository Actions disabled and preserve literal-false workflow conditions. Source acquisition does not authorize CI, paid fallbacks, account changes, source execution or owner-stopped work. Continue original native receiving IDs and actual runtime/browser ownership.

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

