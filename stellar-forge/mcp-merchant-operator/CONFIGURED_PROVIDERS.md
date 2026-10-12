# Configured merchant providers

The merchant MCP host advertises tools supported by its own configuration.
Clients can read its tool list without importing every provider implementation.
Release, workspace, payment and customer-export operations retain their original
source modules, saved state and public interfaces.

## Open the operator

Use the merchant configuration produced by the setup command for the source or
workspace you operate. It declares the private release store, customer export
directory and optional connection files.

```js
import { openMerchantOperator }
  from '@tokenjunkielabs/starforge-merchant/merchant/mcp';

const operator = await openMerchantOperator('/private/merchant/merchant-mcp.json');
try {
  const names = operator.tools.map(tool => tool.name);
  const status = await operator.status();
  console.log({ names, capabilities: status.operator.capabilities });
} finally {
  await operator.close();
}
```

HTTP and stdio use this same operator. Their setup, authentication and existing
CLI arguments are described in [README.md](README.md). Select operations from
the server's actual `tools/list` response.

`openMerchantOperator` reads host configuration and imports the readers needed
by its declared connections. `new MerchantReleaseOperator(config, options)`
remains synchronous for hosts that already have a normalized configuration.
Construction prepares the tool list and validation tables without constructing
provider runtimes. Reopen the operator after changing its connections.

## Select the host's workspaces

A provider is advertised when its normalized configuration field is present and
non-null. Original readers still validate aliases, paths, private directories,
source declarations and credentials. Tool arguments select declared aliases.

Release and customer-export operations are always available. Cache and dataset
controls use the original selected release and retained state. Optional
families follow the host connections below.

| Normalized configuration | Operations |
| --- | --- |
| `catalog` | Discovery review and publication |
| `facilitators` | Retained facilitator review and release changes |
| `fleet` | Fleet planning, preparation and runtime management |
| `accounting`, `buyerExpenses` | Accounting, statements, platform exports and buyer expenses |
| `support`, `receiving` | Support observation/cases and receiving workspaces |
| `pythonWorkspaces`, `graphqlWorkspaces` | Python and GraphQL authoring |
| `odataWorkspaces`, `feedsWorkspaces`, `grpcWorkspaces` | OData, feed and gRPC merchant workspaces |
| `opencageWorkspaces` | OpenCage source and customer workspaces |
| `sourceWorkspaces`, `openapiWorkspaces`, `harWorkspaces` | Source-console, OpenAPI and captured-API authoring |
| `s3Workspaces`, `opensearchWorkspaces`, `redisWorkspaces` | S3, OpenSearch and Redis workspaces |
| `socrataWorkspaces`, `ckanWorkspaces`, `worldbankWorkspaces` | Socrata, CKAN and World Bank research |
| `fiscalDataWorkspaces`, `usaSpendingWorkspaces`, `edgarWorkspaces` | Fiscal Data, USAspending and SEC EDGAR research |
| `coingeckoWorkspaces`, `tenderlyWorkspaces` | CoinGecko research and Tenderly simulation merchants |
| `geocodioWorkspaces`, `arcgisWorkspaces` | Geocodio and ArcGIS workspaces |
| `webdavWorkspaces`, `sheetsWorkspaces` | WebDAV and Sheets authoring |
| `publishers`, `pricing` | Retained data publishers and pricing review |
| `woocommerce`, `mpp` | WooCommerce and native MPP customer operations |

These are normalized JavaScript fields, not replacement keys for the
configuration file. For example, a GraphQL host declares
`graphqlWorkspaceConnection`; its reader produces `graphqlWorkspaces`. Use each
provider's documented setup command and connection schema.

The complete `MERCHANT_TOOLS` export remains available from the original operator
entry point. It is the full compatibility catalog, independent of one host's
connections. The instance's `operator.tools` is a separate cloned list and is the
appropriate catalog for execution.

Hosts can inspect configured metadata through the installed catalog entry point
without opening a workspace:

```js
import { merchantToolCatalog, merchantToolFamilies }
  from '@tokenjunkielabs/starforge-merchant/merchant/mcp/catalog';

// config is the normalized configuration already read by the host.
const advertised = merchantToolCatalog(config);
const families = merchantToolFamilies(config);
```

The pure catalog functions return shared definitions; treat their results as
read-only. `operator.tools` returns a fresh structured clone. Calls absent from
the configured catalog return `TOOL_NOT_FOUND` before opening a provider.

## Loading and status

Each provider has one loading promise and one owned instance per operator.
Concurrent accepted reads share that instance. The selected provider imports
its original module and receives the same normalized configuration and injected
options as the original operator.

ArcGIS uses the operator's existing publisher owner. Its registry dependency
resolves that single instance, so the browser and MCP continue borrowing the
same publisher and refresh scheduler. A loaded dependency does not add otherwise
unconfigured tools to the advertised catalog.

`merchant_status` retains release selection, history, runtime observation,
process ownership, busy/closing state and last failure. Configured provider
summaries retain their existing keys, including `operator.opensearchWorkspaces`
and `operator.discovery`. Reading status can load those summary providers.
Their existing explicit open/start operations still control model, browser and
seller runtimes.

Additional fields describe capabilities and module loading:

- `operator.capabilities.tools` gives the advertised tool count.
- `operator.capabilities.families` lists advertised families and their counts.
- `operator.providers` records attempted loads with name, `LOADING`, `READY` or
  `ERROR` state, and `durationMs`. Error entries include the original code and
  message.

Durations measure module loading and owner construction in this process.
Provider query latency and seller readiness retain their original observation
interfaces. After an interrupted write, use the provider's original operation
or recovery interface and retained identifier.

A failed load removes its loading promise so a later explicit call can retry.
Its error remains visible in loading status until the next attempt. Loaded
providers continue to use their existing instances.

## Native release startup

The SF82 release module keeps its public entry points, source identity
constants, synchronous path/snapshot helpers and SDK version export. Reading
an empty store or release history imports the small release-state layer.
Selected staging, inspection and execution import the original implementation
when needed.

Source families include Python, DuckDB, datasets, S3, PostgreSQL, MySQL, JSON-RPC,
SQLite, ClickHouse, Redis, MSSQL, gRPC and OpenSearch. Preparation, validation,
source digests, activation generation checks, history and process leases remain
in their original implementations.

Dataset source views and lifecycle controls are preserved. Application
readiness includes the configured handlers/upstreams and every supported native
source type.

## Requests and shutdown

The configured operator retains its original request size:

| Host connections | Maximum complete request body/frame |
| --- | ---: |
| Feeds configured | 16 MiB + 64 KiB |
| GraphQL configured, without feeds | 8 MiB |
| MPP configured, without feeds or GraphQL | 3 MiB |
| OpenSearch or gRPC configured, without feeds, GraphQL or MPP | 2 MiB |
| Other configurations | 128 KiB |

HTTP and stdio forward this limit to the original transport. Provider-specific
limits, retained-file chunk sizes and argument validation still apply within
an accepted request.

Changes remain serialized through the operator. Every accepted call, including
reads and in-flight imports, is tracked for shutdown. `close()` rejects new
calls, cancels already loaded fleet staging, drains accepted work and closes
loaded owners and the process-owned seller. Repeated calls share the same close
operation. Unused providers are not imported to close the host.

Await `close()` before discarding the process or reopening native writer
directories. An incomplete original shutdown returns
`OPERATOR_SHUTDOWN_INCOMPLETE`; the owning provider's retained state and recovery
operation remain authoritative.

## Add a provider

Keep the integration's original configuration reader, runtime class, operation
methods and saved files. Place its original schema factory in a lightweight
module under `catalog/`, with shared pure contracts separated from runtime
imports. Re-export the factory from the original module for existing callers.

Register the factory and family in `catalog.mjs`, and its configuration field,
dynamic import, original constructor and dependencies in `providers.mjs`.
Preserve injected options and shared owners explicitly. Connect the original
reader through its configuration-file field and retain the provider's setup
and CLI commands.

Ordinary providers implement `call(name, args)`, a synchronous `summary` getter
and their original `close()`. The operator dispatches advertised metadata to the
matching family; an ordinary provider needs no additional prefix branch.
Release, cache, dataset, discovery and facilitator controls retain their
specialized paths.

Scope provider guidance to an advertised prefix in `instructions.mjs`. Keep its
original documentation and receiving workflow beside the implementation. The
distribution includes this merchant component and its lightweight contracts
in the installed package.

## Native receiving

The maintained program is `receiving/configured-startup.mjs`. It composes the
original merchant exercise with real configured OpenSearch, S3 and GraphQL
declarations, concurrent reads during close, authenticated HTTP, direct stdio
and distribution command forwarding. It retains each completed stage and uses
owned temporary stores.


```sh
node stellar-forge/mcp-merchant-operator/receiving/configured-startup.mjs \
  --directory /private/configured-startup-receiving \
  --source /private/original-opensearch-source.json \
  --source-commit "$(git rev-parse HEAD)"
```

Run from the checked-out source with Node 24 and its normal runtime dependencies.
Supply an original declared OpenSearch source file. An optional `--baseline`
argument selects an exact original source root for startup comparison. Use normal
real paths so distribution commands keep their original CLI entry detection.

Provider-specific journeys remain available for actual source capture, native
seller staging, paid delivery and customer reopening. This program exercises
the shared operator and transport boundary.
