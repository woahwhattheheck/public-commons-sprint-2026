# Commissioning integration into the original Central product

## Owned source

This contribution owns `odk/commissioning/` and `odk/COMMISSIONING.md`. The original owner composes workspace/server, managed/SDK identity, Store/capture/review/report/archive and the original native fixture. The original `central-host/` owner keeps service lifecycle.

Use all modules/assets:

- `agreement.mjs` — complete definitions, native mappings and explicit calendar.
- `model.mjs` — original Store records/resources and native plan/capture/delivery.
- `extension.mjs` — fixed assets and authenticated routes on the original listener.
- `open.mjs` — direct composition using original Store callback/server.
- `cli.mjs` — direct or borrowed-listener operations and original restore.
- `browser.mjs`, `index.html`, `style.css` — complete neutral operator.
- `agreement.example.json` — blank original-data intake.

## Original Store callback

The original constructor accepts optional trusted-code `extend` after assembling its full public API:

~~~js
try {
  if (extend) await extend({workspace, store});
  return workspace;
} catch (error) {
  await workspace.close();
  throw error;
}
~~~

This is the narrow tail of the original constructor, not its replacement. Preserve all original initialization/operation wrappers.

A managed caller composes:

~~~js
let commissioning;
const workspace = await openCentralWorkspace({
  directory,
  extend: ({workspace, store}) => {
    commissioning = createCentralCommissioning({
      workspace, store, connection: actualPrivateConnection
    });
  }
});
const extension = createCommissioningExtension({workspace, commissioning});
~~~

Commissioning cannot open another Store; its handle/directory must match the held original owner.

New record kinds: `commissioning-inspection`, `commissioning-host`, `commissioning-draft`, `commissioning-request`, `commissioning` and `commissioning-delivery`. All use existing records/revisions/transactions.

Original account/project/form observations, host handover and agreement/handover documents use native `retain` and `resources`. The original archive includes the entire SQLite snapshot and every referenced resource hash, so no schema migration, sidecar business database or second archive format is required.

## One original HTTP listener

`createCentralServer` accepts `extensions=[]`. The trusted extension has:

~~~js
{
  name: "commissioning",
  assets: new Map([
    ["/commissioning/", {
      url: new URL("./index.html", import.meta.url),
      type: "text/html; charset=utf-8"
    }]
  ]),
  async handle({request, response, address, body, json}) {
    // True only when this route was handled; otherwise false.
  }
}
~~~

Integrate fixed assets after original Host/Origin checks. Read `asset.url` and retain original CSP/no-store/no-referrer/nosniff/content-length handling. Reject duplicate asset paths when composing; do not override `/` or accept browser file paths.

Call `extension.handle` **after original bearer authorization**, with the native JSON reader/response function. Await it; continue native routing if false. Errors go through the original mapper.

| Route | Meaning |
|---|---|
| GET /api/commissioning/state | Saved definitions/native capture/output state |
| POST /api/commissioning/inspect | Retained original account/project/form observation |
| POST /api/commissioning/recordHost | Actual original deployment handover |
| POST /api/commissioning/saveDraft | Complete agreement/CAS save |
| POST /api/commissioning/readiness | Required decision validation |
| POST /api/commissioning/prepare | Immutable full definition/period plans |
| POST /api/commissioning/install | Same native connection/two plans with recovery |
| POST /api/commissioning/capturePeriod | Original capture dispatch with retained ID |
| POST /api/commissioning/resumeCapture | Same native capture continuation |
| POST /api/commissioning/deliver | Original dataset/report/archive handover |

Actions return `{ok:true,result,operationId}`; state is direct JSON. Existing `/api/captures/:id`, `/api/downloads` and original file endpoints remain authoritative.

The direct `serveCentralCommissioning` starts one original server and verifies its authenticated state before returning the private URL. The managed launcher mounts this extension on its current owner/listener, rather than starting a second direct service.

### Lifetime and startup

Close HTTP, await `commissioning.close()`, then close the original workspace. The original owner drains/pauses captures and outputs before releasing its Store. The commissioner waits for its queue but never closes a Store it did not acquire.

The UI path is `/commissioning/#token=ORIGINAL_TOKEN`; original field work is `/#token=ORIGINAL_TOKEN`. A direct descriptor has schema `stellar-forge.central-commissioning-listener.v1`, workspaceId, directory, origin, url, fieldWorkspaceUrl and token. This is ephemeral private connection information, not archived business data.

Include all executable/assets in the actual managed source-identity closure. Installed Applications completion requires the original launcher/catalog/identity and actual receiving result.

## Native API

~~~js
const bridge = createCentralCommissioning({workspace, store, connection});

const inspection = await bridge.inspect({id, projectId});
// READY, actual actor/project/forms, connectionId and complete source receipts.
// Exact completed-ID replay performs no provider request.

const draft = await bridge.saveDraft({
  id: draftId, requestId, expectedRevision, agreement: originalAgreement
});
// Native id/revision, full agreement/hash and readiness.

const prepared = await bridge.prepare({
  id: commissionId, draftId, draftRevision: draft.revision,
  inspectionId: inspection.id, existingPlanIds: optionalTwoOriginalIds
});
// Full sourceDefinition and definition, plans/periods/outputs/indicators.

const installed = await bridge.install({id: commissionId});
// INSTALLED, exact original connection and period plans.

const result = await bridge.capturePeriod({
  id: commissionId, period: 0, requestId: retainedCaptureRequestId
});
// {capture, requestId, reused}; wait/review through the original workspace.

const delivered = await bridge.deliver({
  id: commissionId, requestId: retainedDeliveryRequestId,
  captures: [
    {period: 0, captureId: firstCapture, reviewId: firstAcceptedReview},
    {period: 1, captureId: secondCapture, reviewId: secondAcceptedReview}
  ]
});
~~~

Completed delivery has pinned selection/request, datasets, reports, three documents and original archive. Dataset entries: `{period,id,captureId,tableId,name,files,receipts}`. Reports: `{period,id,captureId,baselineId,files,receipts}`. Documents: name/type/sha256/bytes. Use original `workspace.exportFile`/`sourceFile` to retrieve them. The CSV uses approved fields; the native dataset's rows.jsonl/source pages and full archive retain complete selected-capture source. `processing.portableSource=complete-selected-capture` explicitly preserves that original custody contract; warehouse consumers must choose the intended native projection.

Restored READY_FOR_ARCHIVE returns RECEIVED_PORTABLE with actual `receivedArchive`, without provider replay or an invented producer archive row.

## Join the original native receiving

Use the existing Central receiving driver, actual original fixture IDs and selected instance. No additional server or replacement capture engine is needed.

1. Consume actual bootstrap connection/CA/environment and service receipt.
2. Retain the original host handover, inspect actual actor/project/forms and fill the agreement from those real IDs/boundaries.
3. Save/replay the complete draft, prepare/install two original plans, with explicit real field/measure mapping and native key approval.
4. Let the original driver operate its source changes and captures for these plans, or adopt two already-existing exact plans. Retain actual original pages/versions/media.
5. Use original quality/review UI/API and actual accepted native review IDs.
6. Deliver the accepted pair; open the actual native report/dataset/browser views.
7. Restore the same complete archive to an independent recipient; reopen exact agreement/plan/capture/output identities without another provider capture.
8. Preserve the one whole operation's source pins, host/version/result and full output hashes.

The typed warehouse joins each original approved dataset ID/file receipt with its period/plan/review/source identity. Deployment or a proposed calendar does not imply customer acceptance.
