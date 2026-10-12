# Grant purchase reviewer

Install the original grant purchase workbench, review the retained source and
payment outcome, read both complete Buyer results, then export the closed view
for another receiving operator. The `grant-reviewer` selection packages this
whole workflow through the maintained distribution and runtime installer.

The reviewer reads the retained purchase. Receiving, reading, closing and
exporting it preserve the original quote identities, outcome and source vintage.
They do not dispatch another payment or refresh the underlying data.

## Build or receive the selected source

Use the archive and SHA-256 returned by the original distribution builder. To
build it from a checkout containing the selected full commit:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/checkout --ref ORIGINAL_COMMIT \
  --selection grant-reviewer --out /absolute/grant-reviewer-release
~~~

Replace `ORIGINAL_COMMIT` with the immutable source commit that contains the
recipe. Retain the returned receipt with the archive. The source manifest names
the commit and `grant-reviewer` selection, including the original recipe path,
Git blob, SHA-256 and byte count. The package version includes
`.selection.grant-reviewer`. Use those actual values for installation.

Continue the same source build with its original output:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/checkout --out /absolute/grant-reviewer-release --resume
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --out /absolute/grant-reviewer-release --status
~~~

An omitted selection on resume inherits the saved one. A different explicit
selection returns `DISTRIBUTION_SOURCE_SELECTION_CONFLICT`. A complete output
returns its original verified archive. Use a new output for a different source
commit or product.

## Prepare the original runtime

The maintained installer requires Linux, Node 22.16 or later, Python 3.11 or
later, npm and `flock`. Select native Stellar dependencies, the original
`mcp` feature and operator support. Exact package versions and their checks
come from the selected source's runtime profile and retained dependency lock.

Run the original installer from its checkout:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /absolute/grant-reviewer-runtime \
  --archive /absolute/grant-reviewer-release/ORIGINAL.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 --native --feature mcp --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /absolute/grant-reviewer-runtime

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /absolute/grant-reviewer-runtime --load --source

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /absolute/grant-reviewer-runtime -- source
~~~

Use the returned archive filename and SHA-256, then retain the READY installation
identity, profile, lock and source-manifest hashes. Interrupted installation
continues with `runtime-install resume --dir` against the same directory.
Original source remains under `package/`; dependencies remain beside it under
`node_modules/`.

When the existing receiver supplies a complete retained dependency tree and its
original lock, use `install --dir ... --adopt-existing`. This is a boolean flag;
the original receiver places the tree and lock in the prepared runtime. The
installer checks the source-selected profile, exact imports and native
operations under that installation's lease. Adoption does not run npm.
For an original cache installation, the maintained `--offline`, `--cache` and
`--node-headers` options retain their documented behavior.

The commands below use `starforge` from this READY runtime. When its executable
is not on PATH, use the same installer command above with
`run --dir /absolute/grant-reviewer-runtime --` followed by the command and
arguments, for example `runtime-workspace status --workspace /private/runtime-desk`.

## Open through Applications

Keep the private parent directories under the operator's control. Create the
Runtime workspace once, attach the existing READY installation, then serve it:

~~~sh
starforge runtime-workspace init --workspace /private/runtime-desk
starforge runtime-workspace attach --workspace /private/runtime-desk \
  --runtime /absolute/grant-reviewer-runtime --label "Grant purchase reviewer"
starforge runtime-workspace serve --workspace /private/runtime-desk --port 8465
~~~

For an existing Runtime workspace, use its original directory and skip init.
In **Applications**, select **Grant purchase reviewer**, the attached runtime,
and a private reviewer workbench directory.

Leave Packet and SHA-256 empty to select the bundled public purchase in the
workbench, or supply the complete exported packet and its exact digest.
Choose **Review**, **Save**, **Connect**, **Start**, then **Open**. The original
application binds the runtime, workbench and selected packet, and opens only
the current workbench instance.

The same installed product is available directly:

~~~sh
starforge grant-demo workbench --dir /private/grant-review/purchase --port 0
~~~

Use either the saved Applications operation or the direct command for that
workbench. Its original kernel lease preserves the single owner. Noninteractive
startup prints the listener and instance identity. Applications supplies the
current private connection; a direct operator can read the local
`workbench-connection.json`. Keep its code out of shared messages, packets and
project metadata. The browser clears the entered code and URL fragment after
connecting.

## Read the complete original purchase

1. In **Packet intake**, choose **Review bundled purchase**, or upload the
   complete receiving packet. The workbench retains the exact bytes and verifies
   the original documents, native result representation and SHA-256.
2. In **Source and query**, review the original query, source vintage, selected
   terms and full document downloads.
3. Choose **Receive this packet**. The original receiving engine restores both
   native quote records and their complete result files in this selection's
   private directory.
4. Choose **Open original Buyer**, then **Buyer results**. Select each quote and
   choose **Read complete saved result**. The original Buyer client reads the
   retained ranges and checks their total bytes and SHA-256 before displaying
   or downloading the complete result.

The bundled primary result contains 53,468 bytes, 100 rows and 14 columns.
Its original truncation flag remains true. It describes NYC HPD
building-in-project events at the retained source vintage; the original query
and source links explain those records. The primary quote retains
`CONFIRMED_BY_SERVER` and its `TRANSFER_MATCHED` observation. The earlier
indeterminate quote remains separate with its original `FAILED` observation
and complete 4,733-byte error result.

**Open original console** uses the Buyer's existing private-code form.
Obtain the current code through authenticated local access. Both full quote
histories and result files remain with their original native stores.

## Close, export and hand over

Choose **Handover → Close Buyer and export packet**. The original Buyer drains
its HTTP and broker work and releases the quote-store writer before the export
reads that closed view. The packet retains the original quote transitions,
seller outcomes, source documents and full result bytes.

Download the complete packet and retain its displayed SHA-256. A receiving
operator selects that file and digest in a new Applications review with their
own private workbench. The equivalent direct command is:

~~~sh
starforge grant-demo workbench --dir /private/receiver/purchase \
  --packet /private/receiver/original-export.json \
  --sha256 EXPORTED_SHA256 --port 0
~~~

The new workbench and access code belong to the receiver. Original quotes and
result bytes remain identical. The workbench's **Review receiving copy** option
provides the same local path and labels it as a receiving copy.

Choose **Reopen this received packet** to start the original Buyer after a
closed export. Applications **Stop** drains the managed workbench and Buyer;
the next reviewed Start reopens the same retained workspace.

Keep the original workbench directory and action IDs after interruption.
Retrying an unchanged action recovers its existing accepted result. An already
published export is reconciled against its saved identity before later mutable
history is read. A prepared managed start retains its request ID; reopen the
same Runtime workspace and recover that original operation.

## Preserve the installed source and receiving identity

The selection retains four original component roots in their relative layout.
The maintained builder also follows their real static imports and required
runtime declarations.

| Original root | Product files it preserves |
| --- | --- |
| `stellar/scf-starforge-20261009/distribution` | Original CLI, selection, installer, Runtime workspace, Applications controls and their dynamic assets |
| `stellar/scf-starforge-20261009/sf46-release` | Original installed-runtime inspection, managed release and operator lifecycle |
| `stellar/scf_2026/presentation/reviewer` | Workbench, bundled public packet, original source/results, browser assets, operating guides and both receiving modules |
| `stellar-forge/mcp-paid-agent` | Native Buyer, quote/result stores, computed console assets, browser client and declared MCP runtime inputs |

The selected command catalog contains `installation`, `runtime-profile`,
`runtime-install`, `runtime-workspace`, `runtime-transfer` and `grant-demo`.
Its Applications provider is `grant-reviewer`; its public workbench import is
`@tokenjunkielabs/starforge-merchant/grant/reviewer-workbench`. Use
`starforge --help` and `starforge registrations` for the actual installed
declarations.

The original detailed operating and receiving guides travel inside the
installed package at:

- `source/stellar/scf_2026/presentation/reviewer/WORKBENCH.md`
- `source/stellar/scf_2026/presentation/reviewer/RECEIVING.md`
- `source/stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md`

For the original source receiving workflow, the existing
`WORKBENCH_RECEIVING.mjs --runtime-directory ABSOLUTE_READY_RUNTIME` option
extends the same completed direct journal through Applications. Pass its
original `--operation` and `--source-root`. It preserves the earlier direct
result, skips completed phases and uses the same received workbench.
`WORKBENCH_MANAGED_RECEIVING.mjs` inspects and adopts the supplied installation;
it does not prepare dependencies. The final result records actual managed
start, live reattachment, drained Stop, prepared-start recovery and closed
controller reopening.

Keep source-archive, recipe, runtime-profile, dependency-lock and READY
identities with the receiving handover. Private workbenches, access codes,
customer files and native operation journals remain outside the source package.
Archive size, installed size and memory use come from the actual original
build and receiving output; registration counts do not measure them.
