# Current eight-contract accounting build and receiving

Use the same native/principal-build.py and byte-identical native/watershed_process.py used by the reference build. The current profile selects the awarded repository's real PT/YT/custody/recovery contracts and accounting edition 3. It has a distinct input schema and source seal; a reference workspace cannot silently become a current build.

## Complete source acquisition

The exact full231 packet is the decoded content of public-sprint Git blob 5f4a19b2b5a338e7cfdf2c78ff6f8737fc36af58:

https://api.github.com/repos/woahwhattheheck/public-commons-sprint-2026/git/blobs/5f4a19b2b5a338e7cfdf2c78ff6f8737fc36af58

The original equipped receiver saves that whole decoded JSON response content using its existing source acquisition. Select exactly 7,509,894 UTF-8 bytes, SHA-256 71d7d5b9b1adaf6fb4c9a2bb6b49f614cd9c5c101a0454c75985e54f9de9eb04. An API response wrapper/base64 string is not the decoded packet.

The entry independently verifies this complete packet, all 231 full member byte/hash identities and the complete 230-member manifest. CURRENT_ACCOUNTING_SOURCE.json excludes itself deliberately. The original 190 historical snapshots are preserved as original source evidence; they are not substituted for this run's seven new lifecycle snapshots.

## One original executable course

Retain the original Principal programme operation ID and equipped-host reservation. The existing owner supplies actual absolute Cargo/Rustc 1.91.0 executable paths, SHA-256 values and complete --version outputs. No new provider/deployment/signing configuration is required.

Create this complete input, replacing labelled runtime/path values with actual selections:

```json
{
  "schema": "principal.current-build-input.v3",
  "operationId": "THE-EXISTING-PRINCIPAL-PROGRAMME",
  "directory": "/ABS/original-programme/current-accounting-build",
  "sourcePacket": "/ABS/original-programme/current231-decoded.json",
  "sourceSha256": "d2aef9bbd305b40dd10937c7420a985db69d107508eed1246493309dc5b89a83",
  "cargo": {
    "path": "/ABS/toolchain/bin/cargo",
    "sha256": "ACTUAL-CARGO-SHA256",
    "version": "ACTUAL COMPLETE cargo 1.91.0 VERSION OUTPUT"
  },
  "rustc": {
    "path": "/ABS/toolchain/bin/rustc",
    "sha256": "ACTUAL-RUSTC-SHA256",
    "version": "ACTUAL COMPLETE rustc 1.91.0 VERSION OUTPUT"
  },
  "cargoHome": "/ABS/original-cargo-home",
  "searchPath": "/ABS/toolchain/bin:/usr/bin:/bin",
  "timeoutSeconds": 3600
}
```

Run:

```sh
python3 -B /ABS/current/operator/native/principal-build.py --input /ABS/original-programme/current-build-input.json
```

The one existing entry materializes the whole selected current source under the owned operation's source directory. It preserves the full original packet, every source byte, the exact executing entry and owner, runtime selections and Cargo configuration. The input source seal is over the complete canonical selected source bytes and metadata, not merely the packet checksum or a path list.

The four native phases retain actual Cargo and Rustc version observations, then run:

```sh
cargo build --locked --release --target wasm32v1-none --workspace --exclude principal_integration_tests
cargo test --locked -p principal_integration_tests --test accounting_lifecycle -- --nocapture --test-threads=1
```

The entry sets RUSTC to the selected absolute compiler, CARGO_TARGET_DIR to the selected source's target directory, PRINCIPAL_CURRENT_WASM to its actual release Wasm directory and PRINCIPAL_COURSE_ARTIFACTS to the owned lifecycle output directory. It retains separate full stdout/stderr and actual process identities for each phase.

All eight complete Wasm files are required: oracle adapter, permissioning, risk control, SY wrapper, principal manager, PT token, YT token and recovery escrow. The exact accepted build artifacts are checked/restored before the test. The course registers those actual Wasm artifacts with the pinned Soroban test host.

All seven new full snapshots are required:

- current-01-live-repeated-claims.json
- current-02-frozen-final.json
- current-03-explicit-pending-recovery.json
- current-04-recovered-final.json
- current-05-complete-maturity-proof.json
- current-06-three-atom-conservation.json
- current-07-full-unit-conservation.json

They exercise repeated paid yield without collateral inflation, differing entry rates with the explicit conservative issuance preview, ordinary-transfer retention of earned whole and fractional rewards, fixed first-eligible maturity, actual recipient payment deltas, cold snapshot opening, explicit issuer recovery including zero-YT whole and fractional rewards, full finalization and invalid/missing maturity source rejection. The two added snapshots complete both reported transfer-rounding witnesses through split, merge, self-transfer, allowance transfer, a later genuine rate increase, full principal/YT burn and zero-YT fractional recovery; unsupported economic rates are rejected before custody.

This selected executable course does not run every historical unit test. The full existing tests and separate commands remain in docs/ACCOUNTING_EDITION_3.md; the receiving result must name what actually ran. It uses test-host signing mocks and unlimited semantic test budgets and establishes no funded deployment or production resource-cost result.

## Resume, receiving and operator

The same lease/process ownership, ordered attempts, create-only source/results, full phase proof and no-process COMPLETE adoption described in PRINCIPAL_BUILD.md apply. The result explicitly names profile current-accounting-v3. A completed reference profile cannot satisfy it. Failed compiler output remains original evidence; source corrections require a reviewed new explicit source edition.

The first complete result and later reopen both revalidate all original source/runtime records, four phase requests and process receipts, full stream files, eight Wasm files and seven new snapshots. No financial operation occurs. Feed the complete retained build directory to the original Principal operator/workspace receiving programme alongside its current API edition and source roster.

Before customer/demo readiness, the original operator owner must actually open the exact current UI, inspect its current accounting/inverse-index/pending/fraction/backing/maturity/recovery views at wide and narrow widths, use the original request and export controls, and reopen/download the complete selected evidence. Compilation and source review alone do not establish a usable rendered product, external audit or live settlement.

The Wasm build excludes the host-only integration-test harness while building all eight actual contracts. Cold snapshot clients reconstruct their original contract addresses in the new Env before reading; they do not reuse environment-bound address objects.

The complete edition2 guide remains in the source as historical evidence. Edition3 is a fresh accounting initialization; this build does not migrate an existing edition2 deployment. The source-selected inverse-index denominator is 10^30 and supported economic oracle rates are 1 through 10^18. The operator must display the actual conservative issuance preview and source sample; it must not present original-rate notional as the issued amount when their integer values differ.
