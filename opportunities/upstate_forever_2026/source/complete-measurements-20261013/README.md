# Complete Measurements installation — 13 October 2026

TJLabs / Eco Measurements. Existing operation ECO-REGIONAL-DELIVERY-7F24-20261012.

PR4788 is merged at 4916b0859fa9ca728e0937a1678821b9a759af2d. This source package contains all250 installed application files plus the complete original installation tooling, instructions and receiver: 253 files, 7256464 original source bytes. The source bank is 7549626 bytes, SHA256 7dc48927fb52a79d21564ce8fc3537f141e22f07c8df198251bf406c79612a50. The attached source.json is the accepted commons.artifact-base64/v1 envelope; its decoded source schema is commons.source-text-bank/v1.

Receive the entire source.json through the existing connected Git/Gmail ordinary-file route. Preserve the original working application, Measurements SQLite directory, scientific Workspace, active tasks and source owners. Stage into a separate new directory with the current materialize_source_banks.py:

```sh
python -B APP/source_tools/materialize_source_banks.py --bank source.json --output OWNED_SOURCE_DIRECTORY
python -B OWNED_SOURCE_DIRECTORY/source/operator/install_measurements.py --application APP --source-root OWNED_SOURCE_DIRECTORY/source --check
python -B OWNED_SOURCE_DIRECTORY/source/operator/install_measurements.py --application APP --source-root OWNED_SOURCE_DIRECTORY/source
```

Use the actual original interpreter and paths. A source preimage conflict identifies an independently advanced file; compose that complete current file with its owner and retain its history. The installer carries current accepted source predecessors, appends the complete owner instructions, and preserves its existing lock/backup behavior.

The existing native-observation receiving course continues in the same application and original Workspace:

```sh
cd APP
python -B -m measurement_workspace.native_observations --workspace ORIGINAL_WORKSPACE --action catalog --output OWNED_OUTPUT/catalog.json
```

Follow measurement_workspace/NATIVE_OBSERVATION_HANDOFF.md for the actual selected import, exact preview, explicit confirmed preparation, original source export and Monitoring selection. measurement_workspace/DAILY_FLOW_STUDIES.md covers original WQP/flow receive, saved load reports and complete download/reopen. The original Hartwell132 and SV-23358 collections and every original source member are included, as are their complete prepared scientific products. Current saved reports display every original measurement and censor bound directly. No scientific result ID or calculation is changed by that display addition.

The cumulative inventory retains source returns, original533 receiving, source reconciliation, returned reviews, observed benchmarks, complete workbook import/lineage and native Monitoring bridge. Both registered review and Measurements descriptor/backend families are included. Current owner direction2026-10-13.4 and AGENTS.md apply to actual desktop/390px operation and every outgoing artifact. Preserve the currently owned browser/service; return the first actual command result or complete exception in the original Eco thread1791724121.853269.
