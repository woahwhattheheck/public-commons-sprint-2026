# Paycashless retained-source reconciliation model

## Runtime and public API

lib/paycashless.mjs is a synchronous, pure ES module. Its three exports are normalizeBook(input), normalizeLinkDecision(input,{book,versions,sources,decisions}), and reconcilePayments({book,versions,history,sources,decisions,coverage}). It uses the unchanged maintained lib/source-json.mjs and lib/decimal.mjs. The host keeps current-tip normalization and accepted decision publication inside the same original SQLite transaction. The model starts no provider call, stream, timer, database, process or financial operation.

The frozen paycashless.integration-contract.v1 remains the API. A book preserves logical identity, sandbox/production, explicit Paycashless/Horizon aliases, original createdAt or updatedAt period basis, inclusive start/exclusive end and supplied display time zone. Timestamps retain the exact input and compare all supplied fractional-second digits without rounding to milliseconds. ID filters remain explicit. A missing relationship needed by an invoice/payment filter yields filterMatch:null, retains the row and keeps its values outside conclusive selected totals.

Native versions retain id, resourceId, kind, provider, sourceId, sourceScope, environment, connectionAlias, complete value, complete relative numberTokens and original context. Original resource IDs never substitute for immutable version IDs. Every selected original is preserved in its row or the source/version inventory. Identical observations keep observedVersionIds and count once per scoped resource; conflicting observations remain full rows marked ambiguous. History remains history and is not automatically selected as current by arrival.

## Exact money and accounting layers

Numeric API values are read from their original numberTokens. No rounded JavaScript Number is converted back into an accounting value. Raw monetary source strings use the maintained decimal bounds. Internal canonical arithmetic uses BigInt coefficient and scale and therefore supports their exact expanded values and accumulated sums. Integer minor-unit fields must be integers; payment fee/vat/emtl retain the API's number-valued fields without invented rounding.

Invoices expose their reported due/paid/remaining/overpaid/subtotal/tax fields, every complete item, exact price-times-quantity subtotal and all original tax-rate data. Remaining and overpaid checks use the issued fields. No undocumented per-line tax inclusion, allocation or rounding rule is invented.

Invoice-payment rows preserve paid, requested/paid minor amounts, invoiceId and intentId. They compare exact selected invoice and intent versions in the same provider scope and environment. A paid instalment requires an observed succeeded intent for that relation check. Multiple instalment rows naming one intent remain an unresolved relation; cash is still counted only once at the payment-intent layer.

The complete invoice instalment sum requires an original COMPLETE paycashless.invoice-payments.list capture for input.params.id, with no initial cursor/date/membership filters, terminal next:null, all page source receipts, original source.requestInput invoice binding and every full projected page version included in selection. Missing or filtered population remains UNKNOWN even if a visible subtotal happens to agree. The observed subtotal/count and full source evidence remain visible. maxInstallments and supplied acceptPartialPayments are checked without manufacturing unseen instalments.

Only succeeded payment-intent rows contribute to the collection role. Invoices use invoice-stock; instalments use instalment-evidence/paid or unpaid; payouts have their own payout role. Pending, charged, sent, reversed, failed, cancelled and expired states retain their original separate roles. Consumers must not add these independent roles together as new revenue.

Fee, VAT, EMTL and stamp duty remain separate reported values. No implicit net-fee deduction, refund from a reversed status, foreign exchange, currency scale or bank balance is inferred.

## Result shapes

The result schema is paycashless.payment-reconciliation.v1. Arrays: rows, invoices, invoicePayments, payments, payouts, accounts, settlements, events, allocations, exceptions, totals. Full coverage/source/version/history/link inventories accompany them.

Callback events are source-evidence records rather than accounting rows. Their complete output fields are id, versionId, resourceId, sourceId, sourceScope, environment, eventType, eventTypeAuthenticated:false, verifiedData, authenticatedFields, observedAt, original, numberTokens, webhookId, sourceBodyComplete and semantics. They deliberately do not assert a native business status, amount, currency or period membership. This specializes the initial integration contract's common-row wording for the actual signed callback projection.

A common accounting row has id, versionId, observedVersionIds, resourceId, sourceId/sourceIds, sourceScope, environment, connectionAlias, kind, original status/currency, inPeriod:true|false|null, filterMatch:true|false|null, amounts, checks, full original and numberTokens, relatedVersionIds, excluded, selectionAmbiguous, allocationIds, allocatedAmount, remainingAmount and evidenceState. Each check has code and state MATCH|MISMATCH|UNKNOWN, plus complete evidence. Reconciliation state is separate: PROVIDER_CONFIRMED, RECONCILED, PARTIAL, UNALLOCATED, NOT_FINAL, UNKNOWN, EXCLUDED or OUTSIDE_SELECTION.

Totals are unit-separated objects:
{sourceScope,environment,currency,unit:"minor",role,values:{count,amount,...},versionIds}.
Their amount-like values are exact decimal strings. A missing value adds an explicit <field>UnknownCount; it never contributes a zero. Unknown period, filter membership, resource identity, units or evidence use distinct unresolved-* role prefixes. These observed amounts remain useful without presenting them as proven selected-period collections.

Invoice additions: lineItems, computedLineSubtotal, taxRates, invoicePaymentVersionIds, selectedPaidInstalmentSum/count, selectedInstalmentCount, maxInstallments and instalmentCoverage. The selected sum is a diagnostic even when whole-population proof is absent.

All native provider statuses remain exact. No check overwrites original source fields.

## Explicit Stellar allocations

The book chooses provider or stellar as reconciliation basis. Provider confirmation and independent chain evidence remain separately visible. An allocation can select only a native payment or payout and an exact selected Horizon operation. Allocation provider amount is a positive integer minor-unit string; settlement amount is a positive Stellar decimal with at most seven decimal places. An explicit positive conversion rate and nonempty original evidence source IDs are mandatory, even when a human considers the unit scale obvious. Exact settlementAmount times rate must equal allocationAmount.

The binding retains currency, providerUnit:"minor", exact asset type/code/issuer, network passphrase, account, incoming/outgoing direction, memo type and memo. Incoming applies to collections; outgoing applies to payouts. Network proof, matching transaction hash, original success flags, actual transaction memo, account and asset identities must all agree. Inline transaction evidence with a different hash is rejected even if another transaction is otherwise valid.

Ordinary payment, incoming path_payment_strict_send and incoming path_payment_strict_receive can use the destination amount/asset. Outgoing path payments remain UNKNOWN under this binding because their destination amount does not prove the merchant's source spend. No source-asset inference is made. Create-account, contract calls, trustlines and unrelated operations remain complete selected observations and unresolved as payment settlement evidence.

Original network and transaction sources must be complete. Missing details remain UNKNOWN. An operation is identified economically by network, environment, original transaction hash and operation ID, so collecting it through another alias does not create new capacity.

Aggregate capacity is checked on both the selected payment/payout and the economic chain operation before any eligible allocation is applied. An overallocated group is retained in full and consumes no capacity; processing order never awards a first claimant. Other provider success states do not become final because a reviewer allocates them.

## Decision history

Decisions are immutable attributed editions. They retain full source references, corroborating version IDs, reason, actor, notes, exact subject and original parent. New normalization requires the current unsuperseded parent tip, same book and same subject. The host performs that check and write atomically. Competing forks and cycles are invalid history.

A proposed or rejected successor leaves the preceding accepted ancestor effective. An accepted withdrawal stops the preceding decision. Independent accepted include/exclude decisions that conflict leave the subject unresolved. Every historical and current decision is retained in allocations with effective/tip flags and full original data; only effective accepted allocations can consume value. An older version mentioned by a decision can remain in history, but must be explicitly selected to supply a current allocation.

## Captures, streams and scope

Original paged captures retain exact input, connection, page receipts, source membership, status and terminal cursor. Every page must have classification.outcome accepted, no projectionError/error, full selected version membership, and exact request/body SHA matches to its retained source. The first request must equal the capture input; every later request must equal the preceding original next-page input with the same action; the last original page must declare next:null. A successful HTTP response with failed projection or unbound empty rows never proves an empty population. Completion applies only to that exact query. A live Horizon stream retains its own explicit complete:false coverage and never substitutes for a terminal historical population. The public callback signature covers JSON.stringify(data), the registered callback URL and signature timestamp. It does not authenticate the top-level event label. Results retain that label with eventTypeAuthenticated:false; verifiedData and authenticatedFields come from the original native verification context. Neither label nor arrival order selects current invoice/payment/payout state, related reads or cash totals.

The model does not infer merchant population completeness from absent rows or a standalone detail response. Its report is a reconciliation of selected evidence, not a period-end bank balance, grant milestone acceptance, undisclosed account authorization or an instruction to move funds.

## Validation in this source edition

The accompanying authored source-only exercise executed the complete pure model in Functions/V8 with the unchanged decimal functions and canonical JSON logic. Twelve meaningful checks cover full invoice/instalment/collection separation, original paged population, unresolved period totals, exact submillisecond bounds, rejected-successor and accepted-withdrawal semantics, aggregate over-allocation, conflicting inline transaction identity, numeric values beyond Number precision and duplicate chain observations across aliases, rejected/failed page projection, exact page-body/request receipts and complete original cursor-chain binding.

These are explicitly authored financial examples, not Paycashless customer records or a provider/native commissioning result. The actual provider store, HTTP, browser and original customer course remain the host integration owner's responsibility.
