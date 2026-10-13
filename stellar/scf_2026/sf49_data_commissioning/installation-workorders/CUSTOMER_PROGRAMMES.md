# Query.Farm and air-quality customer programmes

These programmes turn an original commercial Workshare into a useful operating installation through the existing Grant Operations product. Choose `queryfarm` for a complete acquired result with retained SQL use, or `ars-air-quality` for a complete reviewed client reporting edition. The existing `cocart` and `blockscout` profiles continue unchanged.

The profiles supply the whole customer task and operating sequence. The actual case supplies its source attachments, agreement, deployment identities, payment authority, receiving host and accountable operators. Keep those selections together in the original case.

## Choose a whole useful task

| Programme | Complete customer output | A later useful task | Repeated use of the original task |
| --- | --- | --- | --- |
| Query.Farm | Complete typed result edition, retained acquisition, working VGI catalog entry and the customer's actual SQL result | Explicit selection of a changed source edition or separately requested discrete computation | Catalog discovery/binding, SQL scans, caching, reconnects and reopening the acquired edition |
| ARS reporting | Reviewed client report for the selected network/period, complete CSV/JSON/HTML and manifests, retained original source/review/report | Next agreed report period or a deliberate linked correction that changes the client's useful output | Downloading another format, paging through retained observations or reopening the same report |
| ARS daily review, when separately selected in the original case | Complete newly available daily population, source-quality review, named status and actionable review output | The next real daily population and its completed review | Rereading the same measurements, refreshing a screen or repeating the same review export |
| CoCart | The selected customer's useful native checkout/order and fulfilled digital purchase | Another useful shopper order | Recovery or reopening of the existing cart/order/payment |

For a paid task, retain each actual merchant-priced acquisition and the complete useful output. If the real provider charges for several requests needed to finish a task, retain those purchases and their common task association. Row count, page count and file formats describe the task's data; the native purchase records describe its payments.

## Query.Farm: result acquisition through retained SQL use

Choose one customer, source/worker and useful query or computation. Record the complete intended source population before acquiring it. A table name, preview query or sample with LIMIT does not establish that all required rows arrived.

The source contract records field meanings, integer/decimal precision, timestamp and timezone, units, missing values, parameters, source edition, completeness and permitted use. When the original scope includes refresh, select two real editions and keep both available for the receiving work.

Use the customer's actual installed VGI catalog and worker. Choose streaming when the access policy must constrain rows or columns in the service. Direct-file delivery must give the customer permission to the whole delivered file. Retain actual component/source licenses with the installation.

The operating sequence is:

1. Select the useful result, complete population, original source edition and explicit purchase terms.
2. Acquire through the original merchant/buyer operation, retaining its payment/result identity and complete source manifest.
3. Bind the retained result in the existing VGI catalog and execute the customer's actual DuckDB/Arrow work.
4. Deliver the useful SQL/computation output with its original acquired-edition reference.
5. Reconnect, scan, cache and reopen using the retained acquisition and original service state.
6. When selected, acquire the next real edition explicitly and explain its meaningful change.
7. Export and independently receive the complete installation, retained result and operating configuration.

The public Query.Farm VGI material describes queries as a poor billing unit and notes that metering/billing is not included in VGI. This integration therefore keeps the explicit acquisition in the original merchant flow. A fresh SQL connection or cache miss must not silently initiate another paid acquisition.

Primary product references:

- [Query.Farm data as a service](https://query.farm/vgi/data-as-a-service/)
- [VGI product and demonstrations](https://query.farm/vgi/)
- [VGI catalog operation](https://query.farm/vgi/docs/python/how-to/catalogs/)
- [Maintained Stellar Forge VGI service](../../../scf-starforge-20261009/sf88-operator-buyer-cli/python/stellar_forge_buyer/vgi_service/README.md)

Public demonstration endpoints illustrate the product. Select the actual customer's permitted source for a commercial installation.

## ARS: source intake through client reporting and correction

The default profile follows a monthly client reporting task. Bind one authorized network, one selected CSV/REST intake, the reporting period and its timezone, the original reporting/DataView entry, and the named reviewer who selects preliminary or final treatment.

Preserve parameter and sensor identity, units, local and UTC timestamps, quality flags, missingness and source corrections. Receive the full agreed source population. Every page required to complete that population belongs to the same intake, with its own original provider/request record where applicable.

Deliver the report with its complete CSV, JSON, HTML and manifests. The receiving client should be able to identify the network, reporting period, source edition and review status from the deliverable itself. Preserve the original capture, review, report and delivery identities when reopening it.

ARS describes hourly collection and daily review for its Wyoming work, together with monthly preliminary and quarterly/annual validated reporting. A useful daily review programme can therefore be proposed as a separate selected task. Preserve the original monthly scope until the actual case selects the daily population, reviewer output and cadence.

A daily selection must state:

| Selection | Required concrete meaning |
| --- | --- |
| Source window | Actual network/sensors, local reporting day, timezone and equivalent UTC bounds |
| Source availability | Expected arrival time and how late/missing observations are represented |
| Complete output | Reviewed population and a useful reviewer output identifying status, exceptions and resulting action |
| Review owner | The actual accountable air-quality reviewer |
| Repeat trigger | The next real source window and a completed useful review |
| Paid unit | The selected merchant's actual complete review acquisition or constituent priced requests |
| Correction | Linked changed edition, reason, previous delivery retained and client release decision |

The customer controls review and publication. When using the installed merchant release console, continue the selected original reviewed study into its staged dataset release and then its actual activation, run, stop, rollback and client delivery. A staged package retains its own status until the release operator activates it.

Primary sources and maintained operation:

- [ARS air-quality data services](https://www.air-resource.com/ars-air-quality/air-quality-data/)
- [ARS Wyoming data-management programme](https://www.air-resource.com/data-management-for-the-wyoming-department-of-environmental-quality/)
- [ARS DataView product](https://www.air-resource.com/dataview-product-release/)
- [Maintained OpenAQ product](../../../../products/openaq/README.md)
- [OpenAQ operating guide](../../../scf-starforge-20261009/sf30-seller-sdk/openaq/OPERATING.md)

The maintained public OpenAQ worked study supplies a reproducible source/intake/reporting example. The actual customer installation binds its authorized source, review rules and reporting population.

## Prepare a first Installation from its original seed

Use the [complete installation-workorders guide](README.md) to obtain a fresh native `installation-workshare-seed` from the existing case and the complete attached commissioning source/packet. The returned envelope retains the actual case version, plan digests, original commercial source, assignments and acceptance criteria.

Choose the profile and operator-owned output paths:

~~~sh
CUSTOMER_PROFILE=queryfarm
CUSTOMER_OUTPUT="$PRIVATE_OUTPUT/queryfarm-programme"

starforge grant-installation-workorder template \
  --profile "$CUSTOMER_PROFILE" \
  --seed "$PRIVATE_OUTPUT/original-seed.json" \
  --out "$CUSTOMER_OUTPUT/bindings"

starforge grant-installation-workorder prepare \
  --profile "$CUSTOMER_PROFILE" \
  --seed "$PRIVATE_OUTPUT/original-seed.json" \
  --bindings "$CUSTOMER_OUTPUT/bindings/bindings.json" \
  --out "$CUSTOMER_OUTPUT/prepared"
~~~

Between template and prepare, complete the actual selections in `bindings.json`. For ARS use `CUSTOMER_PROFILE=ars-air-quality` and that customer's own seed and private output directory. Direct source use is `node prepare.mjs` with the same arguments.

Bind the actual source reference and authority; original merchant and independent buyer deployment IDs; exact atomic price, approved task budget and payment terms; private receiving host, named engineer and actual source/application attachments. Blank template values retain profile guidance and remain visible as selections to complete.

Load `installation-input.json` into the original **Customer installations** desk, preview it against the current case, save the same Installation and export its complete handover. A changed case/version requires a fresh seed. The native preview resolves the actual source/deployment/payment references.

## Continue an Installation that already exists

The one-operation receiver accepts `queryfarm` and `ars-air-quality` in each customer's `profile` field. Retain the original receiving input schema `stellar-forge.installation-workshare-receiving.v1`, stable request prefix, Workshare case, canonical plan digest, original source files and their exact hashes.

For a first Installation, the receiver composes the selected profile with the original seed. For an existing Installation, it refreshes the same commercial source and preserves the saved task, payment, deployments, receiving fields, stage and observations. Supply deliberate task or receiving changes in that customer's explicit `bindings` object.

The profile's complete steps and input list remain available in the generated workorder. Choosing a profile alone does not replace a saved customer's task. For example, a daily-review selection belongs in the existing ARS customer's explicit task bindings after that scope is selected; its original monthly reporting terms remain in the Workshare.

Use the established receiver with the current original case and plan:

~~~sh
starforge grant-installation-receive \
  --operations-cli "$SCF_MODEL_ROOT/workspace/cli.py" \
  --workspace "$SCF_WORKSPACE" --case "$SCF_CASE" --plan "$SCF_PLAN" \
  --inputs "$CUSTOMER_FILES/RECEIVING.json" \
  --source-root "$CUSTOMER_FILES" --out "$CUSTOMER_OUTPUT" \
  --receiving-workspace "$SCF_RECEIVING_WORKSPACE" \
  --actor "$SCF_ACTOR" --receiving-actor "$SCF_RECEIVING_ACTOR"
~~~

The receiver attaches complete matching sources, reads current versions, previews and saves original Installation identities, exports the complete case once, imports it into the distinct receiving workspace, and reopens every selected original Installation. Retain that complete result with the actual source-to-output work.

## Schedule recurring use from the real source cadence

Use the existing Cohort Planning operation to select actual participants, merchants, service windows, useful tasks and payment units. Keep commercial commissioning fees and funded engineering costs in their original records.

Two buyers each purchasing one useful task on ten weekdays produce twenty task purchases. The current thirty-purchase, fourteen-calendar-day programme requires a genuinely supported additional source of useful work: a third participating buyer, applicable weekend tasks, or additional distinct tasks with their actual source and customer purpose. Choose the operating case's real option and let the existing planner carry its selected calendar.

Monthly reporting alone supplies no basis for daily report purchases. A separately selected daily review task can provide a daily cadence when the source and reviewer produce that complete useful output. A Query.Farm daily edition can provide daily use when that source actually publishes a useful changed edition. CoCart can supply useful new shopper orders under its selected customer agreement.

For each programme, record the original buyer/merchant, intended source window or edition, useful output, priced acquisition, actual settlement time, completed receiving time, and return on another UTC day. Use the original native operation to record completion and the application criteria to evaluate the current cohort.

## Receiving handover

The complete handover includes the original Workshare and technical Installation; source/worker application and license selections; actual private configuration references; retained complete data/result/report and their source identities; original payment and customer-delivery state; the named operator's useful receiving output; and ownership for source publication, review, release, correction, rollback and support.

The four maintained JSON profiles and this guide travel with the existing `installation-workorders` distribution component. The preparation and receiving commands continue through the original native schema, preview, save, export and import operations.

## Resume an interrupted customer programme receiving operation

Keep the same receiving input, request prefix, original and receiving workspace paths, actor, and private output directory. Run the same `grant-installation-receive` command again. The receiver retains the exact input document and complete selected source bytes; once those copies exist, continuation can use them if the original input/source files are unavailable. A present original file must still match its retained identity.

Before calling the native Installation save, the receiver saves the exact command arguments, reviewed preview, document and workorder under `installation-attempts/`. A lost response is recovered with the same original request ID and unchanged arguments. The original SF47 transaction returns its saved receipt before evaluating a newer case version. The receiver then reopens the receipt's exact Installation ID and revision and verifies its document and hash. It does not resave that old programme over a later editor revision.

An earlier receiver output without an attempt record can also continue. Its complete retained seed, input, bindings and workorder must match one committed native history event: the original case/plan, Workshare, actor, note, expected version, preview hash and deterministic request ID. The receiver reuses that same request and checks the returned original receipt. Missing or ambiguous source, a changed request fingerprint, or a different saved edition stops that continuation without creating a replacement identity.

If the original native compare-and-save definitively refused an unaccepted attempt, the receiver retains that refusal and reads the current edition before a new preview. The existing three-way merge applies programme changes against their original base and preserves independent saved fields and rows. Conflicting changes still require an explicit resolution in the original Installation editor; a new-draft change is never rebound to an arbitrary saved Installation.

A completed per-customer selection is retained before moving to the next customer. Restarting keeps that accepted historical revision even when the live Installation has advanced. The complete native case export includes the current case, every saved Installation edition, and all selected source attachments. Receiving verifies the chosen original editions and programme reports after native import; later history remains available in the original editor. Keep `receiving-export.json`, `RECEIVED.json`, `installation-attempts/`, and the complete source/workorder files with the handover. Deliberately new work uses a separately selected receiving input and output directory instead of rewriting a completed operation.
