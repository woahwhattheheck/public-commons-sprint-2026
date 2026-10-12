# Private Ubuntu native receiving

The original Timescale demonstration can run without a machine-wide PostgreSQL
installation. `ubuntu-native-demo.py` selects the exact official Ubuntu 24.04
x86_64 PostgreSQL17.11 and TimescaleDB2.30.2 packages used by the native product.
It checks their complete byte lengths and SHA-256 hashes before streaming only
the required fresh-install runtime members into an owned private directory.
Package downloads and extraction run sequentially. PostgreSQL LLVM bitcode,
JIT, and other Timescale versions are unnecessary for this fresh example and
are omitted; every selected file or link is retained in the setup manifest.

Use an existing complete source checkout at its exact selected commit, with
no existing `node_modules` entry. Supply the complete compatible installed
dependency roots already held by your worker. The runner creates symlinks in
its own runtime and checkout; it neither changes nor removes donor packages.
It checks the declared package versions before downloading native packages.
If GraphQL16.14.2 alone is missing, it can retrieve that one official npm archive,
verify the registry SHA-512, and unpack it without npm installation or scripts.

Operate this command through the current Commons `host/swarm_cloud_job.py run`
with its original stable operation ID, runtime declarations, memory and disk
admission, retained logs and output artifacts. The bootstrap itself is not an
admission controller. Include the repository, native runtime, PostgreSQL data,
download/extraction peak, existing browser process and completed checkpoint
growth in the selected resource envelope. Temporary filesystem capacity is
not additional cgroup RAM. Keep the foreground invocation alive for the complete
database and receiving sequence.

```sh
python3 SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/ubuntu-native-demo.py \
  --repository SOURCE \
  --source EXACT_SOURCE_COMMIT \
  --directory EXISTING_PRIVATE_OPERATION_DIRECTORY \
  --runtime-directory NEW_PRIVATE_RUNTIME_DIRECTORY \
  --operation-id TIMESCALE-NATIVE-DBA55-20261012 \
  --dependency-root EXISTING_FULL_NODE_MODULES \
  --dependency-root EXISTING_PG_NODE_MODULES \
  --node INSTALLED_NODE24 \
  --playwright INSTALLED_PLAYWRIGHT_DIRECTORY \
  --chromium INSTALLED_CHROMIUM_EXECUTABLE \
  --remediation-receiver ORIGINAL_REMEDIATION_RECEIVING_PATH
```

Repeat `--dependency-root` for the existing complete roots needed by this
checkout. The receiving path is relative to the selected repository. The source
root, operation directory and each declared donor must already exist. The
runtime directory must be new. A normal Ubuntu user runs its own PostgreSQL
server under that same account. When the bootstrap is already running as root,
it starts PostgreSQL as uid65534 instead. The private server binds loopback with
an ephemeral port, SCRAM authentication and a generated private password. It creates no system
service and starts no GitHub Action.

The original `native-demo.mjs` operates its unchanged explicit six-reading
industrial usage example and retains its phase UUIDs. The same cluster remains
available for `timescale-workspace-native-receiving.mjs`, its merchant MCP,
Applications and real browser path, full resumable project download and customer
reopen. When selected, the complete original remediation receiving CLI follows
against that same merchant configuration and workspace. Its expected arguments
are `--native-result`, `--config`, `--workspace usage`, and `--directory`.

Each setup/subprocess stage is saved before and after execution in the original
`host.json`; subprocess output remains in complete log files. The runner dumps
and stops only its own database and retains the whole original database,
password file, workspace, native result, receiving projects and logs in
`Timescale_Native_Host_Checkpoint_20261012.tar.gz`. This archive is private:
it includes credentials and complete operating state. Public dependencies and
the already-pinned Git source are reproducible inputs and are excluded.

A successful native journey is recorded separately from completion of the
checkpoint. The host becomes complete only after the archive is closed and
its size and SHA-256 are retained. Reopening a completed operation verifies
those original bytes and source/receiving intent. A failed original database
operation must resume from its retained data and phase records; the bootstrap
refuses to replace it with a fresh cluster. Legacy setup-only records predating a
database or checkpoint retain their preceding exact host record before a new
setup generation. Completed or interrupted database/checkpoint state is never
silently replaced.
The native and receiving executables remain the owners of their original UUIDs,
editions, publication, work history, and full export/receive behavior.

The three original Node journeys keep their own database, HTTP and browser
deadlines and cleanup; the Python wrapper imposes no second kill deadline.
Database shutdown executes even if a setup journal or log cannot be written.
After all native receiving ends, the runner releases only its own unchanged
checkout dependency symlink. The original complete donor installations remain
available to every other borrower.
