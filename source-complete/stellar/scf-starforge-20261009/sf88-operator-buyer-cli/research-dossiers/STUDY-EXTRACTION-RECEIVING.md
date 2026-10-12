# Complete original study extraction and receiving

This programme commissions the maintained Research application with the complete original NCT03529110 result record. It carries every source cell through the original question-specific eligibility study link, versioned forms, separate extractor drafts and submissions, source-based resolution, table publication and full editable receiving.

## Original source

The programme consumes three existing files. Their exact bytes are checked before the application receives them.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| NCT03529110 original registry study | 99,951 | 1e8f401843a30673b2d653ceb2682ad8f6d038af268a185c3333028d339d14c1 |
| Original study locator/provenance | 923 | 97e7af80fa105e38307228f657744d6ecd0ac0da20f023ee8677ad01ceef8720 |
| Complete original result projection | 22,605 | 26fe9d252136ec2e2428c2c04dd7afa9f0ab4b5a70b0e8dabc20c8802fe4c093 |

The original record is retained at `libfile_dd72ba9b31288191a91c7ac884bc7921`; its underlying file is `file_00000000250c822f82c7b76d425ba239`. The original locator is `libfile_21b0f142bcf08191917dd3fb28846293`. The complete result projection is the original Commons blob `86324e03609f0d8c23c7f99de7f0b2418ab56a2a`, also retained with its full source review in Canvas `F0C8NQ2GEBW`.

The source belongs to the original capture `capture-fb551338-f35d-46b3-b257-1138ba449c28`, observed on 12 October 2026 at 03:54:02.721 UTC. Its original page hash and URL remain in the locator. The application receives these files through the existing `createSourceBundle` / `receiveSourceBundle` APIs.

Original study: https://clinicaltrials.gov/study/NCT03529110

## Complete field selection

The case preserves five outcomes, seven classes, seven categories and fourteen measurement objects. Each row retains the complete original outcome metadata, class metadata, category metadata, contextual group, measurement object and denominator containers. Every form field has its own original JSON pointer.

The original Decimal helper resolves 112 distinct pointers into 182 answers: fourteen rows with thirteen required fields. Present entries in this source are JSON strings; all 138 present selections keep their exact strings. The other 44 selections retain explicit absence and a reason.

| Field | Meaning |
| --- | --- |
| value | Original reported value |
| lower_limit | Original lower confidence bound |
| upper_limit | Original upper confidence bound |
| comment | Complete measurement comment, or its absence |
| outcome_denominator | Count for this outcome and group |
| class_denominator | Count for this class and group, where reported |
| category_denominator | Count at the actual category scope, where reported |
| unit | Original `unitOfMeasure` |
| parameter_type | Original `paramType` |
| precision | Original `dispersionType` |
| time_frame | Complete original `timeFrame` |
| population | Complete original `populationDescription` |
| analyses | Original comparative `analyses` field, or its absence |

All outcomes retain overall denominators 261/263. Duration of response additionally retains class denominators 208/90 for BICR and 201/97 for investigator assessment. Those counts come from `classes[0].denoms` and `classes[1].denoms`; their category objects have no denominator field.

Reported `NA` remains a string accompanied by the original non-estimable comment and the authored answer status. Strings such as `77.0`, the original reported percentages, and every confidence bound remain unchanged. All five outcome objects lack an `analyses` field. The complete original record travels with every portable copy, so the surrounding source remains inspectable.

The programme's deliberate operator discrepancy is one extractor-B entry of `79.0` for the original BICR ORR value `79.7`. It is labelled as a commissioning operator entry. The source helper continues to return the original `79.7`, the draft retains the difference, and the resolution selects the original source-supported value. Both original submissions remain in history.

## Operating sequence

The sender creates a private Research workspace with two questions, receives the original supported source bundle for each question and completes an explicit registry source review for the primary question. That review uses the normal eligibility protocol, separate decisions, final resolution, exact-occurrence application and explicit study/report link.

The complete operator creates form v1 and the fourteen-row result set, saves and submits both reviewers' complete drafts, compares the deliberate entry discrepancy against the source and resolves every row. Native inspection then checks all 182 accepted values, their statuses, source pointers, source bytes, independent submissions and the retained discrepancy.

A table publication freezes all fourteen accepted result editions. Its readable columns accompany the complete original descriptors and source/reviewer/resolution context. JSON, CSV, Markdown and HTML exports carry the entire selected population. Full dossier and extraction reports retain the wider review history.

The sender prepares form v2 with the same complete field set and more explicit group/denominator review instructions. It records why the original baseline remains valid on form v1. The original Python `EligibilityDelivery` freezes the selected review and all twelve customer files, writes the complete customer ZIP, opens that exact ZIP and receives its JSON and gzip members through the maintained portable readers. The main programme adopts those two actual received directories. Its next review is authored in the customer archive's stream-reader workspace.

Receiving compares the original metadata, full source bytes, form and result history, source values, table/publication history and all readable exports at their selected revision. The related question is checked against its original state.

The receiving installation then creates the full v2 result set linked to the same existing study, saves two complete received reviews, resolves every row and records the replacement of the earlier set. A second table edition and publication preserve the first publication and expose the original complete comparison. The operator reopens the received work, and the original Python/Merchant caller reads full pinned pages, resolves all source pointers, replays selected committed requests and receives complete publication/source/portable exports.

Finally, the continued dossier exports again and opens in another fresh receiving workspace through both original portable formats. The result manifest identifies every completed source, result, publication and file by its actual revision and hash. Its row lineage maps each original source row to the prior and continued result editions. The native publication comparison retains the engine's actual logical identities; a replacement result set therefore appears as removed and added result IDs while the source-row lineage preserves their explicit relationship.

## Runtime and recovery

Use the existing source installation and the original receiving operation. The maintained runtime supplies Node, Python 3, Linux `flock`, the original Playwright module and Chromium, and the installed original Merchant/Python closure. The application owns and closes its listener and browser/transport children.

SIGINT and SIGTERM abort the programme's original browser, Merchant and Python customer calls and close its application listeners. Store operations check cancellation between the maintained transactions; the original Decimal source reader also receives the same signal. Streaming exports stop through their owned reader. An interrupted committed operation is recovered through its unchanged saved request on resumption.

The Python customer child is launched through `study-extraction-owned-child.py`. This is the exact existing 521-byte Linux parent-death wrapper from Commons commit `408fe378d693678c25bc2e2b4227bdefea80ce1e`, original path `integrations/native_wordpress/php-child.py`, Git blob `da6716e88cd5da76d754a969b84dda601e0e063d`, SHA-256 `0c5950245e3138dc929dfc8d1a0529a68e692c69c0f8233c3249303bcb29b544`. Its original source text is retained unchanged. The wrapper executes the selected Python receiver in its owned process group. If the Node owner ends, Linux delivers SIGTERM; the Python handler raises `StudyEligibilityCancelled`, a dedicated `BaseException`, through the original runtime's `finally` and workspace context cleanup. This exception remains distinct from `KeyboardInterrupt`, which the maintained SDK can consume while preserving an already completed bridge reply. The receiver catches its own cancellation only at the main boundary and exits 130 with the original cancellation error code. It does not call the workspace's joining close method from inside the signal handler. The outer caller escalates only that owned group after fifteen seconds if shutdown has not completed.

A JavaScript caller supplies an optional standard `AbortSignal` as `options.signal`. The same signal reaches both browser phases, both Merchant phases and the original customer archive receiver. Phase checkpoints and exact request files remain available for the next invocation.

The programme directory stores the input binding, original seed, exact canonical request files, selected phase results and completed output manifest. Each mutation is saved before the original store is called. On resumption, the same request ID and body recover the original result before new work continues. A complete result is reused after its retained output files are checked.

Connection descriptors and browser profiles remain inside the private programme workspace. The customer output consists of the named source, complete report/table/portable files and the selected browser screenshots. The original `8 MiB` state, `64 MiB` response and `256 MiB` portable limits remain enforced by the maintained engine.

## Run the complete programme

Use a complete existing repository installation containing the current Research,
Merchant and Python sources. The command consumes the existing three source files
and the runtime's actual Playwright and Chromium paths:

~~~sh
node /absolute/checkout/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/study-extraction-workflow.mjs \
  --operation DBC61-SCF-STUDY-EXTRACTION-20261012 \
  --run-directory /absolute/private/original-study-programme \
  --study-file /absolute/inputs/NCT03529110_Original_Registry_Study.json \
  --provenance-file /absolute/inputs/original-provenance.json \
  --projection-file /absolute/inputs/original-result-projection.json \
  --playwright-module /absolute/runtime/playwright-module.mjs \
  --chromium /absolute/runtime/chromium
~~~

Replace the absolute input and runtime paths with their existing locations. The
operation and programme directory identify this one continued run. Invoke the
same command to recover it.

The original extraction engine uses its maintained Python 3 source reader.
`--python` optionally selects the Python executable used to invoke the installed
customer SDK; it defaults to `python3`. The original Node runtime is
`process.execPath`, and the SDK checkout is derived from this source file's
original repository location. Python bytecode output is disabled for this
commissioning child.

A JavaScript caller may invoke `runStudyExtractionWorkflow(options)` using
the corresponding camel-case option keys. The default original drivers are:

| Driver | Role |
| --- | --- |
| study-extraction-browser.mjs | Complete browser authoring and received-workspace inspection |
| study-extraction-merchant-receiving.mjs | Complete original Merchant pages, source, exact operation recovery and eleven exports |
| study-extraction-eligibility.mjs / .py | Original Python eligibility delivery, customer ZIP and both receiving readers |
| study-extraction-owned-child.py | Maintained Linux parent-death binding for the owned customer runtime |

The returned `state: COMPLETE` manifest is produced only after the full
programme has completed. It carries both publication selections, original
customer delivery and Merchant histories, source-row lineage and every retained
artifact's relative path, byte count and SHA-256. The complete customer archive
and readable files are under the named delivery directories. Private connection
inputs, SDK call directories and browser profiles stay outside the artifact list.

### Complete receiving contract

The browser's author call returns the original form, form edition and result-set
IDs plus the reviewed revision and exact saved original extraction request file.
Its inspect call uses the selected received IDs on the same application listener.

The Merchant caller retains all extraction and publication sections at a selected
revision, the 112 original source pointers, complete original source content and
record, all three extraction reports, all four publication formats and both
portable formats. The receiving invocation also selects the prior publication
for its full comparison. Both supplied replay requests must already exist in the
selected native histories; their unchanged original operations are recovered.

The Python customer caller prepares one actual eligibility selection, exports its
two portable files, complete dossier Markdown/HTML, eligibility JSON and seven
section CSV files, and packages those exact bytes. Its fresh archive receiving
returns the original JSON and gzip workspace directories. The main programme
uses those directories for its full source/extraction/publication comparison and
then continues the received dossier.

## Source composition

The original extraction and publication engine is composed by 3AD7. The original browser, Node client, CLI and route integration is composed by 63DD. The case and full receiving programme are the DBC61 arm; the same team supplies the original Decimal helper and full Python/Merchant transport. Original installed/customer receiving remains with 7A2F.

The maintained methods used here are `eligibility`, `reviewEligibility`, `extraction`, `extractionSourceValues`, `reviewExtraction`, `exportExtraction`, `extractionPublications`, `reviewExtractionPublication`, `exportExtractionPublication`, and the existing dossier/source/portable APIs.

Method reference: Cochrane Handbook, Chapter 5, for planned extraction forms, independent outcome extraction, explicit disagreement resolution and linked reports of a study:

https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current/chapter-05


## Complete recurring customer delivery

After the original complete extraction and both receiving paths finish, the same programme continues through the maintained customer-updates product. The existing Python stream receiver supplies the customer sender. The existing final receiving workspace supplies the customer receiver. Both already contain the same original dossier, source, first publication and completed second review.

`study-extraction-customer.mjs` uses those original connections and the current ResearchWorkspaceClient. It binds the complete source occurrence and exact native question, Eligibility Study, form, result-set, table and publication records at the saved receiving revision. The first commissioning brief selects the complete first publication. The revised brief and requested update select the second publication with explicit denominator context and original-publication lineage. The work is frozen and delivered through `runResearchCustomerDelivery`, including the original complete work snapshot, four report formats and the original dossier handover. That handover is received into the existing final workspace. The final correction clarifies the cover and delivery notes while preserving both complete publications and all original source/review history.

The commissioning customer is the internal Commons research programme. Request origins identify its actual programme actor. All source intake references identify the existing retained edition. The native source comparisons must report the original population unchanged in the update and correction. The review snapshot records editable receiving as pending until that actual receiving has happened; the final correction records the successful prior receiving step. Original canonical customer requests and both native replays remain retained by the customer product.

The complete customer result is `customer-updates.json`; its full operating directory is `customer-updates/`. The whole programme result includes the project, all three delivery identities, both original table identities, actual source-change counts and both exact handover identities. Its artifact list includes the closed handover files, complete source selection, authored commissioning case and original-request replay output. Credentials remain in the original private connection files.

Recovery first reuses the original received-review completion and frozen revision. Subsequent customer operations can extend that same received workspace without causing an already completed extraction phase to execute again. Interrupted customer requests are reconciled by their original saved request ID and revision. The same signal reaches the customer clients through the existing fetch transport, and both owned application listeners join normal or interrupted closure. Run the same existing `study-extraction-workflow.mjs` command and operation directory to complete the programme.


## Full client template exchange

The same receiving programme continues the completed second publication through
the original template-exchange product before producing its continued dossier
exports. It uses the existing received store and application listener. The
selected publication and its fourteen original rows remain pinned to the saved
review revision while subsequent template reviews extend the same dossier.

The complete native continuation authors a commissioning workbook, maps every
original field by its stable result identity, releases the frozen table, receives
a reordered client workbook with one explicitly labelled proposed value and an
unmapped note, and reviews that complete return. The actual assigned reviewer
receives a complete uncertain draft through the existing extraction engine. The
original accepted request is recovered under its original request ID. A later
client template edition retains the notes and row order and receives its own
reviewed mapping and released workbook.

The original template product exports and receives the full extended dossier,
including its actual workbook, mapping, comparison, request and review blobs.
The existing Research browser then opens the selected return, review and draft,
downloads the released workbook, and records desktop and mobile screens. It uses
the current application's original fragment token; saved delivery records carry
only the public application path. The same configured Python interpreter is
passed to the original stores and application listeners.

The full continuing result is template-exchange.json, with the complete
operating files under template-continuation/. Its native and browser phases
reuse their original files and selected IDs after interruption. The main dossier
reports and both continued portable formats use the actual revision after this
template work. The original frozen extraction publication remains the selected
customer deliverable, and the subsequent customer handover carries the complete
template history in that same original dossier.

Inspect the emitted workbook previews and browser images when the native
programme finishes. The programme retains those exact files for the receiving
owner's visual review.


## Appraisal in this original programme

The complete Appraisal product is part of this same study workflow. Its full operator/source guide is [risk-of-bias/RISK_OF_BIAS.md](./risk-of-bias/RISK_OF_BIAS.md), with the browser controls in [risk-of-bias/BROWSER.md](./risk-of-bias/BROWSER.md) and exact native fields in [risk-of-bias/API.md](./risk-of-bias/API.md).

The original sender first completes its fourteen-row extraction and first evidence publication. The appraisal binder then selects the actual resolved primary PFS result from that original result set and the existing study/version. It binds the full independent A/B and resolver packet to the retained registry file: 99,951 bytes, SHA-256 1e8f401843a30673b2d653ceb2682ad8f6d038af268a185c3333028d339d14c1. All 301 passage occurrences use the original typed source resolver and 53 actual pointers.

The existing Appraisal browser authors the protocol/review, assessment, two complete drafts, two immutable submissions and source-based adjudication. The same authenticated listener then receives the typed client, actual CLI and Merchant reads, replays one already-committed request, and compares all four complete report formats. The sender's final revision and complete dossier exports include that original review.

Both original JSON and gzip receiving workspaces are compared at the same selected revision. Their complete appraisal views retain the exact protocol, study/result/source binding, all independent submissions, original adjudication and native operations. The received browser opens that saved review in its own actual workspace context.

The received continuation makes one explicit source clarification: A's baseline answer names the original MEDIAN statistic while preserving the reported 54.5 and 54.2 values. The new draft supersedes A's original draft; the new submission supersedes A's original submission; the new adjudication resolves the complete new A plus original B set and retains the earlier adjudication. This adds three original mutations and leaves B's independent submission unchanged. The existing full final export/reopen carries that corrected review before the maintained recurring customer programme continues.

The parent retains the earlier extraction revision checkpoint and uses the actual later appraisal revision for the received report/export and native head comparison. Its original operation ID, workspace, listeners, child wrapper, Python selection, cancellation signal, source input and canonical request recovery remain the same. Appraisal adds no other native controller.

The full result includes:

| Field | Retained output |
|---|---|
| appraisal.sender | Actual seven-action browser review, exact source selection, native transport receiving, reports and screenshots |
| appraisal.jsonReceiving | Complete original appraisal equality in the existing JSON receiver |
| appraisal.gzipReceiving | Complete original appraisal equality in the existing gzip receiver |
| appraisal.received | Actual received browser inspection, source-linked A correction, new submission and superseding adjudication |
| appraisal.continuedReceiving | Complete corrected appraisal equality after the original final fresh reopen |

The declared artifacts include each original browser request body, workspace-bound recovery envelope, accepted response, receiving state/result, source case, report, screenshot and typed/CLI/Merchant file. Private listener connections remain with the original application owner. The customer receives the complete editable dossier and its selected reports through the existing delivery paths.

The workbook exchange follows the complete received appraisal correction. Final report, portable dossier, and appraisal receiving use the actual final template revision. All original Research hosts receive the same programme cancellation signal and selected Python interpreter.
