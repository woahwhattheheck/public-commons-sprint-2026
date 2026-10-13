# APM2 editable documents: opening, regeneration and complete return

This maintainer continues the original APM2 document project. It keeps the supplier response, original notice, review register, sources and capacity planner together. It does not submit an issuer response or invent supplier capability, estate measurements, dates or prices.

## Open the complete edition

Open `index.html` in the extracted directory. Open both HTML documents, their editable Markdown, the review register and original source files. The two retained Adobe PDF links are the original reading editions. Their source identities and page counts are recorded in `PDF_EDITIONS.json`; they are not silently relabelled after a document edit.

Open `capacity/index.html` with its four siblings present. This is the existing offline capacity planner, with the same model and controls as the maintained CanadaBuys route `/apm2-capacity/`. The current planner includes the narrowly bound stale-open correction: a delayed imported file cannot replace a newer project, selection or edit. The original five assets remain retained under history and in the baseline. Use **New project**, enter explicit inputs, **Save JSON** and **Export report**. **Open JSON** restores all scenarios. Keep the complete JSON with the report. No selected estate project was supplied in the original response package; the planner starts with blank inputs.

## Choose the authority for this edition

The twelve original document files remain editable. Preserve the original notice JSON and CSV unchanged. The review register carries original issuer question/section mappings, evidence and response owners, approval decisions and review notes. Its rows must cover the current response IDs once each; new original issuer questions can be added to the response content and corresponding register.

Choose one reading source explicitly:

- `preserve` is the default for the original twelve unchanged files. It retains the original reading copies and adds working opening/source links.
- `structured` reads the complete response content, workshare and review register. It regenerates both Markdown and HTML documents. Update every authored scope statement when changing commercial terms; contradictory retained fees/hours/calendar claims stop generation with a specific finding.
- `markdown` uses each complete edited Markdown document as its reading authority and regenerates its HTML. Structured JSON is retained unchanged and the edition records that no Markdown-to-JSON merge was inferred. Reconcile its structured content before using a later structured edition.

Generated reading copies replace their active counterparts only in a **new** output directory. Every incoming file is retained in an input snapshot under `history/`, including custom HTML, selected project, previous PDFs and manifests. Existing history is carried forward. Nothing is written over the input edition.

## Run the maintained entrypoint

Node.js 18 or later is sufficient. No install, package download, network request or external document renderer is used for HTML generation.

Initial complete original edition:

~~~sh
node tools/maintain.mjs --output /absolute/new/APM2-original
~~~

After editing the actual source edition:

~~~sh
node /absolute/current/APM2/tools/maintain.mjs \
  --source /absolute/current/APM2 \
  --authority structured \
  --output /absolute/new/APM2-revised
~~~

For edited Markdown use `--authority markdown`. The complete frozen baseline is at `tools/APM2_Base_Edition.json`; `--baseline FILE` selects that exact source explicitly when needed. It contains the unchanged original twelve files, their hashes, original layout, original PDF identities and five maintained capacity assets. Do not substitute another customer/source edition by filename alone.

Attach an actual selected capacity project while building:

~~~sh
node tools/maintain.mjs --source /absolute/current/APM2 \
  --authority structured --capacity-project /absolute/apm2-capacity-project.json \
  --output /absolute/new/APM2-with-capacity
~~~

The original capacity model validates the JSON and generates `capacity-report.html`. The exact input bytes are retained as `capacity-project.json`; both are linked on the opening page. Blank or unknown values remain blank or unknown.

The generic source files live in the maintained CanadaBuys project under `examples/apm2/response-documents/`; the existing capacity source remains under its sibling `capacity/`. The private baseline and customer documents travel in this internal handover, not in the public generic source repository.

## Bind a newly rendered PDF to its exact HTML

For an edited reading copy, print/export the final generated HTML using the existing selected renderer and inspect every page. Keep the original PDF history. A new PDF must be accompanied by an explicit receipt array:

~~~json
[
  {
    "kind": "binder",
    "html_sha256": "SHA256_OF_EXACT_GENERATED_BINDER_HTML_BYTES",
    "pdf_path": "new-binder.pdf",
    "pdf_bytes": 12345,
    "pdf_sha256": "SHA256_OF_ACTUAL_PDF_BYTES",
    "renderer": "Original renderer and export identity",
    "pages": 16
  }
]
~~~

The receipt's `pdf_path` is relative to its JSON file. It may contain one binder and one offer. Page count is the observed count, not the original count copied by assumption.

Run the **same original input and same authority** again, with `--pdf-receipts /absolute/receipts.json` and a different new output directory. The maintainer reproduces the exact HTML and verifies its receipt, PDF byte count, digest and PDF signature before attaching a current reading PDF. A copied edition automatically keeps an already attached current PDF only when its prior manifest, edition record, renderer receipt, actual PDF bytes and exact newly generated HTML all agree. If HTML changed, regenerate and render it again. Edited editions without a matching PDF expose their current HTML and a visible pending-PDF record; the old provider PDFs remain clearly historical.

## Inspect and reopen the actual outgoing package

Open the exact output `index.html` at desktop and a narrow width. Follow both document contents, source links and capacity controls. Download/open the Markdown, selected capacity JSON/report and any attached PDFs. Inspect every final PDF page for clipping, overflow, unreadable text and source mismatch. Source-level hash and link checks do not claim a browser or page-image review.

Copy or ZIP the **whole output directory**, including `tools/`, `capacity/`, `history/`, `MANIFEST.json`, `EDITION.json` and original sources. Reopen it from a separate directory. The manifest lists every member's exact bytes and SHA-256 except the manifest itself. Each PDF edition has an explicit original or current source binding.

This is the same APM2 response-documents operation, with supplier approval and issuer submission still controlled by the original commercial owner. No customer sending is performed by this command. Bryce's local Codex in-app browser remains reserved to him from 16:00 UTC until his explicit release; an independently available isolated browser may perform the outgoing review.

## Original project operating instructions

# Repository delivery instructions

Use the current README and the existing product's build/receiving guide. Coordinate through the original implementation and receiving owners, preserve concurrent source, and carry work through its authorized delivery.

## Rendered product inspection — owner instruction, 2026-10-13

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
Canonical attachment/media clarification: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791885532614949

## GitHub Actions zero spend — existing owner instruction

Keep GitHub Actions disabled in this repository's provider settings and preserve the disabled source policy in [.github/hosted-ci-policy.json](.github/hosted-ci-policy.json). Every workflow job must retain the established literal-false condition, including manual dispatch and reusable jobs. Preserve its original condition inside the wrapper, and preserve the complete steps, commands, source and delivery artifacts.

Run focused product work in the existing cloud Linux or original local receiving operation. A public repository, available free minutes, cloud admission failure or a missing green check does not authorize enabling or dispatching hosted Actions. Do not set `HOSTED_CI=on`, add scheduled hosted runs or choose a paid runner. Keep source-native receiving moving with its original owner and saved operation.

Before publishing workflow changes, use the maintained Commons `tools/hosted_ci_gate.py --zero-spend REPO_ROOT` and `--check REPO_ROOT` source operation where that existing runtime is available. Its canonical wrapper is `${{ (false) && (ORIGINAL_CONDITION) }}`; the original condition is retained for native continuation. Provider disablement, the whole-account spending budget and dated billing remain separate controls; preserve current artifacts and their original custody.

This carries Bryce's existing zero-spend instruction from [Commons RULES, CI and spend](https://github.com/woahwhattheheck/commons/blob/main/RULES.md#4-ci-and-spend) into this repository's consumed entry guidance. Original cost coordination: https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791755765336589 .

