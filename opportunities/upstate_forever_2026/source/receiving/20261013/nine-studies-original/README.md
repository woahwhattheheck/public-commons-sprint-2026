# Nine Study reader: preserve current work during Reopen view

This is a narrowly guarded repair for the actual completed `Upper_Savannah_Nine_Study_Review_20261013.html` retained as `libfile_15558dd7231081918054f037544f2dc3`. The original 363-member archive is `libfile_870ff8a6d0ec81919c6c1ee8b31fc8e2`, 132,963,053 bytes, SHA-256 `e845f21e67a27ebca3ac7cdffe522f67fd00cbc37b8171956fef2cbbc036366c`. Its nine native study archives and scientific records are preserved.

## Corrected behavior

The original Reopen view handler awaited `file.text()` and then replaced the study, notes, map extent and filters unconditionally. Executing that exact handler with a delayed file read reproduced loss of a later study selection and a newer note. The replacement binds each read to its request number and the complete original review state. A later edit or study/filter/map selection is retained, with a clear instruction to reopen the file when the reader is ready to replace the current view. A newer file selection supersedes older reads. An obsolete failed read cannot replace the current status or clear the newer file input.

The unchanged-state path still reopens the selected retained edition and its original notes and filters. This repairs source behavior; it is not a claim that the repaired outgoing HTML has been rendered or visually accepted.

## Apply to the actual retained HTML

Use the existing native course, retaining its original reader and archive:

```sh
python -B repair_nine_study_review.py \
  --input ORIGINAL/Upper_Savannah_Nine_Study_Review_20261013.html \
  --output OUTPUT/Upper_Savannah_Nine_Study_Review_20261013-saved-view-repaired.html
```

An optional `--expected-sha256` binds the input to the actual original file hash. Both complete original code fragments must match exactly; a different or partially changed reader is rejected. The embedded gzip observation payload is compared before and after, and remains byte-identical. The script writes the distinct repaired HTML and a JSON receipt with original/output/data hashes; it refuses to replace a different existing output. No source or data acquisition, native study rebuild, model run, or archive replacement is involved.

If the native viewer generator is available in the original 363-member ZIP, apply the same two exact replacements from `saved-view-replacements.json` to its HTML template, preserving every other character. Its pathname was not exposed through the readable archive surface; this repair therefore works directly on the verified original outgoing reader without guessing a generator location.

## Native acceptance and original operation

Open the actual repaired artifact on desktop and at 390 px. Reopen an unchanged saved view; inspect its original study/edition, source filter, notes and map. Delay a saved-view read and edit notes or select another study; the current work must remain. Select a newer saved file before an older read finishes; only the newer file may apply. Operate station/map selection, inspect original location and row detail, and export/reopen the complete selected-row and review files. Inspect the actual outgoing attachments; preserve original data and historical archive.

This follows complete `CURRENT_OWNER_DIRECTION.md` v2026-10-13.3: immediate priority remains the actual Upper Savannah 30 m native simulated baseline/riparian/matched-control course; full upstream domain, SC reporting mask and four utility anchors remain distinct; actual NDR/SDR annual stream-delivered nitrogen/phosphorus kg/year and sediment tonnes/year retain their native support and units. Editable inputs/results and cold reopening, actual desktop/390 px control/export/reopen inspection, original-source ownership, and the 14:00 UTC cutoff remain in force. This reader correction adds no new native job and does not claim a model result or visual acceptance.
