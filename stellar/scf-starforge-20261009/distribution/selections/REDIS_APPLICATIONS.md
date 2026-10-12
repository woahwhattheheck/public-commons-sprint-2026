# Redis and Valkey applications

This Starforge product carries the complete Redis/Valkey application workflow:
connection setup, six kinds of read product, source commissioning, generated
customer clients, full paid-response export, and application comparison during a
Redis-to-Valkey cutover. The installed Applications catalog contains Redis, Buyer
and the merchant console. Each opens its existing saved workspace.

## Install the selected product

Build from the desired committed source with the maintained distribution builder:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs --repo /absolute/checkout --ref ORIGINAL_COMMIT --selection redis-applications --out /absolute/redis-release
node stellar/scf-starforge-20261009/distribution/build.mjs --repo /absolute/checkout --out /absolute/redis-release --resume
~~~

The first command selects this committed recipe and its original contributions.
Resume retains the same source, selection and output. Receive the actual archive
path and SHA-256 returned by the builder through the existing installer:

~~~sh
starforge runtime-install prepare --dir /srv/starforge/redis-runtime --archive /deliveries/redis-applications.tgz --sha256 ACTUAL_ARCHIVE_SHA256 --native --feature redis --feature schema --feature openapi --feature mcp --operator
starforge runtime-install install --dir /srv/starforge/redis-runtime
starforge runtime-install inspect --dir /srv/starforge/redis-runtime --load --source
~~~

Use the actual archive filename and digest from the build receipt. The runtime
selects pinned dependencies from that source, including the Redis client, schema,
OpenAPI, MCP and native Stellar payment implementations. The operator selection
carries the original Python dependencies. Existing cache, offline install,
matching Node headers and verified dependency adoption remain available through
the maintained installer.

Attach the resulting READY installation in Runtime workspace, open Applications,
and select Redis. Keep the customer source workspaces, received files, buyer
configuration and release directories in their existing private locations outside
the installed source. Installation and source selection preserve those locations
through the original setup and managed application inputs.

## Connect and operate the real deployment

Redis Applications supports a standalone Redis or Valkey source, Cluster,
Sentinel, and Upstash REST. Review the actual endpoint, node addresses, namespace,
read identity, environment variable names and connection limits in the original
connection setup. Cluster address mappings retain the addresses advertised by
the selected deployment. Sentinel retains distinct monitor and data credentials
and TLS authorities. Upstash uses its existing HTTPS endpoint and token
environment reference.

Save the reviewed application, Start its original managed process, and Open its
retained operator address. The same application supports Stop, reopened history
and recovery of a saved start. The original product/source editor exposes:

| Read product | Customer data | Full continuation |
| --- | --- | --- |
| Value | One configured key | One result |
| Hash fields | The configured field projection | One result |
| Sorted set | Ranked members and scores | Exact returned nextInput |
| Stream | Entries and their original IDs | Exact returned nextInput |
| List | Indexed entries | Exact returned nextInput |
| Set | Native membership scan | Original SSCAN cursor through cursor zero |

Values retain exact textual numbers and the source's original binary encoding.
Use the original response files when data exceeds an inline preview.

The complete connection and managed-application instructions travel in
`source/stellar/scf-starforge-20261009/sf30-seller-sdk/redis/workspace/SETUP.md`
and
`source/stellar/scf-starforge-20261009/distribution/runtime-workspace/REDIS_APPLICATIONS.md`.

## Deploy the application through provider SSH access

The same installed product includes `redis-ssh` for a provider that gives SSH
access to the database host's loopback interface. Declare the complete
standalone, Cluster or Sentinel inventory, including every data node, monitor,
announced address and stable local forwarded port. The application remains on
the customer's application host; its Redis connection uses the owned local
forwards.

~~~sh
starforge redis-ssh profile --deployment /srv/customer/ssh-deployment.json
starforge redis-ssh prepare --deployment /srv/customer/ssh-deployment.json --input /srv/customer/commissioning-input.json --output /srv/customer/commissioning-via-ssh.json
starforge redis-ssh run --deployment /srv/customer/ssh-deployment.json --sha256 REVIEWED_DEPLOYMENT_SHA256 -- starforge redis-commission receive --input /srv/customer/commissioning-via-ssh.json --workspace /srv/customer/commission
~~~

Use the digest returned by the profile review and the original commissioning
operation's arguments. The compiler preserves its product IDs, routes, expected
results, payment terms and release selection. OpenSSH reads the exact pinned
known-host file bytes and the selected identity-file or agent-socket reference.
The original Redis authentication still applies independently.

Cluster redirection and Sentinel promotion use the retained address map through
the same forwards. An unknown discovered address requires a revised inventory.
If any owned SSH process ends, the deployment manager stops the application and
its descendants, closes the remaining forwards and returns a terminal result to
the existing host supervisor. A new start reopens the selected saved workspace.

The complete inventory templates and operating guide travel with the installed
source at
`source/stellar/scf-starforge-20261009/sf30-seller-sdk/redis/deployment/SSH_DEPLOYMENT.md`.
That guide also explains using the same outer command for the retained Runtime
workspace, customer export and release console, and receiving both real Redis
Cluster and Sentinel through OpenSSH.

## Commission the whole application

Open Commissioning in the same Redis operator workspace. It reviews a complete
contract against the selected source revision, runs the original saved preview
requests, retains all returned pages and customer expectations, and prepares a
complete customer handover. The command and browser use the same operation
history and workspace.

The separate full-input command creates and receives a customer workspace:

~~~sh
starforge redis-commission template > /private/customer-commissioning.json
starforge redis-commission review --input /private/customer-commissioning.json
starforge redis-commission receive --input /private/customer-commissioning.json --workspace /private/customer-redis
~~~

Replace the example connection, product terms, queries and expected results with
the actual selected customer contract before receiving. Collection checks that
require full data use allPages. Empty nonterminal scan pages remain part of the
same collection; an original source limit retains the returned page and its
reason. Complete collection receiving precedes package preparation and staging.

The `redis-commissioning` command operates commissioning in an existing
workspace. Its complete command contract and browser handover are in
`sf30-seller-sdk/redis/workspace/COMMISSIONING_OPERATOR.md`; the full-input
command is documented in the adjacent `COMMISSIONING.md`.

Keep the generated client files together with their original export manifest.
The prepared package, selected release and original operation IDs bind the
customer application to the reviewed source and terms.

## Receive complete customer response files

The installed `redis-customer-export` command uses the original generated
client and the customer's existing buyer, approval and signing context. Select
the actual operation IDs, source query names, initial inputs, payment ceilings
and full-response size limit in the export plan. The supplied plan covers all
six read kinds and is editable for 1–64 selected operations.

The SDK root is the installed `source/stellar/scf-starforge-20261009`
directory, containing both `sf30-seller-sdk` and `sf31-buyer-client`.
Use that actual path in the following commands:

~~~sh
starforge redis-customer-export review --sdk-root /srv/starforge/redis-runtime/package/source/stellar/scf-starforge-20261009 --client /private/customer-client --plan /private/customer-export-plan.json --out /private/exports/export-001
starforge redis-customer-export run --sdk-root /srv/starforge/redis-runtime/package/source/stellar/scf-starforge-20261009 --client /private/customer-client --plan /private/customer-export-plan.json --out /private/exports/export-001 --buyer-context /private/existing-buyer-context.mjs
starforge redis-customer-export status --out /private/exports/export-001
~~~

The runtime inspection supplies the actual installed sourceRoot if its directory
layout differs. The existing buyer-context module exports createBuyerContext and
returns the customer's buyer, approval, official scheme signer and optional
cancellation/cleanup. Its complete interface and example plan are in
`sf30-seller-sdk/redis/workspace/CUSTOMER_EXPORT.md`.

Each call reserves its output before delegating, then saves the complete returned
HTTP body before interpreting it. The manifest retains source/client identity,
original inputs, call/payment ceilings, returned requirements, receipt,
correlation IDs and full-file hashes. Paginated products advance in rounds using
their exact native nextInput. Set responses preserve empty pages, repeated
visits, original ordering and textual cursors.

Status reopens the retained plan and every response file. An existing output
directory belongs to that original business export; the buyer's existing journal
handles payment or intent reconciliation. Keep the original files and remaining
inputs when a call budget, source limit or returned buyer outcome needs review.

## Compare Redis and Valkey application behavior

The `redis-cutover` command receives the same application contract on the
original Redis deployment and selected Valkey deployment:

~~~sh
starforge redis-cutover template > /private/customer-cutover.json
starforge redis-cutover review --input /private/customer-cutover.json
starforge redis-cutover receive --input /private/customer-cutover.json --directory /private/customer-cutover
starforge redis-cutover compare --input /private/customer-cutover.json --directory /private/customer-cutover
~~~

Record the actual immutable data edition or agreed paused-write window, including
its responsible operator. Use distinct source workspace and receiving request
IDs for the two deployments. Keep queries, customer checks, routes and payment
terms identical across them.

Lists, rankings and streams compare ordered rows. Set comparison checks
membership while retaining each original page and duplicate scan visit. Full
saved previews are bound to the original query, revision, exact input,
continuation and result hash. A truncated prefix cannot complete a collection
comparison. The command writes the complete row differences and reopens every
generated customer file before accepting a saved result.

An optional candidate release is staged after customer expectations and the
paired comparison pass. The datastore operator executes the agreed data move,
traffic selection and production rollout using the retained release and rollback
edition. The complete paired input and receiving guide are in
`sf30-seller-sdk/redis/workspace/CUTOVER.md`.

## Customer handover and recovery

Deliver the selected source archive and digest, READY runtime/profile/lock, full
customer workspace and source configuration, approved commissioning contract,
complete generated client, customer buyer configuration, saved response files,
and release/rollback selection. For a cutover, retain both original workspaces
and the complete comparison and difference files. Keep actual private credentials
in the customer's existing secret configuration; source files contain their
named environment references.

The included Buyer and merchant console use the original request, receipt and
complete-file workflows. Their saved Operations and MCP interfaces operate these
same application workspaces. The Redis package registers the existing
redis-workspaces and client-exports merchant providers alongside Buyer,
discovery, facilitators, publishers and receiving.

Use `starforge --help`, `starforge registrations --source redis` and
`starforge source` to inspect the installed product and its original source.
Named package exports expose the maintained Redis source, setup, workspace,
commissioning, customer export, cutover, Buyer and merchant APIs.

A source upgrade uses the existing installer into a new runtime directory and
retains the previous runtime for recovery. Reopen the same customer workspaces
and original operation identities against the deliberately selected runtime.

## Run the retained customer-export integration journey

The original source includes one complete `customer-export-journey.mjs` receiving
flow. Run it with the installed Node against a new private output directory:

~~~sh
node source/stellar/scf-starforge-20261009/sf30-seller-sdk/redis/workspace/customer-export-journey.mjs --out /private/redis-export-receiving-001
~~~

It exercises the actual generated client, original Buyer and full-response file
writer with in-process HTTP response fixtures. The six-product flow includes
renamed operation/query bindings, a custom set cursor, empty pages, duplicate
members, responses larger than 65,000 bytes, exact textual integers, full-file
reopening, call-budget completion and retention of a returned body whose metadata
needs review. The output contains the actual original manifests and response
files plus a single complete result with source hashes.

The source commissioning and managed application journeys use the selected
actual Redis/Valkey deployment separately. Their complete source is retained in
the same Redis component.
