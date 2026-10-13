# Housing commissioning through the existing migration workspace

Use one complete editable workspace for the selected property and tenancy population, contractor and repair registers, and rent or other explicitly selected financial reconciliations. The installed property, register and financial screens operate the same original SQLite workspace, file objects and request history. The mixed receiving programme carries all three domains through the original portable delivery.

This guide describes a local commissioning and receiving workflow. Its authored reference course is an operator example. It contains no ForHousing tenant export, appointed supplier configuration, customer approval, issued tender workbook or vendor result. Actual system actions remain with the authorised housing, contractor, scheduling and finance operators. The workbench records and compares their complete retained inputs and returned observations.

## 1. Select the original scope and operating authority

The [published ForHousing FHT028 notice](https://www.sell2wales.gov.wales/search/show/search_view.aspx?ID=OCT666359&catID=) identifies tenancy/applications, repairs, compliance/safety, rents/financials and portal/CRM. Its detailed issued pack is supplied through the advertised Delta route. Those broad requirements do not supply actual field mappings, existing system names, interface specifications or migration volumes.

[Infoshare+ Universal Adapter](https://infoshareplus.com/products/universal-adapter/) describes supported housing integration, consultant configuration, contractor workflows and diary integration. These are general product capabilities. They do not establish Infoshare+'s appointment, the customer's installed connectors, authority to write to a platform, or access to an interface.

Keep the actual issued specification, amendments, selected source inventory, supported target contracts and appointed roles in their authorised project location. Private tenant records, contact details, credentials, supplier documents and customer configuration do not belong in the public source repository. The public programme can consume those originals through its ordinary private receiving plan without embedding them in code.

Agree the complete identities and meanings before configuring the screens:

| Population | Retain separately | Authority and interpretation to record |
| --- | --- | --- |
| Property and address | Original property identity, address identity and any unit/space identity | Actual master writer; an address label alone is not a unique property key |
| Application, household and people | Application, household, person and membership identities; effective periods | Actual source for each family, permitted joint membership and confidential attributes |
| Tenancy and occupation | Tenancy agreement/episode, linked people, property, start/end, state and time convention | Customer-reviewed occupancy policy; do not import another customer's single-live-lease rule |
| Rent account and transactions | Account identity, original movement identity, signed amount, currency and posting/document dates | Actual ledger, balance/sign convention, period and separately acquired output |
| Repair and contractor work | Job, task, contractor, stage, cancellation/reopen and original event/request identity | Job completion is distinct from approval, claim submission and payment |
| Appointment | Appointment and job identity, original booking/rebooking event and effective/recorded times | Actual diary writer and returned booking/cancellation status |
| Claim and work items | Claim identity, original job, Schedule of Rates edition, item, units, amount and currency | Submitted, approved, rejected and paid are separate outcomes |
| Compliance, documents and portal references | Certificate/document identity and version, applicable property/job/person relation, original status | Retain complete originals and access/retention scope; a copied reference does not transfer authority |
| Service request, complaint and follow-up action | Original case/stage, correspondence/document and related action/job identities | A response or closed complaint is distinct from completion of its outstanding actions or repair |

Use complete ordered identity components rather than concatenating display strings. Preserve leading zeroes and the distinction between absent, null and blank. Declare date versus timestamp meaning and actual timezone. Keep financial values as exact decimal text and currency; do not combine claims with rent or treat matching grand totals as a complete reconciliation.

The property engine evaluates its selected lease interval and cardinality rules. If a housing policy permits joint occupation or overlapping legal arrangements, model the actual agreement, person membership and episode identities explicitly and select a rule that describes the intended legal population. If the supported rule cannot express the reviewed policy, retain that limitation and use the existing register findings for the unresolved population. Do not alter keys simply to hide a real overlap or call an inapplicable rule passed.

For detailed original-domain contracts, use [Register operator](REGISTER_OPERATOR.md), [Property continuity](PROPERTY_CONTINUITY.md) and [Financial reporting](FINANCIAL_REPORTING.md) alongside the actual selected housing input. Housing-specific mappings in this course are explicit operator choices, not a published vendor schema.

## 2. Receive and open the entire application

Select the full application edition declared by the housing programme. The housing profile adds the mixed receiver, authored reference generator and this guide to the complete existing application. Earlier 16-, 21-, 24-, 31-, 39-, 48- and 56-file archives retain their original selected source; receiving an older archive does not silently upgrade its code.

### Run the selected complete local course

The reference generator and mixed receiver use the existing original files and action interfaces. Run from the complete selected application directory. The authored reference entry runs the selected complete course from one original owned directory:

~~~sh
python3 -B housing_reference_example.py --directory /absolute/owned-housing-course
~~~

Keep that same directory on continuation. The generator owns its labelled original example files and the mixed receiver owns the admitted input, request IDs and output history. A new directory is a new authored example; it is not a way to retry an uncertain original operation.

The authored course retains 84 source and evidence files. `INTENT.json` freezes the complete application and actual Python identity before producer work; `producer-journal/` retains the original requests and results. `housing-input.json` and `PREPARED.json` bind the complete plan before receiving. The mixed receiver returns `receiving/COMPLETE.json`; the generator writes `COURSE-RESULT.json` with its actual final assertions and the paths and hashes of all three complete archives. Read those returned paths when opening the producer, first recipient, second recipient and final workspace. The reference exercises one selected rent period plus its opening balance; the commercial two-period commissioning scope and proposed population sizes require their own complete inputs and observed runs.

For a supplied real-input plan, use the mixed receiver's unchanged named arguments:

~~~sh
python3 -B housing_receiving.py --input /absolute/actual-housing-plan.json --out /absolute/original-housing-receiving
~~~

Do not place actual customer input into the public reference generator. Read the selected returned `COMPLETE.json` and its actual archive/recipient descriptors before opening a receiving workspace.

For an actual project, replace the authored plan with the reviewed complete operator plan and original retained files. Keep the same plan, selected application, workspace and output directory when continuing an admitted operation. The programme's original operation ID, actors and complete request payloads are part of its receiving lineage. Do not regenerate the example into an admitted operation directory or replace a retained original file.

The mixed plan's domain selection is `modules: ["register", "property", "finance"]`. It retains the original CaseReceiving `workspace`, `application`, `source_files`, `steps` and `customer_steps` contract. `customer_actor`, `second_customer_actor` and `second_customer_steps` identify the two later receiving operators and their explicit local edits. A `$result` reference names an already retained producer/customer/second-customer step and a JSON pointer; a `$file` reference names the retained source-file key and selected identity field. These references resolve to real original results. They are not vendor IDs, a second datastore or permission to dispatch a housing-system action.

Select and stage the original source and evidence files needed for **both** later recipient edits in the producer plan's `source_files`. They then travel in the complete archive with their original hashes. Do not assume a receiving operator can read a producer-only local path or fetch an undeclared future file. Every step uses its original complete request and actor; optional register `comparisons` identify exact retained before/after rehearsal results.

The reference course identifies every action by a stable logical key. Use the complete actual `actions` array and original request/returned result for the physical record ID; titles and example labels are not IDs. Its intended stages are:

| Stage | Original selected work | Operator inspection |
| --- | --- | --- |
| Producer A | Full property source/target families, contractor registers and rent opening/movement/output | Preserve initial mismatch/unknown/returned-state findings across all three surfaces |
| Producer B | Second complete source/return edition, selected corrections and later reviews | Compare retained originals at the selected cutoffs; do not overwrite A |
| First recipient C | Complete contractor rebooking/acknowledgment continuation and another full register rehearsal | Open the original job/appointment/request lineage and preserve the earlier return |
| Second recipient D | Later authored credit movement, separately retained complete output and recalculation/review | Keep signed amount/currency/period scope and the original source corrections |
| Final receiver | Entire last-edited portable delivery | Cold-open the same identity and retain every original producer and recipient record |

These are authored local course selections, not observations of customer activity. Exact final keys and results come from the admitted reference plan; the mixed programme never treats the descriptive table as a request to a supplier.

### Open the saved workspace

Use the actual workspace path returned by the selected course or ordinary portable receiver. Do not use `--create` for a received workspace:

~~~sh
python3 -B migration_server.py --workspace /absolute/original-workspace --host 127.0.0.1 --port 8083
~~~

Open the server's actual reported URL. All three screens must show the same workspace identity:

| Route | Existing controls | Work performed |
| --- | --- | --- |
| `/` → **Register migration** | Source mappings, Destination plans, Rehearsals, Finding decisions, Cutover, All records | Contractor/repair/appointment/claim populations and exact relationships/unit controls |
| `/property` | Contract, Source files, Rehearsals, Findings, Release, Records and handover | Property/tenancy contract, complete source and target editions, relationships and temporal findings |
| `/financial` | Original files, Definitions, Periods, Reconciliation, Controls, Release and receiving, All records | Explicit financial interpretation, full period calculation and independent native output |

Enter the actual recorded operator on each surface. Each page preserves its own unfinished form state for this workspace. Use one operator mutation at a time. After a change in another surface, refresh the next surface to obtain the current revision before saving. An old page revision must not be forced over a later accepted change.

A cold receiving browser reconstructs property and financial file choices from the complete retained records. Those files are initially unselected. Explicitly select the evidence needed for the next action. Opening a file or recovering its descriptor does not approve it.

## 3. Keep the full property and tenancy course

Open **Contract** in `/property`. Review the retained contract under **Contract to edit** and use **Copy selected retained contract into editor** when a later contract is genuinely required. The editor carries platforms, families and the selected lease rule into a new draft, with the original contract as its parent. Enter the actual change reference and a new review note; do not overwrite the old contract.

For each family, preserve the complete required fields, identity order, authoritative platform and every parent relation. Person membership, a tenancy agreement and a rent account should not collapse to the property ID. Review the exact active states, inclusive/exclusive end convention and missing/open-end treatment in the lease rule.

Under **Source files**:

1. Retain the complete original source or independent target file, and separately retain its extraction/mapping evidence. Choose **Source or target export**, **Extraction, schema or approval evidence**, or **Accepted inventory** as appropriate.
2. Select the exact contract and family, original file, actual CSV/JSON-array format, encoding and delimiter.
3. Record source/target role, complete/partial/unknown coverage, original system and references, capture time, effective cutoff, authoritative platform and extraction reference. Mark an independent target only when it was actually acquired separately.
4. Use **Read complete file and map columns**. The preview provides the full row count and displayed sample; saving parses the complete file. Map every contracted field to its original column.
5. Enter the acquisition and mapping review, select its original evidence, then choose **Save complete dataset edition**. A later extraction keeps its previous family dataset where appropriate.

The property/financial flat-table parser has an explicit 64 MiB per-file bound, alongside its supported row, column and field rules. Establish capacity against the actual selected schema and complete original file sizes before admission. A property edition selects exactly one dataset for each declared family; it does not accept several file partitions as a substitute for that dataset. Do not slice rows, relabel a sample as complete, or imply that multipart intake is supported. When an original population exceeds the implemented bounds, retain the complete original and use a genuinely supported, reviewed upstream transformation that preserves its complete population and identities, or expand the maintained implementation under the same work before intake.

A genuine empty property JSON table written as `[]` can retain zero rows because its explicit reviewed mapping supplies the original column names. Financial JSON-table intake discovers columns from actual rows and therefore rejects `[]`; a genuine zero-row financial export can use a complete supported CSV header with no data rows. Keep the selected source format and its original meaning, and never insert a placeholder tenant or transaction.

Under **Rehearsals**, select exactly one complete dataset for every contracted family to freeze each source and target edition, including confirmed empty families. Use the same reviewed contract and effective cutoff for each comparison. Preserve each distinct capture/extraction identity.

Choose **Reconcile all families and lease rules**, then inspect **Records and handover**. A reconciliation has both **Record comparisons** and **Rule checks**. Page/search the complete population; a matching field comparison does not waive unresolved authority, coverage, relationship or interval checks.

In **Findings**, choose the exact reconciliation and **Load every finding**. To continue a saved review, select its exact **Previous review**. All retained decisions load, and only drafts for that same parent overlay them. Record the actual owner, reason, disposition and coherent corrected assessment. Editing a reason preserves its evidence; **Attach current selected evidence** deliberately replaces that decision's evidence selection. Review all pages, not just the first twenty findings.

A corrected return is a new dataset/edition/reconciliation at the correct scope and cutoff. The later review refers to that coherent correction while the earlier mismatch remains retained. A later real capture is another rehearsal, with its own source and target editions. Replaying an older return must not replace the later tenancy or rent correction.

## 4. Use the existing contractor and repair registers

Return to `/`. In **Sources**, retain each entire register export as `inventory_csv` or `inventory_jsonl`, with its actual scope, identity namespace, capture time and coverage. Retain an independent destination observation as a distinct source record. An importer's acknowledgment and an independently observed population have different meanings.

Open **Register migration** → **Source mappings**. Select the original source ID, register name, actual system label and source/target side. Add each mapped field using its exact original CSV heading or JSON pointer. Choose the explicit type and required status; ordered positive identity positions form the logical key. Preview the full population, then save the complete immutable mapped register. Use the predecessor dataset ID for a later compatible edition.

In **Destination plans**, include every original selected register dataset. Record the actual cutoff and allowed capture age. Add:

- the authoritative destination system for each register;
- the exact fields to compare;
- complete relationship rules, such as appointment → repair job and claim item → original job/SoR edition;
- exact unit/group controls for separately selected quantities, monetary measures and currencies.

A relationship uses the complete original field tuple. A display label or an incomplete parent population cannot establish a valid link. Do not assume that a submitted job or accepted HTTP request is a completed repair, booked appointment, accepted claim or posted payment.

In **Rehearsals**, select the retained plan and the whole independently observed target dataset population. Open the complete result and use register/status/finding filters without losing the full retained count. **Inspect sources and complete checks** exposes the original source occurrences. **Compare whole rehearsals** retains the earlier and later complete items, including changed source membership. A disappeared source row is not an instruction to delete a target row.

Use **Record decision** on the original finding. The register module records one finding decision at a time; it does not use the property or financial whole-review JSON interface. Supply actual disposition, reason and supporting original row IDs. **Prepare successor decision** carries the original finding and previous decision into a later draft. Keep rework, waiting for evidence, accepted variance and withdrawn distinct.

The **Working file, drafts and request recovery** panel contains the complete local register forms, dynamic mapping/rule rows, selections and unanswered requests. **Download current working file** preserves unfinished browser work; it is distinct from the native workspace delivery. Restore it only into the same workspace identity and reconcile its retained original requests.

Use **Cutover** for the actual selected rehearsals, acceptance owner, unresolved findings and recorded cutover/recovery direction. A local held decision can travel in an editable handover. Do not manufacture a customer acceptance to complete the example.

## 5. Reconcile the financial meaning of rent and other selected accounts

Open `/financial` → **Original files**. Retain the unchanged transaction/export files, actual native report definition and independent output evidence. For every dataset choose the real company, system/version, original reference, capture time, coverage, role, measure, currency basis and reporting window.

Map the complete original transaction key, signed amount, account, currency, dates and selected dimensions. A rent account is not a contractor claim. Keep each selected measure and accounting population distinct. Blank, missing, duplicate or invalid values remain findings, not zero. Do not infer a currency or convert amounts with floating point.

Under **Definitions**, select the original native-definition files and retain the actual tool/version and interpretation: family, company, basis, measure, currency, groups, filters, sign and rounding. At least one actual retained native-definition file is required. An authored example file is labelled as an authored definition; it does not stand in for a vendor workbook.

**Copy retained definition into draft** preserves the original definition and its native files. A changed definition needs the actual approved change control and a new review note. Receiving an editable workspace does not supply that approval. Ordinary later source/output/review corrections can retain the same definition when its interpretation has not changed.

Under **Periods**, select the definition, complete transaction dataset, actual date basis and full reporting period. **Net movement** calculates the signed selected movement. **Opening balance + movement** also requires the real opening dataset for the preceding calendar day under the same company, basis, measure and currency interpretation. Historical transactions without that opening source do not prove a closing ledger balance.

After **Calculate and retain every inclusion/exclusion**, open the run under **All records**. Inspect each complete section: **rows**, **population**, **exclusions** and **issues**. The totals do not replace the original membership or reasons. Each currency remains a separate key.

Retain the independently acquired native output as a `report_output` dataset. In **Reconciliation**, select the exact expected run and actual output; explain how the native result is bound to the original definition and period, and select its execution evidence. **Reconcile every original key** compares the complete keyed output, not only the grand total.

Use **Open complete discrepancy population**, select the exact **Previous review** when continuing one, and review all pages of 25. Retained decisions, their original evidence and parent-specific drafts load together. Enter review title, actual reviewer role and whole note. **Save complete reviewed population** retains one complete decision file and all its rows. Historical inline reviews remain readable.

A resolved difference needs a coherent later complete reconciliation of that same selected key, definition, company/family and period. A different financial basis, a later unrelated period or a comment cannot substitute for the original correction. A genuinely empty complete expected/output population remains empty; unknown coverage cannot establish absence.

## 6. Keep the two rehearsals and the real cutover separate

The mixed programme retains all domain actions in one original workspace. Complete the selected first source/return course and its initial findings; retain the full correction and later review; then retain the selected second complete source/return edition. Each domain keeps its own exact source and result semantics.

Cross-domain navigation does not itself calculate an undeclared join. The register contract must explicitly include and compare each required tenancy/rent/job/claim reference, while property and financial results retain their selected identities. Include complete common source keys and evidence in the reviewed plan. Do not infer a relationship merely because two screens have similar titles.

Property **Release** and finance **Controls** record actual proposed, approved, executed, rejected or withdrawn evidence. Execution and approval are separate retained editions. Record actual owner, reference, authority and outcome. A proposed local control remains proposed until its real predecessor/authority requirements are satisfied.

Commercial scope, technical readiness, customer acceptance and a portable working-record delivery are different facts. The authored course remains held where real approvals or external operations are unavailable. A held course can still be fully exported, independently received and edited without inventing a release.

## 7. Hand over all domains, make both receiving edits, and return the final edition

Use the mixed receiver for the selected complete course. It prepares the original delivery, receives it into a separate first recipient, applies that operator's exact selected changes, prepares a second delivery, receives the result into the second recipient, applies its selected later changes, and prepares the final returned delivery for independent cold reopen.

Retain all three complete archives and their source/manifest identities. The last edited workspace must have its own downloadable archive; earlier deliveries alone do not represent the final recipient's work. The programme's actions and phase results identify the actual original request and returned record behind every logical step.

### Find the complete returned editions

Read the original `--out/COMPLETE.json` as a retained result, not as a browser acceptance. It records `schema: "commons.housing-receiving/v1"`, the operation/input/source selection, all three modules, 16 original phases, full actions, artifacts, catalogues and three delivery descriptors. Each delivery retains its original record, manifest hash and archive `path`, `bytes` and `sha256`.

The exact mixed receiver paths relative to its original `--out` are:

| Retained edition | Complete downloadable archive | Independent receiving workspace |
| --- | --- | --- |
| Producer with both selected rehearsals | `deliveries/producer/complete.zip` | `customer/workspace` |
| First recipient's later retained changes | `deliveries/customer/complete.zip` | `second-customer/workspace` |
| Second recipient's final retained changes | `deliveries/second_customer/complete.zip` | `final/workspace` |

Use the returned `locations` for actual absolute producer, customer, second-customer and final paths. The authored wrapper may choose its own original output directory; do not infer that it is the reference root itself. Read that wrapper's actual returned result to locate the mixed result.

Completion verifies the original records and files, both receiving edits, all three archives, the final independent return and cold reopen. Completed replay checks the existing copies again and preserves later valid local edits. A missing or damaged completed recipient is reported; the programme does not silently restore over it. The result intentionally retains `rendered_product.status: "NOT_VERIFIED"` and `client_ready: false`: actual important-control operation, attachment viewing and rendered inspection remain necessary.

For an ordinary manually operated handover, use **Handover & history** on `/`, **Prepare complete workspace and application** on the property page, or **Prepare complete editable delivery** on the financial page. They use the same complete portable application/workspace mechanism. Their screen-specific titles do not restrict the archive to one domain.

Download the actual archive link. Retain and inspect the manifest, full SQLite working state, original file objects, complete application source, record histories and report attachments. Use the maintained `inspect-delivery` and `receive` commands in `migration_cli.py` to open it in a separate directory. Select the returned workspace path; do not point a new receiver at the producer's directory.

The receiving operator should open all three surfaces on that same received workspace, inspect the original selected records, make only the assigned later edits, and export the entire result again. Preserve earlier mismatches, corrected assessments and review parent chains. Reopening an already received archive preserves later accepted local edits. Do not replace a progressed recipient with an earlier baseline.

Native workspace delivery contains accepted records and complete original files. A register working-file download separately contains unfinished browser forms. Property/financial session drafts and browser-local decision drafts are not assumed to travel in the native archive. Save an intended immutable review before handover, or retain its unfinished state through the original supported browser mechanism without describing it as an accepted record.

### Complete readable attachments

Open the actual exported `reports/` directory. Inspect `review.html` and the complete `register-review.html`, `property-review.html` and `financial-review.html` generated by this selected application, with their original CSV/NDJSON links and catalogues. Readable HTML is a view of retained results, not evidence that a vendor operation ran.

From each domain's record view, download both complete formats for the important selected datasets, plans/editions, calculations/rehearsals, reconciliations and reviews. Property and financial exports include explicit section tags where applicable. For finance runs, retain population/exclusions/issues as well as aggregated rows. For register results, retain full original finding detail and source occurrences. Open the files, not just their links.

## 8. Recover the original request without replacing later work

When a response is lost, keep the original workspace, actor, operation ID, expected revision, complete request and output directory. First inspect the retained operation. A successful result is reused; an unanswered transport call is not grounds to create another business request.

Property and financial pages retain the pending request before dispatch. **Inspect result** or **Inspect original result** exposes its native status. Retry only the exact original unadmitted request. **Continue original operation** continues its retained interrupted operation. Return to a corrected draft is available only for a genuinely unadmitted request or the module's explicit no-output local validation disposition; the original request/error remains retained. Unknown, active and post-commit results stay on their original recovery path.

For the mixed programme, a step may predeclare an explicit `resume_reason`, and the original plan may predeclare `delivery_resume_reason`, using the supported same-command recovery route. Do not add or change either field in an already admitted plan; when it was not predeclared, use the existing CLI to resume the original operation and retain that control result. Failed or stale resume-control requests remain retained. A subsequent control still targets the original action, never the earlier control request. Preserve the original plan semantics and admission identity while using these documented continuation fields.

For register requests, use the existing working-file recovery panel. Preserve a conflicting tab's complete working file and original saved revision rather than force-overwriting it. For a mixed programme interruption, use the exact original admitted input and its documented resume route. Do not submit new IDs to advance around an uncertain original result.

A changed schema, runtime or source edition is a distinct source selection. Do not change the code underneath an admitted course without the maintained receiving mechanism's explicit source handling. Native source review, a completed local course and a customer acceptance are separate results.

## 9. Operate and LOOK at the outgoing product before presenting it

The repository's owner-directed rendered-product instruction applies to this guide, the reference course and every receiving/delegated operator. Source review and programme completion do not establish that the outgoing user experience has been seen.

Run/open the exact outgoing application and inspect it as its operator will use it. At the intended desktop/screenshare width and a relevant narrow/mobile width:

- Open all three populated surfaces, confirm the same workspace identity, inspect long original IDs and substantial tables, and use the actual filters/paging.
- Exercise original file selection and complete mapping preview, retained review loading, a permitted later correction, parent-specific unfinished text and reload, and the displayed original request recovery controls.
- Observe loading, genuine empty and meaningful rejected-input states without manufacturing or deleting tenant records.
- Download and open every outgoing attachment. View actual HTML reports, relevant PDF/workbook pages, original files and archive contents in their normal recipient-facing applications.
- Receive the complete returned archive, cold-reopen the editable workspace, and confirm later accepted changes remain available on all three surfaces.
- Capture useful actual screenshots and LOOK at those images or the live rendered result. Capturing without viewing is insufficient.

Fix clipping, overflow, broken controls, unreadable tables and unclear error/recovery states directly within the authorised implementation. Keep the industrial design plain and readable. Do not replace this work with a dashboard, a receipt product, an approval queue or broad repeated tests.

The full public source is a reusable implementation. The current handoff must separately state its exact source edition, whether the selected native course actually executed, which real screens and attachments were viewed, and any precise remaining user-facing gap. No browser, native, vendor or customer-ready outcome is inferred from this guide or from another worker's source review.
