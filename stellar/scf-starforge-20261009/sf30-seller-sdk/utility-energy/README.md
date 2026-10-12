# Utility data receiving and customer workspace

This application receives complete Green Button Atom/ESPI exports and UtilityAPI JSON in the existing retained NDJSON/XML workspace. It joins interval selection, source corrections, coverage, billing reconciliation, native query editions, the original publisher, and full customer receiving in one private operator.

## Open the operator

Run these commands from an installed Starforge distribution:

    starforge utility-energy --workspace /absolute/private/utility-workspace init
    starforge utility-energy --workspace /absolute/private/utility-workspace serve --connection-file /absolute/private/utility.url

Open the private local URL printed by the process. The source version can also be launched with Node on cli.mjs or Python on cli.py. Python 3.11+ and Expat 2.6+ provide the existing XML parser. Node 22 executes the original SF30 dataset engine and publisher. SF30_UTILITY_PYTHON and SF30_XML_NODE select existing runtimes.

The clean browser console provides Sources, Interval review, Dataset and editions, Bill reconciliation, Customer delivery, Publisher and Operations. The CLI operates the same database and files. utility-client.mjs attaches customer or agent code to the same running operator through its private connection file.

## Original source intake

Receive an exported file:

    starforge utility-energy --workspace /absolute/private/utility-workspace import --file meter.xml --provider greenbutton
    starforge utility-energy --workspace /absolute/private/utility-workspace import --file intervals.json --provider utilityapi --kind intervals

Green Button input uses the Atom and ESPI namespaces. Resource identity comes from the original self link or Atom ID. Declared relationships connect UsagePoint, MeterReading, ReadingType and LocalTimeParameters. Each original interval reading, quality value, source cost and billing summary remains associated with the exact source XML and resource position. Unknown fields remain in the retained original document and complete resource record.

UtilityAPI intake supports complete meter, bill and interval objects, arrays and complete collection responses. Opaque UIDs remain strings. Numeric lexemes and missing/null/value states remain available alongside exact decimal normalization. All complete resource objects are retained in normalized sources.

Standalone published or exported blocks use explicit kinds such as reading-block, meter-base-block, bill-base-block, bill-line-item, bill-supplier-block, bill-tier-block, bill-tou-block, bill-demand-block and bill-power-block. These records preserve their original structure and typed interpretation. They enter the resource inventory without fabricated meter or object UIDs.

### Collect every authorized provider page

Use an existing UtilityAPI authorization and its selected meter UIDs. Place its token in the named environment variable on the operating host. Supply a configuration file with name, meter_ids, token_env, collections, and optional start/end instants with explicit UTC offsets.

    starforge utility-energy --workspace /absolute/private/utility-workspace collect --configuration capture.json

The collector requests allow_mixed=true, follows original next URLs, and retains every original body and receipt. Provider limit counts interval containers. HTTP 202, 429 and temporary server responses retain the pending operation and Retry-After time. HTTP 200 is_incomplete remains an explicit provider result. The browser offers pause and continuation; the CLI can resume with collect --capture CAPTURE_ID. Tokens stay in the operating process environment.

Official contracts: https://utilityapi.com/docs/api/intervals/list and https://help.utilityapi.com/what-does-mixed-interval-data-mean.

## Interval review

A selection includes its source import IDs, optional meter-series IDs, display zone, exclusive time window, source priority, explicit correction choices, exclusions with reasons, and whole-interval overlap policy. Review records bind the exact source identities and complete analysis.

Equivalent source readings are grouped under one logical meter/channel/period and keep all source row references. A differing value, unit, quality, cost, reading type or local-time definition requires a source choice. Source priority resolves explicitly selected editions; row choices take precedence. Choosing shorter or longer overlapping intervals preserves complete original intervals and reports the resulting gaps.

The report includes source durations, UTC coverage, overlapping intervals, gaps, local daily totals, boundary rows, quality distribution, raw units, scaled quantities and observed energy. A local day can have 23 or 25 hours. The original ESPI LocalTimeParameters rule controls the source-local display; an explicit IANA display zone is also available.

Green Button interval energy uses the original unit, power-of-ten multiplier, ReadingType kind and accumulation behavior. For example, delta energy in Wh is scaled into kWh. Power and demand remain different quantities. UtilityAPI forward, reverse, net, generation and maximum-demand channels remain separate. Forward minus reverse is checked against a supplied aggregate net channel using exact decimal arithmetic.

The reviewed-energy-profile.csv export contains whole original energy intervals, with separate meter/channel series, UTC inclusive start, exclusive end, duration in seconds and kWh. Mixed durations and gaps remain visible in profile-contract.json. This is useful around the existing Energy Toolbase utility integration and its CSV/XML receiving workflow; the recipient selects its intended meter/channel and maps the documented columns.

## Native query editions and bill reconciliation

Build a saved review through the original NDJSON/SF30 engine. The dataset has an explicit logical interval key, declared meter/channel/unit filters, start/end ranges and deterministic native paging. Source values, scaled values, quality, provenance and original time strings remain inspectable.

    starforge utility-energy --workspace /absolute/private/utility-workspace build --review REVIEW_ID
    starforge utility-energy --workspace /absolute/private/utility-workspace query --build BUILD_ID --params '{"limit":"100","sort":"start_utc"}'

The last accepted query and native snapshot are retained. Native continuation cursors stay bound to their original query. Edition comparison uses exact projected cells; review metadata is stored outside the projected rows so saving a new review alone does not mark every reading changed.

Bill reconciliation uses exclusive billing period ends and whole contained intervals. It reports observed and billed energy, gaps, overlaps, edge intervals and the chosen channel. An ambiguous bill can be mapped explicitly from bill row ID to meter-series ID. Supplier, TOU, tier, power and demand blocks remain distinct from parent line items. A provider charge total and its line items can represent different concepts, so both source quantities remain visible.

## Full customer delivery and reopen

Build the selected review, then create its delivery:

    starforge utility-energy --workspace /absolute/private/utility-workspace export --review REVIEW_ID --out /absolute/private/utility-customer-delivery.zip

The delivery contains the original native CSV/config, original native project packet, all reviewed inputs, full normalized resources, source and mapping lineage, review decision, billing reconciliations, source contracts, the optional reviewed energy profile, and utility-workspace.zip.

Receive that inner utility-workspace.zip in a new operator:

    starforge utility-energy --workspace /absolute/private/received-utility init
    starforge utility-energy --workspace /absolute/private/received-utility restore --file utility-workspace.zip
    starforge utility-energy --workspace /absolute/private/received-utility serve

Receiving reconstructs the original source inventory, native mappings/builds/snapshots and edition comparisons. It restores utility originals, exact review records, capture receipts, reconciliation and completed operation history. The same source workflow then continues from its retained revision history.

## Original publisher and customer client

Configure merchant terms through the Publisher tab or merchant --terms terms.json. Terms contain payment, origin and path using the original seller contract. Create the complete delivery after configuring those terms to include seller.json, OpenAPI and the generated customer SDK.

Publisher prepares that exact delivery through the original Socrata dataset publisher, SF82 sourceFiles, versioned dataset, draft review, release and customer engines. Its operation controls use the existing optimistic revision and release-generation fields. Closing the utility operator drains the owned source and publisher processes. Live publisher releases remain owned by their publisher workspace; portable source receiving retains source/review history and merchant configuration.

## Original operating example

fixtures/test_usage_data.xml and fixtures/test_usage_data_01.xml are unchanged Green Button Alliance reference sources. The full file contains 1,340 readings, including a daylight-saving transition; the single-day source contains 96 readings that overlap it. The Apache 2.0 notice and original comments are retained.

contracts/utilityapi-examples.json holds the original published provider blocks and two complete meter-state examples with exact source locations. contracts/source-contracts.json records source repository commits and schema editions.

Run operate-example.py --out /absolute/private/utility-operation to receive those full original sources, save the complete interval reviews, build/query the original native dataset, reconcile bills, compare the overlapping source edition, export a full customer package, restore it into a fresh workspace, and query the restored native snapshot. The operating output records the actual source counts and results.

The shared foundation lives in ../ndjson, ../xml, ../dataset-handler.mjs, ../socrata/publisher.mjs and ../clinicaltrials/publisher-bridge.mjs. This contribution adds a utility workflow while retaining those original engines and their existing ownership.
