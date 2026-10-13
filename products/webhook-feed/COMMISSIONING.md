# Commission a webhook customer installation

Use this guide with the installed [Webhook event operations](OPERATING.md) product to deliver an event service that a customer can operate and use. The result is a complete selected event window in the customer's existing workflow, followed by a later useful window and a working handover to its receiving engineer.

The maintained implementation already supplies signed ingestion, reviewed field projection, paid cursor pages, the original SF88 subscriber, private operating interfaces, and complete event-store transfer. Commissioning connects those capabilities to the customer's actual source, destination, payment choices and operating responsibility.

## Choose the customer outcome

Start in the existing customer case and Workshare. Select one contract/event family or equivalent source task, one existing database or internal API destination, and the business action that the received events support. Use the customer's existing destination contract and original source examples when preparing the mapping.

For a Stellar contract-event installation, the useful result can be a complete selected ledger/event window applied to an existing application table or API. Preserve network, provider scope, contract, transaction and individual event identity. Two events from the same transaction remain two events. Preserve exact XDR and identifier values until the customer's agreed decoder or application interprets them.

The paid feed and the downstream database load are separate parts of the same delivery. The shipped subscriber retains paid pages and exports NDJSON with a manifest. Any customer-specific transformation or destination adapter is implemented and accepted against that original export or subscriber interface.

Record the following decisions together in the existing workorder:

| Decision | Concrete selection |
| --- | --- |
| Useful task | The destination operation and complete result the customer needs; name the event or business change that makes a later collection useful. |
| Source | Original provider, network, contract/topic selection, authorized access and source meaning. Retain the actual examples and full original documentation already acquired. |
| Public output | Selected field names and meaning, event identity, ordering basis, missing/null handling, exact integer and XDR treatment. |
| Destination | Existing database/API, receiving owner, mapping, idempotency key, transaction/acknowledgment boundary and reconciliation query. |
| Scope | Included event family, destination, delivery window, throughput and retention needs, agreed correction process and acceptance owner. |
| Payment | Merchant route, network, asset, atomic amount per page, recipient, facilitator, buyer per-page ceiling and aggregate spending owner. |
| Operation | Selected source/runtime edition, host, private credential references, HTTPS ingress, lifecycle owner and support responsibility. |
| Receiving | Which person receives projected subscriber output and which engineer is authorized to receive the publisher's full private operating state. |
| Commercial timing | Original quoted fee, clock-start conditions, milestones, agreed support and actual invoice/collection dates. |
| Funding assignment | Each future adaptation belongs once to its selected grant package or commercial workorder. |

The commissioning payer may be the application customer, a resource publisher or an agency. The resource publisher operates and authorizes the event service. The independent buyer controls its own task, signer and spending. The receiving engineer operates the installed source and recovery procedure. Name those roles even when one organization performs more than one.

## Keep the two receiving paths clear

**Paid subscriber delivery** contains the approved projection, complete received pages, original buyer-operation references, saved subscription cursor, and NDJSON plus its manifest. This is the material consumed by the customer's application. The source-body digest identifies the original signed input; it does not reveal or reconstruct fields excluded from the projection.

**Publisher operating handover** contains the original event SQLite snapshot, source/feed definitions, retained raw bodies, delivery identities, merchant plan and cursor key. For Mercury, the joined recovery package also includes the original source-operation store and private bridge credentials. Deliver this package only to the engineer authorized to operate that publisher state. Keep the private source material in the customer's existing private transfer and backup destination.

The SF88 subscription and its original buyer-operation directory retain customer payment attempts and responses. Include those in the buyer's own existing backup process. A publisher event snapshot does not replace the merchant/facilitator financial journals or the buyer's original operation state.

## 1. Start the selected installed owner

Read the existing [operating guide](OPERATING.md) for the exact connection file, Applications entry, local/connected client and environment options. Use Node 24 or later and the selected installed source edition.

For a source that already emits Standard Webhooks, initialize the original event store and start the managed workspace:

    starforge webhook-feed init --state /private/event-service/publisher
    starforge webhook-operations-workspace --state /private/event-service/publisher --port 0

The complete reported workspace URL opens the private operator. Applications offers the same Webhook event operations owner with Open, Stop and Reopen. Publish the signed ingress and paid merchant route through the selected HTTPS reverse proxy; keep administration private.

For an existing Mercury installation, retain the original Mercury operations and signed bridge owner. Its source verification, scoped identities, catch-up tasks and delivery binding remain authoritative. Use the [Mercury bridge operating sequence](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/4bd995b6293a00fa52992ae9ac0f17cdc56ed7b7/stellar/mercury-event-operations/starforge-feed/README.md) from a checkout or installed selection that includes that bridge. The webhook-event-operations selection contains the general event product; its definition does not include the separate Mercury source tree.

Choose one owner for each receiver, merchant and private workspace listener. The original Mercury bundle can already own all of those services. Use the general product's configured aliases to operate the existing store where appropriate; preserve its existing lifecycle and source destination. A source-native process that already owns ingestion uses the documented null receiverPort setting when a separate managed event workspace is selected. An existing merchant owner also keeps its merchant listener.

Record the actual launch selection and how the receiving engineer stops and reopens it. The application must reopen the same original store identity.

## 2. Review the source and publish the useful fields

Use Sources and Feeds in the private browser, or the source_save and feed_save actions through the original webhook-operations connection. Load current state before editing a definition and use its reviewed expectedRevision. A new definition uses null.

The source definition selects its original signing-secret environment reference, event-type pointer, timestamp pointer, accepted size and clock tolerance. The generic receiver implements Standard Webhooks. Mercury's original notification and native destination signatures are verified by their original source and bridge before the same bytes enter the generic store.

Select only the fields the buyer needs. Preserve complete original bodies privately and document the consumer meaning of each selected field. The native JSON parser retains unsafe integer literals as exact decimal strings; a destination adapter must preserve that spelling until it has an appropriate exact numeric representation. XDR-base64 values retain their original bytes and interpretation.

Receive the agreed real source examples. Inspect the accepted event, original source identity and attempts through Events or the events/event actions. A repeated source identity with unchanged bytes reuses its original acceptance; a different body under that identity requires source reconciliation.

Use preview for the selected feed to inspect the complete public page shape and the actual field mapping before preparing payment terms. A source or feed edit retains the earlier definition and requires a current revision.

## 3. Set page economics against the whole customer task

The merchant charges **per requested page**. The customer task is **a complete captured event window applied to its destination**.

Choose page size with the actual event volume and payload size. The count limit and encoded-byte limit both affect page count. Ceiling(matching events / page size) is only a count-based lower bound when byte limits can split earlier.

The buyer configuration retains the selected route, asset, recipient, maximum page price, signer and its existing operator policy. The original buyer's spending owner governs aggregate exposure. An optional maximum page count bounds one sync invocation; later sync continues the saved window.

Record these values before the first paid window:

| Quantity | Operating use |
| --- | --- |
| Atomic amount per page and asset | The actual reviewed merchant payment option. Keep amounts in their original atomic units and report each asset separately. |
| Expected and maximum pages per useful window | Plan from actual source volume, field projection and byte limit. Update the estimate from the first complete customer window. |
| Task-level spending allowance | Include all required paid pages and the customer's selected network/service charges under its existing spending policy. |
| Cadence or trigger | Start collection when the customer's source/task needs a new window. The subscriber has no built-in background polling schedule. |
| Empty-window behavior | An admitted request can still be a priced page when no selected events match. Choose cadence with that operating consequence in view. |
| Recovery responsibility | Inspect and recover the original page operation before creating another paid request after an uncertain outcome. |

Save actual terms through plan_save and prepare the named release. Start the merchant with the selected native facilitator and saved reviewed plan/feed selection. The named release is a delivery artifact; the managed process launches from the store's saved plan and current feed revisions. A changed feed or payment plan needs the documented stop/start to bind its new selection.

The event-store preview checks the data projection. The paid subscriber operation establishes the actual settlement and received-page result for that buyer. Use the customer's useful task to determine the operation and its spending allowance.

## 4. Complete the first buyer window and destination load

Use the installed buyer-event-feed command with the original SF88 buyer configuration. The following paths are operator-selected private locations:

    starforge buyer-event-feed init --dir /private/customer/event-subscription --config /private/customer/event-buyer.json --feed SELECTED_FEED_ID --id CUSTOMER_SUBSCRIPTION_ID --page-size 50
    starforge buyer-event-feed sync --dir /private/customer/event-subscription
    starforge buyer-event-feed inspect --dir /private/customer/event-subscription

The first received page captures a fixed upper source sequence. Every following page completes that same window even if new events arrive. The subscriber saves the complete response, its original buyer operation, event rows and next cursor together. Filtered sequence gaps are part of the selected source; they do not mean that the subscriber should invent missing events.

CAUGHT_UP means that captured window is complete. PAGE_LIMIT_REACHED means the allowed page count finished and its saved cursor can continue through the same sync command. The receiving application should mark its business task complete only after its own destination has accepted the selected window.

Export the original received events:

    starforge buyer-event-feed export --dir /private/customer/event-subscription --out /private/customer/deliveries/window-01.ndjson

The export creates window-01.ndjson and window-01.ndjson.manifest.json. Preserve both. The manifest retains source/page references, file identity, count and sequence boundary. Repeating the same export destination completes or reopens that selected export; use a new destination for a later window. Each export contains the retained subscription snapshot. A later export can include previously delivered events, so the destination adapter must apply its agreed idempotency key using the preserved event identities.

For a customer whose destination is analytical work, use the maintained
[Event Analysis programme](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/EVENT_FEED_ANALYSIS.md).
It consumes these same complete files into the existing Analysis database,
retains every individual event and exact projected value, reviews cumulative
later windows, and produces full typed tables, saved report publications,
workbooks and a complete customer workspace handover. Existing customer report
and worksheet choices remain part of that reviewed continuation.

Implement the agreed database/API load with the destination's original transaction and idempotency behavior. Keep each source event's identity through transformation. Where the destination already implements idempotency, use its supported contract. Otherwise include a durable acceptance ledger or transactional key in the customer-specific adapter. Record the source window, accepted events, rejected or unresolved items and the actual destination acknowledgment in the original workorder.

The acceptance owner opens the delivered result in the customer's existing application and completes the agreed task. Review missing, null, exact numeric, event-index and timestamp meaning there, rather than stopping at a successful HTTP response.

## 5. Operate a later window and recover real interruptions

A later useful source or business change starts the next sync from the saved resume cursor. Use the original subscription for the same feed revision. A deliberately changed source projection or retained starting boundary gets a newly reviewed subscription directory, while the earlier subscription and its acquired results remain available.

Use the customer's agreed real examples to cover the operating behaviors that matter:

| Customer operation | Completion visible to the operator |
| --- | --- |
| Two selected events from one transaction | Both original event identities arrive and apply independently in the destination. |
| Original provider redelivery | One accepted event is retained; its attempt history reflects delivery again. |
| Restart after ingestion | Reopen the original source/store and continue its saved delivery work. |
| Destination outage and replay | Reconcile the existing source/destination operation; continue the same identities and retain the actual destination result. |
| A ledger catch-up or event window with several pages | Receive the complete selected window, then apply its full output. |
| Interrupted buyer response | Use recover to reopen the original buyer operation and complete its retained response where available. |
| Later customer window | New source work produces a distinct useful completed destination task while the prior delivery remains readable. |

The offline recovery command is:

    starforge buyer-event-feed recover --dir /private/customer/event-subscription

It reads the retained original operation and response; it does not start a new request. Inspect RECOVERY_PENDING or ORIGINAL_ATTEMPT_RECORDED through that operation's existing buyer journal.

For FEED_CHANGED, review the new feed and create the deliberately selected subscription. For CURSOR_EXPIRED, restore the required retained source history or select an explicit current starting boundary while retaining the earlier customer output. The original merchant and buyer guides contain the complete response contracts.

## 6. Hand over a service the receiving engineer can run

Keep the full operator handover within the selected publisher authority. In the private browser's Continuity view or through snapshot, create a named snapshot. Read manifest and retain its returned manifestFile.sha256. The original operating guide supplies the exact request shapes.

Download, reopen and receive the selected operating snapshot:

    starforge webhook-operations download --connection /private/event-service/connection.json --workspace publisher --snapshot SELECTED_SNAPSHOT --directory /private/event-service/received-files --expected-manifest MANIFEST_SHA256
    starforge webhook-operations reopen --directory /private/event-service/received-files --snapshot SELECTED_SNAPSHOT --expected-manifest MANIFEST_SHA256
    starforge webhook-operations restore --directory /private/event-service/received-files --state /private/event-service/received-publisher --snapshot SELECTED_SNAPSHOT --expected-manifest MANIFEST_SHA256

Interrupted download continues its original checkpoint. Repeated restore for the same snapshot reopens the same receiving workspace and preserves later operator edits. Choose a new receiving directory for a different snapshot.

A Mercury source uses its original joined source/feed snapshot and restore commands so source delivery state and the downstream feed remain coherent. Keep its private bridge credentials inside that authorized handover and its provider credentials in their existing environment custody.

Have the receiving engineer, using the selected host, perform the actual stop/reopen, current source or terms change, buyer continuation and agreed recovery operation. Reconcile operations after the backup point using the original source, merchant and buyer journals. Record elapsed recovery time, remaining differences and the accepted correction in the existing Installation or Workshare.

Capture a required customer window before applying body retention. The retention decision uses the original throughSequence and expectedHighWatermark. Accepted identities remain retained; raw bodies at or below throughSequence are removed. The retention period must support the customer's actual subscriber lag and recovery commitment.

## A practical commissioning sequence

Use the timing in the actual accepted workorder. This sequence fits a compact installation with one selected event family and one existing destination; its phases remain explicit when a deployment needs a longer window.

| Phase | Engineering and operator result | Review that completes it |
| --- | --- | --- |
| Source and destination connection | Current provider scope, selected host, real event examples, destination contract and original installed store. | The receiving owner can identify the exact source, destination and permitted operating handover. |
| Useful event mapping | Reviewed public projection and destination mapping, preserving individual event identity and source meaning. | The agreed real examples produce the intended destination records. |
| Paid customer window | Actual native terms, complete subscriber window, original paid responses and whole destination result. | The customer completes the selected application task and reviews its actual page cost. |
| Continuation and correction | Redelivery, restart, destination recovery, multi-page catch-up and a later useful window. | Original identities, original financial outcomes and customer results reconcile. |
| Independent handover | Source, configuration references, readable guides, complete authorized state, buyer output and recovered service. | The receiving engineer independently operates the selected installation and closes the agreed correction round. |

Commercial clock-start and milestone terms belong to the original offer and accepted workorder. Record active implementation and correction time separately from provider or customer waiting. The operator can then compare the scope estimate with actual delivery effort before pricing another installation.

## Fit within a funded Stellar implementation

For an installation selected into the existing SCF programme, the webhook-specific customer work maps to the same six packages:

| Existing package | Remaining work for the selected event customer |
| --- | --- |
| T1 merchant-resource integration, 80 hours / USD 7,600 across the programme | Connect the chosen source/runtime, implement its typed destination adapter, and operate the selected paid route and buyer configuration. |
| T1 authority and handover, 40 hours / USD 3,800 | Implement the receiving host's source/terms change, access configuration and customer-specific installation/recovery corrections. |
| T2 provider and ledger deployment, 70 hours / USD 6,650 | Complete the same useful event operation through the two selected independent facilitators and the buyers' actual native payment setup. |
| T2 deployed threat response, 50 hours / USD 4,750 | Install the selected source/delivery monitoring and operate the interrupted-settled-purchase and merchant-delivery-failure responses in that deployment. |
| T3 mainnet rollout, 90 hours / USD 8,550 | Complete the production host, network/asset/account selection, recurring customer workflow and controlled release/rollback. |
| T3 production recovery and handover, 70 hours / USD 6,650 | Complete receiving-host restore, post-backup reconciliation, key rotation and an independently operated support case. |

These are the programme's existing totals for both merchant installations, not six additional allocations for one webhook customer. Assign actual selected adaptations once within that plan. Keep completed reusable source in the current product baseline, separately commissioned customer work in its original commercial scope, and source subscriptions, purchased usage, network charges and routine operation with their actual cost owner.

The programme's existing cohort remains two independent merchants and two independent buyer operators. By day 90, the buyers complete at least ten useful testnet purchases during seven consecutive days and the same useful operation through both independent facilitators. By day 150, both merchants operate on mainnet and the buyers complete at least thirty useful purchases during fourteen consecutive days, with each returning for a distinct completed purchase on another day. The complete customer task and the merchant's per-page priced unit are recorded together. Read the actual paid operations and full receiving results when reporting those programme targets.

## Operating sources

- [Maintained product and Applications/CLI/Merchant setup](OPERATING.md).
- [Original signed feed, page contract, merchant release and retention](../../stellar/scf-starforge-20261009/sf30-seller-sdk/webhook-feed/README.md).
- [Original SF88 subscription, recovery and complete customer export](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/event-feed/README.md).
- [Mercury source and paid-feed bridge](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/4bd995b6293a00fa52992ae9ac0f17cdc56ed7b7/stellar/mercury-event-operations/starforge-feed/README.md).
- [SCF Build submission criteria](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/submission-criteria) and [budget/deliverable guidance](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines), reviewed October 12, 2026.
