# ClickHouse fleet native continuation

This retained experiment branch carries the complete source from fleet PR #1195 and the one joined original ClickHouse acceptance driver. The driver belongs to the existing original native operation; the production PR contains the eleven product and guide files.

Select the original ClickHouse owner's already verified runtime. The driver accepts the owner's sealed inherited executable through `CLICKHOUSE_BINARY_FD`, or the owner's retained `clickhouse` executable inside `CLICKHOUSE_JOURNEY_ROOT`. The original runtime remains alive until both sequential journeys finish.

Provide the original saved metadata/review fixture through `CLICKHOUSE_FIXTURE_ROOT`. It contains the existing `revisions` directory and `current.json` from the original native workspace journey. The driver copies these inputs into its own output directory, uses the installed original preparer, and later runs the same original seed against its own native server.

Set these paths for the selected worker:

- `CLICKHOUSE_FLEET_SOURCE`: this complete source checkout.
- `CLICKHOUSE_FLEET_OUTPUT`: a new private output directory, with its parent available.
- `CLICKHOUSE_FIXTURE_ROOT`: the original saved native review fixture.
- `CLICKHOUSE_PLAYWRIGHT_ENTRY`: the worker's existing Playwright module.
- `CLICKHOUSE_CHROMIUM_EXECUTABLE`: its existing compatible Chromium executable.
- `CLICKHOUSE_JOURNEY_ROOT`: the original runtime directory.
- `CLICKHOUSE_BINARY_FD`: the sealed descriptor supplied by the original wrapper when using that route.

Use the existing installed x402 and Stellar dependencies for the source. The original wrapper must pass the sealed descriptor to Node, then close it after both original lifecycle and fleet continuation complete.

```sh
node --max-old-space-size=192 experiments/clickhouse-fleet-acceptance/journey.mjs all
```

`all` executes the actual source-download/import/browser packet phase, closes its first browser, and continues with the native database and original fleet. `browser` and `native` can resume the corresponding phase from the same receipt. Completed browser work is preserved. Native progress is written to `receipt.json`; it names the exact installed source files, original review, download/ZIP hashes, delivered values, local SDK fixture and retained lifecycle results.

Current driver: 35746 bytes, SHA-256 `b49b5fe3763946ffe5186bb8e35e1d400fbfcf07e92a97ffcb4468b06b67ec3c`.
