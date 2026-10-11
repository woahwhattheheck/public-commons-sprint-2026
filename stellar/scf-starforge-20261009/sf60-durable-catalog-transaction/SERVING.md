# Serve an operator-owned durable catalog

`service.mjs` makes the original SF60 committed catalog available through the
original Bazaar HTTP discovery API. Node 22+ is the only runtime dependency.
The service does not introduce a second catalog, parser, ranker or persistence
format. Existing trust, lifecycle, cursor and withdrawal semantics are retained.

For signed seller admission, revisions and withdrawal while discovery stays
online, use the [live operator and command-line client](./OPERATOR.md). It owns
this same journal and discovery implementation, with private Unix or
authenticated loopback control for the operating-system user.

## Start from an existing journal

Stop the current standalone SF60 owner cleanly, then run from the repository:

```sh
node stellar/scf-starforge-20261009/sf60-durable-catalog-transaction/service.mjs --directory /private/catalog --port 8787
```

The directory must already contain `catalog-commits.json`. A missing path is an
error, preventing a typo from silently serving an empty catalog. For an explicit
empty installation, add `--create-empty`; this does not create seller records or
pretend to establish consent. No sample entries are inserted.

Startup replays the original committed journal. Malformed records abort startup.
The command prints the actual bound URL, including an assigned port when `--port
0` is used. The listener binds only to `127.0.0.1`. Use that exact host, not a
different Host header or cross-origin browser request. Integrate an existing
operator-local explorer through its server-side proxy.

Available GET routes:

| Route | Result |
| --- | --- |
| `/discovery/resources?limit=20&offset=0` | Original resources and pagination total |
| `/discovery/resources?network=stellar%3Atestnet&scheme=exact` | Original same-offer network/scheme filtering |
| `/discovery/search?query=weather&limit=20` | Original ranked search and opaque next cursor |
| `/healthz` | Current active resource count, committed operation count and journal head |

`type`, `extensions`, `payTo`, `network`, and `scheme` retain the original Bazaar
filter behavior. To continue search, send the returned `pagination.cursor` with
the **same query and filters**. List uses offset; search uses cursor. Retirement
and updates performed by the original owning process affect subsequent reads.
The API returns `resources`, not a rewritten provider `items` envelope.

All requests are GET-only. There are no ingestion, signer, settlement, wallet,
admin-write or remote-fetch routes. The raw journal, signer identities and
operator policies are not served. Application authorization stays in the existing
operator process; localhost is not an authentication system for other local users.

## Retain one writer and serve its live catalog

Standalone mode holds SF60's existing `.catalog-writer.lock` for its entire
lifetime. It will **refuse** another owner's lock; it never deletes or steals it.
For a long-running authenticated operator that already ingests or retires offers,
mount the service in that same process instead of starting a second owner:

```js
import { DurableCatalogTransaction } from './journal.mjs';
import { serveDiscovery } from './service.mjs';

const catalog = await DurableCatalogTransaction.open('/private/catalog');
const http = await serveDiscovery({ catalog, port: 8787 });
try {
  // Existing authenticated operator logic owns catalog.ingest()/retire().
  // HTTP clients only call the original list/search operations.
  await runExistingOperator();
} finally {
  await http.close();   // Detaches HTTP; does not close the supplied catalog.
  await catalog.close();
}
```

`serveDiscovery` requires the actual original `DurableCatalogTransaction`, not an
object impersonating it. Its health route changes to 503 if the owning journal
becomes unusable. An owning operator must close the HTTP listener before closing
the journal. `openDiscovery` is the standalone convenience API and closes both.
SIGINT/SIGTERM on the CLI closes the listener and releases the owned journal lock.
An unclean crash retains the original SF60 manual orphan-lock recovery rules.

The SF61 explorer workstream can consume these two existing discovery endpoints;
this backend supplies no competing browser interface. The source delivery
addresses runnable durable self-hosting in the SF10 readiness plan. It does not
establish mainnet deployment, seller authorization, live payment acceptance or
an approved grant application.
