# Open Waters receiving

Turn a saved WQX review into a complete, reusable handoff for Open Environment’s Open Waters importer. The Open Waters tab uses the same private water project as acquisition, analysis, review, and merchant delivery.

## Open the work

From `sf30-seller-sdk`, start the existing application:

```sh
node wqx-water-quality/cli.mjs serve --project /private/water-project
```

Save the intended sample review, select **Open Waters**, choose that saved review, and enter the receiving organization and project. Select an existing monitoring location or prepare a new location. Preview the complete selection before saving a plan.

Every saved plan has its own name, original review and capture identity, source records, receiving choices, and six exact downloads. Reopening a plan reproduces those files. Save a new plan name when choices change.

## Prepare the receiving fields

**Identities.** Open Waters accepts activity and monitoring-location IDs of at most 35 characters. Compact mode preserves IDs that already fit, removes hyphens from UUIDs, and derives a stable ID for other long identities. The complete original provider, organization, activity, location, and result identities remain in the crosswalk. Two different source identities that resolve to the same receiving ID are shown together for a receiving choice.

**Locations and activities.** The identity tables offer all supported native fields, including fields absent from the source. Use the reported coordinates, datum, collection method, sampling method and context. Existing-location mode records the native location lookup and exports only sample/result rows for that location. New-location mode prepares its monitoring-location row before the samples are imported.

**Repeated values.** Use field translations to apply one explicit original-value-to-receiving-value choice throughout the selection. The observed-value inventory shows the affected occurrences. Original values stay attached to the source and every changed field records its prior and receiving representations.

**Individual results.** Open a result to inspect its full source pointer, original identity, native fields, limits, and changes. Per-result choices can select a receiving value or resolve two source limits competing for one native slot. A row with an unresolved native field error stays in the complete handoff and appears in the receiving-choice inventory.

**Detection limits.** The published importer exposes method detection level, laboratory reporting level, practical quantitation limit, lower quantitation limit, and upper quantitation limit. Select an explicit receiving slot for each observed source type or retain it in the original source/comment. Every source limit keeps its type, value, unit, comment and original pointer. If different limits would occupy the same slot, the row requires an explicit choice. The native format has one unit field shared by its five limit slots.

The original USGS quarter contains six limit types and includes cases where a censoring threshold differs from another limit on the same result. These distinctions remain intact. The [USGS reporting-level definitions](https://pubs.usgs.gov/sir/2021/5031/sir20215031_app02.html) explain the separate detection and reporting conventions. Receiving choices control representation; the adapter does not replace measurements with limit values.

**Reference values and methods.** The requirements table lists native reference families, exact values, method IDs/contexts, and existing-location lookups. Paste or import the receiving installation’s exact reference catalog. Catalog JSON keys are native family names such as `ActivityType`, with arrays of accepted string codes. Match results are shown per value. Collection, preparation, analytical and laboratory-preparation methods retain their ID/context pairs for lookup in the receiving organization.

## The six receiving files

| File | Use |
| --- | --- |
| Locations TSV | New monitoring-location rows that fit the published native columns. |
| Results TSV | Locally compatible sample/result rows, including the source identity and every reported limit in the native result comment. |
| Crosswalk JSON | Complete saved plan, every selected source result, all limits, original/native identities, field changes, references, and receiving choices. |
| Receiving HTML | Offline instructions, source and plan identifiers, identity tables, reference requirements, and remaining field choices. |
| References CSV | Native reference and method inventory with exact values, contexts, occurrences, and supplied-catalog matches. |
| Complete bundle JSON | Saved plan, all five other outputs, original private review, complete native capture, original requests, and the required project revisions. |

Each download records its byte length and SHA-256. The complete bundle freezes the project context used by its original review, so later project edits preserve the saved bundle’s bytes.

## Receive in Open Waters

1. Open the receiving organization and project. Use its current monitoring-location and activity inventory when choosing whether to create or reuse records.
2. Reconcile the exact reference values and method contexts in Open Waters’ Reference Data screen.
3. For new locations, open **Import Data → Monitoring Locations** and paste the complete locations TSV, including its header. Use the standard column layout and finish the native location validation.
4. Open **Import Data → Samples / Results**, select the receiving project, and paste the complete results TSV including the header. Finish the native validation and reconcile the imported activities against the saved crosswalk.
5. Resolve further native receiving choices in the workspace, save a new plan, and retain the existing activity inventory so the same results are not imported twice.
6. Retain the complete bundle with the native import record. Its original capture and saved review can be reopened in an empty water project.

The importer matches published column aliases after trimming and uppercasing; raw internal field names are not import headers. It splits tabs and physical lines without CSV quoting. The exporter therefore writes the actual aliases, escapes line/tab separators inside comment text, and checks every rendered cell through the same parsing contract. Original source text remains in the retained capture.

The installed Open Waters database applies its reference tables, translations, characteristic defaults, and final validation. The prepared plan exposes those receiving dependencies alongside the actual files. EPA submission remains a separate action in the existing native application.

## Continue from the command line

All commands use the same application project and saved records:

```sh
node wqx-water-quality/cli.mjs open-waters \
  --project /private/water-project --review REVIEW \
  --options receiving-choices.json

node wqx-water-quality/cli.mjs open-waters \
  --project /private/water-project --review REVIEW \
  --options receiving-choices.json --id PLAN

node wqx-water-quality/cli.mjs water-export \
  --project /private/water-project --plan PLAN \
  --format bundle --out /private/PLAN-complete.json

node wqx-water-quality/cli.mjs water-receive \
  --project /private/received-project \
  --bundle /private/PLAN-complete.json
```

`water-plans` lists saved plans; `water-plans --id PLAN` reopens one. `water-export` supports `locations`, `results`, `crosswalk`, `report`, `references`, and `bundle`. The CLI preserves existing output files.

Receiving a complete bundle verifies its artifacts, original private review and capture, then rebuilds the receiving plan from the actual retained source and saved choices. A continuation uses the same bundle and plan. The browser offers the same complete-bundle import.

## Complete worked source

`examples/potomac-2025-q1.source.json` carries the original WQP response graph for USGS station `USGS-01646580`, January–March 2025. It contains 1,035 results, 13 activities, one station, and 1,112 embedded limit records. Its capture SHA-256 is `cbb29504ab01598cddb21bde33c918ca92075aad7f53fdac4fb07581371d29d7`.

`examples/potomac-2025-q1.openwaters.json` selects the original organization `USGS`, project identifier `32UFDQN00`, existing location, compact activity identities, and explicit retention of all six original limit types. Select the corresponding entries in the receiving installation. This baseline keeps the full quarter visible: its source includes 452 nondetections, eleven `standard units` labels exceeding the old receiver’s unit length, and one long coded sample-splitter label. Their exact original values and receiving controls are available together.

The single maintained journey imports the original capture, saves the complete review and plan, checks all original result and limit pointers, exports all six files, changes the later project revision, reopens the saved exports through HTTP, and receives the full bundle in an empty project. With `--browser`, the same operation drives the actual application, downloads and reopens its files, imports the complete bundle, and inspects desktop/mobile behavior.

```sh
node wqx-water-quality/openwaters-journey.mjs \
  --directory /private/open-waters-receiving \
  --source-bundle wqx-water-quality/examples/potomac-2025-q1.source.json \
  --browser
```

Use `--capture /private/original-capture` to reuse an existing complete capture. A browser runtime can be selected with `--playwright-module` and `--browser-executable`.

### Continue a prepared operation

The maintained command runs preparation, browser/receiving, and final receiving verification in serial Node processes. Preparation completes and closes its source model before Chromium starts. Its small `open-waters-native-result.json` checkpoint records the original configuration, capture/review/plan hashes, all six output lengths and hashes, and native preparation checks. Each later process consumes that exact checkpoint.

After an interrupted browser or receiver, keep the same directory:

```sh
node wqx-water-quality/openwaters-journey.mjs \
  --directory /private/open-waters-receiving --resume --browser
```

This opens the saved immutable plan and verifies its retained exports. The browser opens that plan directly, inspects the original identities, limits and receiving requirements, downloads the six files, then receives the full bundle in the operation’s existing receiving project. A saved successful browser result is reused. The final process verifies the receiving review, capture and all six regenerated receiving-file hashes.

Use `--native-only` to finish preparation and retain the completed native checkpoint for another process. A pre-checkpoint operation that already has its complete saved project and six exports can use the same `--resume` command; adoption records the actual retained file verification and preserves any original progress record.

### Move the completed receiving phase to another host

The complete bundle contains the original private review, capture graph, mapping plan and exact five companion files. Extract the delivery ZIP and give its complete JSON member to the receiving command:

```sh
node wqx-water-quality/openwaters-journey.mjs \
  --directory /private/open-waters-receiving \
  --prepared-bundle /private/delivery/receiving/potomac-quarter-open-waters-01-complete-open-waters.json \
  --resume --browser
```

The import uses the original project’s complete-bundle receiver, verifies the source and mapping identities, and copies the bundle’s exact exported members. It retains the same capture, review and plan rather than acquiring another source cohort. Supply `--options` only when those options exactly match the saved choices.

The operation retains `open-waters-native-result.json`, `open-waters-receiving-result.json`, `open-waters-result.json`, stage/error records, original exports, the receiving project, and browser downloads/screenshots. The native checkpoint remains available if a later process is interrupted.

## Published interface

The adapter’s 143-column metadata is derived from the public [Open Environment / Open Waters source](https://github.com/open-environment/open-waters), directory `OpenWaters/OpenWaters`:

| Source | Original Git blob |
| --- | --- |
| `App_Docs/ImportColumnsConfig.xml` | `6675d0a595e75fe48b6a27e23be50c4e65cc5440` |
| `Utils.cs` import header mapping | `13230edb6d2ed79ca40fb36606bd1a3b72c29cdb` |
| `WQXImport.aspx.cs` | `f185089d17b41d47ce6d2b84df4eb6d6f0c7ed1a` |
| `db_WQX.cs` validation and native insertion | `9ed998b6906b2b67f213b42e94bd1378d471298d` |

The upstream application targets Windows/IIS, .NET Framework 4.6.1 and SQL Server. The adapter runs in the existing Node water workspace and independently implements its published interoperability fields. The original C# implementation remains in the upstream repository.
