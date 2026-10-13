# Scenario design application receiving

This installer composes the complete original Scenario design component into the current scientific application. Follow [CONSERVATION_DESIGN.md](CONSERVATION_DESIGN.md) for the saved-plan and editor workflow.

## Complete application installation

The source cohort includes the current original editor, its complete source manifest,
the original conservation binding, the native provider and browser descriptor,
and `operator/install_conservation_design.py`. Receive the entire cohort in the
same application source directory before invoking the installer.

From the receiving application's existing Python environment:

```sh
python -B SOURCE_ROOT/operator/install_conservation_design.py \
  --application CURRENT_APPLICATION --source SOURCE_ROOT
```

The installer uses the current application's `install_extensions.py` to compose
the shared server and browser. It adds `scenario-design` to the actual current
`model/portable.py` application directory inventory and, when present, the
current `source_tools/application_assembly.py` snapshot inventory. The current
assembler reads its directories from the installed portable source and remains
unchanged. Earlier assemblers with a literal root tuple receive that one addition.
These are surgical inventory joins: current SQLite snapshot handling, source exclusion
rules, unrelated directories and other component registrations remain in their
original implementations.

Both the earlier portable inventory with an explicit root-file list and the
newer portable inventory that walks all ordinary root files are supported.
The original portable collector must expose its maintained literal directory
tuple. The assembler may use either its earlier literal root tuple or the current
`_installed_source_directories` resolver that reads this portable declaration.
Other inventory implementations are reported for composition before writing.

The original `model/conservation.py`, `model/common.py`, `model/rasters.py`
and `model/workspace.py` are dependencies of the receiving application. The
complete current original `model/conservation_bindings.py` and
`model/conservation_scenarios.py` are included, so the installed design adapter
can resolve an original saved plan and its actual native model scope. The
receiving check requires the maintained scope-resolution methods before
installing; current native coverage and paired-experiment implementation stay
with the original scenario module. Installation compiles incoming Python
sources without running tests or native model jobs. The editor's manifest
checks every original editor source member.

`--preview` returns the complete proposed source paths, predecessor and
postimage hashes. Normal installation checks the current dependency and target
bytes, preserves predecessor files in its operation history, restores unchanged
postimages if the write sequence fails, and records the completed installation
at `operator/conservation-design-install.json`. A repeat installation with
the same source is safe; an independently edited component is surfaced for
composition instead of being overwritten.

### Cumulative source receiving

Use the existing cumulative staging directory. After the maintained shared host
and original Conservation sources have been joined, and before source checking,
snapshotting and archive construction:

```python
from pathlib import Path
import runpy

application = Path("CURRENT_STAGING_APPLICATION")
installer = runpy.run_path(str(application / "operator/install_conservation_design.py"))
result = installer["install"](application, application)
```

The cumulative owner should use the installer's complete `FILES` cohort for
its presence check. A wholly absent component can be skipped. A partially
received component must list its missing members and continue source receiving
before producing the final application. The installer is inside `operator/`,
so existing application source collection carries the reinstall entry point.

For an in-memory composer, `inventory_sources(sources, *, directories=("scenario-design",))` accepts the actual
current path-to-source mapping and returns the complete portable and optional
assembler postimages. It changes only their directory literals; the composer
keeps its existing conflict and source-receipt behavior. Other complete received
components can pass their explicit root directories to the same helper, for
example `("scenario-design", "measurement_workspace", "observations", "source_data")`.
The default remains the original editor namespace. Existing roots stay in order
and names already present are retained once.

### Original editor, saved designs and reopening

Restart the current operator after installation so its maintained registry
discovers `conservation-design.json`. Scenario design lists the original saved
Conservation plans. Prepare a selected plan and download its complete editable
project ZIP.

Run the supplied editor with the same application's Python environment:

```sh
cd CURRENT_APPLICATION/scenario-design
python server.py --workspace ORIGINAL_DESIGN_WORKSPACE
```

The loopback editor listens on port 8848 by default; `--port` selects another
local port. In the editor, receive the complete project ZIP, create an alternative,
edit its original polygons, select explicit land-cover inputs, and export the
native handover ZIP. Back in the original operator, receive that handover through
the normal queue. Reopen the saved receiving record and follow its original
scenario and optional prepared native run.

A scientific Workspace backup now includes the complete editor namespace.
Prepared projects and native handovers already live under the Workspace's
`conservation-design/` directory and travel with the existing recursive data
inventory. The maintained extension restore hook calls the original
`get_preparation` and `get_receiving` validators for every retained operation,
checking the saved binding, file identities, original plan reference and native
scenario/run relationships.

The standalone editor's draft database belongs to its chosen
`ORIGINAL_DESIGN_WORKSPACE`. To transfer an in-progress draft, use the editor's
complete project export and receive it in the destination editor; this preserves
its alternatives and edit history. A scientific Workspace archive includes
the prepared/exported files retained inside that Workspace.

The complete native receiving journey is: original plan → prepared project →
edited project → native handover → original scenario/run → Workspace backup →
new-directory receiving → reopened design operation. Use the real retained IDs
and original geometry at each stage.

## Retained provider composition

The installer reads the current descriptor's original provider factory and adds its workspace verification method in memory. Existing binary upload, draft recovery, embedded-editor routes and task controls stay in that actual source body. The added method reuses the original saved-operation validators. An already registered workspace verifier remains owned by its current provider. The current descriptor's version, routes, actions, assets and client capabilities are preserved.

The separate receiving helper and this guide are additive public application source. The original component and its current scientific prerequisites remain their authors' maintained files.
