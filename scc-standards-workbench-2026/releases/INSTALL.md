# Install the standards workbench

This wheel is built from the complete public source release at commit `4b8a1b8f9e7c0ea7e41155ced87bef3bf00fab6f`. It includes the local application, browser assets, original public source files, bilingual drafting example and the authored operator exercise.

## Download and run

Download [scc_standards_workbench-0.1.0-py3-none-any.whl](./scc_standards_workbench-0.1.0-py3-none-any.whl). Python 3.10 or newer is required. Install it into the Python environment in which you want to run the application:

```sh
python -m pip install ./scc_standards_workbench-0.1.0-py3-none-any.whl
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

## Retain and reopen a project

The workspace directory holds its SQLite database and original file custody. The CLI can list projects and produce a complete private project archive:

```sh
standards-workbench --workspace ./standards-workspace --list
standards-workbench --workspace ./standards-workspace --export PROJECT_ID --output project-private.zip
standards-workbench --workspace ./restored-workspace --restore project-private.zip --list
```

Use the actual project ID shown by `--list`. Private archives carry the original files, full project state and history. The application's publication export is a separate content projection: it includes only the explicitly public sources and their bound case rows. Select the recipient-appropriate export when sharing work.

See the [complete operating guide](../README.md), [API guide](../API.md) and [publication guide](../PUBLICATION.md) for the native workflow and exact record semantics.

## Completed installation and current execution status

On 12 October 2026 at 01:35 UTC, the wheel was built from the exact published source archive, installed into a fresh target directory, and opened through its installed CLI. The installed public project was revision 1 with seventeen original files, ten clauses, eight cases and CAD 0.00 collected. All seventeen retained original files matched their recorded sizes and SHA-256 values. The installed runtime resolved python-docx 1.2.0 and ReportLab 4.4.9.

The wheel contains thirty-nine package members. Its source archive contains thirty-six entries, including the selected-source manifest. These installation results do not describe a grant award, committee decision, customer payment or a live production deployment.

The full authored browser workflow and its subsequent private-archive restore are continuing as a separate, retained operation. The publisher has generated its fixed English/French DOCX, PDF and HTML standards, comparison and management documents; final page rendering and visual review are continuing. This release records completed installation without marking those remaining operations complete.

## Exact release files

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `scc_standards_workbench-0.1.0-py3-none-any.whl` | 275,954 | `9fc3fa51180dd437a83725714772463e2def9c1763ab9b240bc6d481e8bfa1ed` |
| `scc_standards_workbench-0.1.0-source.zip` | 273,760 | `f3b6d92c3d514af79b6e4d5c0f2745c24dfbe3341620f65dc6cbbc9a96495747` |

[Download the original source archive](https://github.com/woahwhattheheck/public-commons-sprint-2026/raw/4b8a1b8f9e7c0ea7e41155ced87bef3bf00fab6f/scc-standards-workbench-2026/releases/scc_standards_workbench-0.1.0-source.zip). Its manifest and original release documentation remain unchanged.
