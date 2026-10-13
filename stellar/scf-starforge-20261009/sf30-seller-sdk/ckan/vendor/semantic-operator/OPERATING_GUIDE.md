# Operating the semantic interoperability workspace

## Workspace and operator identity

Start `run.py serve --workspace /absolute/private/directory` and open its printed loopback address. The original workspace identity is displayed on every screen. Enter the name of the local operator before editing; each revision and operation retains that actor.

Keep workspaces on a local Linux filesystem. The application owns one exclusive workspace lock and supervises one native job at a time. Another operator may use an independent received workspace. Opening the same workspace twice produces a direct instruction to use its original local address.

Files and directories are private to the operating-system owner. Browser requests must use the exact local origin and application header; the host validates both. The local interface assumes that the computer account itself is trusted.

## Sources

Import the full original file, choose its exact serialization and role, and record where it came from. Supported graph serializations are Turtle, N-Triples, RDF/XML and JSON-LD. TriG and N-Quads use the dataset workflow described in [DATASETS.md](DATASETS.md). A CSV file uses the **table** role. Data, ontology and shapes are separate roles.

The operator stores complete bytes under their SHA-256 content identity. A source revision links to that retained artifact. Editing a source requires the current revision; earlier files and metadata remain in history. A missing or modified retained file is an error, never a reason to substitute another source.

**Add retained reference** selects a complete bundled upstream file. Its byte length and Git blob identity are checked before import. The reference manifest carries the original repository, path, object and license. The bundled TriG reference is available in dataset mode; its named graphs remain separate.

**Inspect** creates a native job from the chosen revision. Its complete report and machine-readable output remain attached to the job. **Download** always returns the complete retained file. **Preview** is a readable view with an explicit display limit; it does not truncate the saved artifact.

## Mappings

A mapping converts an explicitly selected CSV revision into RDF statements. It contains:

- A subject IRI template, such as `https://example.org/item/{ID}`.
- Optional classes asserted for each mapped subject.
- A delimiter and exact strings treated as null.
- One field definition per selected column: predicate IRI, literal or IRI kind, and optional literal datatype, language tag or object IRI template.
- A review note describing the intended semantics.

Use absolute IRIs. Literal datatype and language are mutually exclusive. IRI values do not carry literal annotations. The mapping retains the table ID, revision and hash. If the table changes, create another mapping revision that selects the new table edition.

The application does not infer business meaning from column names. A source identifier, numerical lexical value or language tag remains visible and reviewable. Original input bytes are retained even when an RDF syntax defines its own numeric conversion.

## Snapshots

Select RDF data revisions and zero or more CSV mapping revisions. The native job resolves those selections once and saves an immutable input specification before dispatch.

A completed single-graph snapshot retains canonical N-Triples, a readable Turtle edition, complete provenance and native summary. Choose **Dataset with named graphs** for canonical N-Quads, TriG, complete graph inventory and graph-aware provenance. Dataset-specific graph selection and scope controls are described in [DATASETS.md](DATASETS.md). Provenance links statements and mapped records to their actual source editions. Mapping definitions are copied into the original job, so later edits cannot change a prior result.

Original input files are stored once in the workspace's content-addressed source directory. A job references those exact files by identity and checks their length and hash before execution.

## Validation

Use **Import profile** for the documented DCAT-AP 3.0.1 modular profile. It retains `html/shacl/shapes.ttl`, `html/shacl/range.ttl` and `html/shacl/mdr-vocabularies.shape.ttl` as three selected shapes sources, with W3C DCAT 3 as an explicit ontology. The official release describes optional recommended constraints and vocabulary imports separately; their original manifests remain available for deliberate selection and source acquisition. The generated constraint-ID family is a separate retained design and is not mixed into this profile.

Choose a snapshot, at least one shapes source, optional ontology sources, and one explicit inference mode: none, RDFS, OWL-RL or both. Choose whether informational or warning findings count toward conformance.

Native validation first checks the shape definitions. An invalid shapes edition is recorded as that outcome with the native report; it does not imply that the data graph itself failed or passed the intended constraints. Correct the source in a visibly separate local edition and run another validation from that selected revision.

Completed validation retains the report graph, findings, source provenance, complete counts and engine versions. The application preview presents focus nodes, paths, values, messages, severity and source shapes. The original structured report remains available next to it.

The engine uses native RDFLib and pySHACL operations. Executable JavaScript, advanced extensions and import fetching are disabled. Existing `owl:imports` assertions remain in the retained graph. Include the required ontology files explicitly.

## Queries

Choose an original snapshot and enter a SELECT, ASK, CONSTRUCT or DESCRIBE query. The exact query text is retained with its native job and outputs.

SELECT results include standard SPARQL JSON and a CSV edition with columns for value, bound state, RDF term kind, datatype and language. Unbound is different from an empty literal. The preview renders typed terms in a table. ASK results retain the native boolean; graph-producing queries retain their complete output graph.

The query summary states the configured row limit, delivered count and whether more results existed. A limited result does not claim an unknown total. Review the full summary before treating an extraction as complete.

Network-bearing queries, update commands and arbitrary executable extensions are rejected. Queries read the retained snapshot without changing it.

## Changes and review decisions

Choose before and after snapshots. Set the relationship predicates to follow, the traversal depth and the node limit for impact analysis. An empty predicate list follows all resource relationships. The original graph difference remains complete even when impact exploration reaches its separately reported limit.

The comparison retains additions and removals in complete graph forms, statement changes, relationship traversal output, source-linked affected nodes and a native summary. Graph snapshots use RDFLib blank-node canonicalization. Dataset snapshots use PyLD's URDNA2015 with the retained inventory profile described in [DATASETS.md](DATASETS.md). Labels identify the structure of their own snapshot; stable source IRIs establish cross-edition entity identity.

A decision links a title, disposition and review note to the exact mapping, snapshot, validation, query or comparison ID, revision and payload hash. Editing a decision creates another revision. Review history stays available after transfer and recovery.

## Native jobs and interrupted requests

Every operation has a stable original operation ID. Browser response loss is reconciled against that ID. It does not automatically create a second engineering job.

The application writes a job's immutable specification before its record. If the record write is interrupted, retrying the original operation reconstructs the missing row from the saved specification before resolving any newly changed source heads.

The worker holds one native lock for its job, verifies all original inputs and retains each attempt in its own generation directory. Complete results include a file manifest with actual lengths and hashes. The application adopts a verified completed result before dispatching another job.

Use **Cancel** to close the current owned process. Use **Continue original** on an interrupted or failed job after addressing its actual cause. Continuation keeps the same job ID and pinned inputs; a new attempt retains the previous files. Replaying a completed job does not execute it again.

Default native limits are 120 seconds and 1 GiB of address space; supported per-operation values are 5–600 seconds and 256–4096 MiB. Limits are recorded with the original job. A failure at a resource limit is retained with its original files and explicit status.

## Receiving an independent workspace

Finish or cancel live work before exporting. **Download complete handoff** retains this workspace's original records, histories, source files, native results and attempt journals as a manifest-bearing ZIP.

On the receiving operator, select that ZIP and describe its origin. The receiver validates every file and the application database before publishing a new private workspace. Publication uses Linux atomic no-replace directory rename. It never claims or replaces an arbitrary existing directory.

The same archive returns its original receiving receipt. A source workspace with different current record hashes remains an independent branch; the receipt lists conflicting IDs and revisions. Both histories stay available for engineering review.

**Open workspace** launches the received workspace in another local operator. Work in that child is independent. Export later child edits from the child operator itself. When the parent is transferred to another host, its retained incoming archive can reconstruct that incoming edition in the new receiver's directory. Former host paths are preserved only as history and are not followed.

## Encrypted recovery

Use a passphrase of at least 12 characters. The archive is authenticated and encrypted with AES-256-GCM; its key is derived with PBKDF2-HMAC-SHA256, a fresh salt and 600,000 iterations. The passphrase is not stored in browser storage or an application record. Operation fingerprints retain only a private keyed digest.

Download the encrypted `.csw` file and store its passphrase separately. Restore into a new private directory outside the original workspace. The receiving process authenticates the archive, checks its manifest and complete histories, publishes the destination, and creates a fresh local key on first open.

A command-line restore is available when the original application is unavailable:

```bash
.venv/bin/python run.py restore --archive /path/to/original-recovery.csw --destination /new/private/workspace
.venv/bin/python run.py serve --workspace /new/private/workspace
```

The command prompts for the passphrase without echo. `--passphrase-stdin` is available for an authorized local integration. Do not place a passphrase in a shell argument or shared log.

Original source and engineering IDs are retained. Former queued or active jobs receive an explicit interrupted lifecycle transition; they do not automatically execute on the new host. A transferred recovery receipt does not include a recursively nested encrypted archive: supply the original separately held archive to restore it on that host.

## Operational sizes and custody

A single imported or result file is limited to 64 MiB. A transfer's expanded file set is limited to 512 MiB. These checks prevent an archive from unexpectedly exhausting the workstation. Complete artifacts are retained or the operation reports an error; partial files are not presented as complete results.

The host's API is loopback-only. There is no external data delivery, credential collection or billing workflow. Project-specific system connections and customer acceptance belong to the selected implementation scope.

Keep the workspace directory and its recovery archives under the intended operator's control. Retain upstream source notices when sharing a portable package.
