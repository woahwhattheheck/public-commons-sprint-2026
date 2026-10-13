# Flowable commissioning programmes

Commissioning coordinates a complete ordered set of original Flowable operations in the existing workspace. The operator receives a source-complete programme, prepares a step, reads its native review, deliberately dispatches it, and continues from the saved outcome. Processes, decisions and adaptive cases use the same programme mechanism and their existing native implementations.

The **Commissioning** sidebar brings the complete plan, selected source members, native progress, original operation reviews, operator acceptance and whole handover together. It uses the existing private workspace URL, account environment, request journal and ownership lease.

## Receive and operate a complete programme

1. Open the existing Flowable product. Select its original process, DMN or CMMN REST connection.
2. Open **Commissioning** and choose a complete programme JSON. Receive programme saves the exact file and every declared source member.
3. Open the saved programme. The table shows each native action, dependencies and current original outcome.
4. Choose **Prepare step**. Identifiers are resolved from exact confirmed earlier records, and the complete resolved child input is saved before native preparation.
5. Read the existing native review. It contains the original request body, current engine preimage, complete sources and native validation where applicable. Use its existing dispatch control to execute that reviewed request.
6. Refresh the programme and continue. A dependent step becomes ready only when all selected earlier steps are confirmed.
7. After the complete native programme, record the actual reviewing operator, decision and note. Acceptance is tied to the exact programme source and current native record editions.
8. Choose **Export complete workspace**. The existing handover includes programme sources, every attempt and review, all native records, request/response bytes, journals and receiving lineage.

The saved programme is an immutable plan. Author a new complete programme edition to change its scope, resources or inputs. All prior programmes remain in the original workspace history.

A programme selects one REST service family. Use separate saved programmes for process, DMN and CMMN services so their original connection identities remain explicit.

## Complete reference case programme

The installed source includes:

    stellar/scf-starforge-20261009/sf30-seller-sdk/flowable/workspace/examples/case-commissioning.programme.json

This contains the original three CMMN case families, two complete source editions each, three complete typed start inputs and the original catalogue. Its 73 deliberate native operations cover deployment, case start/name/criteria, manual review activation, claim/unclaim/reclaim, delegation/resolution, source confirmation, the changed edition's exception path, and handover approval.

The original examples select case-reviewer, case-specialist and case-approver. Select an agreed commissioning environment and those authorized identities, or author a complete input edition for the customer's chosen identities. The programme retains the exact signed 64-bit sourceSequence token 9223372036854775806. The only dynamic start substitution is the quoted definition identifier; the business key is fixed when the programme is authored.

The source models are the existing editable Flowable reference cases. Their human inputs and decisions are supplied commissioning examples. Review the values before performing the corresponding operation. Existing native receiving remains responsible for the complete engine/history comparison and product source selection.

## Programme source format

The document schema is stellar-forge.flowable-programme.v1. It contains:

- key, label and optional note identifying the exact authored programme.
- sources: complete relative source names, bytes, SHA-256, media type and canonical Base64 content.
- steps: distinct named native operations in dependency order.

Each step identifies its original operation kind and complete selection object. Supported kinds are release, process, task, migration, decisionRelease, decisionEvaluation, caseRelease, caseInstance, casePlanItem and caseTask. The selection is consumed by the existing native planner.

Original native JSON remains in selection.bodyText. This is particularly important for native long values beyond JavaScript's safe integer range. Do not parse and reserialize bodyText to substitute identifiers.

A step's after array adds explicit dependencies. bindings resolve a field or complete quoted string token from a saved earlier operation. All referenced steps become dependencies automatically.

Example:

~~~json
{
  "key": "start-case",
  "label": "Start the selected case edition",
  "kind": "caseInstance",
  "selection": {
    "action": "startCase",
    "bodyText": "{\"caseDefinitionId\":\"__DEFINITION__\",\"businessKey\":\"customer-2026-001\",\"variables\":[]}"
  },
  "bindings": [
    {
      "token": "__DEFINITION__",
      "from": {
        "step": "deploy-case",
        "document": "after",
        "pointer": "/definitions",
        "where": {
          "key": "customerCase",
          "deploymentId": {
            "step": "deploy-case",
            "document": "reconciliation",
            "pointer": "/evidence/deploymentIds/0"
          }
        },
        "valuePointer": "/id"
      }
    }
  ]
}
~~~

A selector reads a complete original response, before, after, reconciliation or selection document. JSON pointers use standard ~0 and ~1 escaping. An optional where selector must match exactly one original row. Expected match fields may bind another earlier original document. The final identifier must be a nonempty native string.

Field bindings select processInstanceId, caseInstanceId, taskId or planItemInstanceId. Token bindings replace complete quoted placeholders such as "__DEFINITION__" with JSON-escaped strings. Every other byte of bodyText stays unchanged.

The programme retains the original record reference, exact resolved value and selector for each binding. There is no executable code or expression language in a programme file.

## Compile an existing complete case cohort

case-programme.mjs exports buildFlowableCaseProgramme. Pass the complete original catalogue text, a members map containing every selected source, a stable operation key, reviewer/specialist/approver identities and an optional actual native tenant.

Each member supplies text, contentBase64, bytes, sha256 and mediaType. text is a compiler input only. The portable output carries the complete original Base64 member. Its intake verifies size, SHA-256 and canonical Base64 before saving.

The compiler accepts the maintained three-family reference catalogue and the existing partner cohort shape with resources and ordinary/exception cases. It operates both original source editions. The existing Onwelo three-family/two-scenario cohort compiles to 127 native steps. Company-specific programmes remain with their original private company case.

The compiler carries native definition, case, plan-item and task identifiers through original confirmed results. All declarations and selections remain reviewable in the ordinary native workspace. It does not start an engine or dispatch a request during compilation.

## CLI and installed SDK

The existing CLI exposes the same actions through call:

~~~sh
starforge flowable-workspace call --url-file /srv/private/flowable-url.txt --method saveProgramme --input /srv/private/receive-programme.json --output /srv/private/saved-programme.json
starforge flowable-workspace call --url-file /srv/private/flowable-url.txt --method readProgramme --input /srv/private/read-programme.json --output /srv/private/current-programme.json
starforge flowable-workspace call --url-file /srv/private/flowable-url.txt --method prepareProgrammeStep --input /srv/private/prepare-step.json --output /srv/private/prepared-step.json
~~~

saveProgramme input contains requestId, connectionId and the complete programmeText string. The saved connection's 24-character record ID is distinct from its human alias.

prepareProgrammeStep input contains its retained requestId, programme id, expectedRevision and stepKey. The result includes the original child operation. Review and dispatch that child through readReview and its original dispatch action.

readProgramme returns current progress, complete source references, each selected attempt, review history and basisSha256. reviewProgramme records accepted or changes-requested, the actual reviewer and a substantive note against expectedRevision and basisSha256.

FlowableProductClient supplies typed saveProgramme, readProgramme, prepareProgrammeStep and reviewProgramme methods, as well as the existing generic call and complete-response file route.

## Merchant agent operations

The maintained merchant provider exposes merchant_flowable_save_programme, merchant_flowable_programme, merchant_flowable_prepare_programme_step and merchant_flowable_review_programme. They use the same saved workspace alias, original action schemas and complete-result file transport. Read the returned child operation through the existing review tool and dispatch it with its original kind-specific tool. The current source declares 45 workspace actions and 51 complete merchant tools.

The installed native journey now compares exact declared action/tool names from its selected source, so later additive capabilities retain full coverage without stale hard-coded counts. Programme records join the same complete native revision comparison.

## Interrupted preparation and native transport

The programme stores the exact child preparation request ID, complete resolved input and binding evidence before calling the native model. If the process stops between those writes, **Resume saved preparation** reuses that child input.

A lost browser reply retains the original request in the existing browser queue. Resume it through the original request control. Read the programme to see the current native outcome.

A dispatched request stays with its original record. Use **Refresh native outcome** in that record's review for unknown or interrupted native outcomes. The programme never creates another dispatch to resolve an uncertain original one.

An undispatched stale, invalid or failed review may be renewed through **Prepare current review**. This saves a new preparation attempt and retains all earlier attempts. Dependencies and native identifiers are resolved against the current confirmed saved outcomes. Already dispatched work continues through reconciliation.

Changing the selected engine connection requires a separate authored programme. An existing programme retains its original connection configuration.

## Native complete receiving

native-programme-receiving.mjs exports receiveFlowableProgramme for the existing equipped receiving owner. Supply:

- The original producer and independently selected receiver FlowableProductClient instances.
- The original saveProgramme input with its stable requestId and complete source.
- The selected private archivePath.
- The owner's retained state object and retain(state) callback that atomically saves it before returning.
- The original cancellation signal when applicable.

The helper joins those existing owners. It prepares each exact step, invokes the original dispatch, reconciles an uncertain outcome through its saved record, exports the complete workspace, downloads its original archive, inspects and adopts it through the original receiver, and compares the complete programme source and native outcome basis.

The caller retains the same state and selected input after interruption. Successful export, download and receive steps reuse their saved result. The helper stops on an unresolved native outcome so the original operation can be inspected and continued. It never recreates an engine, workspace, source selection or customer case.

Keep the receiver's complete stopped workspace with the native result. Reopen that same installed workspace through its existing launcher and read the received programme. The original native owner controls any continuation after the first receiving.

## Review and version continuity

Programme review records retain every selected child record ID, revision and hash. If reconciliation creates a later native record edition, the prior review remains in history and is shown as referring to an earlier outcome. The operator can review and accept the new complete edition.

Whole handover uses the existing workspace exporter and adopter. The programme record kind participates in the same immutable revision and source inventory. Use a source edition containing this programme feature at both ends; the older receiver does not know the new programme record kind.

The source contribution includes the full browser control, core/adapter, case compiler, typed client, native receiving helper, complete reference programme and this guide. Existing Flowable process, decision and case semantics remain owned by their original native adapters.
