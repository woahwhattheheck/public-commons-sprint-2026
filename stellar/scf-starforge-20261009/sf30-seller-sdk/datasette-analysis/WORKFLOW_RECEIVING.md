# Receive and continue the complete native supplier workflow

This operation runs the six original supplier SQL sections, complete catalogue
coverage and native supplier review through the installed Analysis application,
then receives that complete project into a separate installation and produces a
real report successor. Use the original source and product implementations
throughout.

The earlier A49AA publisher and 9333 saved Analysis operations keep their own
original sessions, source checkpoints and continuation. The joined conapi
operation below has its own retained workflow directory and selected Analysis
owner. Its source selection includes the completed workflow, native selected-view
correction, original supplier component and installed receiving contribution.

## 1. Select the actual complete installation and source

Read the original installed binding and use its sourceRoot. A built package
commonly places it at /opt/tjlabs/merchant/source. Derive both components from
that actual source root:

~~~sh
CONAPI_SOURCE=/opt/tjlabs/merchant/source
CONAPI_ANALYSIS_COMPONENT="$CONAPI_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis"
CONAPI_SUPPLIER_COMPONENT="$CONAPI_SOURCE/products/conapi/supplier-report"
CONAPI_PYTHON=/absolute/original/installed/workbooks/bin/python
CONAPI_ANALYSIS=/absolute/private/conapi/analysis
CONAPI_WORKFLOW=/absolute/private/conapi/workflow
CONAPI_PROJECT=/absolute/private/conapi/project
~~~

Use the Python executable returned as installation.python by the installed
runtime inventory. The maintained environment includes Python 3.11 or newer and
the workbooks extra. Keep the original selected Node runtime on the operator's
configured path.

The source manifest must include:

| Selected source | Purpose |
| --- | --- |
| Complete datasette-analysis component, including WORKFLOW_SUPPLIER_EXAMPLE.json | Original worker, six SQL sections, report and receiving operations |
| Native buyer query_stream.py, query_export.py, analysis_workspace.py, analysis_reports.py and analysis_exports.py | Transaction-bound source selection and complete native exports |
| Complete products/conapi/supplier-report component | Maintained parser, comparison/review, CLI/browser, coverage, attachment helper and original guides |
| Selected distribution and original product source archive | Full software installation in the delivered customer project |
| Native Kestra source and actual rendered flow delivery when configured | Original external request/correlation and installed delivery route |

The adapter and native-source correction are in merged PRs
[560](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/pull/560)
and [586](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/pull/586).
The operator selects the final joined source commit containing the complete
supplier component and receiving contribution. Record the actual source commit
and built archive returned by the maintained product builder in the same
operation. [The product guide](../../../../products/datasette/README.md) and
[its receiving guide](../../../../products/datasette/RECEIVING.md) own those
installation commands.

The installed wrapper binds every selected WORKFLOW document, profile and
workflow source file, all selected Kestra files and every selected supplier
component member. Its complete invocation requires all four installation fields:

~~~sh
starforge datasette-analysis \
  --runtime-workspace /absolute/private/runtime-operator \
  --runtime-directory /absolute/private/original-runtime \
  --runtime-id ORIGINAL_24_HEX_RUNTIME_ID \
  --installation-id ORIGINAL_64_HEX_PYTHON_INSTALLATION_ID \
  -- workflow status --workspace "$CONAPI_WORKFLOW"
~~~

All direct Python commands below use CONAPI_PYTHON from that same actual
installation.

## 2. Keep the selected original Analysis owner open

Use the existing operator if the conapi operation has already started. The
maintained client reads its actual operation ID:

~~~sh
CONAPI_OPERATION="$("$CONAPI_PYTHON" - "$CONAPI_ANALYSIS_COMPONENT" "$CONAPI_ANALYSIS" <<'PY'
from pathlib import Path
import sys
sys.path.insert(0, str(Path(sys.argv[1]).resolve()))
from operator_client import DatasetteOperatorClient
original = DatasetteOperatorClient.from_workspace(sys.argv[2]).status()
print(original["operation_id"])
PY
)"
~~~

For a new joined operation, retain one operation ID in the private project first,
using the creation sequence in **Native preparation for the receiving profile**
in [WORKFLOW_ANALYSIS.md](WORKFLOW_ANALYSIS.md). Then start the maintained
Analysis server on its owning terminal/service:

~~~sh
"$CONAPI_PYTHON" -I "$CONAPI_ANALYSIS_COMPONENT/cli.py" serve \
  --workspace "$CONAPI_ANALYSIS" \
  --operation-id "$CONAPI_OPERATION" \
  --checkout "$CONAPI_SOURCE" \
  --node /absolute/installed/node \
  --port 0
~~~

The server owns the shared native workspace. Workflow requests retain their
individual native operation IDs and selected editions on this original owner.

## 3. Bind the complete paired supplier source

The selected supplier component includes the complete original reviewed example
at $CONAPI_SUPPLIER_COMPONENT/examples/published-pricing-intake.workspace.json.
It imports all 23 original published price records into the explicitly empty
initial target and retains all 23 review decisions. Its original request ID is
conapi-elite-initial-import-20261012, revision 23, with status reviewed. The
workflow links that original native review to its own external business request.

Use that retained workspace for this source edition. Its candidate CSV is the
exact pricing source selected below. For a customer's different candidate or
rule selection, use the corresponding complete native review workspace.

The retained published source family is:

| Original file | Bytes | SHA-256 |
| --- | ---: | --- |
| [published-pricing.csv](https://elitedigitalagency.io/data/published-pricing.csv) | 3,558 | 6891cc62b1341ee0cdf601a78e9e04b6232f1c26cc1cdeb8f021a5edc1fa5dcb |
| [services-catalogue.csv](https://elitedigitalagency.io/data/services-catalogue.csv) | 4,964 | c225a1e081f783ce20eaf5de222449c03a3d01130ebb9d123b29fcb3673034c9 |
| [datapackage.json](https://elitedigitalagency.io/data/datapackage.json) | 3,780 | 6c758cf191a670985e7195752565c8d16169d6be8941f707a50ebd6638adefe2 |

The publisher is Elite Digital AI Solutions Ltd; this retained original edition
is dated August 12, 2026, acquired on October 12, and licensed CC BY 4.0. The
complete original files and their original publisher metadata are the inputs.
The selected installation also retains these exact three original files at
$CONAPI_ANALYSIS_COMPONENT/sources/elite-digital-20261012, with their complete
publisher attribution and source inventory. Use those paths directly for this
retained edition. For another actual edition, update the selected descriptors
and corresponding native review workspace together.

Configure from the complete maintained example. Use the real local original
files and built software archive:

~~~sh
"$CONAPI_PYTHON" -I "$CONAPI_ANALYSIS_COMPONENT/workflow_cli.py" configure \
  --template "$CONAPI_ANALYSIS_COMPONENT/WORKFLOW_SUPPLIER_EXAMPLE.json" \
  --source-csv "$CONAPI_ANALYSIS_COMPONENT/sources/elite-digital-20261012/published-pricing.csv" \
  --related-csv "catalog=$CONAPI_ANALYSIS_COMPONENT/sources/elite-digital-20261012/services-catalogue.csv" \
  --source-metadata "$CONAPI_ANALYSIS_COMPONENT/sources/elite-digital-20261012/datapackage.json" \
  --related-metadata "catalog=$CONAPI_ANALYSIS_COMPONENT/sources/elite-digital-20261012/datapackage.json" \
  --supplier-component "$CONAPI_SUPPLIER_COMPONENT" \
  --supplier-workspace "$CONAPI_SUPPLIER_COMPONENT/examples/published-pricing-intake.workspace.json" \
  --supplier-table-name supplier_feed_accepted \
  --supplier-pricing "$CONAPI_ANALYSIS_COMPONENT/sources/elite-digital-20261012/published-pricing.csv" \
  --supplier-catalogue "$CONAPI_ANALYSIS_COMPONENT/sources/elite-digital-20261012/services-catalogue.csv" \
  --supplier-metadata "$CONAPI_ANALYSIS_COMPONENT/sources/elite-digital-20261012/datapackage.json" \
  --analysis-workspace "$CONAPI_ANALYSIS" \
  --operation-id "$CONAPI_OPERATION" \
  --source-archive /absolute/private/releases/complete-datasette-source.zip \
  --output "$CONAPI_PROJECT/supplier-configuration.json"
~~~

The profile retains sourceBindings as prices: candidate and coverage aliases
prices/catalog. The native Analysis editions receive every original field as
the original CSV string, including blank charity pricing and actual published
zero prices. Named source roles and coverage inputs must match the actual
Analysis CSV hashes.

The six SQL sections are original_prices, original_catalogue, price_catalogue,
catalogue_coverage, catalogue_review and selected_period. The report retains all
prices, the complete catalogue, exact origin/path relationships and all original
unmatched records. GBP amounts, one-off/month/free billing periods and published
from-price wording remain separate.

Save the original external request as supplier-request-a.json:

~~~json
{
  "schema": "stellar-forge.source-workflow-request.v1",
  "requestId": "conapi-supplier-a-20261012",
  "correlationId": "conapi-supplier-receiving-20261012",
  "profile": "elite-supplier-review",
  "parameters": {"period": "month"}
}
~~~

Retain and complete that original request:

~~~sh
"$CONAPI_PYTHON" -I "$CONAPI_ANALYSIS_COMPONENT/workflow_cli.py" accept \
  --workspace "$CONAPI_WORKFLOW" \
  --request "$CONAPI_PROJECT/supplier-request-a.json"
"$CONAPI_PYTHON" -I "$CONAPI_ANALYSIS_COMPONENT/workflow_cli.py" run \
  --workspace "$CONAPI_WORKFLOW" \
  --request-id conapi-supplier-a-20261012 \
  --configuration "$CONAPI_PROJECT/supplier-configuration.json"
"$CONAPI_PYTHON" -I "$CONAPI_ANALYSIS_COMPONENT/workflow_cli.py" status \
  --workspace "$CONAPI_WORKFLOW" \
  --request-id conapi-supplier-a-20261012 --history
~~~

The returned original outcome includes the actual query row counts/truncation,
selected views, query/export/report IDs, original supplier request/comparison/
revision/status, source-role hashes and complete file list. Open the original
Customer_Report.html and Supplier_Report_catalogue-coverage.html from that
delivery. Also open Datasette_Report.html and Datasette_Analysis.xlsx for the
pricing source, and catalog_Datasette_Report.html and catalog_Datasette_Analysis.xlsx
for the catalogue. Their original source-wide baselines describe each actual
CSV's fields, publisher metadata, strings, blanks and price units. Then inspect
the retained supplier report/workspace through its own application. The complete native accepted outputs appear when its actual status
is reviewed.

## 4. Exercise continuation on the same native owner

The supplier request above is the main product receiving. Use the complete
retained WRI profile on the same Analysis operation as a second real source to
exercise shared-workspace continuation. Its full source is the original
59,792-byte WRI archive, SHA-256
53f2486406d61f18c9e1c9ceaac659c265bbad7afe2fe54b1a17f43307cb0ca0,
with reviewed edition SHA-256
ee34942e0c4c090d4e5cab66eeb51dda49c5cf8852f86d9dfa299913b4115616.
The source receiver and exact WRI configuration commands are in
[WORKFLOW_ANALYSIS.md](WORKFLOW_ANALYSIS.md).

Retain a new supplier request C with the same supplier configuration, its own
requestId, parentRequestId set to conapi-supplier-a-20261012 and period free.
To pause once after its actual primary native prepare completes, the existing
adapter's public progress callback can retain that event and return control
to the operation runner. The following one-time continuation invocation uses
the actual Workflow and adapter; it adds no replacement data or report engine:

~~~python
from pathlib import Path
from workflow_engine import Workflow, read_json
from workflow_analysis import NativeWorkflowAdapter

project = Path("/absolute/private/conapi/project")
workspace = Path("/absolute/private/conapi/workflow")

class PreparedContinuation(RuntimeError):
    pass

def adapter_factory(configuration, *, workspace, progress):
    def record(event):
        progress(event)
        if event.get("phase") == "PREPARE" and event.get("status") == "COMPLETE":
            raise PreparedContinuation("Continue this original request after the other real source.")
    return NativeWorkflowAdapter(configuration, workspace=workspace, progress=record)

with Workflow(workspace) as operation:
    operation.accept(read_json(project / "supplier-request-c.json"))
    try:
        operation.run("conapi-supplier-c-20261012",
                      read_json(project / "supplier-configuration.json"),
                      adapter_factory=adapter_factory)
    except PreparedContinuation:
        pass
~~~

Run that snippet with the selected Python from the original component directory,
using its actual original paths. It preserves the complete native prepare,
original action IDs and business request in the durable workflow. The progress
exception is recorded as that controlled continuation event.

Now run the complete WRI request B through WORKFLOW_EXAMPLE.json on this same
Analysis workspace/operation. Use its own original business ID and parameters
country USA, minimumCapacityMw 0. It prepares its actual complete WRI edition,
runs its original native query/report/export and changes the source operator's
current edition through the maintained APIs.

Continue supplier C with the normal CLI and its exact retained configuration:

~~~sh
"$CONAPI_PYTHON" -I "$CONAPI_ANALYSIS_COMPONENT/workflow_cli.py" run \
  --workspace "$CONAPI_WORKFLOW" \
  --request-id conapi-supplier-c-20261012 \
  --configuration "$CONAPI_PROJECT/supplier-configuration.json"
~~~

C resumes its original prepared supplier sources after B. Its SQL/report uses
the supplier's exact view/version/revision bindings, and its native archive
selects its own supplier edition. The retained WRI result keeps its own edition
and query/report outputs. Original supplier A still returns its original
result and file hashes when replayed. Read the actual native identities and
selected-source manifests from the completed outcomes.

A changed dated supplier CSV can be exercised in the same way when its actual
native comparison/review workspace is available: configure the real changed
source and corresponding candidate role together, then continue the older
request after that successor. Keep each original request and source edition.

## 5. Export and independently receive the complete supplier project

Export request A to a new complete project filename:

~~~sh
"$CONAPI_PYTHON" -I "$CONAPI_ANALYSIS_COMPONENT/workflow_cli.py" export \
  --workspace "$CONAPI_WORKFLOW" \
  --request-id conapi-supplier-a-20261012 \
  --destination "$CONAPI_PROJECT/Complete_Supplier_Project_A.zip"
~~~

Use the returned archive.sha256 as the receiving selection. The outer ZIP
carries all native Analysis outputs/archive, every supplier manifest member,
coverage originals and outputs, the entire built software archive, original
request/history and selected workflow/Kestra source.

On the separate receiving installation, select its actual source root and
installed Python. Receive into new canonical private directories:

~~~sh
"$CONAPI_PYTHON" -I "$CONAPI_ANALYSIS_COMPONENT/workflow_cli.py" receive \
  --archive /absolute/received/Complete_Supplier_Project_A.zip \
  --sha256 ACTUAL_COMPLETE_OUTER_ARCHIVE_SHA256 \
  --workspace /absolute/private/conapi-received/workflow \
  --analysis-workspace /absolute/private/conapi-received/analysis
~~~

The receiver preserves original business request, result and source identities.
It relocates delivered paths and runs the original native archive receiver.
Its received tree contains:

| Relative location beneath the received workflow | Complete original work |
| --- | --- |
| received/delivery/ | Native source, query/report/workbook outputs and original Analysis archive |
| received/delivery/supplier/ | Original supplier manifest and every declared sibling under the original filename, plus coverage and workflow link |
| received/application/ | Complete original software archive |
| received/workflow/ | Selected workflow code, original guides/profiles and native Kestra source |
| received/intake/ | Complete original request intake |
| received/deployment/ | Actual rendered native flow delivery when configured |

The outer labels keep Supplier_Report_ prefixes in the result; the supplier
directory restores their original basenames. Its unchanged manifest still
declares workspace.json, report/rules, both original sources, changes and actual
accepted outputs. The full original input review is separately retained as
original-supplier-workspace.json.

Reopen the received Analysis application using the original operation ID from
the received configuration, the receiving installation's source root and that
new Analysis directory. This starts the restored operation on its independent
owner. The existing received native source, query/report, workbook and operation
records remain its original project.

Repeating receive for the same outer archive and target continues the original
receiving operation. Re-exporting that received original request uses the
retained application archive and original file map. Choose a new export filename
to record the new handover.

## 6. Make the actual report successor from received originals

The received request's original configuration remains immutable. Configure a new
successor from the complete received source files and review workspace. The
source-role and publisher hashes remain those of the original files.

Set these actual receiving paths:

~~~sh
CONAPI_RECEIVED=/absolute/private/conapi-received/workflow
CONAPI_RECEIVED_ANALYSIS=/absolute/private/conapi-received/analysis
CONAPI_SUPPLIER_FILES="$CONAPI_RECEIVED/received/delivery/supplier"
~~~

Read the restored Analysis operation ID through the same native client. Use the
complete application archive path recorded under received/application, then
configure against the receiving installation:

~~~sh
"$CONAPI_PYTHON" -I "$CONAPI_ANALYSIS_COMPONENT/workflow_cli.py" configure \
  --template "$CONAPI_ANALYSIS_COMPONENT/WORKFLOW_SUPPLIER_EXAMPLE.json" \
  --source-csv "$CONAPI_SUPPLIER_FILES/coverage-pricing-source.csv" \
  --related-csv "catalog=$CONAPI_SUPPLIER_FILES/coverage-catalogue-source.csv" \
  --source-metadata "$CONAPI_SUPPLIER_FILES/coverage-publisher-metadata.json" \
  --related-metadata "catalog=$CONAPI_SUPPLIER_FILES/coverage-publisher-metadata.json" \
  --supplier-component "$CONAPI_SUPPLIER_COMPONENT" \
  --supplier-workspace "$CONAPI_SUPPLIER_FILES/original-supplier-workspace.json" \
  --supplier-table-name supplier_feed_accepted \
  --supplier-pricing "$CONAPI_SUPPLIER_FILES/coverage-pricing-source.csv" \
  --supplier-catalogue "$CONAPI_SUPPLIER_FILES/coverage-catalogue-source.csv" \
  --supplier-metadata "$CONAPI_SUPPLIER_FILES/coverage-publisher-metadata.json" \
  --analysis-workspace "$CONAPI_RECEIVED_ANALYSIS" \
  --operation-id ORIGINAL_RESTORED_32_HEX_OPERATION_ID \
  --source-archive /absolute/private/conapi-received/workflow/received/application/ACTUAL_ORIGINAL_ARCHIVE_FILENAME \
  --output /absolute/private/conapi-received/successor-configuration.json
~~~

Save and run a real report change, selecting the original free billing period:

~~~json
{
  "schema": "stellar-forge.source-workflow-request.v1",
  "requestId": "conapi-supplier-received-successor-20261012",
  "parentRequestId": "conapi-supplier-a-20261012",
  "correlationId": "conapi-supplier-receiving-20261012",
  "profile": "elite-supplier-review",
  "parameters": {"period": "free"}
}
~~~

Use accept, run and export on CONAPI_RECEIVED with this request and the new
successor configuration. The six native SQL sections run from the complete
received originals; selected_period has the actual changed parameter. The
supplier review keeps its original native identity and its new external request
link. The resulting complete project preserves the original delivery-to-successor
relationship.

For a review/rule change, launch the complete original received supplier
application:

~~~sh
node "$CONAPI_SUPPLIER_FILES/supplier-report-cli.mjs" serve --port 8765
~~~

Open the printed localhost URL and adjacent workspace.json, make the intended
native edit, and export its successor workspace. Supply that complete new original workspace and its actual matching
CSV source in a new configuration. The native revision/status, accepted output
and original lineage travel with the report successor.

Finish the joined operation by delivering the complete original and successor
project archives, their returned hashes, original native identities and concise
observed outcome in the existing conapi receiving thread. Keep the exact
configuration and source selections in those projects so the next operator can
continue them directly.

## 7. Open and continue through managed Applications

The complete installed product includes **Datasette source workflow** beside
the original **Datasette customer Analysis** entry. Select the original
workbooks Python installation, workflow directory and actual configured
profile. Review, Save, Start and Open use the existing Applications lifecycle.

For the received original project, set workflowDirectory to CONAPI_RECEIVED.
Leave configurationFile empty to inspect and re-export the retained result.
For the actual successor, select successor-configuration.json produced above
after reopening the restored Analysis operation.

The managed listener checks its original process, workspace ID and exact
configuration against its private launch record and authenticated health
response before exposing Open. Its health response also identifies the
configured native Analysis owner and readiness. The workbench shows the whole
source family, all six SQL sections, report definition and required period
parameter, then retains each original request and successor outcome.

Use the existing Stop control and reopen the same workflow directory to
continue the retained project. The current Open link contains the new local
capability. The native Analysis application retains its separate original
workspace and lifecycle.

[INSTALLATION.md](INSTALLATION.md#managed-source-workflow) contains the exact
Application settings and installed wrapper command. The complete
[product operating guide](../../../../products/datasette/OPERATING.md#operate-a-complete-source-workflow)
connects retained source selection, supplier review, native reports and the
portable receiving journey.
