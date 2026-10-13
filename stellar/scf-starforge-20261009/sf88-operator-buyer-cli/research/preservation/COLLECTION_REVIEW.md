# Portable collection review

This is the complete offline review of an existing original-file accession in the preservation Workbench. It carries the institution’s original inventory, settings, every complete saved review through the selected base, current review decisions and any unfinished file-editor text. A recipient can edit the complete collection description and selection, save an editable HTML or working JSON, reopen it and return it to the original accession.

The original file contents stay in the retained Workbench workspace and its BagIt transfer. The working file contains every original path, size and SHA-256, including original directories; it does not contain the binary originals. Use **Export complete workspace** for the full application, original files and saved state.

## Prepare the working file

Open **Collections**, choose the retained accession and make any local edits. **Download editable working HTML** produces one self-contained browser application. **Download complete working JSON** produces the same complete working state without repeating the editor source. Both include an unfinished file edit literally, including metadata text that is not yet valid JSON. Downloading never saves or changes the native accession.

The source selection uses the exact saved revision and review SHA-256 underlying the tab draft. If the native accession advanced elsewhere, the working file retains its original base and complete history through that base. Later native history is checked during return; it is not silently substituted for the base.

The selected source is read under the original accession lock. All original inventory and review history validation uses collection_accession.py. Each complete source and working file has a SHA-256, and each original inventory and saved review retains its own original hash. These identities detect changes; they are not signatures or evidence of review approval.

## Work offline

Open the saved HTML in an existing current browser. No network connection or repository credential is used. The browser must provide its normal SHA-256 cryptography for local files. If it cannot, the file remains intact and the editor reports the unsupported capability.

The table exposes every original file in pages of fifty. Search complete original paths, show included/excluded files or files without recorded rights, and open **Review** for the full original byte identity. Edit inclusion, complete Dublin Core arrays and the reason for the decision. Rights and preservation suitability are operator statements, never inferred.

**Apply file decision to working draft** validates complete Dublin Core names, up to 100 text values per field, the original path and the required reason for metadata edits or exclusions. A supplied title cannot be empty. **Use original file defaults** removes that draft decision explicitly. Saved original history remains intact. **Discard unfinished edit** returns to the current draft decision.

The review note belongs to the whole draft. Download complete working HTML or JSON at any point, including with an unfinished file edit. The browser retains a best-effort tab recovery copy of the draft and raw editor; a quota or storage failure is visible. A reopened saved file remains authoritative until the operator chooses **Restore retained tab draft**. Different tabs retain separate session drafts.

Opening another working file validates it completely before replacing the current view. If changes exist, the editor asks before replacement and tells the operator to download them. Download requests are not proof that the browser wrote a file successfully: open the actual saved HTML or select the saved JSON using **Open selected working file**, then inspect its source, draft and unfinished editor. Retain each needed edition as its own file.

## Return to the original Workbench

Finish or discard any unfinished file edit before returning decisions. Under **Collections**, select the original accession. Choose the complete working HTML/JSON using **Complete working HTML/JSON or original review JSON**, then **Review imported working file**.

The Workbench reads embedded JSON from HTML as data; it never executes a returned HTML script. The returned source must match the actual accession ID, settings and inventory, and every saved review in its base must be an exact prefix of the current original history. A foreign, modified or incomplete source is refused. The complete original working file remains selected and available to retain.

The existing comparison shows each complete **saved**, **local draft** and **imported** file decision and the whole review note. A missing decision means original defaults. Select values explicitly, one whole record at a time, or use a labelled whole-column choice. The local draft remains intact until **Apply reviewed choices to draft**; canceling preserves it. Editing is locked while comparison choices are prepared, and Apply checks the original accession and draft again.

**Save complete review** uses the original revision precondition and appends the original native review history. A concurrent save is reported; keep the local draft and returned file and compare again. No automatic provider operation, BagIt build or destination submission occurs. Later BagIt and whole workspace exports use the existing original controls.

Decisions-only review JSON remains supported with its original 4 MiB metadata limit. It lacks the full working source; use the working HTML/JSON for portable source/history validation and unfinished-edit custody.

## Complete size boundaries

The original inventory and each valid review retain their 4 MiB profiles, 10,000-file inventory and original 64 MiB/member, 2 GiB total binary limits. Portable complete source and working JSON are bounded at 64 MiB; a self-contained HTML is bounded at 128 MiB. Every selected saved revision remains included. If complete history exceeds this boundary, export the full native workspace; no history is dropped to fit. Original server request limits and provider operations are unchanged.

## Read-only source and installation

GET /api/accession-review-source?id=ACCESSION reads the current complete source. Optional revision and reviewSha256 select one exact original base and its complete preceding history. Unknown/mismatched selections fail. This route does not create a review, job or accession.

The same original source can be exported with the installed Python:

    python3 -B research/preservation/collection_review.py \
      --accession /existing/workspace.operator/accessions/ACCESSION \
      --output /separate/review-source.json

The command publishes create-only outside the accession and reuses only identical existing output. Source JSON is an input for the installed renderer, not a working draft by itself.

The complete optional source group is collection_review.py, collection_review.js, this guide and receiving/collection_review_receive.mjs. The managed Applications binding and full application/workspace snapshot require the entire group whenever present. Old snapshots without the group remain supported by their original complete source. Installed workbench.html loads this maintained renderer before the original collection panel.

## Original-case receiving

Use the existing Node 22 or later, Python 3.11 or later, Chromium and Playwright installation. This manual programme extends the existing completed original-file accession case. It does not initialize another collection, repeat donor169, connect a destination or invent institutional decisions.

    node research/preservation/receiving/collection_review_receive.mjs \
      --application /existing/selected-sdk \
      --operation /original/collection-operation \
      --review /actual/operator-selected-following-review.json \
      --browser /existing/chromium \
      --playwright-module /existing/node_modules/playwright/index.mjs \
      --python /existing/python3

The original operation must already contain its collection accession COMPLETE.json and retained workspace. The supplied review is the actual following operator choice bound to that exact inventory. The course records current complete source bytes, base review and the supplied review before any edit. It uses the original inherited browser guard and a portable-review subdirectory; no second controller is started over a live predecessor.

It downloads the actual working HTML, opens it independently, retains an unfinished selected edit, saves and reopens that full buffer, applies all selected original decisions through the offline controls, saves and reopens full working JSON/HTML, returns through the existing explicit native comparison and saves one original revision. It verifies the actual complete inventory/history and selected output, exports the complete workspace, receives it through the original Python receiver and opens the copied application. Original request/source/output identity, uncertain saves and exports are reconciled before continuation; source changes require an explicit new source selection at a completed boundary.

A completed automated run is not visual acceptance. The producing operator must OPEN and LOOK at the exact desktop and 390-pixel screens, loading/error states, full file editor and conflict choices; operate important controls; download and open the actual HTML/JSON and complete archive; then reopen the copied application. The result retains actual screenshots and marks producer LOOK pending until those exact outputs are inspected. Preserve all source, selected original case, full outputs and any failed attempt before the producing host exits.
