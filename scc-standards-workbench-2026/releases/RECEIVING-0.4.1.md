# Standards workbench 0.4.1 — native ballot corrections

This release publishes the generic corrections produced by the original equipped SCC ballot operation. It contains the whole 70-file installable application, including the existing prime-application desk, consultation, publication, original public inputs, operating guides and owner instructions.

## Complete downloads

- [Installable source ZIP](./scc-standards-workbench-0.4.1-source.zip): 496,157 bytes; SHA-256 `309922befdb17a60e0243c9740873ef00da70eb47116b1ac7137b86d01f6e99d`.
- [Lossless source JSON](./scc-standards-workbench-0.4.1-source.json): 2,454,018 bytes; SHA-256 `cdbf29201be7b5ecb20bbd4590c7e1ff979a73b64dd4fb6ee1c16e0a5effc1f7`. Each member includes its complete Base64 body, exact size and SHA-256.
- [Installation, upgrade and restoration](./INSTALL.md).

The ZIP expands to `scc-standards-workbench-0.4.1/` with 1,829,987 source bytes. Its `SOURCE_RELEASE.json` identifies the 69 other members by their Git blob identities. Both original CP1252 Statistics Canada CSVs retain their exact original bytes; their separately named UTF-8 derivatives remain explicit.

## Corrections incorporated

| Source | Result |
| --- | --- |
| `ballot_exchange.py` | The readable decision exporter uses the document bytes directly, avoiding a second encoding call. |
| `consultation.py` | Long headings and source labels wrap in readable HTML. |
| `web/app.js` | Justification, notification evidence and text containing line breaks use multiline controls. The saved source text retains its paragraph boundaries. |
| `web/member-ballot.css` | Member response review tables fit narrow screens and wrap long values. |
| `web/member-ballot.js` | The downloaded readable response uses the same bounded, wrapping presentation. |
| `delivery/ballot-receiving.mjs` | The original course compares retained JSON values, resumes an explicit baseline-linked branch, waits for actual UI rerenders, serves only its own retained files over loopback, and prepares source-specific read-only presentation exports. |

The exact original native correction carrier is `SCC-04-Generic-Source-Corrections-20261013.zip`, 145,211 bytes, SHA-256 `0d69443089e7119633c462e906a18eb7c784d7b42ac06d88d316ced1010659b2`. These six postimages were checked against that carrier and the current public repository preimages. The other application sources and public inputs are retained unchanged; release/version documentation and the source manifest are updated.

## Actual completed ballot operation

The equipped original operation completed under source identity `cd0d5a03baede5b3611b733a1b36fa9d5c81216fc372bbe2df81b91e1589dc39`. Its authored example reached revision 33 with eight returns and eight adoptions, retained the original member vote, closed the original ballot, recorded its procedural review and publication, and independently restored the complete private case.

| Retained record | Exact identity |
| --- | --- |
| Project | `scc-authored-operator-v1` |
| Ballot | `ballot-course-pas-v1` |
| Original member vote | `member-vote-0093e45a75236a127261fee5f560566f` |
| Closure | `ballot-d8bbff6899054673877ade7c6ba061b4` |
| Procedural review | `procedure-0efd53c88e684b258a43521fad400851` |
| Publication | `publication-5858cd97d64b451d89e1d6a729bcdc34` |

These are authored operating-example identities. They do not identify a real committee decision or a submitted applicant package.

The completed native source identity is retained separately from this packaged release: this archive additionally updates its version declarations, README and manifest. Final normal-view inspection of every outgoing Word, PDF, CSV, JSON and archive attachment remains an explicit producing-owner step. The separate prime-application receiving operation retains its own state; the ballot completion does not claim that application course has completed.

## Continue the same receiving operation

Use the original configured `delivery/ballot-receiving.mjs` operation and preserve its selected source, workspace and output. Ordinary restarts retain the same progress and exact request records. If continuing after the earlier closed-ballot failure, use a separate owned workspace/output and the original baseline through the existing `original_baseline_archive`, `original_baseline_sha256` and `continued_from_output` configuration fields, with a reason in `baseline_continuation_note`. The controller checks the baseline bytes and parent's operation before restoration and retains the original branch unchanged.

Read-only presentation exports are written under `presentation/<source-identity>/`. They re-export the actual retained ballot, publication and seven packet identities, verify the unchanged original packet bytes and verify that native project state has not changed. Older output files remain at their original paths.

The browser's file-URL restrictions remain unchanged. The course's private loopback server accepts only files beneath the owned output directory and requires its random route token. Two exact unchanged Statistics Canada HTML hashes with the original unavailable jQuery dependency are classified as source-document warnings; other page errors remain failures. The output retains those warning identities.

Run and inspect the exact outgoing product and all attachments as required by the bundled AGENTS.md and CLAUDE.md. Use the actual desktop/narrow captures and normal recipient views, operate important controls, export and reopen. Preserve complete private continuation archives and use the existing application writers; no additional financial, email or submission action is introduced by this release.

## Verification and publication scope

All 70 source members were decoded and hash-checked; the ZIP was reopened and every member matched the lossless source JSON. The 60 unaffected member bodies remain byte-identical to 0.4.0. This package includes no private applicant data or credentials. Earlier immutable release downloads remain available. GitHub Actions settings and workflow files are unchanged; publication uses the existing disabled-Actions repository state.
