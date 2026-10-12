# Site weather operations in Applications

The managed application opens the same NWS site workspace used by the native
browser and merchant tools. Its saved selection binds the installed source,
private workspace identity, optional buyer inbox and merchant runtime. The
original Applications controller owns preparation, launch, observation, Stop
and reopening.

## Select and save the application

Choose **Site weather operations** (`nws-site-weather`) in the original
Applications workspace, then select the actual installed SF46 release
containing this product.

| Field | Selection |
| --- | --- |
| Private site-weather workspace | Existing original workspace, or one new folder beneath an existing private parent |
| Original buyer inbox | Optional existing SF88 inbox containing this customer's original completed page intents |
| Private merchant runtime JSON | Optional existing configuration for the original SF82 port and facilitator |
| Identifying User-Agent | Optional operator identification sent to the original NWS API |
| Port and other common fields | The existing Applications settings for this launch |

Use **Review**, then **Save/adopt**, then **Review Start** and **Start**.
The review records the selected source files and host input identities.
When the workspace already exists, its UUID is added to the original command;
ordinary captures, notes and customer receipts remain valid across restarts.

The runtime configuration uses the original NWS/SF82 contract. An omitted file
selects the original challenge-only runtime. A configured file supplies the
host's native facilitator settings. The selected file bytes remain in the
reviewed input set.

## Open the operator and complete the work

The original process announces `NWS_READY`. Applications observes its
private startup record, validates the selected source and workspace, and
publishes the **Open UI** link. The browser uses the original bearer fragment
and session header.

Inside the workspace, maintain named sites, capture the current point mapping
and chosen weather products, inspect source coverage and observations, review
notes and comparisons, prepare a weather table, operate its original merchant
release and receive the ordered completed customer pages. The full operator
workflow is in [README.md](README.md).

The original private `application-url.json` is also the host-selected
connection for the merchant MCP adapter. [MCP.md](MCP.md) describes the 30 tools,
original source import, complete source/wire downloads and resumable customer
receiving. The browser and agent share the same retained state and operation
identities.

## Stop, receive and reopen

Use the original application's **Stop** control. The NWS server pauses active
capture tasks, retains completed provider responses, drains pending original
actions and closes its workspace-owned merchant publishers. The saved source,
editions, annotations and customer deliveries remain available to the next
launch.

Reopen the same saved application and workspace. Its current session URL may
change while the stable workspace UUID and private input selections remain
bound. If a reviewed input changed, use the existing Applications review flow
to select its actual current source and configuration before starting.

An original capture can be resumed from the operator after reopening; its
completed source responses and provider retry time stay with that capture.
A completed customer download can be reopened through `nws-mcp reopen`
using its saved original transfer index.

## Direct original launch

The installed browser entrypoint is:

```sh
starforge nws-workspace \
  --workspace /absolute/private/nws-workspace \
  --inbox /absolute/private/original-buyer-inbox \
  --port 0 --startup-format json
```

Optional `--release-runtime PRIVATE_JSON`, `--user-agent STRING` and
`--expected-workspace-id UUID` use the same native settings selected by
Applications. The separate `nws` command runs the original action CLI.
The entrypoint files retain their source paths:
`nws/workspace.mjs` for the browser and `nws/cli.mjs` for CLI actions.

## Source and startup contract

`distribution/runtime-workspace/application-nws.mjs` exports:

| Export | Responsibility |
| --- | --- |
| `nwsApplication(common)` | Source-owned application descriptor and explicit input fields |
| `prepareNwsApplication(settings,{inputPath,runtimeDirectory})` | Inspect the actual selected SF46 runtime, retain original source/input identities and produce native argv |
| `nwsStartup(request,text)` | Validate the original startup and return its private URL and source identity |
| `NWS_READY_SCHEMA` | `stellar-forge.nws-workspace-startup.v1` |

The original JSON announcement has `status:NWS_READY` and carries
`directory`, `workspaceId`, `inboxDirectory`,
`releaseRuntimeFile`, `sourceDirectory`, `userAgent`, `pid`
and `url`. The helper checks the original selected workspace with
`inspectWorkspaceIdentity(directory,{schema:'stellar-forge.nws-workspace.v1'})`.
It verifies optional reviewed workspace ID, inbox/runtime/User-Agent settings
and port against the original command. The source directory remains beneath
the selected original release's retained `source/` tree.

The maintained contribution `distribution/contributions/nws.json`
declares the original browser, action CLI, MCP receiver, source exports and
external browser assets. Its `applicationProviders.nws-site-weather` entry
selects this product's own `nws/application-provider.mjs`.

That module implements `stellar-forge.runtime-application-provider.v1` and
delegates catalog construction, preparation and startup verification to the
original helper above. It matches the exact `nws-workspace` command and uses
the shared `observeApplicationStartup` reader. The retained first valid
`NWS_READY` announcement becomes the original Applications URL record;
ordinary process output remains ordinary output.

The selected installed runtime must contain the maintained source-owned
Applications provider loader and this complete contribution. Its existing
registration inventory identifies the actual provider source and original
file hashes. The application stays in the same installed runtime and managed
controller lifecycle.
