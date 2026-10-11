// MIT. Actual original merchant commands for the selected generated host.
import { join } from 'node:path';
import { shellWord as q } from './host.mjs';

export function retainedOperations(p) {
  if (!p.release) return '';
  const { store, id, expectedGeneration, digest } = p.release;
  const releases = `${q(p.node)} ${q(join(p.sourceRoot, 'stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs'))}`;
  const run = `runuser -u ${p.serviceUser} -g ${p.serviceGroup} -- ${releases}`;
  return `## Retained merchant and discovery

The selected merchant is **${id}**, generation **${expectedGeneration}**, digest
\`${digest}\`. Its original store is ${store}. The original release manager
owns the seller process, source checks, accepted-work drain and cache controls.
The staged runtime owns the listener port, facilitator and application settings.
This host does not replace those settings or create an operations/outbox service.

Prepare the store${p.discovery ? ' and complete discovery setup' : ''} as ${p.serviceUser},
or transfer only those selected private directories to that account before the
installation preflight. Preserve directory 0700 and file 0600 permissions,
including the signing key. The private host bundle remains administrator-owned.
Stop the previous foreground/console/MCP owner before starting the systemd group.

\`\`\`sh
${run} status --store ${q(store)}
${run} inspect --store ${q(store)} --id ${q(id)}
${run} cache-status --store ${q(store)}
\`\`\`

Use the actual instance ID from cache-status for the original cache-invalidate
command. Source status verifies the original process and exact offered terms,
so a different process on the same port cannot satisfy this host's smoke check.
The store generation is pinned in every service preflight. To upgrade or roll
back, stop the group, use the original release diff/activate/rollback command,
put the returned generation in release.expectedGeneration, and generate a new
host bundle. Install that reviewed bundle and start its same target. Keep the
current discovery journal through merchant version changes; review its update
against the newly running release before returning the public listing to buyers.

${p.discovery ? `### Publish and maintain this original listing

Discovery service: stellar-forge-${p.merchant}-discovery.service.
Public resource list: ${p.publicOrigin}/discovery/resources
Public search: ${p.publicOrigin}/discovery/search
Original offer export: ${p.discovery.sourceURL}
Seller: ${p.discovery.sellerId}. Public-key SHA-256: ${p.discovery.publicKeySha256}.
Private setup: ${p.discovery.directory}.

The service runs original catalog-run --no-workspace. It reads the same setup,
key metadata and retained source, then opens the original SF60 writer and its
private capability transport. It never generates a key or publishes on startup.
Only the two GET discovery routes pass through Caddy. The proxy sets the
selected loopback Host and removes browser origin metadata for this public
read-only interface; it does not expose the control transport, key, enrollment
files, journal, health or browser workspace. Merchant payment requests retain
their original headers and routing in their separate existing proxy blocks.

After the seller and catalog are running, use the same original review/apply flow
as the release console and merchant MCP. Choose a new private review filename:

\`\`\`sh
${run} catalog-inspect --store ${q(store)} --setup ${q(p.discovery.directory)}
${run} catalog-status --store ${q(store)} --catalog ${q(p.discovery.connectionFile)} --id ${q(id)}
${run} catalog-review --store ${q(store)} --catalog ${q(p.discovery.connectionFile)} --id ${q(id)} --out /private/NEW_CATALOG_REVIEW.json
${run} catalog-apply --store ${q(store)} --catalog ${q(p.discovery.connectionFile)} --review /private/NEW_CATALOG_REVIEW.json
\`\`\`

Place the review in a real private directory owned by ${p.serviceUser}. Read its
exact resource, payment alternatives and changes before apply. Apply consumes the
original source/release/runtime/catalog-head binding. Reopening an unchanged
listing produces zero changes and issues no new signatures or journal writes.
Use the same catalog-review command with --withdraw ROUTE_ID --reason TEXT for
explicit retirement. A dropped control response is reconciled with catalog-status;
the host never retries a publication or payment automatically.

The existing encrypted maintenance command stops seller then catalog, snapshots
both under privateRoot and restores their complete selected directories. It moves
only the host's release.store and discovery.setup selections. Original release
digests, key bytes, enrollment and catalog journal remain unchanged. The next
maintenance plan refers to the restored directories, so subsequent backups use
the active generation. Existing external application writers remain explicitly
declared in the original maintenance plan.
` : ''}`;
}
