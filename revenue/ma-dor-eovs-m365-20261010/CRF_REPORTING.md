# Crisis and Resilience Fund reporting

This application extends the retained migration workbench with the England CRF Year 1 Crisis support reporting workstream. It keeps actual source files, explicit mappings, complete reporting editions, full differences, finding decisions and original workbook files in the existing SQLite workspace and operation journal. It does not create a second customer database.

Open **CRF reporting** from the ordinary application index, or visit **/crf**. The native server, command API, original file store and portable receiving workflow are the same ones used by the other workbench modules.

## Owner-directed product inspection

Before calling this client/prospect-facing application, report or export ready, the producing worker must open/run/render the exact outgoing version, LOOK at its actual screens or real screenshots, and operate its important controls. Check intended screenshare width and narrow/mobile width, populated/empty/loading/error states, complete downloads and reopening. Capturing screenshots without viewing them is insufficient. Fix broken, unstyled, cramped, clipped, overflowing or unreadable output before presenting it. Source review, HTTP success, DOM counts, unit checks and another worker's approval do not replace seeing the product.

Use plain industrial design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls and useful labels. Keep the real workflows and computation. Apply this instruction to delegated workers and the application copies they actually consume. Preserve existing source, native and receiving owners. These requirements do not create new watchers, duplicate operations, broad test suites or a restart of an owner-stopped project.

The CRF receiving programme reports its actual CLI/source result separately from rendered-product status. Its completion does not set browser_executed or client_ready to true.

## The reporting contract

The rule source is the DWP Year 1 combined reporting guidance, updated 7 April 2026:

- [Combined reporting requirements](https://www.gov.uk/government/publications/crisis-and-resilience-fund-guidance-for-local-authorities-in-england-1-april-2026-to-31-march-2029/crisis-and-resilience-fund-1-april-2026-to-31-march-2029-management-information-combined-reporting-requirements)
- [Combined data catalogue](https://www.gov.uk/government/publications/crisis-and-resilience-fund-guidance-for-local-authorities-in-england-1-april-2026-to-31-march-2029/the-crisis-and-resilience-fund-management-information-combined-data)
- [Fund guidance and publication index](https://www.gov.uk/government/publications/crisis-and-resilience-fund-guidance-for-local-authorities-in-england-1-april-2026-to-31-march-2029)

The supported periods are:

| Selection | Included dates | Due date |
|---|---|---|
| interim | 1 April–30 September 2026 | 29 October 2026 |
| annual | 1 April 2026–31 March 2027 | 6 May 2027 |

The annual return is cumulative. Do not add an interim total to an annual total that already includes the interim period. A comparison between these periods remains an explicit period comparison; it is not an accounting adjustment.

A contract retains the authority name, county/unitary authority type, scope, financial year, actual recognition basis, explicit repeat-count interpretation and named review evidence. This version deliberately pins Year 1. A later rule version requires an explicit reviewed software revision.

For a county authority, Housing Payments Tab 3 is outside this Crisis support workstream. Actual county-to-district contributions belong in the supplied governance totals and notes required by the issued workbook. The application does not infer the completeness of Resilience Services, Community Coordination, Housing Payments or officer governance from Crisis support data.

## Complete source intake

Retain the actual original exports and their acquisition evidence. CSV and complete flat JSON-table inputs preserve original scalar kinds and JSON numeric tokens. Inspect original headers before selecting a mapping. An API response, periodic full export, deletion/tombstone feed and independent finance/control return have different coverage meanings; an added/updated endpoint does not prove deletions.

Six explicit source families make one reporting edition:

| Family | Reporting role |
|---|---|
| applications | Explicit outcome units, including application and non-application awards; awarded, refused, pending and accepted-but-unawarded are distinct |
| awards | One reviewed awarded reporting unit per awarded application/outcome unit |
| allocations | Original recognised spend by award and the actual presenting-crisis, support-method and need categories |
| payment_controls | Independently acquired actual payment outcomes, amounts and payment timestamps |
| repeat_counts | One reviewed recipient classification at the reporting period end, with twelve-month coverage and interpretation evidence |
| contributions | Actual supplied governance/other-strand values, each with an authority reference, under external.* metric names |

The application/outcome and award rows are **reporting units**. They are not a guessed Theseus, GrantsNow or other vendor table layout. A raw case can have multiple events or instalments. The accepted mapping must identify the correct reporting unit before import; payment instalments and split spend belong in their related families. The one-to-one link is explicit and checked.

Every family must be selected, including an actual reviewed empty population where appropriate. Missing fields stay unknown. Unknown source coverage does not become complete because a file has no rows.

Each dataset retains:

- Its complete file identity, filename, format and selected CSV encoding/delimiter.
- The exact canonical-field-to-original-column mapping.
- Explicit original-to-reviewed category translations where needed.
- Source system, extraction reference, captured timestamp, declared start/end and complete/partial/unknown coverage.
- The original review actor, role, note and evidence files.
- Every original row, its scalar kinds, mapped cells and mapping/identity issues.

A direct mapping value is an original column name. A reviewed category translation has this shape:

~~~json
{
  "column": "actual_award_flag",
  "values": [
    {"source": {"kind": "string", "value": "Y"}, "target": true},
    {"source": {"kind": "string", "value": "N"}, "target": false}
  ]
}
~~~

Unmapped values produce findings. The application does not guess that a blank means false or that an unfamiliar source code means other. Actual field names and category values are advertised by crf.schema and used in the operator.

An original source is limited to 64 MiB. The underlying original parser's explicit row/column limits remain in force. Planning quantities in a commercial workshare are not measured customer volumes.

## Reporting calculation and lineage

Table 9 includes awarded and refused outcome units, including non-application routes. Pending applications and accepted-but-unawarded applications are excluded. Each awarded outcome must have its explicit corresponding award unit. Table 10 routes count those award units.

Table 8 uses exact GBP allocations under the reviewed recognition basis. Table 11 splits that spend by actual application basis. Table 14, 15 and 16 each use explicit reviewed categories. Split spend is recorded as actual allocations; the application does not invent equal splits. Every relevant amount has at most two decimal places and computations use a 256-digit decimal context.

Table 12 uses actual elapsed time from submission to payment for application-based awards, excluding in-kind goods. The boundary is two consecutive calendar days, including weekends; it is not a business-hours calculation or decision-to-payment interval. The payment time must also appear in an independently acquired paid control.

Table 13 counts recipients once at period end. Its supplied previous-award count is explicitly reviewed against the twelve-month guidance. The published previous-award wording and example are retained as an interpretation question; the application does not silently subtract one from a total-award count. A local household lookback rule does not replace this reporting basis.

Table 17 permits overlap among children, pensioners, disabled persons and other individuals. Employment and benefit pairs reconcile separately. The actual source classification must use the reporting definitions and, for awards supporting children, the relevant adult's employment and benefit basis. No age, disability, employment, benefit receipt or eligibility is inferred by this software.

A declaration of complete coverage is insufficient if the capture predates the reporting period's close. England reporting periods close at the next midnight in Europe/London. Such editions remain provisional. A purported observed submission or payment timestamp later than the source's actual capture also creates a finding.

Every original row gets a retained disposition. Every metric contribution points to its dataset, row identity and ordinal. Original errors are retained rather than dropped. Missing or ambiguous related rows, incomplete sources, allocation/control differences and unreconciled categories remain visible findings.

The result READY_FOR_WORKBOOK_MAPPING means the selected reporting calculation has no findings. It does not mean the whole official workbook is compliant or that an officer or DWP has accepted it.

## Two editions, corrections and findings

Create an initial edition from the complete six-family selection. A corrected descendant retains each earlier source or an explicit dataset descendant; it does not silently replace a source file under the old identity.

Compare full editions to see every business-key group, every occurrence and every metric. Duplicate identities remain grouped and AMBIGUOUS. A removed classification requires complete compatible source coverage; otherwise it is NOT_OBSERVED. All before/after rows remain in the complete export, including unchanged rows.

A finding review retains one decision for every original check in a complete strict JSON file. The dispositions are:

| Disposition | Meaning |
|---|---|
| open | Work remains on the original finding |
| explained | The explanation and evidence are retained; the reporting fact is still unresolved |
| corrected | An explicit corrected descendant of the same reporting period no longer contains that finding |

A review preserves its exact parent and actual evidence. It never edits the old edition or turns incomplete original facts into complete workbook inputs. For workbook output, select the corrected complete reporting edition itself.

The browser retains unfinished decisions under the exact workspace, edition and parent review. Reopening an existing review must load all its original decisions before applying drafts. Pagination must not discard unedited decisions or previously attached evidence.

## Use the actual issued workbook

Obtain the actual issuer-provided workbook through the existing authorised operator. The public HTML guidance and field catalogue do not provide a substitute workbook. Preserve the actual file as an original object.

The adapter supports original XLSX and XLSM packages. It does not convert an XLS, a PDF, a locally redesigned workbook or a template extension into an official return.

Inspect the actual workbook, then create an explicit reviewed binding:

- Bind the whole template hash, original format and authority reference.
- Select exact existing sheets and A1 cells from inspection.
- Bind each selected cell's original raw-cell hash and intended scalar type.
- Map inputs to an original metric or an explicitly reviewed typed literal.
- Select actual workbook check cells and any explicit expected cached values.
- Review any preserved macros and external relationships. They are not executed or refreshed.

The adapter preserves original package members and changes only the selected existing input cell spans. It refuses formulas and their shared/array followers, effective protected locked cells, merged followers, digitally signed packages and unsupported metadata-bearing inputs. It never removes protection. A locked style is effective on a protected sheet; both the original style bit and effective protection are exposed.

Text remains literal, including SpreadsheetML escaped-character semantics. Exact numeric text is preserved in XML. Values exceeding native spreadsheet precision are flagged for actual returned-input inspection; the adapter does not silently round them.

Verification retains the exact original generated output container. It compares every decompressed package member and the precise selected input edits against the original template; it does not recompress the archive to recreate its identity across Python or compression-library versions.

A populated workbook retains historical formula caches. It must be opened and recalculated in the actual authorised spreadsheet application. Staff must look at the rendered controls and retain the actual saved return.

Import that actual return against the original prepared output. The comparison retains all selected inputs, cached checks, formula/protection/validation comparisons, unbound cell changes, changed package members and active/external-content differences. Large observations are paged retained sections, not a truncated summary.

A matched cache is an observation, not proof of a fresh calculation. The software does not manufacture a typed Section 151 signature, copied submission email, authority to submit or DWP acceptance. Record those actual events through the authorised owner workflow.

## Operator, commands and full exports

Start or reopen the application from its complete source directory:

~~~sh
python3 migration_server.py --workspace /absolute/existing-workspace --port 8083
~~~

Use --create only for an actually new workspace. Keep the server local or behind the existing authorised access route.

The browser uses the existing POST /api/read and POST /api/operations routes, with the existing operation/payload envelope. It uploads through POST /api/files and downloads exact objects through GET /api/files/SHA256?filename=NAME. Complete CSV/NDJSON record exports use the existing /api/exports route.

Native commands use the same dispatch:

~~~sh
python3 migration_cli.py --workspace /absolute/existing-workspace command crf.schema
python3 migration_cli.py --workspace /absolute/existing-workspace command crf.edition.create --payload /absolute/reviewed-request.json
python3 migration_cli.py --workspace /absolute/existing-workspace command crf.verify
python3 migration_cli.py --workspace /absolute/existing-workspace export crf.edition RECORD_ID --format ndjson --out /absolute/new-output.ndjson
~~~

Every mutation requires its original operation_id, actor and exact expected_revision. Successful replay returns the original complete result. Unknown, running or post-commit outcomes retain the exact original request for recovery.

crf.request_status can permit returning a known local validation rejection to a new draft only after one original SQLite snapshot shows no retained owned record, rows, result or checkpoint. This observation does not cancel the old journal entry. Workbook generation keeps original-request recovery because an output object can have been published before a later interruption.

crf.verify rebuilds the original selected record and its full dependency closure from retained requests and original files, compares every complete section, then checks the original successful result. It verifies immutable history; it does not perform a vendor call or confer external approval.

## Complete portable receiving

The current portable application includes every existing case, grant, financial, property and register file plus the eight CRF leaves. Historical complete source profiles remain supported as their own immutable editions. Never replace a captured old source edition during the same receiving operation.

Use the ordinary full portable delivery for staff handover. The separate crf_receiving.py programme can execute a reviewed original plan through two independently editable receivers and a final independent receiving of their complete returned archive.

A plan contains schema commons.crf-receiving-plan/v1; a unique operation_id; title and actual actor; workbook_required; the full original files list; original steps; and first_edit/second_edit with distinct operators and complete explicit steps. Each file has key, absolute path, filename, SHA-256 and byte count. A step has key, advertised operation and full semantic payload. The programme itself binds actor, original operation ID and revision.

Within payloads, {"$sha":"file-key"} resolves an original file hash, {"$file":"file-key"} its evidence descriptor, and {"$step":"prior-step-key"} an already retained record identity. Forward references are rejected.

The original stage requires a reviewed contract, at least two complete reporting editions and their full comparison. Every original-course workbook output must belong to a selected edition and original contract; every returned workbook must belong to one of those original outputs. Set workbook_required to true only when this actual course includes both the prepared official workbook and its actual returned native file. False records a reporting-workspace course without claiming the workbook step happened.

~~~sh
python3 crf_receiving.py --plan /absolute/original-plan.json --workspace /absolute/producer-workspace --output /absolute/owned-receiving-output --create
~~~

Continue the same admitted plan, output directory, source edition and runtime with --resume. Do not relaunch an unknown operation under a new identity.

The programme retains the actual interpreter/source binding, original plan, all source objects, complete phases, three full archives, both recipient edits and an independently received final delivery. Cold reopen compares original requests and complete results in all three receiving workspaces. Completed continuation preserves later recipient edits; it does not recreate a missing completed receiver as if no work could have occurred there.

A CLI result is a CLI result. Complete the owner-directed actual browser and outgoing workbook inspection before presenting the resulting product to a client.

## Prepare the complete authored operating course

The application includes a complete onboarding and receiving plan. It creates six nonempty source families with 20 original rows, a deliberate paid-control difference, its corrected source descendant, full edition comparison and finding decisions. The first recipient edits both an allocation and its separate control, then computes and reviews a later complete edition. The second recipient makes an independent successor review. All original records and both actual edits remain in the three complete delivered archives.

~~~sh
python3 crf_receiving.py --prepare-reference /absolute/owned-work/crf-reference
python3 crf_receiving.py --plan /absolute/owned-work/crf-reference/REFERENCE-plan.json --workspace /absolute/owned-work/crf-producer --output /absolute/owned-work/crf-receiving --create
~~~

The reference directory contains all 19 original files, the complete plan and manifest. Preparation computes and checks the intended source populations before writing any member. It leaves actual workspace operations to the normal receiving command. Existing differing files are never replaced.

The example starts at GBP 200.00 with exactly one allocation/payment-control difference. The first correction preserves the spend and corrects that control; the first recipient's consistent allocation/control edit produces GBP 205.00. Each complete comparison retains all 20 original rows. The original course has 13 steps, the first recipient five and the second recipient two.

Every reference value and operator is explicitly authored software onboarding material. The course contains no issued MI workbook; workbook_required is false. Supply actual official workbook bytes and an actual native return in a separately reviewed plan to operate that part of the product.

## Readable handover report

Every complete portable delivery includes crf-review.html beside the ordinary review.html. It presents all retained contracts, source editions, reporting results, comparisons, review chains and workbook observations at the selected workspace revision. Each reporting edition has its complete metric table; every record links to full CSV and NDJSON exports of all retained sections. Earlier and later totals remain separate editions.

Open the actual report, its exports and the editable archive as a recipient. Inspect intended and narrow widths and reopen the delivered application before calling the outgoing product ready.

## Complete authored browser operating and return course

The complete CRF receiving module also contains a concrete browser course. It uses the existing six-family authored reference plan and the original application, without adding an application file or changing the admitted register48 programme. This is an operator-authored software course; it contains no customer records, issued DWP workbook, native spreadsheet calculation, payment instruction or officer acceptance.

Freeze the **entire current 59-file application**, including this guide and the complete receiving module, before the first original mutation. The already captured 56-file CRF course retains its original v5 application and exact source selection. The browser continuation checks that exact application selection against the three-archive result; adding the browser source after an older course has already begun is not a valid continuation.

An accepting owner should run these commands from that exact application directory, using one owned ordinary-disk root and actual installed runtime paths:

```sh
python3 -B crf_receiving.py --prepare-reference /absolute/owned-crf/reference
python3 -B crf_receiving.py --plan /absolute/owned-crf/reference/REFERENCE-plan.json --workspace /absolute/owned-crf/workspace --output /absolute/owned-crf/receiving --create
python3 -B crf_receiving.py browser --result /absolute/owned-crf/receiving/COMPLETE.json --output /absolute/owned-crf/browser --node /actual/node --playwright /actual/playwright/index.mjs --chromium /actual/chrome-headless-shell
```

The first command only preserves the complete authored source and plan. The second performs the original plan, both recipient edits, all three exports and the independently reopened final edition. If interrupted, continue that same command with its original paths and `--resume`, retaining its existing creation choice as described above. The third is a separate continuation of its completed result. Its output must be a nonnested sibling of the original receiving directory. Select an actual Playwright module entry exporting Chromium and existing executable Node/Chromium paths; there is no download, hosted browser, paid service, installation or Actions job in this course.

The browser command deliberately accepts only `CRF-AUTHORED-REFERENCE-20261013-V1` with `workbook_required:false`. Actual customer plans keep their original explicit receiving path. An absent issued workbook remains absent: the workbook tab is inspected in its real empty state, without creating a substitute XLSX, manufacturing native formula observations or enabling an external write.

### Actual operating flow

The browser supervisor receives the original **first** archive into its own editable workspace and retains every original source file from the received content-addressed objects. It does not read an assumed former source directory. It opens a genuinely empty workspace as well as this populated receiving workspace.

Through the mounted original controls it copies an existing contract into an unsaved draft and reopens that draft; stages the original complete files; previews the selected mappings; shows an actual invalid-mapping error; and performs the plan's five first-recipient actions and two second-recipient actions through the actual forms. These are the original allocation/control correction, complete later edition and comparison, full review and both successor review decisions. Each uses the plan's authored actor. The earlier saved plan, requests, records and three original archives remain intact.

The UI uses its own durable operation UUIDs. The browser journal binds each actual request to its original logical step and maps references to the actual returned record IDs. The original source bytes are unchanged. Three explicit UI representation choices are retained in the new requests: selected evidence has the UI role `evidence`; JSON intake records the UI's encoding and delimiter fields; multi-select dataset IDs follow the actual form order while requiring the identical complete selection. A review's complete decision file is checked against every original selected decision after binding any correction reference to the actual browser-produced edition. These are new recorded recipient requests, not claims that their request bodies match earlier native IDs byte for byte.

The course exercises the actual finding controls, selected evidence attachment, exact-parent review drafts, reload, full record/section pages, original-file links, verification and handover controls. It downloads every retained CRF record as complete CSV and NDJSON, every displayed original file, and the full editable ZIP. The supervisor compares those downloads with the complete native originals and exports; it verifies the downloaded ZIP against the exact delivery receipt.

It then independently receives that **actual browser-downloaded ZIP** into `return-receiver`, checks every original and browser operation/record, opens the returned application in a new browser session, and renders `reports/crf-review.html`. Every linked complete CSV/NDJSON attachment is parsed and compared with the original record exporter, and all eight complete record inventories are read. The full workbench report remains linked and retained. Both populated and returned application views and the CRF report are captured at 1440 and 390 pixels. Real empty, mapping-error, admitted-loading and draft-reopen views are also retained.

### Interruption and exact continuation

Keep the entire browser output directory, its `intent.json`, `session.json`, `browser-profile`, `browser-phases`, source/configuration, originals, downloads, images and logs. Continue by repeating the **same browser command**. The original programme, application selection and runtime identities must still match.

Before each mutation is forwarded, the programme saves the actual complete request and browser session. It retains every actual HTTP return before delivering that return to the UI. A lost response is reconciled by the original operation ID. Completed phases adopt only the same complete native request/result. An unadmitted request can use the UI's exact retry; an interrupted original uses its retained continuation control. A running or unresolved request remains unresolved and is not replaced. A known rejected input is preserved for investigation; the course does not silently alter its original semantics to force completion.

An inherited filesystem lease covers the supervisor, Node and its original Python listeners. A second browser invocation cannot enter while any of these original owners still holds it. Closing the owner's pipe asks its owned children to close; an uncertain child retains the lease. The programme does not kill unrelated processes or create a new course after an unknown result. Missing recipients with already-admitted browser requests are an error, not an invitation to recreate their old baseline. Complete results preserve later valid recipient edits and the first immutable completion receipt.

### Completion and actual rendered review

`browser/COMPLETE.json` records the original input/application/runtime binding, full browser results, downloaded archive, independent return, complete export and record verification, and retained artifact identities. `browser/BROWSER-COMPLETE.json` and `browser/return-browser/RETURN-BROWSER-COMPLETE.json` retain the corresponding actual browser outputs. Attempt stdout/stderr and original requests remain alongside them.

A successful automated result sets `browser_executed:true` but deliberately leaves `screenshots_viewed:false` and `client_ready:false`. Before a product-ready claim, the producing operator must **open and view the actual outgoing screenshots or live render**, inspect the full CRF report and its downloaded attachments, check the important controls and readability at intended and narrow widths, and inspect the returned editable workspace. Capture alone, source review, DOM checks and HTTP success do not satisfy that requirement. Fix any observed defect in the actual outgoing product and preserve its new complete edition and original operation history. State the observed native/browser result and any remaining workbook or acceptance input accurately; no result is claimed merely because this source exists.
