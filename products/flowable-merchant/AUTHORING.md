# Flowable source programme authoring

The **Commissioning programmes** page contains the source authoring desk and the existing saved native programmes. The desk keeps the complete catalogue, all model editions, typed request sources and selected roles together. Process, case and decision programmes use the original compilers and the original workspace save, preparation, dispatch and review operations.

## Open and operate the source desk

Open the original private Flowable workspace URL, select **Commissioning programmes**, then choose **New source programme**, **Load process example**, **Load case example**, **Load decision example** or **Reopen complete source-draft JSON**. The three supplied examples contain the original complete native receiving sources. Enter a distinct stable operation key and choose the actual native role identities before compiling an example.

A source draft belongs to the current workspace in the current browser. The draft shelf shows its saved edition and reopening action. Changes save after a short editing pause. The status explicitly shows saving, saved or a storage error; leaving the page with unsaved edits prompts the operator. A second tab cannot silently overwrite an edition: the local database compares the saved revision atomically. If another tab advanced it, download the current edits, save a new copy, or explicitly reopen the saved edition.

**Download complete draft** retains every editable source and configuration field in one portable JSON file. Reopening it creates a distinct local copy. Unfinished model or input text remains editable and downloadable: source syntax is checked when the original programme compiler requires it. A failed compilation, request or browser storage write leaves the working draft intact.

## Keep source paths and exact input text

Add individual UTF-8 files or a source folder. Folder intake removes only the chosen outer folder and preserves all nested paths. Use the optional path prefix when adding a selection such as typed input files under `inputs/`. Duplicate incoming paths are rejected. Existing source members are replaced only when the explicit replacement checkbox is selected.

The inventory opens each complete member in the source editor. It supports media type changes, explicit renaming, new source members, download and removal. Renaming updates the draft's catalogue selection and typed input mapping. References written inside the catalogue or model remain original source: edit those references deliberately when changing source topology.

File intake decodes UTF-8 strictly, retains a byte-order mark if present and checks round-trip bytes. Imported sources stay unchanged until edited. Typed JSON is retained as text; the desk does not parse and serialize its numbers. Thus the original long numeric token `9223372036854775806` survives intake, draft download, reopening and programme compilation. Textarea edits create a new source edition using the browser editor's line endings.

Select the original catalogue member. For BPMN, select the intended families, choose each family's complete typed input file, choose the migrations and select the family for human delegation. The existing process compiler accepts the complete three-family source cohort and selected courses from it. For CMMN, the complete authored catalogue supplies family/scenario selection and input paths; edit that source to author the agreed course. The existing case compiler requires its reviewer, specialist and approver identities to match the typed input contract.

For DMN, choose the families from the original decision catalogue. Its complete typed cases and authored review routes travel with the source. Exact bigDecimal and bigInteger values remain strings. The compiler uses the native key and tenant lookup; the operator reviews the prepared rule source and the actual response for each evaluation. After editing a model, **Inspect source identity** shows its current complete byte count and SHA-256. **Update catalogue model identities** explicitly updates the catalogue's model byte counts and hashes from the current complete inventory. Review its typed cases and expected routes as part of the same authored source edition before compiling.

The original compiler remains responsible for supported topology, native action selection, exact placeholders and role contracts. The desk does not infer a customer's policy or an engine definition version.

## Build and deliver the complete programme

**Build complete programme preview** runs the selected original compiler over the exact current source edition. Review the complete native step order, dependencies, actions, typed bodies and source identities. The detailed plan omits only base64 bodies from the on-screen view; complete source bodies remain present in the compiled JSON download. Any configuration or source edit invalidates the preview.

**Download compiled programme** exports the full native programme JSON. **Save programme for native review** uses the selected original engine connection and the existing `saveProgramme` request journal. It opens the saved programme in the original operator review controls. Each native operation still uses its normal preparation, review, dispatch, reconciliation and resume flow. An uncertain save remains in the existing pending-request recovery; the source draft remains available.

The complete draft and compiled programme each have a 16 MiB limit; a draft can retain at most 500 complete source members. The compiled source inventory includes UTF-8 byte counts, SHA-256 identities and exact base64 bodies. Local source drafts are working copies. The original workspace stores the authoritative received programme and native operating history.

## Source and packaging

The authoring modules live in the existing `flowable/workspace/` directory:

- `programme-authoring.mjs`: complete draft contract, source intake, exact source identities and original compiler composition.
- `programme-authoring-store.mjs`: workspace-scoped IndexedDB drafts with atomic revision checks.
- `programme-authoring-browser.mjs`: industrial source editor, configuration, draft recovery, preview and original save handoff.
- `examples/process.source-draft.json`, `examples/case.source-draft.json` and `examples/decision.source-draft.json`: complete original native example sources.

The existing programme panel installs the desk; the browser asset manifest registers all authoring modules, original compiler dependencies and full source examples. Existing saved programmes and their import, reviews, native operation preparation and workspace export controls remain in the same panel.

## Rendered product inspection — owner instruction, 2026-10-13

Before calling a customer/prospect-facing application, website, dashboard, demo, report, presentation or export ready, the producing worker must open/run/render the exact outgoing version, look at the rendered screen or actual screenshots and operate the important controls. Inspect screenshare and narrow/mobile widths where relevant; populated, empty, loading and error states; downloads, exports and reopening. Capturing screenshots without viewing them is insufficient. Code review, DOM counts, HTTP 200, unit checks and another worker's approval do not replace seeing the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work. Use plain industrial design with readable tables, clear hierarchy, consistent typography and spacing, restrained controls and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead to repairs without broad suites or a verification product.

Carry this instruction into consumed owner-controlled policy, boot, build and receiving surfaces and every delegated assignment. Preserve current engineering owners, original operation identities and concurrent source. Do not force restarts, create watchers, revive stopped work or modify third-party policy. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result and continue independent implementation while it runs. This instruction does not extend the October 13, 2026 14:00 UTC Ecosystem cutoff.

For this desk, inspect an empty draft, a populated example, a long source member, an invalid catalogue, native role errors, a storage conflict, draft download/reopen and compiled programme download/save. Open the saved native programme and its source/action view. The source-only compiler review does not stand in for this actual rendered inspection.
