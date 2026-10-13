# Complete customer-return review

The Directory operator can receive a returned OperatingPlan or a complete existing return review, compare the original histories, retain explicit decisions and receive the reviewed result into the original saved procedure. The implementation calls the unchanged original `distribution/discovery/operating-plan-return.mjs` model. Directory supplies the native source basis, immutable accepted requests, files, operator and full customer receiving.

## Original meanings

A return contains both complete current and incoming histories, the reviewer, notes, all decisions and an optional completed plan. The original model identifies their shared revision and distinguishes a return of the same plan from a returned copy. Divergent edits remain visible. Command and argument changes stay together; recorded results stay with their status and work context. Added or removed steps and complete step ordering are reviewed explicitly. A custom JSON null can remove a whole step. Source order decisions retain every selected step and become stale when the included set changes.

Preparing or reviewing does not save a new plan. Completing retains an immutable reviewed intent. Applying calls the original native plan receiver and then stores its applied-review receipt. These are **separate recoverable writes**, not one atomic transaction. If the plan save completed before an interrupted response, retry the exact same accepted apply input. The receiver finds the exact native receive request or recognizes the full completed result inside the later current history. It preserves later edits and avoids adding an empty revision.

Each immutable `operatingPlanReturns` record retains the original current plan ID, native basis/catalog hashes, full accepted-input hash, reviewer metadata, predecessor review and complete `review`, `comparison` and `input` file descriptors. An applied row additionally identifies the actual saved native plan and revision count. Complete workspace receiving replays every original accepted request through the original model, validates every predecessor and file, and verifies the native plan receive. Receiver-local archive receipts keep their own workspace semantics.

## Operator workflow

Open **Returned procedures** in the existing Human Services Directory application.

1. Select an exact saved current procedure using the paged source-plan search or its full native record ID.
2. Upload the complete returned OperatingPlan. Its full text and filename remain in the working draft. Enter the review identity, reviewer, notes and actual operating owner.
3. Prepare the original comparison. Inspect every page and its complete shared/current/returned values. Select current, returned, shared or custom values and retain a reason. Filters distinguish conflict and unresolved rows; they do not omit rows from the saved full comparison.
4. Save complete reviewed choices. Finish any unresolved changes or original-model issues. Then retain the completed review intent.
5. Read the actual native saved head and apply the retained reviewed result. A changed head is an explicit conflict unless the full completed history is already present.
6. Download complete editable JSON, readable HTML or the reviewed complete plan. Review, comparison and accepted-input files also have their original full-file routes.
7. Receive and reopen the complete editable Directory workspace in the customer's separate private destination.

The working JSON includes incomplete custom JSON text, all decisions, original upload text and any pending exact request. Explicit Save working JSON and session persistence preserve this working material across reload. While a read/save/file intake is pending, all editable controls are disabled; edits cannot be cleared by the arriving response. The pending-request view can retry the identical request. Retain its full working copy before choosing to revise a rejected input. A complete saved review is immutable; revising produces an explicit successor.

No procedure command is executed by this review. An authored local course does not establish that an external customer responded, accepted a delivery, reserved a service or approved a source warning.

## Native API and CLI

The source-owned `directory-operating-returns-schema.json` contains every exact JSON input. POST actions live at `/api/directory/operating-returns/{prepare,revise,complete,apply,receive,export}`. All requests use the existing authenticated loopback operator and original workspace identity.

| Operation | Native CLI | Python method |
| --- | --- | --- |
| Prepare original histories | `operating-return-prepare --input FILE` | `prepare_directory_operating_return` |
| Save complete decisions | `operating-return-revise --input FILE` | `revise_directory_operating_return` |
| Retain completed intent | `operating-return-complete --input FILE` | `complete_directory_operating_return` |
| Receive reviewed plan | `operating-return-apply --input FILE` | `apply_directory_operating_return` |
| Receive full existing review | `operating-return-receive --input FILE` | `receive_directory_operating_return` |
| Export JSON/HTML/plan | `operating-return-export --input FILE` | `export_directory_operating_return` |

Put `--workspace PRIVATE_WORKSPACE` after the CLI subcommand. Read a complete review with `operating-return-review --workspace PRIVATE_WORKSPACE --id RECORD`; comparison and input use the corresponding suffix. Native rows use `rows --kind operating-return --id RECORD --offset 0 --limit 50` and optional `--row-kind`, `--conflict true|false`, `--unresolved true|false`. Whole original files use `file --kind operating-return --id RECORD --member review|comparison|input --out PRIVATE_FILE`.

GET `/api/directory/operatingPlanReturns/:id/{review,comparison,input,rows}` returns the source-defined original JSON. Rows accept offset, limit, kind, conflict and unresolved; pages have a contiguous nextOffset and 4 MiB budget. GET `/api/directory/operatingPlanReturns/:id/files/:kind` streams the complete declared file. The collection's ordinary record/read routes retain full historical rows.

## SDK, MCP and recovery

The existing `merchant_human_services_directory_` provider includes six exact mutation tools and five original read/file tools. Its types expose all original model and native record shapes. `changeHumanServicesDirectoryOperatingReturn` performs exactly one selected accepted action and attaches its complete original input to an interrupted/rejected error. Call complete and apply separately; preserve the completed intent and exact apply input before dispatch.

`readHumanServicesDirectoryOperatingReturn` reopens the full record, review, comparison and accepted input. `iterateHumanServicesDirectoryOperatingReturn` yields every complete comparison page and validates original record/review identities, total, contiguous offsets and byte bounds. `downloadHumanServicesDirectoryOperatingReturnFile` binds the original declared payload bytes/hash to its native descriptor before receiving every file through the maintained transport. `downloadHumanServicesDirectoryOperatingReturn` receives complete JSON, HTML or reviewed plan exports in the same way.

The runtime's named payload is selected by `manifest.source.payloadFile`; otherwise the original response is `original-response.json`. Request, input and artifact metadata files are not substituted for that payload. Complete downloads retain every manifest member and can be reopened by the original receipt.

Native limits are 32 MiB per OperatingPlan, 128 MiB per full review, 192 MiB per accepted return request, 256 MiB per comparison and 512 MiB for the file bridge/readable export. Existing connected JSON input/response limits remain unchanged. Use the native CLI/HTTP input for a larger valid request and the full-file route for a larger original review/comparison. The complete Directory archive limit remains 2 GiB; the connected whole-file route remains 512 MiB. Nothing is truncated to fit an interactive response.

## Complete native operating course

Use the already completed original Directory result and its matching editable archive. The course creates a distinct derived workspace retaining the original UUID. It does not rerun acquisition or original Directory construction.

```sh
python SOURCE/fhir_directory/operate_operating_returns.py \
  --receiving PRIVATE/OPERATED_HUMAN_SERVICES_DIRECTORY.json \
  --receiving-sha256 0b0e08808ae3c1c62c512271dd6269cee2219b792d63d720ef67b8411e775fe0 \
  --archive PRIVATE/Directory_Complete_Editable_Workspace.zip \
  --workspace PRIVATE/return-course-workspace \
  --out PRIVATE/return-course
```

The selected completed archive is 28,828,941 bytes, SHA-256 `c00ad722ed19986a513e113b3a69c82cfae2aa4bdcddc6b7056187a3b1578064`; the original UUID is `2c51f522-4852-463b-bdc0-59389d7bae83`. Keep the unchanged 103,569-byte native JSON beside it. Existing source environments set `SF30_DIRECTORY_PYTHON`, `SF30_REFERRAL_PYTHON`, `SF30_ELTSS_PYTHON` and `SF30_XML_PYTHON` to their selected original interpreter when required; the original Node bridge uses its existing runtime selection.

The journal retains each exact request before mutation and reuses a completed step. The course prepares a real source-bound plan, authors a divergent local revision and a returned copy, saves explicit original-model choices, retains completion, deliberately reaches the actual plan-save-before-return-receipt boundary, recovers the applied receipt, preserves a later saved head, receives a full existing review, downloads all complete originals, checks authenticated API/CLI reads, exports the whole workspace and receives/reopens it in a fresh private customer destination.

Outputs are `OPERATED_DIRECTORY_OPERATING_RETURNS.json`, `OPERATING_RETURNS_JOURNEY.json`, complete original review files and exports, source identities, full registry and `Directory_Customer_Return_Complete_Editable_Workspace.zip`. The result declares actual execution only after every native step and customer restoration completes.

## Complete operator, Merchant and customer course

```sh
node SOURCE/fhir_directory/operate_operating_returns_clients.mjs \
  --receiving PRIVATE/return-course/OPERATED_DIRECTORY_OPERATING_RETURNS.json \
  --workspace PRIVATE/return-course-workspace \
  --out PRIVATE/return-clients \
  --chromium EXISTING/CHROMIUM \
  --playwright EXISTING/PLAYWRIGHT/index.mjs
```

This consumes that complete actual native result. It operates the real returned-procedure screen, receives a full authored incoming plan, preserves incomplete custom JSON through download/reload, saves the corrected explicit choice, completes and applies the reviewed result, receives complete browser exports and captures desktop/mobile views. It replays the exact original accepted native calls through SDK/MCP, reads every original return and comparison page, receives all declared files and historical plans, closes/reopens Merchant on the same native owner and reads the review again. After exporting the full current workspace, it releases the original host and receives the exact packet into a separate customer workspace, compares every immutable record and reopens its review/predecessor in the real operator.

The course uses only the selected installed Chromium and one browser at a time. Its journal retains browser POST inputs before dispatch and reconciles the exact original request on interruption. Save the whole output directory and its independent result, journal and workspace packet before an ephemeral process exits. The selected result must always travel with its own exact workspacePacket, not an earlier archive.

Output is `OPERATED_DIRECTORY_OPERATING_RETURNS_CLIENTS.json` plus `OPERATING_RETURNS_CLIENTS_JOURNEY.json`, all full native/connected file receipts, comparison pages, original histories, browser working drafts, screenshots and complete customer workspace. Source syntax checks and publication alone are not evidence that this course has run.

## Source and ownership

The unchanged original return model/type declarations come from merged Merchant PR935, head `85d2072671e31c5b352e7bce4fb7c47a38f2802a`, merge `0cd72e1e555a0a5314a8c98b7842d65cc37b7484`: model `bd3e83ff93dba623647f9dbb046f5a573748d2d8`, types `ebb27c80e74ccadddd4515027296acc38b08a55a`. Its original standalone browser/CLI remain with their original owner. The Directory bridge adds its own native storage, source-bound receiving, industrial operator and clients around that exact model. Directory publication must preserve concurrent original-owner changes and record any later upstream model adoption explicitly.
