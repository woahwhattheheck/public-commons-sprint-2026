# Commission an OpenFEMA portfolio service

This guide takes one selected analyst job from its original disaster records to an editable portfolio, a useful customer delivery and an installation another engineer can operate. It uses the existing **Public Assistance portfolios** application, native merchant and buyer engines, and complete workspace receiving.

Use the [workorder](examples/commissioning-workorder.md) to record the actual customer arrangement. The [DR 4724 criteria](examples/commissioning-dr4724.json) are directly accepted by the native portfolio command. The [operating reference](README.md), [managed application guide](MANAGED.md) and [source contract](SOURCE_CONTRACT.md) describe the maintained interfaces used below.

## 1. Choose the customer job and complete output

A practical first installation serves an analyst or research service maintaining a defined Public Assistance portfolio. The job can be a regional recovery review, an applicant working set, or a recurring review of changes to obligated projects. Define the question in terms the receiving analyst can answer with the delivered files: for example, which projects in the selected disaster cohort changed since the prior complete edition, which applicant matches need review, and which follow-ups the team has assigned.

The installation joins five responsibilities:

| Responsibility | Decision or work retained in the original workorder |
| --- | --- |
| Commissioning payer | Select the implementation scope, price, acceptance and party paying for operation and purchases. |
| Source/portfolio owner | Select the disaster cohort, analyst criteria, permitted customer output and update frequency. |
| Merchant operator | Operate the selected host, dataset release, exact payment terms and delivery recovery. |
| Independent buyer and receiving analyst | Approve the useful request and spending, open the complete result in the existing application, and use it for the agreed question. |
| Receiving engineer | Reopen the original installation, continue its saved work and operate subsequent releases and recovery. |

A source platform, the merchant and the payer can be different organizations. Record each actual party once and carry the same workorder through installation and receiving. The engineering team obtains the official records and indexed documentation, implements the selected consumer mapping and prepares the complete handover.

Specify both the **useful output** and the **priced request**. A customer may want one complete reviewed project table, a particular query, or the next reporting edition. A large table can require several query pages; the workorder therefore records the total approved task spending and how the buyer assembles the complete result. The service provides the agreed acquisition, curation, operation and delivery around the identified public source.

For a first installation, select one complete disaster cohort, one agreed publication table and one existing receiving application. Keep the six-table working portfolio for the analyst and receiving engineer. Record any additional report mapping, private enrichment or ongoing care as actual scoped work. The template leaves the commercial price and dates for the original customer agreement.

## 2. Open the maintained operator

Use the installed Stellar Forge distribution with Node 24 and its declared runtime dependencies. Select an owned private directory for the original workspace and the original buyer inbox and merchant runtime when publication is part of the installation:

```sh
openfema-workspace \
  --workspace /absolute/private/openfema \
  --inbox /absolute/private/original-buyer-inbox \
  --release-runtime /absolute/private/original-release-runtime.json
```

Open the local session URL printed by the application. Retain it in the original private host connection. Managed hosts can select **Applications → Public Assistance portfolios**, choose the same directory, inbox and runtime, then use that saved application to stop and reopen it. The provider is `openfema-public-assistance`; the merchant tool provider is `openfema-workspaces`. Both operate the original workspace UUID and actions. See [MANAGED.md](MANAGED.md) and [MCP.md](MCP.md).

The browser, connected tools and managed application can share that running service. A separate CLI process opens the workspace as its writer, so close the running operator before using the standalone CLI commands below, then reopen it at the same directory. Keep repeated or interrupted actions under their original operation IDs.

The customer workorder records the selected host and actual owner of service charges, purchase principal and network fees. This product uses the existing runtime; the grant's hosted Actions and incremental service reserve remain at their existing $0 allocation.

## 3. Receive the complete retained source, then select its edition

Use an existing complete source bundle when the required cohort has already been acquired. Receive it from the original source custodian and import its full JSON or gzip JSON through **Sources**. The native CLI equivalent is:

```sh
openfema receive-source \
  --workspace /absolute/private/openfema \
  --bundle /absolute/private/OpenFEMA_Original_Source_Bundle.json.gz

openfema view --workspace /absolute/private/openfema
```

The receiving result and Sources area identify the complete source edition. Copy that **64-character edition ID** into the workorder and portfolio selection. The source capture has its own identity; the DR 4724 capture ID below is not an edition ID.

For a new cohort, **Sources** accepts disaster numbers, states and declaration-date bounds. Selectors of different kinds combine with AND, and values within one selector combine with OR. Declaration dates select the disaster cohort; the collector then retains all associated applicant and obligated-project records for the selected disasters. A later project obligation is still part of that cohort. The command for a fresh DR 4724 acquisition is:

```sh
openfema capture \
  --workspace /absolute/private/openfema \
  --disasters 4724 \
  --label "DR 4724 Public Assistance"
```

Capture preserves every returned page, dataset dictionary, opening and closing refresh observation and saved continuation. Pause and resume the original capture from Sources. A closed process resumes fetching when the operator is reopened and the original operation is continued. The [source contract](SOURCE_CONTRACT.md#complete-refresh-and-recovery-behavior) explains the three dataset refresh boundaries.

### Use the original DR 4724 example

The [retained example](examples/recorded-dr4724/README.md) and [complete report](https://chatgpt.com/space/page_3e4298551d048191a72a621dabdf9ace) provide an immediate analyst commissioning case. Its original bundle contains **605,029 bytes**, SHA256 `580f2b88274a9d74070d03b636840863a11ab3c21270da9d8a63840524b58077`, and twelve original responses. Capture `3bda20261012000000000001` records its last response observation at **2026-10-12T10:49:24.857Z**.

The complete selected edition covers **DR 4724, Hawaii, Wildfires and High Winds**: 195 distinct funded projects, 43 applicant registrations and two declaration areas. Its unexcluded portfolio reports the following separate measures:

| Retained field | Exact USD amount |
| --- | ---: |
| Project cost (`projectAmount`) | 805,640,204.35 |
| Federal obligations (`federalShareObligated`) | 753,670,619.58 |
| Total obligations (`totalObligated`) | 753,670,619.58 |
| Mitigation (`mitigationAmount`) | 15,048,877.26 |

The [recorded output manifest](examples/recorded-dr4724/manifest.json) binds the complete reports to the source and original calculation. Use those counts and values when opening that exact original edition before making analyst exclusions. A later edition or a different portfolio selection carries its own coverage and totals.

The installed contribution carries this complete report, all six CSV tables, portfolio JSON, manifest and the original native commissioning files. The original full native commissioning continues through [examples/TESTNET.md](examples/TESTNET.md). Its saved operation is `SCF-OPENFEMA-PORTFOLIO-3BDA-20261012`; the original host and payment owners retain its runtime, inbox, keys and spending journal. Continue that operation when receiving its installation. The retained source and report can be used immediately for portfolio review and the application demonstration.

## 4. Turn records into an accountable analyst portfolio

In **Portfolios**, select the received edition and name the customer working set. The packaged criteria file keeps the entire DR 4724 cohort, retains unmatched applicants for review and applies no amount or category cutoff:

```sh
openfema portfolio \
  --workspace /absolute/private/openfema \
  --source COPY_THE_RETAINED_64_CHARACTER_EDITION_ID \
  --criteria /absolute/installed/source/stellar/scf-starforge-20261009/sf30-seller-sdk/openfema/examples/commissioning-dr4724.json
```

The criteria's disaster numbers are strings, as required by the portfolio contract. Capture scope disaster numbers are integers. When adapting the criteria to a customer, retain original applicant identifiers as text, including leading zeroes, and enter federal-amount bounds as exact decimal strings.

Work through the complete portfolio in this order:

1. **Disasters and declarations:** establish the selected disaster and its designated areas. Count the disaster once while retaining every area. Record the question and selected observation period in the portfolio note.
2. **Applicants:** inspect the original applicant names, identifiers and reported locations. A declaration-area row and an applicant address have different geographic meanings. Keep original candidate rows available where a project has more than one matching applicant.
3. **Projects:** inspect the source project identity, process/status fields, obligation dates, category and four separate amount measures. The portfolio's financial sort uses exact cents; the native publication keeps amount values as decimal strings.
4. **Issues:** review any missing or ambiguous relationships, conflicting identities, missing amounts and stale prior choices. A complete source with no issues still retains its coverage and source edition.
5. **Review:** select the actual record and save the analyst's decision, explanation, owner, due date and priority. Select an original applicant row when resolving an ambiguous match.
6. **Accept the selected version:** record what the analyst accepted and which follow-ups remain assigned. Keep that immutable version as the delivery input.

The native review states are `open`, `reviewed`, `follow_up` and `resolved`; priorities are `low`, `normal` and `high`. A disposition is `include` or `exclude`. Exclusion, a non-open state or an explicit applicant choice requires an explanation. Owners are labels in the original review record; due dates use YYYY-MM-DD.

Each saved review creates a new version. Record details and save operations remain bound to the selected portfolio/version. If another operator advances that version, reopen the current record and carry the intended decision forward against its actual state.

An excluded project remains in the retained project table with `included=false`. The included totals and grouped activity use the selected included records. This preserves the analyst's decision and the complete source while allowing a receiving application to distinguish the full working set from the included subset.

### Keep the source's financial and geographic meaning

The [current retained field definitions](SOURCE_CONTRACT.md#preserve-the-monetary-measures) govern the analysis. Project cost, federal obligations, total obligations and mitigation are separate source measures. Missing amounts remain distinct from zero; negative adjustments remain negative. The application sums each measure with integer cents and preserves its original value.

The funded-project source covers obligated worksheets. Its amounts describe the recorded project and obligation measures; they do not identify a contractor's invoice, a new procurement opportunity or project completion. Project county describes reported applicant location. The working report retains the designated-area geography separately.

A later source edition may contain added, changed or absent records because the operational source itself changed. Keep the original metadata and refresh observations beside the analyst interpretation. FEMA's [dataset descriptions](https://www.fema.gov/about/openfema/data-sets) and the retained source contract provide the underlying definitions.

## 5. Prepare the actual customer delivery

Choose the delivery that completes the agreed question:

| Delivery | Intended recipient and useful content |
| --- | --- |
| Complete HTML report | An authorized receiving analyst gets all six tables, source/criteria interpretation and analyst notes in a printable file that opens offline. |
| Portfolio JSON | The analyst's application gets the complete retained portfolio, original source rows, joins, criteria and decisions. |
| Spreadsheet CSV | The selected full table is ready for spreadsheet review with formula-leading cells neutralized. |
| Native merchant dataset/query | The buyer receives the selected table's declared columns through the original dataset and payment workflow. Exact amounts and identifiers remain strings. |
| Complete workspace ZIP | The receiving engineer gets source responses, editions, all versions and decisions, native datasets/releases, original operations and retained customer files. |

Assign recipients for the report, working JSON, source bundle and complete workspace. Full reports and working handovers carry analyst notes and operating context. The native project-table columns include review status, priority and the inclusion flag; its declared table projection does not include free-text review notes, owner or due date. Review the actual prepared table and its full retained provenance package before choosing what is delivered and to whom. The complete workspace is the private installation handover.

In **Publication**, select the accepted portfolio version and the agreed table, prepare its native dataset, inspect its schema and run the actual buyer query. The project dataset retains excluded rows and their inclusion flags; a consumer needing only included projects applies the dataset's declared `included` filter. Changing a display page, search box or report filename does not change the immutable prepared dataset.

The query default is 50 rows and the maximum query page is 250. The original DR 4724 demonstration uses `?limit=250` to receive its complete 195-project result. A larger customer task continues the declared query pagination, keeps the original approved page requests and assembles the full selected output before acceptance. Record the actual number and price of those requests in the workorder.

Select the merchant's real public origin, route and payment object: scheme `exact`, selected Stellar network and asset, `payTo`, positive atomic amount string and `maxTimeoutSeconds`. Inspect the staged release, then activate/start it against the displayed generation using the original runtime. A prior release remains available for the native rollback operation.

The buyer approves the selected useful request through its original workflow. In **Customers**, inspect and receive its actual intent IDs from the original configured inbox. The maintained buyer path retains the complete five-file customer delivery and original financial outcome. Open the full acquired output in the agreed receiving application. Later downloads and interrupted file transfers continue the same original operation.

The [original testnet commissioner](examples/TESTNET.md) already carries acquisition, a native payment, complete receiving, browser operation and restored-workspace receiving. Its existing 50,000-stroop spending ceiling and original payment journal apply to that demonstration operation. A customer's priced unit and budget are configured in that customer's own original agreement and payment selection.

## 6. Continue the recurring review

Record the reason and schedule for a later useful edition in the customer workorder. At that time, capture the same agreed cohort to completion, revise the existing portfolio against the new edition and compare the before/after versions in **Changes**. Keep the earlier accepted version available.

Review changed fields and the four separate financial deltas. Check source-scope compatibility before interpreting added or absent projects. Revisit any applicant choice the later edition marks stale. Assign the resulting real follow-up work in Review, accept the next version and prepare its customer output.

A later edition, reporting period or distinct query can be a new approved purchase. Reopening already acquired files or finishing a retained download belongs to its original purchase. A paid request's usefulness is the customer's complete accepted output and the work it enables.

For recurring value, record the analyst's prior process where known, active review time, correction effort, completion of assigned follow-ups and receiving-engineer effort. Preserve the accepted output and actual customer feedback in the same workorder. These observations support the next installation's scope and commercial estimate.

## 7. Hand the original installation to its receiving engineer

Pause active capture before creating a complete workspace backup. Close the live writer before running the separate CLI sequence:

```sh
openfema backup \
  --workspace /absolute/private/openfema \
  --out /absolute/private/OpenFEMA_Complete_Workspace.zip

openfema inspect-backup \
  --archive /absolute/private/OpenFEMA_Complete_Workspace.zip

openfema restore \
  --archive /absolute/private/OpenFEMA_Complete_Workspace.zip \
  --workspace /absolute/private/openfema-received
```

Use a new output file and a distinct owned canonical receiving directory. The archive preserves the original workspace UUID, source editions, analyst versions and decisions, publisher history and complete customer files. At the new location, the native receiving operation adopts the original publishers with the new absolute dataset bindings and stages their corresponding releases. Open the restored **Publication** area and operate the appropriate restored release.

An interrupted restore resumes with the same archive and directory. Repeated receiving reopens that original result. After a native restart changes the local session URL, **Handover → Original operation history** can reopen saved operations under the same workspace identity.

The receiving engineer completes the selected analyst question, opens an earlier acquired customer result, continues an assigned follow-up and performs the agreed release change or rollback. The installation record names the new operating location, accountable operator, retained archive, later operations that require reconciliation and the support path.

Use the [workorder's acceptance table](examples/commissioning-workorder.md#acceptance-and-handover) to retain those actual outcomes alongside the agreed delivery. Source, reports, customer outputs and operating handover have their intended recipients; the existing native workspace remains the operating record.

## 8. Fit a selected installation into the SCF plan

This product is a candidate for one of the existing two independent merchant installations. The original customer selection and workorder determine whether it enters that cohort. The source, retained report and product implementation provide the starting material for prospective customer-specific engineering.

| Existing tranche | OpenFEMA installation work within the current packages |
| --- | --- |
| T1, days 1–30 | Implement the selected cohort/output mapping, buyer application, actual host/route/payment terms and independent operator receiving. Carry source/terms changes or withdrawal through the same installed service while retaining earlier customer output. |
| T2, days 31–90 | Deploy that useful operation through both selected facilitators and operate interruption and delivery-failure recovery. Complete the existing combined target of ten useful purchases by two independent buyers during seven consecutive days ending by day 90. |
| T3, days 91–150 | Operate recurring mainnet editions, release/rollback, off-host retention and receiving-host restore. Complete the existing combined target of thirty useful purchases during fourteen consecutive days ending by day 150, with both buyers returning on another day, and finish the independent maintainer's support case. |

The canonical plan remains **$38,000, 400 prospective hours and 150 days from actual award acceptance**, across its original six packages and two-merchant/two-buyer cohort. Assign each actual adaptation once to its funded package or separately commissioned commercial workorder. Record the actual useful output, recurring customer use and independent technical handover as the completion outcomes.

## Maintained references

- [OpenFEMA application and commands](README.md)
- [Native source and financial field contract](SOURCE_CONTRACT.md)
- [Complete retained DR 4724 report and six tables](examples/recorded-dr4724/README.md)
- [Managed Applications](MANAGED.md) and [typed merchant tools/receiving](MCP.md)
- [Original native and testnet commissioning](examples/TESTNET.md)
- [FEMA data catalogue](https://www.fema.gov/about/openfema/data-sets)
- [FEMA API documentation](https://www.fema.gov/about/openfema/api)
