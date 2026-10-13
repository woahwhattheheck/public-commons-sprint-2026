# Receive complete Ecosystem Sciences source

The receiver reconstructs the exact complete Git edition named in a SHA-256-verified source-selection bundle. The repository is `woahwhattheheck/public-commons-sprint-2026` and the project prefix is `opportunities/upstate_forever_2026`. Each selection retains the full 40-character commit and project-tree identities, original file count and byte count, plus any explicitly ordered source components.

Revision 3.1 uses that immutable selection throughout Git fetching, tree inspection, archive extraction, native installation and resume. It never resolves a moving branch name. The receiving owner publishes a new exact selection and its SHA-256 when the accepted source edition changes.

## Complete receiving

Use the actual GIS Python interpreter and the exact source-selection path and SHA-256 published for the accepted demonstration edition:

```bash
python -B source_tools/receive_ecoscience_source.py \
  --bundle /absolute/published-source-selection.json \
  --bundle-sha256 FULL_PUBLISHED_SHA256 \
  --output /absolute/ecosystem-current-operation \
  --install
```

The receiver uses an isolated operation-owned Git repository by default. It fetches the selected commit, hydrates the project through sparse checkout, and reads the complete Git object inventory. If an equipped worker already has that commit and every project blob, add `--checkout /absolute/existing/repository`. The supplied checkout is read without changing its working tree, index or references.

Omit `--install` or add `--prepare-only` to reconstruct source. The receiving owner runs the single full installation. Scientific execution continues through the accepted demonstration operation after receiving.

The selection uses schema `upstate.ecoscience-receiving-source/v1`. Its `base` object contains exactly `repository`, `commit`, `prefix`, `git_subtree`, `files` and `declared_bytes`. Commit and tree must be full lowercase Git identities; counts must be positive integers. `components: []` selects an already-integrated Git application. Each optional ordered component retains its complete UTF-8 file bodies and exact per-file byte counts and SHA-256 hashes.

## Retained operation and interruption recovery

The operation retains:

- `canonical-source/`: the complete unchanged selected Git project.
- `prepared-source/`: composed source, identical to canonical source when no overlays are selected.
- `application/` and `application.zip`: output of the maintained cumulative installer.
- `ASSEMBLY.json`, exact inventories and command logs: the original resumable operation.
- `previous-attempts/`: preserved partial installation outputs when that failed operation is resumed.

Every original path, Git blob identity, size and executable status comes from the selected tree. Extraction checks the complete incoming content against Git's blob identity, handles short writes, flushes and synchronizes each file, and independently verifies the actual on-disk canonical inventory before promotion. Retained JSON writes are likewise flushed, synchronized and read back before replacement. The prepared tree is checked against the canonical inventory and exact overlays before promotion.

Source and installed inventories retain executable status and verify it again on resume. An explicit text overlay may select regular Git mode `100644` or `100755`; otherwise it preserves an existing path's mode or uses non-executable mode for a new file.

The maintained installer runs with `-B` and `PYTHONDONTWRITEBYTECODE=1`. It receives untouched canonical source through `--scientific-source`. An explicit scientific source override is inventoried and checked again after installation. Direct owned child processes inherit the same operation lock file descriptor, so a surviving installer prevents a second receiver from moving its active output after parent interruption.

Repeat the identical command to resume. The source-selection hash, exact base tuple and original operation receipt bind the output to that edition. Completed application and archive content are verified before reuse.

## Audited source-selection example

`integration/ecoscience-source-2a2bb5b6.json` retains the audited source edition at commit `2a2bb5b63139e9a64637e64bac76b684ac4e676a`, tree `fd2d723d8d447c16f56f11a43541505101257543`: 4,099 original blobs, 332,168,721 bytes, 4,093 non-executable files and six executable files. The selection is 329 UTF-8 bytes, SHA-256 `f446c68861c1212f97293c54aa3b4840efe9282e8dd3cd0c2c39a26cd9bb37fa`, with an empty components array.

That file preserves the audited source example. The accepted demonstration continuation uses the newly issued selection containing its runner correction and current receiving additions. The original revision-2 receiver and b395 operation remain separately reproducible.

## Demonstration continuation

Use the installed application with the accepted simulated-input study and its retained native run identities. The maintained importer, NDR/SDR execution, comparisons, maps, report, export and save/reopen workflow remain the original application operations. The completed-output Programme adopter can consume their retained receiving record. Coordinate the single simulation through its existing owner and preserve the Ecosystem sprint artifact at October 13, 2026, 14:00 UTC.
