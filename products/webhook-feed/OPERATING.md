# Webhook event operations

Operate one original webhook event store from Applications, its private browser, terminal commands, a local JavaScript client, or the existing Merchant MCP connection. A single managed process owns the original signed receiver, optional paid merchant, browser, and store. Customer transfers use the original complete SQLite snapshot and preserve the received workspace on a later replay.

For complete saved source/feed/merchant drafts, exact native-save recovery and portable editable receiving, use [Publisher working copies](WORKING_COPIES.md).

For the complete customer workorder, page/task spending decisions, useful destination delivery, later-window operation and independent receiving, use [Commission a webhook customer installation](COMMISSIONING.md).

The selected product is maintained at:

    stellar/scf-starforge-20261009/distribution/selections/webhook-event-operations.json

Its source-owned contribution registers the operating commands, Applications entry, Merchant tools, typed client, and original browser assets. The product retains the existing SF30 seller and SF88 event-feed buyer.

## Commission a workspace

Use the existing Node 24+ Starforge runtime. Choose a private parent directory on the host, then initialize its original event store:

    starforge webhook-feed init --state /private/event-service/publisher

Create a private connection file at /private/event-service/connection.json:

    {
      "schema": "stellar-forge.webhook-feed-operator-connection.v1",
      "workspaces": {
        "publisher": {
          "label": "Publisher event store",
          "directory": "./publisher"
        }
      },
      "receivers": {
        "customer": {
          "directory": "./customer"
        }
      }
    }

Keep the connection file readable only by its owner (mode 0600). Paths are relative to that file. Receiving directories must be different from source directories. The parent of a receiving directory must already be private. The receiving directory itself is created by the original restore.

Start the managed workspace:

    starforge webhook-operations-workspace \
      --state /private/event-service/publisher --port 0

This starts the original receiver and private operator on available loopback ports. Open the complete workspace URL reported by the command. The private session file in the original store records the active process, store, receiver, merchant, and browser. Clients use that retained session to connect to the same original browser listener.

Applications provides **Webhook event operations**. Select the initialized original event store and, optionally, the private listener configuration and environment JSON. Review and start through the existing Applications lifecycle. Open, Stop, Reopen and operation history remain owned by Applications. The startup observer checks the selected installed source, store, process, retained session and authenticated live listener before offering Open.

The application can be stopped and started again using the same event directory. Its store identity, source definitions, delivery history and issued cursor key remain in SQLite.

## Configure the existing Merchant host

The Merchant connection selects named original stores on the host. This lets remote clients operate configured workspaces without supplying arbitrary host paths.

Initialize a separate Merchant host from the connection:

    starforge webhook-operations setup \
      --directory /private/event-service/merchant-host \
      --connection /private/event-service/connection.json \
      --name "Event operations"

The returned configuration is the original merchant-mcp.json. Run that file with the existing Merchant MCP host and client setup workflow. Its source-owned webhook-feed provider contributes 15 operations.

| Action | Operating result |
| --- | --- |
| workspaces | Configured source aliases and receiving destinations |
| state | Original source, feed, event, merchant and listener state |
| source_save | A complete source definition under the reviewed revision |
| feed_save | A complete feed projection and filter under the reviewed revision |
| events | Accepted event identities, attempts and retained-body status |
| event | One original retained event and its source identity |
| preview | The original feed page and authenticated continuation cursors |
| plan_save | Native SF30 terms validated by the original compiler |
| release | Original seller-service, handlers, terms and release files |
| snapshot | A consistent original SQLite snapshot |
| manifest | All original customer files, exact sizes and hashes |
| file | An immutable bounded range of one retained file |
| file_release | Release a native retained read |
| receive | Restore into a configured customer workspace, or reopen it |
| retention | Apply the original reviewed event-body retention boundary |

Each tool name has the merchant_webhook_feed_ prefix. The source-owned provider handles shutdown by draining its own calls and file reads; Applications continues to own the original receiver and browser process.

## Save a source and reviewed projection

Source JSON names the provider's existing signing-secret environment variable. The receiver process obtains the secret from its environment, including an Applications private environment file.

    {
      "workspace": "publisher",
      "definition": {
        "id": "inventory",
        "label": "Inventory changes",
        "secretEnv": "INVENTORY_WEBHOOK_SECRET",
        "typePointer": "/type",
        "occurredAtPointer": "/timestamp",
        "enabled": true,
        "maxEventBytes": 65536,
        "toleranceSeconds": 300
      },
      "expectedRevision": null
    }

Save that private JSON as source-operation.json:

    starforge webhook-operations call \
      --connection /private/event-service/connection.json \
      --action source_save --json /private/event-service/source-operation.json

A new definition uses a null revision. For an edit, load state and pass the current source or feed revision. The original store rejects a stale edit with DEFINITION_CHANGED and returns its current revision. Retrying an identical already-saved definition returns the original current definition.

The receiving endpoint is the managed receiver URL followed by /webhooks/inventory. Publish that ingress through the existing HTTPS reverse proxy. Keep the private workspace listener local.

The original receiver uses [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md). It signs the exact event ID, timestamp and original body bytes. The provider event ID stays stable on retry. A successful acknowledgement follows the native SQLite commit. An identical retry updates the original attempt count; a reused ID with different bytes returns EVENT_ID_CONFLICT.

The existing Mercury bridge retains its own source verification and forwards through its original signed feed envelope. Configure source adapters according to the originating provider's signature protocol.

Save a feed with the fields customers should receive:

    {
      "workspace": "publisher",
      "definition": {
        "id": "stock",
        "label": "Stock changes",
        "description": "Committed stock quantities by SKU.",
        "sourceIds": ["inventory"],
        "types": ["inventory.changed"],
        "projection": [
          {"name": "sku", "pointer": "/data/sku"},
          {"name": "quantity", "pointer": "/data/quantity"}
        ],
        "enabled": true,
        "defaultPageSize": 50,
        "maxPageSize": 100,
        "maxPageBytes": 1048576
      },
      "expectedRevision": null
    }

Run the same call command with action feed_save. Original raw bodies stay in the private store. The customer page contains the reviewed projection. Unsafe integer literals retain their exact original numeric spelling through the original parser.

Use events to inspect attempts and event to read one accepted event. An events response contains an events array, including when there are no retained events. Use preview with workspace, feedId and optional limit or cursor to inspect the customer page.

## Merchant terms and Buyer

Save actual network, asset, amount and merchant receiving address through plan_save. Its plan is the original stellar-forge.webhook-feed-merchant.v1 document described in the original webhook-feed README. The provider asks the original SF30 compiler to validate those terms before storing them.

Prepare a named release through release. It contains the original seller-service.json, merchant-plan.json, handlers.mjs and release.json. Customer release files remain tied to the selected source store and feed revisions.

To run the merchant together with the receiver, create a private runtime JSON:

    {
      "receiverPort": 8492,
      "merchantPort": 8494,
      "facilitator": "https://YOUR_EXISTING_FACILITATOR",
      "allowLocalFacilitator": false
    }

Select that runtime file in Applications, or pass --runtime-file to webhook-operations-workspace. A merchant port requires a saved native plan. A null merchant port leaves merchant serving disabled while the operator prepares definitions and terms. Set receiverPort to null when an existing source-native process owns ingestion. The default receiver port is 0.

The original merchant pins the reviewed feed revision when it starts. After changing a feed or merchant terms, stop and start that application to bind the new reviewed release. The native admission path handles concurrent changes to the active revision.

The SF88 event-feed Buyer continues to own purchase intents, paid responses, exact response retention and subscriber checkpoints. Each page has an immutable upper event boundary. Continue with nextCursor within that window and resumeCursor after the window is complete. A page cursor is retained only after the customer durably accepts that page.

## Complete operating-workspace transfer

This is the privileged handover to an engineer authorized to operate the publisher's complete private state. Its SQLite snapshot includes retained raw source bodies and the private cursor key. A paid feed subscriber receives the reviewed public pages and the original SF88 NDJSON/manifest export; use that buyer's own subscription and operation journal for subscriber receiving. Keep publisher snapshots in the selected private operator transfer and backup destination.

Create a named snapshot using the browser Continuity view or the snapshot action:

    {
      "workspace": "publisher",
      "name": "customer-20261012"
    }

A snapshot contains the original events.sqlite and snapshot.json. The operator manifest adds download.json as a stable transfer descriptor. It identifies the original snapshot, store, high-water boundary and both exact file sizes and hashes. The complete SQLite backup retains source and feed definitions, merchant plan, accepted events, duplicate identities, delivery attempts and cursor key.

Read manifest with:

    {"workspace":"publisher","exportId":"customer-20261012"}

Retain manifestFile.sha256 from the response. Download all files:

    starforge webhook-operations download \
      --connection /private/event-service/connection.json \
      --workspace publisher --snapshot customer-20261012 \
      --directory /private/event-service/customer-download \
      --expected-manifest MANIFEST_SHA256

Use a private Merchant client JSON such as {"url":"https://YOUR_EXISTING_MERCHANT_HOST/mcp","tokenEnv":"MCP_ACCESS_TOKEN"}. Set that existing bearer token in the command's environment. Substitute --merchant-client FILE for --connection FILE to download through the remote Merchant transport. The same native retained downloader handles exact immutable range reads, whole-file hashes, local checkpoints, interrupted transfer and resumed receiving.

Re-running download against the same directory resumes its original checkpoint and checks the same manifest. Reopen a completed download offline:

    starforge webhook-operations reopen \
      --directory /private/event-service/customer-download \
      --snapshot customer-20261012 --expected-manifest MANIFEST_SHA256

Restore into a new original customer workspace:

    starforge webhook-operations restore \
      --directory /private/event-service/customer-download \
      --state /private/event-service/customer \
      --snapshot customer-20261012 --expected-manifest MANIFEST_SHA256

The original restore validates the full SQLite snapshot. A private receiving marker binds the customer directory to the original snapshot. Repeating restore for that same snapshot reopens the customer directory and preserves subsequent customer edits. A different snapshot cannot silently replace that directory.

For receiving on the Merchant host, use receive with workspace, exportId, receiver and expectedManifestSha256. The receiver is the named destination in the private connection file.

A stopped publisher's retained snapshots remain downloadable. Reopen the restored customer store with webhook-operations-workspace, or select it in Applications. Reuse the existing provider secret environment variables when receiving further source events.

## JavaScript client

The installed package exports a typed client at @tokenjunkielabs/starforge-merchant/merchant/mcp/webhook-feed. Both local and remote clients expose the same operations:

    import {
      openWebhookFeedClient,
      openWebhookFeedMerchantClient
    } from '@tokenjunkielabs/starforge-merchant/merchant/mcp/webhook-feed';

    const client = await openWebhookFeedClient({
      connection: '/private/event-service/connection.json'
    });
    try {
      const current = await client.state({workspace: 'publisher'});
      const page = await client.preview({
        workspace: 'publisher', feedId: 'stock', limit: 50
      });
      const manifest = await client.manifest({
        workspace: 'publisher', exportId: 'customer-20261012'
      });
      await client.downloadSnapshot({
        workspace: 'publisher',
        exportId: 'customer-20261012',
        directory: '/private/event-service/customer-download',
        expectedManifestSha256: manifest.manifestFile.sha256
      });
    } finally {
      await client.close();
    }

For the connected route, call openWebhookFeedMerchantClient({url: 'https://YOUR_EXISTING_MERCHANT_HOST/mcp', tokenEnv: 'MCP_ACCESS_TOKEN'}). It uses the existing bearer token environment variable and native Merchant initialization; an original loopback HTTP MCP endpoint is also supported. Transfer methods accept AbortSignal and a progress callback. restoreDownloaded receives the full original snapshot; reopenSnapshot checks the completed download without replacing customer state.

## Operational recovery

| Result | Continue the original operation |
| --- | --- |
| DEFINITION_CHANGED | Reload the current definition, compose the intended edit, and save with its current revision |
| FEED_CHANGED | Review the current feed and restart the merchant for that revision |
| NAME_ALREADY_EXISTS | Inspect the existing named release or snapshot before selecting another name |
| WEBHOOK_OPERATIONS_SESSION_CHANGED | Open the configured original application and read its current retained session |
| WEBHOOK_OPERATIONS_MANIFEST_CHANGED | Reconcile the selected original snapshot and its retained manifest identity |
| WEBHOOK_OPERATIONS_RECEIVE_CONFLICT | Reopen the directory's original snapshot or choose a new receiving directory |
| CURSOR_EXPIRED | Recover the corresponding retained snapshot or explicitly start from the current retained boundary |
| Transport failure with uncertain true | Inspect the original definition, named release or snapshot before retrying the same write |

The adapter never automatically retries a write after an uncertain network outcome. Named native results and reviewed revisions make the next inspection concrete.

Retention uses throughSequence and expectedHighWatermark from the reviewed original store. Original accepted identities and hashes remain after body retention, so old retries preserve their identity. Capture the required customer snapshot before removing bodies still needed by a subscriber.

## Source ownership

The original seller engine remains under sf30-seller-sdk/webhook-feed. These operations add a managed owner, source-owned Applications and Merchant registration, local and connected clients, complete customer transfer and an operating guide. The original workspace accepts an optional operation binding in its status result. Source ingestion, signature verification, database transactions, feed projection, merchant pricing, Buyer journals and native snapshot restore continue through their original modules.
