# Compare saved customer deliveries

The Deliveries desk compares two immutable editions from the same Record Mastering workspace. Use it before distributing a refreshed customer list to see exactly which records, selected fields, text values, resolution states and original field evidence changed.

## Read the difference

Choose the **Before edition** and **After edition**, then **Compare editions**. The direction is your explicit choice; the application does not reorder the pair by date. The scope table shows both titles, saved record selections, delivered counts, omitted counts, unresolved-field counts and selected columns.

Records align only by their original stable master identifier. Added and removed mean present in only one selected delivery. They do not establish that a customer was created or deleted. Ready-only deliveries omit masters with any unresolved field, including an unresolved field outside the delivered column selection. Explicit exclusions, missing source records, merges and splits also change delivery membership; inspect the original private workspace if you need the underlying reason. A merge can retain one original master identifier and archive another; a split creates a new master identifier.

Every field keeps its original text. Leading zeros, large decimal strings, spelling and whitespace are not normalized or converted to numbers. **Empty text** means the field was delivered with an empty string; **Absent from edition** means that row or selected column was absent. The resolution state distinguishes an empty source from an unresolved value.

Text, resolution and provenance changes are counted separately. A later source edition can retain the same selected text and resolution while changing the current source candidates. The original saved decision may still refer to the earlier selected edition. Both remain available under **Complete original field provenance**; the comparison does not rewrite the earlier choice.

Use **Show** and **Find** to inspect all differences, added/removed/changed/unchanged records, or a master identifier or source text. The browser pages through the entire comparison. Downloads always contain every record and selected field, including records hidden by the current filter.

## Keep and reopen the complete result

- **Save complete comparison JSON** retains both complete original delivery file sets, exact file inventories, both selection descriptions, every comparison row and the comparison digest.
- **Download readable report** produces a standalone HTML report with the scope, all summary measures, both original source-edition lists and every compared record. Each record includes the full original field evidence.
- **Download all field changes CSV** contains one row for every compared master/field, including presence flags, exact before/after text and status, change flags and both complete source/decision values as JSON cells.
- **Original before delivery** and **Original after delivery** use the existing complete customer-package download.

Import CSV columns as text in spreadsheet software. Original text can contain leading zeros, long decimal strings or formula-like content; the export intentionally preserves it.

Use **Open saved comparison JSON** in the same workspace, or in its independently received full workspace. The browser reads both immutable native editions again, verifies the saved workspace identity and selected comparison digest, and compares the entire saved object with the freshly reconstructed result. It refreshes both visible selectors to the reopened pair. A moved receiving directory is supported because the identity is the native workspace UUID, not its original filesystem path. Later unrelated workspace edits do not alter the two immutable editions.

The JSON does not import or merge private workspace records. If the receiving workspace lacks either edition, receive the complete original private workspace using the existing transfer workflow. A standalone customer delivery package remains readable, but it is not a substitute for that editable workspace.

## Native command and client

The original CLI creates one new file per invocation:

~~~sh
node cli.mjs compare --workspace /absolute/customer-workspace \
  --before ORIGINAL_BEFORE_ID --after ORIGINAL_AFTER_ID \
  --format json --output /absolute/new-delivery-comparison.json

node cli.mjs compare --workspace /absolute/customer-workspace \
  --input /absolute/new-delivery-comparison.json \
  --format html --output /absolute/new-delivery-comparison.html

node cli.mjs compare --workspace /absolute/customer-workspace \
  --input /absolute/new-delivery-comparison.json \
  --format csv --output /absolute/new-delivery-comparison.csv
~~~

These commands run from the original source directory, or through the existing installed dispatcher as **record-mastering compare**. Outputs use the original create-only file writer. The CLI closes its original client on success or failure and does not create a new workspace writer/controller.

The same read is exposed through the typed client and ordinary JSON-lines/CLI invoke:

~~~js
const result = client.invoke('delivery.compare', {
  beforeId: originalBeforeId,
  afterId: originalAfterId
});
// result.comparison contains the full original files and all comparison rows.
// result.reportHtml and result.changesCSV are complete export strings.
~~~

Optional **workspaceId** and **expectedSha256** bind a retained comparison to its original native source. The existing **merchant_mastering_query** accepts **action: "delivery.compare"** with the same input. Large Merchant results use its existing complete retained-file/chunk reader; follow every returned page and verify the original complete digest.

The operation reads both editions under the original SQLite read transaction. It creates no revision, saved decision or native event, and changes no source activation, matching or payment behavior.

## Complete source and original receiving

The existing source-selected product includes the new engine, original core read, CLI and type declarations, Merchant read metadata, browser module and asset declaration. The full workspace backup already contains all immutable deliveries; its format and receiver are unchanged. Preserve the current public lifecycle/replay repairs and the original installed receiving programme when adopting this source.

Use the original worked-example sources and initializer if a fictional demonstration is needed. Its existing three saved deliveries cover initial, corrected and reviewed customer records; they are fictional examples, not customer activity. The original archived customer workspace, when explicitly supplied, keeps its own identity and history.

Before presenting this version or its exports to a recipient, the producing operator must open and LOOK at the actual populated and empty/loading/error screens at desktop and narrow widths; operate pair changes, filtering, pagination, complete downloads and JSON reopen; and open the actual HTML/CSV/JSON and both original archives. Source review and a successful read do not establish rendered or native acceptance. Continue the existing equipped receiving course; this source adds no separate native request.
