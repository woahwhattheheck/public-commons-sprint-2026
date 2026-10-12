# Groundwater operator and receiving guide

This guide follows the complete original workspace from source intake to independent receiving and restore. The same interface runs on loopback and, through the adapter, inside an existing Tethys 4.6.1 portal. Its records describe a model study and its actual outputs. The included TWRI study is a published numerical example; it does not establish a calibrated site model or a customer's acceptance.

## 1. Open the intended workspace

For a new private workspace, use the explicit creation command:

```sh
python3 -B workspace.py init --workspace /absolute/private/groundwater
python3 -B workspace.py serve --workspace /absolute/private/groundwater --port 8892
```

For an existing workspace, run only `serve` or a read command. The database is `groundwater.sqlite`. Existing empty, partial or missing original databases are rejected rather than initialized during a read. An interrupted explicit initializer retains its original identity and temporary publication. A published database that later disappears must be restored from its retained source.

Open the loopback URL, enter the **Operator** name and select the intended project. Tethys supplies the actual authenticated username; its field is read-only. The portal URL binds the account, configured private storage, selected slot and original workspace UUID. Do not move retained browser requests between a loopback workspace and a different portal slot.

Use **Create project** to give the study a name, description and site label. Leave an unknown site blank. The project description should identify publisher examples and assumptions. Settings updates preserve their original version and history.

### Retained drafts and requests

Draft forms survive ordinary refresh and navigation in this browser. Saving first records the complete operation ID, action, payload, target URL and expected workspace version. Only then does the browser send the original request. All new writes are disabled while its outcome remains unresolved.

Use **Read original operation** after an uncertain reply. If it is not yet recorded, **Retry exact original request** resends the same body and ID. A definitive conflict retains the rejected request and draft so the operator can compare current state. **Discard draft and reload current values** explicitly replaces an old form draft with current values. It never reuses a rejected operation ID for changed content.

Original uploaded bytes are not stored in localStorage. Their filename, length and SHA-256 are retained. If a pending upload must be resumed after reopening the browser, select that exact original file; a different size or hash is rejected. A successful committed upload can be recovered without uploading it again.

## 2. Retain and inspect the original source

Open **Sources**.

### Bundled USGS TWRI baseline

Use **Retain publisher baseline**. This captures the unchanged builder, paired prose, environment/developer references and relevant licenses as fourteen distinct originals. It creates one baseline edition without executing Python or a solver.

The builder pin is `MODFLOW-ORG/modflow6-examples@8be96e1727483c9c908977a5b8233eb5c5bbeef9`, file `scripts/ex-gwf-twri.py`. Its SHA-256 is `e1a388a73ad97f04aa6a7f7a8b77170c20565c28bd1e785d466fb2f47461b3dc`. [publisher/manifest.json](publisher/manifest.json) binds all originals.

Open the original inventory, use **View original text** for readable sources and **Download original** for the exact bytes. The text preview is bounded; a large or binary original remains a verified download.

### Complete native model package

Use **Import original model ZIP** for a supplied native model. The original ZIP is limited to 64 MiB, with at most 5,000 regular files and 512 MiB expanded content. Paths must be unambiguous and relative. Encrypted members, symlinks, duplicate paths and references outside the retained tree are refused.

Select the actual MF6 simulation namefile and legacy namefile. Provide explicit aquifer layer pairs, for example `[[0,0],[2,1],[4,2]]` only when that map describes the supplied model. Record intended units separately from actual native declarations. The parser follows literal FILEIN, OPEN/CLOSE and legacy EXTERNAL unit mappings and exposes missing references. A package with blocking selection/reference findings cannot be run. Uploaded Python is retained as source and is never executed by this generic intake.

Generated files from an actual retained run may themselves be captured as an original package with their native file paths. Do not label a source filename mentioned in prose as an uploaded file unless those bytes are present.

## 3. Understand the publisher findings

| Finding | Original observation | Operator treatment |
| --- | --- | --- |
| Recharge wording | Executable line 68 is 3e-8; paired prose is 3e-7 ft/s | Keep both. The unchanged baseline executes the script. A changed value requires an attributed scenario. |
| Legacy unit declaration | MF6 writes feet/seconds; the legacy builder omits DIS codes, which default to metres/days in FloPy 3.11.0 | Keep actual declarations. Correct only a selected derived scenario when that assumption is explicitly reviewed. |
| Steady solution | One stress period, one step, numeric length 86400; no MF6 storage package and a steady legacy model | Describe equilibrium outputs. Do not call them a transient daily hydrograph. |
| Aquifer representation | Five MF6 layers represent aquifers and confining beds; legacy uses three aquifers with confining-bed handling | Compare 0/2/4 against 0/1/2, preserving each model's grid. |

The current scientific reference also includes [FloPy's pinned legacy DIS constructor](https://raw.githubusercontent.com/modflowpy/flopy/a43f79127d0383e5328a602e72faf9a9730c7d61/flopy/modflow/mfdis.py), whose defaults define the original metadata discrepancy. The operator records findings and explicit dispositions rather than silently changing that source.

## 4. Create and review an immutable scenario

Open **Editions** and the intended parent. The page shows the parent SHA, full original parameters and source. It supports:

- **Recharge:** select the change, enter an exact decimal string and a reason. The source's intended rate unit is feet/second.
- **Existing wells:** select an original well by its index and cell, enter the exact new rate and a reason. Negative rates withdraw; positive rates inject. Locations retain their original aquifer correspondence.
- **Legacy unit declaration:** select the attributed feet/seconds correction and explain why it is appropriate for this derived study. The unchanged baseline remains available.

Give the scenario a name and purpose. **Save immutable scenario** creates a child edition; it does not mutate the parent or run a model. Subsequent corrections create another child. Generic native packages remain complete independent sources rather than being rewritten through a TWRI-specific editor.

Use **Save named review** on the exact edition. Every required finding needs an explicit disposition and reason. **Approve exact edition/result** is available only after required findings are acknowledged and no blocking or changes-required issue remains. **Request changes** retains that decision without enabling scenario execution.

For the publisher acceptance journey, the first derived edition changes only legacy unit metadata. Its numerical inputs remain unchanged, making it a clearly attributed compatible reference. A second child changes a selected recharge value. The driver labels these as operator demonstration scenarios; they are not customer recommendations.

## 5. Configure the actual native runtime

Open **Runtime** and choose existing absolute executable paths. The complete selection is:

- Python 3.11 or later with FloPy 3.11.0 and modflow-devtools 1.7.0;
- publisher-compatible Matplotlib at most 3.9.4, NumPy, pandas, GitPython and packaging;
- MODFLOW 6 **6.8.1**;
- MODFLOW-2005 **1.12.00 double**, selected as **mf2005dbl** from executable release 29.0.

The runtime inspection executes only version/dependency probes. It records binary hashes, actual versions, Python/platform identity and installed direct/transitive distribution-file fingerprints. It does not download dependencies or run a model.

An administrator can prepare one environment using the documented optional dependency group and [examples/prepare_runtime.py](examples/prepare_runtime.py). The helper calls the retained original FloPy acquisition API separately for MF6 6.8.1 and executable release 29.0's mf2005dbl. Do not use the older MF6 bundled in release 29.0.

Keep the private model workspace outside a Git checkout. The unchanged publisher builder's repository discovery can select shared examples/figures directories; the native adapter refuses that execution location.

## 6. Queue, execute and recover the same original run

On an edition, enter the native purpose and choose **Create queued run**. Queueing retains:

- source and edition identities;
- the complete reviewed application file manifest and exact source bytes;
- actual configured binary/dependency fingerprints;
- the original operation ID and request.

Open the run and choose **Execute original run**. A fresh attempt contains the exact original source, generated model inputs, both actual executable invocations and all output files. Native children inherit the original worker lock. The publisher baseline uses its unchanged builder, both actual solvers and its original plots/assertion. A derived scenario uses the same builders with only the selected reviewed changes.

Use **Refresh** to observe progress. An incomplete run exposes its original attempt log and issue. A live worker is returned without a second execution. A reserved but undispatched attempt resumes its same preparation. After an interrupted dispatch, inspect the retained attempt, then explicitly select the retry checkbox to start a new attempt under that same run. Earlier attempt files remain intact.

After restore, an operator may explicitly rebind paths only to a runtime with identical complete fingerprints. That changes the saved host paths with attribution, not historical source, result or runtime identity. A previously prepared request tied to an unavailable original path remains explicit; it is never silently rewritten.

A completed result must still have all original files. If a completed file is missing, readback returns unavailable. It does not regenerate current outputs and label them as the old result.

## 7. Read the actual numerical result

Completion requires both actual native executions, successful exits, normal termination evidence and fresh output closure. The original publisher Python function returning normally is insufficient: its MF6 failure branch only prints a buffer and can skip the legacy solve.

The run page displays:

- each solver's exact runtime, arguments, output evidence and termination;
- each engine's actual declared length/time units and native output precision;
- original `kstp`, `kper` and `totim`, with unit basis;
- mapped aquifer metrics, per-side masks and jointly valid cell counts;
- package budgets and native listing budgets;
- exact files and SHA-256 values;
- derived head maps and original publisher figures.

### Masks and comparisons

Head values can be finite sentinels. The reader uses actual model activity, constant-head definitions, dry/no-flow sentinels and finite checks. MF6 negative idomain is vertical pass-through and excluded; legacy negative IBOUND is a valid constant-head cell. It reports exclusions separately for each engine and the number of jointly usable cells.

Cross-engine physical metrics require compatible horizontal grids, selected aquifer mapping, actual output steps/times and declared units. Incompatible results keep their numerical comparison and reasons while withholding a physical same-unit difference. The unchanged publisher all-cell criterion—maximum absolute numeric head difference below 0.05 in each aquifer—is retained separately. Passing it does not resolve the baseline unit declaration conflict.

**Compare** selects two complete original runs. The viewer retains both runtime/source/edition identities and exact steps. It does not align time records merely because they occupy the same array index. Comparisons remain tied to those immutable original outputs.

### Budgets

Budget rates use each native model's length cubed per time. Listing cumulative volumes are separate. The reader explicitly maps CHD/CONSTANT HEAD, DRN/DRAINS, WEL/WELLS and recharge terms. Internal face-flow arrays and DATA-SPDIS are not external inflow/outflow. Unmatched labels remain visible and require review rather than being silently counted twice.

The original plot normalizes specific-discharge vectors. Arrow length represents direction after normalization, not discharge magnitude. Derived maps show model-local rows/columns and declared units; no unprovided geographic CRS is assumed.

## 8. Review and freeze the complete report

Use **Save named review** on the run. The review binds the exact native-result hash. Review every actual finding, including any missing listing or unrecognized budget term. A successful solver is a numerical completion, not approval.

Open **Reports**, select the reviewed run, enter a title and purpose, and explicitly select comparison runs. **Freeze complete report** retains the original result, edition, source, runtime, review, generated model inputs, every output and all selected comparison originals. It creates one immutable JSON/CSV/HTML/ZIP closure. Reopening verifies those same bytes.

The CSV is a scientific summary, not a substitute for the native binaries. JSON uses scientific decimal strings; the original binary head/budget files remain authoritative. Keep HTML beside the complete received package so figures and original-file links resolve.

## 9. Deliver and independently receive

Open **Receiving**. Save a named receiver pointing to an existing private directory outside the source workspace. In Tethys, the selected private Paths root confines this directory. The receiver version is retained in the delivery.

Choose the report, receiver and purpose, then **Deliver exact package**. The original delivery record commits before the copy. **Read back original file and receipt** verifies that copy. **Continue original delivery** finishes the same saved filename and package after an interrupted copy; it does not create a new report or delivery ID.

Independently receive the exact archive:

```sh
python3 -B workspace.py inspect-package --archive /absolute/received/report.zip
python3 -B workspace.py receive-package --archive /absolute/received/report.zip --destination /absolute/new-report-receiver
```

The receiving request binds the complete archive and manifest before extraction. Repeating it reopens the same original package. An unrelated occupied destination is refused. An interrupted original lock/request publication can be resumed only with its exact saved archive identity.

Only after actual verification should a receiving reviewer choose **Accepted** or **Corrections requested**, enter their name, timezone-qualified occurrence time, original reference and reason, then **Save named receiving decision**. The technical demonstration's receiver acknowledges a complete example package; it does not claim site-design approval.

## 10. Capture and reopen a full workspace

After every solver child has stopped, open **Backup** and choose **Create complete backup**. Capture includes the original SQLite, operation requests/results/history, source objects, all retained native attempts, reports, deliveries and complete application source/assets. It does not recursively embed prior backup archives.

An interrupted capture remains queued or failed under its original ID. **Continue original backup** resumes that capture. If an already captured database lacks its original capture marker, the workspace reports an ambiguous capture rather than taking a newer database snapshot under the old identity.

Restore to a new empty destination:

```sh
python3 -B workspace.py restore --archive /absolute/original-backup.zip --destination /absolute/new-restore
python3 -B workspace.py state --workspace /absolute/new-restore/workspace
python3 -B workspace.py serve --workspace /absolute/new-restore/workspace --port 8893
```

The immutable received payload stays under `new-restore/received`; the operating database is under `new-restore/workspace`. The restored UUID, source/edition/run/report IDs and operation requests/results remain the originals. A restored running attempt becomes interrupted. Historical backup rows are labelled **external_archive**, preserving their prior identities without offering a nonexistent local download. No solver starts automatically.

A replayed original operation returns its historical result with current state. Replaying an exact run-execution request also continues its queued side effect if no native dispatch ever occurred; an already dispatched attempt still uses explicit **Continue original run**. Runtime fingerprints compare the actual executable and dependency content. Raw version diagnostics remain visible observations, including legacy Fortran process IDs and addresses, and are not treated as binary changes. Use the original run, report and operation pages to verify receiving. Installation of archived Python code is a separate administrator choice; the Tethys adapter always imports the configured reviewed core, not code from an uploaded archive.

## 11. Tethys and complete native receiving

[TETHYS.md](TETHYS.md) documents installation into an existing portal, account permissions, private Paths slots, exact CSRF/actor binding and a receiving continuation. No portal/account is created by a model run.

[examples/NATIVE_WORKFLOW.md](examples/NATIVE_WORKFLOW.md) gives the one complete native journey. It preserves one original operation configuration and its exact per-phase requests across continuation. It performs the unchanged dual baseline, a metadata-aligned reference, a browser-authored scenario, actual native comparison/review/report/delivery, independent receiving, backup and restored UI readback. It records completion only after owned services and children drain. Missing dependencies, a failed solver or a lost original artifact remains an actual incomplete outcome.
