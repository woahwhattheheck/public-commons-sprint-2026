# Application source contexts

The selected application keeps original scientific source, original installers,
upstream documentation and maintained operator modules together. These files do
not all execute under the same import or web-routing context. The component
catalogue describes those contexts while preserving the original bytes, source
manifest identities and complete package membership.

## Python execution context

A component may declare `python_contexts` with an original directory `prefix`,
ordered `import_roots`, and an optional `installed_prefix`. The longest matching
directory prefix applies to a source file. Explicit roots precede the application
and operator roots. Resolution selects the first Python module/package in that
order, including namespace packages, and uses that same file for symbol checks.
An installed-prefix map changes where a retained installer payload's relative
imports resolve; the payload itself is retained and hashed at its original path.

The original `scenario-design` programme resolves its own `server` and
`conservation` modules. Monitoring's original installer payload resolves relative
imports against the maintained installed `model` namespace.

## Retained historical members

`retained_only` records an exact file path and its reason. The file is still
required, exported and hashed. Python syntax is still checked. Its historical
imports or documentation asset links are not treated as current application
runtime dependencies. A maintained import, descriptor or browser asset pointing
to that file is an explicit source-role error.

This edition uses that role for the original package-based Monitoring adapter,
the earlier Chemistry patch-installer test, and three original GeographicLib
JSDoc pages. The current Monitoring descriptor names `monitoring_native`.
The complete scientific sources and native source manifests remain selected.

## HTML route templates

`html_templates` binds an exact template path to explicit `token`,
`url_prefix` and `asset_root` values. Source Refresh's retained
`__SOURCE_REFRESH_BASE__` route resolves to the original adjacent CSS/module
files. Each resolved file must exist and is included in the closure. The mapping
does not turn local route assets into ignored absolute URLs.

Declarations reject escaping paths, unknown fields, duplicate identities and
conflicting selected contexts. They compose with the existing component fragment
loader. No context declaration changes scientific execution, source hashes,
the original source bank or the public component selection.
