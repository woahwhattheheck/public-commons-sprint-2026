# Configured supplier HTTPS intake and delivery

For daily document preparation, sending, provider-result recovery and customer
handover, start with the [customer operating guide](GUIDE.md). This reference is
for the host operator configuring the agreed HTTPS connection and for client
implementers using its retained records.

This is the HTTPS continuation of the existing supplier order workspace. It receives complete original ORDER XML into the same source/document store, and sends a reviewed native confirmation, dispatch notification or invoice through a channel configured by the host operator. The existing order revisions, original XML, file downloads, operation IDs and portable customer package remain authoritative.

The public Unite interface documentation establishes an onboarding sequence—consultation, development/test, then access setup and activation—and identifies openTRANS 1.0 and HTTPS as the usual choices. It does not publish a universal account URL, authentication scheme, transport acknowledgment body or retry guarantee. Configure the actual connection sheet agreed for the supplier. The implementation does not infer those details from an HTTP success code or a receipt-only ORDERRESPONSE. The latter is a business response that Unite says it does not process as an availability confirmation.

Sources: [current interface overview](https://support.unite.eu/en-gb/for-suppliers/edi-interfaces-for-order-processing), [order transfer](https://support.unite.eu/en-gb/for-suppliers/order-transmission-interface), [confirmation](https://support.unite.eu/en-gb/for-suppliers/order-confirmation-interface), [dispatch](https://support.unite.eu/en-gb/for-suppliers/dispatch-notification-interface), [invoice](https://support.unite.eu/en-gb/for-suppliers/invoice-interface), and [original EDI guide 3.3](https://unite.eu/assets/support/nl/mercateo-edi-3-3supplier_en-1.pdf). The checked source contract is retained in source/UNITE_HTTPS_TRANSPORT.json.

## Prepare one negotiated channel

Node 24+, Python 3 and the original selected supplier-order source/package are required. TLS uses Node's normal certificate verification. No new service, database or worker queue is installed.

The host owns a regular JSON configuration file. URLs and authentication are never taken from a browser action, MCP tool request or imported customer package. A missing configuration preserves the existing manual workspace behavior and exposes an empty channel list.

The following is a template. The reserved example domains, credentials, statuses, supplier number and certificate paths must be replaced by the actual test connection agreement before use. Its status sets are example selections, not published Unite defaults.

~~~json
{
  "schema": "stellar-forge.supplier-order-https-config.v1",
  "channels": [
    {
      "id": "supplier-test",
      "title": "Agreed supplier test connection",
      "mode": "test",
      "supplierId": "ACTUAL_AGREED_SUPPLIER_IDENTIFIER",
      "agreement": { "reference": "Actual onboarding connection sheet and revision" },
      "incoming": {
        "url": "https://supplier.example.invalid/edi/order",
        "auth": {
          "type": "basic",
          "usernameEnv": "SUPPLIER_EDI_IN_USER",
          "passwordEnv": "SUPPLIER_EDI_IN_PASSWORD"
        },
        "messageIdHeader": "x-agreed-message-id",
        "acknowledgment": {
          "statusCode": 200,
          "contentType": "text/plain; charset=utf-8",
          "body": "OK"
        }
      },
      "outgoing": {
        "endpoints": {
          "ORDERRESPONSE": "https://recipient.example.invalid/edi/confirmation",
          "DISPATCHNOTIFICATION": "https://recipient.example.invalid/edi/dispatch",
          "INVOICE": "https://recipient.example.invalid/edi/invoice"
        },
        "contentType": "application/xml",
        "auth": { "type": "bearer", "tokenEnv": "SUPPLIER_EDI_OUT_TOKEN" },
        "acknowledgment": {
          "acceptedStatusCodes": [200],
          "rejectedStatusCodes": [400, 422],
          "receiptHeader": "x-agreed-receipt"
        },
        "timeoutMs": 30000,
        "maxResponseBytes": 1048576
      }
    }
  ],
  "intake": {
    "host": "0.0.0.0",
    "port": 8443,
    "certFile": "./private/supplier-cert.pem",
    "keyFile": "./private/supplier-key.pem"
  }
}
~~~

Omit a document endpoint when that document kind has not been negotiated. Omit incoming or outgoing entirely for a one-direction channel. Each channel needs at least one direction. The original supplier number must agree with the workspace's first original ORDER. A different supplier belongs in its own workspace.

Supported authentication is Basic or Bearer. Configuration contains environment variable names only. The native process resolves their actual values immediately before authentication/send. Do not put a token in a URL, operation reason, provider reference or configuration field. Public channel details show the reference names and scheme, not the values. Password/key handling stays with the host's existing deployment.

Optional outgoing tls supports caFile and the paired certFile/keyFile for a negotiated client certificate. Relative file paths resolve against the configuration directory. Private key files must be regular files with no group/other permissions. Verification cannot be disabled. The HTTPS listener also requires the selected server certificate and private key. The private browser remains a separate loopback HTTP listener with its existing token and origin gate.

Every URL must be canonical HTTPS without credentials, query parameters or fragments. Transfers do not follow redirects. The configuration supports raw application/xml or text/xml POST, not a provider-specific multipart envelope, FTP, SFTP, AS2 or a generic webhook action.

For acknowledgments, declare accepted 2xx statuses and any statuses the agreement explicitly establishes as *definitely not accepted*. Do not treat every 4xx/5xx as safe to retry. If the agreement prescribes an exact response body, set exactBodySha256 to its complete SHA-256. receiptHeader is an optional dedicated response header. maxResponseBytes bounds retained response bytes; a larger or interrupted response remains UNKNOWN with its retained prefix and observed length, never a false acknowledgment. A complete response is retained even when its status is unrecognized.

A channel marked **Test** still performs a real HTTPS POST to its configured
endpoint. Select the endpoint owner's actual test service and agreement. The label
does not create a simulator, activate an account or certify an integration.

The configuration is snapshotted when the workspace opens. Close and reopen after editing its channel fields. Channel fingerprints include the negotiated public selection and credential reference names. Rotating the value of an existing credential does not revise the business channel.

## Start intake and the private desk

Use absolute workspace, configuration and request-file paths with the installed
launcher. Several browser clients may share one running host. Close that host
before starting a separate CLI or merchant host over the same workspace.

~~~sh
starforge supplier-orders serve \
  --workspace /srv/supplier-orders/supplier \
  --transport-config /srv/supplier-orders/config/channels.json \
  --https-intake
~~~

This prints the private browser URL and the configured intake channel URLs. It does not make an outgoing send. Publish the configured HTTPS endpoint through the supplier's existing network setup; the request Host and path must match the exact configured URL. The optional listener host/port describe the actual local bind; the public URL can use the agreed reverse-proxy port when that proxy preserves the original Host and path.

To run just the receiving listener:

~~~sh
starforge supplier-orders intake \
  --workspace /srv/supplier-orders/supplier \
  --transport-config /srv/supplier-orders/config/channels.json
~~~

The receiver accepts authenticated raw XML POST up to 64 MiB, validates complete EOF and content length, retains the original bytes, and then invokes the existing native openTRANS parser. It only accepts ORDER documents for its declared supplier. Original DTD and business findings remain available in the same workspace.

The first original ORDER initializes that order's current selection. A later received edition remains in history for explicit operator review/current selection; receiving never overwrites a newer local order revision automatically.

When messageIdHeader is configured it is mandatory and identifies the provider's exact original message. Reusing it with different bytes or a different selected channel produces a conflict. Without that header the original whole-body SHA identifies a repeated message on the channel. A duplicate completed receipt returns the same configured acknowledgment and the same transmission ID without inserting another document or selecting another revision.

A successful configured acknowledgment is returned only after RECEIVED and the original document operation are durable. It says that this receiver retained the document. The record's recipientProcessing separately indicates RETAINED or REVIEW. A malformed or foreign-supplier input returns 422 with a retained REJECTED transmission. A temporary parser/runtime/storage failure keeps its complete source and same original operation in RECEIVING; a later same-message retry resumes that operation. A lost acknowledgment therefore has an ordinary same-message continuation.

Intake authentication failures do not retain the submitted body. Busy/closing/transient intake returns a failure rather than the configured success acknowledgment. There is no inbound browser-origin bypass into private operator routes.

## Review, prepare and send

In the private desk, create and review the confirmation, dispatch or invoice through the draft workflow. Prepare its complete native XML first. Open **EDI deliveries → Configured channels** to inspect the available connection. On the prepared document, choose **Prepare transmission**; review the exact document and channel identities, give the reason and retain the ready transmission. **Send this document** makes the separate explicit transfer.

Preparation checks the current original order branch, saved draft revision, native review and supplier identity. The pending intent pins the complete file and channel. The operator may select that same prepared document into current quantities before transport. This exact one-document advance from its pinned source branch is accepted. Send rechecks the same business selection and prospective fulfilment atomically before recording SENDING. If the source branch or draft has advanced, prepare the intended current XML and cancel the obsolete intent.

The full explicit CLI path is:

~~~sh
starforge supplier-orders transport-channels \
  --workspace /srv/supplier-orders/supplier --transport-config /srv/supplier-orders/config/channels.json

starforge supplier-orders prepare-transmission \
  --workspace /srv/supplier-orders/supplier --transport-config /srv/supplier-orders/config/channels.json \
  --request /srv/supplier-orders/requests/prepare-transmission.json

starforge supplier-orders send-transmission \
  --workspace /srv/supplier-orders/supplier --transport-config /srv/supplier-orders/config/channels.json \
  --request /srv/supplier-orders/requests/send-transmission.json
~~~

A preparation request uses actual returned document/channel hashes:

~~~json
{
  "requestId": "supplier-confirmation-prepare-001",
  "documentId": "RETURNED_DOCUMENT_RECORD_ID",
  "expectedDocumentSha256": "RETURNED_DOCUMENT_RECORD_SHA256",
  "channelId": "supplier-test",
  "expectedChannelSha256": "RETURNED_CHANNEL_SHA256",
  "reason": "Send the reviewed current availability confirmation."
}
~~~

The following request selects the returned transmission revision:

~~~json
{
  "requestId": "supplier-confirmation-send-001",
  "transmissionId": "RETURNED_TRANSMISSION_ID",
  "expectedRevision": 1
}
~~~

Copy the actual revision; it is not always 1. Every mutation returns the original workspace operation with result.transmissionId and result.transmission. Retrying the same request ID with the same body returns that saved operation before current-state guards; changing its body conflicts. Never create a new ID merely because a response was lost.

One Send makes one HTTPS POST. The complete source is rehashed before use; the same selected bytes supply the Content-Length and body. Native HTTP status, selected nonsecret response headers, complete response or bounded prefix, observed byte count, provider receipt and exact retained file identity enter the original transmission history. A socket error or receipt-persistence failure cannot produce a successful acknowledgment.

## Interpret and reconcile the outcome

| State | Meaning | Available continuation |
|---|---|---|
| READY | An explicit original delivery intent is prepared. | Send once, or cancel. |
| SENDING | The original operation owns one active native attempt. | Reopen the same operation; do not start another attempt. |
| ACKNOWLEDGED | Complete HTTP response matches the configured transport acknowledgment, or actual provider readback resolved it. | Inspect original response/history; no replay. |
| REJECTED | Complete response matches an explicitly negotiated definite non-acceptance, or incoming original XML was rejected. | Outgoing: reasoned Retry creates READY; incoming: inspect retained original and correct the source. |
| UNKNOWN | The attempt may have delivered but has no durable matching transport acknowledgment. | Read the provider's actual outcome, then Resolve. |
| NOT_ACCEPTED | Actual provider reconciliation established non-acceptance. | Reasoned Retry creates READY. |
| CANCELLED | Operator stopped an unsent/confirmed-not-accepted intent. | Keep history; a deliberate Retry may reopen READY. |
| RECEIVING / RECEIVED | Original incoming XML is pending native receiving / durably retained. | Retry the same incoming message if pending; inspect original record if received. |

On process interruption, the original native operation owner is reconciled through the existing workspace store. An ended SENDING attempt becomes UNKNOWN, preserving its source and attempt ID. It is never automatically replayed. A still-live owner remains active.

In the browser, **Record provider result** records actual provider evidence for
an unknown outcome. The corresponding native `resolve` request is:

~~~json
{
  "requestId": "supplier-confirmation-readback-001",
  "transmissionId": "RETURNED_TRANSMISSION_ID",
  "expectedRevision": 3,
  "outcome": "NOT_ACCEPTED",
  "providerReference": "Actual provider ticket or original receipt reference",
  "reason": "Provider confirmed this exact document SHA was not accepted."
}
~~~

Use ACKNOWLEDGED when that is the actual readback. An optional evidenceFileId plus expectedEvidenceSha256 binds a complete original file already retained in the workspace; the file is rehashed. Provider reference and reason are mandatory even without a file.

~~~sh
starforge supplier-orders resolve-transmission \
  --workspace /srv/supplier-orders/supplier --request /srv/supplier-orders/requests/provider-readback.json
starforge supplier-orders retry-transmission \
  --workspace /srv/supplier-orders/supplier --request /srv/supplier-orders/requests/deliberate-retry.json
~~~

The native `retry` request has requestId, transmissionId, expectedRevision and reason. In the browser, **Prepare another attempt** performs this step and creates READY only. A separate **Send this document** action, with its own request ID and current revision, performs the later POST. Cancel uses the same four fields. Acknowledged deliveries cannot be cancelled or replayed through these actions.

HTTP acknowledgment does not assert order acceptance, inventory reservation, invoice approval or payment. recipientProcessing remains NOT_REPORTED for outgoing transfers. A receipt-only ORDERRESPONSE must not be substituted for the actual availability/cancellation confirmation required by the business interface.

## History, APIs and full receiving

~~~sh
starforge supplier-orders transmissions --workspace /srv/supplier-orders/supplier --direction outgoing
starforge supplier-orders transmission --workspace /srv/supplier-orders/supplier --id ORIGINAL_TRANSMISSION_ID
starforge supplier-orders transmission-history --workspace /srv/supplier-orders/supplier --id ORIGINAL_TRANSMISSION_ID --offset 0 --limit 50
~~~

The public native class is workspace.transport. Methods are channels, list, get, history, prepare, send, retry, resolve and cancel. Lists and histories have bounded complete pages and nextOffset; history also returns transmissionId and the current revision. No record is silently truncated. The whole original events remain in the package.

Private HTTP routes retain the original Host/Origin/Bearer gate:

| Method | Route after /api/supplier-orders | Purpose |
|---|---|---|
| GET | /transport/channels | Host-declared public channel selections |
| GET | /transport/transmissions | Direction/state/order-filtered list |
| GET | /transport/transmissions/:id | Current full receipt, without embedded event array |
| GET | /transport/transmissions/:id/history | Complete paged events |
| POST | /transport/prepare | Pin a reviewed original document and channel |
| POST | /transport/transmissions/:id/send | One explicit native attempt |
| POST | /transport/transmissions/:id/retry | Deliberately reopen an eligible intent |
| POST | /transport/transmissions/:id/resolve | Bind actual provider readback |
| POST | /transport/transmissions/:id/cancel | Retain an unsent cancellation |

The original Merchant supplier-order provider exposes matching transport_channels, transmissions, transmission, transmission_history, prepare_transmission, send_transmission, retry_transmission, resolve_transmission and cancel_transmission tools. Its host workspace alias owns transportConfigPath. Typed names are transportChannels, transmissions, transmission, transmissionHistory, prepareTransmission, sendTransmission, retryTransmission, resolveTransmission and cancelTransmission. Existing native-file downloads receive full response/evidence files with their original byte/hash identities.

Whole export and customer receive remain the original operations:

~~~sh
starforge supplier-orders export --workspace /srv/supplier-orders/supplier --request-id supplier-handover-001 --out /srv/supplier-orders/handover/customer-orders.zip
starforge supplier-orders receive --workspace /srv/supplier-orders/customer --input /srv/supplier-orders/handover/customer-orders.zip --request-id supplier-inspect-001 --mode inspect
starforge supplier-orders receive --workspace /srv/supplier-orders/customer --input /srv/supplier-orders/handover/customer-orders.zip --request-id supplier-receive-001 --mode merge
~~~

The package includes original documents, source XML, transmissions and their complete event histories, retained response/evidence files, source order revisions and original operations. Import verifies new transmission seals and file/document references before merge. Existing current customer selections and newer local revisions retain the original conflict-preserving behavior.

Imported transmission rows are historical. Neither matching IDs nor an imported sender journal authorizes a send: outgoing execution requires this native workspace's identity and its actual local original prepare operation. Endpoint configuration and secrets are never installed from a package. The recipient configures its own channel and prepares its own locally reviewed document when it has a real authorized delivery to make.

The runtime drains actual send/intake tasks before closing their workspace. The separate HTTPS listener stops accepting requests, waits for original receiving operations and closes its sockets. A failed close retains the owner for a retry. Non-serving CLI operations close before printing terminal JSON.

## Maintainer verification with local HTTPS

This section describes an optional product verification operation. Daily operators
use the installed desk and their negotiated connection. Choose one of the
invocations below for a new verification; preserve that selection and the same
operation ID/directories when resuming it.

The installed export supplier-orders/https-receiving provides a complete local TLS receiving program over the retained original publisher ORDER and the native draft/parser/workspace. It uses an isolated local certificate, declared test channel and peer receipt store. It exercises actual authenticated intake, explicit confirmation/dispatch/invoice delivery, lost acknowledgment and actual retained peer readback, controlled non-acceptance/retry, source/history/portable customer reopening and full lifetime closure. It does not connect to a live Unite or implementation-partner endpoint.

This is an executable local integration, not a certification result. Record its actual returned operation/report before asserting completion. A blocked native runtime is a pending receiving operation; it is not a successful test or a live integration.


Run from the verified package root, or use the corresponding path in the selected
source checkout. Supply the actually installed browser module and executable:

~~~sh
node source/stellar/scf-starforge-20261009/sf30-seller-sdk/supplier-orders/receiving/supplier-order-https-native.mjs \
  --directory /srv/supplier-orders/verification/https-receiving \
  --producer /srv/supplier-orders/verification/https-producer \
  --customer /srv/supplier-orders/verification/https-customer \
  --operation supplier-https-verification \
  --browser-module /actual/installed/playwright \
  --browser-executable /actual/installed/chromium
~~~

The program requires existing OpenSSL for its private local test certificate and the original Linux flock helper. Its native typed client calls the actual Merchant supplier-order MCP dispatch; the separate real browser uses the original private HTTP API and downloads the complete retained response. Input/output requests and native operations are retained in the selected receiving directory. Reopen the same directories and operation after interruption. The native test channel is fixed to loopback; no supplier configuration or document is sent to a remote partner.

When the verification is intended to continue an already completed installed
release and its 27-tool customer workflow, choose this invocation with both full
reports instead:

~~~sh
node source/stellar/scf-starforge-20261009/sf30-seller-sdk/supplier-orders/receiving/supplier-order-https-native.mjs \
  --directory /srv/supplier-orders/verification/https-receiving --producer /srv/supplier-orders/verification/https-producer --customer /srv/supplier-orders/verification/https-customer \
  --operation supplier-https-verification \
  --baseline-report /srv/supplier-orders/verification/installed/receiving/baseline/receiving/report.json \
  --operator-report /srv/supplier-orders/verification/installed/receiving/operator/operator-report.json \
  --browser-module /actual/installed/playwright \
  --browser-executable /actual/installed/chromium
~~~

Both original programs must report PASS with closed lifetimes. The following intake verifies their complete report and artifact identities, then receives the operator's whole producer and final customer packages through the original portable importer. Those original workspaces and the signed installer remain unchanged. For an already fulfilled order, the local transport journey prepares a reviewed revision of an existing selected dispatch and invoice; it preserves their business IDs and quantity contributions.

## Customer profile binding

The complete customer declaration is selected before business intake and retained
with original documents and package histories. A customer-profile channel must add
`profileSha256` with the exact current declaration hash to its existing host-owned
channel object. The optional field remains absent for legacy implicit Unite channels,
preserving their original configuration hash and replay identities. The native engine
checks the profile pin at prepare, send and incoming intake. Transport lists apply the
selected order-ID limit; full events retain the source document and profile identity.

See [PROFILES.md](PROFILES.md) for complete browser/CLI/40-tool selection, declared
rules, original source preservation and explicit empty-customer package adoption.
Changing a profile never auto-retries a possibly delivered original message.
