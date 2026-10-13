# DataRunner recurring reporting: complete customer commissioning

This programme puts an existing SQL report into a customer-owned reporting operation. The useful result is the agreed complete report, delivered to its actual audience on its business calendar, with a receiving operator able to continue it. The consultancy keeps its data model, upstream transformations and chosen BI presentation.

The maintained profile is **datarunner-reporting.json**. The Installation catalogue discovers it directly. Use the original customer Workshare, original operating case and the current installed source; record the actual customer, source and payment selections when preparing the native document.

## 1. Select the complete reporting job

Begin with the business decision the report supports. Record the current report, its intended reader, what changes between periods, and the present cost of preparing or delivering it. Select one complete useful output whose query and transformation ownership are clear. A table read by another system, an Excel workbook reviewed by a person, and a daily exception alert have different delivery and empty-result requirements.

The customer and consultancy settle the following together in the existing workshare:

| Selection | Complete value to retain |
| --- | --- |
| Customer and owner | Actual company, account owner, original case and commissioning payer |
| Report and decision | Original report name, reader, business question and useful output |
| Database | Actual engine, connection, deployment, permitted hosting and source-use authority |
| Query | Saved query ID and version, complete SQL, source scope and upstream transformation owner |
| Period | Actual start/end parameter rules, timezone and reporting calendar |
| Output | Whole CSV, XLSX, PDF, inline report or approved existing destination update |
| Recurrence | Customer-selected due periods and reason a new result is useful |
| Operation | Named schedule operator, recipient owner, failure route and support window |
| Receiving | Named independent operator, full source-workspace export and receiving location |
| Commercial terms | Original implementation fee, ongoing service, subscription and source-purchase terms |

The workshare contains the actual scope, effort, timeline, correction allowance and handover. This maintained profile supplies the technical programme; its preparation preserves the original commercial fields and every original acceptance phase.

## 2. Use the existing product and account

DataRunner documents a customer console, saved connections and queries, schedules, report formats and delivery history. Its connection table distinguishes engines that can run SQL from connections that only check availability. PostgreSQL, SQL Server and Redshift are documented query paths; their actual authentication and network arrangement still come from the selected deployment. Read the current [connection contract](https://www.datarunner.app/en/docs/connections) when choosing the database.

Use the customer's original workspace. Confirm its plan and ownership before choosing an automation route. The [official CLI documentation](https://www.datarunner.app/en/docs/cli) places API keys and command-line access on Team and higher plans. Console commissioning remains the original entry for an account without that feature.

The retained operating package identifies the selected release and key-scope names from the installed client and current account. Credentials stay in the customer's normal secret store. Record its reference and owner in the private workshare, along with rotation and removal responsibility.

| Existing component | Role in this programme |
| --- | --- |
| Customer database | Supplies the approved source, under its original database owner |
| Consultancy SQL and transformations | Define the complete report and its business meaning |
| DataRunner console | Owns the saved report, schedule, recipients and operational history |
| Official DataRunner CLI | Runs an existing query or sync when the selected account and installation support it |
| Existing source workspace | Retains complete source/result editions, review and independent receiving |
| Original SF30 seller and buyer | Handle a separately selected paid-source publication/acquisition |
| Existing SF47 Installation | Joins customer scope, task, source, payment, implementation and acceptance |

## 3. Commission the original connection and query

In the selected workspace, open the actual saved connection or create the customer-approved connection through its existing console. Use the provider's connection check and retain the specific result. Confirm the source engine really supports querying and the customer permits the selected hosted connection.

Open the complete SQL and its saved version. Retain its effective connection, parameters and reporting window. DataRunner's [query contract](https://www.datarunner.app/en/docs/queries) describes parameter binding, version history and result ceilings. The operator reviews the actual completed output before its schedule is activated.

Make the following meanings explicit:

- Stable identifiers and SQL aliases, including any source key used to compare later editions.
- Exact integer and decimal representation; preserve large numeric text when converting to another engine would change its value.
- Unit, currency, timestamp type, source timezone and report timezone.
- NULL, empty string, absent value and any published masking rule.
- Inclusive and exclusive period bounds, late-arriving records and the rule for correcting a closed period.
- Upstream transformations retained in Python, the warehouse or another existing model.

For an aggregate report, the complete result is the full output of its approved aggregation. Preserve that definition. A downstream delivery component does not recreate underlying records that the query never returned.

Run the original selected report. Review the full row and column count, completion state, source freshness, error information and expected output. A provider result ceiling is an implementation constraint to resolve in the original query or output design. Keep the agreed report complete when selecting a larger account limit, an approved set of partitioned periods or the existing large-data source workspace.

## 4. Configure and receive the actual delivery

Choose the format for the user's next action. DataRunner's [report documentation](https://www.datarunner.app/en/docs/reports) describes CSV, Excel, PDF and inline HTML. Its current destination documentation distinguishes report attachments from summary-only routes. Use the selected channel's own setup page and actual account configuration.

Retain the original report, destination and recipient selections. Contacts and lists can resolve differently on a later send; the operator records the actual intended audience and uses the customer's recipient-change process.

First perform the channel's configuration check, then execute the complete report and inspect the real run and route outcomes. Open the delivered attachment or destination update. Compare it with the complete selected result, including row count, fields, period, formatting and source meaning. A configuration probe answers whether a route can respond; the completed report supplies the actual customer output.

For a webhook, the [generic webhook channel](https://www.datarunner.app/en/docs/channel-webhook) specifies public HTTPS delivery, optional signing and a JSON body carrying the report. Receive the actual envelope from the configured product. Validate a configured signature over the original body bytes, retain that body, and use the real run and route identity to handle redelivery. The existing destination must be able to distinguish a test event from a report and preserve an already completed route on a retry.

The provider's separate [outbound event documentation](https://www.datarunner.app/en/docs/api) describes lifecycle events. A run-success notification is a different input from a report attachment. Select the actual route according to whether the receiving application needs the result itself or a notification about it.

## 5. Save the customer's reporting calendar

A useful recurrence comes from the business requirement: a weekday operations report, a weekly client update, an end-of-month statement, or a source change that matters to a named reader. Preserve the current working schedule when it already provides the required result. Commission a new schedule for the selected maintenance or delivery gap.

DataRunner's [schedule documentation](https://www.datarunner.app/en/docs/schedules) assigns timezone to each schedule. Enter the selected timezone explicitly, including its daylight-saving behavior. Record how the customer handles holidays, missed periods, late data and closing a reporting period.

| Calendar decision | Operating rule |
| --- | --- |
| Due time | Named local time and explicit timezone for the actual report |
| Due days | Customer-selected calendar, such as weekdays or a named weekly period |
| Source cutoff | Parameter boundaries and source-freshness requirement |
| Missed period | Original operator decides whether to recover that period or advance |
| Empty result | Apply the report's agreed informational or suppression behavior |
| Threshold | Agreed value or row threshold and its actual escalation recipient |
| Source delay | Preserve the previous output and indicate the incomplete current period |
| Query correction | Keep both versions, changed period and reviewed successor |
| Withdrawal | Change the actual schedule and record the customer's request in the original case |

The source provider's example calendar syntax is reviewed against the installed schedule editor before saving. Keep the accepted expression and its displayed next-run preview together. An operator compares the preview with the intended local dates and times, including a daylight-saving boundary when that timezone uses one.

After the baseline, operate a genuinely due later reporting period. Compare the complete result and source/query context, review the actual delivery, and record the operator time required. This establishes whether the component actually removes repetitive work for that customer.

## 6. Retain complete editions through the maintained source path

Keep the original result bytes and its complete run context before a conversion or publication. The handover includes the selected query/version, parameters, source period, full result, actual run record and destination outcome.

For CSV results, the original SF30 loader provides the maintained inspection and optional seller path:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-cli.mjs --dataset "$DATASET_CONFIG"
```

The dataset configuration selects the actual retained file, dataset name, complete reviewed columns and optional filtering/sorting. Use schema **stellar-forge.csv-dataset.v1** and the exact current loader contract.

The selected SF30 source accepts one to 64 exposed columns, explicit string/integer/number/boolean types and nullable decisions. It supports **empty** and **unquoted-empty** CSV null encodings. Keep the original bytes; select the mode that matches the export's actual NULL and quoted-empty behavior. SQL aliases must satisfy the maintained column-name rules. When a report exceeds this representation, use the existing source/SQL workspace that can carry its full shape or agree the source query's intended complete output. Preserve its original field mapping and customer scope.

A full-result inspection confirms the loader's row count and immutable snapshot before publication. The operator checks those against the original report, including the original query's completion state. Loading a CSV does not establish that an upstream exporter returned every requested record; the original run and agreed query population supply that part of the receiving.

If a customer-approved dataset is intended for paid distribution, use the original seller generator with the source owner's actual public payment terms:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-cli.mjs \
  --dataset "$DATASET_CONFIG" --payment "$PAYMENT_TERMS" \
  --origin "$PUBLIC_ORIGIN" --path /data --out "$SELLER_CONFIG"
```

The maintained seller and original buyer then own publication, request preparation, authority, acquisition and delivered result. Retain source rights and masking decisions before exposing an output. The same original source workspace owns its complete edition history and independent export/receive operation.

## 7. Use the official CLI from its actual selected release

The provider publishes an installer and a version-pinning option. Receive the official installation instructions and its published checksum in the actual operating environment. Record the installed version and relevant command help as part of the private handover; run under the customer's normal user account and selected credential profile.

Use the original listing to find a real saved query ID. Machine output is selected explicitly:

```sh
datarunner query list
datarunner query run "$QUERY_ID" --format csv
```

Retain the completed command's status and full result. The documented default output is a human-readable table, so a downstream CSV path needs the format selection. Query execution and result delivery remain different operations; use the original report's actual route history to establish that a recipient received its output.

Where the selected existing operation is a sync, the current provider [pipeline/sync contract](https://www.datarunner.app/en/docs/pipelines) supplies its own destination and history. The receiving operator waits for that original sync's actual completion and opens the resulting destination. Its current source definition, masking and schedule remain part of the customer-owned product.

The CLI and API documentation use different spellings for some scope labels. Retain the actual labels exposed by the selected account and installed client when creating a key. Use the published product's current browsable API for any route-specific automation and keep its complete request/response contract with that selected version.

The current primary reference links API documentation under **https://api.datarunner.app/docs** and OpenAPI under **https://api.datarunner.app/openapi/v1.json**. An independent direct retrieval of the latter on 12 October 2026 returned HTTP404. The console, official CLI and complete exported-result route provide the documented commissioning path; an API-specific integration takes its exact fields from the running account's current reference when that route is selected.

## 8. Prepare the original Installation document

Use the current installed profile catalogue and the original complete Workshare seed. The file paths below are the maintained drivers.

```sh
node stellar/scf_2026/sf49_data_commissioning/installation-workorders/prepare.mjs profiles

node stellar/scf_2026/sf49_data_commissioning/installation-workorders/prepare.mjs template \
  --profile datarunner-reporting --seed "$ORIGINAL_SEED" --out "$BINDING_DIRECTORY"
```

The native template returns **bindings.json** with the original source selection. Fill the actual customer source reference and authority, account/report/run/source IDs, accountable merchant and buyer deployments when used, approved payment terms and whole-task budget, and named receiving host/operator. Preserve the original customer Workshare identity and the complete selected case/plan.

For the recurring task, use the actual report name and business period in the task fields. Record the difference between the baseline, later due period and a correction. Keep the selected source and run history attached to the existing case. Where the original workflow is already an operated Installation, continue its current draft and revision through the original application; the preparation driver consumes a fresh planned seed.

```sh
node stellar/scf_2026/sf49_data_commissioning/installation-workorders/prepare.mjs prepare \
  --profile datarunner-reporting --seed "$ORIGINAL_SEED" \
  --bindings "$SELECTED_BINDINGS" --out "$PREPARED_DIRECTORY"
```

The driver produces the complete native installation input and preview input, **WORKORDER.md**, and source-bound preparation record. Its merge preserves the original workorder, funding/commercial assignments, acceptance checks, Workshare phase bindings, workflow periods and coordination fields.

Receive and save that document through the existing native Installation application and its current case version. The maintained **receive.mjs** and source-preparation flow use the same installed profile catalogue. The original receiving owner supplies the actual source attachments and current case selection, then executes the complete source attach, Workshare seed, preview/save, whole-case export and independent receive operation.

## 9. Carry source change, failure and correction to completion

A report may fail at connection, query, rendering or destination delivery. Read the original run and route history first and act at that failed stage. Keep its source query and period, complete available output and earlier route outcomes together.

If a query ran successfully but a destination failed, recover through the original product's delivery path and use the existing retained result. If the source was wrong, preserve that edition and the complete corrected source/query, review the changed values and affected period, and deliver the agreed successor. Record who accepted the correction and what ongoing change was applied to the original schedule.

For a webhook redelivery, the receiving service keeps the original raw-body verification and real run/route deduplication. For a manual result download, recover the same result. For a customer request to produce a genuinely new report period, use the selected calendar and original authority. Each activity remains linked to the report whose business purpose it serves.

The operator can find and act on the following from the original history:

| Question | Source to read |
| --- | --- |
| Which query produced this value? | Original saved query/version and effective parameters |
| Which business period is covered? | Source window, timezone and accepted period definition |
| Was the result complete? | Actual run completion, row/column count, export and approved population |
| Which audience was selected? | Actual destination/recipient resolution for that run |
| Which route received it? | Original per-route outcome and complete destination output |
| What changed? | Full predecessor/successor result and source/query review |
| What should happen after interruption? | Original run, existing delivery outcome and retained workspace |
| Who operates the next period? | Named operator and selected customer calendar |

## 10. Independently hand over the whole operation

The commissioning package includes every required source and customer output, the actual configuration definitions, the complete SQL and current transformation handover, retained report history and the original source workspace. Configuration exports carry references to credentials held in their existing store.

The receiving operator opens the complete report and its history, reads the selected calendar and timezone, locates the real source/query definition, receives the whole workspace into the selected independent location, and opens the agreed files or destination output. The operator then completes an agreed report continuation through the original application, including the actual failure or correction procedure selected for handover.

The customer receives the usable reporting operation with named responsibilities:

| Owner | Handover responsibility |
| --- | --- |
| Customer account owner | Workspace, plan, account access and subscription |
| Database administrator | Approved connection, network and source access |
| Consultancy maintainer | SQL, models, transformations and changed business requirements |
| Reporting operator | Schedule, actual run review and due-period continuation |
| Destination owner | Recipient lists, channel configuration and downstream receiving |
| Source payer | Separately approved source budget and original buyer authority |
| Receiving engineer | Full handover import, reopened result and operated continuation |

Keep the agreed support hours and reporting calendar realistic for the customer's work. Use observed preparation and exception effort to price ongoing operation. A new source, report, destination or support obligation goes through the original workshare's change process.

## 11. Commercial and grant use

Commissioning, a software subscription, ongoing reporting support and paid source acquisitions remain separately priced activities. Retain the actual customer agreement and payer for each. Record implementation effort under its selected commercial or grant-funded assignment and preserve the original prospective package budget.

The recurring report supplies a practical reason for a customer to return: it supports the next business period or a meaningful changed source. Its useful task identity follows that purpose. The original merchant/buyer record supplies any corresponding paid-source purchase and completed useful output; receiving the same file, retrying delivery or reading saved SQL does not create another period.

Use measured outcomes: operator minutes required per due report, time until the intended audience can use it, complete periods delivered, changed-source corrections and whether the customer returns for a later due period. The application receives those actual results through the same operating case when the selected programme runs.

## Maintained source and provider references

Implementation pins used to author this programme:

| Path | Original Git blob |
| --- | --- |
| installation-workorders/prepare-core.mjs | e23a23ad1a68fc826ca6282a8582434b0ce3ec92 |
| installation-workorders/profiles.mjs | 45e01e96fcd797c075553282d8daa701ad11e48b |
| sf30-seller-sdk/dataset-cli.mjs | 95ed4f2db87385e6d8d8fd0d83f5ac566d93519b |
| sf30-seller-sdk/dataset-handler.mjs | 8da9ef8bddbc560aabe1a74f59c258e29f18d5a9 |

The profile's **sourceFiles** contains the complete repository paths. Its eight implementation stages and complete input list are consumed by the maintained preparation engine.

Primary provider references checked 12 October 2026: [getting started](https://www.datarunner.app/en/docs/getting-started), [connections](https://www.datarunner.app/en/docs/connections), [queries](https://www.datarunner.app/en/docs/queries), [schedules](https://www.datarunner.app/en/docs/schedules), [reports](https://www.datarunner.app/en/docs/reports), [channels](https://www.datarunner.app/en/docs/channels), [generic webhook](https://www.datarunner.app/en/docs/channel-webhook), [CLI](https://www.datarunner.app/en/docs/cli), [API and events](https://www.datarunner.app/en/docs/api), and [pipelines and syncs](https://www.datarunner.app/en/docs/pipelines).


## 12. Installed reporting project and complete recipient handover

The [reporting-programme product](../../../../products/source-tables/reporting/REPORTING_PROGRAMMES.md) now joins this same installation programme to the maintained Source Tables engine. Build the `reporting-programmes` selection, then open `starforge reporting-programme serve --port 8787` for the complete installed browser or use `apply`, `receive-desk`, `inspect` and `export` with complete original request files. Its create/define operations retain the full SQL, parameter template and calendar; run receives actual provider/query identity, resolved period/parameters, source snapshot and full CSV output; delivery retains the original route receipt or observed failure/uncertainty. The Reporting Programmes workbench uses those same original operations, retains unfinished work and exact pending requests, and opens or exports the complete native project. The original Source Tables workbench on the same local listener supplies typed field review, reasoned corrections, retained comparisons and native merchant receiving. Its complete returned project reopens in Reporting Programmes with the original reporting history retained.

Retain the original complete programme JSON and exported native ZIP in this same commissioning case. The ZIP includes all SQL/result/receipt files, original request bodies, earlier source editions and the complete editable project. Continue later due periods on that project; identical result bytes can recur without losing their separate period and parameter records. A configured provider schedule remains the actual execution authority. The full product guide carries the opening commands, recipient return contract and current owner instruction for observing the exact outgoing app and attachments.
