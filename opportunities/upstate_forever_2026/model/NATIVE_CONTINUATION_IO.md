# Continue saved native calculations without rereading identical bodies

A completed scientific file can be encountered repeatedly while the existing
native supervisor reconnects a worker, reads its completed result and resumes a
saved parameter study or programme. These reads now share one temporary verified
body inventory within the original synchronous operation.

The first encounter still reads the complete file and computes SHA256. Every
encounter opens the selected regular file, checks its descriptor and compares
device, inode, size, modification time and change time. A new or changed identity
requires another full read. The opened descriptor and current path must still
agree after verification. Original output bytes, scientific selections, native
stage identities, model versions and output units are unchanged.

## Operation boundaries

The inventory starts empty at the existing single-run, retained-input,
programme and parameter-study supervisor entries. Nested calls share it. The
native execution entry also scopes direct CLI use. Each new thread or process
uses its own inventory; a copied context cannot reuse another thread or process's
entries. The outermost operation discards the inventory on return or exception.
Only metadata is retained, with least-recently-used eviction to bound memory;
eviction simply restores a full read on next use.

There is no persistent content cache, second scheduler, output copy, additional
scientific run or new user-facing workflow. Ordinary verification outside these
operation boundaries still reads every requested body. Existing run locks,
worker identity checks, source hashes, process ownership, stop/reconnect behavior
and retained native result checks remain in place.

## Adopt into an existing receiving application

Receive all five complete postimages together:

- model/common.py
- model/verified_files.py
- model/native.py
- operator/native_jobs.py
- model/NATIVE_CONTINUATION_IO.md

The ordinary portable application inventory includes the new Python module.
Preserve newer sibling changes when joining the three existing files. Let an
already-running original worker finish with its admitted source, then select
the composed application for the next ordinary continuation. The existing
launcher and Workspace paths remain authoritative.

Open an existing saved native task or study and resume through its current
controls. Previously completed cases retain their actual result identities.
A changed or damaged output is reported through the original failure path.
Reopen the existing result, comparison and report in the same operator and use
their normal downloads. Inspect those actual desktop and phone surfaces and
attachments under CURRENT_OWNER_DIRECTION.md version 2026-10-13.4 and the
post-call campaign ECO-POSTCALL-20261013 / F0C8R2SQ0NP.

## Measure the actual file-read scope

The helper exposes optional in-process counts for the receiving operator:
`verified_files()` yields an object with `observation()`, containing complete
hash-read count, bytes actually hashed and metadata-confirmed repeat checks.
A producing receiver can wrap its original synchronous continuation with that
context and retain those counts beside measured wall time. Nested original
entry points join that context automatically. The counts do not include native
model I/O, transfers, source preparation or report generation; report them with
that exact scope.

A fresh process or independent operation starts with no verified identities.
Compare a complete original continuation and its actual elapsed time when making
a recipient-level performance statement. A reduction in hashed bytes alone is
not an end-to-end speed measurement.
