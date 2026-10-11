# Dataset customer workspace

A local customer application for receiving a merchant's dataset offer, reviewing its query and payment caps, continuing the original paginated acquisition, reopening its delivered data, and using it in the existing Python analysis workspace.

The application uses the original `prepareReview`, operator preset, private workspace initializer, `dataset-session.mjs` acquisition/recovery/accounting methods and SF100 data-room exporter. It does not add a purchase engine, wallet, dataset database or SQL implementation. The browser presents original native state, and the original buyer retains per-page approval in the launching terminal.

## Open the application

Use the Node and Python runtimes already required by SF88. Run from this directory:

```sh
node server.mjs \
  --state /absolute/private/customer-datasets \
  --operator-settings /absolute/private/buyer-operator.json \
  --analysis-python /absolute/path/to/python3 \
  --analysis-checkout /absolute/path/to/public-commons-sprint-2026 \
  --analysis-directory /absolute/private/customer-analysis
```

Open the complete private link printed in that terminal. The server binds `127.0.0.1`; its default port is `8439`, and `--port 0` selects an available port. Keep the terminal open. Ctrl+C stops owned acquisition/accounting continuation, drains its retained work, closes the owned analysis process and releases the customer workspace lock.

`--operator-settings` is the existing private buyer preset accepted by [`readBuyerOperatorPreset`](../../buyer-runbook/handoff-intake.mjs). It declares the original actor, service, payer, Python executable and total/daily atomic ceilings, plus the existing signer/proxy settings when required. The customer browser receives the public payer and declared caps; it never chooses a signer executable, policy path or wallet secret. Refer to the original [buyer runbook](../../buyer-runbook/README.md) for custody and operator configuration.

The three analysis arguments are optional as a group. They select the original Python executable, matching source checkout and analytical directory. They are host settings, not merchant-provided commands. A retained-data-only workspace can open without either operator or analysis settings.

## Receive and acquire

1. **Receive a dataset:** choose the merchant's original saved offers or discovery JSON. The exact bytes are retained. Native seller arrays, saved `resources`/`items`, `scf61-observed-native-page-v1` and `ORIGINAL_UNSIGNED_CATALOG` are supported. Choose a GET dataset offer and payment option from that file.
2. **Select the query:** use the original merchant's supported `fields`, `limit`, `sort`, `snapshot`, `where_*` and range parameters. The original dataset query validator and saved discovery preparation enforce the request contract. A snapshot parameter pins the requested edition; otherwise the first accepted native page fixes it. The cursor comes from accepted native pages.
3. **Review the limits:** select a stable session name, page/row/page-byte ceilings and daily/total atomic caps. The review displays the exact URL, asset/network, payee, payer and page allocation. A total cap can intentionally permit fewer than the page limit; the original acquisition stops at its native total cap. Caps are allocations, not settled charges.
4. **Create acquisition:** the original initializer creates its private operator workspace, ledger and native dataset session. This preparation makes no purchase. The reviewed source, preset, native configuration, signer module, policy, session definition and limits remain bound to the received review.
5. **Continue acquisition:** the application runs the original `runDatasetSession`, including native terminal approval, original signer selection, page evidence and cursor continuity. It never supplies an alternate `executePage`. The progress view shows retained pages, actual original outcomes, current snapshot, original request and native stop state.
6. **Finalize data room:** after native `COMPLETE`, the original SF100 delivery builds or reopens the selected room. A completed room is reused. Download its exact JSONL, CSV, HTML review and manifest, or inspect a page of actual JSONL rows in the browser.

All native row types are preserved in the preview. The first access hashes the exact opened delivered file; subsequent reads reuse that check only while the file's device, inode, size, modification time, change time and expected original SHA remain identical. Sparse byte offsets in the original SF100 UTF-8/LF JSONL format allow sequential row browsing without rescanning from byte zero. Downloads stream from the verified open descriptor through one-use, short-lived browser tickets.

## Resume original work

Reopen the same `--state` directory. Existing sessions and browser action history persist, while current acquisition state is read from the original native files. An interrupted browser job is marked `INTERRUPTED`; it is not automatically replayed.

- **Recover interrupted session** calls the original native recovery. Its same-host process and lock-identity checks determine whether a dead lock can be removed. This application does not remove a live or foreign-host native lock.
- **Continue acquisition** resumes the original next page only when native state is `READY`. A retained ambiguous page remains subject to the original reconciliation rules; changing a browser record does not replace that page.
- **Purchases** reads the original existing attempts. **Continue purchase finalization** uses the original attached operator workspace and original `accountDatasetSession(..., finalize: true)` ranges. It does not acquire another page. Product completion and payment finalization are shown separately.
- **History** retains the exact action ID, native result and any failure. If a browser loses the response after dispatch, **Recover saved request** appears on the session view and reuses the same action ID and inputs. Transient server, network and authorization errors retain this request. Starting another action first recovers that saved request without creating a new action ID; an already accepted job returns its original result. The native session and expected review revision prevent a stale new mutation.

The customer metadata uses the repository's maintained Linux `flock` helper, so only one browser application owns a state directory. The original session locks still govern acquisitions shared with another tool. A full disk or interrupted save leaves the native files and original purchase evidence available; reopening inspects those sources.

## Attach an existing completed acquisition

The optional private host profile selects original session and room paths:

```json
{
  "schema": "stellar-forge.sf88.dataset-workspace.v1",
  "sessions": [
    {
      "id": "inventory_widgets",
      "label": "Inventory widgets",
      "session": "/absolute/original/acquisition",
      "room": "/absolute/original/data-room"
    }
  ]
}
```

Save it privately and add `--profile /absolute/private/datasets.json` to the launch command. The original immutable session identity is `session.json`'s `config.operation.intentId`; it is compared with the native inspection result and the complete session definition hash. The matching configuration hash, original query, limits and room path remain fixed for that profile name. Reopen the same state without repeating `--profile`.

Select the attached session and **Finalize data room** to verify/reuse its original delivery. Existing complete acquisition and room files are not copied into a second acquisition. The customer state contains references and browser operation records. Preserve those original source directories when moving or backing up the customer workflow. The analytical workspace's independent native backup is documented below.

## Open the original analysis workspace

In **Data & analysis**, choose an analytical source name and click **Open analysis workspace**. The trusted launcher performs the original commands, with the exact finalized native paths:

```sh
python3 -m stellar_forge_buyer.analysis_workspace \
  --database /absolute/private/customer-analysis \
  --checkout /absolute/path/to/public-commons-sprint-2026 \
  --node /absolute/path/to/node \
  source --name inventory_widgets \
  --session /absolute/original/acquisition \
  --room /absolute/original/data-room \
  --expected-revision 0
```

Then it starts the same module's `serve` command. Source registration precedes the analytical server. The application stops only the analytical child it previously started; a different active workspace owner retains its original native lock. Registration is idempotent for the same native source. Replacing a source alias uses the original saved source revision.

**Go to analysis workspace** opens the original browser and capability. Import the registered completed source there, review the acquired edition, select its native view and run original saved SQL. The existing [Python workspace guide](../python/WORKSPACE.md) explains query/schema comparison, explicit reviewed selection, source-bound report export, analytical backup and fresh-process reopening. Its completed comparison workflow is merged in PR1172 (`c3174f521fa12e6139e3cb7b0c4e7257c2a29c7c`).

The receiving application does not infer that two different queries represent upstream data changes. The analysis workspace preserves the original dataset snapshot, column projection, filter, ordering and immutable edition identity for that review.

## Source interfaces

| File | Responsibility |
| --- | --- |
| `receiving.mjs` | Retain original offers, native review, original operator/session preparation and reviewed setup preflight |
| `model.mjs` | One private customer owner; native session identity, asynchronous original actions, history, purchase views and exact delivered files |
| `analysis.mjs` | Trusted original Python source registration followed by its owned server |
| `server.mjs` | Fixed loopback listener, exact Host/Origin checks, per-instance capability, bounded input and streamed download tickets |
| `public/` | Plain industrial browser for receiving, progress, rows, purchase history and analysis |

Programmatic entry: `startDatasetWorkspace({stateDirectory, profilePath, operatorSettings, analysis: {python, checkout, directory}, port})` returns `{url, origin, close}`. Call `close()` to drain owned work. The server's private capability stays in its original launch link and browser session; it is not written into exported customer job records.
