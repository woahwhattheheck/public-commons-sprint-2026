# Investigations in the Upper Savannah workbench

Investigations connects registered scientific sources, retained native results, and saved analytical conversations in the existing workbench. It uses the selected Workspace, the original Operations queue, and the workbench's authenticated downloads.

## Open an investigation

Start the maintained operator with the existing Workspace and operator-state directory. Open its authenticated URL, select the Workspace, and choose **Investigations**. Create a named investigation or reopen an existing one.

The catalog lists registered datasets, native runs, and saved experiments. Select a resource and choose **Inspect selected**. The completed result records the original source identity, scientific units, coverage, and retained evidence. Inspecting a native run exposes its registered artifact members for comparison.

Raster comparisons use the original grid alignment and declared units. Table comparisons use the selected pairing keys and observed/predicted columns. Choose compatible measurements and read the resulting coverage alongside the numerical comparison. Source declarations are preserved; missing units remain visible.

The optional **Assistant** uses the provider configured on the server and the same investigation engine. Questions, retained analyses, and typed action plans remain in the current investigation. Local inspection and guided native actions are also available directly.

## Continue scientific diagnostics and native programmes

In **Scientific interpretation**, open a saved report and choose **Investigate this analysis**. The existing registered desk opens that report in Investigations. The operation uses the exact report revision, dataset identity, and source hash; it reopens an existing matching association when available.

In **Guided actions**, **Design native programme** opens the application's existing Scenario experiments designer. Select the original baseline, alternatives, profiles, and parameter values there. Its original save or run task returns to the investigation, where the saved programme can be selected for native ensemble preparation. The originating investigation and Workspace remain bound to this return.

Choose **Inspect original experiment** to browse saved cases and their result pages. Native task status, the saved programme, and retained outputs are available from the same workflow. **Continue original submission** resumes the original submission represented by a saved plan.

The maintained Scientific interpretation desk also retains its **Transfer study** and **Prepare Decision study** actions. Investigations installation preserves those registered connections.

## Export selected original files

Open **Source collections**, select current registered datasets or native artifact members, and choose **Export selected original files**. Selection is saved independently of the current catalog read, so a temporary source-list failure does not erase it.

The queued export freezes the exact selected references and source identities. For an original native primary, the collection includes its declared companion members and required GIS sidecars. Companion records keep their original bindings, paths, byte counts, and hashes. An explicitly selected companion remains a selectable original in its own right.

The completed collection has a verified ZIP download, its original file inventory, and individual retained downloads. Extract the ZIP and open **START.html** to browse it. The included catalog, manifest, and original files allow the collection to be reopened or re-exported with the same companion family.

Saved collections remain attached to the investigation. Reopen one to recreate authenticated download links after a browser or server restart. Replaying the original export operation returns its existing collection.

**History and export** separately creates the investigation's complete JSON and readable HTML report. Those reports preserve the saved evidence and history. Original scientific-file collections remain available in **Source collections**.

## Request and browser recovery

Every queued request retains its submitted Workspace, action, payload, and operation ID. A lost admission response retries the same request. The operator can return an identical active task admitted by another operation; the client records that accepted task and operation separately, then follows those exact identities on later reads.

Late responses update the context of their original Workspace. Completing an earlier session-creation request preserves a later explicit investigation selection. Detached source-selection controls cannot change a newly selected Workspace.

Completed conversations, evidence, exports, collections, and native programme results remain readable when a catalog refresh fails. Reload or reopen the desk to retry those independent reads. Retained task controls expose the original operation and its current state. A task restored with a portable study is inspected through its captured record; a live operator task link appears only when the original task belongs to the current operator Workspace.

## Install into a maintained application

Use the application's existing scientific Python environment and a complete source checkout. Set the following paths to the actual source and receiving application:

```sh
export ECO_GIS_PYTHON=/absolute/path/to/python
export ECO_SOURCE=/absolute/path/to/upstate_forever_2026
export ECO_APPLICATION=/absolute/path/to/receiving/upstate_forever_2026

"$ECO_GIS_PYTHON" -B "$ECO_SOURCE/eco_intelligence/install_upstate.py" \
  --application "$ECO_APPLICATION" --source-root "$ECO_SOURCE"

"$ECO_GIS_PYTHON" -B "$ECO_SOURCE/install_intelligence_operator.py" \
  --application "$ECO_APPLICATION" --source-root "$ECO_SOURCE" --dry-run

"$ECO_GIS_PYTHON" -B "$ECO_SOURCE/install_intelligence_operator.py" \
  --application "$ECO_APPLICATION" --source-root "$ECO_SOURCE"
```

The native installer receives the current engine package. The operator installer validates all selected source members, prepares the browser joins, preserves previous bytes, and writes the registered descriptor after its runtime files. It extends the existing portable application inventory to include the native engine, source helper, generic receiving procedure, and catalog utility.

On the maintained registered host, Scientific interpretation already connects to Investigations through its existing retained-desk bridge. The installer validates and preserves that connection. On an earlier supported host with a built-in Scientific interpretation controller, it joins that existing controller. The programme callback always uses the application's existing Scenario experiments instance. A conflicting unrecognized source edition requires composition before replacement.

Restart the original operator after installation and reload the browser so the current descriptor and modules are selected. Preserve the live operator-state directory and scientific Workspace.

## Receive an original-file collection through the native queue

The generic receiving procedure accepts the actual application, retained Workspace, and a separate receiving state directory. An optional JSON file supplies the current selected source references.

```sh
"$ECO_GIS_PYTHON" -B \
  "$ECO_APPLICATION/receiving/eco_intelligence/receive_original_collection.py" \
  --application "$ECO_APPLICATION" \
  --workspace "$ECO_WORKSPACE" \
  --state-directory "$ECO_COLLECTION_STATE" \
  --selected-refs "$ECO_SELECTED_REFS" \
  --require-declared-companions
```

The procedure uses the original operator queue to create an investigation and export the selected originals. It opens the actual ZIP ticket, verifies and reopens the delivered catalog, retries the same operation, restarts the operator, and reopens the same collection. Its result is saved as **collection-receiving-result.json** under the chosen receiving state directory. The companion option requires a selected original family with declared members.

The Web Map source-admission receiver can invoke this same generic collection procedure through its `--collection-receiver` option after admitting original region and context sources.

## Integration surface

The registered Investigations descriptor uses the existing host and exposes these authenticated reads:

| Read | Selection |
| --- | --- |
| `GET /api/intelligence/catalog` | Workspace |
| `GET /api/intelligence/session` | Workspace and session ID |
| `GET /api/intelligence/evidence` | Workspace, session ID, evidence ID |
| `GET /api/intelligence/plan` | Workspace, session ID, plan ID |
| `GET /api/intelligence/export` | Workspace, session ID, export ID |
| `GET /api/intelligence/diagnostic` | Workspace and diagnostic ID |
| `GET /api/intelligence/experiment` | Workspace, experiment ID, offset and limit |
| `GET /api/intelligence/native-task` | Workspace and task ID |
| `GET /api/intelligence/collection_sources` | Workspace |
| `GET /api/intelligence/collection` | Workspace, session ID, collection ID |

Mutations use the original task queue: `intelligence.session.create`, `intelligence.diagnostic.open`, `intelligence.inspect`, `intelligence.prepare`, `intelligence.execute`, `intelligence.continue`, `intelligence.ask`, `intelligence.export`, and `intelligence.collection.export`.

The native repository supplies current dataset records and registered artifact members. Export resolves only selected original references through that repository before catalog projection, allowing named views of content-addressed sources to be materialized and verified. Inventory reads remain metadata-only.

Files and project state stay under the original Workspace. Download tickets use the existing file server's authentication, original byte count, content hash, and range handling. Provider credentials stay in server configuration.
