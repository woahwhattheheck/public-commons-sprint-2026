# OpenLineage installed Quality operations

This workflow receives a completed OpenLineage Quality workspace through the maintained
Starforge product installation. An operator can inspect the same producer observations,
rule editions, saved evaluations, decisions and report documents from the installed
application, the command line and the merchant MCP connection. The resulting delivery
also includes the complete editable workspace and source package.

Use the [selected product package](SELECTED_PACKAGE.md) for the original source
inventory, pinned builder and resumable package operation. Build from the same
published source commit used by the selected package, and retain its complete
archive and identity for this installed journey.

The installed continuation belongs to
`OPENLINEAGE-INSTALLED-QUALITY-E496-20261012`. Its input is the complete export and
native result from `OPENLINEAGE-DATASET-QUALITY-9EEA-20261012`. The original Quality
programme retains responsibility for creating and reviewing its dataset. This workflow
receives that completed customer state and operates its installed product.

## Operator journey

Open **Applications**, choose **OpenLineage operations**, and select the received
OpenLineage workspace directory. Use a private token file for the installed operator
session. The saved application keeps its original source release and workspace identity.
Start it and open the local URL reported by that operation.

In **Quality**, choose the original dataset. **Observations** explains which producer
events supplied metrics and assertions. **Rules** shows the saved comparisons and their
editions. **Evaluation** opens the selected saved result with its original event selection
and rule-set hashes. **Decisions** shows the reasoned dispositions attached to findings in
that saved evaluation. These views support the same operator review on desktop and at
a 390-pixel phone width.

Download the saved evaluation in HTML for reading, JSON for structured use, or CSV for
tabular review. Each format refers to the same saved evaluation. The native receiving
programme compares these documents across the installed command line and actual
merchant MCP connection.

Stop and restart the saved Application when the operator session needs reopening. The
workspace identity and saved history remain the same. The restarted server announces a
new instance. Inspect the merchant connection and explicitly select the current instance
before continuing its requests.

For another reviewer, open the delivered `editable-workspace/` with its included
application source. The received copy contains the same workspace ID, revision, source
events, rule editions, evaluations, decisions and operation IDs. The complete installed
source package is included alongside it.

## Complete receiving input

Run the maintained programme with one private JSON input:

~~~sh
node products/openlineage/INSTALLED_RECEIVING.mjs /absolute/private/installed-quality-input.json
~~~

The host needs Linux, Node 22.16 or newer, Python 3.11 or newer, Git, `flock`, and its
existing Chromium/Playwright installation. Use an owned writable temporary directory
for the native process. The receiving case, original Quality files and selected source
must be on the same accessible host.

Choose either an existing complete selected package or a complete source build. The
following structure selects a package already produced by the maintained distribution
builder. Replace each descriptive value with the actual original result or local path.

~~~json
{
  "schema": "commons.openlineage.installed-quality-input.v1",
  "operationId": "OPENLINEAGE-INSTALLED-QUALITY-E496-20261012",
  "directory": "/absolute/private/openlineage-installed-quality",
  "selectedPackage": {
    "directory": "/absolute/private/selected-package",
    "archive": "/absolute/private/original-selected-package.tgz",
    "sha256": "SHA256_OF_THE_COMPLETE_ORIGINAL_ARCHIVE",
    "sourceCommit": "FULL_PUBLISHED_GIT_COMMIT"
  },
  "originalQuality": {
    "resultFile": "/absolute/private/complete-quality-native-result.json",
    "workspaceFile": "/absolute/private/complete-quality-workspace.json",
    "sha256": "ORIGINAL_BROWSER_DELIVERY_EXPORT_ID"
  },
  "browser": {
    "modulePath": "/absolute/path/to/playwright/index.js",
    "executablePath": "/absolute/path/to/chromium",
    "args": ["--no-sandbox", "--disable-dev-shm-usage"]
  },
  "pythonExecutable": "python3"
}
~~~

The browser arguments above are for the existing isolated Linux receiving container.
Use the host's established browser configuration. `modulePath` must point to the
installed module, and `executablePath` must point to an actual executable on that host.

For an original source build, replace `selectedPackage` with:

~~~json
{
  "sourceBuild": {
    "directory": "/absolute/private/complete-source",
    "repository": "/absolute/private/source.git",
    "commit": "FULL_PUBLISHED_GIT_COMMIT"
  }
}
~~~

The source directory supplies the maintained builder and original runtime modules. The
repository is an existing checkout or the original Git-object cache containing the
selected commit, complete tree and required source objects. The programme calls
`buildDistribution` with the exact `openlineage-operations` selection, immutable commit,
offline mode and its original output directory. Missing Git objects should be acquired
through the maintained source receiver and placed under their original IDs before
continuing that same build.

The input selects the complete v5 Quality source: 77 product application files and
76 portable workspace files. The Application provider is retained in the selected
product, while the portable inventory follows the original store's versioned contract.
Every portable application file in the original Quality export must match the installed
package's source bytes and manifest Git blob. A later product source edition must be
received through its matching original programme and complete export.

## Upgrade the completed Quality customer to version 7

The same programme also carries the completed version 5 customer into the complete
version 7 application. Select the explicit upgrade input below. The original installed
operation above continues to require its original version 5 source and 76-file export.

The upgrade first validates that original export with both its original version 5 store
and the selected version 7 store. All 76 original application files must match their
published source snapshot. Keep either the original published commit or the complete
published source packet with its Git blob identity. A corrected source file must be
declared separately with its published Git blob; the programme verifies its complete
bytes. This supports the original Quality delivery's retained source packet and later
desk correction without changing the meaning of either source edition.

The original receiver creates a separate `original-customer-workspace/`. The current
store then exports that same workspace with all 81 selected application files. Its
receiver opens a new `customer-workspace/`; the original received application stays
available. The programme compares the entire state and every object byte across that
transition, including source events, saved editions, rule definitions, evaluations,
dispositions and their histories, attached results, schema/service records and operation
IDs. A source upgrade does not create a customer revision or a new Quality decision.

That received customer continues through all the installed command, runtime,
Applications, browser, merchant, reopening and independent delivery stages described
below. Each selected application file is checked against the complete product manifest.
The final export must contain the same original state and objects and the complete
81-file selected source. The delivery also retains `original-source/`, the exact original
workspace, native result, source selection, and complete original packet when selected.

Use the maintained distribution builder to select the actual current source commit.
The `sourceBuild` alternative above also works for this upgrade. For an existing selected
package and the original packet with a published desk correction, use:

~~~json
{
  "schema": "commons.openlineage.installed-quality-upgrade-input.v1",
  "operationId": "OPENLINEAGE-INSTALLED-QUALITY-UPGRADE-SDK12-20261012",
  "directory": "/absolute/private/openlineage-quality-upgrade",
  "selectedPackage": {
    "directory": "/absolute/private/current-selected-package",
    "archive": "/absolute/private/current-selected-package.tgz",
    "sha256": "SHA256_OF_THE_COMPLETE_CURRENT_ARCHIVE",
    "sourceCommit": "FULL_PUBLISHED_CURRENT_GIT_COMMIT"
  },
  "originalQuality": {
    "resultFile": "/absolute/private/complete-quality-native-result.json",
    "workspaceFile": "/absolute/private/complete-quality-workspace.json",
    "sha256": "ORIGINAL_COMPLETE_DELIVERY_EXPORT_ID",
    "sourceSnapshot": {
      "directory": "/absolute/private/original-quality-source",
      "repository": "/absolute/private/original-source.git",
      "packetFile": "/absolute/private/original-quality-source-packet.json",
      "packetBlob": "FULL_PUBLISHED_ORIGINAL_SOURCE_PACKET_GIT_BLOB",
      "overrides": [
        { "path": "quality-ui.mjs", "gitBlob": "FULL_PUBLISHED_CORRECTED_SOURCE_GIT_BLOB" }
      ]
    }
  },
  "browser": {
    "modulePath": "/absolute/path/to/playwright/index.js",
    "executablePath": "/absolute/path/to/chromium",
    "args": ["--no-sandbox", "--disable-dev-shm-usage"]
  },
  "pythonExecutable": "python3"
}
~~~

For an original application that exactly matches one published commit, replace
`packetFile`, `packetBlob` and `overrides` with `"commit": "FULL_ORIGINAL_GIT_COMMIT"`.
Keep the original snapshot directory and Git repository. The commit mode compares
each original application file to that commit's actual source tree; packet mode verifies
the complete retained packet and each declared correction against their Git objects.

Run the same `INSTALLED_RECEIVING.mjs` command with this explicit upgrade input.
Continue an interrupted upgrade with its same input and case; its journal binds both
source editions and the complete original customer export and native result. The
`upgrade-original-application-source` stage records the old and new source identities,
state digest, exact object closure and unchanged operation IDs.

## What the programme operates

| Stage | Maintained interface | Customer result |
| --- | --- | --- |
| Source selection | Distribution builder, selected recipe and original unpacker | Complete source-selected archive and verified package manifest |
| Product installation | SF46 package preparation, release installation and activation | Installed `forge.mjs` command with the selected source release |
| Command-line review | Installed OpenLineage command | Original Quality overview plus identical HTML, JSON and CSV reports |
| Runtime preparation | Runtime installer, operator profile, offline install and inspection | Ready source-verified operator runtime with zero selected dependencies |
| Applications | Original provider, managed runtime adoption, saved application and startup | Actual local application tied to the original workspace |
| Browser review | Existing Chromium and the installed Quality desk | Desktop observations/rules/evaluation/decisions and phone evaluation/decisions |
| Merchant connection | Original OpenLineage setup and HTTP MCP host | Seven Quality tools in the actual catalog; matching overview and reports |
| Reopening | Application stop/start and explicit merchant instance selection | Same workspace and history through a new actual server instance |
| Editable delivery | Original complete export and workspace receiver | Independent desktop/phone opening with all 76 original application files |

The programme reads and exports the completed Quality state. Product setup records,
runtime installations and Application lifecycle operations live in its own private
receiving case. Original source event IDs, rule editions, evaluations, decisions and
workspace operation history remain unchanged.

The complete OpenLineage source selection includes the maintained merchant console
and its workflow modules. Its authenticated MCP host can therefore start with the
console enabled from the installed package, using the same source-verified operator
runtime. This receiving programme opens that actual host and compares all three
Quality report formats through its original seven-tool merchant interface.

The selected package explicitly includes `OPENLINEAGE_LICENSE`. That upstream notice
is part of every original editable application inventory. The maintained distribution
builder retains the explicitly declared original project license name, so installation
can prepare the Application and export the complete workspace.

## Native progress and continuation

`installed-receiving.json` records the original input binding, source commit, operation,
completed stages, saved mutation intents, Application requests and artifact identities.
The case uses the maintained private lock. A second invocation cannot concurrently
operate that same case.

The command prints `OPENLINEAGE_INSTALLED_PROGRESS=` records while the original stages
advance. A selected source build also prints `OPENLINEAGE_SELECTED_BUILD=` events.
Use these records to identify the current action and its retained output rather than
starting an unrelated case.

After an interrupted invocation, retain the original input JSON, case directory,
source package, source commit and Quality files. Invoke the same programme with that
same input. It reuses its source build, verifies an already prepared release, reopens
the original installed runtime plan, and preserves saved Application requests. Completed
artifact files must still match their recorded complete bytes.

A partial runtime preparation that never wrote its original installation plan remains
inspectable through `preparation.json` and `prepare-error.json`. The continuation uses
the maintained runtime recovery operation to prepare a new owned runtime directory
from that original preparation, and records both directories before proceeding.
The previous preparation remains available for inspection. A missing workspace,
different archive, different source commit or changed Quality export needs source
recovery; replacing values in the original journal would change the operation.

When the programme reports an Application error, inspect the saved Application's
operation and its `worker.log` under the original runtime workspace. Keep the saved
request ID and current source pin. Correct the actual source or runtime issue and
continue the original operation with an explicit source revision when necessary.

## Delivery contents

A successful invocation produces `delivery/openlineage-installed-quality.zip`.
The complete native result and archive digest are recorded in the receiving journal.

| Delivery member | Purpose |
| --- | --- |
| `START_HERE.md` | Exact source commit, workspace, evaluation and opening instructions |
| `editable-workspace/` | Independent editable workspace with all original source and customer state |
| `installed-quality-workspace.json` | Complete installed export in the original receiving format |
| `original-quality-workspace.json` | Exact original Quality browser delivery used as input |
| `original-quality-native-result.json` | Completed original programme result |
| `installed-quality-result.json` | Installed operation, runtime/Application results, source binding and artifact identities |
| `reports/` | Complete installed HTML, JSON and CSV evaluation reports |
| `screens/` | Actual installed desktop/phone and independently received desktop/phone views |
| `source-package.tgz` | Complete original source-selected product package |
| `runtime-unpack.py` | Original source package receiver |
| `INSTALLED_RECEIVING.mjs` and `INSTALLED_RECEIVING.md` | Complete editable programme and operating guide |
| `delivery-manifest.json` | Complete archive member names, byte counts and SHA-256 values |

The ZIP retains completed native operation details before its own archive identity is
known. The outer `installed-receiving.json` carries the final `COMPLETE` status and
the ZIP's actual SHA-256. Save both complete files to the existing reviewer delivery
before releasing the native process.

## Opening the delivered customer workspace

From the extracted delivery, use its complete original application:

~~~sh
node editable-workspace/application/cli.mjs serve --workspace editable-workspace --port 0
~~~

Open the actual local URL printed by that server. In Quality, select the original
dataset and saved evaluation named in `START_HERE.md`. Review the saved decisions and
open the complete reports. The delivered source is editable and can be reopened without
the private receiving case.

To inspect or install the source-selected product, unpack the retained archive using
the SHA-256 printed in `START_HERE.md`:

~~~sh
python3 runtime-unpack.py --archive source-package.tgz --sha256 ORIGINAL_ARCHIVE_SHA256 --out selected-package
~~~

Use its maintained runtime installer at
`selected-package/source/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs`.
Prepare an operator profile with `--operator`, install that profile with `--offline`,
and inspect it with `--load --source`. The original installer help provides the complete
commands and original runtime paths. Open the installed Runtime workspace, adopt its
managed home, and save OpenLineage operations in Applications with the received workspace.

For commissioning another customer's dataset, use `QUALITY_OPERATOR.md` in the
application source. It covers original event intake, choosing relevant metrics,
versioned local rules, saved evaluations, reasoned decisions, and repeat reviews against
new events. Keep each customer workspace and its source lineage separate while using the
same installed product.
