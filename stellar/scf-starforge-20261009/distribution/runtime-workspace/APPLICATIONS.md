# Applications

Applications opens the original merchant and buyer tools from a selected READY runtime. It retains the runtime binding, installed release, data paths, exact argv, original process operation and private session URL. The existing managed worker owns the process. Closing the runtime browser or its web server leaves that process available for reopening.

## Available original tools

| Application | Maintained command | Original workflow |
| --- | --- | --- |
| API merchant authoring | openapi-workspace | Source intake, paid routes, saved packages, seller preview and operations |
| Dataset preview | dataset-workspace | A dataset configuration file or retained dataset state, native query and preview |
| PostgreSQL publisher | postgres-publisher serve | Plans, extraction, candidate review, publication, schedules and buyer handoff |
| Google Sheets publisher | sheets-publisher serve | Original authorization/source, range plans, extraction, review and recurring publication |
| PostgreSQL authoring | postgres-workspace | Original database inspection, query contracts, merchant package and release |
| Object buyer workspace | buyer-object-workspace | Original sessions, receiving, chunk or whole acquisition, verified downloads and managed analysis |
| Commerce session | commerce-console start | An initialized SF66 session, original buyer/delivery/recovery and terminal approval |
| XML dataset onboarding | dataset xml … serve | An initialized XML workspace, source intake, mapping, native query, comparison and portable editions |

A selected runtime must actually contain the command. XML and Object Buyer additionally require their original forwarding/server source; an older package cannot acquire these capabilities by selecting a label. The chosen original profile supplies the dependencies required by the application. Applications installs no replacement engine or new npm dependency.

## Save and start

1. Open the existing runtime workspace, attach or select the READY installation at its original absolute directory, and choose **Applications → New application**.
2. Select the original application and its private data paths. Use port **0** for the original server to choose an available loopback port. Commerce and XML take existing initialized workspaces.
3. **Review application** displays the exact command, source commit, runtime, managed home and terminal mode. The optional environment file is represented only by its path.
4. **Save application** reuses a matching original managed release if available. Otherwise it starts the existing managed adoption for that exact installation. The same operation appears in Managed releases and Operations.
5. **Review start** checks the current input files and original release. **Start reviewed application** launches the existing command through the managed worker.
6. **Open application** appears when that CLI prints its actual private local URL. Work in the original application: its forms, source validation, database, publisher, buyer and payment rules remain authoritative.

The API projects folder may be an existing private directory or one new directory in an existing private parent. Saving creates that one reviewed folder if needed. Source and dataset paths retain their original meanings.

The runtime console and original application have separate capability URLs. The latter is captured only from the selected CLI's startup announcement and retained privately against its original operation ID. It is never inferred from a configured port, source example or arbitrary terminal text.

## Publisher initialization and reopening

For a new PostgreSQL or Sheets publisher, select **Initialize a new publisher** and provide a new publisher directory, the original source configuration and target dataset state. The first launch passes --create to the original publisher.

Once its workspace.json exists with the reviewed source and target, a later launch reopens without --create. The original database, plans, candidates, review/publication history and schedules remain in that workspace. An incomplete or different directory is retained and reports the original error; Applications does not recreate or erase it.

Source configurations can retain their existing environment references and renewable credential files. Applications does not add provider credentials to source packages or replace the original OAuth/database connection manager.

## Object buyer receiving and reopening

Select the existing private object state. An optional original product profile supplies products for new reviews; existing sessions reopen their retained configuration without that profile. Applications pins a selected profile file for launch, while the original buyer rereads and pins the actual product descriptor and operator files for each new purchase review.

The first operator settings file creates the original received/operator-settings.json path reference. A later start can omit that setting and reuse the saved path. Selecting a different path for the same state is rejected; the original prepared product files and their buyer workspace remain unchanged. The optional Analysis Python executable is resolved and reviewed before launch.

The original Object Buyer URL opens its receiving, acquisition, accounting, downloads and analysis controls. Its per-chunk or whole-purchase approval stays in the connected original terminal. Retained customer acquisitions are never replayed by opening this application.

## Environment

By default a launched application inherits the runtime operator's environment. For a private application-specific environment, select a JSON file owned by the operator with mode 0600 and one regular file link. It contains environment names and string values, such as:

    {
      "PG_CONNECTION_URL": "postgresql://..."
    }

Use the names expected by the original selected source configuration. The review retains the file identity and SHA-256, not its contents. The runner verifies and reads those bytes just before launch and passes values through the child environment. A changed file requires a fresh start review. The existing HOME and CODEX_HOME locations remain in use.

No shell is invoked. Secrets are not placed in command arguments, application records, command results or browser responses. The original application may log its own diagnostic output, which stays in the private operation.

## The original commerce terminal

The SF81 buyer bridge opens /dev/tty. An ordinary detached stdin pipe cannot supply that controlling terminal. For commerce, the same managed runner places the exact original Node command inside a Python standard-library PTY.

The terminal pane displays original output. Read the current prompt, enter the intended response and choose **Send line to original terminal**. Ctrl-C and Ctrl-D send their actual control bytes. Opening, refreshing or recovering the runtime UI sends no terminal input.

An input retains its UUID, sequence and byte hash. Its dispatch claim is durable before the first PTY write. Repeating the same request returns the retained receipt; an interrupted DISPATCHING input is not automatically repeated. Read the original output to decide what response is still needed. SENT records delivery of bytes to the terminal. The original application records approval, execution and settlement.

A terminal write checks stop and original child exit throughout dispatch and waits at most ten seconds for the PTY to accept its complete input. An interrupted, failed or partial write retains DELIVERY_UNCERTAIN and the number of bytes written; its UUID is never replayed automatically. Output backpressure does not prevent the bridge from observing shutdown. Pending input bytes are private and removed after dispatch. Retained receipts contain identity, size/hash and delivery state. The original terminal may echo the input into its private output, as a normal terminal does.

The PTY records actual bridge and original child identities and keeps the existing worker lease. Stop first sends SIGTERM to that exact original process group. After five seconds, a child that has not closed is sent SIGKILL only after its original PID, start time, process group and session still match. The bridge keeps its original child unreaped until this cleanup finishes, then reaps it and retains the real exit result. Its result records graceful or forced termination and any output bytes that could not drain. Reopen the original application's retained operation after an interrupted action; terminal delivery never grants automatic approval.

The default Python is /usr/bin/python3; another reviewed absolute executable may be selected. The adapter uses the standard library and installs no terminal package or supervisor.

## Stop and recover

**Stop application** addresses the original run ID. A queued launch is recorded STOPPED before execution; a live launch uses the original managed stop file and runner. Commerce first drains within the terminal's graceful interval. A forced terminal exit leaves the original application's durable operation available for its own recovery.

**Cancel pending start** also covers a saved start whose original worker request was not created. Cancellation is retained under the application lock, so a later retry cannot launch it.

**Continue original start** reuses the saved UUID for an intent that was durably prepared but never dispatched. **Reconcile original operation** calls the existing managed recovery for an interrupted worker. A command with an existing launch record is not launched again. Its original result, output, process identity and kernel lease supply recovery.

After a confirmed stop, edit the settings, save another reviewed revision and review a new start. Earlier runs and revisions remain. Changing a managed home's active release does not silently move a running application: each start pins its selected runtime and release.

Applications prevents another retained run for the same data directory while an earlier one is active, queued or unreconciled. Kernel leases remain authoritative when a container's /proc does not expose the inner namespace's PIDs.

After the runtime web server restarts, open its new URL and select the saved application. A live operation exposes its same original private application URL and ID. An ended URL remains historical and its Open link is disabled. A reviewed new start opens the same application data; it does not replay buyer work.

## CLI

The browser and CLI use the same model:

    starforge runtime-workspace applications --workspace /private/runtime-console
    starforge runtime-workspace application-review --workspace /private/runtime-console --request /private/review.json
    starforge runtime-workspace application-save --workspace /private/runtime-console --request /private/save.json
    starforge runtime-workspace application-start-review --workspace /private/runtime-console --application-id APPLICATION_ID
    starforge runtime-workspace application-start --workspace /private/runtime-console --request /private/start.json
    starforge runtime-workspace application-stop --workspace /private/runtime-console --application-id APPLICATION_ID --operation-id RUN_UUID
    starforge runtime-workspace application-recover --workspace /private/runtime-console --application-id APPLICATION_ID --operation-id RUN_UUID
    starforge runtime-workspace application-output --workspace /private/runtime-console --application-id APPLICATION_ID --operation-id RUN_UUID

Configuration review takes runtimeId, kind, label and settings. For example, openapi settings contains outputParent and port. Editing also takes applicationId and expectedRevision from the saved application.

Save takes requestId, reviewId and applicationId (null for a new application). Start takes applicationId, its start reviewId and a new requestId. Keep each request JSON file. If its response is lost, resend the same UUID and body; a changed body cannot reuse that UUID.

CLI state/output are private operator data and can include original capability URLs. Keep them with the private workspace.

## Original integration seams

| Method | API | Purpose |
| --- | --- | --- |
| GET | /api/applications/state | Saved bindings, runs and current private URL |
| POST | /api/applications/review | New configuration or current revision review |
| POST | /api/applications/save | Save configuration and join original managed adoption |
| POST | /api/applications/connect | Continue the same pending adoption |
| POST | /api/applications/start-review | Review current files and selected release |
| POST | /api/applications/start | Retain and launch the original command |
| POST | /api/applications/stop | Stop or cancel that operation |
| POST | /api/applications/recover | Reopen/reconcile that operation |
| GET | /api/applications/output | Retained original command output |
| GET | /api/applications/terminal | Original PTY output, identities and input receipts |
| POST | /api/applications/input | Explicit idempotent terminal input |

These routes use the existing loopback, Host, Origin and capability checks. Output is rendered as text. No original application capability is placed in a public asset.

applications.mjs composes original runtime inspection, managed adoption/release selection and managed-run. application-command.mjs supplies the optional environment, original URL capture and terminal input. application-terminal.py is only a PTY for that managed child. public/applications.mjs adds the presentation.

Optional managed-run fields are applicationId, terminal, terminalPython, environmentFile and environmentSha256. Existing ordinary commands preserve their original behavior. Keep these additive files and this guide inside the maintained distribution's existing runtime-workspace subtree; there is no separate package producer.

### GoldRush and selected Python environments

Choose GoldRush wallet research after initializing the original `goldrush workbench`. Applications pins `workbench.json`, its original release, buyer state, inbox, workspace or profile, and any selected observation manifest. It accepts only the original `GOLDRUSH_WORKBENCH_READY` announcement for that same state directory. The existing buyer owns acquisition and terminal approval.

The Object Buyer analysis Python path remains the selected executable, including a virtual environment's `bin/python` symlink. Review records the link, resolved executable and any `pyvenv.cfg`; it does not substitute the base interpreter and discard that environment.

The terminal records both the child PID used by its parent and the procfs PID when `/proc` was mounted in an ancestor namespace. The retained, unreaped `pty.fork` child and its original process group govern shutdown; loss of a procfs observation does not leave exception cleanup waiting indefinitely after a single TERM.

## Research dossiers and saved source collections

Choose **Research dossiers**, then select the private dossier directory. An existing store reopens its questions, editions, original source occurrences, selections, findings and revision history. A new directory can be created in an existing private parent. The original application creates and operates its own store.

To read an existing OpenAlex collection, select its original research workspace directory. Applications retains that directory and its original queries and editions directories as launch inputs. The selected runtime supplies its original OpenAlex workspace module; an explicit original module can be selected when continuing a separately retained provider installation. Source gathering is an operation in that original provider workspace. Opening a dossier does not gather or purchase data.

The optional provider edition adapter is the original local module passed as --edition-adapter. It can reopen Valyu editions through the original retained provider store, preserving that store's access and retention behavior. Applications records the module file identity and passes the same path to research-workspace.

The original command announces one JSON line with mode RESEARCH_DOSSIER_WORKSPACE, its selected directory and its actual loopback capability URL. The observer accepts it only for the research-workspace command and matching --dir argument, then applies the existing local URL checks. The source command owns HTTP shutdown and closure of its original provider workspace; saved dossiers remain available for the next reviewed start.

Inside the original research application, create or reopen a question, receive saved source editions, compare provider occurrences, select evidence, write findings, compare revisions and download HTML, Markdown or complete portable JSON. Reopen the same portable dossier through its original API or CLI to retain all revision and source identities.
