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
| Commerce session | commerce-console start | An initialized SF66 session, original buyer/delivery/recovery and terminal approval |
| XML dataset onboarding | dataset xml … serve | An initialized XML workspace, source intake, mapping, native query, comparison and portable editions |

A selected runtime must actually contain the command. XML additionally requires its original XML forwarding source, because older runtimes contain dataset without that subcommand. The chosen original profile supplies the dependencies required by the application. Applications installs no replacement engine or new npm dependency.

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

Pending input bytes are private and removed after dispatch. Retained receipts contain identity, size/hash and delivery state. The original terminal may echo the input into its private output, as a normal terminal does.

The PTY records actual bridge and original child identities. Both retain the existing worker lease. Stop sends the original process group a normal termination signal and lets the original application drain accepted work. There is no forced-kill timeout or automatic approval.

The default Python is /usr/bin/python3; another reviewed absolute executable may be selected. The adapter uses the standard library and installs no terminal package or supervisor.

## Stop and recover

**Stop application** addresses the original run ID. A queued launch is recorded STOPPED before execution; a live launch uses the original managed stop file and runner. Commerce may remain STOPPING while its accepted work drains.

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
