# PostgreSQL source-to-fleet native continuation

This experiment runs the complete PostgreSQL product handoff in the original
execution owner's existing native job. It consumes the original public
`postgres/demo-database.mjs` and `postgres/example-seed.sql` fixture, the existing
authoring and release consoles, the fleet workbench, original release stores,
native CLI, managed browser, and merchant MCP provider.

The production source is composed on PostgreSQL PR #1185 at
`2b9a7387e8e8408b9de8a03959b839fadeb85f47`. That original commit owns the
`postgresPackage: prepared.directory` review field and its complete engine. The
downstream production change consists of thirteen files for the source selector,
browser handoff, shared download helper and guides. The acceptance scripts live
only under this experimental directory.

## Use the original execution host

Use the existing Node.js 22.16 or later and the complete maintained merchant
dependency closure prepared for the original PostgreSQL source. The public
fixture uses `pg`, `pg-cursor`, `@electric-sql/pglite`, and
`@electric-sql/pglite-socket`; the original runtime uses its declared x402,
Stellar SDK and other merchant dependencies. Preserve their original package
manifests, lockfiles, licenses and exact versions in the source/runtime intake.
The driver adds no runtime installation or database engine download.

The browser helper uses the host's existing Python Playwright and Chromium.
The accepted C4E8 host has `/usr/bin/chromium` and Python Playwright. Run this
continuation sequentially in its existing PostgreSQL operation after the
original engine's phases, while that owner retains execution custody.

```sh
export PG_FLEET_SOURCE=/mnt/data/work/scf-pg03/source
export PG_FLEET_OUTPUT=/mnt/data/work/scf-pg03/fleet-continuation
export PG_FLEET_PYTHON=python3
export PG_FLEET_CHROMIUM=/usr/bin/chromium
node --max-old-space-size=256 "$PG_FLEET_SOURCE/experiments/postgres-fleet-acceptance/journey.mjs"
```

`PG_FLEET_SOURCE` must be the complete composed public source checkout and
resolve the retained dependencies. `PG_FLEET_OUTPUT` is a new private output
directory on the admitted host. Put `browser.py` beside `journey.mjs`.

If the original owner keeps its exact public four-row database running, pass its
existing local connection in `PG_FLEET_PUBLIC_DEMO_URL` inside the process
environment. The driver verifies the original four public records, uses that
same database, and restores the one edited demo title on completion. The
original owner closes that database after the continuation. Without that
variable, the driver starts the unchanged public demo child and owns its
shutdown; close the preceding fixture before using this mode. Connection
values and local browser capabilities remain inside the host process and its
temporary private bridge files.

## The single joined journey

1. Use the original PostgreSQL browser to select the public `id`, `title`, and
   `price_cents` columns, bounded `region` and `minimum_id` parameters, ordered
   output, exact payment terms and merchant origin. Export through the original
   API and download its reviewed fleet source without a separate release store.
2. Create the next package versions through that same original source API.
   Review all four source packages in the original Seller releases console
   using relative paths, then download the canonical source definitions. Blank
   single-seller ports remain irrelevant to this fleet download.
3. Import the native source into the intended fleet card, change source type and
   restore its review, reopen the downloaded draft, and export the actual launch
   ZIP. Check the original manifest through every step and render the existing
   browser at desktop and 390-pixel widths.
4. Interrupt the original bootstrap during PostgreSQL package capture through
   its public owner signal, observe no committed release, then run the ZIP's
   unchanged original setup command against that same retained directory to
   complete two merchants and four private release stores. Run the original
   foreground fleet CLI, change a
   reviewed package's bytes, observe the original refusal, restore those bytes,
   and stage the same selected source successfully.
5. Serve exact original paid-query responses through the installed x402 SDK and
   the public merchant operations journey's local facilitator protocol. Retain
   the original numeric string `900719925474099312345`, `東京 demo`, two selected
   rows and the three public fields.
6. Open the same retained managed workspace and its original merchant Operations
   link. Initialize the existing merchant MCP provider with the ZIP's exact
   commands and that same retained fleet directory.
7. Stage through MCP, compare the exact price change, prepare a replacement,
   activate while an original request drains, retire after completion, and roll
   back `10000 → 12500 → 10000`. Update the one public demo row and observe that
   the retained PostgreSQL configuration reads live data.
8. Close the provider, relocate original package directories, repeat the original
   setup, reopen MCP at retained fleet revision 3, and verify the same immutable
   release identities and live-query output. Close every driver-owned process.

The local facilitator is a controlled fixture for the original installed SDK.
The receipt records its verification and settlement counters, exact response
hashes and native lifecycle results. The original engine owner's provider and
payment runs remain attributed to their own source and operation.

## Outputs and recovery

`receipt.json` records milestone completion, original production-source hashes,
the actual database version, response hashes, source review identities and
cleanup. The output directory retains screenshots, browser export ZIP, source
downloads and original release state. Browser bridge files containing temporary
local capabilities are removed during cleanup.

The driver checkpoints completed browser/setup/CLI phases. If the execution
owner interrupts a later phase, inspect that receipt and the original fleet
state before resuming the concrete remaining operation. Repeating against an
already complete receipt refuses a second full run. Native original release IDs
and setup journals retain their own lifecycle state throughout.
