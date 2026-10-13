# Commissioning Collections customer installation

This operating package joins the customer's original paid Workshare to the delivered Commissioning Collections application. Use the existing Grant Operations case, Source Preparation Desk and Installation workflow to retain the whole commercial scope and receive the actual customer operation. Use the original merchant accounting workspace for invoices, bank and Stellar receipts, credits, allocations, refunds and saved Xero cash cycles.

The installed profile ID is `commissioning-collections`. The merchant selected product is `merchant-commissioning-collections`; its operator desk is `/receivables/commissioning/`. The profile is discovered by the maintained `profiles.mjs` catalogue in this directory. Grant Operations already includes the complete installation-workorders component, so the new profile is received through that existing selection.

## 1. Select the complete original customer work

Start from the original Workshare case and its actual commercial owner. Retain the source that establishes the whole agreed delivery:

| Original input | Required original identity |
|---|---|
| Workshare receiving packet | `prepared_case.id`, `workshare_input.source.case_id` and complete `workshare_input.plan` |
| Saved Delivery handover | Whole `dealscout.delivery-handover.v1` snapshot, wrapper hash, Workshare/scope/delivery identities and every original saved phase |
| Workshare plan | Complete `dealscout.workshare-plan.v1`, canonical plan SHA-256, commercial currency, schedule and full phase population |
| Phase effort | Each original phase ID, exact JSON pointer, original hours/minutes unit and complete quoted effort total |
| Project source | Complete `partner-commissioning-workshares/v1` edition, original project IDs and source reference |
| Merchant account | Existing original customer, invoice, allocation, credit, receipt, refund and saved Xero cycle identities |
| Installation | Existing operating case, selected deployments, receiving host, named operator and actual payment/source authority |

The portfolio project file and the paid Workshare packet have different source roles. The former supplies project fees, milestone shares and planning context to Commissioning Collections. The latter supplies the original commercial agreement, delivery phases, acceptance terms and effort to the Installation workflow. Retain both complete originals and their own identities.

Keep company-specific scope, contacts, fees, source documents, ledger exports and runtime customer files in the original private delivery. This repository contains the generic profile and operating source. Existing company senders keep the external relationship; the installation workflow uses the customer's actual agreed acceptance and handover participants.

### Effort comes from its original source

For each original Workshare phase, select the real source field that contains its effort. The maintained source helper supports a pointer into the plan or into a complete supporting JSON file. It validates the exact selected hours against that original field, converts minutes through its existing Decimal implementation and checks that all phases equal the original total.

Do not derive effort by dividing a fee by a rate. If a source records only a price, it supplies commercial terms; select the actual separately retained effort source before preparing the complete Installation. Preserve every original phase and dependency. The existing explicit phase-ID amendment can reconcile an already reviewed phase-ID mismatch while retaining the unchanged original packet.

## 2. Retain sources in the existing Grant Operations case

Open **Installations → Prepare original source workshares** in the original operating case. Use its current owner or case-scoped delivery-lead account.

1. Create a source preparation with the original operation identity.
2. Retain the whole Workshare packet and every source or supporting effort document with its exact receiving filename, length, SHA-256, source reference, observed time and media type.
3. Inspect the complete packet and every phase.
4. Select the installed **Commissioning collections** profile.
5. Map every phase's original effort and the full original total.
6. Add the complete project source and agreed native customer/cash handover documents as supporting sources.
7. Save the full selection and prepare the complete native package.
8. Review all prepared files, then attach the complete cohort atomically to the same Operations case.

The Source Preparation Desk's current native limits are 8 MiB per original file and 64 MiB of selected source input. The receiving Operations case has its own complete-source capacity. Use its native preflight and keep whole originals; do not split a financial source into an arbitrary prefix to fit a limit.

The original `source-inputs.py` produces `SOURCE_SELECTION.json`, all original selected files, `Supplier_Workshare_Commissioning.json`, `Supplier_Complete_Receiving_Packets.json`, `SUPPLIER_RECEIVING.json` and `SOURCE_PREPARATION.json`. For an existing saved Delivery handover, `handover-inputs.py` reads the complete original snapshot and preserves its Workshare, source, scope and phase hashes before preparing the same original receiving input.

The maintained Source Preparation Desk guide is:

`stellar/scf_2026/sf47_budget_model/workspace/INSTALLATION_SOURCE_DESK.md`.

### Terminal source preparation

Use the complete selection retained from the desk or the original case owner. The input file names below refer to actual complete source selections; they are not empty templates.

```sh
python3 stellar/scf_2026/sf49_data_commissioning/installation-workorders/source-inputs.py \
  --selection /absolute/original/SOURCE_SELECTION.json \
  --source-root /absolute/original/complete-files \
  --out /absolute/existing-parent/new-source-preparation
```

For the original saved Delivery handover selection:

```sh
python3 stellar/scf_2026/sf49_data_commissioning/installation-workorders/handover-inputs.py \
  --selection /absolute/original/HANDOVER_SELECTION.json \
  --source-root /absolute/original/complete-files \
  --out /absolute/existing-parent/new-handover-preparation
```

Each helper reuses the maintained Workshare intake. It retains original bytes and publishes a complete create-only preparation. Supply the actual source paths and original operation/request identity, then retain its whole output in the same case.

## 3. Prepare and receive the original Installation

Choose the original attached Workshare in **Open native Installation preparation** and read its binding template with profile `commissioning-collections`. The seed's case version, pinned grant plan, Workshare, assignments and original acceptance checks remain the source of the Installation.

Select:

- The accountable merchant deployment and actual independent customer deployment already recorded in this case.
- The original project/source edition and actual source-use authority.
- The receiving host, runtime/source edition and named receiving engineer.
- The actual approved payment network, asset, recipient, authority and terms-source IDs.
- Exact atomic unit price, task count and task budget from the selected merchant terms.

The profile supplies the complete technical customer task, source semantics, operating steps and receiving criteria. It leaves actual commercial and deployment selections with the original case. The source engine checks that the price multiplied by task count does not exceed the selected atomic budget.

Review the full native Installation preview. Open the complete draft and save through the original Installation editor. Keep every original Workshare phase and its native check ID. Record actual execution and receiving observations through those checks, with the actual operator, observation date and original work/purchase/outcome IDs.

## 4. Install the complete merchant application

Use the selected product `merchant-commissioning-collections` with the existing Starforge distribution builder/installer. Its original selection includes the Commissioning Collections source, shared browser client, Xero dependencies and original merchant accounting chain. The existing application provider exposes the installed operator desk. The installed command is:

```text
starforge commissioning-collections
```

Use its installed help and original workspace selection for the actual receiving host. The dedicated application defaults to port 8452 and serves `/receivables/commissioning/`. The native server factory is `createCommissioningCollectionsServer({workspace,receivables,xero,...})`.

The application borrows the existing `ReceivablesWorkspace` and `AccountingWorkspace`. It preserves the original accounting lease, mutation journal, source exports and saved customer files. The Xero helper is borrowed for original file/source access; it does not open another financial store. Stop or transition the original owner through its existing control before a separate CLI process opens that same workspace.

Record the actual installed package/source identity, Node/Python/runtime versions and original workspace identity in the Installation. The standalone product's source programme, `XERO_CASH_CHECK.mjs`, carries the complete existing two-cycle cash/commissioning journey; the receiving owner uses that same programme in its actual selected native environment.

## 5. Inspect and retain the whole project source

In the Commissioning desk, select the complete original UTF-8 source file and inspect it before importing. The source contract is:

| Field | Native meaning |
|---|---|
| `schema` | `partner-commissioning-workshares/v1` |
| `source_date` | Original optional source date |
| `projects[].id` | Original stable project key, up to 160 allowed characters |
| `name` | Original project name |
| `currency` | Original three-character currency code with explicit configured scale |
| `fee` | Original positive exact net fee |
| `milestones[]` | Complete original milestone conditions |
| `payments[]` | Matching positive percentages totaling exactly 100 |
| `stage,owner,case_id,source_url` | Original source context |
| `invoiceDays` | Original optional invoice term in whole days |

The source reader retains the original JSON numeric tokens. Milestone fee shares use largest-remainder distribution in the selected currency's minor units, with original milestone order breaking equal remainders. The whole fee is conserved. No binary floating-point amount is used to invent monetary shares.

The native source limit is 8 MiB; the dedicated HTTP transport accepts the complete encoded source within its original 32 MiB request limit. The source can contain up to 200 projects with up to 40 milestones each. Its full original file remains downloadable.

The inspection returns the original filename, bytes and SHA-256, source date, normalized project rows, currency scales and rounding rule. Review these values. Import with the exact original bytes, expected SHA, inspected revision, actual actor and original request ID. A later edition receives its own source ID and explicit `replacesSourceId`; old imports and captures remain intact.

## 6. Select a whole review cohort and actual customer

Choose the account `asOf` date and original project IDs. Each selected project has an explicit native customer UUID. A project without a customer remains a review item; the application does not infer a customer from a name or similar amount.

Use the original candidate views for customers, invoices, allocations, credits, receipts, refunds and saved Xero cycles. Candidate pages preserve the same original workspace revision and date context. Keep the whole selected object and its source identity when making a binding.

The review selection distinguishes these native identities:

| Selection | Required original fields |
|---|---|
| Invoice line | `invoiceId,invoiceSha256,invoiceLineId,netAmount,taxAmount` |
| Allocation portion | `allocationId,amount` |
| Credit-note line | `creditId,invoiceLineId,netAmount,taxAmount` |
| Physical receipt portion | `receiptId,amount` |
| Refund portion | `refundId,amount` |
| Xero cash cycle | Original saved cycle UUID |
| Milestone dates | `acceptedDate,plannedAcceptedDate,invoiceDays,delayDays` |

Original project and invoice/credit line keys use their stable-key grammar. Native customer, invoice, allocation, credit, receipt, refund, cycle and capture IDs retain the original UUID grammar.

### Commercial and invoice values

The original project fee is net commercial scope. Issued invoice bindings select exact net and tax portions from original immutable invoice lines and retain the invoice JSON SHA. A milestone can bind several original lines; a whole invoice can be attributed across multiple milestones or projects using explicit portions.

The application checks capacity across the entire selected cohort. The same original line cannot contribute more net or tax than it actually contains. View the complete original invoice balance inside the binding when a project uses only part of it.

Invoice settlement is represented separately. Attribute exact original allocation and credit-note portions to the milestone. The original date boundaries determine whether those records contribute at the selected account date. Selecting a portion of one allocation leaves its unassigned remainder visible as an original finding.

### Dates and planned collection

Record the actual accepted date only from the original observation. Keep planned acceptance in its own field. The selected invoice term can come from the original source or an explicit operator scenario, and the application preserves that basis. Expected collection and planned due dates are planning outputs.

Original invoice issue/due dates, allocation/release dates and physical receipt dates remain independent facts. The review does not convert a project stage such as proposed or complete into a paid or accepted financial state.

## 7. Reconcile physical cash through its original owner

Select receipt and refund portions for physical customer cash. These are separate from allocations that settle invoices; the report displays separate commercial, settlement and physical-cash totals.

| Native situation | Original action before the next cohort review |
|---|---|
| Unallocated customer payment | Use the original receipt/customer funds view and explicit allocation |
| Partial statement coverage | Retain the original bank coverage key and covered amount |
| Wrong customer or bank amount | Use the original reviewed bank receipt correction with its source-specific successor/residual records |
| Paid credit disposition | Use the original credit disposition to release/reassign exact native allocation amounts |
| Pending customer refund | Retain original reservation and proposed payout terms |
| Actual refund or verified Stellar return | Receive or record it through the original refund controller and retain its native proof/source |
| Unposted verified outgoing return | Reconcile/adopt the original return through its existing reviewed flow before reusing the affected cash |
| Operator correction of an earlier payout | Preserve actual payout date, native accounting/correction date and original replacement reference |

The review retains receipt predecessor/successor IDs, bank coverage, allocation lineage and refund original references. It reads dated balances from the original ledger. A correction creates a new native fact and a later report; the report does not mutate an invoice or move cash.

Keep the complete bank parser reports and source editions with the original bank intake. The delivered source handles CSV, OFX and MT940 through its maintained parsers. Original source-only, pending, debit or correction rows retain their own meanings; the commissioning report uses the native cash records selected by their owner.

## 8. Select saved Xero cash cycles

Use the existing Xero desk to retain the original account observation, native returned document IDs and explicit cash matches. Select the resulting saved cash cycle for the commissioning project.

The review keeps the saved cycle's account date, provider observation time, original source hashes, package cohort, matching outcomes and findings. It does not treat today's Xero aggregate as a historical balance for an earlier date.

Original invoice payments, credit applications, prepayments, overpayments, allocations and refunds remain separate components. In Xero, an invoice's credited aggregate can include more than issued credit notes. The original cash compiler retains component source IDs and exact matching, including reviewed cross-document credit disposition. Missing component IDs, inconsistent totals or unsupported lineage remain explicit review items.

Correct source matches in the original Xero cash workspace, save the resulting cycle and select that cycle ID for the next commissioning review. The earlier saved cycle and the earlier captured cohort retain their own complete source.

## 9. Review, capture and repeat

A preview reads the exact selected source and current native state, normalizes the selection and returns its original revision, complete review, file inventory and `previewSha256`. Review:

- Every selected project and milestone, with original source fee and milestone rounding.
- Recorded and planned dates, original invoice terms and current due-date context.
- Invoice line bindings, exact allocation and credit portions and original whole invoice balances.
- Physical receipt/refund portions, reservations, corrections and native lineage.
- Saved Xero source/cycle comparisons and every original finding.
- Totals by currency, separately for commercial scope, invoice settlement and physical cash.
- All differences from the selected saved baseline.

Capture with the exact normalized selection returned by the preview, its revision and preview SHA, actual actor and retained original request ID. A later edited field invalidates the previous preview; obtain and review a new preview before capture.

For the second cycle, select the actual newer project/account edition and the desired earlier capture as baseline. Review each source, binding and dated-balance difference. A successful later capture preserves both complete editions. Reopen the original owner and recover the earlier request by its original ID to confirm that the old receipt still selects its original source/capture.

A useful delivery includes two actual cycles or the customer's agreed initial cycle and a concrete scheduled repeat trigger. Record the cycles that actually occurred in the original Installation acceptance, with their original source and capture dates.

## 10. Deliver the selected reports and complete private handover

The selected-cohort report files are:

| File | Content |
|---|---|
| `commissioning-review.json` | Complete selected review and native source identities |
| `commissioning-projects.csv` | Selected project totals and customer references |
| `commissioning-milestones.csv` | Original milestone conditions, dates and attributed amounts |
| `commissioning-cash.csv` | Selected native receipt/refund amounts and date context |
| `commissioning-findings.csv` | Full original review findings |
| `commissioning-handover.html` | Readable selected-cohort handover |

The **complete private capture** archive additionally contains `commissioning-account-snapshot.json` with the entire original receivables ledger/customer population, original source files, selected Xero cycle files and original customer cash advice. Deliver that complete operational archive to the authorized internal/customer operator specified by the original agreement. Use the selected HTML/CSV reports for the intended cohort report recipient.

Preserve each file's original name, byte count and SHA-256. The archive's complete inventory keeps every origin/role even when identical original bytes are stored once. Preserve the full original workspace handover separately from a report export: it contains the working source, owner configuration and saved native state needed to continue the account.

The customer acceptance step includes opening the actual installed desk, reading the retained sources and capture, downloading the whole agreed files, performing an agreed local correction through its original controller and reopening the resulting successor capture. Record what the customer actually received and operated against each original Workshare-linked Installation check.

## Original HTTP and typed-client operation

The dedicated API root is `/api/receivables/commissioning`.

| HTTP operation | Native result |
|---|---|
| POST `/sources/inspect` | Complete source inspection |
| POST `/sources` | Reviewed original source import |
| GET `/sources` | Paged original source list |
| GET `/sources/{id}` | Source summary/projects/history |
| GET `/sources/{id}/files/{name}` | Exact original source file |
| GET `/candidates` | Paged original native candidates |
| POST `/sources/{id}/preview` | Complete normalized cohort review |
| POST `/sources/{id}/captures` | Reviewed immutable capture |
| GET `/captures` | Paged saved captures |
| GET `/captures/{id}` | Complete saved capture |
| GET `/captures/{id}/files/{name}` | Original retained file bytes |
| GET `/captures/{id}/export` | Full saved capture JSON |
| GET `/captures/{id}/export?name=handover.tar` | Complete private archive |
| GET `/requests/{id}` | Original request journal lookup |

Use the installed typed client at `./merchant/receivables/commissioning/client`. It exposes `inspectSource,importSource,sources,source,sourceFile,candidates,preview,capture,captures,detail,file,export,exportFile,request`. The client preserves the original native error/recovery fields. File methods return the actual response bytes; `export` returns the complete capture.

The original helper `commissioningImportArguments` preserves inspected source bytes/hash/revision; `commissioningCaptureArguments` preserves the normalized reviewed selection and preview identity. Use those original helpers when building a durable client workflow instead of reconstructing monetary or request fields from rendered tables.

## Recovery and concurrent work

The browser retains source/import and capture requests before sending, with the actual actor and exact body. It keeps one pending operation until its original result is reconciled. A response timeout does not authorize a replacement request.

Read the original request status. If recorded, adopt the returned source/capture. If the native state reports `WORKSPACE_COMMIT_UNKNOWN`, preserve `outcomeUnknown`, `reopenRequired` and all `commitUncertainty` fields. Close/reopen through the original owner, then read or replay that same request. If a later list or file read fails after a successful write, retain the successful mutation receipt and retry only the affected read.

The Installation Source Desk and the merchant account have separate original revision controls. The former owns commercial source, phases and Installation observations; the latter owns financial records and captured account reports. Keep their original case/workspace IDs and source references when joining the customer handover. Do not copy a revision number from one into a mutation on the other.

## Source and acceptance mapping

| Original paid delivery outcome | Existing implementation and retained result |
|---|---|
| Whole scope and exact phase effort | Source Preparation Desk, source-inputs.py or handover-inputs.py, original Workshare/phase hashes |
| Installed merchant customer workflow | Selected merchant-commissioning-collections product and actual deployment/runtime receipt |
| Billing and cash attribution | Original invoice/allocation/credit/receipt/refund record IDs and complete commissioning preview |
| Accounting integration | Original saved Xero package/return/cash-cycle source and matching outcomes |
| Repeatable collection review | First capture, actual later account/source edition and baseline difference capture |
| Independent handover | Actual named operator reopen/correction, selected reports, complete private archive and original Installation observations |

The original Workshare defines the customer's actual acceptance headings. Map each heading to its real implementation/receiving result and retain every original check; this table supplies the product-side correspondence without replacing the customer's agreement.

## Maintained source

The profile pins the original source paths and blobs for the merged Commissioning Collections product and its existing Installation helpers. The generic product was merged in merchant PR993, commit `0a075ade2fd93d15f553e39bb466c14a46532cb9`, from source `aad181acf271e5e4f5939555ae9420a45209f1c8`.

Use the original Source Preparation Desk and selected-product guides for the existing runtime and deployment controls. Current editions may add complementary customer workflows; preserve their owners and source joins when receiving a newer selected product.


## Receive a saved capture into the original Installation

The **Receive commissioning** tab in the existing Installation Source Desk joins the completed commercial review to the original Workshare Installation. It uses the same browser journal, source files, draft editions, recording operator and original request recovery as the other Source Desk steps.

### Receive the complete original archive

The saved merchant capture can travel as its complete `handover.tar`. Download it from the saved capture, then use **Original files** to retain the complete archive in the current Source Desk draft with its actual source reference and observation time. Open **Receive commissioning** and select it under **Receive a complete merchant handover archive**.

1. Review the complete original archive. The native reader checks the original uncompressed USTAR member set, exact manifest hashes and lengths, required capture/source identities and available draft capacity.
2. Inspect the member inventory and any changed current filenames. Select each exact current file you intend to replace, then review again. Previous draft editions and complete source blobs remain retained.
3. Enter the existing source receiving reason and receive the reviewed archive. The original request journal records its exact archive, replacement selection and preview identity.
4. Inspect the suggested received capture selection. It contains the five required JSON originals and selected reports; map the project and Workshare phases using the same workflow below.

The archive remains a complete private original. Its member inventory includes the complete account snapshot and other private source files. Receiving the archive retains those bytes in the private Source Desk; the later Installation attachment selection includes the complete account snapshot only when explicitly selected. Empty original members remain exact inside the retained archive. Nested original member names retain their original identity and use deterministic native receiving filenames.

The original per-upload limit is 8 MiB, the selected draft limit is 64 MiB, and retained draft blobs are limited to 256 MiB. The complete review reports all three measures. A larger archive can use the individual original-file path below.

The installed command and durable preparation, receiving, replay and reconciliation workflow are documented in [Installation commissioning archive receiving](../../sf47_budget_model/workspace/INSTALLATION_COMMISSIONING_ARCHIVE.md). The same original actual-source receiving programme also accepts an `archive` descriptor instead of `files`, preserving its complete fifteen-step customer operation.

### Retain and inspect the original files

Download the following files from the saved Commissioning Collections capture, then retain each complete file in the current Source Desk draft through **Original files**:

- `commissioning-capture.json`
- `commissioning-manifest.json`
- `commissioning-review.json`
- `commissioning-source.json`
- `original-workshares.json`

Keep each receiving filename, SHA-256, byte count, source reference and observation timestamp. Select the exact capture file and exactly one of each required source file in **Receive commissioning**. Original selected-cohort reports and other capture attachments are optional additional receiving files.

The complete `commissioning-account-snapshot.json` contains the entire original receivables ledger and customer identities. Receiving that file requires both selecting it and checking **Explicitly include the complete private account snapshot**. This checkbox does not select or upload the file by itself.

Choose **Inspect selected original capture**. The native bridge verifies the retained bytes against the original descriptors, checks the capture/review/source identities, and returns the original saved projects and current Installation candidates. An inspection is tied to the exact source draft revision and selected file identities. Editing the file selection invalidates it.

### Review project and phase mappings

Choose the saved project and its existing Installation. The saved project’s original Workshare case ID must match the Installation’s original Workshare binding. The operator selects these identities explicitly.

For each applicable captured milestone, choose its original Workshare phase from the existing Installation’s phase-check bindings. The desk shows the complete captured milestone and the original Installation checks, including their criteria, operator observations, acceptance state and dates. Unmapped milestones remain visible. At least one explicit milestone-to-phase mapping is required by this receiving workflow.

Choose **Review exact Installation attachment**. The review binds:

- The Source Desk draft ID, revision and exact receiving files.
- The original Operations case version.
- The selected Installation ID and revision.
- The saved capture and project identities.
- Each explicit captured milestone / original phase / original check mapping.
- The complete-account-snapshot selection.
- Every source addition or reused original case source, with complete byte and hash metadata.

The interface shows new source count and bytes, the current phase checks, source reuse and native findings. The source table also labels the generated native `Commissioning_Receiving_<sha256>.json` association. Its exact bytes bind the capture/source identities, original Installation and Workshare plan, complete explicit milestone-to-phase/check mappings and original file descriptors. It travels in the ordinary case and Installation exports alongside the selected originals, and its source capacity is included in the preview. Download the complete preview when the operating file needs a copy. A change to the source selection or phase mapping invalidates the prior preview.

### Attach and recover the same original request

Enter the original Installation save reason in the Source Desk reason field, then choose **Attach reviewed commissioning sources** after reading the complete review. The existing Source Desk first stores the exact original action and request ID in its browser journal, then sends `commissioning.attach` with the native preview digest and the reviewed revisions.

The native transaction receives the exact selected files and native receiving association into the original case and creates the next original Installation edition by appending source references to receiving and the selected phase checks. Original check acceptance observations, dates, recording operators, criteria, payment selections and commercial terms retain their original values. The saved result identifies the new Installation revision, original capture, selected project, retained source references and exact preview.

If the response is interrupted, use the existing **Read original request status** or **Retry exact original request** controls. The same retained request ID and original bytes are reused. A successful attachment is retained before refreshing the surrounding case. A later refresh failure therefore remains a readback operation.

The desk retains the complete attachment receipt and offers **Download complete attachment receipt**. Earlier original receipts remain in saved Source Desk history. A revised capture is received through a fresh reviewed source selection; it does not replace earlier saved bytes or infer a new acceptance/payment observation.

### Native API and ownership

All routes remain under the current original Source Desk:

| Operation | Native route or action |
| --- | --- |
| Inspect complete selected files | `POST /api/operations/:caseId/installation-sources/:draftId/commissioning/inspect` |
| Preview exact project, Installation and phase mappings | `POST /api/operations/:caseId/installation-sources/:draftId/commissioning/preview` |
| Attach the reviewed originals | Existing Source Desk command with `action: "commissioning.attach"` |
| Reconcile the original request | Existing Source Desk request-status and exact-replay operations |

Inspect accepts `{expectedRevision,captureFileId,fileIds}`. Preview adds `{expectedVersion,projectId,installationId,expectedInstallationRevision,milestonePhases:[{milestoneIndex,phaseId}],includeAccountSnapshot}`. The returned `selection` and `previewSha256` are carried unchanged to the original attach command; the outer command retains its original draft revision, actor, note and request ID.

The native bridge borrows the original Source Desk transaction and existing Operations/Installation owner. The browser addon borrows the original Source Desk state, persistence, file downloads, request journal and mutation admission. This keeps the complete commercial handover within the customer’s original case.


### Continue the existing native receiving programme

The maintained `installation-source-desk-receiving.py` programme accepts the optional argument `--commissioning-receiving /absolute/private/commissioning-receiving.json` alongside its existing original case, source selection, workspace, runtime and output arguments. The complete original fifteen-phase flow remains in place.

The descriptor has schema `stellar-forge.installation-commissioning-run.v1` and four exact top-level fields:

| Field | Complete original input |
| --- | --- |
| `schema` | The schema string above |
| `sourceRoot` | Absolute private directory containing the original extracted capture files |
| `files` | Complete selected records with `filename, mediaType, sourceUrl, observedAt, bytes, sha256` |
| `projects` | Explicit `projectId, workshareCaseId, milestonePhases, includeAccountSnapshot` selections |

Each `milestonePhases` entry contains the original integer `milestoneIndex` and original Workshare `phaseId`. Select exactly the original file bytes and identities; the five required filenames above and the same explicit full-account choice apply.

Before mutation, the programme retains the descriptor and every selected original file under its existing private run control directory. Its commissioning step follows the original Installation and browser steps. It selects one exact Installation created for the descriptor’s Workshare case, imports the retained capture through the original Source Desk, compares the complete preview before and after native selection normalization, and attaches through the original request journal.

The same step then reads every attached source, verifies the generated association, compares the full Installation document after excluding only the intended source-reference additions, and replays the exact original request. The programme’s existing complete case export, SQLite backup and independent reopen include the saved commissioning receipts and original files. Earlier input and result identities remain in the original run directory. The default invocation without this descriptor retains its original behavior.
