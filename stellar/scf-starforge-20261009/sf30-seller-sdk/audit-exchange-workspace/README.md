# Audit Exchange

Audit Exchange is a local working application for original BuildingSync audit XML, source corrections, official validation, source-bound operational reviews, native energy analysis and complete building handover.

The same durable project is available through an industrial browser interface, Python/Node commands, a typed JavaScript client, local MCP and the maintained Starforge Applications/Merchant lifecycle. The operator's complete original XML remains the source of every view.

## Start a project

The application requires Python 3.11 or newer and lxml. Node 22.16 or newer runs its Node CLI and agent adapters. Install the Python dependencies into the host's selected environment:

~~~sh
python3 -m pip install -r requirements.txt
python3 application.py init --directory /absolute/private/audit-project --name "Audit review"
python3 application.py serve --directory /absolute/private/audit-project --port 8769
~~~

Open the exact local URL printed by the server. The server binds 127.0.0.1 and announces the original project and running-instance identities. Working projects live outside the application source directory.

The equivalent Node command is:

~~~sh
node cli.mjs serve --directory /absolute/private/audit-project --port 8769
~~~

AUDIT_PYTHON selects an explicit Python executable for Node commands. The native analysis runtime is installed separately as described in ANALYSIS.md; a queued project operation never installs packages.

## Complete the working review

Import a complete original XML and choose its schema/profile requirements. The browser exposes native facilities, buildings, actual systems, measures, scenarios, resources, references, fields and every original time-series row.

Review exact scalar values and source relationships. A field correction records its original expected value and becomes a new complete XML revision. A replacement keeps the first original and every intermediate revision. Source comparison lists the complete scalar and relationship changes.

Save a review with its title, state, owner, due date, note and evidence. Each review names an exact source revision and optional native entity. Link an existing Haystack, LDA or turnover record through an explicit sidecar. Save an edition to freeze source revisions together with the current review, sidecar and analysis state.

OPERATOR.md contains the complete browser workflow. CORRECTIONS.md describes the complete colleague-return flow: proven source ancestry, original/current/returned native comparison, explicit field or full-document choices, selected returned reviews, an atomic original-project save and complete onward handover.

## Native standards and identities

standards/standards.json identifies the exact retained XSD, imported gbXML XSD, official Schematron profiles, publisher examples and original notices. standards/AUDIT_CONTRACT.md records the interoperability decisions and exact eight-table receiving contract.

The lxml XMLSchema and ISO Schematron engines execute the retained original files. The external XSD import resolves only to its exact local gbXML asset. Complete SVRL remains with every selected profile result. Original XML declarations and the selected validation schema are separate fields.

IDs and IDREFs resolve inside one original XML document. Namespace prefixes do not change native identity. Unknown extension content, comments and processing instructions remain in original bytes and subsequent complete XML revisions. Projection uses actual native entity locations and namespaces.

The official combined L100/BSyncr example contains 84 time-series rows across seven separate streams. Total energy, peak demand and cost keep their original quantities and units. Missing units and missing ReadingType remain explicit source facts. Shared systems retain their actual building relationships.

## Native energy work

Select the exact source revision, native building, scenario, resource and stream. Supply complete observed weather, its source reference, explicit timezones, weather units and observed interval. The original nmecr package runs its eleven-model catalogue with actual applicability and model outcomes.

When the original stream has no native building association, the operator can deliberately bind an actual native Building for analysis. Original empty associations remain intact. A stream explicitly shared across buildings requires an appropriate source allocation before a single-building model.

The application retains full XML, literal readings, weather, options, native frames, fitted R objects, statistics, predictions, plots, logs, dependency identities and model checkpoints. A recoverable runtime interruption can continue the same analysis ID through analysis.resume. Input corrections create a deliberate new original analysis. ANALYSIS.md documents the complete native options and runtime installer.

## Turnover and editable receiving

Choose the original physical assets, supporting audit records and proposed review requirements. Preview all eight consumer tables before saving. The export carries the exact CSV columns, full XML, model, validation and SVRL.

Physical systems become proposed asset rows only through deliberate selection. Utility energy streams remain audit readings. Review and acceptance fields stay available for the receiving operator.

Export an original XML, current or saved-edition HTML review, full workspace, or full application plus workspace. Complete editable packages contain every original source/revision, validation and receiving history, saved edition, review, sidecar, analysis input/output and ordinary delivery. Outer ZIP inventories identify every retained file by path, byte length and SHA-256.

Receive the complete package into another project through the browser's receiving view or workspace.receive. The receiver creates its own local operating identifiers, preserves original native XML identities and receiving history, rebuilds native views with the delivered engine, and keeps all current and saved-edition output links usable. The complete application package includes this source and its guides under application/.

## Commands and native agents

~~~sh
python3 application.py action --directory /absolute/private/audit-project --request-json /absolute/request.json
python3 application.py analysis-work --directory /absolute/private/audit-project --analysis-id ORIGINAL_ANALYSIS_ID
~~~

A complete mutation envelope has action, inputs, requestId (UUID) and expectedVersion. Inputs include actor and note. Retain that whole envelope before sending. A repeated identical envelope returns its original saved result even after later workspace changes; another input under the same UUID is rejected.

Read requests use action and inputs. The complete catalogue is in catalog.mjs. source.page pages the original model; source.bytes and export.read return successive SHA-bound byte ranges; operation.get retrieves the saved original mutation result.

MCP borrows the already running application:

~~~sh
node mcp.mjs --url http://127.0.0.1:8769/ \
  --workspace-id ORIGINAL_WORKSPACE_ID --instance-id ORIGINAL_INSTANCE_ID
~~~

The browser/Node client is client.mjs. HTTP uses GET /api/state, POST /api/action and GET /api/download/ID. Native actions/downloads carry X-Audit-Workspace-Id. GET /api/identity exposes the pinned original running instance. The CLI, browser and agents share the same SQLite project and version checks.

MERCHANT.md describes host-pinned original input aliases, complete-file import, explicit instance reconnection and managed agent setup. The distribution's audit-exchange source selection carries the application through the existing build, installer, Applications and Merchant surfaces.

## Complete native commissioning

COMMISSIONING.py and BROWSER_COMMISSIONING.mjs operate the actual server, original upstream fixtures, durable revisions, saved review state, full exports, native analysis and independent receiving. Their case directory retains complete requests and outcomes and can continue the same original operation.

The five publisher fixtures are interchange examples. Their original descriptions and source identities travel with the application. A project's own measured sources and observed weather remain explicit separate inputs.
