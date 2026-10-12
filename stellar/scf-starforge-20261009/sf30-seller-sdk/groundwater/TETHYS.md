# Tethys installation, operation and receiving

This adapter opens the maintained groundwater workspace inside an existing Tethys portal. The portal supplies the signed-in account, application permissions, CSRF protection and private Paths. The original groundwater core supplies projects, immutable source and scenario editions, scientific comparisons, the native worker, operations, reports and complete backups. The same reviewed application assets serve both the standalone operator and the portal.

The source contract targets **Tethys 4.6.1**, **Python 3.11 or later**, and **starforge-groundwater-workspace 1.0.0**. Installing this adapter does not install or run MODFLOW, FloPy or another native environment. Register the actual installed native closure through the original runtime configuration when that host is ready.

## Install into the existing portal environment

Use the portal's current service environment and its reviewed application checkout. Install the original core first, then install this Tethys app from its own directory:

```sh
cd /absolute/reviewed/groundwater
python -m pip install --no-deps .
cd tethys_app
tethys install --without-dependencies
tethys manage collectall
```

The first command installs the complete core and its reviewed operator assets into `groundwater_workspace/_application`. The Tethys installer discovers `tethysapp.groundwater_workshare` and registers its controllers, setting and permissions. The adapter uses current Python packaging; it does not require a generated legacy setup.py. Its install configuration skips dependency installation because the existing portal and separately installed core are the selected environments.

Run the installation in the existing portal's deployment process. Preserve its current multi-app or standalone choices if the native installer asks about them. Collect the app's public CSS and icon, then restart the actual configured portal service by its existing deployment method. No universal service name or process supervisor is assumed here.

The adapter imports the installed reviewed core. It never imports Python from a received report or restored backup. A restored archive may retain a full application source edition for review and a separate controlled installation; it cannot replace the running portal's code.

The retained source contract and primary references are in [SOURCE_CONTRACT.json](tethys_app/tethysapp/groundwater_workshare/resources/SOURCE_CONTRACT.json). The original [Tethys application installation documentation](https://docs.tethysplatform.org/en/stable/installation/application.html) explains the portal installer. Exact 4.6.1 command and packaging behavior is pinned to the release source recorded in that contract.

## Configure private workspace scope

In the existing Tethys administration interface, open the Groundwater workspace app's `portal_configuration` JSON setting:

```json
{
  "workspace_scope": "user",
  "default_slot": "workspace",
  "max_request_bytes": 33554432
}
```

These are the only supported keys. The default gives each active portal account its own private workspace area. Choose `"app"` only when the intended operators should share the app's private area; those accounts also need `use_shared_workspace`. A changed scope selects a different existing Paths root and cannot reuse a bound URL from the old scope.

A slot is an explicit name of 1–64 letters, digits, underscores or hyphens, starting with a letter or digit. It selects a private workspace or a create-only restore destination. It is not an arbitrary server path. The setting does not accept a native executable, outside receiving directory, credential or uploaded application source.

`max_request_bytes` bounds one original JSON action, including the base64 representation of an imported source ZIP. The supported range is 1 KiB through 128 MiB. Coordinate the portal's existing HTTP request limit with the selected bound. Increasing this value does not alter a native run's memory or storage allocation.

The adapter uses the current Tethys Paths API and its original quota checks. An installation configured with `USE_OLD_WORKSPACES_API` must be migrated through its existing portal configuration before using this app. No alternate filesystem root is invented when a quota or Paths check fails.

### Private layout

Let `BASE` mean the actual path returned by the selected Tethys app or user workspace. The following paths are beneath `BASE/groundwater_workshare`:

| Path | Purpose |
| --- | --- |
| `workspaces/SLOT` | New, initially absent destination for an original complete-workspace restore |
| `workspaces/SLOT/workspace/groundwater.sqlite` | The original working database |
| `workspaces/SLOT/received` | A restore's immutable incoming package, separate from later edits |
| `receivers/SLOT` | Private local report delivery root for this slot |
| `received_reports/SLOT` | Independent create-only report package receiving |
| `creation_intents` | Small retained identities for explicit portal workspace creation |

The namespace and its child directories are private, mode 0700 and owned by the current portal service account. An existing link, special file, different owner or overly broad mode returns a concrete error; the adapter does not silently replace it or change its permissions. Correct an existing deployment's ownership and permissions deliberately in that deployment.

The report receiving roots are outside the restore container. Preparing a report receiver therefore does not make a new complete-workspace restore destination nonempty.

## Assign existing application permissions

Grant permissions through the portal's existing application permission system. Every request requires an active authenticated account and `view_workspace`, including installations that enable an open portal mode. The current account username is the recorded actor; a supplied actor in JSON cannot impersonate someone else.

| Permission | Original actions or capability |
| --- | --- |
| `view_workspace` | Read the selected workspace, source editions, native results and frozen reports |
| `edit_workspace` | Create a portal slot, create/update projects, import original sources and create scenario editions |
| `review_workspace` | Record attributed edition and native-result reviews |
| `execute_runs` | Prepare, execute or continue the original bounded native run |
| `configure_runtime` | Inspect and register actual installed native executable paths |
| `publish_reports` | Freeze a reviewed original report |
| `receive_reports` | Configure a scoped local receiver and deliver, reconcile or acknowledge a report |
| `backup_workspace` | Create/resume a full private backup and download its original archive |
| `use_shared_workspace` | Access the app-wide private Paths scope when configured |

The registered groups provide reader, analyst, reviewer, receiver, operator and administrator combinations. The operator group can complete a reviewed project and receiving workflow, but runtime configuration and shared-area access remain explicit administrator permissions. A permission change takes effect on the next request; cached browser state does not grant authority.

## Check the selected installation and open its original slot

Run the helper in the same configured Tethys service environment, using the exact identifier of an existing account:

```sh
python -m tethysapp.groundwater_workshare.manage \
  --user operator --slot workspace check

python -m tethysapp.groundwater_workshare.manage \
  --user operator --slot workspace paths
```

Replace `operator` with the actual account identifier. The helper resolves that existing account, the original Tethys app and its permissions. It does not create a portal user. The `check` response identifies Python, the installed portal, the reviewed core module, configuration and permissions. If an original database is present, it reads the retained workspace and native runtime; a missing area is reported without constructing a database. Any reported issue produces a nonzero exit.

`paths` prepares only private parent and receiving directories and returns their actual absolute locations. It does not initialize a groundwater database. Use the returned `portal_path` to open the selected slot after its creation or restore.

In the app launcher, choose **Create workspace** for a genuinely new project. The CSRF-protected form commits an original creation identifier and a fixed future workspace UUID before it creates any slot directory. The core owns its own initialization intent, verified temporary SQLite database, atomic publication and completion. No second scientific database or worker is created by the adapter.

If the browser or process stops during creation, the same creator can choose **Continue original creation** from the launcher. That action retains the saved creation ID, slot and database UUID. It can finish the original core initialization or reopen its completed database. It cannot adopt an unrelated existing directory, replace a damaged database or recreate a missing completed workspace. An invalid or unavailable original is preserved for recovery.

For existing work, choose **Open workspace**. Bound reads use `Workbench(..., existing_only=True)`. A missing, partial or invalid database is an error before state initialization. The route binds the actual workspace UUID as well as a nonsecret hash of the selected account, scope and private root. Two accounts that receive an archive with the same retained UUID therefore have different browser request addresses. Open the launcher after an account or deployment-path change.

## Complete the original source, scenario and native review workflow

The portal serves the original operator's source, project, scenario, run, report and receiving views. All domain URLs use the configured `apiBase`. Adjacent CSS, external bootstrap and deferred application JavaScript use the configured asset location; no inline credential or additional browser session is created.

Start by retaining the exact publisher package or supplied source ZIP in the original Sources workflow. The upload goes through the original `source.import` action and object store. The adapter does not unpack an upload into the portal code or execute its contents. Read the source manifest, original inputs and any reported omissions before creating a scenario edition.

The TWRI publisher example preserves the native distinctions established in the main [operator guide](OPERATOR.md): the original five-layer MODFLOW 6 model and three-aquifer legacy model are mapped explicitly; original package unit declarations are separate from intended prose units; executable recharge and narrative recharge are retained independently. An attributed scenario can change a supported input, but cannot rewrite the baseline or make incompatible units physically comparable by changing a display label.

A runtime administrator registers the actual installed executable and library closure using the original runtime configuration. The core's inspection and frozen fingerprint remain authoritative. Preparing a run creates its original queued record. Execute or resume acts on that same bounded native worker; there is no Tethys queue, extra scheduler or automatic solver installation.

Read the actual native return codes, outputs, masks, times, units and budget summaries. Keep unsupported or missing comparisons explicit. Record the named reviewer and reason on the exact current edition/run before freezing a report. A successful HTTP response from the portal is not evidence that a native solver completed; the original run state and retained output hashes supply that evidence.

## Configure one scoped receiving route

Prepare a private child of the current slot's receiver root:

```sh
python -m tethysapp.groundwater_workshare.manage \
  --user operator --slot workspace prepare-receiver --name review-team
```

Use the exact returned `receiver_directory` in the original receiver form. Both its creation and later delivery/resume/reconcile/acknowledgement resolve under this selected slot. Parent traversal, symlinks, noncanonical path spelling or an outside directory is rejected before native delivery. Existing receiver history remains retained even if its old location is unavailable.

Freeze a report from its actual reviewed source/run basis. Download or inspect the original JSON, HTML, CSV and ZIP formats. The transport opens a held file descriptor, verifies its exact byte count and SHA-256 against the core's retained descriptor, and serves those bytes. Report HTML and SVG downloads carry a sandbox policy. Private responses are not cached, and an authenticated external bootstrap is limited to same-origin resource use.

Select the existing receiver and deliver the frozen report. An interrupted delivery is continued on its original ID; reconciliation checks the original file receipt. Record an acknowledgement only after its actual evidence is available. A locally recorded acknowledgement is not a customer email, external approval or clinical/scientific acceptance.

For an independent receiving copy of a frozen report package, prepare a new absent destination:

```sh
python -m tethysapp.groundwater_workshare.manage \
  --user operator --slot workspace prepare-report --name review-copy

starforge-groundwater inspect-package --archive /absolute/frozen-report.zip

starforge-groundwater receive-package \
  --archive /absolute/frozen-report.zip \
  --destination /exact/report_destination/from/the/helper
```

Use the actual path returned by the helper. Keep the original archive and inspection/receiving results. A different existing directory is never overwritten to make an import appear successful.

## Back up, restore into a new slot and reopen

A full private backup is different from a frozen report export. It retains the original working database, operation history, source objects, scientific records, supported native evidence, application source and the original core initialization records. Use **backup.create** once; if its committed preparation was interrupted, use **backup.resume** with that same backup ID. A lost download response does not require another backup.

Download the completed original backup through the authenticated backup endpoint. Record its exact size and hash. To continue it separately, choose a new named slot and prepare only its parents:

```sh
python -m tethysapp.groundwater_workshare.manage \
  --user operator --slot received-project prepare-slot

umask 077
starforge-groundwater restore \
  --archive /absolute/complete-workspace.zip \
  --destination /exact/restore_destination/from/the/helper
```

The restore destination must remain absent before the original create-only restore. A slot with a retained creation intent is also occupied, even if its database creation has not finished. The helper does not delete that intent to reuse its name.

The native restore response returns the actual `workspace_id`, `workspace`, archived `application`, `archive_sha256`, `original_operations_preserved`, `automatic_run` and `restored_at`. Preserve it. Use the returned working directory, which is beneath `destination/workspace`, for a direct original read:

```sh
starforge-groundwater state --workspace /exact/workspace/from/restore
```

Open the new slot from the existing portal launcher. The incoming `received` package remains immutable while the working database can continue. The installed reviewed application still serves the UI. No native run starts merely because the backup was restored or the portal opened.

On a different host, configure a genuinely installed compatible runtime and use the core's explicit same-run rebind/resume rules where supported. Retained absolute paths or an old successful run do not establish that today's runtime is present. Earlier backups whose archive bytes were not themselves included remain honest history; use their reported availability instead of offering a fabricated download.

For deployment moves that change private Paths locations, read the preserved original receiver history and explicitly configure a new receiver beneath the new slot. Do not edit historical receiving locations or operation requests to make an old delivery appear current.

## Resolve a lost action response on the same address

The shared UI stores a request before dispatch and keys its drafts and recovery by origin plus the complete configured API base. It also retains the original dispatch URL. A mismatch stops replay. The current authenticated actor is supplied by the portal, while the original action name, operation ID, expected workspace version and payload are delegated to the core.

For an ambiguous action:

1. Reopen the same account and slot. Preserve the saved request and dispatch address.
2. Read its exact original operation ID through the UI's recovery control.
3. If committed, use that retained result, including the original run, report, delivery or backup ID.
4. If the core returns `operation_not_recorded`, check the original in-progress action before retrying its exact request. A momentary 404 does not prove the first caller stopped.
5. Resolve a version conflict in the current form. Do not generate a new operation merely to conceal an uncertain result.

JSON actions are bounded, reject duplicate keys and nonfinite JSON numbers, and use the original core error codes. Scientific values remain the core's exact strings. Every POST retains normal Django CSRF validation and per-action app permissions. No CSRF exemption or new Bearer token is added by this adapter.

An error opening a bound database requires restoration or resolution of that original database. The read path never invokes the new-workspace constructor as an automatic fallback.

## Run the complete native portal receiving continuation

The adapter includes an executable continuation for the actual completed standalone workspace. Run it only in the existing configured Tethys 4.6.1 environment, as that portal's service account, with an explicitly selected existing Tethys user. It creates no user, portal service, solver run or scientific scenario.

Its input contract is [RECEIVING_INPUT.schema.json](tethys_app/tethysapp/groundwater_workshare/resources/RECEIVING_INPUT.schema.json). Build the request from the actual completed backup and retained source/run/report/operation readbacks:

| Input | Actual source |
| --- | --- |
| `operation_id` | One retained local receiving identifier, reused on every continuation |
| `user` and `slot` | Existing portal account and an explicit new private receiving slot |
| `archive` | Absolute complete-backup path, exact byte count and SHA-256 |
| `expected.workspace_id` and `workspace_version` | Original meta identity/version in the backup's frozen database |
| `expected.project_id` | Original project in that same database |
| `source_ids` / `edition_ids` | Original selected source and scenario records |
| `runs` | Each original completed run ID and canonical result SHA-256 |
| `reports` | Each frozen report ID, report SHA-256 and its exact ZIP bytes/SHA-256 |
| `operations` | Each original committed operation ID, request SHA-256 and canonical result SHA-256 |
| `report_receivings` | Original selected report IDs and explicit new private receiving names |

The request and all selected lists are explicit. No illustrative scientific values or sample customer IDs are inserted by the adapter. The original core's `digest` over its JSON result supplies the canonical result hash. Do not use a prettified JSON file's byte hash in its place.

Run the retained request once:

```sh
python -m tethysapp.groundwater_workshare.receiving \
  --input /absolute/private/tethys-receiving.json
```

The caller enforces the selected installed versions and existing account permissions. It binds the archive, expected records, account PK, Paths root, scope and slot in one create-only request before calling the original restore. Private creation uses a restrictive umask. The original core handles its own partial extraction and restore publication; the caller does not manufacture or replace those control records.

After restore, it independently checks the immutable incoming SQLite identity and version. It opens the continued working database with `existing_only=True`, reads every selected original source and edition, verifies completed native result files, checks each frozen report's four export formats and reads every selected committed request/result. It then receives the selected original report ZIPs into their separate private report destinations through the maintained `receive_package` function. These receiving receipts remain unreviewed; no external acknowledgement is invented.

The complete original result and `portal-handoff.json` are retained under the selected Paths namespace's `portal_receiving/OPERATION_ID`. The handoff gives the actual account-bound portal path, original workspace/project/run/report/operation IDs and the result file's byte identity. Open that path through the existing portal and sign in normally as the selected account. The caller does not create a session or bypass login.

If interrupted, repeat the exact command and input. Its own retained request and the core's original restore/receiving markers must match. A conflicting archive, user, slot or selected record stops the continuation. A later edit in the restored working database does not rewrite the original receipt: the returned readback identifies the current workspace version separately and verifies the selected original immutable records again. The original incoming archive and database remain the receiving basis.

The programme's result establishes actual local native receiving only when it runs successfully on that configured portal. It does not claim browser inspection or customer acceptance. A portal operator can use its exact handoff for the visible reopening, original request recovery and report inspection without running the solvers again.

## Operator handover and acceptance

Record the actual installed source edition, portal/core/Python versions, selected scope, original account permissions and slot path. Retain the real native runtime fingerprint, source and scenario IDs, run attempts/results, reviewer decisions, frozen report hashes, receiver and delivery IDs, acknowledgement evidence and the completed backup/restore result.

A complete native portal handover should demonstrate an authenticated existing account, one original source and scenario, actual native result readback, a reviewed report, exact receiving and a new-slot restore/reopen with original operation identities. The administrator can inspect its exact paths with `check` and `paths`; the recipient can inspect the original frozen package with the maintained CLI.

Source publication and syntax validation establish the delivered adapter, not an installed customer portal, available tenant, native solver result or external acceptance. Attach actual host and runtime results to the original workshare when they exist. The authored adapter/core are MIT; unchanged upstream inputs and their licenses retain their own identities.
