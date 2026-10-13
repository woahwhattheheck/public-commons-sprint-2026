# Document version intake and process handover

Use the original Flowable workspace to review a complete selected Alfresco file version, map its fields, start one selected BPMN definition, perform human work and receive the complete source and native history.

## Select the original document

The read-only capture command uses Alfresco REST v1. Select the existing repository, exact file node UUID and version label. Version labels such as 1.0 belong to the selected node; they are not the node UUID. Use the configuration in workspace/examples/documents/capture.example.json, replacing its explicit placeholders with actual reviewed values.

The operator supplies environment variables named by usernameEnv and passwordEnv. The capture needs permission to read the selected node, its version history and the selected version content. Credentials are never written into the source packet. The command does not upload, delete, revert, transform or modify an Alfresco document. No content service URL or customer endpoint is invented.

```sh
flowable-document-capture --config selected-document.json --out selected-document.capture.json
```

An existing successful output is reopened after checking the same repository/node/version selection; it is not recaptured on retry. A failed pickup retains its complete responses in a separate failure file. Resolve the actual error with the repository owner and choose an explicit fresh attempt. Authentication/permission/not-found/archived responses do not authorize current-content fallback.

The command reads current node metadata for context, all observed history pages, selected-version metadata, full selected-version content, then the same selected-version metadata again. It omits Range and If-Modified-Since and accepts only full HTTP 200 without Content-Range. Each original response body is retained with exact byte length and SHA-256. Content is limited to 4 MiB; each metadata body to 1 MiB; history to 32 pages of 100 entries and 256 KiB each; whole capture to 16 MiB. Larger work requires a deliberately revised source contract.

### Version changes and consistency

Alfresco's offset history pages are not a snapshot cursor. The pickup rejects duplicate labels, changing reported totals, incomplete pagination, missing selected versions and differing before/after selected metadata. It retains the actual observed page sequence separately.

An identical metadata response before and after pickup is an observed consistency check. It does not prove that the server could not change and restore a version in between. The API does not supply an atomic content/history snapshot or server-attested immutable digest. The retained SHA identifies the exact bytes this pickup received. A concurrent new current version need not invalidate the explicitly selected older version. There is never an automatic substitution of live node content.

## Review and map in the existing workspace

1. Open the original workspace and select its BPMN service. Refresh engine to save complete native process definitions and source.
2. Open **Document intake**. Load the complete capture and reviewed profile. The profile selects the repository URI and a namespace, one to twelve field bindings, original JSON pointers rooted at version or content, and the existing typed-variable mapping.
3. Select the captured BPMN definition. Preview the exact document hash, XML hash, business key and unchanged native request text. Inspect the actual original document in its normal viewer. The profile's task identities and business semantics must be appropriate for the selected model.
4. Save the complete original programme. **Prepare and review original start** uses its original stable request and verifies the native prepared definition and retained XML. Continue the original dispatch in its saved operation.
5. Use **Processes** and **Human tasks** for actual human work. Refresh engine afterward. **Show actual process and saved history** selects the exact process ID returned by original native reconciliation and reads that ID from the selected saved portfolio.
6. Open **History analysis** for the same saved capture. Its source coverage remains complete; document intake does not replace or relabel native historical observations.

Long and double source properties use the existing decimal-text contract. A signed-64 value such as 9223372036854775806 remains exact in the native body. Unrepresentable JSON numeric properties are not silently rounded. Native document identity variables are reserved: repository, node, version, complete capture/content hashes, original name and content length.

The programme identity binds the profile namespace, repository URI, node and selected version. Reopen its saved originals for recovery. A changed mapping/capture for the same identity is a review conflict, not permission to overwrite source or start another process. A separately approved new version has a distinct native intent.

## Source and result

The saved programme contains five full source members: complete Alfresco capture JSON, mapping profile, selected definition metadata, selected BPMN XML, and original document content. The original filename and media type stay in the capture; the portable binary member is document-content.bin. The complete programme is bounded by the maintained 16 MiB save limit.

The original workspace retains selected request bytes, plan, prepared native source, dispatch response and reconciliation, followed by complete process/task/activity/variable history. Document intake takes the native confirmed process ID; it does not fabricate an ID from the source business key. An UNKNOWN, DISPATCHED or READBACK operation stays with its existing reconciliation and does not receive another start.

## Independent receiving and cold reopening

The installed export ./seller/flowable/workspace/document-receiving supplies receiveFlowableDocument. Pass the existing producer and independent receiver clients, original programmeInput, original archivePath, and durable state/retain callback. Clients keep their maintained call, view, downloadDelivery and inspectDeliveryFile APIs.

The function invokes the existing receiveFlowableProgramme. Its read-only domain review verifies exact document/profile/definition/request before dispatch and confirmed native identity afterward. On confirmation it uses one durable original capturePortfolio request to retain the resulting native history before the complete export. It then uses the original exporter, downloader, inspector and adopter. It compares the same original programme, selected operation revision, process ID, saved portfolio and full source/result bytes in the receiving workspace.

After closing and reopening the original receiver, call reopenFlowableDocument({client,state}) using the retained state. This compares the exact original result again. No new engine, repository record, case store or process ledger is created. The receiver must be a distinct actual workspace.

## Editable reference

The shipped examples contain two editable editions of a document-review BPMN process, an authored text document, exact historical-version capture, mapping and capture configuration. Edition 1 has a document-review task. Edition 2 adds a handover approval task. The profile uses explicit example identities and typed properties.

These are authored implementation examples. They are not a customer's policy, evidence of a successful native run, or an Alfresco response observed from a live repository. Deploy them only in the selected reference environment through the original release operation, then use the captured real definition ID for preview.

## Original source contract

workspace/document-source-contract.json pins the actual Alfresco API definition at Alfresco/rest-api-explorer fddee4de42f85487a1b8b327e5c55ad3af15ffa6, src/main/webapp/definitions/alfresco-core.yaml. The selected version endpoints are documented from Alfresco 5.2. The customer's installed edition and permission configuration are selected and checked during commissioning.

The Flowable process and history operations remain the maintained original Flowable 8 REST contract and saved workspace APIs.

## Operate the actual outgoing edition

The responsible producing operator opens the actual complete outgoing version, works through populated/empty/loading/error and recovery states at wide and narrow sizes, downloads and opens the exact source document, mapping, programme and complete handover, then cold-reopens the independent received workspace. View the actual rendered screens and use each attachment in its normal application. Retain the real version/opening result; source parsing is a separate fact.

Bryce explicitly released the temporary local-browser reservation at 16:29:39 UTC on 2026-10-13 in original coordination https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791908979290839. Preserve existing tabs and saved state. The full exact-version product and attachment inspection rule remains in force.

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
