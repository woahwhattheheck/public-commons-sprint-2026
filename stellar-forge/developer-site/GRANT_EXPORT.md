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
| source-package.json | Complete selected application, source index, budget and companion for source receiving, whenever the draft has a selected complete bundle |
| prepared.txt and prepared.json | Native edition output, selected answers or mapped fields, exact values, counts, recorded limits and field issues |
| fields/*.txt | Exactly one selected value per file, with no added trailing newline |
| review.html | Complete offline values, copy controls, counts and full printing |
| manifest.json | Selected source identities and hashes of every generated output; written last |

Open review.html to read, copy or print. Printing includes long values across as many pages as needed. The native draft can be reopened through the original **Prepare submission** interface; its planning sources, handover and reviews remain in that same record.

## Receive source into the same saved draft

Use a complete source package from **Source editions**, or the
`source-package.json` produced by an existing four-file export:

~~~sh
starforge grant-export \
  --draft /private/scf/saved-submission.json \
  --receive-source-package /private/scf/source-package.json \
  --out /private/scf/prepared-with-source
~~~

The command verifies the complete incoming package and receives it into the
original draft before preparing output. Its draft ID, retained source editions,
edited-answer baselines, issuer fields, native planning, reviews and versions
continue. Untouched canonical answers receive the selected source. Existing
issuer-field text keeps its original explicit refresh behavior.

A changed source retains the preceding full working version. A different
four-file bundle for the same application preserves the previous handover
selection. Repeating the same already-selected bundle does not add another
source-receiving version. The command then prepares its normal frozen output.

The incoming package supplies all four original bodies and their retained
metadata, so this receiving path uses the selected files directly. The
`--receive-source-package` option applies to `--draft`. The existing
`--source` mode below remains the publisher's way to prepare a new source
edition from its original application, index, budget and companion files.

Whenever the prepared draft selects a complete reviewer bundle, its output also
contains `source-package.json`. This file is ready for another operator's
Source editions screen or this same command. See the
[original handover guide](GRANT_HANDOVER.md#receive-and-share-a-source-package)
for the source package's byte and model contract.

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


## Carry issuer context and operating work through the same application

In **Prepare submission → Submission handover → Issuer programme and selected native plan**, open the complete issuer-case ZIP from the original Grant Operations workspace. Review its original case, selected terms and retained native plan before receiving it into the current draft. The receiving profile explicitly chooses whether to select that native plan. Save or export the same editable application to retain the issuer source with its answers, field wording, prepared editions and history.

The installed exporter exposes the same receiving path:

```sh
starforge grant-export --draft saved-submission.json --receive-issuer-case complete-issuer-case.zip --issuer-profile issuer-profile.json --out /absolute/customer/issuer-export
```

The complete profile and source rules are in [GRANT_ISSUER_CONTEXT.md](./GRANT_ISSUER_CONTEXT.md). The issuer edition travels in the complete draft and the export includes the original issuer case, selected native planning ZIP and readable issuer context.

Under **Native delivery plan → Customer operating procedure**, select the original native revision and work packages, enter the customer and receiving details, and create a procedure. Open **Command finder → Operating plans** to receive that complete JSON, edit the ordered work, save revisions, retain actual output files and export the whole procedure. Use **Returned procedures** to review independent changes against their complete original history; receive the resulting complete plan or completed review back into the same application's planning review. [GRANT_OPERATING_PLANS.md](./GRANT_OPERATING_PLANS.md) documents the complete browser and `starforge grant-operating-plan` flow.

The existing **Issuer form fields** view records the selected answer text at each wording review. When an answer changes, compare the previous and current text, choose the current wording or retain the edited field, and save that decision with the same draft. A source refresh keeps an already open draft selected while its complete comparison becomes available.
