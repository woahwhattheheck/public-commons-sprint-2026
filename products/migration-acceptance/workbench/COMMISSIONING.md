# Commissioning and handover — Migration Acceptance

This is the practical handover for the [reusable technical scope guidance](WORKSHARE.md). The full source-level operator contract is [OPERATOR.md](OPERATOR.md); business-rule semantics are in [acceptance/OPERATING.md](acceptance/OPERATING.md). Keep those documents with the exact delivered source manifest.

## 1. Establish one installation and one operation owner

Record the customer project, agreed resource/table inventory, installation owner, business data owner, receiving operator and workshare owner. The primary installation owns the active workspace and original native jobs. The receiving installation adopts the complete retained history and keeps imported native bindings suspended until an explicit authorized continuation.

The receiving course uses one primary and one independent receiving installation. Record their installation IDs and platform/interpreter identities after actual installation; do not fill those fields from examples.

The browser, HTTP API and CLI use the same workspace. While its server owns the directory, use its HTTP/UI interface. Close that server before opening the same workspace through the standalone CLI. Keep original request IDs and exact request bodies whenever continuing a lost acknowledgement.

## 2. Receive the full customer input register

Deliver each file by the agreed private channel and record its original filename, byte count and SHA256. The receiving operator retains the file as a source object; corrections add a new source edition.

| Register field | Required content |
|---|---|
| Resource and table IDs | Stable resource name, target business table, business object ID and every normalized child table. |
| File identity | Filename, CSV/JSON/NDJSON format, byte count, SHA256 and owning source system/export job. |
| Population boundary | Complete/snapshot/incremental meaning, export time, filters, cursor window, row counts and exclusions. |
| Schema and mappings | Every selected business column, source/right mapping, native type hint and business comparison type. |
| Keys | Complete primary/business key, composite key order, duplicate semantics and required fields. |
| NULL and empty values | Explicit CSV NULL strings; JSON NULL convention; treatment of empty text and absent fields. |
| Numeric meaning | Integer/decimal lexical values, decimal scale, units and currencies; no mixed-unit aggregate. |
| Expected population | Independently reviewed full expected-table file, complete marker, columns, row count and hash. |
| Relationships | Parent/child objects and ordered columns, all-NULL policy, duplicate-parent treatment and required/reviewable selection. |
| Controls | Grouping columns, count or exact sum, measure column/scale, NULL policy and required/reviewable selection. |
| Ownership | Named source corrector, mapping approver, exception authority and receiving operator. |
| Scope and host | Accepted total rows/bytes, selected host resources, retention destination and delivery calendar. |

Use canonical business-column names in acceptance rules. The application resolves them through the original left/right mappings and declared types. Retain textual codes as text when leading zeros or formatting carry meaning. Supply integer and decimal expected values as lexical strings so JavaScript number conversion does not remove information.

Expected values are reviewed independently of the destination being tested. Copying a freshly loaded destination into the expected file would not establish source-to-target correctness.

For nested JSON, list every normalized business table before accepting the input plan. New unaccounted child tables keep the original completeness gate closed. The four-resource quote covers only the explicit resulting table inventory accepted for this slice.

### Copyable handover register

Fill these fields with actual selected values and receipts:

```json
{
  "customerProject": "",
  "commercialScopeEdition": "",
  "primaryInstallationId": null,
  "receivingInstallationId": null,
  "sourceManifestSha256": null,
  "runtimeId": null,
  "runtimeArchive": {"path": null, "bytes": null, "sha256": null},
  "resources": [],
  "owners": {
    "migrationLead": "",
    "businessDataOwner": "",
    "exceptionAuthority": "",
    "hostOwner": "",
    "receivingOperator": ""
  },
  "deliveryCalendar": {"phase1Start": null, "handoverTarget": null, "holds": []},
  "selectedProjectId": null,
  "selectedRevision": null,
  "nativeVerificationJobId": null,
  "comparisonId": null,
  "acceptancePlanId": null,
  "acceptanceReportId": null,
  "acceptanceDecisionId": null,
  "currentConsumerSelectionId": null,
  "namedHandoffs": [],
  "correctionRegister": [],
  "handoverAcceptedAt": null,
  "handoverAcceptedBy": null
}
```

Empty fields are unfinished selections, not successful receipts. Keep the completed register beside the exact handoff package.

## 3. Install or receive the original runtime

Select Linux, Node 24+, the pinned CPython 3.12 interpreter, Git, flock and uv. Browser commissioning additionally needs a selected existing Playwright module and Chromium executable. The operator is built on Node's own APIs; browser dependencies and the Python engine are separate runtime selections.

The source selects dlt 1.31.0 at commit `2360d229c77f7f64692acc31a4555f4cfcd50ed3` with DuckDB. The original source and lockfile determine the environment. Record the real source/package manifest and selected interpreter before installation.

From the complete product root, the maintained commands are:

```sh
node vendor/dlt/runtime/runtime.mjs install --directory /absolute/private/dlt-runtime --python /absolute/python3.12 --uv /absolute/uv
node vendor/dlt/runtime/runtime.mjs verify --directory /absolute/private/dlt-runtime
node vendor/dlt/runtime/runtime.mjs pack --directory /absolute/private/dlt-runtime --output /absolute/delivery/dlt-runtime.tar.gz
```

Reuse the same selected directory and arguments if installation is interrupted. Reconcile its original command/lock/result first. The maintained runtime holds an inherited kernel lease through verification and native children. Do not run a parallel installer or replace files under a live worker.

Before customer native work, the runtime-ready receipt must identify a ready installation and its complete portable descriptor. Keep the archive's exact bytes/hash, runtimeId, installed-manifest identity and original logs. A successful source parse is not this installation receipt.

For the independent installation:

```sh
node vendor/dlt/runtime/runtime.mjs receive --bundle /absolute/dlt-runtime.tar.gz --sha256 ORIGINAL_ARCHIVE_SHA256 --directory /absolute/received-runtime --python /absolute/matching/python3.12
node vendor/dlt/runtime/runtime.mjs verify --directory /absolute/received-runtime
```

Use the interpreter build/ABI and platform recorded by the selected runtime. Receiving rebuilds its environment offline from the complete original package; it does not relocate a copied virtual environment. The received executable paths may change while normalized runtime identity remains the same.

The host owner confirms actual available memory, disk and retained-history capacity for the complete selected inputs. The quote's volume envelope is confirmed against complete exports and handoffs before the start date. Keep runtime archives and immutable closed data separate from mutable private native generations.

## 4. Start the primary workspace

The host owner creates a private workspace and an authentication file outside the exported source tree. Assign separate operator and viewer identities using the existing authentication schema in OPERATOR.md. The viewer can inspect the retained evidence; the operator owns mutations. Customer tokens and local process credentials are not part of the portable package.

```sh
node cli.mjs serve --directory /absolute/private/customer-workspace --auth /absolute/private/auth.json --runtime-ready /absolute/private/dlt-runtime/runtime-ready.json --host 127.0.0.1 --port 8781
```

Use the printed origin and authenticate with the selected identity. Record the actual installation ID from authenticated `/api/info`. The existing host owner supplies any external TLS/proxy/identity integration; the supplied command selects a loopback listener.

Upload and retain all literal source and expected files. Compile the exact native plan, inspect all mappings and approve it with a named actor. Record the plan ID and source edition. Select the complete installed runtime before preparing a job.

## 5. Commission the customer slice through original native stages

Use the **Native runs** pane or the original action API. A typical complete initial chain is extract → normalize → load → verify. Each continuation selects the exact original closed parent job. A non-latest parent requires an explicit fork reason so later accepted history is retained.

Preparation and execution are separate actions. Record the stable request body, expected revision, selected plan, stage and parent before dispatch. Reconcile the original request after a lost acknowledgement.

Inspect the full job result and closed files after each stage. Retain failed attempts and their actual output. If an original extract or failed-job retry has an uncertain outcome, use its exact step/attempt resolution with the original evidence. Do not create a fresh request merely to repeat a possibly completed native effect.

The **Comparison** pane binds the fresh verification to the complete selected expected population. Review every business table, schema, row multiplicity and typed cell. Native pending packages, failed jobs and unmapped business tables are required holds. Record the exact comparison ID and complete observations/report identities.

## 6. Author business acceptance and review measured findings

In **Business acceptance**, select the exact compiled native plan. Author an edition containing every agreed object, key, required field, relationship and control. Save the full rule input as an immutable source, then compile that retained input.

Evaluate the selected rule edition against its own complete native comparison. The report preserves both-side findings and complete failed-row identities; the interface may display bounded examples separately.

Relationship and total handling is deliberate:

- A child with no matching parent is an orphan. Duplicate matching parents remain an ambiguity; they are not silently treated as a single parent.
- An optional composite relationship may allow all key components to be NULL. A partially NULL key is still a finding.
- Counts retain row multiplicity. Exact sums use the selected integer/decimal type and explicit scale.
- An absent group remains different from a present zero-total group.
- NULL rejection or ignoring is an explicit control choice. Empty text remains distinct from NULL.
- Acknowledgement records that the operator reviewed a finding. It does not make the measured condition pass.
- An accepted exception applies only to a finding declared reviewable by that rule edition and records the authenticated actor and reason.
- Required key, typed-parity and native-completeness failures remain blocking.

Record the full report and any complete decision edition, not merely the displayed accepted count. Decisions never overwrite measured findings.

## 7. Correct, verify and select

The workshare schedules the first correction cycle in Phase 3. For each issue, retain the report/finding ID, complete affected-row identities, source/plan edition, correction owner, proposed change and expected result.

The customer-owned source corrector supplies a new complete file edition with the correction's provenance. The migration operator retains it, compiles/reviews the appropriate new native plan, and continues from the deliberate original parent. The rule owner decides whether the rules are unchanged or requires a separately reviewed new edition.

Run the needed native stages and a **fresh explicit verify**. Recompute complete parity and business acceptance against the corrected edition. Earlier orphan, mismatch, acknowledgement and exception evidence remains in history. The confirmation cycle checks the complete agreed population, including unaffected rows.

The application permits a new retained consumer selection only for the currently approved native plan, its latest completed verification, the matching ready comparison and the current ready acceptance report/decision. Record those IDs in the handover register.

This selection controls the workbench's retained consumer view. Its API identifies the closed export and reports `liveQuery:false`. Any external production cutover remains a separate action owned by the customer's system team.

Demonstrate rollback through the original selected cutover record, then reopen the intended final retained selection. Record the actual selection IDs before and after. Imported older dlt consumer history remains visibly legacy-unreviewed until supported by its own accepted evidence; rollback to a previously accepted snapshot preserves that snapshot's provenance.

## 8. Deliver the complete named workspace

Prepare a named handoff for the accepted revision through **Delivery & history**. Keep its original request, title, selected revision, full source manifest, length and hash.

The canonical package is plain `.ndjson`. It carries the complete selected history, original request results, immutable data/source objects, native job files, runtime archive and editable product source. The format retains exact older named-package reconstruction without recursively embedding redundant new archive copies. Original gzip-v1 packages remain readable.

Download the complete named file; verify the saved length and SHA256 against the retained descriptor. Keep the complete file and its descriptor together. Browser screenshots accompany that evidence; they do not replace it.

The complete handover includes WORKSHARE.md, this document, OPERATOR.md and acceptance/OPERATING.md with the same selected editable source.

## 9. Perform independent receiving and cold reopen

The receiving operator uses a separate private installation and workspace. First close any server owning that directory, then use the same CLI:

```sh
node cli.mjs create --directory /absolute/private/receiving-workspace --request-id original_receiving_project_request --title "Customer receiving"
node cli.mjs inspect-package --directory /absolute/private/receiving-workspace --file /absolute/delivery/Complete_Application.ndjson
node cli.mjs receive --directory /absolute/private/receiving-workspace --project RECEIVING_PLACEHOLDER_ID --request-id original_receive_request --file /absolute/delivery/Complete_Application.ndjson
```

Use the actual placeholder ID returned by create. Receiving preserves the imported project's original identity and returns that ID and its disposition.

Read-only package inspection verifies original bytes, headers, history and closure. Its acceptanceValidation may say `deferred-until-retained` because the new full data objects are not yet in the receiving store. The original receiving pass retains them and completes acceptance/history validation before adopting the project. Do not treat the preview as a business acceptance decision.

On the independent installation:

1. Reopen the exact project/revision and its full original sources.
2. Inspect the complete native plan, fresh comparison and full business report/decision history.
3. Retrieve the original closed database/state files and exact older named handoff.
4. Verify the selected consumer and its acceptance provenance.
5. Retain one receiving review, prepare the returned named edition and hand it back.
6. Receive that descendant on the primary installation; confirm forward disposition.
7. Re-receive the same named edition and an older named edition; confirm that neither discards newer retained history.
8. Close the application and reopen it with the CLI. Confirm the same selected revision, named-file identities and consumer provenance.

Imported native bindings are suspended. Opening received history must not start historical native jobs automatically. Actual continuation uses the original runtime and explicit original job controls.

## 10. Reference programme and commissioning evidence

The supplied reference programme exercises the original dlt fruitshop resources with 13 customers, 3 inventory categories, 6 inventory rows and 100 purchases. The complete 122-row source population is retained. A separately labelled orphan edition changes one purchase's customer relationship; the original source stays available.

The course demonstrates required holds, acknowledgement without acceptance, deliberate reviewable exception, corrected original source, fresh verification, retained selection/rollback, operator views, complete portable runtime receiving, fresh/forward/same/older history and cold reopen.

It is the product reference course. Customer commissioning uses the customer's accepted inputs and the operator workflow above; the fixed reference driver is not a generic replacement for a customer's source or expected data.

The original reference command shape is:

```sh
node receiving/receive.mjs --source /absolute/complete-product --directory /absolute/private/definian-reference --config /absolute/complete-product/reference/programme.json --runtime-ready /absolute/private/dlt-runtime/runtime-ready.json --source-manifest /absolute/complete-product/source-manifest.json --playwright /absolute/playwright/index.mjs --chromium /absolute/chromium
```

Continue an existing accepted operation with those same selected paths and `--resume`. Reconcile any actual native owner first. A source correction must use the supplied guarded source-adoption process and preserve the original selected source/history; do not rewrite an active selection ad hoc.

The original reference native course retains its actual execution state; this public source edition does not assert completion. After execution, actual completion requires the original operation journal, source-bound `CUSTOMER_RESULT.json`, complete artifact hashes, original native receipts, confirmed owner closure and receiving results. Keep reference and customer result identities separate.

## 11. Calendar, responsibilities and final handback

Use the technical phases in WORKSHARE.md and the actual customer agreement. The migration lead records input holds and the next owner action. Review slots, dates and dependency changes belong to the original agreed plan.

At handover, the receiving operator signs the exact selected revision and artifact register. The host owner accepts access lifecycle, backups, retention destinations and ordinary runtime operation. The business owner accepts the required/reviewable policy and remaining expressly accepted exceptions. The original opportunity owner records commercial acceptance and the corresponding invoice milestone.

The implementation team follows the actual agreed handover and defect-correction terms. Each report names the original project/request/job and complete retained evidence so it can be corrected through the same history. New datasets, live connectors, production operations and future engine upgrades are scheduled as new agreed work.

The finished handback is the complete editable workspace, matching runtime, full measured and decision history, named receiving packages, actual reopening evidence and named owners able to operate the next agreed migration edition.
