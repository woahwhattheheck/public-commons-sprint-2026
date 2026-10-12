# Export the existing SCF submission from the command line

Prepare complete copyable answers from the same submission draft used by the browser workspace. This command uses the maintained submission, planning and handover models. A saved draft retains its identity, source editions, edited answers, issuer fields, versions and review history.

## Export a saved draft

Use the installed grant-reviewer product or complete merchant toolkit:

~~~sh
starforge grant-export \
  --draft /private/scf/saved-submission.json \
  --out /private/scf/prepared-20261012
~~~

The original command registry passes every argument and exit code to the maintained exporter. Use `starforge grant-export --help` for its options or `starforge registrations --command grant-export` to inspect the selected source. The package also exposes the same functions as `./grant/application-exporter` under its actual package name.

For a complete source checkout, use Node.js 22 or newer:

~~~sh
node stellar-forge/developer-site/grant-export.mjs \
  --draft /private/scf/saved-submission.json \
  --out /private/scf/prepared-20261012
~~~

The command opens and verifies the original submission export envelope or its complete native draft through the existing handover API. Each export prepares a native frozen edition, saves the existing version history, and writes the original checksummed envelope for reopening. The new directory contains the full native draft for reopening in the existing submission workspace, all nine edited canonical answers, the native form map, the selected prepared values, individual text files and an offline review/copy page.

| Output | Content |
| --- | --- |
| draft.json | Original checksummed submission export envelope, including its native prepared edition, complete draft and retained history |
| application.md | All nine current canonical answers, with their full Markdown |
| form-map.json | Original native issuer form map |
| prepared.txt and prepared.json | Native edition output, selected answers or mapped fields, exact values, counts, recorded limits and field issues |
| fields/*.txt | Exactly one selected value per file, with no added trailing newline |
| review.html | Complete offline values, copy controls, counts and full printing |
| manifest.json | Selected source identities and hashes of every generated output; written last |

Open review.html to read, copy or print. Printing includes long values across as many pages as needed. The native draft can be reopened through the original **Prepare submission** interface; its planning sources, handover and reviews remain in that same record.

## Receive an application edition

A new draft needs the complete application and its matching original source index, plus the actual source URL:

~~~sh
node stellar-forge/developer-site/grant-export.mjs \
  --source /private/scf/application.md \
  --source-index /private/scf/source-index.json \
  --source-url https://example.org/grant-data/application.md \
  --budget /private/scf/budget.csv \
  --companion /private/scf/product-and-finance.md \
  --id scf46-working-draft \
  --out /private/scf/received-application
~~~

Replace the example URL with the source actually received. The command verifies the original byte length, SHA-256 and Git blob identity before creating the draft. The budget and companion options retain all four original reviewer files through the existing handover source-bundle API. Supply both together; existing saved drafts retain their previously received bundles, evidence, planning sources and source editions. Omitting the pair receives just the application and index, while the native handover records the original file context available for that edition.

Use the [original composer](GRANT_COMPOSITION.md) to receive a changed manuscript into the current application and source index. Use the browser workspace's existing source comparison to receive it into an edited draft.

## Select the prepared values

By default, an existing issuer map selects its saved fields; a draft without one selects the nine canonical answers. Use `--select answers` or `--select fields` to make that choice explicit.

The draft's existing handover operator, title, note, bundle and evidence selections are retained when preparing the new edition. Use the original workspace to edit those selections.

Use `--format plain` for the model's normal form-copy conversion, or `--format markdown` to preserve markup in each prepared value. Counts and recorded-limit comparisons apply to exactly that selected output. The complete canonical Markdown is always retained in application.md.

The `--form-map /private/scf/issuer-map.json` option imports a native map using the original model's versioning behavior. It retains the map's saved field text and manual edits. To refresh a mapped field from selected answers, use the existing submission workspace's explicit refresh operation and export that saved draft.

Over-limit answers remain complete. Exit 2 reports recorded limits exceeded; exit 0 reports completed output; exit 1 reports an input or filesystem error. A blank limit or unspecified character convention remains visible for the operator's field review. No destination limit is guessed.

The output directory must be new. Files use private permissions and each output is created exclusively. A filesystem failure can leave that new directory incomplete; a complete manifest is the final file. The source draft and any existing output directory remain intact.

Keep generated drafts and prepared files in the original internal application workspace. This command is included with the whole developer-site source component selected by the grant-reviewer product.

See [the submission guide](GRANT_SUBMISSION.md) for editing and form mapping, and [review rounds](GRANT_REVIEW_ROUNDS.md) for the existing named review and author handover.

