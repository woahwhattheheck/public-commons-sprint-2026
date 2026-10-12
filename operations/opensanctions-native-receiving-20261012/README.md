# OpenSanctions native receiving on an equipped Linux worker

This package continues the existing OpenSanctions source-monitoring project through the original yente matching engine and OpenSearch backend, then exports and reopens the same workspace. It uses the existing Commons native controller for capacity admission, execution, process identity, recovery and retained output.

The operation identity is **DCE4-OPENSANCTIONS-NATIVE-20261012**. Keep this identity, the original receiving input and the selected worker directory throughout preparation and execution.

## What this package supplies

| File | Responsibility |
| --- | --- |
| receive.py | Prepare the worker from exact source, start the original native operation, inspect or resume its record, request its original stop, and receive the complete output |
| native-receiver.py | Install or receive the selected native engines, index the original source edition, operate the retained screening requests, export the project and reopen the same source and case |
| SOURCE_CLOSURE.json | The 29 exact source files used by this operation, with original Git blob identities and byte lengths |
| README.md | Source, runtime, operating and receiving contract |

The 29-file closure contains the original NDJSON Workspace, dataset engine, monitoring application and standalone console. The complete managed Applications distribution is maintained by the existing Starforge distribution producer. Its merged provider and contribution are described in the original [Applications guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/4d4c9c32988e085607c870a1a37e1092f183fc2d/stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/opensanctions/MANAGED_APPLICATIONS.md).

## Original source and customer project

The application is pinned to merged commit **4d4c9c32988e085607c870a1a37e1092f183fc2d**, [PR1696](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1696). SOURCE_CLOSURE.json lists 29 files totaling 386,406 bytes. Each received member must match both its original Git blob and byte count.

The input is the original OpenSanctions_Receiving_Workspace.zip:

- Bytes: 7,700,640.
- SHA-256: 2773214cb71964dfd0059b144164df276a138a9c43a1d81b75766ee0c048097f.
- Source editions: UN 20260930120133-bwr and 20261012000104-kls.
- Complete populations: 2,926 before and 2,923 after.
- Original changing editions: four MOD, four DEL and one ADD across the three selected nonempty delta files.
- Current source case: 64e5904305d833550e4fcc96ae941879ca028fd07c4740ad9075fc3ef36837fb.
- Retained source-inspection portfolio: 346dca20eb08f2a7e7b16b1f43c6e52f7db1b360a5d017bc53f171888a0e6a65.

The original source operation already replayed those deltas, reconciled all 2,923 current records using the publisher's original content projection, followed NK-imakgBoSw66P4ytCKUaNZ2 to Q94511220, and reopened the complete project with its two-event case history. This continuation receives that project directly. Its matching queries select the same two retained public-source records.

The original input is delivered through the existing internal case/equipment handoff. Its data and retained customer history travel with the operated workspace. Source publication contains the receiving implementation and input identity.

## Native engines

| Component | Selected original |
| --- | --- |
| yente | Published 5.5.0 wheel from release 258c0a1fbcd9e7f70acdb113f19c28b7eac282b8 |
| yente wheel SHA-256 | 97d7a09af6ff919b76334e6784537d1ce24ec288c5436a2f19db99772f846401 |
| followthemoney | 4.9.2 |
| nomenklatura | 4.10.0 |
| rigour | 2.1.2 |
| PyICU | 2.16.2 |
| OpenSearch | Original 2.15.0 core/min Linux x86-64 TAR |
| Index schema | 016; the original installed function derives the full system and dataset index names |
| Dataset | un_sc_sanctions at 20261012000104-kls |
| Algorithm | Native logic-v2, limit 10, threshold 0.7 |

The selected OpenSearch archive is 252,915,665 bytes. Its SHA-512 is efd2a88766e8a2f5a7e0f73cc61fa45fa07edbe8c36ce7708bba4f80b64bf4b627bb9a46f26bd6e70279610ef1fd416b00d9a34387198ea3c7eb4d2e388356aa.

Publisher archive: https://artifacts.opensearch.org/releases/core/opensearch/2.15.0/opensearch-min-2.15.0-linux-x64.tar.gz

An existing cached archive can be selected with --search-archive. It is hashed before extraction. Select an existing Yente Python console script with --yente-bin and its actual interpreter with --yente-python. If the interpreter option is omitted, the script’s sibling `python` must exist. For a system installation whose interpreter is named `python3`, supply that actual path explicitly. The receiver preserves a virtual environment’s Python invocation path, records the resolved binary and `pyvenv.cfg` identity, and launches the original console script through that same selected interpreter. Preparation rejects a missing or changed interpreter before native execution; the native receiver checks all five installed distribution versions and compares every installed Yente Python source file against the original published wheel before provisioning or starting OpenSearch. This distinguishes the selected release from later main-branch code that retains the same package version.

The source index version from yente differs from a dataset's indexed edition. The native catalog must return un_sc_sanctions in current, with version and index_version both equal to 20261012000104-kls and index_current true. The original /readyz endpoint must also return HTTP 200.

## Select the actual existing worker

Use an equipped Linux x86-64 host with:

- Python 3.11 through 3.14 and Node 22 or later.
- The maintained Commons host directory containing native_foreground.py and swarm_cloud_job.py.
- Its actual existing shared state, memory-reservation and disk-reservation directories.
- A persistent private directory for this original operation.
- An existing nonroot OpenSearch account. When the receiving shell already uses that account, the default is its current identity.
- Original PyICU build inputs if a compatible installed yente environment is unavailable: matching ICU and Python development headers, linker files and a C++ compiler.

The wrapper records the actual Python/Node versions, source identities, host modules and selected paths. It loads the original Commons ForegroundLaunch and native.start functions. The runtime and capacity paths come from this worker's current configuration.

The default memory declaration is 1,536 MiB for the whole operation, plus the existing controller's 256 MiB reserve. The OpenSearch heap is explicitly 512 MiB, with separate 256 MiB metaspace and 64 MiB compressed class space settings. The memory declaration includes Python, native dependencies and source/data work; the heap value alone is not the total process demand.

Disk declarations total 3,072 MiB and 24,000 inodes. With a nonroot receiving shell, the complete declaration is attached to the operation directory. With a root shell using an existing nonroot search account, the original receiver's traversable /tmp search installation is declared separately: 1,792 MiB/16,000 inodes for the private job and 1,280 MiB/8,000 inodes for /tmp. The shared native controller decides admission against the real filesystems and existing reservations.

## Prepare the original operation

The following shell variables denote the actual paths supplied by the equipped host owner:

~~~sh
python3 receive.py prepare \
  --directory "$OPENSANCTIONS_JOB_DIRECTORY" \
  --input "$OPENSANCTIONS_ORIGINAL_INPUT" \
  --commons-host "$COMMONS_NATIVE_HOST" \
  --shared-state-root "$COMMONS_SHARED_STATE" \
  --memory-ledger "$COMMONS_MEMORY_LEDGER" \
  --disk-ledger "$COMMONS_DISK_LEDGER" \
  --node "$OPENSANCTIONS_NODE"
~~~

Optional selections:

~~~text
--source-root ACTUAL_MERGED_SF30_DIRECTORY
--python ACTUAL_PYTHON_EXECUTABLE
--search-user EXISTING_NONROOT_ACCOUNT
--search-archive ACTUAL_PINNED_OPENSEARCH_TAR
--yente-bin ACTUAL_ORIGINAL_YENTE_CONSOLE_SCRIPT
--yente-python ACTUAL_PYTHON_FOR_THAT_YENTE_ENVIRONMENT
--runtime-consumers-root EXISTING_SHARED_RUNTIME_REGISTRY
--records-root SAME_ORIGINAL_RECORDS_DIRECTORY
--allow-private-development-packages
~~~

--source-root reads the existing selected SF30 source and copies its exact 29 files into this private operation. Otherwise, preparation receives those same files from their pinned original Git URLs. Both paths enforce the identical manifest.

--allow-private-development-packages selects the receiver's existing private APT download/extract support. It retains signed index metadata, exact candidate versions, original package archives and SHA-256 values, and extracts the matching headers/runtime into this operation. The Python build uses that explicit include/library selection and one compiler job. The installed operating-system package database and package scripts are outside this private receiving action.

Preparation writes runtime-selection.json and preserves the original ZIP, native receiver and source closure. Repeated preparation accepts identical bytes and selections. A changed input, controller source or selected destination returns the specific conflicting path.

A SOURCE_READY result contains the selection digest, the real native record path, the complete source count and input identity. This stage prepares the original job; execution begins through start.

## Start and retain the same native job

~~~sh
python3 receive.py start --directory "$OPENSANCTIONS_JOB_DIRECTORY"
~~~

Keep this command attached to the existing worker's normal foreground-job route. The original controller records the intent, checks shared admission, retains process identity and hands the same process into its supervisor.

The start acknowledgement contains the actual original state and record. Capacity waiting remains in that record. Reissuing the same start selection returns the retained original operation through native.start; a different intent is rejected by that original controller.

Read the actual record with:

~~~sh
python3 receive.py status --directory "$OPENSANCTIONS_JOB_DIRECTORY"
~~~

Use the existing controller's retained capacity recovery for the same job:

~~~sh
python3 receive.py resume --directory "$OPENSANCTIONS_JOB_DIRECTORY"
~~~

When native status reports an explicit recoverable pre-dispatch failure, pass that exact reported failure digest:

~~~sh
python3 receive.py resume \
  --directory "$OPENSANCTIONS_JOB_DIRECTORY" \
  --recover-failure "$OPENSANCTIONS_REPORTED_FAILURE_SHA256"
~~~

The unchanged original resume_foreground/resume_capacity functions reconcile liveness, registration, the previous failure and its admission record. Keep the same directory and record through reconnections.

For an operator-requested stop of this selected operation:

~~~sh
python3 receive.py stop --directory "$OPENSANCTIONS_JOB_DIRECTORY"
~~~

The wrapper reads the original supervisor identity and calls native.stop with that selection. The receiver handles SIGTERM/SIGINT by retaining its current workspace, closing its owned services and writing its original result and artifact manifest.

## Native operation sequence

1. Verify the original 7,700,640-byte receiving input.
2. Receive the original native engines or select existing compatible installations. Retain exact dependency and source identities.
3. Open a private loopback OpenSearch instance with its own data, configuration, logs and ports.
4. Import the original customer workspace and verify its current edition, original case identity and two-event history.
5. Build the original yente local manifest with catalogs empty and only the retained UN dataset selected. Preserve its original identifiers and dataset edition.
6. Run the original yente reindex and serve commands.
7. Read native readiness, catalog and algorithms. Require the actual current dataset edition and logic-v2 algorithm.
8. Prepare and dispatch the original two-record match request through the application's own matching module. Retain the exact request bytes, response bytes, native candidate list and feature explanations.
9. Read the original Q94511220 entity through the same provider operation history.
10. Prepare the identical screening intent again and require the same request ID in RECEIVED state.
11. Export the complete original workspace, close it, import that export into the receiving workspace and reopen the same source case and received request.
12. Query the original dataset engine for Q94511220, retain the actual response, close the receiving workspace and both native services, and package the result.

Resolution and relevance remain separate customer decisions. The matching engine's returned candidates and explanations remain provider results in the same request history. The application preserves their original source and the customer's earlier decision history.

## Receive the complete return

~~~sh
python3 receive.py collect \
  --directory "$OPENSANCTIONS_JOB_DIRECTORY" \
  --return-directory "$OPENSANCTIONS_PERSISTENT_RETURN_DIRECTORY"
~~~

Collection reads the actual native record and original artifact manifest. Every retained output member must match its recorded byte count and SHA-256. The complete archive is copied under a name containing its digest; repeated collection preserves that same archive and immutable source receipt.

The command returns the actual native state/exit code, domain result, input identity, source commit, output digest, member inventory and service-close time. Exit zero requires both native exit zero and NATIVE_RECEIVING_COMPLETE. A selected failure or interruption returns its actual retained result and a nonzero outcome.

Primary outputs:

| Output | Content |
| --- | --- |
| operation/results/run-result.json | Actual selected source, native commands, request/response operations, receiving result and service closure |
| operation/results/run-artifacts.json | Exact original output filenames, lengths and SHA-256 values |
| operation/results/native-return.tar.gz | Complete selected original output package |
| OpenSanctions_Native_Receiving_Workspace.zip | Full workspace with original sources, case history and received native requests |
| Native command and HTTP files | Original engine logs, versions, readiness, indexed edition, algorithms and response bodies |

The operator's existing workspace remains under operation/workspace. The cold receiving workspace remains under operation/receiving. The standalone console can then open that same received project with the selected Python and source; use the complete merged Applications guide for the existing managed Start/Open/Stop/reopen surface.

## Source references

- Original product: https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1696
- Source monitoring guide: https://www.opensanctions.org/docs/monitoring/
- Identifier continuity: https://www.opensanctions.org/docs/identifiers/
- Original statement fields: https://www.opensanctions.org/docs/statements/
- yente release source: https://github.com/opensanctions/yente/tree/258c0a1fbcd9e7f70acdb113f19c28b7eac282b8
- Published release metadata: https://pypi.org/pypi/yente/5.5.0/json
- OpenSearch 2.15 original installation guide: https://docs.opensearch.org/2.15/install-and-configure/install-opensearch/index/
- Commons native controller source: https://github.com/woahwhattheheck/commons/blob/01fd307e1e1dad152ce491b219190a500dee1578/host/swarm_cloud_job.py
- Commons original foreground operation: https://github.com/woahwhattheheck/commons/blob/01fd307e1e1dad152ce491b219190a500dee1578/host/native_foreground.py

Deliver the complete native return to the same original customer case and source-family handoff, then reopen its retained matching request and case in the maintained operator.
