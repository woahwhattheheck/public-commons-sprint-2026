# Source and dependency notices

## Authored application

The application source, selected procedure summaries, proposed clause text, worked-case questions and executable workflow are authored material under the included MIT license. Source-linked examples remain proposals for review. They do not claim standards-body approval, certification, an appointed committee, an executed contract or actual revenue.

The application reuses the original Commons NEKCV source-intake parser unchanged as `source_intake.py`. Original parser SHA256:

`ba4de76acc4867e0a5f17dd1bfedb6d9e9ab48e2a71216d4cfc9df113e9b6684`

Original repository path: `opportunities/nekcv_data_warehouse_2026/operator/intake.py`. Its CSV/JSON/XLSX identity, header, null/cell annotation and source-locator behavior is retained. The SQLite compare-and-swap, durable request, archive and restore envelope develops the original Commons PLAN/NEKCV application pattern.

## Statistics Canada / Statistique Canada

The public annex retains original source bytes for the 2025 Interim List of Changes to Municipal Boundaries, Status, and Names; its record layout and change-code documentation; the related boundary-file guide; and the publisher's open-licence page.

- English overview: https://www150.statcan.gc.ca/n1/pub/92f0009x/92f0009x2025001-eng.htm
- French overview: https://www150.statcan.gc.ca/n1/pub/92f0009x/92f0009x2025001-fra.htm
- Open Licence: https://www.statcan.gc.ca/en/terms-conditions/open-licence

The packaged `demo/source-manifest.json` identifies the exact source URL, retrieved response, digest, byte count, publisher and licence for each original. Statistics Canada material is used under its Open Licence. This application and its interpretations are not endorsed by Statistics Canada.

The two original CSV files retain cp1252 bytes. Each separately named UTF-8 derivative records its input digest, explicit decoder and byte-for-byte round-trip equality; no CSV row, quote, delimiter or cell is rewritten. The complete fifteen-column EN/FR identity/count/date correspondence is retained in the annex.

Source population-affected fields are tied to the Census vintage described by the publisher. Municipality-change dates, geographic boundaries and population vintage are separate. The authored Amos example's two-to-one relationship and affected counts are not a new annual population estimate.

The eight case narratives, questions and expected observations are authored interpretations of the cited rows, not observed committee decisions or validation by the source publisher. English and French source cells remain unmodified.

## Standards procedures and adjacent work

The package includes authored summaries and source URLs, not copies of restricted SCC or DGSI procedure PDFs.

- SCC technical specifications: https://scc-ccn.ca/standards/flexible-standards-based-solutions/national-technical-specification
- SCC workshop agreements: https://scc-ccn.ca/standards/flexible-standards-based-solutions/workshop-agreement
- SCC community-sourced guidance: https://scc-ccn.ca/standards/flexible-standards-based-solutions/community-sourced-guidance
- SCC national PAS guidance,2021: https://scc-ccn.ca/system/files/2024-05/sirb_rg_national-pas-guidelines_v1_2021-07-20.pdf
- DGSI directives,Edition7: https://dgc-cgn.org/download/24585/?tmstv=1717529426
- SCC SDO accreditation,v6,2025: https://scc-ccn.ca/system/files/2025-04/scc_rg_sdo-accreditation_v6_2025-03-06.pdf
- SCC transition bulletin: https://scc-ccn.ca/accreditation/bulletins/update-standards-development-organizations-accreditation-program
- DGC published work programme: https://dgc-cgn.org/digital-standards/work-program/

The selected accreditation basis and unresolved ballot-denominator interpretations remain explicit. The summaries do not establish an actual DGC election under the transition.

The eighteen adjacent-work records retain the published September2–October1,2026 programme period and original source locators. Existing work is not represented as our new standards proposal.

## Publication dependencies and fonts

The document publisher uses `python-docx 1.2.0` for editable WordprocessingML and `reportlab 4.4.9` for PDFs. These dependencies are declared in the package metadata. Their own distribution licences remain applicable.

PDFs use the Bitstream Vera fonts supplied with ReportLab, or the explicitly packaged same-font template location if present. The font licence shipped with ReportLab is retained at its original distribution location and referenced by the publisher; it is not replaced with a new font licence. No remote font or document-rendering service is called at runtime.

## Excluded research and business material

The installer contains the public application, open-licensed sources and plainly authored examples. It excludes restricted procedural originals, prime-contact research, private coordination, correspondence and the separately prepared application/workshare proposal. A complete private project archive is a different artifact from a public installer or selected edition handover.
