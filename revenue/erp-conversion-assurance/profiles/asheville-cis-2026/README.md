# Asheville utility conversion operator

A private, local application for preparing utility/CIS conversion work: original account and meter intake, parallel billing, predecessor comparison, reviewed corrections, payment reconciliation, customer actions, field handoffs and complete restoration.

The application extends the existing ERP Conversion Assurance operator and its original reconciliation worker. It includes an industrial browser interface, a native command line launcher and an editable private workspace. No application package installation or hosted build is required.

## Start

Read [INSTALL.md](INSTALL.md), then run from the extracted source root:

~~~bash
node revenue/erp-conversion-assurance/profiles/asheville-cis-2026/cli.mjs serve --directory /absolute/private/utility-workspace
~~~

Open the complete local URL printed by the launcher. Its private fragment grants access to that local session. The application binds to 127.0.0.1.

[OPERATOR.md](OPERATOR.md) follows a complete working project. [NATIVE_FORMATS.md](NATIVE_FORMATS.md) describes the exact provider mappings and source distinctions.

## Complete working scope

| Area | Delivered workflow |
| --- | --- |
| Source intake | Retain original CSV, JSON and GeoJSON bytes; inspect and map observed columns; preserve identifiers as text; correct rows into new versions; search and export any retained version. |
| Customer service | Separate account, location, service and meter identities; retain customer preferences, contact details and emergency indicators; schedule stop, start or transfer with a distinct successor service. |
| Parallel billing | Up to 5,000 selected accounts; monthly and bimonthly periods; meter replacement history; register or interval consumption; actual final reads; explicit rounding, proration and tariff interpretation. |
| Comparison and acceptance | Run the original reconciliation worker against the exact retained predecessor export; retain failed and corrected runs; review the original report; adopt the selected candidate into the local migration ledger. |
| Native provider files | Five MuniBilling source dictionaries, six published positional PDF mappings and three separately observed CSV headers; exact identifiers, six-place meter values and reversible direct-field corrections. |
| Handheld meters | SmartFusion EZREADER Type F 280-byte intake/output and Mueller Type X 618-byte intake/576-byte output with source-selected date, clock, identity and record-separator settings. |
| Payments | Match actual retained Paymentus, bank/lockbox/ACH and WaterSmart exports by explicit transaction or batch references; record matched receipts and source-linked NSF, ACH return, chargeback or refund entries once. |
| Collections | Retain approved credits, fees, waivers, leak adjustments, installments and extensions; calculate opening-cutoff-aware aging; produce reviewed notice CSVs and source-linked field review orders. |
| Field operations | Retain route/technician order, physical address, meter, GIS and backflow context; carry a standalone offline HTML route book; import reason, reading and original JPEG/PNG returns. |
| Delivery | Freeze a complete project ZIP containing source versions, results, ledger and original comparison replays. Keep an encrypted full workspace backup for editing and cold restoration. |

The local ledger records migration decisions. Native file generation records a handoff for the receiving configuration; the application records no vendor import acceptance or production posting.

## Source contract

The City of Asheville's original **298-FY27-ITS-RFI-OnPremisesTylerMunisSaaSReplace** includes a separately answerable utility billing/meter CIS component. The original question deadline is October 20, 2026 at 4 p.m. Eastern; information is due October 22 at 4 p.m. Eastern. It is an information-only planning request. A commercial implementation workshare should be scoped with a qualified provider, using the customer's actual exports and receiving configuration.

The profile maps 20 paraphrased operational requirements from the [original City CIS document](https://docs.google.com/document/d/13KoXkjwljo_RVcTXlpFJ9MSv4C6inClLzjMTs9YjCSQ/edit). Public source code contains functional field contracts and source references. Original City/vendor documents and customer exports belong with the private project custody.

Published [City rates](https://www.ashevillenc.gov/service/rates-fees/) are pinned in billing-rules.json: water consumption rates for bills issued on or after September 1, 2026, and meter base fees effective July 1, 2026. [Leak-adjustment rules](https://www.ashevillenc.gov/service/higher-than-expected-bills/) are retained with their timing and history requirements. The source-capture method and unresolved source boundaries remain in the same file.

Native contracts are described in [NATIVE_FORMATS.md](NATIVE_FORMATS.md), including links and SHA-256 identities of the original functional source files.

## Practice operation

The included Practice command creates generated fictional records and exercises the delivered native application, original comparison service and full workspace recovery:

~~~bash
node revenue/erp-conversion-assurance/profiles/asheville-cis-2026/practice.mjs /absolute/new/private/practice-operation
~~~

Add --browser only when the environment already has Python Playwright and Chromium. UTILITY_CHROMIUM selects an existing executable; UTILITY_PYTHON selects an existing Python runtime.

The complete operation includes 5,000 bills with an independently specified expected total of **509,750.00 USD**, original FAIL → correction → PASS, 5,000 adopted baselines, native formats, payments/returns, photo-backed field return, original replay archives, two handoffs and cold restoration. The command writes its actual outcome in result.json. Its generated identities are Practice records; no original City account data is included.

## License and source closure

This profile and its authored source are MIT licensed under the repository license. The installable archive preserves the original shared ERP runtime and license, adds this isolated profile, and identifies the included source files in SOURCE_MANIFEST.json. Native documentation remains attributable to its original publishers.
