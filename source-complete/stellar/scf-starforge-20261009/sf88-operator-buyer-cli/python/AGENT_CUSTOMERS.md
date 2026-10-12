# Persistent LangChain and LangGraph customers

`CustomerWorkflow` connects the existing Python Buyer to an agent application.
It uses the original saved intent, native review, attempt, file transfer and
response reader, then retains application progress in a local LangGraph SQLite
checkpointer. A customer can select a request, resume the same review, consume
its response, restart, and hand the retained product to another application.

The integration is optional. The base Buyer and portable delivery reader keep
their existing standard-library installation. Install the framework extra from
the original checkout when an agent application needs it:

```sh
python -m pip install './stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python[agents]'
```

The tested framework versions are LangGraph 1.2.14, SQLite checkpointer 3.1.1,
LangChain Core 1.6.9 and Pydantic 2.14.0 on Python 3.12.14. The extra declares
these minimum compatible versions. Python's existing requirement remains 3.11+
for the package. Use the matching original Node checkout/runtime described in
[README.md](README.md); the framework does not install a second payment runtime.

## Prepare with the original Buyer

Keep request authoring and private native configuration in the host application.
All original entry points remain available: `prepare`, `from_config`,
`from_workspace`, `from_operation_handoff` and `from_paid_file`. The existing
[multipart and response workflow](CUSTOMER_WORKFLOWS.md) supplies a complete
16 MiB native request body, SSE/NDJSON reader and paid-file example.

For example, the host can prepare a merchant-selected request and pass the
resulting intent to its agent:

```python
from stellar_forge_buyer import Buyer, MultipartRequest, UploadFile

buyer = Buyer(checkout=checkout, state_dir=customer_state, timeout=360)
operation = buyer.prepare(
    discovery_file=saved_discovery,
    row=selected_resource,
    accept=selected_terms,
    intent_id=stable_intent_id,
    url=selected_merchant_url,
    method="POST",
    multipart=MultipartRequest(
        fields=merchant_fields,
        files=(UploadFile(merchant_upload_field, selected_local_document),),
    ),
)
operation.configure(
    operator_profile=private_native_operator_profile,
    request_timeout_ms=180_000,
    response_timeout_ms=120_000,
    response_stream={"format": "ndjson"},
)
```

The variables above are the application's actual selected discovery, merchant
contract and local document. The original body encoder, schema checks, byte pins,
operator configuration and approval behavior all run through the original Buyer.
Retain `stable_intent_id`; on subsequent application starts use
`buyer.operation(stable_intent_id)` to reopen it.

## A durable customer run

```python
from stellar_forge_buyer.agent_workflow import CustomerWorkflow

with CustomerWorkflow(buyer) as customer:
    customer.register("invoice-analysis-2026-10", intent_id=stable_intent_id,
                      format="ndjson")
    state = customer.start("invoice-analysis-2026-10")
    # For a prepared intent, state contains the original review and review_key.
    # The application selects that exact saved review using its normal UI.
```

`register` is idempotent for the same run/source/options. The run's source binding
is immutable. A changed selection needs a different run identifier; the original
intent still owns its single attempt. `start` reopens an existing checkpoint and
returns a pending decision without manufacturing a new review or another request.

Continue a selected review, including from a fresh process:

```python
with CustomerWorkflow(buyer) as customer:
    state = customer.inspect("invoice-analysis-2026-10")
    selected_key = state["review_key"]  # bind the exact review selected by the application
    result = customer.resume("invoice-analysis-2026-10",
                             action="execute", review_key=selected_key)
```

`execute` may perform the original paid request. The original configured
operator/signing authority, exact configuration/body hashes and native approval
still apply. A node restarted after native completion calls `Operation.recover()`
first. If the original attempt exists without a recoverable result, the run
returns its actual recovery state. It does not create a replacement intent or
repeat an unknown attempt.

`resume(action="recover")` reopens that same native result. `action="review"`
reassesses the original state and can produce a fresh native review while the
original intent is still prepared. `action="cancel"` ends the customer graph;
it does not undo a previously executed native operation.

| Saved state | Customer behavior |
| --- | --- |
| `REGISTERED` | Source/options are retained; graph has not started. |
| `REVIEW_REQUIRED` | Exact original review is retained and exposed as a graph interrupt. |
| `RECOVERY_REQUIRED` | Native error/state is retained; an explicit continuation reopens it. |
| `AVAILABLE` | Retained customer data can be read or exported. Native payment/HTTP status stays separate. |
| `CANCELLED` | This customer graph has ended through its recorded decision. |

## Native typed LangChain tools

```python
from stellar_forge_buyer.agent_tools import create_tools

with CustomerWorkflow(buyer) as customer:
    tools = create_tools(customer)
    # Pass tools to the host's existing LangChain agent or LangGraph ToolNode.
    # The customer object remains open for the lifetime of those tool calls.
```

The tools are actual `StructuredTool` instances with explicit Pydantic argument
schemas, synchronous and asynchronous callables, and `content_and_artifact`
responses. No model provider, model API key or separate agent server is required.

| Tool suffix | Operation |
| --- | --- |
| `operations`, `operation` | Read original saved intents and native delivery summaries. |
| `runs`, `inspect` | Read persistent graph progress and pending decisions. |
| `register` | Bind a stable customer run to an original intent and response format. |
| `start` | Recover available data or expose the original prepared review. |
| `resume` | Execute the selected review, recover, reassess, or cancel. |
| `read` | Consume verified retained records or file metadata by record offset. |
| `export` | Produce or reopen the private portable customer handoff. |

Use a standard ToolCall envelope when invoking directly if the host needs the
full `ToolMessage.artifact`:

```python
read_tool = next(tool for tool in tools if tool.name == "stellar_forge_read")
message = read_tool.invoke({
    "name": read_tool.name,
    "type": "tool_call",
    "id": "read-customer-page-1",
    "args": {"run_id": "invoice-analysis-2026-10", "offset": 0, "limit": 20},
})
page = message.artifact
# await read_tool.ainvoke(the_same_tool_call_shape) uses the same original workflow.
```

The default model content cap is 6,000 characters. An oversized result is visibly
marked `content_truncated`, while its complete selected page remains in the
artifact. Request a smaller page or a JSON Pointer to select a field. The model
receives route summaries without request query values or authorization headers.
Private operator profiles, signer settings, local upload paths and claim secrets
are host inputs, not model tool arguments. Hosts can supply original file options
by intent with `create_tools(..., file_options_by_intent={intent_id: options})`.

A workflow invoked from a tool inside another LangGraph supplies its own explicit
thread coordinates; it never copies the host's `configurable` values or private
Pregel state. The installed LangGraph 1.2.14 configuration handling clears ambient
checkpoint coordinates for that explicit thread. The customer's review remains
an interruption in its own persisted graph, returned as ordinary tool data to the
host graph. See the native [interrupt](https://docs.langchain.com/oss/python/langgraph/interrupts)
and [persistence](https://docs.langchain.com/oss/python/langgraph/persistence) contracts.

## Consume actual response formats

```python
page = customer.read(run_id, offset=40, limit=20, pointer="/customer/id")
```

JSON Pointer follows the JSON document for JSON responses and each value for
NDJSON/CSV records. SSE normally retains the original event, data, id and retry
fields. Select `event_json=True` to call the existing `SSEEvent.json()` explicitly,
then apply the pointer to that application JSON:

```python
events = customer.read(run_id, offset=1, limit=10,
                       event_json=True, pointer="/meta/domain")
```

The typed SSE/NDJSON export is produced by the original Node reader and reopened
through the existing Python `StreamDelivery`. There is no second framing parser.
JSON and CSV use the original verified response readers. Binary and paid-file
formats return metadata for the original verified file.

`format="paid-file"` first reopens `recover_file()` and preserves its native
transfer result. A completed local file delivery can be consumed even when that
original development/operator flow has no recorded payment attempt. In that
case the artifact explicitly records `ORIGINAL_FILE_DELIVERY` and
`purchase_attempt_recorded: false`. When a purchase exists and the product still
needs delivery, the workflow calls the original resumable `retrieve_file` path.

For an existing native SF31 response writer capture, use the separate source
registration API without creating a Buyer attempt:

```python
customer.register_saved_stream(
    "retained-events",
    response_file=actual_writer_configuration,
    saved=actual_saved_or_failed_response_file_view,
    source=actual_source_provenance,
    allow_partial=True,
)
customer.start("retained-events")
```

The original reader validates the recorded bytes, SHA and complete-record prefix.
An intentionally stopped stream remains `complete: false` with its original
native error. `AVAILABLE` means selected data is readable; it does not replace
native payment classification, successful HTTP status, or stream completion.

## Portable handoff and restart

```python
from stellar_forge_buyer.agent_workflow import CustomerDelivery

handoff = customer.export(run_id)  # private, create-only, stable digest directory
# Save handoff["directory"] and handoff["manifest_sha256"] with the customer's work.
portable = CustomerDelivery.open(
    handoff["directory"], expected_manifest_sha256=handoff["manifest_sha256"]
)
next_page = portable.read(offset=20, limit=20)
```

The handoff contains `delivery.json`, the original native receipt/view, exact raw
response bytes and any typed records or JSON derivative. Each file has a retained
SHA and size; the source manifest binds the original run/artifact. Repeated export
returns the same package with `reused: true`. The package can be moved as a whole
and opened without the original state directory, Node, LangGraph, or source URL.
Only the base Python package is needed for portable reading. An expected manifest
hash selects the exact package; file hashes alone do not establish sender trust.

The default graph directory is `STATE/agents`, containing SQLite checkpoints,
immutable run bindings, original review snapshots and customer artifacts. Close
`CustomerWorkflow` before the original workspace backup. The existing
`buyer.workspace_recovery()` includes Buyer state; if a custom graph directory
is outside that state, pass it through the original recovery `include` option.
See [RECOVERY.md](RECOVERY.md) for the existing coordinated native backup/restore.

## Installed command line and example

```sh
stellar-forge-agent --checkout /original/checkout --state /private/customer register report-1 ORIGINAL_INTENT --format ndjson
stellar-forge-agent --checkout /original/checkout --state /private/customer start report-1
stellar-forge-agent --checkout /original/checkout --state /private/customer inspect report-1
stellar-forge-agent --checkout /original/checkout --state /private/customer resume report-1 --action execute --review-key EXACT_SELECTED_REVIEW_SHA
stellar-forge-agent --checkout /original/checkout --state /private/customer read report-1 --offset 0 --limit 20
stellar-forge-agent --checkout /original/checkout --state /private/customer export report-1
stellar-forge-agent read-delivery /private/handed-off-package --manifest-sha256 EXACT_MANIFEST_SHA --offset 20 --limit 20
```

`attach-stream RUN native-response.json` accepts the retained writer envelope
`{writerOptions, responseFile, source}` and optional `--allow-partial`.
`--directory` selects an existing separate graph workspace; `--timeout` preserves
the native parent timeout, default 360 seconds. The command is also available as
`python -m stellar_forge_buyer.agent_workflow`.

[examples/agent_customer.py](examples/agent_customer.py) is a runnable host that
selects an existing intent, exposes/reopens its review, uses a native typed tool,
and exports available data. Its explicit `--action` continues the saved decision.

## Native customer operation

This integration was used with the installed framework versions above and actual
retained native inputs: two complete Lichess game records, three Wikimedia events
whose deliberately interrupted stream remained incomplete, and the original
1,048,576-byte local file delivery with zero additional HTTP requests. A separate
host LangGraph received the original review of the retained 1,070,525-byte
multipart request as tool data. A fresh process reopened the same checkpoints,
resumed that exact review to cancellation, and reopened all three byte-identical
customer handoffs. The existing native payment attempts and captures were not
replayed. No additional test suite or model/provider request is included.
