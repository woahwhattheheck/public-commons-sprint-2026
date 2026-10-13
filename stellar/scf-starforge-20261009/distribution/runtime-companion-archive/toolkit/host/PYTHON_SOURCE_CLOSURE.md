# Complete Python source selection and receiving

Use this collector when an original Python programme must travel with its complete
local imports and selected resources. The collector reads source with the running
Python standard library's AST parser. It does not import the selected application,
load its plugins, query installed packages, run a customer programme, install a
dependency or contact a provider.

The public JavaScript collector remains at `host/source_closure_cli.cjs`.
This Python entrypoint is independent of Node and uses the same ordinary
source-materialization layout: exact original packet, operation identity,
complete source directory, private staging area and completion record. The two
language analyses have distinct schemas. Neither silently interprets the other's
packet.

## Collect, inspect, receive, reopen

Use Python 3.10 or newer. Select the actual source root and the original ordered
import roots. Supply actual script or module entrypoints and every required
resource. An application with Python launchers and browser assets needs its
browser HTML, JavaScript, CSS and other assets explicitly retained; the existing
JavaScript collector can produce that complete source selection.

```sh
python3 host/python_source_closure.py collect \
  --root /original/checkout \
  --spec /original/selection.json \
  --output /owned/complete-source.json.gz --gzip

python3 host/python_source_closure.py inspect \
  --input /owned/complete-source.json.gz

python3 host/python_source_closure.py receive \
  --input /owned/complete-source.json.gz \
  --directory /owned/original-source-receiving
```

The first command retains whole source even when recognized imports or dynamic
selections remain incomplete. Exit 2 carries that complete packet and the exact
missing references; correct the original selection using those actual
observations. A source IO, identity or changed-working-tree error returns exit 1.
Successful complete collection, inspection and receiving return exit 0.

Reopen with the same command and same original input. The receiver accepts a
new directory or an existing ordinary empty directory; an interrupted receive
continues with the identical packet. A different packet, changed received file,
unselected file, unexpected directory or symlink is rejected. Use a separate
explicit receiving directory for a deliberately different source edition.

The received tree is:

- `operation.json`: original uncompressed packet identity, full file roster and selected directories.
- `source-packet.json`: complete original uncompressed JSON bytes.
- `source/`: every complete selected source/resource file, under its original path.
- `pending/`: private temporary writes, outside the selected source.
- `complete.json`: original operation with a relative source-directory pointer.

The completion file uses `source_directory: "source"`. The command response
also gives its current absolute path. Move the complete receiving directory
together and reopen it through its retained packet; original identities survive
the move. Run an application only through its existing owner-controlled command
after selecting the received source. Receiving itself executes no application.

## Source selection

The selection is an explicit part of the source edition. A typical shape is:

```json
{
  "schema": "commons.python-source-selection/v1",
  "label": "Original application and native tools",
  "module_roots": ["application", "capture/source-engine", "."],
  "entrypoints": [
    {"module": "example_application.__main__"},
    {"script": "native/original-journey.py"}
  ],
  "resources": [
    "application/requirements.txt",
    "application/example_application/web/index.html",
    "application/example_application/web/app.mjs",
    "application/example_application/web/style.css",
    "native/browser-journey.mjs"
  ],
  "external_modules": ["requests"],
  "dynamic_imports": []
}
```

Those names illustrate a selection; they are not a claim that those files exist
in a checkout. `host/examples/python-source-closure-self.json` is the runnable
selection for the real complete public collector and its guide.

### Entry contexts and import roots

`{"module": "package.tool"}` resolves that exact module through the declared
roots, includes its parent package initializers and scans it with its real
package context. This is an exact module-import selector. For the original
`python -m package` entry, select `package.__main__` explicitly; importing a
package alone does not imply running its main module. `{"script": "tools/run.py"}` scans the file as `__main__`
with no package. A script's directory is **not** automatically appended to the
selection: include its actual search directory in `module_roots` when that is
how the original launcher operates. A relative import in a plain script is
reported as an error.

The selection models ordinary filesystem Python source under the supplied
ordered roots. The resolver follows each dotted component, retaining
`__init__.py` for regular packages. A module file stops subpackage lookup.
Namespace package portions accumulate across roots until a regular package or
module wins according to search order. Selected import-root and namespace
directories are explicit packet members, including empty portions. Receiving
recreates those ordinary directories as well as full file bodies, so an empty
selected namespace remains importable after transfer. A regular package confines its children
to that package directory; a namespace package searches all selected portions.

Parent source is collected even when a later child is missing, so the
incomplete result still carries useful original files. From-list names can be
attributes: an actual local submodule is included when it exists, but an absent
attribute-name module is not invented. This is a conservative source selection:
all syntactic import branches, including conditional and type-checking branches,
are inspected, and an existing from-list submodule may be retained even when
runtime initialization supplies an attribute of the same name.

Builtin and frozen module classification precedes ordinary source lookup. Declared local
source otherwise wins over standard-library or explicitly declared external
modules. Standard-library, builtin and actual frozen-module name lists are retained from the original
Python interpreter; inspection reuses that original classification. The
collector does not load environment packages to discover dependencies.

Custom meta-path finders, zipimport, extension modules, generated modules,
runtime changes to `sys.path`/`__path__`, monkey-patching and selected
plugin entry points need the original operator's explicit roots and mappings.
The result does not claim to reproduce arbitrary runtime import hooks. Select
required native libraries, wheels, generated source and configuration as whole
resources and use the original runtime installer for their activation.

### External dependencies

Imports outside local source must match the retained standard-library
classification or `external_modules`. A declaration such as `requests`
covers `requests` and its dotted descendants. A more specific declaration
covers only that module and descendants. An undeclared, absent top-level module
is an incomplete source result, so a typo cannot silently become an installed
dependency.

External declarations select dependency boundaries; they do not prove an
installed version or download a package. Retain the original requirements,
lockfiles, wheel metadata and complete required artifacts as resources. Keep
their actual installation/receiving with the existing runtime owner.

### Resources

Resources are exact complete relative paths. There are no implicit globs,
whole-home scans or environment-secret discovery. Binary files use canonical
Base64; decodable UTF-8 source remains readable. Every member retains its byte
count, SHA-256, Git blob SHA-1 and ordinary executable/non-executable mode.

A Python resource is preserved but is not automatically executed or treated as
an entrypoint. If a custom loader imports that file, give it an explicit loaded
module context in the corresponding dynamic selection so its own imports are
also traversed. Scripts started by an original subprocess launcher belong in
`entrypoints` when they need independent import analysis, and remain under
their original controller for actual execution.

## Dynamic imports and plugins

Literal `importlib.import_module` calls and its directly imported aliases
are resolved when their argument binding is unambiguous. A literal relative
name also needs its literal package, or the unchanged `__package__` from the
current context. The simple one-argument absolute `__import__` form is
resolved, including `builtins.__import__` and imported builtins aliases. Richer builtin arguments, rebound import aliases, computed module
names, plugin entry-point calls and explicit file loaders retain the **whole
original expression**, its source SHA and AST position.

Inspection reports an unmapped dynamic call as incomplete. Copy its exact
`source`, `line`, `column` and `expression` into the original selection,
together with that file's full SHA-256 and the complete operator-selected
modules/resources:

```json
{
  "source": "application/example_application/plugins.py",
  "source_sha256": "ACTUAL_64_CHARACTER_SOURCE_SHA256",
  "line": 27,
  "column": 8,
  "expression": "importlib.import_module(selected_plugin)",
  "modules": ["example_application.adapters.original_plugin"],
  "resources": ["application/example_application/adapters/original-settings.json"]
}
```

A custom file loader may give a module a name unrelated to its on-disk
directory. For that exact source-bound call, add explicit loaded contexts:

```json
{
  "source": "application/example_application/bootstrap.py",
  "source_sha256": "ACTUAL_64_CHARACTER_SOURCE_SHA256",
  "line": 18,
  "column": 11,
  "expression": "importlib.util.spec_from_file_location(module_name, engine_path)",
  "modules": [],
  "resources": [],
  "files": [
    {
      "path": "capture/source-engine/core.py",
      "module": "original_source_engine",
      "package": ""
    }
  ]
}
```

These examples require replacement with actual source observations before use.
Mapping identity checks include the full source hash and complete expression.
A changed source edition, changed expression, duplicate position or unused
mapping is an error. Empty selections are rejected. Multiple legitimate
module contexts are all retained; scanning never executes the custom loader.

A local package star import (`from package import *`) can implicitly load
submodules named by the package’s `__all__`. It therefore retains the entire
original `ImportFrom` expression as a dynamic selection. Select the full
intended local module population from the original package declaration; the
collector does not execute or guess a computed/rebound `__all__`. Ordinary
module and external star imports keep their existing explicit dependency
boundary.

A dynamic call can be mapped to several original modules and resources when
the operation deliberately supports multiple known selections. Keep the full
selection, rather than replacing it with one sample plugin. Unknown runtime
choices stay as unresolved expressions until their actual intended source is
selected.

AST discovery covers the documented import forms and recognized importlib,
builtin and plugin/file-loader calls. Arbitrary application wrappers cannot be
identified as importers merely from their names; retain their actual provider
mapping and selected modules/resources. Source selection is an explicit
operator input, not a claim that static analysis predicts every runtime action.

## Reusable Python API

```python
from python_source_closure import collect_source, inspect_source, receive_source, json_bytes

packet = collect_source(original_root, original_selection)
raw = json_bytes(packet)
checked = inspect_source(packet)
received = receive_source(packet, raw, original_receiving_directory)
```

`collect_source` returns complete file bodies and graph observations.
`inspect_source` replays the original source-search observations and parser
analysis from the complete packet. It verifies every file identity and requires
the original contexts, graph, errors, dynamic selections and coverage to agree.
It does not consult a checkout or current installed third-party environment.

Use a Python version that understands the original source syntax. The packet
retains the original implementation/version. A receiving interpreter unable to
parse that source or reproduce its analysis returns an explicit error; it does
not silently rewrite the source. Full original bytes remain available.

`receive_source` requires complete coverage and original matching packet bytes.
It stages complete writes beside the original operation, publishes each file
exclusively and rereads every received member. Existing identical files are
reused. Mode is reduced to owner-only read/write with owner execute when the
original ordinary source was executable.

`SourceError` exposes `code`, its plain message and complete `detail`.
Native IO errors retain their actual class/message in the command's JSON.
Do not relabel an interrupted native opening as a source/parser result.

## Coherent source and limits

A filesystem collection caches whole original reads, retains every positive
and negative lookup, then rereads selected bodies and search outcomes before
publishing. A changed working source or changed lookup fails publication.
The original negative lookup observations travel with the packet so an
independent inspector can reproduce the selected filesystem search semantics.

Default ceilings are 8,192 files, 64 MiB of source, 8 MiB per file, 100,000 lookup
observations and 100,000 AST references. The selection may lower each ceiling
through `limits`; raising these ceilings requires a deliberate maintained
source change. Complete JSON is bounded at 256 MiB and compressed input at
128 MiB. Gzip output is deterministic for the same exact source and
classification. Source packets never include a changing capture timestamp.

Publication creates an exclusive staged file, flushes it, and links the complete
bytes into the intended output. An existing different output is preserved.
Interrupted receiving reuses only the same original packet and complete
existing bytes. An ordinary exactly-empty receiving directory is accepted even
if a prior opening ended before publishing `operation.json`.

These are local source operations. Keep them in a directory controlled by the
original receiving owner. They do not provide an isolation boundary against
another process with permission to mutate that owner's directories mid-call.

## Whole native self-source course

From the public repository containing this exact source:

```sh
python3 host/python_source_closure.py collect \
  --root . --spec host/examples/python-source-closure-self.json \
  --output /owned/python-source.json.gz --gzip
python3 host/python_source_closure.py inspect --input /owned/python-source.json.gz
python3 host/python_source_closure.py receive \
  --input /owned/python-source.json.gz --directory /owned/python-source-original
python3 /owned/python-source-original/source/host/python_source_closure.py inspect \
  --input /owned/python-source-original/source-packet.json
python3 /owned/python-source-original/source/host/python_source_closure.py receive \
  --input /owned/python-source-original/source-packet.json \
  --directory /owned/python-source-original
```

This is a complete source → gzip → inspect → independent materialization →
received-tool inspection → same-operation reopen course. Keep the five actual
command outputs and original packet together. It does not start a customer
application or exercise a replacement model.

For a selected customer programme, use its unchanged complete source and actual
launch configuration as input, retain all browser/native data resources and
review every unresolved original selection. Continue the customer application
only with its existing native writer and case. Private customer source,
capture data and original runtime secrets stay on their authorized private
delivery surface; the reusable public collector contains none of them.

## Original language references

- Python import system, packages, namespace portions and search order:
  https://docs.python.org/3.12/reference/import.html
- Standard AST source locations and parsing:
  https://docs.python.org/3.12/library/ast.html
- `import_module`, relative names and package arguments:
  https://docs.python.org/3.12/library/importlib.html
- Source encoding declarations:
  https://docs.python.org/3.12/library/tokenize.html#tokenize.detect_encoding

## Owner-directed product use

Retain the original application's owner instructions with its source and
receiving guide. Before presenting a client/prospect-facing application or
attachment as ready, open/run/render its exact outgoing version, look at the
actual pixels, operate important controls, inspect relevant desktop/narrow
and populated/empty/error states, download and reopen its complete outputs,
and repair defects in that original workflow. Every attachment counts.
Source/parser results and another worker's approval do not replace actual
product use. This collector changes source delivery; the original application,
provider, runtime and visual receiving retain their existing owners.
