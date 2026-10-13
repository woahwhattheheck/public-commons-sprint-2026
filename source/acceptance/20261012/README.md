# Upstate Forever: original RFP acceptance sources

This folder supplies the issuer requirements and source context for the existing Upstate Workspace customer-review workflow.

## Contents

- `official-rfp.pdf`: the original 18-page issuer PDF, 7,470,549 bytes, SHA256 `04313cdda0b19f98b4081ef1eeec2f52707437759f9058f8d0e5abc8d83d6dbf`.
- `acceptance-profile.json`: seven original map IDs, 33 source-linked requirements, input data, output formats, grid, schedule, budget, proposal sections, roles and scientific decisions.
- `review-requirements.json`: the corresponding `{id,title,detail}` requirements for `reviews.create_review`.
- `community-context.csv`: all 17 block-group records from PDF page 16, preserving the original household poverty percentages and distinct demographic measures.
- `sources.json`: the original `upstate.sources/v1` intake manifest, with only paths relative to this directory.

## Intake and review

Materialize this complete directory in the same native lifetime as the existing Workspace. Import `sources.json` with `Workspace.import_sources`, retain the actual returned source collection ID, then pass that ID and the list in `review-requirements.json` to the existing `reviews.create_review` selection. The original review model owns packet creation, decisions and archive receiving.

The data carrier separately records the original shared source locator. Copy and hashcheck that PDF into this directory before import. The importer correctly rejects absolute and parent-traversal paths in its manifest.

## Reading the source

Pages 1–3 were read from the original rendered images because their OCR is blank and the native text layer contains only headings. PDF page 16 has a reliable native text table; the aggregate OCR misreads some values, including its total population. The retained 17 rows sum to 27,448 and contain 10 block groups below the stated South Carolina median household income of $72,350.

The profile distinguishes issuer requirements, issuer process and engineering acceptance. Scientific decisions capture implementation choices for the model and delivery owners: exact basin and source-water coverage, exterior buffer, model and regional coefficients, scenarios, projected 30 metre grid, protected-water designation data, combined-export presentation, sampling interpretation, and geospatial receiving formats.

The RFP's specific final delivery date is November 1, 2027. Its overview also describes completion in November 2027. The proposed project ceiling is an inclusive $50,000; the profile leaves the proposed fee unset. The proposal receipt deadline is November 6, 2026 at 5 p.m. Eastern Time; the recorded UTC equivalent is derived from America/New_York.

## Source identity

Issuer URL: https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf

The separate retained Library representation `libfile_a060a78b1eec8191aab8d7b2252a4750` is reported as 7,504,118 bytes. That identity is recorded separately from the exact 7,470,549-byte native source used here. The native source identity above is the edition used by this scientific application.
