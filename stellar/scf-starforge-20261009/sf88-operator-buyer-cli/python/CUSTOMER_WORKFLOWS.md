# Python uploads, retained records and file delivery

Use one existing `Buyer` state directory for the customer's reviewed API calls,
saved response records and original paid-file entitlements. Request construction
uses the native SF88 multipart helper and SF30 codec. Stream consumption uses the
native Node `BuyerResult` reader and shared SF31 parser. File continuation uses
the existing `Operation.retrieve_file`, `recover_file` and `FileTransfer` APIs.

Install this package with its matching original runtime checkout, including
[request-body.mjs](../request-body.mjs), the [native stream reader](../node/STREAMS.md)
and [paid-file delivery](../../sf101-merchant-receiver/README.md). The Python
package needs no additional dependency. Its native subprocess default remains
360 seconds.

## Author the exact multipart request

Start with the existing private configuration prepared from the selected merchant
offer. Its URL, method, accepted terms, intent and operator settings remain the
source of the request. The fields in this example match the original Pinata file
upload input: the file plus a selected network and an optional name.

```python
from stellar_forge_buyer import Buyer, MultipartRequest, UploadFile

buyer = Buyer(checkout="/srv/commons", state_dir="/srv/private/customer")
upload = buyer.from_config(
    "/srv/private/reviewed-upload-config.json",
    multipart=MultipartRequest(
        fields={"network": "private", "name": "Quarterly statement"},
        files=(UploadFile("file", "/srv/private/statement.pdf",
                          content_type="application/pdf"),),
    ),
)
upload.configure(request_timeout_ms=180000, response_timeout_ms=120000)
review = upload.review()
print(review.native)

result = upload.execute(review=review)
result.raise_for_status()
print(result.json())
```

Choose fields and response formats from the actual route. The Pinata file upload
returns its normal JSON response; the finite stream configuration below belongs
to a route that offers SSE or NDJSON.

`MultipartRequest.files` accepts `UploadFile(field, path, filename=None,
content_type=None)`. A native selection dictionary is also accepted:

```json
{
  "fields": {"network": "private", "name": "Quarterly statement"},
  "files": [{"field": "file", "path": "/srv/private/statement.pdf",
             "filename": "statement.pdf", "contentType": "application/pdf"}]
}
```

The original helper opens each selected file, reads its bytes, encodes and checks
the complete multipart body, and returns the generated boundary. Python retains
that body under its byte hash inside the operation directory. Native review
shows the decoded field and file details. File selection paths are no longer
needed after preparation; later changes to an original attachment cannot change
the reviewed request.

The encoded request, including multipart framing, can contain up to **16 MiB**.
The same ceiling applies to `body=bytes`, imported native operation handoffs and
existing `operation.bodyFile` configurations. The exact byte count and SHA-256
survive through the native request and accounting continuation. Supplying both
`body` and `multipart` is an input error. An absent body and an explicitly present
empty body keep their distinct native configuration.

`multipart=` works with `Buyer.from_config`, `from_workspace`, `prepare`, and
`Operation.configure`. Headers other than Content-Type survive; the original
encoder supplies the Content-Type boundary. Native schema and operation-ticket
checks apply to the resulting body before the request is executed.

## Configure the offered response and deadlines

For an existing SSE route, configure its original operation:

```python
operation = buyer.from_config("/srv/private/reviewed-event-config.json")
operation.configure(
    request_timeout_ms=180000,
    response_timeout_ms=120000,
    max_response_bytes=64 * 1024 * 1024,
    response_stream={"format": "sse", "maxRecordBytes": 1048576,
                     "maxRecords": 100000},
)
result = operation.execute(review=operation.review())
```

Use `format: "ndjson"` for an offered NDJSON response. Original selected payment
flow, merchant terms and signer configuration remain in the reviewed operation.
The native stream implementation documents the supported
[flow and framing rules](../../sf31-buyer-client/STREAMING.md).

| Setting | Meaning |
| --- | --- |
| `request_timeout_ms` / original `requestTimeoutMs` | Native HTTP exchange deadline, including DNS, TLS, generation, headers and body. Range 1–300000 ms. |
| `response_timeout_ms` | Original response-file capture deadline after the response becomes available. |
| `Buyer(timeout=360)` | Whole native subprocess deadline in seconds, including original operator interaction and accounting. |

An omitted request deadline retains native behavior: the selected stream capture
timeout for streams, otherwise 30000 ms. A top-level `requestTimeoutMs` in an
existing configuration or trusted operator profile passes through unchanged.

## Consume typed records and reopen

```python
for event in result.events():
    # SSEEvent has index, event, data, id and optional retry metadata.
    print(event.index, event.event, event.data, event.id)

reopened = buyer.operation(operation.intent_id).recover()
records = reopened.export_stream(format="sse")
print(records.complete, records.count, records.source)
for event in records.events(start=4):
    use_event(event)
```

The first read asks the original Node reader to verify the entire retained body,
parse it using its original codec, and check its bytes again during consumption.
It publishes `records.jsonl` and `manifest.json` together in a private operation
export directory after that completes. Later reads reuse the same export. Python
verifies the complete exported file before yielding records from the same open
descriptor.

`SSEEvent.json()` explicitly interprets an event's data as application JSON. SSE
data otherwise remains text, including `[DONE]`. Event IDs, retry metadata,
multiline data and source order retain their native meanings.

For NDJSON:

```python
for value in result.ndjson():
    use_row(value)

delivery = result.export_stream(format="ndjson")
for record in delivery.records(start=100):
    # NDJSONRecord retains both original zero-based index and decoded value.
    save_row_and_checkpoint(record.value, record.index)
delivery.file.save_as("/srv/private/customer-records.jsonl")
```

The native parser uses JavaScript JSON number semantics. Precision-sensitive
identifiers and amounts should be represented as strings by the source. The
bridge rejects non-finite decoded numbers instead of changing them to JSON null.
The original raw response remains in its recorded location with its original
digest.

The local typed export defaults to a 256 MiB byte ceiling. `max_export_bytes`
allows an explicit limit up to 1 GiB; `max_record_bytes` and `max_records` pass
additional consumption limits to the native reader. `start` is a zero-based
application checkpoint. Save it in the same transaction as the application's
use of each record when that application needs transactional consumption.

## Inspect a retained incomplete capture

```python
original = buyer.operation("the-existing-intent").recover()
if original and original.delivery.get("status") == "FAILED" and original.stream:
    prefix = original.export_stream(format="sse", allow_partial=True)
    for event in prefix.events():
        inspect_event(event)
    assert prefix.complete is False
```

The native reader verifies the entire partial-file hash and exposes only its
recorded complete-frame prefix. Its original failure, bytes, stream boundary and
accounting outcome remain in the result. Reading records performs local work;
the original payment and merchant recovery APIs remain available on the same
operation.

An existing native CLI, Node or Python result can also be read directly:

```python
from stellar_forge_buyer import read_retained_response

retained = read_retained_response(
    checkout="/srv/commons", config_file="/srv/private/original-config.json",
    result_file="/srv/private/original-result.json",
    cache_dir="/srv/private/record-exports",
)
for event in retained.events():
    use_event(event)
```

That reader binds both original file hashes into the export identity. It does
not add an operation to the buyer's payment state.

Applications using the original SF31 writer directly can pass its retained
response-file view to `export_saved_stream(checkout=..., response_file=options,
saved=receipt, cache_dir=...)`. This returns the same `StreamDelivery` and verifies
the same raw-file bytes. It retains a `SF31_RESPONSE_FILE` source view, without
creating a buyer attempt or assigning a payment outcome.

## Continue the original paid-file delivery

For a merchant's original paid-file handoff, use the same established methods:

```python
file_operation = buyer.from_paid_file(
    "/srv/private/original-file-handoff.json",
    workspace="/srv/private/original-native-workspace",
    intent_id="the-file-order-intent",
)
purchase = file_operation.execute(review=file_operation.review())

# On the first download or after reopening this same intent:
delivery = file_operation.recover_file()
if delivery is None:
    progress = file_operation.inspect_file_transfer()
    print(progress.status, progress.retained_bytes, progress.resumable)
    delivery = file_operation.retrieve_file(resume=True, timeout_ms=120000)
with delivery.open() as product:
    import_product(product)
```

The original `SF101_CLAIM_TOKEN` environment variable supplies the merchant claim
credential where required. The destination is retained before native transfer
begins. `FileTransfer`, `DeliveryError` recovery fields, Range/ETag handling and
whole-file verification are the existing paid-file implementation. Upload,
stream and entitlement routes each retain the exact operation they were issued.

## Run the customer command

[`examples/use_api.py`](examples/use_api.py) provides `prepare`, `execute`,
`recover`, `prepare-file`, `inspect-file` and `resume-file` over these same APIs.
Run it from the installed package environment:

```sh
python examples/use_api.py --checkout /srv/commons --state /srv/private/customer prepare \
  --discovery /srv/private/observed-offers.json --row 0 --accept 0 \
  --intent the-selected-upload-intent --url "$OBSERVED_UPLOAD_URL" --method POST \
  --multipart /srv/private/selected-files.json --profile /srv/private/operator-profile.json

python examples/use_api.py --checkout /srv/commons --state /srv/private/customer execute \
  --intent the-selected-upload-intent

python examples/use_api.py --checkout /srv/commons --state /srv/private/customer recover \
  --intent the-existing-stream-intent --format sse --records /srv/private/events.jsonl

python examples/use_api.py --checkout /srv/commons --state /srv/private/customer resume-file \
  --intent the-file-order-intent --transfer-timeout-ms 120000
```

Select `--format` during preparation only for the response format offered by that
route. Recovery reads the retained result; `resume-file` first checks for an
already completed original product before invoking its transfer continuation.
