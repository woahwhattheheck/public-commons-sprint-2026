# Python customer commissioning and delivery

The installed Research Python SDK now runs the same customer project, retained brief, recurring update, frozen report and editable handover workflow as the Research browser and Node operator. Use an existing ResearchWorkspace and its existing dossier. Original source editions, extraction and appraisal records stay in that dossier through receiving and later corrections.

The full implementation is in research_customer_updates.py, research_customer_types.py and research_customer_receiving.py. Their native bridge calls the existing [customer operator](../research-dossiers/customer-updates/operator.mjs), [file publisher and portable inspector](../research-dossiers/customer-updates/files.mjs) and [complete receiving programme](../research-dossiers/customer-updates/receiving.mjs). The [customer operating guide](../research-dossiers/customer-updates/CUSTOMER_UPDATES.md) describes the original customer model and browser.

## Attach the installed client

Use the same selected checkout, private Research connection file and Python client directory as the original Research programme. The connection file carries the original local listener and authentication. The Python client saves the actual observed workspace identity in its original client.json.

    from stellar_forge_buyer import ResearchWorkspace

    workspace = ResearchWorkspace(
        checkout=selected_checkout,
        connection_file=selected_connection_file,
        directory=retained_python_client_directory,
        timeout=900,
        request_timeout_ms=120000,
    )
    customer = workspace.customer_updates(original_dossier_id)
    overview = customer.read()
    print(overview["revision"], overview["overview"])

Use the context manager when the application owns this Python attachment:

    with ResearchWorkspace(
        checkout=selected_checkout,
        connection_file=selected_connection_file,
        directory=retained_python_client_directory,
    ) as workspace:
        customer = workspace.customer_updates(original_dossier_id)
        projects = list(customer.iter_rows(section="projects"))

The attachment uses the original ResearchWorkspace admission and cancellation lifecycle. Closing it joins its accepted Python calls; the original Research host remains available for other clients. The complete two-client programme registers its one native operation with both attachments, so closing either one stops and joins that operation.

## Original data and typed forms

Import wire types from stellar_forge_buyer.research_customer_types. The types use the native JSON field names, including requestId, expectedRevision, briefId, requestEditionId, editionIds, previousDeliveryId and amount. CustomerPeriod is a functional TypedDict with the literal JSON key "from".

A customer brief contains the customer and owner, selected question IDs, protocol reference, exact source plans, requested outputs and acceptance criteria, scope and update policy. A source plan includes its original provider query and parameters, source handle and usage terms. Monetary amounts remain strings.

Use europe_pmc_plan to derive a source plan from an original saved query:

    selected = customer.europe_pmc_plan(
        query_id=original_query_id,
        query_revision=original_query_revision,
        question_id=original_question_id,
        plan_id=authored_plan_id,
        library=selected_library,
    )
    source_plan = selected["plan"]

The original query revision is read through the native workspace. Select a retained source edition for each actual intake. To include an existing extraction, eligibility, appraisal, table or publication record, obtain its full native path and hash:

    record = customer.record(original_record_path, revision=selected_revision)
    selection = {
        "path": record["path"],
        "sha256": record["sha256"],
        "label": record["label"],
    }

The native record reader validates the returned record against its hash. The work preview binds all selected records to their actual dossier revision.

## Prepare, review and submit a complete request

prepare selects one current native revision when expected_revision is omitted. It then uses the installed original customer parser to normalize the full five-field request. It returns a portable prepared request with workspace, dossier and native request SHA.

    prepared = customer.prepare(
        "create-project",
        {"brief": complete_original_customer_brief},
        request_id=retained_request_id,
        actor=original_actor,
    )
    prepared_file = customer.save_prepared(prepared, selected_prepared_file)

Read the complete file before submitting it. Its request has these original fields:

    {
      "requestId": "...original saved ID...",
      "expectedRevision": 1,
      "actor": {"id": "...original actor...", "name": "...original actor name..."},
      "action": "create-project",
      "data": {"brief": "...complete authored brief object..."}
    }

The snippet above shows the envelope shape; prepare and the native model validate the complete selected brief and actual revision.

Submit the retained prepared file:

    saved = customer.submit_prepared(selected_prepared_file, resume=True)
    operation = saved["result"]["operation"]
    project = operation["result"]["project"]
    brief = operation["result"]["brief"]

The native writer checks the selected revision and exact source context, appends the customer operation and keeps its original request. Python retains the original request, every attempt and complete response in the existing ResearchWorkspace call journal.

submit accepts the full native request object. submit_file preserves the exact caller JSON bytes, expected size and optional SHA before invoking the original writer:

    saved = customer.submit_file(
        original_request_file,
        expected_sha256=original_request_file_sha256,
        resume=True,
    )

The source file is copied through the original held-file publisher before submission. A later recovery can use that retained source after the caller's original file moves.

## All customer actions

Each convenience method accepts its full native data object plus request_id, expected_revision, actor, resume and cancel_event. Each call uses the same original five-field request and native model.

| Python method | Complete native data |
| --- | --- |
| create_project | brief |
| revise_brief | projectId, expectedBriefId, complete brief, reason |
| record_agreement | projectId, briefId, disposition, by, occurredAt, reference, message, optional records |
| request_update | projectId, complete definition with selected brief, kind, prior delivery, request source, periods and instructions |
| revise_request | projectId, cycleId, expectedRequestEditionId, complete definition, reason |
| attach_intake | projectId, cycleId, requestEditionId, planId, exact editionIds, original source handle, note |
| review_work | projectId, cycleId, requestEditionId, complete selection, preview fingerprint, summary, limitations, change decisions, acceptance and note |
| publish_delivery | projectId, workId, expectedWorkSha256, title, coverNote, deliveryNote |
| record_delivery | projectId, deliveryId, status, by, occurredAt, channel, reference, message, optional original |
| set_project_status | projectId, ACTIVE/PAUSED/COMPLETE, reason |

The Native customer result is under saved["result"]; the original operation and returned project, brief, request, intake, work or delivery are under saved["result"]["operation"]. IDs for subsequent actions come from these saved native results.

## Review a source update and freeze its delivery

The work selection holds the exact intake IDs and complete native record references. preview returns the original revision, revision hash and source-context fingerprint, source change counts, selected brief/request and previous delivery baseline.

    preview = customer.preview(
        project_id=project_id,
        cycle_id=cycle_id,
        request_edition_id=request_edition_id,
        selection={"intakeIds": selected_intake_ids, "records": selected_native_records},
    )

Read the actual changed sources at the same selected revision and fingerprint:

    changes = list(customer.iter_preview(
        section="changes",
        project_id=project_id,
        cycle_id=cycle_id,
        request_edition_id=request_edition_id,
        selection={"intakeIds": selected_intake_ids, "records": selected_native_records},
        revision=preview["revision"],
        fingerprint=preview["fingerprint"],
    ))

Review the returned source changes and write the operator's complete change decisions, acceptance and narrative. Pass that same fingerprint and selected revision to review_work. The original native model rejects a changed context before it freezes the work.

Read a saved review with work(work_id). Use iter_work for full frozen sources, records, changes or intake pages. Its revision is the frozen work source revision; workspaceRevision identifies the dossier edition in which that work was opened. The iterator pins both values and the original fingerprint.

publish_delivery takes the saved work ID and SHA. The original compiler creates the four frozen report formats from the selected full work. Later changes to source records, customer instructions or renderer code do not replace that delivery's stored report bytes.

## Original request recovery and explicit native replay

Read the existing saved call:

    retained = customer.saved_request(original_request_id)

Continue that same call after a lost reply, process interruption or partial file publication:

    saved = customer.recover(original_request_id)

recover consumes the original retained request and original native result. A completed response and complete selected exports reopen from their retained files before a host reconnect. Failed attempts retain their original request IDs and unknown-outcome state.

An explicit replay is a separate durable Python call:

    replayed = customer.replay(
        original_request_id,
        replay_id=distinct_retained_replay_id,
        resume=True,
    )

The original native requestId, expectedRevision, actor, action and data stay unchanged. replay_id identifies the Python replay attempt, so interruption after dispatch has an original durable recovery target:

    replayed = customer.recover(distinct_retained_replay_id)

Calling replay with another explicit replay_id reaches the native writer again. The native reply identifies the original operation and current dossier revision. The first submission receipt and each replay receipt remain separate.

## Read complete history

read exposes overview, projects, briefs, agreements, requests, intakes, work, deliveries, delivery-events, operations, records, editions and questions.

iter_rows retains the first native revision and page total throughout traversal. iter_preview also retains the source fingerprint. iter_work retains both the selected dossier revision and frozen source revision. An offset beyond the first page requires the selected revision.

    deliveries = list(customer.iter_rows(
        section="deliveries",
        project_id=selected_project_id,
        revision=selected_dossier_revision,
    ))

Full JSON responses are written into a private original response file and read with the existing SHA-checked FileDelivery. The bridge writes a small file descriptor to stdout. This preserves the original Runtime output budget for every existing Python product while supporting the complete customer records.

The native request budget is 16 MiB. Customer work/report files use the native 64 MiB budget, source-workspace archives 128 MiB and complete portable dossiers 256 MiB. The private Python response envelope allows 96 MiB plus framing for the full native result and its exact original request. Full member bytes travel through existing native file readers and publishers.

## Export and hand over the editable product

Export a selected delivery format or full reviewed work:

    report = customer.export(
        request_id=retained_export_id,
        delivery_id=delivery_id,
        format="html",
    )
    with report.open() as original_bytes:
        consume_report(original_bytes)

The returned FileDelivery checks the exact size, SHA and destination while reading its original held file descriptor. Its json, csv_rows and save_as methods are the same installed readers used by other Python Research products.

Create the full customer handover:

    handover = customer.handover(
        request_id=retained_handover_id,
        delivery_id=delivery_id,
        directory=selected_handover_directory,
        source_workspace=original_source_workspace_selection,
    )

source_workspace is optional. When selected, it is the actual Europe PMC library, actor and requestId object. The existing source exporter verifies its relationship to the selected brief and retains the complete workspace archive.

Every handover includes:

- Frozen JSON, Markdown, HTML and CSV customer reports.
- The complete saved work review.
- The full editable Research portable dossier, with original history and all historical work/report attachments.
- The selected complete Europe PMC source workspace when requested.
- The native handover manifest with each original file's name, size, SHA, content type and selected project/delivery/work identities.

Use handover.report("json"), handover.work(), handover.dossier() or handover.source_workspace() for the original FileDelivery. handover.verify checks every member. customer.inspect_handover runs the original native full portable inspector, including its history and selected source/report joins.

## Receive and continue a correction

Use the receiver's existing ResearchWorkspace and the same dossier ID:

    receiving_customer = receiving_workspace.customer_updates(original_dossier_id)
    received = receiving_customer.receive_handover(
        selected_handover_directory,
        request_id=retained_receiving_id,
        directory=selected_receiving_operation_directory,
        manifest_sha256=handover.manifest_sha256,
        source_actor=original_receiving_actor,
    )

The bridge binds the selected dossier and exact manifest before receiving. The native receiver retains all source files first, reopens the original portable dossier and selected source workspace, and verifies the exact saved delivery and work. Its existing history import preserves later valid customer work.

Open the received input directly with ResearchCustomerDelivery.from_received(received). A correction uses request_update with kind CORRECTION, the selected prior delivery and the actual retained brief. Attach its actual source editions and record selection, review its work and publish its new delivery through the same methods.

## Continue the original complete programme

The Python receiving wrapper calls runResearchCustomerDelivery itself. Pass the SAME directory and full case.json used by the original Node customer programme. It reopens or continues its saved baseline, changed brief/request, update, complete receiving, final correction and original-request replays.

    from stellar_forge_buyer import run_research_customer_delivery

    result = run_research_customer_delivery(
        sender=existing_sender,
        receiver=existing_receiver,
        directory=original_customer_programme_directory,
        case_file=original_customer_programme_case_file,
        request_id=retained_python_programme_id,
        expected_case_sha256=original_case_file_sha256,
        resume=True,
    )

The complete original case has schema sf88-research-customer-delivery-case/v1, dossierId, actor and the authored baseline, update and correction definitions. The definitions select actual source edition IDs and native record paths/hashes. The Node model validates this case and uses its retained original phase requests before later revision or source reads.

For the NCT03529110 programme, use the case and programme directories produced by the existing study-extraction-customer.mjs continuation. That original binder already selects its actual question, Eligibility Study, occurrence, two exact publications and original reviewer records. Reuse those selections and the two original workspace connection files.

The included examples/research_customer_delivery.py is a complete command-line caller. It takes the original directories and case path, retains the result, and uses a whole-program cancellation exception so signal interruption unwinds the existing child/workspace cleanup before ending the caller.

## Installed command-line workflow

The existing Python Research entry point registers these commands. Common --checkout, --connection, --directory, --timeout and --request-timeout-ms options precede the command.

| Command | Operation |
| --- | --- |
| customer-list | Paged original customer history |
| customer-record | Full selected native record and hash |
| customer-preview | Full source-bound work preview input |
| customer-work | Frozen reviewed work |
| customer-plan | Original Europe PMC query to source plan |
| customer-validate | Original request normalization |
| customer-prepare | Complete retained prepared-request file |
| customer-submit | Exact raw request or prepared file |
| customer-saved | Original request and latest attempt |
| customer-recover | Original saved operation continuation |
| customer-replay | Explicit durable original-native replay |
| customer-export | Exact report/work/portable export |
| customer-handover | Full editable customer handover |
| customer-inspect | Complete native handover inspection |
| customer-receive | Full receiving into the selected dossier |
| customer-operation | Original native operation files |
| customer-programme | Original whole baseline/update/receive/correction programme |

Use --output to retain complete command JSON in a new file. Repeating the same output publication accepts the identical saved result. A changed result requires another explicit output destination, preserving the previous file.

customer-replay requires --replay-id. customer-handover and customer-receive require their own retained --request-id. customer-programme takes --receiver-connection, --receiver-directory, --native-programme, --case and --request-id. These are original owned workspace and programme paths.

## Operating errors and continuation

| Native result | Operator continuation |
| --- | --- |
| EXPECTED_REVISION_REQUIRED or stale selected revision | Reopen current original state and review a newly prepared request; retain the previous prepared file. |
| CUSTOMER_UPDATE_CONTEXT_CHANGED | Read the selected preview/source changes and prepare the new reviewed work against that actual context. |
| RESEARCH_REQUEST_ID_REUSED | Reopen the original request body for that ID, or assign a new ID to the newly authored action. |
| A lost reply or interrupted native call | Use recover with the original submission or replay ID. |
| CUSTOMER_UPDATE_INPUT_FILE_CHANGED | Reopen the saved original request/operation and its retained source bytes. |
| CUSTOMER_UPDATE_HANDOVER_MANIFEST_CHANGED | Select the original handover and its exact saved manifest before continuing receiving. |
| OPERATION_BUSY | The existing original writer owns that operation; continue its retained request after it completes. |

The original source, saved request, native result and complete delivery bytes are the customer product's continuing working state.
