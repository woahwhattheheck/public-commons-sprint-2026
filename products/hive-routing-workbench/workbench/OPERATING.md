# Operating a complete Hive application

## Original edition intake

Create an edition directory containing the complete selected application files and edition.json:

~~~json
{
  "schema": "hive-desk-edition/v1",
  "name": "Original customer application",
  "config_file": "router.config.json",
  "supergraph_file": "supergraph.graphql",
  "operations_file": "operations.json"
}
~~~

With no explicit files list, the importer retains every ordinary file beneath the directory. An explicit files list can identify the complete selected set. Paths remain relative to the edition. The original manifest, native configuration, supergraph and client programme must all be present.

The application stores the complete original bytes. A changed edition retains its original parent and supporting files while replacing the selected complete file. The browser opens a saved file for editing. Use Add file to changed edition for each related configuration, schema or supporting-file change, then save all staged files as one complete separate edition.

The native configuration selects an explicit loopback listener. For a file-based supergraph, the selected original JSON configuration has this shape:

~~~json
{
  "http": {
    "host": "127.0.0.1",
    "port": 4000,
    "graphql_endpoint": "/graphql"
  },
  "supergraph": {
    "source": "file",
    "path": "supergraph.graphql"
  }
}
~~~

The original Hive implementation reads the configuration and validates its own fields. Its file supergraph is loaded at startup unless the original polling option is configured. Stop/restart or prepare the reviewed changed edition to apply the corresponding file change deliberately.

Configure the actual application headers, JWT/JWKS provider, authorization, persisted operations, traffic behavior and telemetry using the original pinned Hive contract. Every configured top-level feature appears in the review with its complete value and upstream source link. Review each feature with a concrete reason.

## Private host values

Start the operator with the selected host's existing private environment. In Native deployments, list the existing environment variable names that the original router needs. The supervisor passes those selected names to the child and keeps their values outside the saved edition.

The saved configuration chooses ROUTER_CONFIG_FILE_PATH and the listener. Original from_env placeholders are resolved by Hive itself; select their existing environment-variable names for the native child. HOST, PORT, ROUTER_HTTP_HOST, ROUTER_HTTP_PORT and SUPERGRAPH_FILE_PATH cannot override that reviewed listener through the selected environment list.

A private operation header selects its existing environment variable by name:

~~~json
{
  "id": "customer-account",
  "method": "POST",
  "path": "/graphql",
  "body": {
    "query": "query CustomerAccount { me { id name } }",
    "operationName": "CustomerAccount"
  },
  "header_env": {
    "Authorization": "CUSTOMER_GRAPHQL_AUTHORIZATION"
  }
}
~~~

The operator's host environment supplies the actual header value when the request runs. The saved request records its selected environment name. Ordinary public request headers belong in headers. The HTTP client owns its connection and body-length headers.

## Complete client programmes

operations.json contains the complete agreed programme:

~~~json
{
  "schema": "hive-desk-operations/v1",
  "timeout_seconds": 120,
  "operations": [
    {
      "id": "current-user",
      "name": "Current user and cross-subgraph data",
      "method": "POST",
      "path": "/graphql",
      "body": {
        "query": "query CurrentUser { me { id name } }",
        "operationName": "CurrentUser"
      },
      "expectation": {
        "category": "application-data",
        "description": "Review the complete response from the selected original application."
      }
    }
  ]
}
~~~

Select the customer's actual query, variables, operationName, extensions, headers and expected outcome for each row. GraphQL HTTP GET is also supported. A POST body can retain an original GraphQL batch.

A run saves its selected operations, original edition, binary source pin and actual native process attempt. Each request gets a start record before dispatch. The result retains every HTTP response header, status, raw response body, original request selection and elapsed time. GraphQL data, errors and extensions remain together; an HTTP error response is still a received original response.

Open **Full response** to read the complete native body. **HTTP and request** exposes the complete retained record, and **Download body** downloads its exact bytes. Review every operation with an observed reason. An expected authorization or validation error can be accepted as the correct application outcome.

The comparison joins stable operation IDs across both complete programmes. It keeps added/removed operations, changed HTTP statuses, request changes, response-header changes and all JSON differences, including arrays, partial data, errors and extensions. Every comparison retains the complete underlying rows and original body identities.

## Native processes and restart

Prepare binds the original binary, complete edition, selected environment names and installation. Starting an already live deployment reopens its actual original process. A queued start whose launcher ended continues that same queued attempt.

The original child inherits the deployment's operating-system lease. If its supervisor disappears between process launch and the saved PID, reconciliation identifies the child using that original lease, executable and edition directory. It can reconnect the saved deployment to the actual child.

Inspect shows the observed native and supervisor processes, their start identities, and the original /health and /readiness responses. Reconcile updates a stopped or interrupted original attempt. Stop targets the observed original child, sends SIGTERM and allows Hive's original graceful drain. Finished native logs become immutable workspace objects.

A new native attempt gets a new programme and review before cutover. An interrupted programme retains the started request. Inspect its actual original outcome before an explicit replay, particularly when a client operation changes application state. Opening a completed programme by its saved ID reuses that complete result.

## Cutover and rollback

Cutover requires the selected ready original router, a complete accepted configuration review and a complete accepted programme from its currently running native attempt. The saved decision binds the deployment, edition, programme, review, native attempt and endpoint.

The operator forwards HTTP GraphQL requests at /graphql to that selected native router. It preserves original response bodies and status, repeated response headers, native errors and streaming body chunks. WebSocket clients use the displayed original native listener directly. The operator route itself serves HTTP GET and POST.

A rollback selects a previously served deployment, starts its original router if needed, runs and reviews the full client programme for that new attempt, then saves the rollback decision. The endpoint history retains the earlier cutover and rollback decisions.

## Command line

All browser changes have equivalent commands. Pass exact structured command data with --data-file:

~~~bash
python3 -m hive_desk action /work/hive/customer-workspace edition.import --data-file import.json
python3 -m hive_desk action /work/hive/customer-workspace native.prepare --data-file deployment.json
python3 -m hive_desk action /work/hive/customer-workspace native.start --data-file selected-deployment.json
python3 -m hive_desk action /work/hive/customer-workspace programme.run --data-file programme.json
python3 -m hive_desk action /work/hive/customer-workspace workspace.verify
~~~

The controller source lists the complete data fields for configuration.review, programme.review, programme.compare, deployment.cutover, deployment.rollback and delivery actions. Structured errors identify the selected saved action and the field or original process that needs attention.
