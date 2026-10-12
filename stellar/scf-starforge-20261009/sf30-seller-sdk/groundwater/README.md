# Groundwater scenario workspace

A complete local and Tethys operator for retained groundwater models, explicit scenarios, both native MODFLOW solvers, numerical review, frozen reports and independent receiving. It is part of the maintained Stellar Forge seller SDK and uses one original Python workspace behind the browser and Node customer interface.

The bundled study is the unchanged USGS MODFLOW 6 TWRI example at commit `8be96e1727483c9c908977a5b8233eb5c5bbeef9`. Fourteen publisher source and license files are retained with their exact byte counts and SHA-256 values in [publisher/manifest.json](publisher/manifest.json). They are examples, not a customer site model, calibration or accepted engineering design.

## What the operator completes

- Retain the publisher baseline or a complete original native-model ZIP, inspect every original and resolve literal native file references.
- Create immutable scenarios with an exact parent, original and selected recharge/well values, and attributed reasons. Preserve the legacy unit metadata discrepancy in the original baseline.
- Review each edition, queue its source/application/runtime identities and execute MF6 and MODFLOW-2005 double precision under one original run. Inspect actual solver receipts, heads, masks, budgets, listings, plots and file hashes.
- Compare original runs with explicit aquifer, grid, time and unit compatibility. Review the actual result before freezing a report.
- Deliver the complete frozen package, verify it independently, record a named receiving decision and restore a full workspace backup into a new destination.
- Open the same interface in a configured Tethys 4.6.1 portal using its real account, permissions, CSRF and private Paths storage.

Read [OPERATOR.md](OPERATOR.md) for the complete workflow, [API.md](API.md) for original request/response shapes, [TETHYS.md](TETHYS.md) for portal installation and receiving, and [examples/NATIVE_WORKFLOW.md](examples/NATIVE_WORKFLOW.md) for the one complete publisher journey.

## Start the original operator

Use Python 3.11 or later. Reading, editing source records and receiving packages do not install or run a solver.

```sh
python3 -B workspace.py init --workspace /absolute/private/groundwater
python3 -B workspace.py serve --workspace /absolute/private/groundwater --port 8892
```

Open `http://127.0.0.1:8892`. Enter the named operator, create a project and retain its original source. An existing database is opened without creating a replacement identity. Explicit `init` is the only CLI creation path.

For an installed Python package:

```sh
python3 -m pip install /absolute/reviewed/groundwater
starforge-groundwater init --workspace /absolute/private/groundwater
starforge-groundwater serve --workspace /absolute/private/groundwater
```

The wheel includes the complete reviewed application, UI, publisher originals, guides and adapter source. It does not install native dependencies implicitly.

## Native runtime

| Component | Required original selection |
| --- | --- |
| MODFLOW 6 | 6.8.1 from MODFLOW-ORG/modflow6 release 6.8.1 |
| MODFLOW-2005 | 1.12.00, executable **mf2005dbl**, from MODFLOW-ORG/executables release 29.0 |
| FloPy | 3.11.0 |
| modflow-devtools | 1.7.0 |
| Python | 3.11 or later |
| Matplotlib | Publisher-compatible version at most 3.9.4; optional dependency group selects 3.9.4 |
| Additional Python dependencies | NumPy, pandas, GitPython and packaging with their complete installed dependency closure |

Release 29.0 contains an older MF6 binary. Select only `mf2005dbl` from that archive and obtain MF6 6.8.1 separately. [examples/prepare_runtime.py](examples/prepare_runtime.py) uses the retained original FloPy download helper with those two exact releases after the administrator supplies an environment containing the declared Python dependencies. Runtime configuration records actual executable bytes, versions and installed dependency fingerprints; it does not accept a version label alone.

Keep model execution outside a shared Git checkout. The unchanged publisher script discovers a parent repository and otherwise redirects its examples/figures there; the native adapter refuses such a path.

## Scientific distinctions retained

The executable recharge is **3e-8 ft/s**, while its paired prose says **3e-7 ft/s**. MF6 declares feet/seconds; the unchanged legacy builder omits DIS unit codes and FloPy defaults declare metres/days. The source intends feet/seconds, but that intent does not replace the actual native declaration. A separately attributed scenario can correct the legacy declaration.

This is one steady solution with numeric period length 86400 and one step. It is not a transient 24-hour hydrograph. Aquifers map from MF6 layers 0/2/4 to legacy layers 0/1/2. Dry, no-flow, inactive, pass-through and nonfinite cells remain explicit. External budget rates and cumulative volumes remain distinct; internal face flows and specific-discharge metadata are excluded from external mass-flow totals. The publisher's normalized arrows do not depict discharge magnitude.

The unchanged publisher all-cell numeric criterion remains visible separately from physically comparable metrics. A numeric match does not resolve the declared unit conflict.

## Maintained Node customer surface

```js
import {GroundwaterWorkspace} from "./index.mjs";

const workspace = new GroundwaterWorkspace({
  workspace: "/absolute/private/groundwater",
  python: "/absolute/environment/bin/python"
});
const state = await workspace.state();
const original = await workspace.action({
  action: "project.create",
  actor: "Named operator",
  operation_id: "my-original-project-request",
  expected_version: state.workspace.version,
  payload: {name: "Reviewed model study", description: "", site_label: ""}
});
const readback = await workspace.operation("my-original-project-request");
```

`initialize(workspaceId?)` is explicit creation. All other methods open the original database. `action` forwards the original request to the Python core; there is no second Node journal. `inspectPackage`, `receivePackage` and `restore` use the same complete-file verification.

The maintained distribution command is `groundwater`, which invokes [cli.mjs](cli.mjs) and the original Python CLI. Set `STARFORGE_GROUNDWATER_PYTHON` to the installed environment's executable when required.

## Recovery and release status

Every operator request retains its exact operation ID, payload and expected version before dispatch. A lost reply is read back from that original operation. Uploaded model bytes stay outside browser storage; reselect the same file and verify its size and SHA if an undecided upload must resume. A completed native result or export with missing retained files is unavailable; recovery does not calculate a replacement under the old identity.

Source publication, syntax checks, native execution, named numerical review and receiving acceptance are separate facts. The supplied native journey records its actual outcomes only on an equipped host. A source merge does not claim that a solver or Tethys portal has run.

Authored code is MIT licensed; bundled publisher licenses and attribution remain beside the unchanged originals.
