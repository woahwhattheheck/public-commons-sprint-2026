# OpenFEMA original testnet commissioning

This runs one new paid OpenFEMA purchase inside the same complete source, portfolio, merchant, customer, archive and restored-workspace receiving operation.

The host uses the maintained native commissioning pattern from WordPress (source commit `4c62463acfae23b50fb3327d7eafeb087e8b4806`) and NocoDB (original consumer blob `40afbe0c2cf2a2fa74113d313347d73e9f5c874f`). Original SF30/SF82 owns the seller; the native x402 facilitator and SDK perform the testnet transfer; SF88/SF81/SF36 own the buyer, approval and spending journal; SF43 observes the actual transfer; SF88/SF100 produces the five customer files.

## Host preparation

Use the already selected complete OpenFEMA source and its original acquisition bundle. The source is the current `3a35855d0317fcf696eb2dc17567fa7f31e0358d` product, including all seven E9B2 application/dataset postimages, with the receiving driver and this additive commissioner. The commissioner checks its critical original source blobs and retains their complete hashes before accounts are created.

The executing host needs Node 22 or later, Python 3.11 or later, OpenSSL, and the existing browser/Playwright pair. The original package versions are `@x402/core@2.28.0`, `@x402/stellar@2.28.0`, `@x402/extensions@2.28.0`, and `@stellar/stellar-sdk@16.3.0`. The payment packages must resolve from the materialized source tree for both ESM imports and the native buyer's generated signer. The accompanying `testnet-runtime-package.json` records these existing version pins. Reuse the equipped host installation when present; if this is a fresh authorized testnet host, install those original packages once in its private runtime and make that existing `node_modules` directory available from the source root. Keep the already installed OpenFEMA/MCP dependencies, including re2js, available there.

Copy `testnet-input.example.json` to a private mode-0600 host selection file and replace the absolute runtime/source/input paths with the actual host paths. Put `operationDirectory` outside the source tree. Keep the operation ID, fixed OpenFEMA route, original source ref, and single-payment budget unchanged. The optional browser pair may be omitted only when the existing browser operation is being received separately; the complete commissioning operation includes it.

The source bundle must be the complete retained DR4724 edition, 605,029 bytes with SHA-256 `580f2b88274a9d74070d03b636840863a11ab3c21270da9d8a63840524b58077`. A gzip transport containing those same bytes is accepted by the original portfolio driver.

Run:

```sh
node /absolute/receiving/source/stellar/scf-starforge-20261009/sf30-seller-sdk/openfema/examples/testnet-commissioning.mjs --input /absolute/receiving/openfema-testnet-host.json
```

## Actual merchant and buyer journey

The retained operation first creates a dedicated payer and merchant keypair through the official Stellar SDK. It saves the two private keys before any Friendbot request, then obtains and retains the actual testnet account observations. A POSIX kernel lease holds this one operation through both Node phases. On interruption, rerun the same command with the same private directory and selection file; it reuses the original accounts, funding records, ports, source and buyer ledger.

The host makes a private CA and hostname certificate through OpenSSL, verifies the certificate, and starts the actual Node runtime with the selected CA bundle. Its explicit CONNECT proxy routes only the selected OpenFEMA HTTPS hostname and the fixed public Stellar testnet RPC. Normal TLS certificate and hostname validation remains active. The original native facilitator owns actual verification, fee sponsorship and settlement.

Public terms select native XLM on `stellar:testnet`, the freshly retained recipient, and one payment of 50,000 stroops (0.005 XLM). The original buyer policy reserves that same maximum for this operation. The host creates an original SF88 workspace and inbox, then runs the full portfolio driver.

While the selected original SF82 generation is live, the driver:

1. Reads its original health and 402 challenge.
2. Freezes the new queue request against this OpenFEMA release, dataset snapshot, exact `?limit=250` query and recipient.
3. Reviews the original SF81 approval record against that exact request and budget, then lets the original buyer execute once.
4. Reads the saved original 195-row response, verifies its snapshot, total and completed cursor, and reads the original checkout evidence.
5. Observes the matching on-chain SEP-41 transfer through SF43 and finalizes the same original SF36 reservation.
6. Receives the original CSV, JSONL, HTML review, delivery JSON and dataset manifest through the OpenFEMA MCP file client; the local reopen verifies their complete bytes.
7. Stops the selected seller and continues the full browser, workspace ZIP, native publisher relocation, restored seller challenge and exact reopen journey.

The queue creates a permanent original attempt before execution. A rerun first inspects that same attempt and its retained checkout records. It does not generate a second payment intent to overcome an interruption. Retained original saved outcomes flow back into the same five-file receiving; an incomplete native checkout is recovered through its original evidence API and kept with the same account, request, attempt and ledger.

## Retained result and custody

The complete result is `results/TESTNET_RECEIVING.json`; the original full application report is `native-work/native-portfolio-receiving.json`. The public result includes the actual transaction, payer, recipient, amount, selected snapshot, source hashes, original account-independent output paths, file hashes, ledger finalization and resource closure. The commissioning directory keeps the exact selected request, original queue outcome, checkout evidence reference, paid response, approval review and native package versions.

The whole private operation directory also contains account keys, journal keys, TLS keys, broker/session connections and original buyer state. Preserve it through the current host's private artifact-return channel for recovery. For a public release or grant handoff, select the application report, original paid transaction/receipt metadata, screenshots, the five customer files and the complete OpenFEMA workspace ZIP. Keep the private account and operator state in its original host custody.

Completed result reuse verifies the retained application report hash and returns the same completion. The original seller, MCP host, approval socket, facilitator and ingress are closed before the final result is marked complete.
