# Original merchant commissioning and receiving

This course operates the complete Paycashless application against selected original merchant sources and/or explicitly selected account operations. It does not manufacture invoices, customers, payment records, settlements or source coverage.

## Required actual selections

Use Linux Node 24 and the complete current application directory. Provide three distinct absolute paths: original producer workspace, independent received customer workspace destination, and independent returned workspace destination. Preserve the same operation ID and output directory on continuation.

The input schema is `paycashless.commissioning-input.v1`:

```json
{
  "schema": "paycashless.commissioning-input.v1",
  "operationId": "ORIGINAL_MERCHANT_COURSE",
  "sourceDirectory": "/absolute/current/application",
  "runtimeDirectory": "/absolute/selected/runtime",
  "producerDirectory": "/absolute/private/producer",
  "customerDirectory": "/absolute/private/customer-receiving",
  "returnedDirectory": "/absolute/private/returned-receiving",
  "sources": [],
  "operations": [],
  "captures": [],
  "book": {},
  "decisions": [],
  "customerActions": [],
  "reportName": "Original merchant payment reconciliation"
}
```

This is a shape, not a runnable merchant case. Supply the full book and actual sources or complete native acquisition. The receiving result requires an actual selected original Paycashless payment version. Legitimate empty-period reports remain a normal application feature; they do not establish merchant commissioning.

A source entry is:

```json
{
  "key": "original-selected-response",
  "file": "/absolute/private/original-response.json",
  "sha256": "EXACT_FULL_FILE_SHA256",
  "bytes": 123,
  "connectionAlias": "ACTUAL_ALIAS",
  "action": "paycashless.payments.list",
  "inputJSON": "{\"query\":{\"limit\":100}}",
  "status": 200,
  "bodyComplete": true,
  "observedAt": "ACTUAL_ISO_TIMESTAMP"
}
```

Replace every illustrative value with the actual original receipt. Optional fields include filename, contentType and original response headers. Supply either `inputJSON` or a safe typed `input`. Full original response numbers are retained with exact numeric tokens; request inputs must satisfy their native signature/schema representation.

An operation entry is `{key,connectionAlias,action,inputJSON,dispatch:boolean,reconcile?:boolean,evidence?:object}`. A capture entry is `{key,connectionAlias,action,inputJSON,maxPages?}`. Every key is unique. Only explicitly selected dispatches can run, and the private course configuration must have `allowDispatch:true`. For selected mutations the course records one stable `delivery.configure` command before the exact dispatch. It does not retry an uncertain mutation.

A decision is the complete frozen domain decision from the model guide. A customer action is `{key,method,args}`, restricted to original profile/book/link/reconciliation/report/source/project/webhook methods. These are actual selected successor edits, not invented commissioning records.

## Run and continue

```sh
node operate-paycashless.mjs \
  --input /absolute/private/original-course.json \
  --output /absolute/private/original-course-receiving \
  --configuration /absolute/private/original-config.json
```

Use the same exact input, configuration binding and output directory after interruption. The course selects and verifies the complete application and native runtime. Restarting with different application files cannot silently execute later phases.

The eleven phases are:

1. Capture and verify the complete selected source and Node/runtime files.
2. Retain/import every exact original merchant source file.
3. Execute selected original provider operations and complete original captures.
4. Save the selected immutable book and reviewed decisions.
5. Freeze reconciliation and all JSON, CSV and HTML report artifacts.
6. Export the actual producer SQLite snapshot and complete archive.
7. Inspect and independently receive that archive.
8. Apply the explicitly selected customer continuation while preserving original records.
9. Export the actual customer return snapshot and archive.
10. Independently receive the returned project and verify the original report history.
11. Replay the original book request in the customer workspace and prove later customer work remains unchanged.

Each phase has a create-only receipt and complete artifact index. Request observations are retained separately from accepted results. The full original request ID and body are frozen before execution. A bounded capture's accepted RUNNING/PARTIAL response remains intact; continuation uses separately frozen commands on that same capture, never a replacement capture.

The archive's actual SQLite snapshot supplies the receiving comparison, including any legitimate writes made before export froze. The course does not compare a later archive to an earlier intended catalog. Initial COMPLETE and later completed adoption both verify every phase, artifact, source/runtime member, actual archive, manifest and selected workspace identity after owned resources close.

## Native evidence and stream operation

Read the actual provider and Horizon source coverage in the report. Complete invoice-instalment controls require the full same-invoice population and exact source selection. A continuous SSE stream has a saved cursor and all observed events, but does not assert terminal period coverage. See [SETTLEMENT_STREAM.md](SETTLEMENT_STREAM.md) for the same-store worker and durable checkpoint.

No account-specific sandbox credentials or merchant exports were supplied with the public implementation source. A source-reviewed package therefore carries no claim that those provider operations have already run.

## Actual mounted product course

Use the exact outgoing source and real producer workspace from the selected course. Open the server's actual origin and enter the private operator token.

At a normal screenshare width, operate the source/import form, complete page capture, provider register filtering, full detail/history, book editing, allocation/correction, reconciliation and all report controls. Verify original invoice→instalment→intent relationships and payout confirmation/approval data. Open an empty result and an invalid form or native error. Retain unfinished editor text, reload and recover the original pending request; do not submit a replacement ID.

At a narrow/mobile width, reopen the same workspace and use the navigation, tables, form fields and report sections. Inspect horizontal scrolling, long provider IDs, source hashes, exact large monetary tokens, dialogs, focus and error messages. Correct clipping or inaccessible controls in the outgoing source.

Download and actually open every JSON/CSV/HTML report. Inspect the actual full records and original amount strings. Extract the full delivered archive, open the included application with its selected runtime and received workspace, make the authorized customer edit, and open the returned project. Complete this with the original course, not a separate example that changes the case.

The producing peer must LOOK at rendered output or actual screenshots and use the controls and attachments before calling the product client/demo-ready. HTTP success, source compilation, a peer review or a screenshot merely captured is not that operation. Record the exact outgoing source, workspace, runtime, viewport, source/attachment identities and actual result when the equipped owner completes it.

## Continue the same mounted course through browser portability

Use the existing original merchant/browser owner and retained operation. This source extension adds no independent provider or native producer.

On the exact current app, keep a partially edited provider JSON field, source metadata, a chosen original source file and report name/destination. Download the complete working copy; inspect it in its original workspace. Make a later visible edit and restore explicitly. Reopen the application and verify the restored raw form text, complete retained selection, original request IDs and previous-view receipt. Download and actually open both the selected original file and prior-view JSON. A malformed or different-workspace working copy must leave the current view unchanged.

At the narrow viewport, operate the same controls and Recovery. Newly imported pending requests must remain unsent until the operator uses the original explicit recovery control. Inspect both the browser file and the independently received native archive according to the original all-attachments requirement. Record actual results in this same commissioning operation; source review alone is not that result.
