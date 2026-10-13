# Complete mixed application source

Use this workflow when one application has Python workers or services, Node modules,
browser modules and explicit data or presentation assets. It composes the maintained
Python AST collector and JavaScript/HTML collector into one exact source edition and
one receiving directory. Existing distribution builders can use the Python API or
CLI without changing their product declarations, archive rules or native controller.

## Required tools

Python 3.10+ and an existing Node executable are required. No package is downloaded.
Keep these complete files together under their original paths:

- application_source_closure.py and application_source_bridge.cjs
- python_source_closure.py
- source_closure_cli.cjs and connected_javascript_source_closure.cjs
- vendor/acorn-source-closure/acorn.cjs
- the original Python/JavaScript guides and Acorn SOURCE.json/LICENSE

The packet pins all six executable source files by full byte count, SHA-256 and Git
blob identity. Inspection requires those same bytes. This makes later reopening use
the original resolver version. Receive the tools alongside the application when
the recipient does not already have that edition; keep their normal host/ layout.

## One original recipe

The selection schema is commons.application-source-selection/v1. It has:

| Field | Meaning |
|---|---|
| label | Readable name for this source edition |
| python | Complete original commons.python-source-selection/v1 selection |
| javascript | Complete original commons.javascript-source-selection/v1 selection |
| resources | Additional complete relative file paths shared by the application |
| directories | Explicit empty or populated ordinary directories to retain |

Both language selections are mandatory. Supply the actual Python module_roots in
their actual search order, explicit script/module entrypoints and source-bound dynamic
selections. A module entry means an import; use package.__main__ for python -m package.
Select the actual Node/browser entry files and exact served URL-to-source mappings.
A browser URL is not inferred from a repository directory.

For example, a Python package serving a separately located browser client can select:

    {
      "schema": "commons.application-source-selection/v1",
      "label": "Operator workspace",
      "python": {
        "schema": "commons.python-source-selection/v1",
        "module_roots": ["application"],
        "entrypoints": [{"module": "operator_workspace.__main__"}],
        "resources": [],
        "external_modules": [],
        "dynamic_imports": []
      },
      "javascript": {
        "schema": "commons.javascript-source-selection/v1",
        "paths": ["application/operator_workspace/public/app.mjs"],
        "routes": [
          {"url": "/app/app.mjs", "path": "application/operator_workspace/public/app.mjs"},
          {"url": "/app/client.mjs", "path": "browser/client.mjs"}
        ],
        "resources": []
      },
      "resources": [
        "application/operator_workspace/public/index.html",
        "application/operator_workspace/public/style.css",
        "README.md"
      ],
      "directories": ["application/operator_workspace/templates"]
    }

The example is a shape explanation. Use your actual source paths and routes.

Python's complete selected files are also supplied to the original JavaScript
collector as explicit resources. That collector scans any retained JavaScript/HTML
bodies and follows their literal source requests. Shared resources participate in the
same scan. A Python worker discovered as a JavaScript file resource remains a complete
resource until its actual Python module/script context is selected: the report lists
such bodies as retained_python_resources. Do not silently assume a worker's package,
module search path or launch working directory.

## Collect, inspect and receive

Create an ordinary private output directory first. Select an existing writable
temporary directory if the system temporary filesystem is full.

    python3 host/application_source_closure.py collect \
      --root /absolute/original-source \
      --spec /absolute/application-selection.json \
      --output /absolute/output/application-source.json.gz \
      --gzip --node /absolute/node \
      --temporary-parent /absolute/private-temporary

    python3 host/application_source_closure.py inspect \
      --input /absolute/output/application-source.json.gz \
      --node /absolute/node \
      --temporary-parent /absolute/private-temporary

    python3 host/application_source_closure.py receive \
      --input /absolute/output/application-source.json.gz \
      --directory /absolute/recipient/original-operation \
      --node /absolute/node \
      --temporary-parent /absolute/private-temporary

The receiver creates operation.json, source-packet.json, pending/, source/ and
complete.json. source/ contains the complete original file layout and selected
namespace/empty directories. Run the SAME receive command to continue an interrupted
receive or confirm the completed source. Existing member bytes must match exactly.
The receiver creates no application process and changes no existing project state.

An exactly empty ordinary receiving directory is accepted if interruption occurred
before operation.json was published. An unidentified nonempty directory is rejected.
Once the operation exists, only the same original decompressed packet bytes can
resume it. A later source edition needs its own receiving directory.

After inspection and receipt, use the application's existing installed launcher,
working directory and configuration. Those remain the original product's responsibility.
This workflow does not execute application code or replace its installation process.

## What the packet preserves

There is one complete file table. Each row independently binds its selected path,
mode, complete UTF-8 or canonical Base64 body, bytes, SHA-256 and Git blob identity.
A repeated blob at two paths creates two independent path rows. A path-bearing
cache entry cannot substitute an earlier path for the currently selected member.

The original Python and JavaScript analyses retain their schemas, every ordered
member reference, selected contexts, import edges, external dependencies, computed
expressions, errors and limits. Their bodies refer to the common file table.
Reopening reconstructs their complete original packets before calling the maintained
inspectors. The original Python parser environment and all positive/negative filesystem
search observations remain present.

The combined collector rejects these concrete inconsistencies:

- The same source path has different bytes or executable modes between collectors.
- A new JavaScript/resource member contradicts an original Python missing-file or
  file/directory search observation.
- A file is also a directory, or paths differ only in portable case aliases.
- An exact selected source changes before both collectors finish.
- A retained source member, collector analysis, selection, tool identity or directory
  population changes during inspection.

All selected source bodies are reread from the same original root after both language
collectors finish. Python's original lookup observations are rechecked as well.
This is a coherent captured source edition under the original collectors' read/recheck
model; callers requiring an immutable repository snapshot should supply one.

Every explicit resource, selected file and empty namespace portion remains included.
No minification, newline conversion, path remapping or source evaluation occurs.

## Scope and computed selections

COMPLETE means both original collectors completed their documented source scope.
Python handles its selected filesystem import contexts and requires explicit mappings
for unresolved computed or wildcard imports. JavaScript follows literal imports,
re-exports, dynamic literals, require literals, new URL resources, HTML scripts/styles
and exact browser routes. Its computed expressions, external package requests and
filesystem URLs remain visible in the complete report.

A JavaScript computed import is not made complete by a guess. Select its complete
original runtime source/resources explicitly and retain the expression for the
operator's review. The original collector reports the number and bodies of these
expressions. Installed packages, Python external modules, CSS URLs, generated paths,
plugin loaders and runtime configuration are not inferred by this wrapper.

The full packet preserves resources even when they are not parsed as executable
source. retained_python_resources makes that distinction explicit. To cover one of
those Python bodies as executable code, add its actual context to the original
Python selection and recollect from the original source root.

## Programmatic API

Import from the trusted installed host directory:

    import application_source_closure as application_source

    packet = application_source.collect_application(
        original_root, complete_selection,
        node="/absolute/node", temporary_parent=private_temporary)
    original_raw = application_source.json_bytes(packet)
    application_source.inspect_application(
        packet, node="/absolute/node", temporary_parent=private_temporary)
    receipt = application_source.receive_application(
        packet, original_raw, original_receiving_directory,
        node="/absolute/node", temporary_parent=private_temporary)

The bridge only invokes the existing source_closure_cli.cjs collect/inspect APIs.
It uses small file-based requests and complete bounded response files, so the source
does not enter the shell argument string or depend on an interactive pipe session.

The ordinary outer CLI returns 0 for complete source, 2 for an incomplete original
analysis, and 1 for a source/operation error. It emits full structured output.
A collector timeout retains its error and stops that original parser process.

## Self-source receiving

host/examples/application-source-self.json selects this complete product, both
unchanged language collectors, the pinned original Acorn distribution/license and
all three guides/recipes. The meaningful native course is:

1. Collect the complete maintained product from its actual source root.
2. Inspect the packet using the original tools.
3. Receive it into a new original private operation.
4. Invoke the received Python tool against the same packet.
5. Repeat the original receive and compare the complete source identities.

That course exercises the real composed application source, parser bridge, coherent
reread, common table, full receiving layout and independent reopening without creating
a second customer application or provider operation. Actual execution status belongs
with the returned native result; source review alone is not a native pass.
