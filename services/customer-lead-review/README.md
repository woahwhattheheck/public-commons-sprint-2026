# Customer lead review

Build one self-contained customer review page from a complete original lead package. The page displays the original documents and public prospect selection, keeps editable feedback and saved review history, and exports a source-bound JSON return for the original sender.

This directory packages the maintained portable builder, review model, interface, archive reader and byte/compression helpers. Their original module paths and APIs are preserved. The command-line entry adds input selection, file handling and a usable example around those same modules.

## Quick start

Use Node.js 22 or newer. There is no dependency installation step. Run from this directory:

```sh
node cli.mjs example --out example-preview.json
node cli.mjs inspect --input example-preview.json
node cli.mjs build --input example-preview.json --package example-sample --out example-review.html

```

Open example-review.html in a browser. The example contains explicitly fictional organizations and reserved example.invalid addresses. Its two package choices demonstrate the selection boundary; the generated page contains only the package named by --package.

For your original customer input:

```sh
node cli.mjs inspect --input original-preview.json
node cli.mjs build --input original-preview.json --package ORIGINAL_PACKAGE_ID --out customer-review.html

```

The output directory must already exist. Use a new filename for each output. The writer stages a complete file beside its destination and creates the final path atomically without replacing any existing file or symbolic link. If a destination already exists, the command fails and preserves it. Use a normal local filesystem that supports hard links.

A successful build prints a JSON receipt containing the output path, exact UTF-8 byte count and SHA-256, original package and edition IDs, original archive identity, member count and public review-source identity. Keep that receipt with the original input and generated page.

## Input contract

The CLI consumes complete UTF-8 JSON with version commons.customer-package-preview.v1. This is the maintained portable builder's selected customer-package projection. It carries the complete original archive in base64 plus the original member inventory. The example command generates a complete working document in this format, including real computed byte counts and hashes.

Top-level fields:

| Field | Meaning |
|---|---|
| version | commons.customer-package-preview.v1 |
| customer | Customer display name |
| customer_key | Stable customer selection key |
| packages | Original package descriptors; build selects exactly one by its ID |

Each package retains:

| Field | Meaning |
|---|---|
| id, package_sha256 | Original package identity |
| edition_id | Original immutable customer edition ID |
| title, instructions | Original package title and opening instructions |
| delivery_type | sample, paid or replacement |
| quantity, currency, price_minor | Original public selection count and price |
| prepared_at | Original package preparation time |
| archive | name, type: application/zip, bytes, sha256 and complete base64 |
| files | Every original member, with name, title, type, bytes and sha256 |

The original archive must use the deterministic stored-file format supported by lead_customer_archive_core.cjs. The original reader reconstructs the same ZIP to verify names, ordering, CRCs, timestamps, offsets and the complete directory. Every declared member must occur exactly once and match its size and hash. The command preserves the original archive bytes.

The selected archive must include leads.json. That file is the complete public dealscout.lead-pack.v1 projection accepted by the original review model. The model checks its exact field set, public lead fields, quantity and source limits. Package quantity, delivery type, currency and price must agree with that projection. Input private working records, contact journals and staff case stores belong in their maintained receiving application; the portable input is the selected customer package.

The CLI normalizes verified original archive/member bytes into the existing commons.complete-customer-directory.v1 in-memory shape, then invokes the unchanged renderPortableLeadPackages. It does not deserialize arbitrary numeric-key objects as file bytes. Applications already holding that original typed prepared structure can call the maintained builder API directly.

## Commands

### build

```sh
node cli.mjs build \
  --input original-preview.json \
  --package ORIGINAL_PACKAGE_ID \
  --out customer-review.html

```

Package selection is always explicit, including an input containing only one package. Multiple descriptors with the selected ID are rejected. Other packages are omitted from the generated HTML; their original inputs remain available for separate explicit builds.

The default complete HTML limit is 262,144 bytes. For a local standalone file with a larger permitted destination, set an explicit bound:

```sh
node cli.mjs build --input original-preview.json --package ORIGINAL_PACKAGE_ID \
  --out customer-review-large.html --max-html-bytes 1048576

```

The accepted override is 1,024 through 33,554,432 bytes. The existing inline-payload and archive limits still apply; increasing this option does not remove them. If a destination has its own upload limit, use that destination's actual limit.

### inspect

```sh
node cli.mjs inspect --input original-preview.json

```

Lists customer and package selection metadata so the operator can choose an original ID. The build command performs complete archive and public-source verification.

### check-return

```sh
node cli.mjs check-return --input returned-review.json \
  --preview original-preview.json --package ORIGINAL_PACKAGE_ID

```

The original model validates the complete return, its public source, immutable review ancestry and saved current draft. Supplying --preview and --package binds it to the exact original selected archive and public edition. Supply these two arguments together.

The command emits a compact receipt with source identity, edition and package IDs, review ID, saved revision, observation count and exact returned-file bytes/hash. It leaves the original JSON unchanged. A standalone structural check is also supported:

```sh
node cli.mjs check-return --input returned-review.json

```

A source hash establishes content continuity. It does not authenticate the person who wrote a reviewer name. The sender's original receiving application records the actual message, delivery, author/time/channel and any commercial resolution. Use its normal customer-request intake with this exact returned JSON and the original source context.

### example

```sh
node cli.mjs example --out example-preview.json

```

Creates one fictional sample package and one fictional paid package using the original archive writer and complete public document shape. It is useful for learning controls and verifying an installation without customer records. Both packages have distinct original IDs; run separate build commands to generate their pages.

Unknown/repeated options and incomplete required arguments fail with a readable message and exit code 1. Successful commands return exit code 0. The entry also supports --help.

## Customer workflow

1. Open the generated HTML and inspect its selected package, original lead pack and supporting files. **Download this file** and **Download complete ZIP** retain their original bytes.
2. In **Review this selection**, enter the reviewer name and overall note. Search the complete selection, choose a prospect, and inspect its original company, workflow, contact and sources.
3. Choose **Keep**, **Question**, **Duplicate**, **Unavailable**, **Outside the brief**, **Incorrect contact**, **Incorrect source** or **Other**. Write the observation and requested next step. Untouched prospects remain outside the returned observations.
4. Use **Save review edition** to record the current complete observations. Saved history is retained in order; an unchanged save does not add a duplicate edition.
5. Use **Download return JSON** for the complete saved current review. If fields changed after the last save, save a new edition before returning it.
6. Send that return in the original conversation. The sender can run check-return with the original preview and selected package before continuing its existing receiving workflow.

A decision is a customer observation. The original receiving application handles qualification, replacement, refund or delivery actions from the actual received context.

## Keep drafts and resume complete work

**Download draft JSON** preserves the complete current raw form, saved history and every retained working copy. It can back up unfinished fields before they meet the requirements for saving an edition. **Save editable package** preserves the same drafts together with the complete original package and executable page.

**Open saved review** accepts the same-source saved draft JSON or return JSON. Opening another working copy retains the previous one under **Retained working copies**. **Resume this working copy** restores it while keeping the work that was open. Different browser copies observed in local storage are retained before a current write.

Draft JSON accepts the earlier format without parked copies and the current format containing them. Saving and reopening use one 64 MiB UTF-8 working-copy bound. Saved return JSON retains the original 1 MiB intake limit; public leads.json retains the 512 KiB review-source limit. Saved review history supports up to 100 editions within those original byte limits.

Browser storage is an additional working copy. File downloads provide complete portable recovery when storage is full, unavailable or cleared. If an error occurs, keep the current page open and preserve the complete draft or editable package. When the complete working-copy limit is exceeded, current text remains in the page so the operator can retain smaller complete copies deliberately.

The initial page uses the original compressed payload loader. A saved editable page embeds the complete expanded original payload and one original application bootstrap. It preserves original ZIP/member content and keeps review state separate.

## Printing

**Print review** prints full static text for every current response, including unfinished observations. Original prospect context, reviewer/note, decision, observation and requested next step appear in the printed report. The report includes original edition and package identity. Inspect the print preview and all generated pages to confirm full text and usable page breaks.

For the original package's other documents, open their complete original files and use their own native printing or export controls.

## Product inspection and outgoing delivery

Follow the full standing instruction in this directory's AGENTS.md. The producing operator must personally open and operate the exact outgoing version and look at its actual rendered screen or screenshots. Source inspection, successful generation, a screenshot merely being captured, or another peer's approval does not replace that producing-operator inspection.

For this product, carry one complete course through the original browser/receiving operation:

- Open the exact page at desktop and narrow phone widths, including a 390-pixel view where appropriate. Inspect blank, populated, validation-error and recovery states.
- Use package documents, source links, prospect search and selection, decisions, long observations and save/history controls.
- Download and open the saved return, complete draft and editable HTML. Cold-open the editable HTML in a separate clean browser context and confirm original sources, unfinished fields, saved history and retained working copies.
- Operate original file and ZIP downloads. Extract the complete ZIP and inspect every outgoing member in its appropriate viewer; open linked documents and editable artifacts.
- Inspect the full printed output. Confirm complete text, readable foreground/background, narrow layout, focus and meaningful controls.
- Return actual images and opened/downloaded artifacts to the producing owner, fix defects in the maintained source, and repeat the affected meaningful course on the corrected outgoing version.

Keep each original package and reviewed presentation successor identified. Existing archived deliveries remain exact. Use the already assigned receiving operation and actual active equipment; maintain the original saved request identity when resuming.

## API and dependency layout

The preserved renderer export is:

```js
import {renderPortableLeadPackages} from
  './tools/revenue_owner_console_20261010/lead_customer_package_portable.mjs';

const result = renderPortableLeadPackages(prepared, {
  customerKey,
  zipSource,
  gzipSource,
  archiveSource,
  hashSource,
  maxHtmlBytes: 262144
});

```

The four source arguments are complete maintained module bodies embedded by the original builder. The CLI reads them relative to its installed source, independent of the current working directory.

| Module | Purpose |
|---|---|
| lead_customer_package_portable.mjs | Original package selection, standalone viewer and renderer |
| lead_customer_review.cjs | Original public source, draft/history and return validation |
| lead_customer_review_ui.mjs | Customer form, recovery, saved files and full review printing |
| lead_customer_archive_core.cjs | Original deterministic ZIP writer and exact reader |
| connected_sha256.cjs | Original UTF-8 byte counts and SHA-256 |
| connected_zip.cjs | Original ZIP and base64 helpers |
| connected_gzip.cjs | Original gzip/DEFLATE implementation |
| connected_inline_payload.mjs | Original complete embedded-payload compression |

The tools and host subdirectories preserve original relative import paths. The ZIP helper's late gzip import is included. The original archive reader is supplied explicitly as archiveSource; it is part of the runtime closure even though the renderer does not statically import it.

No package manager or server is needed for this builder. Customer source files stay with the operator's chosen local output and receiving destination. Publish only generic implementation and clearly fictional examples in a source repository.

## Source and license

See source-manifest.json for original module identities and the preserved-source mapping. This directory's LICENSE applies Apache-2.0 to the Commons-derived implementation and new CLI/guide. THIRD_PARTY_NOTICES.md retains the upstream SHA and compression notices, including their MIT and Zlib terms. Those notices and the original source headers travel with this directory.

Retain the exact input, command receipt, generated HTML and original returned JSON with each completed customer operation. They allow another operator to reopen the same package and continue its original review.
