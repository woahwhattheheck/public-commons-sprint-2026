# IANZ Ara Hono application integration

Original operation: IANZ-33593043-ARAHONO-WORKSHARE-94FE-20261012.
This application joins the existing Voco workshare. Public source transcriptions and contracts remain byte-for-byte original in source-register.json, data/ and contracts/.
These are source observations, not client exports. Customer correspondence, pricing correspondence, private submitted records, credentials and account bindings belong in the private receiving workspace.

## Ownership and interfaces

The application coordinator owns workspace.py, schema.py, mapping.py, server.py, cli.py, seed.py and web/. The documents engine owns documents.py and DOCUMENTS.md. The billing engine owns billing.py and BILLING.md. A single branch integrates complete source leaves.

All engines use Python's standard library and have no storage or network side effects. Workspace retains original bytes under file_id = "sha256:" + actual SHA-256, and immutable typed record editions under the exact contracts/data-contract.json key. File downloads expose those retained bytes. Every mutation has an original request ID, fingerprint, expected revision, operator and reason; exact retry returns its accepted result.

Documents engine:
- inspect_document(content: bytes, *, filename: str, media_type: str) -> JSON dict: kind, bytes, sha256, parts, controls, tables, paragraphs, edition_markers, relationships, warnings.
- render_docx(template: bytes, mappings: list[dict], records: dict) -> dict: content (bytes), inspection (dict), applied (list), unresolved (list). Map received native control paths or exact table cells to explicit entity/key/field bindings. Keep untouched XML and package members.
- compare_documents(expected: list[dict], returned: list[dict]) -> dict: differences, summary. Rows carry document_key, document_edition_id, sha256, bytes, access_class, associations, native_id, file_id.
- DocumentError derives from ValueError. Reject malformed, oversized, encrypted or unsafe packages without discarding the original stored asset.

Root owns the eight shared views: Sources; Accounts and sites; Accreditations and scope; Assessments and documents; Billing; Target mapping; Receiving; Handover. Browser code uses semantic tables and forms, grayscale industrial styling, keyboard access and responsive stacked detail panels.

## Original source boundaries

Sources S21-S26 are linked DOCX originals; their complete file acquisition belongs to 94FE's IANZ-A1 request. The current original scope cohort is 826 issue 23, 791 issue 53 and 157 issue 8. Older indexed observations have only declared field coverage. Original source bytes and transcription bytes have separate hashes. Label changes never silently merge legal entities. Tariff quantities authored by operators stay identified as authored, separate from received customer invoice quantities.

Target native tables, keys, finance policy and returned contract come from an explicitly received target profile. The default mapping is canonical staging and does not name an unobserved customer product or environment. Local receiving exercises use their own named local target.

## Delivery

Retain original source files, canonical rows, edit history, mapping versions, original requests, native receipts, returned extracts, difference decisions, attachments and guides in one editable handover. Reopen in a clean instance and continue the same project. No automated Actions workflow is introduced.
