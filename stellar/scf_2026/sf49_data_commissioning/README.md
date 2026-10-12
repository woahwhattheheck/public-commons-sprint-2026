# Data-service commissioning designs for SCF SF49

These commissioning designs turn the maintained merchant product into a defined installation that an API or data operator can commission. Use them with the [original SF49 adoption process](../SF49_ADOPTION_PILOT_PLAYBOOK_20261009.md) and its existing private workorder. The deliverable is one agreed useful operation on the merchant's host, its complete output in the buyer's application, and a receiving operator able to change and maintain it.

The reference products include **SEC company-data editions**, **OData collections**, and [**approved imagery deliveries**](IMAGERY.md). They exercise different customer requirements: a filing-derived record whose publication history matters, a typed operational collection whose pages, keys and source access must stay intact, and a geographic selection whose approved source, rights and exact image files reach the buyer together. SEC and OData already have source authoring, merchant configuration, original buyer handoffs and managed Applications integration. The selected release remains the shared Starforge installation.

## Choose the customer job

| Design | Useful buyer task | Merchant's delivered operation | The decision to settle in the existing workorder |
| --- | --- | --- | --- |
| SEC company-data editions | An analysis application obtains the reported facts for a selected company, concept, unit and filing/period window, retaining the observations needed for a source-aware financial review. A filing-index consumer can instead locate the selected company's original filing documents. | A versioned GET resource with explicit offered concepts or forms, immutable acquisition identity, complete selected rows and a source-bound continuation. | Select the actual company, offered product, filing and period policy, complete receiving consumer and refresh cadence. |
| OData collection receiving | An operational application obtains the approved order or other entity collection and can reconcile a later edition by declared keys. A customer requiring current provider pages can use the live service. | Either an accepted captured collection published through the original dataset seller, or a live paid page from one reviewed query and source binding. | Select snapshot or live behavior, exact entity/projection/filter, row and byte ceilings, buyer spending cap and receiving application. |
| Approved imagery receiving | A GIS user opens the agreed area, acquisition window, scene selection and image assets with their source metadata and rights. | A reviewed STAC edition and exact files carried through the existing merchant/buyer into a portable GIS handover and independently reopenable commissioning record. | Select the real catalog/identity, licensed collections, useful scene/asset pairs, payment unit, complete buyer cap, receiving application and refresh/maintenance owner. |

For each design, the implementation price buys the agreed integration, source handling, deployment and operator handover. The merchant selects the commercial value and price of its own service. Its data receipts, implementation invoices and ongoing care remain the original distinct commercial events.

### SEC: an edition the receiving analyst can use

The maintained [SEC merchant](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/434ccfd8b34e056f29d9e265575ff1a63cda73af/stellar/scf-starforge-20261009/sf30-seller-sdk/sec-edgar/README.md) starts from original SEC JSON. The retained reference export contains Apple company facts and Genpact's current filing index, with configuration, review, OpenAPI, generated JavaScript client and declarations, buyer handoff, original raw sources and a manifest.

| Reference source | Original identity | Existing operated source result |
| --- | --- | --- |
| Apple company facts | CIK `0000320193`; edition `apple-facts-20261011`; SHA-256 `73a86c6aedc31f77cac2ea4df5f80f0b3bd7e6eb58bb4e01444fbedf3afb9c43` | 25,135 original observations; the example product offers `us-gaap:Assets` and `us-gaap:NetIncomeLoss`. |
| Genpact submissions | CIK `0001398659`; edition `genpact-filings-20261011`; SHA-256 `fca3d62aff9f2dac8c6c4c201970b8d128269387b71461c77ecae84d845eb1e7` | 1,003 original filing-index rows, with original accession, dates, forms and document links. |

The actual source/operator operation already imported both captures, retained missing fiscal fields and repeated accessions, exercised source selection, save conflict, revision restore and restart, and exported/reopened the complete merchant package. The managed source operator uses those same records and exporter. These two products in one reference export are one implementation foundation; the grant cohort selects its merchant organizations and accountable operators through the existing commercial cases.

**Contract for the facts buyer.** Keep `cik`, `taxonomy`, `concept`, `unit`, `value`, `valueType`, `start`, `end`, `accession`, `filed`, `form`, `fy`, `fp`, `frame`, `sourceIndex` and `unitIndex` with the acquired observation. Numeric values retain their original JSON spelling in `value` with `valueType: "number"`. A null fiscal year or period stays null. Two accessions reporting the same period remain separate observations. The buyer's analytical layer chooses its comparison policy explicitly.

The selection's filing window and reported-period window are independent. For example, an Assets request limited by `filedTo` answers what the selected edition contains within that filing-date boundary; an `end`-date selection addresses the reported period. Use the same concept and unit when a consumer expects comparable observations. The source product preserves the original records without remapping fiscal years, converting currencies or resolving restatements.

**Contract for the filing buyer.** Select recent submissions or an explicitly named historical shard. A current submissions capture retains its history-file descriptors; obtaining an older shard creates a separate source edition. Deliver the complete original index rows and document paths the buyer requested. A document comparison or annual-report service can consume those links through its own maintained operation and source rules.

**Refresh and operating work.** The merchant chooses which acquisitions become offered editions. A changed source digest takes a new edition and product revision. An earlier customer keeps its acquired bytes and source identity. The source acquisition command uses the configured organizational User-Agent and original shared supplier-quota owner; the receiving host joins that same acquisition arrangement. Work on the grant installation resolves the actual customer company's source selection, host configuration, downstream reader and deployed refresh/change behavior.

The first useful receiving result is an analyst opening the selected rows in its actual consumer with original units, dates and accessions intact. Its handover includes the agreed selection, complete source/client export and the command that reopens the same retained product. A follow-on review uses a new chosen source edition while retaining the earlier selection and output.

### OData: a complete operational collection

The [original OData workspace](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/434ccfd8b34e056f29d9e265575ff1a63cda73af/stellar/scf-starforge-20261009/sf30-seller-sdk/odata/README.md) reads the service document and CSDL before compiling a saved query. Source records, schema editions, query reviews, capture progress, receiving decisions, dataset exports and live profiles share that workspace.

The retained Northwind reference has 26 entity sets and 830 Orders across five original pages. Two complete captured editions compare identically by declared keys; the saved dataset query matches 122 USA orders. Returned Decimal strings such as `48.2900` and `147.2600` retain their scale. This reference provides concrete source and receiving behavior for the customer to inspect. The customer installation selects its own authorized service, company scope and useful entity.

**Choose the delivery model before setting the resource price.**

| Model | What the customer acquires | Source and change semantics | Receiving outcome |
| --- | --- | --- | --- |
| Captured edition | The queryable, accepted dataset from a complete retained provider collection. | The edition retains the actual CSDL, saved query and original page chain. A later complete edition can show additions, removals and changes by the provider's declared keys. | Original dataset files and source record, followed by the buyer's saved analysis or operational import. |
| Live reviewed query | Each successful provider page of the merchant's chosen live operation. | Saved source filters, output/filter/order fields and total ceiling constrain the query. Every page records its actual supplier response identity and acquisition time; source changes between pages remain meaningful. | Exact response bytes, normalized rows, receiving manifest and the original next-page request until provider completion or the reviewed total limit. |

The source's next link determines continuation. A short page can still have a next link. `pageSize` is a provider preference; `maxPageRows` and the response-byte limit are separate hard ceilings. The complete query's `top` or source row limit constrains the total. Preserve declared entity keys even when the customer projects fewer business fields.

**Snapshot contract.** Native dataset exports retain exact Decimal and Int64 text and a companion `_state` column for each selected property, distinguishing `value`, `null` and `missing`. Select no more than 32 properties for that native dataset shape. Keep complex values as the original export's JSON text. Review a changed query separately when interpreting the difference between editions; a narrower filter can otherwise look like removed source records.

**Live contract.** Prepare the product from the existing reviewed workspace plan so the original schema digest, filters, ordering and authorization-variable reference remain attached. The buyer's initial JSON POST contains the selected request. A following request contains only the returned `cursor`. That cursor retains the merchant binding, original query, cumulative row count and expiry. The service's private runtime directory retains its continuation key through restart. A receiving host reopens an existing purchase through its original buyer execution state; a new purchase receives a new stable intent.

**Price the real unit of work.** Live OData prices each successful provider page in integer asset units. The source example's 10,000-unit page price would amount to 50,000 units for its retained five-page response chain, before separately selected transaction or operating costs. This is configuration arithmetic; the selected asset, merchant price and actual provider pagination determine the customer amount. Do not estimate an enforceable spending ceiling by dividing rows by requested page size. Use the buyer's own persistent per-request and total spending limits, inspect each actual continuation and record the full query's accepted cost.

Keep the logical query/receiving ID beside its individual page intents and settlement records. The customer's completed job is the useful selected collection. Payment and repeat-use reporting can then show the original page transactions and the completed consumer task without treating a transport retry, another wallet or a copied result as another independent customer.

## Commission on the original host and buyer

Select one native source product and the existing original release for each merchant. Record the chosen provider access, public origin, merchant asset/recipient/amount, facilitator, actual private workspace and receiving consumer in that original workorder. Configure secrets through the supported private host references. The customer uses the original buyer host and approval flow to choose its signer, network, asset, request and spending limits.

For SEC, the **SEC EDGAR source operator** card takes the retained operator workspace and capture store. Review, Save and Start open its original authenticated browser; import/select the source, preview rows, save the draft and export the complete chosen merchant configuration. Stop and the next Start retain the same workspace, editions and history. The buyer service uses the configured facilitator and original native seller.

For OData, the **OData** card takes its original workspace and optional saved live-service ID. It can open source authoring alone or launch that live merchant and operations view. Original customer handoffs pin their committed request and response paths. Receive the saved response, then prepare the returned continuation through the same SF88 buyer. Managed Stop closes the owning listeners; reopening retains the source workspace and service's private continuation state.

The original [buyer setup](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/434ccfd8b34e056f29d9e265575ff1a63cda73af/stellar/scf-starforge-20261009/buyer-runbook/OPERATOR_SETUP.md) and [request collections](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/434ccfd8b34e056f29d9e265575ff1a63cda73af/stellar-forge/mcp-paid-agent/COLLECTIONS.md) perform approval and execution. Each receiving engineer uses the actual released source containing the selected Applications family, CLI/server startup hooks and common controller. A source checkout's revision and an installed runtime's manifest are retained as their actual separate identities.

### Ready native receiving inputs

The two JSON templates in this directory have the **existing managed runners' actual input schemas**. Replace each absolute path with the chosen existing runtime, original source/workspace and complete retained input. Select a new output directory for its first operation. For a retained operation, continue that original receiver and records.

For the SEC reference export, use [sec-managed-input.example.json](sec-managed-input.example.json):

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sec-edgar/managed-operation.mjs \
  --input /absolute/sec-managed-input.json
~~~

Its `manifestSha256` is the retained export manifest's original `27ef7f9f05a99530cf72f64ce722dba8e90561444f1581350df8cbdc84374eee`. A customer's newly selected export supplies its own actual manifest digest. The original operation opens the installed Applications model, retains previews/downloads, exports the complete source, stops the listener and reopens the same workspace/store.

For a complete OData live response chain, use [odata-managed-input.example.json](odata-managed-input.example.json):

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/odata/live/managed-receiving.mjs \
  --input /absolute/odata-managed-input.json
~~~

`responseFiles` are the complete ordered native live envelopes, including the terminal response. Original supplier JSON pages and native live response envelopes have different shapes; select the envelopes produced by this existing service. The operation imports those original responses, prepares the original buyer continuations, stops the managed service and reopens its retained response inventory and continuation identity. An optional `environmentFile` selects the actual existing private Applications environment.

Both source-owned runners retain complete outputs and original operation identities in their selected output directory. The merchant and buyer operation remain with their existing owners while receiving proceeds.

## Commission approved imagery and receiving

The [imagery commissioning guide](IMAGERY.md) carries the customer's selected geographic job through actual catalog access, eoAPI policy review, explicit file selection, the original merchant/buyer and the receiving GIS application. It includes native-schema examples for the [scene query](imagery-query.example.json), [private source references](imagery-source-runtime.example.json), [original Buyer](imagery-buyer-config.example.json) and [deployment access plan](imagery-commissioning-plan.example.json). The maintained STAC and Prescient owners perform source/SDK acquisition, receiving and recovery.

The guide maps source/terms change, actual purchase continuation, receiving-host restoration and production operation onto the same six existing grant packages. Its [application insertion](IMAGERY_APPLICATION_TEXT.md) and complete five-scene demonstration join the current manuscript and customer demonstration.

## Continue into the buyer's recurring analysis

The [Python analysis and workbook commissioning guide](PYTHON_ANALYSIS.md) carries the selected SEC observations or complete OData collection into the customer's saved query, exact-value spreadsheet mapping, reviewed source refresh and receiving handover. It includes original client recipes for [SEC observations](sec-workbook.recipe.example.json), [OData Orders](odata-workbook.recipe.example.json) and [a reviewed recurring edition](sec-workbook-refresh.recipe.example.json).

This is the downstream use of the source and purchase selected above. The customer chooses the decision, precision policy and reason to return; the original AnalysisWorkspace, workbook client, native agent tools and managed runtime retain its work. The [self-contained application insertion](PYTHON_APPLICATION_TEXT.md) gives the current manuscript editors the customer outcome and remaining host-integration work.

## Commission source editions and complete report receiving

The [source-edition commissioning guide](SOURCE_EDITION_COMMISSIONING.md) carries Matomo report hierarchy and Coin Metrics Cloud/API source meaning into the original merchant, buyer application and second-operator handover. The completed foundations are the original 89-row hierarchical Matomo source/customer delivery and 168 actual hourly Community reference-rate observations with a lossless API/CSV comparison. Their original remaining browser/release stages keep their recorded status.

Use the native [Matomo comparison request](matomo-edition-comparison.example.json), [reference-rate comparison request](reference-rate-comparison.example.json) and [existing SF77 delivery fields](source-edition-delivery-fields.example.json) with the customer's actual source/edition IDs and original terms. The guide preserves whole-population coverage, exact values and time units, daily catalog versions, deliberate omissions, source/terms change and complete receiving. It maps actual customer-host adaptations to the same six packages and retains the original Talos $9,800 / 15-business-day workshare as a separate commissioning route. Its [application contribution](SOURCE_EDITION_APPLICATION_TEXT.md) joins the same canonical manuscript.

The original support case and owner terms can travel with those source files through [SF49's native workorder carrier](source-edition-workorder.mjs). `prepare`, `receive` and `replay` call the maintained SF74/SF77 APIs, preserve complete original input bytes and coverage, and verify the same packet after transfer. Use the [attachment inventory](source-edition-attachments.example.json) for separately retained provider handovers and receiving records. Approved price remains independent of an unrecorded cost; the original model and terms editor preserve null cost and display a known adverse margin without repricing.

## The remaining engineering in the grant cohort

Apply these designs to the canonical two-merchant/two-buyer deployment. They make the first tranche a concrete customer-host integration rather than another architecture exercise. Keep the current six cost packages, 400 prospective hours, $38,000 request and award-relative 150-day schedule in the original model.

| Existing cost package | Concrete adaptation on the selected data-service installation | Customer result |
| --- | --- | --- |
| `T1-merchant-resource-integration` | Connect the customer's actual source/access arrangement; implement its selected source/query and consumer mapping; configure its native release, public route, payment terms and buyer host. | Each merchant has one useful operation and its buyer opens complete correctly interpreted output. |
| `T1-merchant-authority-handover` | Complete the real source/terms change or withdrawal, configure the receiving operator and resolve installation-specific source/runtime defects. | A second accountable operator reopens the installation and changes the agreed resource while prior acquired output remains usable. |
| `T2-provider-and-ledger-deployment` | Run that same useful operation through the two selected independent facilitators and original buyer ledgers. Carry page/edition identities into actual request, transfer and delivered-result records. | The original useful testnet purchase window is measurable on the deployed consumer task. |
| `T2-deployed-threat-response` | Connect the existing monitoring and recovery to actual supplier, merchant and buyer failures; resolve interrupted settled delivery and merchant-delivery failure on the customer host. | Staff can identify and complete the unfinished original work and understand its actual financial outcome. |
| `T3-mainnet-merchant-rollout` | Configure the real production network, asset/accounts and receiving hosts; complete controlled release/rollback and the agreed recurring useful operation. | Two maintained merchant installations and the original recurring-buyer/mainnet use window. |
| `T3-production-recovery-and-handover` | Finish customer-specific supervision, off-host retention, key rotation and receiving-host restore; reconcile work after the retained backup and complete the maintainer's support case. | The receiving team can support the installation and retain its original source, paid results and operating history. |

Use active installation, source adaptation, consumer integration and handover hours to size the next commercial implementation. Record elapsed access delays separately so a wait for a customer's environment does not become invented engineering effort. The existing SF47 case attaches actual hours and payment dates to its selected grant package or commercial workshare once. Reuse the selected source, runtime and compute; hosted Actions remains the canonical $0 budget.

At review, the merchant demonstrates the agreed resource and source change, the buyer consumes its complete result, and the receiving engineer operates its retained history and relevant recovery. The original workorder retains their technical acceptance, commercial terms, invoice events and measured support effort. [Application-ready integration text](APPLICATION_TEXT.md) connects this defined customer job to the existing manuscript.

## Source selection

This design reads the following original source at revision `434ccfd8b34e056f29d9e265575ff1a63cda73af`:

| Source | Exact Git blob |
| --- | --- |
| SEC merchant guide | `398195ac9691b27a35a5eca8e5939a608cc0377e` |
| SEC parser/store and query engine | `fcb2cb2cf29eb6202dfc785a96a94e3d60e64d3d` |
| SEC example merchant configuration | `5587c81311f76e7563bf34b8eec321e34a865413` |
| SEC Applications guide | `4b442010a56da06486a1fd310879d63dac46ed6f` |
| SEC original managed operation | `fa0a79365278d65580990b00ebb09ca797590eed` |
| OData workspace guide | `cd22919de946285aac69beeef1ebd4677f748db2` |
| OData live guide | `6179ba7061a3e57aa3d4c427206779ae52f73790` |
| OData Applications guide | `a1fe74edb4810560852125d625eee148ab88f45a` |
| OData original managed receiving | `e571daa0cc1d0c725d6464d0c8145dbf05313048` |

The complete original workflow remains in [SEC Applications](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/434ccfd8b34e056f29d9e265575ff1a63cda73af/stellar/scf-starforge-20261009/distribution/runtime-workspace/SEC_EDGAR_APPLICATIONS.md), [OData Applications](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/434ccfd8b34e056f29d9e265575ff1a63cda73af/stellar/scf-starforge-20261009/sf30-seller-sdk/odata/live/APPLICATIONS.md) and [the live source contract](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/434ccfd8b34e056f29d9e265575ff1a63cda73af/stellar/scf-starforge-20261009/sf30-seller-sdk/odata/live/README.md). Customer-specific inputs and correspondence stay in the original private case.

SCF's [submission criteria](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/submission-criteria) call for a self-contained technical and market case. Its [budget guidance](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines) ties future development to defined outcomes and requires architecture before submission. This commissioning design supplies the selected resource and receiving contract before that funded customer-host work begins.
