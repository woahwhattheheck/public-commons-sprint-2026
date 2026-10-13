# Current eight-contract accounting build and receiving

Use the same native/principal-build.py and byte-identical native/watershed_process.py used by the reference build. The current profile selects the awarded repository's real PT/YT/custody/recovery contracts and accounting edition 2. It has a distinct input schema and source seal; a reference workspace cannot silently become a current build.

## Complete source acquisition

The exact full230 packet is the decoded content of public-sprint Git blob efe3cc552b57d34dbda34d59101c15816c46ef58:

https://api.github.com/repos/woahwhattheheck/public-commons-sprint-2026/git/blobs/efe3cc552b57d34dbda34d59101c15816c46ef58

The original equipped receiver saves that whole decoded JSON response content using its existing source acquisition. Select exactly 7,482,441 UTF-8 bytes, SHA-256 17e49d735384874c3db1116de7d449078e0a6f12246eb4598661821bb45c5915. An API response wrapper/base64 string is not the decoded packet.

The entry independently verifies this complete packet, all 230 full member byte/hash identities and the complete 229-member manifest. CURRENT_ACCOUNTING_SOURCE.json excludes itself deliberately. The original 190 historical snapshots are preserved as original source evidence; they are not substituted for this run's five new lifecycle snapshots.

## One original executable course

Retain the original Principal programme operation ID and equipped-host reservation. The existing owner supplies actual absolute Cargo/Rustc 1.91.0 executable paths, SHA-256 values and complete --version outputs. No new provider/deployment/signing configuration is required.

Create this complete input, replacing labelled runtime/path values with actual selections:

```json
{
  "schema": "principal.current-build-input.v2",
  "operationId": "THE-EXISTING-PRINCIPAL-PROGRAMME",
  "directory": "/ABS/original-programme/current-accounting-build",
  "sourcePacket": "/ABS/original-programme/current230-decoded.json",
  "sourceSha256": "dadf1139e47d63dfe7f02884b75428e2cdb2715ef6e8aab92d136dac62a0a231",
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

All five new full snapshots are required:

- current-01-live-repeated-claims.json
- current-02-frozen-final.json
- current-03-explicit-pending-recovery.json
- current-04-recovered-final.json
- current-05-complete-maturity-proof.json

They exercise repeated paid yield without collateral inflation, differing entry rates, transfer credit and pending semantics, fixed first-eligible maturity, actual recipient payment deltas, cold snapshot opening, explicit issuer recovery including zero-balance earned pending, full finalization and invalid/missing maturity source rejection.

This selected executable course does not run every historical unit test. The full existing tests and separate commands remain in docs/ACCOUNTING_EDITION_2.md; the receiving result must name what actually ran. It uses test-host signing mocks and unlimited semantic test budgets and establishes no funded deployment or production resource-cost result.

## Resume, receiving and operator

The same lease/process ownership, ordered attempts, create-only source/results, full phase proof and no-process COMPLETE adoption described in PRINCIPAL_BUILD.md apply. The result explicitly names profile current-accounting-v2. A completed reference profile cannot satisfy it. Failed compiler output remains original evidence; source corrections require a reviewed new explicit source edition.

The first complete result and later reopen both revalidate all original source/runtime records, four phase requests and process receipts, full stream files, eight Wasm files and five new snapshots. No financial operation occurs. Feed the complete retained build directory to the original Principal operator/workspace receiving programme alongside its current API edition and source roster.

Before customer/demo readiness, the original operator owner must actually open the exact current UI, inspect its current accounting/credit/pending/backing/maturity/recovery views at wide and narrow widths, use the original request and export controls, and reopen/download the complete selected evidence. Compilation and source review alone do not establish a usable rendered product, external audit or live settlement.

The Wasm build excludes the host-only integration-test harness while building all eight actual contracts. Cold snapshot clients reconstruct their original contract addresses in the new Env before reading; they do not reuse environment-bound address objects.
