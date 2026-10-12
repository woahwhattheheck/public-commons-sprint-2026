# Central host and operating handover

This is the host contribution to the existing ODK Central field-data workspace. It starts the released Central product, receives the original connection into the existing operator, retains the native database backup and persistent service volumes, and reopens the same service. The form, submission, media, cohort and report workflow remains in the original product's receiving driver.

The selection is Central **v2026.3.1**, upstream commit **7d6de621955c5bb6a68e098ca10c9cbb92285cdf**, with backend **de0d2a07fd7c9ff698cbc312e550dd40ff058340**. UPSTREAM.json lists the exact source objects used for the Compose, account and backup interfaces. The program checks both actual checkouts and the running /version.txt before returning a service handover.

## What is installed

The original Compose stack supplies Central's frontend and backend, PostgreSQL14, form conversion, Enketo, Redis and mail service. The original one-time PostgreSQL upgrade component is preserved. The helper adds a private runtime configuration and a port/TLS override beside the checkout; it leaves the original application source intact.

Use the already accepted Linux host for the existing receiving operation. The helper uses that host's installed Docker Engine and Docker Compose, git, OpenSSL and Python3.10 or later. Compose must be at least2.24.4 because the override explicitly replaces the native port and environment-file lists. It creates no cloud account, VM, subscription or hosted build workflow. Image builds use the original Dockerfiles, one at a time through COMPOSE_PARALLEL_LIMIT=1.

The original installation guide recommends a small persistent server and describes additional capacity for media-heavy workloads. The host must have enough actual disk for the original images, data and the selected backup. An image-inclusive backup can be much larger than the data. Use the returned Docker/runtime details and the actual snapshot byte counts to place it.

Sources: [installation](https://docs.getodk.org/central-install/), [native stack](https://github.com/getodk/central/tree/7d6de621955c5bb6a68e098ca10c9cbb92285cdf).

## Select the same receiving instance

Copy host.example.json to a private operator directory and set its real paths and administrator identity. Keep operation_id equal to the existing product operation and use a distinct compose_project. The checkout and private runtime must be separate directories; an already existing checkout must match both selected immutable commits.

The four network modes are:

| Mode | Connection and listener | Certificate source |
| --- | --- | --- |
| local | HTTPS localhost on the selected port, bound only to127.0.0.1 | OpenSSL creates one private CA and a localhost certificate; later starts reuse the original identity. |
| customssl | The selected HTTPS DNS hostname | The operator's existing fullchain and private key. |
| letsencrypt | The selected DNS hostname on ports80 and443 | Central's original certificate lifecycle. |
| upstream | The selected external HTTPS DNS hostname; Central's HTTP listener is loopback-only behind the existing proxy | The existing HTTPS proxy; an explicit private CA can be supplied. |

The local mode is for the original native receiving workspace on that host. A published customer service uses its actual selected DNS hostname and a validated HTTPS route. Upstream mode waits for that route to return the exact Central version; a listening private port alone does not produce a running-service handover.

For customssl, configure:

~~~json
{
  "mode": "customssl",
  "domain": "central.example.org",
  "url": "https://central.example.org/",
  "http_port": 80,
  "https_port": 443,
  "bind_address": "0.0.0.0",
  "tls": {
    "fullchain": "/private/operator-certs/fullchain.pem",
    "private_key": "/private/operator-certs/privkey.pem"
  }
}
~~~

For upstream, use mode upstream, bind_address127.0.0.1 and the selected internal http_port. Keep https_port equal to the public HTTPS port, usually443. Configure the existing reverse proxy for the exact domain. Preserve WebSocket, original request bodies and the original Central upload limit. The helper does not edit another service's proxy configuration.

Source: [Central advanced configuration](https://docs.getodk.org/central-install-advanced/).

## Prepare and start

Set the selected administrator-password and backup-passphrase references in the host's existing private environment. Values are not command arguments. The example reference names are ODK_CENTRAL_ADMIN_PASSWORD and ODK_CENTRAL_BACKUP_PASSPHRASE.

~~~sh
python3 central_host.py --config /private/central-host.json prepare
python3 central_host.py --config /private/central-host.json build
python3 central_host.py --config /private/central-host.json bootstrap
~~~

prepare verifies the installed runtime, acquires the selected original source if its directory is absent, prepares TLS where selected, and reads the original expanded Compose definition. It retains complete native command output privately. build acquires the original images and builds the released source. An already completed image selection is read back and reused.

bootstrap starts the original stack, waits for the exact released version and checks authenticated native API access. On a fresh instance it uses the original backend createUser task with the password supplied on standard input, then the original user-promote command. If the same account already exists, its actual access is checked before a further account action. It does not reset an existing user's password.

The helper's defaults retain the original bundled database and local attachment storage. This is the complete profile operated by its snapshot/restore commands. An existing external database or S3 attachment service requires its own original backup/restore integration; do not insert those settings into this profile and treat a local snapshot as complete.

The runtime directory has mode0700 and its files mode0600. It contains the original operation journal, configuration, native output and connection secret. The CA signing key remains outside the nginx certificate mount. Keep this directory on the accepted host's private persistent storage.

Source: [original administrative tasks](https://github.com/getodk/central-backend/blob/de0d2a07fd7c9ff698cbc312e550dd40ff058340/lib/task/account.js).

## Join the existing field-data operator

After authenticated startup, connection.json has the existing workspace's exact connect shape:

~~~json
{
  "id": "central-cb57-native",
  "name": "Original Central native receiving",
  "url": "https://localhost:8443/",
  "authEnv": "ODK_CENTRAL_AUTHORIZATION",
  "allowLoopback": false
}
~~~

The named variable contains the complete Authorization header. connection-secret.json holds that value privately for the same receiver. The value is not part of connection.json or handover.json.

For local TLS, start the existing Node receiving driver with NODE_EXTRA_CA_CERTS set to the returned tls/ca.pem and put the value from connection-secret.json into the selected authEnv in that child environment. Use the standard environment/secret facility already selected by the receiving owner. Certificate verification remains enabled. The existing openCentralWorkspace({directory}) and workspace.connect(connection) APIs consume this connection unchanged.

For example, a receiver can read its own private JSON and bind only the selected child environment before invoking the existing driver:

~~~js
const connection = JSON.parse(await readFile(connectionPath, 'utf8'));
const credentials = JSON.parse(await readFile(secretPath, 'utf8'));
const env = {
  ...process.env,
  [connection.authEnv]: credentials[connection.authEnv],
  NODE_EXTRA_CA_CERTS: selectedCaPath
};
// Invoke the original receiving driver with its unchanged input/operation.
~~~

The receiving owner continues the same project, original form generations, complete root/repeat pages, submission versions and expected/present media. Its original IDs, original XML and resulting product exports remain the authoritative customer workflow. A successful host bootstrap itself does not create or submit a form.

## Complete recovery snapshot

The ordinary Central direct backup contains the database. Preserving existing Enketo Web Form links also requires its Redis state and generated keys. The full host operation therefore combines the original database API with a stopped-service capture of every attached persistent Docker volume.

~~~sh
python3 central_host.py --config /private/central-host.json snapshot \
  --out /private/central-backups/original-receiving-01 \
  --include-images
~~~

The sequence is:

1. Read the actual authenticated Central version, user and project roster.
2. Stream POST /v1/backup to an exclusive partial file, using the selected private passphrase.
3. Verify the complete stream with the same original service image's OpenSSL and pg_restore --exit-on-error --file /dev/null, then retain the original .pgdump.enc.bin.
4. Record each original image and every persistent volume/mount binding.
5. Stop the selected Compose services, stream each volume through the original image's tar utility, and retain the exact bytes and hashes.
6. Retain the private runtime configuration and TLS material. If requested, save the exact native images by their immutable image IDs.
7. Restart only the services that were running and read the same original Central API again.

The four named data volumes are always included. Image-declared anonymous volumes, including any original certificate or upgrade storage attached to the selected containers, are also retained. Bind-mounted application source is identified by its exact original commits; private TLS bind files are copied into the snapshot. The full image export supplies the exact runtime images for a different existing receiver.

snapshot.json records all file byte counts/hashes, native images, service-to-volume bindings, original source, direct-backup response and source reopening. If a complete snapshot already exists, the same command verifies it and reopens the source rather than creating another snapshot. An incomplete snapshot directory is retained for diagnosis; a new capture uses a separately selected output directory after the original source is reconciled.

This package contains private credentials and service data. Keep the full snapshot on the authorized private backup destination. Public source publication and the ordinary host handover use only the source/config examples and returned operational metadata.

Source: [Central backup and restore contract](https://docs.getodk.org/central-backup/).

## Restore into a selected new instance

Create a second private configuration with a different compose_project and runtime directory. For a same-host rehearsal, choose unused local ports, such as8081/8444, and retain the existing original checkout if it is clean and exact. Use a distinct stable receiving operation for that restore. The same source database and project IDs are retained.

~~~sh
python3 central_host.py --config /private/central-restore.json restore \
  --snapshot /private/central-backups/original-receiving-01
~~~

The command admits only a previously unused target project and records that selection before creating containers. It verifies every original snapshot file, loads saved native images when included, and pins every target service to the retained image ID. It compares the original persistent mount roster with the newly created target's bindings, then restores each exact volume into that target.

A partial restore resumes the same original snapshot and unused target. The target is not started until every retained volume is complete. The source project is never a restore destination. The helper preserves the original authentication data, starts the target, verifies its exact running version and compares its original project population before publishing restore-result.json and the target connection.

The original field-data receiving driver then reopens its retained product archive and compares the original selected form/submission/media output against this restored endpoint. This supplies the complete source-to-product receiving closure; the host layer supplies the actual service and storage restoration.

Keep the source's network origin for a real replacement service when existing public links must continue working. A rehearsal on another origin preserves their underlying native state while using that receiver's own route and TLS identity.

## Stop and reopen the same service

~~~sh
python3 central_host.py --config /private/central-host.json status
python3 central_host.py --config /private/central-host.json stop
python3 central_host.py --config /private/central-host.json start
python3 central_host.py --config /private/central-host.json handover
~~~

stop uses the original Compose stop and checks that the selected containers have ended. start uses the retained configuration, original volumes and image selection. No command removes a volume or invokes docker compose down -v. The private file lock serializes this host operation; the original Docker container/project identities identify the persistent service across operator invocations.

If an invocation is interrupted, inspect its existing operation.json, private command output and actual Compose state. Reuse the original configuration and operation. A completed build is reused; a completed snapshot is verified; a selected incomplete restore keeps its same snapshot and target. Never start a second instance merely because the previous caller stopped returning output.

## Returned handover

handover.json is produced from the actual running service. It includes the source/backend version, real HTTPS origin, observed time, selected runtime, current container states, original connection references and retained backup/restore identity. It excludes passwords, tokens, runtime environment contents and certificate keys.

The customer engineering owner joins that handover to the original field-data receiving result, source definitions, three selected forms/two reporting periods where applicable, and the agreed commissioning schedule. The start date is recorded after the real source/access/host selection is agreed; retain the original ten-business-day offer and milestones in the original customer case.

## Files and native source boundaries

| File | Purpose |
| --- | --- |
| central_host.py | Complete native host preparation, startup, authentication, snapshot, restoration and reopening. |
| host.example.json | Editable private host selection without credential values. |
| UPSTREAM.json | Released upstream source and original interface pins. |
| HOST.md | Installation, connection, recovery and operating handover. |

The original Central and backend repositories retain their Apache2.0 license and notices. This additive host wrapper is MIT-licensed. The full product source publication does not include a runtime directory, customer data or private backups.
