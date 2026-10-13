# Harbour Source Workspace — core and CLI operation

This local source workbench retains original harbour records, documents, declared permissions and history. Its nineteen roles are neutral staging roles. A saved target contract describes actual selected supplier files; the application does not call a supplier tenant or infer effective authorization, a harbour authority decision or a successful load.

## Run the complete source

Use the installed Node executable and the complete sibling files in this directory. The browser runs offline in the separately built Harbour_Source_Workspace.html. The CLI uses the same engine and portable parser. For source imports or saved changes on Linux or Windows, the original CLI holds one kernel IPC lease for the selected workspace path. Concurrent writers fail rather than race. Source review here is not a native runtime or visual inspection result.

All filesystem paths below must be absolute. Keep request JSON and original files with the operation until its first successful save. Use a new immutable output directory for a later edition. An existing exact output is adopted; different existing bytes are preserved and reject.

```sh
node /ABS/harbour-source-workspace/cli.mjs init --workspace /ABS/case/working.json --id harbour-case-1 --title "Original harbour source" --at 2026-10-13T19:00:00Z
node /ABS/harbour-source-workspace/cli.mjs apply --workspace /ABS/case/working.json --request /ABS/case/import-parties.json --file /ABS/source/parties.csv --operation-id import-parties-1
node /ABS/harbour-source-workspace/cli.mjs inspect --workspace /ABS/case/working.json
```

An import request contains the complete attributed input. Keep the original filename in the request even when its physical staging filename differs.

```json
{
  "action": "importCsv",
  "input": {
    "operationId": "import-parties-1",
    "expectedRevision": 0,
    "at": "2026-10-13T19:00:00Z",
    "actor": "Named operator",
    "filename": "parties.csv",
    "purpose": "Original authorized source export",
    "representation": "original",
    "side": "source",
    "role": "parties"
  }
}
```

Without --file, importCsv accepts input.text; importFile accepts input.base64. Every other operation uses its full saved JSON input. The permitted actions are importFile, importCsv, saveMapping, saveCorrection, saveSelection, saveOperatingProfile, saveFinancialProfile, saveReview, saveContract, prepareTarget and recordReturn. Their exact fields and returned IDs are documented in API.md. All original bytes are retained once in the workspace and reconstructed when replaying their original operation.

## Mapping, review and actual returned data

1. Retain complete original source tables and supporting documents, including original workbook/SQL/PDF files that are not parsed. CSV is the mapped interface. Preserve supplier workbook adaptation as an explicitly agreed delivery task.
2. Map each original numeric header position, namespace, compound key and reference purpose explicitly. Duplicate headings remain distinct. A short record's absent cell is different from an existing empty string. Correct one cell with its current expectedValue and an attributed reason; null means only the next missing trailing position.
3. Select exact mapping and document editions. Declare all nineteen role coverage choices and actual permission/history/evidence basis. Unknown coverage remains visible. Any external-only evidence reference must identify its exact selected document record and its original locator; it never claims possession of absent bytes.
4. Read the full projection, graph, conflicting witnesses and source findings. Accept a current structurally ready selection through saveReview. Source completeness and effective authorization remain separate questions.
5. Retain actual supplier route, template and dictionary files. An explicitly authored example must use authority authored-example. Every selected mapping, even a header-only included source, needs a destination table. Map all template columns and every nonempty relationship to the actual destination key. If destination IDs differ, use complete original crosswalk files.
6. prepareTarget freezes the exact source assessment, complete CSV bodies and compound row bindings. Give only the actual approved files to the supplier through its sanctioned process outside this tool.
7. Import complete actual returned CSV files and bind all expected columns to their actual numeric indexes. Missing expected columns use null and cannot pass as a match. recordReturn compares the frozen prepared edition; omitted tables remain unreported, extra rows and unmapped original columns remain visible.

```sh
node /ABS/harbour-source-workspace/cli.mjs rows --workspace /ABS/case/working.json --source SOURCE_ID --out /ABS/edition/source-rows.json
node /ABS/harbour-source-workspace/cli.mjs analyze --workspace /ABS/case/working.json --selection SELECTION_ID --out /ABS/edition/source-analysis.json
node /ABS/harbour-source-workspace/cli.mjs assess-target --workspace /ABS/case/working.json --contract CONTRACT_ID --out /ABS/edition/target-assessment.json
node /ABS/harbour-source-workspace/cli.mjs report --workspace /ABS/case/working.json --selection SELECTION_ID --preparation PREPARATION_ID --return RETURN_ID --out /ABS/edition/Complete_Harbour_Report.html
node /ABS/harbour-source-workspace/cli.mjs handover --workspace /ABS/case/working.json --out /ABS/edition/complete-exit
node /ABS/harbour-source-workspace/cli.mjs receive --workspace /ABS/recipient/working.json --input /ABS/edition/complete-exit/Working_Recovery.json
```

The report rejects a return paired with another prepared output. Every expected and actual returned cell is a readable table row; original JSON and witnesses are also retained. It does not equate byte matches with supplier acceptance or permission enforcement.

## Whole exit and continuation

handover retains every original binary, raw source CSV, attributed correction/mapping/scope/review, historical prepared CSV and actual returned comparison. MANIFEST.json records original names and safe archive member aliases. Working_Recovery.json is the complete original selected browser envelope, including unfinished drafts, selection and copy identity; a plain workspace is wrapped by the maintained parser. The browser Exit additionally carries working HTML and complete source closure.

receive preserves the exact incoming original under a content-addressed .incoming directory. An existing descendant with the same id/title/createdAt and original operation prefix is retained rather than overwritten. Divergent history requires a separate destination. Browser drafts remain with their original current copy; the incoming full recovery remains independently available.

For an interrupted apply, retry the same request and --operation-id. A completed original operation replays against a later descendant without repeating its effect. Its changed input rejects. Once completed, the exact body can be restored from retained original file bytes if the staging input disappears; if the request file also disappears, --operation-id selects its full retained original request. The first invocation always needs actual original request/input files. Optional --expected-genesis and --expected-head freeze a reviewed selection; exact completed operation replay remains valid after later work.

Atomic replacement and create-only outputs are synchronized before acknowledgment. The CLI removes its private incomplete temporary file after a write failure. It never deletes a different final output or steals a live process lease.

## Scope and capacities

Validation ceilings are 32 MiB per original file/CSV, 128 MiB complete portable JSON, 100000 rows and 512 columns per CSV, 256 files, 128 source tables and 10000 operations. These are not measured delivery volumes or throughput promises. Binary Base64, retained history, frozen witnesses and drafts consume portable space. Measure a real agreed edition before commissioning; retain complete originals instead of truncating them.

receiving-fixture.mjs contains only explicitly authored operating examples. Its complete85-operation source course covers all nineteen roles,23records,59retained files and19example target tables; the observed source result has23matching returned records. The actual browser course operates the same forms and a successor edit with22matching records and one changed original label, preserving all prior bytes. This is not council, supplier or tenant data, and source execution is distinct from native/rendered receiving.

## Actual outgoing version

Before any client-facing delivery, the producing peer must open/run/render and personally LOOK at the exact application, full reports and every outgoing attachment; inspect desktop and relevant mobile width, important controls, empty/error/populated states, complete downloads and reopened exports. Open usable ZIP contents and every applicable PDF/report page. Capture images and actually view them. Source checks, schemas, HTTP200 or another worker's approval do not replace observing and using the result. Fix visible defects in the authorized work and continue. No broad sweeps, new controller or approval queue is created. Existing attribution, spending and exact warm-message approval instructions remain in force.

## Harbour operating and financial policy editions

The nineteen roles are neutral source preparation roles, not the fields of a Council tenant or Harbour Assist. Run metadata or inspect the complete API.md before mapping actual originals. The original active supplier route, original reference templates and returned files remain explicit. The workbench never issues an offer, allocation, permit, licence, invoice or payment.

The two additional apply actions are saveOperatingProfile and saveFinancialProfile. Both use the same full saved operation JSON and CLI lease as every other mutation. Their exact inputs are in API.md and receiving-fixture.mjs. Original body, source evidence, actor/time and selected scope are immutable. Imported workbook/SQL/PDF files remain full binary evidence; only explicitly imported CSV is parsed.

A profile binds the exact saved mapping/correction/file selection. A later correction or mapping leaves it STALE. Save a successor selection and attributed profiles to inspect the new source basis. A new profile on the same scope makes an older accepted review ineligible for new target preparation until the new profile selection is reviewed. Existing target CSVs and observations remain intact.

The report separates structural readiness from operating and financial findings. Unconfirmed or adverse operating evidence never becomes a software refusal, allocation or permission. Missing profile means UNCONFIRMED. Date-only and explicit-offset timestamps are compared only within their declared format; ambiguous local strings are retained visibly. Local contact checks require the source application condition, actual party relationship, explicit consent code and selected original document bytes. They make no travel-time inference.

Financial profiles bind actual amount/account/currency/period/type fields and explicit sign multipliers. Exact decimal strings remain separate by namespace/account/currency/period/entry type. Currency conversion and tariff calculations are absent. Selected totals are not debtor balances. A per-record remaining amount appears only after all four source completeness flags, original opening items and compatible allocation dependencies are valid. Missing, unbound, invalid or unknown-partition records keep affected residuals unconfirmed.

Every outgoing report includes whole operating/financial profiles, qualified dates/codes/contact/decision evidence, original allocation records, contributing keys and complete financial findings in readable tables, as well as the full JSON and operation history.

## Complete authored receiving selection

receiving-fixture.mjs exports receivingGenesis, buildReceivingFixture() and receivingRequests(). The complete builder returns workspace/events and all exact selection/profile/review/contract/preparation/return IDs plus sourceByRole/mappingByRole. It uses only fictional authored records.

The complete85-operation course contains19roles,23unique records,59retained files and19supplied example target tables. It distinguishes opaque parties0007 and7 despite equal labels, duplicate unknown headings, all256binary byte values, original consent document, initial versus complete waiting dates, offer timestamps with explicit offsets, and a recorded retained-waiting-date decision. The financial example keeps GBP100.10 and EUR20.00 charges separate; GBP60.05 allocation leaves an exact GBP40.05 remaining amount under its explicit fictional complete-population declaration. The full returned example contains23MATCH records. These quantities are fixture behavior, never a native rendering result or throughput benchmark.

The existing caller-owned browser receiving module performs the real forms, edits the first parties label at column1, preserves both source variants and former target files, creates a successor selection and both profiles, then reconciles a returned original edition with exactly one changed record. Open and personally view all generated screenshots and the selected outgoing attachments. Source-only execution does not fulfill the producing worker's actual rendered-product requirement.

Preserve the existing original case, exact attachments and same equipped programme. Do not create a parallel controller, rebuild old requests with fresh identities, or replace current recipient descendants during replay.
