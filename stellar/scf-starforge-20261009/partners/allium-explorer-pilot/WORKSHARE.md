# Proposed paid Allium customer integration

**Offer for the existing commercial owner to scope with Allium: USD 2,800 fixed fee, six business days after access and acceptance terms are agreed.** This is a proposal, not an accepted contract or booked revenue. The software already published in this repository is the starting implementation; the fee is for the customer-specific query, deployment, integration and handoff below.

## Buyer problem and delivered result

An Allium customer with rights to a selected Stellar dataset wants a usable, priced data product for approved buyers. They need a controlled query/export path, exact field handling, predictable provider usage, buyer pagination, source refresh, native payment behavior and delivery/reconciliation visibility in one working implementation.

Deliver one customer-controlled Stellar transaction dataset route backed by an approved saved Explorer query. A private acquisition job prepares the dataset; the existing Stellar merchant stack serves approved projections and paginated results. Refreshing data preserves the original route and payment terms and lets active readers finish on retained snapshots. Allium access remains a provider/customer concern, and native Stellar payment and fulfillment remain the existing merchant product's concern.

Allium's [Consulting & Services and Technology Alliance programs](https://www.allium.so/partners) provide a relevant commercial route for implementations and complementary products. There is no evidence yet that Allium has approved this pilot or allocated budget. This offer is suitable for Allium-funded integration work or an introduced customer whose scope and data rights match the deliverable.

## Included work

| Delivery | Customer-specific scope | Acceptance output |
| --- | --- | --- |
| Approved source product | One saved Explorer query against the agreed current Stellar schema; up to twelve projected fields; explicit window, limit, precision and allowed use | Actual customer query ID, approved projection, successful provider result and documented source selection |
| Acquisition and refresh | API-key integration or authorized JSON export, existing run recovery, private output, result limits, original versioned dataset promotion | Successful real acquisition and a later refresh with unchanged published route/payment tuple |
| Merchant integration | One original SF30 seller route, actual approved Stellar asset/recipient/amount, testnet facilitator and signer, customer HTTPS staging environment | Genuine native testnet challenge, authorized buyer payment, delivered dataset page and existing merchant fulfillment record |
| Operator and buyer handoff | Existing dataset workspace, one prepared buyer query, pagination/refresh instructions and existing support/reconciliation views | Operator repeats acquisition/publish; buyer continues the same snapshot; delivery is traceable in the original product |
| Transition | Configuration walkthrough, written operating notes and one remediation pass for scope defects found during acceptance | Customer's designated owner receives working source/configuration and can repeat the agreed workflow |

The query and staging limits are set to the actual customer's result size and provider allowance. The current adapter's single-result response ceiling is 1 MiB through the original hardened transport. A result reaching its row limit is explicitly reported; it is not silently treated as a complete period. Large-history bulk exports or a different delivery contract are a separate scope.

## Work plan and price

Days 1–2: confirm source authorization, saved query, data contract, projection and actual result handling. Days 3–4: configure and operate the existing merchant route and testnet buyer/fulfillment flow in the customer staging environment. Day 5: run a new source generation, confirm retained-reader continuity, connect existing operator views and fix integration defects. Day 6: complete customer acceptance and operator handoff.

Proposed milestones are **USD 1,400 after source/product acceptance** and **USD 1,400 after merchant/buyer/operator acceptance**. The six-day estimate assumes roughly twenty hours of customer-specific engineering with timely access and feedback. Allium credits, hosting, native transaction costs and customer-selected services are separately approved customer costs; this offer creates no subscription or automatic charge. The existing source work is not counted as newly funded work or promised again as a grant milestone.

## Inputs agreed at kickoff

The customer or Allium supplies a technical owner, exact permitted data and use, one approved saved query or export, scoped API access if live acquisition is selected, a customer staging host, approved public payment terms and existing testnet signing/facilitator access. The commercial owner agrees IP/license treatment for customer-specific work, milestone acceptance and payment method before paid execution. Raw provider credentials and private exports stay in the operator environment.

The proposal covers one provider, one query product, one native merchant route and one staging deployment. Changes to those quantities, pubnet go-live, compliance conclusions, a new database/indexer, high-volume historical export, custom dashboards or ongoing support are separately scoped. These are delivery definitions for a priced engagement, not restrictions on the swarm's ability to continue useful engineering.

## Source and technical decision

Allium's [documented saved-query execution](https://docs.allium.so/api/explorer/run-query) returns a run ID. Its [status endpoint](https://docs.allium.so/api/explorer/fetch-query-run-status) reports an execution state, and its [results endpoint](https://docs.allium.so/api/explorer/fetch-query-run-results) returns the source metadata and row objects. The adapter implements this exact operator sequence and produces the original SF30 dataset format.

The [current Stellar RPC migration notice](https://docs.allium.so/changelog/deprecated-stellar-v1) is the reason the starting query uses `stellar.raw.transactions_v2`. The [current machine-payment documentation](https://docs.allium.so/ai/machine-payments/endpoints-pricing) lists other settlement networks; the offer is to integrate an approved Allium data source with the already existing Stellar merchant, not to claim Allium already supports Stellar-native settlement.

The next relationship conversation can show `cli.mjs`, the generated dataset in the original workspace, the native seller's actual offer and a refresh. The owner should ask which approved dataset and introduced customer would justify a paid implementation, then use the agreed scope above. All further contact belongs in the existing Allium relationship thread.
