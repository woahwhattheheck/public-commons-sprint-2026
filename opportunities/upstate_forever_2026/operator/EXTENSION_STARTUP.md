# Operator extension startup

Operation: UPSTATE-FULL-PRODUCT-BUILD-BRYCE-20261012 / ES-9960

This change extends the maintained ECSA operator registry. Installed workbenches are loaded in dependency order using their existing requires_actions declarations. A workbench can depend on another installed workbench regardless of the two JSON filenames or their presentation order.

The original action queue, routing, retained state, provider factories, browser host and download tickets remain the integration interfaces. No second operator or registry is installed.

## Composition behavior

The loader reads all manifests before creating any provider. It preserves each complete manifest and its original module bindings. It registers available providers, then reconsiders dependent workbenches using the actions that actually registered. Independent components continue loading when one provider fails. Duplicate IDs, invalid manifest shapes, unresolved provider actions and dependency cycles appear in the existing registry diagnostics.

Registration diagnostics are rebuilt from each installed-manifest pass, so repairing a malformed file clears its old error. Files without a validated extension identity use a file:<filename> diagnostic key, separate from every valid provider ID. A healthy provider cannot erase an unrelated malformed file's error merely because their names match. Duplicate IDs include files with a valid ID whose remaining manifest is malformed; a healthy sibling cannot silently erase that conflict. Runtime task/state diagnostics are retained.

Calling load again with identical installed manifests leaves existing provider instances intact. A changed installed manifest requires an operator reopen so active request ownership and loaded source do not change underneath pending tasks.

## Source integration

The contribution is a replacement of the load method only, against maintained ECSA source SHA256 9363ac944ff29b0fa86747a2c10e83f45dc7ed8a745343652b197010028d6147 / Git blob 3dd869f26a90e079f00861d8d501a20a31b05a57. This same source is included in ECD1's 252-file base at Canvas F0C8JNZTURK.

Use apply_dependency_startup.py with the actual application directory. It locates the one current ExtensionRegistry.load method using Python's syntax tree, checks its exact SHA256 against the original and previously distributed dependency-aware revisions, and preserves all surrounding concurrent edits. The installer carries one replacement body and approved method hashes, keeping its source compact. It checks the replacement's Python syntax before mutation, saves the original bytes beside the resulting file, and replaces the file atomically. Already-applied source is reused. The method-only integration preserves the current authenticated preview routes, file routes and route parameters.

Run the current application-owned install_extensions.py against the actual cumulative source as its existing integration procedure directs. The descriptor and service packages for water-quality context and project continuity remain their complete independent components. The Project continuity service composes with the maintained incremental project transport.

## Focused receiving

Open an actual retained workspace with the installed workbench manifests, run one declared dependency chain in the original queue, and confirm the resulting item/download is available after reopening. Inspect an existing complete project, receive it, and resume its original unfinished source operation. The native model's existing accepted numerical results can be reused for this application continuation.
