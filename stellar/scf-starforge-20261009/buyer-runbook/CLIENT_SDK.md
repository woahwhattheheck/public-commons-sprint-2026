# Receive a customer SDK and prepare an acquisition

Receive the original seller's complete customer SDK in the existing buyer
runbook workspace, inspect every operation and payment option, configure exact
request inputs, and continue through its original local buyer and acquisition
workflow. The seller's files remain attached to the saved customer request.

The originating workflow is documented in
[SF82 customer SDK handover](../sf82-seller-pilot/CLIENT_HANDOVER.md).
A completed export contains these six original files:

| File | Purpose |
| --- | --- |
| `client-export.json` | Original completion receipt and SHA-256 file identities |
| `seller-openapi.json` | Complete original methods, routes, request schemas and payment options |
| `seller-client.mjs` | Generated JavaScript client |
| `seller-client.d.mts` | Generated TypeScript declarations |
| `package.json` | Original module/package entry points |
| `README.md` | Seller-specific customer client instructions |

The receiving workspace reads these files as retained data. It uses the original
client-export validator and request builder supplied by the installed Starforge
source. It does not import the uploaded JavaScript. The SDK completion receipt
describes the saved export and its source mode; live availability and current
payment terms are reviewed later by the original buyer.

## Open the original workspace

Use the same private configuration directory and local operator preset described
in [WORKSPACE.md](WORKSPACE.md#receive-a-private-merchant-request):

```sh
node stellar/scf-starforge-20261009/buyer-runbook/cli.mjs workspace \
  --state /private/acquisitions/workspace \
  --configs /private/acquisitions/buyer-configs \
  --operator-settings /private/acquisitions/local-operator.json
```

The installed command is `starforge buyer-runbook workspace` with these same
flags. Existing parents and selected paths must be canonical local paths.
The original workspace uses private POSIX directories and files. It binds to
loopback and prints its browser URL. Reopen with the same `--state`; the saved
configuration and settings paths can then be omitted.

The local operator preset declares this machine's actor, service, Stellar payer,
Python executable, maximum total/daily atomic budgets and existing wallet
environment or trusted signer provider. Those settings come from the receiving
host. The SDK upload contains no authority to replace them.

## Receive and retain the original export

1. Choose **Receive customer SDK**. Extract the merchant's archive first and
   select `client-export.json` with its five named files.
2. Choose **Receive original files**. The receiver retains the receipt first,
   followed by each named payload. Each file must match the receipt's exact
   byte count and SHA-256. Once complete, the canonical validator also checks
   the original OpenAPI, operations, generated module header and package layout.
3. Inspect the original mode, seller origin, completion time, OpenAPI hash and
   receipt hash. The **Original files and completion receipt** table offers
   the retained bytes as downloads.
4. Choose an operation. The page displays its original method, compiled route,
   OpenAPI path, full request parameters/body schema and every payment option.

A partial upload stays in **Retained customer SDKs** with its missing filenames.
Select that SDK and upload those files to continue. Including its identical
receipt again opens the same retained SDK. A response lost after a file was
written can be retried: the same bytes are accepted, and changed bytes retain
their mismatch. A different original receipt is a separate saved SDK.

Both original GENERATED and ADOPTED_RETAINED completion receipts are supported.
The receiver preserves their provenance and timestamps. It does not create a
replacement completion receipt. Files carry the canonical limits: 65,000 bytes
for the receipt, 64 MiB for one payload and 128 MiB for the five payloads together.

The SDK retains the origin supplied by the seller. Native SF88 preparation
requires an HTTPS merchant origin. A canonical export bound to local HTTP remains
available for source inspection and file download; its merchant must supply an
original HTTPS export for native buyer preparation. The receiver never rewrites
the saved origin or substitutes a different seller.

## Configure exact request inputs

Choose a stable intent ID for the intended business operation. Keep that ID when
reopening or retrying the same retained request. Each SDK operation keeps its
original method and route; the customer supplies only its declared inputs.

| Input | Receiving behavior |
| --- | --- |
| Dynamic path | Enter every named segment; the original builder encodes it into the compiled route. Original OpenAPI `{name}` and seller `:name` paths are joined through their validated operation identity. |
| Query parameters | Supply a JSON object containing strings or arrays of strings. Arrays preserve repeated values. Required query fields come from the original schema. |
| JSON body | Enter exact JSON text. Its UTF-8 bytes are retained without numeric reserialization. |
| Multipart fields/files | Supply fields as a JSON object, add files under their declared field names, and use each file's original or explicit Content-Type. The original multipart encoder builds and retains the body once. |
| Encoded multipart body | Select its exact body file and original Content-Type, including the original boundary. |
| Optional body | Explicitly select **Omit this optional request body** when the original schema permits absence. An absent body is distinct from a present body file. |
| Operation ticket | For a POST that uses an original merchant-issued ticket, attach that ticket and its original lowercase header when specified. The native default is `x-merchant-operation`. |

GET, HEAD and DELETE have no request body. POST, PUT and PATCH use the original
advertised JSON or form input. The body must fit the smaller of the seller's
exported limit and the buyer's 16 MiB ceiling, including multipart framing.
The original encoder's part and field limits apply. The complete source schema
remains available above the form; application validation stays with the merchant.

For exact decimals in query input, use a string such as:

```json
{"fraction_band":"0.1234000","tag":["quarterly","retained"]}
```

For a JSON body, the entered text itself is retained. For example,
`{"amount":9007199254740993,"fraction":"0.1234000"}` keeps those original
characters in the request body.

Choose **Retain request and review payment**. The workspace concretizes the
original public route using those inputs, retains the exact request packet, and
opens its existing **Receive and prepare a request** view. The packet records the
original receipt, OpenAPI and complete-files identities, selected operation and
input selection. It contains the exact body, ordinary request headers and actual
ticket when present.

The private packet is retained before request acceptance. Retrying the same
selection uses those exact bytes, including an already encoded multipart
boundary. A lost response therefore recovers the original request. The SDK's
saved request list reopens it without configuring the inputs again.

## Review the payment and local buyer

The request page shows the complete original alternatives: scheme, network,
asset, recipient, exact atomic amount, timeout and extra metadata. Explicitly
select the intended option and enter total and per-UTC-day atomic limits. The
daily limit must cover that option and fit within the total and the host preset.

1. Choose **Save request review**. Inspect the selected terms, original request
   body/hash, receiver payer and local limits.
2. Choose **Prepare local buyer**. The original native importer retains the
   private inputs and the original initializer creates the local operator,
   Governor keys and Python spending ledger. Its ordinary config is published
   in the existing configuration directory after setup completes.
3. Choose **Add to acquisition plan**. The existing editor keeps its current
   editable rows and appends this selected configuration. An initialized plan
   begins a new draft.
4. Save and review the original plan, then choose **Initialize acquisition**.
   The original runbook retains the selected config/body snapshots and keeps
   the exact request identity through execution and recovery.

Receipt upload, composition and native preparation do not load a wallet or
purchase a resource. Acquisition execution continues through the original SF88
buyer, SF81 terminal approval, signer, SF36 spending ledger and SF31 response
writer. The original buyer reviews fresh merchant terms before payment.
Existing result downloads and accounting use the same acquisition records.

## Reopen and resume

Close and reopen the original workspace with the same state path. Received SDKs,
missing-file lists, original file downloads, composed requests, saved payment
reviews, prepared buyers and acquisitions remain linked in their original store.

An interrupted request setup resumes its matching saved generation using the
original native import and initializer. Existing exact private inputs, keys and
ledger are reused. An edited local preset requires a new explicit review;
changed retained input bytes surface their original mismatch. A completed
operator whose final ready response was lost is adopted as that same operator.

An existing accepted request can be reopened after its ticket expires. Replaying
its exact cached composition returns that retained request. New ticketed request
acceptance, new review/preparation and execution still use the original current
ticket checks. Ordinary ticket-free requests keep ticket metadata absent.

The workspace's existing acquisition backup includes its private intake tree,
SDK files, composition checkpoints and original operators under the reviewed
state root. Use [Back up acquisitions](WORKSPACE.md#back-up-acquisitions) and its
original same-root restore workflow. Copying a source config alone does not move
its privately retained request, keys or ledger.

## Native composition and compatibility

The original `openRunbookWorkspace` model exposes:

| Model method | Input or result |
| --- | --- |
| `receiveClient` | `{base64}` containing the original receipt |
| `uploadClientFile` | `{id,file,base64}` containing one listed payload |
| `client` | Saved client ID; returns original manifest, files, operations and related requests |
| `composeClientRequest` | `{id,expectedManifestSha256,operationId,intentId,values,ticket?}` |
| `clientAttachment` | Saved client ID and original filename; returns verified attachment bytes |

These methods use the existing intake metadata lease and original private
publication helpers. The browser's authenticated local routes are
`POST /api/clients/upload`, `POST /api/clients/file`,
`POST /api/clients/request`, `GET /api/clients/CLIENT_ID` and
`GET/HEAD /files/clients/CLIENT_ID/FILENAME`. The existing session header,
Host/Origin checks and JSON request rules apply.

A ticketed POST retains the original
`stellar-forge.operation-handoff.v1` packet. Ticket-free operations and other
supported methods use `stellar-forge.operation-handoff.v2`, with an explicit
`method` and `files.ticket:null` / `ticketHeader:null` when absent.
The original CLI imports either through:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --import-operation --file /private/sdk-request.handoff.json \
  --dir /private/new-request-inputs --accept 0
```

The CLI remains create-only. The receiving model explicitly uses the native
`importOperationHandoff({...,resume:true})` continuation for its own matching
setup attempt. Original ticketed requests, paid-file orders, external buyer
configs and existing acquisitions retain their established paths.

Ship the entire original buyer-runbook and SF30 developer components with the
updated original SF88 operation-handoff module. Existing Stellar Forge package
manifests already include those components; there is no additional service,
package dependency or command alias.
