# Dataset buyer in Applications

The Dataset buyer opens the original SF88 receiving application from the selected installed runtime. It keeps the original customer workspace, acquisition sessions, SF100 rooms, purchase history and Python analysis owner.

## Open a customer workspace

1. Select an original READY runtime containing `buyer-dataset-workspace`, then choose **Dataset buyer** in Applications.
2. Choose the private customer workspace. Reuse its original directory to reopen saved offers, query choices, sessions, delivered files and history. A new directory can be created inside an existing private parent.
3. Optionally select the original session profile to attach already retained acquisitions and their data rooms. The profile uses the original `stellar-forge.sf88.dataset-workspace.v1` schema, with `sessions` entries containing `id`, `label`, `session` and `room`. Applications retains the file identity and each original session definition; the buyer itself checks the native session/configuration identity.
4. Select the original private buyer operator preset when preparing a new acquisition. Existing retained data can open without a preset. The native preset and original per-page approval determine the permitted acquisition.
5. For analysis, select both the original Python executable and private analytical workspace directory. Applications preserves a lexical virtual-environment executable and its original binary/configuration binding. It derives the source checkout from this same selected READY runtime, so the Python and Node components use the same installed source.
6. Review and save the application, then review its current inputs and start it through the existing managed operation. **Open application** uses the original private loopback link. Its capability remains in the original private operation and browser session.

The original managed terminal stays connected to this buyer. A page acquisition still presents its original review and terminal approval; selecting an application or opening a retained dataset performs no purchase. The optional terminal Python executable only supplies that original PTY and defaults to `/usr/bin/python3`.

## Use the original receiving and analysis workflow

Within the customer application, receive the merchant's original offers or discovery file, select its dataset and query, review page/row/byte/payment caps, and prepare the original acquisition. A saved native session resumes through the same page cursor and permanent attempt records.

For an already completed acquisition, use its retained session entry to inspect history, page through typed rows, download the native JSONL/CSV/review files, or open the original analysis handoff. The analysis action registers the original session and finalized SF100 room before starting the owned Python service. It does not acquire those pages again.

The linked analytical browser is the original workspace: choose the imported edition, review changes and views, use saved SQL, create reports and export or reopen its retained backup. Applications supplies its selected source and executable; the original database, source aliases and immutable version IDs remain authoritative.

## Stop and reopen

Use **Stop** on the original managed operation. The buyer stops its owned acquisition/accounting continuation, drains retained work, closes its owned analytical service and releases its original lock. Do not launch another owner against that live analytical database.

A subsequent start uses the saved settings with a fresh original input/start review. Reopen the same customer workspace and analysis directory to retain sessions, delivered files, source aliases, SQL and reports. Interrupted acquisitions remain governed by their original status and recovery actions; opening Applications does not authorize replaying an uncertain purchase.

The selected runtime stays pinned to its original installation, source manifest, dependency profile and lock. Choose and review a different runtime explicitly when moving an application to another installed edition.

## Original source joins

`application-dataset-buyer.mjs` exports:

- `datasetBuyerApplication(common)`: the one catalogue entry and original operator fields.
- `prepareDatasetBuyerApplication(settings, {inputPath, selectedExecutable, runtimeDirectory})`: original command arguments, retained input identities and new customer directories for the existing application lifecycle.
- `datasetBuyerStartup(request, text)`: a private URL from the original selected command's startup output.

The caller keeps the existing full runtime/source verification. The helper reads the original READY metadata binding with `source:false` to avoid hashing the entire package twice, and derives the analysis checkout from the resulting `sourceRoot`.

The original dataset server accepts optional `--startup-format json`. It prints one `stellar-forge.sf88.dataset-workspace-launch.v1` LISTENING record with its state/profile/operator/analysis paths, actual process ID and private URL. The shared observer matches those paths and the selected port against the retained argv. The original managed worker owns process identity and shutdown.

Already installed editions without the new `dataset-workspace/launch.mjs` keep their original human startup prefix. The helper selects that compatibility path only when the selected runtime lacks the structured source. Once `--startup-format json` is selected, an invalid structured announcement cannot fall back to the human prefix.

### Compose with the existing Applications owner

In `applications.mjs`, import `datasetBuyerApplication` and `prepareDatasetBuyerApplication`, add `datasetBuyerApplication(common)` to the existing catalogue, and extend the original command helper to accept `runtimeDirectory`:

```js
} else if (type.id === 'dataset-buyer') {
  const prepared = await prepareDatasetBuyerApplication(settings, {
    inputPath, selectedExecutable, runtimeDirectory,
  });
  args.push(...prepared.args);
  inputs.push(...prepared.inputs);
  createDirectories.push(...prepared.createDirectories);
}
```

Keep the existing common port, environment and terminal handling. Pass the original runtime directory at all four call sites:

| Existing operation | Runtime argument |
| --- | --- |
| `reviewApplication` | `runtime.directory` |
| `saveApplication` | `reviewed.runtime.directory` |
| `reviewApplicationStart` | `runtime.directory` |
| `prepareApplicationStart` | `saved.runtime.directory` |

In `application-command.mjs`, import `datasetBuyerStartup` and add this branch to the existing per-line original CLI observer:

```js
if (request.command === 'buyer-dataset-workspace')
  candidate = datasetBuyerStartup(request, text);
```

Retain the existing private URL file, original application/operation IDs, PTY input, worker lifecycle and every concurrent catalogue entry. This module does not introduce another dispatcher or database.

