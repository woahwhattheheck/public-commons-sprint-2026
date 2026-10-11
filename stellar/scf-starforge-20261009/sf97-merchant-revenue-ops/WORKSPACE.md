# Merchant pricing workspace

The original SF97 merchant revenue tool now has a local browser workflow. An
operator opens the current SF30 seller configuration and its original operations
capture, enters commercial assumptions, reviews every offered payment choice,
and saves a complete version of the existing report. A later session can reopen
the report, download usable merchant terms, or reuse the assumptions in another
review.

The workspace calls the same `merchantTerms`, `analyze`, and `createReport`
functions as the maintained SF97 CLI. Payment normalization, ordered option
binding, decimal validation, BigInt money calculations, traffic validation and
native reconciliation stay in the original implementation. This adds an operator
interface and private saved versions; it does not change seller prices or start
a payment, seller, webhook worker or external request.

## Start with an existing merchant

Use Node 22+ on the operator host and the current original source checkout. No
additional packages, database, hosted service or GitHub Actions are needed.
The parent of the workspace directory must already exist. The workspace itself
is created with mode 0700 and saved files use mode 0600. An existing workspace
must already be private and use a real, absolute, normalized directory path.

From the repository root:

```sh
node stellar/scf-starforge-20261009/sf97-merchant-revenue-ops/workspace/cli.mjs \
  --config /private/merchant/seller-service.json \
  --state /private/merchant/pricing-workspace \
  --ops-url http://127.0.0.1:8424 \
  --port 8457
```

The command prints the local workspace URL. Open it directly in the operator's
browser. Keep this listener on the operator host; it has no public bind option.
The live source is the **existing** SF30 operations listener's `/api/snapshot` or
`/export.json`, with its actual session, routes and counters. A root operations
URL is normalized to `/api/snapshot`. Live reads accept only HTTP loopback,
reject redirects, and use the original four-second capture timeout. There is
no background polling.

For a saved original operations export, replace `--ops-url` with:

```sh
--snapshot /private/merchant/original-seller-traffic.json
```

To include the existing native companion in every saved review, add:

```sh
--native-outbox /private/merchant/existing-sf98-outbox
```

The companion reads that actual existing outbox through original
`native-reconcile.mjs`. Its output is saved under `report/native-settlement/`,
with the same original event, option, session and delivery semantics. A failure
to produce the requested companion prevents the incomplete review from becoming
a saved version; prior saved work remains available. Omit the option when the
merchant does not have that original journal.

## Complete a pricing review

1. Check the seller configuration, observed session and capture time. **Refresh
   operations** obtains another original capture while retaining the form's
   commercial values. A captured snapshot stays fixed for calculation and save;
   newly arriving traffic does not silently change a review already being edited.
2. Enter the merchant name and shared monthly fixed cost. Leave an unknown fixed
   cost blank. Open each service in the service list.
3. Enter the actual quoted USD unit value, quote basis, merchant's monthly
   paid-volume target, and known per-fulfillment/per-challenge USD costs. Unknown
   optional costs stay blank. All USD values retain decimal strings to six
   places; the browser never converts them to floating-point amounts. Monthly
   volume must be a nonnegative safe integer. A new route starts with blank
   pricing and a visible target of zero, not invented demand.
4. Review the complete payment choices shown on each service: network, atomic
   amount, scheme, asset, recipient, timeout and any original `extra` metadata.
   Both original definitions and imported offers use the original normalization.
   The workspace derives **all ordered** `expectedPayments` from this exact
   seller source. The quoted USD value and costs are a common route assumption;
   they are not multiplied by the number of options or converted from atomic units.
5. **Calculate review** runs the original analyzer without saving. Inspect the
   monthly plan, route counts and original operational issues. Unknown costs
   remain unknown in the totals. A commercial target and an HTTP 2xx count have
   their existing distinct meanings; this review is not a booked revenue ledger.
6. Give the review a name and **Save review**. This validates the same inputs,
   writes the original HTML/JSON report, optionally generates the native
   companion, and commits one immutable private version.

Every save checks the exact seller bytes again. If configuration changes before
save, refresh the source and review its current choices. Refresh preserves
entered assumptions for matching route IDs and exposes new or changed services.
It does not preserve a removed route in new terms. Earlier versions retain their
actual original seller configuration, option set and raw operations capture.

The initial workspace can be opened while the operations source is unavailable;
saved history is still readable and the form remains available. Restore that
configured source and refresh before calculating or saving. Captures are retained
in memory for up to sixteen distinct snapshots; refresh after restarting the
workspace or after an old capture expires.

## Reopen, compare and reuse

Start the same command with the same private `--state` after a restart. The form
loads the latest saved merchant assumptions and the current seller source.
**Saved reviews** lists the most recent one hundred versions and their planned
gross and contribution after fixed cost. Open their existing reports side by
side to compare the captured sessions and merchant assumptions. Full committed
history remains on disk, including versions older than the recent list.

**Use assumptions** copies a saved review's commercial values into a new review
against the current seller configuration. It asks before replacing unsaved form
edits, retains the original saved version, and requires the next save to match
the latest workspace revision. If another tab saved while this form was open,
its save cannot overwrite that work: refresh and select the desired saved
assumptions before creating a new version.

Each saved version offers the usable original `terms.json`, original report JSON,
original operations capture, and version manifest. Native companion exports are
listed when attached. **Open report** serves the original script-free HTML.
The downloaded `terms.json` can be used directly with the existing CLI:

```sh
node stellar/scf-starforge-20261009/sf97-merchant-revenue-ops/analyze.mjs \
  --config /private/merchant/seller-service.json \
  --terms /private/merchant/downloaded-terms.json \
  --snapshot /private/merchant/original-seller-traffic.json \
  --output /private/merchant/new-cli-review
```

Keep seller/operations/terms from the same approved review when reproducing its
result. The original CLI continues to reject stale option bindings and mismatched
traffic routes. Independent chain and fulfillment accounting remain in the
existing [merchant accounting](../merchant-settlement-accounting/README.md) and
native merchant services.

## Saved-state and restart behavior

The private directory contains `versions/`, `successors/`, and `pending/`.
Each committed version contains exact original `seller.json` and `snapshot.json`
bytes, generated `terms.json`, original `report/` outputs, and `manifest.json`
with SHA-256 and byte counts. Downloading saved files verifies their committed
bytes and refuses changed paths or contents.

A new review is completely written and flushed before publication. Its manifest
is atomically linked as the previous revision's sole create-only successor.
This is the cross-process compare-and-swap: two tabs or two listeners may read
the same state, but only one can publish its successor. No stale PID lock can
prevent restart. A process loss before publication leaves only uncommitted
staging, which readers ignore. A process loss after publication is recovered
from the same committed version. Repeating the same request ID and exact inputs
returns that original save; reusing the ID for different inputs fails.

Use a local filesystem with atomic hard links and directory fsync support for
the state directory. A remote object mount is not a supported replacement. The
workspace never deletes committed versions or rewrites the original merchant
source or native outbox. Filesystem ownership and backup remain the operator's
existing responsibility.

The listener validates Host, Origin and browser request context. Mutations use a
random per-process workspace header; cross-origin requests, wildcard paths and
arbitrary file reads are rejected. Static interface assets are served locally,
and original HTML reports retain a script-free policy. No browser local storage,
telemetry, external fonts or libraries are used.

## Integration interface

- Source command: `sf97-merchant-revenue-ops/workspace/cli.mjs`.
- Distribution alias: `revenue-workspace`; include the complete original
  `sf97-merchant-revenue-ops` component in the maintained distribution manifest.
- Existing exports added to `analyze.mjs`: `merchantRoutes(seller)`,
  `merchantTerms(seller, commercial)`, `readJson(path, label)`,
  `liveSnapshot(url)` and `createReport(argv)`. The original CLI `main(argv)`
  retains its JSON status output and also returns that result.
- Embedding: `startWorkspace({config, directory, snapshot, opsUrl,
  nativeOutbox, port})` returns `{url, server, model, close}`. Select exactly one
  of `snapshot` and `opsUrl`. No automatic seller launch or external contact is
  performed by the embedding interface.

Original SF74 support and merchant commercial owners can consume the unchanged
report and terms schemas. The workspace is an additive native merchant adoption
workflow for the single SCF project, not another grant submission.
