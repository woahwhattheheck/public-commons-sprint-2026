# SSH deployment for Redis applications

Run the existing Redis application through owned SSH forwards when the database
provider exposes SSH access on each database node. The deployment inventory
records all data and Sentinel nodes, their announced addresses, their SSH
identities and their stable local ports. It compiles into the same source profile
used by the merchant, saved workspace, generated customer client and release
manager.

The application runs on its normal customer application host. Each SSH session
ends on the corresponding database host and forwards to that host's loopback
database listener. The application-side listeners are all on 127.0.0.1. The
existing database username, password environment reference, native query
permissions and selected database continue to apply.

## Select the access path

Use the original verify-full TLS connection when the selected deployment exposes
a verified TLS database endpoint. Use this SSH deployment when the selected
provider access is per-node SSH with a database listener reachable on that SSH
host's loopback interface.

| Input | What to obtain from the existing deployment |
| --- | --- |
| Data topology | Standalone, Cluster, or the Sentinel primary group name |
| Nodes | Every primary, replica and Sentinel that the native client can discover |
| Announced addresses | Actual host and port strings returned by Cluster or Sentinel, including relevant aliases |
| SSH access | Exact node hostname, port, provider-issued login, and selected key or agent |
| Server identity | Existing trusted SSH known-host records for those exact hosts and ports |
| Database listener | The Redis port reachable on loopback of each selected SSH host |
| Read identity | Existing data credentials and, for Sentinel, separate monitor credentials |
| Local ports | One stable unused 127.0.0.1 port per declared node |
| Customer contract | Original source queries, routes, payment terms and expected results |

A single SSH connection to a bastion does not describe the final database hop.
The inventory requires that the remote database endpoint is loopback on the
selected SSH host. Add all nodes before receiving a Cluster or Sentinel
application; discovery and promotion need the same connection path as the seeds.

The provider continues to operate Redis, replication, Sentinel and the host.
This application deployment uses the existing SSH and database interfaces.

## Prepare the inventory

Start from one complete example in this directory:

- example-standalone.json
- example-cluster.json
- example-sentinel.json

Replace every example hostname, SSH login and primary group name with the actual
selected deployment. Each node contains its exact aliases, localPort,
remotePort, role and SSH environment references. Cluster seeds select data
nodes. Sentinel seeds select monitor nodes. A standalone inventory has one data
node.

An SSH identity can be a private-key file or a public identity whose private key
is already held by the selected agent. Set identityFileEnv for the identity file
and agentSocketEnv when an explicit agent is used. An agent-only selection may
omit identityFileEnv. Authentication is noninteractive public-key authentication.

The environment contains paths and database secrets:

~~~sh
export REDIS_SSH_IDENTITY_FILE=/private/keys/customer-redis
export REDIS_SSH_KNOWN_HOSTS_FILE=/private/keys/customer-redis-known-hosts
export REDIS_READ_PASSWORD=YOUR_EXISTING_READ_PASSWORD
export REDIS_MONITOR_PASSWORD=YOUR_EXISTING_MONITOR_PASSWORD
~~~

Use the customer's existing secret loader in service operation. The saved JSON
contains environment variable names. Obtain host keys from the provider's
existing trusted record and place those records in the selected known-hosts
file. OpenSSH verifies the selected hostname and port using that file.

Review the compiled profile:

~~~sh
starforge redis-ssh profile --deployment /private/customer/deployment.json
~~~

The result includes the deployment SHA256, original Redis connection profile,
required environment names, node counts and all local address mappings. The
SHA256 identifies the complete semantic inventory, so formatting or key order
changes retain the same identity.

## Join the original customer commissioning input

Start with the complete original commissioning input, including the customer's
actual query declarations, routes and expectations. Prepare its SSH connection:

~~~sh
starforge redis-ssh prepare \
  --deployment /private/customer/deployment.json \
  --input /private/customer/commissioning-original.json \
  --output /private/customer/commissioning-ssh.json
~~~

Prepare replaces the connection with the compiled loopback profile and records
which direct-TLS certificate bindings were replaced. It preserves the original
operation IDs, selected products, customer terms, checks and release input, then
runs the existing commissioning validator. The output uses the unchanged
commissioning schema. Repeating preparation accepts an existing output only when
its complete bytes match.

The original connection mode is local-plaintext because the application talks to
local SSH listeners. Remote traffic travels inside the authenticated SSH
sessions. Existing native nodeAddressMap handles the actual announced data and
monitor addresses. The compiled profile selects nodeAddressPolicy mapped-only:
every announced address and local forwarded endpoint must be retained in that
map. Unknown addresses, including unknown loopback addresses, are rejected before
Redis connects. An added or renamed provider node requires a revised inventory.

## Receive and operate

Copy the actual deployment SHA256 from profile or prepare into REVIEWED_SHA256.
Run the original commissioning operation as the owned application:

~~~sh
starforge redis-ssh run \
  --deployment /private/customer/deployment.json \
  --sha256 REVIEWED_SHA256 \
  --runtime-dir /run/user/1000 \
  -- starforge redis-commission receive \
  --input /private/customer/commissioning-ssh.json \
  --workspace /private/customer/redis-workspace
~~~

The user runtime directory must be writable by the application operator. The
default is the host's temporary directory. Control sockets use a new private
directory with short paths; a long runtime path is rejected before opening its
forward. OpenSSH is an installed host dependency.

Run the existing saved authoring workspace, prepared merchant or release
operation in the same way:

~~~sh
starforge redis-ssh run \
  --deployment /private/customer/deployment.json \
  --sha256 REVIEWED_SHA256 \
  -- starforge redis workspace open \
  --directory /private/customer/redis-workspace
~~~

The exact inner command belongs to the existing workspace or release guide.
With a retained installation, use its normal runtime-install run command for
both the outer redis-ssh entrypoint and the inner application command. Keep the
same local forwarded ports in the inventory when reopening an existing source.

For source checkouts, replace starforge redis-ssh with:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/redis/deployment/ssh.mjs
~~~

The application starts after every selected SSH session has authenticated and
its control channel confirms readiness. The original Redis commissioning or
preflight then verifies the database protocol, credentials, topology and actual
read products through those forwards. OpenSSH's ExitOnForwardFailure covers
local forwarding setup; the original Redis operation evaluates the ultimate
database connection.

## Process lifetime and recovery

The deployment owns its SSH processes and the complete application process
group. A lost SSH process aborts the deployment, closes the application and its
descendants, and closes the remaining SSH sessions. A stopped application closes
all of its forwards. SIGINT and SIGTERM use the same cleanup. An unresponsive
owned process receives SIGKILL after the selected close deadline.

Startup has one reviewed overall deadline, with up to four SSH authentications
in progress. SSH connection timeout and authenticated keepalives detect an
unresponsive server. The profile permits explicit deadlines and keepalive
settings for the selected network.

The selected public known-host bytes are copied into the private runtime
directory before SSH starts. Each status entry retains the digest of the exact
host-key bytes used. Key-file and agent paths are resolved from the selected
environment, while the runtime directory contains the public trust records and
control sockets.

Run returns COMPLETE only when the original application exits successfully and
cleanup completes. TUNNEL_FAILED, APPLICATION_FAILED and CLEANUP_FAILED return
a nonzero CLI exit. The result retains the underlying application outcome and
node status. A process supervisor can restart this one original command after a
failed run. Keep the same source, workspace and operation identities; use their
existing recovery controls.

A systemd deployment should run the single outer command under the intended
application account with Restart=on-failure and KillMode=control-group. Set its
working directory, existing environment/secret file and shutdown timeout in the
normal service configuration. The SSH manager owns application descendants, and
the service manager retains final process-group custody.

For a node replacement, update the actual trusted host record and node inventory,
review the new deployment SHA256, and prepare the connection into the original
customer workflow. Keep the prior inventory with its source/release edition so
the operator can choose the matching retained deployment during recovery.

## Native product receiving

The existing native Redis merchant journey accepts this optional access mode:

~~~sh
SF30_REDIS_JOURNEY_ACCESS=ssh \
SF30_REDIS_JOURNEY_TOPOLOGY=cluster \
SF30_REDIS_JOURNEY_COLLECTIONS=1 \
SF30_REDIS_JOURNEY_WORKSPACE=1 \
SF30_REDIS_JOURNEY_OUTPUT=/private/receiving/ssh-cluster.json \
node stellar/scf-starforge-20261009/sf30-seller-sdk/redis/native-journey.mjs
~~~

Use topology=sentinel for the primary/replica and three-monitor deployment.
The SSH fixture uses the original native Redis topology, read-only identities,
slot migration or primary promotion, saved workspace, generated buyer response
files and retained release changes. It adds a real local OpenSSH daemon,
generated temporary client/server keys, pinned server identity and all-node
forwarding. Its final application operation reads through the actual Redis
source, loses the SSH server and confirms that the application, its descendant
and all owned forwards close.

The receiving host needs Node, the selected @redis/client runtime, Redis 7+,
OpenSSH client, ssh-keygen and an installed sshd. The local sshd must be able to
authenticate the existing receiving user with its temporary selected key.
SF30_SSH_JOURNEY_USER selects that existing account. No user account is created.
SF30_SSH_JOURNEY_SSHD, SF30_SSH_JOURNEY_SSH and SF30_SSH_JOURNEY_KEYGEN can select
installed executable paths. SF30_SSH_JOURNEY_RUNTIME_DIRECTORY selects a short
writable directory for the fixture's control sockets.

The SSH mode forwards to the native database's loopback TCP listener. The
existing independent-CA TLS journey remains selected by its original TLS mode.
Receive the exact source and retain the final native JSON result alongside the
customer package.

## Primary interfaces

- OpenSSH client: https://man.openbsd.org/ssh
- OpenSSH configuration: https://man.openbsd.org/ssh_config
- Original Redis profiles: ../connection-profile.mjs
- Original source and ACL guide: ../README.md
- Original commissioning workflow: ../workspace/COMMISSIONING.md
- Original customer exporter: ../workspace/CUSTOMER_EXPORT.md
