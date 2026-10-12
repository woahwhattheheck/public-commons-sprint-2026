# Real Tethys portal preparation and original study receiving

This continuation prepares an actual Tethys 4.6.1 installation, verifies ordinary account access in its real browser, and receives an already completed groundwater study. It uses the original 64-file Groundwater Workspace and its Tethys adapter. The original publisher and scenario solvers remain in their existing operation.

The preparation and receiving phases use one portal operation ID, one private installation, the same account identities, and the same retained requests. Preparation needs no invented model, source ID, run ID or backup. Receiving begins only when the original model operation has completed, its owned services have closed, and its exact native result and complete backup are available.

## What is installed

The local demonstration uses the native Tethys SQLite portal database. This application declares no PostGIS persistent store. The adapter's model files use the current private Paths API, with `USE_OLD_WORKSPACES_API=False`. Its default user scope is retained; shared app storage is not enabled.

A copied Python environment installs Tethys 4.6.1 and a compatible Django 5.2 release. The actual resolved dependency graph is recorded. Fifteen installed Tethys files are compared to the exact reviewed upstream commit, and all 64 installed application files are compared to the original source capsule.

The maintained Tethys CLI generates portal configuration, performs database migrations, installs the app, generates its declared npm dependencies, and collects static files. The actual npm dependency tree and browser resource responses are checked. Python, Node, npm, Playwright and a complete Chromium executable are explicitly selected; this caller does not download a browser or a MODFLOW binary.

Two local demonstration accounts are created through Django's actual user manager. Neither is staff or a superuser. The app's own permission registration creates its namespaced groups, and the native guardian permission grants access to the app object:

| Account | Native group | Groundwater permissions |
| --- | --- | --- |
| Operator | `groundwater_workshare:groundwater_operator` | View, edit, review, execute, publish, receive and back up |
| Reader | `groundwater_workshare:groundwater_reader` | View only |

The operator does not receive runtime administration or shared-workspace permission. Generated credentials and the portal secret stay in the private handover.

The preparation browser signs into both actual accounts. It opens the native launcher, checks the rendered permissions, verifies missing-CSRF and reader creation denials, and verifies anonymous login enforcement. It creates no groundwater workspace. Preparation then closes the server and browser and verifies that both private account roots contain no model database.

## Exact original application

The complete original capsule is Git blob:

```text
ec6a1d1faa4d641835d2853715887ad5481be800
```

It belongs to the reviewed runtime continuation at source head `96a1d66ad032cbbb2640252fedd3f4048a6c8dd6`, built from the original [PR 2312](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2312) application. It contains all 64 application files, including the unchanged publisher originals and complete Tethys adapter. The retained runtime correction separates stable executable/dependency identity from variable legacy version-probe diagnostics. The browser continuation now persists the selected project and reloads the exact detail route and waits for its actual rendered content before interaction, including the restored-workspace pass. Both corrections preserve the original model operation, queued worker, source revisions and phase requests. The native-package reference correction separates selected MF6 block syntax from legacy third-token/unit records and appends an attributed inspection to the same saved source. Original import findings and source/edition IDs remain retained; new reviews and runs bind the current inspection basis. The portal uses its existing edit-workspace permission for this inspection, and the original browser continuation verifies the same inspection after full restore.

The initial portal preparation used capsule `715b64b00e14355a2492b6dc13d701136c2ea684` and stopped during package installation before portal configuration, database or accounts. Its unsaved process namespace became unavailable. The continued preparation explicitly adopts this reviewed source before its first completed installation; it does not claim that the lost partial archive was restored. The actual earlier failure and save outcome remain in the producing operation's observation.

Keep this capsule as an explicit local file. The preparer verifies its Git object hash and every member. The native model result must report that same original source head and application content hash. The portal caller is additive and is kept outside the original application directory during the model run, so adding this continuation does not change that run's source selection.

The exact portal bootstrap sources are listed in [UPSTREAM.json](UPSTREAM.json). The core and adapter guides remain [OPERATOR.md](../OPERATOR.md) and [TETHYS.md](../TETHYS.md).

## 1. Freeze the portal preparation input

Use absolute paths to the actual selected runtime. The command checks the complete source capsule before publishing a create-only input. This example shows the command shape; supply the actual directories and runtime paths for the selected host.

```bash
python3 prepare_input.py --phase prepare \
  --operation-id AQUAVEO-TETHYS-RECEIVING-39DA-20261012 \
  --parent-operation-id AQUAVEO-NATIVE-PUBLISHER-39DA-20261012 \
  --source-capsule /absolute/original-source-capsule.json \
  --work-directory /absolute/private/portal-work \
  --python-executable /absolute/python3 \
  --node-executable /absolute/node \
  --npm-executable /absolute/npm \
  --playwright-directory /absolute/node_modules \
  --chromium-executable /absolute/chrome-headless-shell \
  --operator-username groundwater_operator \
  --reader-username groundwater_reader \
  --slot received-study --port 8898 \
  --output /absolute/portal-preparation-input.json
```

The two accounts, slot, private directory and port are explicit choices in that retained input. The selected private directory must be new or belong to the same original preparation request. An occupied unrelated directory is refused.

The preparation request contains the parent operation's identifier only. It does not claim that the model has run or provide a substitute result.

## 2. Prepare and inspect the real portal

```bash
python3 prepare_portal.py --input /absolute/portal-preparation-input.json
```

The maintained distribution command is equivalent:

```bash
groundwater-portal --python /absolute/python3 prepare \
  --input /absolute/portal-preparation-input.json
```

The process reports actual phases as they start and complete. Package installation and static collection can take several minutes. An existing completed phase is verified before continuation; original accounts and configuration are not replaced.

A successful preparation writes:

- `output/preparation-result.json`: exact source, account, browser and preparation identities.
- `output/Groundwater_Tethys_Prepared_Portal.zip`: the stopped private portal, its copied environment, installed application, collected static files, original account/configuration material and preparation evidence.
- `output/requirements.txt` and `requirements-lock.json`: the actual installed Python dependency versions.
- `output/preparation-browser/browser-result.json`: ordinary-account login, native permissions, CSRF and anonymous-access results.

If an owned phase fails, the process drains its children and writes an interrupted preparation archive with a new retained artifact sequence. Its result remains interrupted. The actual log and private state identify where the same request can continue. A failure during later receiving also captures the current stopped portal, original incoming model result and backup, exact receiving/browser request controls, and pending operation evidence. The pre-receiving installation archive is retained separately. A missing selected browser does not make the account/browser phase complete.

Screenshots are local inspection aids. They are not required members of the saved preparation artifact.

## 3. Preserve the installation before an ephemeral host exits

Save the returned private archive and preparation result from the same producing lifetime. The archive includes generated account credentials, session data and the portal secret. Keep it in the authorized private handover; it is not a public source artifact.

The prepared runtime is bound to the original absolute paths, native platform and recorded base Python/Node shared libraries. It is not represented as a portable runtime for arbitrary operating systems.

When the original private directories are no longer available, inspect the archive's manifest and restore that exact archive to its recorded paths on a compatible host:

```bash
python3 restore_prepared.py \
  --archive /absolute/retained-prepared-portal.zip \
  --bytes ACTUAL_BYTES --sha256 ACTUAL_SHA256 \
  --work-directory /exact/original/private/portal-work \
  --driver-directory /exact/original/portal_native \
  --source-capsule /exact/original/source-capsule.json
```

The restore validates the full archive and each member. It publishes a sibling original restore request before creating the destination, resumes only that same request, preserves executable modes and in-root runtime links, and refuses occupied unrelated material. It does not initialize an account, database, model or native run.

Completed restore replay returns its original historical receipt and leaves later portal changes in place. To inspect present behavior, continue the original portal receiving or open the installed portal. A historical restore receipt is not a claim that later files are still unchanged.

## 4. Bind the actual completed model result

After the original model operation has completed and closed all owned services:

```bash
python3 prepare_input.py --phase receive \
  --work-directory /exact/original/private/portal-work \
  --native-result /absolute/actual/native-result.json \
  --backup /absolute/actual/original-workspace-backup.zip \
  --output /absolute/portal-receiving-input.json
```

This reads the retained preparation instead of accepting a new account, runtime or portal selection. It checks the actual native result's operation, completed state, closed-service statement, source head and exact backup bytes/SHA-256. Relocating the incoming backup is allowed only when its bytes are identical.

The receiver derives source, edition, run, report and operation IDs from the actual immutable database in that verified backup. It does not manufacture them from a template. The source inventory hash, selected result hashes, frozen report archive and every original operation request/result hash are retained.

## 5. Receive, review and reopen the same portal

```bash
python3 run_portal.py --input /absolute/portal-receiving-input.json
```

Or:

```bash
groundwater-portal --python /absolute/python3 receive \
  --input /absolute/portal-receiving-input.json
```

The caller uses the installed original adapter's receiving function to restore into the explicitly selected private slot. The received archive's Python files remain retained source; they are not executed as a replacement for the installed reviewed application.

The ordinary-account browser then:

1. Opens the received workspace through its account-, private-root-, slot- and UUID-bound portal URL.
2. Views the exact original TWRI source, existing native runs, declared units and original comparisons.
3. Opens the frozen report and verifies all four original exports: ZIP, JSON, HTML and CSV.
4. Checks that runtime administration and a missing-CSRF request are denied without changing the workspace version.
5. Signs in as the second reader and verifies that the first account's private URL cannot be used by that account.
6. Uses the original UI to save a private receiver, deliver the exact frozen report and record an attributed local technical receiving acknowledgment.
7. Creates and downloads the complete continued-workspace backup.
8. Reads original operation history, closes the first server, starts the same portal again and reopens the same report, receiving and operation identities.

The browser retains each original action body and operation ID before allowing its dispatch. Lost responses resolve against the native operation reader. An unfinished delivery or backup continues through the same original request. Reopening does not create a second receiver, report, acknowledgment or backup.

The local acknowledgment describes technical receipt by the demonstration operator. It does not claim customer acceptance, site calibration, a field-study outcome or production-tenant commissioning.

The portal phase checks that the selected native run IDs remain unchanged and starts zero model runs. The original scientific distinctions remain visible: executable versus prose recharge, declared legacy/MF6 units, steady-state time context, mapped aquifers, masks, separate rate/volume budgets and original native execution outcomes.

## Receiving outputs

A complete receiving writes `output/portal-result.json` only after its server and browser children have drained. The result binds:

| Result area | Retained evidence |
| --- | --- |
| Original source and data | Source head, workspace ID and immutable selected source/edition/run/report/operation closure |
| Accounts and authorization | Actual ordinary user IDs, native groups, feature permissions and private URL binding |
| Receiving | Original receiver, delivery and technical acknowledgment IDs and exact native requests/results |
| Reopen | A separate browser read after the first server has closed, using the same portal and domain records |
| Backup | Complete continued workspace and the full private portal handover |
| Lifecycle | Zero new model runs and all owned services closed |

`Groundwater_Tethys_Complete_Private_Handover.zip` contains the stopped portal, original complete application, original incoming backup/result/capsule, installed preparation carrier, actual receiving evidence and private account/configuration material. Its manifest lists every retained member's exact size and SHA-256.

A completed result reopens only after its original required artifacts verify. Missing frozen output is reported as unavailable; the caller does not regenerate a new report or current snapshot under the old identity.

## Continuing an interruption

Keep the same input file, work directory, account files, phase receipts and original archives. Run the same command again. Do not remove the portal database or create a replacement account to clear an error.

The parent holds an original worker lock. Direct child processes inherit that lock, and normal shutdown waits for their process groups to drain. An interrupted preparation archive is captured after that drain. If an execution surface loses contact with an active process, use its original process/controller state before dispatching a continuation; absence of a returned response is not proof that the original process stopped.

If a package or native browser is unavailable, preserve its actual installation/error state and supply the same intended runtime closure. This local command does not manage a hosted production tenant.

## Upstream basis

All implementation checks refer to Tethys commit `f030ef90c3441472298e2ab3543cae7f25c91716`:

- [Native dependency declaration](https://github.com/TethysPlatform/tethys/blob/f030ef90c3441472298e2ab3543cae7f25c91716/pyproject.toml)
- [Portal settings and SQLite/current Paths configuration](https://github.com/TethysPlatform/tethys/blob/f030ef90c3441472298e2ab3543cae7f25c91716/tethys_portal/settings.py)
- [Native app permission registration](https://github.com/TethysPlatform/tethys/blob/f030ef90c3441472298e2ab3543cae7f25c91716/tethys_apps/base/permissions.py)
- [Private Paths](https://github.com/TethysPlatform/tethys/blob/f030ef90c3441472298e2ab3543cae7f25c91716/tethys_apps/base/paths.py)
- [Real account login handler](https://github.com/TethysPlatform/tethys/blob/f030ef90c3441472298e2ab3543cae7f25c91716/tethys_portal/views/accounts.py)
- [Database CLI](https://github.com/TethysPlatform/tethys/blob/f030ef90c3441472298e2ab3543cae7f25c91716/tethys_cli/db_commands.py), [configuration/static generators](https://github.com/TethysPlatform/tethys/blob/f030ef90c3441472298e2ab3543cae7f25c91716/tethys_cli/gen_commands.py), and [application installation](https://github.com/TethysPlatform/tethys/blob/f030ef90c3441472298e2ab3543cae7f25c91716/tethys_cli/install_commands.py)

The actual native result is the authority for installation and browser completion. Source publication alone does not establish an installed portal or a received customer study.

### Continuing a stopped receiving phase

If receiving fails after the original model has been restored, its interrupted carrier includes the current portal and original receiving/browser request controls, the exact parent result and model backup, and the earlier prepared installation archive. Restore it with the same command, adding `--native-result` and `--backup` at the exact original paths recorded in `manifest.json` under `original_incoming_paths`. Both destinations must be explicitly supplied; this archive cannot select an unapproved external write path. Existing matching files are verified and preserved. Continue the original receiving input after restore; the initial prepared installation, account identities and already recorded model operations remain the same.

The publisher handover now projects verified native backup/report paths into explicit JSON text fields, preserving each complete original descriptor. The same completed model/browser operation continues through independent receiving and the restored browser; no solver output, run ID or immutable backup is regenerated by this correction.
