# SF102: Merchant seller recovery and zero-payment cutover parity

**Use case:** A working SF30 paid JSON API needs a repeatable, private backup and standby migration, preserving its **real configured Stellar payment asset, network, atomic amount, recipient, API response data and canonical public origin**. SF102 packages the actual static seller configuration plus snapshot assets, restores it into a separate clean location, and checks the original native seller's published payment offers on both loopback servers before a human switches an HTTPS proxy. It is deliberately not another seller, settlement adapter, DNS manager or CI workflow.

Node 22+, no npm dependency for SF102, no cloud runner. The **existing original SF30** remains the only source of payment challenges, verification, settlement and route serving. Compatible inputs are original `stellar-forge.seller-service.v1` configs containing inline `response` or `responseFile` JSON routes. Dynamic `handler` routes are rejected during pack because their application dependencies cannot safely be smuggled into a backup.

## Actual operator flow

The seller config and each referenced `responseFile` must live within the same original config directory (including subfolders) as regular non-symlink JSON files. This prevents accidental collection of unrelated secrets from arbitrary host locations. Place staging output under an *existing* private parent, outside the original source.

```sh
F=stellar/scf-starforge-20261009
node "$F/sf102-seller-recovery/recovery.mjs" pack \
  --config /private/merchant/seller.json \
  --out /private/backup/sf102-20261011-a
node "$F/sf102-seller-recovery/recovery.mjs" verify \
  --bundle /private/backup/sf102-20261011-a

# On a destination host after privately transferring this bundle:
node "$F/sf102-seller-recovery/recovery.mjs" restore \
  --bundle /private/import/sf102-20261011-a \
  --to /private/merchant/standby

# Start the EXISTING native SF30 runtime on both hosts or separate local ports.
# For a local no-wallet acceptance, omit --facilitator on both processes:
node "$F/sf30-seller-sdk/serve.mjs" --config /private/merchant/seller.json --port 8423
node "$F/sf30-seller-sdk/serve.mjs" --config /private/merchant/standby/seller.json --port 8425
node "$F/sf102-seller-recovery/recovery.mjs" probe \
  --bundle /private/backup/sf102-20261011-a \
  --current http://127.0.0.1:8423 \
  --standby http://127.0.0.1:8425
```

In production, make the standby's original service accessible via operator-owned **loopback** network path on its own host; both endpoints must be accessible as `127.0.0.1` on the machine running `probe` (e.g. existing authenticated SSH local forwarding, configured by the operator). SF102 never negotiates SSH, contacts a public server or flips DNS. `probe` only asks original `/_seller/health` and `/_seller/offers`; it **never sends a paid API request, payment header or settlement request**. Reports matched exact compiled offers and route/method/URL/mode metadata. A successful parity check is necessary for a migration but not proof the reverse proxy, backend, payment facilitator or wallet will function. Switch HTTPS traffic and run original merchant settlement acceptance using the separate SF96/SF98 workstreams with the merchant's authorization.

## What gets delivered

`pack` creates a new private directory `0700`, including `seller.json` (original route declarations with rebased `./assets/<id>.json` paths), exact JSON byte snapshots under `assets/`, and `manifest.json` with route/payment fingerprints, asset SHA-256, original/staged config SHA-256 and canonical origin. Files are create-only `0600`; existing output directories are never overwritten. The original config and data are not modified. The manifest does not publish recipient addresses or atomic prices, but the private `seller.json` necessarily contains original payment terms: **do not post the bundle to a public repository or Slack channel**.

`verify` ensures manifest/schema/route/asset correspondence, hash integrity, strict UTF-8 JSON and no unexpected files, including explicit symlink and size guards. `restore` verifies the source and creates a distinct private destination with the same staged config/assets and a receipt. No scripts, wallet keys, facilitator secrets or imported application modules are copied. For inline `response` routes, the unchanged exact JSON travels inside `seller.json`.

## Boundaries and commercial value

This creates a portable operator asset for **existing static paid datasets/APIs**: a customer can recover from a failed host, stage a replacement and preserve unchanged payment terms before proxy cutover. It works alongside current SF30 seller (including SF61 OpenAPI-derived static configs), SF93 support handoffs, SF99 HTTPS deployment and SF98 settlement notification without modifying those owner files or introducing parallel payment logic. Imported offers keep their original embedded HTTPS URL; changing `publicOrigin` or changing wallet/asset/price is *not* a restore operation and needs fresh original seller compilation and a new merchant acceptance review.

No GitHub Actions, background timers, server processes, scheduled tasks, hosted spend or submission/transaction are started by SF102 itself. Its scoped CLI output contains hashes/counts, never the JSON dataset body.
