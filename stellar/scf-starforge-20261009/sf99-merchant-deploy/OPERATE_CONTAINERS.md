# Operate the original merchant container

The SF99 container operator carries a saved merchant deployment through image
loading, startup, native readiness, diagnosis, graceful shutdown and reopening.
It uses the existing single-container generator and original foreground
supervisor. Every command names the same merchant project explicitly; it cannot
accidentally inherit a different COMPOSE_PROJECT_NAME from the calling shell.

Use the existing generated container bundle and its nested host directory:

~~~sh
node stellar/scf-starforge-20261009/sf99-merchant-deploy/cli.mjs container status \
  --bundle /private/deployments/data-merchant-001
~~~

The installed source package uses the same entry point:

~~~sh
npx --no-install starforge merchant-host container status \
  --bundle /private/deployments/data-merchant-001
~~~

All operations also accept --docker /absolute/path/to/docker when the existing
host installation is outside PATH. The operation module exports
inspectContainerOperation(bundle) and
runContainerOperation(bundle, operation, options) for an existing operator UI
or another maintained CLI. The options select only the existing Docker executable,
startup wait, log tail and public smoke mode. The original maintenance adapter
continues to own backup, migration, resume and rollback.

## Load the selected image and start

For a registry image pinned by digest, explicitly load that exact image:

~~~sh
node stellar/scf-starforge-20261009/sf99-merchant-deploy/cli.mjs container pull \
  --bundle /private/deployments/data-merchant-001
~~~

The response includes Docker's actual inspected image ID. A local sha256:...
image ID has no registry address; load it through the existing image preparation
workflow instead. Pull does not start the merchant. Keep the image, source,
dependency closure, original host configuration and private state selected by the
existing generated bundle. Follow that bundle's runbook for permissions and the
declared UID/GID before starting.

~~~sh
node stellar/scf-starforge-20261009/sf99-merchant-deploy/cli.mjs container up \
  --bundle /private/deployments/data-merchant-001
~~~

Up performs the original complete container/source/mount check, starts the one
selected merchant service with no build or implicit pull, waits for Docker's
health result, and reads the original supervisor from inside that same running
container. Success requires exactly one running selected service and native
merchant readiness in its full service mode. The default wait is the saved startup
timeout plus 30 seconds; --wait-seconds can extend it up to 900 seconds. It cannot
shorten the original startup allowance. A start error leaves the original
component outcomes available to status and logs for diagnosis.

The original supervisor starts and drains the seller, delivery, receiver and
discovery components in their maintained order. It retains original PID/hostname
identity, source generation, private environment parsing and native writer leases.
Do not start a second systemd or container group against the same state.

## Inspect the actual outcome

~~~sh
node stellar/scf-starforge-20261009/sf99-merchant-deploy/cli.mjs container status \
  --bundle /private/deployments/data-merchant-001
node stellar/scf-starforge-20261009/sf99-merchant-deploy/cli.mjs container logs \
  --bundle /private/deployments/data-merchant-001 --tail 100
node stellar/scf-starforge-20261009/sf99-merchant-deploy/cli.mjs container smoke \
  --bundle /private/deployments/data-merchant-001
~~~

Status combines Docker's selected service state with the original supervisor's
runtime ID, readiness and child outcomes. Native status runs with compose exec
inside the live container. A fresh compose run process would use a different
PID namespace and cannot establish the current merchant writer's identity.
Status also returns the last original private runtime record so an exited
container retains useful startup and drain information. That retained record is
distinct from a fresh in-container observation.

Logs use the original service's rotated Docker logs. --tail selects 1–10,000
lines. The command returns logs only for this merchant's selected service. Original
runtime logs can contain private operator information; use the existing private
host access path when reading them.

Smoke executes the original SF99 smoke command inside the same container and
returns its complete named checks, including a structured unsuccessful result.
The outcome also requires the original live supervisor to be ready in full service
mode; an HTTP response alone cannot hide a stopped delivery process.
After the existing Caddy fragment and TLS origin are active, add --public to
inspect the original public routing and private-path confinement. Actual customer
purchases continue through the original buyer, signing and accounting workflow.

## Drain and reopen

Pause this merchant's ingress through the existing Caddy procedure, then drain
the original group:

~~~sh
node stellar/scf-starforge-20261009/sf99-merchant-deploy/cli.mjs container stop \
  --bundle /private/deployments/data-merchant-001
~~~

Stop uses the saved project and service identities. It remains available when a
live input, source entrypoint or state path has changed, because stopping the
running merchant must remain possible after a configuration error. The saved
container/host manifests and generated Compose/runbook artifacts still have to
match their retained identity. Status, logs and image pull use that same saved
selection. Startup and smoke continue to require the original complete current
source/configuration/mount checks.

The stop response includes the previous runtime ID, Docker's final service state,
and the original retained child/drain outcome. Compose uses the original summed
stop allowance. The command requires Docker to report zero running instances of
the selected merchant before returning success. It preserves every bind-mounted
queue, journal, order database, retained source selection and delivery checkpoint.

Run up against the same bundle to reopen that state. For an upgrade, use the
existing source/image lifecycle and generate the next bundle, stop this group,
start the replacement under the same merchant project name, and inspect native
readiness before returning ingress. Code rollback selects retained compatible
source/image bytes and preserves current payment state.

For encrypted backup, migration and interrupted-operation recovery, continue the
original container maintenance workflow. It already owns Caddy maintenance,
the native writer shutdown, original SF101 snapshot/restore, restored-host
selection and the following generation. These operator commands add routine
operation of that same deployment without introducing a second maintenance
journal or source package.
