# Readable scientific inspection in the original operator

This module makes the existing saved source, grid, profile, run and operation records readable in the Upper Savannah Scientific Workbench. It uses the original operator and saved Workspace. It does not launch a model, change scientific inputs, submit an operation, or create a second study.

## Use the existing workspace

Open the original private operator link and choose the intended Workspace. Keep the credential-bearing link private.

1. Open **Native model runs**, then open an existing run. **Where and when these results apply** resolves the retained grid, parameter profile, land-cover scenario, source edition, reporting-area selection and upstream model-domain selection. A model period appears only when the retained profile supplies it.
2. Read the native annual totals, units and valid-cell counts. NDR/SDR delivery to streams is not a measured intake concentration. Missing coverage, uncertainty or a model period is stated as missing rather than estimated.
3. Open **Original sources**, select a retained source collection, then **Inspect native file**. The native file reader supplies real raster dimensions, CRS, bounds, pixel size, no-data value, or the vector/table schema and its actual preview rows. A loading message remains visible during the read. A failure offers the original source selection again, including a selected vector layer.
4. Open **Operations** and a saved task. Read its original inputs, progress, result and execution attempts. Failure messages include a practical next step and expandable original validation detail. Opening or exporting the task does not resubmit it.
5. Use **Download readable inspection** for a self-contained HTML document and **Download original record JSON** for the retained selected record. The export snapshots both the original record and the displayed source labels before the click; a later poll cannot relabel that edition. All retained fields and nested members remain available. Large lists are grouped, not truncated.

The HTML opens without the service or a JavaScript runtime. It is an inspection document, not a complete Workspace backup, calculation runner or customer handover archive. Keep using the existing **Back up workspace**, native artifact downloads and original delivery workflow for those purposes. Top-level temporary download controls are omitted from these inspection files; original provenance links remain unchanged.

## Install in the maintained original application

The production files are:

- `operator/web/scientific_inspection.mjs`
- `operator/extensions/scientific-inspection.json`
- The narrow joins in the existing `operator/web/app.mjs`

The small manifest uses the original extension registry to serve this module. It creates no new desk, backend action, model route or task. The owner of the original operator may reopen that service after the normal source composition so its original registry sees the asset. Preserve the same Workspace, operator-state directory, access configuration and other installed extensions.

The full source bank at `operations/eco-operator-scientific-inspection-22b7-20261013.source.json` contains every complete changed file and exact app joins. If another operator author has advanced `app.mjs`, compose each supplied before/after join against that current body; reject a missing or multiply matched hunk and reconcile with its owner. Do not replace a later complete app with this bank's older full app image. The untouched original source and registry remain the dependency.

This ownership boundary is original operator Inspect/run/task/source details. Measurements readable results and intake belong to their existing owners; CEDAR's operator source intake and the guided first-study journey remain separate.

## Operate the exact outgoing source on real retained records

`operator/inspection_receiving.mjs` attaches to an already running original operator. It selects actual saved records, reads the actual native endpoints, exercises the original UI and exports complete selected records. Supply existing Node, Playwright and Chromium paths. It permits the original authentication-session request, blocks scientific mutations, and never starts a model or creates demonstration data.

Set `UPSTATE_OPERATOR_URL` privately to the original access link; do not paste its token into a public guide, issue, log or Slack message. Alternatively supply the existing origin with `--url` and its token through `UPSTATE_OPERATOR_TOKEN`.

```sh
"$CODEX_PRIMARY_RUNTIME_NODE" /path/to/original/application/operator/inspection_receiving.mjs \
  --workspace ORIGINAL_WORKSPACE_KEY \
  --directory /path/to/owned/inspection-receiving \
  --chromium /path/to/existing/chrome-headless-shell \
  --playwright /path/to/existing/playwright/index.js \
  --module /path/to/original/application/operator/web/scientific_inspection.mjs \
  --module-sha256 EXACT_SELECTED_MODULE_SHA256
```

Optional `--run`, `--source` (source-collection identity), `--source-id` and `--task` select actual existing records. Otherwise it chooses a completed saved run with artifacts, an original supported source and a retained operation. It fails clearly when those original records are unavailable; it does not invent replacements.

The course:

- Captures the exact served module identity and complete original state.
- Opens a real native run, original source and saved task; downloads HTML and JSON and compares the JSON with the original endpoint record.
- Holds one original source read long enough to operate and capture the real loading state, then releases the same request.
- Temporarily takes only its isolated browser context offline, opens the actual connection error, restores the connection and retries the original source selection.
- Opens a real run without artifacts when one exists. If none exists, it records that absence explicitly.
- Uses 1440px and 390px widths, retains screenshots, closes the original browser context, then cold-opens every exported HTML file offline and operates its expandable detail.
- Writes each attempt into a new owned directory; earlier outputs remain untouched.

A successful course ends **OPERATED_AWAITING_VISUAL_INSPECTION**. The producing operator must actually open and LOOK at the captured screens and exported documents, fix any affected unreadable or broken result, and retain the exact outgoing edition and observations. That state is deliberately not a claim of visual inspection. Source parsing and peer review have completed; no native/browser receiving is claimed by this source publication.

Keep full original run/task/source JSON and every exported document private to the original study receiving context. Return a concise source/result pointer in the existing Eco thread, with the actual viewed screens, controls, downloads, cold reopen and any concrete unresolved condition. Do not publish a credential, private source data or customer files in this public repository.

## Scientific field meanings

The compact native catalogue preserves complete grid and profile records. The inspection uses `grid.spec.reporting_area`, `grid.spec.model_domain`, `grid.spec.source_collection_id`, `grid.grid` and `profile.model_period` directly. It does not infer basin membership from a source name.

Raster transforms use the original native six-value order `a, b, c, d, e, f`: column x step, row x step, x origin, column y step, row y step, y origin. Bounds remain in the stated coordinate system. A numeric no-data value of zero stays zero. Raster counts, areas, means, fractions and annual quantities retain their native values and declared units; the formatter does not convert scientific amounts.

The original full JSON remains an optional support view. Plain labels help the operator interpret its fields; they do not replace the scientific provenance or the existing comparison and review tools.

## Required rendered-product and attachment practice

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

