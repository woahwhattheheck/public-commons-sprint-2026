# Compose the existing SCF application

The original composer turns the selected application Markdown and detailed companion into the existing reviewer page and source index. It retains the original grant amount, budget, milestones, capacity and cash fields supplied by the manuscript owner. The same command receives the selected economic, coastal and Datasette installation sections.

## Select the current source

Use the complete current developer-site checkout. Keep the accepted nine-answer application, detailed product and finance companion, page shell and source index together under `dist/`. Select the full current canonical manuscript when receiving new text; a subsection or earlier donor page is not a replacement for the cumulative edition.

The original customer projection receives the accepted complete Webhook and OpenFn sections and keeps meaningful correspondence labels in the public reader. Its source-index projection retains the selected public source identities and measured file metadata. Use that same maintained projection when receiving the current manuscript.

The economic and coastal selections each use one actual merged product commit. Datasette uses two: its original source/publisher commit and its customer Analysis commit. Those commits belong to separate maintained contributions. After the first selection, the source index retains them for subsequent composition.

## Receive a manuscript edition

An installed product exposes the same composer as `starforge grant-compose`. Run the source command from the repository root:

~~~sh
node stellar-forge/developer-site/grant-compose.mjs \
  --directory /absolute/path/to/current/developer-site/dist \
  --manuscript /absolute/path/to/current-scf-application.md \
  --fred-commit <economic-product-commit> \
  --coops-commit <coastal-product-commit> \
  --datasette-commit <datasette-customer-commit> \
  --datasette-publisher-commit <datasette-publisher-commit> \
  --source-pins-output /absolute/path/to/current-grant-source-pins.json
~~~

Omit `--manuscript` when rendering edits already saved in the application and companion downloads. Omit a product's commit flags to retain its selection from the source index. The two Datasette commits are required together for a new selection.

Composition preserves all nine original answer headings and every unrelated companion section. Selected installation subsections are replaced once, and the existing tenth section receives the product entry. Source identifiers and hashes are refreshed from the complete result. The guided product opening and submission navigation are then composed into the same edition. Repeating the same composition produces identical files.

## Receive the four reader files

The original receiving callback accepts the four Git blob overrides emitted by `--source-pins-output`:

| Route | Selected content |
|---|---|
| `/grant.html` | Complete application in the existing reader |
| `/grant-data/application.md` | Complete nine-answer Markdown |
| `/grant-data/product-and-finance.md` | Cumulative detailed companion |
| `/grant-data/source-index.json` | Current source selections and original financial fields |

Pass that object as `sourcePins` to the original `inspectGrantApplication` callback, along with its selected source commit and receiving directory. Its other declared original routes stay selected. Additional product assets have their own file selection; they do not change this four-reader override contract.

The result also reports `reviewerEntry` and `submissionWorkspace`. These describe the selected opening anchors and submission route; the submission descriptor binds the same application SHA-256 and Git blob that the editor reads. They do not add routes to `sourcePins`.

The declared browser manifest includes the original routes and six complete component assets:

| Route | Use |
|---|---|
| `/grant-entry-browser.mjs` | Prepare the original installed/source command and opening guide |
| `/grant-entry.css` | Responsive product opening |
| `/grant-submission.html` | Full answer and issuer-field workspace |
| `/grant-submission.css` | Original workspace layout |
| `/grant-submission-core.mjs` | Complete source, answer, form and version model |
| `/grant-submission-workspace.mjs` | Original draft-store editing and receiving controls |

The workspace uses the existing `/drafts.mjs` and the same application/source-index files. Its complete source travels under the original developer-site component in the grant-reviewer product.

The HTML reader and downloadable Markdown have different relative locations. The composer adjusts the companion link only in the rendered HTML. Markdown sibling links remain relative to `grant-data/`.

## Use the existing local command and Site

The selected source checkout opens through:

~~~sh
node stellar-forge/developer-site/grant.mjs --port 8787
~~~

The installed product opens through `starforge grant-application --port 8787`. Use the actual origin returned by that listener; its result also supplies the submission-workspace URL. An already-running original source server can serve the same declared routes; no second listener is needed.

Start with **Explore the working product**. The [reviewer-opening guide](GRANT_ENTRY.md) covers the original film/report, Applications, quoted host command and complete purchase handover. Then choose **Prepare submission** to edit the nine answers, map the actual issuer fields and limits, save complete versions and receive a later source edition. The [submission guide](GRANT_SUBMISSION.md) covers exact copy counts, complete draft export/reopen, source comparisons and preservation of manual edits.

The source publisher applies the complete selected files to the existing Site project and keeps its current audience. The manuscript owner supplies accepted content, the cumulative writer supplies the current public source projection, and the same-account publisher supplies the actual saved version and deployment result.

The existing reviewer callback and any selected product continuation receive that actual source edition through the original page. Their outputs record what was actually opened, downloaded and retained. Source composition by itself does not replace the publisher's saved version or a completed operating result.
