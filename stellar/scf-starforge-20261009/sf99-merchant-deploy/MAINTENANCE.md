# Merchant maintenance and restored-host cutover

The original SF99 command now carries a running merchant through maintenance,
encrypted backup, restored-state preparation, service activation and recovery
from an interrupted operation. It uses the original SF101 recovery engine,
original SF98 delivery lock, original SF99 deployment and the existing Linux
systemd/Caddy installation. It creates no payment, order or accounting engine.

`backup` pauses and snapshots the existing host, then resumes it. `migrate` keeps
traffic paused from its fresh snapshot through activation of a new private state
directory. That continuous pause prevents purchases accepted after the snapshot
from being lost during a later switch. The service and public origin keep their
existing identities.

## Select the existing host

Use the existing Linux administrator account and complete immutable source
release, with Node 22+, systemd, Caddy and util-linux `flock`. The original
unprivileged merchant account must already exist. Paid-file merchants also use
the original Python 3.11+ runtime. These commands operate the selected host;
run the ordinary SF99 generator and installation first.

Keep the merchant Caddy fragment in its own file, imported by the existing main
Caddyfile. The fragment's bytes and every original merchant unit must match the
retained SF99 deployment bundle. For example, the existing Caddyfile includes:

```caddyfile
import /etc/caddy/merchants/report-merchant.caddy
```

The maintenance command changes that single imported fragment, validates the
complete configuration and reloads Caddy through its configured admin endpoint.
It never stops the shared Caddy service or removes another merchant's site.
The original origin must reach this selected host. A CDN or extra ingress tier
must preserve the maintenance response and header used to observe activation.

Create an administrator-owned operation directory outside merchant state,
source, deployment bundles and all selected recovery roots:

```sh
install -d -m 0700 -o root -g root /var/lib/stellar-maintenance/report-merchant
node stellar/scf-starforge-20261009/sf99-merchant-deploy/cli.mjs maintenance template \
  > /private/report-merchant-maintenance.json
chmod 0600 /private/report-merchant-maintenance.json
```

Fill in that plan with the actual installed paths:

```json
{
  "schema": "stellar-forge.merchant-maintenance.v1",
  "bundle": "/private/deployments/report-merchant-001",
  "operationsRoot": "/var/lib/stellar-maintenance/report-merchant",
  "systemdDirectory": "/etc/systemd/system",
  "caddy": {
    "fragment": "/etc/caddy/merchants/report-merchant.caddy",
    "config": "/etc/caddy/Caddyfile",
    "unit": "caddy.service",
    "binary": "/usr/bin/caddy"
  },
  "recoveryPlan": "/private/report-merchant-recovery.json",
  "extraWriterUnits": [],
  "writerTemplates": [],
  "passphraseEnv": "SF101_RECOVERY_PASSPHRASE"
}
```

Omitting `recoveryPlan` selects the original bundle's `recovery-plan.json`.
That generated plan contains `privateRoot` and selected configuration inputs.
The explicitly selected plan must also contain any external approved file or
asset roots, upstream idempotency journals, and other merchant records being
moved. Choose complete directories for trusted modules with relative imports;
the original recovery format preserves their relative closure. Roots must be
named, real and nonoverlapping as required by SF101.

The command retains the exact original host and recovery plans in its private
operation directory. It keeps the service environment file and its values out
of the recovery roots. Provision the named SF101 passphrase through the existing
private operator environment; its original minimum is 16 bytes. The passphrase
is neither a CLI argument nor written into the journal, host bundle or proxy.
The merchant's existing environment file remains selected after migration.

The optional `runtime` object can select actual absolute paths for `systemctl`,
`systemdAnalyze`, `runuser` and `getent` when the host uses different locations.
Defaults use the original Linux binaries under `/usr/bin` and `/usr/sbin`.

Inspect the concrete installation and named roots before operating it:

```sh
node stellar/scf-starforge-20261009/sf99-merchant-deploy/cli.mjs maintenance inspect \
  --plan /private/report-merchant-maintenance.json
```

## Include the merchant's other writer jobs

List every owned service, timer, socket and path unit that can write any selected
recovery root in `extraWriterUnits`. Backup stops those units and restores their
previous active states. Migration also needs a reviewed template for each unit's
installed fragment and **every** existing `.conf` drop-in. It verifies that the
loaded systemd fragment/drop-in paths match that complete set before pausing
ingress. Services use the merchant's existing stable account or root; activation
units retain their original dependencies and schedules.

For a catalog writer, copy the installed service to a separate private template
and replace the complete selected path arguments with named placeholders:

```ini
[Unit]
Description=Report merchant catalog refresh

[Service]
Type=oneshot
User=stellar-merchant
Group=stellar-merchant
WorkingDirectory={{CATALOG_DIRECTORY}}
ExecStart=/usr/bin/python3 /opt/catalog/refresh.py --catalog {{CATALOG_FILE}}
ReadWritePaths={{CATALOG_WRITABLE}}
```

Declare that template and the original paths in the maintenance plan:

```json
{
  "extraWriterUnits": ["report-catalog.service", "report-catalog.timer"],
  "writerTemplates": [
    {
      "unit": "report-catalog.service",
      "files": [{
        "path": "/etc/systemd/system/report-catalog.service",
        "template": "/private/templates/report-catalog.service",
        "bindings": [
          {"name": "CATALOG_DIRECTORY", "path": "/srv/report/catalog", "format": "working-directory"},
          {"name": "CATALOG_WRITABLE", "path": "/srv/report/catalog", "format": "path-list-item"},
          {"name": "CATALOG_FILE", "path": "/srv/report/catalog/catalog.json", "format": "exec-argument", "originalStyle": "bare"}
        ]
      }]
    },
    {
      "unit": "report-catalog.timer",
      "files": [{
        "path": "/etc/systemd/system/report-catalog.timer",
        "template": "/private/templates/report-catalog.timer",
        "bindings": []
      }]
    }
  ]
}
```

Use a separate name for each different directive format, as shown for the
working directory and writable directory. The recovery plan must include that
actual catalog directory. For an installed drop-in, add another `files` entry
with its exact installed path, retained template and explicit bindings.

Rendering the **original** binding paths must reproduce the installed bytes
exactly. `originalStyle` is `quoted` by default, or `bare` for an existing
unquoted argument/list item. New paths are quoted and escaped for their actual
systemd directive context. `working-directory` uses a raw scalar. Optional
`prefix` preserves `-`, `+` or `-+` on path-list items, and `-` on a working
directory. Templates with no path changes still require `bindings: []`.

The command pins original bytes, ownership, mode and templates before ingress
changes. It maps only declared paths through the authenticated recovery roots,
parses the staged unit tree, and replaces only those installed files. Ordinary
failure before commit restores their exact original bytes. Resume reuses the
same pinned templates. The returned next-generation plan points to preserved
templates with the new path bindings, so a second migration needs no manual
reconstruction. External writers remain stopped until the restored merchant
has passed preflight and the operation has committed.

## Back up and resume the current merchant

```sh
node stellar/scf-starforge-20261009/sf99-merchant-deploy/cli.mjs maintenance backup \
  --plan /private/report-merchant-maintenance.json --id before-catalog-upgrade
```

The command first saves its operation identity and previous component states.
It serves `503` with `Cache-Control: no-store`, `Retry-After` and a unique
`X-Stellar-Forge-Maintenance` header at the merchant origin, then observes that
same response over HTTPS. It installs operation-owned systemd condition files,
stops the entire declared group, and reads each unit's actual state and process
IDs. Stopping uses the existing seller → sender → receiver shutdown ordering.

The original outbox kernel lease is held while the original SF101 engine creates
and fully verifies the encrypted snapshot. The command then removes only its
own condition files, restores the previously active component group, observes
the original readiness endpoints and reloads the original public fragment.
Private operator and health paths remain confined to their existing listeners.
The result gives the retained archive path and completed operation ID.

## Restore into a new state directory and activate it

```sh
node stellar/scf-starforge-20261009/sf99-merchant-deploy/cli.mjs maintenance migrate \
  --plan /private/report-merchant-maintenance.json --id catalog-generation-002 \
  --destination /srv/stellar/report-merchant-generation-002
```

The destination must be new, with an existing traversable parent, outside the
original host components and recovery roots. Add `--source-root` only when
selecting an already prepared immutable source release. Otherwise the original
deployment's release stays selected; its resolved Node/Python executables remain
unchanged. Install any original runtime dependencies before selecting a release.

The original recovery engine authenticates the complete archive before restoring
it. SF99 stages the original named roots, preserves standalone module filenames,
and rewrites only known filesystem selections. Public origins, route methods,
prices, asset/recipient identities and provider URLs stay in their original
configuration. No arbitrary code, URL or description is searched and replaced.

| Stored component | Restored behavior |
| --- | --- |
| Original host inputs | Select the authenticated copies and generate a new original SF99 bundle. |
| SF101 checkout | Rebase its existing receiver and outbox paths. |
| SF101 enrolled files | Verify every file's retained size and SHA-256, then change only `orders.file_path` in one SQLite transaction. |
| SF101 identities | Retain all other columns, schemas, rows, tokens, events, entitlements and access records; compare their complete database identity before commit. |
| API response files/assets | Resolve the original path relative to the original config directory, then map it to the selected restored root. |
| Upstream idempotency state | Move a dedicated selected external state root beneath restored `privateRoot` and update its explicit binding. |
| Other selected immutable records | Carry the exact original bytes under their named roots without inventing new records. |

The archive is retained unchanged. File-root copies preserve their original
basename/extension; directory roots keep their original module and asset closure.
If a selected idempotency root also contains unrelated configuration or source,
select its dedicated state directory in the original recovery plan.

Before activation, the command assigns only the newly created destination to
the existing service account, makes the host bundle administrator-owned and
group-readable, and runs its actual preflight as that unprivileged account.
The original systemd parser validates the generated units. Only the original
seller and receiver start for local readiness; the sender's original lease
remains held so preflight cannot send pending delivery events.

The durable `COMMITTED` transition chooses the restored state before any
external delivery or public traffic resumes. The command then starts the full
original group, observes readiness and restores the public fragment. Its result
contains the active bundle and a **new maintenance plan** for that generation.
Use that returned plan for the next operation: it preserves every selected
external recovery root and coalesces roots now contained by merchant state.

## Continue an interrupted operation

Use the same original maintenance plan and stable operation ID:

```sh
node stellar/scf-starforge-20261009/sf99-merchant-deploy/cli.mjs maintenance status \
  --plan /private/report-merchant-maintenance.json --id catalog-generation-002
node stellar/scf-starforge-20261009/sf99-merchant-deploy/cli.mjs maintenance resume \
  --plan /private/report-merchant-maintenance.json --id catalog-generation-002
```

Status reads the private operation even when installed components need repair;
it does not decrypt archives or contact the merchant. Resume checks the original
plan identities, reacquires the original kernel locks, and observes actual
process and ingress state before continuing. The systemd condition files and
merchant maintenance response persist across an operator process interruption.

An interrupted create-only snapshot or restore is retained. A new attempt uses
its own numbered directory recorded in the same journal; it never overwrites
an earlier attempt or the original merchant state. Operator commands for the
same merchant share one separate operation lock and durable active-operation
pointer. Kernel ownership ends when the process closes its descriptor or dies;
there is no age-based lock stealing.

Before commit, an ordinary failure automatically reinstalls and starts the
original host. The explicit equivalent is:

```sh
node stellar/scf-starforge-20261009/sf99-merchant-deploy/cli.mjs maintenance rollback \
  --plan /private/report-merchant-maintenance.json --id catalog-generation-002
```

After commit, resume repairs forward against the chosen state. A sender or buyer
may already have accepted work there, so rollback no longer restores the earlier
state snapshot. To change code or paths again, run another migration from the
returned active generation's maintenance plan. This keeps original payment,
delivery and entitlement history intact.

Private journals retain phases, selected paths, hashes and operation errors.
They contain no copied service environment or passphrase. Archive retention and
off-host backup copying remain the merchant's existing storage procedure; the
command never deletes original state or earlier archives automatically.

## Original runtime references

- [Original encrypted recovery contract](../sf101-merchant-recovery/README.md)
- [Original continuous delivery and kernel lease](../sf98-merchant-delivery/SERVICE.md)
- [Caddy configuration validation and graceful reload](https://caddyserver.com/docs/command-line)
- [systemd unit conditions, dependencies and drop-ins](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html)
