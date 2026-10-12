# Continue the original StellarExpert MCP source receiving

This is the complete source handoff for the original operation
`stellar-expert-mcp-receiving-b3909-20261012`.
It supplies the final 112 selected Git blobs to the existing original receiver.
The receiver keeps the same a4e5c724 source identity, cache, journal and source tree.
The completed two-page customer purchase remains in that original workspace.

## Exact selection

| Item | Identity |
| --- | --- |
| Repository | woahwhattheheck/public-commons-sprint-2026 |
| Selected commit | a4e5c7248462e54f25f8c98f9e70dccf83d02237 |
| Selected tree | e66e0ec8283b9847bc1c0152ae9ee47401ce38a2 |
| Original native record | 065814666cd55fbf25282b776d220914fd2efd42c6b4624e453319a0a28b90ff |
| Incoming packet | source-incoming.json, 1,133,414 bytes |
| Packet SHA256 | fb6b3cc07bddc19f35d088cae6e9033efca199f90a7c8fd6294d6cdd540382e5 |
| Packet Git blob | c1f961bf3b7cd1c2efeec98c95650eafbfacdcf0 |

The original missing-object manifest contained 1,321 objects / 18,192,772
bytes. Actual reads of the three retained Git donors account for 1,209
objects / 16,360,144 bytes. This packet supplies the other 112 objects /
1,832,628 bytes. Every object was checked against its original size and Git
blob identity before packaging. The full compressed packet was reopened
and its decoded identity checked before publication.

`INPUTS.json` retains the exact original source, receiver, cache, metadata
locations, donor paths, terminal operation and proposed linked recovery ID.
The package contains source bytes and operating instructions. It contains
no account credentials or new payment configuration.

## Stage the packet and finish the same cache

Use the existing Python and Git installed on the receiving host. Keep this
directory's four small source/instruction files beside source-incoming.json.
The original project must already contain its captured metadata, metadata
SHA256 file, exact original receiver and source-cache state.

```bash
python3 -B receive_incoming.py --receive-cache
```

The helper first validates the complete packet and each source blob against
the original metadata. It then writes immutable OID.blob.gz files into
`/dev/shm/b3909-stellar-incoming-a4e5`, under one incoming lock.
The helper accepts an existing identical incoming object and rejects changed
bytes. Interrupted staging can therefore reopen the same packet.

It invokes the original `source-input/git-object-receiving.py` with the
same cache and available declared Git donors. The original receiver owns
all Git object creation, source-tree verification, missing-object accounting
and its canonical source-cache lock. Local Git reads use
`GIT_NO_LAZY_FETCH=1` and the original receiver's
`--no-lazy-fetch` support.

This cache step deliberately leaves materialization to the original native
continuation, where its retained capacity declaration applies. A successful
cache result is `SOURCE_READY` with the original receiver reporting
`OBJECTS_AVAILABLE` and zero missing objects. Exit 2 and
`SOURCE_NEEDED` retain the exact remaining manifest if a donor has
disappeared. The helper does not fetch replacement objects.

The incoming directory retains:

- `receipt.json`: packet identity and every staged original object.
- `original-receiver-result.json`: complete receiver stdout, stderr,
  exit code and actual available/absent donor paths.
- `result.json`: the combined staging/cache result.

An alternative incoming directory must be an owned canonical absolute
directory. Pass it with `--incoming` and add that exact directory to
the original continuation's incoming arguments before source adoption.

## Adopt the complete continuation

`native-continue.py` is the complete successor for the original
project's `private/native-continue.py`. It uses the same root, exact
metadata SHA, original receiver, cache, source destination, accepted dependency
tree and `private/mcp-journey.cjs` journal. Its changes add the two
actual retained Git donors and complete incoming directory, then report a
remaining local source gap directly through the original missing manifest.

Before placing that file, reconcile the original native record and verify
that its child and supervisor have ended. Preserve the original source as a
named prior edition. The existing continuation must match either the
declared previous Git blob `c90cbe0c4e0e6a4673dee00f895acd80e4f720d9`
or the already-adopted successor
`f472fb58c81ce7288e846de498fac88efe04e3a9`.
Use an atomic file replacement and independently read back the successor.
A different current source is a concurrent edit to reconcile.

The original 06581466 operation ran a real child and ended with exit 1 after
partial source receiving. Preserve that terminal result. The maintained
`native_foreground.py --recover-failure` path handles pre-dispatch
launch failures, so it does not restart this terminal child execution.

The next actual execution uses the explicitly linked ID
`stellar-expert-mcp-receiving-b3909-20261012-recovery-1` with the same
original project and command. Before first registration, inspect any
existing record under that ID and save a continuation manifest binding the
original request/result hashes, original operation/record, selected source,
metadata, successor script and current operating journal. Use the maintained
native runtime's existing `start`/`ForegroundLaunch` interface
with the original runtime paths and capacity declarations. Reuse a matching
existing recovery request if one already exists.

The accepted runtime source for that interface is Commons commit
`62c14ca97b0e3aac0acae58e0bee78af3dd66569`, originally retained at
`/workspace/scratch/dbc61db6310c/native-runtime-recovery-62c14ca9/host`.
Its source identity is
`05f93ccf41ae46f147a5e64bae770cc2e057ef50de34eb74d1d3a2c3755704dd`.
A newer runtime must be adopted through the maintained handoff after
reconciling the same original request.

## Existing customer outcome and remaining operating result

The original merchant already delivered 100 rows across two purchased
50-row pages. The exact transactions are retained in the original journal:

| Original page | Transaction | Ledger |
| --- | --- | --- |
| p1-recovery1 | 7a18d2fa0bbb7639dc22c62b2ddebf21c5a3045dca2687349d27a11edd68a377 | 5150783 |
| p2 | 466d462e0c6ce92b6d6ae1166df7f5e33a637b4a088bfc62804260b28643cbac | 5150801 |

The remaining operating work uses those retained source/customer files in the
original MCP workspace and installed Applications receiving programme.
`private/result.json` is the original MCP journey result; the
continuation's source status is
`private/source-receiving-result.json`. Keep the original intent
order, returned files and byte identities throughout that continuation.

This source handoff is ready for the native receiving host. The native
cache result and linked MCP result are recorded by their actual executions.
