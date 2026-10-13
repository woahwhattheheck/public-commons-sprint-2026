# Lake County Capital Program

A complete local engineering workspace for the original Lake County, Colorado capital-asset workshare. It retains original source files, explicit record mappings, professional findings, selected-model exchanges, 15-year capital scenarios, staff decisions, full reports and an independently reopenable application.

This application supports the proposed FEA delivery. It does not establish a County contract, an accepted supplier appointment, a grant award, a professional appraisal or a completed client capital plan.

## Start with the received application

The complete handover contains:

- `application/`: every required Python, browser and documentation file.
- `workspace/`: the original SQLite database, all retained source objects, prior versions and exact mutation requests.
- `delivery/`: the selected frozen publication, a full readable report and complete editable register CSVs.
- `manifest.json`: each member's byte count and SHA-256, the native workspace identity, the selected publication and the full application inventory.

Use Python 3.10 or later on Linux. The application uses the Python standard library. It requires Linux `renameat2` for publishing a new received directory without replacing an existing destination. The optional automated browser review additionally uses an explicitly selected installed Node, Playwright module and Chromium executable; it never installs dependencies or downloads a browser.

From the received folder:

```sh
python3 -B application/cli.py status --root workspace
python3 -B application/cli.py serve --root workspace --startup-file private-startup.json
```

Open the private loopback link printed by the server. The token stays in the local startup file and browser session. Keep that startup file private. The complete archive does not include a provider token or browser session.

The server listens only on `127.0.0.1`. It checks the Bearer token, Host and browser Origin for every workspace API call. It does not expose a public service, connect to My Facility Plan or PubWorks, or call a financial model.

## The operator workflow

### 1. Retain original sources

In **Sources & editions**, select the complete original file and enter its authority, source type, source URL and original publication date. Retrieval time is recorded separately.

PDFs and other documents may remain documents. For a CSV or JSON register, inspect the actual columns, select the original record identifier and map only known columns. An omitted value is not filled from a similarly named property. A public directory observation is not an authoritative client asset record.

The workspace retains the original bytes and their SHA-256 before parsing. CSV parsing is strict UTF-8, permits a UTF-8 BOM, and records malformed widths, missing columns and duplicate identities. JSON uses an explicit array pointer. The supported input bound is 32 MiB per original file and 200,000 rows per register input. See **INPUTS.md** for the complete contracts.

### 2. Review an immutable source edition

An edition selects complete originals and their mappings. A following edition can name its predecessor. Every source row carries its original file, source-row position, physical CSV line when applicable, raw values, mapped values and issues.

Duplicate identifiers are never resolved by choosing the first row. An absent or ambiguous asset reference remains unresolved. The **Registers** screen provides pages for inspection; the full native export and register downloads are not truncated to those pages.

Record actual reviews in **Review decisions**. A review is bound to the exact source edition or object version. Crosswalk decisions preserve room/building/site granularity and ownership or maintenance distinctions. They do not rewrite source rows or silently clear original errors.

### 3. Exchange with the selected existing model

Retain the actual model and export files. In **Model exchange**, name the model and its version, document the agreed exchange/recalculation method, and select original key, editable and guard fields.

The prepared JSON includes the original model-file identities and all selected register values. Return a complete original CSV or JSON export as a new edition. The workspace compares all returned records: missing, additional, duplicate, changed, invalid and guarded values remain in the result.

An explicit decision accepts the exact comparison, keeps the original or rejects the return. A return with unresolved identities, guard changes or structural errors cannot be accepted. Recalculation stays with the selected original model and its authorized environment. The application does not guess private workbook ranges, formulas, My Facility Plan APIs or vendor import formats.

### 4. Save source-bound scenarios

A scenario uses supplied actions or an explicitly accepted model return. It selects one currency, one supplied price basis and one 15-year horizon. Five- and ten-year views use the same selection.

A blank start creates an explicitly incomplete draft. Unknown timing, currency, operating impact and amount basis remain unresolved. Supplied zero is retained as zero.

Capital need, planned expenditure, operating impact, authorized funding, contingent funding, actual cash receipt, cash payment and closing cash are separate metrics. Stated funding totals and contextual study-programme figures are not additive asset-capital funding. A valid actual receipt uses its own receipt year even when its authorization predates the horizon. Conflicting closing-cash outputs leave that year's balance unavailable.

No escalation, discount rate, exchange rate, financing, maintenance recurrence, replacement interval, future appraisal or cash balance is inferred. Exact decimal arithmetic uses a private precision context of 320 digits for the declared input bounds.

### 5. Freeze a full handover

An **internal working** publication can preserve public evidence while client inputs remain unavailable. A **reviewed handover** requires a supplied client or prime asset register, actual source acceptance, complete selected scenarios and their explicit reviews. Neither mode records client approval.

Choose the baseline and up to two alternatives. The publication freezes exact source/scenario versions. Later working changes do not change that publication.

Download the full HTML report and complete workspace archive. The export takes one locked native SQLite snapshot and includes every retained original, source version, decision, original request, editable register and required application file.

## Native requests and interruption recovery

The CLI and browser use the same native action API. Every mutation has an original operation ID, actor, native workspace ID, expected workspace revision, action and full payload.

The native workspace first checks whether that exact operation is already complete. A completed original request returns its original result even after later edits. A different payload under the same operation ID is rejected. Only unfinished requests compare the selected current revision.

The browser persists the complete pending request before dispatch. If a reply is lost, use **Reconcile original request**. A different or stale draft is not silently rebased. A definitive rejected request can be retained and reopened only after confirming that no completed native result exists. Selecting a new current basis is an explicit operator action.

CLI example:

```sh
python3 -B application/cli.py prepare --root workspace \
  --operation original-source-review-01 --actor your-operator \
  --action review.save --payload review-payload.json \
  --request original-review-request.json
python3 -B application/cli.py apply --root workspace \
  --request original-review-request.json --result original-review-result.json
python3 -B application/cli.py operation --root workspace --id original-source-review-01
```

Keep the same prepared request on resume. Do not edit its original revision, payload or operation ID to force a replay.

## Browser draft backups and saving recovery

Use **Download draft backup** to retain the current open drafts, pending request and acknowledged operation references for this workspace. **Open draft backup** accepts only this same workspace. Before opening the selected backup, the browser downloads the current drafts so later work stays available. A different current pending request must be reconciled before the backup can replace the open request.

If browser storage fails, keep the page open and use **Download unsaved drafts** before closing or reloading. **Try saving again** reconnects to the original browser store and saves the current drafts. A failed initial read leaves the saved state unopened; it does not replace it with new empty drafts.

The complete pending file upload remains saved before dispatch. Once the native workspace acknowledges the exact file request, the browser retains its operation ID, request hash and complete file reference. The native workspace still keeps the full original request and original bytes. Typing into a later draft therefore does not copy that PDF's base64 into every browser autosave.

## Receive into another selected directory

Use the exact delivered ZIP identity:

```sh
python3 -B application/cli.py receive \
  --archive Lake_County_Capital_Program_Complete.zip \
  --destination received-capital-program \
  --sha256 EXACT_DELIVERED_SHA256 --bytes EXACT_DELIVERED_BYTE_COUNT
python3 -B received-capital-program/application/cli.py status \
  --root received-capital-program/workspace
```

Receiving rejects unsafe paths, duplicate or undeclared members, missing application files, changed member hashes and incomplete source/native selections. Its original receiving receipt and staging directory survive interruption. A completed stage is published using no-replace rename. A later destination edit is preserved and requires an explicit source decision; receiving never overwrites an existing unrelated workspace.

The received application is executed independently; it does not depend on the author's source checkout. The original native workspace identity remains the same. The receiving receipt has its own actual receiving identity.

## Whole operating selection

`operate.py` consumes one exact local selection, creates or reopens the actual internal workspace, retains the complete source, imports selected editions, runs explicitly selected exchanges/scenarios/reviews, freezes the publication and executes the received source in two fresh Python processes.

```sh
python3 -B application/operate.py --selection actual-operating-selection.json
```

A selection includes the original case ID and workshare-source hash, actual local source paths and hashes, explicit mappings, actual operator and original operation ID. Every step persists its request before invocation. Complete result replay reopens the original result/archive; it does not create another publication or receiving workspace.

When the actual browser programme is selected, it visits all seven sections at desktop and phone widths and retains fourteen viewport images. It downloads and verifies the original frozen report and complete workspace before performing the receiving actions. The same received application then downloads/reopens its draft backup, demonstrates one explicitly labelled internal IndexedDB transaction abort and original save retry, reloads that saved draft, and retains the exact already captured public PDF through the normal upload control.

That last action creates an explicitly recorded later receiving revision. Its compact browser backup is checked against the full native original request; it does not create a client asset, source edition or approval. Completed replay preserves that later revision. If an interrupted browser attempt changed the received workspace but left no complete review, the operator stops with the original native request and files retained instead of repeating the upload in a new attempt.

Public source acquisition is handled by the separately selected source collector in the same native execution session when applicable. The application itself consumes the retained originals. It does not fetch substitute data during a replay.

## Administration and limits

Keep the workspace directory private and writable by the actual operator. Back up through the native complete export while the application holds its workspace lock. Do not copy a live SQLite file without its native snapshot procedure or delete unknown initialization/receiving stages.

Archive size is bounded at 512 MiB, compressed and uncompressed. The current implementation is a single local workspace with serialized mutations, not a multi-tenant hosted service. Public URLs and evidence metadata are preserved; production integration, licensed systems, professional judgments and client data access remain explicitly selected work.

## Commission the selected public source edition

The public intake uses the complete original source packet and its sealed collector directory. It verifies every original member and the complete source ZIP before projecting records, then retains the projection rules and complete original JSON records in the workspace.

Run the packet's exact collector in the same native session with `FEA_PUBLIC_SOURCE_SAVE_MODE=embedded` and a private `FEA_PUBLIC_SOURCE_DIR`. Keep its complete directory, including `capture-complete.json`, in the final handover. A repeated collector invocation verifies and reuses the completed edition; changed source URLs or original bytes require a separate source decision.

`commission_public.py` takes the original public packet and workshare source paths, their SHA-256/byte counts, the actual operator, original operation ID, selected workspace/output/receiving directories, and optional existing Node/Playwright/Chromium paths. Use its `--help` output for the complete argument list. It creates the real internal workspace through the same native API; it does not create another commercial case.

The application receives a prepared public-reference edition and the actual captured edition, compares all projected registers, and retains the full comparison. The operating selection and application source hashes are immutable. Resume reuses that exact selection and original native request journal instead of deriving another edition from changed local files.

The added historical registers preserve:

- `financial_observations`: proposed funding, reported rent and historical grant context, with their actual status, unit, recipient and source date.
- `capital_rollforward`: all supplied components and summary rows, with exact opening/addition/deletion/closing values. Each row reconciles independently; summary rows are not summed again with their components.
- `budgets`: complete original historical account lines. Financial column mappings and amounts remain unknown until reviewed against the source page.
- `asset_observations`: source-linked public facility, lease, maintenance, parcel and GIS observations. Public directory and GIS identifiers retain their separate namespaces.

GIS identifier coverage and published edit-marker consistency remain separate. The source files preserve original service geometry, including Z/M when supplied, and all bounded response pages. A complete source response does not imply a current professional asset assessment.

### Preserve capture progress across a temporary runtime

The selected collector records each complete raw body and its exact source receipt before optional text extraction. Both installed `pdftotext` and fallback `pypdf` run in a separate process with a 30-second deadline. A timeout leaves the original PDF retained and its derived-text status explicit.

The connected commissioning producer in `source/continuous_producer.py` takes the original full work-order JSON, including the existing artifact ID and current version. Its source collector runs with `FEA_PUBLIC_SOURCE_CHECKPOINT_MODE=parent_stdio`. After each completed group of at most three newly read sources, and before long GIS/browser work, the collector pauses on a hash-bound checkpoint request. A restored group that uses only retained source receipts does not create another checkpoint. The producer verifies that source manifest, saves the complete current operating artifact as an explicitly incomplete checkpoint, and returns the actual saved identity/version before acquisition continues.

Each checkpoint and final delivery replaces that same item using its last confirmed version. A missing or failed save result blocks further automatic writes. The checkpoint itself retains all complete originals, source receipts, current application source and prior attempt history; it is never labelled a completed capture or client handover.

An explicit `resume_checkpoint` in that work order can select the same saved item's complete metadata result, actual version and ZIP hash/size. The unchanged official download helper restores it. Every archive member is verified before its public source directory is received; the selected checkpoint supplies the missing acknowledgement only for its own exact request. Existing captured sources retain their actual acquisition times and byte identities. This recovery path accepts only an incomplete source-only checkpoint from the same source commit, before native workspace creation. It does not substitute a new workspace for a partially executed native programme.

The ordinary received client application remains a Python-standard-library workspace. The connected producer's official Library helpers are needed only for this internal acquisition/preservation workflow.

The initial public operating publication is explicitly internal work with follow-up required. No client-approved register, private FEA model, condition assessment, replacement valuation, 15-year forecast, confirmed grant cash or client acceptance is fabricated from these public observations.
