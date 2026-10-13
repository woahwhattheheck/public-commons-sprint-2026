# Collect and receive an Eco application component family

This tool completes the existing Eco family-source handover. It begins with the original component catalogue, every selected component dependency, original resource manifests and exact declaration bodies. It then runs the maintained Python AST collector and Acorn JavaScript collector under explicit source selections. Their additional source members enter the same ordinary family bank. The existing application assembler remains the authority for overlay predecessors, application component closure and fresh-directory receiving.

## Installed entry point

Run from the existing complete application directory:

    python -m source_tools.component_source_collection --help

The component fragment is integration/component_fragments/component-source-collection.json. Its additive component is component-source-collection. Its complete Python/JavaScript collectors, original Acorn distribution and licence live under source_tools/vendor/source_closure/. Those are unchanged originals from the maintained public host collector, not shortened copies. The adapter also depends on the current application_assembly.py, application_components.py and component_fragments.py. Their exact identities travel in every collected edition.

Python uses the installed interpreter's original builtin, frozen and standard-library classification. JavaScript uses the retained Acorn source, whose original hash is checked by the maintained native reader. Node must already be available. Neither collector imports application modules, starts an application, installs packages, contacts a provider nor runs a scientific task.

## Complete workflow

### 1. Select the actual existing family

    python -m source_tools.component_source_collection plan /actual/complete/application \
      --component ORIGINAL_COMPONENT_NAME \
      --label "Current selected family" \
      --output /owned/new-output/family-selection.json

Repeat --component for multiple actual component entry points. Use names from the original effective catalogue and fragments, not a guessed directory label. The original family exporter resolves its dependency graph and retains scientific and other resource members declared by that graph.

The plan command writes an editable source selection. It groups Python entry modules by declared import context, retains ordered roots, includes original JavaScript files, and records the native /web route mapping. It proposes source-analysis entry points, not a substitute launch command. Review the original launcher's module identity and ordered roots before collection. Selecting package.__main__ means the original python -m package execution entry; selecting a package alone covers the package import.

Installed-prefix source loaders and filenames without a normal dotted module identity are explicitly listed under unresolved_contexts. Retain the full existing native loader context. An actual installed source tree can be selected directly; a source-only alias must be represented through the original collector's explicit source-bound dynamic file mapping. Removing a note does not establish coverage: the adapter also compares parsed contexts with the selected original declaration and lists any runtime member that has not been parsed.

### 2. Retain explicit runtime choices

The recipe uses this schema:

    {
      "schema": "upstate.component-source-selection/v1",
      "label": "Current selected family",
      "components": ["ORIGINAL_COMPONENT_NAME"],
      "python": [
        {
          "id": "original-backend",
          "selection": {
            "schema": "commons.python-source-selection/v1",
            "label": "Original installed backend",
            "module_roots": [".", "operator"],
            "entrypoints": [{"module": "model.workspace"}],
            "resources": [],
            "external_modules": [],
            "dynamic_imports": []
          }
        }
      ],
      "javascript": [
        {
          "id": "original-browser",
          "selection": {
            "schema": "commons.javascript-source-selection/v1",
            "label": "Original browser",
            "paths": ["operator/web/ORIGINAL.mjs"],
            "resources": [],
            "routes": [
              {"url": "/web/ORIGINAL.mjs", "path": "operator/web/ORIGINAL.mjs"}
            ]
          }
        }
      ],
      "unresolved_contexts": [],
      "javascript_runtime": []
    }

The illustrative names above must be replaced by the selected original family. A family may have only one language; multiple original Python or JavaScript selections are supported. Every selection has a unique ID. Their complete source tables are shared in the resulting bank, so byte-identical files at different original paths remain separate members.

Python uses the maintained collector's exact source-bound dynamic_imports contract. A mapping retains source, source_sha256, AST line/column, complete expression, selected modules/resources and optional exact file-loader path/module/package identities. Computed package wildcards remain explicit. External packages require explicit names; the adapter does not inspect or install the host's environment packages.

JavaScript retains every computed import/require/URL expression. To bind one, add a javascript_runtime row:

    {
      "selection_id": "original-browser",
      "source": "operator/web/ORIGINAL.mjs",
      "source_sha256": "THE_ACTUAL_64_CHARACTER_SOURCE_HASH",
      "range": [123, 167],
      "expression": "THE_COMPLETE_ORIGINAL_EXPRESSION",
      "paths": ["operator/web/SELECTED.mjs"],
      "reason": "Original selected loader option and its source declaration"
    }

Add each selected path to that language selection's paths or resources. The range and complete expression come from the actual parsed source, not a line-number guess. The adapter requires exactly one matching choice, verifies the original source hash and full selected source members, and rejects stale or unused mappings. An explicitly external runtime choice can retain an empty paths list with its actual reason. Such a declaration records an operator-selected runtime dependency; it does not install it.

Served routes use the actual HTTP URL to repository-member relationship. Explicit routes take precedence over repository adjacency in the maintained collector. Preserve differing browser and Node contexts through separate selections. Native template bindings remain in the original component inventory. Large raster, GeoPackage, source archive and other scientific members remain on the original assembler's complete resource path.

### 3. Collect one coherent source edition

    python -m source_tools.component_source_collection collect /actual/complete/application \
      --selection /owned/new-output/family-selection.json \
      --edition "Selected family 2026-10-13" \
      --operation-id ORIGINAL_SOURCE_OPERATION \
      --against /actual/receiving/application \
      --node /actual/installed/node \
      --temporary-parent /owned/writable-temp \
      --output /owned/new-output/collected-family.json

The original family source and both language collectors must observe the same full file bodies and ordinary modes. Every selected member and declaration is re-read at the closing boundary. New parser-discovered members receive the same original receiving-tree predecessor hash when --against is supplied. Collection never modifies either application directory.

The output is commons.source-bank/v1, kind upstate.selected-application-family/v1. Original declarations remain full bodies in family_selection.declaration_sources. They are provenance, not permission to overwrite the receiving catalogue with a partial catalogue. The original installed catalogue/fragment writers publish any missing declaration through their existing source lane.

The source_collection section retains:

- The exact source recipe and original adapter/assembler/collector identities.
- Every original family seed member, original family source identity and complete declaration context.
- Each language's complete original analysis, ordered member references, Python positive/negative lookup observations, explicit runtime selections and namespace directories.
- A recomputable report containing all source members, original component closure, parsed runtime members and unresolved selections.

The bank stores each full source member once. It includes every original family member even when that member is not executable code. The adapter never changes module content, normalizes source indentation, rewrites scientific manifests, emits a reduced runtime or substitutes a summary for original bytes.

Exit 0 means the selected source coverage is complete. Exit 2 means a full bank and actionable original findings were written. Inspect language_findings, javascript_runtime_findings, python_context_findings, uncovered_runtime_members and the original component_inventory. Resolve a finding against the actual current source or loader selection, then author a new output filename/edition. Create-only output publication reuses identical bytes and refuses to overwrite a different edition.

A source parser deliberately follows retained import syntax. Conditional fallback imports can expose more than one possible runtime context. Preserve that finding and the original native launch selection; do not label an unresolved alternative complete. Likewise, a declared retained_only file is retained as original source but must not be reached as a runtime dependency. The report makes this distinction explicit.

### 4. Reopen the full bank

    python -m source_tools.component_source_collection inspect \
      /owned/new-output/collected-family.json \
      --node /actual/installed/node \
      --temporary-parent /owned/writable-temp

Inspection reconstructs both language packets from the shared complete source table and replays the unchanged collectors. It checks original selection order, complete bodies, parser observations, source contexts, source/tool identities and the full report. It verifies that no seed member was dropped and that every added member belongs to an actual retained collector packet. Whole family source identity and original declaration bytes must agree.

Use the tool versions retained with that edition. A later assembler or collector is a different source toolchain; it must make a new explicitly selected edition rather than relabel the previous result.

### 5. Receive through the existing full application assembler

    python -m source_tools.component_source_collection assemble \
      /actual/retained-complete-base.json \
      --bank /owned/new-output/collected-family.json \
      --edition "Current application with selected source family" \
      --operation-id ORIGINAL_SOURCE_OPERATION \
      --node /actual/installed/node \
      --temporary-parent /owned/writable-temp \
      --map-output /owned/new-output/complete-application.json \
      --output /owned/new-output/application

The base can be an original complete application map, retained complete native transport or current complete application directory accepted by application_assembly.read_layer. Repeat --bank in the original intended overlay order.

Every selected collected bank must replay completely. The adapter calls the original compose API; changed members still require their actual preimages, original selected declarations must already agree with the receiver, and every original component check still applies. It calls the original atomic fresh-directory receiver and retains its exact source receipt. Afterwards it restores any explicitly recorded empty Python namespace portions in that same new directory. This directory-only continuation is idempotent and rejects aliases or file conflicts; the same source receipt can reopen an interrupted continuation. No existing application source or Workspace is overwritten.

The complete map retains the original assembly identity plus the selected source family identities and explicit namespace directories. Scientific external-source declarations, exact native manifests, selected data/member identities and original authored files remain as the original assembler records them.

## Limits and deployment

The original assembler keeps its 512 MiB decoded-source and 10,000-member limits. Language analysis uses its unchanged per-selection limits: at most 8,192 members, 64 MiB source, and 8 MiB per file. Separate explicit runtime selections can cover independent original contexts. The full family union stays under the original assembler's limits. A scientific member does not need to enter the language parser merely because it belongs to the family: it stays in the original full source/resource bank.

The standalone receiving adapter and all original language dependencies are selected by the additive component fragment. The root catalogue, cumulative installer and scientific/operator modules are unchanged by this feature. Original component writers keep ownership of their moving declarations; source recipients keep their existing native/controller/Workspace ownership.

This workflow performs source collection and receiving. Continue the application's already selected original native/browser/scientific course afterwards. For the actual producing application, follow CURRENT_OWNER_DIRECTION.md: open and use the complete desktop and narrow operator, inspect all outgoing reports/maps/files, reopen the delivered working copy and retain actual operated results. The source coverage report describes source, not those native or visual outcomes.
