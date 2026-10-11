# Publish a running merchant release

The existing release console can now compare a merchant's retained offers with
its catalog, publish new or revised offers, and withdraw a selected listing.
It uses the original SF50 Ed25519 proof, the running SF60 catalog operator's
independently pinned seller policy, and the original SF95 withdrawal. Discovery
stays online, with one existing journal writer throughout the workflow.

## Connect the existing merchant and catalog

Start the catalog using its existing [operator instructions](../sf60-durable-catalog-transaction/OPERATOR.md).
Keep its approved seller ID, public-key pin, origins, payment recipients,
networks and schemes in that operator's existing policy. The release console
does not add or change catalog authorities.

Copy [release-catalog.example.json](./release-catalog.example.json) to a private
operator directory and replace its references:

| Field | Value |
| --- | --- |
| `directory` | The existing live catalog directory, using its original Unix or authenticated loopback transport |
| `sellerId` | The merchant ID already configured in the catalog operator |
| `sourceURL` | The exact HTTPS offer-export URL on the release's public origin, such as the merchant gateway's existing `/_seller/offers` endpoint |
| `keyFile` | The merchant's existing Ed25519 seller-proof private key file |

The key must match the catalog operator's independently pinned public key. It
is a seller-proof key, separate from the Stellar wallet. The key file is a
regular file owned by the operating user with mode 0600 (or stricter); relative
configuration paths resolve beside the configuration file. Review reads only
configuration references. Apply reads the current key file immediately before
signing; key bytes never go to the browser, catalog, release snapshot or result.

Start the same release console with this connection:

~~~sh
node stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs console \
  --store /private/merchant/releases --catalog /private/merchant/catalog-connection.json
~~~

## Review, publish and maintain an offer

1. Select and start the original merchant release. In **Catalog publication**,
   refresh to see each route's current catalog state, sequence and exact atomic
   payment terms alongside the retained release terms.
2. Select **Review offer publication**. The review contains only offers whose
   exact exported source or configured export URL differs from the active catalog. It binds the original
   release digest, current running instance, catalog head, configured public
   key pin, policy and source references. No signature is issued during review.
3. Select **Publish reviewed offers**. The merchant signs every payment
   alternative using the original SF50 implementation. The same live operator
   verifies all proofs, previews the original batch, and applies it against the
   exact reviewed head. Every changed offer commits together or the original
   batch rejects the group. An already matching release produces no catalog
   write or signature.
   Distinct assets on the same network and recipient remain separate selectable
   alternatives; each complete alternative receives its own original proof.
4. Upgrade through the existing release workflow. Review the new running
   release to publish its changed offer and input contracts. Previous catalog
   versions remain in the original lifecycle history.
5. To retire an old listing, choose the retained release containing that route,
   enter a withdrawal reason, and select **Review withdrawal**. Inspect the
   actual currently listed terms, then apply. The original SF95 request binds
   that catalog head, seller, signer, resource and next sequence. Withdrawal
   removes that one listing while keeping its history and other discovery
   resources available.

Publication is explicit. Stopping or restarting a seller does not rewrite the
catalog; the existing listing can remain during a normal restart. Withdraw a
retired operation explicitly. The console displays the running mode, including
an explicitly configured local challenge preview. A catalog listing records a
signed offer; it is not a payment or a guarantee of public gateway availability.

Changing the release, running instance, catalog head or configured policy after
review requires a fresh current comparison. The original catalog performs its
own signature, ownership, source, sequence and head checks on every apply.
There is no automatic write retry. If a response is lost, **Refresh catalog**
reads the original committed source hashes and lifecycle history to reconcile
what is now listed. A new publication review skips exact matching offers.
The configured export URL participates in that comparison, so moving the public
offer endpoint produces an explicit update even when offer bytes stay unchanged.
The original journal binds a seller to its original signer; a different current
pin is displayed as `SIGNER_CHANGED` and requires that existing authority for
updates or withdrawal. This adapter does not reinterpret a policy change as a
seller-key rotation.

## Terminal workflow

The original release CLI exposes the same adapter:

~~~sh
node release-cli.mjs catalog-status --store /private/merchant/releases \
  --catalog /private/merchant/catalog-connection.json --id version-2

node release-cli.mjs catalog-review --store /private/merchant/releases \
  --catalog /private/merchant/catalog-connection.json --id version-2 \
  --out /private/merchant/publish-version-2.json

node release-cli.mjs catalog-apply --store /private/merchant/releases \
  --catalog /private/merchant/catalog-connection.json \
  --review /private/merchant/publish-version-2.json

node release-cli.mjs catalog-review --store /private/merchant/releases \
  --catalog /private/merchant/catalog-connection.json --id version-1 \
  --withdraw retired-route --reason "This operation has been retired" \
  --out /private/merchant/withdraw-retired-route.json
~~~

Apply that withdrawal review with the same `catalog-apply` command. Review files
are created exclusively with mode 0600. The original catalog journal and its
history remain the durable publication record; there is no second publication
database or background publisher to reconcile.

## Embedded use

Import `readReleaseCatalogConfig`, `releaseCatalogStatus`,
`reviewReleaseCatalog` and `applyReleaseCatalog` from `release-catalog.mjs`.
Status/review take `(releaseStore, { config, releaseId })`. Review additionally
accepts `action: 'withdraw'`, `routeId` and `reason` for one retirement. Apply
takes `(releaseStore, { config, review })`. Each result preserves original
atomic strings and the original operator receipt. The console stores its own
latest review and accepts only that review ID through its existing token and
same-origin control surface.

The focused `release-catalog-journey.mjs` exercises the original saved release,
real seller process, live authenticated catalog, signing, publication, update,
withdrawal and catalog restart. It uses an ephemeral Ed25519 key and local
nonpayable demonstration offers. Native payment behavior remains covered by
the existing accepted release journey; this workflow sends no payment.
