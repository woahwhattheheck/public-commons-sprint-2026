# Investigations in the original workspace

The complete Investigations component is installed at `eco_intelligence/`. It reads the original registered source inventory and native outputs, retains analyses and guided plans in the original project's persistent state, and submits scientific work through the existing Operator queue.

## Current native integration

Use [the native binding guide](eco_intelligence/UPSTATE_BINDING.md) for the actual Operator and Workspace interfaces. The host constructs `UpstateInvestigations(operator, native_experiments=True, ...)` and passes it to its authenticated Investigations feature. The original host owns authorization, source registration and the worker queue.

The package includes the original Engine and SQLite Store, complete table/raster interrogation, browser and HTTP interfaces, provider tool calling, report exports, actual native job admission/reconciliation, saved experiment selection and workspace restoration. Guided experiment selection retains the full immutable source plan alongside the installed native producer's resolved view and uses the complete saved case cohort.

Existing native runtime source can receive this component with:

```sh
python eco_intelligence/install_upstate.py --application /absolute/original/application --source-root .
```

Run from this application's source directory with its existing compatible Python environment. The installer compares current source, preserves overwritten known editions, parses the complete package and adds `eco_intelligence` to the original portable source inventory. Its current-source comparison deliberately preserves a separately changed implementation for composition.

The application's HTTP feature and the selected-workspace diagnostic snapshot are composed by their existing native integration owners. In particular, a snapshot requested while the original workspace exclusive lock is already held must use that host's already-held-lock integration. The full application receiving journey remains the original joined operation.

## Source layout

All 28 members of the selected complete component are retained byte for byte. Runtime modules, the original compatibility installer, dependency notes and three original receiving programmes keep their component paths. Four component-level documents are under `docs/intelligence/`, preserving this application's existing root README.

- [Native binding and full receiving flow](eco_intelligence/UPSTATE_BINDING.md)
- [Original component README](docs/intelligence/README.md)
- [Original integration contracts](docs/intelligence/INTEGRATION.md)
- [Original completed component receiving record](docs/intelligence/validation.json)
- [Complete current adoption inventory](docs/intelligence/source.json)

The component README describes its original standalone distribution; resolve its source-root commands from this application's directory. The earlier `install_intelligence.py` launcher is retained for its legacy FastAPI/catalog integration. The current original-workspace integration uses `eco_intelligence/install_upstate.py`.

The original component manifest is retained in `docs/intelligence/MANIFEST.sha256` as source history. The current adoption inventory records each complete member's actual SHA-256, original path and installed path. It is the source selection for this edition.

## Receiving and continuity

The retained validation record describes the original component's completed integration, browser and capacity journeys. The current original-host receiving uses the native binding guide: registered source inspection, full analysis, original queued work and result reception, readable and JSON exports, complete workspace backup, new-directory restore, and reopening the same investigation and native task history.

Use the installed original environment and current full-application receiver. Existing completed scientific runs remain reusable through their original IDs and source selections. Investigation state retains the original project UUID while each request resolves its current registered and authorized workspace.
