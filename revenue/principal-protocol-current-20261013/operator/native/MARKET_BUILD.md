# Market edition 1 — maintained native build

Use the original `native/principal-build.py` and its unchanged `watershed_process.py` process owner. This is an additional source profile in that maintained course, not another runner. The original reference and accounting-3 profiles retain their exact inputs and artifact rules.

Select the complete `source/current-market-packet.json`: 7677275 bytes, SHA256 `bf8edadbbd4d1d114c6c372fbdcf44485abd737504250f84e4e5e8e7a57de472`, 240 complete contract/source members. The build-source canonical SHA is `e9fd4e3921d4a15632bf30d4742819fade96b3444e38d89dbd99ec53cf714b08`; it is intentionally different from the packet file SHA. The former seals the complete selected Base64 member object using the original Python encode() recipe.

Create a new ordinary private input JSON using actual retained executable paths and identities:

```json
{
  "schema": "principal.market-build-input.v1",
  "operationId": "YOUR-EXISTING-PRINCIPAL-MARKET-CONTINUATION",
  "directory": "/absolute/owned/principal-market-edition-1",
  "sourcePacket": "/absolute/operator/source/current-market-packet.json",
  "sourceSha256": "e9fd4e3921d4a15632bf30d4742819fade96b3444e38d89dbd99ec53cf714b08",
  "cargo": {"path": "/actual/cargo", "sha256": "ACTUAL-SHA256", "version": "cargo 1.91.0 ACTUAL-RETAINED-SUFFIX"},
  "rustc": {"path": "/actual/rustc", "sha256": "ACTUAL-SHA256", "version": "rustc 1.91.0 ACTUAL-RETAINED-SUFFIX"},
  "cargoHome": "/actual/retained/cargo-home",
  "searchPath": "/actual/selected/bin:/usr/bin:/bin",
  "timeoutSeconds": 3600
}
```

These are explicit placeholders, not executable facts. Preserve the original host's actual Rust/Cargo 1.91.0 selection and existing dependency cache. Do not alter compiler identities to make an unqualified executable pass. Use a new source-edition output directory; keep the accepted accounting-2 workspace and any existing accounting-3 build receipt unchanged.

```sh
python3 /absolute/operator/native/principal-build.py --input /absolute/market-build-input.json
```

The original owner then retains these five phases:

1. Actual Cargo version.
2. Actual Rust compiler version.
3. Locked release Wasm build: `cargo build --locked --release --target wasm32v1-none --workspace --exclude principal_integration_tests`.
4. Original unchanged accounting lifecycle: `cargo test --locked -p principal_integration_tests --test accounting_lifecycle -- --nocapture --test-threads=1`.
5. Market lifecycle: `cargo test --locked -p principal_integration_tests --test market_lifecycle -- --nocapture --test-threads=1`.

All ten Wasm outputs are retained from phase3. The original seven accounting host snapshots and five new market host snapshots are retained in their corresponding phase outputs. Complete stdout, stderr, input, process identity, source, runtime and accepted result are recorded. The source is rechecked after every command; locked Cargo cannot silently update it. An interrupted completed attempt is adopted under its original signature before another attempt is considered.

The new market test registers all ten **actual built Wasm contracts**. It exercises original PT/YT issuance and stateless tokenization, original SAC/Permissioning rules, exact custody and fee split, both swap directions, bounded/slippage/deadline failures, risk pause, creator rotation, the original RecoveryEscrow's restricted LP recovery, mature withdrawal and independent Env snapshot reopen. Mock authentication in the host fixture does not establish production wallet signing or deployment acceptance. Contract role/eligibility/topology gates are separately asserted in the same actual host course.

There is no live RPC, deployment, signer or funded transaction in this build. The operator course can import the complete new API/source and use its original ZIP/JSON/browser working-copy receiving without a live deployment. Actual contract observations require separately authorized real deployed addresses and Wasm bindings.

After a successful compiler/host result, continue the original receiving owner: inspect populated desktop and390px, actual quote/source/control behavior, interruption recovery, all outgoing files and cold editable reopening. Source/V8 checks alone are not that result. Return the first actual compiler, host or browser exception in the original Principal thread; preserve its original output directory and process receipt.

## Original history

`source/current-accounting-packet.json` stays byte-exact at7,509,894 bytes /71d7d5b9b1adaf6fb4c9a2bb6b49f614cd9c5c101a0454c75985e54f9de9eb04. Its original231 members and original CURRENT_ACCOUNTING_SOURCE.json describe that preserved accounting-only edition. The installed market tree's authoritative manifest is CURRENT_MARKET_SOURCE.json. It also carries the prior accounting manifest as historical source. Original upstream and accounting-2 bodies stay in their existing paths.
