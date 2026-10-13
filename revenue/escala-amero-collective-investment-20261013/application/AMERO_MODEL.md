# Amero collective-investment evidence and disbursement planning

This module provides the pure domain layer of the retained-source Escala/Amero operator. It has no network, persistence, clock, account signing or financial dispatch. The existing native workspace owns original response capture, immutable versions, current selection, attributed decisions, saved plans and explicit provider operations.

## Original source and supported scope

The Escala source is the complete 39-file public collective-investment-api repository at ca9ae6256fdbf7786e20b4c2b2926ce179468944, its OpenAPI, and the original version 1.1 architecture. The repository identifies its service responses as mock logic. The implementation preserves apiMode=mock and published-mock execution semantics. An operator-configured tenant selector is retained as routing context; the original Express application does not authenticate it.

The full SCF44 submission describes treasury, voting, milestone verification and SDP integration. The domain retains those roles without deriving an unstated voting policy, oracle verification method or deployed MoneyGram/SDP integration. The selected mock has no project router and no implemented webhook router. Project IDs can be retained as book filters; a nonexistent project resource is not synthesized.

The SDP source is the exact complete official 21-file API/Go snapshot retained alongside this guide. Its instruction validator, amount bounds, registration types, source-account API and original payment/receiver schemas determine the preparation interface. Amounts use the unchanged exact-decimal and original-JSON helpers from the maintained payment workbench.

## Pure API

All four exports are synchronous:

- normalizeBook(input)
- normalizeLinkDecision(input, {book, versions, sources, decisions})
- reconcilePayments({book, versions, history, sources, decisions, coverage})
- normalizeDisbursementPlan(definition, {book, versions, sources, decisions})

AMERO_CONTRACT exports the exact resource kinds, result arrays and relation labels. RESULT_ARRAYS is the complete stable report roster. The reconciliation schema is amero.reconciliation.v1.

### Book

A book has id, name, environment (sandbox or production), connections {escala:[], sdp:[], horizon:[]}, tenantId, communityId, fundId, projectIds, proposalIds, milestoneIds, distributionWalletIds, period {start,end,timeZone}, and notes. Nullable scalar scope fields retain null. Arrays contain explicitly selected original IDs. The half-open period is [start,end); timestamp fractions are compared exactly, and timeZone is an explicit valid display timezone. No server clock or inferred local date changes membership.

Rows outside the chosen provider connection/environment are reported as excluded source gaps. Available original scope IDs are checked against filters. A missing parent field is an unresolved scope, not evidence of a match. Native response cells remain intact; request params, original request body and response-envelope IDs provide separately retained relationship context.

### Source and row contract

Each version preserves id, kind, provider, resourceId, sourceId, sourceScope, environment, connectionAlias, original value, numberTokens and context. Each supporting source must contain the complete body and request SHA-256 receipts, exact source scope/environment, accepted projection, no projection/provider error, and the selected version ID. Original request/body digests remain source receipts.

Every ordinary result row carries id, kind, versionId, observedVersionIds, resourceId, sourceId/sourceIds, sourceScope, environment, connectionAlias, original providerStatus, domain status, original, numberTokens, context, checks and relatedVersionIds. apiMode and executionSemantics are retained. The domain status MATCH/UNKNOWN/MISMATCH describes its evidence checks. It is not a provider transaction state or an approval.

The 28 arrays are communities, funds, contributions, tokens, proposals, votes, milestones, evidence, attestations, disbursementRequests, disbursements, sdpDisbursements, payments, receivers, wallets, assets, settlements, events, allocations, decisions, rejectedDecisions, totals, findings, sourceGaps, distributionWallets, balances, capabilities and organizations. Every array exists even when empty. The report retains all original fields and exact source spellings.

Identical selected observations of one scoped resource share one economic row and preserve all selected version/source IDs. Conflicting observations remain full separate rows with unresolved identity. The native selection-conflict ledger remains visible. History is used only for exact supporting evidence and decision references; it does not silently replace the selected current resource.

## Money and governance

Contributions are observed principal records. Token mints, token balances and voting weights are distinct non-cash measures. Dashboard and fund totals are source summaries. An Escala executed label is a mock release observation. None is added to SDP payment cash.

SDP payment rows are the counted payout layer. A SUCCESS payment is reported as observed successful payout only when its selected source, exact amount, asset and period evidence are usable. Other provider states remain observed nonfinal. Missing/invalid dates, conflicting sources, unresolved selected-wallet scope and unproven amounts remain in an explicit unresolved-evidence-or-period bucket. The known subtotal is labelled amountBasis and unquantifiedVersionIds retain every row with an unavailable amount. Totals group by original scope, environment, network and exact asset; they never sum different issuers.

Totals cover selected original observations. This edition does not turn a terminal capture, stream, dashboard or subset into a complete population. populationComplete remains false, and sourceGaps describe that limit. Complete source response pages and the native capture history remain available to the operator.

SDP disbursement statistics are retained separately. The official implementation rounds some summary amounts to two places; those values do not overwrite exact individual payment sums. Receiver-nested payments are retained evidence and are not counted again.

Tally weights, the reported result, snapshot IDs, attestor labels, evidence hashes and supplied signatures are preserved. The module does not infer electorate completeness, quorum, delegated voting authority, one-person-one-vote eligibility, cryptographic signature validity or oracle authorization from those values.

## Attributed decisions

A normalized decision is:

    {bookId, subjectVersionId,
     kind: "note"|"include"|"exclude"|"relate"|"allocate"|"withdraw",
     status: "proposed"|"accepted"|"rejected",
     targetVersionId:null, relation:null,
     subjectAmount:null, targetAmount:null, unitBinding:null,
     reason, actor, recordedAt, sources:[], supersedesDecisionId:null}

The native writer supplies the decision ID and stores the full immutable body under its existing request/revision transaction. A successor must follow the actual unique current tip for that subject. Proposed and rejected successors preserve the most recent accepted ancestor. An accepted withdrawal removes that lineage's effect. Forked/cyclic histories are unresolved. Independent include/exclude decisions that conflict remain unresolved rather than applying iteration order.

Accepted relate labels are community-fund, proposal-milestone, proposal-vote, milestone-evidence, milestone-attestation, milestone-disbursement, disbursement-sdp, disbursement-payment, and payment-settlement. Each has a fixed source/target kind constraint. A reviewed relation supplements the report without rewriting original provider fields or conferring authorization.

An allocate decision is only an SDP payment to a Horizon operation. It requires exact positive equal subjectAmount and targetAmount in the same asset, with no inferred exchange rate. unitBinding is:

    {network, assetType:"native"|"credit_alphanum4"|"credit_alphanum12",
     assetCode, assetIssuer:null, account,
     memoType:"none"|"text"|"id"|"hash"|"return", memo:null}

The original SDP asset, source distribution account, recipient address, successful payment, transaction hash and operation ID must agree with the selected Horizon operation, independently selected network root, successful transaction and exact memo. Supporting source completeness includes the selected distribution wallet that supplies the source account. Excluded or conflicted payment/settlement selections cannot allocate. Identical retained transaction observations share one proof while preserving all version/source IDs; conflicting historical bodies remain unresolved. Outgoing path-payment destination amount does not prove source spend and remains unresolved.

All accepted allocations are evaluated together against payment and economic-operation capacities. A duplicate alias cannot multiply an operation's available amount. Over-allocation prevents the competing set from consuming capacity; there is no first-writer-wins accounting. An accepted note or inclusion cannot bypass missing original proof.

## Full recipient plan

The definition is:

    {name, milestoneVersionId, proposalVersionId:null,
     approvalVersionIds:[], evidenceVersionIds:[], treasuryVersionIds:[],
     distributionWalletVersionId, assetVersionId,
     recipientWalletVersionId:null, registrationContactType,
     verificationField:null,
     rows:[{phone,email,id,amount,verification,paymentID,
            walletAddress,walletAddressMemo}],
     note}

All recipient fields and amounts are strings. The saved definition retains those original values. The derived CSV applies the original provider's trimming/case normalization separately and uses RFC4180 quotes. It does not insert spreadsheet-protection apostrophes into machine fields: a plus-prefixed E.164 number stays exact.

The return is {definition,versionPins,csv,createInput,findings,totals,status}. Pins include each complete originalVersion and originalSource metadata body, source/scope/environment, body/context identity and original source request/body hashes. createInput is the original request wrapper {params:{},query:{},headers:{"X-Wallet-Id":...},body:{name,asset_id,registration_contact_type,wallet_id?,verification_field?}}.

PREPARED means locally valid complete instructions with selected original source/account/asset bindings. NEEDS_REVIEW retains the same complete plan, rows, CSV, findings and source pins for editing/export. Neither state is financial approval. Mock evidence and unresolved governance policy remain clear nonblocking findings because preparation itself does not dispatch.

The source distribution wallet must be ACTIVE with an ACTIVE underlying account and a valid original Stellar address. Its source connection must match selected SDP asset and recipient-provider evidence. The exact asset issuer is preserved; no default USDC issuer is supplied. An account-specific asset response cannot be rebound to a different distribution wallet.

Registration types are EMAIL, PHONE_NUMBER, EMAIL_AND_WALLET_ADDRESS, and PHONE_NUMBER_AND_WALLET_ADDRESS. Contact type with a wallet address forbids recipient provider and verification field; contract addresses forbid memos. Without addresses, the actual recipient provider and original verification rules apply, including the embedded-wallet exception. Valid complete Stellar public-key/contract encodings are checked including checksum.

Instructions contain at most 10,000 rows, and the CSV plus complete deterministic multipart framing is bounded to the original 5,000,000-byte request limit. multipartBoundBytes conservatively covers the boundary collision extension for any later selected disbursement ID. Amounts are positive decimal strings with at most seven decimal places and at most 922337203685.4775807, the scaled signed-64-bit bound. Identifiers retain the original 64-character constraints. Exactly one contact per row and unique normalized contacts are required.

PIN validation counts UTF-8 bytes (4–8), national ID up to 50 bytes, and supplied birth/year-month values must be valid calendar strings. The provider's current-date check and libphonenumber validation remain explicitly identified server checks. A supplied memo is retained for the original SDK memo validator. No local approximation is presented as complete provider acceptance.

The instruction upload is a whole replacement: the official implementation deletes existing DRAFT payments for the selected disbursement, creates this full supplied set, persists the original CSV and changes the disbursement to READY. The operator must inspect the complete file and selected current disbursement before its separate native operation. Save/preparation never invokes it.

## Validation and commissioning

The source-only course exercises eighteen meaningful full-domain paths: exact settlement allocation, mock/cash separation, original numeric precision, unknown period totals, decision rejection/withdrawal, set-wide capacity, transaction/recipient conflicts, failed projection, full source-pinned CSV, duplicate/precision/bound failures, plus-prefixed phone preservation, cross-connection rejection, exact fractional boundaries, auxiliary arrays, linked-wallet proof, target selections, identical transaction history, unresolved account/amount totals and full plan-edition pins. It uses explicitly authored records and reports that origin. These are implementation checks, not merchant/provider or native commissioning evidence.

Actual commissioning uses supplied original sources and the maintained native operator: save the book; capture/import whole selected responses; select current original versions; inspect all rows, evidence and findings; save attributed relationships; save/download/reopen the entire recipient plan; prepare the original provider request; review and explicitly dispatch only under the actual account's authority; capture original outcomes; reconcile the exact selected payment and Stellar evidence; export/open the full recipient report and portable workspace. Preserve the existing request journal and all later customer history.
