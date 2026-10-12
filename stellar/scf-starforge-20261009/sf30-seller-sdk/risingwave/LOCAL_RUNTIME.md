# Retained local RisingWave runtime

This command prepares and runs one local RisingWave 3.1.0 instance for a
private workbench and its installed Applications. It keeps the executable,
database state, environment, process identity and complete database log
together. The same instance continues while the native workbench closes and
the managed application opens, closes and reopens.

The command is available as:

~~~sh
starforge risingwave-runtime --help
~~~

From a source checkout, use:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/risingwave/examples/local-runtime.mjs --help
~~~

Use Linux x86_64 with AVX2, Node 22.16 or newer, GNU tar and util-linux flock.
The original private filesystem needs regular files, hard links, atomic
rename and fsync. Keep the runtime directory, database state and workbench
directories outside the source checkout.

## Select the original operation

Bind these paths and resource values from the host selected for that
operation:

| Value | Meaning |
| --- | --- |
| `RW_RUNTIME_HOME` | Private directory for executable/archive, configuration history, process state and log |
| `RW_OPERATION_ID` | Existing operation identity |
| `RW_STATE_HOME` | Original private database state directory |
| `RW_FRONTEND` | Selected loopback frontend, such as `127.0.0.1:4566` |
| `RW_MEMORY_BYTES` | Memory budget passed to the whole single-node runtime |
| `RW_RECEIVING_RESERVE_BYTES` | Additional memory reserved for the operating system, Node, browser and receiving work |
| `RW_PARALLELISM` | Selected compute parallelism |
| `RW_COMPACTION_THREADS` | Selected compaction worker threads |
| `RW_FREE_STATE_BYTES` | Free disk reserve required when starting the original database |
| `RW_PRIVATE_ENVIRONMENT` | Existing private JSON file containing the original connection-string reference |

The environment file contains string values, for example a
`RISINGWAVE_URL` entry. Its actual database URL selects the database, user,
credentials and frontend port. Retain the original file with mode 0600.
The local launcher expects the URL's host to be localhost or 127.0.0.1 and
its port to match the chosen frontend. The original transport uses 4566
when the URL omits a port.

If that file has not yet been written, prepare reads the named connection
value from its process environment and creates the file inside an already
private parent directory. A connection string is supplied through that
environment reference, without placing credentials in command arguments.
Additional existing JSON entries are preserved. New environment and immutable
metadata files acquire their final names only after the complete bytes are
written and synced, so an interrupted write can be retried.

## Prepare the executable

Reuse the complete original archive when it is already available:

~~~sh
starforge risingwave-runtime prepare \
  --directory "$RW_RUNTIME_HOME" \
  --operation-id "$RW_OPERATION_ID" \
  --store-directory "$RW_STATE_HOME" \
  --listen-address "$RW_FRONTEND" \
  --memory-bytes "$RW_MEMORY_BYTES" \
  --reserve-bytes "$RW_RECEIVING_RESERVE_BYTES" \
  --parallelism "$RW_PARALLELISM" \
  --compaction-threads "$RW_COMPACTION_THREADS" \
  --minimum-free-bytes "$RW_FREE_STATE_BYTES" \
  --environment-file "$RW_PRIVATE_ENVIRONMENT" \
  --archive "$RW_ORIGINAL_ARCHIVE"
~~~

Select exactly one executable source:

- `--archive ABSOLUTE_PATH` verifies and reads the existing complete archive.
- `--download` retrieves the pinned archive into the same runtime directory.
- `--binary ABSOLUTE_PATH --binary-sha256 SHA256` reuses an already selected
  regular executable and its original byte digest.

The Linux x86_64 archive is
[risingwave-v3.1.0-x86_64-unknown-linux.tar.gz](https://github.com/risingwavelabs/risingwave/releases/download/v3.1.0/risingwave-v3.1.0-x86_64-unknown-linux.tar.gz),
201,363,854 bytes, SHA-256
`3e42052148bcd5cf9df076f983005f7164a8ee77d83128ab51e02489c9a7e629`.

Prepare streams an interrupted download from its retained partial offset
when the server returns the matching HTTP range. If the server returns
the whole archive, it restarts that unfinished file at offset zero. Final
publication checks the complete size and SHA-256. An invalid completed
partial is retained under its own digest and the original download is
retried once. Already published files are compared before reuse.

Extraction selects the single regular executable named risingwave from
that archive. Its actual declared unpacked size is checked against
available disk and the chosen free-byte reserve. Only the executable is
materialized; the original archive stays available. On tmpfs or ramfs,
archive and executable writes also need current memory headroom for their
additional bytes and the selected receiving reserve. Filesystem free space
alone cannot provide that memory. If publication
finished just before the provenance write was interrupted, the next
prepare compares the existing executable with the archive stream and
finishes the same provenance file.

An operator-selected executable keeps its supplied digest and selected
source path. In both paths, prepare reads the actual executable's version
and help and checks the pinned single-node options.

The final `runtime.json` binds the selected binary, resource settings,
private state and environment digest. Each complete configuration also
has an immutable file in `configurations/`. Repeating prepare with the
same running configuration returns that existing process. Resource
settings can be revised after that original instance exits, while its
database state and prior configurations remain available. Prepare checks the
original operation again after acquiring its lock; serve reads the committed
configuration under that same lock.

## Inspect the host and start the instance

~~~sh
starforge risingwave-runtime inspect --directory "$RW_RUNTIME_HOME"
starforge risingwave-runtime serve --directory "$RW_RUNTIME_HOME"
~~~

Inspect reads Linux memory, cgroup and CPU data and the actual state
filesystem. Memory output separates raw cgroup headroom from inactive
disk-backed file cache. Shared-memory pages are excluded from the file
cache estimate. The selected runtime memory and receiving reserve are
compared with the available estimate; CPU settings are compared with
affinity and quota. Inspect retains these measured values in its output
so the operation owner can select practical settings.

Serve repeats admission immediately before starting. It checks the
frontend and the pinned internal ports 5690, 5691, 5688 and 6660. The
resource check is a current observation: concurrent processes and future
database growth still affect available capacity.

The command uses the pinned source's default single-node mode and passes:

~~~text
--store-directory ORIGINAL_STATE
--listen-addr SELECTED_FRONTEND
--total-memory-bytes SELECTED_MEMORY
--parallelism SELECTED_PARALLELISM
--compaction-worker-threads-number SELECTED_THREADS
~~~

The child receives the ordinary environment with inherited `RW_*`
configuration options removed, so an older shell configuration cannot
redirect this selected local store. The private connection JSON remains
unchanged. This launcher runs the pinned default local storage layout:
`state_store` and `meta_store/single_node.db` stay under the selected
database state directory.

The foreground owner retains a kernel flock and passes the same open
file description to the RisingWave child. A surviving database therefore
keeps that lock if its launching console ends. Process records include
Linux boot ID, PID, process start ticks, executable and selected
arguments. A later serve recognizes the same instance, including
equivalent argument order and the explicit single subcommand. It returns
that existing process instead of launching another one.

`risingwave.log` retains complete stdout and stderr. Console messages
carry progress, paths and identities. A `runtime-listening` event means
the original process has opened the chosen frontend socket. The
connection inspection below reads the actual database version and
identity:

~~~sh
starforge risingwave-runtime inspect \
  --directory "$RW_RUNTIME_HOME" --connect
~~~

This uses the product's original pg transport and pinned 3.1.0 version
check. Run it from the installed native runtime or a source environment
where the selected pg dependency is available.

Normal SIGINT or SIGTERM to the foreground serve command reaches its
owned child. A lost output or journal write leaves a started database
with its retained original state and log. A later inspect/serve can
recover the exact process from Linux state. The command never removes
the database directories.

## Continue native and installed receiving

Keep serve active in the original owning process. Run the existing
native programme against the original private environment and exact
source/input selection. When its native workbench writer closes,
continue the existing managed programme against that same server and
workbench.

The full operation remains:

1. Prepare the selected executable and original private environment.
2. Start or reuse the original local database.
3. Run the original native receiver with its frozen source, real input
   digest and same case directory.
4. Build/install the selected complete merchant recipe and retain its
   archive, installation, profile, lock and manifest identities.
5. Run the original managed receiver with its completed native result,
   original private environment and awaited browser callback.
6. Retain the same database state, application and source editions for
   subsequent operator use.

Use [MANAGED_WORKBENCH.md](MANAGED_WORKBENCH.md) for the actual installed
receiving command and browser callback. Use [WORKBENCH.md](WORKBENCH.md)
for the original operator, subscription, capture and merchant workflow.

The local runtime configuration does not replace those existing native
or managed progress files. Each programme continues its own original
case and installation. An interruption is resumed with the same runtime,
state, environment, native case and managed case paths.

## Source contracts

- [Pinned RisingWave single-node arguments and storage layout](https://github.com/risingwavelabs/risingwave/blob/45baf6460ea942e4ff57a5aa057d5b8db7f3b563/src/cmd_all/src/single_node.rs).
- [Pinned compute memory split and reserve implementation](https://github.com/risingwavelabs/risingwave/blob/45baf6460ea942e4ff57a5aa057d5b8db7f3b563/src/compute/src/memory/config.rs).
- [Linux cgroup v2 memory and CPU interfaces](https://www.kernel.org/doc/html/v6.6/admin-guide/cgroup-v2.html).
- [Linux memory-backed filesystem behavior](https://www.kernel.org/doc/html/v6.12/filesystems/tmpfs.html).
- [Linux filesystem identifiers](https://github.com/torvalds/linux/blob/master/include/uapi/linux/magic.h).
- [Linux flock lifetime and inherited open file descriptions](https://man7.org/linux/man-pages/man2/flock.2.html).
- [Linux process start-time identity](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html).
