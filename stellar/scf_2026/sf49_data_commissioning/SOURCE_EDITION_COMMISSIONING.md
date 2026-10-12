# Source-edition commissioning: reports, Cloud data and a usable buyer result

This design extends the [existing SF49 commissioning package](README.md). It defines one customer installation: an authorized source population becomes a reviewed report or query, the merchant offers that operation on Stellar, and the buyer receives the complete result in its own application. A second operator can change the source or terms, reopen earlier output and recover unfinished work using the same installation.

Use the original [SF49 adoption process](../SF49_ADOPTION_PILOT_PLAYBOOK_20261009.md), [SF77 workorder](../../scf-starforge-20261009/sf77-merchant-workorder/README.md) and [SF97 pilot](../../scf-starforge-20261009/sf97-merchant-pilot-conversion/). The new material supplies concrete source, receiving and acceptance choices for those existing records.

**Application basis, October 12, 2026.** TokenJunkieLabs requests the existing **$38,000 for 400 prospective hours over 150 days after award acceptance**. The six packages and original payment assumptions remain the budget. The architecture and reusable implementations described here already exist; the funded work is the selected customers' source/access adaptation, installed Stellar operation, consumer integration and technical handover. The current application remains interest-submitted, invitation-pending.

## 1. Choose a buyer job that has a reason to recur

| Installation | Useful customer outcome | Source and delivery choice to settle |
| --- | --- | --- |
| Matomo report service | An agency or analytics application reviews the selected referral report and its child detail, then compares a later accepted edition without losing the report hierarchy or metric meaning. | Actual Matomo deployment, site, literal date/range, report variant, permitted segment, complete archived report population, selected metrics and the application's receiving format. |
| Coin Metrics source-edition service | A research application receives one authorized asset/metric or market-data population, explains differences between selected exports and uses the reviewed relation in its existing query or report. | Licensed transport or permitted export, exact family and identifiers, time window/frequency, all source files/pages, catalog versions, typed mapping, explicit omissions and actual downstream query. |
| Provider contract migration | An existing application moves an agreed resource from a retained old contract to a selected new provider contract while preserving deliberate identity, parameter, unit and output choices. | Original request inventory, chosen model families, reviewed parameter serialization, new authorized source and release/cutover/rollback plan. The maintained Blockworks integration supplies this release foundation. |

A later source edition, a newly completed reporting period or a changed customer decision supplies the reason to return. Agree that use with the buyer before scheduling the recurring operation. A copied delivery or another local reopen is continued use of the original result; it is not a new purchase.

The whole buyer task is named separately from the merchant's priced unit. A source report may contain parent and child tables; a query may need several paid pages; an archive may be carried in many file chunks. The workorder states whether the price buys a page, selected query result, edition or entitlement and what finishes the customer's full task. The original buyer's per-request and aggregate spending controls apply to the actual offered unit.

## 2. Start from the delivered product, with precise operating status

| Foundation | Completed original work | What that result establishes |
| --- | --- | --- |
| Matomo demo report and customer | The selected October 11, 2026 Referrers search-engine report and native keyword children retained **89 rows in 14 tables from 15 accepted responses**, including an empty child. Its typed edition records 22 observed fields. The original source-file projection carried 57 chunks through eight SF100 pages; complete Python archive receiving and reopening restored the report and source. | The processed archive, hierarchy, native values, page evidence, source-file delivery and customer reopen work together. The source is a retained internal demo input. It does not establish a customer's deployment, payment or raw-event population. |
| Coin Metrics Community reference rates | The original catalog selection produced **168 BTC ReferenceRateUSD observations at 1h frequency across three HTTP 200 pages**. The API edition and a direct lossless CSV derivation were ready; comparison matched all 168 with zero value differences, duplicate keys or invalid keys. The selected catalog window was October 5 at 01:00 UTC through October 12 at 01:00 UTC, with the end included; the first returned observation was October 5 at 02:00 UTC. | The actual returned population, complete native page chain, typed intake and API-to-CSV conversion are retained. This is a Community reference-rate result. It is not an independent licensed Cloud/API parity result or an assertion that the absent boundary row existed. The separately observed empty spot-candle selection remains separate. |
| Blockworks source refresh and native release | The original merchant retained its legacy and current descriptions, saved explicit source-refresh choices, exported the selected package, staged and compared releases, selected the candidate, obtained its unpaid challenge, stopped it, rolled back and reopened the baseline. | The original release lifecycle operates around a deliberately reviewed provider change. An unpaid challenge establishes its native challenge response, not provider authorization, acquired paid data or settlement. |

The Matomo merchant package has been exported. Its retained release/browser continuation remains unfinished. Coin Metrics' original query/merchant/handover browser stage and Blockworks' final browser/handover stage are also pending on their original operations. These boundaries are recorded with the original cases; they do not prevent a reviewer or customer from inspecting and using the completed source and receiving components.

The [Matomo source and client](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/ca6231c4538ce4f2ced960f4a661a9e6b571610d/stellar/scf-starforge-20261009/sf30-seller-sdk/matomo), [Coin Metrics workspace](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/b7d10fcc48d3d716e839e10fbc43b3d792fdf13b/stellar/scf-starforge-20261009/sf30-seller-sdk/duckdb/cloud-delivery) and [Blockworks release](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1354) retain the maintained implementation. Original customer data, credentials and native operation archives stay in their private custody.

## 3. Put the source and receiving contract in the existing workorder

The customer and implementation owner settle the following fields before the funded installation starts. This makes T1 implementation work: access integration, source/query adaptation, consumer mapping, deployed payment controls and receiving-host corrections.

| Decision | Record in the same workorder | Why it changes the implementation |
| --- | --- | --- |
| Buyer task | Named consumer, business decision, complete output and useful refresh trigger. | Determines the query, report grain, output shape and what the receiver must actually open. |
| Source authority | Source owner, actual host/account or supplied export, selected rights, allowed retention and redistribution, operator and credential references. | Determines which source may be acquired and delivered. A public development input supplies no additional customer entitlement. |
| Population | Site/report/variant/segment or family/asset/metric/market; literal period; request timezone; full selected pages, objects or partitions; native completion condition. | Determines coverage, source cost and whether an apparent missing row is meaningful. |
| Field meaning | Keys, types, units, hierarchy, time basis, null/absence treatment, tolerated differences and explained omissions. | Determines comparison, consumer mapping and corrections. |
| Merchant contract | Query/resource, exact request and result, selected release, network, asset, recipient, amount, facilitator and priced unit. | Determines the real Stellar request and aggregate cost of completing the customer task. |
| Receiving and change | Authorized receiving host, application/version, complete portable output, second operator, source-change/withdrawal and recovery case. | Determines installation fixes, support ownership, retained history and practical acceptance. |
| Commercial boundary | Original price, milestones, invoice/due dates, correction scope, additional-work process and actual effort owner. | Keeps implementation fees, merchant usage, source costs and collected cash attached to their real events. |

[Source-edition delivery fields](source-edition-delivery-fields.example.json) use SF77's existing optional `delivery.scope`, `delivery.deliverables` and `delivery.acceptanceCriteria` text fields. Merge those fields into the original owner-supplied terms. The file is not a complete terms record and supplies no invented seller, permission, price or payment identity. Each field fits the maintained 8,192-character limit.

SF77 can build the existing readable workorder from an already retained SF74 runtime handoff and those complete terms:

~~~sh
node stellar/scf-starforge-20261009/sf77-merchant-workorder/workorder.mjs \
  --handoff /absolute/private/original-case.merchant-support.json \
  --terms /absolute/private/original-owner-terms.json \
  --out /absolute/private/new-workorder-packet
~~~

This uses the original handoff and owner-entered scope. It does not perform another source request, purchase, diagnostic, invoice or external send. Record actual acceptance and commercial events through the existing case rather than treating generated acceptance text as a customer signature.

The owner-approved proposal fee is independent of an internal cost estimate. In the original SF77 packet, an unrecorded cost remains `null` and the margin remains unknown; a recorded zero remains zero. A known cost above the fee is displayed as an adverse margin and cost excess. The agreed fee, approval record and original commercial status stay intact. The arithmetic does not create an invoice, customer acceptance or a receipt of funds.

## 4. Preserve the source's meaning

### Matomo: one selected processed archive and its hierarchy

Select the actual mode: Matomo standalone/Cloud Reporting API or Matomo for WordPress REST. A WordPress installation binds the request to its own site context and uses WordPress authorization. It is not interchangeable with a standalone `idSite` plus `token_auth` request. Use the configured original connection and supported private credential references.

Discovery retains the report metadata for the same site, literal period/date, language and permitted segment. Select its actual unique report variant, including declared goal or dimension parameters. Follow its discovered child-report action and parameter identity. A child table may use another native report action. WordPress report parameters use native bracketed query fields such as `apiParameters[idGoal]`; the maintained transport preserves those names.

The source is `API.getProcessedReport`. It can fill absent/null metric slots with zero, remove undeclared fields and filter rows while constructing a processed report. Disabling metric formatting or requesting raw metrics does not turn that response into raw visits. Retain the returned report definitions and actual transformations. A field that disappears in a later report version remains an observed schema change.

Offset traversal follows actual short/empty termination for each selected table. `reportTotal` contains metric totals, not a row total. Archive caps and summary rows are a separate limit: complete traversal means the retained processed archive was traversed, not that every underlying visit or dimension was preserved by Matomo. Keep partial traversal, empty children, native summary rows and any archive truncation visible.

Use the retained report variant and full typed hierarchy path as the ordinary comparison key. A label alone can recur under several parents. Duplicates and null/absent keys remain findings. The source retains table, parent row, path, original request, row and value kinds, so a receiving analyst can open the exact originating record.

Choose the report grain before aggregation. Parent and child totals describe overlapping populations; summing both would double count them. Unique-user and ratio metrics need their native definition and denominator. The buyer receives the complete hierarchy and selects the proper grain in its application. No installation should invent a global additive metric from a displayed report label.

### Coin Metrics: complete selected files, native types and dated catalogs

Retain the transport actually used: S3, Snowflake, API export or another permitted local export. The implemented Cloud workspace takes their original files and receipts. Live Snowflake execution belongs to the maintained Snowflake source client. This commissioning workflow does not initiate requester-pays acquisition; a customer's already permitted export can be used within its documented rights.

For S3, record every actual listing page for each selected complete prefix and every selected object's original key, size, ETag and available version metadata. Filenames are opaque. The published daily job start window is not evidence that all partitions have finished. For Snowflake, retain the native statement identity, column metadata, total counts and every result partition. For an API export, retain the first request and every returned continuation URL/token through terminal completion.

Coin Metrics' four reference catalogs are overwritten daily. The workbench keeps each version actually captured; it does not reconstruct historical catalogs. Bind a data edition to the catalog versions used to interpret it. An exchange name encoded in a partition can differ from the source's native identifier. Keep both in provenance rather than silently using one as the other.

The comparison records the actual family, asset/metric or market, frequency, time bounds and boundary inclusion. API values often arrive as strings; Cloud Parquet carries native numeric types and UTC epoch nanoseconds. Choose the time unit for each side explicitly. A file-specific UTC assertion applies only to that file. Preserve original decimal spelling and precision, JSON number versus string, and missing versus null. A CSV empty cell remains a string unless that file explicitly declares its null token.

The provider's documented omissions are material. Cloud trades omit `mark_price`, `index_price`, `iv_trade` and `liquidation`; the market catalog omits the documented pool, fee, address and multiplier fields. Record a selected omission with its side, field and reason. Do not erase the raw source or use a numeric tolerance to conceal a unit, currency, scale or time mismatch.

The existing limits are part of selecting a coherent customer job: up to 4,096 files, 2 GiB per file, 8 GiB total, 32 MiB structured JSON, and 1,000,000 rows/256 columns per native relation. Agree a useful partition/window within those bounds. A limit or incomplete source population stays explicit; it does not imply that absent records were withdrawn.

## 5. Implement the operation on the original merchant and buyer

The implementation owner carries the agreed source through the existing application in this order:

1. **Install the selected maintained release on the actual host.** Bind the original private source workspace, secret references, receiving interpreter/application, authorized public route and native source identity. Retain the installed manifest separately from a source checkout's revision.
2. **Retain and inspect the selected population.** Reuse an accepted capture or continue its original cursor/attempt. Import the customer's full source, catalogs and receipts. Fix real access, format and host constraints before choosing the published dataset.
3. **Save the intended interpretation.** Select report grain or relation, explicit row keys, native types, timestamp units and deliberate omissions. Review every ambiguous key and material field difference. A correction creates a new source/mapping comparison; the earlier edition and review remain readable.
4. **Select the useful merchant operation.** Matomo joins the original SQLite workbench/publisher and SF82 release. Coin Metrics materializes the reviewed relations into the original DuckDB reader, then uses its existing query author, review, merchant plan and package preparation. Choose the exact input/result and price unit from the workorder.
5. **Connect the buyer's existing application.** Configure its original signer, payment policy, per-request/aggregate limits, facilitator and result destination. The same useful operation must be recognizable through each selected independent facilitator. Preserve any real provider-specific terms instead of assuming identical endpoints imply independent operation.
6. **Deliver and consume the complete task.** Follow the original buyer's actual continuation and payment state. Receive the complete dataset, report or file package and its source inventory. Open it in the agreed analysis/query/report workflow, with the original accounting and whole-task completion beside it.
7. **Hand over authority and change.** The second operator opens the same source, selected release and receiving result; changes or withdraws the agreed source/terms; and preserves earlier acquired output. Source edits do not rewrite a prior buyer's archive.
8. **Resolve an actual installed recovery case.** Inspect the original action, intent, transfer and delivery before continuing the unfinished step. Record the alert, acknowledgment, action taken, retained history and receiving outcome in the existing support case.

Use the original publisher and release controls for stage, diff, select, start, stop and rollback. A development challenge can be served without resolving upstream credentials that it cannot use; an admitted provider request must resolve the actual configured credentials before dispatch. The development descriptor and bound loopback listener remain explicit. Production selection requires the customer's real deployable origin and authority.

The actual Blockworks source-refresh lifecycle demonstrates the source/parameter/release part of this sequence. Its new contract required reviewed repeated-versus-comma array choices; reopening the merchant setup preserves those choices. This is the kind of customer-specific integration that belongs in the selected work package, rather than an assumption that similar provider field names mean equivalent behavior.

## 6. Native operator and receiving examples

These examples use the maintained interfaces. They are not new operation results. Replace the example IDs and revision with the current original records, settle the field choices, and keep the final request unchanged after dispatch. Do not run an example as a second copy of an already retained action.

### Carry the original workorder and its source evidence

Run the repository-relative commands below from the maintained checkout root. Use the actual original SF74 support handoff and its owner terms; the source-edition attachments remain separate evidence. The commissioning carrier calls the existing SF74 importer and SF77 builder directly. It does not fabricate a support capture, change a case's identity or interpret source-file hashes as a payment receipt.

The [attachment selection](source-edition-attachments.example.json) gives each selected original file a unique ID, descriptive role, original name, exact byte count and SHA-256. Fill those fields from its retained manifest or receiving result. File paths are local inputs; the portable inventory retains relative paths. A Matomo handover, its original receiving summary, a Coin Metrics comparison report or a licensed export can be retained as separate files. The original provider/customer receiving module remains responsible for parsing that source; the workorder carrier verifies its retained bytes.

```sh
node stellar/scf_2026/sf49_data_commissioning/source-edition-workorder.mjs prepare \
  --handoff /absolute/private/original-case.merchant-support.json \
  --terms /absolute/private/original-owner-terms.json \
  --attachments /absolute/private/selected-source-files.json \
  --id original-commissioning-operation \
  --out /absolute/private/commissioning-workorder

node stellar/scf_2026/sf49_data_commissioning/source-edition-workorder.mjs replay \
  --bundle /absolute/private/commissioning-workorder

node stellar/scf_2026/sf49_data_commissioning/source-edition-workorder.mjs receive \
  --bundle /absolute/private/commissioning-workorder \
  --out /absolute/second-operator/received-commissioning-workorder
```

The directory contains the exact original handoff and terms, the original SF77 JSON packet/HTML/checklist, the selected source attachments and an immutable inventory. The original runtime review, route/capture identity, coverage interpretation and source hashes remain in the native packet. Receiving copies the complete declared inventory and rebuilds the same packet through the original APIs; replay reports the original fee, unknown or recorded cost, readiness and commercial status.

The stable operation ID, input hashes and generation time bind a resumed preparation. Each file is published only after its exact bytes have been written and checked, and the completion manifest is published last. After a storage interruption, repeat the same `prepare` command with the same inputs and directory; retained complete files are checked and reused. A different request cannot overwrite that directory. If the source locations have moved, use the completed bundle's `replay` or `receive` command. Repeated receiving checks the existing same bundle. None of these operations calls a provider, seller or payment service.

The carrier preserves the original support-handoff limit and uses streamed copying for attachments: up to 64 files, 8 GiB per attachment and 16 GiB in total. These are carrier limits, not a promise that a provider's parser or selected source format accepts that size. Native output must reproduce exactly on replay; the result also identifies whether the three recorded SF74/SF77 entry-module digests match the current installation. A changed renderer or review result stays visible as a replay difference, so an earlier packet is not silently rewritten.

### Matomo comparison and complete customer reopen

Close any other owner of the same local workspace before using the local CLI. Read its actual state:

~~~sh
starforge matomo-source state \
  --workspace /absolute/private/original-matomo-workspace
~~~

[matomo-edition-comparison.example.json](matomo-edition-comparison.example.json) selects the original `report` and `path` comparison selectors and a native `nb_visits` field. Replace the edition IDs, observed revision and field list from the inspected editions. Its report/path key keeps hierarchy; it does not flatten the archive.

~~~sh
starforge matomo-source compare \
  --workspace /absolute/private/original-matomo-workspace \
  --input /absolute/private/reviewed-matomo-comparison.json

starforge matomo-source action \
  --workspace /absolute/private/original-matomo-workspace \
  --id commissioned-referrers-comparison-001
~~~

The second command reads the original action after completion or a lost response. A changed mapping takes a new explicit action; an unknown outcome is reconciled against the saved action.

For an already prepared complete handover, the receiving operator uses its own authorized directory and existing interpreter:

~~~sh
starforge matomo-customer receive \
  --archive /absolute/private/original-matomo-handover.zip \
  --out /absolute/private/received-matomo \
  --python /absolute/existing-python/bin/python

starforge matomo-customer reopen \
  --out /absolute/private/received-matomo \
  --python /absolute/existing-python/bin/python

starforge matomo-customer rows \
  --out /absolute/private/received-matomo \
  --python /absolute/existing-python/bin/python \
  > /absolute/private/received-report-rows.jsonl
~~~

The native receiver verifies the archive, original SF100 page chain, per-page operator evidence, source chunks and Matomo edition identity. `rows` streams original JSONL bytes with exact number/string/null/absence distinctions and source references. It does not parse all values through JavaScript.

The completed internal Matomo handover came through the original local producer and finalized SF100 scan. Its payment status remains `NOT_INFERRED_FROM_SOURCE_HTTP_OR_LOCAL_HASHES`. A customer's acquired SF88 delivery keeps its own original payment state. Complete local source receiving does not create a paid buyer attempt.

For a configured remote host, use the [existing typed client](../../scf-starforge-20261009/sf30-seller-sdk/matomo/CLIENT.md). `starforge matomo-remote tools` reads the 52 original tool declarations locally. Revision-bound calls retain their exact arguments and original workspace instance; an interrupted dispatch is reconciled through its action. Artifact transfer binds the original file identity and resumes with the maintained writer before invoking the same Python receiver. Select an installed release that includes these Matomo contributions; a source merge alone does not certify an older installed distribution.

### Coin Metrics comparison, query and portable receiving

Reopen the original workspace with its actual retained state and DuckDB 1.5.6 interpreter:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/duckdb/workspace/cli.mjs \
  --state /absolute/private/original-coinmetrics-workspace \
  --python /absolute/existing-duckdb/bin/python \
  --port 0
~~~

Use the printed original authenticated URL. In **Cloud delivery**, inspect both edition inventories and their actual relation IDs. [reference-rate-comparison.example.json](reference-rate-comparison.example.json) is the existing `POST /api/cloud/compare` body for an API/CSV reference-rate comparison. Replace its IDs and revision with the selected records. It maps `asset` as text, `time` as an explicit ISO timestamp on each side, and `ReferenceRateUSD` as an exact decimal with zero tolerances.

For a real Cloud/API pair, choose the Cloud relation's actual timestamp unit and column mapping, its licensed source/capture identity and appropriate omission decisions. The supplied API/CSV template does not prove that independent pair. The [native API](../../scf-starforge-20261009/sf30-seller-sdk/duckdb/cloud-delivery/API.md) retains full coverage and source-linked findings.

Review the comparison with an accepted or changes-requested decision and a useful note. Select the intended immutable edition/relations; handle an unsaved merchant draft before changing source. The original **Build a query → Query review → Merchant plan → Prepare → Inspect** workflow creates the useful operation. Selection compiles the complete chosen relations into one native DuckDB database, preserving source-file/row lineage.

The complete private export can include the original source files, catalogs, comparison/review history, selected source and the unchanged verified merchant package. A receiving operator opens the same Cloud workbench on its own authorized host and receives the archive through the original intake/upload/receive sequence. Source-file hashes are mandatory; archive upload may obtain its SHA from the server's streamed bytes. An interrupted upload continues its retained intake ID. The native receiver verifies every member and original record identity. It does not repeat provider acquisition, former merchant actions or a purchase.

Opening the received archive does not silently select a different merchant source. The second operator deliberately selects the received edition and query after inspecting the retained choices. Reopening an existing matching identity retains the earlier history; conflicting bytes remain a receiving error.

## 7. What the reviewer and second operator must be able to do

Acceptance is an operating outcome tied to the customer's task, not a row count alone.

| Point in delivery | Concrete demonstration on the selected customer installation |
| --- | --- |
| Source and interpretation | Open the actual source contract and full retained inventory; explain its completion boundary; follow one result to its original file/request/row; show the selected hierarchy or key/type/time mapping. |
| Useful result | Run the agreed operation and consume the whole expected output in the named application. Display any unresolved key, omission or coverage issue with its effect on that task. |
| Original payment and output | For a purchase, join the original approved request, actual transfer, native reservation and complete output. Show the parent task separately from individual pages or parts. |
| Change and recurring use | A second operator reviews a new source/terms decision, keeps the previous edition/result usable and performs the next customer-requested use. An original reopen stays attached to its earlier task. |
| Recovery and receiving | Restore the agreed retained state/files on the authorized receiving host, reconcile original unfinished work, then complete the maintainer's actual support case. Record what history the backup covered and what happened afterward. |
| Commercial completion | Retain technical acceptance, actual implementation/correction/support effort, original invoice events and received amounts in the same case. Request payment through the original authorized relationship under its agreed terms. |

Keep active engineering time separate from customer-access delays, wait time and recurring routine operation. Compare the same customer's previous integration or recovery process only when its original baseline exists. The current internal 89-row and 168-row operations provide concrete product foundations; they do not supply independent customer counts or purchased usage.

## 8. Use the existing six funded packages

| Existing package | Hours / amount | Remaining source-edition commissioning work | Receiving outcome |
| --- | --- | --- | --- |
| `T1-merchant-resource-integration` | 80 / $7,600 | Implement the chosen customer's access, source selection, hierarchy/type/query mapping, deployed merchant route and buyer application join. | Complete useful output in the named consumer on the actual host. |
| `T1-merchant-authority-handover` | 40 / $3,800 | Configure the second operator; complete the agreed source/terms change or withdrawal and the resulting installation corrections. | The receiving operator changes the original service while earlier acquired output remains usable. |
| `T2-provider-and-ledger-deployment` | 70 / $6,650 | Join the same useful operation to the selected independent facilitators, buyer ledgers and real page/result accounting. | Original requests, transfers and full customer tasks are measurable on the deployed consumer. |
| `T2-deployed-threat-response` | 50 / $4,750 | Implement customer-specific source/merchant/buyer monitoring and response; resolve interrupted settled delivery and merchant-delivery failure. | Staff recover the unfinished original step and explain the actual financial and output outcome. |
| `T3-mainnet-merchant-rollout` | 90 / $8,550 | Configure actual production network, asset/accounts, origin and receiving hosts; complete controlled cutover/rollback and useful recurring work. | Maintained mainnet installations serving the agreed repeat buyer tasks. |
| `T3-production-recovery-and-handover` | 70 / $6,650 | Complete supervision, off-host retention, rotation, restore/reconciliation and the independent maintainer's support case. | A receiving team can operate and recover the original service and its paid/source history. |

The total remains **400 hours / $38,000**, allocated 120/120/160 hours to T1/T2/T3. The existing role allocation, working-day model, cash assumptions and original award-relative days 30/90/150 remain in [SF47's current candidate](../sf47_budget_model/sf10_current_candidate.json).

The original cohort targets remain two independently operated merchants and two independent buyers, the same useful operation through two independently operated facilitators, at least ten useful testnet purchases in the selected seven-day T2 window, and at least thirty useful mainnet purchases in the selected fourteen-day T3 window with both buyers returning on another day. These are proposed application outcomes. No internal source run, archive page, tool call or team-operated reopen is added to those external targets or to the existing eighteen-payment baseline.

Assign each performed adaptation once to its original grant package or separately commissioned workorder. The grant covers future Stellar integration and deployment/receiving engineering; the existing product is the starting source. It does not pay again for completed reusable code or create a budget for subsidized source purchases or customer usage. SCF's [submission](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/submission-criteria) and [budget/deliverable](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines) guidance require the architecture at application and real development in T1.

## 9. The original Talos workshare supplies a concrete commissioning route

The original **Talos / Coin Metrics Cloud Delivery** case proposed **$9,800 over 15 business days after the agreed source and receiving inputs are ready**. Its first-contact message was sent on October 12, 2026 at 01:52:50 UTC and retained as `1a12dd0085459fa1`; the original case subsequently recorded that same sent event. The proposal is an actual commercial offer. Customer acceptance, a licensed source commitment and paid usage are not established by that sent event.

| Original workshare period | Delivered work | Customer-supplied input |
| --- | --- | --- |
| Days 1–3 | Complete authorized source intake, manifests, actual catalog versions and receipt provenance. | Selected licensed export/access, exact source population, native listing/query/page records and receiving constraints. |
| Days 4–8 | Explicit keys, types, timestamp units, tolerances and omissions; complete source-linked comparison and reviewed native query. | Permitted comparison baseline, original schema/units and accountable technical reviewer. |
| Days 9–12 | Agreed consuming workflow, full private handover and the first working session in the customer's receiving environment. | Actual consumer and authorized receiving host/operator. |
| Days 13–15 | The receiving engineer's examples, one consolidated correction pass and the handover working session. | Consolidated technical feedback and acceptance owner. |

The original milestones are **$3,920 at commencement, $3,920 at technical acceptance and $1,960 at accepted receiving**, with invoices at those events and **Net 15** payment terms. These terms remain attached to the original offer. The proposal did not supply a planned-hour allocation, so this design does not insert one into the existing 132-hour/four-provider cost group or infer collected cash.

The customer selects the actual licensed S3/Snowflake export or other permitted source and its corresponding baseline. Source licensing and provider/query/egress charges remain the customer's selected source costs; the workshare price covers the defined engineering and receiving. The Community reference-rate files are private development inputs and are excluded from the public commissioning source and prospective licensed-customer delivery.

Use the same case `talos-coinmetrics-cloud-delivery-2026`, original sender and proposed terms when progressing source readiness, scope, implementation, acceptance and collection. A human reply and further relationship correspondence stay with the original relationship owner. No second first-contact message or substitute commercial identity is part of this design. The original [workshare](https://github.com/woahwhattheheck/commons/blob/87a59f4ce7a8e6962c05af09aa7c36ca9beb7e75/tools/revenue_owner_console_20261010/case_assets/talos-coinmetrics-cloud-delivery-2026/WORKSHARE.md) and [receiving inputs](https://github.com/woahwhattheheck/commons/blob/87a59f4ce7a8e6962c05af09aa7c36ca9beb7e75/tools/revenue_owner_console_20261010/case_assets/talos-coinmetrics-cloud-delivery-2026/INPUTS_RECEIVING.md) retain its complete terms.

This is an additional qualified commissioning route, not a replacement for the existing Veridex, Nansen, CoCart, Blockscout or four-provider workshares. Select the actual participating customer and independent operator before attributing adoption. Their existing responses, prices, source rights and commercial events keep their original meaning.

## Source and example custody

| Maintained contract read for this design | Exact source |
| --- | --- |
| Matomo native comparison and selectors | `comparison.mjs` blob `bf32e91cd06ab70b93ff214a022d2259bc43b520` |
| Matomo original operator CLI | `cli.mjs` blob `ef72ee0adb471cc6013dafdf649a120698a5da57` |
| Matomo edition/source hierarchy | `editions.mjs` blob `14178b95e897a42f84408d0d3309b4e0446d5006` |
| Matomo original Python receiving | `customer.py` blob `98851d4f9106a989322f88de1a995d5832ad9b79` |
| Coin Metrics input/comparison/receiving API | `API.md` blob `cce4ebb6f9200b36c208b4873cace4265e7d8b4e` |
| SF77 owner-entered delivery fields | `README.md` blob `4060c382a9b6be4bbe87d49672c31ec4f6871df9` |
| Talos original workshare and receiving inputs | Private Commons blobs `d8401b0e6eb08aabf212da8c5e27a8aa9264545d` and `587249e4327e611500d6b6f2d827abe84b8b3244` |
| Existing grant cost and outcome model | `sf10_current_candidate.json` blob `999f01bc9df0563c94a221c1fad1fbc91ccdcdd4` |

Provider semantics are described in the original [Matomo Reporting API](https://developer.matomo.org/guides/reporting-api), [report metadata](https://developer.matomo.org/api-reference/reporting-api-metadata), [WordPress REST API](https://developer.matomo.org/api-reference/wordpress/restapi-reference) and Coin Metrics [Cloud Delivery](https://docs.coinmetrics.io/access-our-data/cloud-delivery), [S3](https://docs.coinmetrics.io/access-our-data/cloud-delivery/amazon-s3) and [API](https://docs.coinmetrics.io/api/v4/) references.

The three JSON examples in this directory are native request/delivery-field templates, parsed and checked against the source contracts above. They do not include provider captures, credentials, customer acceptance or a new executed operation. Their exact fields support the same original operator, buyer and case records.

[Application-ready source-edition contribution](SOURCE_EDITION_APPLICATION_TEXT.md) supplies the concise manuscript insertion. The canonical Canvas retains the complete application, source/commercial registers and latest operating status.
