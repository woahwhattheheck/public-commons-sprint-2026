# Receive and continue a Gravitee API cohort

## Complete package

The handover is one JSON package with a package SHA256 and an explicit list of original file paths, byte counts, hashes and complete file bytes. It contains the operating workspace, source contracts, native definitions, mapping revisions, original provider responses, event journals and the standalone application source.

The package includes the source for the Merchant integration. That integration attaches to an installed Merchant host; the standalone browser and CLI run directly from the received source. The source-parser dependency is pinned in the product package manifest.

## Inspect and receive

On a Linux machine with Node 22.16 or later and `flock`:

```sh
node products/gravitee-merchant/cli.mjs inspect \
  --input /absolute/gravitee-handover.json

node products/gravitee-merchant/cli.mjs receive \
  --input /absolute/gravitee-handover.json \
  --destination /absolute/received-orders

cd /absolute/received-orders
npm install --prefix source/products/gravitee-merchant --ignore-scripts --omit=dev
node source/products/gravitee-merchant/cli.mjs serve \
  --directory /absolute/received-orders/workspace
```

The receiver verifies the whole package and every file, then atomically reserves a new private destination directory. It retains the original package identity before writing operating files and uses immutable, synced writes under its original receiving lock. If receiving is interrupted, run the same command with the same package and destination: complete matching files are reused and missing files are received. A different package or changed existing file is reported with its exact identity. The final receiving record identifies the package, destination, original workspace and each complete file.

Configure the credential environment variables named in the received connection records. Open the returned private browser URL and verify the source bundle, draft revision, native request history and actual target identity. The workspace keeps its original ID and operation UUIDs.

For an interrupted native mutation, open its original request and read its saved provider response before using current-target reconciliation. An already accepted native request stays attached to its original commissioning child. The next stage uses the same parent sequence.

## Actual native receiving run

The source includes `native-receiving.mjs`, a complete receiving exercise for an actual Gravitee APIM installation. It creates isolated API names and context paths in the configured owned test environment. It runs source import, native mapping, API and plan creation/publication, start and deployment, actual gateway observations, a changed native edition, source export, and a second operating-directory receive.

Provide the real Management API and gateway connection in a private configuration file. Use an upstream endpoint reachable from that actual gateway. The native driver resolves the configured bearer or basic-authentication variables on the host.

```json
{
  "connection": {
    "label": "Native receiving environment",
    "managementUrl": "http://127.0.0.1:8083/management/v2",
    "organizationId": "DEFAULT",
    "environmentId": "DEFAULT",
    "auth": {
      "type": "basic",
      "usernameEnv": "GRAVITEE_NATIVE_USERNAME",
      "passwordEnv": "GRAVITEE_NATIVE_PASSWORD"
    },
    "gatewayUrls": ["http://127.0.0.1:8082"]
  },
  "upstream": "https://api.gravitee.io/echo",
  "expectedPublicStatus": 200,
  "outputDirectory": "/absolute/gravitee-native-receiving"
}
```

```sh
node products/gravitee-merchant/native-receiving.mjs \
  --input /absolute/native-connection.json
```

The output is a retained native report, complete handover and receiving result. Every Management API and gateway observation comes from the configured installation. A real provider error remains attached to the original operation and its complete response. Reuse the original output directory to resume that receiving operation.

The driver uses an OpenAPI public-proxy edition and a RAML API-key edition, a changed native configuration, the provider's actual deployment preflight, current deployments, and actual public/authentication gateway statuses. Its isolated APIs remain in that environment for inspection and subsequent service workloads.

Use the workspace's browser to review the resulting source, mappings, requests, history and handover on desktop and phone widths. Before sharing a customer-facing artifact, open the exact delivered edition and inspect its complete main-screen flow and all included guides.

## Runtime records

The standalone files use the maintained shared private storage and kernel lease implementation. The receiving source includes that exact module. The original workspace files remain private on the receiving host.

The source manifest describes every application file needed by the standalone browser and CLI. It also preserves the additive application/MCP integration modules so the receiving team can install the same capability in its maintained host.

A complete handover can be opened and edited with the native application: select a draft, change its actual source mapping or native body, save a new revision and continue the same working history.
