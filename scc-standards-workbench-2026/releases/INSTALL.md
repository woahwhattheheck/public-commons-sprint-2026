# Install the standards workbench 0.1.1

This release contains the complete local application, browser assets, original public source files, bilingual drafting example and separate authored operator exercise. Version 0.1.1 improves heading and table pagination in the generated English/French Word documents and PDFs.

## Download and run

Download [scc_standards_workbench-0.1.1-py3-none-any.whl](./scc_standards_workbench-0.1.1-py3-none-any.whl). Python 3.10 or newer is required. Install it into the Python environment in which you want to run the application:

```sh
python -m pip install ./scc_standards_workbench-0.1.1-py3-none-any.whl
standards-workbench --workspace ./standards-workspace --demo
```

Open the local address printed by the command, normally `http://127.0.0.1:8773`. Keep the command running while you work. Stop it with Ctrl+C and use the same workspace path to resume.

The wheel declares `python-docx==1.2.0` and `reportlab==4.4.9`. Pip installs those document-generation dependencies. The wheel does not contain a Python runtime. For an offline installation, supply this wheel and the dependency wheels through pip's `--no-index --find-links` options.

## Choose the right working project

The default public example retains ten paired English/French clauses, eight source-bound cases and seventeen input files. The original Statistics Canada CSV bytes remain cp1252; the separately identified UTF-8 derivatives are included too. The municipal-change counts describe affected Census populations and retain their original vintages.

For an empty working project, omit `--demo` and choose **New project**. To open the separate authored operator exercise:

```sh
standards-workbench --workspace ./standards-workspace --authored-demo
```

Its example committee, agreement and remittance inputs are explicitly authored. It initially contains no recorded vote, accepted report, invoice or collected payment. The two examples have stable, distinct project IDs. Opening an example again resumes the retained project and preserves its edits.

The application supports clause and table authoring, original-file intake and field mapping, language review, frozen editions, edition-bound consultation and ballots, procedural review, publication, communication records, phase reports, invoicing and payment allocation. Its selected procedure records preserve the distinctions between TS, PAS, WA, CSG and the separate ordinary DGSI profiles. Selecting a profile does not establish a standards body's elected accreditation edition or approval.

## Upgrade an existing workspace

Stop its running application, retain a private project export, install the new wheel in the same Python environment, and restart with the same `--workspace` path. The application resumes the existing project. Keep the export available for independent restoration.

## Retain and reopen a project

The workspace directory holds its SQLite database and original file custody. The CLI can list projects and produce a complete private project archive:

```sh
standards-workbench --workspace ./standards-workspace --list
standards-workbench --workspace ./standards-workspace --export PROJECT_ID --output project-private.zip
standards-workbench --workspace ./restored-workspace --restore project-private.zip --list
```

Use the actual project ID shown by `--list`. Private archives carry the original files, full project state and history. The application's publication export is a separate content projection: it includes only the explicitly public sources and their bound case rows. Select the recipient-appropriate export when sharing work.

See the [complete operating guide](../README.md), [API guide](../API.md) and [publication guide](../PUBLICATION.md) for the native workflow and exact record semantics.

## Completed installation and publication work

On 12 October 2026 at 03:21 UTC, this 0.1.1 wheel was built from the exact selected source archive and installed into a fresh target. Its installed command completed successfully. All thirty-three packaged application and public-source files matched the selected bytes, and all thirty-nine wheel members were retained. The installed runtime reports workbench 0.1.1, python-docx 1.2.0 and ReportLab 4.4.9.

The earlier 0.1.0 installation also created and reopened the public example through its installed CLI: seventeen original files, ten paired clauses, eight cases and CAD 0.00 collected. The source data remains in this 0.1.1 package. The existing authored browser workflow and private-archive continuation use their original saved project and remain separately tracked.

The corrected publisher generated all twenty-eight standard, comparison and management files from the retained editions. Its nonpresentation JSON and CSV files match the preceding edition outputs exactly. The four Word documents and four PDFs rendered to eighty-one page images. All eighty-one pages were visually inspected at their original resolution, including an independent review of the French editions; no material layout defect remained.

## Exact release files

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `scc_standards_workbench-0.1.1-py3-none-any.whl` | 277,220 | `8dc0fb9ecca6dfe4cd2699953e5dfecbae1b123b4e6f02d12a6872bd60bf901e` |
| `scc_standards_workbench-0.1.1-source.zip` | 274,907 | `3e5e100c47e9cbb7dd8302485a8e34f5bc4e812e1f8040363a9457068a70d101` |

[Download the matching source archive](./scc_standards_workbench-0.1.1-source.zip). Its `SOURCE_RELEASE.json` records each selected file's size, SHA-256 and Git blob identity.

The original [0.1.0 installer and installation record](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/acae3d237cde20602b73d39d334bdab5cd12c9df/scc-standards-workbench-2026/releases/INSTALL.md) remain available at their immutable release.
