# WooCommerce merchant

This selected Starforge package includes the original WooCommerce bridge and
managed application, merchant Operations, purchased-file delivery, buyer receiving
and refund recovery. Existing WordPress orders and the original worker own their
normal state transitions.

## Open the saved WooCommerce application

Attach the original READY runtime in the Runtime workspace and open Applications.
Review the existing WordPress bridge configuration and merchant state, save the
WooCommerce application, and start the original managed service. The selected
catalog also includes Buyer and the merchant console.

The Applications page retains the original WordPress, Operations and fulfillment
addresses. Use the published Open action when its saved navigation origin matches
the workspace. If the Runtime workspace has moved to another port, use the exact
retained address shown by the application; the existing child does not change its
navigation trust during that move.

The original source and guides travel under:

- `source/stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/`
- `source/stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/MANAGED.md`
- `source/stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/OPERATIONS.md`
- `source/stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/BASKET.md`
- `source/stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/REFUNDS.md`
- `source/stellar/scf-starforge-20261009/sf98-merchant-delivery/`

Use the maintained commands and their complete original options:

```sh
starforge woo-managed --help
starforge woo-seller --help
starforge woo-buyer --help
starforge woo-operator --help
starforge woo-refund --help
starforge delivery --help
starforge delivery-workspace --help
starforge buyer-agent --help
```

## Existing site, orders and purchased files

Configure the complete original WordPress bridge files through its maintained
setup workflow. Retain the same site/database, WooCommerce settings, selected
merchant account, original order and buyer profiles. The WordPress bridge's
generated setup inputs, PHP/JavaScript/CSS resources and refund-network data
remain original files in the package.

The managed WooCommerce process opens the same Operations and SF98 fulfillment
workflow. Select the existing order and use its original transfer/settlement
state. A completed payment and its outbox retain their original identities.
Refunds retain the original order, credit and refund handoff.

For purchased-file fulfillment, preserve the complete WordPress site/download
files and the original outbox/worker state. Packaging the application source
does not reconstruct a customer's existing upload directory. The buyer reopens
the original receipt and received files; runtime installation does not create a
new payment or a replacement order.

A cold customer packet therefore includes the exact source package, native
runtime/profile/lock, the complete existing WordPress site and database, original
merchant/outbox state, approved buyer configuration and received files. The
original WooCommerce receiving journey checks those relationships across service
stop, reopen and buyer recovery.

## Runtime and source

Receive this exact archive with its SHA-256 through the maintained
`runtime-install prepare` command. Select native dependencies plus the original
`schema`, `openapi` and `mcp` groups, and `--operator` for the original
Linux/Python operator. Run the maintained install and inspect operations to
obtain READY before attaching the runtime to Applications.

```sh
starforge runtime-profile catalog
starforge doctor --native --feature schema --feature openapi --feature mcp
starforge source
starforge registrations
```

The release manifest retains the original commit and the committed product
selection, including exact contribution and recipe files. The customer runtime
uses that selection automatically. `starforge --help` lists the included command
surface; `starforge COMMAND --help` retains each original command's options.

The named package exports retain their original implementations. This product
does not expose the full toolkit's broad root import. Use the named Water,
WooCommerce, buyer, runtime or merchant exports listed in `package.json`.

Complete customer projects, site files, operating state and received files belong
outside the installed package. Preserve them and their original operation IDs
through runtime upgrades and recovery. The original installer receives the
archive, verifies source/profile/lock, and retains its normal resume, cache,
offline-transfer and exact-source recovery behavior.

## Build or resume this source selection

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs --repo /absolute/checkout --ref ORIGINAL_COMMIT --selection woo-merchant --out /absolute/woo-release
node stellar/scf-starforge-20261009/distribution/build.mjs --repo /absolute/checkout --out /absolute/woo-release --resume
```

Use the original archive path and SHA-256 from the receipt for installation.
A different source commit or product uses its own output; resume retains this
WooCommerce package selection.
