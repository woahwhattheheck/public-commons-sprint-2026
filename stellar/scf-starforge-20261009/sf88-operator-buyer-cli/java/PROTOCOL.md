# Original bridge and distribution contract

The Java SDK invokes the existing `sf88-operator-buyer-cli/go/bridge.mjs` and
uses its original `stellar-forge.go-buyer-call.v1` schema unchanged. The bridge's
original name and native error codes remain stable across callers.

Each Java call creates a private `.java-calls/java-*` directory in the original
Node application state. `request.json` contains the original schema, generated
call ID, action, optional intent/acquisition ID, selected runtime/state/profile,
native limits and action arguments. Binary bodies use `bodyBase64`. Process
arguments contain only the Node executable, bridge and private request path.

The original bridge writes `response.json` with that call identity. Java checks
schema, call ID, action, optional ID and the boolean result state. Complete
original errors and result fields remain available. File bytes and records use
stdout while structured metadata stays in the private response file. Java
compares bridge byte/record counts with the actually consumed stream.

## Supported native actions

| Group | Original actions |
| --- | --- |
| Buyer | `ready`, `list`, `create`, `request`, `discover`, `prepare`, `import`, `create-inbox`, `inspect-handoff` |
| Operation | `review`, `inspect`, `execute`, `recover` |
| Inbox | `list`, `show`, `enqueue`, `enqueue-config`, `review`, `execute`, `cancel`, `recover`, `finalize`, `report`, `response` |
| Object | `create`, `attach`, `list`, `initialize`, `inspect`, `recover`, `run`, `download`, `assemble`, `delivery`, `report`, `accounting`, `finalize`, `recover-accounting` |
| Dataset | `create`, `attach`, `list`, `initialize`, `inspect`, `recover`, `run`, `deliver`, `manifest`, `accounting`, `finalize`, `recover-accounting` |
| File | `verify`, `copy`, `bytes`, `stream`, `records` |

Wire actions retain the group prefix, such as `operation.execute`. Java invokes
the action once. Failures retain the same original request and state identities.

## Receive a maintained source edition

The existing distribution component includes
`stellar/scf-starforge-20261009/sf88-operator-buyer-cli`. The builder's runtime
extension list includes `.java` so it retains `Build.java`, all SDK classes and
the examples with their guides and license. The original bridge and Node buyer
remain in that same component.

Select the installed edition's SF88 root, enter its `java` directory, and run
`java Build.java ABS_NEW_BUILD_DIRECTORY`. Keep customer state and operator
profiles outside the installation. The JAR takes the selected runtime path;
its source embeds no host-specific installation or private directory.

Compilation and execution use Java 17+. Native Node/Python dependencies and
terminal requirements come from the installed merchant edition. The Node
merchant's execution path acquires no JVM dependency.

## Source compatibility

Authored against public sprint source
`3863fa574de7a2c73f02ef78953ac5620403eed1`, whose maintained bridge blob is
`f581440e7e5c6594b8d0c4aaa605d6ad5c62a725`. The client consumes the public
`Buyer`/`BuyerResult` API through that original source. Other selected source
editions must include the actions the customer intends to use.

Native option maps at acquisition and accounting seams retain additive fields.
Typed results keep the complete original map. Runtime and state are explicit
on each call so an existing application's Java adoption preserves its original
intents and acquisitions.
