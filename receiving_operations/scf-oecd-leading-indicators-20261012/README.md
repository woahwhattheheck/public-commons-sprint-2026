# OECD analyst and customer application

This application imports retained OECD composite-leading-indicator observations and their dataflow, data structure and codelists. It provides source review, exact calendar comparisons, saved report editions, a native series catalog, merchant publication, dataset delivery and customer project reopening.

The source contains the complete retained seven-country example: 15 provider responses and 231 monthly observations. The reports use the source's amplitude-adjusted index, whose long-term average is 100. See the [OECD indicator description](https://www.oecd.org/en/data/indicators/composite-leading-indicator-cli.html) and [OECD Data Terms](https://www.oecd.org/en/about/terms-conditions.html).

## Release contents

The application and native dependency source are distributed in one complete 290-file source selection. Application PR [2171](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2171) supplies the complete original product. PR [2222](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2222) supplies the reviewed Python startup fixes. The merged report-attribution edition is PR [2273](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2273), commit `ef4c6c57b08bb67b750aa251ccdaeb79dc84031b`.

Every application file is listed in `SOURCE_SELECTION.json` with its exact source commit, Git blob, SHA-256, byte count and mode. The source carrier contains the complete Git metadata and every selected file. Its two ZIP parts and transfer index are checked by the included Git receiver before source materialization.

New reports use report version 2 and include `briefing.html`, `briefing.json`, `observations.csv`, `SOURCE_RIGHTS.json` and `SOURCE_RIGHTS.md`. Saved version-1 reports retain their original bytes. Exported customer projects preserve the corresponding report version and source acknowledgment.

## Requirements

Use Python 3.11 or newer, Node.js 24, and an installed Git executable that supports `--no-lazy-fetch`. The Python source uses the standard library. `SOURCE_SELECTION.json` lists the Node package requirements, including the Stellar/x402 packages, `yaml` and `re2js`. Supply the directory containing the installed packages through `--node-modules`.

The following commands use example absolute paths. Replace them with the directories chosen for the installation. Keep source cache, source code, package installation and saved project in distinct directories.

## Install and create a briefing

Put both complete ZIP parts, `OECD_RELEASE_SOURCE_TRANSFER.json`, `receive-oecd-release.py.txt` and `git-object-receiving.py.txt` in the transfer directory. Keep each ZIP filename exactly as written in the transfer index. Python can run the .py.txt source files directly.

~~~sh
python3 /srv/oecd-transfer/receive-oecd-release.py.txt \
  --source-transfer /srv/oecd-transfer/OECD_RELEASE_SOURCE_TRANSFER.json \
  --commit EXACT_SOURCE_COMMIT_FROM_INDEX \
  --receiver /srv/oecd-transfer/git-object-receiving.py.txt \
  --cache /srv/oecd-source-cache \
  --source /srv/oecd-source \
  --project /srv/oecd-project \
  --node-modules /srv/oecd-packages/node_modules \
  --node node \
  --python python3 \
  --mode briefing
~~~

The launcher materializes the complete selected source, verifies the unchanged Git receiver, binds the package installation, and runs the application. The briefing example imports the source family, saves the first edition, saves a second editorial edition, exports the native dataset and full project ZIP, and imports that ZIP into a separate customer workspace. It compares the complete report files and every source row after reopening.

The JSON result contains the saved editions, dataset export, project archive path and hash, customer workspace identity, and browser commands. The report's selected date window and the full retained source-series coverage are recorded separately.

## Open the analyst workspace

~~~sh
node /srv/oecd-source/stellar/scf-starforge-20261009/sf30-seller-sdk/sdmx/oecd/cli.mjs \
  serve --project /srv/oecd-project --python python3
~~~

The workspace provides source inventory, country and period selection, source revision comparison, report preview and save, catalog activation, dataset export, complete project export and project import. Its typed Node client, command interface, MCP tools and Applications provider use the same saved project.

Open the generated `briefing.html` directly to read the complete offline report. Use `observations.csv` for the report's selected observations, and distribute its source-rights companions with it. The JSON report retains the citation, access date, provider metadata and exact source identifiers. Use the complete project ZIP to move the editable analyst project to another workspace.

## Merchant publication and dataset delivery

The public `examples/receiving.json` file describes the merchant and buyer configuration accepted by `receiving.mjs`. Configure those fields for the installation, including the payment settings, buyer workspace and provider authentication environment names.

~~~sh
python3 /srv/oecd-transfer/receive-oecd-release.py.txt \
  --source-transfer /srv/oecd-transfer/OECD_RELEASE_SOURCE_TRANSFER.json \
  --commit EXACT_SOURCE_COMMIT_FROM_INDEX \
  --receiver /srv/oecd-transfer/git-object-receiving.py.txt \
  --cache /srv/oecd-source-cache \
  --source /srv/oecd-source \
  --project /srv/oecd-merchant-project \
  --node-modules /srv/oecd-packages/node_modules \
  --node node \
  --python python3 \
  --mode receive \
  --config /srv/oecd-settings/receiving.json
~~~

This program publishes the retained dataset through the SDMX merchant, uses the configured Dataset buyer, completes accounting through its native page interface, saves the full delivery and reopens it. It compares the delivered dimensions, values, presence, actions and observation attributes with the retained source. The 150-row page setting in the example delivers its 231 observations in two pages.

The receiver stores the configuration binding and completed steps in its project checkpoint. To continue an interrupted run, use the same project, configuration and invocation. Completed native steps are recovered from that checkpoint.

## Upgrade and reopen saved projects

Receive a new source release into a distinct source-cache and source directory. Stop the running application normally, then open the same saved project with the new source. Keep the original project directory and settings.

A repeated saved operation returns its original selection and report version. To author a new version-2 report from a saved project, open that selection, review its current revision, and save a new report edition. The original report stays available. Export and import use the exact files named by each saved report manifest.

The source cache retains the received Git objects and source-transfer result. The saved project retains source responses, native catalog history, report editions, exports and receiving state. The two directories serve different purposes and can be reopened independently.
