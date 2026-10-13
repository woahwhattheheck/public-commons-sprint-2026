# Commons Semantic Interoperability Operator

A local engineering application for retaining source editions, mapping tabular data to RDF, validating graph and named-graph dataset snapshots, running typed SPARQL queries, reviewing semantic changes, and transferring the complete workspace to another operator.

The interface is a quiet grayscale desktop application served on the loopback address. Ten views cover sources, mappings, snapshots, validation, queries, changes, native jobs, independent receiving, and encrypted recovery. Engineering work is saved as original records and immutable revisions; native execution uses the selected source bytes and mapping editions.

## Start

Use Linux with Python 3.11 or later and a private writable directory. Atomic receiving uses Linux `renameat2(RENAME_NOREPLACE)`; SQLite requires a local filesystem with reliable locking and synchronization.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python run.py serve --workspace /absolute/private/semantic-workspace
```

Open the exact `http://127.0.0.1:<port>` address printed by the command. The port is selected automatically. Keep this process running while using the operator. Use Ctrl+C to close its owned native worker and received operator processes. An existing workspace reopens with its original identity, records, revisions and jobs.

The pinned native dependencies are RDFLib 7.6.0, pySHACL 0.40.1, PyLD 3.3.0 and cryptography 50.0.1. Dataset canonicalization uses the released URDNA2015 implementation in PyLD with the explicit `commons-semantic-dataset-inventory/1` profile for empty blank graph identity. A prepared environment may put these exact packages on `PYTHONPATH` instead of installing another copy.

## A complete engineering sequence

1. Import original Turtle, N-Triples, RDF/XML, JSON-LD, TriG, N-Quads or CSV files. Record the source reference, title, edition and license. The **Sources** view also offers the retained public W3C and DCAT-AP examples with their exact upstream object identity. **Import profile** retains the documented DCAT-AP modular source selection in one resumable operation.
2. Inspect a source through its original native job. For CSV, define the subject IRI template, classes and each predicate mapping. The mapping pins the exact table revision.
3. Build a graph or dataset snapshot from selected data revisions and mappings. Dataset mode retains named graphs and empty-graph identity, with explicit graph choices and mapped-row destinations. Complete data, source provenance and native summaries are retained.
4. Select a snapshot, shapes editions, optional ontologies and an explicit inference mode for SHACL validation. Invalid shapes remain a distinct native result with their complete report. A corrected local shapes edition is a separate source revision.
5. Run SELECT, ASK, CONSTRUCT or DESCRIBE queries. SELECT downloads preserve RDF term types, datatypes, language tags and unbound values. The query summary states whether a configured row limit was reached.
6. Compare two original snapshots. Review complete additions, removals and relationship impact, then save a decision against the exact result revision.
7. Download a complete handoff or encrypted recovery archive. A recipient keeps an independent workspace and its original IDs; differing branches are retained alongside each other.

See [OPERATING_GUIDE.md](OPERATING_GUIDE.md) for each screen and recovery behavior, [NATIVE_ENGINE.md](NATIVE_ENGINE.md) for native RDF semantics, and [RECEIVING.md](RECEIVING.md) for the completed source-to-receiver exercise.

## What travels with a workspace

A handoff contains the standalone SQLite application image, original source and native result bytes, complete record histories, native input specifications and retained attempts. A manifest verifies every file. Original IDs, source hashes and selected revisions remain intact.

Local encryption keys, live processes, host addresses and temporary files are not transferred. A receiving operator creates a fresh local key. Received child workspaces are independent: export subsequent changes from that child operator itself. The parent keeps its incoming edition and receipt history, which can be reconstructed on another host. A transferred recovery receipt asks for its separately held encrypted archive instead of opening a former host path.

Encrypted recovery uses AES-256-GCM with a fresh salt and nonce and PBKDF2-HMAC-SHA256 with 600,000 iterations. The passphrase is required to restore. Keep it separately from the archive.

## Source and product boundaries

The retained examples are public W3C and DCAT-AP material, together with clearly identified local derivations used for receiving. They do not represent a private customer ontology, an accepted customer solution, or a statement that public source shapes conform. The full upstream files and notices are retained under `reference/`.

The native engine performs graph operations on retained local inputs. It preserves ontology import assertions without fetching them. JSON-LD remote contexts, SPARQL network access and executable extensions are disabled. Dataset jobs preserve graph membership and a complete empty-graph catalogue. Validation and query union choices are explicit and retained; original version 1 graph jobs keep their existing model. See [DATASETS.md](DATASETS.md) for the same-workspace dataset workflow.

This application runs under one trusted operating-system owner. It does not expose a public service, multi-user authentication, a hosted database, or external system credentials. It does not modify upstream source systems or incur GitHub Actions usage.

## Package and license

`BUILD_RELEASE.py` builds a source ZIP with a full file manifest from an explicitly supplied source commit. It includes the application, native engine, operating guides and all original reference sources. By default it excludes workspaces and receiving output. The explicit `--dataset-result` option adds the verified completed dataset handoff and its result, using the exact archive recorded by the receiving operation. Installed runtimes, Git metadata and private keys stay outside both package forms.

Application code is Apache-2.0 licensed. The upstream reference files retain their own licenses and attribution in `NOTICE` and `reference/SOURCE-MANIFEST.json`.
