# Application field transfer

Turn the existing SCF manuscript into exact form-field text and a local copy/review page. This utility reads the maintained application; it does not create a competing proposal or rewrite its facts.

The supplied map follows the ten sections of the October 12 reviewer manuscript. It is a **manuscript map**, not a claim about the issuer's final field names or limits. Apply the actual invitation's labels and limits in a private copy of that map.

## Export the current manuscript

Run with Node.js 22 or newer, using the original private manuscript and a new output directory:

    node stellar/scf_2026/application-transfer/cli.mjs \
      --source /private/scf/current-reviewer-application.txt \
      --profile stellar/scf_2026/application-transfer/scf46-sections.json \
      --out /private/scf/field-transfer-20261012

An optional --source-ref records the manuscript's canonical file or document reference in the private manifest.

Open review.html for the complete selected fields, copy buttons, length counts and configured-limit status. Printing includes each complete value across as many pages as needed. The output also includes:

| File | Use |
| --- | --- |
| fields/*.txt | One exact value for each mapped destination field, with no extra trailing newline |
| fields.json | The same field values, counts, limits and original line ranges |
| application.md | Complete selected content in the mapped field order |
| manifest.json | Original source/profile SHA-256, output hashes and selected/unselected line ranges |

Keep the application, private field map and generated outputs in the existing internal application workspace. They can contain customer conversations and private source references. Publish only this generic utility, its generic section map and documentation.

Every selected field retains its source text, including tables, amounts and links. Newline styles are normalized to LF for the transfer; the manifest hashes the original input bytes. The output directory is created with mode 0700 and its files with 0600. Existing outputs are preserved. A filesystem error can leave the new directory incomplete; the manifest is written last.

## Match the destination form

Edit the field map to match its actual field labels and restrictions:

    {
      "schema": "starforge.application-field-map.v1",
      "title": "Current application form",
      "fields": [{
        "id": "project-outcome",
        "label": "Project description",
        "selectors": [{"heading": "Project and requested outcome"}],
        "limits": {"max_characters": 5000, "character_unit": "utf16"}
      }]
    }

The 5,000-character value above is a configuration example. The supplied SCF section map leaves limits unspecified.

Supported character units are utf16 (the default used by HTML maxlength), code_points and utf8_bytes. max_words counts whitespace-delimited words; set it only when that agrees with the destination's requirement. All three character counts are visible regardless of which limit is configured.

The program exports complete over-limit text and exits with code 2. Edit the maintained manuscript or select an appropriate complete excerpt, then export again. It never silently clips a sentence, table, budget or requirement. Exit 0 means the files were exported with no configured limit exceeded; fields without supplied limits remain explicitly identified. Invalid source selectors or profiles exit 1.

## Select exact existing text

Each field can combine several selectors. A selector has:

| Option | Behavior |
| --- | --- |
| heading | Exact ATX Markdown heading text, without the # markers |
| scope: section | Its complete content, including lower-level subsections; the default |
| scope: lead | Only content before the next heading |
| occurrence | One-based occurrence when a heading is repeated |
| include_heading | Include the source heading itself |
| paragraph_starts | Select complete paragraphs by unique exact prefixes inside that section |

Paragraph selection preserves source order and is useful when a manuscript contains internal editorial material alongside the reviewer copy. Record the chosen prefixes in the private map; the manifest records unselected nonempty line ranges for review. It does not guess which source material is internal.

Missing or ambiguous headings and paragraph prefixes, and unknown selector options, produce an explicit error. Fenced code is not treated as document headings. Field ids must be unique lowercase filenames. Field content is escaped before rendering the offline page.

## Use from an existing application

The core is dependency-free JavaScript and does not require Node:

    import { buildTransfer, renderReview } from './transfer.mjs';
    const result = buildTransfer(manuscriptText, fieldMap, sourceIdentity);
    const html = renderReview(result);

The Node wrapper supplies original-byte hashes and writes the complete package. A caller can use fields.json values for a later authorized form operation without scraping the review page.

Source selection and field limits are editorial inputs. The utility preserves the existing application and leaves the destination form's final review with its operator.
