# Source-owned Applications providers

Applications discovers its original catalog, preparation logic and startup readers
through the same source contributions used by the maintained merchant distribution.
A product adds its own adapter module and an `applicationProviders` entry; it does
not add another branch to the shared lifecycle or stdout observer.

The runtime still owns Review, Save, Connect, Review Start, Start, Open, Stop and
recovery. Existing application IDs, source/runtime bindings, command arguments,
private environment files, original terminal approvals, resource leases and
retained operation records keep their original meanings. Provider adapters call
the existing native implementation; they do not create a second server or store.

## Inspect and locate a provider

`starforge registrations --source databento` shows the original contribution,
including its provider module. `starforge registrations` includes the effective
provider count and all declaring source files. The Applications state includes a
`providers` inventory with each adapter's path, bytes, SHA-256, declaring
contributions, catalog order and application kind IDs. The existing catalog and
saved applications remain in their original state fields.

A checkout reads its selected source files. An installed archive first verifies
the complete contribution inventory against its original manifest, then verifies
each provider module's original bytes before importing it. The builder requires
every declared adapter to be part of its original source selection; its existing
module collector checks the adapter's static imports. Declarations do not execute
provider code during packaging.

## Add or extend a product

Use the product's existing `distribution/contributions/<id>.json`. Keep its
commands, exports, browser assets and driver declarations unchanged. Add the
original provider module:

```json
{
  "schema": "stellar-forge.merchant-distribution-contribution.v1",
  "id": "example-source",
  "description": "Example source data products",
  "applicationProviders": {
    "example-source": "stellar/scf-starforge-20261009/example-source/application-provider.mjs"
  }
}
```

When the source already has a contribution, add that field to it rather than
creating another registration for the same provider. A component can provide more
than one application kind. The existing PostgreSQL and Sheets contributions each
select their separate original authoring and publisher adapters.

The source module default-exports this versioned contract. Replace the example
native imports, command and paths with the actual original product:

```js
import {
  APPLICATION_PROVIDER_SCHEMA,
  observeApplicationStartup,
} from '../distribution/runtime-workspace/application-provider.mjs';
import {
  exampleApplication, prepareExampleApplication, exampleStartup,
} from './managed-application.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA,
  id: 'example-source',
  order: 1000,
  catalog({ common, field }) {
    return [exampleApplication(common)];
  },
  async prepare(type, settings, context) {
    const original = await prepareExampleApplication(settings, context);
    return {
      args: original.args,
      inputs: original.inputs,
      createDirectories: original.createDirectories ?? [],
      ...(original.resourceKey ? { resourceKey: original.resourceKey } : {}),
    };
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'example-workspace';
  },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"example.original-startup.v1",')) return null;
      return () => exampleStartup(request, text, directory, context);
    });
  },
};
```

`catalog` receives copies of the original common port/environment fields and the
original `field(name, label, type, required, description)` helper. It returns an
array of ordinary existing catalog entries: stable `id`, original `command`,
`title`, `description`, `terminal`, `fields` and optional `requiredSource`
or original `python` metadata. Field types remain `path`, `text`, `json`,
`boolean` and `port`. The shared UI renders those same entries.

Provider `order` is optional, defaults to 1000 and must be an integer from 0 to
1,000,000. Providers sort by order then ID; multiple entries from one provider
retain their declared order. The migration preserves every original catalog
entry and its original position, including the five installed Python choices and
both event-feed applications.

## Original preparation and validation

`prepare(type, settings, context)` receives normalized original settings.
The context contains the original `root`, `runtimeId`, `runtimeDirectory`,
`inputPath`, `selectedExecutable` and `applicationEnvironment` functions.
It returns `args`, `inputs` and `createDirectories`, plus any original
retained identity fields. Preserve those fields and the original names used by
its native startup reader.

`applicationPreparation(settings, inputPath)` supplies the existing mutable
`args`, `inputs`, `createDirectories`, `path(...)` and `option(...)`
helpers for an adapter that previously prepared its command inline. A thin
adapter over an existing preparer can return its original result directly.

The shared finalizer continues to append the normal port option, prepare the
original terminal executable and read the private environment. It retains
environment hashes and the original terminal flag. Set `appendPort: false`
only when the original preparer already owns that argument, as MPP does.
The original installed Python adapter uses `completeCommand: true` to return
the unchanged full result from its existing Python runtime lifecycle, including
its reviewed Python installation and command binding.

Optional hooks preserve native selection rules:

| Hook | Original operation |
| --- | --- |
| `validateSettings(type, settings)` | Synchronous provider-specific selection checks after the shared field normalization. |
| `checkRuntime(type, settings, runtime, context)` | Required source checks on the selected actual runtime, before command preparation. |
| `resourceKey(type, settings, {hash})` | The original shared workspace or provider resource identity when the default kind/directory identity differs. |
| `verifyLaunch(request, operationDirectory)` | Original current-input checks immediately before the managed worker launches its process. |
| `prepareChild(request, operationDirectory, originalArgs, environment)` | An already existing alternative native launch path, such as the installed Python lifecycle. |

A returned `resourceKey` from preparation continues to take precedence over the
fallback identity. Review/Save and Start compare the same current inputs and
source/runtime bindings. The registry does not change those checks or create
another resource-lock directory.

## Original output readers

`matchRequest` must identify the original managed request without looking at
process output. Most products match their exact command. Shared commands also
match the existing original argv selector: XML and OData use distinct subcommands;
StellarExpert selects its original flag within the dataset command. Installed
Python applications match their existing `pythonCommand` binding. The selector
must return the boolean `true` for an accepted request.

`createObserver` receives the original request, operation directory and process
context. It may delegate a complete existing observer, as Python does, or return
the common `observeApplicationStartup` reader. That reader exposes the same
`write(bytes)` and asynchronous `close()` interface used by the original
managed worker.

The line callback runs synchronously for filtering and multiline assembly.
Return `null` for irrelevant text, an original URL or
`{url, original?, links?}` for an already parsed announcement, or a deferred
function for asynchronous native verification. A deferred function runs only
after preceding candidate announcements have been resolved; an ignored later
announcement never starts another native check. Arrays support original
multiline feeds that complete more than one JSON record in one chunk.

The common reader preserves UTF-8 decoding, original ANSI removal and the default
16,384-character unfinished-line window. Its optional fourth argument accepts
\`{lineLimit}\` when an original provider already uses another window: DuckDB keeps
65,536 and WQX keeps 32,768 decoded characters. The value must be an integer from
1 through 1,048,576. Provider-specific assemblers keep their own existing limits. The original feed and wallet assemblers are reused unchanged. Ordinary
log lines are filtered before asynchronous verification is queued.

The first accepted result must point to the original private HTTP loopback
listener. It is retained once in `application-url.json`, with the same
application ID, operation ID, command, observation time and optional original
identity/links. Provider authentication and live listener checks stay in the
original startup function. The registry does not infer a URL from arbitrary
provider payloads or terminal text.

## Source and registration errors

The existing contribution composer coalesces identical provider declarations
during a source migration and records all declaring files. Different paths for
one provider ID produce `DISTRIBUTION_REGISTRATION_CONFLICT` with both owners.
Invalid module paths or non-`.mjs` entries are rejected by the same declaration
validator before source execution.

At runtime:

| Code | Meaning and recovery |
| --- | --- |
| `APPLICATION_PROVIDERS_MISSING` | The selected source does not contain its complete provider declarations. Use the complete original distribution. |
| `APPLICATION_PROVIDER_SOURCE_DUPLICATE` | One module is assigned more than one provider identity. Keep one declaration and stable module ID. |
| `APPLICATION_PROVIDER_SOURCE_CHANGED` | Source changed during reading or differs from the installed manifest. Restore the original archive or select the intended completed release. |
| `APPLICATION_PROVIDER_KIND_DUPLICATE` | Two providers claim the same application kind. Keep that kind with its original owner. |
| `APPLICATION_PROVIDER_KIND_UNKNOWN` | An application kind has no declared provider in this source. Select the release containing its original contribution. |
| `APPLICATION_PROVIDER_COMMAND_UNKNOWN` | A managed application request matches no original provider. Correct the source registration or native selector. |
| `APPLICATION_PROVIDER_COMMAND_AMBIGUOUS` | More than one provider accepts the same managed request. Use the exact original subcommand or flag selector. |
| `APPLICATION_PROVIDER_LOAD_FAILED` | The declared original module or its dependency cannot load. The error includes the provider ID, path and original cause. |

Unknown module fields, missing hooks, duplicate catalog fields and invalid
preparation results are reported explicitly. Non-application managed commands
continue through their existing ordinary command path.

## Receiving and ongoing source changes

Publish the complete adapter, declaration and original source dependencies in one
normal product change. The existing cumulative builder selects that immutable
source; keep its original build and receiving operation. No second package,
dependency installation, UI registry or standalone application launcher is
required.

The running Applications host keeps its source inventory for that process.
Receive the following complete release and reopen its original host to discover
new contributions. Existing saved applications retain their original IDs,
runtime/source bindings and histories. Review any actual changed source through
the existing lifecycle before starting it; normal edits within a product's
native workspace remain governed by that original product's identity contract.

The maintained Databento adapter is a complete example:
[provider](providers/databento.mjs), [source-owned registration](../contributions/databento.json),
and [original operator guide](DATABENTO_APPLICATIONS.md). Its provider calls the
same native preparer and authenticated startup reader already operated on the
retained migration workbench. The original producer, customer export and warehouse
receiving do not run again when the source registration is migrated.
