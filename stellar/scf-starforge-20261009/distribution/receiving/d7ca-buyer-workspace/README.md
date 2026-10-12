# Original Buyer receiving application

This receiver operates the existing managed Applications model and the original Buyer runbook host. It imports the previously received six-file SDK and public paid-file handoff, approves one original SF88 request through the browser broker and SF36 governor, downloads the original 524,288-byte customer file, stops the managed host, and reopens the same saved work in a fresh native instance.

Run this one operation on an equipped Linux host with Node 24, Python 3.11 or newer, OpenSSL, and ordinary local Unix/TCP socket support. The runtime must be an actual READY installation of the source selected below. Its source manifest, frozen SDK lock and dependency closure are checked by the original installer before Applications adoption.

## Original inputs

The adjacent [buyer-inputs.zip.base64](buyer-inputs.zip.base64) and
[input-manifest.json](input-manifest.json) carry these exact retained inputs.

The original carrier is a 45,761-byte ZIP with SHA-256:

054de2e10e48e1eaffb9450cccff7013f7d993a82a05c58ec433554b26093866

Immutable Git binary blob: a0e20bc5dc7025a54096abb65b0b10fdc21e2b3b.

The same ZIP has a portable base64 carrier at Git blob feb436004727665a5d9eb4614f403a6db7348f4d. Its ASCII representation is 61,017 bytes including its final newline. Decode that text once, verify the ZIP SHA-256, then extract it into one private input directory. All paths and byte hashes are listed in input-manifest.json and MANIFEST.json.

The input paths after extraction are:

- canonical-sdk/: all six original SDK files. The 1,716-byte client-export.json has SHA-256 972f52aebb78beacd93bc6c5a9824118b9bd9e44be872143108384da48bfea91.
- paid-file/merchant.handoff.json: the exact 768-byte handoff, SHA-256 e813efe8c32ee02ca25a8fd7edbb381734ed40c3cbf8edc1a0c36395ff0f7e6a.
- paid-file/customer-product.bin: the exact 524,288-byte result, SHA-256 61d1d9c5745bdaa4fab39240651bc242a5186b15393fd475082fcf6e84f400ab.
- paid-file/result.json and original-drivers/: retained prior operating result and the three original host/SDK drivers.

The handoff selects the public example origin https://paid-file.example, its original runbook-customer-order, and 10,000 atomic units on stellar:testnet. The receiving host terminates this exact HTTPS origin through an explicitly selected local CONNECT proxy and a private temporary CA. The unchanged native TLS client verifies the original hostname. A disposable receiving signer returns the same original x402 envelope shape after the real browser approval and SF36 reservation. The returned native result retains its original PAYMENT_OUTCOME_UNKNOWN status for the merchant response without a settlement receipt, alongside its actual saved customer file. The prior customer's retained run and purchase remain separate source inputs.

## Private configuration

Create a mode-0600 JSON file using real paths and the actual retained install receipt:

~~~json
{
  "schema": "stellar-forge.buyer-runbook.managed-reception-input.v1",
  "runtimeDirectory": "/absolute/original/READY-runtime",
  "expectedSourceCommit": "<exact selected 40-character source commit>",
  "expectedManifest": "<actual package manifest SHA-256>",
  "receptionDirectory": "/absolute/private/buyer-receiving-operation",
  "sdkDirectory": "/absolute/private/inputs/canonical-sdk",
  "expectedSDKManifestSha256": "972f52aebb78beacd93bc6c5a9824118b9bd9e44be872143108384da48bfea91",
  "handoffFile": "/absolute/private/inputs/paid-file/merchant.handoff.json",
  "customerFile": "/absolute/private/inputs/paid-file/customer-product.bin",
  "pythonExecutable": "/usr/bin/python3",
  "opensslExecutable": "/usr/bin/openssl",
  "waitTimeoutMs": 300000
}
~~~

Optional applicationWorkspace selects an existing private Applications workspace; when omitted, the original constructor creates one inside the reception directory. Optional homeId chooses an existing managed home. Optional bootstrapSourceRoot selects the installed bootstrap source when it differs from runtimeDirectory/package/source.

The reception directory's parent must already exist. The receiver creates its own private buyer workspace, config directory, native policy/ledger, temporary operator keys, CA and operation journal there. No wallet key is required for this local receiving operation.

Run:

~~~sh
/absolute/original/node receive_buyer_managed_application.mjs /absolute/private/receiving-config.json
~~~

Run the exact same command and configuration to continue an interrupted receiving operation. The journal preserves the original Applications save identity, linked managed starts, buyer run, original intent, reviewed decision, first exported report and native result. A confirmed stopped host can reopen the same application; the original attempt guard prevents a fresh purchase for a previously attempted operation.

## What the operation completes

The native sequence is:

1. Inspect the selected READY runtime and exact customer/SDK source bytes.
2. Create or recover the private receiving journal and original native operator ledger.
3. Use original Applications Review, Save, runtime adoption and Start.
4. Bind the compact startup announcement and actual /api/launch to the selected source, input selection, PID and instance.
5. Save Local buyer setup through its actual review and original retained proposal.
6. Receive and download all six original SDK files, then receive the exact paid-file handoff.
7. Read the original served application and shared approval assets; parse the two served modules in this same command.
8. Review and initialize one original acquisition, then execute the real SF88 child process.
9. Review the actual native live terms, budget and four-part operation identity, and approve that exact request.
10. Read the native result, original customer download and report; confirm the original governor's single retained reservation and native request count.
11. Stop and drain the original managed host.
12. Reopen the same application in a fresh process, read the saved setup, complete SDK, handoff and same original result, download the same customer bytes, and Stop again.

The main receipt is buyer-managed-reception.json. The first original browser report is original-buyer-report.json. Keep the private fixture/ directory and the original Applications workspace with that receipt for source-level recovery. Its private CA/key and operator-key files are operating inputs, so only the result summary and public input/source hashes belong in a coordination message.

Use operation identity D7CA-SCF-BUYER-RECEIVING-APPLICATION-20261012 in the existing Applications and sim-data threads. An actual result names the installed source/manifest, application and managed operation IDs, original run/intent, native reservation, customer hash and two stopped process instances.
