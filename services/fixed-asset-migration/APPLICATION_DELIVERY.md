# Complete offline application delivery

The maintained standalone builder and the existing browser/CLI handover now retain the executable application source together with the original editable workspace. The same Financial, Work orders and costs, and Issuer reference workflows remain authoritative.

## Open the received package

Extract the complete handover into its own directory. Start with:

- `Fixed_Asset_Finance_Workspace.html`: the exact operating workspace, with its original records and review history.
- `workspace.json`: the original portable project accepted by the maintained receiver.
- `MANIFEST.json`: identities of the complete handover members.
- `application/SOURCE_MANIFEST.json`: identities of all declared application source files and the original entrypoints.
- `application/services/fixed-asset-migration/`: the full local application, templates, adapters, operating guides and CLI.
- `application/AGENTS.md`: the standing owner instructions retained with source.
- Original financial/work-order/issuer exports and every retained supporting attachment remain at their existing paths.

The source closure is separate from the accounting records. Adding executable source to a handover does not mutate a workspace, attest a financial policy, accept a migration or import anything into a supplier system. The original data and operation IDs remain unchanged.

Save working HTML to preserve both the project and this exact source closure for the next browser handover. An older HTML without a source bundle still exports its original project honestly, but does not claim to carry the new offline preparation tools. Rebuild it from the maintained application with the complete received workspace.

## Prepare native Business Central/Dynaway originals

An installed Node runtime is required for the CLI. Run the retained source-preparation entrypoint with the complete actual capture; it uses no network access or provider credentials:

```sh
node application/services/fixed-asset-migration/integrations/business-central/prepare-work-orders-cli.mjs --capture /absolute/original/work-order-capture.json --out /absolute/new/prepared-source
```

See [the source-preparation operating guide](integrations/business-central/WORK_ORDER_SOURCE.md) for its exact options and capture schema. Read [the Microsoft reconciliation guide](integrations/business-central/MICROSOFT_RECONCILIATION.md) before choosing company LCY, dimensional relationships or a cost basis. [The reusable context contract](integrations/business-central/MICROSOFT_CONTEXT_CONTRACT.json) deliberately leaves customer-specific identities unconfigured.

Import the prepared original CSV through the existing Work orders and costs desk or its `wo-import` CLI operation. Retain all output originals, capture, mapping and findings files through the existing supporting-file API. Their actual contents participate in the original workspace source basis. Missing native order links or actual cost remain findings; application packaging does not fill them.

## Reopen and continue independently

Use a new independent workspace path to receive a complete project; an existing matching descendant remains protected by the CLI:

```sh
node application/services/fixed-asset-migration/cli.mjs receive --workspace /absolute/independent/workspace.json --input /absolute/received/workspace.json
node application/services/fixed-asset-migration/cli.mjs inspect --workspace /absolute/independent/workspace.json
node application/services/fixed-asset-migration/cli.mjs handover --workspace /absolute/independent/workspace.json --out /absolute/new/complete-handover
```

To rebuild a working HTML from the retained source and project:

```sh
node application/services/fixed-asset-migration/build-standalone.mjs --workspace /absolute/independent/workspace.json --out /absolute/new/Fixed_Asset_Finance_Workspace.html
```

The builder reads a fixed source allowlist, hashes each complete UTF-8 member and embeds it in the standalone bootstrap. It excludes arbitrary adjacent files and private customer captures. Missing members, changed source descriptors, symlink escapes or mismatched operating modules fail before a complete-source output is presented. Generated HTML is deliberately not embedded inside its own source bundle; the original template and builder are retained instead.

Handover creates a fresh overall manifest after preserving the original issuer, financial and work-order members and adding `application/`. CLI publication keeps the original create-only/resume-if-identical behavior. Do not overwrite a received source directory to update an existing delivery; retain a separate coherent application edition and explicitly rebuild the same original workspace.

## The offered 50,000-cost-line scope

The original parser permits up to 100,000 data records in one selected CSV, subject to its 32 MiB input/member and 128 MiB complete-workspace limits. A 50,000-line cost population is below the record ceiling, but its actual vendor columns, supporting sources and operation history still have to fit the byte limits. This is a source-contract capacity statement, not measured throughput.

Reviewed allocation, header-match and returned-cost-match schedules are limited to 10,000 rows **per operation**. Several disjoint batches operate on the same retained source population. An allocation batch replaces all allocations for each named source row; keep every split of one source row in the same batch. Likewise, keep every returned match for one allocation key together. Later batches must not accidentally replace a partial earlier split. Previous rows outside a batch remain intact.

Use the original stable source row IDs/allocation keys, save each complete reviewed request and check the resulting revision before the next batch. Reconcile the complete population after the final batch. Five batches can cover 50,000 one-to-one rows; additional splits can require more batches. Do not split the underlying source into five selected editions to evade size limits: only one edition is selected per source role/domain. If complete source and history exceed the original byte budget, define a genuinely separate migration scope with the customer and supplier before import.

## Inspect the actual delivery

The existing receiving owner must open and LOOK at the exact outgoing app at desktop and narrow widths, operate its important populated/empty/error controls, download the handover, open its contents and reopen the working project. Verify that the application directory contains the original preparation CLI and all eight new Business Central/Microsoft files. Open every outgoing attachment in its normal viewer. Source review or a passing in-memory exercise does not establish visual or customer acceptance.

Use the actual receiving environment and preserve active user sessions and current owner browser instructions. No broad test sweep, new migration controller, provider posting, credential collection or automatic supplier import is introduced by this packaging change.
