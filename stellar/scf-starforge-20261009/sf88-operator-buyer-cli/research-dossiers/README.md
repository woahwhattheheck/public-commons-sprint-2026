# Research dossiers for the SF88 buyer

A local research application that turns saved research deliveries into a project
with questions, selected evidence, notes and cited findings. It lives beside the
original SF88 buyer and uses its verified saved result and private file primitives.

The operator can receive several editions for each question, inspect complete
source content, compare revisions, export a readable report and reopen the same
portable project elsewhere. Identical sources are grouped by DOI or URL while
each original edition occurrence and content variant remains available.

## Open the operator

Use the complete sprint source checkout and its existing Node 22+ runtime.
The dossier application itself uses Node built-ins and adds no npm dependencies.

From the checkout root:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/server.mjs \
  --dir /private/research-workspace
```

The parent of the private directory must exist. Open the local URL printed by the
command, including its token fragment. An existing directory retains its projects
and revision history. The listener binds to 127.0.0.1; requests carry the generated
operator token and responses disable browser caching. An optional `--port` selects
the local port.

Use the left project list to create or reopen a dossier. Within a project:

1. Write the research questions and their current status.
2. Receive an authorized saved JSON result or attach an original provider edition.
3. Inspect its complete typed content, variants and original references; mark
   evidence as supporting, contradicting, background or unreviewed.
4. Write findings and select the sources belonging to that finding's question.
5. Compare revisions, export HTML or Markdown, or download portable JSON.

The interface retains the expected revision when editing. If another operator
writes first, refresh the current state before applying the intended edit.
Existing notes on an unavailable edition remain editable through their original
occurrence handles.

## Receive a saved research delivery

There are two retained-data inputs:

- `openalex`: an actual OpenAlex works response with `meta` and `results`.
  The application preserves the original response and works records, reconstructs
  the abstract from its original inverted index, and exposes current locations,
  topics and reference IDs. OpenAlex metadata is CC0; linked full text has its own
  licence. The application imports metadata and does not fetch linked full text.
- `research`: the explicit envelope below for content the operator may retain.
  `sourceTerms` records the actual source permission. The source JSON is retained
  byte-for-byte; normalized display fields sit alongside the original records.

```json
{
  "schema": "sf88-research-results-v1",
  "provider": "your-original-provider",
  "query": "the actual research question",
  "sourceTerms": "the actual source licence or retained-use agreement",
  "results": [
    {
      "id": "original-source-id",
      "title": "Original title",
      "url": "https://original-source.example/document",
      "content": {"section": "The original complete returned content"},
      "authors": ["Original author"],
      "citation": "Original citation",
      "references": ["Original reference"],
      "metadata": {"original": "provider fields"}
    }
  ],
  "usage": {},
  "warnings": []
}
```

This is an input-shape example. Supply the original records for the intended
project. `content` accepts a string, an object or an array of objects. A source's
title, authors, citation, references and metadata remain attached to its original
occurrence even when another edition contains identical text.

An existing Node buyer can hand its original saved result directly to the store:

```js
import { openDossierStore } from './research-dossiers/index.mjs';

const dossiers = await openDossierStore('/private/research-workspace');
const project = await dossiers.get(existingProjectId);
const result = await originalBuyer.operation(existingIntentId).recover();
const updated = await dossiers.receiveBuyerResult(project.id, {
  result,
  intentId: existingIntentId,
  questionId: existingQuestionId,
  provider: 'openalex',
  label: 'Original completed delivery',
  expectedRevision: project.revision,
});
```

The import calls the original result's `bytes()` method and binds the saved
length and SHA-256 to the dossier edition. This composes the original completed
operation. The saved result remains recoverable in its buyer workspace.

## Import a complete saved OpenAlex cohort

Connect the dossier to the original OpenAlex saved workspace when launching it:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/server.mjs \
  --dir /private/research-workspace \
  --openalex-workspace /private/original-openalex-workspace \
  --openalex-module /absolute/original-checkout/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research/workspace.mjs
```

The workspace must already contain its original `queries` and `editions`
directories. `--openalex-module` selects the installed original workspace module;
omit it when that module is included beside this dossier in the cumulative
release. Module and directory choices are made in the local launch command.
The browser chooses saved edition IDs from that existing workspace.

Choose **Add research → Saved OpenAlex cohort**, select the dossier question,
and inspect the saved cohort's query, coverage, page count and review revision.
Importing receives the original workspace's current saved edition. A growing
collection can be imported again: completed page identities are reused and
new saved pages are added. A changed source query, page index or review record
gets a new retained cohort snapshot.

The metadata edition preserves the source coverage exactly: `EMPTY`,
`PARTIAL`, `COMPLETE` or `INTERRUPTED`. It also retains the original query,
edition record, review decisions, page/request metadata and native buyer
records. Each raw response is its own original OpenAlex edition. Source review
decisions remain provenance; the operator controls dossier selections, notes
and findings independently.

A retry uses the source-file fingerprint, so export/report timestamps do not
create duplicates. If a request stops after some pages, the current dossier
keeps those pages and the next import resumes from its current revision.
The CLI returns `openAlexImport` progress on interruption; the browser reloads
the committed dossier before offering the same cohort again.

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/cli.mjs import-openalex \
  --store /private/research-workspace --id DOSSIER_ID --question QUESTION_ID \
  --openalex-workspace /private/original-openalex-workspace \
  --openalex-module /absolute/original-checkout/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research/workspace.mjs \
  --edition ORIGINAL_EDITION_ID --revision CURRENT_DOSSIER_REVISION
```

Applications that already own the original workspace can compose it directly:

```js
import { receiveOpenAlexEdition } from './research-dossiers/index.mjs';

const current = await dossiers.get(existingProjectId);
const imported = await receiveOpenAlexEdition(dossiers, current.id, {
  workspace: originalOpenAlexWorkspace,
  editionId: existingSavedEditionId,
  questionId: existingQuestionId,
  expectedRevision: current.revision,
});
```

`startDossierWorkspace({directory, openalexWorkspace})` accepts that same
existing object. Its caller retains the original workspace lifetime; the
launch command closes the object it opens when the server stops.

## Attach the original Valyu research edition

The maintained [Valyu merchant and customer workspace](../../sf30-seller-sdk/valyu/)
owns the provider request, its projected delivery, original edition store and
source entitlement. Pass that workspace's existing `ValyuStore` to the adapter:

```js
import {
  startDossierWorkspace,
  createValyuEditionProvider,
} from './research-dossiers/index.mjs';

// originalValyuStore is the running original workspace's ValyuStore.
const workspace = await startDossierWorkspace({
  directory: '/private/research-workspace',
  providers: { valyu: createValyuEditionProvider(originalValyuStore) },
});
console.log(workspace.url);
```

The original store module is
`sf30-seller-sdk/valyu/store.mjs`; its public factory is
`await ValyuStore.open(directory, { provider })`. Prefer the already-open store
inside that workspace. Its owner closes it when the original application exits.
The dossier adapter only calls `editionView(id)`.

For a separately launched dossier operator, provide a trusted local module that
exports a `providers` object using the same adapter. Load it with
`--edition-adapter /absolute/path/to/original-edition-adapters.mjs`.
This module is operator-installed code. Source IDs and uploaded JSON cannot
select modules, credentials or filesystem paths.

Attach the edition to the question as:

```json
{"editionId":"the-original-valyu-edition-id"}
```

The adapter preserves `row.occurrenceId` as the stable source handle, original
typed content and references where the original edition permits them, and the
original usage, warnings and partial-response state. Retention-restricted rows
remain visible as opaque source handles with editable analyst notes. Their
status remains partial when the provider returned results that cannot be retained.

Dossier history stores the edition handle and the customer's own questions,
notes and findings. The original permitted view is read in memory when the
operator opens it. Report and portable exports retain those handles and authored
analysis; they do not copy provider-controlled source bodies from a reference
edition. The original Valyu workspace remains the source of edition access.

## CLI

Every state-changing command requires the current revision returned by the
preceding operation. Use absolute private paths for the store, input and output.

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/cli.mjs help
```

| Command | Purpose |
| --- | --- |
| `create` | Create a project with title and description. |
| `list`, `get` | List projects or open a current/historical revision. |
| `question` | Add a research question. |
| `receive` | Receive a complete original OpenAlex or retained-research JSON file. |
| `attach` | Attach an original edition reference through its configured provider. |
| `import-buyer` | Recover the existing SF88 operation and import its saved result. |
| `note` | Select evidence and save its note and classification. |
| `finding` | Add a question-specific finding with original source references. |
| `compare` | Compare two persisted revisions. |
| `export` | Save complete HTML, Markdown or portable JSON. |
| `reopen` | Reopen a portable project with its original identity and history. |

The Node API additionally exposes `update`, `updateQuestion`,
`updateSelection` and `updateFinding` for the same operator forms.

## History, export and reopening

Each successful edit appends an immutable, create-only revision linked to the
preceding revision's hash. Concurrent writes to the same next revision cannot
overwrite each other. Retained original response files are content-addressed and
checked against their length and SHA-256 before use.

Portable JSON contains the complete revision history and all permitted retained
source bytes. Reopening the identical project is idempotent. A receiver can append
a matching continuation to its original history; conflicting histories and altered
source bytes are rejected. A report includes the questions, findings, selected
evidence, source occurrences and original retained records.

Current limits are 64 MiB per retained response, 8 MiB per revision, and 256 MiB
for the complete portable document. The operator's individual source-upload
control accepts 16 MiB; use the CLI or Node API for a larger allowed original
response. Typed source content is not shortened by report or portable export.

## Native operation

The application was operated through its real Node HTTP server on
2026-10-11 using three original MIT SF88 source records at repository commit
`5a71931713a7e72ca6b5ca78679a24df18dba3f0`:
`node/result.mjs`, `node/store.mjs` and `node/workspace.mjs`.

Operation `SCF-RESEARCH-DOSSIER-CB57-20261011` created two questions, two editions,
four source occurrences grouped into three sources, two findings and eleven
revisions. Fifteen HTTP requests exercised the operator, stale-edit rejection,
revision comparison, HTML/Markdown/portable export and two idempotent reopens
of the same project. It retained exact original source content and rejected
an altered portable blob. The process exited 0 at 22:16:46 UTC with peak RSS
69,744 KiB. Subsequent source review preserved per-occurrence metadata and
question-specific finding references.

## Source contracts

- [Original SF88 Node buyer](../node/README.md)
- [Original buyer result storage](../node/result.mjs)
- [Original private file primitives](../node/store.mjs)
- [Valyu edition source](../../sf30-seller-sdk/valyu/store.mjs)
- [OpenAlex data construction and licensing](https://help.openalex.org/data/how-its-built/)
- [OpenAlex synchronization](https://help.openalex.org/access/sync/)
- [Valyu acceptable use policy](https://www.valyu.ai/valyu-acceptable-use-policy)
- [Valyu platform service agreement](https://www.valyu.ai/valyu-platform-service-agreement)

## Runtime Applications launch contract

The `research-workspace` command serves the same private dossier store used by this SDK and CLI. The runtime Applications entry supplies `--dir`, optional `--edition-adapter`, optional `--openalex-workspace` and `--openalex-module`, and the selected local port. An existing directory reopens the retained questions, source editions, selections, findings and history.

Startup writes one JSON line containing `mode: "RESEARCH_DOSSIER_WORKSPACE"`, the exact selected `directory`, the actual private `url`, configured `providers`, and `openalexConfigured`. Managed consumers should accept this URL only from this command and the matching `--dir` input. Use the returned URL; its fragment supplies the original capability. SIGINT or SIGTERM closes the HTTP server and the original configured OpenAlex workspace.

An OpenAlex workspace must already contain its original queries and editions. Without an explicit module override, it is opened by the original `research/workspace.mjs` in the same selected source. The Applications configuration retains the chosen directory and module paths; the research application controls source intake, review and exports.
