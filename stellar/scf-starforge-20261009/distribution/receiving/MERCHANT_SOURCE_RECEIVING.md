# Complete merchant source receiving

Receive one complete merchant source selection and continue its original OData,
collection, Wherobots or other customer operation. The receiver consumes the
existing Commons source packet, original source donor and installed Node
dependencies. Each selected text or binary member keeps its original Git blob
identity.

Use Python 3.10 or newer. The destination is a private directory separate from
the donor and installed dependencies. All paths below are the actual paths on
the accepting machine.

## Prepare and open the selected source

~~~sh
python3 merchant-host-source.py \
  --packet current-host.packet.json \
  --source /private/original-operation/source \
  --donor /actual/original-installed-source \
  --node-modules /actual/installed/node_modules
~~~

The packet's original donor and Node paths are defaults when their options are
omitted. Successful receiving prints `MERCHANT_SOURCE_READY`, the source path,
its selection sidecar, selected source commit, accepted joins and the complete
contribution/provider counts. The existing API remains:

~~~python
selection = materialize(packet, donor, source, node_modules)
~~~

The same command reopens an already completed selection. It verifies the selected
Git bodies, contribution inventory, dependency link and, for selections created
by this receiver, the complete frozen source inventory. A complete received
source can reopen after its original donor has been retired. Its selected
installed Node dependencies must remain available. Reopen and inspection also compare
the actual member names and kinds with the completed inventory. Unexpected
members are reported and preserved, so later customer edits do not silently
become the saved source edition. Keep customer outputs in their original output
directory outside this selected source.

Keep the final source directory and its adjacent
`<source-name>.source-selection.json` together with the original operation. The
receipt retains the exact packet digest, Git member identities, accepted joins,
borrowed dependency path and complete received-source digest.

## Resume the same preparation

Repeat the identical command after a process interruption. The deterministic
preparation directory beside the source binds the packet, donor, destination
and Node dependency paths. Its identity and full donor inventory are written
before that preparation becomes visible.

Each original donor file is streamed into a private temporary file, checked
against its frozen length and SHA-256, flushed, then installed atomically.
Already complete files are reused. An interrupted copy cannot become a completed
source member. The original donor-complete marker separates copying from
applying selected postimages; a resumed postimage phase verifies the untouched
donor members without replacing postimages that already arrived.

The complete expected source combines the frozen donor inventory with the
packet's exact postimages and original contribution selection. This includes
source outside the explicitly selected Git members. Files that remain to be
copied must still match the frozen donor selection. A missing or changed donor
member is reported at that exact path; a copied and verified member remains
usable independently of the donor.

Before publication, the receiver verifies every selected Git body, the complete
source inventory, contribution membership and original Node dependency link.
It writes the ready selection inside the existing preparation, renames the
finished tree to its final source path and publishes the compatible sidecar.
An interruption on either side of that directory rename is recovered by the
same command. Ready receipts made by the preceding staged receiver are reused
unchanged.

One same-destination OS lease serializes these transitions. POSIX uses `flock`;
Windows uses its standard byte-range lock. The OS releases ownership when the
process exits, while the lock file keeps its inode.

## Recover a directory left by the original direct-write receiver

The first receiver could stop after creating the final source directory but
before writing its selection receipt. Adopt that original partial directory
with the same source packet and paths:

~~~sh
python3 merchant-host-source.py \
  --packet current-host.packet.json \
  --source /private/original-operation/source \
  --donor /actual/original-installed-source \
  --node-modules /actual/installed/node_modules \
  --resume-incomplete
~~~

The receiver records the original directory identity, then moves that same
directory into its existing preparation. It reuses complete members and fills
the missing source from the frozen donor and selected packet. This avoids
making a second complete copy of the interrupted directory.

Before replacing any unrecognized member, the receiver retains its exact bytes
or directory under:

~~~text
.merchant-host-preparation-<binding>/retained-incomplete/member-<unique>/member
~~~

The adjacent `original-path.json` records its original relative path. An
incomplete original selection receipt is preserved there too. Known complete
source bytes can be replaced by their selected postimage without duplicating
them. Unexpected files and directories are retained outside the finished
source, so the completed source contains the selected edition.

The adoption record and original directory identity survive interruption.
Repeating the command continues that same adoption. Once adoption has been
recorded, ordinary receiving also resumes it. A completed receipt for another
selection is preserved; use that selection's original command and destination.

The keyword API is additive:

~~~python
selection = materialize(
    packet, donor, source, node_modules, resume_incomplete=True
)
~~~

## Inspect the original receiving state

~~~sh
python3 merchant-host-source.py \
  --packet current-host.packet.json \
  --source /private/original-operation/source \
  --donor /actual/original-installed-source \
  --node-modules /actual/installed/node_modules \
  --inspect
~~~

Inspection reads the original records and source. It creates no directory,
lease or customer operation. The callable form is
`inspect_materialization(packet, donor, source, node_modules)`.

| State | Meaning | Receiving action |
| --- | --- | --- |
| `MERCHANT_SOURCE_UNPREPARED` | This selection has no source or preparation. | Run the normal receiving command. |
| `MERCHANT_SOURCE_INCOMPLETE` | The original source directory exists without an owned completed selection. | Adopt the same interrupted selection with `--resume-incomplete`. |
| `MERCHANT_SOURCE_PREPARING` | The original preparation exists; `phase` identifies copying or postimage application. | Repeat the original command. |
| `MERCHANT_SOURCE_READY_TO_PUBLISH` | The staged source and retained ready receipt verify. | Repeat the original command to publish them. |
| `MERCHANT_SOURCE_SELECTION_PENDING` | The published source verifies; its original sidecar remains to be published. | Repeat the original command. |
| `MERCHANT_SOURCE_READY` | The completed source and saved selection verify. | Continue the original customer operation. |

Inspection is a snapshot. A concurrent receiver can advance the preparation
after the read; the next receiving command reconciles it under the original
lease.

## Continue the original customer operation

Add `--run-odata` to the receiving command. Optional `--connection` and `--out`
map the same original connection and operation directory onto their actual
accepting-machine paths. `--node` selects the installed Node executable.

~~~sh
python3 merchant-host-source.py \
  --packet current-host.packet.json \
  --source /private/original-operation/source \
  --donor /actual/original-installed-source \
  --node-modules /actual/installed/node_modules \
  --run-odata \
  --node /actual/node \
  --connection /private/original-operation/connection.json \
  --out /private/original-operation/odata-semantic-native
~~~

The packet continues to supply the original workspace alias, source edition,
live profile, fields and expected semantic digest. The existing OData driver
retains its capture, payment and edition identities. Collection and Wherobots
consumers use the same completed source with their original receiving command,
input selection and output directory. Receiving source does not create another
customer command or replace the original operation's execution ownership.

Declare enough space for the complete source copy and original customer
outputs through the accepting host's maintained native runtime. Existing partial
source is moved into preparation, while retained changed members consume only
their own additional space. Preserve the completed source, selection receipt
and any retained prior members until the original operation has accepted their
custody.
