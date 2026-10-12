# Airport assessment and implementation workbench

A local, editable workspace for airport AI adoption research: original source files → airport and authority context → opportunity and readiness assessments → build/buy/partner/process alternatives → reviewed decisions → implementation and measurement workpapers.

![Public airport context in the workbench](public-overview.png)

## Install and open

Download [airport_assessment_workbench-0.1.0-py3-none-any.whl](airport_assessment_workbench-0.1.0-py3-none-any.whl?raw=true) and save it in a folder you control. The 772,648-byte package contains the application source, browser interface, public reference materials and two separate example projects.

Use Python 3.10 or later with its standard `venv` and `pip` components. The wheel installation needs no additional package downloads. Run these commands from the folder containing the wheel; environment activation and a source checkout are unnecessary.

### Windows — Command Prompt

```bat
py -3 --version
py -3 -m venv airport-env
airport-env\Scripts\python.exe -m pip install --no-index --no-deps airport_assessment_workbench-0.1.0-py3-none-any.whl
airport-env\Scripts\python.exe -m airport_operator --workspace .\airport-workspace --demo --port 8771
```

### macOS / Linux / POSIX

```sh
python3 --version
python3 -m venv airport-env
./airport-env/bin/python -m pip install --no-index --no-deps ./airport_assessment_workbench-0.1.0-py3-none-any.whl
./airport-env/bin/python -m airport_operator --workspace ./airport-workspace --demo --port 8771
```

Open **http://127.0.0.1:8771**. Keep the terminal open during use; press **Ctrl+C** there to stop. Repeat the start command with the same workspace to reopen saved work. The local actor name records the operator's supplied label.

Optional scripts perform the same installation and startup without activation. Save them beside the wheel. The installers check the published wheel SHA-256 before installation; the launchers retain their adjacent workspace even when invoked from another directory.

| Platform | Install | Start |
| --- | --- | --- |
| Windows Command Prompt | [install-windows.cmd](install-windows.cmd) | [start-windows.cmd](start-windows.cmd) |
| POSIX shell | `sh` [install-posix.sh](install-posix.sh) | `sh` [start-posix.sh](start-posix.sh) |

To load the separate calculator and decision example, stop the server and replace `--demo` with `--authored-demo` in the start command. The public context project contains published FAA and airport material; the authored planning project supplies editable example costs, capacity and observations. Existing saved example edits are preserved.

The standalone [installation and restore instructions](INSTALL_AND_RESTORE.txt) are convenient to keep beside the wheel. The [complete operator guide](OPERATOR_GUIDE.md) covers the full research workflow, input mapping, calculations, recipient exports, private recovery and existing API.

### Save and restore a working project

A selected recipient handover and a complete `private_restore` archive serve different purposes. Use **Export & history** to save each project's full private continuation, including original bytes and revision history. Restore into a new workspace to preserve any different current work.

Windows:

```bat
airport-env\Scripts\python.exe -m airport_operator --workspace .\recovered-airport-workspace --restore .\airport-continuation.zip --port 8771
```

POSIX:

```sh
./airport-env/bin/python -m airport_operator --workspace ./recovered-airport-workspace --restore ./airport-continuation.zip --port 8771
```

The restore command imports the archive and then opens the server. For subsequent starts, keep that recovered workspace path and omit `--restore` and its filename. A selected original workbook remains the complete original file; choosing an airport audience does not filter rows inside that attachment.

## Work through an assessment

- Retain original CSV, JSON, XLSX and reference documents with source metadata. Preview the actual columns and select explicit field mappings or the FAA enplanement mapping.
- Keep airport owners, operators and decision authority distinct. Connect each use case with source-backed readiness, risk and responsibility workpapers.
- Compare delivery alternatives using explicit cost periods, currency, discount assumptions, preference criteria and shared allocations.
- Save a decision together with its complete reviewed inputs. Subsequent source or workpaper changes leave the original decision available for comparison and later review.
- Plan dependencies, period-specific staff capacity, maintenance and exit responsibilities across the project.
- Measure count, mean or rate using declared cohorts, observation windows, eligibility and exclusions.
- Export editable project, airport or use-case reports and an implementation memorandum. Choose original attachments explicitly for each recipient.
- Export a complete private continuation archive and restore it into a fresh local workspace to continue editing.

The application uses the Python standard library and SQLite. It runs on loopback with local-origin checks; the operator controls its workspace and original files. See the [operator guide](OPERATOR_GUIDE.md) for complete import, calculation, export, recovery and API instructions.

## Sources and scope

The included FAA CY2025 workbook retains **1,676 airport rows**, six publisher footer rows and one blank source row. The public project selects **DEN, SYR and HPN**, with four distinct published owner/operator records. Sixteen reference entries plus their source manifest make seventeen retained originals.

The project follows the interactive-tool direction of [ACRP 03-88](https://rip.trb.org/View/2772553). Published traffic and governance context remain distinct from authored planning inputs and from locally supplied airport observations. Participating research teams provide their own methods, airport findings, judgments and research personnel.

## Package identity

Version: **0.1.0**  
Bytes: **772,648**  
SHA-256: `38c9fbdbaf76b51dc0e91c1625ff8624f98241017466d99160b70ea4d633ce30`

The installer was built from the completed application, installed without network dependencies, and used to restore the saved assessment with exact original source bytes and unchanged calculations. Reopening the saved project preserved its reviewed inputs and workpapers.

Application code: [MIT](LICENSE). Reference publications retain their original rights and notices; see [SOURCE-NOTICES.md](SOURCE-NOTICES.md).
