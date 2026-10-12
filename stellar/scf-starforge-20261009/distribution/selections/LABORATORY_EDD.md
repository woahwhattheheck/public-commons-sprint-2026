# Laboratory EDD receiving

Receive complete laboratory file families, inspect every original scientific field,
review ambiguous cross-format correspondence, record source-bound decisions and
return native files with portable editors. The `laboratory-edd` selection packages
the complete Lab application with its original paid-job merchant and customer
workspaces.

## Build the selected original source

Product source: [Laboratory EDD in Merchant Workspace](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/tree/main/stellar/scf-starforge-20261009/sf30-seller-sdk/lab-edd).

Use the complete source commit and archive returned by the existing product owner.
To build from a checkout containing that selected commit:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \\
  --repo /absolute/checkout --ref ORIGINAL_COMMIT \\
  --selection laboratory-edd --out /absolute/laboratory-release
```

Retain the returned archive path, SHA-256 and `distribution.json`. Its manifest
binds the original commit, source tree, complete source files and exact
`laboratory-edd` recipe. The package version ends in
`.selection.laboratory-edd`. Resume an interrupted build with the same output:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \\
  --repo /absolute/checkout --out /absolute/laboratory-release --resume
```

The installed product contains all laboratory source, native generators, offline
editors, original public input ZIPs and complete receiving callers. The full
8.8 MB cross-profile result is a separate companion download linked by the
included example guide. This keeps the executable source package within the
original builder's per-file limit while preserving the complete reusable result.

## Install or adopt the runtime

Use Linux, Node 24, Python 3.11 or later, npm and `flock`. Select native Stellar,
`schema`, `mcp` and operator support through the original runtime installer:

```sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \\
  --dir /absolute/laboratory-runtime \\
  --archive /absolute/laboratory-release/ORIGINAL.tgz \\
  --sha256 ORIGINAL_ARCHIVE_SHA256 --native --feature schema --feature mcp --operator
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \\
  --dir /absolute/laboratory-runtime
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \\
  --dir /absolute/laboratory-runtime --load --source
```

Replace the archive name and digest with the original build receipt. Use the
same directory for `runtime-install resume`. When the original receiver already
supplies the complete dependency tree and lock, use the installer's supported
`--adopt-existing` flag; it checks that existing tree against the selected profile.

The runtime retains its package under `package/`, dependency tree under
`node_modules/`, exact source manifest and original profile/lock. Use the returned
READY identity. Run an installed command through:

```sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \\
  --dir /absolute/laboratory-runtime -- lab-edd profiles
```

The commands below use that runtime's `starforge` executable.

## Open the complete product

```sh
starforge runtime-workspace init --workspace /private/runtime-desk
starforge runtime-workspace attach --workspace /private/runtime-desk \\
  --runtime /absolute/laboratory-runtime --label "Laboratory EDD"
starforge runtime-workspace serve --workspace /private/runtime-desk --port 8465
```

Reuse the existing workspace when present. Follow
[Laboratory EDD in Applications](../../sf30-seller-sdk/lab-edd/APPLICATIONS.md)
to prepare the actual merchant configuration, choose the original native factory
and environment, Review, Save, Start and Open the saved Laboratory EDD application.
The same guide covers all five original file slots, customer checkout, full result
receiving, saved field/correspondence decisions and Stop/fresh Start.

The selected product exposes Laboratory EDD, the original paid-job merchant,
Job checkout and Job result receiver catalog entries. It includes the complete
original paid-job merchant tool provider. Each entry keeps its existing runtime,
request and process ownership.

## Source profiles and operator results

| Source profile | Complete operation |
| --- | --- |
| `equis-lab-3` | Sample, batch and combined test/result/QC files, every physical row and parent identity |
| `equis-lab-4` | Separate sample, test, result and batch files with complete native identities |
| `geotech-dts8d` | Original 150-field DTS8D workbook contract, source cells/epoch, explicit literal corrections and native XLSX |
| EQuIS3 ↔ EQuIS4 | Both independent native families, candidate correspondence, explicit pair/separate/defer choices, entity links and full editable tables |

Use [the complete reconciliation guide](../../sf30-seller-sdk/lab-edd/RECONCILIATION.md)
for the original two-source workflow. The bundled public examples retain all
500 + 500 results, original samples/tests/batches, exact limits and qualifiers.
Their complete source execution retained 599 candidate groups, all 29 ambiguous
groups and 25,229 field comparisons. The saved original result, exact execution
context and full archive are linked in
[the companion guide](../../sf30-seller-sdk/lab-edd/examples/mccampbell/CROSS_PROFILE.md).

For direct local receiving, `starforge lab-edd --help` exposes profiles, inspection,
editable tables, native preview, complete receive, cross-profile correspondence,
merchant configuration and result reopening. The SDK exports these same original
modules under `@tokenjunkielabs/starforge-merchant/seller/lab-edd` and its named
model/profile/decision/reconciliation/merchant-configuration subpaths.

## Receive and preserve the same operation

Run [the maintained complete receiving command](../../sf30-seller-sdk/lab-edd/RECEIVING.md)
against the selected source, original example or authorized full delivery and
actual installed runtime. It preserves original sealed input and job identities,
worker/result replay, all native files, complete browser editing, independent
reopening and process-manager retirement. Retain the actual result with the
package's source manifest and runtime tuple.

The Laboratory EDD catalog delegates the `jobs serve` request to the existing
paid-job merchant provider. Its private lease prevents a second service from
owning the same state. Use the same saved Application's Stop and fresh Start;
its job records, input claims, source binding and completed customer results
remain in that original private service directory.
