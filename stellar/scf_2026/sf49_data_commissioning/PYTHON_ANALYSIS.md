# Commission a buyer's recurring analysis and workbook

This is the downstream customer workflow for the existing [SEC and OData commissioning design](README.md). The receiving team turns an acquired result into a saved analytical decision, a reviewed workbook edition and a product another operator can reopen. The original merchant, Buyer, AnalysisWorkspace, workbook client and managed Applications retain the work.

For a company-data customer, the useful task might be reviewing selected reported concepts before an investment or credit decision. For an operational-data customer, it might be reviewing a complete order collection before a period close. Agree the decision and its refresh cadence before choosing a merchant resource. The workbook's source window, units and treatment of changed records then have a concrete meaning.

The implementation uses the [original Python buyer](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/e28755f20dd4f9cb932d82fb59feb48424e327e7/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/README.md), [customer workbook engine and client](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/e28755f20dd4f9cb932d82fb59feb48424e327e7/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/WORKBOOK_DELIVERY.md), and [native agent workbook interface](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/93a3966b5ae41336d3d687e1daf4504676a4d4ee/stellar-forge/mcp-paid-agent/WORKBOOKS.md). The exact source selection and current operated outcomes are recorded below.

## Agree the customer job

Keep these choices in the existing installation workorder. A receiving engineer should be able to complete the agreed task from this description.

| Decision | Company-data consumer | Operational collection consumer |
| --- | --- | --- |
| Useful result | Selected company, concept and unit, with its complete reported observations and accession history. | Selected company/service and entity collection, with declared entity keys and the complete accepted query. |
| Time meaning | Filing-date window and reported-period window are separate selections. Retain both when relevant. | Identify source acquisition time and business/event date separately; agree the period filter and timezone. |
| Refresh reason | A new filing, corrected source or explicit analytical selection. | A new complete collection, corrected source or approved query change. |
| Comparison rule | Keep accession and source index. The analyst explicitly selects how to treat restatements and duplicate period observations. | Compare by the provider's declared keys only after reviewing schema, query and collection completion. |
| Exact representation | Retain the original number spelling, unit, null fiscal fields and dates. | Retain Decimal/Int64 text and the original value/null/missing state. |
| Acceptance | The receiving analyst can explain the chosen observations and reopen both delivered editions. | The receiving operator can reconcile the complete selection, explain its changes and reopen both delivered editions. |

Use the SEC and OData source contracts in the parent guide. A change to a query, projection, key, unit or mapping is an analytical change to review. Record that change beside the source edition so an apparent addition or removal has an intelligible cause.

## Install the selected customer runtime

The host chooses one complete source release and its original installer receipt. The source commit, source manifest, Python interpreter and selected package cohort are distinct retained identities. Use the maintained Python runtime controls in the received Runtime workspace to review, resolve, install and inspect the customer's environment.

Select the declared `workbooks` extra for Excel delivery. Select `agents` when the customer uses the existing typed LangChain tools or persistent LangGraph customer workflow. The resolver retains the complete selected wheels and hashes for that interpreter. Installation checks the original entrypoints, package metadata and dependencies. The managed Analysis application binds the inspected private environment belonging to that received runtime.

The full [Python receiving operation](../../scf-starforge-20261009/distribution/python-runtime/NATIVE_RECEIVING.md) covers the original source installer, exact wheel cohort, primary installation, offline transfer, customer copy and managed Applications lifecycle. It also records actual wheel and expanded byte requirements before the receiving host starts its workload. Use that source-owned operation for a new receiving environment.

The customer application owns its private database and original launch control. In Applications, select that database and the inspected Python runtime, review and save the Analysis entry, then Start and Open. Stop drains the owned service; reopening preserves the original database and uses the new service's actual private launch capability.

A host that already has the selected environment can use the original CLI:

~~~sh
/absolute/installed/python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer/analysis \
  --checkout /absolute/received/source \
  --node /absolute/selected/node serve --port 0
~~~

The command reports its listening address and private launch-file location. Keep the private URL and customer paths with that host. A workbook client reads the current launch record when it connects.

## Bring the acquired result into Analysis

Use the original complete purchase result or acquisition. Keep the merchant/source edition, request, payment intent, response and receiving decision attached to it.

### Original dataset acquisition

A complete captured dataset is registered by its original native session. Registration inspects that retained session and does not start another acquisition.

~~~sh
/absolute/installed/python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer/analysis \
  --checkout /absolute/received/source --node /absolute/selected/node \
  source --name selected_collection \
  --session /private/customer/original-dataset-session
~~~

Open Sources in Analysis. Review the registered source revision and its complete rows, then use the existing import workflow to choose the column mapping and create the typed edition. A changed source registration uses the original expected revision.

### Original paid HTTP or MCP result

For an SEC HTTP query or a selected OData live response, register the original Buyer configuration and result through the existing response adapter:

~~~sh
/absolute/installed/python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer/analysis \
  --checkout /absolute/received/source --node /absolute/selected/node \
  response --name selected_response --input-kind buyer \
  --config /private/customer/original-buyer-config.json \
  --result /private/customer/original-buyer-result.json --format json
~~~

A retained native MCP result uses the same command with `--input-kind mcp` and its original `--manifest /private/customer/original-result.meta.json`. The browser's response mapping workflow reviews the actual row selection, types and schema before creating the edition.

For a paginated live OData task, retain the ordered original response chain and terminal continuation alongside the individual page intents. Register the required original responses, select their actual row mappings, and save the analytical query over the intended complete set of typed views. The customer job's complete result and the individual page payments stay linked. A short page alone does not establish completion.

The response CLI's complete source options are defined in the [original AnalysisWorkspace](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/e28755f20dd4f9cb932d82fb59feb48424e327e7/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/stellar_forge_buyer/analysis_workspace.py). Existing typed-stream and object receiving use their own original source records through that same adapter.

## Save a useful analytical result

In Analysis, inspect the imported views and their source identities before authoring the query. Save its SQL and typed parameters, then execute it against the reviewed view set. Create the complete query export for the customer selection. The original export's manifest and typed JSONL are the workbook source; the earlier screen preview can contain fewer rows.

For SEC facts, keep the columns the customer needs to understand each observation: `cik`, `taxonomy`, `concept`, `unit`, `value`, `valueType`, `start`, `end`, `accession`, `filed`, `form`, `fy`, `fp`, `frame`, `sourceIndex` and `unitIndex`. Preserve the original scalar text. Any customer calculation needs an explicit unit, precision and restatement policy. A display conversion to a spreadsheet number is a separate choice.

For a captured OData Orders selection, preserve the declared key with the chosen business columns. The sample workbook includes `OrderID`, `CustomerID`, `OrderDate`, `Freight` and `Freight_state`. The query must expose those exact labels from the selected typed edition. Retain the original state columns for nullable or absent properties.

A saved report can combine multiple original queries and explanations. Publish the selected report before choosing its sections as workbook sources. If a report repeats a column label, preserve the original zero-based position with that label. The workbook engine checks the pair.

## Deliver the reviewed workbook

The ready recipe shapes are:

- [SEC observation workbook](sec-workbook.recipe.example.json), selecting one complete query export with the listed observation fields.
- [OData Orders workbook](odata-workbook.recipe.example.json), selecting one complete query export with the declared key, exact freight text and state.
- [Recurring SEC edition](sec-workbook-refresh.recipe.example.json), selecting a newer complete export for the existing worksheet.

These are original `WorkspaceWorkbookClient` inputs. Replace each source ID and digest with the actual values from Workbooks → Sources or its source API. Set the expected definition revision from the current saved workbook. Review the source labels against the recipe before saving; adjust the recipe to the actual approved projection.

The examples use `decimal-text` for an OData Decimal and plain text for the SEC observation value, preserving the source's own spelling. Identifiers remain text. Explicit null labels keep nulls visible in the delivery. Source strings beginning with a formula marker remain literal text under the original workbook writer.

Run the existing complete delivery client:

~~~sh
/absolute/installed/bin/stellar-forge-workbook-deliver \
  --database /private/customer/analysis \
  --recipe /private/customer/selected-workbook.json \
  --operation /private/customer/workbook-delivery
~~~

The client retains one save request and one build ID, downloads the complete workbook, manifest and ZIP, verifies them, receives the handoff and writes its delivery result. Repeating that exact command continues the same retained operation. A different intended definition uses its own operation directory.

Use the Workbooks browser for the equivalent source selection, cell preview, build progress, cancellation, history and authenticated downloads. Full builds iterate every selected source row. A conversion failure remains attached to the original build and is corrected through a reviewed definition.

### Native agent access

Register the existing database with the customer's original authenticated native MCP host:

~~~sh
node /absolute/received/source/stellar-forge/mcp-paid-agent/native-workspace-cli.mjs \
  analysis-register --dir /private/customer/mcp \
  --name customer --database /private/customer/analysis
~~~

Agents use the `customer` alias and the existing `analysis` action. The maintained tools expose source picking, definition review, build progress, complete file ranges and recurring-edition review. The host resolves the private database and service capability.

A first source request is:

~~~json
{
  "action": "analysis",
  "analysisWorkspace": "customer",
  "analysisOperation": "workbook-sources",
  "analysisRequest": {"kind": "query-export", "limit": 25}
}
~~~

Use returned original IDs, digests and cursors. The [native workbook guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/93a3966b5ae41336d3d687e1daf4504676a4d4ee/stellar-forge/mcp-paid-agent/WORKBOOKS.md) specifies the complete save, refresh, file-range and cancellation envelopes.

The optional Python agent customer follows the original Buyer intent through its own persisted review and result state. A host registers the original intent with `CustomerWorkflow`, opens the saved review and continues its exact review key. Its typed tools read the verified result and export a complete handoff. `AVAILABLE` describes the retained customer data; the original transaction and response records retain the financial and HTTP outcome. See [the complete agent customer](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/e28755f20dd4f9cb932d82fb59feb48424e327e7/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/AGENT_CUSTOMERS.md).

## Refresh the same customer decision

Open the saved workbook and choose Review newer sources. Candidate query exports follow the original SQL and typed parameters; candidate report sections follow the original report/query lineage. Inspect the before/after view bindings, row counts, column labels and actual cells.

Keep every existing worksheet in order. For each changed worksheet, select the intended complete source, resolve renamed or duplicate columns, and record the reason. Keep the original source and mapping for each unchanged sheet.

The existing client consumes the complete reviewed recipe:

~~~sh
/absolute/installed/bin/stellar-forge-workbook-deliver \
  --database /private/customer/analysis \
  --refresh-recipe /private/customer/selected-refresh.json \
  --operation /private/customer/next-workbook-edition
~~~

The client retains the review, its digest, save identity and build identity. A stale expected revision asks the operator to review the current workbook; the same committed save can be recovered after a lost response. The new handoff retains its original predecessor definitions and their complete source files.

This is the repeat-use proposition for commissioning: a customer returns when a new source edition helps the same decision. Retained history lets the customer explain what changed. A workbook rebuild or an offline opening is recorded as that action; useful new acquisitions retain their own original purchase records.

## Hand the result and application to another operator

Choose the receiving scope with the customer.

| Receiving scope | Complete input | Original receiving route |
| --- | --- | --- |
| Delivered workbook | Selected handoff ZIP, archive SHA and manifest SHA. | Original workbook receive/inspect; includes selected typed sources and refresh-definition history. |
| Working analytical application | Complete closed customer database directory and all referenced query, report, workbook and external source cohorts. | Original private workspace copy/recovery; preserve workspace and job identities. |
| Python execution environment | Exact wheel cohort, source/runtime selection, interpreter compatibility and installation receipts. | Original Python bundle/receive/install and managed Applications binding. |

The workbook recipient can open the Excel file directly or inspect the retained analytical delivery offline:

~~~sh
/absolute/installed/python -m stellar_forge_buyer.analysis_workbooks receive \
  --archive /private/receiving/handoff.zip \
  --destination /private/receiving/workbook \
  --sha256 ORIGINAL_HANDOFF_SHA256

/absolute/installed/python -m stellar_forge_buyer.analysis_workbooks inspect \
  --delivery /private/receiving/workbook \
  --manifest-sha256 ORIGINAL_MANIFEST_SHA256
~~~

The receiver publishes a complete new destination without replacing an unrelated directory. Repeating the selected operation recovers its own interrupted receiving state.

A complete application transfer keeps referenced files with the database. Retained job records can contain a producer directory as historical provenance. Receiving opens the files beneath the selected receiving database using the validated job identity. It does not rewrite the producer's result or follow its old host path. The managed receiving operation reopens the same application with the actual received runtime, then closes its owned services.

During handover the second operator opens the selected result, explains one precision/null mapping, reviews one source change and finds the previous edition. They reopen a completed delivery after the merchant connection is unavailable, then demonstrate the agreed restore and service restart. Record acceptance and support corrections in the original workorder.

## Demonstration sequence for the existing SCF presentation

The current product/team film demonstrates a paid MySQL result. Use this customer sequence as its live or recorded continuation when the chosen analytical state is available. Keep the filmed purchase, workbook reference case and selected commissioning case identified individually.

| Scene | Operator action | What the viewer learns |
| --- | --- | --- |
| Useful result | Open the original acquired result and explain the selected business decision, source window and complete row count. | Stellar payment acquired a defined operation whose output reaches an actual customer workflow. |
| Analytical selection | Show the saved query, typed parameters, source views and complete export. | The customer can explain which acquired records support the decision. |
| Reviewed workbook | Open the original definition and preview one exact decimal, identifier and null mapping; open the completed workbook. | Source meaning and complete output survive spreadsheet delivery. |
| Next edition | Reopen the original definition, review a selected successor and show the retained earlier edition. | The customer has a reason to return and a way to explain change. |
| Receiving operator | Receive the complete handoff, inspect its sources and reopen the saved application or workbook offline. | Another operator can use and maintain the delivered work. |

The original workbook continuation already delivered seven data rows across three sheets with the exact `599.010000` sales value, then reopened both historical editions. The reference sheets are Wikimedia events (three rows), Sales summary (one row) and Wikimedia report (three rows). The original handoff has 17 manifest-declared payload files, a 34,623-byte archive and a 10,046-byte workbook. Its published source and native continuation are [PR1372](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1372) and [PR1385](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1385).

The complete installer/managed Python receiving extension is carried by [PR1379](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1379) and the original continuing [PR1546 operation](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1546). Use its final original receiving result for installation-specific demonstration figures when that operation completes. The customer workbook result above has its own retained completed provenance.

## Fit this work to the existing grant cohort

The original application retains its two merchants, two buyers, two facilitators and six funded work packages. The current requested scope is 400 prospective hours / $38,000 over 150 days from award acceptance. This consumer design assigns concrete customer work to those packages.

| Existing work package | Remaining customer-specific analytical work |
| --- | --- |
| T1 merchant-resource integration | Select and map the actual source/consumer, configure the customer's runtime and finish one useful query/workbook delivery from the agreed paid resource. |
| T1 authority and handover | Complete the agreed source/terms change and transfer the operating workflow to the second accountable operator. |
| T2 provider and ledger deployment | Carry the same useful acquisition through the selected facilitators; retain its native payment and complete consumer result together. |
| T2 deployed threat response | Resolve actual source, payment/delivery and receiving failures on the installed host, preserving the original unfinished operation. |
| T3 mainnet merchant rollout | Operate the agreed recurring customer task on its mainnet configuration and retained production releases. |
| T3 production recovery and handover | Restore the whole agreed customer state/runtime, reconcile later work and complete independent maintainer support. |

Keep useful acquisition counts in the original purchase register, workbook editions in their original history, and installation/correction/support effort in the existing case. This supplies a usable pricing and support history for later commissioned integrations.

The [application insertion](PYTHON_APPLICATION_TEXT.md) is self-contained so reviewers can understand this customer use without opening implementation links. This follows the official [SCF submission criteria](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/submission-criteria) and [budget/deliverable guidance](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines): define the technical plan and funded outcome in the application itself. The original manuscript remains the budget and cohort authority.

## Source and outcome selection

| Maintained component | Source identity used for this design |
| --- | --- |
| SEC/OData commissioning and customer contracts | PR1764, merge `ce715128ad66cefa921b9ebba1bd7f7599c706d8`. |
| Python Buyer, AnalysisWorkspace, recurring workbook and agent customer | Release `e28755f20dd4f9cb932d82fb59feb48424e327e7`, containing merged PR1372. |
| Workbook delivery guide | Git blob `a6535c4966fde3ef1b61d7a8c602ee7e508c9c9e`. |
| AnalysisWorkspace source and native CLI | Git blob `30b371f08d00ee848e7456b779ac61b0298e60c5`. |
| Python agent customer guide | Git blob `bf5069b6c9dfdae497db4c1eee06661fbbf58626`. |
| Native MCP workbook receiving and producer-path correction | `93a3966b5ae41336d3d687e1daf4504676a4d4ee`; guide blob `897fb35941f995492004c137f4af9648da1e16e9`. |
| Managed Python runtime and Applications | Merged PR1379; complete original customer receiving continues in PR1546. |

Private customer inputs, launch capabilities and complete customer databases stay in the authorized customer workspace. Public source contains these operating instructions and example shapes; the chosen customer supplies its actual retained IDs and files.
