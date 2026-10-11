# Bitwave merchant Data Fusion workshare

A complete implementation engagement connecting original merchant settlement records to a customer-owned Bitwave reconciliation data source and returning reviewed bookkeeping references to the retained merchant workspace.

**Proposed delivery:** $5,600 fixed · eight business days after agreed inputs · 50% kickoff / 50% acceptance.

The working application lives in [merchant settlement accounting](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/). Its original accountant engine owns the handoff, exact source matching, returned bookkeeping assignments and revision history. The additive Bitwave module prepares the native data-source schema and request batches, retains native delivery and row captures, and sends matched returns through that existing engine. The browser exposes the workflow at `/bitwave.html`.

## Source-qualified fit

Bitwave's [Stellar integration announcement](https://www.bitwave.io/blog/stellar-integration-completes-streamlining-accounting-reporting-for-enterprises) states that its Stellar integration is live and invites projects building on the network to contact the team. Our implementation connects merchant payment context, source report identity and reviewed external references to that existing accounting workflow.

Its [loaded-data-source contract](https://docs.bitwave.io/docs/api-loaded-data-sources) provides a native route for customer reconciliation tables. The current contract requires `idFieldName`, defines the schema when the data source is created, and recommends 250 rows per typical insertion request. The application retains exact asset amounts, identifiers and source fields as strings.

The [row retrieval contract](https://docs.bitwave.io/docs/get-datasource-rows) supplies native table rows and pagination. The application retains the captured pages, compares their source fields to the selected original handoff, and shows missing, altered, unknown or duplicate rows before returned assignments reach the accountant workflow.

Bitwave's [transaction export documentation](https://docs.bitwave.io/docs/transactions-export-1) distinguishes original transaction records from later combined transactions. Its exported original records do not contain the newly combined transaction identity. The workshare therefore carries the accountant's chosen external book reference in its own returned field alongside the original transaction evidence.

Bitwave's [official contact page](https://www.bitwave.io/contact-us) publishes `info@bitwave.io` under “Ask a Question.” Both visible contact links resolve to this same address. The page retrieval metadata is retained in `contact-source.json`. Its [accounting partner program](https://www.bitwave.io/accounting-partner-program) describes a network of accounting practices, technical support and mutual referrals. This implementation can be evaluated by the Bitwave delivery team for a concrete customer close.

The commercial fit is our proposed use of those documented capabilities. The designated customer accountant sets the chart of accounts, bookkeeping interpretation and close decisions.

## Delivery package

[WORKSHARE.md](WORKSHARE.md) defines the actual scope, inputs, schedule and acceptance. [Bitwave_Merchant_Data_Fusion_Workshare.pdf](Bitwave_Merchant_Data_Fusion_Workshare.pdf) is the two-page presentation of that offer. `sources.json` records the official source URLs and their relevance.

The unit covers one agreed report family, one customer organization and approved data-source schema, up to 5,000 source events across two monthly closes, two corrected accountant-return cycles, runnable source and operator handoff. Each close keeps its own labeled source plan and retained native result. The customer receives the mappings, original-source lineage, data-source requests, reconciliation results, reviewed return history and a recoverable workspace.
