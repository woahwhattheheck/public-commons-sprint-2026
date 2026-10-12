# Saved 360Giving publisher workspace

Retain complete publisher source editions, review every grant in the existing publisher editor, save exact decisions, create a candidate, query the original native dataset, compare complete builds, and hand the result to another operator.

Each fund has a separate dataset key. A dataset may have several source editions. The native engine retains all 26 mapped columns, including exact monetary text, optional-value states and the complete original grant.

## Install and open

The installed distribution exposes the complete saved workflow:

~~~sh
starforge dataset-360giving-workspace --workspace /path/to/publisher-workspace init
starforge dataset-360giving-workspace --workspace /path/to/publisher-workspace serve
~~~

For a source checkout, use Python 3.11+ and Node 22+. Install the original profile requirements and invoke its direct entry point:

~~~sh
python3 -m pip install -r stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/360giving/requirements.txt
node stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/360giving/operator/cli.mjs \
  --workspace /path/to/publisher-workspace init
node stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/360giving/operator/cli.mjs \
  --workspace /path/to/publisher-workspace serve \
  --connection-file /path/to/private-console-url.txt
~~~

Select Python with a leading `--python /path/to/python` after the command name, or `SF30_NDJSON_PYTHON`. The original native process uses `SF30_XML_NODE` when set, otherwise `node` on PATH. The original publisher requirements are the only additional Python dependencies.

Open the private URL printed by `serve` or written to its connection file. Keep that process open while using the console. Close it before reopening the same workspace through the CLI or another console. Shutdown finishes accepted work and closes the original native child.

`init` creates a new private directory owned by the current operating-system user. The console creates its connection file only at a new path and removes its own file when it closes.

## Browser workflow

1. Under **Add a complete source edition**, choose the dataset key and label. Reuse that key for later editions of the same fund. Select the complete publisher JSON and matching registry record, enter the original source URL, and include original capture/transport files when available.
2. Select the retained edition and open **Publisher review**. The existing editor shows every original grant, exact JSON, official schema results, publisher questions and registry metadata. Enter the reviewing operator and make the intended review decisions and sourced corrections.
3. Select **Save review to workspace**. The exact decision file is retained with its SHA-256. Return to the workspace to create its candidate or complete handoff.
4. Select **Create candidate**. The original publisher applies the selected metadata and explicit corrections, then validates the complete result against its pinned official schemas.
5. Build the original or candidate dataset. Query complete native pages, filter grants/currencies/recipients, sort supported fields, and compare complete builds. **Download all changes** returns every change as JSON Lines.
6. Select **Prepare complete handoff**. The exact ZIP is also available under **Saved work** for later download.
7. In another private workspace, choose the ZIP under **Receive a complete handoff**. Its source, review, candidate and reconstructed native projects become available immediately.

The original review editor can also download and load decision files. **Import an existing decision file** saves that exact file against its source edition.

A complete handoff contains the selected fund and edition. Export each fund separately; their dataset keys, reviews and native projects remain distinct when both are received into one workspace.

## Saved work and continuation

Every mutation retains a request ID and exact input before execution. The server processes accepted operations through one worker. The CLI uses the same saved requests.

After an interrupted connection, reopen **Saved work** and select the original request. **Resume original request** continues its retained inputs and output. A repeated completed request returns its saved result; a different input under the same request ID is rejected.

The browser retains an uncertain admission and offers **Reconcile request**, which resends the same ID and input. An uncertain review save keeps its exact bytes and offers **Resume pending save**.

A request selects the complete publisher program/assets bundle. Keep that source installation available when continuing older requests. Handoffs carry the portable operator source and original publisher assets.

## Command line

The following direct paths are relative to the profile's `360giving` directory. Supply `--workspace` before the subcommand. Use actual source URLs and the exact identities returned by prior operations.

~~~sh
node operator/cli.mjs --workspace /path/to/publisher-workspace intake \
  --request digital-ethics-original \
  --dataset digital-ethics-2022 --label "Digital Ethics Fund 2022" \
  --source-url "https://publisher.example/original.json" \
  --source original.json --registry registry.json --capture capture.json

node operator/cli.mjs --workspace /path/to/publisher-workspace decisions \
  --request digital-ethics-review --edition EDITION_SHA256 --file review.json

node operator/cli.mjs --workspace /path/to/publisher-workspace candidate \
  --request digital-ethics-candidate --edition EDITION_SHA256 --decision DECISIONS_SHA256

node operator/cli.mjs --workspace /path/to/publisher-workspace build \
  --request digital-ethics-native --edition EDITION_SHA256 --candidate CANDIDATE_SHA256

node operator/cli.mjs --workspace /path/to/publisher-workspace query \
  --dataset digital-ethics-2022 --build BUILD_SHA256 \
  --params '{"limit":"25","fields":"grant_id,title,amount_awarded,currency","where_currency":"GBP"}'

node operator/cli.mjs --workspace /path/to/publisher-workspace export \
  --request digital-ethics-delivery --edition EDITION_SHA256 \
  --decision DECISIONS_SHA256 --candidate CANDIDATE_SHA256 \
  --out /path/to/digital-ethics-complete-handoff.zip
~~~

| Command | Purpose |
| --- | --- |
| `state` | Read all saved datasets, editions, reviews, candidates and requests. |
| `review --edition ID [--decision ID]` | Read the complete report and selected decision template. |
| `native-state --dataset KEY` | List original native sources, mappings, builds and comparisons. |
| `compare --request ID --dataset KEY --before ID --after ID` | Compare all keyed rows and retain every field change. |
| `changes --dataset KEY --comparison ID --offset 0 --limit 50` | Read a page of changes. |
| `receive --request ID --file HANDOFF.zip` | Receive and reconstruct the complete handoff. |
| `request --id ID` | Read the original saved operation. |
| `resume --id ID` | Continue that original operation. |
| `upload --file FILE` | Retain an exact input object for API-driven work. |

Native query values are strings. Use `where_grant_id`, `where_currency` and `where_recipient_id` for filters; `gte_award_date` / `lte_award_date` for date ranges; and `sort` for grant_id, award_date or title. A cursor remains bound to its original dataset snapshot and query. Omit `fields` to return every mapped column.

## Complete two-fund workflow

The retained examples include the complete Digital Ethics Fund 2022 package (5 grants) and Connecting to Care Fund 2024 package (7 grants), with their original registry and capture files.

Run both through actual private HTTP operations, native query/filter/cursor pages, complete comparison, ZIP download, independent receiving and cold workspace reopening:

~~~sh
starforge dataset-360giving-workspace example \
  --out /path/to/scvo-complete-workflow --reviewer "Reviewing operator"
~~~

From the source profile directory, the equivalent is `node operator/cli.mjs example` with the same arguments. Reuse the original output directory and reviewer to continue.

The workflow retains every original grant value, records the named operator's source-retention decisions and selects metadata already present in each registry. It produces two complete fund handoffs, two real workspaces, saved decision files and `workflow-result.json`. Either workspace can then be opened with `serve`.

The original profile's `ATTRIBUTION.md` and `examples/*-capture.json` retain source URLs, capture identities and licences.

## Retained storage and API

| Store | Contents |
| --- | --- |
| `objects/` | Exact uploaded input files addressed by SHA-256. |
| `editions/` | Original prepared publisher editions and their immutable input selection. |
| `decisions/EDITION/SHA/` | Exact saved decision files, namespaced by edition. |
| `candidates/` | Full candidates and original decision/program/source bindings. |
| `native/DATASET/` | Original NDJSON workspace, native builds and comparisons for one fund. |
| `requests/` | Saved inputs, progress, results and continuation errors. |
| `deliveries/` | Original generated complete handoffs. |
| `received/` | Every incoming source member and original publisher receiving directory. |

The authenticated loopback API exposes `/api/state`, `/api/upload`, `/api/requests`, `/api/request`, `/api/resume`, `/api/review`, `/api/native-state`, `/api/query`, `/api/changes`, `/api/changes-file` and `/api/download`. It rejects another Host or Origin and renders grant content as text with a same-origin content policy. The live console uses its installed editor.

The original publisher accepts individual files up to 256 MiB. The complete handoff layer accepts a ZIP up to 1 GiB and 2 GiB expanded, with full membership and identity checks. Native input limits remain those of the original NDJSON workspace. The console permits eight HTTP connections, one accepted operation at a time, and one fund's native Node process at a time.


## Saved Applications and connected commands

The same publisher can be saved in the original Applications manager as **360Giving publisher workspace**. Select its private initialized workspace and existing Python, then review, save, connect and start it. The complete setup and source-to-receiver workflow are in [360Giving Applications](../../../../distribution/runtime-workspace/360GIVING_APPLICATIONS.md).

Use `--connection <private connection file>` to operate the running application with the same publisher commands and stable request IDs. Applications keeps that connection path stable when the saved publisher reopens. `changes-file --dataset KEY --comparison SHA256 --out /absolute/complete-changes.jsonl` downloads the complete verified native field changes. The complete managed receiving driver transfers all saved editions, reviews and candidates, then compares full native content after cold reopening both workspaces.
