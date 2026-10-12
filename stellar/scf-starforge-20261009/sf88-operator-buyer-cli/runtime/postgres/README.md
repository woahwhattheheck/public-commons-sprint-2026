# PostgreSQL runtimes for complete buyer receiving operations

These launchers give the existing Python buyer an isolated PostgreSQL endpoint,
an exact Psycopg installation and an orderly database restart. Use an existing
customer PostgreSQL connection for the deployed warehouse; use these contexts
when operating a complete original delivery on an equipped development host.

The receiving product and its full command guide are in
[../../python/POSTGRESQL.md](../../python/POSTGRESQL.md). Its mapping, immutable
edition identities, transactional COPY, original manifest retention and stable
application views are shared by both runtimes.

## Files and host requirements

| File | Responsibility |
| --- | --- |
| native_postgres.py | Restore the original pinned native PostgreSQL package and Psycopg wheels, start a private server, run commands, restart and clean up its owned processes. |
| streaming_pglite.py | Own the pinned PGlite package, Psycopg wheels, local socket and the responsive client broker. |
| pglite_stream_worker.mjs | Run the actual PGlite PostgreSQL engine in a separate process with blocking native wire callbacks. |
| ../../python/stellar_forge_buyer/processes.py | Supervise receiving commands and close their owned descendants after exit, timeout or caller interruption. |

Both Python launchers use Linux x86-64 and Python 3.12 because their binary
Psycopg wheel is pinned to that ABI. The PGlite worker additionally needs the
host's existing Node runtime. The broker resolves an explicit node argument,
CODEX_PRIMARY_RUNTIME_NODE, or node on PATH, in that order. The observed host
runtime is Node v24.19.0. Its default worker arguments are
--max-old-space-size=128, --max-semi-space-size=4 and --liftoff-only: these bound
JavaScript heap growth and use V8's baseline WebAssembly compiler for the
isolated receiving operation. Pass node_arguments=() to use the host's normal
Node compilation and heap settings. Readiness records the actual Node version,
arguments, PostgreSQL buffer settings, linear memory size and peak RSS.

Native PostgreSQL runs as an existing nonroot identity. A root caller uses the
host's existing nobody account. The launcher checks the user namespace's UID/GID
maps before downloading: a namespace that maps only root needs an equipped host
with an ordinary nonroot identity. The launcher keeps PostgreSQL's original
owner checks in place.

Fresh PGlite initialization needs capacity for its PostgreSQL and initdb
WebAssembly instances and the initial database. The completed original receiving
operation on 2026-10-12 reached 490,920 KiB (479.4 MiB) of child RSS; reopening
reached 119,312 KiB (116.5 MiB). The earlier runtime reached 1,072,632 KiB
(1,047.5 MiB). Budget memory for initialization as well as the steady database
process; workload and host behavior can change the peak. The worker starts with
128 MiB of WebAssembly memory and keeps PGlite's required default startup flags.
The supported initDbStartParams options apply the same 8 MiB shared and
maintenance buffers, 1 MiB work_mem, ten-connection limit and disabled parallel
workers during initialization. PostgreSQL's [initdb --set option](https://www.postgresql.org/docs/18/app-initdb.html)
applies those values while bootstrapping and retains them in postgresql.conf.

## Native server

The native launcher restores the exact original Linux package, validates its
SHA-512 integrity before extraction, and validates the two Psycopg wheel
SHA-256 digests. It downloads into its owned temporary context.

~~~python
from native_postgres import NativePostgres

with NativePostgres() as host:
    # host.environment contains PGHOST, PGPORT, PGUSER, PGDATABASE,
    # SF_BUYER_POSTGRES_DSN and the isolated driver's PYTHONPATH.
    result = host.run(["python3.12", "existing_receiving_operation.py"])
    result.check_returncode()
    print(result.stdout)

    # The same owned data directory is opened by a new native server process.
    host.restart()
    result = host.run(["python3.12", "existing_reopen_operation.py"])
    result.check_returncode()
    print(result.stdout)
~~~

Pass temporary_parent only when the host has a suitable temporary filesystem.
The context owns that directory and removes it when it exits. Keep deliverables
that must outlive the operation in the operation's established output location.

Readiness is established by a real Psycopg connection executing SELECT version().
The package contains postgres and initdb; the launcher does not require
pg_isready. The server exposes a private Unix socket and no TCP listener.
Settings include 8 MiB shared buffers, 1 MiB work_mem, 8 MiB
maintenance_work_mem, ten connections, disabled parallel workers and a
five-minute statement timeout. The statement timeout is configurable.
SIGTERM requests PostgreSQL's orderly shutdown and checkpoint before restart.

## PGlite streaming server

PGlite provides an embedded PostgreSQL engine. Its ordinary synchronous wire
API accepts a supplied input buffer. COPY FROM STDIN needs that native read to
wait for later CopyData and CopyDone messages, while the client socket remains
responsive.

This adapter places those responsibilities in separate processes:

1. The Python broker owns the selected local socket and forwards original client
   bytes to the worker through bounded 64 KiB pipe frames.
2. The Node worker calls the pinned engine's actual native PostgreSQL loop.
   Its read callback waits on the pipe when PostgreSQL needs more input.
3. Native backend bytes, including CopyInResponse, CommandComplete, errors and
   ReadyForQuery, return immediately through the broker to the original client.
4. When the client ends, the worker executes native ROLLBACK and DISCARD ALL,
   verifies their actual completion and idle responses, and synchronizes the
   database before the broker assigns the next client. The worker bounds reads
   at frontend message boundaries and handles Terminate as a logical client
   close, including when it follows CopyDone in the same socket write.

The adapter uses the same libpq connection settings and run/restart interface:

~~~python
from streaming_pglite import StreamingPGlite

with StreamingPGlite() as host:
    result = host.run(["python3.12", "existing_receiving_operation.py"])
    result.check_returncode()
    print(result.stdout)
    host.restart()
    result = host.run(["python3.12", "existing_reopen_operation.py"])
    result.check_returncode()
    print(result.stdout)
~~~

The default transport is a private Unix socket. On a development host that
supports loopback TCP and rejects AF_UNIX, select StreamingPGlite(transport="loopback").
This binds only 127.0.0.1 on an operating-system-selected port. Use it inside an
isolated development host: the embedded backend trusts local clients. Socket
setup runs before engine allocation. Read host.environment after each restart;
the loopback port may change, and host.run automatically uses the current
connection settings.

An explicit data_directory persists beyond the context and must be controlled
by the caller. The context's default database is temporary. Give a retained
directory to one worker at a time; stop the original worker before reopening it.
The server serializes complete client sessions because one PGlite instance has
one backend. Close one client before opening another client in the same
operation. Ordinary query, COPY and result backpressure flow through the
original wire connection.

This private development transport has no TLS or GSS layer. A separate
PostgreSQL cancel connection closes without targeting another process;
statement_timeout and the owning command's timeout control long operations.
The private Unix socket is inside a mode-0700 directory. Runtime exceptions
close the owned worker instead of assigning a damaged session to another
client. During orderly shutdown, the worker reports closure only after PGlite's
filesystem close and native closed flag have completed. The pinned engine may
exit Node from Emscripten; a synchronous exit handler records that same completed
close with native exit status zero. The broker requires that close record and a
zero process exit before restarting the retained data directory.

## Receiving command lifetime

Put the buyer's python directory on the launcher's Python import path when
using StreamingPGlite.run. The command runner uses the standard-library
stellar_forge_buyer.processes module on Linux with child adoption and pidfds.

Each run owns a separate supervisor and one command. The supervisor preserves
the command's stdout, stderr and actual exit status. It retains the original
process-group leader until cleanup finishes, adopts detached descendants such
as Chromium, and uses process descriptors to signal those children across PID
namespaces. A command timeout first requests termination, then removes and reaps
surviving owned descendants. The caller's lifetime pipe also starts cleanup if
the caller exits abruptly. Cleanup completes before run returns or raises
TimeoutExpired. completed.owned_processes records that result.

The original command may spend up to ten additional seconds in ordinary
termination cleanup. A kernel task waiting for uninterruptible I/O can take
longer to exit; its supervisor retains ownership until the task exits.
This supervision is for commands with the lifetime of the receiving operation.
Keep independently operated services outside that command's process tree.

The semantic receiving example uses the same runner for its browser and CLI,
saves the original command logs on timeout, removes its temporary private
browser configuration, and leaves retained receiving checkpoints available for
the same command to resume. Its browser closes explicitly on termination and
publishes its final state only after that close.

## Run a complete original delivery and reopen it

Put this runtime directory and the existing buyer's python directory on
PYTHONPATH. Supply the original completed SF88 report and the reviewed mapping
through SF_DELIVERY_REPORT and SF_COLUMN_MAPPING. The report continues to point
at its original complete SF100 directory.

The following operation uses the public receiving CLI, a real COPY import and
a restarted server. It prints the actual warehouse/version identifiers and
command results, so a caller can join them to its existing operation record.

~~~python
import json
import os
import sys

from native_postgres import NativePostgres
# StreamingPGlite has the same interface when that runtime is selected.

report = os.environ["SF_DELIVERY_REPORT"]
mapping = os.environ["SF_COLUMN_MAPPING"]

def command(host, *arguments):
    result = host.run([
        sys.executable, "-m", "stellar_forge_buyer.postgres_cli",
        "--schema", "sf_runtime_receiving", *arguments,
    ])
    result.check_returncode()
    return json.loads(result.stdout)

with NativePostgres() as host:
    review = command(host, "review", "--report", report, "--mapping", mapping)
    initial = command(host, "init")
    imported = command(
        host, "--expect-warehouse", initial["warehouse_id"],
        "import", "--report", report, "--mapping", mapping,
        "--expect-version", review["version_id"],
    )
    selected = command(
        host, "--expect-warehouse", initial["warehouse_id"],
        "activate", "incoming", imported["version_id"],
        "--expected-revision", "0",
    )
    page = command(
        host, "--expect-warehouse", initial["warehouse_id"],
        "rows", imported["version_id"], "--limit", "5",
    )
    host.restart()
    reopened = command(
        host, "--expect-warehouse", initial["warehouse_id"], "status",
    )
    reused = command(
        host, "--expect-warehouse", initial["warehouse_id"],
        "import", "--report", report, "--mapping", mapping,
        "--expect-version", review["version_id"],
    )
    print(json.dumps({
        "postgres_starts": host.starts,
        "review": review,
        "imported": imported,
        "selection": selected,
        "row_page": page,
        "reopened": reopened,
        "reimported": reused,
    }, indent=2))
~~~

The full buyer guide covers a second original edition, all-row keyed comparison,
application joins, exact manifest export, view restoration and row/history
pagination. Use rows.next_after and compare.next_offset when reading every page.

## Completed original receiving operation

On 2026-10-12 the unchanged buyer at commit
8a3582a5296a7ba325c44e9ef1b37ec896a08ad5 completed the full workflow on
PostgreSQL 18.3 (PGlite 0.5.8), Psycopg 3.3.6 and Node 24.19.0, using two existing
deliveries of the original fictional inventory example.

Both five-row editions were loaded through native COPY. The operation retained
the exact original rows and manifest bytes, read typed decimals and nulls,
joined the application view to its selected-edition metadata, and compared the
two keyed editions. PostgreSQL rejected a duplicate business key with SQLSTATE
23505 and rolled back the entire failed import. After a full engine shutdown
and restart, the same warehouse identity and two editions reopened; reimport
returned UNCHANGED and restoring the first edition created view revision 3.
All 38 client sessions completed native reset. Both database processes recorded
a completed native close and exited with status zero.

## Exact dependencies and source contract

| Dependency | Version | Original source |
| --- | --- | --- |
| Native PostgreSQL package | @embedded-postgres/linux-x64 18.4.0-beta.17 | [npm archive](https://registry.npmjs.org/@embedded-postgres/linux-x64/-/linux-x64-18.4.0-beta.17.tgz) |
| Embedded PostgreSQL engine | @electric-sql/pglite 0.5.8 | [npm archive](https://registry.npmjs.org/@electric-sql/pglite/-/pglite-0.5.8.tgz) |
| Driver | psycopg and psycopg-binary 3.3.6 | The exact public Python package wheel URLs and SHA-256 digests are retained in native_postgres.py. |

Native package SHA-512:

~~~text
jVw/MdDtIX/vICH/DKIe6/mHpiCggdx6QVyza4vt/NbcZFsL0KhwglF6F1Koqx3gRBZ9XtN+vi63EsqSyqOSxA==
~~~

PGlite package SHA-512:

~~~text
n9tsbUOhwx2epK1V0ZG9Ar4SHWUju04dhmzZXiSBXwBoleOvIfals33NAaWgagQVAL4Rbvx/Ptsu3P+pA09f6Q==
~~~

The streaming worker uses PGlite's public Module getter, native callback
registration, PostgreSQL loop/longjmp entry points and startup functions.
It checks those symbols before accepting a client session. The loop follows the
upstream [pglite.ts implementation](https://github.com/electric-sql/pglite/blob/main/packages/pglite/src/pglite.ts);
the inspected source blob was f1016184996cfad357d3425b8b838d8ded4e0cf3.
The original PGlite socket package used in the affected operation was
@electric-sql/pglite-socket 0.2.11. This adapter supplies the responsive pipe
transport around the original 0.5.8 engine.

The PGlite package and upstream loop are Apache-2.0 licensed. The native
PostgreSQL npm distribution is MIT licensed. Package version checks and
content digests are part of the launchers' runtime contract; update them
together with the corresponding native interface when adopting another release.
