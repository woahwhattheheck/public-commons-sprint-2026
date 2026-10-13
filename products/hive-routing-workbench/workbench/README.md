# Hive application workspace

A complete operator for importing a GraphQL application, running the original Hive Router, reviewing its complete client programme, switching the selected deployment, and delivering the entire saved edition to another installation.

The browser uses a plain grayscale interface. The command line calls the same controller and saves the same editions, processes, results and reviews.

## Open the operator

Use Linux with Python 3.10 or later. Install the pinned YAML reader, create a workspace outside the source directory, and start its local operator from this source root:

~~~bash
python3 -m pip install -r requirements.txt
python3 -m hive_desk init /work/hive/customer-workspace --name "Customer GraphQL application"
python3 -m hive_desk serve /work/hive/customer-workspace --port 8794
~~~

Open **http://127.0.0.1:8794** through the selected host's existing access. The operator listens on loopback. A receiving installation can select its own loopback port.

The application uses the original **Hive Router v0.3.4**, source commit **28eafc1bceb3dce8600d0eeea2ce2c2ec9563bb6**. Select the matching original Linux release executable in **Native deployments**. The programme checks its published bytes and SHA-256 before starting it.

| Platform | Original release asset | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Linux amd64 | hive_router_linux_amd64 | 70,274,296 | d59fc37101f1ae9c78dffc7a62dafd1ab7e4905aaa300e692661067b32670af6 |
| Linux arm64 | hive_router_linux_arm64 | 63,567,664 | b4e5e0c36a08f1e3bf25946228de2f00c99c672945358facdf1f6c2dc28b3bb3 |

Original assets: https://github.com/graphql-hive/router/releases/tag/hive-router%2Fv0.3.4

## Complete working sequence

1. Import the complete original edition. Its directory contains the native configuration, complete supergraph, agreed client operations and supporting files.
2. Review each configured native feature. The operator links directly to its original source and saves the specific retain/change decision and reason.
3. Prepare and start the original release executable. Inspect its actual process, native readiness and complete log.
4. Run every selected client operation. Open each full response and its original HTTP/request record. Expected GraphQL errors remain part of the review.
5. Save the complete programme review. Select the reviewed current native attempt for cutover.
6. Create a changed edition from the original files. Start its original native router, run the same complete programme, compare all outcomes, and review the actual changed behavior.
7. Cut over the workspace's stable HTTP GraphQL endpoint. A rollback uses the retained earlier deployment and a reviewed programme from its currently running native attempt.
8. Export the complete application and saved workspace. Receive it into a fresh directory, open the received source, select that installation's original executable and environment, and run its full programme.

The original reference programme, fixture source, configuration and receiving instructions are in **reference/**. It uses the upstream Rust fixture's accounts, inventory, products and reviews subgraphs.

## What travels together

The complete ZIP includes every path in source-files.json, the saved SQLite workspace, all original edition files, received native response bodies, completed native logs, reviews, deployment history and the complete source inventory. The receiving reader verifies the archive and original workspace before publishing the new directory.

A workspace keeps immutable file objects by content hash. Every saved entity change has a revision and a retained event. The incoming/current comparison identifies identical, forward or diverged histories; receiving always creates a complete separate directory.

## Operating documents

- OPERATING.md — original edition intake, private environment, complete results, cutover and process recovery.
- RECEIVING.md — export, inspect, receive, reopen and use a delivered application.
- WORKSHARE.md — proposed complete customer implementation, schedule, price and handover.
- upstream/SOURCE.json — original source and release provenance.
- upstream/router/LICENSE_MIT — the retained original upstream license.

## Source

Original Hive Router: https://github.com/graphql-hive/router/tree/28eafc1bceb3dce8600d0eeea2ce2c2ec9563bb6

Official router documentation: https://the-guild.dev/graphql/hive/docs/router

Official implementation partners: https://the-guild.dev/graphql/hive/partners

Pinned YAML reader: https://pypi.org/project/PyYAML/6.0.3/
