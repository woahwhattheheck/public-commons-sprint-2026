# APM2 capacity and cost planner

Use this complete no-build application to compare measured observability scenarios and produce an editable capacity/economics handover. It extends the original APM2 response-engineering workshare for Shared Services Canada solicitation BPM026762/35133. All estate measurements and supplier prices begin empty.

## Open and operate

Open **APM2 capacity planner** in the CanadaBuys procurement navigation. The existing local service serves the planner at /apm2-capacity/. The planner is independent of the saved procurement database; its editable project is a complete JSON file.

For standalone use, keep index.html, planner.css, model.js and planner.js together and open index.html in a browser. No build, package installation, network connection or supplier account is required. The same files can be served by an existing static web server.

1. Name the project and preserve its original notice reference.
2. Name a scenario, identify its owner, measurement window, selected pipeline and scope.
3. Include each relevant signal explicitly. Enter average and peak inputs separately. Blank is missing; an explicit zero remains zero.
4. Record the basis, original source and observation date/window for every input. Use measured, assumption or supplier to make its status clear.
5. Read Capacity to inspect calculations and missing inputs. Partially complete signals show an available subtotal and leave the complete total missing.
6. Enter costs, currency and period. Set a forecast horizon and explicit billable days/hours per month when daily/hourly lines are present.
7. Duplicate a scenario to compare an alternative while retaining its original inputs. Update the copy's assumptions and sources.
8. Save JSON. Open it in another browser to recover every scenario, value, provenance record, cost line and collector decision. Invalid files leave the open project unchanged.
9. Export the readable HTML report. It includes every scenario, input, calculation, missing value, cost period and source. Open the report and print it to PDF if needed.

Browser storage is a local working copy. The JSON download is the portable deliverable. An unreadable prior browser copy pauses autosave until the operator deliberately opens another file or starts a new project. Changing origins, clearing storage or using another browser does not move a working copy.

## Definitions and equations

All units are decimal: GB = 1,000,000,000 bytes; MB = 1,000,000 bytes; Mbit = 1,000,000 bits. Average rates cover all 86,400 seconds of the day. Convert an operating-hours-only measurement to a whole-day average and record the conversion.

| Quantity | Equation |
| --- | --- |
| Generated trace spans/s | Requests/s × mean spans/request |
| Generated metric observations/s | Active series ÷ collection interval seconds |
| Generated log events/s | Events/s |
| Retained items/s | Generated rate × signal retained fraction |
| Exported ingest bytes/s | Retained items/s × mean exported bytes/item |
| Average ingest GB/day | Average exported bytes/s × 86,400 ÷ 1e9 |
| Wire transfer GB/day | Average ingest GB/day × measured wire/exported-byte ratio |
| Peak wire Mbit/s | Peak exported bytes/s × measured wire/exported-byte ratio × 8 ÷ 1e6 |
| Steady-state storage GB | Average ingest GB/day × retention days × measured stored/ingested-byte ratio |
| Outage queue GB | Peak exported bytes/s × outage seconds × measured queue/exported-byte ratio ÷ 1e9 |

Trace fractions represent the selected span sampling policy. Metric fractions represent actual observation filtering, with aggregation and cardinality effects recorded separately. Log fractions represent actual event filtering. Each signal has separate average/peak fractions and retention. Enter 1 explicitly when all items are retained.

Mean exported bytes/item belongs to the selected representation. The transport ratio includes measured encoding/compression/overhead. The storage ratio should state whether indexes, replicas and compression are included. The queue ratio describes serialization or memory representation at the queue being planned. Record where filtering occurs: a buffer before sampling may need a ratio measured against the corresponding pre-filter volume. These ratios are not interchangeable.

An explicit zero does not conceal another missing input. Zero events/s with unknown bytes/event leaves the byte calculation missing until its assumptions are complete. Excluding a signal explicitly removes it from totals.

Summed peak rates assume coincident peaks. Record the joint-peak interpretation in scenario scope. Steady-state storage is an estimate; startup ramps, tiering, changing rates and age-dependent compression need separate scenarios or documented additional analysis.

## Cost model

Every line has category, description, amount, currency, period or one-time status, original quote/measurement and notes. Categories cover platform, infrastructure, support, engineering and other entered costs.

Native subtotals group exact decimal amounts by **currency and period**. Up to six decimal places are retained using integer arithmetic. Missing amounts keep a group's total missing while showing the entered subtotal. An empty register is missing, not a zero-price solution.

The separate approximate forecast uses the selected scenario currency:

- Monthly amounts stay monthly.
- Annual amounts divide by 12.
- Daily amounts multiply by explicit billable days/month.
- Hourly amounts multiply by explicit billable hours/month.
- One-time amounts are added once.
- Horizon = monthly equivalent × entered horizon months + entered one-time costs.

Currencies are never converted or combined. Other-currency lines remain in native totals and are counted as excluded from the selected-currency forecast. Taxes, discounts, tiered charges and unentered costs are not implied; enter agreed amounts explicitly. Normalized forecasts use floating-point arithmetic. Exact original amounts remain in JSON and native totals.

Compare compatible currencies and identical horizons. No supplier prices, estate volumes or internal proposal costs are prefilled.

## Collector decision record

Record configuration/versions/processors, workload and duration, CPU/memory, queues, rejected or dropped telemetry, export latency, throughput, backend limits and the resulting capacity decision. Stateful processing and routing may constrain horizontal scaling. This planner does not derive replicas from a universal throughput constant.

Review these primary references against the selected version and deployment:

- [OpenTelemetry Collector scaling](https://opentelemetry.io/docs/collector/scaling/)
- [Dynatrace Collector scaling](https://docs.dynatrace.com/docs/ingest-from/opentelemetry/collector/scaling)
- [Dynatrace OTLP ingestion](https://docs.dynatrace.com/docs/ingest-from/opentelemetry/otlp-api)
- [CanadaBuys data dictionary and support](https://donnees-data.tpsgc-pwgsc.gc.ca/ba2/ac-cb/soutien-support-eng.html)

Technical source review: 13 October 2026.

## Reuse and receiving

model.js has no dependencies or DOM access. It exposes CapacityModel in the browser and module.exports in Node. Public functions:

- blankProject(), blankScenario(name)
- validateProject(project), parseProject(json), serializeProject(project)
- calculateSignal(name, signal), calculateScenario(scenario), calculateCosts(scenario)
- reportHTML(project)
- SIGNALS, OUTPUTS and SOURCES metadata

Receiving schema: **tjlabs.apm2.capacity.v1**. A project contains 1–100 scenarios, selected ID, metadata, complete signal definitions and provenance, cost lines and collector decisions. Numeric measurements are finite nonnegative numbers or null. Intervals and horizons must be positive when present. Fractions are 0–1. Currency is a three-letter uppercase code. Amounts are canonical decimal strings or null.

Imports validate before replacing current state. Results recalculate from saved inputs. Reports escape authored values and link only the built-in primary references. Entered telemetry/cost data is not posted to the procurement database or an external service.

routes.mjs serves a fixed five-asset allowlist through the original loopback service and retains its host/origin checks. The planner policy loads only its own scripts and styles and prevents outgoing connections. Its UI uses an industrial monochrome layout and native accessible form controls.

Cost completeness is dependency-specific: an unknown one-time item leaves the horizon incomplete while preserving a known monthly recurring total. A scenario with no selected-currency cost lines has no selected-currency forecast, even when another currency has entered amounts. Numeric overflow is reported explicitly as a missing result.
