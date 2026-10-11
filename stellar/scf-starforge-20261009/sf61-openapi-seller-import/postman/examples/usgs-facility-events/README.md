# A facility event service from a Postman collection

This customer example takes public earthquake requests through the existing
Postman merchant importer and turns the delivered GeoJSON into a facility watch
report. The complete input collection, public environment, source decisions,
customer request map, original plan preparation and reporting application are
included. It is a useful starting product for a facilities operator with several
sites and a regular incident review process.

The commercial service is merchant integration, managed API delivery and
facility-specific reporting. USGS supplies the original public API and data.
The operator sets the merchant price, delivery terms and its own site procedure.

## Open the customer result

Open **historical-report.html**. It was produced by the included report engine
from **historical-response.json**, the actual public USGS catalog response
for the Napa-area window on August 24–25, 2014. The retained event is
`nc72282711`; its current source magnitude is 6.02. All three illustrative sites
fall within their 100 km threshold: Napa 9.421 km, San Francisco 49.846 km and
Sacramento 82.102 km. The input response keeps the source event, geometry,
provider generation time and last update. The source URL is inside its metadata.

The three site labels are examples near city centers. Replace them with the
customer's authorized coordinates and thresholds before preparing its report.
The report calculates epicentral distance. Radius and magnitude identify events
for review; the customer's operating procedure determines any site action.

To produce new JSON, CSV and HTML from that same retained input, run from a
complete source checkout with Node 22+:

~~~sh
EXAMPLE_DIR=stellar/scf-starforge-20261009/sf61-openapi-seller-import/postman/examples/usgs-facility-events

node "$EXAMPLE_DIR/report.mjs" \
  --events "$EXAMPLE_DIR/historical-response.json" \
  --facilities "$EXAMPLE_DIR/facilities.example.json" \
  --out /absolute/private/napa-facility-report
~~~

The output directory must be new and its parent must exist. It contains
`report.json`, `facility-events.csv` and `report.html`. A completed report is
self-contained. The command uses only supplied files; it can process a retained
paid response repeatedly without another purchase. Interrupted output retains
an `INCOMPLETE` marker, so an operator can create a fresh report from the same
inputs. No installed package beyond the repository's existing Node runtime is
needed.

## The original collection and exact selection

| Collection pointer | Public service request | Customer purpose |
| --- | --- | --- |
| `/item/0/item/0` | `GET /fdsnws/event/1/query` | Events within an explicit UTC time window, magnitude floor and geographic rectangle |
| `/item/0/item/1` | `GET /fdsnws/event/1/count` | Matching event inventory, using the same filters without the search limit |
| `/item/1/item/0` | `GET /earthquakes/feed/v1.0/summary/2.5_day.geojson` | Routine watch feed covering the past day, magnitude 2.5 and higher |

All requests use the public `https://earthquake.usgs.gov` origin and declare
`noauth`. They contain no cookies, scripts, saved response examples, credentials
or backend headers. **decisions.json** explicitly selects structured URL fields
and JSON responses. **public.environment.json** makes the historical window,
region and result limit easy to inspect and change.

The collection is original Commons-authored source built from the
[USGS catalog contract](https://earthquake.usgs.gov/fdsnws/event/1/) and
[USGS GeoJSON contract](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php).
It uses the published Postman v2.1 format and keeps nested request pointers.
Source references and attribution are retained in **sources.json**.

USGS recommends its real-time feeds for routine automated displays. Use the
catalog endpoints for a defined historical or investigative window. Catalog
queries support at most 20,000 returned events. The count request has the same
filters but no result limit; compare it with the delivered search result. For
larger windows, split the time range and deduplicate repeated event IDs. Both
time boundaries are inclusive. The reporter accepts several retained responses
and applies the newest event update for each ID.

## Prepare the original merchant plan

Create the retained source packet and editable plan through the original
Postman CLI:

~~~sh
node "$EXAMPLE_DIR/prepare-example.mjs" /absolute/private/usgs-onboarding
~~~

This performs the original source inspection, creates a private directory, and
writes the normal **source.json** and **merchant-plan.json**. Operation IDs,
query samples and the plan schema come from the unchanged importer.

Open source.json in the maintained API merchant workspace, or edit the generated
merchant-plan.json directly. Fill these existing fields:

| Plan field | Operator input |
| --- | --- |
| `sellerServer` | The actual public HTTPS address of this merchant |
| `serviceName` | The customer-facing service name |
| `payment.network` | The intended Stellar network; generated plans start on testnet |
| `payment.asset` | The actual asset contract used by the existing payment flow |
| `payment.payTo` | The merchant's actual payment recipient |
| `operations[].amountAtomic` | Exact per-operation atomic prices as strings |
| `operations[].headerEnv` | Already empty for these public noauth requests |

The editable fields start empty where commercial terms are required. Prices,
accounts and deployments belong to the selected operator configuration.
The original compiler checks the finished plan.

To save the compiled merchant using the existing command:

~~~sh
starforge openapi postman merchant \
  --source /absolute/private/usgs-onboarding/source.json \
  --plan /absolute/private/usgs-onboarding/merchant-plan.json \
  --out-parent /absolute/private/merchant-projects \
  --name facility-event-service
~~~

Use an existing private project parent. Source-checkout users can invoke
`node stellar/scf-starforge-20261009/sf61-openapi-seller-import/postman/cli.mjs`
with the same `merchant` arguments.

The saved package's **RUN.md** supplies its actual seller and operations
commands. Its normal source, plan, request cases, bindings and upstream
configuration enter the original [retained release
workflow](../../../../sf82-seller-pilot/README.md). Reopen the same project in the
[merchant workspace](../../README.md) to inspect its retained collection,
environment and decisions.

For a new customer region or historical period, change the public environment
values, inspect the resolved requests, and create a new reviewed packet. Keep
the existing completed package as its previous configuration.

## Deliver a request and save the response

**customer-requests.json** lists the exact public method, resource path and
sample query values for each selected operation. Use the saved merchant's actual
origin, keeping those paths. This map is a customer input aid; original saved
offers provide the actual payment requirements.

Use the existing [operator buyer](../../../../sf88-operator-buyer-cli/README.md)
to discover the seller's offers, prepare the desired request, and review the
concrete URL and terms. Keep the original intent ID, budget, signer and evidence
settings. Set `captureBody` to false when using its response-file writer.

With an already prepared buyer configuration, the maintained commands are:

~~~sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --review --config /absolute/private/buyer.json \
  --response-out /absolute/private/downloads/events.geojson

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --execute --config /absolute/private/buyer.json \
  --response-out /absolute/private/downloads/events.geojson
~~~

The existing buyer retains its terminal review, payment operation, response
status and file identity. For a completed GeoJSON response, run:

~~~sh
node "$EXAMPLE_DIR/report.mjs" \
  --events /absolute/private/downloads/events.geojson \
  --facilities /absolute/private/customer-facilities.json \
  --out /absolute/private/customer-watch-report
~~~

The count endpoint returns inventory metadata. Feed its result into the
operator's completeness review, and pass only the search or real-time
FeatureCollection into the report command.

## A repeatable customer operation

1. Agree the customer's sites, contact for operational handover, geographic
   coverage, magnitude floors, report schedule and expected service price.
   Keep actual facility coordinates in the customer's private input.
2. Set and review the original merchant terms, save the package, and use its
   existing release and customer request controls.
3. For routine watch work, select the past-day feed. For a historical case,
   choose explicit UTC dates and compare count with retrieved events.
4. Save the actual returned resource with the original buyer writer. Keep each
   successful response file for later report reproduction.
5. Run the report with the customer's facilities. Deliver the HTML for reading,
   CSV for their operations sheet and JSON for their application.
6. Inspect the source-window table and source issues. The output preserves
   provider generation, event time and last update. An empty match list applies
   to those supplied windows and thresholds.
7. Reopen the original merchant project for plan changes. Recompute a report
   from saved bytes whenever the customer changes its sites or thresholds.

A report accepts 1–16 GeoJSON files, up to 100,000 received event rows and 500
facilities, with a maximum of 10,000 matching facility/event rows across the
whole report. This keeps the HTML document and accompanying JSON/CSV exports
manageable. Matching computes distance before copying a result. When the total
match limit is reached, the command gives an explicit split-sites/time-windows
message before allocating another row. Use the same retained response files for
those separate reports; narrowing an intended radius or magnitude threshold is
also an explicit operator choice.
Each site requires a stable ID, name, latitude, longitude, radius in kilometers
and minimum magnitude. Longitude is read before latitude in USGS geometry.
The reporter keeps the newest `properties.updated` for each event ID, excludes
conflicting rows that have the same newest update, and lists source issues.
Events missing magnitude and non-earthquake event types are counted separately.
Matching uses unrounded great-circle distance, then rounds display kilometers
to three decimals. CSV text cells are escaped for spreadsheet import.

## Source and license

The collection, reporter and guide use the included MIT license.
**historical-response.json** was retrieved from the USGS public API; the
provider response retains its own source and event attribution. USGS explains
its public-domain data policy and separately marked third-party material in
[Copyrights and Credits](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits).
Credit: U.S. Geological Survey.

The importer and merchant interfaces used for this package were read at
`b1f2930be38eeb69d2b4d1db783ba7f656e495e8` in the original public sprint repository.
The example adds customer inputs and a downstream report while using those
maintained source, merchant, release and buyer interfaces.
