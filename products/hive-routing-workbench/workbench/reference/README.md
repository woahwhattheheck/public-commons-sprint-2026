# Original Hive application reference

This reference uses the complete original Hive Router four-subgraph developer fixture at [graphql-hive/router, commit 28eafc1bceb3dce8600d0eeea2ce2c2ec9563bb6](https://github.com/graphql-hive/router/tree/28eafc1bceb3dce8600d0eeea2ce2c2ec9563bb6). Its selected subgraphs are **accounts, inventory, products and reviews**. The original Rust fixture also contains other example modules; their source remains unchanged in the retained crate.

The reference contains public developer data: nine products, nine inventory entries, six accounts and eleven reviews. It is an executable receiving example, not customer data or evidence of a customer deployment. A prospective engagement scoped to three customer subgraphs remains a separate customer selection.

The single receiving operation is `HIVE-APPLICATION-MIGRATION-0C7A-20261012`. The reference calls the existing Hive Desk workspace, native deployment, programme, review, cutover, rollback and receiving APIs. The original Hive binary performs every GraphQL operation.

## Source and runtime selection

The complete retained selection is in [FIXTURE-SOURCE.json](FIXTURE-SOURCE.json). Its 35 entries include all 16 files in the original `bench/subgraphs` crate, the original Rust workspace manifest and lock, the original toolchain and Cargo settings, and the selected router configuration/source contracts. Each entry includes the full original path, Git blob, byte count and SHA-256.

The complete product keeps those original files once under `upstream/router/<original repository path>`. The original supergraph is [products-example.supergraph.graphql](../upstream/router/bin/router/fixture/products-example.supergraph.graphql); its unmodified bytes remain retained in both prepared editions. The four original subgraph URLs are changed only to the explicitly selected loopback listener. That receiving realization is recorded separately from the original bytes.

A Rust build needs the **complete original checkout**, because the fixture depends on other crates in the same original workspace. The 35 selected files document and retain this reference; they do not replace the full checkout. The original [toolchain](../upstream/router/rust-toolchain.toml) selects Rust 1.98.1. The fixture build uses the unchanged [Cargo.lock](../upstream/router/Cargo.lock), [crate manifest](../upstream/router/bench/subgraphs/Cargo.toml), and [Cargo configuration](../upstream/router/.cargo/config.toml).

The receiving host also supplies the exact published Hive Router v0.3.4 Linux executable. Hive Desk's original `native.inspect_binary` verifies the selected release bytes and platform before any router launch. Keep the full checkout, existing Rust toolchain, original router binary, complete product source, build output and operation output within the host's existing capacity/admission declaration.

## Build the original fixture

Run from the complete product directory. Use existing runtime executables and an owner-private output directory. The upstream directory must have the selected commit checked out with unchanged tracked files.

```sh
python3 -B -m reference.build_fixture \
  --upstream /ABS/original-hive-router-checkout \
  --output /ABS/PRIVATE/hive-reference-build \
  --cargo /ABS/existing/cargo \
  --rustc /ABS/existing/rustc \
  --git /ABS/existing/git
```

This invokes the original command:

```sh
cargo build --locked --release -p subgraphs
```

The helper preserves the selected Cargo and Rust proxy paths, sets an owned `CARGO_TARGET_DIR`, verifies the original checkout and exact selected source before and after the build, and retains the complete Cargo log. It records the actual tool versions and executable identity in `fixture-ready.json`. Reopening a completed build verifies and returns that same receipt. A build interruption retains its original attempt and log; a subsequent build uses the same original Cargo target directory. A surviving build child holds the original build lease, so another caller cannot start over it.

The genuine fixture executable is `target/release/subgraphs`. It starts with no arguments, uses the original `HOST` and `PORT` environment variables, and exposes the original `/health` route. The receiving driver sets these to the selected loopback address and port. No substitute HTTP implementation or generated dataset is used.

## Prepare source editions without launching a process

This optional source preparation is also performed by the complete receiving command. It starts no fixture or router.

```sh
python3 -B -m reference.prepare \
  --upstream /ABS/original-hive-router-checkout \
  --output /ABS/PRIVATE/hive-reference/editions \
  --initial-port 4811 \
  --changed-port 4812 \
  --subgraph-origin http://127.0.0.1:4200
```

The two editions retain the complete original source selection, unchanged operation file, configuration, supergraph and explicit derivation record. The changed edition removes exactly the original `Product.internal` field declaration. All four subgraph implementations and their data remain unchanged. The same final query therefore succeeds on the original schema and returns the original router's validation error against the changed schema.

Each prepared file is written atomically, reopened and checked before `prepared.json` is published. Existing files must match the same selection. Keep three distinct, available, unprivileged listener ports. The receiver's original input journal binds those ports for continuation.

## Run the complete original receiving programme

The host that owns the whole Hive Desk operation runs this command once its original runtime and capacity selection are ready:

```sh
python3 -B -m reference.receive \
  --source /ABS/complete-hive-product \
  --upstream /ABS/original-hive-router-checkout \
  --fixture-ready /ABS/PRIVATE/hive-reference-build/fixture-ready.json \
  --router /ABS/original/hive_router \
  --root /ABS/PRIVATE/hive-reference \
  --initial-port 4811 \
  --changed-port 4812 \
  --subgraph-port 4200
```

Run from `--source`, so the existing `hive_desk` and this reference are imported from the selected product. The product's complete `source-files.json` inventory is bound to the receiving input. The exact original fixture receipt, router bytes, checkout, ports, output directory and operation identity are recorded before effects.

| Phase | Original native actions | Retained result |
| --- | --- | --- |
| Initial | Import and review original edition; start original fixture and router; receive and review all 20 operations; activate; stop and drain router | Twenty complete responses and the first full handoff |
| Changed | Start the changed edition on its own port; receive the same 20 operations; compare and review every response; activate; stop and drain | Twenty complete responses, including the actual removed-field validation result |
| Rollback | Restart the retained original deployment; run and review the same 20 operations on this new original native attempt; compare; perform the reviewed rollback; stop and drain | Twenty complete responses bound to the actual rollback attempt |

The same original fixture serves all three phases. The driver starts only one selected router at a time. Router shutdown uses Hive Desk's original SIGTERM/drain path. The fixture has its own inherited lifetime lease and exact process identity; recovery can adopt its surviving original process rather than duplicate it.

Rollback requires a complete reviewed programme from the actual restarted native attempt. The driver performs that programme before calling the existing rollback API.

## Twenty retained operations

[operations.json](operations.json) carries each full original GraphQL query, variables, operation name, HTTP method, path, public headers and explicit expectation.

1. Complete product catalogue.
2. Product inventory, price/weight requirements and shipping.
3. Original default product limit.
4. Explicit product-limit variable.
5. Current account.
6. Complete account collection.
7. Exact account ID.
8. Absent account.
9. Account to reviews, products and inventory.
10. Product reviews and full authors.
11. Aliased product selections.
12. Shared GraphQL fragments across subgraphs.
13. Conditional review exclusion.
14. Conditional review inclusion.
15. Named operation selected from a multiple-operation document.
16. Native GraphQL GET.
17. Original unknown-field validation error.
18. Original missing-required-variable error.
19. Original invalid-variable coercion error.
20. The reviewed `Product.internal` schema surface.

The three deliberately invalid requests remain complete native responses. They are reviewed against their intended error outcome, rather than being discarded or rewritten as successful GraphQL data. The changed phase adds the removed-field validation outcome for operation 20.

The driver checks the complete selected populations and key native selection behavior. Every actual HTTP status, response header, body, GraphQL data, error and extension remains in the existing programme/workspace. Comparison retains all original differences. Rollback additionally requires the original data and errors to match the initial result; it does not replace or suppress changing native metadata.

## Continuation and process custody

Repeat the exact original command with `--resume` to continue the same directory. The selected input must match its retained source, paths, original executable receipts and ports. The receiver holds one operation lease. Fixture recovery checks the same lease inode, executable, cwd, environment, PID and process start identity before adopting or stopping an original process.

The receiver reuses completed programmes and committed cutover history. It also continues an interrupted prepared/running programme through the original programme API when that exact original native attempt is still live and every saved row has a received outcome; the existing API skips those received rows and sends only operations that never started. A started request with an uncertain outcome, a request error, or an ended/different native attempt remains with the original operator for reconciliation. It does not silently send another twenty requests. Hive Desk retains every actual native attempt and response. A reviewed new native attempt, when required by the original lifecycle, remains visible alongside its predecessor. If every phase is complete but the fixture-close journal update was interrupted, continuation reconciles and closes only the original fixture lease; it does not start another fixture.

The receiver publishes its exact final result candidate only after the fixture, selected routers, original workspace and receiving workspaces have closed. If publication is interrupted, `--resume` reopens and checks the saved candidate and every selected artifact, then completes publication using the same bytes and timestamps.

## Complete delivery and receiving

The operation retains:

- `reference-receiving.json`: original input, phase IDs, attempts, decisions, export selections, error history and final candidate.
- `fixture-owner.json` and `fixture.log`: actual original fixture custody and complete output.
- `editions/`: complete initial and changed source editions and exact derivations.
- `workspace/`: original Hive Desk history, objects, native deployment records, response bodies, reviews, cutover and rollback.
- `responses/{initial,changed,rollback}/`: all 60 selected original HTTP bodies and their complete programme records.
- `initial-handoff.zip` and `complete-handoff.zip`: full original workspace and selected editable product source.
- `receiving-initial/` and `receiving-final/`: actual fresh receiving/reopen results.
- `result.json`: sealed final result with complete artifact byte/hash identities and original native attempts.

Named handoffs retain the exact generated ZIP bytes. Reopening uses those original packages rather than assuming a newly generated ZIP has identical timestamps. The complete receiving phase verifies the original source and history, reopens the same archive again, and classifies newer, older and identical histories through the original `compare_receiving` interface. The current working history remains preserved.

The result reports 60 selected responses and separately reports all retained programme attempts/responses, including any real recovery work. Source preparation alone does not create a completed result. Only the actual whole receiving programme may publish `complete: true`.

Keep the original router binary/build receipt, full checkout and installed runtime available for an explicitly selected later native deployment. Imported native process records are historical in a new installation; the portable workspace preserves their identities and evidence without claiming those original processes are live.
