# Sling Migration Workspace

A complete operator for original configuration intake, Sling replication, full typed comparison, reversible consumer selection and editable receiving.

The application retains source editions and stable request history, compiles Airbyte configuration through the original semantic module, runs the selected Sling binary, displays native and comparison results, and exports a complete portable project. The seven working sections are Overview, Sources, Migration plans, Native runs, Comparison, Cutover & consumers, and Delivery & history.

## Run the installed application

Use Linux amd64 for the selected native engine, Node 24, Python 3 with its standard SQLite module, and the existing `flock` command. The server and semantic engine use Node built-ins; no npm installation is required.

Receive the original engine once into a private runtime directory:

```sh
python3 native/install.py --directory /absolute/private/sling-runtime
python3 native/install.py --directory /absolute/private/sling-runtime --reopen
```

An already retained original release can be supplied with `--archive /absolute/sling_linux_amd64.tar.gz`. The installer checks its fixed complete SHA/length, extracts the unchanged binary and retains its actual version observation. Reopening a completed receipt verifies the retained archive and executable.

Start the application with an owned private workspace and an installation-owned authentication file:

```sh
node cli.mjs serve --directory /absolute/private/sling-workspace --auth /absolute/private/sling-auth.json --runtime-ready /absolute/private/sling-runtime/runtime-ready.json --host 127.0.0.1 --port 8781
```

The private auth file uses schema `tjlabs.sling-auth.v1` and an `actors` array. Each actor has `id`, `name`, `roles: ["operator"]` or `["viewer"]`, and an independently generated token of at least 24 characters. Keep this installation file outside source and exported packages. An existing host can instead supply the server's `contextForRequest` adapter. The hosted customer workspace is separate from the development repository.

See [OPERATOR.md](OPERATOR.md) for the actual UI workflow and full download/receiving commands. [migration/OPERATING.md](migration/OPERATING.md) documents all four Airbyte intake families, exact cell types, comparison semantics and downstream edits. [WORKSHARE.md](WORKSHARE.md) defines the proposed paid implementation scope.

## Native reference and application limits

The selected engine is original Sling 1.6.5 at commit `7641892e24a7023c8012069596698970c7b3e041`. The full original baseline and upsert CSV bytes are retained under `reference/original/`; `reference/DERIVATION.json` separately identifies the authored catalogue, binding and consumer configurations.

The complete native programme first loads all 1,000 baseline rows, then executes the 14-row change that updates 12 original IDs and inserts two. The expected final count is 1,002. These are source-derived expectations until the programme's actual result records successful execution.

The current installed execution/snapshot adapter uses SQLite source and parallel target databases. The semantic compiler retains original configuration semantics for the supported intake families and produces native Sling replication documents. A different database pair needs its own complete native export/snapshot adapter; the proposed workshare includes that customer-specific implementation.

The default consumer reads the selected immutable SQLite snapshot. The optional `--consumer-root` identifies actual customer-owned downstream text files for separately reviewed literal changes. Runtime cancellation, uncertain native effects, cross-process ownership, historical reads and returned packages retain their original identities; they do not automatically start another job.

## Complete original receiving programme

The full programme uses one native lifetime, the original source pair, two named source/configuration editions, complete comparisons, a real consumer switch/rollback, both browser widths, fresh receiving and exact historical/same/forward/older package handling:

```sh
node receiving/receive.mjs --source /absolute/component --directory /absolute/private/receiving-operation --runtime-ready /absolute/private/sling-runtime/runtime-ready.json --source-manifest /absolute/source-manifest.json --playwright /absolute/playwright/index.mjs --chromium /absolute/chromium
```

Continue the same operation with the same arguments and `--resume`. The manifest is a JSON object with `files: [{path, bytes, sha256}]` for every editable source leaf; paths are relative to the component. The receiver compares it to the actual complete source inventory before creating its operation. It retains source/runtime selection, every original request and response, complete typed outputs and named archives.

The programme writes `CUSTOMER_RESULT.json` only after its complete native, consumer, browser and receiving phases succeed and the final named archives have been rehashed. Failure keeps the original operation and explicit current phase for recovery. It does not silently create a second workspace or replacement native evaluation.

## Portable handoff

The current complete portable format is canonical newline-delimited JSON, schema `tjlabs.sling-portable.v2`, named `.ndjson` and served as `application/x-ndjson`. Each handoff carries its complete immutable project prefix, exact frozen request rows, original source objects, native attempt files, comparison outputs, consumer snapshots and editable application/engine-reference source. Earlier v2 handoffs contribute their exact frozen headers and request selections to this same object pool. The original record writer verifies that every earlier named handoff can be reproduced byte-for-byte, then materializes its exact file when requested. This avoids recursively embedding complete earlier archives and repeating the runtime inside one package. A download still produces a complete standalone file with its original recorded length and SHA256. Existing gzip-v1 `.ndjson.gz` packages remain readable and retain their literal original archive bytes for unchanged export. Credentials are installation-owned and are not exported.

The receiving application can inspect retained results without configuring the engine. Native continuation requires an explicit runtime selection and action. Handoffs refuse a live native owner and preserve complete same/older history; a forward import fences old observations before adopting the descendant.

## Command line

`node cli.mjs help` lists the full workspace CLI; `node migration/cli.mjs help` lists the semantic and downstream commands. Close the HTTP owner before opening its same workspace with a local CLI writer. Reuse original request IDs and saved input files after interruption. Downloaded output publishes only after its complete original SHA/length has been verified.

## Licensing and provenance

The surrounding application is provided under the included MIT license. Retained Sling source and its unchanged executable retain Sling's original license and notices under `upstream/sling/`. The reused Stellar private-directory/lease modules keep their exact source/license closure under `vendor/stellar-expert/`. The source bundle preserves those boundaries and does not relicense the upstream engine.
