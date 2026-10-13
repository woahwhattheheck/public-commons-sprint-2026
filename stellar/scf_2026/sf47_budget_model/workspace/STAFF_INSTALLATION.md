# Install, back up and recover a named-staff Grant Operations workspace

This handover keeps the complete Grant Operations installation together: every saved plan and revision, operating case, original attachment, business request, staff assignment and the source needed to run the application. Use it when moving the installation to another host, preparing an independent recovery copy, or handing day-to-day operation to a new owner.

The installation owner manages the private owner access file. Named staff sign in at `/team` with their individual staff ID and access code. Lead, finance, contributor and reviewer permissions continue to use the original planning and case workflows. A staff administrator is a delivery lead explicitly assigned administration across all cases.

## Operate one shared installation

Run the complete source edition supplied with the workspace. Its directory layout is significant because the original commercial and merchant adapters load sibling modules by relative path. Keep `stellar/scf_2026/sf47_budget_model/workspace`, its parent budget model and the original selected `stellar/scf-starforge-20261009` modules together.

The existing launch command is:

```sh
python3 stellar/scf_2026/sf47_budget_model/workspace/cli.py serve \
  --workspace /srv/grant-team/workspace \
  --scenario stellar/scf_2026/sf47_budget_model/sf10_current_candidate.json
```

Use the runtime and account already selected for this installation. The planning server keeps its workspace private and listens on loopback. The launch prints its actual address and writes the owner's private `open-workspace.html` and `access.key` inside the workspace. The owner opens that file, opens the Team page, and creates each person's profile with the appropriate case selections. A contributor profile additionally selects that person's original contributor record for each assigned case.

For staff on other machines, keep the organization's existing SSH access and host configuration. Forward the server's actual port to the same local port on each staff machine. For example, if the running server advertises port 8765:

```sh
ssh -N -L 127.0.0.1:8765:127.0.0.1:8765 existing-grant-host
```

Keep that SSH connection running and open `http://127.0.0.1:8765/team` on the staff machine. The address and port must match the installed server's allowed origin. Each staff member uses their own access code. The private owner link belongs to the installation owner.

Changing a person's role, case selection or contributor mapping ends their existing sessions. Rotating their code or revoking the profile also ends that person's sessions. Review staff activity and case history from the same shared installation rather than exchanging separate working databases.

## What an installation backup contains

The owner or staff administrator can download a complete backup through:

```text
GET /api/staff/installation/export.zip
```

Open that address from the authenticated Team browser session. The server takes an SQLite backup while holding the original workspace mutex, so the database is one complete committed snapshot. Normal staff work can continue after that short database snapshot. The source inventory is read and checked for changes before the archive is returned.

| Member | Retained content |
| --- | --- |
| `planning.sqlite3` | All original database tables, saved plans and revisions, cases, case source bytes, request histories, operating records, commercial selections, staff profiles and staff events. |
| `scenario.json` | The exact original scenario bytes from the earliest retained plan. Every other plan's original source remains in the database. |
| `source/` | The complete installed workspace source, parent budget model and actual local JavaScript module and asset dependencies, in their original repository layout. |
| `INSTALLATION-MANIFEST.json` | Every member's byte length and SHA-256, all database table fingerprints, business-table fingerprints, staff roster identity, original scenario and saved commercial connection selections. |

The backup is private operational data. It contains original business documents and the source installation's access-table snapshot. Store it in the institution's private backup location. It omits the original `access.key`, browser access file, process lock, and live SQLite WAL/SHM files; the consistent database snapshot already includes committed WAL content.

The archive is a whole-installation handover. The application's existing plan, case, report and source-package exports remain useful for their original individual workflows.

## Save a backup from the host

The HTTP download works with the running server's existing database connection. For a host-side CLI backup, stop that installation through its existing launcher first so the CLI can acquire the original exclusive workspace lock. Then run from the complete source checkout:

```sh
python3 stellar/scf_2026/sf47_budget_model/workspace/staff_installation.py backup \
  --workspace /srv/grant-team/workspace \
  --output /srv/grant-team/backups/grant-team-2026-10-12.zip
```

The command requires an existing `planning.sqlite3` and creates the output file with owner-only permissions. Select a new output filename for each retained edition. It reports the archive's bytes and SHA-256, the number of staff profiles, source files and retained business tables.

Use `--source-directory` only when selecting another complete original source tree:

```sh
python3 stellar/scf_2026/sf47_budget_model/workspace/staff_installation.py backup \
  --workspace /srv/grant-team/workspace \
  --source-directory /opt/grant-release/stellar/scf_2026/sf47_budget_model/workspace \
  --output /srv/grant-team/backups/grant-team-before-upgrade.zip
```

The source collector checks the actual local JavaScript imports, Python helper imports and literal file-relative Python search paths, along with every required Applications boot file. It reports any missing original module. Complete the selected release at those paths and run the same backup command again. A sparse checkout that omits a required merchant client cannot produce a complete receiving package.

Restart the original installation with its existing launcher after the CLI backup completes. Keep the saved ZIP and its returned SHA-256 together in the private backup record.

## Inspect the complete handover

On the receiving host, use the supplied `staff_installation.py` to verify the archive:

```sh
python3 stellar/scf_2026/sf47_budget_model/workspace/staff_installation.py inspect \
  --file /srv/grant-team/backups/grant-team-2026-10-12.zip
```

Inspection checks every member against the manifest, rejects unsafe or duplicate paths and verifies the complete source selection. It prints the original manifest. It performs no network call and does not import or run the source inside the ZIP.

Review the scenario identity, staff roster, application selection and saved commercial connections against the installation being handed over. Retain the original ZIP unchanged throughout receiving.

## Restore into a separate private workspace

Choose a new or empty directory owned by the receiving operator:

```sh
python3 stellar/scf_2026/sf47_budget_model/workspace/staff_installation.py restore \
  --file /srv/grant-team/backups/grant-team-2026-10-12.zip \
  --directory /srv/grant-team/recovered-workspace
```

The command stages the complete installation in a private sibling directory. Before publishing the target, it verifies SQLite integrity, the original scenario bytes, every table fingerprint, the roster and every source file. It then resets access and verifies that the retained business data and staff assignments are unchanged. A final directory rename publishes the complete result together. A populated destination is preserved and the command asks for a new empty target.

The restored workspace retains the following:

| Record | Receiving behavior |
| --- | --- |
| Plans, revisions, cases, attachments, business requests and events | Preserved from the original database snapshot. |
| Staff names, stable actors, roles, active/revoked state, case assignments and contributor mappings | Preserved. |
| Staff access events | Preserved as the original operating history. |
| Login code hashes | Cleared for every staff profile. |
| Browser sessions, staff request replay records and login-attempt counters | Cleared. |
| Installation identity | Cleared so the normal staff-access startup creates a new identity and cookie name. |
| Owner access key and owner browser link | Created afresh by the normal server on first start. |
| Saved commercial connection selections | Preserved with their original server, workspace and source identities. |

The result includes `INSTALLATION.json`, the original manifest and `START.md`. These record the target paths, source identities, retained business fingerprints and the actual access-reset counts.

## First start and staff handover

From the restored directory, follow its generated `START.md`:

```sh
cd /srv/grant-team/recovered-workspace
python3 source/stellar/scf_2026/sf47_budget_model/workspace/cli.py serve \
  --workspace . \
  --scenario scenario.json
```

The owner opens the newly generated private `open-workspace.html`. Open the Team page and review each retained profile before issuing a new access code. A restored active profile has its assignments but no usable code until the owner rotates its credential. A revoked profile remains revoked.

Issue each person their own new code through the organization's usual private channel. Staff then sign in at the receiving installation's `/team` address and confirm their assigned case or contributor desk. The previous installation's codes and sessions do not authenticate to the restored copy.

The owner should inspect an existing case, its original attachments, retained work and invoice records, and the current plan before accepting the handover. The restored manifest provides the exact original business fingerprints for a receiving record; `INSTALLATION.json` identifies which access records were intentionally reset.

When promoting the recovered copy to the shared operating installation, stop the previous operating server and move the existing launcher/SSH access selection to the accepted copy. Preserve the preceding backup as its original edition. Running two independent writable copies would create separate subsequent case histories.

## Connected commercial services

The grant database retains selections such as a receivables connection's `baseUrl`, `workspaceId` and `sourcesSha256`. The backup also carries the original local client source needed to use those connections.

Each connected commercial workspace has its own original database and operating lifecycle. Start or restore that service through its own existing delivery package, then inspect the configured connection from Grant Operations. Confirm the service presents the retained workspace and source identities before continuing its original receivables workflow.

The installation manifest lists those selections with `ORIGINAL_SERVER_REQUIRED`. A malformed older selection is retained in the database and flagged `SAVED_CONFIGURATION_REVIEW_REQUIRED` for the owner. Restoring Grant Operations never retargets a connection or creates invoices in another service.

## Upgrade and recovery record

Before changing the installed source edition, save the complete original installation backup. Keep the currently selected source commit or release reference with the archive's SHA-256 and the institution's launcher configuration. Deploy the new complete source through that launcher, retaining the original relative source layout and the same workspace path.

For an independent recovery rehearsal, restore the retained ZIP into a separate directory and use its included source. Record the returned target, scenario identity, source-file count, business-table identities and access-reset result. The owner then issues fresh codes only to the receiving staff who need that copy.

A recovery failure leaves the original workspace and ZIP available. The restoration staging directory is removed when publication has not completed. Correct the concrete source, archive or target condition reported by the command and repeat against a new empty directory.

## Run the complete receiving workflow

The supplied programme can operate an independent receiving copy from the exact saved backup:

```sh
python3 stellar/scf_2026/sf47_budget_model/workspace/STAFF_INSTALLATION_RECEIVING.py \
  --archive /srv/grant-team/backups/grant-team-2026-10-12.zip \
  --directory /srv/grant-team/receiving-2026-10-12
```

Choose a new output directory. The programme keeps the original ZIP, restores its complete source and database, and starts that included source in a separate Python process. Before opening the server, it runs the original Python and Node Applications source selectors and requires identical selections and digests. It also verifies every required boot file against the received manifest, including dependencies in neighboring product directories. It verifies the original business tables and staff assignments, issues fresh codes for retained active profiles, signs each person into their selected operating desk, closes the server and repeats sign-in after a cold reopen.

The output contains `result.json`, the complete native stdout/stderr and process return code, the original Applications selection in `received-application-selection.json`, and the independently received workspace. That workspace's `receiving-staff-codes.json` is owner-only and contains the new codes used in this receiving run. It is kept out of the general result. Retain the complete output privately with the original ZIP; the normal owner can rotate these codes again when handing the accepted installation to its actual staff.

An already-running original server can invoke `receive_workspace(open_workspace, new_directory)` from `STAFF_INSTALLATION_RECEIVING.py` to exercise the same complete workflow without opening a second connection to its locked original workspace.

## Python integration

The staff HTTP adapter calls the same implementation used by the host CLI:

```python
from staff_installation import (
    export_installation,
    inspect_installation,
    restore_installation,
)

archive_bytes, manifest = export_installation(open_workspace)
verified_manifest = inspect_installation(archive_bytes)
received = restore_installation(archive_bytes, "/srv/grant-team/new-copy")
```

`export_installation` requires the original open `Workspace` and uses its existing `mutex` and SQLite connection. Call it outside an active business transaction. `restore_installation` receives the whole installation into a new private directory and leaves startup, owner access creation and staff code reissue to the normal application.

