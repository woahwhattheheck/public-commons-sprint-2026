# Managed Superset report application

The Superset chart data application starts the installed report workspace through the existing Applications provider protocol.

- Contribution: distribution/contributions/superset-workspace.json.
- Provider: distribution/runtime-workspace/providers/superset.mjs.
- Adapter: distribution/runtime-workspace/application-superset.mjs.
- Native launch reader: sf30-seller-sdk/superset/launch.mjs.
- Operator command: superset-workspace.

Select an owned private operator directory. An optional existing workspace keeps its retained source, selected edition, reviews and complete delivery history in that original folder. The manager resolves the actual installed source, reads its exact native file closure and retains the selection digest before launch.

The original server receives --directory, --source-directory, --expected-selection-sha256 and --startup-format managed, plus the optional --workspace and selected --port. It verifies the executed source against that selection before opening its native report workspace.

The one-line stellar-forge.superset-operator-launch.v1 announcement contains the operator/instance identities, actual PID and numeric loopback URL, selected workspace/source paths and exact source/selection digests. The token lives only in the owned 0600 operator-launch.json.

The manager's original startup observer reads that private record, verifies the process and selected source again, and makes the original authenticated /api/launch request. Both the record and active response must match the same instance. Opening the actual loopback URL establishes the application-specific HttpOnly SameSite cookie.

Stopping the application closes HTTP admission, drains or cancels its original captures, closes all owned native merchant services, saves the stopped launch state, closes the SQLite connection and releases both applicable directory leases. Restart uses the same retained records and source identities.

The complete operator workflow and installed commands are documented in sf30-seller-sdk/superset/README.md.
