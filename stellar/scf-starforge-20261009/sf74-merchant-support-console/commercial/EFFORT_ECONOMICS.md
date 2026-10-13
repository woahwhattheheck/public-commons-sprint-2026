# Commercial delivery effort and private quotation economics

Use the existing SF47 Customer Installation and the original SF74 **Private economics** tab together. This handoff carries a selected saved commercial Installation, its complete operating case and source history, and the exact selected private planning assessment. It previews a new assessment through the original economics engine. Customer quotation prices and accepted scope remain their original records.

## Open the complete internal example

The internal example opens the original Merchant application and SF47 Delivery operations together. Its separate **WALKTHROUGH** case carries an explicitly authored quotation, acceptance, work records and remaining-work estimates, so operators can use the complete workflow without preparing a live customer's records.

From this complete repository checkout:

```sh
node stellar/scf-starforge-20261009/sf74-merchant-support-console/commercial/effort-economics-example.mjs \
  --out /ABS/private/commercial-effort-example \
  --merchant-port 18776 \
  --operations-port 18777 \
  --python python3
```

The launcher prints the Merchant opening URL and the private Operations access-file path. Open that file to enter the original authenticated SF47 application. The original access token stays inside its private access file. In SF47, choose the example plan and Delivery operations case, then **Customer installations**. Open the saved internal Installation, choose **Use this edition as a draft**, and read current work and accepted tasks. The normal allocations, remaining-hour reviews, full preview, history and saved-edition export controls are available.

The original economics example supplies a USD 7,200 implementation quote and USD 600 monthly care line, with a private planning assessment of 60 implementation hours and a separate USD 95/hour contributor-time valuation. The delivery example records 18 and 24 hours of authored Work and an explicit 30-hour remaining estimate. The original effort engine therefore projects 72 implementation hours. Quoted task effort remains unknown; the 60-hour private plan and the original quotation's billing line retain their separate meanings.

At 72 projected hours, the existing planning-valuation scenario uses USD 6,840 for contributor time plus the original USD 360 referral assumption against the USD 7,200 implementation fee. Its planned contribution is zero. Cash labor cost remains unknown in the original private assessment. All of these values are editable example inputs, with their source notes retained.

To operate the browser workflow and the complete independent receiving path automatically using installed local browser binaries:

```sh
node stellar/scf-starforge-20261009/sf74-merchant-support-console/commercial/effort-economics-example.mjs \
  --out /ABS/private/commercial-effort-example \
  --python python3 \
  --receive \
  --playwright /ABS/installed/playwright/index.mjs \
  --chromium /ABS/installed/chromium
```

This uses the actual SF47 browser controls to read Work, apply the explicit remaining estimates, preview and save a new Installation edition, download its complete ZIP, and reopen the saved edition. That exact browser-produced ZIP becomes the source for the original private economics receiving course. The course saves one new private assessment, exports the complete merchant case/source, receives it independently, and verifies it in a fresh process. It then uses the original and received Merchant screens, downloads and reimports the actual assessment, opens the unchanged exported Installation HTML, and captures desktop and narrow views.

The example retains its original operation, quotation, planning-assessment, authored-acceptance, browser-save and receiving request IDs. Reopen it with the same directory and selected ports after interruption. Existing user edits and historical editions remain in their original application stores. The launcher closes only its owned listeners and browser; the complete private example remains available.

The complete output directory includes both application workspaces, the complete Merchant source handoff, the saved Installation ZIPs, the original and observed economics, the independent receiving stores, editable inputs, readable exports and actual screenshots. Open and inspect the actual screenshots and use the retained applications before presenting this version. The programme records browser operation separately from that human inspection.

## Select and save the real delivery work

Open the original Delivery operations case and its commercial Customer Installation. Select the actual accepted quotation/source through the existing commercial source reader. Attribute actual Work records to accepted task/check identities, enter reviewed remaining implementation effort with its original source and as-of date, preview, then save through the existing Installation writer. Keep the original request ID, expected case version, Installation revision and preview digest when recovering an interrupted reply.

The commercial source does not specify task effort merely because a quotation line has a price or quantity. Commercial quoted hours and quoted-hours overruns remain unknown. Care price or service duration does not establish a support window.

Download the **complete case for this selected Installation revision**. The original archive includes installation-selection.json, installation-effort.json, the full saved Installation and history, original Work and source files, and nested original planning case. A report JSON by itself is insufficient.

The original CLI offers the same workflow:

- installation-effort-seed: select --case, --installation, --expected-revision, --expected-version and --as-of; retain the complete returned editable document.
- installation-preview: pass the complete edited document with the original case/version/revision.
- installation-save: pass that complete document, --expected-preview-sha256, original --request-id, --actor and --note.
- installation-export: select --case, --installation, --revision and --output.

Use the existing workspace/CLI.md and INSTALLATION_EFFORT.md for these native command arguments. This module adds no alternative Work writer or acceptance rule.

## Prepare a private economics handoff

Use the existing installed merchant-commercial command, or its source commercial-cli.mjs entry, with economics effort-preview. Supply:

| Selection | Arguments |
| --- | --- |
| Existing Merchant case | --cases-dir DIR --case ID --revision CASE_SHA256 |
| Exact original quotation | --quote ID --quote-sha SEALED_QUOTE_SHA256 |
| Exact saved planning assessment | --assessment ID --assessment-sha SEALED_ASSESSMENT_SHA256 |
| Full original Installation ZIP | --archive ABSOLUTE_PRIVATE_ZIP --archive-sha FILE_SHA256 |
| Saved Installation | --installation ID --installation-revision N --installation-sha EDITION_SHA256 |
| Recomputed original effort report | --report-sha REPORT_SHA256 |
| Explicit scenario | --hours-basis RECORDED or PROJECTED; --cost-basis UNKNOWN or REUSE_SELECTED_PLAN |
| Owned output | --out ABSOLUTE_PRIVATE_DIRECTORY; optional --python EXECUTABLE |

All file selections use complete exact bytes; quotation/assessment/report sealed digests are distinct from downloaded-file digests. Preserve them separately.

The native helper imports the full archive into an isolated private temporary workspace using the original Workspace and Operations engines. The receiver validates the full original planning history, source bytes, event history, immutable Installation and selected effort rendition, then recomputes its effort report. It compares the original commercial case, quotation, accepted scope, customer response and selected source binding. It never opens the operating writer's live workspace.

The handoff then binds the report to the selected merchant quotation and original quote-origin case. PROJECTED requires the saved report to be ready for planning, with complete remaining reviews and an unchanged current selected-record observation inside the received operating case. That current observation describes this complete exported edition; it makes no claim about subsequent edits to the remote original workspace.

RECORDED selects the original recordedHours. It is incomplete cost-to-date with remaining effort shown separately. PROJECTED selects original projectedTotalHours, including reviewed remaining implementation effort. Neither changes the saved native report or claims customer completion.

UNKNOWN starts cash cost, planning labor valuation, other costs, care effort and care capacity unknown. REUSE_SELECTED_PLAN explicitly reuses those inputs from the selected sealed planning assessment; they remain planning assumptions, not recorded expenditure. The comparison uses the existing economics engine's exact output, keeping cash-cost and planning-valuation scenarios separate. Quotation fee less selected effort cost is a planning contribution scenario, not recognized revenue or realized profit.

## Inspect and explicitly save

The complete private output contains:

- installation.zip: every original native case/source byte.
- native-effort-verification.json: complete selected Installation, frozen snapshot, recomputed report, source binding, current-in-export observation and original reader identities.
- planned-assessment.json and quote.json: exact original sealed documents.
- economics-input.json: new complete private input with the selected hours/cost basis and source identities in its note.
- economics-preview.json and comparison.json: original native review and complete planned/source scenarios.
- README.md, selection.json and effort-economics.json: readable scope, immutable selection and whole member inventory.

Inspect the complete report, task coverage, findings and unknown values. The ordinary **Private economics** import control accepts economics-input.json. Preview there, inspect the original input and all cost/valuation cases, then explicitly save. The CLI equivalent is economics save with the exact --input, --input-sha, original --request-id, --actor, --revision and --review-sha from this preview. Preparation itself does not save.

Keep the complete handoff with the merchant case/source package when transferring work. The merchant assessment carries its original source identities in the input note; this does not invent an attached source blob in the merchant case. The operated receiving course explicitly transfers the complete handoff alongside the full merchant source package, retaining the original archive and planning assessment.

To reopen, use economics effort-reopen --cases-dir DIR --from HANDOFF_DIR --sha256 HANDOFF_MANIFEST_SHA256 [--python EXECUTABLE]. Every full member is checked, the original native ZIP is verified again, and the same economics engine replays the retained original quote and input. Later case edits do not force a historical read through a stale write revision. A changed installed native verifier is reported as a source difference; use the original retained source version when reproducing an earlier handoff.

## One complete operated receiving course

commercial/effort-economics-receiving.mjs exports receiveEffortEconomics(input,{out,environment,signal}). Invoke its CLI with --input PRIVATE_JSON --input-sha SHA256 --out PRIVATE_DIRECTORY. Reuse the same input and output after interruption.

Required input schema is stellar-forge.merchant-effort-economics-receiving.v1. Supply the actual operationId; casesDirectory, caseId and revision; quoteId/quoteSha256; original planning assessmentId/assessmentSha256; archive/archiveSha256; installationId/installationRevision/installationSha256/reportSha256; hoursBasis/costBasis; original requestId and actor; exportId; independent receivedCasesDirectory and receivedSourceDirectory; receiveRequestId and receivingActor. sourceDirectory and generatedAt follow the original full-case exporter; python selects the installed interpreter.

The course prepares and retains the exact source handoff, writes the complete invoking request before one explicit original saveEconomics, and resumes the same native request after an interrupted reply. It exports the entire merchant case/source, receives it independently twice under the same request, verifies the same original assessment, transfers every effort handoff member, and launches a fresh process to verify the full native ZIP and original economics replay alongside the received case. It does not synthesize a customer agreement or publish prices.

Use an existing selected actual case only with its original owner/input. A clearly labelled operator example belongs in the existing example launcher’s separate workspace; never insert authored example work into a customer case. The complete output directory is the transfer unit. No original archive or source member may be omitted from its later delivery package.

Continue the existing equipped SF47/SF74 operator course for rendered receiving. Open the exact selected commercial Installation, inspect task/check attribution and complete/incomplete remaining reviews, download the full selected ZIP, operate this handoff, and import the new input in **Private economics**. Use the ordinary preview/save/history/JSON/report controls. View the full original and received case and the complete handoff at presentation and narrow widths. Record actual observations and inspect the screenshots; the source-only course result intentionally does not mark visual acceptance.

## Sources and runtime

The new Python helper depends on the installed original SF47 workspace modules and their existing commercial source reader. The new JS handoff depends on the original SF74 economics, case store, private file reader and receiving code. Use the complete selected application distribution with its original managed source, not isolated copied leaves. No HTTP provider request, signer, payment, customer acceptance or Forecast mutation is part of this handoff.


---

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
