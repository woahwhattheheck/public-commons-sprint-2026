# Haystack building turnover — installed product

The `haystack-turnover` selection delivers the complete native building-data application through the maintained source builder, installer, Applications lifecycle and Merchant host.

The operator imports original Haystack JSON v4, inspects source-local site/equipment/point records, reviews complete typed tag edits, saves editions, compares revisions and hands an editable project to a receiving operator.

| Surface | Entry |
| --- | --- |
| Browser | **Haystack building turnover** in Applications |
| Operator CLI | `starforge haystack` |
| Native MCP | `starforge haystack-mcp --directory ORIGINAL_PROJECT` |
| Browser/Node SDK | `./seller/haystack` |
| Native grid API | `./seller/haystack/types` |
| Durable workspace | `./seller/haystack/workspace` |
| Complete receiving | `./seller/haystack/portable` |
| Managed agent | `haystack-workspaces` provider |
| Selected installation | `--selection haystack-turnover` |

The complete [operator guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/haystack-workspace/OPERATING.md), [native/API guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/haystack-workspace/README.md), [Haystack source contract](../../stellar/scf-starforge-20261009/sf30-seller-sdk/haystack-workspace/HAYSTACK_CONTRACT.md) and [Merchant configuration](../../stellar/scf-starforge-20261009/sf30-seller-sdk/haystack-workspace/MERCHANT.md) ship with the product.

## Build the selected application

Choose **Haystack building-turnover workspace** in the existing Runtime workspace's source-selection view. Select the full source commit and a new owned output directory.

The maintained source command is:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-workspace-checkout \
  --ref ORIGINAL_COMPLETE_COMMIT \
  --selection haystack-turnover \
  --out /absolute/haystack-release
~~~

The output identifies its complete archive, SHA-256 and source manifest. Continue an interrupted build through that same output:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-workspace-checkout \
  --out /absolute/haystack-release --resume
~~~

The selected source includes the original codec, native workspace, full browser/CLI, application receiver, source fixtures/licenses and maintained host integrations.

## Install and open

Use the existing Runtime installer with the returned complete archive and checksum:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /absolute/haystack-runtime \
  --archive /absolute/haystack-release/ORIGINAL_PACKAGE.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /absolute/haystack-runtime --offline

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /absolute/haystack-runtime --load --source
~~~

This default operator profile selects `native: false`, `features: []` and `pins: {}`. The complete Haystack application, its registered Merchant provider and managed Applications lifecycle use Node builtins and the maintained local helpers. The host requires Linux, Node 22.16 or newer, Python 3.11 or newer, npm and `flock`. The normal installer writes its package lock and READY state through the original offline installation path.

Select the generic Merchant MCP SDK server deliberately with `--feature mcp` when preparing a separate wider host runtime. Add `--native --feature schema --feature openapi` for those additional integrations. The source selection retains their declarations so the maintained profile can resolve the chosen dependencies.

Reuse the maintained installer's original dependency adoption and transfer operations when that complete runtime already exists.

The examples below use the installed `starforge` command. The same calls can run through the original `runtime-install-cli.mjs run --dir RUNTIME --` prefix.

~~~sh
starforge haystack init \
  --directory /absolute/private/building \
  --title "Building turnover"

starforge haystack serve \
  --directory /absolute/private/building --port 0
~~~

For managed operation, register the READY runtime in Runtime workspace, open **Applications**, and choose **Haystack building turnover**. Select that initialized or received project and an optional private token file. Review and save the launch, then use the existing Start, Open and Stop controls.

## Complete the turnover review

Use the operator guide to import the original grid and select its source set. The included Charlie fixture is the complete original upstream building example with its source and license metadata.

Inspect complete equipment/point records and their source-local refs. Prepare the intended typed corrections with a title and reason. Explicit review records the before/after values and accepted or rejected outcome. Save editions for the original and reviewed selections.

Compare editions using every original changed row and tag. Pair different original files explicitly when comparing re-exported sources. The source manifest and native ref context stay visible in the complete reports.

The browser preserves each pending operation's UUID, reviewed revision and exact input before it sends the request. When a response is interrupted, reconnect to the original workspace and recover that operation.

## Hand over an editable project

Create a complete workspace delivery through the browser or CLI. It carries the full saved state, every original source, all proposals/reviews and editions, original mutation outcomes, and every portable application file.

The operator guide's receiving command installs it into a new directory. Start its own `application/cli.mjs` against that directory, or select it in the same managed Applications view. The receiving team can continue native source import, review, comparison and delivery under the original workspace identity.

Deliver the selected managed installation archive and runtime transfer alongside the customer package when the recipient needs the full Merchant environment. Private project data stays in its selected project directory across runtime upgrades.

## Use native agents

The `haystack-workspaces` provider borrows the one original HTTP workspace. Its source-owned configuration binds the existing connection file, workspace UUID, private token file and original input-file aliases.

Read status and retain its revision while paging complete records. Prepare full typed edit proposals, save explicit reviews and editions, then produce native grids or complete reports. The [Merchant guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/haystack-workspace/MERCHANT.md) includes its exact configuration and request-recovery workflow.

## Native operating programme

`RECEIVING.mjs` exercises the real complete source through native HTTP, typed SDK, MCP, Merchant, durable review, restart and independent application receiving:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/haystack-workspace/RECEIVING.mjs \
  /absolute/haystack-turnover-operation
~~~

Retain that operation directory when continuing it. The programme saves original inputs, full useful reports, the editable workspace package and actual outcomes as it progresses.
