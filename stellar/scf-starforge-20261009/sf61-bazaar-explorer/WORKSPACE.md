# Atlas saved workspace and portable handoff

Atlas can retain an operator's original catalog observations, selected offers, and
buyer-request revisions in a private directory. Reopening that directory restores
the same catalog and selection identities. A portable transfer carries the complete
saved workspace to another operator machine, including the original source bytes
and the inputs needed to reopen each saved request.

The browser, local host, and transfer commands use the same `workspace.mjs` store.
The existing SF88 request preparation and handoff builders remain the consumers of
the retained selected offer and request. The current SF61 browser and original
SF60 discovery service continue to use their established source interfaces.

## Start a persistent Atlas workspace

Use Node 22 or later and the installed Starforge distribution. Choose a private
absolute directory outside the source checkout for operator data:

```sh
starforge atlas \
  --workspace /private/atlas
```

From a source checkout of `public-commons-sprint-2026`, the equivalent commands
run from the repository root:

| Installed command | Source entry point |
| --- | --- |
| `starforge atlas` | `node stellar/scf-starforge-20261009/sf61-bazaar-explorer/server.mjs` |
| `starforge atlas-workspace` | `node stellar/scf-starforge-20261009/sf61-bazaar-explorer/workspace-cli.mjs` |
| `starforge buyer` | `node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs` |

Linux uses the standard util-linux `flock` command for single-writer access. The
workspace keeps its private lock inode for reuse; the kernel releases ownership
when the process closes the workspace or exits. Every process opening the same
local workspace participates in that lock.

The first start creates the workspace. Subsequent starts use the same directory.
The printed loopback address opens the original Atlas interface with the retained
workspace controls enabled. With `--workspace` alone, Atlas opens saved source.
Add `--fixture` to include the original development catalog, or select an existing
catalog with the options below. Close the process normally when moving the
workspace between operators or using the offline transfer CLI.

For a running original SF60 catalog, use its existing loopback discovery service:

```sh
starforge atlas \
  --local-upstream http://127.0.0.1:8787 --workspace /private/atlas
```

The catalog service continues to own its own directory and journal lock. Atlas
saves observations in its separate operator workspace. An explicitly selected
public facilitator can use the existing `--upstream` option with the same
`--workspace` directory.

## Work from retained source

Choose **Open capture folder** for the original capture's session, source manifest,
and exact native page files. The capture remains in progress until its expected pages are received
and the core finishes it. Repeated receipt of the same native page uses its original
file identity and bytes; changed content is a conflict to resolve with the source
owner. **Open saved page** receives a single observed native-page export, and
**Retain displayed page** saves the current applied source-page observation.

Saved catalogs remain available after live browsing moves to another source. Use
the saved catalog's search and paging to find the resource, then save the intended
row and one exact offered payment option. Atlas retains that selection independently
of subsequent live filters and page changes.

Prepare the buyer request against that retained selection. The revision editor
can keep, replace, or remove saved body and ticket inputs. Each accepted request
revision keeps the request fields and its original selected source. Optional body
and ticket content are copied into the private workspace, so subsequent handoff
preparation can use those saved inputs. The revision guard prevents a delayed edit
from silently replacing a newer request. Reopen the saved selection to continue
from its current revision before making another edit.

For an ordinary HTTP request, choose **Create buyer handoff** when the saved
selection is ready for the existing buyer terminal. The resulting files belong to that selection and request revision.
The original buyer configuration, source hashes, review, and handoff files travel
together when the workspace is exported.

For one downloaded native buyer handoff, the receiving operator uses the existing
SF88 import path with the intended offered-option index:

```sh
starforge buyer \
  --import-operation --file /private/buyer-operation.json \
  --dir /private/received-buyer --accept 0
```

Use the index of the intended original `accepts` option in place of `0`. This
prepares that operation in the receiving buyer directory. The Atlas transfer
commands below carry the complete catalog and request workspace for continued
operator work.

## Receive a downloadable asset

A listing with the original `stellar-forge-asset` extension opens **File delivery**
in the saved request editor. The panel shows the advertised download name,
expected byte count, content type, and SHA-256. Set **Response destination** to a
new absolute output path on the machine that will run the buyer, then choose
**Prepare and save revision**. That native configuration carries the original
file checks and the selected output path.

Choose **Download buyer configuration**, or use the saved configuration path
shown by Atlas. Review that exact configuration in the original buyer:

```sh
starforge buyer --review --config /private/buyer-asset-review.json
```

Create the buyer's operator workspace using the same review configuration and
your existing operator, service, payer, signer, and spending settings. Replace the
uppercase values below with those settings and use the actual installed signer
provider path:

```sh
starforge buyer --init-workspace \
  --config /private/buyer-asset-review.json --dir /private/asset-buyer \
  --actor YOUR_OPERATOR_ID --service YOUR_SERVICE_ID \
  --payer YOUR_STELLAR_ACCOUNT --python /usr/bin/python3 \
  --signer-provider /private/wallet.mjs \
  --total-atomic YOUR_TOTAL_CAP --daily-atomic YOUR_DAILY_CAP
starforge buyer --review-workspace --dir /private/asset-buyer
starforge buyer --execute-workspace --dir /private/asset-buyer
```

The original buyer performs its current quote approval and file receiving flow.
Its existing `--help` describes additional RPC, signer, and transport settings for
your operator environment.

To continue this purchase on another machine, export and receive the whole Atlas
workspace with the commands below. Reopen the saved selection on the receiving
host, set that host's output destination, and save a new request revision before
continuing from its newly prepared native configuration. The catalog identity,
selected offer, request history, and original file metadata remain together.

## Export the complete workspace

Close the Atlas process that owns the directory, then run:

```sh
starforge atlas-workspace export \
  --workspace /private/atlas --output /private/atlas-handoff.ndjson
```

The command opens the existing store, records its canonical file manifest, and
rechecks each original file while streaming the export with private permissions.
The output path must be new;
choose another filename when keeping a later workspace revision. The final filename
appears only after the whole export is written and flushed.
If the source changes between the manifest and file passes, export stops and
leaves the intended output filename uncreated. Run it again from the settled
workspace. The streaming command retains the manifest and one file at a time.

The printed result contains the workspace ID, transfer ID, file count, total source
bytes, and output path. The transfer ID depends on the ordered file paths, exact
lengths, and SHA-256 hashes, so another export of unchanged canonical files has the
same transfer ID. Its creation timestamp can differ.

Send the resulting file through the already authorized private handoff surface.
Retained pages, buyer request bodies, ticket content, and original handoff files are
included. The export wrapper uses relative workspace paths. Absolute paths within
original prepared configuration bytes remain part of that original record.

## Inspect an incoming transfer

```sh
starforge atlas-workspace inspect \
  --input /private/atlas-handoff.ndjson
```

Inspection reads the complete stream and checks the manifest, each decoded file,
and the final completion record. It also checks that `workspace.json` has the Atlas
workspace schema and the identity declared by the transfer. It prints the complete
file manifest and counts for the receiving operator.

## Receive and reopen

Choose a new destination whose parent directory already exists:

```sh
starforge atlas-workspace receive \
  --input /private/atlas-handoff.ndjson --workspace /private/atlas-received
```

The receiver stages the incoming files beside the destination. It accepts the
complete archive before creating the final workspace directory. It then installs
the exact files without replacing existing content and publishes `workspace.json`
after its referenced data is present. The CLI opens the resulting store through
the original Atlas core and prints its summary.

Reopen it in the original browser:

```sh
starforge atlas \
  --workspace /private/atlas-received
```

The retained catalogs, selections, request revisions, and handoff identities remain
the same. The receiving directory can differ from the exporting directory. When a
saved selection is opened, the core rebuilds its usable prepared representation
with the receiving workspace's saved input paths. The archived original prepared
bytes remain available as the original record. Continue buyer preparation through
that reopened selection when using the received workspace.

## Continue an interrupted receive

Use the same input file, destination, and `--resume`:

```sh
starforge atlas-workspace receive \
  --input /private/atlas-handoff.ndjson --workspace /private/atlas-received --resume
```

The retained receive marker binds this destination to the original transfer ID and
manifest. Already staged files must match the exact expected size and SHA-256;
matching files are reused. A receive interrupted while committing files continues
with the same create-only file installation. Repeating a fully completed receive
returns `alreadyReceived: true` after checking the input and destination bytes.

A different transfer cannot resume into that destination. Receive it into another
new private directory. Likewise, the receiver does not merge an archive into an
independently created or currently active workspace. These choices preserve both
operators' existing selections and revisions without inventing a merge order.

If a file differs, the command reports its relative path and leaves the original
data available. If an input is truncated or its final record is missing, the
destination is not published; supply the complete original file and resume. A full
filesystem can leave staged files for that same continuation. Successfully linked
staging copies are removed after completion; any unrelated staging content remains
available and is reported by `stagingRetained`.

## Format and host integration

The format is newline-delimited JSON with schema
`stellar-forge.sf61.workspace-transfer.v1`:

1. One header contains the workspace identity and ordered manifest.
2. Each file has one record containing its relative path, size, SHA-256, and base64
   original bytes.
3. One final record binds the completed file count and byte total to the transfer ID.

The parser rejects missing, repeated, unlisted, or changed files; malformed UTF-8
and base64; and paths that could escape or collide on the receiving filesystem.
Imported files are data and are never executed by the transfer commands. Newly
created directories use `0700` and files use `0600` where supported by the host.

The module exports these host interfaces:

| Interface | Result |
| --- | --- |
| `prepareWorkspaceTransfer(workspace)` | File manifest plus an asynchronous `records()` iterator that rechecks source bytes |
| `exportWorkspaceTransfer(workspace)` | The same metadata and complete `bytes` buffer for a host response |
| `writeWorkspaceTransfer(workspace, absoluteFile)` | A private, create-only NDJSON file |
| `inspectWorkspaceTransfer(input)` | Complete validation and the original manifest |
| `receiveWorkspaceTransfer(input, absoluteDirectory, {resume})` | A received workspace, counts, and idempotent continuation status |

`input` accepts bytes, NDJSON text, or a byte stream. `workspace.snapshotFiles()` is
the core-owned async snapshot interface and yields `{path, bytes}` records. It
includes only canonical Atlas files; transfer state, transient files, and process
locks stay outside that snapshot.

The parser's default memory budgets are 100,000 files, 128 MiB per file, and 512 MiB
of decoded workspace content. Host integrations can supply a `limits` object when
they deliberately provision different capacity. The transfer module uses Node
standard libraries and performs local file operations only.
