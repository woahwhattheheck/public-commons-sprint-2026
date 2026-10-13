# Independent component declarations

The application can retain a new component through a small owned JSON file in
`integration/component_fragments/`. The existing
`integration/application_components.json` remains the edition baseline.
Assembly and cumulative installation compose that baseline with every retained
fragment before checking source, dependencies, native inputs and installed
postimages. A component author can therefore publish its complete implementation
and one declaration without editing the shared baseline.

The first adopted fragment is `monitoring-report.json`. It retains the six
Monitoring report files and requires the original Monitoring and observed-context
components. Its component definition and edition selection moved out of the
baseline in the same change that introduced the loader. Existing report
preparation, native campaigns, ordered report selections and installation
commands continue to use their original APIs.

## Declare a component

Create a direct JSON member whose filename equals its `id`, for example
`integration/component_fragments/monitoring-report.json`. Use UTF-8 text and
the schema `upstate.application-component-fragment/v1`. Component and fragment
identities use lowercase letters, digits, dots, underscores or hyphens, starting
with a letter. Nested fragment directories are rejected.

The adopted declaration has this shape:

```json
{
  "schema": "upstate.application-component-fragment/v1",
  "id": "monitoring-report",
  "source_reference": "https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/3317",
  "components": {
    "monitoring-report": {
      "title": "Retained Monitoring designs and campaign revisions in ordered scientific reports",
      "paths": [
        "model/MONITORING_REPORT_SOURCE.md",
        "model/monitoring_report_cli.py",
        "model/monitoring_report_source.py",
        "operator/extensions/monitoring-report.json",
        "operator/monitoring_report_native.py",
        "operator/web/monitoring-report.mjs"
      ],
      "requires": [
        "monitoring",
        "observed-context"
      ]
    }
  },
  "extend_components": {
    "core": {
      "paths": [
        "integration/COMPONENT_FRAGMENTS.md"
      ]
    }
  },
  "required_components": [
    "monitoring-report"
  ]
}
```

`components` contains complete definitions for new component identities. A
definition uses the same fields as the baseline: its title, complete retained
`paths`, component `requires`, and optional `import_roots` and
`source_manifests`. Every new definition needs nonempty source paths. Include
all the implementation, extension declarations, browser assets, guides and
source manifests that the feature requires; the fragment complements the
existing import and resource inspection.

`required_components` explicitly adds component identities to the edition's
selected set. Defining a component does not by itself select it. A component may
also become selected through another selected component's `requires`.
A fragment may select an existing component or a definition supplied by another
fragment. References are validated after all definitions have been collected,
so filename order does not require a dependency to be declared earlier.

`source_reference` is optional provenance. Use a public source commit or pull
request for generic published implementation. The loader retains this value
alongside the fragment's path, byte count and SHA-256. It does not fetch or
execute the referenced location.

## Extend an existing component

Use `extend_components` when adding retained members to a component that already
exists. Only four append-only arrays are accepted: `paths`, `requires`,
`import_roots` and `source_manifests`. Existing entries keep their order and
new entries are appended once.

For example, the adopted Monitoring report fragment adds this guide to the
existing core component. Another integration could append a complete adapter
path and a dependency without restating core's large source list:

```json
{
  "schema": "upstate.application-component-fragment/v1",
  "id": "example-adapter",
  "extend_components": {
    "core": {
      "paths": ["operator/example_adapter.py"],
      "requires": ["example-engine"]
    }
  },
  "required_components": []
}
```

This example requires an actual `example-engine` definition and an actual
adapter file in the application; it is not a declaration to install as written.
Extensions cannot rename a component, change its title, remove members, replace
metadata or change an existing dependency. Those changes need an explicit edit
to the component's owning definition.

The same component identity cannot appear in both `components` and
`extend_components` in one fragment. To define a new component, include its
complete initial arrays directly. A later fragment may append to it.

## Deterministic composition and errors

The loader reads direct JSON members in sorted relative-path order. It first
collects every complete component definition, then applies extensions and
selected components in that same order. It preserves baseline member order,
preserves additions in their authored order, and validates the complete
dependency graph, including unselected definitions.

The following fail with a concrete error:

- A filename that differs from the fragment identity, nested declarations,
  duplicate identities, or a duplicate JSON object key.
- A new component identity already defined by the baseline or another fragment,
  even when the repeated definitions happen to match.
- An extension to an undefined component, an undefined selected component or
  dependency, or a dependency cycle.
- Unknown top-level fragment fields, unsupported extension fields, repeated
  entries within one array, or non-string array members.
- Absolute, noncanonical, parent-traversing or backslash paths.
- Nonfinite JSON numbers, missing complete UTF-8 text, or a fragment with neither
  definitions nor extensions.

Directory inspection also rejects fragment paths reached through symbolic-link
aliases. The ordinary component closure continues to validate actual source
presence, imports, local resources, source-manifest members and binary identity.
A valid declaration cannot replace missing implementation or source bytes.

## Identity and complete source retention

Each discovered fragment is a required source member of the application
inspection, including a fragment that defines an optional component. Its exact
UTF-8 bytes are retained. Line endings and whitespace participate in the
fragment SHA-256; directory reads do not normalize CRLF into LF.

With fragments present, the effective catalogue includes a
`component_fragments` list. Each record contains `id`, `path`, `bytes`,
`sha256` and the optional `source_reference`. The closure report exposes the
same records as `component_fragments`. The effective catalogue's normal
`catalog_sha256` consequently binds both the composed declarations and the
exact fragment identities.

Retain fragment declarations as ordinary source-map or directory files. They
cannot be stored inside `integration/source_binary_inputs.json`; the loader
rejects a fragment declaration in that embedded source-input bank. This keeps
catalogue control files available before native input collection in both source
and installed-directory inspection.

Publish and transfer the fragment files with their implementation. Copying only
the baseline catalogue would omit a selected component's declaration; copying
only a computed report would omit the authored source. The existing recursive
portable source inventory already retains the integration and source-tools
directories.

The catalogue hash intentionally changes when a fragment is added, edited or
removed. The cumulative installer compares the effective catalogue hash before
and after installation. Source-map inspection and installed-directory inspection
must see the same fragment text and baseline, so an incomplete copy or a
changed declaration cannot silently pass that comparison.

## Source maps, directories and explicit overrides

The default `source_tools.application_components.inspect(document)` reads the
baseline from `document["files"]`, discovers fragments in that same source map,
and composes them before dependency and retained-file inspection.

`inspect_directory(root)` discovers and composes the directory's fragments
before collecting selected native source manifests and declared binary members.
It then uses the same inspection rules and identity calculation. This ordering
allows a fragment to introduce a component whose original source includes a
native input bank, rather than finding that declaration only after file
collection has finished.

The helper is importable with the application package and through the existing
cumulative installer's `runpy` bootstrap. It resolves its companion module
beside the retained loader; a caller need not add uninstalled application code
to `sys.path`.

An explicit `inspect(document, catalog=override)` remains a complete catalogue
override. It does not automatically discover or merge fragments. A caller that
deliberately supplies a catalogue retains responsibility for its complete
selection. Existing assembly and cumulative installation use the default
discovery path.

When there are no fragments, the original catalogue object and ordinary closure
report are unchanged. No empty provenance fields are added and the prior
catalogue hash is preserved. This is the compatibility path for earlier source
bundles and installations.

## Inspect an assembled application

From the actual application root, with its existing Python environment:

```sh
python -B - <<'PY'
import json
from pathlib import Path
from source_tools.application_components import inspect_directory

report = inspect_directory(Path("."), required=True)
print(json.dumps({
    "selected_components": report["selected_components"],
    "catalog_sha256": report["catalog_sha256"],
    "component_fragments": report.get("component_fragments", []),
}, indent=2))
PY
```

Use the actual interpreter used for the application if it is not named
`python`. This command performs the ordinary required closure inspection and
prints its selected components and retained fragment identities. Existing
assembly and cumulative installer commands require no new fragment flags.

For a source-map consumer, keep the original `document["files"]` and
`file_metadata` contracts. Add the exact fragment text under its application
relative path along with every declared implementation and source member, then
run the same existing `inspect` or `require_complete` operation.

## Publish and migrate without losing peer work

For a new component, use an owned identity and direct fragment file, publish the
complete source, and run the existing component closure through the actual
assembly or installation course. Other owners can add different fragments
without editing that file or the shared baseline.

To migrate a component already declared in the baseline, move its complete
definition and any explicit required selection into the new fragment in one
atomic source change. Preserve its component identity, paths, dependencies and
metadata. Remove only that definition and its prior selection from the baseline.
Do not leave an equal duplicate behind: duplicates are errors so divergent
ownership is visible.

The loader, helper, first migrated fragment and corresponding baseline update
must arrive together. An earlier loader cannot discover a moved definition;
the new loader correctly rejects a fragment whose definition still exists in
the baseline. For this first adoption, the exact Monitoring report definition
was moved unchanged and all unrelated baseline components were preserved.

When an independent owner has advanced the baseline or loader, read its current
source before composing the migration. Apply only the owned definition removal
and loader joins, retaining that owner's additions and native source-context
repairs. A fragment reduces shared editing for subsequent additions; it does not
authorize overwriting a newer baseline.

## Implementation entry points

- `source_tools/component_fragments.py` parses strict fragment JSON and
  implements `fragment_paths(files)`, `read_directory_fragments(root)`, and
  `compose_catalog(base, fragment_sources)`.
- `compose_catalog` accepts `(relative_path, exact_utf8_text)` pairs and returns
  the effective catalogue plus exact fragment records without modifying the
  baseline. An already composed catalogue is rejected to prevent double
  application.
- `source_tools/application_components.py` connects composition to the
  existing source-map and directory closure.
- `integration/component_fragments/monitoring-report.json` is the first
  retained application declaration using this route.

These are source-inventory operations. They preserve the original scientific
Workspace, run identities, native quantities, campaign revisions and report
renderers selected by the declared implementation.
