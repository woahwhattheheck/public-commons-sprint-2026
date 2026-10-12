# Native merchant seller and postsettlement operator

This original-source entrypoint composes a REAL SF30 Stellar x402 seller,
the original official HTTP facilitator/native SDK, the same original SF98
native-success delivery outbox, and the existing local SF30 operations console.
It does not introduce another payment engine, wallet, webhook service, or
synthetic challenge handler.

## Merchant preparation and source compatibility

Supply the merchant's actual original SF30 seller JSON: real HTTPS publicOrigin,
route method, Stellar network and asset, atomic unit amount and merchant payee.
Use precisely one of the existing merchant application binding styles:
a trusted local ESM handler module (the original handler export contract)
or an original seller-upstreams.v1 binding JSON for an approved API.
Static response and responseFile offerings need neither.
Keep your own authenticated facilitator endpoint and credentials private.
Use a dedicated, original SF98 state directory, not a public site or git path.

Execute from the repository root, with Node22+ and original native x402 SDK:

    S=stellar/scf-starforge-20261009/sf30-seller-sdk
    node "$S/operations/merchant-launch.mjs" \
      --config /private/merchant/seller.json \
      --upstreams /private/merchant/api-bindings.json \
      --facilitator https://your-approved-facilitator.example \
      --state /private/merchant/sf98-outbox \
      --history-dir /private/merchant/usage --history-days 90 \
      --delivery-workspace /private/merchant/receiver-workspace \
      --port 8423 --operations-port 8424 --check

The preflight uses the original SF30 seller config and offer compiler and the
original upstream schema, validates handler-module existence if selected, and
prints its configuration summary, including route/binding counts. It does NOT import the handler, contact a
facilitator, execute a payment, open/create the outbox or start a listener.
No wallet/network access or remote resource is required for --check.

`--history-dir` optionally retains the original HTTP observer's daily route
usage across seller restarts. Use a private absolute directory separate from
the SF98 outbox and reuse it for this merchant. `--history-days` retains 1–365
UTC calendar days (default 90) and requires `--history-dir`. The preflight
validates these options without opening either state directory. The running
console exposes the same date/route comparison, retained sessions and JSON/CSV
exports described in the [operations guide](README.md#retain-and-compare-daily-usage).
These aggregate attempts, outcomes and latency are operational usage; SF98
retains its separate native-success delivery journal.

After reviewing the original merchant config, run the exact command without
--check. For a trusted local application replace --upstreams with
--handlers /private/merchant/handlers.mjs, exported as original SF30 functions.

At startup it prints the original seller URL, health/readiness and offers URLs,
owner-local operations URL, /fulfillment and its private `fulfillmentControl`
link. With `--delivery-workspace`, it also prints the existing receiver workspace
on this same listener. To attach the original monitor, add `--incident-state`
and its matching `--incident-merchant` registration. The complete
[incident, receiver and fulfillment workflow](DELIVERY_OPERATIONS.md#connect-incident-monitoring-and-receiver-repair)
reuses their original state, profiles and worker.
Original network verification and settlement are handled by the existing native
resource server. Only its processSettlement success with a supported original
native receipt enters the durable SF98 outbox; original 402/HTTP2xx attempts do
not represent chain payment evidence.

## API merchant application and supplier accounts

For an upstream-backed merchant, this launcher now runs the same
`createUpstreamApplication` used by the maintained upstream entrypoint. Its
compiled configuration supplies the original route admission and request-body
limits to the native seller. The same handlers retain cache, OAuth connection,
idempotency and shared supplier-account state throughout the merchant session.

Use the installed `starforge merchant` command with the arguments above. Keep
the original upstream file's credential references, cache directories and
idempotency directories. A configured `supplierAccounts` map and each binding's
`supplierAccount` select the shared original call allowance described in the
[supplier account guide](../supplier-quota/README.md). Continue the same account
directories when upgrading the installed source.

The preflight summary includes `supplierQuotaBindings` alongside
`upstreamBindings`. It validates account declarations and route membership
before opening the application. The running startup record adds
`supplierAccounts`, pointing to the account screen on the original operations
listener when this merchant has configured accounts.

The original operations console can now read this merchant's upstream
snapshots, cache controls and supplier account snapshots. Open **Supplier
accounts** to review original dispatch totals, remaining calls and provider
cooldown. Its JSON and CSV exports describe the same local account state.
Pass `--operation-controls` to enable the original cache and operation controls
for these bindings. Startup then prints their private fragment link as
`upstreamControls`; open that complete link on the merchant host. Without the
flag, the operations desk keeps its original read-only mode. The launcher
attaches the original application controls before the operations listener opens.

One launch-time environment snapshot supplies upstream preflight and handler
construction. Credential refresh and authorization-code connections still use
their original provider implementations. Native payment verification and the
SF98 successful-settlement journal retain their existing path.

## Closing and restarting the native merchant

Use the process's normal SIGINT/SIGTERM lifecycle, or await the returned
session's `close()` when embedding this launcher. The launcher first drains
the original seller. When its native work is idle, it drains and closes the
operations listener and saves its final checkpoint. It then closes the original
application's cache, OAuth, idempotency and supplier resources. Operator requests
finish while their original controls remain available. Repeated close calls join
the same cleanup.

If the seller exceeds its configured drain grace, the close call retains that
failure while application cleanup waits for the original work to become idle.
The operator listener remains attached during that continuation. A partial
startup failure follows the same cleanup path, including a failure while
opening the SF98 outbox, loading the facilitator client or binding operations.
A stop signal received during startup is retained across the current acquisition;
the returned resource is closed at the next boundary and readiness is not
published for the interrupted launch.

Restart with the same merchant configuration and private state directories.
The application reopens its existing supplier allowance, cache and completed
request records; the native SF98 journal retains its original settlement
events. Programmatic close also removes this launch's signal handlers, so
reopening the merchant does not accumulate old shutdown callbacks.

## Operator meaning and privacy

The original seller's /_seller/ready and /_seller/offers endpoints report
live route state and advertised original payment offers. The original owner-local
operations root / reports actual HTTP attempts, errors, duration and challenges.
The owner-local /fulfillment page reports actual SF98 original native-success
events and pending/accepted/exhausted webhook delivery states, not external
ledger finality or actual order fulfillment.

Original /delivery.json and /delivery.csv local exports retain only event
fingerprints, route and delivery-state metadata. /delivery.metrics and the
original /metrics provide local Prometheus-compatible data. Event fingerprints
are hashes, not wallet identities; avoid publishing them with customer
documentation. Protect originals and exports on trusted operator hosts.

The original SF98 sender delivers webhooks under the operator's selected receiver
profile. A new attached workspace starts paused; its **Run continuously** action
and retained restart intent use the same original worker. Fulfillment recovery
requeues only the selected original exhausted notification. A receiver HTTP 2xx indicates
acceptance only. Use the original SF86 chain reconciliation and merchant order
authority for independent confirmation before irreversible fulfillment.

Seller and operations use separate localhost-only HTTP listeners. Only the
seller is intended for an operator-controlled public HTTPS reverse proxy.
Never expose the operations port to customers or to a shared reverse proxy.

The --max-in-flight and --drain-grace-ms options reuse original SF30 request
capacity and lifecycle. Closing the launcher follows the seller, application and operations lifecycle
above, using the configured in-flight drain period.
The SF98 outbox itself preserves original 0700/0600 directory and file
permissions. Multiple independent active merchants must use separate journals
and ports; one merchant outbox should have only one writer/drainer owner.

## Actual original-source merchant pilot acceptance

Run original --check first. Launch only with genuine approved merchant terms and
original native facilitator (the command does not invent or configure a signer).
Fetch one original protected merchant path without payment to observe its actual
SDK 402 challenge. Complete one separately-authorized real testnet payment only
where the operator already has appropriate testnet account/payment authority;
confirm the original SDK outcome and inspect the corresponding original journal
event via /fulfillment. A refusal must produce no event, and repeated successful
receipt processing must not duplicate durable SF98 events. Confirm operator-only
retries through the original SF98 worker and the private fulfillment control link.

This package requires no hosted Actions, added service or additional dependency
beyond the maintained original seller implementation and its official x402 SDK.
