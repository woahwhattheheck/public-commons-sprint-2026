# Contributor Engagements: complete native receiving

This course takes a selected agreement edition through the original SF47 Forecast and Portfolio, retains the native receiving review, exports the complete source case, receives it through the original importer, and reopens every retained collection and planning revision. The complete product course also verifies that same accepted case through the original typed Node client and registered merchant provider, downloads both complete exports, and resumes an interrupted retained-file read after reopening the same provider. The final delivery includes the full selected application and receiving source, all complete native case ZIPs, exact requests and responses, source attachments, and immutable snapshots of the completed receiving phases.

Use the existing original SF47 host and workspace. The host remains the only owner of its Workspace lock, SQLite database and native engines. The course uses its authenticated HTTP API. It does not initialize another application, open the database directly, create an alternative forecast engine, or send a payment or message.

The operator workflow, agreement fields, original CLI and all HTTP contracts are documented in [Contributor Engagements](ENGAGEMENTS.md). This guide covers the complete receiving programme and its original operation recovery.

## Choose the intended course

| Input mode | Original source selected | Native writes performed |
| --- | --- | --- |
| ACTUAL | Explicit existing case/version, current saved baseline Forecast, supplied original agreement document or existing reviewed book, selected confirmed agreement IDs, reviewed resource mapping and optional full Portfolio inputs. | A book only when a document was supplied; the selected native Forecast, Portfolio and receiving review; a distinct complete receiving case through the original importer. |
| WALKTHROUGH | Explicit immutable original plan/revision and source identity, selected calendar/as-of/confirmation dates, and the complete clearly fictional source card. | A new case with native mode WALKTHROUGH; its fictional source and two example contributors; baseline Forecast; proposed and confirmed book editions; native handover and receiving; a distinct complete receiving copy. |

ACTUAL consumes only the supplied original contributors, agreements, sources and selections. It never invents a confirmation, person or scope in an existing case. An agreement must already have the native CONFIRMED state and retain its actual confirming party, timestamp and source. The baseline must still describe the selected case's current recorded facts.

WALKTHROUGH creates its own explicitly named example case through the original create operation. The example card is attached in full with original source.add. Its example names and all terms remain visibly fictional. One person stays proposed with unknown availability; the other becomes confirmed in a successor edition for the course. The original native remaining package estimates provide the example allocation amounts. No cash observation or commercial promise is created. These results demonstrate the product, not an actual person's acceptance.

The course preserves the native Portfolio's actual allocationStatus and readyAlternativeIds. A narrow exploratory alternative may remain unfinished. A successful receiving record does not claim that every alternative is READY, or that a planning estimate has become received funds.

## Source and native prerequisites

Use the complete current SF47 product source whose root contains:

- budget.py, the original budget engine.
- workspace/managed_launch.py and the original Python/Node selected runtime.
- The complete Contributor Engagements backend, browser operator and CLI.
- The six receiving leaves listed below.

The maintained managed_launch.py BOOT_FILES tuple includes ../budget.py and current source dependencies outside sf47_budget_model. Those dependencies include the original developer-site source-table modules and settlement-accounting client. Source preparation reads the entire original literal declaration with Python's standard ast parser; it does not import or execute the engines. It resolves every declared runtime path against workspace/, then requires the resulting file to lie inside the explicitly selected repositoryRoot. It reads every complete file and its mode. It does not shorten the original selector to make a smaller package.

The receiving sourceDirectory is the sf47_budget_model product root, one level above workspace/. repositoryRoot is the complete original source repository containing that product and every externally referenced runtime member. For the current repository, select:

~~~json
{
  "repositoryRoot": "/selected/current-source",
  "sourceDirectory": "/selected/current-source/stellar/scf_2026/sf47_budget_model"
}
~~~

These paths identify source, not private case data. The complete native manifest records pathBase: "repository" and productPath: "stellar/scf_2026/sf47_budget_model"; every member path is canonical and relative to repositoryRoot. The receiver keeps the product path for the original engines and the repository path for complete source verification and delivery. An older self-contained product selection may omit repositoryRoot only when all original runtime members actually remain inside that product; the current external dependencies require the complete repository selection.

The exact managed_launch.py descriptor used to parse BOOT_FILES is itself included in the selection. Its selected bytes, SHA-256 and mode must equal the captured selector before preparation is published and on every reopen. The same manifest retains the receiving files and, when agent is selected, the complete original provider/client import closure and receiving companion. Portable manifest members never contain traversal segments or symbolic links.

The original source and receiving files are:

| File | Purpose |
| --- | --- |
| workspace/operations_engagements_receiving.py | Complete supplied-host receiving and recovery. |
| workspace/prepare_engagements_receiving.py | Read-only source, file and explicit native selection preparation. |
| workspace/ENGAGEMENTS_RECEIVING.md | This operating guide. |
| workspace/engagement-receiving-actual.example.json | Editable ACTUAL selection shape. |
| workspace/engagement-receiving-walkthrough.example.json | Editable WALKTHROUGH selection shape. |
| workspace/engagement-walkthrough-source.example.json | Complete explicitly fictional source card. |
| workspace/engagement-agent-receiving.mjs | Same-case typed-client and registered-provider receiving, full downloads and local reopen. |
| workspace/ENGAGEMENT_AGENT_RECEIVING.md | Complete agent receiving contract and file recovery. |
| workspace/engagement-agent-receiving.example.json | Editable input shape for the parent-owned agent phase. |

The examples contain marked path, identity and date selections. They are templates, not executed receipts. Replace every SELECT_ or date placeholder with the intended original selection. The illustrative localhost port is not evidence that a host is running there.

The native host must already be accepting the complete selected source. Preserve the existing receiver's ownership and coordinate a current source update with that owner. Use its actual loopback URL, original workspaceDirectory and private access.key path. The preparer hashes the complete key file and the receiver uses that same identity. Only the hash and original path appear in the receiving input; the token bytes are not copied into the delivery.

A separate receivingHost is optional. When omitted, the original importer creates the distinct receiving case in the same host and workspace. When supplied, it selects another already-running original SF47 host, workspace and private key. Neither option starts a host. Both use the original native importer and preserve the full source history.

The Python course uses the standard library in the same Linux environment as the maintained SF47 host. Its optional Node phase uses the selected original agent/client/provider modules and existing Node executable. The Python owner holds one kernel flock for its private receiving output. The awaited Node child inherits that same guard; it does not acquire a second application or receiving lock. Keep the complete repository source, both host workspaces, preparation directory and receiving output separate. Preparation and receiving output each require an existing owned private parent directory.

## Prepare a private selection

Make a private copy of the appropriate example JSON. Its schema is:

    stellar-forge.sf47-engagement-native-receiving.v1

Common required fields are operationId, mode, actor, reviewNote, importedCaseName, sourceDirectory, outputDirectory and host. Select repositoryRoot for the complete current repository closure. A supplied receivingHost has the same host fields. deadlineSeconds defaults to 3600 and accepts an integer from 1 through 86400. The complete product examples also select agent; omitting that object preserves the original Python-only course.

The final engagement.receiving command checks the complete saved Forecast and Portfolio. That accepted request may use the remaining overall receiving deadline instead of stopping after 30 seconds. It retains the exact reviewed body, version and request ID. Other native HTTP requests keep their existing 30-second request limit. Expiry or interruption still leaves an uncertain write for same-key recovery; it does not prove that the native transaction failed.

operationId is the stable identity of this complete receiving. Keep it through interruption and reopen. The native create/command/import request IDs are bounded deterministic derivatives of this operation plus the fixed phase identity. The exact first request body and key are retained before dispatch, and the full operation ID remains in the source selection and journal.

reviewNote must be nonempty. The original native review/import contract retains that note for book and final receiving writes. actor is the original recording operator, not a new authentication account. importedCaseName names the distinct receiving case and must not imply a new actual commitment.

### ACTUAL fields

Supply actual.caseId, actual.expectedVersion and actual.baseForecastId. The expectedVersion is an explicit reviewed version; preparation does not silently move it to a newer case. The preparer reads that exact case, requires OPEN, reads the selected current baseline, and pins the original plan content/source and full Forecast SHA-256.

Choose exactly one book input:

- actual.document: an absolute path to the complete original engagement JSON.
- actual.reviewId: the existing original reviewed edition. The preparer pins its complete reviewSha256.

Provide actual.agreementIds and actual.portfolioSelection.resourceMap. Each selected agreement ID must refer to a confirmed original agreement; each mapping retains its reviewed engagementId/resourceId pair. The native handover performs the authoritative contributor, source, uniqueness, date and allocation checks.

actual.forecastSelection may include the original explicit remainders and paymentModes choices, name and note. Omitted remainders use the original baseline less selected allocations. Omitted timing follows the native common-agreement rule; conflicting timing requires an explicit original choice. Decimal hours and money stay exact native decimal strings.

actual.portfolioSelection may include complete native inputs, name and note. Alternatively, actual.portfolioInputs selects a file containing the complete original native Portfolio draft. Use that file when preserving a larger reviewed portfolio or its Installation phases and alternatives. The preparer reads and hashes the entire file. The handover preserves unrelated original fields and applies selected contributor resources to the base and every explicit alternative through the native constructor.

The receiver reads the first case snapshot before any write, then retains it. If the live case changes before a yet-unfinished original command, the native expectedVersion guard rejects that command. Do not edit the saved request's version or key to bypass that review. A separate intentionally reviewed course can select the new state after the original operation has been reconciled.

### WALKTHROUGH fields

Supply walkthrough.planId and walkthrough.revision for the retained original plan. Preparation reads that exact immutable revision and fills planContentSha256 and planSourceSha256. Supply walkthrough.calendarStart, asOfDate, confirmedAt, name and exampleSource.path.

Choose dates from the intended course. confirmedAt requires a timezone and must be on or before asOfDate in UTC. The course does not override the server's clock or claim that a historical example is a current confirmation.

The supplied example card has two clearly marked fictional people. The first receives an example fixed amount equal to the native remaining package estimate, with explicitly selected hours. The second remains proposed. Their source card bytes, original attachment ID and all later book source references are retained.

The course uses the original Portfolio seed. Inside this new WALKTHROUGH only, it explicitly selects the one example contributor for the native grant packages and retains a one-day exploratory alternative. The native engine produces the resulting findings and statuses.

### Same-case Node client and merchant provider

Select agent for the complete native-plus-agent course. The existing managed grant launch must already describe the same original host and workspace. The original readGrantWorkspaceConfiguration and inspectGrantAgentBinding APIs validate that launch. An arbitrary HTTP URL or a manually constructed launch marker cannot substitute for the original managed binding.

The unprepared agent selection is:

~~~json
{
  "agent": {
    "nodeExecutable": "/absolute/original/runtime/node",
    "repository": "woahwhattheheck/tjlabs-stellar-merchant-workspace",
    "revision": "SELECT_THE_ACTUAL_FULL_40_CHARACTER_SOURCE_COMMIT",
    "providerConfiguration": {
      "path": "/absolute/private/engagement-course/grant-workspaces.json"
    },
    "workspace": "selected-grant"
  }
}
~~~

Replace the revision placeholder with the actual selected full Git commit. Use the existing regular executable chosen for that host. The preparer retains its full byte count, SHA-256 and mode as agent.nodeIdentity. It rejects a changed executable on reopen.

Use the original private provider configuration. Its selected alias must explicitly contain allowStart: false and the same original directory as host.workspaceDirectory:

~~~json
{
  "schema": "stellar-forge.sf47-workspace-connection.v1",
  "workspaces": {
    "selected-grant": {
      "directory": "/absolute/original/native-workspace",
      "allowStart": false,
      "label": "Selected original contributor receiving workspace"
    }
  }
}
~~~

Keep any actual original scenarioFile, pythonExecutable or host-input aliases required by that existing binding. Do not replace current provider configuration with this illustrative subset. The selected complete provider file must be private, must remain outside preparation and receiving output, and is bound by its complete byte count and SHA-256. Its bytes are not copied into the portable source delivery.

The preparer adds the complete provider, catalogue, original host-file/retained-file modules, typed client declarations, companion and guide to the native source selection. It writes ENGAGEMENT_AGENT_SOURCE.json with the agent source schema, original repository/revision, pathBase and productPath, and the exact same complete files array as ENGAGEMENT_SOURCE.json. Both phases therefore execute one selected full source edition. agent.sourceManifest is generated from those exact bytes; it is not a separately authored partial source list.

The Node phase reads the Python phase's completed native outcome and frozen original request journal. It verifies the original case, selected book, Forecast, Portfolio and receiving identities through the typed client and registered provider. When the course saved the selected book, it replays only the exact already-accepted engagement.prepare request whose returned review identity matches that book. ACTUAL with an existing reviewId has no new book-save request; that mode verifies the existing book without creating another edition. The phase also replays the exact already-accepted engagement.receiving request. The original native request IDs, expected versions, actor, note and full bodies remain unchanged.

The registered provider's snapshots, native summaries and file-read descriptors retain their original shapes. Complete export bytes are received through the original SDK download and retained-file protocol. The interrupted provider download preserves its accepted prefix and the same snapshot/file identity while the original provider closes and reopens. Subsequent chunks complete that original file. The parent then applies the original native case and planning archive validators to both full exports.

A fresh export can have its own exportedAt timestamp and ZIP bytes. Each actual response and full SHA-256 is retained independently; matching case contents are compared without replacing the original export bytes. No new case import or planning command is needed for this observation.

### File identities

In an unprepared selection, file objects may initially contain only path. The preparer fills their complete bytes and sha256. If bytes or sha256 are already supplied, the actual file must match. It applies the same rule to the original host key, plan source/content, existing book and baseline Forecast.

The final sourceManifest and preparationSource are produced inside the selected preparation directory. When agent is present, its sourceManifest is generated there as well. Do not manually replace their bytes or hashes. The original private selection-input.json is retained verbatim, and its complete hash remains in both the preparation receipt and native source manifest. Reopening a completed preparation checks the entire original source, captured selector, supplied files, runtime executable, provider configuration and exact generated agent manifest before returning the same PREPARED receipt.

## Prepare and run

Use the same original Python executable selected for the native source. These commands illustrate the stable interfaces; replace the paths with the actual selected placement.

~~~bash
python3 -B /selected/sf47_budget_model/workspace/prepare_engagements_receiving.py \
  --selection /private/contributor-course/selection.json \
  --output-directory /private/contributor-course/prepared
~~~

The preparer performs only source/file reads and selected original HTTP GETs. Its terminal receipt has state PREPARED and nativeWrites equal to zero. It creates:

- selection-input.json: exact original private selection bytes.
- ENGAGEMENT_SOURCE.json: complete selected repository runtime, receiver, companion and guide inventory, including budget.py, every maintained external runtime member and original modes.
- ENGAGEMENT_AGENT_SOURCE.json when agent is selected: original repository/revision plus exactly the same full file selection for the awaited Node phase.
- engagement-receiving.json: the complete pinned native input.
- PREPARED_NATIVE_RECEIVING.json: exact input/source identities and the zero-write preparation receipt.

After reviewing that concrete prepared selection, the already-authorized native owner runs:

~~~bash
python3 -B /selected/sf47_budget_model/workspace/operations_engagements_receiving.py \
  --input /private/contributor-course/prepared/engagement-receiving.json
~~~

The course owns only its private receiving output guard. The original server continues to own the application and its database. Do not launch an Operations CLI process against that same locked workspace while the host is active. All course mutations go through the host's original APIs.

The terminal JSON reports COMPLETED only after the complete native receiving, complete source delivery and private file verification finish. A PREPARED input, source publication or native preview is not a completed course.

## Actual native phase sequence

The first original GET, POST body and key for every phase are saved before dispatch. Later reentry uses those original selections.

1. Read and pin the explicit original case, or create the explicit WALKTHROUGH from the selected original plan.
2. For WALKTHROUGH, attach the complete fictional card, create its two example contributors and save the original baseline Forecast.
3. Read the selected actual book or save the supplied complete original document. WALKTHROUGH retains both proposed and confirmed editions with the native supersedes link.
4. Call engagement-forecast with the complete selected original agreements. Save exactly the returned native inputs with its expectedPreviewSha256 through forecast.save.
5. Reopen the full saved Forecast and compare its native inputs, report and full hash.
6. Call engagement-portfolio with the exact normalized book/Forecast selection and reviewed resource mapping. Save exactly the returned complete inputs through portfolio.save.
7. Reopen the full saved Portfolio, original baseForecastSnapshot, complete report and alternatives.
8. Save engagement.receiving with both original normalized handover selections and the exact saved book, Forecast and Portfolio identities. Check its actual allocationStatus and readyAlternativeIds.
9. Export the selected book as the complete original case ZIP. Preserve its original MANIFEST.json, selected engagement identity, readable engagement.html, full planning.zip and all native members.
10. Receive those exact ZIP bytes through the original native import endpoint, with the original stable import request. The importer validates every original review/event/record, native saved Forecast/Portfolio, source attachment, Installation and planning revision before the new case is published.
11. Reopen the received case, full paginated history, selected book, Forecast, Portfolio and receiving review. Download and hash every original source attachment.
12. Re-export the complete received case. Compare every retained non-placement collection, original selected engagement, exact source attachments, every planning revision/report and the original planning files. Only the original importer's new case/plan placement identity, name, import origin and creation/export times differ.
13. Read the original source case again to confirm the course's selected version and recorded rows remain unchanged during the receiving copy.
14. Publish the completed original native outcome and freeze its original request journal before the optional agent phase begins.
15. When agent is selected, reopen an existing completed local observation first. Otherwise await the same-case typed-client/provider receiving child, retain its complete reads, exact accepted-request replays and full downloads, and validate the two original export archives and all planning/source contents.
16. Retain the full selected repository source, freeze the completed delivery journal and manifest, publish the complete private ZIP, and reopen every byte before final completion.

All monetary and scheduling results come from the original engines. The caller compares their retained outputs; it does not recalculate a substitute forecast or allocation.

## Interrupted replies and same-operation recovery

Keep the entire original preparation and receiving directories. Re-run the same command and the same input. Do not replace the operationId, request IDs, versions, review selections or source manifest.

A completed native outcome is retained before the optional agent phase and source packaging begin. If delivery later fails, the same operation reopens that closed outcome and complete artifacts locally; it does not repeat the native course merely to rebuild the ZIP. Later legitimate changes in the source case do not erase that accepted phase.

With agent selected, ENGAGEMENT_AGENT_ORIGINAL_JOURNAL.json freezes the first NATIVE_COMPLETE request journal once. Reentry never replaces it with a later attempt journal. ENGAGEMENT_AGENT_SELECTION.json retains the exact parent selection, and ENGAGEMENT_AGENT_RECEIVING.json retains the inspected completed observation. The same stable agent/ output retains its selected source, original native identities, downloaded prefixes and ENGAGEMENT_AGENT_RESULT.json. Each actual child launch has its own immutable input.json, stdout.log and stderr.log under agent-attempts/0001/, then the next numbered attempt. A completed observation is fully inspected from retained local files before another child or network call. A packaging-only retry therefore retains both completed native and agent results.

Each native mutation is persisted as a complete original request before POST. The original server's request table recovers a committed result before it considers a later current version. After a lost reply, the caller reuses that same request and body. A published complete response file is recovered before another HTTP request. An uncertain response remains UNKNOWN in the private receiving journal.

Completed local selections, native response bytes and downloads are immutable files with complete hashes. A later phase cannot silently replace them. A different current case or source creates a source/version conflict and preserves the previous artifacts for review.

After a host restarts at a different loopback port, keep the original input and use only the current placement override:

~~~bash
python3 -B /selected/sf47_budget_model/workspace/operations_engagements_receiving.py \
  --input /private/contributor-course/prepared/engagement-receiving.json \
  --host-url http://127.0.0.1:ACTUAL_PORT
~~~

Use --receiving-url only when a separate receivingHost was originally selected. Overrides change only the current connection origin. The source manifest, original workspace paths, private key hashes, business selection and all request bodies remain bound. The existing native host owner is responsible for reopening its same data and selected source.

The first stop signal interrupts the caller's current HTTP wait, including a response whose body still owns the original socket, and stops admission of another phase. The same response and connection stay owned through cleanup. During the Node phase it is forwarded to that same child owner, which retains its accepted requests, client/provider instances, file readers and writers until they drain. The Python owner waits for that child to close and keeps the original output guard and private logs until then. It does not apply a short leaf-worker kill timer to an owner that is still closing its descendants. The inherited guard descriptor is closed once by the child without unlocking the parent's lease. The caller retains its journal and original file handles through final cleanup. The supplied native application remains owned by its original host.

The native server may have accepted a request when the HTTP connection was interrupted. Treat that request as uncertain until its same-key replay returns the original result. Do not infer a failed native mutation merely from a disconnected transport.

## Complete delivery and cold file reopen

The receiving output contains the original input/source selections, requests/, responses/, selections/, original-inputs/, native/, received/, received-sources/ and source/. With repositoryRoot selected, source/ retains the complete canonical repository-relative placement, including external runtime modules. Every complete source member retains its original mode. Native case ZIPs are kept unchanged. With agent selected, the complete stable agent output, frozen original agent journal and every attempted child input/log are included as well.

ENGAGEMENT_NATIVE_JOURNAL.json is the live private attempt journal. Its first completed native phase is frozen separately at delivery/ENGAGEMENT_NATIVE_JOURNAL.json. That immutable closed-phase snapshot contains all accepted requests, responses, derived selections and artifact identities. Subsequent delivery retries or final local reopens may append attempts to the live journal; they never rewrite the delivered snapshot.

DELIVERY_MANIFEST.json is published from that same frozen phase. It contains every member's path, size, SHA-256 and mode, plus the full source selection, original/received case identities, native result hash and frozen journal hash. It is complete before the ZIP becomes visible.

Contributor_Engagements_Complete_Receiving.zip contains the full selected source and every manifested original receiving file. Publication uses a private temporary archive and create-only link. It verifies the entire ZIP, flushes its bytes and all selected output ancestors, then exposes the final name. Reentry validates exact manifest bytes and every complete member, including original source modes, before reusing an existing ZIP.

ENGAGEMENT_NATIVE_RESULT.json contains the original native outcome, the selected agent observation when present, complete archive hash and state COMPLETED. Running the same command after completion verifies all retained artifacts and the final ZIP locally and returns that original result without repeating native case operations. The selected source and original private key files must remain available because they are part of the course's retained identity. The agent companion's inspect interface also verifies its existing completed observation from retained files; follow ENGAGEMENT_AGENT_RECEIVING.md for that exact input and result contract.

The final ZIP is private: it contains original case source, complete native records and operation material. Preserve it through the approved original artifact destination before a temporary carrier exits. The course provides exact file/hash metadata; the carrier's maintained artifact workflow performs the actual durable save. A local ZIP path by itself is not a provider save receipt.

## Limits and failure records

The original native API accepts complete requests and native case ZIPs up to 32 MiB. Original source attachments retain the native per-file and total limits. The selected runtime/source inventory is bounded at 128 MiB and 8,192 members. The complete private receiving delivery is bounded at 256 MiB. All archive members are read and hashed; large ZIP/PDF/PNG files are stored without an extra compression pass.

A source, case or version conflict preserves all existing different output. An ENOSPC or file failure leaves the original journal and complete published files for the same operation's reentry. The preparer/caller close every owned descriptor and private guard on failure, preserving the first error and recording cleanup diagnostics when necessary.

If the whole carrier is lost, restore the complete preparation/output/source placement and original host data through their existing artifact custody. Do not reconstruct a request from a screenshot or substitute a new source edition. If source truly must change, prepare a separately explicit reviewed source continuation with the original owner; changing a manifest hash inside an existing input is not recovery.

## What the final evidence establishes

A completed WALKTHROUGH proves that the original product accepted the fictional course inputs, produced its native outputs, retained source/history, and received the complete portable case. It establishes no actual agreement or payment.

A completed ACTUAL course proves that the explicitly supplied original agreement selection joined its saved native Forecast, Portfolio and receiving, and that the complete original case survived the native import/reopen. Original acceptance and money facts remain exactly those in the selected case and its source evidence.

The source publication, preparation receipt, native result, local complete ZIP and durable destination receipt are separate stages. Keep their actual identities in the original case handoff.
