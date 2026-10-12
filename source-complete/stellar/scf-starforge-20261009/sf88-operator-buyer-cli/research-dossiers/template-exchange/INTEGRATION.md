# Join the original Research store and host

## Ownership

The template-exchange directory is DBC61's additive source. The original dossier/composer remains 3AD7; the existing server, browser driver and shared client remain 63DD. AF825's complete customer-update programme and the original publication/appraisal/EPMC joins remain unchanged. Compose against the current cumulative source, not an earlier isolated dossier copy.

## Original factory

In the maintained openDossierStore closure, import:

    import {
      createTemplateExchange,
      validateTemplateExchangeState,
      validateTemplateExchangeTransition,
      templateExchangeBlobs
    } from './template-exchange/engine.mjs';

After the original head, commit, blob, putBlob and reviewExtraction functions exist, construct:

    const templateExchange = createTemplateExchange({
      head, commit, blob, putBlob, reviewExtraction,
      workbookOptions: {python: extractionOptions.python ?? 'python3', signal: extractionOptions.signal}
    });

The exact original Python-option name can follow the current maintained factory; pass its actual configured interpreter. Do not introduce a different source root or silently select a new environment. Expose templateExchange on the existing returned store object.

The factory expects head(id, revision?) -> {state, sha256}, original commit(id, expectedRevision, label, async update, {projection}), and exact content-addressed blob/putBlob functions. The engine does not need a public raw-state mutation method.

## History and portable validation

1. Call validateTemplateExchangeState(state) from the common original state validation path. Missing templateExchangeEvents means an empty family, preserving old dossiers.
2. Await validateTemplateExchangeTransition(previousState, state, {readContent, python: configuredPython, signal: extractionOptions.signal}) in the original per-revision semantic transition validation. It verifies append-only events and reconstructs the complete actual request against the preceding original revision.
3. Include templateExchangeBlobs(state) in the original portable source-blob enumeration and size accounting. This must cover both ordinary JSON and streaming/gzip exports.
4. The exact raw workbook/inspection/mapping/report/return/decision/native-request bytes must be admitted to readContent before transition replay. Both reopen and reopenStream use the same semantic validation. Do not keep the new family as unvalidated opaque JSON.
5. Ordinary original engine mutations preserve the appended event family. A template transition cannot alter unrelated dossier state.

No replacement serialization envelope is needed. Template events keep their full original request, request SHA, prior revision SHA, actor, reason and original/committed revision. A retry of the same request returns its accepted operation; a reused request ID with different input is a conflict.

## Existing HTTP server

createTemplateExchangeDispatcher({templateExchange: store.templateExchange}) returns a route handler without listening or adding authentication.

Mount it under the existing authenticated request/origin/body-size handling:

    /api/research/dossiers/:dossierId/template-exchange/:action

GET the route prefix itself for the page (empty action). Other GET actions are publication, record, operation and blobs/:sha256.
POST actions: stage-template, stage-mapping, stage-release, stage-return, stage-return-review, review, prepare-extraction-draft and accept-extraction-draft.

Pass {dossierId, method, action, query, body}. JSON results are {kind:'json', body}; native downloads are {kind:'file', body, filename, contentType, sha256, revision}. Use the maintained JSON/error/file response functions. Return Buffer download bytes with the existing safe attachment filename helper. Retain the original host's auth, same-origin checks, CORS policy, capability model and operator lifecycle; the dispatcher intentionally does not duplicate them.

Serve these explicit static bindings in the existing Research static map:

| Public filename | Source |
| --- | --- |
| template-exchange.html | template-exchange/public/template-exchange.html |
| template-exchange.css | template-exchange/public/template-exchange.css |
| template-exchange.js | template-exchange/public/template-exchange.js |
| template-exchange-client.mjs | template-exchange/client.mjs |

Add the original dossier's navigation link using the actual original fragment token:

    const token = new URLSearchParams(location.hash.slice(1)).get('token');
    const target = new URL('/template-exchange.html', location.origin);
    target.searchParams.set('dossierId', actualDossierId);
    target.hash = new URLSearchParams({token}).toString();

The existing host creates /#token=<64-lowercase-hex-token> and requires Authorization: Bearer <token> for API calls. The template page reads that same fragment with URLSearchParams and supplies the client's existing headers option. Same-origin cookies alone do not satisfy the host. The return link is /#token=<token>&dossier=<actualId>&view=study-extraction. Keep the capability in memory/navigation; it is never saved in localStorage, dossier data, source files or delivery receipts. native/browser.mjs saves only origin + pathname + search in result.json.

Preserve the current publication, eligibility, extraction, appraisal and source menus. Window templateExchangeApp exposes the selected API/state for the existing native browser continuation.

## Original clinical draft recovery

acceptExtractionDraft binds the selected retained review to the complete prepared original request at its historical expected revision before calling reviewExtraction. It then records the actual original accepted operation. If a receipt was lost after that native commit, replay recovers the same original operation. The receipt request compares actor, reason, review, blob, native identity and original revision; a stale UI selection or changed reason cannot cause an unreported native mutation.

The module creates a complete uncertain draft for an actually assigned extractor. It does not submit, adjudicate, overwrite a publication or promote a client cell to source truth. The original extraction engine continues to validate all source-pointer and field constraints.

## SDK and command line

The typed module exports its complete factory, client, dispatcher and workbook interfaces. The same selected-dossier CLI is:

    node research-dossiers/template-exchange/cli.mjs WORKSPACE DOSSIER page query.json
    node research-dossiers/template-exchange/cli.mjs WORKSPACE DOSSIER stage-template file-input.json
    node research-dossiers/template-exchange/cli.mjs WORKSPACE DOSSIER review exact-request.json
    node research-dossiers/template-exchange/cli.mjs WORKSPACE DOSSIER download selected-output.json

Staging a file uses {bodyPath,filename,format?,delimiter?}. A download uses {sha256,revision?,output}. Review requests explicitly include requestId, expectedRevision, actor, action, data and reason. Retain that exact request to reconcile an interrupted response. Do not retry a failed native draft under a new request ID until its original operation has been checked.

## Original cancellation and native receiving

The existing host accepts an optional `extractionSignal` alongside `extractionPython`. Pass the programme's existing controller signal to `startDossierWorkspace`; the host forwards that same object as `extractionOptions.signal` to the original store. The caller still owns the listener and its normal `close()` lifecycle. An omitted signal preserves existing callers.

Keep the same optional signal in both template factory `workbookOptions` and the original semantic transition validator. Both ordinary JSON and streaming/gzip receiving must call that validator with the original retained source reader and this same signal. Do not serialize the signal into a request, event, source envelope or connection file.

The nested template API checks cancellation before and after its original operations. Workbook inspection/patching retains the existing owned Python child's abort, timeout and close handling. Retained blob reads, staged writes, cached inspection results and event reconstruction also check the signal, so a cached result cannot advance a cancelled programme. If a native extraction or dossier event committed before interruption, its original request ID and retained operation remain authoritative; the next caller reopens the same operation with a new live controller and uses the existing request recovery. Cancellation does not roll back an accepted event or create a replacement request.


## Complete installed integration

The maintained dossier now owns `templateExchange`, its source inventory and append-only semantic replay in both JSON and gzip receiving. `server.mjs` binds the original dispatcher after the existing Host, Origin, bearer, workspace and instance checks. It serves the four explicit workbook assets with the same security headers, accepts the original 32 MiB workbook limit through the base64 JSON envelope, and returns original revision and content-hash headers on downloads. Native template error statuses and the original Research error envelope reach the client unchanged.

The original dossier header opens `/template-exchange.html?dossierId=<selectedId>#token=<currentToken>`. The complete browser imports `/template-exchange-client.mjs` at its actual served URL. All twenty template source files and their original Python/native helpers are included in the current source-owned Research contribution. The original receiving workflow combines the full independent appraisal and its typed/CLI/Merchant receiving, workbook exchange, final portable reopening and customer programme on the actual continued revision.
