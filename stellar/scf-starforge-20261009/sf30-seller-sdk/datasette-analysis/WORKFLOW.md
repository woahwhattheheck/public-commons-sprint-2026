# Source request, analysis and delivery operator

This application takes an original API or JMS business request through the installed Datasette source product, native Analysis queries and reports, correlated result delivery, and a complete editable project handover. It is part of the existing Datasette product selection. The operator uses a neutral industrial interface with request, source/report, delivery and history views.

## Installed components

| Component | Responsibility |
| --- | --- |
| `workflow_engine.py` | Durable original requests, source/configuration identity, native operation continuation, result and delivery state, complete project export and receiving |
| `workflow_analysis.py` | Existing Datasette capture and edition APIs, original Analysis workspace, selected SQL/report/workbook outputs and native workspace archives |
| `workflow_cli.py` | Direct operation, commissioning configuration, gateway and broker integration commands |
| `workflow_server.py`, `workflow_app.*` | Local operator, authenticated gateway API, complete file downloads and receiver inbox |
| `kestra/` | Six complete native flows, deployment renderer, original JMS transport bridge and native header producer |
| `WORKFLOW_ANALYSIS.md`, `WORKFLOW_EXAMPLE.json`, `WORKFLOW_SUPPLIER_EXAMPLE.json` | Native source/Analysis configuration, retained WRI profile and original paired supplier CSV profile |
| `products/conapi/supplier-report/` | Original supplier CSV parser, comparison/rules engine, editable browser, CLI export and complete catalogue coverage |

Run on Linux with Python 3.11 or later and the existing installed Analysis dependencies. The original Datasette capture route uses the installed Node runtime. The selected Kestra version, plugins and JMS provider dependencies are recorded in [the native flow guide](kestra/README.md) and [its source selection](kestra/NATIVE_SOURCES.json).

The existing `starforge datasette-analysis` wrapper requires the original runtime and installed Python selection before `-- workflow`. Read these values from the retained runtime binding and Python installation; `runtimeId` is 24 lowercase hexadecimal characters and `installationId` is 64. The wrapper selects that installation's Python and complete product source:

```sh
starforge datasette-analysis \
  --runtime-workspace /var/lib/conapi/runtime-workspace \
  --runtime-directory /var/lib/conapi/runtime \
  --runtime-id ACTUAL_24_HEX_RUNTIME_ID \
  --installation-id ACTUAL_64_HEX_PYTHON_INSTALLATION_ID \
  -- workflow status --workspace /var/lib/conapi/workflows --history
```

Use the actual absolute directories and IDs from the installation. A direct Python invocation is also supported from that same installed source. In the commands below, `python3` is the selected installation's Python; use its absolute `installation.python` path when it is not the current shell's interpreter.

## Bind the actual installation

The native Analysis operator stays open in its own terminal or service. Set `CONAPI_SOURCE` to the selected binding's actual `sourceRoot`; the example shows a built package's `source` directory. Reuse the native Analysis operator's actual workspace and original 32-character operation ID:

```sh
CONAPI_SOURCE=/opt/tjlabs/merchant/source
ANALYSIS_ROOT="$CONAPI_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis"
python3 -I "$ANALYSIS_ROOT/cli.py" serve --workspace /var/lib/conapi/analysis --operation-id ACTUAL_32_HEX_OPERATION_ID --port 0
```

For a new native Analysis workspace, generate its operation ID once and retain that ID in the installation. For an existing workspace, read its actual operation ID. The workflow adapter checks that it is talking to that same original operation. [WORKFLOW_ANALYSIS.md](WORKFLOW_ANALYSIS.md) gives the full native receiving and original source sequence.

Prepare the actual source/report template. Its `profile` is the business profile emitted by the original gateway. Its source can be a complete native handover, retained customer edition, fresh Datasette capture, or an original CSV file with its publisher metadata and reviewed key. Its SQL references reviewed original collection and column names and binds the business parameters through the native query parameter interface.

Render the native deployment first when using JMS. The renderer needs the final intended worker configuration path; it can render before that configuration file is created:

```sh
python3 "$ANALYSIS_ROOT/kestra/render_flows.py" --deployment /etc/conapi/kestra-deployment.json --output /etc/conapi/rendered-flows
python3 -I "$ANALYSIS_ROOT/workflow_cli.py" configure --template /etc/conapi/profile-template.json --source-handover /var/lib/conapi/source/Original_Handover.json --analysis-workspace /var/lib/conapi/analysis --operation-id ACTUAL_32_HEX_OPERATION_ID --source-archive /var/lib/conapi/source/Complete_Datasette_Product.zip --flow-delivery /etc/conapi/rendered-flows/flow-delivery.json --output /etc/conapi/customer-workflow.json
```

Use the complete original built Datasette product archive as `sourceArchive`. The maintained product distribution build and receiving commands are documented in [the product guide](../../../../products/datasette/README.md). The outer workflow handover includes that original archive plus the complete workflow and Kestra source selected for this operation.

`configure` resolves and hashes the real selected files. The command also supports repeated `--related-handover ALIAS=PATH` for complete named companion feeds. It hashes configured `source` and `relatedSources` handovers or editions, the complete application source archive, and the full rendered flow delivery. Supplying `--source-handover` selects that original source; omit it when the template already selects a retained edition or fresh Datasette capture.

For two related feeds, set a stable `sourceAlias` and name the other source in `relatedSources`. The native adapter keeps each complete edition and its reviewed mappings and supports useful queries joining those actual sources. The detailed native contract and supported SQL tokens are in WORKFLOW_ANALYSIS.md.

Keep broker and callback credential values in the installation's secret service or process environment. Configuration carries ordinary references to their names. The native deployment's result destination, correlation mode and optional reply destination must match `delivery.jms` in the worker profile.

## Supplier review and catalogue coverage

The installed Datasette selection includes the complete original supplier product at
`products/conapi/supplier-report/`. The same distribution exposes
`starforge supplier-report`; arguments go unchanged to the maintained supplier CLI.
The original module, CLI, editable browser, rules, source examples and operating guides
are included in the application source archive.

Start with `WORKFLOW_SUPPLIER_EXAMPLE.json` and the original supplier comparison
workspace. A source of kind `csv` retains the complete CSV bytes, original publisher
metadata, reviewed key columns and parser identity. The main price feed uses its
original `name` key; the companion catalogue uses its original `url` key. Both are
imported through the native Analysis source-document interface. Each cell keeps its
original string spelling, including blank amounts, explicit zeroes and the publisher's
period wording. Review and projection remain part of the native source edition.

Bind actual installed paths once:

```sh
SUPPLIER_ROOT="$CONAPI_SOURCE/products/conapi/supplier-report"
python3 -I "$ANALYSIS_ROOT/workflow_cli.py" configure \
  --template "$ANALYSIS_ROOT/WORKFLOW_SUPPLIER_EXAMPLE.json" \
  --source-csv /var/lib/conapi/source/published-pricing.csv \
  --source-metadata /var/lib/conapi/source/datapackage.json \
  --related-csv catalog=/var/lib/conapi/source/services-catalogue.csv \
  --related-metadata catalog=/var/lib/conapi/source/datapackage.json \
  --supplier-component "$SUPPLIER_ROOT" \
  --supplier-workspace /var/lib/conapi/supplier/reviewed.json \
  --supplier-table-name supplier_feed_accepted \
  --supplier-pricing /var/lib/conapi/source/published-pricing.csv \
  --supplier-catalogue /var/lib/conapi/source/services-catalogue.csv \
  --supplier-metadata /var/lib/conapi/source/datapackage.json \
  --analysis-workspace /var/lib/conapi/analysis \
  --operation-id ACTUAL_32_HEX_OPERATION_ID \
  --source-archive /var/lib/conapi/source/Complete_Datasette_Product.zip \
  --flow-delivery /etc/conapi/rendered-flows/flow-delivery.json \
  --output /etc/conapi/supplier-workflow.json
```

Use the actual original filenames and workspace selected for the request.
`--related-csv ALIAS=PATH` and `--related-metadata ALIAS=PATH`
can be repeated for other named sources. Existing descriptor paths in the template
are also resolved and hashed when no override is supplied. The profile retains the
original source and publisher fields, exact CSV/parser hashes and complete supplier
workspace hash. The native supplier request and comparison identities stay attached
to their original reviewed workspace and are explicitly linked to this business request.

`delivery.supplier.sourceBindings` names which original comparison side belongs to each
native CSV source. For example, `{"prices":"candidate"}` binds the actual candidate CSV
in the supplier manifest to the `prices` edition's complete source hash. Choose `baseline`
when that is the original selected side. The catalogue coverage's `pricingAlias` and
`catalogueAlias` bind its original CSVs to the same named native editions. These explicit
bindings keep a reviewed comparison attached to its actual source files.

The native adapter runs the original supplier exporter beneath the request's private
workspace, generates the complete original-source catalogue coverage, and joins all
files to the native Analysis delivery. The public result includes the supplier's actual
request, comparison, revision and status with the complete attachment name map.

A complete workflow handover places these files together under
`delivery/supplier/` using their original basenames. The CLI manifest remains
beside `workspace.json`, `review.html`, original sources, rules and report files.
The Source and report tab shows the original supplier comparison, revision and review
status and can download the complete project directly. After `workflow receive`, run
`node RECEIVED_WORKSPACE/received/delivery/supplier/supplier-report-cli.mjs serve --port 8765`,
open the printed localhost address, and load the adjacent `workspace.json` to continue
review. The supplier manifest retains every original data file and all editor, CLI,
coverage and attachment source files so this received directory can export the next
complete reviewed edition. Export that complete reviewed workspace through
the installed supplier CLI, then select its new original workspace for a successor
business request. Re-exporting the received workflow preserves this directory layout,
its original manifest and every complete attachment.

See the supplier component's `NATIVE_ATTACHMENTS.md` and
`CATALOGUE_COVERAGE.md` for the complete file and source contracts, and
`WORKFLOW_ANALYSIS.md` for paired native source queries and report continuation.

## Open the operator

```sh
python3 -I "$ANALYSIS_ROOT/workflow_cli.py" serve --workspace /var/lib/conapi/workflow --configuration /etc/conapi/customer-workflow.json --port 0 --open
```

The command prints the local URL and saves it in the private workspace. Open that complete URL. The application binds to 127.0.0.1 and protects its API with a per-launch capability. A browser reload retains the current connection for that tab.

The operator supports:

- Original request entry with business parameters and a saved input draft.
- Source/report continuation, actual native progress and original operation IDs.
- Complete native outputs and complete project downloads.
- Prepared JMS result files and callbacks through the installed customer route.
- Original producer results and customer received-result replies.
- An inbox for complete received business results.
- A successor request copied from an existing request with its parent ID retained.

The Source and report view displays the native outcome, including any partial report or query truncation. A completed transport result carries that same native outcome. The request history retains source, execution, publication and receiving events. Each downloadable file is checked against its full original length and SHA-256 before transfer and again by the browser.

When a process exits during a request, the operating-system request lock is released. The operator then makes continuation available with the same request and native operation IDs. Multiple processes sharing this local workspace use that same lock and SQLite state. Use the original mounted local filesystem selected for the worker; the SQLite/lock workspace is a persistent installation resource.

## Business request contract

```json
{
  "schema": "stellar-forge.source-workflow-request.v1",
  "requestId": "customer-feed-20261012-001",
  "correlationId": "customer-feed-20261012-001",
  "profile": "customer-feed",
  "parameters": {}
}
```

Use the customer's actual identifiers and installed profile. Request IDs are printable strings of 1–200 characters. Repeating the same ID with the same complete original input continues the existing request. A changed source plan or business input uses a successor request ID and can carry `parentRequestId`.

When a native JMS message supplies `correlationId`, it must agree with the business correlation ID. The full original JMS object is retained separately from the normalized business request. The original message identity and actual Kestra execution ID remain in the history.

For a direct gateway handoff:

```sh
python3 -I "$ANALYSIS_ROOT/workflow_cli.py" accept --workspace /var/lib/conapi/workflow --request /var/lib/conapi/intake/business-request.json --transport /var/lib/conapi/intake/native-message.json --execution-id ACTUAL_KESTRA_EXECUTION_ID
python3 -I "$ANALYSIS_ROOT/workflow_cli.py" run --workspace /var/lib/conapi/workflow --request-id customer-feed-20261012-001 --configuration /etc/conapi/customer-workflow.json
python3 -I "$ANALYSIS_ROOT/workflow_cli.py" status --workspace /var/lib/conapi/workflow --request-id customer-feed-20261012-001 --history
```

An API request can omit `--transport`. Every command emits one JSON result; errors return a nonzero exit status. Original native source and Analysis operations are retained and continued under deterministic operation identities.

## Result and receiving contract

The business result envelope contains `requestId`, `correlationId`, `runId`, `deliveryId`, `resultSha256`, and the complete public `result`. That result includes actual source editions, Analysis jobs, report metadata, native operation identities and original output descriptors.

Each file descriptor carries its name, full byte length, SHA-256, content type and original download route. Set `delivery.artifactBaseUrl` to the customer's installed gateway origin when results are consumed outside the local operator. The gateway maps those authenticated file routes to the local API and applies its existing customer access rules.

The canonical result hash uses UTF-8 JSON with sorted keys, compact separators, preserved Unicode, and finite numbers. The stable delivery ID is the first 40 hexadecimal characters of SHA-256 over canonical `{"runId": "...", "resultSha256": "..."}`. The supplied original receiver performs those checks.

| Sender state | Meaning |
| --- | --- |
| RECEIVED | The complete original business input is retained. |
| RUNNING | The native source/report operation has started. The `active` field identifies a currently held worker lock. |
| FAILED | The operation retained its original input and error; continue the same request. |
| RESULT_READY | The native result and complete output descriptors are retained. |
| PUBLISHED | The actual producer or callback returned a successful publication result. |
| DELIVERED | The original customer receipt matches the request, correlation, delivery and full result hash. |

The actual Analysis outcome stays in `result.analysis.status`. Read that field and its report/query details when assessing the source result.

### JMS

The renderer supports actual native batch consumption, realtime intake, result recovery, selected-result receiving and original receipt acknowledgment. Use [kestra/README.md](kestra/README.md) for the complete original plugin configuration, native task fields and six-flow execution sequence.

In `business-properties` mode, the selected original JMS Produce task sets `businessRequestId`, `businessCorrelationId`, `deliveryId` and `resultSha256` as ordinary properties. In `native-header` mode, the supplied producer also sets the actual JMSCorrelationID and optional JMSReplyTo through the provider's native message methods. Select the mode required by the existing customer contract.

A direct publication handoff can prepare the original item, then record the actual provider response:

```sh
python3 -I "$ANALYSIS_ROOT/workflow_cli.py" publish --workspace /var/lib/conapi/workflow --request-id customer-feed-20261012-001 --attempt-id ORIGINAL_ATTEMPT_ID --output /var/lib/conapi/outbox/jms-message.json
python3 -I "$ANALYSIS_ROOT/workflow_cli.py" published --workspace /var/lib/conapi/workflow --request-id customer-feed-20261012-001 --attempt-id ORIGINAL_ATTEMPT_ID --receipt /var/lib/conapi/outbox/producer-response.json
```

The original producer response must contain its actual `messagesCount=1`. Native flow recovery uses the saved request, original attempt ID, delivery identity and complete result. The customer's original receipt can be recorded through `acknowledge` or `reconcile`.

### API callback

An installed callback profile uses:

```json
{
  "delivery": {
    "callback": {
      "url": "https://customer.example/actual-installed-result-route",
      "headersEnv": {"Authorization": "CUSTOMER_CALLBACK_AUTHORIZATION"},
      "timeoutSeconds": 30
    }
  }
}
```

Replace the commissioning address with the actual authorized customer endpoint. The callback sends the complete retained envelope, a stable Idempotency-Key, and headers read from the named environment variables. HTTPS and local HTTP receivers are supported. A successful response is retained as a publication; a matching original receiver receipt also completes delivery. An interrupted callback retains its attempt and can resume.

```sh
python3 -I "$ANALYSIS_ROOT/workflow_cli.py" callback --workspace /var/lib/conapi/workflow --request-id customer-feed-20261012-001 --attempt-id ORIGINAL_CALLBACK_ATTEMPT
```

The supplied receiving operator accepts the original result at `POST /api/results` and returns the corresponding receipt. Its native CLI accepts the same complete body or native JMS envelope:

```sh
python3 -I "$ANALYSIS_ROOT/workflow_cli.py" receive-result --workspace /var/lib/conapi/result-inbox --message /var/lib/conapi/intake/result-message.json --request-id customer-feed-20261012-001 --correlation-id customer-feed-20261012-001 --delivery-id ACTUAL_DELIVERY_ID --expected-result-sha256 ACTUAL_RESULT_SHA256 --correlation-mode native-header
```

For a direct callback body, omit the JMS correlation-mode argument. The receiver retains the complete original result and message. A repeated identical result returns the original receipt with a replay indicator. Return that receipt through the existing customer completion route.

## Complete project handover and continuation

```sh
python3 -I "$ANALYSIS_ROOT/workflow_cli.py" export --workspace /var/lib/conapi/workflow --request-id customer-feed-20261012-001 --destination /var/lib/conapi/delivery/Source_Workflow_Project.zip
python3 -I "$ANALYSIS_ROOT/workflow_cli.py" receive --workspace /var/lib/conapi/received-project --archive /var/lib/conapi/delivery/Source_Workflow_Project.zip --sha256 ACTUAL_OUTER_ARCHIVE_SHA256 --analysis-workspace /var/lib/conapi/received-analysis
python3 -I "$ANALYSIS_ROOT/workflow_cli.py" serve --workspace /var/lib/conapi/received-project --port 0 --open
```

The complete archive includes:

- Every original native result file and the complete native Analysis workspace archive.
- The selected original product source archive.
- The full selected workflow runtime, operator assets, guides and native Kestra source.
- The exact rendered deployment and all six complete native flow definitions when selected.
- Every retained original request intake object, selected configuration, business result, publication and history event.

Receiving checks the complete original archive and every member. It restores into a private staging directory, retains progress across interruption, and moves the completed project into place. Supplying the same archive and receiving directory continues the original receiving operation. `--analysis-workspace` also restores through the original native Analysis archive receiver.

The receiving installation keeps the original configuration identity and binds delivered files to their new local paths. Re-exporting that project retains the delivered original source archive, deployment and request inputs. Its history keeps the original sender events and adds receiving and subsequent operation events.

Recreate the exact selected flows from the received complete deployment:

```sh
python3 "$ANALYSIS_ROOT/kestra/render_flows.py" --receive-delivery /var/lib/conapi/received-project/received/deployment/flow-delivery.json --output /etc/conapi/received-flows
```

To edit the project for a new source plan or a new installation, copy its delivered source/configuration, bind the successor's actual paths and secret references, and create a successor request. Existing business results and their original identities remain available for receiving, delivery recovery and review.

## Gateway API

All local API calls require `X-Workflow-Capability` from the current private launch URL. Browser requests use the original local origin. A server-side gateway can call the loopback API with that capability.

| Method and route | Operation |
| --- | --- |
| GET /api/configuration | Installed profile and useful query metadata |
| GET /api/requests | Original request list and active worker state |
| GET /api/requests/{id}?history=true | Full request, native result, publications and history |
| GET /api/requests/{id}/envelope | Complete correlated business result |
| GET /api/requests/{id}/files/{name} | Complete original output or project download |
| GET /api/inbox | Original received-result receipts |
| POST /api/requests | Retain `request`, optional `transport` and `executionId` |
| POST /api/requests/{id}/run | Continue the selected original native operation |
| POST /api/requests/{id}/publish | Prepare an original JMS attempt |
| POST /api/requests/{id}/published | Record actual `messagesCount` and provider response |
| POST /api/requests/{id}/callback | Continue the selected original callback attempt |
| POST /api/requests/{id}/acknowledge | Receive the original customer receipt |
| POST /api/requests/{id}/export | Prepare the complete editable project |
| POST /api/results | Retain the complete customer result and return its receipt |


## BDNB territory and complete customer receiving

The [BDNB product entry](../../../../products/ntico/bdnb-territory/README.md) composes
original publisher files, explicit source dictionaries, territory selections,
edition correspondence, individual reviews and complete Analysis reports,
workbooks, streaming annexes and workspace archives in this same application.
The mounted **BDNB territory** operator and exact CLI requests share its native
database and request history.

Use the [complete receiving programme](../../../../products/ntico/bdnb-territory/RECEIVING.md)
for producer → customer review → returned archive → independent reopen, and the
[original workflow profile](../../../../products/ntico/bdnb-territory/WORKFLOW.md)
for commissioned API/Kestra/JMS delivery and its real recipient receipt.
