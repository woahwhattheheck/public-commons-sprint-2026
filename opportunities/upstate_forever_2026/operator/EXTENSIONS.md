# Explicit operator extensions

The extension host joins additional desks to the existing Upper Savannah application. Installed JSON manifests declare each desk's Python provider, queue actions, authenticated HTTP routes, browser factory, lifecycle methods, navigation, styles, retained item kinds, state contribution, task downloads and receiving verification.

The existing Operator remains the execution boundary. Submitted actions keep the original operation identity, request hash, single-worker task queue, workspace gate, resume/cancel behavior and task records. The existing HTTP handler keeps authentication and the original verified download tickets. This package contains source plumbing and the actual bindings for source preparation, native-run comparison and saved scenario decisions; it introduces no scientific calculation.

## Install into the current receiving application

Receive the complete current application and authored desk sources. This package adds:

- operator/extension_registry.py
- operator/web/extension_host.mjs
- operator/extensions/source-preparation.json
- operator/extensions/native-run-desk.json
- operator/EXTENSIONS.md
- install_extensions.py

The decisions package supplies operator/extensions/decisions.json alongside its backend and browser bridge. The installer copies it when present in the selected source root and preserves an existing semantically identical JSON registration.

Run on the receiving host:

    /opt/pyvenv/bin/python install_extensions.py \
      --application /mnt/data/eco12-source \
      --source-root /path/to/received/upstate_forever_2026

The installer composes changes from the actual current server.py and app.mjs. It prepares every change and parses Python before replacement, preserves the existing task decorators and static asset set, and checks source bytes at each replacement boundary. An incompatible current anchor identifies the specific join that needs composition. --dry-run prints the exact intended changed files and hashes without replacing source. The installer never executes a scientific run.

The current source family is the original operator edition with spatial, communities and customer reviews, including the separately published programme installer. The installer keeps those integrations in place. A desk should have one active owner: either its previous explicit shared-file joins or its manifest. Backend action collisions appear in the extension catalogue and keep the existing owner active. Remove only the redundant joins for the desk being migrated. Other desks remain unchanged.

The normal server command gains repeated --source-root DIR options. A registered source manifest's parent directory also remains available to SourcePreparation. Browser selections identify a registered source directory and a relative path; they do not supply arbitrary host paths.

## Installed registrations and original source contracts

| Registration | Existing implementation | Original queue actions | HTTP reads |
| --- | --- | --- | --- |
| source-preparation | source_preparation.SourcePreparation; source_workbench.createSourceWorkbench | source.prepare; source.compose | GET or POST /api/source-preparation/catalog, /files, /progress, /result |
| native-run-desk | run_workbench.attachRunWorkbench | Existing run.prepare, run.start and run.compare | Existing /api/state, /api/item and original task APIs |
| decisions | decision_workbench; decision_bridge.attachDecisionWorkbench | decision.view.save | GET /api/decisions/catalog and /api/decisions/view?view_id=ID |

Source preparation binds the current revision 3 constructor SourcePreparation(operator, fault, source_roots), read(workspace_key, operation, payload), invoke(task), and decorate_task(task). Its browser controller exposes mount, update and suspend. The native-run controller exposes mount, update, detach and dispatch; its declared global action prefix is run-desk-. The decisions controller exposes mount, update and detach, with decision-specific listeners owned by that desk.

The native-run desk's original openDelivery callback receives {baseline_run_id, scenario_run_ids}. The installer passes this selection to the existing complete delivery form. An existing programme controller receives openProgramme(selection) through programmes.create({selection}); otherwise that optional callback resolves a separately registered programmes controller. Current native-run source may ignore that optional capability until its callback-enabled successor is received.

Source provenance inspected for these bindings:

- Source preparation revision 3: operator/source_preparation.py, SHA256 9226020ab55543a0678f6047f6f440d3c9b094f51220116071ec1573313ffd0f.
- Source browser: operator/web/source_workbench.mjs, SHA256 ca52add2895be2576177917f175d1ade1a5d1acf964fc96766e399f92961b97f.
- Native-run browser: operator/web/run_workbench.mjs, SHA256 ea827bce28f537a6dd88270a1142c33e4c2d8816def3c9df3bd2c7c71b0616e9.
- Original source and programme implementation: https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/f4cb7c70a92f2db6a469ddffcca10f69ef5bdf4d/opportunities/upstate_forever_2026
- Decisions implementation: https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2632

## Python manifest contract

Each application-owned operator/extensions/*.json has schema upstate.operator-extension/v1 and a stable id. These files are installed source, not files loaded from an uploaded scientific workspace. Providers are explicit trusted Python modules; browser imports are explicit installed /web/ modules.

A backend binding identifies handler and an ordered args array. Available context names are:

| Name | Meaning |
| --- | --- |
| operator | Existing Operator instance |
| fault | Existing Fault exception class |
| source_roots | Explicit operator source-root directories |
| workspace_key | Existing registered workspace key |
| workspace | Original Workspace object |
| action | Current queued action name |
| payload | Exact action or HTTP input object |
| task | Original retained queue task |
| operation | Explicit operation name declared by the route or item binding |

Bindings may also supply kwargs mapping parameter names to context names. backend.module chooses the provider module. Optional backend.factory creates a provider instance. Individual bindings may specify a different module for a dedicated verifier.

backend.actions plus backend.invoke add action admission and worker dispatch. backend.routes declares exact GET/POST paths and read/preview handlers. Expensive work remains an original queued action. backend.items optionally adds an /api/item kind. backend.state contributes a unique key to state.data. backend.decorate_task adds downloads using the original provider's verified tickets. backend.verify_workspace executes inside the original receiving flow before the received workspace is registered.

Registration validates all bindings before committing routes or actions. A failed desk has an issue in GET /api/extensions while other desks remain available. Actions, routes, items and state keys cannot overwrite an existing declared owner. Static assets preserve the original operator's HTML, module and CSS transport. The source registry accepts only canonical relative installed paths.

ExtensionRegistry public methods:

    load()
    handles_action(action)
    invoke(task)
    has_route(method, path)
    read(method, path, workspace_key, payload)
    has_item(kind)
    item(workspace_key, kind, id)
    extend_state(workspace_key, data)
    decorate_task(task)
    verify_workspace(workspace)
    manifest()

accepted_actions, item_kinds and web_assets expose the additional registered names. manifest() returns schema upstate.operator-extensions/v1, browser-safe registrations, explicit reads/actions, state keys, registered static assets and per-desk issues. Backend module names, factory bindings and filesystem source roots are not sent to the browser.

## Browser host contract

createExtensionHost(host) uses the existing getState and api functions. Desks receive the declared existing capabilities: endpoint, refresh/refreshState, getWorkspace, openItem, showTask, showRunLog, openDelivery, toast, navigate and any additional integration-owned functions. The original delegated navigation handler continues to handle data-view buttons.

Use these hooks once in the original app:

    await extensions.load();                      // after successful session authentication
    extensions.update(state);                    // every accepted refresh, including task-only changes
    if (extensions.render(view, content, state)) return;
    if (await extensions.dispatch(button)) return;
    extensions.detach();                         // workspace switch
    extensions.hasView(view);                    // navigation admission

The installer supplies those joins. extensions.title(view) resolves an extension label; diagnostics() returns current local registration/import/lifecycle issues. openExtension(id, method, ...args) supplies an optional cross-desk bridge.

An active controller mounts once per selected node/workspace. Later state refreshes call its registered update method without replacing the form. If the workspace or view changes during a module import, the previous selection cannot mount afterward. A queued browser action waiting for an import verifies the same workspace before dispatch. Failed modules show a local retry control. Other views stay usable. Desks with their own listeners keep them; only explicit nonoverlapping action_prefixes reach the shared dispatcher.

## Saved assessments and receiving verification

The decisions state contribution is data.decision_views. GET /api/decisions/view accepts view_id. Its optional /api/item alias uses kind=decision-views and forwards both id and view_id. decision.view.save runs through the original task queue. The source record retains operator selection, computed assessment including the normalization cohort/ranges, and the actual source snapshot.

The decisions manifest calls model.decisions.verify_all(workspace) before original receiving registration. The existing recursive portable application/workspace archive carries the new source and retained records. The registry adds the verifier hook; it does not replace archive validation or introduce another backup format.

## Focused behavior check

Run the single dependency-free lifecycle check with Node:

    node operator/web/extension_host.check.mjs

It exercises delayed module completion across a workspace switch, per-desk registration failure, task-only refresh without remount, explicit action dispatch and cancellation of an action whose workspace changed. This check passed in the available JavaScript runtime with 16 assertions. Python source is parsed by the installer on the receiving host; the complete application there supplies the real model/provider imports.

Scientific calculations remain in their authored modules. Their domain review belongs with the associated scientific implementation and the actual retained source/output data.
