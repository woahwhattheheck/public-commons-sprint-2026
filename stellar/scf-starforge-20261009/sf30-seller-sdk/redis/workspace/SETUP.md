# Redis connection setup

The connection setup browser creates the original Redis merchant workspace from a deployment profile, named read products, merchant terms and optional CA bundles. The same source compiler, native Redis client, workspace database, customer package generator and release store serve the resulting workspace.

## Start

Use Node 22.16 or later with the seller's installed dependencies. Choose a new workspace directory under an existing parent:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/redis/cli.mjs workspace setup \
  --directory /srv/merchants/new-redis-workspace --port 8437
~~~

Open the printed operator URL. Its local fragment authorizes this setup process. The listener binds to 127.0.0.1. The output uses schema stellar-forge.redis-setup-startup.v1, status REDIS_SETUP_READY, and includes the exact setup ID and selected destination.

The browser walks through four sections:

1. **Connection.** Select standalone Redis/Valkey, Redis Cluster, Redis Sentinel or Upstash REST. Enter hosts, ports, deployment-specific settings and the host's credential environment names.
2. **Products.** Import or edit the initial named query declarations. Use the source's actual key names and projected fields.
3. **Merchant terms.** Import or edit the original merchant plan: public origin, payment options, routes, examples and parameter descriptions.
4. **Review and create.** The original compiler reviews every query and customer route. Inspect required environment names, run a live declared read, and create the workspace.

Creation opens the original authoring interface. Its product editor, saved versions, full live previews, customer packages, release controls and generated clients operate on the newly retained workspace.

Close the process with SIGINT/SIGTERM. Reopen the saved workspace using:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/redis/cli.mjs workspace open \
  --directory /srv/merchants/new-redis-workspace
~~~

The original workspace create --source --plan terminal command remains available for existing source and plan files.

## Deployment settings

| Deployment | Connection settings |
| --- | --- |
| Standalone | Host, port, database index, optional data ACL username and password environment name. |
| Cluster | One to sixteen unique seed endpoints, database zero, common data credentials and TLS, optional advertised address mapping. |
| Sentinel | Master name, one to sixteen unique monitor endpoints, data database/ACL/TLS, separate monitor ACL/password environment name/TLS, optional address mapping. |
| Upstash REST | The database's HTTPS REST endpoint and token environment variable name. |

Data and monitor TLS default to full certificate verification. An empty CA selection uses the host trust store. Upload the appropriate PEM CA bundle when a deployment uses a private authority; each bundle may contain multiple certificates up to 1 MiB. Setup parses every certificate and retains the exact selected bytes. A referenced source-file CA requires its bundle to be selected; importing a filename alone does not change the connection to system trust.

Plaintext is the existing local receiving mode and accepts loopback destinations only. Cluster discovery and Sentinel promotion use the original native topology implementation. For mapped networks, the advanced address map accepts the original declaration shape:

~~~json
{
  "redis-internal.example:6379": {"host":"redis-proxy.example","port":16379}
}
~~~

Set credentials in the host process before starting setup. The browser takes reference names such as REDIS_PASSWORD, REDIS_SENTINEL_PASSWORD and UPSTASH_REDIS_REST_TOKEN. Review reports whether each reference is available without returning its value. Missing variables leave offline authoring available; a live preview asks for the missing host references. Reopen the workspace with the correct environment for later live reads and seller operation.

## Review and live preview

Review returns a digest over the exact workspace label, source, merchant plan and certificate fingerprints. Preview and create carry that digest and the same complete draft. Changing the draft requires another review.

A preview runs a declared product with its input object through openRedisSourceFile. The connection uses the selected source limits, real native topology discovery, credentials and certificates. The response retains the complete original result, observed time, exact input and continuation. **Read next page** sends the source's actual nextInput; **Download complete response** preserves all rows and binary/exact-number representations.

The initial example plan contains demonstration payment fields. Supply the intended public origin, asset, recipient and amount before using it for paid requests.

## Save, import and recover

**Download setup** exports one complete JSON object with label, source, plan and certificates. Certificate keys are caFile and sentinelCaFile, each containing its PEM text when selected. Source CA references are normalized to database-ca.pem and sentinel-ca.pem.

**Import setup** reopens that complete object. **Import source JSON** and **Import merchant plan** accept the original separate files. Source and plan each have a 256 KiB limit. Credential values belong in the environment and are outside the setup file.

The current form, including partially edited JSON, is retained in browser session storage under the current setup ID. Download the setup when moving it to another host or process.

Creation uses one retained request ID in the browser. A repeated request with the same digest returns the original workspace. A conflicting request cannot replace it. If a response is lost, refresh the setup window and use **Open workspace** for its completed result. After a process interruption, open the created directory with the original workspace command.

The workspace database retains the immutable connection profile and CA blobs alongside its first product revision. Product edits create normal saved revisions under that same binding. Connection changes use a new setup directory.

## Host API

~~~js
import { startRedisConnectionSetupServer } from './workspace/setup-server.mjs';

const session = await startRedisConnectionSetupServer({
  directory: '/srv/merchants/new-redis-workspace',
  port: 8437,
  environment: process.env,
  // Optional initial: {label, source, plan, certificates}
});
console.log(session.operatorUrl);
// await session.close();
~~~

For a non-browser host, createRedisConnectionSetup in setup-model.mjs exposes state, review, preview, create and close. Creation calls createRedisAuthoringWorkspace; its result carries the original workspace ID/profile digest, required environment names, head and destination. The host may adopt setup.workspace into the original authoring server after creation.

The workspace setup --input COMPLETE_SETUP_JSON command starts with a saved setup file, including both CA bundles. Local HTTP routes require the original token header; mutation routes also require the original origin. Customer source data returned by preview is displayed as text and downloaded as the complete source response.

## Complete receiving run

The setup-journey.mjs driver performs the complete source-to-workspace operation using an existing native Redis server fixture and installed Playwright/Chromium. It exercises source import, reviewed live read, original workspace creation, product save, customer preparation and cold reopen. It also reviews Cluster, Sentinel with separate CAs, and Upstash profiles through the same model and confirms retained original CA/binding behavior. Use the operated native journey's supplied source, plan and runtime paths. The journey owns and closes its setup/workspace/browser processes; the surrounding original Redis journey owns the database.
