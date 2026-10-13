# Haystack building turnover — installed product

The `haystack-turnover` selection delivers the complete native building-data application through the maintained source builder, installer, Applications lifecycle and Merchant host.

The operator imports original Haystack JSON v4, inspects source-local site/equipment/point records, reviews complete typed tag edits, saves editions, compares revisions, assigns corrective work and reviews the receiving team's completed work with its full evidence.

| Surface | Entry |
| --- | --- |
| Browser | **Haystack building turnover** in Applications |
| Operator CLI | `starforge haystack` |
| Native MCP | `starforge haystack-mcp --directory ORIGINAL_PROJECT` |
| Browser/Node SDK | `./seller/haystack` |
| Native grid API | `./seller/haystack/types` |
| Durable workspace | `./seller/haystack/workspace` |
| Corrective work API | `./seller/haystack/corrective-work` |
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

## Assign, complete and return corrective work

Open **Work items** from an original source record or complete diagnostic. Record the full task, responsible person, due date and priority. Attach complete files, operator observations or an original native tag proposal, then submit the work against its reviewed source material.

The reviewer can verify that exact submitted material, reopen it for another round or record an explicit accepted exception. The full event history and every evidence file stay with the original project.

When a recipient returns a complete editable workspace, preview every item in the original project's **Work items** view. Choose keep or accept for each item, and resolve fields changed by both operators. Later returns use the already accepted recipient history, preserving deliberate follow-up edits and reversals.

Read the complete [corrective-work guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/haystack-workspace/CORRECTIVE_WORK.md) for assignment, evidence, review, return comparison, reports, large-file access and native actions.

## Hand over an editable project

Create a complete workspace delivery through the browser or CLI. It carries the full saved state, every original source, all proposals/reviews and editions, every corrective-work event and evidence file, original mutation outcomes, and all 41 portable application files.

The operator guide's receiving command installs it into a new directory. Start its own `application/cli.mjs` against that directory, or select it in the same managed Applications view. The receiving team can continue native source import, tag review, assignments, evidence, corrective-work review and delivery under the original workspace identity.

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

The complementary corrective-work programme operates the full Charlie source through assignment, complete evidence, independent native proposal reviews, concurrent operators, repeated recipient returns, browser work and complete independent receiving:

~~~sh
mkdir -p /absolute/haystack-corrective-operation
flock -n /absolute/haystack-corrective-operation/programme.lock \
  node stellar/scf-starforge-20261009/sf30-seller-sdk/haystack-workspace/CORRECTIVE_RECEIVING.mjs \
  /absolute/haystack-corrective-operation
~~~

Use the same original operation directory when continuing. It retains full original requests, operator browser drafts, complete useful reports and the editable receiving package.


## Point-list modelling and contractor returns

The same installation now includes the complete semantic workflow. Open **Point-list modelling** from the managed application's related links, or use `/semantic.html` on the already running original server. Native building grids and corrective work remain available from the same workspace.

Import original CSV/TSV point lists or select retained native grids. Inspect every source row and choose column positions explicitly; repeated headings remain separate. Preview naming and class proposals, then retain a full model with stable entity identities, original row references, relationships, dictionary terms and review notes.

A saved model is an immutable version over a retained source context. The browser keeps open entity/relationship/dictionary drafts and complete pending requests in its original IndexedDB stores. After a lost response, use **Requests → Read original receipt** or **Continue same request**. If a peer edits the model, **Compare draft with current saved head** preserves both contents. An unchanged model head can explicitly adopt the current workspace revision; a changed head requires deliberate review and a new save against that selected head.

The [complete modelling guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/haystack-workspace/SEMANTIC_MODELLING.md) covers source mappings, full source references, model/dictionary editing, native reports and the returned-model choices.

### Install the selected offline Brick engine

The Node application retains its normal operator profile. Native Brick validation additionally uses the exact CPython 3.12 Linux x86_64 wheel archive and original ontology declared by `semantic-dependencies.json` and `semantic-standard.json`. Follow the complete [offline runtime guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/haystack-workspace/SEMANTIC_NATIVE.md):

~~~sh
python3.12 stellar/scf-starforge-20261009/sf30-seller-sdk/haystack-workspace/install_semantic_runtime.py \
  --manifest /absolute/selected-source/semantic-dependencies.json \
  --archive /absolute/exact-semantic-offline-archive.zip \
  --directory /absolute/private/semantic-runtime
~~~

The installer verifies the whole archive, closed member inventory, exact wheel set and requirements, then installs offline at the final virtual-environment path. Keep that destination and its original installation record when reopening an interrupted installation.

Use the common Applications **environmentFile** field to select an owned private file containing:

~~~json
{
  "HAYSTACK_SEMANTIC_PYTHON": "/absolute/private/semantic-runtime/bin/python"
}
~~~

The original controller binds the file's exact hash to the reviewed launch. For a direct operator CLI, set that same variable in the process environment. No additional CLI or provider-specific launcher is introduced.

Open a saved model, validate its exact head and read the actual native Boolean and every returned output file. The application retains original model JSON/Turtle, complete SHACL report text/Turtle, the original Brick wrapper report and expanded validation graph when supplied by the selected runtime. Source mappings, human review and field-observation status stay explicit; an ontology result does not establish live building telemetry.

### Deliver and receive the complete work

Prepare full model reports in JSON, CSV or HTML and dictionary reports in JSON or CSV. A complete workspace package also retains all original point files, model versions, contexts, relationships, dictionaries, reviews, native outputs, return decisions and portable application sources.

Receive that package with the existing receiver and open its original workspace in the installed application. A contractor can edit a received model and export the whole workspace again. The original operator chooses **keep** or **adopt** for each returned model after reviewing the complete comparison. Keeping a local head still retains the incoming source and model history. New returned models become active only through an explicit adopt decision.

The managed Merchant tools share these same actions. Host-pinned `point-list` and `workspace-return` aliases carry complete files above the request-body limit; SHA-bound JSON ranges preserve large catalogues/models/return comparisons. Read the full [Merchant guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/haystack-workspace/MERCHANT.md) for exact tools, file pins and original-request recovery.

### Complete operating continuation

`SEMANTIC_RECEIVING.mjs` and its `SEMANTIC_BROWSER.mjs` companion operate one retained point-modelling project. The native programme supplies the exact saved inputs and running server; the browser completes the source/mapping/model/review/return journey, desktop and 390 px views, all selected native downloads, and original request reconciliation. It returns only after its browser and borrowed merchant clients close.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/haystack-workspace/SEMANTIC_RECEIVING.mjs \
  /absolute/original-semantic-input.json
~~~

Retain the original operation directory, request files, browser profile and selected inputs. The programme's full result records actual completed steps and complete output identities. Managed Applications Start/Stop receiving remains a separate actual READY-runtime input; source inclusion alone is not a successful installed launch.
