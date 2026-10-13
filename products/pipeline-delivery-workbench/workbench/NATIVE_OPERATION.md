# Original Dagster and dbt operating lifecycle

## What owns execution

A Workspace is a persistent SQLite writer with a permanent Linux flock. Its existing reentrant lock also covers mutation acceptance and native start admission. Runtime.idle_guard owns that lock and the same native flock for a selected-writer switch or backup. Nested guards reuse the existing owner; they do not create another process or queue.

Original Dagster is responsible for run execution and run storage. runner.py calls the released JobDefinition.execute_in_process API with the preassigned original run_id and the regular DagsterInstance from DAGSTER_HOME. The original dbt executable, not a replacement evaluator, parses and executes SQL/YAML and produces artifacts.

The selected dbt1.12.5 CLI definitions were read from the upstream source. deps supports the original project/profiles/vars options but not target_path or threads, so that stage uses only its actual options. Parse/build/run/seed/compile/source freshness/docs generate use their original supported selectors and output paths. Dependency installation is explicit and catalogue generation has a separate original output directory.

## Accepted request before native work

run.execute retains:

- original project/edition/contract/binding IDs and source hashes
- a workspace operation ID and one Dagster UUID
- the caller's exact request ID, payload digest, expected revision and accepted response
- optional same-project managed database baseline or explicit failed-run predecessor

COMMIT precedes any original process creation. invoke returns that accepted response even if a later setup or persistence step fails. request.get reads that original response; exact request replay does not automatically run a second pipeline.

The source and connection references are materialized into an immutable request.json. Original project files are copied from the retained SQLite blobs. An external profiles.yml is read only to pin its hash and retained directory reference; its values are not copied into the application or delivery. Every dbt stage checks that profile hash before invoking it.

## Native lifetime and result

The host acquires native.lock before Popen and passes that same locked file description to runner.py. The worker validates the inherited descriptor against the original lock file and records its exact PID/start-ticks/PID-namespace/boot identity. Each dbt child inherits the same native lease. Another host cannot treat an ended wrapper as an idle workspace while its original dbt child still runs.

Each setup attempt retains its own launch/worker/error records. The stable original Dagster UUID and input request remain unchanged across a definite before-dispatch setup continuation. The worker checks the original Dagster store before execution; an existing run is observed, never executed again.

Native stages retain argv, process identity, stdout/stderr, exit status and JSON artifacts. The selected invocation's artifacts remain distinct from the optional later catalogue stage. A terminal outcome is published only for a terminal original Dagster status. An interrupted observation is retained separately; it does not seal an unknown run as completed.

A final outcome binds actual run ID, source/contract hashes, native runtime versions, stage exits, original artifacts and any managed DuckDB snapshot. The workspace verifies artifact bytes before adopting that outcome. Re-reading an unchanged observation does not create another workspace revision.

## Reconciliation and explicit continuation

Reconcile first reads the same retained terminal outcome. If the worker is alive, it observes the original identity and marker. If it has ended, the original native reader obtains the same native lease and queries the same Dagster UUID. It never calls dbt or execute_in_process.

- Original success/failure/cancellation: retain or recover that actual terminal result and its existing artifacts.
- Original store confirms no such run: record a fresh native absence observation and allow the same unchanged setup intention to continue.
- Existing nonterminal run or unavailable reader: retain interrupted/unknown state, original IDs and output. Do not turn missing output into a retry.
- Received historical operation: preserve its original machine paths and process/native identities; the receiver does not signal or redispatch that machine's job. Configure a new local binding and select a new local run.

Stop records a persistent local intent and signals only the verified original process group. It is not reported as a native cancellation before the original run returns its result. A positively idle, never-dispatched operation can be marked locally cancelled-before-dispatch; it has no fabricated Dagster outcome.

A definite failed or cancelled operation may create an explicit new run with parent_run_id. A successful same-project managed DuckDB snapshot can be selected as a baseline for a new incremental run. An external warehouse cannot be copied or treated as a managed local baseline.

## Persistence, packaging and receiving

The worker can finish after a browser server has closed. Its original files and native lease remain authoritative. On restart, open the same writer and reconcile its retained run. No automatic startup loop or hidden scheduler launches work.

Complete backups hold the original idle guard and use SQLite backup for the application and original native SQLite stores. They retain original source, requests, artifacts and complete app source. Client releases scope application history and native-run files to one selected project and do not include the all-client Dagster database.

All archive members have explicit path/size/SHA identities. Receiving verifies the full archive before staging, verifies bytes while extracting, checks the original database identity, fsyncs the stage and publishes one destination. The original receipt and manifest are retained there. A repeated same-archive receive returns the existing directory and its current revision; it does not restore over later changes.

External installed executables and profiles remain references. Receiving does not install packages, run source, query a provider or refresh a native result. Those are separate explicit operator actions.

## Practical native run

The included original Jaffle Shop source uses existing data tests and seed data. Operate it through the staff UI or CLI, read the original Dagster/dbt IDs and results, save a review, create a client release, receive that archive, then reopen the same directory and preserve a later edit. A local example only establishes those actual exercised source/runtime paths. It does not assert access to a customer tenant or acceptance of a paid project.
