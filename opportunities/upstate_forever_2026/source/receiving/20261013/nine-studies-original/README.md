# Nine Study reader: responsive map, readable values and safe Reopen

This source update applies to the exact completed `Upper_Savannah_Nine_Study_Review_20261013.html` retained as `libfile_15558dd7231081918054f037544f2dc3`. Its original standalone SHA-256 is `baec49821d4234f8e241c20c52612d903af4533ab02a9b504d7a05ee772608d3`. The preserved 363-member archive is `libfile_870ff8a6d0ec81919c6c1ee8b31fc8e2`, 132,963,053 bytes, SHA-256 `e845f21e67a27ebca3ac7cdffe522f67fd00cbc37b8171956fef2cbbc036366c`. The nine native study archives and scientific records remain unchanged.

## Reader changes

The repaired Reopen flow binds each asynchronous file read to its request number and the complete review state at the start of the read. If notes, study, filters, station selection or map extent change while it loads, the later work stays in place. A newer selected file supersedes earlier reads, and stale failures cannot change the status or clear the newer file input. Reopening an unchanged view continues to restore its selected retained edition and saved notes and filters.

Fit stations and Full domain now retain their fit mode through viewport resize and recompute the same selected extent for the new map proportions. Manual zoom, keyboard or pointer pan, and saved-view Reopen leave fit mode, preserving the chosen map extent across later resizes. Marker circles and labels use the limiting SVG dimension so their visible size stays legible when the SVG letterboxes at desktop or phone aspect ratios.

The Value column uses tabular numerals, a minimum width of 18 characters and no wrapping. Its full original text remains in the same cell, and the existing table wrapper provides horizontal scrolling at narrow widths. Exports and embedded study data are unchanged.

## Apply to the retained standalone reader

Run the existing native receiving helper with the exact source hash and write a distinct output file:

```sh
python -B repair_nine_study_review.py \
  --input ORIGINAL/Upper_Savannah_Nine_Study_Review_20261013.html \
  --output OUTPUT/Upper_Savannah_Nine_Study_Review_20261013-responsive-saved-view-repaired.html \
  --expected-sha256 baec49821d4234f8e241c20c52612d903af4533ab02a9b504d7a05ee772608d3
```

The adjacent `saved-view-replacements.json` contains each complete old/new text pair and its exact UTF-8 preimage and postimage SHA-256. The helper verifies the pinned source HTML, every pair hash, the final reader hash and the embedded gzip payload. It accepts only the exact original or exact completed repair and refuses to replace a different output. It writes a separate reader and a JSON receipt. It does not rebuild native studies or modify the original archive.

The generator pathname inside the original archive remains unavailable from the readable archive surface; this source update therefore repairs the verified standalone HTML directly.

## Focused receiving evidence

The exact repaired standalone was opened in fresh headless Chrome contexts. Normal saved-view reopen preserved its UTF-8 notes and manual extent. A delayed file read did not replace newer notes, source and row filters or selected study; of two overlapping reads, the newer file won after the older read finished last. The manual viewBox stayed identical through desktop-to-390-to-desktop resizing, while a selected station marker remained 12 CSS px across all three sizes.

The selected 29-gauge table kept full numeric values on one line; at 390 px its horizontal scroll remained inside the table wrapper, and the Complete original record control opened the full source record. Desktop and phone captures were opened and inspected. The final standalone HTML is `42375ba33a06ffd873cfc47943e4927a7105849b316067cd98669b6020a5102e` (`8596212` bytes); its embedded study payload is byte-identical to the pinned original.
