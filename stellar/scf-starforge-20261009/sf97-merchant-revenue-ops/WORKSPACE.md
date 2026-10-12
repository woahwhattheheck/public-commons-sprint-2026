# Merchant pricing workspace

The original SF97 merchant revenue tool now has a local browser workflow. An
operator opens the current SF30 seller configuration and its original session or
retained usage history, enters commercial assumptions, reviews every offered
payment choice, and saves a complete version of the existing report. A later
session can reopen the report, compare saved periods, download usable merchant
terms, reuse the assumptions, or prepare exact atomic price changes from a saved
review and carry them into the seller's existing release workflow.

The workspace calls the same `merchantTerms`, `analyze`, and `createReport`
functions as the maintained SF97 CLI. Payment normalization, ordered option
binding, decimal validation, BigInt money calculations, traffic validation and
native reconciliation stay in the original implementation. Saved pricing reviews
and prepared seller configurations have independent private version histories.
The original seller launcher and release console handle deployment and runtime
selection.

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
The live source is the **existing** SF30 operations listener. Its `/api/snapshot`
or `/export.json` supplies the current session, and `/api/history` or
`/history.json` supplies original retained usage. A root URL initially selects
`/api/snapshot`; the browser can switch to retained history on that same listener.
Live reads accept only HTTP loopback, reject redirects, and use the original
four-second capture timeout. There is no background polling.

For a saved original operations export, replace `--ops-url` with:

```sh
--snapshot /private/merchant/original-seller-traffic.json
```

For an original retained-history export, use:

```sh
--history /private/merchant/original-usage-history.json
```

Both file flags can be provided together so the operator can switch between the
two original exports. File inputs keep the range and route selection already in
the export. Use `--ops-url` by itself when requesting fresh date ranges. A history
URL may initialize the original selection, for example:

```sh
--ops-url 'http://127.0.0.1:8424/api/history?from=2026-10-01&to=2026-10-11'
```

The live history selector accepts only the original `from`, `to`, and `routeId`
parameters. Select actual UTC dates and an ordered interval of at most 366 days.
Leaving a live date blank uses the original history service's default. The
workspace preserves the returned retention clipping and effective interval.

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

1. Check the seller configuration and selected source. Choose the current session
   or retained period; for live history, apply the desired UTC range and optional
   original route filter. **Refresh operations** obtains another original capture
   while retaining commercial values. A capture stays fixed for calculation and
   save; newly arriving traffic does not silently change a review being edited.
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
   monthly plan, route counts and original operational issues. For retained
   history, inspect the original daily review and route variants described below.
   Unknown costs remain unknown in the totals. A commercial target and an HTTP
   2xx count have their existing distinct meanings; this review is not a booked
   revenue ledger.
6. Give the review a name and **Save review**. This validates the same inputs,
   writes the original HTML/JSON report, optionally generates the native
   companion, and commits one immutable private version.

Every save checks the exact seller bytes again. If configuration changes before
save, refresh the source and review its current choices. Refresh preserves
entered assumptions for matching route IDs and exposes new or changed services.
It does not preserve a removed route in new terms. Earlier versions retain their
actual original seller configuration, option set and raw operations capture.

## Review retained periods

Retained usage comes from the original SF30 history writer. If history is disabled,
the workspace identifies that source as unavailable. Enable the existing
operations launcher's history directory on the merchant host:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/operations/launch.mjs \
  --history-dir /private/merchant/seller-usage --history-days 90 -- \
  --config /private/merchant/seller-service.json
```

Use a private history directory for that original merchant service. The
[operations guide](../sf30-seller-sdk/operations/README.md#retain-and-compare-daily-usage)
describes its checkpoint, restart and retention behavior. The pricing workspace
reads its exports and does not take over the writer.

The source panel displays the requested and effective range, actual observed UTC
days, contributing sessions, modes and storage condition. Session rows retain
their original active/finalized/interrupted state, capture and checkpoint times,
outstanding requests and observer errors. The original session/day/route coverage
is used when present; older exports retain the original legacy coverage handling.

The commercial preview uses the original `usageHistory` and `periodReview`:

- Each retained day shows actual request starts and completions, 402/2xx outcomes,
  and the original modeled values and costs. An absent day has no saved
  observations and is not filled with invented zeros.
- Original route ID, method and path variants remain separate. Current terms
  apply only to matching current variants; historical and removed variants stay
  visible with their original unpriced outcomes.
- Monthly targets are applied once to the selected current service scope.
  Selecting more days or sessions does not multiply the monthly plan. A route
  filter retains the original engine's treatment of shared monthly fixed cost.
- The native companion uses the same retained days, original session coverage,
  ordered payment options and exact recipient groups. Its output remains attached
  to that saved period; overlapping sessions are handled by the original
  reconciliation rules.

Switching source or applying dates updates this browser's capture. Another open
tab keeps its own selected source and reviewed bytes. Selecting a saved export
does not enable date editing: obtain another original history export or use the
live listener to review a different interval.

The initial workspace can be opened while the operations source is unavailable;
saved history is still readable and the form remains available. Restore that
configured source and refresh before calculating or saving. Captures are retained
in memory for up to sixteen distinct exports and at most 64 MiB of source bytes.
Refresh after restarting or after an old capture expires. The original reader
retains its 2 MiB session/configuration limit and 64 MiB history limit. Saved files
must fit 64 MiB each; select fewer original history days or one route if a generated
report exceeds that size.

## Reopen, compare and reuse

Start the same command with the same private `--state` after a restart. The form
loads the latest saved merchant assumptions and the current seller source.
**Saved reviews** lists the most recent one hundred versions and their planned
gross and contribution after fixed cost. Select two versions and compare them in
the workspace. It opens their exact saved reports and shows each original period,
coverage, monthly plan and service values side by side. Configuration, commercial
terms, observation kind and interval identity show whether the two reviews use
the same inputs. Comparison displays the maintained report values without
recalculating, interpolating days or treating unlike periods as equal. Full
committed history remains on disk, including versions older than the recent list.

**Use assumptions** copies a saved review's commercial values into a new review
against the current seller configuration. It asks before replacing unsaved form
edits, retains the original saved version, and requires the next save to match
the latest workspace revision. If another tab saved while this form was open,
its save cannot overwrite that work: refresh and select the desired saved
assumptions before creating a new version.

Each saved version offers the usable original `terms.json`, original report JSON,
original `snapshot.json` or `history.json` capture, and version manifest. Native companion exports are
listed when attached. **Open report** serves the original script-free HTML.
The downloaded `terms.json` can be used directly with the existing CLI:

```sh
node stellar/scf-starforge-20261009/sf97-merchant-revenue-ops/analyze.mjs \
  --config /private/merchant/seller-service.json \
  --terms /private/merchant/downloaded-terms.json \
  --snapshot /private/merchant/original-seller-traffic.json \
  --output /private/merchant/new-cli-review
```

For a retained-period review, use the same saved seller and terms with
`--history /private/merchant/downloaded-history.json`. This invokes the original
CLI's history dispatch directly.

Keep seller/operations/terms from the same approved review when reproducing its
result. The original CLI continues to reject stale option bindings and mismatched
traffic routes. Independent chain and fulfillment accounting remain in the
existing [merchant accounting](../merchant-settlement-accounting/README.md) and
native merchant services.

## Use a saved pricing decision in accounting

Download **Report JSON** from the saved version. The original accounting
[pricing import](../merchant-settlement-accounting/PRICING.md) converts that
report into validated merchant accounting terms and retains the exact report
bytes alongside them:

```sh
node stellar/scf-starforge-20261009/merchant-settlement-accounting/pricing-cli.mjs \
  --report /private/merchant/pricing/versions/VERSION/report/report.json \
  --out /private/merchant/new-pricing-import
```

Use the resulting `accounting-terms.json` in the existing accounting workspace's
**Sources & imports → Merchant accounting terms → Import & select terms** flow,
or pass it as `--terms` to the original accounting CLI. The import maps every
configured payment option, exact route quote and per-fulfilled cost; unknown
costs remain unknown. Choose the saved report instead of the pricing
`terms.json` because the two tools have distinct terms formats.

For a long or descriptive quote basis, supply `--reference` with an explicit
short accounting label. The original full quote basis, selected pricing range,
source hashes, monthly targets, fixed costs and challenge costs are retained.
The accounting run uses its selected native journals and verification sources;
the pricing assumptions provide its unit valuations.

## Compare demand, price and cost scenarios

Open **Scenario planning** from the workspace header to start with a saved
review. Enter alternative volumes, USD quotes and costs; compare contribution
and margins; review exact break-even or target suggestions; then save and export
the comparison. **Use selected scenario in pricing review** opens its commercial
assumptions in the existing pricing form for calculation and save against the
current operations source. The [scenario planning guide](PLANNING.md) covers
the complete workflow, exact arithmetic, saved comparisons and application API.

## Prepare a seller price change

**Prepare price change** on a saved review opens that review's original seller
configuration. The same action is available through the **Prepare seller price
change** section below the comparison. This connects a commercial review to a
usable seller configuration without editing its JSON by hand.

1. Select the saved pricing review and **Load payment choices**. The workspace
   shows its source configuration identity, original report, merchant valuation
   and every ordered payment choice on every service.
2. Enter the desired **Proposed atomic amount** for each choice being changed.
   Amounts are positive whole-number strings in that asset's smallest unit.
   Keep the current amount for alternatives whose price should stay the same.
   The original SF30 normalizer enforces its signed Soroban i128 limit.
3. Select **Review price change**. Inspect the current and proposed amounts
   together. Use **Inspect terms** on any row, or expand the first choice's
   **Complete payment terms**, for the scheme, network, asset, recipient, timeout
   and extra metadata on both sides.
4. Give the change a name and **Save configuration**. The complete original
   seller shape is retained, with just the selected payment amounts changed.
   A private decision version holds that configuration, its source review and
   the exact before/after terms.
5. Use **Saved price changes** to download the prepared files or stage a retained
   release when the original source package and release store are attached.

The browser sends each edit as a route ID, ordered payment index, expected current
amount and explicit proposed amount. Those identities are checked again against
the saved configuration. The review hash binds the preview to the save. If the
configured seller file changes, create a pricing review of its new configuration
and use that review for the next price change. Earlier decision downloads remain
available.

The USD values displayed beside a route are the saved merchant assumptions.
Atomic inputs are independent strings; the operator explicitly chooses each
asset's price. The exported merchant terms bind the new complete option set
through the original `merchantTerms` function while carrying forward the saved
USD valuation, quote basis, costs and monthly volume target. Revise those
commercial assumptions in a new review when the merchant's agreement changes.

Changing an amount clears the old preview and requires a new review. Switching
the selected source keeps the current form until **Load payment choices** is
used. Refreshing operations retains unsaved amount entries. An interrupted save
can be retried with the same request; a competing save refreshes the decision
history position and keeps the entered amounts available for review. A refresh
also recognizes a completed interrupted save by its original request ID.

The editor displays eight services per page and retains amount entries across
pages. All entered changes are validated together; an invalid amount returns
to its service page. The change table uses the workspace's existing row paging,
and full payment terms are expanded for the selected choice.

### Configuration package

| Download | Use |
| --- | --- |
| `seller.json` | Complete original seller configuration with the reviewed amounts. Relative data references retain their original form. |
| `launch-seller.json` | Configuration for this operator host, resolving the original static response references against the source configuration directory. |
| `terms.json` | Original SF97 merchant terms rebound to all new ordered payment options, with the saved explicit commercial assumptions. |
| `decision.json` | Reviewed before/after terms and source identities for this price change. |
| `source-seller.json` | Exact original seller bytes from the saved pricing review. |
| `source-terms.json` | Exact original merchant terms from that review. |
| `pricing-report.json` | Exact original commercial report that informed the change. |
| `manifest.json` | Retained decision identity, file sizes and SHA-256 values. |
| `source-manifest.json`, `source-plan.json` | Exact original API package manifest and merchant plan when a source package is attached. |
| `source-package/…` | Updated original authoring package when one was attached at workspace launch. |

For an existing service with a static response, run the local launch configuration
through the maintained seller launcher:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/serve.mjs \
  --config /private/merchant/prepared-price-change/launch-seller.json \
  --port 8423
```

Use the merchant's existing facilitator and handler arguments when they are part
of that deployment. An absolute handler module path keeps the same application
binding when the exported configuration lives in a different folder. Local
launch references continue to use the source host's existing data files; use the
complete original authoring package when moving the merchant to another host.

After deploying the prepared seller, point the pricing workspace at its current
configuration and operations source. Its next commercial review will include
the deployed option amounts. The retained `pricing-report.json` continues to
describe the original commercial decision and observation period; subsequent
native settlement reconciliation uses the original merchant accounting workflow
with the appropriate deployed terms and journals.

### Prepare a retained seller release

Attach the original saved API merchant package and an existing SF82 release
store to the workspace:

```sh
node stellar/scf-starforge-20261009/sf97-merchant-revenue-ops/workspace/cli.mjs \
  --config /private/merchant/api-package/compiled/seller-service.json \
  --state /private/merchant/pricing-workspace \
  --ops-url http://127.0.0.1:8424 \
  --source-package /private/merchant/api-package \
  --release-store /private/merchant/releases \
  --release-runtime /private/merchant/release-runtime.json \
  --port 8457
```

The runtime JSON contains the existing release runtime options, for example the
merchant's chosen port and facilitator URL. The source package supplies its
original application bindings. Keep those settings in the private operator
configuration used for this merchant.

The source adapter carries exact payment edits into the original authoring
selections and saves the package through its maintained compiler. A saved
decision with that package offers **Stage retained release**. The action uses
the original SF82 staging implementation and returns the retained release ID.
Repeating a completed stage action recovers the same release.

Open the merchant's existing [seller release console](../sf82-seller-pilot/RELEASES.md)
to compare the staged configuration, select it and restart the original seller
using the console's established controls. The same console retains the previous
release for rollback.

## Saved-state and restart behavior

Pricing reviews use `versions/` and `successors/` in the private state directory.
Each committed review contains exact original `seller.json` and either
`snapshot.json` or `history.json` bytes, generated `terms.json`, original `report/`
outputs, and `manifest.json` with SHA-256 and byte counts. The manifest retains
source selection and compact coverage metadata; detailed original counters remain
in the source and report. Downloading saved files verifies their committed bytes
and refuses changed paths or contents. Existing version-one session reviews remain
readable and can be compared or reused alongside new period reviews.

Seller price changes use the independent `decisions/` and
`decision-successors/` history. A price decision binds its source review, exact
edited configuration, merchant terms and complete optional source package in one
immutable manifest. Staged release receipts are retained separately under
`staged-releases/`, preserving the original decision bytes. The browser reopens
the most recent one hundred price decisions and displays any retained release
ID after restart. Both workflows use `pending/` for uncommitted writes.

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
- Embedding: `startWorkspace({config, directory, snapshot, history, opsUrl,
  nativeOutbox, sourcePackage, releaseStore, releaseRuntime, port})` returns
  `{url, server, model, close}`. Select exactly one
  live `opsUrl`, or one or both original `snapshot` and `history` file paths.
- `model.state(selection)` selects the original source per call. Selection is
  `{kind:'SESSION'|'DURABLE_HISTORY', from:null|string, to:null|string,
  routeId:null|string}`. Date and route fields stay null for file inputs and
  current-session captures. Returned `snapshot.sha256` identifies either original
  observation kind and remains the preview/save input binding.
- `model.compare({leftVersion,rightVersion})` reads two committed original
  reports and returns them with source/terms compatibility information.
- The HTTP interface provides `POST /api/source` and `POST /api/compare` under
  the existing per-process workspace header and local-origin controls. Original
  preview, save, download and assumption-reuse endpoints retain their contracts.
- Repricing source: `POST /api/repricing/source` with `{version}` returns the
  saved review's original ordered choices, commercial inputs, source hash and
  current decision-history revision.
- Repricing preview: `POST /api/repricing/preview` takes
  `{version,sellerSha256,edits:[{routeId,paymentIndex,expectedAmount,amount}]}`.
  Indices are zero-based; atomic amounts remain strings. The response includes
  exact changes, the prepared seller hash and a `reviewSha256` binding.
- Repricing save adds `{requestId,label,expectedRevision,reviewSha256}` to those
  same preview inputs. Its revision belongs to the independent price-change
  history. Workspace state exposes that history as `repricing.history`.
- Decision files are available under `/repricing-files/DECISION/FILE`.
  `POST /api/repricing/stage` with `{decision,reviewSha256}` stages a retained
  source package when the existing release store and runtime are configured.

Original SF74 support and merchant commercial owners can consume the unchanged
report and terms schemas. The workspace is an additive native merchant adoption
workflow for the single SCF project, not another grant submission.

## Allocate original supplier costs

Open the **Supplier costs** link in this workspace to retain original bills, credit notes, quotes and usage context, map complete charge rows, conserve allocations in their source currency, compare corrected editions, and carry a reviewed USD per-fulfilled cost into a new original pricing review. The complete operator workflow and private backup/restore interface are in [Supplier costs](economics/README.md).

Optional `--supplier-usage FILE` and `--accounting-report FILE` supply host-selected original context for explicit capture. `--restore-cost-workspace BACKUP.tar --state NEW_DIRECTORY` restores a complete private pricing-and-cost workspace. Continue supplying the original seller and observation inputs when reopening. Supplier documents and tariff estimates retain their source meanings; the original native payment-price and release decisions remain in this pricing workspace.
