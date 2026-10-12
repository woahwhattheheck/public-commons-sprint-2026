# Operate a complete Analysis project

A complete project joins the customer's current analytical database with the original files needed to understand, reopen and continue it. The offline reader contains typed dataset rows, saved SQL and parameters, report records, workbook editions and downloadable original files. The editable workspace uses the original Analysis application and database engine.

## Install the selected product

Build one immutable source selection from this repository:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-checkout \
  --ref SELECTED_COMMIT \
  --selection analysis-project \
  --out /private/analysis-release
~~~

Use the returned complete archive and its SHA256 with the original installer:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /private/analysis-runtime \
  --archive /private/analysis-release/RETURNED_ARCHIVE.tgz \
  --sha256 RETURNED_ARCHIVE_SHA256 --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /private/analysis-runtime

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /private/analysis-runtime --load --source
~~~

Retain the returned source root, source commit and source-manifest digest. Provision the original Python package in **Runtime workspace → Python**, selecting Python 3.12 or later and this same source release. Resolution, installation and activation stay with the original Python runtime worker. The package's console-script inventory must include `stellar-forge-analysis-project`; an older installation remains available for its existing sessions.

Select the declared extras needed by subsequent analytical work. Opening a retained project and exporting its already generated report/workbook files use the original source and standard library. Building new workbook editions requires the original `workbooks` extra. The current installed `pyproject.toml` and the retained project's source select their actual dependencies.

The installed command runs with the lexical virtual-environment Python path. Its original project launcher then imports the project's own verified `runtime/python` source, with the selected installed dependencies still available. Node uses the supplied executable and the project's matching `runtime/native` tree. Keep all of those files together.

The [Python runtime guide](../../stellar/scf-starforge-20261009/distribution/python-runtime/README.md) documents exact resolve/install/activate and complete environment transfer commands.

The included [installed receiving program](RECEIVING.md#run-the-retained-installed-journey) can commission this same package directly from an actual `--python` executable through those original operations. It also accepts an already retained `--installation` ID. The program keeps the review, resolution, installation and activation requests alongside the original customer project, then completes its full Applications opening and following handover.

## Open through Applications

Add **Open Analysis project** with these selections:

| Field | Select |
| --- | --- |
| Installed Python environment | The retained installation containing the new project entrypoint |
| Complete project ZIP or directory | The whole delivered project |
| Private customer database directory | A new destination or this project's already received database |
| Retained project directory | Optional private extraction destination for ZIP input |
| Project ZIP SHA256 | Optional exact digest supplied with the delivery |
| Original receiving operation | Optional existing UUID32 for a receiving continuation |
| Original Node executable | The selected compatible native executable |
| Local port | 0 for an available loopback port |

Preparation opens the original installed command in read-only inspection mode. It verifies every declared file, the complete ZIP inventory when applicable, the native archive, and the original runtime source inventory. It binds the manifest SHA256, workspace ID and ZIP SHA256 into the actual managed request. A changed selection is rejected before receiving or launching it.

ZIP input is materialized under a private retained directory. The default is a sibling of the customer database named by the reviewed manifest SHA256. Keep that directory while the project is in use. The original complete source remains available after the input ZIP is moved only when the subsequent command explicitly selects the retained extracted directory.

The original archive receiver creates or reopens the destination under its own receiving journal. Repeating the same source and destination returns its original receiving result and preserves later customer queries, reports, workbook editions and database revisions. A different project cannot overwrite that destination.

Applications observes the actual original listener's private launch file, process ID and workspace identity before presenting **Open**. **Stop** sends SIGINT through the same managed process. The native Analysis owner closes its server and drains its original background work. Open and export requests use the same database resource as **Analysis and workbook workspace**, so they share its existing local ownership rules.

## Installed command

Use the script path reported by the original Python installation:

~~~sh
/selected/python-installation/bin/stellar-forge-analysis-project \
  --checkout /selected/runtime/package/source \
  --project /private/deliveries/Analysis_Project.zip \
  inspect
~~~

The compact result includes the verified workspace ID, manifest SHA256, original archive identity, complete member count and ZIP digest. Inspection creates no customer database and executes no code from the selected project.

Receive the same project without opening a listener:

~~~sh
/selected/python-installation/bin/stellar-forge-analysis-project \
  --checkout /selected/runtime/package/source \
  --project /private/deliveries/Analysis_Project.zip \
  --project-sha256 ORIGINAL_PROJECT_ZIP_SHA256 \
  --manifest-sha256 REVIEWED_MANIFEST_SHA256 \
  --workspace-id ORIGINAL_WORKSPACE_ID \
  --database /private/customer/analysis \
  receive --operation ORIGINAL_RECEIVING_UUID32
~~~

Open it with the native application:

~~~sh
/selected/python-installation/bin/stellar-forge-analysis-project \
  --checkout /selected/runtime/package/source \
  --project /private/deliveries/Analysis_Project.zip \
  --manifest-sha256 REVIEWED_MANIFEST_SHA256 \
  --workspace-id ORIGINAL_WORKSPACE_ID \
  --database /private/customer/analysis \
  --node /absolute/path/to/node \
  serve --port 0 --open
~~~

All global options precede `inspect`, `receive`, `serve` or `export`. `--project-cache` selects a particular private ZIP extraction directory. The command checks the project again at execution, even when its selection was prepared earlier.

## Continue the analytical work

Use the original Analysis source, mapping, query, report and workbook controls. Source review retains each response's transport, source identity and exact payload. Saved queries keep their parameters, views and revisions. Reports and workbook jobs retain their original operation identities and complete outputs. The offline reader presents the exported snapshot; create a following project to include later customer work.

The original source modules and receiving guide remain included in every complete project. Select a project from its known delivery context because its retained runtime supplies the application code used to continue that project.

## Export a complete following handover

Stop the native Analysis listener, then add **Export complete Analysis project** in Applications. Select the same customer database, original source project and Python installation. Choose a private output directory outside both the database and the source project.

Leave the archive operation field empty to bind a stable archive ID to the verified source manifest, workspace, database and output directory. Review, save and start use that same ID. Choose a new output directory for a new customer handover, or supply an existing UUID32 to resume its exact export. Keep the original operation ID, output directory, title and source selection when continuing an interrupted export.

The installed command is:

~~~sh
/selected/python-installation/bin/stellar-forge-analysis-project \
  --checkout /selected/runtime/package/source \
  --project /private/deliveries/Analysis_Project.zip \
  --manifest-sha256 REVIEWED_MANIFEST_SHA256 \
  --workspace-id ORIGINAL_WORKSPACE_ID \
  --database /private/customer/analysis \
  --node /absolute/path/to/node \
  export --operation ORIGINAL_ARCHIVE_UUID32 \
  --output /private/delivery/following-project \
  --title "Customer analysis"
~~~

The command opens the original database owner once. For a new archive operation it retains all currently registered stream and MCP response sources through the original response-source helper. It then starts or resumes the same original `workspace-export` job. The complete native archive supplies the current database, saved output closure and retained original input files.

The original complete-project builder combines that archive with the source project's verified runtime, launcher, source files and receiving history. Its original reader template is retained. The new receiving record binds the prior manifest, current database identity and original archive operation.

The output directory contains:

- `Analysis_Project.zip`: the complete next operator project.
- `project.html`: the full offline reader.
- `project-data.json` and `project-manifest.json`: complete typed data and member identities.
- `project-operation-result.json`: the completed source selection and original builder result.
- `command-attempts`: the actual original command, stdout, stderr and observed exit for each stage.

A repeated completed export verifies and returns those exact files. Later customer edits require a new archive operation and output directory. A failed or interrupted child keeps its actual output, while the original database job and builder handle their same-operation continuation. SIGINT/SIGTERM is forwarded to the original child; the managed lease remains with the producing command and its child.

For an explicitly requested history-rich archive, the CLI also accepts `--include-previous-backups` after `export`. This follows the original archive engine's option and can substantially increase delivery size.

## Deliver and reopen

Give the next operator the complete ZIP and its returned byte count and SHA256. They can inspect it, open the offline reader, and receive it into an independent private database. Keep the whole source/runtime/receiving inventory; the offline HTML and editable project travel together in the ZIP.

The [receiving guide](RECEIVING.md) specifies the full installed journey and original case input. Use the current existing application operation and saved result when continuing an interrupted receiving run.
