# Record mastering

Turn overlapping customer lists into a saved master dataset. Keep each original file, inspect suggested matches, choose field values, and receive the entire editable workspace on another machine.

The browser, Node client, command line and merchant tools share one SQLite workspace and one revision-bound decision writer. There is no remote model call, background poller, package download or paid service in the runtime.

## Open the worked example

Use Node 22.16 or newer with the built-in `node:sqlite` module. From this directory:

```sh
node launch-example.mjs ./customer-review
```

A new directory creates a fresh worked project through the original operation writer, using the three complete fictional CSV files in `example/`. It retains both source systems, explicit field choices, a billing correction and three delivery editions. Matching groups remain available to review. Reopening the same directory preserves all edits and does not reseed it. All source data needed to create this project is included in a normal source checkout or offline npm package.

Open the private URL printed by the launcher. Keep that launch output private. The service listens on the local machine; stop it with Ctrl+C. The fictional records deliberately include an exact large decimal amount and postal codes beginning with zero.

The complete delivery also retains the original archived revision-22 customer workspace under `archives/customer-review.mastering.gz`, outside the source package. To continue that exact original identity and history instead of creating a fresh example, explicitly select it:

```sh
node launch-example.mjs ./received-original --archive /path/to/archives/customer-review.mastering.gz
```

The original archived file is 59,616 bytes with SHA-256 `5bc472c059f68e757e1cd2fc6a4c2befdb9259a07a5874f8e9f22b9dbffa5fc6`. It is an independently received customer input, not a required runtime dependency. The fresh initializer never changes or substitutes for this archived project.

To start an empty workspace instead:

```sh
node cli.mjs create --workspace ./my-customers --title "Customer records"
node cli.mjs serve --workspace ./my-customers
```

No npm installation is required for either command. The `package.json` also supports using this directory as a local Node package.

## Work through a customer list

**Source editions.** Import a UTF-8 CSV. A new source needs a name, one or more stable key columns and an explicit mapping from source headers to master fields. Choose a durable source-system identifier rather than row position. Every record must have a nonempty, unique key within that source. Quoted commas, quoted line breaks, Unicode, leading zeros and exact decimal strings are retained. Source identifiers are scoped to their own source; identical IDs from two systems are not silently treated as one person.

Importing retains the complete original file but does not replace the active edition. Review the added, changed and missing records, then apply that saved refresh. The same keys retain their existing master membership. Missing records stay in the workspace with their retained original values, but are absent from active matching and deliveries.

**Matching desk.** Choose fields and normalization rules. Shared normalized values produce review groups, not automatic merges. An email, telephone number or company domain may be shared by different people. Open the group, inspect its members, and select only the records that belong together. Paging retains the whole group. Keeping a group separate saves a reason; a changed membership produces a new group to review.

**Master records.** Merge selected records, choose an original field value, enter custom text, add a working note, or split selected source records back out. Agreement on one nonempty value is automatic. Conflicting values remain unresolved until selected. Selecting a source value pins the original source record and text: a later source correction flags that decision for review rather than silently replacing it. Empty custom text remains an explicit selection.

A source-pinned decision follows its source record during a split. A custom decision stays with the original master. Merging incompatible existing decisions retains them for review. Excluding a source record keeps its original data and the stated reason.

“Ready” means the active master's fields are resolved. It does not mean every suggested identity match has been accepted; review matching groups separately before delivering a deduplicated list.

**Deliveries.** Choose the title, fields and either all active masters or only ready masters. Save an immutable edition. Download its complete package or individual files. Each edition contains:

| File | Use |
| --- | --- |
| `master.csv` | Stable master IDs and exact selected text values. |
| `dataset.json` | The original SF30 CSV seller configuration, with text columns and a master-ID filter. |
| `field-provenance.jsonl` | Original field candidates, selected values and decisions. |
| `conflicts.csv` | Unresolved delivered fields, including changed source selections. |
| `delivery.json` | Edition description, selected source editions and CSV digest. |
| `READING.md` | Recipient instructions. |

The package includes field provenance. Select the intended recipient and delivered fields accordingly. Source files, unrelated records and the full private history stay in the separate workspace backup. A ready-only edition omits masters with any unresolved field; an all-active edition leaves unresolved fields blank and lists them in `conflicts.csv`.

CSV is exact machine data. Import its columns as text in spreadsheet software so leading zeros and decimal strings survive and formula-like source text is not evaluated. The existing dataset seller still owns its pricing, payment preparation and paid delivery; mastering does not replace those operations.

## Receive and continue editing

Use **Download private workspace** for the complete editable state, including original source bytes, retained editions, master membership, choices, exclusions, saved operations and deliveries. It is different from a customer delivery package.

```sh
node cli.mjs export --workspace ./my-customers --output ./customers.mastering.gz
node cli.mjs receive --file ./customers.mastering.gz --workspace ./received-customers
node cli.mjs serve --workspace ./received-customers
```

Add `--sha256` to `receive` to bind a particular transferred file. Receiving checks the database, references and retained source digests, and creates a new directory without overwriting another workspace. A received workspace can be edited independently.

To unpack a customer delivery:

```sh
node cli.mjs deliver --workspace ./my-customers --edition DELIVERY_ID --output ./customer-delivery.gz
node cli.mjs unpack-delivery --file ./customer-delivery.gz --output ./customer-files
```

The delivery ID is returned when a delivery is created and by `invoke deliveries`. Generated files are create-only; use a new output name for a different export.

## Use the Node client

```js
import { randomUUID } from 'node:crypto';
import { RecordMasteringClient } from './client.mjs';

const client = new RecordMasteringClient({ directory: './my-customers' });
try {
  const status = client.invoke('status');
  const firstPage = client.invoke('entities', { limit: 100 });
  const first = firstPage.items[0];
  if (first) {
    const request = {
      entityId: first.id,
      label: first.title,
      note: 'Customer record reviewed.',
      expectedRevision: status.revision,
      requestId: randomUUID()
    };
    client.invoke('entity.annotate', request);
    // Reuse this identical request to recover its original result after a lost response.
  }
} finally {
  client.close();
}
```

`client.d.mts` declares every native operation's inputs and outputs. All changes require the observed `expectedRevision` and a stable `requestId`. Reusing an ID with different input is an error. A stale revision is an error, not an implicit rebase. Read `operation` with a request ID to recover a committed result. Browser requests retain a small pending-operation reference across reloads and recover the saved result; the full source file is not copied into browser session storage.

Read operations are `status`, `binding`, `feeds`, `entities`, `entity`, `groups`, `group`, `rules`, `refresh`, `deliveries`, `delivery`, `history` and `operation`. Changes are `feed.create`, `source.import`, `source.activate`, `rules.save`, `match.dismiss`, `entity.merge`, `entity.split`, `field.choose`, `entity.annotate`, `record.exclude` and `delivery.create`. `refresh` is paged and returns its `planSha256`, which must be supplied to `source.activate`.

CLI `invoke ACTION --input request.json` accepts the same operation input. `--input -` reads it from stdin. `import --file source.csv --input request.json` retains the whole original file and respects an optional expected `sha256`. `stdio` accepts one `{id, action, input}` JSON object per line, returning the corresponding ID with a result or error. It is a persistent JSON-lines client, not a separate state engine.

## Managed Merchant Workspace integration

`distribution/contributions/record-mastering.json` adds the original command, Node exports, Applications adapter and lazy merchant provider. The default distribution discovers the source-owned contribution. A deliberately restricted product selection must include it while retaining its other selected contributions. The source uses the maintained `application-provider.mjs` and merchant `provider-contract.mjs` interfaces without replacing their lifecycle or routing owners.

The Applications adapter opens an existing or independently received workspace. It binds its original directory and identity during preparation, preserves common port/environment options and confirms that the original listening process announced the same workspace. The private browser session is retained only in the original application startup output.

The merchant provider's `recordMasteringConnection` selects a host-owned connection JSON file. For example:

```json
{
  "schema": "stellar-forge.record-mastering.v1.connection",
  "workspaces": {
    "customers": {
      "directory": "./my-customers",
      "label": "Customer records",
      "exportsDirectory": "./private-exports",
      "receiveRoot": "./received-workspaces",
      "inputs": {
        "crm": { "path": "./crm.csv" }
      }
    }
  }
}
```

Relative paths resolve against the connection file. An input may also declare its expected `sha256`. Tool arguments select these configured aliases rather than arbitrary host paths.

The eight merchant tools list workspaces, query, apply decisions, inspect inputs, import, export, read complete file chunks and receive editable workspaces. Large read results are saved as complete JSON files with an explicit digest and byte count; follow `merchant_mastering_file_read` until `nextOffset` is null, verify the full digest, then parse the original JSON. Exported workspace and delivery packets use that same file receiving path. Completed export requests reopen the same bytes after interruption. Received aliases remain discoverable after a new provider process starts.

## Operating limits

This version accepts up to 128 MiB per original CSV, 256 source columns and 63 mapped master fields. Matching rules are limited to 16 explicit fields. Read pages contain at most 500 items. A private portable SQLite snapshot must be smaller than 380 MiB so its complete encoded receiving packet stays within the 512 MiB decoded transfer limit.

Active master views use a connection-private, disk-backed SQLite TEMP projection. Pages decode only their selected records; single-record edits refresh their own projection. Source activation, merges and splits rebuild the derived view because membership or record numbering can change. Original tables remain authoritative, and the projection is not included in customer backups.

The CLI, HTTP backup and merchant export use chunked file snapshots. `await RecordMasteringClient.receiveFile(file, directory, {expectedSha256, signal})` receives a file without allocating the whole database or encoded envelope in memory. The existing synchronous `receive` and in-memory `workspacePacket` interfaces remain available for compatibility; use the file receiver for large workspaces. The original version-1 packet and database format are unchanged.

CSV intake, matching summaries and immutable customer delivery still allocate memory proportional to their selected data. A single authored 40,000-record full intake, match, delivery, export, independent-receive and edit run on Node 22.16 peaked at 776,776 KiB, compared with 1,723,752 KiB for the recovered original engine. Twenty paged reads plus search took 191 ms versus 975 ms. End-to-end time was 16.32 s versus 15.26 s; initial projection rebuilding remained slower. These are one-host measurements, not a universal capacity guarantee. Size the host using the complete workload rather than assuming an unbounded record count. Concurrent writes use SQLite transactions, a busy timeout and the original revision check. Stop the original application before directly moving its live database; use its portable export for a live snapshot.

## Complete native customer exercise

`node EXERCISE.mjs . /absolute/new-customer-operation` creates a new worked project through the original writer, operates the real HTTP service through source refresh and master decisions, exports complete customer files, independently receives and edits the workspace, then resumes merchant exports and received aliases across a provider restart. The output directory must be new. An optional third argument selects the recovered original source for exact read comparisons. An optional fourth argument selects the complete original archived customer file; that mode checks and preserves its original workspace identity and revision 22. It performs no paid requests or outbound messages.

License: MIT.
