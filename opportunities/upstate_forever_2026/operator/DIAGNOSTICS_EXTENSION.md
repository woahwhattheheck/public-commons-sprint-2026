# Scientific interpretation in the shared operator

The installed `extensions/experiment-diagnostics.json` registers the original scientific diagnostics provider and browser controller in the existing application. It uses the original task queue, saved Workspace state, API authentication and verified downloads.

## Open the maintained application

Use the current repository application and restart its original operator. The existing extension registry discovers the descriptor and adds **Scientific interpretation** after Experiments. The application must include the original model and operator diagnostics modules, their browser module and stylesheet, and `web/retained_desks.mjs`.

The registered path uses the existing shared host directly. The older `install_diagnostics.py` script remains available for applications using direct server registration; choose that installation path only when the application does not use the descriptor. Both paths preserve the same scientific engine and saved result identities.

## Work with a scientific study

Select a retained experiment programme or original native run cohort. The original queue performs the analysis and saves its report artifacts. Open the saved analysis to inspect scenario effects, parameter responses, ranking stability, observed loads and the original runs and files.

**Export reports** downloads the current scientific report artifacts. **Transfer study** opens the installed Study transfer desk with this analysis already selected; its export carries the analysis's native dependency closure into an independent editable Workspace. When Scientific investigations is installed, **Investigate this analysis** opens that original desk with the current report's exact content identity.

The retained-desk wrapper preserves the original diagnostics controller and its form, navigation and report behavior. It redraws on changes to this desk's saved analyses and tasks, detaches requests when leaving the view and keeps scientific selection tied to the original Workspace.

## Registration contract

- Original provider: `experiment_diagnostics.ExperimentDiagnostics(operator, fault)`.
- Original queued action: `diagnostics.analyze`.
- Original reads: `GET /api/diagnostics/catalog`, `/item` and `/experiment`.
- State: `data.experiment_diagnostics`, using the original provider listing.
- Existing task decoration: saved diagnostic identity and verified report downloads.
- Browser action prefix: `diagnostic-`, dispatched by the shared extension host.
- Study navigation: `openExtension('study-transfer', 'openForStudies', roots)`.
- Investigation navigation: `openExtension('investigations', 'openForDiagnostic', selection)`.

The two cross-desk actions are offered when their actual target desk is present in the installed registry catalogue. The investigation selection includes `report_sha256` so a discussion remains attached to its original report revision.

For the full scientific operating procedure, read `DIAGNOSTICS.md`; for receiving a selected study, read `STUDY_TRANSFER.md`.
