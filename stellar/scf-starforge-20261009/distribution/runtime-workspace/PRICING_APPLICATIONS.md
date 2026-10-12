# Merchant pricing and scenario planning in Applications

The original Applications runtime can open and operate the merchant pricing
workspace. It retains the selected seller, traffic source, saved reviews and
scenarios in one application. The same managed process supplies the **Open
application**, **Scenario planning** and **Supplier costs** links, then closes through **Stop** and
reopens the merchant's saved work on the next start.

## Select the merchant

Use a READY installation containing the current SF97 pricing workspace and its
`stellar-forge.merchant-pricing-workspace-launch.v1` launch contract. Open the
runtime console, choose **Applications → New application → Merchant pricing and
scenario planning**, and select the original merchant inputs.

| Setting | Selection |
| --- | --- |
| Private pricing workspace | The existing saved workspace, or one new directory in an existing private parent. |
| Complete pricing and supplier-cost backup | Optional original WORKSPACE_BACKUP TAR, with a new receiving directory or this same original restoration. |
| Original seller configuration | The current SF30 seller JSON, including its complete ordered payment options. |
| Original operations URL | The merchant's existing loopback SF30 operations listener. Use this source by itself. |
| Original session traffic export | A saved original session export. It can be selected with a retained usage export. |
| Original retained usage export | A saved original history export, retaining its range and route selection. |
| Existing native settlement outbox | Optional original SF98 journal for the native companion in saved reports. |
| Original API merchant package | Optional original authoring package for reviewed seller price changes. |
| Existing seller release store | Optional existing release store, together with that original package. |
| Original release runtime JSON | Optional settings for the selected release store. |
| Local port | Use `0` to have the original server select an available loopback port. |

Choose the operations URL or the saved export files. A live history URL can carry
the original date and route selection; the pricing application retains its normal
source controls. The optional environment JSON follows the existing managed
Applications behavior.

**Review application** displays the exact original command and selected runtime.
**Save application** connects the installation through its existing managed release.
For ordinary opening, it creates the reviewed pricing directory when needed.
For backup receiving, the native restore creates its target during the reviewed start. **Review start →
Start reviewed application** runs the original `revenue-workspace` command.

For example, a merchant using its live operations listener runs:

```text
starforge-merchant revenue-workspace \
  --config /private/merchant/seller-service.json \
  --state /private/merchant/pricing \
  --expected-config-sha256 REVIEWED_ORIGINAL_SELLER_SHA256 \
  --ops-url http://127.0.0.1:8424 \
  --port 0
```

Applications supplies the actual seller digest. The original pricing reader
checks those bytes when its process starts, before creating the workspace or
opening the listener. If the merchant configuration changed after review, review
the current selection and start it again. This check binds launch; the original
pricing application continues to refresh and review later source changes.

Opening the application reads the original seller and retained workspace. Traffic
capture remains in its original source controls. A temporarily unavailable
operations listener or saved traffic export leaves saved reviews and scenarios
available; restore the configured source and use **Refresh operations** for a new
commercial review.

## Complete the commercial workflow

1. Open the pricing application. Select the original current session or retained
   usage period and refresh that capture. Enter the merchant's actual USD quotes,
   expected volumes, variable costs and shared fixed costs. Unknown optional
   costs can remain blank.
2. Calculate and save a pricing review. The original writer retains the exact
   seller, payment options, source traffic, commercial terms and report together.
3. Open **Scenario planning** from Applications or the pricing header. Select the
   saved review, name the scenarios, and vary demand, quoted values or costs.
   Compare contribution, margin, break-even and exact price or volume targets.
4. Save the comparison and download its complete JSON, scenario CSV and selected
   merchant terms. Reopen a saved comparison to recover the same plan identity
   and reviewed source.
5. Use the selected scenario in a pricing review. The original pricing form
   carries the chosen commercial values into its current source review and save.
   Its separate **Prepare price change** flow edits explicit atomic payment
   amounts. With an attached original package and release store, a saved price
   decision can enter the merchant's existing staged-release workflow.

The [pricing workspace guide](../../sf97-merchant-revenue-ops/WORKSPACE.md) covers
source selection, native settlement, exact payment choices and repricing. The
[planning guide](../../sf97-merchant-revenue-ops/PLANNING.md) describes scenario
inputs, exact arithmetic, goal calculations, recovery and exported files.

## Stop and reopen

Choose **Stop application** in the managed runtime. Its existing worker signals
the original pricing process, whose HTTP close drains its handlers and closes
idle connections. The run retains its output and original launch identity. The
application's pricing reviews, scenario comparisons, price decisions and staged
release records remain in the selected directory.

The runtime console itself can be closed and reopened while the merchant process
runs. The current Applications entry returns its original operation and links.
After a completed stop, **Review start → Start reviewed application** opens the
same saved merchant data with a new process and actual local URL. Select its
previous reviews and scenarios to continue work.

When the merchant moves a received pricing workspace to another host, select that
real directory and its original seller/source paths in a new application. The
original saved source and report histories retain their identities. Use the
merchant's established backup and receiving workflow to transfer those complete
files.

## Original startup and installed source

The original CLI emits one startup object containing its schema, existing
`MERCHANT_PRICING_WORKSPACE_READY` status, canonical `state` and `configPath`, the
actual `configSha256`, `pid`, `url`, `planningUrl` and `costsUrl`.
A backup receiving start also reports `costRestore`, including the actual archive,
receiving directory, restored archive digest, complete file count and replay state. Applications accepts the
reported links for that selected seller, workspace and requested port. The
planning link stays on the original server at `/planning`.

`application-pricing.mjs` supplies the catalogue fields, original argument
preparation and startup interpretation. The existing Applications model owns
configuration, installation adoption, process history, stopping and reopening.
The existing SF97 model and planning workspace own all calculations, review
versions, exports and application of selected commercial terms. These files are
part of the maintained distribution's original runtime-workspace subtree.

## Supplier costs and complete recovery

The original pricing workspace opens **Supplier costs** on `/economics`.
Optional **Original supplier usage export** and **Original accounting report**
fields select the original context for explicit capture in that workspace.
Saved originals, cost editions and pricing decisions remain readable when a
configured live observation source is temporarily unavailable.

Start with a saved pricing review for the intended merchant routes and period.
Upload the supplier's original bill, credit note or quotation, map its exact
columns or retain manually reviewed lines, then allocate the signed amounts.
The native page keeps currency, billed and quoted basis, unassigned money,
period alignment and route coverage visible. Save a complete cost edition and
review its eligible proposal before applying costs to a new original pricing
review. Continue that review through **Scenario planning** or its original
atomic price-change and release actions.

### Receive a complete merchant workspace in Applications

Export **WORKSPACE_BACKUP** from the existing Supplier costs page, or receive
the original backup through the maintained merchant pricing MCP/CLI downloader.
Keep its complete original TAR, up to the native 512 MiB limit.

1. Open **Applications → New application → Merchant pricing and scenario
   planning** in the selected READY installation.
2. Enter a new **Private pricing workspace** beneath an existing private
   parent. Select the complete TAR in **Complete pricing and supplier-cost
   backup**. An existing incomplete restoration uses the same directory and
   archive.
3. Select the original seller configuration and its session/history export or
   operations URL. These identify the merchant and the source for future
   reviews. Saved reviews retain their own original seller and observations.
4. Choose **Review application**. The **Receive pricing and supplier costs**
   review shows the archive path, complete SHA-256 and byte count, retained file
   count, receiving directory and original restoration state. It also shows
   supplier originals, saved cost editions, pricing reviews, scenario plans,
   price changes and cost links carried by that backup.
5. Save the configuration, then **Review start → Start reviewed application**.
   Both reviews read the complete original archive. The saved start supplies
   its exact digest to the native restore. A changed archive is rejected before
   any receiving target is created or populated.
6. Open **Supplier costs** to read its original documents and saved editions.
   Open **Scenario planning** and the pricing history to continue the restored
   comparisons and saved reviews. All three links belong to the same original
   pricing process and directory.
7. Stop and reopen that application normally. A completed restoration reopens
   its current retained work, including changes made after import. After
   successful receiving, the configuration can clear the optional backup field
   while keeping the same pricing directory. This permits later starts after
   the handover TAR has been moved to its retained archive location.

The native restore creates a new private target or continues its own original
restoration. It retains complete files and original completion records; a
pre-existing unrelated workspace is not a receiving destination. Choosing
another backup uses a new receiving directory. The same original archive and
destination recover an interrupted import.

A single **COST_EDITION** export remains useful for its original edition
handover. It does not contain the complete pricing workspace required by this
receiving action.

### Inspect or receive through the same CLI

Inspect the full archive and destination without opening a listener or creating
the workspace:

```sh
starforge revenue-workspace \
  --inspect-cost-workspace /private/received/pricing-cost-backup.tar \
  --state /private/merchant/received-pricing
```

Retain the returned `sourceArchiveSha256`, then use that exact value with
`--expected-cost-backup-sha256` when starting:

```sh
starforge revenue-workspace \
  --config /private/merchant/seller-service.json \
  --snapshot /private/merchant/original-seller-traffic.json \
  --restore-cost-workspace /private/received/pricing-cost-backup.tar \
  --expected-cost-backup-sha256 REVIEWED_FULL_BACKUP_SHA256 \
  --state /private/merchant/received-pricing --port 0
```

Replace the digest placeholder with the inspected 64-character value. A source
checkout uses `node stellar/scf-starforge-20261009/sf97-merchant-revenue-ops/workspace/cli.mjs`
in place of `starforge revenue-workspace`. The direct restore command remains
available without the optional digest; Applications supplies it automatically.

The original [Supplier costs guide](../../sf97-merchant-revenue-ops/economics/README.md)
defines monetary allocation, coverage, pricing proposals, comparison and the
complete archive. The [merchant MCP cost guide](../../../../stellar-forge/mcp-merchant-operator/COSTS.md)
covers the same source/book aliases, exact saved requests and resumable complete
file receiving.
