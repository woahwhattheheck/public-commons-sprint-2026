# ECO incremental source assembly

ASTRA-ASSEMBLE12 · version 1.0.0 · Python 3.10+ · standard library only.

A runnable installed-workspace companion to ECD1's cumulative application assembler. ECD1 composes and receives the initial application. This tool receives later editions into that application, preserves local work, merges independent same-file edits, and recovers interrupted writes. The existing scientific backend and operator UI retain their owners and entry points.

## Run immediately

`eco_assemble.pyz` is a standard Python ZIP application containing the complete editable implementation, the full operating guide, and two executable workflow exercises. It runs directly; there is no installer, package download, or Canvas reconstruction step.

```sh
python eco_assemble.pyz --help
python eco_assemble.pyz inspect peer-source.md
python eco_assemble.pyz --root ./current-application adopt
python eco_assemble.pyz --root ./current-application apply peer-source.md
python eco_assemble.pyz --root ./current-application status
python eco_assemble.pyz --root ./current-application pack --output ./next-edition.eco
```

Record the original with `adopt` before independent edits. `apply` never treats a missing ancestor as permission to replace divergent installed source. Incoming unrelated files can still be received while conflicting files retain all versions. Run source updates between native application runs: file replacement is atomic per file, not a filesystem-wide snapshot for an application that ignores the receiver lock.

The executable is 25,755 bytes; SHA-256 `f12b0dbd595f2a4c195f1edee39fced7880b0d99fad050238dc59b6fc077e63a`. Its Git blob is `75b08186b0f95c40ff3e5312af351cff04a74e8a`.

## Open the editable source

Choose a new output directory. The archive is conventional ZIP, so the Python standard library extracts its source directly:

```sh
python -m zipfile -e eco_assemble.pyz ./eco-assembly-source
cd eco-assembly-source
python eco_assemble.py --help
python exercise_workflow.py
python exercise_interop.py
```

The extracted `README.md` is the complete operating guide. Five source/guide/example files total 85,590 bytes, plus the 55-byte `__main__.py` launcher. The main implementation is `eco_assemble.py` (59,483 bytes). All source is contained in this repository's executable; the archive does not contain external source pointers.

## Existing ECO transport compatibility

Accepts plain source maps; `files` maps and lists; separate `file_metadata`; `content_base64`; original operator `encoding: base64` plus `content`; nested Canvas `text`, `content`, `markdown_content`, and `canvas` envelopes; gzip JSON; numbered `upstate.application-source-part/v1` gzip/base64 parts; numbered bare-base64 Markdown; and framed ECO capsules. Repairs rich-text Unicode separators only outside JSON strings. Literal source Unicode, backslashes and line endings are retained.

Checks available file SHA-256, byte counts and optional Git blob identities. Exported capsules include complete source and exact known ancestors. Shuffled complete new-format parts and identical duplicates are accepted; incomplete or mixed editions are rejected.

To feed ECD1's initial/cumulative composition path, emit a text source-bank overlay:

```sh
python eco_assemble.pyz --root ./current-application pack --format source-bank --output ./current-overlay.json
```

Use ECD1's `--overlay current-overlay.json` with its complete original base. Binary files and explicit deletions require the ECO capsule format; source-bank export explains that requirement rather than discarding them.

## Conflict and restart workflow

`status` supplies conflict IDs. `conflict-files` exports retained base/local/incoming bytes. `resolve` records an explicit local, incoming, or complete merged-file choice; use command help for its arguments. Decisions and source origins survive reopening.

`recover` repairs a journal interrupted between writes and preserves newer external edits. `history` shows transactions. `rollback` reverses a committed transaction without replacing post-commit edits; reverse dependent transactions newest first. Content-addressed objects under `.eco-assembly` retain needed previous and conflicting versions.

The receiver serializes cooperating writers with a local lock, checks pre-write contents, uses atomic replacement and a durable journal, rejects traversal/symlink/case/Unicode path collisions, and parses received Python syntax without executing that application source. Known credential filenames and repository/cache directories are omitted from directory export and listed; this is not a content-secret scanner.

Limits: 16 MiB per file, 64 MiB decoded bundle, 96 MiB carrier input, 10,000 files, and 50,000 lines per concurrently edited automatic-merge candidate. Large repetitive files may produce a conservative conflict instead of an expensive automatic merge.

## Exercised delivery

The source-exchange journey received a real earlier ECO project-I/O helper from its published source, retained Unicode and a binary member, combined two independent edits in the same file, received shuffled multipart source, replayed without writes, resolved an overlap while installing an unrelated file, exported into another workspace, and exercised deletion/rollback. An actual child process exited between file replacements; a new process recovered the original two files.

The interoperability journey uses the field shapes read from current ECO/ECD1 carriers, including nested envelopes, original base64 bodies, source-map metadata, legacy parts, whole-payload identities and ECD1 source-bank export. The complete shipped source was received into a separate directory and both journeys passed there. Linux execution is exercised; the Windows lock branch is implemented but needs a Windows host run.

These exercises concern source exchange and application assembly. Scientific runs, native GUI acceptance and watershed calibration remain separate application workflows.
