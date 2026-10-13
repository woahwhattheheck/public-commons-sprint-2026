# Flowable process, case and decision operations

Deploy original BPMN, CMMN and DMN resources, operate cases and human tasks,
migrate running processes, evaluate native decisions and deliver the complete
operating workspace to another operator.

The installed application opens one durable Flowable workspace. Its browser,
typed client, command line and merchant MCP connection use the same engine
connections, captured portfolio, reviewed requests and receiving history.
Every native operation retains its original request, response and current or
historic engine readback.

The command is `starforge flowable-product`. The selected package also provides
`flowable-merchant`. In the Runtime workspace, choose
**Applications → Flowable process, case and decision operations**.

## Open the application

Use the [selected installation guide](../../stellar/scf-starforge-20261009/distribution/selections/FLOWABLE_MERCHANT.md)
to build and receive the complete source and runtime. The operator requires
Node 24 and Linux flock. Connect it to the original Flowable REST service;
the supplied native receiving host uses Flowable 8.0.0 and Java 17 or later.

~~~sh
umask 077
mkdir -p /srv/private
chmod 700 /srv/private

starforge flowable-product init --dir /srv/private/process-operations \
  --name "Process operations"
starforge flowable-product review --dir /srv/private/process-operations
starforge flowable-product open --dir /srv/private/process-operations --port 0
~~~

Open the returned private browser URL. Add the complete REST service base URL
and the names of its username and password environment variables. A standard
standalone REST address is `http://127.0.0.1:8080/flowable-rest/service`;
use the actual endpoint of your selected engine. The saved connection keeps
credential variable names, while the original host supplies their values.

Use `init --workspace /srv/private/original-flowable-workspace` to continue an
existing workspace. Private `--connections` declarations seed missing aliases.
Saved engine revisions remain authoritative on later Open operations.

## Complete the process operation

1. Capture native definitions, deployments, active work and history. Open a
   process definition to inspect or download its original resource.
2. Prepare a release from the complete BPMN or native deployment archive.
   Review the exact request and engine preimage, then deploy that saved request.
3. Prepare and start a selected definition. Operate its human task through
   reviewed claim, delegation, resolution or completion requests.
4. Prepare a process migration using the original Flowable migration document.
   Read native validation before dispatch and inspect the resulting definition,
   active work and history.
5. Export the complete workspace, download its full NDJSON handover, then
   inspect, adopt and reopen it on the receiving host.

The [operating guide](OPERATING.md) explains saved requests, native validation,
engine identities and interrupted-response recovery. The [receiving guide](RECEIVING.md)
covers full source/history export, exact file transfer and cold adoption.

## Use the same records through the SDK and CLI

~~~sh
starforge flowable-product actions
starforge flowable-product status --dir /srv/private/process-operations
starforge flowable-product records --dir /srv/private/process-operations \
  --kind process --offset 0 --limit 50
~~~

The public `./products/flowable-merchant/client` export includes
[complete TypeScript declarations](client.d.mts). `FlowableProductClient`
reopens the retained private connection after an application restart and
streams full native source and handover files.

Stop drains the original workspace before releasing its writer. Open the same
private directory to continue its UUID, saved revisions, original requests and
completed receiving records.

## Native decision operations

The same installed workspace includes original DMN deployment, native decision and decision-service evaluation, captured execution audits and full source/history receiving. Save the original DMN REST endpoint as a separate named connection. Use the **Decisions** page, `capture-decisions`, `decision-portfolio`, `decision-definition` and `decision-execution` commands, the typed client, or the eight native decision MCP actions.

See [Decision deployment, evaluation and operating history](DECISIONS.md) for the complete operator workflow, typed numeric input and native result semantics.

## Adaptive case operations

The same installed workspace includes original CMMN deployment, versioned
case starts and updates, criteria evaluation, case termination, stage and plan
item actions, case human tasks, variables, milestones and complete native
history. Save the actual CMMN REST endpoint as a named connection and open
**Cases**.

Use `capture-cases`, `case-portfolio`, `case-definition` and
`case-instance` from the installed command line. The four saved operation
kinds are `caseRelease`, `caseInstance`, `casePlanItem` and `caseTask`.
The typed client and twelve case MCP actions use these same native reviews
and original-request recovery.

See [Adaptive case operations](CASES.md) for the complete case programme,
all eleven native collections, the pinned engine's plan item semantics and
customer receiving.
