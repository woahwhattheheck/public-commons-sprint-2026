# Install and receive the complete World Bank product

Use the actual selected-source builder, runtime installer, managed World Bank
application and original Analysis/customer receivers. Retain the same operation
directories and source identities through interruption.

## Build the selected source

Use Node 22.16 or newer and a checkout containing the desired complete commit:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-workspace-checkout \
  --ref COMPLETE_SOURCE_COMMIT --selection worldbank \
  --out /absolute/worldbank-release
~~~

The [recipe](../../stellar/scf-starforge-20261009/distribution/selections/worldbank.json)
selects the existing source, Applications and MCP registrations, complete
buyer/Analysis and seller components, product command and guides, original
managed receiver and retained reference package. The builder follows their
original static imports and native browser maps.

Retain the returned archive path, SHA256, commit and source/installed sizes.
Its manifest retains the exact recipe Git blob and digest. Resume an interrupted
build in the original output:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-workspace-checkout \
  --out /absolute/worldbank-release --resume
~~~

An omitted selection inherits the saved product. Another commit or product uses
a new output. See [source selections](../../stellar/scf-starforge-20261009/distribution/SOURCE_SELECTIONS.md).

## Install the original runtime

Use the actual archive and digest returned above:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /absolute/worldbank-runtime \
  --archive /absolute/worldbank-release/RETURNED_ARCHIVE.tgz \
  --sha256 RETURNED_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /absolute/worldbank-runtime
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /absolute/worldbank-runtime --load --source
~~~

These operations retain the original profile, dependency lock, cache, probes
and READY state. An equipped host can use the supported --adopt-existing route
for an already complete matching dependency tree. Continue installation through
the same original runtime directory.

Prepare Python 3.11 or newer with the original workbook dependency:

~~~sh
python3 -m venv /absolute/worldbank-python
/absolute/worldbank-python/bin/python -m pip install \
  '/absolute/worldbank-runtime/package/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python[workbooks]'
~~~

The package pins openpyxl==3.1.5. An existing compatible environment is reusable.
The receiver also accepts --python-dependencies DIRECTORY for an existing
dependency installation; its Python application source comes from the installed
product manifest.

## Run the complete installed receiving

Choose a private mode0700 directory. Use the original installer:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /absolute/worldbank-runtime -- worldbank-product receive \
  --runtime /absolute/worldbank-runtime \
  --workspace /absolute/private/worldbank-product-receiving \
  --python /absolute/worldbank-python/bin/python
~~~

The equivalent installed command is:

~~~sh
starforge worldbank-product receive \
  --runtime /absolute/worldbank-runtime \
  --workspace /absolute/private/worldbank-product-receiving \
  --python /absolute/worldbank-python/bin/python
~~~

The receiver performs one complete original operation:

1. Inspect READY and verify the complete source manifest, selected recipe,
   original file modes, lengths, SHA256 values and Git blobs.
2. Run the original managed example from that installed source: retained
  42-observation acquisition, shared browser/MCP review, export, native merchant,
   resumed six-file customer download, Stop/saved-start recovery and reopening.
3. Pass the actual downloaded handover into the original importer, typed
   Analysis table, four query recipes, report publication, workbook and archive.
4. Receive the complete Analysis workspace into an independent customer
   directory. Compare all 42 original observations, save a Canada GDP query,
   repeat the completed archive receive, and reopen the saved edit over native HTTP.
5. Receive the workbook through WorkbookDelivery, reopen its verified Excel
   stream, and inspect all four data sheets plus source/instruction sheets.

The retained reference is the original source 2 CAN/MEX/USA GDP and population
acquisition for 2018–2024. It contains 42 observations, 6 coverage rows, 42 annual
change rows and 21 GDP/population rows. Canada 2024 GDP remains the exact text token
2270076189683.46. Source acquisition for this receiving uses retained original
responses. The native merchant stage uses the original example's
stellar:testnet CHALLENGE_ONLY terms, HTTP402, private query200 and exact buyer
configuration. Use the normal operating workflow and actual seller terms for a
production service.

## Reopen the same operation

| Path beneath the private receiving directory | Retained state |
| --- | --- |
| receiving-intent.json | Original installation, selected commit, manifest and product |
| managed/managed-journey.json | Original Applications, source, merchant and download checkpoints |
| managed/customer-download/handover.zip | Actual completed source handover |
| producer-result.json | Source, report, workbook and portable workspace results |
| producer/worldbank-analysis/13c281c36fca40fe8377af367911bb4d/delivery/ | Complete customer files |
| customer/ | Reopened Analysis workspace and customer edits |
| customer-workbook/ | Original received workbook package |
| customer-result.json | Exact source query, HTTP reopening and workbook receiving |
| product-receiving.json | Joined complete product result |
| native-errors.jsonl | Actual failed/interrupted continuation details |

Repeat the same runtime, command and private directory after interruption.
Original engines reopen their source import, review, offer, download, report and
archive operation IDs. A directory lease serializes the complete receiver;
busy returns exit 75. The managed child inherits that lease and runs in its own
session with a retained private process log. SIGINT/SIGTERM requests stop after
that original driver's normal cleanup boundary. The receiver waits for that
child to close its models before returning the interruption. Losing the parent
or its output transport preserves the child's lease and log.

The runtime/source binding remains exact for this operation. Receive a different
installed source edition into a new private directory. The customer's normal
Analysis workspace retains its own original editing/archive lifecycle.

## Original implementation

The product delegates source commands to the original World Bank CLI and
analysis commands to stellar_forge_buyer.worldbank_analysis. Its receiving
helper composes the original managed example and complete customer engines.
The upstream [Analysis native receiver](../../stellar/scf-starforge-20261009/sf30-seller-sdk/worldbank/examples/analysis-native-receiving.py)
also remains available with its original pinned acquisition and operation.
