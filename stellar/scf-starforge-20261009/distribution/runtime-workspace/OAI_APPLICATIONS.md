# Repository metadata in Applications

The maintained `oai` command opens the original OAI/XML repository workspace.
The separate `oai-publisher` command carries a reviewed source export through
the original dataset publisher, merchant release and customer preparation.

## Open an existing repository workspace

In Applications, choose **Repository metadata editions**. Select the original
private workspace directory, its existing absolute Python 3.11+ executable,
the desired loopback port and any existing environment file. Review and save the
selection, adopt the selected installed source, then review its start and choose
Start and Open.

The workspace is initialized or restored through the original command:

```sh
starforge oai --python /absolute/path/to/python3 --workspace /private/repository init
starforge oai --python /absolute/path/to/python3 --workspace /private/restored-repository restore --archive /private/oai-workspace.zip
starforge oai --python /absolute/path/to/python3 --workspace /private/repository serve --port 0
starforge oai --help
starforge oai-publisher --help
```

Restore requires a new destination. The normal command and Applications use
the same directory, original SQLite database, retained HTTP responses,
record observations, mappings, reviewed editions and native dataset builds.
Choose a separate private directory for a separately received workspace.

The six console sections expose repository setup, original request history,
record changes, reviewed editions, typed mapping/query and portable receiving.
The source export carries the complete reviewed record population and raw
response lineage. A full workspace backup also carries the original private
transport, so retain it with the same access as the workspace.

## Review and startup

Review calls the original read-only `binding` command. It binds the private
directory, original workspace marker and database identity, selected Python
and the actual OAI/XML source. It reads the database schema without constructing
`Workspace`, so inspection cannot recover or reset an active harvest.

The saved command retains that binding. Start checks it before opening
the original workspace. The original console announces its managed launch;
the Applications helper verifies that same launch through the live loopback
endpoint using the console's session capability. Open reaches that original
console and selected workspace.

Source, Python or workspace replacement requires reviewing the changed
selection. Ordinary retained records, reviews and new editions remain
editable through the original workspace. Applications groups this entry with
XML and retained feed applications for ownership of the same workspace.

## Stop and reopen

Stop forwards SIGTERM through the installed Node launcher to the Python
console. Its original shutdown requests harvest cancellation, joins the
original worker, closes the server and then closes SQLite. Reopen the same
saved application after shutdown. The retained operation IDs, accepted
responses, record changes and reviews supply its continuation.

An interrupted request resumes through its existing saved request. Use the
console's retained history and original Resume/Restart actions as appropriate;
a new application selection is unnecessary for continuing the same harvest.

The installed launcher accepts a leading `--python /absolute/executable`.
Otherwise it uses `SF30_OAI_PYTHON`, then `SF30_XML_PYTHON`, then `python3`.
It sets `SF30_XML_NODE` to the current installed Node executable, forwards
standard input/output and preserves the child exit status.

## Original worked sources

The maintained OAI guide at
`sf30-seller-sdk/oai-pmh/README.md` includes two complete original receiving
entry points: `examples/zenodo_20261011.py` for the retained 231-record Zenodo
capture and `examples/ciim_openalex.py` for the original 169-record OpenAlex
publication, explicit withdrawal, restoration and receiving workflow.
Their source packages and private backups retain their original meanings.

The publisher guide and `oai-publisher --help` cover the original source,
extraction, review, publication, receiving and SF82 release operations. The
existing buyer configuration, allowance and signer remain selected by that
original customer operation.
