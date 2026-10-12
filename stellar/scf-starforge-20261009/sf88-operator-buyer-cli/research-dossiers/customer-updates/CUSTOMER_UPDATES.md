# Research customer updates

Customer updates turns an existing Research dossier into an ongoing customer project. The operator records the agreed question, protocol, source queries, outputs and commercial scope; commissions a baseline, later update or correction; reviews the original retained sources and selected research decisions; and publishes a complete frozen delivery. The customer receives the same editable dossier and can continue its project, work and delivery history.

The operator runs in the original Research application at **/customer-updates.html**. Its Node client, terminal commands and Merchant tools use that application's existing private listener, workspace identity and native writer. Source acquisition, eligibility, extraction, appraisal, evidence publication and synthesis stay in their existing Research tools. Customer work selects their actual saved records and freezes their complete contents with the delivery.

## Complete operator journey

### 1. Open the existing dossier and agree the work

Start or open the original Research workspace using its normal operator instructions. Open Customer updates from the workspace, select the original dossier, and enter the responsible operator ID and name.

In **Customer brief**, create a project with:

- The customer's stable ID, name and original relationship reference.
- The research purpose and the original dossier question IDs.
- The protocol's title, version, original source reference and notes.
- Every agreed source plan: provider, exact query, typed original parameters, original query or source-workspace handle, terms and coverage constraints.
- Each requested output and its explicit acceptance criteria.
- The quoted or agreed commercial scope, charging basis, original reference and update policy.

**Use an existing Europe PMC query edition** reads a query already saved by Literature searches. Select the original or received source library, query ID, exact revision and dossier question. The imported plan retains the actual query, canonical provider selection, source terms and query-version SHA. Acquisition continues in the original literature tool; importing a plan does not acquire or change source material.

Save the initial brief. Record the customer's actual response in the same page with its original correspondence reference and contact. A revised brief creates another immutable brief edition with an explicit reason. Existing requests retain the brief edition they were commissioned against.

### 2. Commission a separate baseline, update or correction

In **Requested update**, select the exact brief edition and enter the customer's request, its date and original reference. Select:

| Kind | Previous delivery |
| --- | --- |
| BASELINE | No previous delivery |
| UPDATE | The actual earlier frozen delivery this update continues |
| CORRECTION | The actual frozen delivery the customer is correcting |

Give every agreed source plan an explicit period. The provider's date field or full-scope rule, literal lower and upper bounds, and coverage notes remain separate values. Empty bounds mean unbounded values for that selected rule; the application does not substitute indexing, publication or acquisition dates for one another.

**Commission a separate update** opens an independent working request. **Save request edition** changes the selected request within its existing cycle and records the reason. Each saved request edition has its own ID; source intakes and work reviews bind that precise edition.

### 3. Attach the original source intake

Use Dossiers, Literature searches or the existing receiving tools to retain the actual source editions. In **Source intakes**, select one commissioned plan and its original retained dossier edition IDs. Record the original acquisition or receiving operation handle and the coverage note.

The native writer checks the question, provider and original source selection. An imported Europe PMC plan also requires the actual retained EUROPE_PMC_WORKSPACE origin and exact original selection/source terms. Changing a query in the working brief does not relabel an older source capture.

A request may have several separately recorded intakes. Their original edition IDs and source bytes remain in the dossier. Later work chooses the specific intakes it uses.

### 4. Review a complete source and research selection

In **Work review**, select the request's saved intake IDs. The native record library exposes original eligibility, extraction, appraisal, publication, synthesis and dossier records. Inspect a complete record and select its exact JSON pointer and SHA. The saved work retains the complete selected record, including its native IDs and numeric values.

**Review this selection at the current dossier revision** returns the original source revision and context fingerprint. Source comparison uses the previous frozen delivery as its baseline and reports added, removed, changed and unchanged original source identities. Full before/after variants, raw-source handles, occurrence identities and original metadata are available on the comparison pages. Uncovered source plans stay visible.

For each changed source, record the authored disposition and reason when appropriate. Review every agreed output as met, partly met, not met, not applicable or not reviewed. Write the customer's summary, limitations and continuation note. Save the complete work review against the returned source revision and fingerprint.

Changing a working source selection invalidates its preview. Reviewing a different context preserves the former preview, decisions and narrative in the form's earlier review contexts. The operator must review the new context before saving it.

### 5. Publish and hand over the full delivery

In **Delivery**, choose a saved work review and write the title, customer cover note and delivery instructions. Publishing creates four complete, immutable report files:

| File | Contents |
| --- | --- |
| JSON | Complete machine-readable brief, request, source comparison, selected native records, review and delivery |
| Markdown | Complete readable delivery, evidence changes, original selections and review |
| HTML | The same complete content in a clean, printable document |
| CSV | The complete source comparison with retained before/after values and original references |

The saved work snapshot remains downloadable as its own exact JSON file. **Download complete editable dossier** exports the original dossier history through this delivery, including original retained source bytes, all saved work snapshots and every published report. Later edits have their own history.

Record SENT, RECEIVED, ACCEPTED, CORRECTIONS_REQUESTED or WITHDRAWN when the corresponding event actually occurs, with the contact, channel, time and original correspondence. **Commission a correction to this delivery** begins a separate correction request on the same customer project.

### 6. Receive and continue

**Receive an editable dossier** retains the complete selected JSON or gzip file in the browser before calling the original native receiver. The native receiver preserves its original dossier IDs, immutable history, source blobs, customer project, work and reports. Open that same project in Customer updates and continue the customer's requested correction or later update.

For delivery outside a single browser, use the complete terminal handover described below. It includes every report file, the exact saved work and the full editable dossier. It can also carry the actual selected Europe PMC query/acquisition workspace.

## Working forms, exact replay and interrupted work

Browser forms are retained independently by workspace, dossier and original brief/request/work identity. New agreements, intakes, reviews, delivery responses and project-status changes have separate draft identities. Ordinary navigation preserves their values.

**History and working forms** can open a retained form, export its complete working-form file or receive one from another session. The portable form identifies its source workspace, dossier, customer project, exact base revision and native revision SHA, plus the full working values, prior review contexts and retained form provenance.

Receiving first compares that base with the actual dossier history in the destination workspace. Receive the corresponding editable dossier before receiving a form if its original history is absent. The preview shows the complete incoming form and the complete existing working form. Choose either:

- **Receive as a separate working draft**. The matching existing form keeps its original slot.
- **Preserve current draft and replace its working slot**. The prior complete form is saved under its own retained identity in the same local transaction before the received form takes the slot.

A changed destination form requires a new review. Reopening a received form uses its original saved base and exact native project/record identities. If the dossier has advanced, the page shows both revisions. Reviewing the form against the current dossier is an explicit action; native save still checks the actual current brief, request, selection and revision. Prior bases and working content remain retained. A historical view remains a separate read-only selection.

Every browser mutation retains the original request before its first dispatch. A lost reply resumes that exact request. **Replay this exact saved request** in History submits the original native request even when this browser already has a completed receipt. Its original first result is retained alongside the replay result; later working edits and an explicitly selected historical view remain separate. Pending native replays remain resumable after a disconnected listener or page restart.

The original native writer resolves an already-saved request before current revision/source checks. Reusing its ID with different input is rejected. A new user decision uses a new request ID.

## Terminal operation

Use the existing workspace connection file. Its listener and token stay with the original application. The following commands are also available through customer-updates/cli.mjs when invoking the source directly.

~~~sh
research-client customer-updates-help
research-client customer-updates \
  --connection-file /private/research-url.json \
  --id DOSSIER_ID --section projects

research-client customer-updates-preview \
  --connection-file /private/research-url.json \
  --id DOSSIER_ID --input /private/source-selection.json \
  --out /private/work-preview.json

research-client customer-updates-save \
  --connection-file /private/research-url.json \
  --id DOSSIER_ID --input /private/complete-original-request.json \
  --run-directory /private/customer-operations/original-save

research-client customer-updates-save \
  --connection-file /private/research-url.json \
  --id DOSSIER_ID \
  --run-directory /private/customer-operations/original-save
~~~

Replace the identifiers and paths with the actual original selections. The second save invocation continues the retained request. A completed local result can reopen without a listener or original input file. An input file that is still present must retain its original bytes.

Read pages with the returned dossier revision and next offset. Preview comparison pages additionally retain their exact fingerprint. Customer pages contain at most 100 items; the full record and file exports provide the complete selected content.

### Full source-to-customer handover

~~~sh
research-client customer-updates-handover \
  --connection-file /private/research-url.json \
  --id DOSSIER_ID --delivery DELIVERY_ID \
  --out /private/customer-delivery

research-client customer-updates-inspect \
  --source-directory /private/customer-delivery

research-client customer-updates-receive \
  --connection-file /private/receiving-research-url.json \
  --source-directory /private/customer-delivery \
  --manifest-sha256 HANDOVER_SHA256 \
  --run-directory /private/customer-receiving

research-client customer-updates-receive \
  --connection-file /private/receiving-research-url.json \
  --run-directory /private/customer-receiving
~~~

The original handover has six content files: all four report files, work.review.json and dossier.research.json.gz. handover.json records their complete exact membership, bytes, hashes and selected native project/delivery/work. The selection and original export outputs are retained before final publication. An interrupted export resumes the same selected files; an already-complete handover opens without the sender.

To include the original Europe PMC workspace, add **--source-workspace /private/original-source-export.json** when creating the handover. That input is exactly:

~~~json
{"library":"original","actor":"RESPONSIBLE_OPERATOR","requestId":"ORIGINAL_SOURCE_EXPORT_REQUEST"}
~~~

The library may instead be the actual selected received-… library. The saved request ID chooses one original source-workspace export. The handover checks that library against the original query-workspace selection in the frozen brief and includes the complete export as a seventh content file. Receiving this optional file requires **--source-actor** and uses the original Europe PMC restore operation and receiving library.

The receiving operation copies all content into its own input directory before the first native write. The selected handover can then move without changing the operation. A stopped receive resumes the same retained dossier/source files and original request identities. Completed receiving can reopen while the editable dossier continues with later work.

Use **customer-updates-operation --run-directory …** to inspect a retained operation, original request and result. Use **customer-updates-export** for one exact report/work/portable file under its own retained export directory. Local operation and handover directories are private, identity-bound and dedicated to one selection.

## Original request and action contract

Every mutation has exactly these outer fields:

~~~json
{
  "requestId": "ONE_ORIGINAL_REQUEST_ID",
  "expectedRevision": 1,
  "actor": {"id": "OPERATOR_ID", "name": "Operator name"},
  "action": "create-project",
  "data": {"brief": {}}
}
~~~

The example shows the envelope only. Populate **data** with the complete selected action below, using actual IDs and returned hashes. client.d.mts declares every complete nested type.

| Action | Complete action data |
| --- | --- |
| create-project | brief |
| revise-brief | projectId, expectedBriefId, brief, reason |
| record-agreement | projectId, briefId, disposition, by:{id,name}, occurredAt, reference, message, records |
| request-update | projectId, definition |
| revise-request | projectId, cycleId, expectedRequestEditionId, definition, reason |
| attach-intake | projectId, cycleId, requestEditionId, planId, editionIds, original, note |
| review-work | projectId, cycleId, requestEditionId, selection, fingerprint, summary, limitations, changeDecisions, acceptance, note |
| publish-delivery | projectId, workId, expectedWorkSha256, title, coverNote, deliveryNote |
| record-delivery | projectId, deliveryId, status, by:{id,name}, occurredAt, channel, reference, message, original |
| set-project-status | projectId, status, reason |

A brief contains **name**, **customer:{id,name,reference}**, **purpose**, **owner:{id,name}**, **questionIds**, **protocol:{title,version,source,notes}**, **sourcePlans**, **outputs**, **scope:{currency,amount,unit,note,reference}** and **updatePolicy**. Each source plan is **{id,name,questionId,provider,query,parameters,original,terms,constraints}**. Each output is **{id,label,format,acceptance}**.

A requested definition contains **briefId**, **kind**, **previousDeliveryId**, **label**, **request:{by:{id,name},receivedAt,reference,note}**, **periods** and **instructions**. Each period is **{planId,from,until,field,notes}**. Every agreed source plan has one corresponding period.

A work selection is **{intakeIds,records}**. Each original record is **{path,sha256,label?}**. Each change decision is **{sourceId,fingerprint,disposition,reason}**; each acceptance is **{outputId,status,note}**. Copy these identities from the original preview. Every agreed output receives one acceptance entry.

## Native HTTP, Node and Merchant surfaces

All HTTP routes run behind the original Research host, origin, authorization, workspace and instance checks.

| Method and route | Operation |
| --- | --- |
| GET /api/dossiers/:id/customer-updates | Paged projects, brief/request editions, intakes, saved work, deliveries, history, native record catalog and original source/question catalog |
| POST /api/dossiers/:id/customer-updates/record | One complete original JSON-pointer/hash selection |
| POST /api/dossiers/:id/customer-updates/preview | Exact source-bound work review and its comparison pages |
| POST /api/dossiers/:id/customer-updates/reviews?projection=metadata | One original retained mutation |
| GET /api/dossiers/:id/customer-updates/work | Reopen a saved frozen work review |
| GET /api/dossiers/:id/customer-updates/export | Exact report/work bytes or the original complete portable stream |
| POST /api/customer-updates/europe-pmc-plan | Read the existing exact source query edition into a commissioned plan |

Native request bodies are limited to 16 MiB. Work/report content uses the original 64 MiB retained blob limit, and the original portable reader/writer retains its 256 MiB limit. Original source bytes, route errors and immutable revision/CAS rules remain authoritative.

The borrowed Node attachment is **client.customerUpdates()**, exposing **list**, **record**, **preview**, **review**, **work**, **export** and **europePmcPlan**. Read-only POSTs are marked as reads. The existing client owns transport, file publication and closing; the customer API does not start another server or process.

Merchant uses the existing Research workspace alias and attachment:

- merchant_research_customer_updates
- merchant_research_customer_update_record
- merchant_research_customer_update_preview
- merchant_research_customer_update_save
- merchant_research_customer_update_work
- merchant_research_customer_update_source_plan

The existing retained-file exporter accepts **customer-update-json**, **customer-update-md**, **customer-update-html**, **customer-update-csv**, **customer-update-portable**, **customer-update-portable-gzip** and **customer-update-work-json**. Select deliveryId for a delivery export, or workId for the work snapshot. Large output remains with the original retained-file reader and downloader.

## Native whole-programme continuation

**runResearchCustomerDelivery({sender,receiver,directory,caseDefinition})** in receiving.mjs attaches to the existing programme's sender and receiver. Its case definition uses the actual original dossier, commissioned brief/query/source selections, saved intake editions, selected research record pointers and authored review decisions.

The case schema is **sf88-research-customer-delivery-case/v1** with **name**, **dossierId**, **actor**, **baseline**, **update**, **correction**, and optional **sourceWorkspace** / **receivingSourceActor**. Each phase supplies **request**, **intakes**, **records**, **review** and **delivery**, with optional actual **deliveryEvent** and expected actual **expectedChangeCounts**. Baseline and update include their complete briefs; update also includes the changed brief reason and a full revised request/reason.

One retained invocation completes:

1. The baseline customer project, requested work, actual source intakes, full selected native review and first report delivery.
2. A changed brief, a separate update request and revised request edition, the actual changed/new source intake, review and frozen delivery.
3. The complete six- or seven-file handover and original receiving into the existing destination workspace.
4. The customer's correction request and full corrected work/delivery on that received project.
5. Direct native replay of the original sender and receiving requests after later work, preserving the saved IDs and current dossier history.

The helper retains the complete case and each exact request before dispatch, uses the original source comparison and writer, and reopens its completed handovers. Its caller supplies the original scientific/source decisions and closes its existing client attachments after the same programme finishes.

## Source composition

The customer-updates directory owns the contracts, context, model, report version, native factory, query-plan reader, routes, client/types, terminal/file handover and whole-programme continuation. The original Research store composes:

- **createCustomerUpdateStore({head,commit,metadata,get,projections,blob,putBlob,exportStream})**
- **validateCustomerUpdateState** with the original retained edition metadata
- **validateCustomerUpdateHistory(previous,state)**
- **await validateCustomerUpdateTransition(previous,state,projected,readContent)** with the prior retained projections
- **customerUpdateBlobMetadata(state)** in both original JSON and streaming portable exports/imports

All saved work snapshots and all four report bodies are native content-addressed blobs. Both portable paths must enumerate and validate them, including historical editions. The existing common server/client/CLI and Merchant aggregate compose these additive leaves while preserving their original provider and operator registrations. This keeps the full source-to-customer workflow in the same editable product.
