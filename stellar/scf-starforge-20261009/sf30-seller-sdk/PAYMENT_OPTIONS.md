# Offer several payment choices on one seller route

An SF30 route can advertise several complete `exact` payment options. A merchant
can offer different Stellar assets or networks at the same API URL while keeping
the price, asset, recipient, network and timeout of each option together. The
existing native x402 server verifies and settles the one selected by the buyer.

This extends the original seller service, compiler, imported-offer support and
native factory. The same options appear in the route's saved offer, the live
`/_seller/offers` response and its `PAYMENT-REQUIRED` challenge. No separate seller,
facilitator or payment scheme is needed.

## Configure the merchant's choices

Existing `definition.payment` configurations keep their singleton behavior. To
offer alternatives, replace that field with `definition.paymentOptions`:

```json
{
  "method": "GET",
  "description": "Download the merchant's dataset",
  "paymentOptions": [
    {
      "scheme": "exact",
      "network": "stellar:testnet",
      "asset": "REPLACE_WITH_TESTNET_ASSET_A_CONTRACT",
      "amount": "10000",
      "payTo": "REPLACE_WITH_TESTNET_RECEIVING_ACCOUNT",
      "maxTimeoutSeconds": 60
    },
    {
      "scheme": "exact",
      "network": "stellar:testnet",
      "asset": "REPLACE_WITH_TESTNET_ASSET_B_CONTRACT",
      "amount": "5000",
      "payTo": "REPLACE_WITH_TESTNET_RECEIVING_ACCOUNT",
      "maxTimeoutSeconds": 60
    }
  ]
}
```

Amounts are integer strings in each asset's atomic units. `10000` units of one
asset and `5000` units of another are independent merchant prices; the compiler
does not convert assets, estimate exchange rates or rank offers by economic cost.
Replace the illustrative identifiers with verified assets and recipients before
using a native payment runtime.

Use exactly one of `payment` and `paymentOptions`. The array accepts 1–16 choices
in merchant-defined order. Every choice has the same validation as the existing
single payment: explicit `stellar:testnet` or `stellar:pubnet`, `exact`, a positive
atomic amount within signed Soroban i128, asset and recipient strings, and an
integer timeout from 1 to 86400 seconds. An optional `extra` JSON object is
preserved independently for each option, including nested objects and arrays.
It must fit within 8 KiB of encoded JSON and contain only finite JSON values;
cycles, functions, undefined values, sparse arrays and excessive nesting are
rejected. New `paymentOptions` entries reject unknown top-level fields. The
existing complete challenge-header
limit still applies; adding options never truncates terms or metadata.

Two options cannot repeat the same scheme, network, asset and recipient, even if
their amount or timeout differs. Express separately priced service tiers as
separate API routes. This keeps buyer selection unambiguous within one offered
rail and recipient. Distinct network, asset or recipient choices remain allowed.

## Run the existing service

The companion config includes two testnet assets and one separate pubnet option
to demonstrate multiple native network registrations. All its payment identifiers
are deliberately nonpayable placeholders. From the repository root:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/serve.mjs \
  --config stellar/scf-starforge-20261009/sf30-seller-sdk/examples/multi-option-service.json \
  --port 0
```

Use the URL printed by the original service:

```sh
curl -i http://127.0.0.1:REPLACE_WITH_PRINTED_PORT/dataset
curl http://127.0.0.1:REPLACE_WITH_PRINTED_PORT/_seller/offers
```

Challenge-only mode advertises all three options without invoking the application
handler. To operate a real merchant service, supply the existing SF30 native
facilitator configuration and verified merchant terms as described in
[README.md](README.md#enable-the-native-x402-runtime). The original factory
registers `ExactStellarScheme` for every network appearing anywhere in the
compiled routes. The operator must choose a facilitator that actually supports
those networks and assets; declaring an option does not establish support,
funding, recipient ownership or settlement.

Imported compiled `offer` routes may also contain 1–16 alternatives. SF30 checks
every original option against the supported canonical exact fields and optional
`extra`, preserves
its position and value, and passes every option to the original native SDK.
Unknown payment fields or ambiguous repeated options are rejected rather than
silently dropped. Imported Bazaar input schemas retain their existing behavior.

The original native `@x402/stellar` 2.28.0 implementation receives each option's
`extra` through its asset-price input. Its `parsePrice()` retains those values;
its `enhancePaymentRequirements()` can overlay `areFeesSponsored` from the
facilitator's actual advertised capabilities. This native capability result may
differ from the configured descriptive value. SF30 does not use `extra` as an
approval or signature-verification result, and a seller cannot establish fee
sponsorship merely by setting a field in its JSON.

## Buyer and fulfillment integration

Choose the exact intended network, asset and recipient, and set an atomic spend
cap for that asset when calling the original SF31 buyer. The first advertised
option is merchant presentation order, not permission to choose or pay. A buyer
must not take a cheap amount from one option and an asset or recipient from
another. Payment approval, signing, one signed retry and outcome reconciliation
remain with the existing buyer and native SDK.

Native settlement callbacks receive the selected `paymentRequirements` alongside
the original payment payload. Downstream delivery or accounting integrations
must use those selected terms and match them to the original route's options;
`route.offer.accepts[0]` is not the paid option merely because it comes first.

## Check catalog visibility without losing an option

`auditCatalogVisibility()` compares all complete options, including timeouts and
structural `extra` JSON values, in
one original resource row. It returns `TERMS_DRIFT` if an option is missing,
changed, repeated or supplemented with another alternative. It does not assemble
different rows into a single invented offer. Option order may differ in the
catalog; option membership and complete values must match.

The result's `paymentOptions` array gives each original option and a `visible`
flag to show which exact terms were found. Those per-option flags are diagnostic:
only the top-level `termsMatch` says that one observed row contained the whole
offer. All results retain `settlementAuthenticated:false`.

`probeLocalVisibility()` still reads only an explicitly supplied loopback
catalog. It applies a network filter when every option uses the same network;
for a cross-network route it reads the actual unfiltered pages so later options
cannot disappear behind a first-option filter. Existing page and request limits
remain in effect.

If the native SDK enhanced capability metadata, compare against the resulting
actual native offer when auditing that live catalog. Comparing a pre-initialized
merchant declaration with different live `extra` values reports drift rather
than silently claiming exact equality.

## Source context

This completes seller support for a shape already observed in the original
Vellar/Periplo corpus: 29 resource rows contained 30 intact payment options, with
one Vellar row advertising both testnet and pubnet. The existing native catalog
classification exercised all options individually. Reuse the original
[Muse result](https://tokenjunkielabs.slack.com/archives/C0C1F274SGH/p1791692683211769)
for that observed corpus; it describes catalog metadata, not a payment executed
by this change. Native network settlement remains independently verified through
the existing operator's real facilitator and ledger workflow.

Native source contract: `@x402/stellar` 2.28.0 `exact/server` provides the
`parsePrice` and `enhancePaymentRequirements` behavior above, and `@x402/core`
2.28.0 `x402ResourceServer` builds requirements separately from every configured
route acceptance. This integration reuses those installed original package
implementations; it does not replace their Stellar payment mechanism.
