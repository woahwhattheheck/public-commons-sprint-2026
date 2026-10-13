# Incremental delivery of complete editable studies

Version 1.0.0. An optional transport for subsequent editions of the **same original
project**. Keep the original native archive format, portable writer, scientific
sources, run ownership and recipient editing workflow. A recipient retains one
known full archive and receives only changed compressed ZIP records. The receiver
reconstructs the producer's **byte-identical full new archive**, then invokes the
existing `model.portable.restore` or `resume_restore`. A delta alone is not a study.

## Produce and send an edition

First make the complete successor with the existing Workspace backup or selected
Study export. Do not modify a retained archive or reconstruct scientific metadata.
Keep both completed archives frozen throughout transport creation.

```sh
python source_tools/archive_delta.py create previous-study.zip new-study.zip study-update.zip --application /owned/application
python source_tools/archive_delta.py review study-update.zip READ_STUDY_UPDATE.html
python source_tools/archive_delta.py inspect study-update.zip
```

Send `study-update.zip`, the two complete Python source files (or their containing
current application), this guide, and `READ_STUDY_UPDATE.html`. The reader shows the
exact base and target identities, measured transfer sizes, and **every** retained,
added, changed or removed native file. Its search, status filters and pages affect
viewing only. Complete recipe/CSV/instruction downloads retain the entire inventory.
If the recipient lacks the exact base, send the original full target by the existing
ordinary archive or multipart route; do not guess a different base by filename.
A small or extensively changed archive can produce a delta larger than the original;
use the displayed measured byte counts to select the better transport.

## Receive, reopen and edit

```sh
python source_tools/archive_delta.py restore previous-study.zip study-update.zip received-edition.zip /owned/new-received-project --application /owned/application
```

The original application must be importable in the current interpreter. Transport
itself requires Python 3.10+ and the standard library on Linux. Native receiving
continues to need that application's usual runtime; no new model runtime is installed
by the transport. `receive BASE DELTA OUTPUT` reconstructs only and requires no native
imports. The exact new ZIP remains usable with the existing standalone native CLI:

```sh
python /owned/application/model/cli.py restore received-edition.zip /owned/new-received-project
python /owned/new-received-project/application/operator/server.py --workspace /owned/new-received-project/workspace --operator-state /owned/new-operator-state
```

Open the local authenticated URL printed by that original server. Inspect saved
scenarios and source choices, completed runs, reports and original files. Recipient
edits happen in the independently received Workspace. The transport never merges or
replaces a sender's or recipient's existing project files. Original native receiving
controls preserve deliberate later edits on a resumed already-received project.

## Interrupted receiving and exact identities

Repeat the same command with the same output path. A nonblocking per-output lock
keeps another receiver from sharing the partial file. Each durable checkpoint follows
file flush/fsync; its atomic journal binds the full recipe identity and completed
record/byte cursor. Replay hashes the committed prefix, discards only its own
uncommitted tail, and resumes the remaining records. A changed base, corrupted
payload, edited committed partial, wrong journal, differing existing output, or
input mutation raises a concrete error without overwriting the existing artifact.
Keep a conflicting partial/output and choose a new output path for a fresh attempt.

Final publication is create-only and atomic on the output filesystem. The complete
reconstructed SHA-256 must equal the original target before publication. An already
completed matching output is reused. Native inspect verifies the original scientific
manifest and every member before the original restore continues. An interrupted
native restore resumes through the original `resume_restore`, not a second receiver.

## Implementation and resource behavior

The delta ZIP holds compressed `DELTA.json` metadata and uncompressed `payload/<sha256>` records. These
payloads are already the producer's compressed ZIP bytes; no recompression or raster
processing occurs. Unchanged records refer to byte offsets in the exact base. The
last record includes the original central-directory tail, so arbitrary offsets,
ZIP64 metadata, data descriptors and comments are reproduced exactly. Every target
byte is covered by a contiguous recipe; duplicate target records can share a payload.
Only 1 MiB stream buffers hold scientific data. Metadata scales with member count,
not raster volume; the metadata admission limit is 64 MiB. Base and target are read
for hashes. Creation and receiving use one owned staging file apiece and never
extract payload-controlled paths. Receiving needs disk for its completed full target
and the independent extracted project; the delta saves transfer, not those required
scientific working bytes.

Source assembly includes this complete feature via the additive
`integration/component_fragments/archive-delta.json`; no shared producer, native
queue, archive schema or original component declaration is replaced. Existing
selective multipart receiving remains complementary: it selects original members
from one archive, while this feature transports a complete **subsequent edition**.

## Current owner direction and product use

Read `CURRENT_OWNER_DIRECTION.md` version `2026-10-13.3` and `AGENTS.md` in the
retained application. Preserve original regional model work, actual source versus
simulated-input distinctions, scientific interpretation, full editable handoff and
the October 13, 2026 14:00 UTC sprint cutoff. This transport creates no new scheduling,
contact, approval or model execution rules. Before putting a new delivery in front
of a human, the producer opens and looks at the populated reader at desktop and
390-pixel widths, operates filters and complete downloads, and opens the exact
reconstructed archive through its original application. Observe the actual resulting
project and its attachments rather than treating hashes or a checklist as viewing.
