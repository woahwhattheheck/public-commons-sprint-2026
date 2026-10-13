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


## Retained interactive file previews

backend.file_routes registers typed responses for a named /api/file/ family.
The original file-cookie authorization, verified ticket lookup, byte-range
handling, content type and send_file response remain in use. The provider
returns the original (ticket, content_security_policy) pair. No source text or
filesystem path is sent as a JSON response in place of the file.

The existing watershed report adapter supplies this exact registration:

    "file_routes": [{
      "path": "/api/file/scenario-report/{workspace_key}/{report_id}",
      "handler": "preview",
      "args": ["route.workspace_key", "route.report_id"],
      "response": "ticket_policy_pair"
    }]

Its backend provider is scenario_decision_reports.ScenarioDecisionReports,
constructed with operator and fault. The published preview(workspace,
report_id) validates both retained identifiers, inspects the original report,
registers its HTML with operator._ticket, and returns that ticket with its
existing PREVIEW_POLICY. The host forwards that policy unchanged to send_file.

The handler joins the file route before the ordinary /api/file/TICKET branch:

    if app.extensions.has_file_route(url.path):
        authorized(file=True)
        reply = app.extensions.file_reply(url.path)
        return send_file(reply["ticket_id"],
                         download=one("download") == "1",
                         content_security_policy=reply["content_security_policy"])

File paths declare a literal family and individual opaque ID parameters.
Parameter values are passed explicitly through route.NAME binding arguments.
Templates cannot capture the original generic ticket route or the original
review-desk family. Overlapping registered file templates are rejected.
Returned tickets retain their original workspace. A returned content policy
cannot contain header line breaks.

The current S1 report policy enables its retained inline scripts inside the
existing sandbox while denying network connections and object embedding. The
host uses the policy returned by the actual adapter; it does not construct a
replacement policy. Source adapter inspected: operator/scenario_decision_reports.py
SHA256 78f1c3b7568d2a4c32dfc004247232f713347dbdd1d06906c3b191066bcd1370.

A previously installed authored report-preview hook can remain while receiving
the first integrated desk. It runs through its original handler. When that
desk migrates fully to its manifest, remove its redundant explicit route/action
joins together so the registration has one active owner.

The installer accepts the exact first published registry/guide hashes as
predecessors for this upgrade and retains unknown current edits for composition.
It also migrates the first workspace-detach join after the original open-draft
guard, preserving the active desk when a workspace switch is rejected.

## Nested retained GIS members and current host composition

A file provider can declare one final relative member parameter with three dots:

    "file_routes": [{
      "path": "/api/file/gis-project/{workspace_key}/{kind}/{project_id}/{member_path...}",
      "handler": "member",
      "args": ["route.workspace_key", "route.kind", "route.project_id", "route.member_path"],
      "response": "ticket_policy_pair"
    }]

This matches the actual GISProjects.member(workspace, kind, key, name) provider. The host decodes the member path once as UTF-8, accepts nested relative inventory members and keeps the original provider responsible for exact inventory membership. Empty, absolute, parent-relative and backslash paths are rejected before calling the provider. Named workspace and project identifiers remain separate opaque URL segments. All route families are checked for overlap, including a final member tail. The response retains the existing authorized file cookie, same-workspace ticket, content security policy, byte-range and download behavior.

The complete host edition composes the original seven-file source/run-owner bank F0C8PRVG4EN with the typed-file successor F0C8TKYRX52. Its browser host retains the current lazy getProgramme capability. The installer migrates the original openProgramme callback before checking for an existing host instance, so updating an already installed app creates one host. It also preserves the corrected new-versus-revised delivery title and supplies the registered action name when the original action label table has no entry.

Apply this complete bank to the same assembled application as the source/run components, then run that bank's install_extensions.py against the actual application root. Existing sources that match the known previous editions can be upgraded directly. Current unrelated authored edits are composed before replacement. The complete decisions bank supplies its own saved-assessment and upload manifest.

## Route payload and import contract for adapter authors

The original HTTP handler runs normal authorization before every registered JSON route. A GET route passes its parsed query dictionary; a POST route passes the decoded request object. The workspace is selected from the same request's workspace value (or the original operator's primary workspace), and the registry supplies both workspace_key and the real operator.ws(workspace_key) object as explicit binding contexts.

A backend factory receives only its declared arguments. For example, a flat operator module can declare factory handler create and args [operator, fault], or use an existing class name. Fault is the original operator exception constructor: Fault(code, message, status). Flat operator imports use the original server's module search path; scientific code imports from model. Invoke bindings can receive the complete original task, or operator/workspace_key/action/payload as requested. The original task queue owns action submission and result retention.

A route's operation is its explicitly declared string, distinct from its URL. A provider can therefore bind read(workspace_key, operation, payload) to several routes without reparsing the HTTP request. backend.state accepts one explicit key and handler; a failed extension registers an issue in the original /api/extensions catalogue while the other desks remain available. The full decisions.json in the saved-assessment bank is an executable example using the same route and invoke contexts.

## Preserve an existing native state projection

An extension may explicitly declare `backend.state.when_missing: true` when its original overview is a compatibility fallback for the same native Workspace projection. The registry preserves any already-present value for that exact key, including an empty list or null, without calling or overwriting it. If the key is absent, the original provider contributes its ordinary state. The flag must be a JSON boolean; omitting it retains the existing collision error, and two extension providers still cannot register the same state key.

Scenario analysis uses this contract for `scenario_analyses`: the native Workspace already projects the original `analyses/*/summary.json` records, while older receiving applications use the same provider overview. Its installer requires the matching descriptor and registry before accepting that maintained native projection. Analysis identities, source records, queues, item handlers and downloads are unchanged.
