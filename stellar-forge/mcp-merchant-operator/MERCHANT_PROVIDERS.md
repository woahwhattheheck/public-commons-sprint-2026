# Source-owned merchant providers

A merchant provider contributes its own tool metadata, host configuration reader,
runtime factory, request limit, lifecycle settings, instructions and setup hook.
The existing distribution contributions select these modules. The existing
MerchantProviderOwners loader constructs a configured runtime only when it is
used, retains its original dependencies, and closes the same owner.

## Inspect the installed providers

Run the maintained commands from a source checkout or installed distribution:

```sh
starforge merchant-providers list
starforge merchant-providers inspect openapi-workspaces
starforge merchant-providers init openapi-workspaces --options /private/openapi-setup.json
```

The setup JSON contains the original initializer's options. For the existing
OpenAPI initializer, a complete example is:

```json
{
  "directory": "/private/openapi-merchant",
  "connection": "/private/openapi-connection.json",
  "name": "OpenAPI merchant"
}
```

The provider hook calls the existing initializer. Its source configuration,
workspace identities, native setup and recovery behavior stay with that
implementation. The legacy init-* commands and exported initializer functions
remain available. Direct merchant MCP commands also expose
providers list|inspect and init-provider ID --options FILE.

## Register a provider

Add merchantProviders to the component's existing contribution JSON, or add its
own contribution in distribution/contributions. The contribution schema and
ownership rules are the same as commands, exports, browser assets and
applicationProviders:

```json
{
  "schema": "stellar-forge.merchant-distribution-contribution.v1",
  "id": "merchant-provider-openapi-workspaces",
  "description": "Original OpenAPI workspace MCP provider",
  "merchantProviders": {
    "openapi-workspaces": "stellar-forge/mcp-merchant-operator/providers/openapi-workspaces.mjs"
  }
}
```

Keep the component and supportFiles declarations for the native implementation,
dynamic imports, maintained data and browser assets. The builder selects each
declared provider module explicitly and follows its real static ESM imports.
It reads declarations from one immutable Git snapshot and does not execute
provider code while building.

Provider IDs use lower-case words separated by hyphens. The family is the stable
merchantToolFamily value, so existing camelCase family and configuration keys
continue to work. One source owns each ID, family, configuration key and raw host
input. The composer reports conflicting contribution paths. The runtime rejects
duplicate tools, unknown ownership dependencies and dependency cycles.

## Provider module

The declaration imports metadata only. The complete maintained OpenAPI example
is providers/openapi-workspaces.mjs; all original families now use the same
interface:

```js
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { openapiWorkspaceTools } from '../catalog/openapi-workspace.mjs';

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA,
  id: 'openapi-workspaces',
  family: 'openapiWorkspaces',
  title: 'OpenAPI merchant workspaces',
  configKey: 'openapiWorkspaces',
  configuration: {
    input: 'openapiWorkspaceConnection',
    privateExports: true,
    read: async (value, { hostPath }) =>
      (await import('../openapi-workspace.mjs'))
        .readOpenApiWorkspaceConfiguration(hostPath(value))
  },
  tools: openapiWorkspaceTools,
  load: () => import('../openapi-workspace.mjs'),
  create: (module, config, options) =>
    new module.MerchantOpenApiWorkspaces(config, options.openapi),
  initialize: async options =>
    (await import('../config.mjs')).initializeOpenApiWorkspaceMerchant(options)
});
```

New sources provide their own initialize implementation in their own setup
module. They do not add a per-family branch to config.mjs, catalog.mjs,
operator.mjs, instructions.mjs or serve.mjs. The package exports the contract
and paired TypeScript declaration as ./merchant-provider, and the registry
reader as ./merchant-providers.

The factory receives the loaded native module, the original normalized merchant
configuration, caller-selected runtime options, and already-created dependency
owners. It returns the original runtime object. Ordinary provider tools use its
existing call(name, args), summary and close() interfaces.

## Configuration and ordering

configuration.input is the original top-level host input, such as
openapiWorkspaceConnection. The merchant reader validates the union of these
inputs and the five common merchant fields. It calls only configured readers;
an omitted input becomes null under configKey. A provider with configKey: null
uses the common merchant configuration and has no separate reader.

The read hook receives the original input value and context containing base,
config and hostPath(value). hostPath resolves the original reference against the
merchant configuration file. The reader performs the component's existing
validation; it does not accept executable paths through MCP tool arguments.

configuration.dependencies lists family names whose normalized configuration
must already exist. For example, ArcGIS reads its declared publishers before
binding its own workspace. Runtime dependencies use the separate top-level
dependencies array and preserve the original borrowing owners. Both graphs
are validated before work starts.

order preserves runtime inventory order. catalogOrder controls family tool
order. Existing declarations retain their original tool order, schemas,
configuration names and request limits. maxRequestBytes contributes the
component's original incoming request limit; the host uses the largest
configured value and its common 128 KiB floor. configuration.privateExports
keeps the existing private customer-export-directory requirement.

## Native concurrency and shutdown

These fields use the existing MerchantProviderOwners lifecycle:

| Field | Meaning |
| --- | --- |
| concurrency: host | Mutations use the original host change lock. This is the default. |
| concurrency: provider | The original provider owns its concurrency and recovery. |
| concurrentTools | Exact native cancel/stop controls that remain available during a host-serialized mutation. Every named tool must belong to this provider. |
| shutdown: drain | Finish accepted host calls, then close this original runtime. This is the default. |
| shutdown: provider | The original close can cancel and drain accepted native work; begin it after accepted calls enter the provider. |
| requestClose(runtime) | Signal the original owner's cancellation method without replacing that owner. |
| dependencies | Borrowing providers finish before the owners they borrow. An incomplete close retains the original handles for an explicit close retry. |

Declare the behavior implemented by the original runtime. A broad set of control
tools is not a substitute for its native cancellation and operation recovery.
The host keeps accepted call and shutdown metadata in its original status view.

## Instructions and source identity

instructions contains original guidance sections with order, text, and either a
prefix or exact tool selector. The host selects them from its advertised tools.
The migrated original always-present sections preserve their previous behavior.
New provider guidance should use its own tool prefix.

The runtime reads the same complete contribution inventory as the package
builder. It resolves modules inside the selected original source, checks
regular-file identity while reading and loading, and verifies installed
provider bytes against the distribution manifest. Inspection reports the
original provider path, SHA256, byte count and owning contributions.

Adding or changing a source declaration takes effect when the host starts from
that complete source. A running operator keeps its selected modules and native
owners for the lifetime of that process.
