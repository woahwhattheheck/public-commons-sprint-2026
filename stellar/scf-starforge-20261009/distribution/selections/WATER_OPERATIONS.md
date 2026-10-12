# Water operations

This selected Starforge package includes the original USGS Water project and
edition workflow, managed browser application, native merchant, agent interface
and complete customer file receiving. It uses the original Water source modules
and the shared Runtime workspace.

## Open the saved Water application

In the Runtime workspace, attach the original READY runtime and open Applications.
Select Water, review the existing project and edition, then save the application.
Start and Open use the retained managed service; Stop and restart preserve that
same project. Buyer and the merchant console remain available in the selected
Applications catalog.

The original Water guides and implementations travel under:

- `source/stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/MANAGED.md`
- `source/stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/WORKSPACE.md`
- `source/stellar-forge/mcp-merchant-operator/USGS_WORKSPACE.md`
- `source/stellar/scf-starforge-20261009/distribution/runtime-workspace/APPLICATIONS.md`

Use the included original commands:

```sh
starforge usgs-water --help
starforge merchant-usgs --help
starforge merchant-mcp --help
starforge merchant-providers --help
starforge buyer-agent --help
```

## Continue capture, analysis and delivery

Reopen the original Water project and retained station/parameter/statistic/date
selection. Keep acquired source rows, quality flags, units and observation times
with that capture. Review the original analysis and create an edition through
the existing Water workspace. Its merchant compiler and buyer preparation retain
the native seller and receiver contracts.

The Water MCP provider operates those same projects and editions. The merchant
console uses the retained provider configuration and selected requests. The
original customer downloader resumes the same file operation and verifies the
retained edition/file identity before completing it.

Water analysis and HEC-DSS conversion retain their original Python runtime
requirements. Their optional native executables and retained scientific data are
configured through the original Water guides; selecting the source package does
not install a hydrology Python environment or replace the converter.

For a customer handover include the selected package and archive identity, the
original reviewed project/edition, original received files, the retained
installation profile/lock and the applicable Water operator guide. Reopen that
same customer state and complete its original receiving checks before delivery.

## Runtime and source

Receive this exact archive with its SHA-256 through the maintained
`runtime-install prepare` command. Select native dependencies plus the original
`schema`, `openapi` and `mcp` groups, and `--operator` for the original
Linux/Python operator. Run the maintained install and inspect operations to
obtain READY before attaching the runtime to Applications.

```sh
starforge runtime-profile catalog
starforge doctor --native --feature schema --feature openapi --feature mcp
starforge source
starforge registrations
```

The release manifest retains the original commit and the committed product
selection, including exact contribution and recipe files. The customer runtime
uses that selection automatically. `starforge --help` lists the included command
surface; `starforge COMMAND --help` retains each original command's options.

The named package exports retain their original implementations. This product
does not expose the full toolkit's broad root import. Use the named Water,
WooCommerce, buyer, runtime or merchant exports listed in `package.json`.

Complete customer projects, site files, operating state and received files belong
outside the installed package. Preserve them and their original operation IDs
through runtime upgrades and recovery. The original installer receives the
archive, verifies source/profile/lock, and retains its normal resume, cache,
offline-transfer and exact-source recovery behavior.

## Build or resume this source selection

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs --repo /absolute/checkout --ref ORIGINAL_COMMIT --selection water-operations --out /absolute/water-release
node stellar/scf-starforge-20261009/distribution/build.mjs --repo /absolute/checkout --out /absolute/water-release --resume
```

The build receipt reports actual source bytes, file count and archive bytes.
A different product selection uses its own output. An omitted flag on resume
inherits this original Water selection.
