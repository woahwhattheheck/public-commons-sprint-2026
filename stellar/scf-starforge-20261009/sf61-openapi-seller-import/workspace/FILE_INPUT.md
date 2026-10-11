# Paid API file input

The existing API merchant workspace imports a declared `multipart/form-data`
request, prepares one private file request and passes its exact bytes through
the original SF30 upstream seller and SF88 buyer. Durable POST uses the same
merchant operation issuer, SQLite journal and recovery dashboard as JSON POST.

## Source and configuration

Import the original OpenAPI 3.0/3.1 JSON or YAML. YAML uses pinned `yaml@2.9.1`,
the core schema, unique keys and bounded aliases; custom serialization and
unsupported field shapes produce an explicit compiler error. The saved package
retains the original source text and SHA-256. Existing JSON packages reopen
without migration.

Select the operation, price and original backend server. Configure the
provider's authentication as environment references. For a file product, raise
**Maximum request bytes** to a deliberate limit large enough for the file,
scalar fields and multipart framing. Each binding defaults to 1 MiB and accepts
up to 16 MiB; the original buyer shares the 16 MiB ceiling. Response limits remain
separate. Enable the existing **Durable POST operations** policy for a POST that
needs one stable merchant operation across later attempts.

Use harmless public examples matching the source schema. A binary property is
represented by a string sample in the public Bazaar schema. Actual filenames,
file contents, paths and body digests belong to the private request workflow.
They are not added to the advertised discovery extension.

An absent OpenAPI `requestBody.required` means the whole body is optional.
Required properties inside that body still apply whenever it is sent. The
workspace preserves both rules, shows them during setup and offers an explicit
**Send no body** control only where permitted. Sending a body without a required
file or scalar property is rejected by the original input admission before
payment verification.

For example, the [first-party Pinata V3 upload description](https://github.com/PinataCloud/docs/blob/main/pinata-api-v3-uploads.yaml)
declares POST `/files` at `https://uploads.pinata.cloud/v3`, a binary `file` and
`network` required within an optional whole request body. It declares HTTP bearer
authentication. Its `org:files:write` description is not an OAuth scope declaration.
The [provider upload documentation](https://docs.pinata.cloud/api-reference/endpoint/upload-a-file)
is the source for provider account permissions and service behavior. Importing,
saving or reviewing the document does not upload to the provider.

## Select, retain, review and issue

1. Start the saved project. In **Durable POST operations**, select the upload
   binding and enter the exact public URL, path/query values, ordinary forwarded
   headers and scalar `body` fields. File fields have their own native file inputs.
2. Select the files and choose **Retain and review selected files**. The local
   workspace copies those bytes, validates the complete original body schema and
   creates one multipart body with one boundary. It writes private files with
   mode 0600 under the existing package's `operation-tickets` directory.
3. Review each filename, media type, byte count and SHA-256, plus the typed scalar
   fields and complete body SHA-256. Changing the request editor or file selection
   clears that selection until it is retained again. A changed source file cannot
   alter an already retained request.
4. Enter the stable merchant operation ID, customer reference and expiry. Create
   the original buyer ticket. The active original handler binds the ticket to
   the exact method, URL, forwarded headers, content type/boundary and body bytes.
5. Run the displayed SF88 review command, or choose **Download complete buyer
   request** to transfer the original portable packet. It contains the offer,
   ticket, exact headers and body bytes without local merchant paths or operator
   credentials. On the receiver, set mode 0600, import with an explicit payment
   option and review the resulting local config. Import pins the body length
   and SHA-256 before the existing buyer workspace or inbox consumes it.
   An explicitly absent body remains absent through transfer; it is distinct
   from a present zero-byte body. Inspect and recover through the original
   operations dashboard; there is no added retry or operation store.

Stopping and restarting the seller preserves those files. Reopen the project,
select **Retained file request**, and review the same bytes before issuing a
ticket. The loader checks the retained manifest and body digests. It does not
require the original file picker path. A stale browser runtime cannot issue a
ticket against a different managed seller.

The native seller uses Node's maintained multipart decoder for admission. It
then forwards the original raw body and content type. It does not rebuild a
FormData object or serialize the parsed fields to JSON. File-array properties
use repeated parts; object-valued fields use JSON parts; scalar strings, numbers
and booleans follow the declared schema. Custom OpenAPI encoding overrides and
unsupported file constraints are rejected during compilation.

## Original CLI preparation

Create a private directory and a local selection file. Paths are explicit
operator input; they are never read from a provider response or public offer:

```json
{
  "fields": {
    "network": "private",
    "name": "Approved upload",
    "keyvalues": {"project": "merchant-integration"}
  },
  "files": [
    {"field": "file", "path": "/private/input/document.pdf", "contentType": "application/pdf"}
  ]
}
```

Use the original saved-offer selection:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs --prepare \
  --discovery /private/offers.json --row 0 --accept 0 \
  --intent-id upload-order-001 --url https://merchant.example/paid/files --method POST \
  --form-file /private/upload-selection.json --form-out /private/upload-request.multipart \
  --out /private/upload-review.json
```

The form output is create-only, and its generated content type is saved in the
review. For a durable operation, obtain the merchant ticket for these exact
bytes and prepare with the existing `--body-file`, `--headers-file`,
`--ticket-file` and `--ticket-header` options. Rebuilding a body with a new
boundary requires matching issuance; it cannot reuse a ticket for other bytes.
The workspace automates this same issuance and file handoff on the merchant host.

The generated seller client exports the declared multipart media type and
accepts `inputs.multipart = {body: Uint8Array, contentType: string}` for retained
bytes, with the original buyer approval/signer interface. `inputs.omitBody = true`
is available only for optional bodies. Public developer docs show source terms
and direct file preparation to the private workflow; the public JSON example
editor does not send a fake file request.

Keep retained requests and ticket files in the merchant's existing private
storage and retention process. They contain the selected customer data; public
discovery and routine runtime status contain none of those file bytes.
