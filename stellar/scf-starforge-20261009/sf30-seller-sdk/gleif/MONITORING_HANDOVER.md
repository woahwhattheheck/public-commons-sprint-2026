# GLEIF research → Monitoring portfolio

This is an original-product continuation. Company research prepares an explicit, frozen portfolio from its saved GLEIF capture and review versions. Source Monitoring receives that complete private file through its existing original-object store, portfolio projection, and full Workspace receiving path. Both original applications remain independently usable.

## Choose the exact source and meaning

Open the existing Company research project. In **Prepare Monitoring counterparties**, select exactly one complete source edition, choose all records or the source-specific included shortlist, and enter the stable Monitoring portfolio key and title. Reuse that key for later source editions of the same customer population. A different key is a different customer namespace.

Name and LEI are mandatory. Optional alternate/former names, registration number, entity status and address text are selected explicitly. The default FtM schema is LegalEntity. A GENERAL GLEIF category does not establish that the organization is a Company. Former legal names use previousName; other selected alternate/transliterated names use alias. Registration authority, original legal jurisdiction, address roles and languages remain in the full companion and original resource. LEI registration status such as LAPSED never becomes entity status.

Select **Review field mapping** and inspect the complete company population through its pages. A source or form change invalidates the preview. **Prepare complete Monitoring handover** uses the original saved operation ID, exact input, frozen reviews and recovery queue. A lost HTTP acknowledgement is continued from the original saved request, not submitted under a new ID.

The finished customer-file entry includes:

| File | Purpose |
| --- | --- |
| gleif-monitoring-portfolio.json | Complete private handover envelope, exact manifest and every attachment |
| portfolio.ftm.json | Exact LegalEntity JSON Lines accepted by the original Monitoring portfolio intake |
| mapping.json | Explicit field choices, original source/review identities and retained source meanings |
| gleif-project.json | Complete editable original GLEIF project snapshot taken before this handover operation |
| research-report.json | Complete original company research report and original records |
| research-report.html | Human-readable original research report |
| entities.csv | Exact machine CSV |
| entities.spreadsheet.csv | Separate spreadsheet-safe CSV; use this in spreadsheet software |
| original-records.jsonl | Full original selected resources, source-page bindings, exact native resource text and projection |

The project is a valid native GLEIF package. Its canonical body is followed by the original sha256 property. This deterministic wire layout lets the Python intake verify the exact original native identity without trying to reformat JavaScript numeric values. Native GLEIF receiving still applies its original package validation and source reconstruction.

A pre-operation snapshot avoids a self-referential project. It retains every earlier source page, review, report, dataset and saved operation. The handover operation and its files are additionally retained in the current research project and its later full exports. Interrupted handover requests retain their original project object too. File and project limits remain the original 256 MiB complete-object limits; an oversized handover fails visibly rather than dropping history.

## Receive in the original Monitoring desk

In **Monitoring → Counterparties → Receive GLEIF company research**, select the complete handover JSON, enter the receiving reviewer and note, and choose **Inspect source and field mapping**.

The native intake verifies the exact manifest/file bytes, the complete original project closure, selected source pages and unique LEIs, original review versions, field mapping and portfolio population. It shows the source capture and copied properties before the explicit **Receive reviewed counterparties** action.

The actual portfolio is created by the original Domain.accept_portfolio implementation. Stable entity IDs are gleif:<LEI>; the stable customer portfolio key remains separate. Existing portfolios and case history are not replaced. Identical FtM bytes under the same key reuse the original portfolio; a new immutable research-intake record preserves each explicit source/reviewer handover independently.

The original database now has the additive os_research_intakes collection. It retains the original request ID/hash, handover object, original research project identity, capture IDs, complete attachment objects and portfolio ID. It uses the original database, mutex and transaction. It is not a second portfolio or matching store.

A retry of the same request returns the original receipt after verifying its retained attachments. Reusing a request ID with changed fields is refused. Browser pending requests survive reload; a definitive rejected, uncommitted request is retained in browser history and can be replaced after a new review. An uncertain request remains available for exact continuation.

**Open original portfolio** continues to the existing counterparty table. The original native matching request preparation, explicit dispatch, actual provider-response intake and separate customer identity/relevance decisions remain unchanged. This bridge does not call a provider, buy a dataset, dispatch screening or make a sanctions decision.

**Use LEI in this case monitoring draft** explicitly adds leiCode to the current case's resolutionProperties while retaining its other choices. This is the original case monitoring policy, separate from a yente service/credential profile. Review and save the case through the original form. Earlier saved case policies are unchanged.

Each retained handover exposes its complete file, editable research project, mapping, report and data downloads. Both application URLs and tokens stay private to their original connection files. No connection token enters a handover or shared source archive.

## Native CLI and client use

Existing GLEIF commands remain available. A selection JSON has this shape; replace the source ID and customer choices with the actual saved values:

~~~json
{
  "captureIds": ["ORIGINAL_COMPLETE_CAPTURE_ID"],
  "selection": "included",
  "portfolioKey": "customer-research",
  "title": "Reviewed counterparties",
  "fields": ["aliases", "registrationNumber", "entityStatus", "addresses"]
}
~~~

Read the exact source preview:

~~~sh
starforge gleif monitoring-preview --connection PRIVATE_GLEIF_CONNECTION --selection selection.json
~~~

Use the returned previewSha256 as expectedPreviewSha256 in a normal saved request with action monitoring.prepare. Submit it through the original gleif run command or merchant_gleif_monitoring tool. The new merchant_gleif_monitoring_preview tool reads the mapping. The existing chunked file tool and new gleif file command retrieve complete original objects by SHA.

For a running Monitoring application, the original source-monitoring-client supports the additive native operations:

~~~sh
starforge source-monitoring-client --connection PRIVATE_MONITORING_CONNECTION upload --file gleif-monitoring-portfolio.json --media application/json
starforge source-monitoring-client --connection PRIVATE_MONITORING_CONNECTION post gleif-preview --input preview-request.json
starforge source-monitoring-client --connection PRIVATE_MONITORING_CONNECTION post gleif-receive --input intake-request.json
starforge source-monitoring-client --connection PRIVATE_MONITORING_CONNECTION get gleif-intake --params intake-identity.json
~~~

Preview request: original is the returned full-file object SHA; optional offset/limit select display rows only. Intake request is the exact JSON below. Keep it for replay.

~~~json
{
  "requestId": "ORIGINAL_UNIQUE_INTAKE_REQUEST_ID",
  "original": "COMPLETE_HANDOVER_OBJECT_SHA256",
  "expectedPreviewSha256": "EXACT_NATIVE_PREVIEW_SHA256",
  "reviewer": "Receiving reviewer",
  "note": "Purpose and chosen source edition"
}
~~~

The read parameters are {"requestId":"ORIGINAL_UNIQUE_INTAKE_REQUEST_ID"}. A committed result contains the original receipt and portfolio. No numeric IDs or source hashes should be guessed.

For an offline native workspace, the maintained Python CLI exposes gleif-preview --input FILE, gleif-receive --request REQUEST.json and gleif-intake --request-id ID. It uses the actual original Python environment and NDJSON engine. Do not open a second writer while that workspace's server is running.

## Complete original receiving course

The maintained gleif/receiving/monitoring.mjs command performs this one bounded course using the existing implementations:

1. Open the original closed GLEIF project and retain the exact selection intent.
2. Preview and execute the original monitoring.prepare operation; reuse its ID on continuation.
3. Write every original handover attachment with exact hash/byte checks.
4. Inspect and explicitly receive the original portfolio through the Monitoring CLI.
5. Export the complete original Monitoring Workspace ZIP, receive it independently, and reopen the exact intake and portfolio.
6. Receive the complete original GLEIF project independently and reopen its actual selected source captures.
7. Save gleif-monitoring-receiving.json with the original identities and full archive descriptor.

Use an already initialized Monitoring Workspace and original complete GLEIF project. Both writers must be available to their original command. This is source intake and independent reopening; it performs no source acquisition or screening.

~~~sh
starforge gleif-monitoring-receive \
  --gleif-workspace /PRIVATE/ORIGINAL_GLEIF_WORKSPACE \
  --monitoring-workspace /PRIVATE/ORIGINAL_MONITORING_WORKSPACE \
  --selection /PRIVATE/selection.json \
  --python /ABSOLUTE/ORIGINAL_PYTHON \
  --output /PRIVATE/NEW_RECEIVING_OUTPUT \
  --reviewer "Receiving reviewer" \
  --note "Original selected source and intended portfolio"
~~~

The output must be outside both original workspaces. Repeating the exact command/output resumes the saved intent; changed source choices require a new output. The current installed source is supplied separately through the original Merchant distribution. The command does not stop/restart existing servers or share their credentials.

The original full Monitoring export includes all native build packets, sources, cases, review cycles, research-intake records and original object attachments. Cold receiving verifies each research receipt and portfolio/file binding inside the original domain transaction. Earlier complete archives without research-intake records remain accepted and receive an empty additive collection. Original GLEIF receiving remains backward compatible too.

After native completion, open the original and independently received applications at desktop/screenshare and 390px widths. Operate the mapping pages, prepare/receive controls, pending-request continuation, retained portfolio, explicit LEI case-policy draft, original matching/case controls where actual authorized source/response data exists, and every download. Open the exact HTML and both CSV editions in their intended viewers, inspect JSON/JSONL data, extract the full Monitoring archive and open its working native project, then open the received GLEIF project and continue an original company review. Inspect screenshots rather than merely recording them.

A successful source/function check is not a claim of browser, Python/native or visual acceptance. The native receipt explicitly leaves visual acceptance pending until the original equipped owner opens and uses the exact outgoing versions. Correct the first actual exception or visible defect in place, preserving original source identities and the same operation.

## Subsequent customer portfolio refresh

The same original receiving command accepts optional `--refresh-selection PRIVATE_REFRESH_SELECTION.json` to compare an earlier same-key customer portfolio against the newly received one, save explicit original case decisions and cold-reopen the complete result. See [PORTFOLIO_REFRESH.md](../ndjson/opensanctions/PORTFOLIO_REFRESH.md) for exact choices and the full native continuation. Omission preserves the original receiving intent and course. A changed selection uses a new receiving output; no existing receipt or source edition is replaced.

## Source packaging

The original gleif-research contribution exports the mapping helper and new receiving command, includes both guides, and carries the browser asset through the original browser-assets.json manifest. GLEIF managed source identity includes the helper, UI, guide and receiver. The original ndjson contribution explicitly carries the Python intake and browser module. Source Monitoring's original application binding includes both new leaves. The original client admits only the three named additive operations.

Follow [MONITORING_FIELD_MAPPING.md](MONITORING_FIELD_MAPPING.md) for primary GLEIF/FtM meanings. The original [GLEIF operating guide](../../../../products/gleif/OPERATING.md) and [Source Monitoring operating guide](../../../../products/source-monitoring/OPERATING.md) remain authoritative for their existing workflows.

## Repository delivery instruction, carried in full

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


## Original customer review cycles

The optional `refreshSelection.cycle` continues this same native operation through reviewer assignment, exact original refresh decision, completion, supervisor sign-off and cold report reopen. Follow the complete [portfolio Review cycles guide](../ndjson/opensanctions/PORTFOLIO_REVIEW_CYCLES.md), including its attributed command sequence. Omission preserves the original course. All exact request bodies and signed JSON/HTML reports remain in the complete received Monitoring workspace.

## Local demo browser custody — original owner direction

From **16:00 UTC on 13 October 2026**, Bryce's local Codex in-app browser belongs entirely to Bryce for his demo. Do not navigate, reload, click, type, capture, inspect, resize, open or close tabs, or run automated checks on that browser. Leave selected demo/report tabs intact. Resume it only after Bryce explicitly says the meeting is over or releases it; no end time is assumed.

Engineering, source integration, shell work and Slack continue. Existing cloud workers may use their isolated browsers. This restriction does not create a new native operation or authorize borrowing another person's browser. Original direction: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791906463475599 .

