# Mercury and event-feed buyer in Applications

Applications opens the complete original Mercury event service and its retained Starforge feed, then opens the original SF88 buyer as a separate saved application. Each application keeps its reviewed runtime, source, private data directory, original managed operation and launch URL.

The Mercury application owns the original source worker, signed destination, feed desk and any saved merchant plan. Its source console provides catch-up, reconciliation, delivery inspection and exports. The feed desk provides accepted events, projection definitions, merchant terms, publication and retention. The buyer keeps its original subscription, page receipts, cursor, approval and immutable exports.

## Select the installed source and runtimes

Use the maintained merchant package and its existing runtime workspace. The selected READY runtime must include both original commands and their source:

| Application | Installed command | Required original source |
| --- | --- | --- |
| Mercury event operations | mercury-feed | stellar/mercury-event-operations/starforge-feed/cli.mjs |
| Event-feed buyer | buyer-event-feed | stellar/scf-starforge-20261009/sf88-operator-buyer-cli/event-feed/workspace.mjs |

Open the installed workspace through its existing alias:

    starforge runtime-workspace serve --workspace /srv/starforge/operator --port 8465

For a new operator workspace, first use the original init and attach commands:

    starforge runtime-workspace init --workspace /srv/starforge/operator
    starforge runtime-workspace attach --workspace /srv/starforge/operator \
      --runtime /srv/starforge/ready-runtime --label "Event operations"

Select that READY runtime in the sidebar. The original Runtime pane retains the merchant archive, source manifest and dependency profile. Choose a source edition containing the table above and this Applications integration. The Mercury source joined in PR1352, after the event merchant and buyer in PR1330; the complete Applications lifecycle joined in PR1345. A previous installed source remains its own edition. Receive the newer complete archive through the maintained installer or original Offline transfers workflow before choosing its commands.

Use Node 24 or later on the operator host. This is checked before reviewing or launching either event application. The source/feed desks and retained buyer inspection use Node native SQLite. A merchant using a facilitator, or a buyer performing an approved new acquisition, also needs the original native x402 SDK/runtime profile. Select that profile through the existing Runtime pane and retain its successful READY installation. Runtime/dependency changes are explicit selections; a running application stays bound to its original release.

Mercury also requires Python 3.11 or later. Choose exactly one of these sources in its application form:

- **Reviewed Python runtime installation:** copy the full installation ID from the selected runtime's original **Python & workbooks** pane. Use its existing review, retained wheel candidate, offline installation and interpreter inspection. The event adapter calls that pane's original inspectPythonInstallation function and retains the installation, source, wheel lock and runtime binding.
- **Original Mercury Python executable:** choose an existing absolute interpreter path. The adapter reads its actual Python version and pins the executable, any symlink target and pyvenv.cfg. A virtual environment's lexical bin/python path is preserved.

Mercury's engine uses its original standard-library package. Selecting an already installed compatible Python environment is sufficient; this application adds no Python dependency resolver. The installed-environment choice requires the original Python runtime component. The explicit-interpreter choice works with a compatible existing Mercury host.

The event buyer's **Terminal Python executable** selects the original Applications PTY helper only. It defaults to /usr/bin/python3. The buyer itself remains the original Node command, and Mercury's Python selection is separate.

## Prepare or reopen the original Mercury bundle

Start from a reviewed original Mercury configuration containing the actual network, provider scope, API base, contracts, topic filters, retry settings and credential variable names. The source configuration controls the original provider requests.

For a new bundle, use the installed command:

    starforge mercury-feed prepare \
      --source-config /srv/mercury/current-config.json \
      --out /srv/mercury-paid-events \
      --python /usr/bin/python3 \
      --mercury-port 8788 --bridge-port 8494 \
      --workspace-port 8493 --merchant-port 8492

This creates the original Mercury state, signed destination credentials, Starforge feed store and fixed bridge descriptor. Preparation without a payment file opens ingestion and the private feed desk. To prepare the merchant at the same time, additionally supply both the original SF30 payment file and the actual public HTTPS origin:

    --payment /srv/merchant/stellar-payment.json \
    --public-origin https://events.example.com

Replace the illustrated origin with the actual merchant origin. The original seller compiler validates the chosen scheme, network, asset, payTo, positive atomic amount and timeout. The source and feed configuration remain original engine inputs.

An existing complete bundle is opened directly; do not run prepare again over it. Its expected paths are:

| Retained path | Purpose |
| --- | --- |
| bridge.json | Store/source/feed identities, selected scope, relative paths and four distinct ports |
| mercury-config.json, or the restored configured path | Exact original Mercury configuration and destination |
| mercury/ | Original event, provider work, task and delivery state |
| feed/events.sqlite | Signed source bodies, feed definitions, merchant plan and durable cursor identity |
| bridge-secrets.env | Original private sender/destination credentials |
| bundle.json | Original preparation and source identity |

The source binds its destination to the selected bridge address. Preserve the four saved ports when reopening that bundle. Applications uses the descriptor's ports instead of adding a competing port field.

### Private provider and operator environment

Mercury's configuration names its existing provider token, incoming webhook secret and operator token variables. For Applications, select its existing **Private environment JSON** field and provide a regular operator-owned 0600 JSON file whose values are strings:

    {
      "MERCURY_PROVIDER_TOKEN": "value held by the operator",
      "MERCURY_WEBHOOK_SECRET": "value held by the operator",
      "MERCURY_OPERATOR_TOKEN": "value held by the operator"
    }

Use the actual variable names from the selected Mercury configuration; the names above illustrate the format. The saved application retains the path and digest. The original worker reopens that file immediately before launch and passes the values to the original command. The generated bridge credential file remains inside the private bundle and is loaded by mercury-feed.

The CLI's separate --provider-env-file format is literal NAME=value. Applications' shared environment field is JSON. Use the corresponding format for the selected entrypoint.

## Save and operate Mercury in Applications

1. Select **Applications → New application → Mercury event operations**.
2. Choose the complete prepared bundle, exactly one Python source, and the private environment JSON. A selected facilitator URL is optional; use the actual HTTPS facilitator for a saved native merchant. The explicit local-facilitator switch requires its corresponding local URL.
3. **Review application** reads the original descriptor, source configuration, private credential file, feed store and Python selection. The exact command is mercury-feed run --bundle DIRECTORY --python EXECUTABLE, with only the reviewed facilitator options.
4. **Save application** binds the original READY runtime and managed release. If that release needs adoption, Applications starts its existing managed adoption and retains the original operation.
5. **Review start**, then **Start reviewed application**. The original managed worker verifies the saved inputs again before invoking its child. If the selected files or Python source changed, review their current state and start that reviewed selection.
6. **Open event feed** opens the actual feed desk. **Open Mercury source** opens the original Mercury operator console. A saved merchant also exposes **Open feed merchant**.

The source console uses its original operator token prompt. Enter the configured token there to inspect source work. The feed desk keeps its own private launch capability. Applications captures all links from the original successful session announcement, matching store/feed identity and saved listener ports. It does not infer a ready service from a port.

The original source console can inspect notifications, events, catch-up jobs, tasks and delivery attempts; reconcile a selected transaction; review a catch-up range; retry or cancel original work; and export source operations. The signed destination accepts the original Mercury event identity and raw-body signature. Retrying a delivered event preserves the original feed identity.

In the feed desk, inspect the three useful views together: the signed source arrival, the selected projected event, and the published feed page. Save source or feed edits using their existing expected revisions. Configure actual merchant terms, prepare the original release, and restart the saved Mercury application to pin that merchant session. Source/filter edits change the effective feed revision; a buyer intentionally selects the resulting feed edition.

The direct operating commands remain available:

    starforge mercury-feed status --bundle /srv/mercury-paid-events \
      --python /usr/bin/python3 --provider-env-file /srv/mercury/provider.env

    starforge mercury-feed mercury --bundle /srv/mercury-paid-events \
      --python /usr/bin/python3 --provider-env-file /srv/mercury/provider.env \
      -- list deliveries --limit 50

Use the original stable job/operation ID when resuming catch-up or reconciliation. Reopening Applications does not create those provider jobs.

## Initialize and save the original event buyer

Use the original SF88 buyer JSON for the actual published HTTPS feed endpoint, recipient, asset, page-price limit, operator policy and signer. The base URL must omit cursor and limit parameters: the original subscriber adds its own fixed-window cursor. The response is JSON and its maximum size can be set through the original responseFile options.

Initialize one new private subscription using the selected installed command:

    starforge buyer-event-feed init \
      --dir /srv/buyer/mercury-events \
      --config /srv/buyer/mercury-buyer.json \
      --feed mercury-events --id mercury-operations --page-size 50

The command retains its original SF88 source runtime and buyer journal paths. Its optional --runtime selects an explicit original sf88-operator-buyer-cli directory; --buyer-state selects a private original buyer journal. Defaults use this installed source and the subscription's original-buyer directory. Keep those paths available when reopening that subscription.

In **Applications → New application → Event-feed buyer**, choose the initialized subscription directory, its local workspace port (0 selects an available port), and any private environment JSON needed by the original signer. Review, save and start through the same original managed lifecycle.

**Open application** opens the actual original subscription desk. Inspect retained pages, event identities, cursor/window state and exports before collecting more. A new **Collect** action uses the original buyer's review, policy, reservation, signer and payment journal. Read and answer any original approval prompt through Applications' connected terminal. Reopening a desk sends no terminal input and creates no new acquisition.

Each accepted page retains the exact response bytes and hash with the original buyer operation. Its events and next cursor commit in the same subscription transaction. A resumed page reuses the original intent. The first unpinned collection starts at the seller's retained origin; subsequent pages and an explicitly supplied cursor keep their exact source bounds. A restored source that cannot serve a retained window reports that condition through the original feed instead of silently completing a different window.

The original CLI operations use the same state:

    starforge buyer-event-feed inspect --dir /srv/buyer/mercury-events
    starforge buyer-event-feed recover --dir /srv/buyer/mercury-events
    starforge buyer-event-feed export --dir /srv/buyer/mercury-events \
      --out /srv/deliveries/mercury-events-20261012.ndjson

Export writes an immutable NDJSON file and its matching manifest. Reusing the same completed destination returns that edition; choose a new destination for a later received edition. The original buyer's Recover action reopens its recorded operation and retained response.

## Stop, reopen and recover the complete operation

Closing the runtime workspace browser or HTTP server leaves the original managed application worker available. Reopen the same private runtime workspace and choose the saved application. Its original run ID, output and actual private URL are retained.

**Stop application** targets the original managed run. Mercury's original launcher stops the source worker before the destination, merchant and feed desk. The buyer closes its original subscriber and any active collection through its native shutdown. The existing PTY owns buyer signal forwarding, process identity and escalation. A stopped run no longer offers a private application link.

For a saved start whose worker request was not yet submitted, **Continue original start** uses the same retained request ID. After an interrupted worker, **Reconcile original operation** reads the original launch/result and kernel lease. It does not create a duplicate launch for an already recorded child. For a confirmed stopped run, review a new start of the same saved data directory.

To move or restore Mercury and its feed, stop the application and use the original joined snapshot:

    starforge mercury-feed snapshot \
      --bundle /srv/mercury-paid-events \
      --out /srv/backups/mercury-events-edition-01 \
      --python /usr/bin/python3

    starforge mercury-feed restore \
      --snapshot /srv/backups/mercury-events-edition-01 \
      --out /srv/mercury-paid-events-restored \
      --python /usr/bin/python3

The original snapshot records the source first, then the destination. Restore uses their original native recovery, preserves store/event identity and rejects incompatible source/destination state. Review the restored bundle as a new saved application path, choose the correct receiving Python/environment, then start that source. Keep the old application stopped while the restored copy uses the same destination ports.

The buyer's subscription remains bound to its original absolute directory and source runtime. Reopen the retained directory and use original Recover for a pending operation. Export completed customer data through the original immutable export. A new host or a deliberately different subscription uses original initialization with the intended feed/cursor and the separately retained buyer journal; do not rewrite the saved definition or silently rebase its cursor.

## Receiving and operator handover

A complete handover includes the selected merchant archive/source manifest, READY runtime and profile IDs, compatible Node/Python paths or installed Python identity, the private runtime workspace, both saved application IDs/revisions, and the original operation IDs. Keep the bundle, source state, buyer journal, credential environment and capability URLs in the operator's private transfer.

Record the source store/feed identity, retained high-water sequence, source delivery state, buyer origin/cursor/window, accepted page hashes and exported edition hashes. Confirm that the source and feed reopen from their original state and that the buyer's saved definition points to the intended installed SF88 runtime.

The maintained release producer supplies one complete installed edition. The original Mercury three-event receiving operation supplies retained source identities and delivery state. The Applications receiving journey reopens that exact operation, exercises its saved applications and operating pages, and records the actual installed command/source pin. Further paid collection is initiated by the operator through the original buyer.
