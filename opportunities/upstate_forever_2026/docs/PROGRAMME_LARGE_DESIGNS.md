# Large saved native programmes

Open **Run programmes → Saved programmes → Open**. Each page shows up to 100 original cases. **Previous cases**, **Next cases**, the state filter and **Find** navigate the saved design without changing it. Find matches an original case key, title, native run ID, profile ID or scenario ID.

For Tim: follow one page of calculations while the progress count continues to cover the complete programme.

## Whole programme progress and selected cases

The progress bar and active-state controls cover every original named case, including cases on other pages. The reader checks the current original run-selection binding, completed-run validity and actual native locks. A programme’s own verification failure remains distinct from native model completion. The original programme lock, pause request and requested-run context stay visible.

Checking cases retains the exact original keys across pages and filters. **Run selected cases** sends that complete checked subset to the existing programme action. **Select all unfinished cases** reads the current whole-programme unfinished set, including cases outside the visible page. **Continue unfinished runs** keeps its original whole-programme behavior.

Page changes cancel an earlier in-flight read. A delayed page response cannot replace the newly selected page. Typed search text survives background redraws; searching does not clear the checked subset.

## Complete scientific inputs and paired scenarios

**Download selections** and **Copy selections** fetch the entire original saved selection on demand. They retain every original case and its selected model families. The compact page marks its selection as metadata-only, so consumers can distinguish it from the complete native input document.

**Review all paired scenarios** resolves pairs from the complete original programme. It includes matching baselines on other pages and all original model/profile cohorts. Preparing the selected paired product still reopens the maintained full status and verifies its current candidate identity. When the saved execution observation changes, the displayed pair choices are refreshed explicitly.

The native case console uses the same compact whole-programme status and detailed inspection of its exact selected run. Original process receipts, full attempt history, logs and existing continuation remain the same.

## Read-side implementation

`model.programme_views.ProgrammeViews` uses the existing `ProjectedFileCache` for validated immutable programme bindings, compact progress and native run projections. Each cached item is invalidated by its device, inode, byte length, modification and change times. Cache misses validate the original full record before storing the projection; unstable in-place reads are rejected by the maintained cache.

The caches have finite memory budgets. They never limit the saved design or the number of cases that can be executed. Every observation still checks all selected native file identities and live locks, while full native stage, storage and execution details are read only for the selected page. Returned objects are independent of cache storage.

The original `ComputeProgrammes.status`, catalogue, CLI, reports, execution and immutable source identities remain available unchanged. The operator uses the compact reader for its catalogue, task decoration, case console and paginated programme view. No simulation output, coefficient, solver argument or scientific input is derived from a catalogue projection.

## API

Existing full `/api/programmes/detail` remains compatible. New read operations are:

| Operation | Result |
| --- | --- |
| `page` | Whole-programme counts/state plus one detailed original case page |
| `selection` | Complete original immutable programme selection |
| `keys` | Current matching original case keys, used for whole-programme unfinished selection |
| `paired` | Complete current paired-scenario candidates and original pair-continuation context |

All use the existing workspace key and `programme_id`. Pages accept nonnegative `offset`, `limit` from 1 to 500, `case_filter` (`all`, `unfinished`, `failed` or `complete`) and optional `query`. The page-size maximum bounds one response, not the design.

`selection_complete: false` identifies page metadata. `page.total` counts matching cases and `page.programme_total` counts every saved case. `counts` always covers the whole programme. `native_active` observes all original native run locks. `observation_id` binds the programme state, native source-record revisions and live activity used for the view.

## Original receiving

Use a programme already retained by the native receiving workspace. Compare the compact page’s whole-programme counts/state with `ComputeProgrammes.status(id, include_ensemble_candidates=False)` at an inactive boundary. Read a later page, select original keys from two pages, and verify that the existing queued request contains both keys. Download selections and compare them with the original `programme.json` selection. Review paired scenarios and compare the candidate IDs with the full original manager.

The receiving operation remains the current original GURA-NATIVE-01 course. These reads do not start another native calculation.
