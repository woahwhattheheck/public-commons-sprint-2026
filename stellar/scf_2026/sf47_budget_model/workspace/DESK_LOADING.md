# Opening Grant Operations desks

Open **Delivery and cash operations**, choose the retained case and select a section. The overview, native records and case finder are available through the original Operations host. A specialist section opens its existing desk after loading that section's JavaScript.

## Opening a section

The initial Operations module imports the staff context, navigation model and navigation UI, plus the small desk loader. Its 31 specialist mount functions request their existing modules only when their sections are opened. A brief **Opening …** message names the selected desk. The original desk then restores its session, reads its original case and displays its controls.

The successful module is reused when the operator returns to that section. Concurrent openings share one module request. Complete source installations still include every specialist file so all sections remain available after installation.

If the module cannot be opened, **Retry loading** tries that same original module again. It keeps the selected case, complete inputs and retained session. Other permitted sections remain accessible. The host's busy state disables the retry while an original operation is underway.

## Preserving current work

Changing sections or cases disposes the old mounted desk through its original lifecycle. If its module is still arriving, the loader skips mounting it into the replacement view. The host also checks that the selected case object is still current before a delayed mount. The module remains available for a later opening of its own section.

The original session and storage objects go to the original mount function unchanged. Existing request IDs, complete statement sources, pending and accepted operations, selected revisions, staff identity and recovery controls remain owned by each desk. The loader performs no case command.

A forecast that has not finished loading still returns its complete initial draft to the host when the operator moves away. After the original forecast mounts, its own draft reader supplies the current inputs. The account desk supplies its own selected-reconciliation receipt.

If a desk's initialization reports a problem after mounting, its original interface and recovery controls stay visible beneath the message. Complete or recover the original request using those controls. After that recovery, reopen the section before requesting another saved-workflow handoff; the existing finder does this automatically by rendering a fresh original desk. The loader continues to respect the original rejected initialization result until that reopening. The module-loading retry applies only before a child desk exists.

## Open saved work from the finder

**Find in case** continues to open exact original statement inputs, reconciliation revisions, funding editions, issuer terms, cohort comparisons and grant procedures. The existing host waits for the selected desk's full `ready` result before using its original saved-workflow adapter or selected-record receipt. The case version and selected mounted handle are checked after awaited work.

A delayed module is therefore part of opening the original desk. The saved source and its original request are carried through the same workflow described in [Saved operating workflows](SAVED_WORKFLOWS.md).

## Implementation and installed source

- `operations_lazy.mjs` provides `createLazyDesk({label, load, exportName})`.
- `operations.mjs` supplies the original dynamic import, mount export, options and current-case guard for each specialist section.
- `operations_http.py` serves the loader and this guide through the existing static registry.
- Both managed launch lists and the Grant Operations source selection retain the loader. The original child files stay in those lists.
- `operations.css` supplies the neutral loading and error panel. Existing child styling remains in its original files.

The returned handle preserves `ready`, `dispose()`, `setHostBusy()`, `draftInputs()`, `currentSavedWorkflow()` and `openSavedWorkflow(selection)`. Its readonly `loadingState` reports the desk label, current phase and whether the original module has loaded. A caller that needs an original detail must await `ready` and inspect the original selected receipt.

## Continue the original installed receiving journey

Use the current [Statements receiving programme](../../../../operations/scf-statements-original-32c2-20261013/README.md) and its retained case. On desktop and phone entry, open the overview and finder, then Account statements, Account reconciliation and the exact saved-workflow destinations. Check that the named desk is available after loading and that its original source, selected revision and retained request controls remain usable.

During a slow section load, select another section or case and confirm that only the current desk is displayed. Return to the first section and continue its original draft. After a temporary module fetch failure, use **Retry loading**. If the original child has already initialized and reports a receiving problem, use that child's own recovery controls.

The focused source exercise covers shared module loading, disposal before import completes, changed-case refusal, reuse on reopening, busy-state forwarding, complete forecast draft fallback, original saved selection, explicit import retry and preservation of a mounted child's failed-request recovery. The installed browser operation records actual startup and navigation results with the existing account controller.
