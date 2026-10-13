# Climate forcing working designs

This is the unfinished-design continuation of the original Climate forcing desk. Follow `CURRENT_OWNER_DIRECTION.md` version **2026-10-13.4** and its current successors. Named revisions use the original immutable Workspace store, original operator task queue and original selected Study archive. Saving or restoring a working design does not prepare a grid or run a model.

## Use the existing desk

Open **Climate forcing** in the original operator. The **Working design** section appears above the scientific case controls.

1. Enter a design name and author. Add an optional revision note. Edit the ordinary title, purpose, baseline, cases, source periods and reporting choices. Blank purpose, unfinished labels, empty case IDs and incomplete source annotations remain literal raw working values.
2. Choose **Save working revision**. The complete request and operation identity are retained before submission. Selected nonempty baseline and source collection IDs must resolve to their original native records. Scientific completeness is checked later by the ordinary preview.
3. Continue editing while the save is pending. Its acknowledgement advances the saved parent without replacing those newer raw edits. The original operation appears under **Retained operations**. If the response is lost, **Reconcile original save** or the retained-submission retry resends the same operation and exact payload.
4. Open the saved-design list to restore a head or inspect its complete ancestor history. Opening an older revision does not rewrite it. A same-series save uses compare-and-swap: if another revision is now the head, the backend rejects it with `WORKING_PARENT_CHANGED`. Open the current head or explicitly choose **Save as new branch**.
5. **Save as new branch** keeps the selected original revision as its fork ancestor and gives the new series its own identity. Full original ancestry travels with exports. The previous browser journal remains under unfinished recoveries, including an original pending request if present.
6. A complete imported history opens as a new branch. Its first save verifies all original baseline/source bindings and retains the imported records byte-for-byte. A history cannot silently replace a native head. A pending recovery can only be reconciled in its original physical operator workspace.
7. **Download unfinished recovery** includes the current raw controls, author/name/note, selected history and any exact pending save. It works without accepting the scientific design. Use it before closing when browser storage is unavailable. **Export complete saved history** queues the ordinary export and gives native download tickets for the selected saved history and its raw fields.

Named saves require a name and author, but do not require scientifically valid cases. No missing number, source period or ID is filled in. The raw design retains the original reporting-area definitions even if their source is no longer offered by the current picker. Selecting a nonexistent nonempty native source fails at save rather than fabricating an edition.

Browser session recovery is supplementary. Portable native revisions are in `climate-working/<revision_id>.json`; save-request timing is retained in `climate-working-operations/<request_id>/request.json`. Browser access failure does not pretend that unsaved controls are durable.

## Scientific preview and native execution

When the raw fields match a saved revision exactly, **Preview retained inputs** passes `working_origin: {revision_id}` to the existing `climate_forcing.preview`. The model revalidates that saved raw draft through its ordinary scientific selection parser, with no recursive origin, and compares the normalized selection exactly.

If the fields changed, save the next working revision before previewing its scientific design. Imported histories must be saved as a verified new branch first. An unnamed, never-saved design can still use the existing ordinary scientific preview.

Preparing retains the exact working origin in the immutable forcing-study selection. Original source validation, fixed versus automatic runoff normalization, forcing-grid checks, native per-model reuse, reporting-area checks and effective land-cover validation remain authoritative. The working-design code does not alter those scientific rules.

Opening a prepared study with a working origin restores its original raw saved revision in the same Climate desk and keeps the prepared study/results available. Execution remains the existing `run.start` queue and original native matcher; no model is dispatched by a working save, import, restore or export.

## Portable selected Study delivery

**Export editable working Study** opens the original Study delivery desk with a typed `climate-working` root. It includes the exact selected revision and full ancestor/fork chain, every selected original source collection and its primary/companion files, and each selected original baseline run with its native input dependencies.

A prepared `climate-forcing-studies` root with `working_origin` automatically includes that same original working history. The existing Study receipt adds a `climate_working` list binding selected revision, series/revision, original project, ancestor IDs and complete history digest. Old receipts omit this list and remain valid as an empty selection; later unrelated working designs are never discovered into an old archive.

Receive through the existing Study importer. Its normal verification checks native immutable records, complete history, source bytes and recorded closure. **Open working design** on the received typed root invokes the existing extension host's `climate-forcing.openWorkingRevision({workspace_key, revision_id})`. The current workspace and delayed-read guards apply before replacing the form.

A history JSON alone carries source metadata bindings, not raster bytes or native outputs. Use selected Study export or the original complete Workspace backup for a recipient that does not already retain those dependencies. The cumulative application assembly includes the working model, transfer visitor, browser helper and CLI through the existing Climate component.

## Operator and native interfaces

Original queued actions:

- `climate-forcing.working.save`: exact payload `{request_id, series_id, parent_id, forked_from, name, author, note, draft, imported_package}`.
- `climate-forcing.working.export`: `{revision_id}`.

Read-only routes:

- `GET /api/climate-forcing/working-list?workspace=...`.
- `GET /api/climate-forcing/working-view?workspace=...&id=...`.
- The existing catalogue includes `working_designs`; explicit open includes the full history and source catalogue.

The save result is `{record, package, history, catalog, workspace_key}`. Identical request ID and payload replays the original result before checking a newer head. Reusing that request ID with different work is rejected. Only the first revision in a new series may declare a fork. An imported package must contain exactly the selected revision's complete ordered ancestry, with no missing, repeated or unrelated records.

The companion CLI uses the same models and opens an existing Workspace with `create=False`. It never starts native work:

```bash
python "$CLIMATE_APP/source_tools/climate_working.py" --workspace "$CLIMATE_WORKSPACE" list
python "$CLIMATE_APP/source_tools/climate_working.py" --workspace "$CLIMATE_WORKSPACE" --output "$CLIMATE_OUTPUT/opened.json" open --revision "$CLIMATE_REVISION"
python "$CLIMATE_APP/source_tools/climate_working.py" --workspace "$CLIMATE_WORKSPACE" export --revision "$CLIMATE_REVISION"
python "$CLIMATE_APP/source_tools/climate_working.py" --workspace "$CLIMATE_WORKSPACE" preview --revision "$CLIMATE_REVISION" --selection-output "$CLIMATE_OUTPUT/selection.json"
python "$CLIMATE_APP/source_tools/climate_working.py" --workspace "$CLIMATE_WORKSPACE" verify
```

Set these variables to the actual original application's, Workspace's and receiving operation's paths and retained revision ID. Output files are immutable; choose a new output for a changed edition. A saved original task payload or pending recovery can be continued with `save --request <actual-file>`; the original request ID and parent are preserved. Do not generate a new request merely because its response was lost.

The selection emitted by a successful CLI preview can be passed unchanged to the original `climate_forcing_study.py --selection` path, retaining its working origin. An unfinished draft is expected to fail scientific preview until its scientific choices are complete.

## Original receiving course

Use the existing equipped Climate owner and original Workspace; do not launch a second model course.

1. In the real browser, save an unfinished named revision with at least one literal blank field. Restore it, revise it, save a second revision and explicitly branch an older original revision. Inspect the original author/note/order in the history.
2. Reconcile one original save request without changing its payload. A concurrent same-parent save must be rejected, while an explicit new branch remains possible. Verify that edits made during an in-flight acknowledgement remain in the form.
3. Download and open every history/raw/recovery JSON attachment. Restore a recovery in the same workspace. Reopen a complete history as a new branch; the native save verifies its actual source bindings.
4. Complete the ordinary forcing fields, save the exact final revision, preview it, and inspect `working_origin`. If the current course already has completed forcing cases, preserve those jobs and use the existing prepared study; no baseline or alternative rerun is required for working-history verification.
5. Export the selected working root and the prepared forcing root through existing Study delivery. Download/open the full archive, receive it into the original selected-Study receiving destination, and inspect the exact receipt/history/source membership. Reopen **Open working design** on the received root.
6. Close the operator. Start the actual copied receiving application against the retained received Workspace in a new process. Reopen the same named revision, original source files, prepared cases and report. Run the read-only CLI `open` and `verify` there to check the exact original history.
7. OPEN/LOOK/use the outgoing desktop and narrow browser views, native task/details and every attachment/archive in recipient viewers. Record actual paths, IDs, operation states and first exceptions. Source or V8 exercises alone are not a native or visual completion claim.

At source publication, controller checks cover unfinished fields, exact retries, independent branches, concurrent-edit and workspace guards, imported ancestry and browser reopening. Actual Python execution, received Study verification and visual LOOK remain the original equipped owner's receiving work.
