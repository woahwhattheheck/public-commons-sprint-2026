# Commission and deliver a World Bank customer programme

This guide scopes a recurring economic-report service around the maintained World Bank product. A customer receives its original source edition, editable Analysis workspace, selected SQL/report/workbook definitions and complete delivery files. The same native programme continues later accepted editions. The customer brief determines countries, indicators, time coverage, interpretation and review responsibilities.

## Define the customer work

Use this checklist in the original quotation or Workshare. Record the actual selections and attach that complete source to the existing customer Installation. The table supplies a commissioning contract; it does not create an Installation or select commercial terms on the customer's behalf.

| Decision | Record before preparing the first delivery | Acceptance |
| --- | --- | --- |
| Purpose and recipient | Decision supported by the report; named operator and reviewer; intended audience | Reviewer can identify the question each saved report section answers |
| Source population | World Bank database ID; country/aggregate and indicator IDs; period; complete selection | Every approved identity is represented or its source absence/null is visible |
| Definitions and rights | Original indicator/country/source metadata, units, source attribution and applicable usage terms | Recipient can inspect the retained original definitions and source references |
| Review policy | Observation keys; repeated-row choice; permitted exclusions and explanation | Saved review records the exact original rows and complete choice/exclusion set |
| Calculations | Selected SQL/query revisions, parameters, report sections and interpretation | Raw values and each derived calculation are distinguishable |
| Workbook design | Sheet names, selected columns, labels, types, missing-value display and precision | Workbook matches the reviewed current definition, including customer edits |
| Recurrence | Approved source edition for each period; acquisition timing; responsible review owner | Each period has its own source/review identity and one retained programme operation |
| Delivery | File set, recipient environment and complete receiving location | Recipient opens reports and the editable workspace with original source/history |
| Optional paid API | Actual merchant route/network/asset/recipient, accepted offer and buyer limits | Original release, buyer intent, acquired outputs and accounting remain linked |
| Care and corrections | Support scope, change authority, correction process and selected commercial terms | Later work retains the accepted predecessor and records the actual new decision |

The source may contain countries and aggregates in the same catalogue. Select them deliberately. A regional aggregate and its member countries are separate observations; adding them together would double-count the population. Source nulls are not zero. A source's most recent observation year is distinct from the capture time and from the customer's reporting period.

Quote source configuration, customer query/report design, initial receiving, recurring review and support as explicit work. Use the original commercial and Installation editors for agreed amounts, hours, dates, contributors and acceptance. This product contribution supplies no default customer price and does not alter the SCF grant allocation.

## Install the original product

Use the maintained World Bank distribution selection and its full source manifest. The complete installed route uses Linux, the selected Node runtime, Python 3.11 or newer and the original Python package's workbooks extra. The original World Bank core.py must stay with source.py. Select the actual Python environment consistently in preparation, programme operation and reopening.

Keep the source acquisition workspace separate from the customer's Analysis directory. Each has its original owner and history. The browser and Merchant adapter borrow the currently running Analysis service; an independent CLI writer must wait until that service is closed through its original control.

Start the original source application:

~~~sh
starforge worldbank-product workspace --directory /absolute/private/worldbank-source
~~~

Use the complete [source operating guide](OPERATING.md) to save the selection, acquire every original page, review rows and export the approved handover. A capture interrupted by a provider error continues its original ID and retained pagination. A changed selection applies to a subsequent capture.

A source handover contains the reviewed CSV, typed dataset configuration, source/selection/review documents, original capture and full response bodies. Keep that entire handover. A screenshot or a partial page cannot replace it.

## Establish the first editable customer edition

The original prepare command validates the handover through the original importer and reproduces the reviewed CSV before importing it into Analysis:

~~~sh
starforge worldbank-product analysis --python /absolute/python3 prepare \
  --handover /absolute/incoming/approved-handover.zip \
  --workspace /absolute/private/customer-analysis \
  --operation-id ORIGINAL32LOWERHEX \
  --prefix customer_economy --resume
~~~

Replace the operation placeholder with one selected stable ID and retain the complete command. A new independent initial analysis uses a new operation and names; continuing an interrupted preparation reuses its original inputs. The result supplies the actual view, report, workbook, publication and delivery identities. Use those returned names instead of deriving them from a screen label.

The original analytical template supplies reviewed observations, coverage and annual change. It adds GDP per person when both required series are present. The customer can edit SQL, choose query revisions/parameters in report sections, change report titles/notes and configure workbook sheets. Save and review those definitions before the next-edition comparison.

The arithmetic contract is explicit:

- Original World Bank number tokens remain text, including decimal/exponent representation; null remains nullable.
- Annual change applies to consecutive four-digit years with the same source/country/indicator/aggregate/unit meaning. Gaps, duplicate periods, missing values and a zero prior denominator yield an explanatory uncalculated result.
- GDP per person uses current-US-dollar GDP divided by positive population at matched original identities. It is not a constant-price or purchasing-power-parity series.
- Derived calculations use the existing SQLite floating-point rules and numeric Excel cells. Original codes, periods and numeric tokens use preserved text cells.
- The current analytical adapter supports fewer than 100,000 reviewed observations and an original handover up to 32 MiB. Larger source acquisition should be scoped into complete supported deliveries rather than silently truncated.

The complete rules and file formats are in the original [Analysis guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/worldbank/ANALYSIS.md).

## Receive and review the next approved edition

Open the original customer service and its World Bank tab:

~~~sh
starforge worldbank-product programme --python /absolute/python3 \
  --workspace /absolute/private/customer-analysis serve --open
~~~

The existing browser's original ZIP intake retains the full approved handover, upload intent and registration result. Review the selected file's complete identity, continue missing chunks with that same intake, and register it through the original World Bank engine. A committed registration is recovered by its existing source/document/revision; the original download remains available after workspace relocation.

Create or open a named programme bound to the actual existing view, report, workbook and observation keys. Select the exact registered source name and revision. Prepare its review with one stable operation ID. The current accepted view stays selected while the candidate is reviewed.

Read both parts of the result: complete observation differences and original provider metadata/review differences. They answer different questions. If the provider capture is unchanged but one observation is excluded, describe a changed analyst review. A later downloaded capture can still contain unchanged observations. Do not rename either condition as a new provider revision.

The customer review records:

1. Current accepted view/version and candidate source identity.
2. Full added/removed/changed rows and the selected observation keys.
3. Provider metadata changes, duplicate groups and source selection/review changes.
4. Exact saved report/query revisions and parameters.
5. Current workbook definition and every worksheet that the refresh will affect.
6. The operator's complete selection note and any explicit column choices.

Publish with that exact review digest. The existing native comparison applies the accepted candidate, runs the reviewed report and refreshes only related workbook sheets. Unrelated worksheets retain their own original sources. If report/workbook/view revisions move after review, reconcile against the customer's current definitions and retain the earlier review. Do not overwrite intervening customer edits.

For changed column layouts, use the original retained proposal. Select exact source positions and full column objects; repeated labels alone cannot identify a column. Continue the same operation after those choices. The complete browser/CLI sequence is in [PROGRAMMES.md](PROGRAMMES.md); the underlying analytical sequence is in [RECURRING.md](RECURRING.md).

## Optional merchant and agent operation

The original dataset bridge prepares the accepted source edition through the maintained publisher and release store. Actual network, asset, amount, recipient and buyer limits come from the selected merchant configuration. The buyer reviews the real offer and retains its original intent/acquisition/accounting. A local report refresh does not issue another purchase.

The Merchant source adapter and the named programme adapter serve different stages of the same delivery. The source adapter operates acquisition, review, original releases and buyer handovers. The programme adapter connects the existing Analysis owner and carries source preparation, review, publication and complete file transfer. Its existing Console recipe pauses for review between preparation and publication; it retains workflow period, native operation and output identities.

A Console profile archive that contains file references is not the full customer transfer. Use its complete handover capture/receive to carry every retained file, then receive the native workspace ZIP through the original Analysis receiver. Follow the complete [Merchant programme guide](../../stellar-forge/mcp-merchant-operator/WORLDBANK_PROGRAMMES.md).

## Approved source intake through the existing agent

The installed `worldbank-programme-agent intake` command and typed `registerWorldBankSource` client operate the original running Analysis service through its existing Merchant connection. Select the actual declared workspace, approved handover and one stable intake ID. The full input and immutable local intent are saved before upload or registration. A private operation directory retains every complete observation and the source selection needed for the following report review.

| Customer operation | Complete retained result |
| --- | --- |
| Begin and upload the approved ZIP | Original intake ID, filename, bytes, SHA-256 and complete local input |
| Resume after connection loss or relocation | Same native intent; original chunks restored from verified available bytes |
| Register through the current Analysis owner | Exact source name, revision and document ID, original review and typed columns |
| Prepare an explicitly selected named programme | Original programme/revision and stable review request with that exact registered source |
| Receive the registered source | Complete original ZIP, registration and intent plus verified content-derived manifest |

Use the same operation directory and intake ID after an interruption. A native ERROR or INTERRUPTED registration requires explicit `--resume true`; a still-running registration is read under the same ID. Source registration leaves the current accepted customer outputs selected. The optional programme preparation creates the existing comparison and review; publish the accepted choice through its original reviewed workflow.

The receiver distinguishes the SQL upload count from `available_bytes`, which describes the complete chunk prefix actually present on the current installation. After an unfinished workspace is restored, resend the original missing chunks under their retained offsets and hashes. After registration, the original download resolves the native document in that restored workspace and no longer depends on upload staging.

The full [agent source-intake guide](../../stellar-forge/mcp-merchant-operator/WORLDBANK_SOURCE_INTAKE.md) provides the complete installed command, typed API, ten MCP controls and independent `intake-download` route. The latter receives every original file after the Analysis service closes. Include the retained operation and registered-source files with the existing customer workshare/Installation. Use the already selected native receiving course and exact approved source; the original report/workbook publication still requires its operator's reviewed choice.

## Deliver, receive and continue

The full delivery includes HTML/JSON reports, section CSVs, Excel, the independent workbook handover, source comparison exports, retained selection, complete Analysis workspace/manifest and the original delivery ZIP. Transfer the files named by the actual completed manifest. Complete file length/hash validation and receiving belong to the original native download/archive engines.

| Receiving action | Retained customer state |
| --- | --- |
| Open HTML/JSON or Excel | The selected published report/workbook edition |
| Receive workbook handover | Complete selected workbook definition, sources and retained history |
| Receive Analysis workspace | Original source documents, typed data, saved SQL, reports, workbook editions and programme records |
| Download original handover after restore | The exact registered source ZIP resolved in the new workspace |
| Repeat completed same-archive receiving | Existing accepted result with later customer edits preserved |
| Create a linked portable delivery | Accepted report/workbook plus a new snapshot of the current customer workspace |

A workspace snapshot made while its outer delivery ZIP is being assembled can retain that assembly as interrupted. The programme verifies the accepted source selection, completed report publication and workbook independently. When it exposes an accepted edition, create a new explicitly linked portable-delivery ID. It reuses the accepted business outputs and includes current customer edits. The earlier incomplete assembly remains in history.

After response loss, read the original request or operation before dispatching again. Retain the exact request/body and resume its original phase. Supported archive continuation reuses its snapshot; non-resumable failed jobs keep the old attempt and record a new attempt under the same operation. These distinct identities are part of the customer's working history.

## Original operated-course selection

The maintained reference uses the retained CAN/MEX/USA GDP/population selection for 2018–2024: 42 original observations and eight response documents. Its approved 41-row comparison handover excludes the original CAN GDP 2018 observation from the same capture. That selection demonstrates review changes and customer continuation; it does not establish a fresh provider update.

The complete original receiving programme covers approved ZIP intake, customer-edited queries/report/workbook, reviewed selection, interrupted-request continuation, native customer downloads and restored-workspace original ZIP access. Its accepting host and actual result remain with the original case owner. Use [PROGRAMME_RECEIVING.md](PROGRAMME_RECEIVING.md) and [INSTALLED_PROGRAMME_RECEIVING.md](INSTALLED_PROGRAMME_RECEIVING.md) with that same retained operation and actual runtime.

For a new customer, select the customer's real source and acceptance brief, then retain the resulting actual delivery and receiving result with its original Installation. Reusable product source, an accepted review, a paid acquisition and a customer's accepted outcome remain separate records. This lets the funded deployment report concrete work and customer use without changing the original grant baseline.

## Owner-directed rendered-product inspection

Source: direct owner instruction of October 13, 2026. Repository copy version: `2026-10-13.1`.
Scope: owner-controlled work across providers, local and cloud runtimes, and current and future workers. Existing owner controls remain in force.

Before calling a client/prospect-facing app, website, dashboard, demo, report, presentation or export ready, the producing worker must open/run/render the exact outgoing version, LOOK at the rendered screen or its real screenshots, and operate the important user controls. Check the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Fix ugly, broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Code review, DOM counts, HTTP200, unit checks or another worker's approval do not replace seeing the actual product.

The Ecosystem product requires plain industrial design: readable tables, clear hierarchy, consistent typography/spacing, restrained controls, useful labels and responsive layouts. Keep the real workflows/data/computation. Reviews must lead directly to repairs and must not replace implementation/integration or become endless rechecking. The existing focused-validation policy remains; do not run broad suites or build a verification product.

Persist this instruction in the active owner-controlled instruction surfaces actually read by the relevant workers: global/project AGENTS/CLAUDE/GEMINI/rules, provider-specific boot instructions, source mirrors, cloud repository copies and current build/receiving guides. Include this instruction in every delegated child assignment, including assignments to another provider or runtime. Maintainers update their own consumed files and return exact paths, source/version and readback. A coordination acknowledgment alone is not propagation. Do not alter historical evidence or third-party/vendor policies. No forced restarts, new watchers or revival of owner-stopped work.

Inspect the actual completed scientific screens, reports, source pages and downloadable HTML in the real operator. Prior empty-Workspace screenshots are not completed-workspace acceptance. Preserve current engineering owners; other coordinators receive propagation rather than duplicate implementation. Continue native source/runtime/archive joins rather than diverting everyone to cosmetic review. This instruction does not extend or restart the Ecosystem sprint: the existing cutoff is October 13, 2026 at 10:00 a.m. America/Kentucky/Louisville, 14:00 UTC.

Source assembly and standalone application handoffs retain the application-level instruction copies with their current guides. This file records an owner-requested product delivery requirement; it does not change provider safeguards, repository access controls, or existing authorization boundaries.
