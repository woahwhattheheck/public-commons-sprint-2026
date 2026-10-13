# Receive native-currency Forecast and Portfolio planning

This continuation opens a complete original Operations export in an isolated native Workspace, compares the retained USD forecasts and allocations with their original engines, and exercises the currency feature through the original Python API and browser. It finishes by exporting the whole case, importing it into a second fresh store and reopening that store in a separate Python process.

The caller is `examples/native_currency_receiving.py`. The browser callback is `examples/native_currency_browser_receiving.mjs`, exporting `receiveNativeCurrency`. Both use the maintained Workspace, Operations, Forecast, Portfolio, HTTP server and UI. They do not implement a replacement calculator or data store.

## Required source and original inputs

Use one selected repository commit containing the complete Forecast/Portfolio currency feature and its unchanged operating dependencies. The private configuration has schema `stellar-forge.sf47-currency-receiving.v1`. Retain that exact configuration before the first import.

| Configuration field | Meaning |
| --- | --- |
| `operationId` | One stable identity for this complete receiving operation. |
| `repositoryRoot` | Absolute checkout root used to verify repository-relative source pins. |
| `sourceRoot` | Absolute directory containing the maintained `server.py`, `model.py`, `operations.py`, `forecast.py` and `portfolio.py`. |
| `sourceCommit` | The original selected implementation commit. |
| `sourcePins` | Complete selected dependency inventory, with repository-relative `path`, exact `gitBlob` and `bytes`; optional SHA-256 adds a second check. |
| `inputs.case` | Original complete case ZIP path, retained filename, byte count and SHA-256. |
| `inputs.originalForecast` and `inputs.originalPortfolio` | Exact prior engine source used to recalculate and export every legacy record. These separate source copies never replace the new engines. |
| `inputs.economics`, `inputs.terms`, `inputs.exchange` | Complete original underwriting, agreement prerequisites and selected exchange-reference source. Their descriptors include original path, filename, exact byte hash, media type, source URL and observed-at metadata. |
| `originalCase` | Exact original program ID, plan ID, version and complete forecast/portfolio counts. |
| `baselineForecastId` | A deliberate selection from the original export. Do not infer it from a filename or silently choose a later sensitivity. |
| `commercial` | A complete native commercial input, with original amount/currency, remaining cost/hours, milestones and unresolved business dates. |
| `rates`, `rateSources`, `selectedRateId` | Explicit rates and their original source attachment bindings. |
| `allocationResource` | An explicitly described receiving capacity assumption. It is not a staff booking. |

Every file is copied into the receiving directory only after its byte count, SHA-256 and, where supplied, Git blob identity match. Original native source files are validated before any Workspace opens. `SOURCE_INVENTORY.json` records the actual byte hashes of all selected source files.

Keep customer-specific amounts, private terms, account references and the complete real case in private receiving configuration and artifacts. The public product example uses a generic native amount. There is no default rate, current-rate lookup or implied settlement transaction.

The commercial source uses the native fields documented in `CURRENCY.md`. Milestones contain `amountNative`; the quoted price and delivery cost each retain their own currency and selected rate ID. The original actual USD cash and invoice records are not rewritten. An exchange rate means one unit of its base currency equals the stated number of quote-currency units.

## One native lifetime

Use one owned worker and one retained output directory. Stop another writer before opening the same original Workspace. The normal Workspace lock and request journal remain authoritative.

On hosts where a temporary filesystem is local to one execution namespace, keep preparation, the browser callback, final verification and archive publication in that same held worker. A later unrelated shell may not see that temporary filesystem. Preserve the completed outputs and any interrupted state before the held worker exits.

Set `TMPDIR` to an owned directory with enough space for browser and archive work. Keep the original input archive unchanged. Do not delete the original case or reset the request files to repeat a completed action.

### Automatic caller in one worker

`examples/native_currency_held_receiving.py` performs all three phases below, closes their child processes, and publishes the complete private archive before releasing its worker. Its intake has schema `stellar-forge.sf47-currency-held-intake.v1`: `operationId`, `sourceCommit`, the complete original `privatePacket`, and the full selected `sourceFiles` and `companions`. Each source item retains its repository-relative path, UTF-8 content, byte count, SHA-256 and Git blob. The complete original case remains a separately supplied file with its own fixed identity.

```sh
python3 -u examples/native_currency_held_receiving.py \
  --base /absolute/owned/native-currency \
  --archive-directory /absolute/persistent/receiving-archives \
  --intake /absolute/private/complete-intake.json \
  --case-file /absolute/private/original-case.zip \
  --playwright /absolute/installed/playwright/index.mjs \
  --chromium /absolute/installed/chromium \
  --hold-result
```

When `--intake` is omitted, the caller emits `INPUT_READY` and reads one complete bounded JSON line from standard input. Keep that input and the receiving run in the same worker; a separate execution namespace may not retain the same temporary directory.

The original case is verified before it is copied into the caller's retained input location. Reentry can use those same retained bytes when the former external source path is unavailable. Each process records its actual runtime under `RUNTIME-<attempt>.json`; earlier runtime observations remain unchanged.

Use a persistent archive directory that is outside the temporary receiving tree. The caller verifies the complete copied archive before returning `SHARED_ARCHIVE_READY`. A full shared filesystem does not prevent the original calculations or browser continuation from running; local state remains available while the caller attempts the available publication route.

On a ChatGPT worker with the original bundled `library_upload.py`, the caller can run that helper from the same namespace. Supply `--library-helper /absolute/installed/library_upload.py` only when selecting an actual installed helper explicitly. Otherwise the caller uses its known bundle when present and can complete on an equipped VM without that plugin. The original helper owns upload preparation, transfer and finalization; the caller retains its full response and requires an actual successful item before reporting the upload as complete.

If neither a verified persistent archive nor a successful upload exists, delivery remains `PRESERVATION_PENDING`. Keep the held worker open and preserve the actual archive before ending that execution namespace. The native phase result and the delivery result are separate fields: a passed calculation is never reported as a successful save by itself.

With `--hold-result`, the caller accepts `{"action":"status"}`, `{"action":"inspect-image","name":"forecast-mobile.png","offset":0}` (or the desktop filename), and `{"action":"finish"}` after publishing its result. Image replies are bounded byte pages with the complete original file's SHA-256 and byte count. The two inspection PNGs are kept separately from the private source/case archive.

### 1. Prepare the original case

```sh
python3 -B examples/native_currency_receiving.py \
  --config /absolute/private/CONFIG.json \
  --output /absolute/owned/receiving \
  --phase prepare
```

The preparation phase:

1. Verifies the complete original case and pinned source identities.
2. Recalculates all retained legacy forecasts and portfolios through both the old and new engines, comparing their complete exports byte for byte.
3. Imports the original case through `Operations.import_bundle` and replays the same import request.
4. Attaches the original economics, terms and exchange-source bytes through `source.add`, then downloads and checks those native source records.
5. Saves an unresolved native quote without inventing a rate, customer payment or business date.
6. Closes and reopens the original Workspace before recovering the exact original save request.
7. Saves an operationally complete allocation whose incomplete financial valuation remains outside the financial frontier and funding delta.
8. Checks a separately retained, unsaved diagnostic with a dated unresolved receipt: complete cash metrics remain null and the known portion remains available.
9. Explicitly selects an original reference rate, conserves the quoted milestone total through cumulative cent rounding, and retains every native amount and currency.
10. Uses the original Portfolio date-selection API to create a separately named allocation sensitivity with the complete native pricing and rate source intact.
11. Rejects changed reuse of an existing request ID.
12. Reconciles native cash and cost-credit rules through controlled original-helper calculations that are never inserted into the business case.
13. Exports each selected forecast and portfolio, plus the complete case before the browser phase.

The source quote and its initial saved native forecasts keep unresolved work and collection dates empty. A later Portfolio sensitivity carries its own explicit capacity and release assumptions. It does not change the original quotation or turn that assumed release into an accepted customer start.

Successful preparation closes the native Workspace before publishing `NATIVE_READY.json`. Its `sourceRoot` is the directory containing `server.py`; `workspaceRoot` is the original directory containing `planning.sqlite3`.

The ready contract contains exact source/case identities, legacy record arrays, the saved native forecast/portfolio IDs, retained rate objects and source IDs, expected native/USD values, and the policy for controlled credit examples. No caller should manufacture these IDs.

### 2. Run the actual browser continuation

The caller supplies an already available Playwright Browser and owns its lifetime:

```js
import { receiveNativeCurrency } from './examples/native_currency_browser_receiving.mjs';

const result = await receiveNativeCurrency({
  readyFile: '/absolute/owned/receiving/NATIVE_READY.json',
  outputDirectory: '/absolute/owned/receiving/browser',
  browser,
  pythonExecutable: '/absolute/path/to/python3',
});
```

The callback owns one browser context and two sequential instances of the maintained Python HTTP service. It starts the original server against the prepared Workspace and uses the normal access form, plan selector and Delivery operations views.

The complete flow checks legacy/native editor switching, unresolved valuation, the known cash portion, explicit FX source entry, preview/save/export, incomplete and priced Portfolio displays, Portfolio-to-Forecast date selection, the mobile view, whole-case download and a fresh service reopen. Mutation bodies and native request IDs are retained before dispatch; an interrupted save resolves through its original saved request and native record.

The callback closes its services before publishing `browser/RESULT.json` with `state: "PASS"`, the exact case ID and the SHA-256 of `NATIVE_READY.json`. The outer caller then closes the supplied Browser.

### 3. Verify the full portable case in a fresh process

```sh
python3 -B examples/native_currency_receiving.py \
  --config /absolute/private/CONFIG.json \
  --output /absolute/owned/receiving \
  --phase verify \
  --browser-result /absolute/owned/receiving/browser/RESULT.json
```

This phase requires a Python process distinct from preparation. It verifies the actual browser result, reopens the original receiving Workspace, confirms the complete original business records and saved legacy records are unchanged, and recalculates every current saved forecast and portfolio.

It exports the complete current case through the original exporter and checks every manifest member. The original importer then receives those exact bytes into a second store. The same import request is replayed without another case, all source bytes and saved records are checked, and that store is closed and reopened.

The list APIs and archive retain their own original order. Receiving compares keyed record identities and full bodies; it does not reorder or edit the exported source to make a check pass.

## Recovery and output custody

`CONFIG.json`, source/input files, command requests, successful replies, previews, saved native records and result artifacts are retained under the same operation. Source files and results are published atomically. Changed bytes under an existing immutable artifact path are rejected.

A command request is written before its native dispatch. If a process stops after a commit but before its reply file is published, the next continuation submits the exact same request. The original native journal either returns that same result or reports a conflict; the caller does not silently create a different request.

Use the same configuration and output directory when resuming. A completed preparation returns its original ready result. A completed final verification returns its original result. Keep any `FAILED-*.json` alongside the actual successful continuation.

The final private handover includes:

- `RESULT.json` and the original `NATIVE_READY.json`.
- Exact selected source inventory and private configuration.
- The complete original case, original engine copies and business/reference source files.
- Every original native request/reply, saved forecast/portfolio and preview used in receiving.
- Forecast and Portfolio ZIPs with native amounts, source rates, credit/rounding details and known-versus-unvalued cash.
- Browser journal and full original downloads; keep the two layout-inspection PNGs as separate optional sidecars.
- The complete final Operations export and its full fresh-import receipt.
- Both closed Workspace databases and their original source histories.
- Any original failure artifacts and the actual successful continuation.

A source parse or a prepared ready file is not a completed browser or full portable-case result. Report each stage according to its actual native receipt.

### Continue a preserved prepared archive

When the original preparation passed and a later receiving step stopped, retain the complete closed operation archive, its exact byte length and SHA-256, and the SHA-256 of its original `NATIVE_READY.json`. Confirm the previous process has ended before taking the same operation's lock. The existing held driver accepts an optional `resumePrepared` object in its complete intake:

```json
{
  "resumePrepared": {
    "archivePath": "/absolute/persistent/original-INTERRUPTED.zip",
    "archiveBytes": 123456,
    "archiveSha256": "<the original archive's full SHA-256>",
    "readySha256": "<the original NATIVE_READY.json SHA-256>",
    "sourceCorrections": [],
    "priorExecution": {
      "state": "FAILED_AFTER_PREPARATION",
      "note": "Preserve the actual first failure and any unresolved delivery receipt."
    }
  }
}
```

The numbers and digests above are placeholders. Supply the actual retained values. Keep the same execution base used by the saved configuration so every native source, SQLite and request path remains bound to its original identity.

The driver verifies the complete archive before restoring regular files, rejects conflicting existing bytes, and checks the original ready state, operation, case, plan and version. It verifies all selected product source pins, reuses the successful preparation, then runs the original browser and fresh-process verification. It does not import a new business case or regenerate saved forecast and Portfolio identities.

If a concrete receiving defect requires a companion correction, provide that complete corrected companion in the intake and add one `sourceCorrections` entry with `path`, `beforeBytes`, `beforeSha256`, `beforeGitBlob` and `reason`. The path must be one of the declared receiving companions. The original product source pins cannot change through this seam. The driver verifies the exact before-image, retains its complete bytes plus the before/after identities, then applies the correction atomically. The continuation receipt retains the parent archive, original ready SHA and every receiving-source change.

Keep the first failure and any uncertain upload result explicit. A subsequent complete-case archive has its own actual delivery identity; creating that archive does not retrospectively establish whether an earlier interrupted upload succeeded.
