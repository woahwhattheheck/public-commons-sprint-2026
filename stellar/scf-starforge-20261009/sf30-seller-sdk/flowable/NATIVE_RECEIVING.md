# Native Flowable process, decision and case operations and customer receiving

This source runs the original Flowable 8.0.0 REST application and the complete operator product. The live engine owns process execution, task assignment, migration validation, DMN evaluation, CMMN case criteria and operating history.

## Original engine

The selected original engine is Flowable 8.0.0, source commit 0779d68e5a3385b74d8acb8bc37901ff54513249. The original release ZIP is 101,332,703 bytes with SHA-256 d0f9ad0b7b2170881d66928178cf31c66084f1d6e3ffe6237afb32d8e9f4ad1d. Its self-contained application is wars/flowable-rest.war. The launcher executes this member with Java17 or later and a private H2 file database.

Original sources:

- https://github.com/flowable/flowable-engine/releases/tag/flowable-8.0.0
- https://github.com/flowable/flowable-engine/tree/0779d68e5a3385b74d8acb8bc37901ff54513249
- https://github.com/adoptium/api.adoptium.net/blob/main/docs/cookbook.adoc
- https://adoptium.net/installation/ci-scripts/

The launcher reuses an installed Java17+ executable. If needed, it resolves one original Temurin21 JRE from Adoptium's publisher metadata, saves that exact selection, checks the publisher's artifact digest, and reuses the selected bytes when resumed. Playwright and Chromium likewise reuse the existing installed runtime; an absent runtime is acquired under the private native operation directory with its original package metadata and selected files retained.

## Whole original journey

The native journey deploys three complete BPMN process families: grant review, customer onboarding and vendor approval. Each has two original release versions. All first versions have intake and review work; the second version adds a final task after review.

The journey starts real processes with business keys and native typed variables, including a long integer that exceeds JavaScript's exact numeric range. It exercises claim, release of a claim, delegation, resolution and completion through the workspace. Flowable validates two original ProcessInstanceMigrationDocument bodies and migrates the selected running processes from their first to their second definition versions. One process retains its original version. The operator browser completes the final task of the migrated vendor process.

One accepted process-start reply is deliberately interrupted after its original engine response has been retained. The workspace is closed and reopened. The original saved dispatch is repeated locally with the same request UUID, then its actual native outcome is read. The journey checks that the original business key identifies one process and that the native start request was sent once.

Complete engine portfolios retain deployments, definitions, running processes, current tasks and original process, task, activity and variable history. Original BPMN resources and native replies are downloaded from immutable source references. The complete workspace is exported, reopened, received by a separate workspace and reopened there. A second complete export carries the later original history into that receiving workspace. The installed product hook then opens the same received data through its CLI, typed client, Applications provider and MCP surface on the same original engine.

The operator source has a neutral industrial layout. The native browser records the overview, definitions, migrations and actual task completion.

## Native decision editions and operating history

The same original REST application exposes the DMN service at
`/flowable-rest/dmn-api`. The launcher waits for the actual native decision
endpoint and saves a separate `dmnConnection` beside the original process
connection. Both use the same private engine and its host-owned credentials.

The decision programme deploys the six complete resources in
[the native decision catalog](fixtures/decisions/decision-catalog.json).
It runs all four authored business cases against each edition:

| Native family | Input | First edition | Second edition |
| --- | --- | --- | --- |
| Grant eligibility | Exact decimal `10000.1250` and integer `922337203685477580612345` | Specialist review | Standard review |
| Grant eligibility | Exact decimal `50.2500` and the same large integer | Standard review | Standard review |
| Vendor review | Screening score 75 | Routine review | Enhanced review |
| Onboarding | Contractor, remote true | Contractor onboarding | Remote onboarding |

These are editable demonstration rules with their original XML and native
Flowable results. The actual browser then prepares, reviews and evaluates
the second grant edition, opens its native execution audit, and retains
screenshots of the decision portfolio, evaluation and audit.

The complete decision capture includes all native definition versions,
deployment resources, execution records and original audit bytes. The
installed continuation evaluates the current native rule through the typed
SDK, installed CLI and authenticated MCP connection, using the same saved
connection and original body. Its final complete export is received through
the original MCP file stream, adopted and cold reopened with every process
and decision revision.

The native journey reports its original engine mutations and retained
responses. A completed decision result contains all eight versioned case
evaluations, the actual browser operation, source hashes, historic audit
downloads and the installed continuation. The selected contribution
publishes the full native DMN contract and source catalogue beside the
operator's [decision guide](../../../../products/flowable-merchant/DECISIONS.md).

## Native adaptive case editions and work

The same original application exposes CMMN at
`/flowable-rest/cmmn-api`. The host explicitly configures
`flowable.cmmn.enabled=true` and `flowable.cmmn.servlet.path=/cmmn-api`, then waits
for an authenticated native
`GET /cmmn-repository/case-definitions?size=1` response. Its saved
`cmmnConnection` uses that full URL. The process, decision and case aliases are
distinct and share the original private engine, administrator and database.

CMMN uses the original shared `flowable.history-level=full` setting. The pinned
[FlowableCmmnProperties source](https://github.com/flowable/flowable-engine/blob/0779d68e5a3385b74d8acb8bc37901ff54513249/modules/flowable-spring-boot/flowable-spring-boot-starters/flowable-spring-boot-autoconfigure/src/main/java/org/flowable/spring/boot/cmmn/FlowableCmmnProperties.java)
declares the CMMN service properties, and
[CmmnEngineAutoConfiguration](https://github.com/flowable/flowable-engine/blob/0779d68e5a3385b74d8acb8bc37901ff54513249/modules/flowable-spring-boot/flowable-spring-boot-starters/flowable-spring-boot-autoconfigure/src/main/java/org/flowable/spring/boot/cmmn/CmmnEngineAutoConfiguration.java)
sets its history level from the shared Flowable properties.

The original [case catalog](fixtures/cases/case-catalog.json) contains six editable
CMMN resources and three complete typed-input documents:

| Native model key | Programme |
| --- | --- |
| `tjlGrantDueDiligence` | Grant due diligence with manual review and retained evidence |
| `tjlVendorException` | Vendor exception work and source confirmation |
| `tjlOnboardingInvestigation` | Onboarding investigation, exception review and approval |

The commissioner deploys and operates both editions of each family through the
original workspace model. It retains native plan-item transitions, human tasks,
criteria, milestones, variables and complete case history, including a
controlled termination. One additional onboarding case on the second edition
continues into the installed product with its original review task active.
Its exact portfolio revision, native definition, case, plan item, task and
completion body are part of the same saved journey.

The installed continuation operates that same task and case:

1. The typed SDK claims the original review task. The installed CLI releases
   that claim using native `{"action":"claim","assignee":null}`. The authenticated
   MCP connection claims the same task again.
2. The **Cases** browser opens the saved original definition and downloads its
   full CMMN source. It prepares, reviews and completes that task with the
   original `evidenceReviewed=true` typed variable.
3. The original case remains active and its authored source-confirmation plan
   item becomes active. MCP triggers that exact item, starts the resulting
   manual exception review, completes the exception work with
   `exceptionResolved=true`, and completes final approval with
   `handoverApproved=true`.
4. The browser reopens the captured completed case, its task and plan-item
   history and both onboarding milestones. The final export follows these
   operations and contains their original source, requests, responses and
   record revisions.

Native task and plan-item IDs are selected from the saved case and verified
against their CMMN owner. The installed continuation never starts a replacement
case to recover an interrupted action. Its SDK, CLI and MCP requests retain
their original UUIDs. A browser retry finds the original selected-case operation
and native request before attempting another preparation. An already dispatched
request continues through original readback; an unresolved trigger requires its
original receipt.

The complete capture pages all eleven CMMN collections, including variables and
available binary variable data. SDK, CLI and MCP open the same saved definition
and case revision. Complete source downloads preserve native byte counts and
SHA-256 values; the browser source download is checked against that same
original source. The installed product exposes all **41** workspace actions and
**47** original merchant tools.

## Run with the complete original source

Use an existing Linux worker with the complete source and Node24 or later:

~~~sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/flowable/flowable-native-host.py \
  --source-root /absolute/original/source \
  --source-revision ACTUAL_INSTALLED_COMMIT \
  --runtime-directory /absolute/private/flowable-runtime \
  --directory /absolute/private/flowable-native-operation \
  --operation FLOWABLE-PROCESS-OPERATIONS-D76C-20261012
~~~

The runtime directory is the READY maintained runtime-install result for the same flowable-merchant release, prepared with --feature mcp --operator. The launcher inspects the complete original package, source, selected dependencies and recorded lock before running the journey from runtimeDirectory/package/source. Applications preparation and merchant MCP therefore use the installed product and its actual dependencies.

Optional original runtime selections are --node, --java, --playwright-module and --chromium. The default engine heap is 768MiB and the default CPU count is two; --java-heap-mib and --native-cpus select the available host allocation.

The native directory owns the engine configuration, credentials, H2 database, process identities, package selections, source revision and saved journey. Continue that directory with its original input after an interruption. A kernel lease excludes a second native owner. Process identity includes its Linux boot ID and start time; cleanup closes only the original process groups owned by this operation.

The host keeps its mode-0600 application-environment.private.json outside the journey handover. The installed journey receives only that path and uses the maintained Applications environment reader. The installed product, Applications owner and merchant configuration directories live beside that private file, so their original listener credentials and URL records remain with the native host. The complete customer downloads, receiving receipts and browser images remain in the journey handover. The workspace and its complete customer export retain environment variable names.

## Receive source and build the original selected product

receive-source-release.py consumes one complete commons.flowable-build-source.v1 JSON packet containing the original signed Git commit capture, complete tree and selected full source members. Every member carries its original Git object ID, bytes, SHA-256 and Base64 content. The original tree retains each blob entry's native size metadata, including when its other metadata is compacted for transfer.

The receiver reconstructs the original Git objects with the maintained git-object-receiving.py, builds the flowable-merchant selection using the maintained distribution builder, inspects the whole selected product archive, and creates an editable complete-source ZIP plus a separate commons.flowable-source-release.v1 manifest.

~~~sh
python3 receive-source-release.py \
  --packet /absolute/complete-flowable-source.json \
  --directory /absolute/private/flowable-source-receiving \
  --native-directory /absolute/private/flowable-native-operation
~~~

source-release-result.json identifies the complete source ZIP, source manifest, selected release and original distribution receipt. With --native-directory, the same invocation prepares, installs and inspects the original selected runtime, continues the native launcher, and joins its completed workspace export to the source, installed runtime and selected release. Interrupted dependency installation resumes in the retained runtime; interrupted archive preparation uses the maintained installer's original recovery workflow, preserving the earlier directory.

## Complete receiving outputs

The native programme resumes interrupted portfolio captures and preparation with their original frozen inputs. After a pre-dispatch interruption, it retains the refreshed prepared revision and saves a dispatch input for that review. When a native request was already dispatched, continuation uses its original saved input and native readback. The installed SDK, CLI and MCP hooks likewise reopen current preparation records instead of caching an interrupted result. Interrupted readback can continue with the same reconciliation request.

A completed original native run produces delivery.json, journey/journey.json, native-receiving-manifest.json and flowable-complete-native-receiving.zip. The completed scope retains its original identity, complete-native-process-history-and-cold-receiving. The archive contains the closed original journey workspaces, source downloads, the initial and later full workspace exports, the final installed export, native operation reports, installed product receiving results and browser images. Both native commissioning and the installed continuation must finish before the host records PASSED; original process groups are drained and CLOSED before archive publication.

The initial and later commissioning exports remain in the original journey step complete-native-process-history-export-and-cold-receiving. The installed-product-cli-client-applications-and-mcp-receiving step returns completeWorkspace with the final delivery record, receiving record, complete file identity and receiving workspace UUID. This final export includes the subsequent SDK, CLI, MCP and browser operations. The parent result.workspace selects those exact final bytes, while commissionedWorkspace retains the earlier handover. The source receiver uses the final installed completeWorkspace for company receiving.

The final installed export keeps its existing filename, complete-process-and-decision-workspace.ndjson, and now contains the complete case programme as well. Its full original MCP file stream is checked through EOF, adopted with the retained manifest and request UUID, then cold reopened. All **15 core record kinds** are compared, including every revision: connection, portfolio, release, process, task, migration, decisionPortfolio, decisionRelease, decisionEvaluation, casePortfolio, caseRelease, caseInstance, casePlanItem, caseTask and programme. Delivery and receiving records preserve their separate workspace authority. No private engine credentials, listener tokens or database files are added to these customer exports.


## Complete programme and source authoring continuation

The same installed journey commissions the original three-family BPMN programme (29 steps and 10 complete source members) and the original three-family DMN programme (14 steps and 7 complete source members). The DMN course reviews each original prepared operation before dispatch, and every confirmed or recovered operation against its retained native definition, full source and typed result. Saved request IDs, operation revisions and complete source identities survive interruptions. The final export and cold receiver retain all programme records, original step outcomes and source members.

The actual installed browser also opens the complete process, case and decision source examples on their corresponding saved native connections. It operates editable source, catalogue identity repair, complete previews, source/draft/programme downloads, file reopening and the same workspace-scoped browser draft after reload. It captures empty, loading, validation-error and populated views at 1440×1000 and 390×844. The browser-generated programme save request is retained before forwarding unchanged; an uncertain reply reopens that same request. Exactly one edited decision programme is saved for native review. The separate original 14-step native decision commissioning course remains the only such execution in this continuation.

Open the actual `authoring-*.png` images and use the exact installed product; screenshots are not reviewed merely because the journey saved them. Open the complete draft and programme downloads through the same product, operate its important controls, and inspect the final complete receiving after cold reopen. The installed report retains `authoring.visualReview.state: REQUIRES_PRODUCING_OWNER_INSPECTION` until the producing owner has actually inspected the returned images and product and repaired any affected readability, layout, control or attachment defect. A native journey result does not itself establish customer-facing visual readiness. Return the actual image files with the source commit, viewports, controls and attachments opened, and any repairs, to the existing producing owner.

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
