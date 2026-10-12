# Research template exchange

This module exchanges a client's XLSX, CSV or TSV template with an immutable Research extraction publication. It keeps the whole original workbook, maps exact published result editions to reviewed cells, releases a workbook, retains a complete client return, and creates a draft in the original assigned-reviewer extraction workflow.

The module uses the existing dossier history, content-addressed blobs, revisions, scientific values, reviewer assignments and portable export. It adds no database, service account, mail sender, replacement adjudicator or clinical source capture.

## Open workbook exchange

Start the existing Research workspace with its normal launch command and open the complete local workspace address. Select a saved dossier, then choose **Workbook exchange** in its header. The workbook page keeps that dossier and the current Research session selected. Use **Back to Research** to return to the original study extraction workspace.

The installed `research-template-exchange` command and exported template client operate on this same dossier. The original NCT receiving programme exercises the full workbook journey alongside independent appraisal, portable reopening and recurring customer delivery.

## Operator workflow

1. Open the existing dossier's **Template exchange** view. Retain the complete client file with a name and reason. Native sheet names, formulas, styles, merged cells, hidden sheets, package media and values appear in its inspection.
2. Select the exact frozen publication. Map each intended cell to a result ID, result edition, field and component, or an explicit pointer in the complete published result record. The default output is exact text. Choose number or boolean only when that is the required client contract.
3. Designate an original result-ID column if complete rows may move. One result ID may occupy only one row of that sheet/identity column; multiple field bindings on that row are allowed. Fixed-position templates remain supported with explicit correction review.
4. Review the mapping and release. Historical or superseded publications and native source/review changes after publication require explicit acknowledgement. Only selected cells and the original result-ID cells change.
5. Retain the actual returned file against the exact release. The comparison shows moved identities, changed mapped cells, missing/ambiguous identities, unmapped cell edits, formula changes and every changed native package part.
6. Decide every changed mapped value: keep the release, retain it as client-only, or propose an original extraction correction. Add a reason. A correction to a fixed cell requires explicit confirmation of its identity.
7. The actual assigned reviewer prepares and accepts a complete original extraction draft. Proposed client values are marked uncertain and retain the original source bases and the exact return/cell/review identity. Submission, independent review and resolution remain the original workflow.
8. If the client layout or notes will be reused, adopt the whole returned file as the next template edition. A new explicit mapping is required. A stale earlier mapping cannot overwrite a later client edition.

Use the existing Research Export/Receive workflow to transfer the complete dossier. It carries templates, releases, returned workbooks, mapping proofs, review decisions, original extraction requests and every historical revision.

## Native file behavior

- XLSX uses the original Office Open XML package. Unrelated part bytes and original worksheet markup outside changed cells remain intact. Existing formulas are preserved; mapping onto a formula, protected target, merged child or array-formula region is rejected.
- Macros and signed workbooks are not altered. External workbook relationships are retained as bytes without fetching their targets.
- Clinical number strings remain exact text by default. Explicit Excel-number output validates the numerical range and significant digits before writing, so a long decimal is not silently rounded.
- Missing values, reported NA, status, comments, denominator scopes and source pointers remain separate original fields. No value is inferred from a formatted blank.
- The service does not evaluate formulas. An XLSX release with formulas requests native recalculation on opening; the calculation report says so. It never reports an unperformed calculation as a result.
- UTF-8 CSV/TSV preserves its BOM, selected delimiter and newline convention. A text value beginning with a formula prefix is escaped as literal text and that transformation is recorded. CSV has no styles, embedded objects or native formulas.
- Complete incoming and outgoing files remain available by their exact SHA256. A client's workbook application may rewrite package parts; the return comparison retains and reports that original file rather than assuming byte-stable reserialization.

Native limits are 32 MiB per workbook, 128 MiB expanded XLSX parts, 500,000 populated cells and 20,000 reviewed cell bindings. The original dossier's total source/portable limits still apply. These are explicit admission limits, not truncated output.

## Runtime

The customer module needs the existing Node Research application and Python 3's standard library. No spreadsheet package or office application is required to retain, inspect, map, release or compare client files.

The separate native commissioning builder uses the already installed Codex primary runtime and @oai/artifact-tool to create and visually inspect an original demonstration layout. It is an authoring tool for the receiving programme, not a new customer runtime dependency.

See INTEGRATION.md for the original factory, validation, HTTP, static and portable joins. See native/RECEIVING.md for the same-store original-study continuation. The CLI mirrors the same selected-dossier API and writes an output only when an existing file is absent or byte-identical.
