# Complete Amero receiving and commissioning

## Scope and selected inputs

This is one resumable producer → customer → return course against the actual application, runtime and original provider inputs. It can consume explicitly supplied original responses or explicitly selected native requests/captures. A published Escala mock course demonstrates software behavior; its fixed observations do not establish a live fund, governance approval or payment.

The original operation ID and all source bytes stay fixed across continuation. At least one selected substantive Escala collective-investment or SDP record must project under the programme's selected environment and connection aliases. An empty input cannot complete this course, although an empty-period report remains an ordinary application feature.

Use a private JSON input with schema `amero.commissioning-input.v1`:

- operationId; absolute sourceDirectory; three different absolute producerDirectory, customerDirectory and returnedDirectory paths.
- runtimeDirectory selecting an already retained complete runtime, or nodeExecutable and runtimeLicenseFiles for original retention.
- sources: each {key,file,sha256,bytes,filename?,contentType?,connectionAlias,action,input?|inputJSON?,status,headers?,bodyComplete:true,observedAt?}.
- operations: optional original {key,connectionAlias,action,input?|inputJSON?,evidence?,dispatch:boolean,reconcile?:boolean}.
- captures: optional original {key,connectionAlias,action,input?|inputJSON?,maxPages?}.
- book: the full programme definition.
- decisions: complete original decision definitions, with actual version/source IDs.
- plans: optional {key,definition,originalFileIds?:[],preparations:[{key,stage,disbursementVersionId?,status?}]}. Original file IDs select complete files already retained in that workspace.
- customerActions: explicit {key,method,args}; allowed methods are profile.update, book.save, link.save, plan.save, plan.prepare, reconciliation.create, report.create, source.import, source.project and webhook.reconcile.
- reportName when desired.

All step keys must be unique. Plan preparation creates saved provider requests only; it never dispatches a payout. Financial dispatch in operations requires both an explicit true dispatch flag and configuration.allowDispatch=true. Original private credentials remain in the separately selected configuration file.

```sh
node operate-amero.mjs --input /absolute/private/course.json --configuration /absolute/private/configuration.json --output /absolute/private/original-course
```

## Eleven complete phases

1. Retain the whole source manifest and Node 24 runtime. Every later invocation verifies its executing application against that retained cohort.
2. Retain and import every selected original response with full hash/length and native request metadata.
3. Prepare selected operations, perform only explicitly selected dispatch/readback, and continue complete original captures.
4. Save the programme, decisions and payout plans. Retain every plan CSV/JSON attachment and each selected prepared SDP stage.
5. Freeze a full reconciliation and retain every JSON/CSV/HTML report.
6. Export the actual producer snapshot, archive it, independently unpack it and bind its complete catalogue to the actual archived SQLite revision.
7. Receive into the selected independent customer directory and verify all original immutable records.
8. Retain the original customer baseline and perform the selected customer continuation under fixed request IDs.
9. Export the actual later customer snapshot and complete return archive.
10. Independently receive that return, retaining the original report and every later customer record.
11. Replay the original programme request in the customer's later state and prove the replay did not overwrite that later state.

Each phase retains its entire artifact index and exact input identity. Accepted results, failed observations and partial captures are separate. A continued original capture preserves its accepted page prefix; no replacement capture is silently started. Completed phase receipts are adopted after complete artifact verification.

Completion is published only after acquired stores close and the same complete phase/source/runtime/archive/workspace proof used by later completed reopening passes. The two actual archive files must remain byte-identical. Customer workspace IDs are actual IDs assigned by receiving; the course does not invent them.

## Continue the same course

Rerun the identical command with the original input, configuration and output directory after resolving the concrete interrupted condition. Keep original request files, phase receipts, source objects, archives and application/runtime. If a native provider outcome is uncertain, inspect and use its original readback before any new business decision. A FAILED command is not permission to create a replacement financial request.

For capture continuation, the course reads the actual selected capture. It adopts a verified external completion or issues a separately frozen continuation command targeting that same capture. A newly observed failed page stops the current invocation; earlier accepted partial observations remain untouched.

A received workspace keeps original completed request receipts and presents a local response wrapper with its current workspace ID. Replaying the original request uses the original stored result and preserves later changes.

## Render and use the exact outgoing product

Before describing a delivery as client/demo ready, the producing operator must open the exact source/runtime selected above and actually use the outgoing product. Record the application/source identity and resulting artifact identities.

At a normal screen-share width and a narrow viewport:

1. Open the programme, its original resource versions and complete provider source details. Confirm the mock/provider/supplied labels and exact amount strings.
2. Retain an unfinished programme or decision edit, export the whole working copy, reload and restore it without losing the raw text.
3. Open a payout plan with enough recipient rows to exercise paging. Switch through full JSON and the grid, retain an invalid unfinished edit, correct it and save the plan.
4. Download and inspect the actual complete instruction CSV and full plan JSON. Confirm row count, ordered identifiers, contacts, exact amounts and selected distribution account/asset.
5. Prepare the selected create/instructions/status stages and inspect their complete method, URL, headers, request body/file and original source pins. Dispatch only requests already expressly selected for that course.
6. Exercise pending-result lookup/recovery on the same request ID, then inspect saved history after reopening.
7. Open the immutable reconciliation and each actual JSON, CSV and HTML report; verify that all domain groups and full original records are present.
8. Download the actual complete handover, independently receive it, make the selected later customer change, export/receive the return and reopen the original historical report.
9. If a Horizon stream is selected, inspect its actual retained network proof, current cursor and source event, then pause it and verify owned reader closure and STOPPED runtime state.

Keep the actual rendered observations, viewport dimensions, downloaded attachments and original request/course records together. Source parsing or a synthetic DOM exercise alone is not an actual rendered-product result. The application can be shipped as source while that exact commissioning outcome remains pending.
