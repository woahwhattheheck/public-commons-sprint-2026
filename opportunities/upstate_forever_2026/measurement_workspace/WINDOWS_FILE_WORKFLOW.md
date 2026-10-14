# Measurements files on the original Windows workbench

This continuation repairs the existing file path from retained scientific input through an explicit saved handover, complete report/CSV/ZIP download and independent reopening. It changes file publication calls. Original scientific values, normalization, selections, IDs, manifests and archived source bodies remain unchanged.

## Use the existing application

Use the existing Windows7256 / whole-workbench6001 launch and its selected populated project. The original operator selects the maintained Node runtime and binds MEASUREMENTS_PYTHON to its actual Python interpreter. This is the same application, native queue and Measurements database. Do not start a second operator or create another store as an installation check. Preserve the original C426 geographic project separately from A555's scientific runs.

The Windows source cohort must include its original model/windows_fs.py implementation. The Python directory helper verifies the exact installed model/windows_fs.py (6,320 bytes / SHA256 5f968b8c7248a8dae36f4a13b1c9edb3c85bca14abc1b1dd5a81c3b4022aae36), loads only that original body in an isolated module and delegates to its sync_directory callable, the same primitive used by model.common._sync_directory. It never resolves an unrelated model package from the Python environment. It does not implement another Win32 API or bypass the platform owner's checks. The Node side uses only the operator's explicit MEASUREMENTS_PYTHON value on Windows; a missing binding returns an actionable error instead of guessing a different interpreter.

Existing POSIX applications retain their ordinary directory fsync. On Windows, the original platform helper validates the directory handle. That is described as directory-handle validation, not directory fsync. All newly written regular files are still flushed on writable handles before publication. Original input readers remain read-only. Existing create-only hard-link publication remains a create-only link; the Windows validation step does not turn that link into a write-through rename or imply a directory-flush guarantee.

## Complete original file journey

1. In the existing Measurements desk, retain the original uploaded file and complete source identity. Reopen its actual preparation, review mappings and choose the intended scientific import. This patch does not select columns or approve source-support assertions for the scientist.
2. Reopen the resulting saved collection or result. The original source IDs, source rows, field meanings, qualifiers and units remain visible. Use the existing explicit complete-handover selection for the desired original collections, saved editions and results.
3. Publish that exact request. Its original request ID and expected workspace revision remain bound. A retry reuses the original request and exact completed bytes; it cannot silently choose a later revision.
4. Download the complete handover ZIP and the individual original file when needed. Both use the original filenames and hashes. No user file is renamed or truncated to fit another source identity.
5. Extract and open the full report/CSV/JSON and original workbook/source files. The complete handover keeps its original editable Measurements project; the same existing receiving route validates every original member before admitting a receiving copy.
6. Reopen the same saved result and retained request. A conflicting destination or changed original member remains a visible error. Existing completed outputs are never replaced with a different body.

For the already selected native CLI boundary, these are the unchanged maintained commands. Use the actual installed Node executable, original database directory, retained request and original IDs supplied by the operator. Run from the application directory; do not substitute example project identities:

    node measurement_workspace/engine/cli.mjs handover-choices --workspace ORIGINAL --output choices.json
    node measurement_workspace/engine/cli.mjs handover-export --workspace ORIGINAL --file retained-request.json --output completion.json
    node measurement_workspace/engine/cli.mjs handover-status --workspace ORIGINAL --id ORIGINAL_HANDOVER_ID
    node measurement_workspace/engine/cli.mjs handover-download --workspace ORIGINAL --id ORIGINAL_HANDOVER_ID --output complete-handover.zip
    node measurement_workspace/engine/cli.mjs handover-inspect --file complete-handover.zip --output complete-source-inspection.json
    node measurement_workspace/engine/cli.mjs handover-read --file complete-handover.zip --selector exact-selector.json --output complete-original

The Chiques report/CSV/bundle CLI uses the same completed-file publisher and no longer reopens a directory as a POSIX FileHandle on Windows. The guided-intake comparison receiving chapter uses the same directory boundary; it retains the original Page/server/database/lifetime lock and never launches a replacement course.

## Exact source changes

- engine/file_platform.mjs and engine/file_platform.py: one shared directory publication boundary. Node calls the original installed Python helper only on Windows; the helper delegates to the maintained application Windows primitive. Missing or mismatched helper results propagate.
- engine/eco_handover.mjs: original handover directories use this shared boundary. Exact existing output is flushed with a writable, non-truncating handle on Windows; POSIX keeps the original read-only flush handle.
- engine/file_product.mjs: successful original create-only publication completes the shared directory boundary.
- engine/chiques_nutrient_cli.mjs: the maintained complete-file publisher owns flushing; remove duplicated read-only file and POSIX directory calls.
- engine/intake-comparison-receiving.mjs: shared directory boundary and writable non-truncating Windows flush on exact existing output, preserving the original POSIX read-only retry.
- engine/handover_archive.py and engine/large_archive.py: flush only their own staged ZIP using r+b. The handover archive uses the shared directory boundary.
- This guide travels with the complete source. The cumulative source owner composes these leaves and their exact predecessor hashes into the existing inventory.

Archive member names use the maintained POSIX relative path representation. The complete project ZIP reader now also rejects colon-bearing member names, including Windows drive-qualified and drive-relative paths such as C:/outside/member and C:member; these cannot be admitted as portable relative members. No separator rewrite, archive format change, scientific recalculation or migration is introduced. Existing exact-byte create-only links and immutable retry comparisons remain in place.

## Real receiving and repair boundary

The source review is not a Windows, Python, Node/SQLite or browser result. Use the SAME original Windows7256/CEDAR/1151/2851/R103D/15227 operation. Return the first actual command, exception and selected source identity to original claim 1791928760.294859; REGIONAL owns this file-path repair. The platform owner retains Win32 locks/identity/write-through semantics, ECO2319 retains whole-project portable/study, and root retains runtime selection, Python bridge and installers.

The producing peer must actually open/run/render the exact outgoing product, LOOK at its rendered screen or real screenshots and operate the important controls. Inspect desktop/screenshare and narrow/mobile widths including 390 px, populated/empty/loading/error states, downloads, exports and independent reopen. Capturing screenshots without looking at them does not count.

ALL ATTACHMENTS count: open/view/play/use each outgoing HTML, PDF, report, spreadsheet, map, archive and project as a recipient. Extract archives, open their complete contents and reopen the working project. Code review, unit checks, DOM counts, HTTP 200, checklists or peer approval do not replace actual product use. Fix clipped, cramped, unstyled or unreadable output before presenting it. Use readable tables, clear hierarchy, consistent spacing/typography and restrained useful controls; retain the real workflow/data/computation.

Current owner direction 2026-10-13.4 applies. Continue the same product and preserve outputs; no expired cutoff, forced restart, new watcher or revival of owner-stopped work. Preserve histories, sender/relationship controls, vendor policy and TokenJunkieLabs attribution. This source continuation remains on the authorized private Slack/Pages route; no private or public Git source publication is requested.
